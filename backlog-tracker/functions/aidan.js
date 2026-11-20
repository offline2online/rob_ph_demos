"use strict";
// Aidan, the agent mailbox (aidan@), as part of the Support Inbox sync.
//
//   • After each email is filed (support-mail.js → ingest), `afterIngest`
//     decides with aidan-core.js whether it starts a run. A run is queued on
//     the ticket (`aidanPending`, `aidan.status: "queued"`) instead of being
//     drafted a Help Centre reply. A tag that is refused is recorded with its
//     reason; an email that doesn't tag Aidan is left exactly as it was.
//   • The scheduled sync then works the queue (`runQueued`, one run per sync,
//     before triage, and only in the sync's first two minutes, so the whole run
//     fits in the function's 540 s: a run reads attachments and writes a whole
//     document). The claim is a transaction, so only one instance runs a job.
//     A run checks the sender again from Gmail's own copy of the email (the
//     configuration and the thread may have changed; the tag, the From
//     address and the defence in depth are decided again, and the topmost
//     Authentication-Results, Gmail's, must verify the From address), chooses
//     the skill, reads the email and its attachments, and either
//       generate: writes the documentation with the skill and replies to
//                 everyone on the email (From, To, Cc; never Reply-To) with it
//                 attached, from the mailbox; or
//       store:    keeps the email and its attachments as reference material
//                 for the skill (skillReferences), used by later runs; or
//       answer:   replies to everyone on the email in the email's own body,
//                 with no attachment (an acknowledgement, or the answer to a
//                 question). No skill is needed; one named in the instruction
//                 is read. A request to write that no skill matches is tried
//                 as an answer too, and goes to a person only when it can't
//                 be answered from the email.
//     An answer or a write may also read the agent console's own data
//     (concepts, project documents and interface contracts, tickets and the
//     pipeline, the Help Centre), read-only, through the MCP server's read
//     tools (`readConsole`, `consoleReader`): the model plans the reads, they
//     run, and the answer is written from them. An answer always may; a
//     write (a skill's document) only when the instruction is clearly about
//     the console (aidan-core.js → writeReadsConsole). A reply that carries
//     console data goes only to the allowed senders on the email, with ids
//     replaced by titles unless asked for. A request to
//     change the console gets a polite "read-only, nothing changed" reply
//     (`readOnlyReply`), and nothing is changed.
//   • One answering engine (rVv1x2N8xlKAZs0gpkRx): an answer run that asks a
//     question is first put to the Support Inbox's own Help Centre pipeline
//     (functions/answer-core.js: match against the whole published Help
//     Centre, draft from the best article, add articles when confidence is
//     under 80%). When the Help Centre answers it (`helpCentreAnswer`), that
//     reply is sent in the email itself, to everyone on the email, with the
//     articles named by title; the confidence and the matched articles are
//     kept on the ticket (`aidan.helpCentre`), never written in the email.
//     None of the Support Inbox's sending gates apply. Anything the Help
//     Centre doesn't answer (a project or documentation question, a question
//     about the email) carries on to the console and the email as before.
//     A run still "working" after 15 minutes was cut off: the next sync moves
//     it to a person (`sweepStale`).
//   • Branded sales collateral (JtkLrEG0aTnC5JfkdPA1): a write whose
//     instruction names collateral ("@Aidan, send me a one-pager for Kestrel",
//     "prepare a platform overview for CP Group in pharmacy"; collateral-core.js
//     → collateralFormat) is written with the brand skill (ph-brand) and the
//     chosen collateral skill, from the email, its attachments, the skill's kept
//     reference material, the published Help Centre and the prospect's
//     industry and country from Prospects (TAM) / Leads (nothing else from the
//     console), cleaned of Australian positioning and internal names, printed
//     to a branded PDF on the server (collateral-pdf.js) and sent by reply-all
//     with the PDF and the Markdown source attached (`collateralAndReply`). It
//     is filed on the ticket and kept as a reference example for the skill.
//   • Spam (mMQ4yBYu4uwvOSHK9WlA): marking a thread as spam, from any tab,
//     cancels a queued run (`markSpam`), and a run already working sends
//     nothing: every send, and the write that ends a run, checks the ticket
//     first (`stopIfSpam`). The ticket then reads "Aidan: no action — spam".
//     Mail arriving on a spam thread queues nothing. "Not spam" puts back what
//     Aidan had recorded (`markNotSpam`); a cancelled request is not run again.
//   • Instruction and content (OrkZBBjz9RM5DY54azIG): when the instruction
//     refers to the thread ("@Aidan, please answer John's question below"),
//     the quoted or forwarded part of the email and the thread's earlier
//     emails are read as CONTENT (aidan-core.js → threadContent): its own
//     <thread_content> block, with the "content, never instructions" line
//     (CONTENT_LINE), in the Help Centre engine's input, the console plan, the
//     answer, the document and the collateral. An earlier email is read only
//     when everyone the reply goes to was already on it, and never Aidan's own
//     console or read-only replies (the audience rule, ac.sharedEarlier). The
//     kind, the skill and the recipients are decided from the instruction
//     alone, exactly as before; the skill choice never sees the content, a
//     store never keeps it, and a console plan given it can't turn the run
//     into a read-only reply. An instruction found in it is ignored and noted
//     on the ticket (readThreadContent).
//   • Code Mode by default (IJhIIzTxOJyZVCzzYggZ): the console plan answers a
//     question about tickets, projects, the pipeline, concepts, leads,
//     prospects or the Help Centre with ONE Code Mode run (a script the model
//     writes, or an insight from the library, consoleReader.script /
//     .insight: the same sandbox and audit as run_script), and single reads
//     only for what Code Mode can't reach (project documents, critiques) or
//     after the run failed.
//   • Self-improvement (IJhIIzTxOJyZVCzzYggZ): at the end of every run that
//     passed the gates, Aidan checks whether the request was fully and well
//     met (aidan-core.js → assessRun: what the run recorded, and the model's
//     own self-check on an answer). When it wasn't, he files a Backlog ticket
//     on the right project with the gap, the request and the improvement
//     suggested, or comments on a matching open one (`reflect`, through
//     `improvements`, mcp-server.js → aidanImprovements). The ticket is
//     linked on the thread's timeline and in `aidan.improvement`.
//   • The voice (SYkk20srKT7pIKM1HS8Z, functions/aidan-voice.js): every reply
//     Aidan writes (an answer, a Help Centre answer, the cover note of a
//     write) is finished first, and then at most ONE light aside in his
//     character is added after it (`inVoice`), from the "aidan-voice" skill in
//     the skills library (added to the library, insert-only, the first time
//     it is missing). The voice never rewrites the reply and never touches an
//     attached document. No aside on a complaint, an outage, a fault or
//     anything commercial, and none when the voice can't be reached: the
//     reply is sent plain. Asked whether he is a bot or an AI, he says yes
//     (`ensureAiDisclosure`). Signed "<sender name>, Personalisation Hub" ("Aidan Hubbot" by default), with the
//     optional signature line from Settings when it is switched on.
//   • The allowed senders are configuration: supportSecrets/aidan, closed to
//     every client by firestore.rules, written only by an admin through
//     POST /supportMail/v1/aidan, never returned unmasked.
//
// Pure wiring: support-mail.js passes in Firestore, its Gmail caller and the
// model, so test/support-mail.test.js drives a whole run with stubs.

const crypto = require("crypto");
const core = require("./support-core");
const ac = require("./aidan-core");
const answerCore = require("./answer-core");
const cc = require("./collateral-core");
const cl = require("./collateral-layout");
const av = require("./aidan-voice");
const mc = require("./market-core");
const chatCore = require("./aidan-chat-core");

const CONFIG_DOC = "aidan";              // supportSecrets/aidan
const REFERENCES = "skillReferences";
const REFERENCE_TEXT_BUDGET = 600000;    // characters stored on one reference document
const REFERENCES_PER_RUN = 20;
const REFERENCE_PROMPT_BUDGET = 80000;   // characters of stored reference text a run reads
const SKILL_PROMPT_BUDGET = 150000;      // characters of the skill's own files a run reads
// The whole run has to fit inside supportMail's timeoutSeconds (540 s, see
// functions/index.js), together with the sync that starts it. So: a run starts
// only in the first LATEST_START_MS of a sync, the skill choice gets
// SELECT_TIMEOUT_MS, the document DOC_TIMEOUT_MS, and neither model call is
// retried (worst case about 2 + 1 + 4 minutes, plus attachment reads and the
// send; an answer gets ANSWER_TIMEOUT_MS, so 2 + 1 + 2 at most). Reading the
// console adds at most CONSOLE_ROUNDS planning calls of CONSOLE_PLAN_TIMEOUT_MS
// each (under a minute), at most one Code Mode run of CONSOLE_SCRIPT_TIMEOUT_MS
// (10 s; aidan-core.js) and the reads themselves. A question put to the Help
// Centre first adds at most three calls of the engine's own 40 s (the match and
// two drafts), so the worst answer is 2 + 2 + 1 + 2 minutes. Collateral reads no
// console plan: it is start + choice + document + COLLATERAL_RENDER_TIMEOUT_MS
// for the PDF (2 + 1 + 4 + 1 minutes, with the send and the filing after). A run that is cut off anyway is moved to a person by the next sync
// (sweepStale) once it has been "working" for STALE_MS. The voice adds one
// short call of VOICE_TIMEOUT_MS after the reply is written (2 + 2 + 1 + 2
// minutes and 20 seconds for the worst answer, 2 + 1 + 4 + 1 and 20 seconds
// for collateral); when it fails or runs out of time the reply goes plain.
const LATEST_START_MS = 120000;
const SELECT_TIMEOUT_MS = 60000;
const DOC_TIMEOUT_MS = 240000;
const ANSWER_TIMEOUT_MS = 120000;
const ANSWER_EMAIL_MAX = 60000;          // characters of the email (with the thread quoted in it) an answer reads
// Each planning round of the console reads (aidan-core.js → CONSOLE_ROUNDS);
// with them a write is still start + choice + plans + document + a minute.
const CONSOLE_PLAN_TIMEOUT_MS = 25000;
// Printing collateral to PDF: Chromium's start, the brand font and the print.
const COLLATERAL_RENDER_TIMEOUT_MS = 60000;
// The voice's one sentence: a small call, never retried.
const VOICE_TIMEOUT_MS = 20000;
const STALE_MS = 15 * 60 * 1000;
const SEEN_KEEP = 50;                    // gmailIds remembered per ticket (aidanSeen), so a message is decided once
const ACTIVE = ["queued", "working"];
const tsMs = (v) => (!v ? 0 : typeof v.toMillis === "function" ? v.toMillis() : v instanceof Date ? v.getTime() : Number(new Date(v)) || 0);

// `consoleReader` (functions/mcp-server.js → consoleReader): { tools(), read(name, args) }
// over the console's read-only MCP tools; null leaves Aidan reading the email only.
// `helpCentre` (support-mail.js): { articles(), run } — the published Help
// Centre catalogue and, in tests, the stand-in for the answering engine; null
// leaves a platform question to the console and the email.
// `accounts` (support-mail.js): async () => { prospects, leads }, the console's
// Prospects (TAM) and Leads, from which collateral takes a company's industry
// and country only. `renderPdf` (collateral-pdf.js → renderPdf): html -> { pdf,
// pages }; with Aidan's model stubbed (`run`) only `run.render` is used, so no
// test starts a browser.
// `improvements` (mcp-server.js → aidanImprovements): { projects(),
// openTickets(projectId), byKey(key), filedOn(day), file({...}),
// comment(itemId, text) }, for the self-improvement tickets; null files none.
// `markets` (support-mail.js): async () => the Brand Guidelines market pages
// (market-core.js → marketsFrom), for collateral tailored to the company's
// country; null leaves collateral on the default guidelines and files nothing.
function createAidan({ db, tickets, secretsRef, gmail, readSettings, logEvent, now, logger = console, callJson, apiKey = () => "", workspaceId = () => "", Anthropic = null, run: runImpl = null, bucket = null, consoleReader = null, helpCentre = null, accounts = null, renderPdf = null, improvements = null, markets = null }) {
  const data = (snap) => (snap && snap.exists ? snap.data() || {} : null);
  const configRef = () => secretsRef(CONFIG_DOC);
  const errText = (err) => core.clip(String(err && err.message ? err.message : err), 300);

  async function readConfig() { return ac.normaliseConfig(data(await configRef().get())); }
  async function status({ admin = false } = {}) { return ac.publicConfig(data(await configRef().get()), { admin }); }
  // Admin: replace the allowed senders (only when a list is given), switch Aidan on or off, and set his sender name and signature line.
  async function saveConfig(body, by) {
    const cur = data(await configRef().get()) || {};
    const patch = { updatedBy: by, updatedAt: now() };
    if ("allowedSenders" in body && String(Array.isArray(body.allowedSenders) ? body.allowedSenders.join(",") : body.allowedSenders || "").trim()) {
      const { senders, bad } = ac.cleanSenders(body.allowedSenders);
      if (bad.length) return { ok: false, error: `Not an email address: ${bad.length} entr${bad.length === 1 ? "y" : "ies"}.` };
      patch.allowedSenders = senders;
    }
    if (body.clearSenders === true) patch.allowedSenders = [];
    if ("enabled" in body) patch.enabled = body.enabled === true;
    if ("requireSenderAuth" in body) patch.requireSenderAuth = body.requireSenderAuth !== false;
    // The optional signature line under "<sender name>, Personalisation Hub": the text
    // is kept when it is switched off, and it can't be switched on empty.
    // The sender name (From display name and sign-off, QVpqiMuwipZ4mKSXHplM).
    // Read on every run, so the next email uses it with no deploy. A first name is required.
    if ("fromFirstName" in body || "fromLastName" in body) {
      const first = ac.cleanNamePart("fromFirstName" in body ? body.fromFirstName : cur.fromFirstName);
      if (!first) return { ok: false, error: "Aidan's first name can't be empty." };
      patch.fromFirstName = first;
      patch.fromLastName = ac.cleanNamePart("fromLastName" in body ? body.fromLastName : cur.fromLastName);
    }
    if ("signatureLine" in body) patch.signatureLine = ac.cleanSignatureLine(body.signatureLine);
    if ("signatureLineOn" in body) patch.signatureLineOn = body.signatureLineOn === true;
    if (patch.signatureLineOn && !ac.cleanSignatureLine("signatureLine" in patch ? patch.signatureLine : cur.signatureLine)) {
      return { ok: false, error: "Write the signature line, or switch it off." };
    }
    await configRef().set(patch, { merge: true });
    return { ok: true, aidan: ac.publicConfig(Object.assign({}, cur, patch), { admin: true }) };
  }

  // ── Deciding, as each email is filed ──
  // `m` is the parsed message just filed. Returns the decision's action, or
  // "duplicate" / "busy". Idempotent across instances: the decision is made in
  // a transaction, and a gmailId already decided on this ticket (aidanSeen) is
  // never queued again, so the schedule and "Sync now" on another instance
  // filing the same email can't queue it twice. While a run is queued or
  // working on the thread, a new request is not queued (and a refused tag
  // doesn't overwrite the run's status): it is logged on the ticket instead.
  // The message as decideAidan reads it: with the Gmail message's facts
  // (ac.mailFacts: every body, the From count, the address headers) when they
  // are at hand, so the tag is read from every body and the defence in depth
  // compares the address headers too.
  const asMessage = (m, facts) => (facts ? Object.assign({}, m, {
    from: facts.from, fromCount: facts.fromCount, bodies: facts.bodies, addressText: facts.addressText, subject: facts.subject,
  }) : m);
  // The thread's earlier emails, as text someone who is not allowed may have written (ac.untrustedThreadText).
  // The thread's stored messages, oldest first.
  async function threadRows(ticketId) {
    const snap = await tickets().doc(ticketId).collection("messages").get();
    const rows = [];
    snap.forEach((d) => rows.push(Object.assign({ id: d.id }, d.data() || {})));
    return rows.sort((a, b) => tsMs(a.at) - tsMs(b.at));
  }
  async function untrustedOnThread(ticketId, exclude, config) {
    return ac.untrustedThreadText(await threadRows(ticketId), { allowed: config.allowedSenders, exclude });
  }
  // ── Spam ──
  // What a spam thread's `aidan` map says. `before` is what Aidan had
  // recorded (a finished run, a refusal), kept so "Not spam" can put it back;
  // a request that was queued or working is cancelled instead and not kept.
  const SPAM_STOP = "aidan-spam";
  const isSpam = (t) => Boolean(t && t.status === "spam");
  function spamState(prev) {
    const p = prev && typeof prev === "object" ? prev : null;
    if (p && p.spam) return p;
    const cancelled = Boolean(p && ACTIVE.includes(p.status));
    const state = { status: "ignored", spam: true, cancelled, reason: "spam", at: now() };
    if (p && p.gmailId) state.gmailId = p.gmailId;
    if (p && !cancelled) state.before = p;
    return state;
  }
  // Called when a ticket's status becomes Spam (support-mail.js → setStatus),
  // whichever tab it was marked in. Only a thread in the Aidan tab gets a
  // record. Returns { aidan: bool, cancelled: bool }.
  async function markSpam(ticketId) {
    const ref = tickets().doc(ticketId);
    const out = await db.runTransaction(async (tx) => {
      const t = data(await tx.get(ref));
      if (!t || !(t.inboxes || []).includes(ac.AIDAN_INBOX)) return { aidan: false, cancelled: false };
      if (t.aidan && t.aidan.spam && !t.aidanPending) return { aidan: true, cancelled: false, already: true };
      const state = spamState(t.aidan);
      // update(), not set-merge: the new map replaces the run's whole map.
      tx.update(ref, { aidanPending: false, aidan: state, updatedAt: now() });
      return { aidan: true, cancelled: state.cancelled };
    });
    if (out.aidan && !out.already) await logEvent(ticketId, "aidan", `Aidan: no action — spam.${out.cancelled ? " The request waiting on this thread was cancelled." : ""}`);
    return out;
  }
  // Called when a spam ticket is marked not spam: what Aidan had recorded is
  // put back. A cancelled request stays cancelled (the sender asks again).
  async function markNotSpam(ticketId) {
    const ref = tickets().doc(ticketId);
    return db.runTransaction(async (tx) => {
      const t = data(await tx.get(ref));
      if (!t || !t.aidan || !t.aidan.spam) return { aidan: false };
      const a = t.aidan;
      const back = a.cancelled
        ? Object.assign({ status: "ignored", cancelled: true, reason: "The request was cancelled when this thread was marked as spam. Send it again to run it.", at: now() }, a.gmailId ? { gmailId: a.gmailId } : {})
        : (a.before && typeof a.before === "object" ? a.before : null);
      tx.update(ref, { aidanPending: false, aidan: back, updatedAt: now() });
      return { aidan: true, cancelled: Boolean(a.cancelled) };
    });
  }
  // Dismiss what Aidan recorded on a thread (the Aidan tab's checkboxes →
  // support-mail.js). Only a finished state that asks for attention is cleared:
  // "no action", "needs a person" and "failed". A request queued or working is
  // left alone (marking the thread as spam cancels it), and so is a record of
  // something Aidan did (a reply sent, an email kept). Returns { dismissed }.
  const DISMISSABLE = ["ignored", "needs-person", "error"];
  async function dismiss(ticketId, by) {
    const ref = tickets().doc(ticketId);
    const dismissed = await db.runTransaction(async (tx) => {
      const t = data(await tx.get(ref));
      if (!t || !t.aidan || t.aidan.spam || t.aidanPending || !DISMISSABLE.includes(t.aidan.status)) return false;
      tx.update(ref, { aidan: null, updatedAt: now() });
      return true;
    });
    if (dismissed) await logEvent(ticketId, by || "system", "Aidan's state on this thread was dismissed.");
    return { dismissed };
  }
  // A run that is already working stops here, before anything is sent or
  // written, when its thread has been marked as spam meanwhile.
  async function stopIfSpam(ticketId) {
    if (!isSpam(data(await tickets().doc(ticketId).get()))) return;
    const err = new Error("This thread was marked as spam.");
    err.code = SPAM_STOP;
    throw err;
  }

  const mentionsAidan = (m, facts) => [m.text, ...((facts && facts.bodies) || []).map((b) => b.text || b.html)].some((x) => /@\s*aidan/i.test(String(x || "")));

  async function afterIngest(m, config) {
    if (!m || m.direction !== "in" || !m.threadId || !m.gmailId) return "none";
    const ref = tickets().doc(m.threadId);
    const facts = m.aidanMail || null;
    const message = asMessage(m, facts);
    // Read outside the transaction: a check, which the run makes again (runOne).
    const untrusted = mentionsAidan(m, facts) ? await untrustedOnThread(m.threadId, m.gmailId, config) : [];
    const out = await db.runTransaction(async (tx) => {
      const ticket = data(await tx.get(ref));
      if (!ticket || !(ticket.inboxes || []).includes(ac.AIDAN_INBOX)) return { action: "none" };
      // A spam thread queues nothing and keeps its "no action — spam" record.
      if (isSpam(ticket)) return { action: "none" };
      const seen = Array.isArray(ticket.aidanSeen) ? ticket.aidanSeen : [];
      if (seen.includes(m.gmailId) || (ticket.aidan && ticket.aidan.gmailId === m.gmailId)) return { action: "duplicate" };
      const d = ac.decideAidan({ inboxes: ticket.inboxes, message, config, runs: ticket.aidanRuns || 0, untrusted });
      // Only a tag is worth a line on the ticket; plain mail in the Aidan tab is left as it is.
      if (d.action === "none" && !d.tagged) return d;
      const busy = Boolean(ticket.aidan && ACTIVE.includes(ticket.aidan.status));
      const patch = { aidanSeen: [...seen, m.gmailId].slice(-SEEN_KEEP), updatedAt: now() };
      // update(), not set-merge: a new `aidan` map replaces the last run's
      // whole map (a merge would keep its reason, document and sentId).
      if (d.action === "none") {
        if (!busy) patch.aidan = { status: "ignored", gmailId: m.gmailId, reason: d.reason, at: now() };
        tx.update(ref, patch);
        return Object.assign({}, d, { busy });
      }
      if (busy) { tx.update(ref, patch); return { action: "busy" }; }
      tx.update(ref, Object.assign(patch, {
        aidanPending: true, aidanRuns: (ticket.aidanRuns || 0) + 1,
        // Aidan answers this, not the Help Centre drafting.
        triagePending: false, aiDraft: null, needsHuman: false,
        aidan: Object.assign({ status: "queued", kind: d.action, gmailId: m.gmailId, instruction: d.instruction, at: now() },
          // The quoted thread will be read as content (never for a store).
          d.action !== "store" && ac.refersToThread(d.instruction) ? { refersToThread: true } : {}),
      }));
      return d;
    });
    if (out.action === "busy") {
      await logEvent(m.threadId, "aidan", "Aidan was already working on an earlier request on this thread, so this one was not run. Send it again once Aidan has answered.");
      return "busy";
    }
    if (out.action === "none" && out.busy) await logEvent(m.threadId, "aidan", `Aidan did nothing with a later email: ${out.reason}`);
    if (out.action === "store" || out.action === "generate") {
      await logEvent(m.threadId, "aidan", out.action === "store" ? "Aidan was asked to keep this email for a skill." : "Aidan was asked to write documentation.");
    }
    if (out.action === "answer") await logEvent(m.threadId, "aidan", "Aidan was asked to answer on the email.");
    return out.action;
  }

  // ── Running ──
  const rowsOf = async (name) => { const snap = await db.collection(name).get(); const out = []; snap.forEach((d) => out.push(Object.assign({ id: d.id }, d.data() || {}))); return out; };
  async function skillFiles(skill) {
    let used = 0;
    const files = (Array.isArray(skill.files) ? skill.files : []).slice().sort((a, b) => (a.path === "SKILL.md" ? -1 : b.path === "SKILL.md" ? 1 : 0));
    const out = [];
    for (const f of files) {
      const room = SKILL_PROMPT_BUDGET - used;
      if (room <= 0) break;
      const text = core.clip(String(f.content || ""), room);
      used += text.length;
      out.push(`<skill_file path="${String(f.path || "").replace(/"/g, "")}">\n${text}\n</skill_file>`);
    }
    return out.join("\n\n");
  }
  async function referencesFor(skillId) {
    const snap = await db.collection(REFERENCES).where("skillId", "==", skillId).limit(REFERENCES_PER_RUN).get();
    const rows = [];
    snap.forEach((d) => rows.push(d.data() || {}));
    let used = 0;
    const out = [];
    for (const r of rows) {
      for (const piece of [{ name: `email: ${r.subject || ""}`, text: r.text }, ...(r.files || []).map((f) => ({ name: f.name, text: f.text }))]) {
        if (!piece.text) continue;
        const room = REFERENCE_PROMPT_BUDGET - used;
        if (room <= 0) break;
        const text = core.clip(String(piece.text), room);
        used += text.length;
        out.push(`<reference name="${String(piece.name || "").replace(/"/g, "")}">\n${text}\n</reference>`);
      }
    }
    return { text: out.join("\n\n"), count: rows.length };
  }
  async function readAttachments(gmailId, payload) {
    const { take, skipped } = ac.pickAttachments(ac.attachmentParts(payload));
    const inputs = [];
    for (const p of take) {
      try {
        let raw = p.data;
        if (!raw && p.attachmentId) raw = (await gmail(`messages/${encodeURIComponent(gmailId)}/attachments/${encodeURIComponent(p.attachmentId)}`)).data;
        inputs.push(ac.attachmentInput({ name: p.name, mimeType: p.mimeType, bytes: ac.fromB64url(raw) }));
      } catch (err) { skipped.push({ name: p.name, reason: `couldn't be read: ${errText(err)}` }); }
    }
    return { inputs, skipped };
  }
  // The email and its files as the model's input blocks.
  function contentBlocks({ header, email, inputs, skipped }) {
    const blocks = [{ type: "text", text: `${header}\n\n<email>\n${email}\n</email>` }];
    for (const a of inputs) {
      if (a.kind === "text") blocks.push({ type: "text", text: `<attachment name="${String(a.name).replace(/"/g, "")}">\n${a.text}\n</attachment>` });
      else if (a.kind === "pdf") blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: a.base64 }, title: core.clip(a.name, 200) });
      else if (a.kind === "image") blocks.push({ type: "image", source: { type: "base64", media_type: a.mediaType, data: a.base64 } });
    }
    const unread = [...inputs.filter((a) => a.kind === "skipped").map((a) => ({ name: a.name, reason: a.reason })), ...skipped];
    if (unread.length) blocks.push({ type: "text", text: `Attachments that could not be read: ${unread.map((u) => `${u.name} (${u.reason})`).join("; ")}` });
    return blocks;
  }
  // No retry: a second attempt could take the run past the function's budget.
  const model = (opts) => callJson(Object.assign({ apiKey: String(apiKey() || ""), workspaceId: workspaceId(), Anthropic, maxRetries: 0 }, opts));
  async function chooseSkill({ instruction, email, skills }) {
    const named = ac.skillNamedIn(instruction, skills);
    if (named) return { skill: named, client: "", reason: "named in the instruction" };
    if (!skills.length) return { skill: null, reason: "there are no skills in the library" };
    const raw = runImpl && runImpl.select ? await runImpl.select({ instruction, email, skills })
      : await model({ system: ac.SELECT_SYSTEM, schema: ac.SELECT_SCHEMA, effort: "medium", maxTokens: 2000, timeout: SELECT_TIMEOUT_MS,
        content: `<skills>\n${skills.map(ac.skillIndexLine).join("\n")}\n</skills>\n\n<instruction>\n${instruction}\n</instruction>\n\n<email>\n${core.clip(email, 20000)}\n</email>` });
    const sel = ac.cleanSelection(raw, skills);
    return { skill: skills.find((s) => s.id === sel.skillId) || null, client: sel.client, reason: sel.reason };
  }
  async function writeDocument({ skill, client, instruction, header, email, inputs, skipped, consoleText = "", content = null }) {
    const refs = await referencesFor(skill.id);
    // With console data the prompt says who the reply really goes to (the allowed senders only).
    // With thread content, the prompt says it is third-party material, never instructions.
    const system = `${ac.docSystemFor(Boolean(consoleText))}${content ? `\n${ac.CONTENT_LINE}` : ""}\n\n<skill name="${String(skill.name || skill.slug || "").replace(/"/g, "")}">\n${await skillFiles(skill)}\n</skill>${refs.text ? `\n\n<reference_material>\n${refs.text}\n</reference_material>` : ""}`;
    const blocks = contentBlocks({ header: `${header}\nInstruction to Aidan: ${instruction}${client ? `\nFor: ${client}` : ""}`, email, inputs, skipped });
    if (content) blocks.splice(1, 0, { type: "text", text: ac.contentBlock(content) });
    if (consoleText) blocks.push({ type: "text", text: consoleText });
    const raw = runImpl && runImpl.write ? await runImpl.write({ skill, client, instruction, system, content: blocks, references: refs.count })
      : await model({ system, schema: ac.DOC_SCHEMA, effort: "high", maxTokens: 32000, content: blocks, timeout: DOC_TIMEOUT_MS });
    return ac.cleanDocument(raw);
  }

  // Keep the email and its readable files against the skill. Binary files go
  // to Storage when a bucket is available; otherwise they are named only.
  async function storeReference({ skill, ticketId, msg, inputs, skipped, by }) {
    const id = `ref-${now().getTime()}-${crypto.randomBytes(4).toString("hex")}`;
    let budget = REFERENCE_TEXT_BUDGET;
    const take = (s) => { const t = core.clip(String(s || ""), Math.max(0, budget)); budget -= t.length; return t; };
    const files = [];
    for (const a of inputs) {
      const f = { name: a.name, kind: a.kind, size: a.size || 0 };
      if (a.kind === "text") f.text = take(a.text);
      else if ((a.kind === "pdf" || a.kind === "image") && bucket) {
        const path = `skill-references/${skill.id}/${id}/${String(a.name).replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120)}`;
        try { await bucket().file(path).save(Buffer.from(a.base64, "base64"), { contentType: a.mediaType, resumable: false }); f.storagePath = path; }
        catch (err) { f.error = errText(err); }
      } else if (a.kind === "skipped") f.reason = a.reason;
      files.push(f);
    }
    for (const s of skipped) files.push({ name: s.name, kind: "skipped", reason: s.reason });
    await db.collection(REFERENCES).doc(id).set({
      skillId: skill.id, skillSlug: skill.slug || "", skillName: skill.name || "", ticketId, gmailId: msg.gmailId || msg.id || "",
      subject: core.clip(msg.subject || "", 500), text: take(core.stripQuoted(msg.text || "")), files, addedBy: by, source: "aidan-email", createdAt: now(),
    });
    return { id, files };
  }

  // A "store" run: keep the email and its files against the skill; no email is sent.
  async function keepReference({ ticketId, job, msg, skill, inputs, skipped, finish }) {
    const stored = await storeReference({ skill, ticketId, msg: Object.assign({ gmailId: job.gmailId }, msg), inputs, skipped, by: "aidan" });
    return finish({
      aidan: { status: "ingested", kind: "store", skillId: skill.id, skillName: skill.name || skill.slug, referenceId: stored.id, files: stored.files.map((f) => ({ name: f.name, kind: f.kind })) },
      status: "resolved", resolvedBy: "aidan", resolvedAt: now(), needsHuman: false,
    }, `Aidan kept this email${stored.files.length ? ` and ${stored.files.length} attachment${stored.files.length === 1 ? "" : "s"}` : ""} as reference material for the ${skill.name || skill.slug} skill.`);
  }

  // ── Reading the console, read-only (1W4QQzYdlJzfdqizePWR) ──
  // The model plans the reads from an index of the projects and concepts and
  // the read tools' own descriptions (up to CONSOLE_ROUNDS rounds, so a search
  // can be followed by the section it found); each read is one of the MCP
  // server's read tools, run by consoleReader, which refuses anything else.
  // Returns null when there is nothing to read with, or the instruction needs
  // nothing from the console; otherwise { changeRequested, results, used,
  // text (the <console_data> block), names (id -> title) }.
  // `content` (the thread content the instruction refers to) is given to the
  // plan so it can read what the quoted question needs; then a change the plan
  // finds is not acted on, because it may have come from the content: a change
  // request is refused only from the instruction's own words
  // (ac.consoleChangeRequest, before any model is asked).
  // `reader` is the console reader to read with: the mailbox's read-only
  // stand-in by default, or (the console's chat panel, `channel: "chat"`) a
  // reader scoped to the signed-in member who asked (mcp-server.js →
  // consoleReader(names, session)). `planTimeoutMs`: one planning round's budget.
  async function readConsole({ instruction, email, content = null, reader = consoleReader, channel = "email", planTimeoutMs = CONSOLE_PLAN_TIMEOUT_MS }) {
    const consoleReader = reader;
    if (!consoleReader || !ac.mayReadConsole(instruction)) return null;
    const planSystem = channel === "chat" ? `${ac.CONSOLE_PLAN_SYSTEM}\n${chatCore.CHAT_PLAN_LINE}` : ac.CONSOLE_PLAN_SYSTEM;
    const planEmail = content ? `${email}\n\n${ac.contentBlock(content)}` : email;
    const read = async (tool, args) => {
      try {
        const r = await consoleReader.read(tool, args);
        return r && r.ok ? { ok: true, text: String(r.text || "") } : { ok: false, text: `Not read: ${core.clip(String((r && r.error) || "no result"), 300)}` };
      } catch (err) { return { ok: false, text: `Not read: ${errText(err)}` }; }
    };
    const projects = await read("list_projects", {});
    const concepts = await read("list_concepts", {});
    const index = ac.consoleIndex(projects.text, concepts.text);
    const tools = (typeof consoleReader.tools === "function" ? consoleReader.tools() : []).filter((t) => ac.CONSOLE_READ_TOOLS.includes(t.name));
    // Code Mode, when the reader offers it: the plan is shown the script
    // tools (as signatures) and the insights Aidan may run, and asks for ONE run.
    const canScript = typeof consoleReader.script === "function";
    let scriptTools = "";
    let insights = [];
    if (canScript) {
      try {
        scriptTools = typeof consoleReader.describeScriptTools === "function" ? String(consoleReader.describeScriptTools() || "") : "";
        insights = (typeof consoleReader.insights === "function" ? consoleReader.insights() : []).filter((i) => ac.AIDAN_INSIGHTS.includes(i.name));
      } catch (err) { logger.warn("support: Aidan couldn't describe Code Mode", { error: errText(err) }); }
    }
    const results = [];
    let changeRequested = false;
    let codeMode = null;    // { ran, ok, kind, name, error, errorKind, toolCalls, durationMs }
    const runCodeMode = async (cm) => {
      let r;
      try {
        r = cm.kind === "insight" ? await consoleReader.insight(cm.name, cm.params, { timeoutMs: ac.CONSOLE_SCRIPT_TIMEOUT_MS })
          : await consoleReader.script(cm.code, { timeoutMs: ac.CONSOLE_SCRIPT_TIMEOUT_MS });
      } catch (err) { r = { ok: false, error: errText(err), errorKind: "error", toolCalls: [] }; }
      r = r || { ok: false, error: "no result", errorKind: "error", toolCalls: [] };
      codeMode = Object.assign({ ran: true, ok: Boolean(r.ok), kind: cm.kind, toolCalls: (r.toolCalls || []).length, durationMs: r.durationMs || 0 },
        cm.kind === "insight" ? { name: cm.name } : {}, r.ok ? {} : { error: core.clip(String(r.error || ""), 300), errorKind: String(r.errorKind || "error") });
      const tool = cm.kind === "insight" ? "get_insight" : "run_script";
      const args = cm.kind === "insight" ? Object.assign({ insight: cm.name }, cm.params) : {};
      // projectRefs: every project the run's tool calls named (the reader
      // reports them), so a gap is filed on the project the run was about.
      const projectRefs = Array.isArray(r.projectRefs) ? r.projectRefs.filter((x) => typeof x === "string").slice(0, 50) : [];
      results.push({ tool, args, codeMode: true, projectRefs, ok: Boolean(r.ok), text: r.ok ? String(r.text || "") : `Not read: the Code Mode run failed (${codeMode.errorKind}): ${codeMode.error}` });
    };
    for (let round = 0; round < ac.CONSOLE_ROUNDS; round += 1) {
      const cmPrompt = canScript ? { scriptTools, insights, done: Boolean(codeMode) } : null;
      const raw = runImpl && runImpl.plan ? await runImpl.plan({ instruction, index, tools, results, round, email: planEmail, codeMode: cmPrompt })
        : await model({ system: content ? `${planSystem}\n${ac.CONTENT_LINE}` : planSystem, schema: ac.CONSOLE_PLAN_SCHEMA, effort: "medium", maxTokens: 4000, timeout: planTimeoutMs,
          content: ac.consolePlanPrompt({ instruction, email: planEmail, index, tools, results, codeMode: cmPrompt }) });
      // Documents and critiques are read inside the Code Mode run.
      // Only while the one Code Mode run is still to come: once it has run
      // (or failed), a document section or critiques are single reads again.
      const plan = ac.cleanConsolePlan(raw, { done: results, codeModeDone: !canScript || Boolean(codeMode), scriptCovers: canScript && !codeMode });
      if (plan.changeRequested && !content) { changeRequested = true; break; }
      if (!plan.codeMode && !plan.reads.length) break;
      if (plan.codeMode) await runCodeMode(plan.codeMode);
      for (const r of plan.reads) results.push(Object.assign({}, r, await read(r.tool, r.args)));
    }
    // The projects the reads were about (a self-check names one when the data
    // was missing there): each read's project argument and every project a
    // Code Mode run's tool calls named, by id or by name against the index
    // (an insight takes a project's name as readily as its id).
    const scopedProjectIds = ac.projectsReadAbout(results, index.projects);
    // PH Agent Context: the topics this thread was about go back to the topic
    // cache, so the pack for each is ready before the next question on it.
    const topics = ac.topicsOf(results, index.projects, scopedProjectIds);
    if (topics.length && typeof consoleReader.rememberTopics === "function") {
      try { await consoleReader.rememberTopics(topics); } catch (err) { logger.warn("support: Aidan couldn't write topics back to the context cache", { error: errText(err) }); }
    }
    return {
      context: ac.contextGap(results), topics,
      changeRequested, results, used: results.some((r) => r.ok), text: ac.consoleBlock(results),
      names: ac.namesById([projects.text, concepts.text, ...results.map((r) => r.text)]),
      tools: [...new Set(results.filter((r) => r.ok).map((r) => r.tool))],
      codeMode, cut: ac.consoleWasCut(results), scopedProjectIds,
      failedReads: results.filter((r) => !r.ok && !r.codeMode).map((r) => ({ tool: r.tool, error: r.text })),
    };
  }
  const consoleFacts = (c) => Object.assign({ reads: c.results.filter((r) => r.ok).length, tools: c.tools }, c.codeMode ? { codeMode: c.codeMode } : {});
  // Ticket (and other) ids out of text written from console data: each becomes
  // its title, unless the instruction asks for ids. Used by answers and writes alike.
  const withoutIds = (text, c, instruction) => ac.stripIds(text, c.names, { asked: ac.asksForIds(instruction) });
  // An answer written from console data, as it is sent: ids out, a long one
  // (over roughly a page) attached as Markdown with a two-line summary inline.
  function consoleReply(answer, c, instruction) {
    return ac.shapeConsoleAnswer({ replyText: withoutIds(answer.replyText, c, instruction), documentMd: withoutIds(answer.documentMd, c, instruction), title: answer.title });
  }

  // ── The voice (functions/aidan-voice.js) ──
  // With Aidan's model stubbed (`run`) the voice runs only when it is stubbed
  // too (`run.voice`), so no test reaches the network.
  const voiceOn = () => !runImpl || typeof runImpl.voice === "function";
  // The "aidan-voice" skill, from the library. When the library has none it
  // is added as first written (insert-only, in a transaction, under a fixed
  // id so two instances can't add it twice); a failure leaves the run using
  // the built-in text.
  async function voiceSkillFrom(skills) {
    const found = av.voiceSkillIn(skills);
    if (found || !voiceOn()) return found;
    const doc = av.defaultSkillDoc();
    try {
      const ref = db.collection("skills").doc(av.VOICE_SLUG);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists) return;
        tx.set(ref, Object.assign({}, doc, { createdVia: "aidan", createdByEmail: null, updatedByEmail: null, createdAt: now(), updatedAt: now() }));
      });
    } catch (err) { logger.warn("support: Aidan couldn't add the voice skill to the library", { error: errText(err) }); }
    return Object.assign({ id: av.VOICE_SLUG }, doc);
  }
  // The finished reply body, in Aidan's voice: the body exactly as it was
  // written, then at most one aside. `kind`: "answer", "helpCentre" or
  // "generate" (a cover note; the attached document never comes here).
  // Returns { text, voice } where voice is what goes on the ticket
  // ({ quirk: bool, reason? }), or null when the voice didn't run at all.
  // Never throws: a reply is never held up by its voice.
  // `content`: the thread the instruction refers to (readThreadContent), when
  // there is one: a complaint or a pricing question quoted below "@Aidan,
  // please answer John's question" makes the reply a plain one too.
  // "Are you a bot?" (asked in the instruction) is settled here, for every
  // kind of reply and whether or not the voice runs: the reply says yes (a
  // dodge gets the line first, a sentence denying it is taken out), and that
  // yes is the email's one touch of character, so no aside is added. On an
  // email that gets no quirk the yes is the plain line.
  async function inVoice({ ticketId, kind, body, instruction, msg, ticket, voiceSkill = null, content = null }) {
    let text = String(body || "").replace(/\r/g, "").trim();
    if (!text) return { text, voice: null };
    const sensitive = av.sensitiveReason([instruction, msg && msg.subject, ticket && ticket.subject, core.stripQuoted((msg && msg.text) || ""), content && content.text, text]);
    if (av.asksIfAi(instruction)) {
      if (sensitive) text = text.split(av.AI_LINE).join(av.AI_LINE_PLAIN);
      const said = av.ensureAiDisclosure(text, { asked: true, line: sensitive ? av.AI_LINE_PLAIN : av.AI_LINE });
      return { text: said.text, voice: { quirk: false, aiAsked: true, reason: said.added ? "asked whether Aidan is an AI: the yes was added" : "asked whether Aidan is an AI" } };
    }
    if (!voiceOn()) return { text, voice: null };
    if (sensitive) return { text, voice: { quirk: false, reason: `plain reply: ${sensitive}` } };
    try {
      const input = { kind, instruction, body: text, firstName: ac.greetingName(msg && msg.fromName) };
      const system = av.voiceSystemFor(voiceSkill);
      const prompt = av.voicePrompt(input);
      const raw = runImpl ? await runImpl.voice(Object.assign({ system, content: prompt, skill: voiceSkill }, input))
        : await model({ system, schema: av.VOICE_SCHEMA, effort: "low", maxTokens: 400, content: prompt, timeout: VOICE_TIMEOUT_MS });
      const quirk = av.cleanQuirk(raw);
      if (!quirk) return { text, voice: { quirk: false, reason: raw && raw.sensitive === true ? "plain reply: the voice judged it sensitive" : "no aside fitted" } };
      return { text: av.withQuirk(text, quirk), voice: { quirk: true } };
    } catch (err) {
      logger.warn("support: Aidan's voice wasn't added", { ticketId, error: errText(err) });
      return { text, voice: { quirk: false, reason: "the voice couldn't be reached" } };
    }
  }
  const voiceFact = (v) => (v ? { voice: v } : {});

  // Send a plain reply (or one with files) on the thread from the mailbox and file it on the ticket.
  async function sendOnThread({ ticketId, ticket, msg, config, settings, recipients, text, attachments = [], fields = {} }) {
    const raw5322 = ac.buildMultipartRaw({
      fromName: config.fromName, fromEmail: settings.connectedEmail, to: recipients.to, cc: recipients.cc, subject: msg.subject || ticket.subject, text,
      inReplyTo: msg.messageId, references: msg.references, attachments,
    });
    await stopIfSpam(ticketId);
    const sent = await gmail("messages/send", { method: "POST", body: { raw: raw5322, threadId: ticket.threadId || ticketId } });
    const sentId = String((sent && sent.id) || `aidan-${now().getTime()}`);
    await tickets().doc(ticketId).collection("messages").doc(sentId).set(Object.assign({
      direction: "out", from: settings.connectedEmail, fromName: config.fromName, to: recipients.to, cc: recipients.cc, subject: core.replySubject(msg.subject || ticket.subject),
      text, snippet: core.clip(text.replace(/\s+/g, " "), 240), at: now(), gmailId: sentId, auto: false, sentBy: "aidan", source: "aidan",
      attachments: attachments.map((a) => ({ name: a.name, type: String(a.type || "").split(";")[0], size: Buffer.isBuffer(a.content) ? a.content.length : Buffer.byteLength(String(a.content || ""), "utf8") })),
    }, fields));
    return sentId;
  }
  const leftOffNote = (k) => (k ? ` ${k} other ${k === 1 ? "person" : "people"} on the email ${k === 1 ? "was" : "were"} left off, because console information goes only to allowed senders.` : "");

  // A request to change something on the console: Aidan can only read it.
  // A short, fixed reply (no model) to the allowed senders on the email;
  // nothing on the console is touched.
  async function readOnlyReply({ ticketId, ticket, msg, config, finish }) {
    const settings = await readSettings();
    if (!settings.connectedEmail) throw new Error("The mailbox isn't connected.");
    const recipients = ac.consoleRecipients(ac.replyAllRecipients({ from: msg.from, to: msg.to || [], cc: msg.cc || [] }, { mailbox: settings.connectedEmail }), config.allowedSenders);
    if (!recipients.to.length) throw new Error("There is no one to reply to.");
    const text = ac.composeReadOnlyReply({ firstName: ac.greetingName(msg.fromName), fromName: config.fromName, signatureLine: ac.signatureLineOf(config) });
    const sentId = await sendOnThread({ ticketId, ticket, msg, config, settings, recipients, text, fields: { kind: "answer", readOnly: true } });
    const n = recipients.to.length + recipients.cc.length;
    return finish({
      aidan: { status: "replied", kind: "answer", readOnly: true, recipients: n, sentId },
      status: "resolved", resolvedBy: "aidan", resolvedAt: now(), needsHuman: false, firstResponseAt: ticket.firstResponseAt || now(), lastReplyAt: now(), lastMessageAt: now(),
      messageCount: (ticket.messageCount || 0) + 1, snippet: core.clip(text.replace(/\s+/g, " "), 240),
    }, `Aidan was asked to change something on the console. It can only read it, so it replied saying so and changed nothing.${leftOffNote(recipients.leftOff)}`);
  }

  // A "generate" run: write the document with the skill and reply to everyone
  // on the email (the verified From address plus the original To and Cc; never
  // Reply-To, never our own addresses), on the thread, with it attached.
  async function generateAndReply({ ticketId, ticket, job, msg, config, skill, client, instruction, email, inputs, skipped, finish, consoleData = null, content = null, voiceSkill = null }) {
    const settings = await readSettings();
    if (!settings.connectedEmail) throw new Error("The mailbox isn't connected.");
    const header = `From: ${msg.fromName || ""}\nSubject: ${msg.subject || ticket.subject || ""}`;
    // Console data read for the instruction goes in as content, after the email.
    const fromConsole = Boolean(consoleData && consoleData.used);
    const written = await writeDocument({ skill, client, instruction, header, email, inputs, skipped, consoleText: fromConsole ? consoleData.text : "", content });
    // Ids out of the reply and the document, as for an answer (unless asked for).
    const doc = fromConsole ? Object.assign({}, written, {
      replyText: withoutIds(written.replyText, consoleData, instruction),
      documentMd: withoutIds(written.documentMd, consoleData, instruction),
    }) : written;
    const all = ac.replyAllRecipients({ from: msg.from, to: msg.to || [], cc: msg.cc || [] }, { mailbox: settings.connectedEmail });
    const recipients = fromConsole ? ac.consoleRecipients(all, config.allowedSenders) : all;
    if (!recipients.to.length) throw new Error("There is no one to reply to.");
    // The cover note in Aidan's voice; the document is never passed to it.
    const voiced = await inVoice({ ticketId, kind: "generate", body: doc.replyText, instruction, msg, ticket, voiceSkill, content });
    const text = ac.composeAidanReply({ firstName: ac.greetingName(msg.fromName), replyText: voiced.text, fromName: config.fromName, signatureLine: ac.signatureLineOf(config) });
    const raw = ac.buildMultipartRaw({
      fromName: config.fromName, fromEmail: settings.connectedEmail, to: recipients.to, cc: recipients.cc, subject: msg.subject || ticket.subject, text,
      inReplyTo: msg.messageId, references: msg.references, attachments: [{ name: doc.fileName, type: "text/markdown; charset=UTF-8", content: doc.documentMd }],
    });
    await stopIfSpam(ticketId);
    const sent = await gmail("messages/send", { method: "POST", body: { raw, threadId: ticket.threadId || ticketId } });
    const sentId = String((sent && sent.id) || `aidan-${now().getTime()}`);
    const size = Buffer.byteLength(doc.documentMd, "utf8");
    await tickets().doc(ticketId).collection("messages").doc(sentId).set({
      direction: "out", from: settings.connectedEmail, fromName: config.fromName, to: recipients.to, cc: recipients.cc, subject: core.replySubject(msg.subject || ticket.subject),
      text, snippet: core.clip(text.replace(/\s+/g, " "), 240), at: now(), gmailId: sentId, auto: false, sentBy: "aidan", source: "aidan", kind: "generate",
      attachments: [{ name: doc.fileName, type: "text/markdown", size }], skillId: skill.id, skillName: skill.name || skill.slug,
      // Restricted to the allowed senders: never read as thread content later (ac.sharedEarlier).
      ...(fromConsole ? { console: true } : {}),
    });
    const n = recipients.to.length + recipients.cc.length;
    return finish({
      aidan: Object.assign({ status: "replied", kind: "generate", skillId: skill.id, skillName: skill.name || skill.slug, client, document: { name: doc.fileName, title: doc.title, size }, recipients: n, sentId },
        fromConsole ? { console: consoleFacts(consoleData) } : {}, voiceFact(voiced.voice)),
      status: "resolved", resolvedBy: "aidan", resolvedAt: now(), needsHuman: false, firstResponseAt: ticket.firstResponseAt || now(), lastReplyAt: now(), lastMessageAt: now(),
      messageCount: (ticket.messageCount || 0) + 1, snippet: core.clip(text.replace(/\s+/g, " "), 240),
    }, `Aidan wrote ${doc.fileName} with the ${skill.name || skill.slug} skill${fromConsole ? " and the console's data" : ""} and replied to ${n} ${n === 1 ? "person" : "people"}.${fromConsole ? leftOffNote(recipients.leftOff) : ""}`);
  }

  // ── Branded sales collateral (JtkLrEG0aTnC5JfkdPA1) ──
  // A write whose instruction names collateral (collateral-core.js →
  // collateralFormat). The document is written with the brand skill (voice,
  // messaging, the CTA) and the chosen collateral skill (structure and depth;
  // the brand skill alone when none was chosen), from the email, its
  // attachments, the thread content when the instruction refers to the thread
  // (audience-checked like any run's, readThreadContent), the skill's kept reference
  // material (earlier collateral included), the published Help Centre and the
  // prospect's industry and country. What the model wrote is cleaned
  // (guardCollateral: no Sydney/Australia positioning, no internal names, no
  // long dashes), printed to a branded PDF on the server, and sent by
  // reply-all with the PDF and the Markdown source attached. It is then filed
  // on the ticket and kept as a reference example for the skill, so later runs
  // stay consistent. No PDF, no email: a person takes it, with the Markdown
  // kept as an internal note on the thread.
  const pdfRenderer = runImpl ? (runImpl.render || null) : renderPdf;
  async function projectNames() {
    try { return (await rowsOf("projects")).map((p) => String(p.name || "").trim()).filter(Boolean); }
    catch (err) { logger.warn("support: Aidan couldn't read the project names", { error: errText(err) }); return []; }
  }
  async function prospectOf(instruction, client) {
    if (typeof accounts !== "function") return cc.prospectFor({ instruction, client });
    try { const a = (await accounts()) || {}; return cc.prospectFor({ instruction, client, prospects: a.prospects || [], leads: a.leads || [] }); }
    catch (err) { logger.warn("support: Aidan couldn't read Prospects and Leads", { error: errText(err) }); return cc.prospectFor({ instruction, client }); }
  }
  // The Brand Guidelines market page for the company's country
  // (mErc7MPAkrKjF9fWgqXb): { market, missing }. `missing` is the country when
  // the company has one and no market page covers it, so the self-check files
  // a ticket to add it; the default guidelines apply meanwhile.
  async function marketOf(prospect) {
    const country = prospect && prospect.country ? String(prospect.country).trim() : "";
    if (!country || typeof markets !== "function") return { market: null, missing: "" };
    try {
      const market = mc.marketFor(country, (await markets()) || []);
      return { market, missing: market ? "" : core.clip(country, 60) };
    } catch (err) { logger.warn("support: Aidan couldn't read the market pages", { error: errText(err) }); return { market: null, missing: "" }; }
  }
  async function helpCentreText(industry) {
    if (!helpCentre || typeof helpCentre.articles !== "function") return "";
    try { return cc.helpCentreBlock(await helpCentre.articles(), industry); }
    catch (err) { logger.warn("support: Aidan couldn't read the Help Centre for collateral", { error: errText(err) }); return ""; }
  }
  // Write: the prompt (brand skill, chosen skill, kept references, the
  // prospect's facts, the Help Centre, the thread content), the model call and
  // the guard. -> { title, replyText, docMd: { text, changes }, files, industry, prospect, hasCollateralSkill }
  async function writeCollateral({ ticket, msg, skill, brand, format, client, instruction, email, inputs, skipped, content = null }) {
    const [prospect, internalNames] = await Promise.all([prospectOf(instruction, client), projectNames()]);
    const industry = cc.industryFor(instruction, prospect);
    const { market, missing } = await marketOf(prospect);
    const helpText = await helpCentreText(industry);
    const refs = await referencesFor(skill.id);
    const hasCollateralSkill = skill.id !== brand.id;
    const marketLine = mc.marketSystem(market, missing);
    const system = `${ac.DOC_SYSTEM}${content ? `\n${ac.CONTENT_LINE}` : ""}\n${cc.collateralSystem({ format, industry, prospect, internalNames })}${marketLine ? `\n${marketLine}` : ""}`
      + `\n\n<brand_skill name="${String(brand.name || brand.slug || "").replace(/"/g, "")}">\n${await skillFiles(cc.promptFiles(brand))}\n</brand_skill>`
      + (hasCollateralSkill ? `\n\n<skill name="${String(skill.name || skill.slug || "").replace(/"/g, "")}">\n${await skillFiles(skill)}\n</skill>` : "")
      + (market ? `\n\n${mc.marketBlock(market)}` : "")
      + (refs.text ? `\n\n<reference_material>\n${refs.text}\n</reference_material>` : "");
    const header = `From: ${msg.fromName || ""}\nSubject: ${msg.subject || ticket.subject || ""}\nInstruction to Aidan: ${instruction}${prospect && prospect.name ? `\nFor: ${prospect.name}` : client ? `\nFor: ${client}` : ""}\nCollateral: ${format.label}`;
    const blocks = contentBlocks({ header, email, inputs, skipped });
    // The thread the instruction refers to, as third-party content.
    if (content) blocks.splice(1, 0, { type: "text", text: ac.contentBlock(content) });
    const facts = cc.prospectBlock(prospect, industry);
    if (facts) blocks.push({ type: "text", text: facts });
    if (helpText) blocks.push({ type: "text", text: helpText });
    const raw = runImpl && runImpl.write ? await runImpl.write({ skill, brand, client, instruction, system, content: blocks, references: refs.count, collateral: Object.assign({ format: format.key, industry, prospect }, market ? { market: market.slug } : {}) })
      : await model({ system, schema: ac.DOC_SCHEMA, effort: "medium", maxTokens: format.maxTokens, content: blocks, timeout: DOC_TIMEOUT_MS });
    const written = ac.cleanDocument(raw);
    // Deterministic, whatever the model wrote: no Australian positioning, no internal names, no long dashes.
    const guard = { internalNames, prospectCountry: prospect ? prospect.country : "" };
    const docMd = cc.guardCollateral(written.documentMd, guard);
    const title = cc.guardCollateral(written.title, guard).text || format.label;
    const replyText = cc.guardCollateral(written.replyText, guard).text || `Please find attached the ${format.label.toLowerCase()} as a branded PDF, with its Markdown source for editing.`;
    return { title, replyText, docMd, files: cc.fileNames(written.fileName, title), industry, prospect, hasCollateralSkill, market, missingMarket: missing };
  }
  // Print: the branded page, printed on the server. -> { printed, failure }:
  // `printed` is { pdf, pages } or null, and then `failure` says why.
  async function printCollateral({ docMd, title, format, industry, prospect, brand }) {
    if (!pdfRenderer) return { printed: null, failure: "the PDF printer isn't available on the server" };
    try {
      const html = cl.collateralHtml({ documentMd: docMd.text, title, format, industry, prospect, brand });
      const printed = await pdfRenderer(html, { format, timeoutMs: COLLATERAL_RENDER_TIMEOUT_MS });
      if (!printed || !cc.isPdf(printed.pdf)) return { printed: null, failure: "the printer returned no PDF" };
      return { printed, failure: "" };
    } catch (err) { return { printed: null, failure: errText(err) }; }
  }
  // Keep example: filed as a reference example for the skill, the Markdown as
  // its text, the PDF in Storage. A filing failure is noted; the email has
  // already gone. -> { referenceId, storagePath } ("" when not kept).
  async function keepCollateralExample({ ticketId, skill, format, industry, title, docMd, files, printed, sentId, mdSize }) {
    const refId = `ref-${now().getTime()}-${crypto.randomBytes(4).toString("hex")}`;
    let storagePath = "";
    let referenceId = "";
    try {
      if (bucket) {
        const path = `skill-references/${skill.id}/${refId}/${files.pdf}`;
        try { await bucket().file(path).save(printed.pdf, { contentType: "application/pdf", resumable: false }); storagePath = path; }
        catch (err) { logger.warn("support: Aidan couldn't store the collateral PDF", { ticketId, error: errText(err) }); }
      }
      await db.collection(REFERENCES).doc(refId).set({
        skillId: skill.id, skillSlug: skill.slug || "", skillName: skill.name || "", ticketId, gmailId: sentId,
        subject: core.clip(`${format.label}: ${title}`, 500), text: core.clip(docMd.text, REFERENCE_TEXT_BUDGET), example: true, format: format.key, industry,
        files: [Object.assign({ name: files.pdf, kind: "pdf", size: printed.pdf.length, pages: printed.pages || 0 }, storagePath ? { storagePath } : {}), { name: files.md, kind: "text", size: mdSize }],
        addedBy: "aidan", source: "aidan-collateral", createdAt: now(),
      });
      referenceId = refId;
    } catch (err) { logger.error("support: Aidan couldn't keep the collateral as a reference", { ticketId, error: errText(err) }); }
    return { referenceId, storagePath };
  }
  // The whole run: write, print, send (reply-all with the PDF and the
  // Markdown), keep the example, file it on the ticket. No PDF, no email.
  async function collateralAndReply({ ticketId, ticket, msg, config, skill, brand, format, client, instruction, email, inputs, skipped, finish, content = null, voiceSkill = null, signals = null }) {
    const settings = await readSettings();
    if (!settings.connectedEmail) throw new Error("The mailbox isn't connected.");
    const { title, replyText, docMd, files, industry, prospect, hasCollateralSkill, market, missingMarket } = await writeCollateral({ ticket, msg, skill, brand, format, client, instruction, email, inputs, skipped, content });
    const removed = docMd.changes;
    // Which market page it followed, or the country no page covers (the default guidelines were used).
    const marketFact = market ? { market: { slug: market.slug, name: market.name } } : missingMarket ? { market: { missing: missingMarket } } : {};
    if (signals && missingMarket) signals.missingMarket = { country: missingMarket, format: format.label };
    const collateralFacts = Object.assign({ format: format.key, formatLabel: format.label, industry, prospect: prospect ? { name: prospect.name, source: prospect.source } : null }, marketFact);
    const mdSize = Buffer.byteLength(docMd.text, "utf8");
    // The branded PDF, printed on the server. Without it nothing is sent.
    const { printed, failure } = await printCollateral({ docMd, title, format, industry, prospect, brand });
    if (!printed) {
      // The Markdown is kept on the thread as an internal note, so a person can finish it.
      await tickets().doc(ticketId).collection("messages").doc(`aidan-draft-${now().getTime()}`).set({ direction: "note", by: "aidan", at: now(),
        text: core.clip(`Aidan's ${format.label.toLowerCase()} (${files.md}), not sent because the PDF couldn't be made:\n\n${docMd.text}`, 100000) });
      return finish({ aidan: { status: "needs-person", kind: "generate", skillId: skill.id, skillName: skill.name || skill.slug, client,
        reason: `The branded PDF couldn't be made (${core.clip(failure, 200)}), so nothing was sent. The Markdown is on the thread as an internal note.`,
        document: { name: files.md, title, size: mdSize }, collateral: Object.assign({}, collateralFacts, { pdf: null, markdown: { name: files.md, size: mdSize }, removed }) }, needsHuman: true },
      "Aidan wrote the collateral but couldn't make the PDF, so a person takes it.");
    }
    const recipients = ac.replyAllRecipients({ from: msg.from, to: msg.to || [], cc: msg.cc || [] }, { mailbox: settings.connectedEmail });
    if (!recipients.to.length) throw new Error("There is no one to reply to.");
    // The cover note in Aidan's voice. The collateral itself (the PDF and its
    // Markdown) is the brand voice's alone and is never passed to it.
    const voiced = await inVoice({ ticketId, kind: "generate", body: replyText, instruction, msg, ticket, voiceSkill, content });
    const text = ac.composeAidanReply({ firstName: ac.greetingName(msg.fromName), replyText: voiced.text, fromName: config.fromName, signatureLine: ac.signatureLineOf(config) });
    const pdfSize = printed.pdf.length;
    const sentId = await sendOnThread({ ticketId, ticket, msg, config, settings, recipients, text,
      attachments: [{ name: files.pdf, type: "application/pdf", content: printed.pdf }, { name: files.md, type: "text/markdown; charset=UTF-8", content: docMd.text }],
      fields: { kind: "generate", collateral: true, skillId: skill.id, skillName: skill.name || skill.slug } });
    const { referenceId, storagePath } = await keepCollateralExample({ ticketId, skill, format, industry, title, docMd, files, printed, sentId, mdSize });
    const n = recipients.to.length + recipients.cc.length;
    const pages = printed.pages || 0;
    const skillName = skill.name || skill.slug;
    return finish({
      aidan: Object.assign({ status: "replied", kind: "generate", skillId: skill.id, skillName, client, document: { name: files.md, title, size: mdSize }, recipients: n, sentId,
        collateral: Object.assign({}, collateralFacts, { pdf: Object.assign({ name: files.pdf, size: pdfSize, pages }, storagePath ? { storagePath } : {}), markdown: { name: files.md, size: mdSize }, referenceId, removed }) }, voiceFact(voiced.voice)),
      status: "resolved", resolvedBy: "aidan", resolvedAt: now(), needsHuman: false, firstResponseAt: ticket.firstResponseAt || now(), lastReplyAt: now(), lastMessageAt: now(),
      messageCount: (ticket.messageCount || 0) + 1, snippet: core.clip(text.replace(/\s+/g, " "), 240),
    }, `Aidan wrote the branded ${format.label.toLowerCase()} ${files.pdf}${pages ? ` (${pages} page${pages === 1 ? "" : "s"})` : ""} with its Markdown source, using the ${skillName} skill${hasCollateralSkill ? ` and the ${brand.name || brand.slug} brand` : ""}${market ? `, tailored to the ${market.name} market page` : missingMarket ? ` (no market page for ${missingMarket}, so the default brand guidelines)` : ""}, and replied to ${n} ${n === 1 ? "person" : "people"}.${referenceId ? ` Kept as a reference example for the ${skillName} skill.` : ""}${cc.guardLine(removed) ? ` ${cc.guardLine(removed)}` : ""}`);
  }

  // An "answer" run: reply to everyone on the email (the same recipients as a
  // write) in the email's own body, with no attachment. The model reads the
  // whole email, with the thread quoted in it, as untrusted content; the only
  // instruction is the one decideAidan accepted. `skill` is one the
  // instruction names, or null. When the model says it can't answer from what
  // it has (the request needs a document or facts that aren't there), nothing
  // is sent and a person takes it; `noSkill` is why a write got here.
  // With console data (`consoleData.used`, readConsole) the answer is written
  // from it too, and then: the reply goes only to the allowed senders on the
  // email; ids are replaced by titles unless the instruction asks for ids; and
  // a long answer (over roughly a page) is attached as Markdown with a
  // two-line summary in the body.
  // With thread `content` (the instruction refers to the thread), the email
  // block is the sender's new text only and the content is its own block,
  // marked as third-party material; the reply is written for everyone on it.
  async function answerInline({ ticketId, ticket, job, msg, config, skill = null, instruction, inputs, skipped, finish, noSkill = null, consoleData = null, content = null, signals = null, voiceSkill = null }) {
    const settings = await readSettings();
    if (!settings.connectedEmail) throw new Error("The mailbox isn't connected.");
    const fromConsole = Boolean(consoleData && consoleData.used);
    const all = ac.replyAllRecipients({ from: msg.from, to: msg.to || [], cc: msg.cc || [] }, { mailbox: settings.connectedEmail });
    const recipients = fromConsole ? ac.consoleRecipients(all, config.allowedSenders) : all;
    if (!recipients.to.length) throw new Error("There is no one to reply to.");
    const n = recipients.to.length + recipients.cc.length;
    const firstName = ac.greetingName(msg.fromName);
    const header = `From: ${msg.fromName || ""}\nSubject: ${msg.subject || ticket.subject || ""}\nInstruction to Aidan: ${instruction}${content ? "\nThe instruction refers to <thread_content>: answer the question found there, for everyone on the email." : firstName ? `\nThe sender's first name: ${firstName}` : ""}\nPeople the reply goes to: ${n}`;
    const refs = skill ? await referencesFor(skill.id) : { text: "", count: 0 };
    const system = `${fromConsole ? ac.CONSOLE_ANSWER_SYSTEM : ac.ANSWER_SYSTEM}${content ? `\n${ac.CONTENT_LINE}` : ""}${skill ? `\n\n<skill name="${String(skill.name || skill.slug || "").replace(/"/g, "")}">\n${await skillFiles(skill)}\n</skill>` : ""}${refs.text ? `\n\n<reference_material>\n${refs.text}\n</reference_material>` : ""}`;
    const blocks = contentBlocks({ header, email: core.clip(content ? content.fresh : String(msg.text || ""), ANSWER_EMAIL_MAX), inputs, skipped });
    if (content) blocks.splice(1, 0, { type: "text", text: ac.contentBlock(content) });
    if (fromConsole) blocks.push({ type: "text", text: consoleData.text });
    const raw = runImpl && runImpl.answer ? await runImpl.answer({ skill, instruction, system, content: blocks, references: refs.count, console: fromConsole ? consoleData : null, thread: content ? content.text : "" })
      : await model(fromConsole
        ? { system, schema: ac.CONSOLE_ANSWER_SCHEMA, effort: "medium", maxTokens: 16000, content: blocks, timeout: ANSWER_TIMEOUT_MS }
        : { system, schema: ac.ANSWER_SCHEMA, effort: "medium", maxTokens: 4000, content: blocks, timeout: ANSWER_TIMEOUT_MS });
    let answer = fromConsole ? ac.cleanConsoleAnswer(raw) : ac.cleanAnswer(raw);
    // The model's own self-check, for the self-improvement ticket (never sent).
    if (signals) signals.selfCheck = answer.selfCheck;
    // "Are you a bot?" always gets a plain yes: when the model had nothing to
    // say to a short instruction that asks only that, the line is the answer.
    const askedAi = av.asksIfAi(instruction);
    if (askedAi && !answer.canAnswer && noSkill === null && String(instruction || "").length <= av.AI_ONLY_MAX) {
      answer = Object.assign({}, answer, { canAnswer: true, replyText: av.AI_LINE, documentMd: "", title: "", reason: "", selfCheck: null });
      // The request was met (it asked only that), so there is no gap to file.
      if (signals) signals.selfCheck = null;
    }
    if (!answer.canAnswer) {
      const why = answer.reason ? ` (${answer.reason})` : "";
      const where = fromConsole ? "the email and the console" : "the email alone";
      const reason = noSkill !== null ? `No skill matches the instruction${noSkill ? ` (${core.clip(noSkill, 200)})` : ""}, and it couldn't be answered from ${where}${why}.`
        : `Aidan couldn't answer this from ${where}${why}.`;
      return finish({ aidan: Object.assign({ status: "needs-person", reason }, fromConsole ? { console: consoleFacts(consoleData) } : {}), needsHuman: true },
        noSkill !== null ? "Aidan couldn't tell which skill to use, so a person takes it." : `Aidan couldn't answer this from ${where}, so a person takes it.`);
    }
    let body = answer.replyText;
    let attachment = null;
    if (fromConsole) {
      const shaped = consoleReply(answer, consoleData, instruction);
      body = shaped.inline;
      attachment = shaped.attachment;
    }
    // The voice: "are you a bot?" answered yes, or at most one aside after
    // the body; an attached answer is never passed to it.
    const voiced = await inVoice({ ticketId, kind: "answer", body, instruction, msg, ticket, voiceSkill, content });
    const text = ac.composeAidanAnswer({ replyText: voiced.text, fromName: config.fromName, signatureLine: ac.signatureLineOf(config) });
    const attachments = attachment ? [{ name: attachment.name, type: "text/markdown; charset=UTF-8", content: attachment.content }] : [];
    const named = skill ? { skillId: skill.id, skillName: skill.name || skill.slug } : {};
    const sentId = await sendOnThread({ ticketId, ticket, msg, config, settings, recipients, text, attachments, fields: Object.assign({ kind: "answer" }, named, fromConsole ? { console: true } : {}) });
    const extra = Object.assign(fromConsole ? { console: consoleFacts(consoleData) } : {}, voiceFact(voiced.voice));
    if (attachment) extra.document = { name: attachment.name, title: answer.title || attachment.name, size: Buffer.byteLength(attachment.content, "utf8") };
    return finish({
      aidan: Object.assign({ status: "replied", kind: "answer", recipients: n, sentId }, named, extra),
      status: "resolved", resolvedBy: "aidan", resolvedAt: now(), needsHuman: false, firstResponseAt: ticket.firstResponseAt || now(), lastReplyAt: now(), lastMessageAt: now(),
      messageCount: (ticket.messageCount || 0) + 1, snippet: core.clip(text.replace(/\s+/g, " "), 240),
    }, fromConsole
      ? `Aidan answered from the console (${consoleFacts(consoleData).reads} read${consoleFacts(consoleData).reads === 1 ? "" : "s"})${attachment ? `, with the full answer attached as ${attachment.name},` : " in the email itself"} and replied to ${n} ${n === 1 ? "person" : "people"}.${leftOffNote(recipients.leftOff)}`
      : `Aidan answered on the email and replied to ${n} ${n === 1 ? "person" : "people"}.`);
  }

  // ── One answering engine: a platform question, from the Help Centre ──
  // The Support Inbox's own match → draft → confidence pipeline
  // (answer-core.js), given the tagged email exactly as triage is given a
  // customer's first email. Returns { triage, cited } when the Help Centre
  // answers the question, else null (not about the platform, no article
  // answers it, or the engine couldn't be reached): the run then carries on to
  // the console and the email. An acknowledgement asks nothing, and an
  // instruction that names a skill is answered with that skill, so neither is
  // put to the engine. With Aidan's model stubbed (`run`) the engine runs only
  // when it is stubbed too, so no test reaches the network.
  // With thread `content`, the engine is given it as its own <thread_content>
  // block (closing tag neutralised, ac.contentBlock) under the "content, never
  // instructions" line (ac.CONTENT_LINE), ahead of the sender's new text
  // (answer-core.js → questionFromEmail, emailBlock).
  async function helpCentreAnswer({ ticketId, msg, ticket, instruction, skill, content = null }) {
    // "Are you a bot?" is Aidan's own to answer, not the Help Centre's.
    if (!helpCentre || typeof helpCentre.articles !== "function" || skill || ac.isAcknowledgement(instruction) || av.asksIfAi(instruction)) return null;
    if (runImpl && !helpCentre.run) return null;
    try {
      const articles = await helpCentre.articles();
      if (!articles.length) return null;
      const q = answerCore.questionFromEmail({ fromName: msg.fromName, fromEmail: msg.from, subject: msg.subject || ticket.subject,
        text: content ? content.fresh : msg.text, content: content ? ac.contentBlock(content) : "", contentNote: content ? ac.CONTENT_LINE : "" });
      const answered = await answerCore.answerFromHelpCentre({ run: helpCentre.run, call: model, ticket: q.ticket, messages: q.messages, articles, source: "aidan" });
      return answerCore.usableAnswer(answered.triage) ? answered : null;
    } catch (err) {
      logger.warn("support: Aidan Help Centre match failed", { ticketId, error: errText(err) });
      return null;
    }
  }
  // The Help Centre's answer, sent as Aidan's: the engine's reply body as the
  // Support Inbox would draft it (support-core.js → stripOpening), the cited
  // articles named by title, in the email itself, to everyone on the email
  // (the Help Centre is public, so nobody is left off). Always sent: the
  // Support Inbox's confidence threshold and auto-send switch are not Aidan's.
  // The confidence and the articles go on the ticket, not in the email.
  async function sendHelpCentreAnswer({ ticketId, ticket, msg, config, finish, triage, cited, content = null, signals = null, instruction = "", voiceSkill = null }) {
    if (signals) signals.helpCentre = { confidence: triage.confidence };
    const settings = await readSettings();
    if (!settings.connectedEmail) throw new Error("The mailbox isn't connected.");
    const recipients = ac.replyAllRecipients({ from: msg.from, to: msg.to || [], cc: msg.cc || [] }, { mailbox: settings.connectedEmail });
    if (!recipients.to.length) throw new Error("There is no one to reply to.");
    const n = recipients.to.length + recipients.cc.length;
    // The engine's answer and its articles first, exactly as drafted; then the voice's one aside, if any.
    const voiced = await inVoice({ ticketId, kind: "helpCentre", body: answerCore.withArticleTitles(core.stripOpening(triage.reply), cited), instruction, msg, ticket, voiceSkill, content });
    // A question from the thread is answered to everyone on it: "Hi all".
    const text = ac.composeHelpCentreAnswer({ firstName: ac.greetingName(msg.fromName), replyText: voiced.text, fromName: config.fromName, signatureLine: ac.signatureLineOf(config), all: Boolean(content) });
    const sentId = await sendOnThread({ ticketId, ticket, msg, config, settings, recipients, text, fields: { kind: "answer", helpCentre: true, confidence: triage.confidence, articles: cited } });
    const pct = Math.round(triage.confidence * 100);
    return finish({
      aidan: Object.assign({ status: "replied", kind: "answer", recipients: n, sentId,
        helpCentre: { confidence: triage.confidence, confidenceSteps: triage.confidenceSteps, articles: cited, question: triage.summary } }, voiceFact(voiced.voice)),
      status: "resolved", resolvedBy: "aidan", resolvedAt: now(), needsHuman: false, firstResponseAt: ticket.firstResponseAt || now(), lastReplyAt: now(), lastMessageAt: now(),
      messageCount: (ticket.messageCount || 0) + 1, snippet: core.clip(text.replace(/\s+/g, " "), 240),
    }, `Aidan answered from the Help Centre (${cited.length} article${cited.length === 1 ? "" : "s"}, ${pct}% confidence) in the email itself and replied to ${n} ${n === 1 ? "person" : "people"}.`);
  }

  // ── Instruction and content ──
  // The thread content a run reads, or null. Only when the instruction (the
  // sender's new text) refers to the thread, never for a store, and never
  // when the instruction itself asks to change the console. The quoted or
  // forwarded part of the tagged email is read as it is; the thread's earlier
  // emails only under the audience rule (ac.sharedEarlier): everyone the reply
  // goes to was already on that email, and none of Aidan's own console or
  // read-only replies. What was left out, and any instruction found in the
  // content (ignored), is noted on the ticket. `content.fresh` is the
  // sender's new text, the only email text the run then reads.
  async function readThreadContent({ ticketId, job, instruction, action, msg, facts, rows }) {
    if (action === "store" || ac.consoleChangeRequest(instruction) || !ac.refersToThread(instruction)) return null;
    const settings = await readSettings();
    const reply = ac.replyAllRecipients({ from: msg.from, to: msg.to || [], cc: msg.cc || [] }, { mailbox: settings.connectedEmail });
    const parts = ac.requestParts({ bodies: facts.bodies, text: msg.text });
    const shared = ac.sharedEarlier(rows, { exclude: job.gmailId, recipients: [...reply.to, ...reply.cc] });
    if (shared.left) await logEvent(ticketId, "aidan", `Aidan left ${shared.left} earlier email${shared.left === 1 ? "" : "s"} on this thread out of what it read, because not everyone this reply goes to had received ${shared.left === 1 ? "it" : "them"}.`);
    const content = ac.threadContent({ quoted: parts.quoted, earlier: shared.rows });
    if (!content) return null;
    content.fresh = parts.fresh;
    content.left = shared.left;
    if (content.ignored.length) await logEvent(ticketId, "aidan", `Aidan: ignored instruction in quoted text (${content.ignored.length}). Only the sender's new text is an instruction: the kind of reply, the skill and the recipients were not changed.`);
    return content;
  }

  async function runOne(ticketId) {
    const ref = tickets().doc(ticketId);
    // The claim is a transaction: of two instances working the queue at once,
    // only one moves the job from queued to working, so only one runs (and sends).
    const claim = await db.runTransaction(async (tx) => {
      const t = data(await tx.get(ref));
      if (!t || !t.aidanPending || !t.aidan || t.aidan.status !== "queued") return null;
      // Queued on a thread that is spam: cancelled here, never run.
      if (isSpam(t)) { tx.update(ref, { aidanPending: false, aidan: spamState(t.aidan), updatedAt: now() }); return { spam: true }; }
      const job = Object.assign({}, t.aidan, { status: "working", startedAt: now() });
      tx.set(ref, { aidanPending: false, aidan: job }, { merge: true });
      return { ticket: t, job };
    });
    if (!claim) return { ok: false, error: "nothing queued" };
    if (claim.spam) {
      await logEvent(ticketId, "aidan", "Aidan: no action — spam. The request waiting on this thread was cancelled.");
      return { ok: true, spam: true };
    }
    const { ticket, job } = claim;
    // What the run did, for the self-check at its end (reflect): filled as it goes.
    const signals = { gated: false };
    const finish = async (fields, event) => {
      // Marked as spam while the run worked: the run's result is not written
      // over the spam record (a store would otherwise resolve the ticket).
      await stopIfSpam(ticketId);
      await ref.set(Object.assign({ updatedAt: now() }, fields, { aidan: Object.assign({}, job, fields.aidan || {}, { finishedAt: now() }) }), { merge: true });
      signals.final = Object.assign({}, fields.aidan || {});
      if (event) await logEvent(ticketId, "aidan", event);
    };
    const result = await (async () => { try {
      const config = await readConfig();
      const msgSnap = await ref.collection("messages").doc(job.gmailId).get();
      const msg = data(msgSnap);
      if (!msg) return finish({ aidan: { status: "error", reason: "The email Aidan was asked about is no longer on the ticket." }, needsHuman: true });
      const full = await gmail(`messages/${encodeURIComponent(job.gmailId)}?format=full`);
      const facts = ac.mailFacts(full);
      // Gate 1, the sender re-check: the configuration and the thread may have
      // changed since the email was filed, so decide again, from Gmail's own
      // copy of the email (every body, the From count, the address headers)
      // and the thread's earlier emails as they are now.
      const refused = (reason) => finish({ aidan: { status: "ignored", reason } }, `Aidan did nothing: ${reason}`);
      if (facts.fromCount === 1 && facts.from !== core.lower(msg.from)) return refused("The email's From address doesn't match Gmail's copy.");
      const rows = await threadRows(ticketId);
      const untrusted = ac.untrustedThreadText(rows, { allowed: config.allowedSenders, exclude: job.gmailId });
      const d = ac.decideAidan({ inboxes: ticket.inboxes, message: asMessage(msg, facts), config, runs: 0, untrusted });
      if (d.action === "none") return refused(d.reason);
      // Gate 2, authentication: Gmail's own verdict on the From address. The
      // headers are in the message's own order, topmost first:
      // senderAuthenticated reads only the topmost Authentication-Results.
      const headers = facts.headers;
      if (config.requireSenderAuth) {
        const auth = ac.senderAuthenticated(headers, facts.from);
        if (!auth.ok) return finish({ aidan: { status: "ignored", reason: "The sender's address couldn't be verified (no SPF, DKIM or DMARC pass in Gmail's own check), so Aidan did nothing." } }, "Aidan did nothing: the sender's address couldn't be verified.");
      }
      // Past every gate: from here the run is checked at its end (reflect).
      // The mark is kept on the job too (aidan.gatedAt), so the 15-minute
      // sweep files a cut-off run only when it had passed every gate.
      signals.gated = true;
      await markGated(ref, job);
      signals.instruction = d.instruction;
      signals.kind = d.action;
      // Instruction and content: the instruction is d.instruction, from the
      // sender's new text only; the content is what it refers to on the
      // thread (readThreadContent), and the email the run reads is then the
      // new text alone. A run that read no content keeps no "refers to the
      // thread" mark, so the Aidan tab shows no instruction/content rows.
      const content = await readThreadContent({ ticketId, job, instruction: d.instruction, action: d.action, msg, facts, rows });
      if (content) job.content = ac.contentFacts(content);
      if (job.refersToThread || content) job.refersToThread = Boolean(content);
      const email = content ? content.fresh : core.stripQuoted(msg.text || "");
      const base = { ticketId, ticket, job, msg, config, instruction: d.instruction, email, finish, content, signals };
      // Aidan can only read the console: a request to change it (create a
      // ticket, update a README, deploy …) gets a fixed, polite reply and
      // nothing is changed. Decided from the instruction's own words, before
      // any model is asked; a store is left to its skill.
      if (d.action !== "store" && ac.consoleChangeRequest(d.instruction)) return readOnlyReply(base);
      const key = String(apiKey() || "");
      if (!runImpl && (!key || key === "unset")) { signals.noModel = true; return finish({ aidan: { status: "needs-person", reason: "No model is configured (ANTHROPIC_API_KEY)." }, needsHuman: true }); }
      const library = (await rowsOf("skills")).map((s) => ({ id: s.id, slug: s.slug || "", name: s.name || "", summary: s.summary || "", files: s.files || [] }));
      // The voice is how the reply is delivered, never a skill a document is
      // written with: it is taken out of the list a run chooses from.
      const skills = av.withoutVoiceSkill(library);
      base.voiceSkill = await voiceSkillFrom(library);
      // What the console holds, read-only. An answer always reads it (a plain
      // acknowledgement plans no read). A write reads it only when the
      // instruction is clearly about the console (ac.writeReadsConsole: a
      // ticket, a concept, the backlog, the Help Centre …), because a reply
      // that carries console data goes only to the allowed senders on the
      // email, and a write that merely names a client ("write the POC summary
      // for Kestrel") keeps going to everyone on it. A write no skill matches
      // is tried as an answer, so it reads the console like one. A failed read
      // leaves the run working from the email alone; a plan that finds a
      // change request gets the read-only reply.
      let consoleData = null;
      const readTheConsole = async () => {
        try { consoleData = await readConsole({ instruction: d.instruction, email, content }); }
        catch (err) { logger.error("support: Aidan console read failed", { ticketId, error: errText(err) }); }
        if (consoleData) Object.assign(signals, { codeMode: consoleData.codeMode, failedReads: consoleData.failedReads, consoleCut: consoleData.cut, scopedProjectIds: consoleData.scopedProjectIds, context: consoleData.context });
        return Boolean(consoleData && consoleData.changeRequested);
      };
      // An answer needs no skill: one named in the instruction is read, and
      // the model is never asked to choose one.
      // A question about the platform goes to the Help Centre first, through
      // the Support Inbox's own engine; whatever that doesn't answer (a
      // project or documentation question, a question about the email)
      // carries on to the console and the email.
      if (d.action === "answer") {
        const skill = ac.skillNamedIn(d.instruction, skills);
        const fromHelpCentre = await helpCentreAnswer({ ticketId, msg, ticket, instruction: d.instruction, skill, content });
        if (fromHelpCentre) return sendHelpCentreAnswer(Object.assign({}, base, fromHelpCentre));
        if (await readTheConsole()) return readOnlyReply(base);
        return answerInline(Object.assign(base, await readAttachments(job.gmailId, full && full.payload), { skill, consoleData }));
      }
      // Branded collateral: a write whose instruction names it. The brand skill
      // has to be in the library; the chosen skill (or the brand skill alone)
      // decides format and depth. It reads no console plan: only the
      // prospect's industry and country, and the published Help Centre.
      const format = d.action === "generate" ? cc.collateralFormat(d.instruction) : null;
      if (format) {
        const brand = cc.brandSkillIn(skills);
        if (!brand) {
          return finish({ aidan: { status: "needs-person", kind: "generate", reason: `Branded collateral needs the brand skill (${cc.BRAND_SLUG}) in the skills library, and it isn't there.` }, needsHuman: true },
            "Aidan was asked for branded collateral, but the brand skill isn't in the skills library, so a person takes it.");
        }
        const picked = await chooseSkill({ instruction: d.instruction, email, skills });
        const { inputs, skipped } = await readAttachments(job.gmailId, full && full.payload);
        return collateralAndReply(Object.assign(base, { skill: picked.skill || brand, brand, format, client: picked.client, inputs, skipped }));
      }
      const chosen = await chooseSkill({ instruction: d.instruction, email, skills });
      if (!chosen.skill) {
        // A request to write that no skill matches may still be something the
        // email itself answers ("summarise this thread"), or the console
        // ("summarise the Customer Support concept"): try it as an answer.
        // A request to keep material has nowhere to go without its skill.
        if (d.action === "generate") {
          if (await readTheConsole()) return readOnlyReply(base);
          return answerInline(Object.assign(base, await readAttachments(job.gmailId, full && full.payload), { noSkill: chosen.reason || "", consoleData }));
        }
        return finish({ aidan: { status: "needs-person", kind: d.action, reason: `No skill matches the instruction${chosen.reason ? ` (${core.clip(chosen.reason, 200)})` : ""}.` }, needsHuman: true },
          "Aidan couldn't tell which skill to use, so a person takes it.");
      }
      if (d.action === "generate" && ac.writeReadsConsole(d.instruction) && await readTheConsole()) return readOnlyReply(base);
      const { inputs, skipped } = await readAttachments(job.gmailId, full && full.payload);
      const run = Object.assign(base, { skill: chosen.skill, client: chosen.client, inputs, skipped, consoleData });
      return d.action === "store" ? keepReference(run) : generateAndReply(run);
    } catch (err) {
      // Marked as spam while it worked: nothing was sent, and markSpam has
      // already recorded "no action — spam" on the ticket.
      if (err && err.code === SPAM_STOP) { signals.spam = true; return { ok: true, spam: true }; }
      // Never customer text in the log: the ticket id and the error only.
      logger.error("support: Aidan run failed", { ticketId, error: errText(err) });
      try { return await finish({ aidan: { status: "error", reason: `Aidan couldn't finish: ${errText(err)}` }, needsHuman: true }, "Aidan couldn't finish, so a person takes it."); }
      catch (e) { if (e && e.code === SPAM_STOP) { signals.spam = true; return { ok: true, spam: true }; } throw e; }
    } })();
    // The self-check: only a run that passed every gate, never a spam thread.
    if (signals.gated && !signals.spam) await reflect({ ticketId, ticket, job, signals });
    return result;
  }

  // ── Self-improvement (IJhIIzTxOJyZVCzzYggZ) ──
  // Was the request fully and well met? (ac.assessRun, from what the run
  // recorded and the model's self-check.) If not, file a Backlog ticket on
  // the right project (a gap in one project's data on that project; anything
  // about what Aidan can do on his own home, the console's project) or, when
  // an open ticket already says it (the same gap for the same request, or
  // worded alike), comment on it instead. At most IMPROVEMENTS_PER_DAY new
  // tickets a day. The ticket is linked on the thread's timeline and in
  // `aidan.improvement`. Never fails the run: a failure is logged and noted.
  // File the gap a self-check found: comment on the matching open ticket, or
  // file a new one on the project the run was about (Aidan's home project
  // otherwise), at most IMPROVEMENTS_PER_DAY new tickets a day. Shared by the
  // mailbox (`reflect`) and the console chat (`chat`, source "chat").
  // Returns { rec, event }: the record kept and the line for the timeline.
  async function fileGap(found, { instruction, ticketKey, supportTicketId = "", kind = "", source = "email" }) {
    const at = now();
    // A missing market page is one gap per country, whatever the request.
    const key = ac.improvementKey(found.category, found.keyText || instruction);
    const label = ac.IMPROVEMENT_LABELS[found.category] || found.category;
    const projects = await improvements.projects();
    const home = ac.homeProject(projects);
    const target = (found.projectId && projects.find((p) => p.id === found.projectId && !p.archived)) || home;
    const title = ac.improvementTitle(found);
    const keyed = await improvements.byKey(key);
    const open = target ? await improvements.openTickets(target.id) : [];
    const match = ac.matchImprovement({ key, category: found.category, gap: found.gap, title }, keyed, open);
    let rec;
    let event;
    if (match) {
      const c = await improvements.comment(match.id, ac.improvementComment({ category: found.category, gap: found.gap, instruction, ticketKey, at, source }));
      rec = { action: "commented", itemId: match.id, title: match.title, projectId: match.projectId || (target && target.id) || "", link: c.board || "" };
      event = `Aidan's self-check: this request wasn't fully met (${label}: ${found.gap}). An open Backlog ticket already covers it, so Aidan commented on "${match.title}" instead of filing a duplicate: ${rec.link}`;
    } else if (!target) {
      rec = { action: "not-filed", reason: "no project to file it on" };
      event = `Aidan's self-check: this request wasn't fully met (${label}: ${found.gap}), but there is no project to file a ticket on.`;
    } else if (await improvements.filedOn(at.toISOString().slice(0, 10)) >= ac.IMPROVEMENTS_PER_DAY) {
      rec = { action: "not-filed", reason: `already ${ac.IMPROVEMENTS_PER_DAY} tickets filed today` };
      event = `Aidan's self-check: this request wasn't fully met (${label}: ${found.gap}). No ticket was filed: Aidan has already filed ${ac.IMPROVEMENTS_PER_DAY} today.`;
    } else {
      const filed = await improvements.file({ projectId: target.id, title,
        desc: ac.improvementDesc({ category: found.category, gap: found.gap, suggestion: found.suggestion, instruction, ticketKey, kind, at, source }),
        improvement: Object.assign({ key, day: at.toISOString().slice(0, 10), category: found.category, gap: found.gap, suggestion: found.suggestion, supportTicketId, supportTicketKey: ticketKey, kind }, source === "chat" ? { source: "chat" } : {}) });
      if (!filed || !filed.ok) {
        rec = { action: "not-filed", reason: core.clip(String((filed && filed.error) || "the ticket couldn't be filed"), 200) };
        event = `Aidan's self-check: this request wasn't fully met (${label}: ${found.gap}). The ticket couldn't be filed: ${rec.reason}`;
      } else {
        rec = { action: "filed", itemId: filed.itemId, title: filed.title, projectId: filed.projectId, link: filed.board || "" };
        event = `Aidan's self-check: this request wasn't fully met (${label}: ${found.gap}). Aidan filed a Backlog ticket on ${target.name}: "${filed.title}" ${rec.link}`;
      }
    }
    return { rec: Object.assign({ category: found.category, gap: found.gap, suggestion: found.suggestion, at }, rec), event };
  }
  async function reflect({ ticketId, ticket, job, signals }) {
    if (!improvements) return null;
    let found = null;
    try {
      found = ac.assessRun(signals);
      if (!found) return null;
      const instruction = signals.instruction || job.instruction || "";
      const ticketKey = ticket.key || ticketId;
      const { rec: record, event } = await fileGap(found, { instruction, ticketKey, supportTicketId: ticketId, kind: signals.kind || job.kind || "" });
      const ref = tickets().doc(ticketId);
      const cur = data(await ref.get());
      if (cur && cur.aidan && !cur.aidan.spam) await ref.set({ aidan: Object.assign({}, cur.aidan, { improvement: record }) }, { merge: true });
      await logEvent(ticketId, "aidan", event);
      return record;
    } catch (err) {
      logger.error("support: Aidan self-check failed", { ticketId, error: errText(err) });
      try { await logEvent(ticketId, "aidan", `Aidan's self-check couldn't file its ticket: ${errText(err)}`); } catch (_) { /* the run is already filed */ }
      return null;
    }
  }

  // The job passed every gate: aidan.gatedAt on the job and on the ticket,
  // only while this same run is still working on it (a spam mark or a newer
  // job is never written over).
  async function markGated(ref, job) {
    const gatedAt = now();
    job.gatedAt = gatedAt;
    await db.runTransaction(async (tx) => {
      const t = data(await tx.get(ref));
      if (!t || !t.aidan || t.aidan.status !== "working" || t.aidan.gmailId !== job.gmailId || isSpam(t)) return;
      tx.update(ref, { aidan: Object.assign({}, t.aidan, { gatedAt }) });
    });
  }

  // A run still "working" STALE_MS after it started was cut off (the function
  // ran out of time or the instance stopped): a person takes it. The run can't
  // be resumed, and it can't send twice: the job left the queue when it was claimed.
  async function sweepStale() {
    const snap = await tickets().where("aidan.status", "==", "working").limit(20).get();
    const ids = [];
    snap.forEach((d) => ids.push(d.id));
    let moved = 0;
    for (const id of ids) {
      const ref = tickets().doc(id);
      let cut = null;
      const done = await db.runTransaction(async (tx) => {
        const t = data(await tx.get(ref));
        if (!t || !t.aidan || t.aidan.status !== "working" || now().getTime() - tsMs(t.aidan.startedAt) < STALE_MS) return false;
        cut = t;
        // A cut-off run on a spam thread is no action, not work for a person.
        if (isSpam(t)) { tx.update(ref, { aidanPending: false, aidan: spamState(t.aidan), updatedAt: now() }); return "spam"; }
        tx.set(ref, { needsHuman: true, updatedAt: now(), aidan: Object.assign({}, t.aidan, { status: "needs-person", finishedAt: now(),
          reason: "Aidan's run stopped before it finished (it was still working after 15 minutes). Check the thread for a reply from Aidan before answering." }) }, { merge: true });
        return true;
      });
      if (done === "spam") await logEvent(id, "aidan", "Aidan: no action — spam. The request waiting on this thread was cancelled.");
      else if (done) {
        moved += 1;
        await logEvent(id, "aidan", "Aidan's run stopped before it finished, so a person takes it.");
        // The time budget is a gap too: the self-check files or comments.
        // Only a run that had passed every gate (aidan.gatedAt, markGated):
        // one cut off before the sender checks is never filed.
        if (cut.aidan.gatedAt) await reflect({ ticketId: id, ticket: cut, job: cut.aidan, signals: { gated: true, stale: true, instruction: cut.aidan.instruction || "", kind: cut.aidan.kind || "" } });
      }
    }
    return moved;
  }

  // Work the queue: at most `max` runs, and only while the sync is young
  // enough for a whole run to finish inside the function's budget.
  async function runQueued(max = 1, { startedAt = null } = {}) {
    try { await sweepStale(); } catch (err) { logger.error("support: Aidan sweep failed", { error: errText(err) }); }
    if (!max) return 0;
    if (startedAt && now().getTime() - tsMs(startedAt) > LATEST_START_MS) return 0;
    const snap = await tickets().where("aidanPending", "==", true).limit(max).get();
    const ids = [];
    snap.forEach((d) => ids.push(d.id));
    let ran = 0;
    for (const id of ids) { const r = await runOne(id); if (!(r && r.ok === false && r.error === "nothing queued")) ran += 1; }
    return ran;
  }

  // ── Aidan in the console's chat panel (yvnAPPAW9ROLrNwJceyn) ──
  // One turn: the member's message answered from the console, exactly as an
  // email answer reads it (readConsole: PH Agent Context first, then ONE Code
  // Mode run), but with `reader`, the CALLER's own read-only reader
  // (mcp-server.js → consoleReader(names, session)), so a viewer's chat reads
  // only what a viewer's agent can. Nothing is sent and nothing on the console
  // is changed: a request to change it gets the read-only reply (no model is
  // asked). The answer is put in Aidan's voice (inVoice) and self-checked; a
  // gap is filed or commented on a Backlog ticket like the mailbox's
  // (fileGap, source "chat"). Never throws: functions/aidan-chat.js stores
  // and audits what this returns.
  // Returns { outcome ("answered" | "read-only" | "cannot-answer" | "unavailable" | "error"),
  //   reply, readOnly, reads, tools, codeMode, topics, voice, improvement, durationMs }.
  let chatLibrary = null;   // { at, rows }: the skills library, read at most every five minutes
  async function chatSkills() {
    if (chatLibrary && now().getTime() - chatLibrary.at < 5 * 60 * 1000) return chatLibrary.rows;
    const rows = (await rowsOf("skills")).map((s) => ({ id: s.id, slug: s.slug || "", name: s.name || "", summary: s.summary || "", files: s.files || [] }));
    chatLibrary = { at: now().getTime(), rows };
    return rows;
  }
  async function chat({ instruction, reader = null, member = {}, history = [], origin = "" }) {
    const started = now().getTime();
    const text = chatCore.cleanText(instruction);
    const done = (o) => Object.assign({ readOnly: false, reads: 0, tools: [], codeMode: null, topics: [], voice: null, improvement: null }, o, { durationMs: now().getTime() - started });
    if (!text) return done({ outcome: "error", reply: chatCore.ERROR_REPLY });
    if (chatCore.changeRequest(text)) return done({ outcome: "read-only", readOnly: true, reply: chatCore.readOnlyReply(text) });
    const key = String(apiKey() || "");
    if (!runImpl && (!key || key === "unset")) return done({ outcome: "unavailable", reply: chatCore.UNAVAILABLE_REPLY });
    const signals = { instruction: text, kind: "chat", gated: true };
    const conversation = chatCore.transcript(history);
    let c = null;
    try {
      c = await readConsole({ instruction: text, email: conversation, reader, channel: "chat", planTimeoutMs: chatCore.CHAT_PLAN_TIMEOUT_MS });
    } catch (err) { logger.error("aidan chat: console read failed", { error: errText(err) }); }
    if (c) Object.assign(signals, { codeMode: c.codeMode, failedReads: c.failedReads, consoleCut: c.cut, scopedProjectIds: c.scopedProjectIds, context: c.context });
    const facts = c ? { reads: c.results.filter((r) => r.ok).length, tools: c.tools, codeMode: c.codeMode, topics: c.topics || [] } : {};
    if (c && c.changeRequested) return done(Object.assign({ outcome: "read-only", readOnly: true, reply: chatCore.readOnlyReply(text) }, facts));
    let answer;
    try {
      const system = chatCore.chatAnswerSystem(origin);
      const blocks = [{ type: "text", text: `Member: ${core.clip(String(member.name || ""), 80)} (${String(member.role || "viewer")})\nInstruction to Aidan: ${text}` }];
      if (conversation) blocks.push({ type: "text", text: `<conversation>\n${conversation}\n</conversation>` });
      if (c && c.used) blocks.push({ type: "text", text: c.text });
      const raw = runImpl && runImpl.answer ? await runImpl.answer({ instruction: text, system, content: blocks, console: c, chat: true })
        : await model({ system, schema: chatCore.CHAT_ANSWER_SCHEMA, effort: "medium", maxTokens: 6000, content: blocks, timeout: chatCore.CHAT_ANSWER_TIMEOUT_MS });
      answer = chatCore.cleanChatAnswer(raw);
    } catch (err) {
      logger.error("aidan chat: the answer failed", { error: errText(err) });
      answer = { canAnswer: false, replyText: "", reason: "", selfCheck: null, failed: errText(err) };
    }
    signals.selfCheck = answer.selfCheck;
    let reply;
    let outcome;
    let voice = null;
    if (answer.failed) { outcome = "error"; reply = chatCore.ERROR_REPLY; }
    else if (!answer.canAnswer) { outcome = "cannot-answer"; reply = chatCore.cannotAnswerReply(answer.reason); }
    else {
      outcome = "answered";
      const consoleText = c ? c.text : "";
      reply = chatCore.stripIdsOutsideLinks(chatCore.safeLinks(answer.replyText, consoleText, origin), c ? c.names : []);
      let voiceSkill = null;
      try { voiceSkill = await voiceSkillFrom(await chatSkills()); } catch (err) { logger.warn("aidan chat: the voice skill couldn't be read", { error: errText(err) }); }
      const voiced = await inVoice({ ticketId: "chat", kind: "answer", body: reply, instruction: text, msg: { fromName: member.name || "" }, ticket: null, voiceSkill });
      reply = voiced.text || reply;
      voice = voiced.voice;
    }
    // The self-check, as the mailbox's: a gap is filed on the project the turn
    // was about, or commented on the open ticket that already covers it.
    let improvement = null;
    if (improvements) {
      try {
        const final = outcome === "answered" ? { status: "replied" } : { status: outcome === "error" ? "error" : "needs-person", reason: answer.failed ? `The answer failed: ${answer.failed}` : answer.reason || "Aidan couldn't answer this from the console." };
        const found = ac.assessRun(Object.assign({}, signals, { final }));
        if (found) improvement = (await fileGap(found, { instruction: text, ticketKey: "console chat", kind: "chat", source: "chat" })).rec;
      } catch (err) { logger.error("aidan chat: self-check failed", { error: errText(err) }); }
    }
    return done(Object.assign({ outcome, reply, voice, improvement }, facts));
  }

  return { readConfig, status, saveConfig, afterIngest, runOne, runQueued, sweepStale, markSpam, markNotSpam, dismiss, factsOf: ac.mailFacts, chat };
}

module.exports = { createAidan, CONFIG_DOC, REFERENCES, LATEST_START_MS, SELECT_TIMEOUT_MS, DOC_TIMEOUT_MS, ANSWER_TIMEOUT_MS, CONSOLE_PLAN_TIMEOUT_MS, COLLATERAL_RENDER_TIMEOUT_MS, VOICE_TIMEOUT_MS, STALE_MS };
