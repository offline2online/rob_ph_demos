"use strict";
// Aidan, the agent mailbox (aidan@), as part of the Support Inbox sync.
//
//   • After each email is filed (support-mail.js → ingest), `afterIngest`
//     decides with aidan-core.js whether it starts a run. A run is queued on
//     the ticket (`aidanPending`, `aidan.status: "queued"`) instead of being
//     drafted a Help Centre reply. A tag that is refused is recorded with its
//     reason; an email that doesn't tag Aidan is left exactly as it was.
//   • The scheduled sync then works the queue (`runQueued`, one run per sync:
//     a run reads attachments and writes a whole document, which takes
//     minutes). A run checks the sender again (the configuration may have
//     changed, and the receiving server must have verified the From address),
//     chooses the skill, reads the email and its attachments, and either
//       generate: writes the documentation with the skill and replies to
//                 everyone on the email with it attached, from the mailbox; or
//       store:    keeps the email and its attachments as reference material
//                 for the skill (skillReferences), used by later runs.
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
const MODEL_TIMEOUT_MS = 300000;

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
  // `m` is the parsed message just filed. Returns the decision's action.
  async function afterIngest(m, config) {
    if (!m || m.direction !== "in" || !m.threadId) return "none";
    const ref = tickets().doc(m.threadId);
    const ticket = data(await ref.get());
    if (!ticket || !(ticket.inboxes || []).includes(ac.AIDAN_INBOX)) return "none";
    const d = ac.decideAidan({ inboxes: ticket.inboxes, message: m, config, runs: ticket.aidanRuns || 0 });
    if (d.action === "none") {
      // Only a tag is worth a line on the ticket; plain mail in the Aidan tab is left as it is.
      if (d.tagged) await ref.set({ aidan: { status: "ignored", gmailId: m.gmailId, reason: d.reason, at: now() }, updatedAt: now() }, { merge: true });
      return "none";
    }
    await ref.set({
      aidanPending: true, aidanRuns: (ticket.aidanRuns || 0) + 1,
      // Aidan answers this, not the Help Centre drafting.
      triagePending: false, aiDraft: null, needsHuman: false,
      aidan: { status: "queued", kind: d.action, gmailId: m.gmailId, instruction: d.instruction, at: now() },
      updatedAt: now(),
    }, { merge: true });
    await logEvent(m.threadId, "aidan", d.action === "store" ? "Aidan was asked to keep this email for a skill." : "Aidan was asked to write documentation.");
    return d.action;
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
  const model = (opts) => callJson(Object.assign({ apiKey: String(apiKey() || ""), workspaceId: workspaceId(), Anthropic, timeout: MODEL_TIMEOUT_MS }, opts));
  async function chooseSkill({ instruction, email, skills }) {
    const named = ac.skillNamedIn(instruction, skills);
    if (named) return { skill: named, client: "", reason: "named in the instruction" };
    if (!skills.length) return { skill: null, reason: "there are no skills in the library" };
    const raw = runImpl && runImpl.select ? await runImpl.select({ instruction, email, skills })
      : await model({ system: ac.SELECT_SYSTEM, schema: ac.SELECT_SCHEMA, effort: "medium", maxTokens: 2000,
        content: `<skills>\n${skills.map(ac.skillIndexLine).join("\n")}\n</skills>\n\n<instruction>\n${instruction}\n</instruction>\n\n<email>\n${core.clip(email, 20000)}\n</email>` });
    const sel = ac.cleanSelection(raw, skills);
    return { skill: skills.find((s) => s.id === sel.skillId) || null, client: sel.client, reason: sel.reason };
  }
  async function writeDocument({ skill, client, instruction, header, email, inputs, skipped }) {
    const refs = await referencesFor(skill.id);
    const system = `${ac.DOC_SYSTEM}\n\n<skill name="${String(skill.name || skill.slug || "").replace(/"/g, "")}">\n${await skillFiles(skill)}\n</skill>${refs.text ? `\n\n<reference_material>\n${refs.text}\n</reference_material>` : ""}`;
    const content = contentBlocks({ header: `${header}\nInstruction to Aidan: ${instruction}${client ? `\nFor: ${client}` : ""}`, email, inputs, skipped });
    const raw = runImpl && runImpl.write ? await runImpl.write({ skill, client, instruction, system, content, references: refs.count })
      : await model({ system, schema: ac.DOC_SCHEMA, effort: "high", maxTokens: 32000, content });
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

  async function runOne(ticketId) {
    const ref = tickets().doc(ticketId);
    const ticket = data(await ref.get());
    if (!ticket || !ticket.aidanPending || !ticket.aidan) return { ok: false, error: "nothing queued" };
    const job = ticket.aidan;
    await ref.set({ aidanPending: false, aidan: Object.assign({}, job, { status: "working", startedAt: now() }) }, { merge: true });
    const finish = async (fields, event) => {
      await ref.set(Object.assign({ updatedAt: now() }, fields, { aidan: Object.assign({}, job, fields.aidan || {}, { finishedAt: now() }) }), { merge: true });
      if (event) await logEvent(ticketId, "aidan", event);
    };
    try {
      const config = await readConfig();
      const msgSnap = await ref.collection("messages").doc(job.gmailId).get();
      const msg = data(msgSnap);
      if (!msg) return finish({ aidan: { status: "error", reason: "The email Aidan was asked about is no longer on the ticket." }, needsHuman: true });
      // The configuration may have changed since the email was filed: decide again.
      const d = ac.decideAidan({ inboxes: ticket.inboxes, message: msg, config, runs: 0 });
      if (d.action === "none") return finish({ aidan: { status: "ignored", reason: d.reason } }, `Aidan did nothing: ${d.reason}`);
      const full = await gmail(`messages/${encodeURIComponent(job.gmailId)}?format=full`);
      const headers = (full && full.payload && full.payload.headers) || [];
      if (config.requireSenderAuth) {
        const auth = ac.senderAuthenticated(headers, msg.from);
        if (!auth.ok) return finish({ aidan: { status: "ignored", reason: "The sender's address couldn't be verified (no SPF, DKIM or DMARC pass), so Aidan did nothing." } }, "Aidan did nothing: the sender's address couldn't be verified.");
      }
      const key = String(apiKey() || "");
      if (!runImpl && (!key || key === "unset")) return finish({ aidan: { status: "needs-person", reason: "No model is configured (ANTHROPIC_API_KEY)." }, needsHuman: true });
      const skills = (await rowsOf("skills")).map((s) => ({ id: s.id, slug: s.slug || "", name: s.name || "", summary: s.summary || "", files: s.files || [] }));
      const email = core.stripQuoted(msg.text || "");
      const chosen = await chooseSkill({ instruction: d.instruction, email, skills });
      if (!chosen.skill) {
        return finish({ aidan: { status: "needs-person", kind: d.action, reason: `No skill matches the instruction${chosen.reason ? ` (${core.clip(chosen.reason, 200)})` : ""}.` }, needsHuman: true },
          "Aidan couldn't tell which skill to use, so a person takes it.");
      }
      const skill = chosen.skill;
      const { inputs, skipped } = await readAttachments(job.gmailId, full && full.payload);
      if (d.action === "store") {
        const stored = await storeReference({ skill, ticketId, msg: Object.assign({ gmailId: job.gmailId }, msg), inputs, skipped, by: "aidan" });
        return finish({
          aidan: { status: "ingested", kind: "store", skillId: skill.id, skillName: skill.name || skill.slug, referenceId: stored.id, files: stored.files.map((f) => ({ name: f.name, kind: f.kind })) },
          status: "resolved", resolvedBy: "aidan", resolvedAt: now(), needsHuman: false,
        }, `Aidan kept this email${stored.files.length ? ` and ${stored.files.length} attachment${stored.files.length === 1 ? "" : "s"}` : ""} as reference material for the ${skill.name || skill.slug} skill.`);
      }
      const settings = await readSettings();
      if (!settings.connectedEmail) throw new Error("The mailbox isn't connected.");
      const header = `From: ${msg.fromName || ""}\nSubject: ${msg.subject || ticket.subject || ""}`;
      const doc = await writeDocument({ skill, client: chosen.client, instruction: d.instruction, header, email, inputs, skipped });
      const parsedHeaders = core.headerMap(headers);
      const recipients = ac.replyAllRecipients({ from: msg.from, replyTo: core.parseAddress(parsedHeaders["reply-to"]).email, to: msg.to || [], cc: msg.cc || [] }, { mailbox: settings.connectedEmail });
      if (!recipients.to.length) throw new Error("There is no one to reply to.");
      const text = ac.composeAidanReply({ firstName: ac.greetingName(msg.fromName), replyText: doc.replyText, fromName: config.fromName });
      const raw = ac.buildMultipartRaw({
        fromName: config.fromName, fromEmail: settings.connectedEmail, to: recipients.to, cc: recipients.cc, subject: msg.subject || ticket.subject, text,
        inReplyTo: msg.messageId, references: msg.references, attachments: [{ name: doc.fileName, type: "text/markdown; charset=UTF-8", content: doc.documentMd }],
      });
      const sent = await gmail("messages/send", { method: "POST", body: { raw, threadId: ticket.threadId || ticketId } });
      const sentId = String((sent && sent.id) || `aidan-${now().getTime()}`);
      const size = Buffer.byteLength(doc.documentMd, "utf8");
      await ref.collection("messages").doc(sentId).set({
        direction: "out", from: settings.connectedEmail, fromName: config.fromName, to: recipients.to, cc: recipients.cc, subject: core.replySubject(msg.subject || ticket.subject),
        text, snippet: core.clip(text.replace(/\s+/g, " "), 240), at: now(), gmailId: sentId, auto: false, sentBy: "aidan", source: "aidan",
        attachments: [{ name: doc.fileName, type: "text/markdown", size }], skillId: skill.id, skillName: skill.name || skill.slug,
      });
      return finish({
        aidan: { status: "replied", kind: "generate", skillId: skill.id, skillName: skill.name || skill.slug, client: chosen.client, document: { name: doc.fileName, title: doc.title, size }, recipients: recipients.to.length + recipients.cc.length, sentId },
        status: "resolved", resolvedBy: "aidan", resolvedAt: now(), needsHuman: false, firstResponseAt: ticket.firstResponseAt || now(), lastReplyAt: now(), lastMessageAt: now(),
        messageCount: (ticket.messageCount || 0) + 1, snippet: core.clip(text.replace(/\s+/g, " "), 240),
      }, `Aidan wrote ${doc.fileName} with the ${skill.name || skill.slug} skill and replied to ${recipients.to.length + recipients.cc.length} ${recipients.to.length + recipients.cc.length === 1 ? "person" : "people"}.`);
    } catch (err) {
      // Never customer text in the log: the ticket id and the error only.
      logger.error("support: Aidan run failed", { ticketId, error: errText(err) });
      return finish({ aidan: { status: "error", reason: `Aidan couldn't finish: ${errText(err)}` }, needsHuman: true }, "Aidan couldn't finish, so a person takes it.");
    }
  }

  // Work the queue: at most `max` runs.
  async function runQueued(max = 1) {
    if (!max) return 0;
    const snap = await tickets().where("aidanPending", "==", true).limit(max).get();
    const ids = [];
    snap.forEach((d) => ids.push(d.id));
    for (const id of ids) await runOne(id);
    return ids.length;
  }

  return { readConfig, status, saveConfig, afterIngest, runOne, runQueued };
}

module.exports = { createAidan, CONFIG_DOC, REFERENCES };
