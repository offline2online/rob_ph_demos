"use strict";
// Aidan in the console (yvnAPPAW9ROLrNwJceyn): the chat panel's endpoint on the
// console's own API (functions/mcp-server.js → mcpServer, /mcp/aidan/chat).
//
//   POST /aidan/chat {text, conversationId?, input?: "text" | "voice"}
//        One turn. The caller is the signed-in member (X-Firebase-ID-Token,
//        requireConsoleUser): any role. The turn reads the console as THAT
//        member (aidan-chat-core.js → chatSession: their email and role,
//        board.read only, via "aidan-chat"), through the same read tools,
//        PH Agent Context and Code Mode run the agent mailbox uses
//        (functions/aidan.js → chat), so a viewer's chat never returns what a
//        viewer's own agent could not read. Read-only: a request to change
//        anything is answered with where to do it, and nothing is changed.
//        → {conversationId, title, message: {role: "aidan", text, at, readOnly,
//          links, outcome}, durationMs}
//   GET  /aidan/chat              → {conversations: [{id, title, updatedAt, turns}]}, the caller's own, newest first
//   GET  /aidan/chat?id=<id>      → {conversation: {id, title, messages, updatedAt}}, the caller's own only
//
// Kept: aidanChats/{id} = {email, title, messages: [{role, text, at, readOnly?,
// links?}], turns, createdAt, updatedAt, updatedAtMs}, at most CHAT_KEEP per
// member (older ones are deleted) and CHAT_MESSAGES_MAX messages each.
// Audited: aidanChatRuns, one row per turn (who, role, when, the input kind,
// the tools read and how many reads, the Code Mode run, the outcome and the
// duration; never the message text). Rate limit: CHAT_RATE_MAX turns per
// member per CHAT_RATE_WINDOW_MS (aidanChatLimits/{email}, in a transaction,
// so every instance counts the same turns). Nothing a member typed is
// written to the function logs.
//
// The mailbox is untouched: its email gates, its budgets and its 540 s
// scheduled function stay as they are; a chat turn has its own budget
// (aidan-chat-core.js): Hosting ends a call at 60 s, so the work stops at
// CHAT_WORK_MS (Aidan is given that deadline and starts nothing he cannot
// finish by it) and the endpoint answers "took too long" at CHAT_TURN_MAX_MS,
// telling the turn to stop (no gap is filed after that). A member has at most
// CHAT_IN_FLIGHT_MAX turns running at once, and a turn may file a self-check
// gap only when the member is not a viewer and filed none in the last hour.
const cc = require("./aidan-chat-core");

const CHATS = "aidanChats";
const RUNS = "aidanChatRuns";
const LIMITS = "aidanChatLimits";
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// deps: { db() (Firestore), logger, now() (Date), requireConsoleUser(req), rateLimited(req, bucket, max),
//   tooMany(res), aidan() (a createAidan instance: .chat), readerFor(session) (a console reader),
//   origin (the console's public origin), turnMaxMs? (tests) }
function createAidanChat(deps) {
  const { logger = console, now = () => new Date() } = deps;
  const db = () => deps.db();
  const turnMaxMs = deps.turnMaxMs || cc.CHAT_TURN_MAX_MS;
  const workMs = deps.workMs || cc.CHAT_WORK_MS;
  const iso = (v) => (v && typeof v.toDate === "function" ? v.toDate().toISOString() : v instanceof Date ? v.toISOString() : typeof v === "string" ? v : null);
  const msOf = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : v instanceof Date ? v.getTime() : Number(new Date(v)) || 0);
  const messageOut = (m) => Object.assign({ role: m.role, text: String(m.text || ""), at: iso(m.at) }, m.readOnly ? { readOnly: true } : {}, Array.isArray(m.links) && m.links.length ? { links: m.links } : {}, m.outcome ? { outcome: m.outcome } : {});

  // The rate limit and the turns running at once, counted in Firestore so
  // every instance agrees. A turn refused for either takes no slot. Returns
  // the rate step plus { busy, turnId, mayFile }.
  async function allowTurn(email, role) {
    const ref = db().collection(LIMITS).doc(email);
    return db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const cur = snap.exists ? snap.data() || {} : {};
      const nowMs = now().getTime();
      const flight = cc.inFlightStep(cur.inFlight, nowMs);
      if (!flight.allowed) return { allowed: false, busy: true, retryAfterS: 10 };
      const step = cc.rateStep(cur, nowMs);
      if (!step.allowed) { tx.set(ref, { windowStart: step.windowStart, count: step.count }, { merge: true }); return step; }
      const turnId = `${nowMs.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      // Only one running turn may file: a second one started meanwhile can't,
      // so "one filing an hour" holds with two turns in flight.
      const mayFile = cc.mayFile(role, cur, nowMs) && !flight.live.some((t) => t.mayFile === true);
      tx.set(ref, { windowStart: step.windowStart, count: step.count, inFlight: [...flight.live, { id: turnId, at: nowMs, mayFile }] }, { merge: true });
      return Object.assign({}, step, { turnId, mayFile });
    });
  }
  // The turn has ended (answered, failed or given up on): free its slot, and
  // note a filing so the next one waits an hour. Never fails the turn.
  async function endTurn(email, turnId, filed) {
    const ref = db().collection(LIMITS).doc(email);
    try {
      await db().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const cur = snap.exists ? snap.data() || {} : {};
        const inFlight = (Array.isArray(cur.inFlight) ? cur.inFlight : []).filter((t) => t && t.id !== turnId);
        tx.set(ref, Object.assign({ inFlight }, filed ? { lastFiledAtMs: now().getTime() } : {}), { merge: true });
      });
    } catch (err) { logger.warn("aidan chat: the turn's slot wasn't freed", { error: String(err && err.message ? err.message : err).slice(0, 200) }); }
  }

  async function ownConversation(id, email) {
    if (!id || !ID_RE.test(String(id))) return null;
    const snap = await db().collection(CHATS).doc(String(id)).get();
    if (!snap.exists) return null;
    const d = snap.data() || {};
    return d.email === email ? Object.assign({ id: snap.id }, d) : null;
  }

  // Keep the newest CHAT_KEEP conversations of this member; delete the rest.
  async function prune(email) {
    const snap = await db().collection(CHATS).where("email", "==", email).limit(cc.CHAT_KEEP + 30).get();
    const rows = [];
    snap.forEach((d) => rows.push({ id: d.id, updatedAtMs: Number((d.data() || {}).updatedAtMs) || 0 }));
    for (const id of cc.overKeep(rows)) await db().collection(CHATS).doc(id).delete();
  }

  // One turn with a ceiling: Aidan is given a deadline (workMs) and stops
  // starting work after it; a turn still going at turnMaxMs ends with the
  // "took too long" reply, and is told to stop, so it files nothing later.
  // The clock starts when the request arrived (`receivedMs`), not when the
  // turn starts, so sign-in, the limits and loading the conversation count
  // against the same 60 s Hosting allows.
  async function runTurn(args, receivedMs) {
    let timer = null;
    let gaveUp = false;
    const startedMs = Number.isFinite(receivedMs) ? receivedMs : now().getTime();
    const waitMs = Math.max(0, startedMs + turnMaxMs - now().getTime());
    const ceiling = new Promise((resolve) => { timer = setTimeout(() => { gaveUp = true; resolve({ outcome: "timeout", reply: cc.TOO_LONG_REPLY, readOnly: false, reads: 0, tools: [], codeMode: null, improvement: null, durationMs: turnMaxMs }); }, waitMs); });
    try {
      return await Promise.race([deps.aidan().chat(Object.assign({}, args, { deadline: startedMs + Math.min(workMs, turnMaxMs - 2000), stopped: () => gaveUp })), ceiling]);
    } catch (err) {
      logger.error("aidan chat: the turn failed", { error: String(err && err.message ? err.message : err).slice(0, 300) });
      return { outcome: "error", reply: cc.ERROR_REPLY, readOnly: false, reads: 0, tools: [], codeMode: null, durationMs: 0 };
    } finally { clearTimeout(timer); }
  }

  async function post(req, res, who, receivedMs) {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const text = cc.cleanText(body.text);
    if (!text) { res.status(400).json({ error: "Type or say something for Aidan first." }); return; }
    const input = body.input === "voice" ? "voice" : "text";
    const email = who.user.email;
    const step = await allowTurn(email, who.user.role);
    if (step.busy) {
      res.status(429).set("Retry-After", String(step.retryAfterS)).json({ error: `Aidan is still answering your other question${cc.CHAT_IN_FLIGHT_MAX > 1 ? "s" : ""}. Try again in a minute, when ${cc.CHAT_IN_FLIGHT_MAX > 1 ? "one has" : "it has"} finished.` });
      return;
    }
    if (!step.allowed) {
      res.status(429).set("Retry-After", String(step.retryAfterS)).json({ error: `You've asked Aidan ${cc.CHAT_RATE_MAX} times in ten minutes. Try again in ${Math.ceil(step.retryAfterS / 60)} minute${step.retryAfterS > 60 ? "s" : ""}.` });
      return;
    }
    // The slot (and a filing's hour) is written BEFORE the reply is sent:
    // nothing is left to run after the response, where Cloud Run may not.
    let filed = false;
    let out;
    try {
      out = await turnFor(who, { body, text, input, email, step, receivedMs, setFiled: (v) => { filed = v; } });
    } catch (err) {
      await endTurn(email, step.turnId, filed);
      throw err;
    }
    await endTurn(email, step.turnId, filed);
    res.status(out.status).json(out.body);
  }

  // One turn, from the conversation to its audit. Returns { status, body }
  // for post() to send once the turn's slot is freed.
  async function turnFor(who, { body, text, input, email, step, receivedMs, setFiled }) {
    let convo = null;
    if (body.conversationId) {
      convo = await ownConversation(body.conversationId, email);
      if (!convo) return { status: 404, body: { error: "That conversation isn't there any more. Start a new one." } };
    }
    const history = convo && Array.isArray(convo.messages) ? convo.messages : [];
    const session = cc.chatSession(who.user);
    const startedAt = now();
    const turn = await runTurn({
      instruction: text, reader: deps.readerFor(session), history, origin: deps.origin || "",
      member: { email, role: who.user.role, name: who.user.displayName || "" },
      mayFile: step.mayFile === true,
    }, receivedMs);
    setFiled(Boolean(turn.improvement && (turn.improvement.action === "filed" || turn.improvement.action === "commented")));
    const links = cc.linksOf(turn.reply);
    const memberMsg = { role: "member", text, at: startedAt, input };
    const aidanMsg = Object.assign({ role: "aidan", text: String(turn.reply || ""), at: now(), outcome: turn.outcome }, turn.readOnly ? { readOnly: true } : {}, links.length ? { links } : {});
    // Append in a transaction, so two turns on one conversation both land.
    const ref = convo ? db().collection(CHATS).doc(convo.id) : db().collection(CHATS).doc();
    const at = now();
    const saved = await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const cur = snap.exists ? snap.data() || {} : null;
      if (cur && cur.email !== email) throw new Error("not the caller's conversation");
      const messages = cc.keepMessages([...((cur && cur.messages) || []), memberMsg, aidanMsg]);
      const doc = { email, title: (cur && cur.title) || cc.titleOf(text), messages, turns: ((cur && cur.turns) || 0) + 1, updatedAt: at, updatedAtMs: at.getTime() };
      if (!cur) doc.createdAt = at;
      tx.set(ref, doc, { merge: true });
      return doc;
    });
    try { await prune(email); } catch (err) { logger.warn("aidan chat: old conversations weren't pruned", { error: String(err && err.message ? err.message : err).slice(0, 200) }); }
    // The audit: who, when, what was read, how long, how it ended. Never the text.
    const cm = turn.codeMode || null;
    const audit = {
      at, atMs: at.getTime(), email, role: who.user.role, via: cc.CHAT_VIA, conversationId: ref.id, input,
      outcome: String(turn.outcome || "error"), readOnly: Boolean(turn.readOnly), durationMs: Number(turn.durationMs) || (now().getTime() - startedAt.getTime()),
      reads: Number(turn.reads) || 0, tools: Array.isArray(turn.tools) ? turn.tools.slice(0, 30) : [], links: links.length,
      codeMode: cm ? Object.assign({ ran: Boolean(cm.ran), ok: Boolean(cm.ok), kind: cm.kind || null, toolCalls: Number(cm.toolCalls) || 0 }, cm.name ? { insight: cm.name } : {}) : null,
      voice: turn.voice ? { quirk: Boolean(turn.voice.quirk) } : null,
      improvement: turn.improvement ? { action: turn.improvement.action || null, itemId: turn.improvement.itemId || null, category: turn.improvement.category || null } : null,
    };
    try { await db().collection(RUNS).add(audit); } catch (err) { logger.warn("aidan chat: the turn's audit row wasn't written", { error: String(err && err.message ? err.message : err).slice(0, 200) }); }
    logger.info("aidan chat turn", { role: who.user.role, outcome: audit.outcome, durationMs: audit.durationMs, reads: audit.reads, input });
    return { status: 200, body: { conversationId: ref.id, title: saved.title, message: messageOut(aidanMsg), durationMs: audit.durationMs, targetMs: cc.CHAT_TARGET_MS } };
  }

  async function get(req, res, who) {
    const email = who.user.email;
    const id = String((req.query && req.query.id) || "");
    if (id) {
      const convo = await ownConversation(id, email);
      if (!convo) { res.status(404).json({ error: "not found" }); return; }
      res.status(200).json({ conversation: { id: convo.id, title: convo.title || "", updatedAt: iso(convo.updatedAt), messages: (convo.messages || []).map(messageOut) } });
      return;
    }
    const snap = await db().collection(CHATS).where("email", "==", email).limit(cc.CHAT_KEEP + 30).get();
    const rows = [];
    snap.forEach((d) => { const x = d.data() || {}; rows.push({ id: d.id, title: x.title || "", updatedAt: iso(x.updatedAt), updatedAtMs: Number(x.updatedAtMs) || msOf(x.updatedAt), turns: Number(x.turns) || 0 }); });
    rows.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
    res.status(200).json({ conversations: rows.slice(0, cc.CHAT_KEEP).map(({ updatedAtMs, ...r }) => r) });
  }

  async function handle(req, res) {
    const receivedMs = now().getTime();
    if (req.method !== "GET" && req.method !== "POST") { res.status(405).json({ error: "method not allowed" }); return; }
    // A coarse per-address ceiling in front of the per-member limit.
    if (deps.rateLimited(req, "aidan-chat", 300)) return deps.tooMany(res);
    const who = await deps.requireConsoleUser(req);
    if (!who.ok) { res.status(who.status).json({ error: who.error }); return; }
    if (req.method === "GET") return get(req, res, who);
    return post(req, res, who, receivedMs);
  }

  return { handle, allowTurn, prune };
}

module.exports = { createAidanChat, CHATS, RUNS, LIMITS };
