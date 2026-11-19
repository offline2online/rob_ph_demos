#!/usr/bin/env node
// Support Inbox and Aidan: how well the real model matches emails to the Help
// Centre.
//
// Runs the one answering engine both use (functions/answer-core.js: is it
// about Personalisation Hub, which articles answer it, then the draft) on the
// made-up emails in test/fixtures/support-eval.json, against the published
// articles in faq/data, and reports for each one: about Personalisation Hub or
// not, the articles chosen, whether that was a right match, the confidence and
// the draft. Exits 1 when any case is wrong.
//
// Every case goes through BOTH paths, judged by the same rules (judgeCase):
//   support  the email as a customer wrote it to support@ (triage);
//   aidan    the same email from an allowed sender, tagged "@Aidan, …"
//            (Aidan's answer run), and the reply Aidan would send.
// EVAL_PATHS=support (or aidan) runs one of them.
//
// With GOOGLE_APPLICATION_CREDENTIALS it also runs the Support Inbox Test
// lab's cases (Firestore supportEvalCases, read directly; LAB_CASES=0 skips
// them) through the support@ path and prints only each case's id, the
// article titles chosen and expected, and the judge's verdict: a case copied
// from a ticket is a customer's email, so never its subject or text. A failing
// lab case is reported, not a failed check: the lab's set tracks what the
// engine still gets wrong.
//
// REPLAY=<n> (and GOOGLE_APPLICATION_CREDENTIALS) also re-runs the newest n
// real tickets and prints only their SUP key, the articles matched before and
// now, and the scores. Never their subject, sender or text: logs here are
// public and those are customers' emails.
//
//   ANTHROPIC_API_KEY=… node backlog-tracker/scripts/support-eval.js [case-id …]
// .github/workflows/support-eval.yml runs it with the repository's key.
"use strict";
const fs = require("fs");
const path = require("path");
const core = require("../functions/support-core");
const answerCore = require("../functions/answer-core");
const ac = require("../functions/aidan-core");
const { callJson } = require("../functions/support-mail");
const labCore = require("../functions/support-lab-core");
const { articleView } = answerCore;

const root = path.join(__dirname, "..", "..");
const faqDir = path.join(root, "faq", "data");
const CONCURRENCY = 4;

function loadArticles() {
  const index = JSON.parse(fs.readFileSync(path.join(faqDir, "index.json"), "utf8"));
  const catName = new Map(index.categories.map((c) => [c.id, c.name]));
  return index.articles.filter((a) => a.status === "published").map((meta) => {
    const file = path.join(faqDir, "articles", `${meta.id}.json`);
    const full = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : meta;
    return articleView(Object.assign({}, meta, full), catName.get(meta.categoryId) || "");
  });
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

const PATHS = ["support", "aidan"];
// One fixture as each path gives it to the engine: a customer's email to
// support@ as triage reads it, and the same email tagged for Aidan as an
// answer run reads it (functions/aidan.js → helpCentreAnswer).
function engineInput(c, pathName) {
  if (pathName === "aidan") return answerCore.questionFromEmail({ fromName: c.fromName, fromEmail: c.fromEmail, subject: c.subject, text: `@Aidan, ${c.text || ""}` });
  return { ticket: { subject: c.subject || "(no subject)", customerEmail: c.fromEmail, fromEmail: c.fromEmail, customerName: c.fromName || "" }, messages: [{ direction: "in", text: c.text || "" }] };
}
// What is wrong with the engine's answer for a fixture: the same rules for
// both paths, and for the Test lab's runs (functions/support-lab-core.js).
const { judgeCase } = labCore;
// The reply each path would write from the engine's answer: the Support
// Inbox's draft, or the email Aidan sends ("" when the Help Centre doesn't
// answer and his run carries on to the console and the email).
function draftFor(pathName, c, t, cited) {
  if (pathName === "aidan") return answerCore.usableAnswer(t) ? ac.composeHelpCentreAnswer({ firstName: ac.greetingName(c.fromName), replyText: answerCore.withArticleTitles(core.stripOpening(t.reply), cited) }) : "";
  return t.reply ? core.composeReply(core.firstNameOf(c.fromName || "", c.fromEmail), t.reply) : "";
}
// Run one fixture through one path. `call` is the model caller.
async function runCase(c, pathName, articles, call) {
  const { raw, triage: t, cited } = await answerCore.answerFromHelpCentre(Object.assign({ call, articles, source: pathName }, engineInput(c, pathName)));
  return Object.assign({ raw, t, cited, draft: draftFor(pathName, c, t, cited) }, judgeCase(c, raw, t));
}

const liveCall = (opts) => callJson(Object.assign({ apiKey: process.env.ANTHROPIC_API_KEY, workspaceId: process.env.ANTHROPIC_WORKSPACE_ID || "" }, opts));
async function triage(ticket, messages, articles) {
  const { raw, triage: t } = await answerCore.answerFromHelpCentre({ call: liveCall, ticket, messages, articles });
  return { raw, t };
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === "unset") { console.error("ANTHROPIC_API_KEY is not set"); process.exit(2); }
  const articles = loadArticles();
  const title = new Map(articles.map((a) => [a.id, a.title]));
  const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "test", "fixtures", "support-eval.json"), "utf8")).cases;
  const only = process.argv.slice(2);
  const cases = only.length ? fixtures.filter((c) => only.includes(c.id)) : fixtures;
  const paths = String(process.env.EVAL_PATHS || PATHS.join(",")).split(",").map((p) => p.trim()).filter((p) => PATHS.includes(p));
  if (!paths.length) { console.error(`EVAL_PATHS is one or more of ${PATHS.join(", ")}`); process.exit(2); }
  console.log(`support-eval: ${cases.length} emails against ${articles.length} published articles, through ${paths.join(" and ")}\n`);

  const jobs = paths.flatMap((p) => cases.map((c) => ({ c, path: p })));
  const results = await pool(jobs, CONCURRENCY, async ({ c, path: p }) => {
    const t0 = Date.now();
    try {
      const r = await runCase(c, p, articles, liveCall);
      return Object.assign(r, { c, path: p, ms: Date.now() - t0, top1: c.articles.length ? c.articles.includes(r.chosen[0]) : null });
    } catch (err) {
      return { c, path: p, error: String(err && err.message ? err.message : err), problems: ["error"], ms: Date.now() - t0 };
    }
  });

  for (const r of results) {
    const mark = r.problems.length ? "FAIL" : "ok  ";
    console.log(`${mark} ${r.c.id} [${r.path}]  (${Math.round(r.ms / 100) / 10}s)`);
    console.log(`     subject: ${r.c.subject || "(none)"}`);
    if (r.error) { console.log(`     error: ${r.error}\n`); continue; }
    console.log(`     about Personalisation Hub: ${r.t.relevant ? "yes" : "no"} (expected ${r.c.relevant ? "yes" : "no"}) · category ${r.t.category} · confidence ${Math.round(r.t.confidence * 100)}% · ${r.t.answerable ? "answered" : "holding reply / none"}`);
    if ((r.t.confidenceSteps || []).length > 1) console.log(`     confidence: ${r.t.confidenceSteps.map((x) => `${Math.round(x.confidence * 100)}% from ${x.articles} article${x.articles === 1 ? "" : "s"}`).join(" → ")}`);
    console.log(`     understood: ${r.t.summary}`);
    console.log(`     chose: ${r.chosen.length ? r.chosen.map((id) => `${title.get(id)}${r.c.articles.includes(id) ? " ✓" : ""}`).join(" | ") : "(none)"}`);
    if (r.c.articles.length) console.log(`     right answers: ${r.c.articles.map((id) => title.get(id)).join(" | ")}`);
    if (r.problems.length) console.log(`     problem: ${r.problems.join("; ")}`);
    if (r.draft) console.log(`     ${r.path === "aidan" ? "Aidan's reply" : "draft"}:\n${r.draft.split("\n").map((l) => `       > ${l}`).join("\n")}`);
    else if (r.path === "aidan" && r.t.relevant) console.log("     Aidan: the Help Centre doesn't answer it, so the run carries on to the console and the email");
    console.log("");
  }

  const bad = results.filter((r) => r.problems.length);
  for (const p of paths) {
    const mine = results.filter((r) => r.path === p);
    const withArticles = mine.filter((r) => r.c.relevant && r.c.articles.length && !r.error);
    console.log(`[${p}] about Personalisation Hub decided right: ${mine.filter((r) => !r.error && r.t.relevant === r.c.relevant).length}/${mine.length}`);
    console.log(`[${p}] a right article among those chosen: ${withArticles.filter((r) => r.chosen.some((id) => r.c.articles.includes(id))).length}/${withArticles.length}`);
    console.log(`[${p}] a right article chosen first: ${withArticles.filter((r) => r.top1).length}/${withArticles.length}`);
    const confs = mine.filter((r) => !r.error && r.t.relevant && r.t.answerable).map((r) => r.t.confidence);
    if (confs.length) console.log(`[${p}] answered: ${confs.length}, average confidence ${Math.round(confs.reduce((x, y) => x + y, 0) / confs.length * 100)}%, ${confs.filter((c) => c >= 0.8).length} at 80% or more; ${mine.filter((r) => (r.t && r.t.confidenceSteps || []).length > 1).length} needed more articles`);
    const failed = mine.filter((r) => r.problems.length);
    console.log(`[${p}] cases passed: ${mine.length - failed.length}/${mine.length}${failed.length ? ` (failed: ${failed.map((r) => r.c.id).join(", ")})` : ""}`);
  }
  // The two paths are one engine: say where they chose a different first article for the same email.
  if (paths.length === 2) {
    const first = (p, id) => { const r = results.find((x) => x.path === p && x.c.id === id); return r && !r.error ? r.chosen[0] || "" : null; };
    const differ = cases.filter((c) => first("support", c.id) !== null && first("aidan", c.id) !== null && first("support", c.id) !== first("aidan", c.id)).map((c) => c.id);
    console.log(`same first article through both paths: ${cases.length - differ.length}/${cases.length}${differ.length ? ` (differ: ${differ.join(", ")})` : ""}`);
  }

  if (process.env.LAB_CASES !== "0" && !only.length) await labCases(articles, title);
  const replay = Number(process.env.REPLAY || 0);
  if (replay > 0) await replayTickets(replay, articles, title);
  process.exit(bad.length ? 1 : 0);
}

// Firestore through the service account (firebase-admin is a dependency of
// functions/, not of this folder). One app for the lab cases and the replay.
let firestore = null;
function adminDb() {
  if (firestore) return firestore;
  const fromFunctions = (m) => require(require.resolve(m, { paths: [path.join(__dirname, "..", "functions")] }));
  const { initializeApp, applicationDefault } = fromFunctions("firebase-admin/app");
  const { getFirestore } = fromFunctions("firebase-admin/firestore");
  initializeApp({ credential: applicationDefault() });
  firestore = getFirestore();
  return firestore;
}

// The Test lab's cases (Support › Support Inbox › Test lab), printing nothing
// a customer wrote: the case id, its source, and article titles only.
async function labCases(articles, title) {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) { console.log("\nlab cases: skipped (no service account)"); return; }
  let rows = [];
  try {
    const snap = await adminDb().collection("supportEvalCases").get();
    rows = snap.docs.map((d) => Object.assign({ id: d.id }, d.data() || {})).filter(labCore.inRun);
  } catch (err) { console.log(`\nlab cases: not read (${String(err && err.message ? err.message : err).slice(0, 160)})`); return; }
  console.log(`\nlab cases: ${rows.length} from the Test lab (id and article titles only)`);
  const names = (ids) => (ids.length ? ids.map((id) => title.get(id) || `(${id})`).join(" | ") : "(none)");
  const results = await pool(rows, CONCURRENCY, async (c) => {
    const fixture = labCore.fixtureOf(c);
    try {
      const { raw, triage: t } = await answerCore.answerFromHelpCentre({ call: liveCall, articles, source: "support", ...answerCore.questionFromEmail({ fromEmail: "customer@example.com", subject: c.subject, text: c.text }) });
      return Object.assign({ c, fixture }, judgeCase(fixture, raw, t));
    } catch (err) { return { c, fixture, chosen: [], problems: ["error"] }; }
  });
  for (const r of results) {
    console.log(`${r.problems.length ? "FAIL" : "ok  "} lab:${r.c.id} [${r.c.source || "lab"}]  chose: ${names(r.chosen)}`);
    console.log(`     expected: ${r.fixture.relevant ? names(r.fixture.articles) : "not about Personalisation Hub"}${r.problems.length ? ` · problem: ${r.problems.join("; ")}` : ""}`);
  }
  console.log(`[lab] cases passed: ${results.filter((r) => !r.problems.length).length}/${results.length}`);
}

// The newest real tickets again, printing nothing a customer wrote.
async function replayTickets(n, articles, title) {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) { console.log("\nreplay: skipped (no service account)"); return; }
  const db = adminDb();
  const snap = await db.collection("supportTickets").orderBy("lastMessageAt", "desc").limit(Math.min(n, 20)).get();
  console.log(`\nreplay: the ${snap.size} newest real tickets (key and article titles only)`);
  for (const d of snap.docs) {
    const tk = d.data() || {};
    if (tk.automated) { console.log(`  ${tk.key}: machine-sent, never drafted`); continue; }
    const msnap = await d.ref.collection("messages").get();
    const messages = msnap.docs.map((m) => m.data()).filter((m) => m.direction === "in" || m.direction === "out")
      .sort((a, b) => (a.at && a.at.toMillis ? a.at.toMillis() : 0) - (b.at && b.at.toMillis ? b.at.toMillis() : 0));
    try {
      const { raw, t } = await triage({ subject: tk.subject, customerEmail: tk.customerEmail, fromEmail: tk.fromEmail, customerName: tk.customerName }, messages, articles);
      const before = ((tk.aiDraft && tk.aiDraft.articles) || []).map((a) => a.title);
      console.log(`  ${tk.key}: before → ${before.length ? before.join(" | ") : "(no article)"}`);
      console.log(`  ${" ".repeat(String(tk.key).length)}  now    → ${(raw.selectedIds || []).length ? raw.selectedIds.map((id) => title.get(id)).join(" | ") : "(no article)"} · about PH: ${t.relevant ? "yes" : "no"} · ${t.category} · ${Math.round(t.confidence * 100)}% · ${t.answerable ? "answered" : "holding reply / none"}`);
    } catch (err) { console.log(`  ${tk.key}: error ${String(err && err.message ? err.message : err).slice(0, 160)}`); }
  }
}

if (require.main === module) main().catch((err) => { console.error(err); process.exit(2); });

module.exports = { PATHS, loadArticles, engineInput, judgeCase, draftFor, runCase };
