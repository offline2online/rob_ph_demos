"use strict";
// Support › Support Inbox › Test lab: ask the answering engine a question,
// rate the answer, keep it as a test case, and run every case again to track
// accuracy over time. Nothing here reads or sends mail, and nothing files a
// ticket: the question goes through the same engine the Support Inbox and
// Aidan use (functions/answer-core.js → answerFromHelpCentre), as a customer's
// first email to support@.
//
// Routes (under /supportMail, created by functions/support-mail.js):
//   POST /v1/lab/ask                    editor  {subject, text}: the draft, the articles, the confidence steps and decideAction's verdict
//   POST /v1/lab/cases                  editor  {id?, subject, text, expect, articleIds, rating, note, answered}: save a case
//   POST /v1/lab/cases/{id}/delete      editor
//   POST /v1/lab/from-ticket            editor  {ticketId}: the ticket's question and final answer as case t-<ticketId>, once
//   POST /v1/lab/runs                   editor  start a run of every case (or continue the one still running)
//   POST /v1/lab/runs/{id}/step         editor  run the next few cases of a run and record them
//
// supportEvalCases and supportEvalRuns are read by members straight from
// Firestore and written only here (firestore.rules). A run holds ids, counts
// and the judge's wording, never a question or a draft. Logs carry ids and
// counts only: a case copied from a ticket is a customer's email.
//
// Pure apart from what support-mail.js injects, so test/support-lab.test.js
// runs it with no Firebase, no network and no model.

const crypto = require("crypto");
const core = require("./support-core");
const answerCore = require("./answer-core");
const lab = require("./support-lab-core");

const CASES = "supportEvalCases";
const RUNS = "supportEvalRuns";
const ASKS_PER_HOUR = 60;
const RUNS_PER_HOUR = 10;
// The sender a lab question is asked as: a reserved domain, no name, so the
// draft opens "Hi there," and no account rule (high value) can match.
const LAB_SENDER = "customer@example.com";

function createSupportLab({ db, requireRole, articles, readSettings, modelCall, anthropicKey, triageImpl = null, tickets, threadMessages, now, logger = console }) {
  const cases = () => db.collection(CASES);
  const runs = () => db.collection(RUNS);
  const send = (res, status, body) => res.status(status).set("Cache-Control", "no-store").json(body);
  const data = (snap) => (snap.exists ? snap.data() || {} : null);
  const ms = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : v instanceof Date ? v.getTime() : typeof v === "string" ? Date.parse(v) || 0 : typeof v === "number" ? v : 0);
  const errText = (err) => core.clip(String(err && err.message ? err.message : err), 200);
  const recent = new Map(); // `${kind}:${member}` -> call times in the last hour
  function rateLimited(kind, who, max) {
    const key = `${kind}:${who}`;
    const list = (recent.get(key) || []).filter((t) => now().getTime() - t < 3600000);
    if (list.length >= max) return true;
    recent.set(key, [...list, now().getTime()]);
    return false;
  }
  const modelReady = () => { const k = String(anthropicKey() || ""); return Boolean(triageImpl || (k && k !== "unset")); };
  const NO_MODEL = "No drafting model is configured (ANTHROPIC_API_KEY).";

  // One question through the engine, as a customer's first email to support@.
  async function answer({ subject, text }, all) {
    const q = answerCore.questionFromEmail({ fromEmail: LAB_SENDER, subject, text });
    return answerCore.answerFromHelpCentre({ run: triageImpl, call: modelCall(String(anthropicKey() || "")), ticket: q.ticket, messages: q.messages, articles: all, source: "support" });
  }
  const view = (all) => { const byId = new Map(all.map((a) => [a.id, a])); return (id) => { const a = byId.get(id); return a ? { id, title: a.title, url: a.url } : { id, title: "", url: "" }; }; };

  // ── Ask ──
  async function ask(body) {
    const subject = core.clip(String(body.subject || "").replace(/\s+/g, " ").trim(), lab.SUBJECT_MAX);
    const text = String(body.text || "").replace(/\r/g, "").trim();
    if (!text) return { status: 400, body: { error: "Write the question first." } };
    if (text.length > lab.QUESTION_MAX) return { status: 400, body: { error: `A question is at most ${lab.QUESTION_MAX} characters.` } };
    if (!modelReady()) return { status: 503, body: { error: NO_MODEL } };
    const all = await articles();
    let answered;
    try { answered = await answer({ subject, text }, all); }
    catch (err) { return { status: 502, body: { error: `The answer couldn't be written: ${errText(err)}` } }; }
    const { raw, triage: t, cited } = answered;
    // decideAction exactly as the Support Inbox calls it for a customer's first
    // email to support@ from an ordinary sender, with today's settings.
    const settings = await readSettings();
    const d = core.decideAction({ triage: t, settings, highValue: false, automated: "", autoRepliesSent: 0, humanInvolved: false, replyToDiffers: false, inboxes: [core.DEFAULT_INBOX] });
    const v = view(all);
    return { status: 200, body: {
      ok: true, relevant: t.relevant, category: t.category, summary: t.summary, spamLikely: t.spamLikely, answerable: t.answerable,
      confidence: t.confidence, confidenceSteps: t.confidenceSteps || [],
      matched: ((raw && raw.selectedIds) || []).map(v), articles: cited,
      draft: t.reply ? core.composeReply("", t.reply) : "",
      decision: { action: d.action, label: lab.DECISION_LABEL[d.action] || d.action, reason: d.reason },
    } };
  }

  // ── Cases ──
  async function saveCase(body, by) {
    const all = await articles();
    const { value, error } = lab.cleanCaseInput(body, all.map((a) => a.id));
    if (error) return { status: 400, body: { error } };
    const id = body.id ? String(body.id) : `c-${now().getTime()}-${crypto.randomBytes(3).toString("hex")}`;
    if (!lab.CASE_ID_RE.test(id)) return { status: 400, body: { error: "That isn't a case id." } };
    const ref = cases().doc(id);
    const cur = data(await ref.get());
    if (body.id && !cur) return { status: 404, body: { error: "That case was deleted." } };
    const doc = Object.assign({}, value, { needsReview: false, updatedBy: by, updatedAt: now() },
      cur ? {} : { source: "lab", createdBy: by, createdAt: now(), lastResult: null });
    // An edit that changes what should happen makes the last result out of date.
    if (cur && (cur.expect !== value.expect || String(cur.articleIds || []) !== String(value.articleIds) || cur.text !== value.text)) doc.lastResult = null;
    await ref.set(doc, { merge: true });
    return { status: 200, body: { ok: true, id } };
  }
  async function deleteCase(id) {
    const ref = cases().doc(id);
    if (!data(await ref.get())) return { status: 404, body: { error: "That case was deleted already." } };
    await ref.delete();
    return { status: 200, body: { ok: true } };
  }
  // "Add to test lab" on a Support Inbox or Aidan ticket: once per ticket.
  async function fromTicket(body, by) {
    const ticketId = String(body.ticketId || "");
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(ticketId)) return { status: 400, body: { error: "That isn't a ticket id." } };
    const ticket = data(await tickets().doc(ticketId).get());
    if (!ticket) return { status: 404, body: { error: "no such ticket" } };
    const id = `t-${ticketId}`;
    const ref = cases().doc(id);
    if (data(await ref.get())) return { status: 200, body: { ok: true, id, already: true } };
    const source = body.source === "aidan" || (ticket.aidan && !(ticket.inboxes || []).includes(core.DEFAULT_INBOX)) ? "aidan" : "support";
    const { value, error } = lab.caseFromTicket(ticket, await threadMessages(ticketId), source);
    if (error) return { status: 400, body: { error } };
    // Expected articles taken from the answer must still be published.
    const known = new Set((await articles()).map((a) => a.id));
    if (value.articleIds.some((x) => !known.has(x))) Object.assign(value, { articleIds: value.articleIds.filter((x) => known.has(x)) });
    if (!value.articleIds.length) Object.assign(value, { expect: "", needsReview: true });
    await ref.set(Object.assign(value, { ticketId, ticketKey: ticket.key || "", createdBy: by, createdAt: now(), updatedBy: by, updatedAt: now(), lastResult: null }));
    return { status: 200, body: { ok: true, id, needsReview: value.needsReview } };
  }

  // ── Runs ──
  async function startRun(by) {
    if (!modelReady()) return { status: 503, body: { error: NO_MODEL } };
    const open = await runs().where("status", "==", "running").get();
    const live = [];
    open.forEach((d) => live.push({ id: d.id, ref: runs().doc(d.id), d: d.data() || {} }));
    for (const r of live) {
      if (now().getTime() - ms(r.d.updatedAt || r.d.startedAt) < lab.RUN_STALE_MS) return { status: 200, body: { ok: true, id: r.id, resumed: true } };
      await r.ref.set({ status: "stopped", finishedAt: now(), updatedAt: now() }, { merge: true });
    }
    const snap = await cases().get();
    const ids = [];
    snap.forEach((d) => { if (lab.inRun(d.data() || {})) ids.push(d.id); });
    if (!ids.length) return { status: 400, body: { error: "There are no cases to run yet. Save a question to the test set first." } };
    if (ids.length > lab.MAX_CASES) return { status: 400, body: { error: `A run takes at most ${lab.MAX_CASES} cases; the set has ${ids.length}. Delete some first.` } };
    const id = `r-${now().getTime()}-${crypto.randomBytes(3).toString("hex")}`;
    await runs().doc(id).set({
      status: "running", startedBy: by, startedAt: now(), updatedAt: now(), finishedAt: null,
      total: ids.length, caseIds: ids, pending: ids, claims: [], results: {}, passed: 0, failed: 0, done: 0, accuracy: null,
    });
    logger.info("support: test lab run started", { runId: id, cases: ids.length });
    return { status: 200, body: { ok: true, id, total: ids.length } };
  }

  async function step(runId) {
    if (!modelReady()) return { status: 503, body: { error: NO_MODEL } };
    const ref = runs().doc(runId);
    const nowMs = now().getTime();
    const claimed = await db.runTransaction(async (tx) => {
      const run = data(await tx.get(ref));
      if (!run) return null;
      if (run.status !== "running") return { run, take: [] };
      const next = lab.claimNext(run, nowMs);
      if (next.take.length) tx.set(ref, { pending: next.pending, claims: next.claims, updatedAt: now() }, { merge: true });
      return { run, take: next.take };
    });
    if (!claimed) return { status: 404, body: { error: "no such run" } };
    if (!claimed.take.length) return { status: 200, body: progress(claimed.run) };

    const all = await articles();
    const results = {};
    await Promise.all(claimed.take.map(async (caseId) => {
      const c = data(await cases().doc(caseId).get());
      if (!c || !lab.inRun(c)) { results[caseId] = lab.errorResult("the case was deleted or changed"); return; }
      try { results[caseId] = lab.resultOf(c, await answer({ subject: c.subject, text: c.text }, all)); }
      catch (err) {
        logger.warn("support: test lab case failed", { runId, caseId, error: errText(err) });
        results[caseId] = lab.errorResult(errText(err));
      }
    }));

    const run = await db.runTransaction(async (tx) => {
      const cur = data(await tx.get(ref));
      if (!cur) return null;
      const caseRefs = Object.keys(results).map((id) => cases().doc(id));
      const caseDocs = [];
      for (const r of caseRefs) caseDocs.push(await tx.get(r));
      const merged = Object.assign({}, cur.results || {}, results);
      const claims = (cur.claims || []).filter((c) => !(c.id in results));
      const sum = lab.summarise(merged);
      const finished = cur.status === "running" && !(cur.pending || []).length && !claims.length;
      const patch = { results: merged, claims, passed: sum.passed, failed: sum.failed, done: sum.done, accuracy: sum.accuracy, updatedAt: now(),
        ...(finished ? { status: "done", finishedAt: now() } : {}) };
      tx.set(ref, patch, { merge: true });
      caseRefs.forEach((r, i) => { if (caseDocs[i].exists) tx.set(r, { lastResult: Object.assign({ runId, at: now() }, results[r.id]) }, { merge: true }); });
      return Object.assign({}, cur, patch);
    });
    if (!run) return { status: 404, body: { error: "no such run" } };
    if (run.status === "done") logger.info("support: test lab run finished", { runId, cases: run.total, passed: run.passed, failed: run.failed });
    return { status: 200, body: progress(run) };
  }
  function progress(run) {
    return { ok: true, status: run.status, total: run.total || 0, done: run.done || 0, passed: run.passed || 0, failed: run.failed || 0,
      accuracy: run.accuracy == null ? null : run.accuracy, remaining: (run.pending || []).length, running: (run.claims || []).length };
  }

  // ── HTTP ── `path` has /supportMail removed; returns false when it isn't a lab route.
  async function handle(req, res, path) {
    if (!path.startsWith("/v1/lab/")) return false;
    const who = await requireRole(req, "editor");
    if (!who.ok) { send(res, who.status, { error: who.error }); return true; }
    if (req.method !== "POST") { send(res, 405, { error: "POST only" }); return true; }
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const by = who.user.email;
    let r;
    let m;
    if (path === "/v1/lab/ask") {
      r = rateLimited("ask", by, ASKS_PER_HOUR) ? { status: 429, body: { error: `At most ${ASKS_PER_HOUR} questions an hour. Try again later.` } } : await ask(body);
    } else if (path === "/v1/lab/cases") r = await saveCase(body, by);
    else if ((m = /^\/v1\/lab\/cases\/([A-Za-z0-9_-]{1,100})\/delete$/.exec(path))) r = await deleteCase(m[1]);
    else if (path === "/v1/lab/from-ticket") r = await fromTicket(body, by);
    else if (path === "/v1/lab/runs") r = rateLimited("run", by, RUNS_PER_HOUR) ? { status: 429, body: { error: `At most ${RUNS_PER_HOUR} runs an hour. Try again later.` } } : await startRun(by);
    else if ((m = /^\/v1\/lab\/runs\/([A-Za-z0-9_-]{1,100})\/step$/.exec(path))) r = await step(m[1]);
    else r = { status: 404, body: { error: "not found" } };
    send(res, r.status, r.body);
    return true;
  }

  return { handle, ask, saveCase, deleteCase, fromTicket, startRun, step };
}

module.exports = { createSupportLab, CASES, RUNS, LAB_SENDER, ASKS_PER_HOUR, RUNS_PER_HOUR };
