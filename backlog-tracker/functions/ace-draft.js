"use strict";
// ── Promote › Leads: Hot Lead → ACE opportunity draft (ticket qLIDYPTSvzKqYLLsI8kC) ──
// When a company lead moves to Hot Lead and its Prospects (TAM) company
// (prospectCompanies/{slugId(name)}) has profile.primaryCloud naming AWS, the
// console asks the Partner Central agent (the AWS-hosted MCP server, through
// partner-central.js's agentMessage: same closed tool list, signing, audit and
// session logging on the lead) to DRAFT the ACE opportunity from:
//   • the lead record (company, website, industry, countries, stores, AWS
//     account id, contacts' names, titles and buying roles; never addresses),
//   • the newest industry one-pager and prospect pack in the company's
//     document library (asked to be attached),
//   • the lead's notes (meeting notes and transcripts, newest 8),
// then to run the co-sell next-step / best-practice recommendations against
// the draft, apply them, aim for an Opportunity Quality Score of 60+, and end
// with "PREDICTED_SCORE: NN" and "RECOMMENDATIONS:" lines (parsed strictly).
//
// Nothing is written to Partner Central without an admin: the agent holds the
// create as a write waiting for approval (Settings → Integrations & MCP → AWS
// Partner Central), and nothing in this module approves anything.
//
// State lives in leadAce/{leadId} (server-only; the lead summary reads it
// through GET /partnerCentral/v1/leads/{id}/ace). It is NOT a field on the
// lead: firestore.rules lists every key a lead may hold, so a server-written
// lead field would make the next editor save of that lead fail. The only lead
// fields written are the documented aceOpportunityId and history.
//
// Stage progression: lead stage → ACE stage (ACE_STAGE_FOR). A later stage
// move of a lead with a draft or opportunity is queued (stageSync "pending");
// a move backwards is flagged and never sent. An admin's "Sync ACE stages"
// sends every queued change in ONE agent message (a bulk opportunity update),
// which again waits for approval.
//
// Routes (answered before partner-central.js's own, wired in index.js):
//   GET  /partnerCentral/v1/leads/{id}/ace          the lead summary's ACE group (editors)
//   POST /partnerCentral/v1/leads/{id}/ace/draft    draft now / draft again (admins)
//   GET  /partnerCentral/v1/ace-sync                queued stage changes (admins)
//   POST /partnerCentral/v1/ace-sync                send them as one agent message (admins)
// Triggers: aceDraftOnLeadWrite (leads/{id}), aceDraftOnSessionWrite
// (partnerCentralAgentSessions/{id}: picks up an approval). Tests: test/ace-draft.test.js.

const { slugId } = require("./prospects-core");
const { normaliseOpportunity } = require("./partner-central");

const COLLECTION = "leadAce";
const COMPANY_COLLECTION = "prospectCompanies";
const SESSIONS = "partnerCentralAgentSessions";
const TARGET_SCORE = 60;
const MESSAGE_MAX = 4000; // partner-central.js AGENT_MESSAGE_MAX
const STALE_DRAFTING_MS = 10 * 60 * 1000;
const STALE_DAYS = 30;
const NOTES_MAX = 8;
const BY = "ACE opportunity draft";
const ACE_STAGE_FOR = { "hot-lead": "Prospect", demo: "Qualified", "post-demo": "Technical Validation", "closed-won": "Committed", "closed-lost": "Closed Lost" };
// Forward order; Launched is never set automatically (a person's call in Partner Central).
const ACE_ORDER = ["Prospect", "Qualified", "Technical Validation", "Business Validation", "Committed", "Launched"];
const STATUSES = ["drafting", "awaiting-approval", "drafted", "rejected", "error", "skipped"];
const LEAD_ID = "[A-Za-z0-9_-]{1,128}";
const ROUTE_VIEW = new RegExp(`^/v1/leads/(${LEAD_ID})/ace$`);
const ROUTE_DRAFT = new RegExp(`^/v1/leads/(${LEAD_ID})/ace/draft$`);
const ROUTE_SYNC = /^\/v1\/ace-sync$/;
// Lines the console's own automations add to a lead's history: not meeting notes.
const SYSTEM_NOTE = /^(Partner Central AI session|AWS funding|POC funding|Enriched by AWS Partner Central|ACE opportunity|ACE stage|Moved from )/i;

const str = (v, max) => String(v == null ? "" : v).trim().slice(0, max);
const isoOf = (v) => {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate().toISOString();
  if (v instanceof Date) return v.toISOString();
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

const isAwsCloud = (v) => /\baws\b|amazon\s+web\s+services/i.test(String(v || ""));
const aceStageFor = (leadStage) => ACE_STAGE_FOR[leadStage] || null;
// "forward" | "backward" | "same" from one ACE stage to another. Closed Lost ends
// a deal: any open stage may move to it, nothing moves out of it automatically.
function stageMove(from, to) {
  if (!to) return "backward";
  if (!from || from === to) return from === to ? "same" : "forward";
  if (from === "Closed Lost") return "backward";
  if (to === "Closed Lost") return "forward";
  const a = ACE_ORDER.indexOf(from); const b = ACE_ORDER.indexOf(to);
  if (a < 0) return "forward";
  return b > a ? "forward" : "backward";
}

// Why this lead's opportunity is not drafted, or ok.
function eligibility(lead, company) {
  const l = lead || {};
  if (l.leadType === "operator") return { ok: false, reason: "Network operator inquiries are people, not companies." };
  if (l.archivedAt) return { ok: false, reason: "The lead is archived." };
  const name = str(l.company && l.company.name, 200);
  if (!name) return { ok: false, reason: "The lead has no company name." };
  if (str(l.aceOpportunityId, 64)) return { ok: false, reason: `This lead already has ACE opportunity ${str(l.aceOpportunityId, 64)}.` };
  if (!company) return { ok: false, reason: `No Prospects (TAM) company record for ${name}, so its primary cloud is not known.` };
  const ace = company.aceOpportunity && typeof company.aceOpportunity === "object" ? str(company.aceOpportunity.id, 64) : "";
  if (ace) return { ok: false, reason: `This company already has ACE opportunity ${ace}.` };
  const cloud = str(company.profile && company.profile.primaryCloud, 60);
  if (!cloud) return { ok: false, reason: "The TAM company record has no primary cloud provider." };
  if (!isAwsCloud(cloud)) return { ok: false, reason: `The TAM company's primary cloud is ${cloud}, not AWS.` };
  return { ok: true, reason: "" };
}

// The newest industry one-pager and prospect pack in the company's document library.
function pickAttachments(documents) {
  const out = [];
  for (const kind of ["industry-one-pager", "prospect-pack"]) {
    const docs = (Array.isArray(documents) ? documents : []).filter((d) => d && d.kind === kind && str(d.title, 200));
    docs.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || (Number(b.version) || 0) - (Number(a.version) || 0));
    const d = docs[0];
    if (d) out.push({ kind, title: str(d.title, 200), url: /^https?:\/\//i.test(str(d.url, 500)) ? str(d.url, 500) : "", version: Number(d.version) || null, date: str(d.date, 10) || null });
  }
  return out;
}

// Meeting notes and transcripts: the lead's own notes, newest first, without the console's automatic lines.
function leadNotes(lead) {
  const h = Array.isArray(lead && lead.history) ? lead.history : [];
  return h.filter((x) => x && x.kind === "note" && str(x.text, 4000) && !SYSTEM_NOTE.test(str(x.text, 200)))
    .slice(-NOTES_MAX).reverse().map((x) => ({ at: str(x.at, 10), text: str(x.text, 4000) }));
}

// The one message that asks the agent to draft the opportunity.
function buildDraftPrompt({ lead, company, attachments, notes, catalog }) {
  const l = lead || {};
  const c = l.company || {};
  const p = (company && company.profile) || {};
  const contacts = (Array.isArray(l.contacts) ? l.contacts : []).filter((k) => k && str(k.name, 120)).slice(0, 8)
    .map((k) => [str(k.name, 120), str(k.jobTitle, 120), str(k.buyingRole, 40)].filter(Boolean).join(", ")).join("; ");
  const ctx = [
    ["Customer", str(c.name, 120)],
    ["Website", str(c.website, 300)],
    ["Industry", str(c.industry, 120)],
    ["Countries", Array.isArray(c.countries) ? c.countries.map((x) => str(x, 60)).filter(Boolean).join(", ") : ""],
    ["Stores", typeof c.storeCount === "number" ? String(c.storeCount) : ""],
    ["Customer AWS account ID", /^\d{12}$/.test(String(c.awsAccountId || "")) ? c.awsAccountId : ""],
    ["Primary cloud", str(p.primaryCloud, 60)],
    ["Company summary", str(p.summary || (l.enrichment && l.enrichment.summary), 700)],
    ["Contacts (name, title, buying role)", contacts],
    ["Console lead", `${str(l.stage, 40) || "hot-lead"} (Personalisation Hub Agent Console)`],
  ].filter(([, v]) => v).map(([k, v]) => `- ${k}: ${v}`).join("\n");
  const att = (attachments || []).map((a) => `- ${a.kind === "industry-one-pager" ? "Industry one-pager" : "Prospect pack"}: ${a.title}${a.url ? ` (${a.url})` : ""}`).join("\n");
  const head = [
    `Draft an ACE opportunity for this customer in the ${catalog} catalogue, created at the Prospect stage. Personalisation Hub is the partner.`,
    "",
    "Lead record:",
    ctx || "- (no details yet)",
    "",
    "Attach these documents to the opportunity:",
    att || "- (none in the company's document library yet)",
    "",
  ];
  const tail = [
    "",
    "1. Create the draft opportunity from the lead record, the documents and the notes above.",
    "2. Run the co-sell next-step and best-practice recommendations against the draft and apply every improvement you can, aiming for an Opportunity Quality Score of 60 or more.",
    "3. Do not submit the opportunity for AWS review or share it with AWS: an admin approves the create in the console.",
    "",
    "End your answer with exactly these two lines:",
    "PREDICTED_SCORE: <a whole number from 0 to 100>",
    "RECOMMENDATIONS: <the recommendations still open, separated by semicolons, or none>",
  ];
  const NOTES_HEAD = "Meeting notes and transcripts (newest first):";
  const fixed = [...head, NOTES_HEAD, ...tail].join("\n").length;
  const room = Math.max(0, MESSAGE_MAX - fixed);
  const noteLines = [];
  let used = 0;
  for (const n of notes || []) {
    const line = `- ${n.at ? `${n.at}: ` : ""}${n.text.replace(/\s+/g, " ")}`;
    const fit = line.slice(0, Math.max(0, room - used - 1));
    if (fit.length < 40) break;
    noteLines.push(fit); used += fit.length + 1;
  }
  return [...head, NOTES_HEAD, ...(noteLines.length ? noteLines : ["- (none yet)"]), ...tail].join("\n").slice(0, MESSAGE_MAX);
}

// The agent's last "PREDICTED_SCORE: NN" line (0–100) and its RECOMMENDATIONS line or list.
function parseDraftReply(replyText) {
  const s = String(replyText || "");
  const scores = [...s.matchAll(/^[\s>*_`-]*PREDICTED_SCORE\s*:\s*\**\s*(\d{1,3})\s*\**\s*$/gim)];
  const n = scores.length ? Number(scores[scores.length - 1][1]) : NaN;
  const predictedScore = Number.isInteger(n) && n >= 0 && n <= 100 ? n : null;
  let recommendations = [];
  const lines = s.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^[\s>*_`-]*RECOMMENDATIONS\s*:\s*\**\s*(.*)$/i.exec(lines[i]);
    if (!m) continue;
    const inline = m[1].trim();
    if (inline) recommendations = inline.split(/\s*;\s*/);
    else {
      for (let j = i + 1; j < lines.length; j++) {
        const b = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(lines[j]);
        if (b) recommendations.push(b[1]); else if (lines[j].trim()) break;
      }
    }
    break;
  }
  recommendations = recommendations.map((r) => str(r.replace(/\.$/, ""), 300)).filter((r) => r && !/^none\b/i.test(r)).slice(0, 10);
  return { predictedScore, recommendations };
}

// An ACE opportunity id the agent named ("O" + digits).
function opportunityIdFrom(replyText) {
  const m = /\b(O\d{5,15})\b/.exec(String(replyText || ""));
  return m ? m[1] : null;
}

// Problems first, from the opportunity as Partner Central holds it. No agent call.
function insights(opp, at = new Date()) {
  if (!opp) return [];
  const out = [];
  const closed = opp.stage === "Closed Lost" || opp.stage === "Launched";
  if (opp.stage === "Closed Lost") out.push({ key: "closed-lost", level: "lost", text: `Closed lost: ${opp.closedLostReason || "no reason given"}.` });
  const today = at.toISOString().slice(0, 10);
  if (!closed && opp.targetCloseDate && opp.targetCloseDate < today) out.push({ key: "past-close", level: "risk", text: `Target close date ${opp.targetCloseDate} has passed.` });
  const mod = Date.parse(opp.lastModifiedDate || "");
  if (!closed && Number.isFinite(mod) && at.getTime() - mod > STALE_DAYS * 864e5) out.push({ key: "stale", level: "risk", text: `No change in Partner Central for ${Math.floor((at.getTime() - mod) / 864e5)} days.` });
  if (!closed && typeof opp.score === "number" && opp.score < TARGET_SCORE) out.push({ key: "low-score", level: "risk", text: `Quality score ${opp.score} is under ${TARGET_SCORE}.` });
  if (!closed && !str(opp.nextSteps, 10)) out.push({ key: "no-next-steps", level: "risk", text: "No next steps recorded." });
  return out;
}

// One message for every queued stage change: a bulk opportunity update.
function buildSyncPrompt(items, catalog) {
  const lines = items.map((x) => `- ${x.opportunityId} (${str(x.company, 120) || "customer"}): move to ${x.target}`);
  return [
    `Update the stage of these ACE opportunities in the ${catalog} catalogue, as one bulk update:`,
    ...lines,
    "",
    "Change only the stage. Do not submit anything for AWS review: an admin approves each write in the console.",
  ].join("\n").slice(0, MESSAGE_MAX);
}

function createAceDraft({ db, partnerCentral, logger = console, now = () => new Date() }) {
  const aceRef = (id) => db.collection(COLLECTION).doc(id);
  const leadRef = (id) => db.collection("leads").doc(id);
  const warn = (msg, extra) => { try { logger.warn(msg, extra); } catch { /* logging only */ } };
  const err = (status, message) => Object.assign(new Error(message), { status });

  async function loadLead(id) {
    const snap = await leadRef(id).get();
    return snap.exists ? snap.data() || {} : null;
  }
  async function loadCompany(lead) {
    const key = slugId(lead && lead.company && lead.company.name);
    if (!key) return null;
    const snap = await db.collection(COMPANY_COLLECTION).doc(key).get();
    return snap.exists ? snap.data() || {} : null;
  }
  async function addHistory(id, line, by) {
    try {
      const ref = leadRef(id);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return;
        const lead = snap.data() || {};
        const history = [...(Array.isArray(lead.history) ? lead.history : []), { at: now().toISOString(), by: str(by, 200), kind: "note", text: str(line, 2000) }].slice(-100);
        tx.update(ref, { history, updatedAt: now() });
      });
    } catch (e) {
      warn("aceDraft: could not add to the lead's history", { leadId: id, error: String(e && e.message || e) });
    }
  }

  // Draft the opportunity. { ok, status, reason, ace }.
  async function draft(id, { by = BY, auto = false } = {}) {
    const lead = await loadLead(id);
    if (!lead) return { ok: false, notFound: true, reason: "That lead was not found." };
    const company = await loadCompany(lead).catch(() => null);
    const el = eligibility(lead, company);
    if (!el.ok) {
      await aceRef(id).set({ leadId: id, status: "skipped", reason: el.reason, at: now(), by: str(by, 200), auto }, { merge: true });
      return { ok: false, status: "skipped", reason: el.reason };
    }
    let cfg;
    try { cfg = await partnerCentral.loadConfig(); } catch (e) { return { ok: false, status: "error", reason: `Couldn't read the Partner Central setting: ${str(e && e.message, 200)}` }; }
    // Claim it: a retried trigger, or a second click, never drafts twice.
    let refused = "";
    const claimed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(aceRef(id));
      const cur = snap.exists ? snap.data() || {} : {};
      const at = Date.parse(isoOf(cur.at) || "");
      const busy = cur.status === "drafting" && Number.isFinite(at) && now().getTime() - at < STALE_DRAFTING_MS;
      if (busy) { refused = "A draft is already being prepared."; return null; }
      if (cur.status === "awaiting-approval") { refused = "A draft already waits for approval in Settings."; return null; }
      if (cur.opportunityId) { refused = `This lead already has ACE opportunity ${cur.opportunityId}.`; return null; }
      if (auto && cur.status === "drafted") { refused = "Already drafted."; return null; }
      const next = { leadId: id, status: "drafting", reason: "", at: now(), by: str(by, 200), auto, catalog: cfg.catalog, attempts: (Number(cur.attempts) || 0) + 1 };
      tx.set(aceRef(id), next, { merge: true });
      return next;
    });
    if (!claimed) return { ok: false, status: "refused", reason: refused };
    const attachments = pickAttachments(company.documents);
    const notes = leadNotes(lead);
    const text = buildDraftPrompt({ lead: { ...lead, stage: lead.stage || "hot-lead" }, company, attachments, notes, catalog: cfg.catalog });
    try {
      const out = await partnerCentral.agentMessage({ text, leadId: id }, { by: str(by, 200) });
      const replyText = str(out.reply && out.reply.text, 6000);
      const parsed = parseDraftReply(replyText);
      const pending = out.session ? out.session.approvals.filter((a) => a.state === "pending").length : 0;
      const oppId = pending ? null : opportunityIdFrom(replyText);
      const status = pending ? "awaiting-approval" : oppId ? "drafted" : "error";
      const doc = {
        status, reason: status === "error" ? `The agent answered without preparing a draft for approval: ${str(replyText, 300) || "no answer"}` : "",
        sessionId: out.session ? out.session.sessionId : null, catalog: cfg.catalog, predictedScore: parsed.predictedScore, recommendations: parsed.recommendations,
        attachments, notesSent: notes.length, pendingApprovals: pending, replyText, at: now(),
        ...(oppId ? { opportunityId: oppId, aceStage: "Prospect" } : {}),
      };
      await aceRef(id).set(doc, { merge: true });
      if (oppId) await linkOpportunity(id, oppId, by);
      await addHistory(id, `ACE opportunity drafted through the Partner Central agent (${cfg.catalog} catalogue)${parsed.predictedScore !== null ? `, predicted quality score ${parsed.predictedScore}` : ""}${pending ? ": the create waits for an admin's approval; nothing was written to Partner Central yet" : ""}.`, by);
      return { ok: status !== "error", status, reason: doc.reason };
    } catch (e) {
      const reason = str(e && e.message, 400) || "unknown error";
      warn("aceDraft: draft failed", { leadId: id, error: reason });
      await aceRef(id).set({ status: "error", reason, at: now() }, { merge: true }).catch(() => null);
      return { ok: false, status: "error", reason };
    }
  }

  async function linkOpportunity(id, oppId, by) {
    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(leadRef(id));
        if (!snap.exists) return;
        const lead = snap.data() || {};
        if (str(lead.aceOpportunityId, 64)) return;
        const history = [...(Array.isArray(lead.history) ? lead.history : []), { at: now().toISOString(), by: str(by, 200), kind: "note", text: `ACE opportunity ${oppId} created in Partner Central (Prospect).` }].slice(-100);
        tx.update(leadRef(id), { aceOpportunityId: oppId, history, updatedAt: now() });
      });
    } catch (e) {
      warn("aceDraft: could not link the opportunity on the lead", { leadId: id, error: String(e && e.message || e) });
    }
  }

  // After a decision in Settings: the draft's create, or a sent stage change. Idempotent.
  async function reconcile(id) {
    const snap = await aceRef(id).get();
    if (!snap.exists) return null;
    const cur = snap.data() || {};
    const patch = {};
    const readSession = async (sid) => { if (!sid) return null; const s = await db.collection(SESSIONS).doc(sid).get(); return s.exists ? s.data() || {} : null; };
    if (cur.status === "awaiting-approval" && cur.sessionId) {
      const s = await readSession(cur.sessionId);
      const approvals = s && Array.isArray(s.approvals) ? s.approvals : [];
      const pending = approvals.filter((a) => a && a.state === "pending").length;
      if (s && approvals.length && !pending) {
        const approved = approvals.some((a) => a && a.state === "approved");
        if (approved) {
          const oppId = opportunityIdFrom(s.lastReply);
          Object.assign(patch, { status: "drafted", pendingApprovals: 0, approvedAt: now(), aceStage: "Prospect", ...(oppId ? { opportunityId: oppId } : { reason: "Approved; the agent's reply did not name the opportunity id yet. Refresh the session in Settings." }) });
          if (oppId) await linkOpportunity(id, oppId, (approvals.find((a) => a.state === "approved") || {}).decidedBy || BY);
        } else {
          Object.assign(patch, { status: "rejected", pendingApprovals: 0, reason: "The create was rejected in Settings; nothing was written to Partner Central." });
        }
      } else if (s && pending !== Number(cur.pendingApprovals || 0)) patch.pendingApprovals = pending;
    } else if (cur.status === "drafted" && !cur.opportunityId && cur.sessionId) {
      const s = await readSession(cur.sessionId);
      const oppId = s && opportunityIdFrom(s.lastReply);
      if (oppId) { patch.opportunityId = oppId; patch.reason = ""; await linkOpportunity(id, oppId, BY); }
    }
    const sync = cur.stageSync;
    if (sync && sync.status === "sent" && sync.sessionId) {
      const s = await readSession(sync.sessionId);
      const approvals = s && Array.isArray(s.approvals) ? s.approvals : [];
      if (approvals.length && !approvals.some((a) => a && a.state === "pending")) {
        const ok = approvals.some((a) => a && a.state === "approved");
        patch.stageSync = { ...sync, status: ok ? "done" : "rejected", decidedAt: now() };
        if (ok) patch.aceStage = sync.target;
        await addHistory(id, ok ? `ACE stage moved to ${sync.target} in Partner Central.` : `ACE stage change to ${sync.target} was rejected; Partner Central was not changed.`, BY);
      }
    }
    if (!Object.keys(patch).length) return cur;
    await aceRef(id).set(patch, { merge: true });
    return { ...cur, ...patch };
  }

  // Queue (or flag) the ACE stage that follows a lead stage move.
  async function queueStage(id, lead, leadStage) {
    const target = aceStageFor(leadStage);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(aceRef(id));
      const cur = snap.exists ? snap.data() || {} : {};
      const oppId = str(cur.opportunityId || lead.aceOpportunityId, 64);
      const hasDraft = cur.status === "awaiting-approval" || cur.status === "drafted" || !!oppId;
      if (!hasDraft) return;
      const sync = cur.stageSync && typeof cur.stageSync === "object" ? cur.stageSync : null;
      const known = cur.aceStage || (cur.status === "awaiting-approval" || cur.status === "drafted" ? "Prospect" : null);
      const ahead = sync && (sync.status === "pending" || sync.status === "sent") && stageMove(known, sync.target) === "forward" ? sync.target : known;
      const move = stageMove(ahead, target);
      let next;
      if (move === "same") next = sync && sync.status === "flagged" ? null : sync;
      else if (move === "backward") next = { status: "flagged", target: target || null, fromStage: leadStage, at: now(), reason: `ACE is not moved backwards (${ahead || "unknown"} → ${target || "no ACE stage"}). Change it in Partner Central if you mean it.` };
      else next = { status: "pending", target, fromStage: leadStage, at: now() };
      if (sync && sync.status === "sent" && move !== "forward") return; // the sent one decides first
      tx.set(aceRef(id), { leadId: id, stageSync: next, ...(oppId && !cur.opportunityId ? { opportunityId: oppId } : {}) }, { merge: true });
    });
  }

  // The write trigger on leads/{id}: acts only when the stage changes.
  async function onLeadWrite(event) {
    const id = event && event.params && event.params.leadId;
    const after = event && event.data && event.data.after;
    if (!id || !after || !after.exists) return;
    const before = event.data.before;
    const d = after.data() || {};
    const prevStage = before && before.exists ? (before.data() || {}).stage : null;
    if (d.leadType === "operator" || d.stage === prevStage) return;
    try {
      const snap = await aceRef(id).get();
      const cur = snap.exists ? snap.data() || {} : {};
      const has = cur.status === "awaiting-approval" || cur.status === "drafted" || cur.status === "drafting" || cur.opportunityId || str(d.aceOpportunityId, 64);
      if (d.stage === "hot-lead" && !has) { await draft(id, { auto: true }); return; }
      if (has && cur.status !== "drafting") await queueStage(id, d, d.stage);
    } catch (e) {
      warn("aceDraft: trigger failed", { leadId: id, error: String(e && e.message || e) });
    }
  }

  // The write trigger on partnerCentralAgentSessions/{id}: a decision may settle a draft or a stage change.
  async function onSessionWrite(event) {
    const after = event && event.data && event.data.after;
    if (!after || !after.exists) return;
    const sid = event.params && event.params.sessionId;
    try {
      const ids = new Set();
      const d = after.data() || {};
      if (d.leadId) ids.add(d.leadId);
      for (const field of ["sessionId", "stageSync.sessionId"]) {
        const q = await db.collection(COLLECTION).where(field, "==", sid).limit(50).get().catch(() => ({ docs: [] }));
        for (const doc of q.docs) ids.add(doc.id);
      }
      for (const id of ids) await reconcile(id);
    } catch (e) {
      warn("aceDraft: session trigger failed", { sessionId: sid, error: String(e && e.message || e) });
    }
  }

  // The lead summary's ACE group.
  async function view(id, ctx) {
    const lead = await loadLead(id);
    if (!lead) throw err(404, "That lead was not found.");
    const company = await loadCompany(lead).catch(() => null);
    const cur = (await reconcile(id).catch(() => null)) || {};
    const oppId = str(cur.opportunityId || lead.aceOpportunityId, 64) || null;
    let opportunity = null; let opportunityError = null;
    if (oppId) {
      try {
        const raw = await partnerCentral.getOpportunity(oppId, ctx);
        const o = normaliseOpportunity(null, { Id: oppId, ...raw });
        const life = (raw && (raw.LifeCycle || raw.Lifecycle)) || {};
        opportunity = { id: o.id, name: o.name, stage: o.stage, reviewStatus: o.reviewStatus, score: o.score, targetCloseDate: o.targetCloseDate, lastModifiedDate: o.lastModifiedDate, nextSteps: o.nextSteps, closedLostReason: str(life.ClosedLostReason, 200) || null, partnerCentralUrl: o.partnerCentralUrl };
      } catch (e) {
        opportunityError = `Couldn't read it from Partner Central: ${str(e && e.message, 240)}`;
      }
    }
    const draftView = cur.status ? {
      status: STATUSES.includes(cur.status) ? cur.status : "error", reason: cur.reason || "", at: isoOf(cur.at), by: cur.by || null, auto: cur.auto === true,
      catalog: cur.catalog || null, sessionId: cur.sessionId || null, predictedScore: typeof cur.predictedScore === "number" ? cur.predictedScore : null,
      recommendations: Array.isArray(cur.recommendations) ? cur.recommendations : [], pendingApprovals: Number(cur.pendingApprovals) || 0,
      aceStage: cur.aceStage || null,
      stageSync: cur.stageSync ? { status: cur.stageSync.status, target: cur.stageSync.target || null, fromStage: cur.stageSync.fromStage || null, reason: cur.stageSync.reason || "", at: isoOf(cur.stageSync.at) } : null,
    } : null;
    const score = opportunity && typeof opportunity.score === "number" ? { value: opportunity.score, source: "actual" }
      : draftView && draftView.predictedScore !== null ? { value: draftView.predictedScore, source: "predicted" } : null;
    const attachments = Array.isArray(cur.attachments) && cur.attachments.length ? cur.attachments : pickAttachments(company && company.documents);
    return {
      leadId: id, eligible: eligibility(lead, company), primaryCloud: str(company && company.profile && company.profile.primaryCloud, 60) || null,
      attachments, draft: draftView, opportunityId: oppId, opportunity, opportunityError, score, targetScore: TARGET_SCORE,
      insights: insights(opportunity, now()),
    };
  }

  // Queued stage changes (Settings).
  async function syncList() {
    const q = await db.collection(COLLECTION).where("stageSync.status", "==", "pending").limit(200).get();
    const out = [];
    for (const d of q.docs) {
      const x = d.data() || {};
      let company = "";
      try { const l = await loadLead(d.id); company = str(l && l.company && l.company.name, 120); } catch { company = ""; }
      out.push({ leadId: d.id, company, opportunityId: x.opportunityId || null, target: x.stageSync.target, fromStage: x.stageSync.fromStage || null });
    }
    return out;
  }
  async function syncSend(ctx) {
    const pending = await syncList();
    const ready = pending.filter((x) => x.opportunityId && x.target);
    if (!ready.length) return { sent: 0, waiting: pending.length, message: pending.length ? "Nothing to send yet: the queued changes wait for their opportunity to be approved." : "No stage changes waiting." };
    const cfg = await partnerCentral.loadConfig();
    const out = await partnerCentral.agentMessage({ text: buildSyncPrompt(ready, cfg.catalog) }, ctx);
    const sid = out.session ? out.session.sessionId : null;
    const waiting = out.session ? out.session.approvals.filter((a) => a.state === "pending").length : 0;
    for (const x of ready) {
      await aceRef(x.leadId).set({ stageSync: { status: "sent", target: x.target, fromStage: x.fromStage, sessionId: sid, sentAt: now(), sentBy: ctx.by } }, { merge: true });
    }
    const n = ready.length;
    return {
      sent: n, waiting: pending.length - n, session: out.session,
      message: waiting ? `${n} ACE stage ${n === 1 ? "change waits" : "changes wait"} for your approval.` : `Sent ${n} ACE stage ${n === 1 ? "change" : "changes"}; the agent did not ask for approval: ${str(out.reply && out.reply.text, 200)}`,
    };
  }

  // Routes. Returns true when it answered.
  async function handle(req, res) {
    const path = String((req.path || req.url || "/").split("?")[0]).replace(/^\/partnerCentral(?=\/|$)/, "").replace(/\/+$/, "") || "/";
    const v = ROUTE_VIEW.exec(path); const d = ROUTE_DRAFT.exec(path); const s = ROUTE_SYNC.test(path);
    if (!v && !d && !s) return false;
    const reply = (status, body) => res.status(status).set("Cache-Control", "no-store").json(body);
    const method = req.method;
    if ((v && method !== "GET") || (d && method !== "POST") || (s && method !== "GET" && method !== "POST")) { reply(405, { error: "method not allowed" }); return true; }
    const who = await partnerCentral.authorise(req, v ? "editor" : "admin");
    if (!who.ok) { reply(who.status, { error: who.status === 403 ? (v ? "only an editor or admin can see the ACE opportunity" : "only an admin can draft or sync ACE opportunities") : who.error }); return true; }
    const ctx = { by: who.user.email };
    try {
      if (v) { reply(200, await view(v[1], ctx)); return true; }
      if (d) {
        const out = await draft(d[1], { by: ctx.by });
        if (out.notFound) { reply(404, { error: out.reason }); return true; }
        reply(200, { ...out, ace: await view(d[1], ctx) });
        return true;
      }
      if (method === "GET") { reply(200, { pending: await syncList() }); return true; }
      reply(200, await syncSend(ctx));
    } catch (e) {
      reply(e.status || 500, { error: str(e && e.message || e, 300) });
    }
    return true;
  }

  return { handle, onLeadWrite, onSessionWrite, draft, reconcile, queueStage, view, syncList, syncSend };
}

module.exports = {
  createAceDraft, eligibility, pickAttachments, leadNotes, buildDraftPrompt, parseDraftReply, opportunityIdFrom, insights, buildSyncPrompt,
  aceStageFor, stageMove, isAwsCloud, ACE_STAGE_FOR, ACE_ORDER, TARGET_SCORE, COLLECTION, STATUSES,
};
