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
//     A run still "working" after 15 minutes was cut off: the next sync moves
//     it to a person (`sweepStale`).
//   • The allowed senders are configuration: supportSecrets/aidan, closed to
//     every client by firestore.rules, written only by an admin through
//     POST /supportMail/v1/aidan, never returned unmasked.
//
// Pure wiring: support-mail.js passes in Firestore, its Gmail caller and the
// model, so test/support-mail.test.js drives a whole run with stubs.

const crypto = require("crypto");
const core = require("./support-core");
const ac = require("./aidan-core");

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
// send; an answer gets ANSWER_TIMEOUT_MS, so 2 + 1 + 2 at most). A run that is cut off anyway is moved to a person by the next sync
// (sweepStale) once it has been "working" for STALE_MS.
const LATEST_START_MS = 120000;
const SELECT_TIMEOUT_MS = 60000;
const DOC_TIMEOUT_MS = 240000;
const ANSWER_TIMEOUT_MS = 120000;
const ANSWER_EMAIL_MAX = 60000;          // characters of the email (with the thread quoted in it) an answer reads
const STALE_MS = 15 * 60 * 1000;
const SEEN_KEEP = 50;                    // gmailIds remembered per ticket (aidanSeen), so a message is decided once
const ACTIVE = ["queued", "working"];
const tsMs = (v) => (!v ? 0 : typeof v.toMillis === "function" ? v.toMillis() : v instanceof Date ? v.getTime() : Number(new Date(v)) || 0);

function createAidan({ db, tickets, secretsRef, gmail, readSettings, logEvent, now, logger = console, callJson, apiKey = () => "", workspaceId = () => "", Anthropic = null, run: runImpl = null, bucket = null }) {
  const data = (snap) => (snap && snap.exists ? snap.data() || {} : null);
  const configRef = () => secretsRef(CONFIG_DOC);
  const errText = (err) => core.clip(String(err && err.message ? err.message : err), 300);

  async function readConfig() { return ac.normaliseConfig(data(await configRef().get())); }
  async function status({ admin = false } = {}) { return ac.publicConfig(data(await configRef().get()), { admin }); }
  // Admin: replace the allowed senders (only when a list is given) and switch Aidan on or off.
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
  async function untrustedOnThread(ticketId, exclude, config) {
    const snap = await tickets().doc(ticketId).collection("messages").get();
    const rows = [];
    snap.forEach((d) => rows.push(Object.assign({ id: d.id }, d.data() || {})));
    return ac.untrustedThreadText(rows, { allowed: config.allowedSenders, exclude });
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
        aidan: { status: "queued", kind: d.action, gmailId: m.gmailId, instruction: d.instruction, at: now() },
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
  async function writeDocument({ skill, client, instruction, header, email, inputs, skipped }) {
    const refs = await referencesFor(skill.id);
    const system = `${ac.DOC_SYSTEM}\n\n<skill name="${String(skill.name || skill.slug || "").replace(/"/g, "")}">\n${await skillFiles(skill)}\n</skill>${refs.text ? `\n\n<reference_material>\n${refs.text}\n</reference_material>` : ""}`;
    const content = contentBlocks({ header: `${header}\nInstruction to Aidan: ${instruction}${client ? `\nFor: ${client}` : ""}`, email, inputs, skipped });
    const raw = runImpl && runImpl.write ? await runImpl.write({ skill, client, instruction, system, content, references: refs.count })
      : await model({ system, schema: ac.DOC_SCHEMA, effort: "high", maxTokens: 32000, content, timeout: DOC_TIMEOUT_MS });
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

  // A "generate" run: write the document with the skill and reply to everyone
  // on the email (the verified From address plus the original To and Cc; never
  // Reply-To, never our own addresses), on the thread, with it attached.
  async function generateAndReply({ ticketId, ticket, job, msg, config, skill, client, instruction, email, inputs, skipped, finish }) {
    const settings = await readSettings();
    if (!settings.connectedEmail) throw new Error("The mailbox isn't connected.");
    const header = `From: ${msg.fromName || ""}\nSubject: ${msg.subject || ticket.subject || ""}`;
    const doc = await writeDocument({ skill, client, instruction, header, email, inputs, skipped });
    const recipients = ac.replyAllRecipients({ from: msg.from, to: msg.to || [], cc: msg.cc || [] }, { mailbox: settings.connectedEmail });
    if (!recipients.to.length) throw new Error("There is no one to reply to.");
    const text = ac.composeAidanReply({ firstName: ac.greetingName(msg.fromName), replyText: doc.replyText, fromName: config.fromName });
    const raw = ac.buildMultipartRaw({
      fromName: config.fromName, fromEmail: settings.connectedEmail, to: recipients.to, cc: recipients.cc, subject: msg.subject || ticket.subject, text,
      inReplyTo: msg.messageId, references: msg.references, attachments: [{ name: doc.fileName, type: "text/markdown; charset=UTF-8", content: doc.documentMd }],
    });
    const sent = await gmail("messages/send", { method: "POST", body: { raw, threadId: ticket.threadId || ticketId } });
    const sentId = String((sent && sent.id) || `aidan-${now().getTime()}`);
    const size = Buffer.byteLength(doc.documentMd, "utf8");
    await tickets().doc(ticketId).collection("messages").doc(sentId).set({
      direction: "out", from: settings.connectedEmail, fromName: config.fromName, to: recipients.to, cc: recipients.cc, subject: core.replySubject(msg.subject || ticket.subject),
      text, snippet: core.clip(text.replace(/\s+/g, " "), 240), at: now(), gmailId: sentId, auto: false, sentBy: "aidan", source: "aidan", kind: "generate",
      attachments: [{ name: doc.fileName, type: "text/markdown", size }], skillId: skill.id, skillName: skill.name || skill.slug,
    });
    const n = recipients.to.length + recipients.cc.length;
    return finish({
      aidan: { status: "replied", kind: "generate", skillId: skill.id, skillName: skill.name || skill.slug, client, document: { name: doc.fileName, title: doc.title, size }, recipients: n, sentId },
      status: "resolved", resolvedBy: "aidan", resolvedAt: now(), needsHuman: false, firstResponseAt: ticket.firstResponseAt || now(), lastReplyAt: now(), lastMessageAt: now(),
      messageCount: (ticket.messageCount || 0) + 1, snippet: core.clip(text.replace(/\s+/g, " "), 240),
    }, `Aidan wrote ${doc.fileName} with the ${skill.name || skill.slug} skill and replied to ${n} ${n === 1 ? "person" : "people"}.`);
  }

  // An "answer" run: reply to everyone on the email (the same recipients as a
  // write) in the email's own body, with no attachment. The model reads the
  // whole email, with the thread quoted in it, as untrusted content; the only
  // instruction is the one decideAidan accepted. `skill` is one the
  // instruction names, or null. When the model says it can't answer from what
  // it has (the request needs a document or facts that aren't there), nothing
  // is sent and a person takes it; `noSkill` is why a write got here.
  async function answerInline({ ticketId, ticket, job, msg, config, skill = null, instruction, inputs, skipped, finish, noSkill = null }) {
    const settings = await readSettings();
    if (!settings.connectedEmail) throw new Error("The mailbox isn't connected.");
    const recipients = ac.replyAllRecipients({ from: msg.from, to: msg.to || [], cc: msg.cc || [] }, { mailbox: settings.connectedEmail });
    if (!recipients.to.length) throw new Error("There is no one to reply to.");
    const n = recipients.to.length + recipients.cc.length;
    const firstName = ac.greetingName(msg.fromName);
    const header = `From: ${msg.fromName || ""}\nSubject: ${msg.subject || ticket.subject || ""}\nInstruction to Aidan: ${instruction}${firstName ? `\nThe sender's first name: ${firstName}` : ""}\nPeople the reply goes to: ${n}`;
    const refs = skill ? await referencesFor(skill.id) : { text: "", count: 0 };
    const system = `${ac.ANSWER_SYSTEM}${skill ? `\n\n<skill name="${String(skill.name || skill.slug || "").replace(/"/g, "")}">\n${await skillFiles(skill)}\n</skill>` : ""}${refs.text ? `\n\n<reference_material>\n${refs.text}\n</reference_material>` : ""}`;
    const content = contentBlocks({ header, email: core.clip(String(msg.text || ""), ANSWER_EMAIL_MAX), inputs, skipped });
    const raw = runImpl && runImpl.answer ? await runImpl.answer({ skill, instruction, system, content, references: refs.count })
      : await model({ system, schema: ac.ANSWER_SCHEMA, effort: "medium", maxTokens: 4000, content, timeout: ANSWER_TIMEOUT_MS });
    const answer = ac.cleanAnswer(raw);
    if (!answer.canAnswer) {
      const why = answer.reason ? ` (${answer.reason})` : "";
      const reason = noSkill !== null ? `No skill matches the instruction${noSkill ? ` (${core.clip(noSkill, 200)})` : ""}, and it couldn't be answered from the email alone${why}.`
        : `Aidan couldn't answer this from the email alone${why}.`;
      return finish({ aidan: { status: "needs-person", reason }, needsHuman: true }, noSkill !== null ? "Aidan couldn't tell which skill to use, so a person takes it." : "Aidan couldn't answer this from the email, so a person takes it.");
    }
    const text = ac.composeAidanAnswer({ replyText: answer.replyText, fromName: config.fromName });
    const raw5322 = ac.buildMultipartRaw({
      fromName: config.fromName, fromEmail: settings.connectedEmail, to: recipients.to, cc: recipients.cc, subject: msg.subject || ticket.subject, text,
      inReplyTo: msg.messageId, references: msg.references, attachments: [],
    });
    const sent = await gmail("messages/send", { method: "POST", body: { raw: raw5322, threadId: ticket.threadId || ticketId } });
    const sentId = String((sent && sent.id) || `aidan-${now().getTime()}`);
    const named = skill ? { skillId: skill.id, skillName: skill.name || skill.slug } : {};
    await tickets().doc(ticketId).collection("messages").doc(sentId).set(Object.assign({
      direction: "out", from: settings.connectedEmail, fromName: config.fromName, to: recipients.to, cc: recipients.cc, subject: core.replySubject(msg.subject || ticket.subject),
      text, snippet: core.clip(text.replace(/\s+/g, " "), 240), at: now(), gmailId: sentId, auto: false, sentBy: "aidan", source: "aidan", kind: "answer", attachments: [],
    }, named));
    return finish({
      aidan: Object.assign({ status: "replied", kind: "answer", recipients: n, sentId }, named),
      status: "resolved", resolvedBy: "aidan", resolvedAt: now(), needsHuman: false, firstResponseAt: ticket.firstResponseAt || now(), lastReplyAt: now(), lastMessageAt: now(),
      messageCount: (ticket.messageCount || 0) + 1, snippet: core.clip(text.replace(/\s+/g, " "), 240),
    }, `Aidan answered on the email and replied to ${n} ${n === 1 ? "person" : "people"}.`);
  }

  async function runOne(ticketId) {
    const ref = tickets().doc(ticketId);
    // The claim is a transaction: of two instances working the queue at once,
    // only one moves the job from queued to working, so only one runs (and sends).
    const claim = await db.runTransaction(async (tx) => {
      const t = data(await tx.get(ref));
      if (!t || !t.aidanPending || !t.aidan || t.aidan.status !== "queued") return null;
      const job = Object.assign({}, t.aidan, { status: "working", startedAt: now() });
      tx.set(ref, { aidanPending: false, aidan: job }, { merge: true });
      return { ticket: t, job };
    });
    if (!claim) return { ok: false, error: "nothing queued" };
    const { ticket, job } = claim;
    const finish = async (fields, event) => {
      await ref.set(Object.assign({ updatedAt: now() }, fields, { aidan: Object.assign({}, job, fields.aidan || {}, { finishedAt: now() }) }), { merge: true });
      if (event) await logEvent(ticketId, "aidan", event);
    };
    try {
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
      const untrusted = await untrustedOnThread(ticketId, job.gmailId, config);
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
      const key = String(apiKey() || "");
      if (!runImpl && (!key || key === "unset")) return finish({ aidan: { status: "needs-person", reason: "No model is configured (ANTHROPIC_API_KEY)." }, needsHuman: true });
      const skills = (await rowsOf("skills")).map((s) => ({ id: s.id, slug: s.slug || "", name: s.name || "", summary: s.summary || "", files: s.files || [] }));
      const email = core.stripQuoted(msg.text || "");
      const base = { ticketId, ticket, job, msg, config, instruction: d.instruction, email, finish };
      // An answer needs no skill: one named in the instruction is read, and
      // the model is never asked to choose one.
      if (d.action === "answer") {
        return answerInline(Object.assign(base, await readAttachments(job.gmailId, full && full.payload), { skill: ac.skillNamedIn(d.instruction, skills) }));
      }
      const chosen = await chooseSkill({ instruction: d.instruction, email, skills });
      if (!chosen.skill) {
        // A request to write that no skill matches may still be something the
        // email itself answers ("summarise this thread"): try it as an answer.
        // A request to keep material has nowhere to go without its skill.
        if (d.action === "generate") {
          return answerInline(Object.assign(base, await readAttachments(job.gmailId, full && full.payload), { noSkill: chosen.reason || "" }));
        }
        return finish({ aidan: { status: "needs-person", kind: d.action, reason: `No skill matches the instruction${chosen.reason ? ` (${core.clip(chosen.reason, 200)})` : ""}.` }, needsHuman: true },
          "Aidan couldn't tell which skill to use, so a person takes it.");
      }
      const { inputs, skipped } = await readAttachments(job.gmailId, full && full.payload);
      const run = Object.assign(base, { skill: chosen.skill, client: chosen.client, inputs, skipped });
      return d.action === "store" ? keepReference(run) : generateAndReply(run);
    } catch (err) {
      // Never customer text in the log: the ticket id and the error only.
      logger.error("support: Aidan run failed", { ticketId, error: errText(err) });
      return finish({ aidan: { status: "error", reason: `Aidan couldn't finish: ${errText(err)}` }, needsHuman: true }, "Aidan couldn't finish, so a person takes it.");
    }
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
      const done = await db.runTransaction(async (tx) => {
        const t = data(await tx.get(ref));
        if (!t || !t.aidan || t.aidan.status !== "working" || now().getTime() - tsMs(t.aidan.startedAt) < STALE_MS) return false;
        tx.set(ref, { needsHuman: true, updatedAt: now(), aidan: Object.assign({}, t.aidan, { status: "needs-person", finishedAt: now(),
          reason: "Aidan's run stopped before it finished (it was still working after 15 minutes). Check the thread for a reply from Aidan before answering." }) }, { merge: true });
        return true;
      });
      if (done) { moved += 1; await logEvent(id, "aidan", "Aidan's run stopped before it finished, so a person takes it."); }
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

  return { readConfig, status, saveConfig, afterIngest, runOne, runQueued, sweepStale, factsOf: ac.mailFacts };
}

module.exports = { createAidan, CONFIG_DOC, REFERENCES, LATEST_START_MS, SELECT_TIMEOUT_MS, DOC_TIMEOUT_MS, ANSWER_TIMEOUT_MS, STALE_MS };
