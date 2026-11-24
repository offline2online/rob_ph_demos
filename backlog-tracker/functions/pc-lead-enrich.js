"use strict";
// ── Promote › Leads: AWS Partner Central lead enrichment and prospecting ──────
// Every new company lead is sent to Partner Central lead enrichment (us-east-1)
// by itself, through partner-central.js's single door to AWS (callAws, closed
// operation list, keyless role, audited). The API is asynchronous (botocore
// model partnercentral-selling 2022-07-26):
//
//   CreateEngagement (a Lead context: the company and one interaction)
//     → StartProspectingFromEngagementTask (TaskId, TaskStatus)
//     → GetProspectingFromEngagementTask until the engagement's Status is COMPLETED
//     → GetEngagement: the ProspectingResult context (ProspectingResultCustomer +
//       ProspectingInsights) and the Lead context's LeadInsights.
//
// The result is stored on leads/{id}.partnerCentral (see public/js/leads-core.js →
// normalisePartnerCentral); the card's lead score and the summary's AWS Partner
// Central section read it, and a live result scoring HOT_LEAD_SCORE or more moves
// a Lead to Hot Lead once (shouldAutoPromote).
//
// Following the task: the write trigger (onLeadWrite) polls every 30 s for up to
// seven minutes; if AWS is still working it bumps partnerCentral.checks, which
// fires the trigger again, up to MAX_CHECKS times. No Cloud Scheduler: this
// project deliberately has none.
//
// Safety rails (test/pc-lead-enrich.test.js):
//   • a test lead always goes to the Sandbox catalogue (callAws sandbox:true),
//     with placeholder contact details, whatever the live setting;
//   • contact details are never invented for a real lead: no contact with a name
//     and an email → "Not sent: contact incomplete", sent once one is added;
//   • network operator inquiries (people), archived leads and leads with no
//     company name are never sent;
//   • idempotent: the lead is claimed in a transaction, ClientTokens are
//     ph-lead-<id>-<attempt> / ph-task-<id>-<attempt>, and the engagement id is
//     saved before the task starts, so a retry reuses it;
//   • Partner Central cannot delete an engagement: deleting a lead deletes the
//     console record only, and a follow-up that finds the lead gone stops
//     without recreating it (every write is a transaction update on an
//     existing document).
//
// Route (answered before partner-central.js's own routes, editors):
//   POST /partnerCentral/v1/leads/{id}/enrich   send again / refresh

const core = require("./leads-core");

const POLL_MS = 30 * 1000;
const FOLLOW_MS = 7 * 60 * 1000; // inside the trigger's 540 s limit
const MAX_CHECKS = 40; // ~5 hours of following
const STALE_SENDING_MS = 10 * 60 * 1000;
const BY = "AWS Partner Central lead enrichment";
const TEST_CONTACT = { FirstName: "Test", LastName: "Lead", Email: "test-lead@example.com", BusinessTitle: "Not provided" };
const ROUTE = /^\/v1\/leads\/([A-Za-z0-9_-]{1,128})\/enrich$/;

const str = (v, max) => String(v == null ? "" : v).trim().slice(0, max);
const isoOf = (v) => {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate().toISOString();
  if (v instanceof Date) return v.toISOString();
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

// The console keeps countries as typed ("UK", "France"); Partner Central wants ISO 3166 alpha-2.
const COUNTRY_CODES = {
  uk: "GB", "united kingdom": "GB", "great britain": "GB", britain: "GB", england: "GB", scotland: "GB", wales: "GB", "northern ireland": "GB",
  us: "US", usa: "US", "united states": "US", "united states of america": "US", america: "US",
  ireland: "IE", france: "FR", germany: "DE", spain: "ES", italy: "IT", netherlands: "NL", belgium: "BE", portugal: "PT",
  sweden: "SE", norway: "NO", denmark: "DK", finland: "FI", poland: "PL", austria: "AT", switzerland: "CH",
  canada: "CA", australia: "AU", "new zealand": "NZ", india: "IN", japan: "JP", singapore: "SG", "south africa": "ZA",
  "united arab emirates": "AE", uae: "AE", "saudi arabia": "SA", brazil: "BR", mexico: "MX",
};
function countryCode(countries) {
  for (const c of Array.isArray(countries) ? countries : []) {
    const s = str(c, 60);
    if (!s) continue;
    const hit = COUNTRY_CODES[s.toLowerCase()];
    if (hit) return hit;
    if (/^[A-Z]{2}$/.test(s)) return s === "UK" ? "GB" : s;
  }
  return "";
}

// Why a lead is not sent, or "" when it may be.
function notSendable(lead) {
  const l = lead || {};
  if (l.leadType === "operator") return "network operator inquiries are people, not companies";
  if (l.archivedAt) return "the lead is archived";
  if (!str(l.company && l.company.name, 200)) return "no company name";
  if (l.test !== true && !firstContact(l)) return "contact incomplete";
  return "";
}
function firstContact(l) {
  return (Array.isArray(l.contacts) ? l.contacts : []).find((k) => k && str(k.name, 120) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str(k.email, 200))) || null;
}
function leadContact(l) {
  if (l.test === true) return { ...TEST_CONTACT };
  const k = firstContact(l);
  const parts = str(k.name, 120).split(/\s+/);
  return {
    FirstName: parts[0].slice(0, 80),
    LastName: (parts.slice(1).join(" ") || "Not provided").slice(0, 80),
    Email: str(k.email, 200),
    BusinessTitle: str(k.jobTitle, 120) || "Not provided",
  };
}

// The CreateEngagement body: a Lead context with the company and one interaction.
function buildEngagement(id, lead, attempt, at) {
  const l = lead || {};
  const c = l.company || {};
  const name = str(c.name, 200);
  const cc = countryCode(c.countries);
  const customer = { CompanyName: name };
  if (str(c.website, 255)) customer.WebsiteUrl = str(c.website, 255);
  if (str(c.industry, 255)) customer.Industry = str(c.industry, 255);
  if (cc) customer.Address = { CountryCode: cc };
  const interaction = {
    SourceType: l.test === true ? "Test lead" : str(l.source, 255) || "Website form",
    SourceId: id,
    SourceName: str(l.sourceLabel, 255) || "Personalisation Hub website",
    InteractionDate: isoOf(l.createdAt) || at.toISOString(),
    CustomerAction: str(l.sourceDetail, 255) || "Submitted a form",
    Contact: leadContact(l),
  };
  return {
    ClientToken: `ph-lead-${id}-${attempt}`,
    Title: name.slice(0, 40),
    Description: `Lead from the PH Agent Console${l.test === true ? " (test lead)" : ""}`.slice(0, 255),
    Contexts: [{ Type: "Lead", Payload: { Lead: { Customer: customer, Interactions: [interaction] } } }],
  };
}

// GetEngagement → the stored customer / insights maps (labels as AWS gave them).
function readEngagement(eng, contextId) {
  const contexts = Array.isArray(eng && eng.Contexts) ? eng.Contexts : [];
  const results = contexts.filter((x) => x && x.Type === "ProspectingResult");
  const pr = (contextId && results.find((x) => x.Id === contextId)) || results[results.length - 1] || null;
  const aws = (pr && pr.Payload && pr.Payload.ProspectingResult && pr.Payload.ProspectingResult.Aws) || {};
  const cu = aws.Customer || {};
  const pi = aws.Insights || {};
  const leadCtx = contexts.find((x) => x && x.Type === "Lead");
  const li = (leadCtx && leadCtx.Payload && leadCtx.Payload.Lead && leadCtx.Payload.Lead.Insights) || {};
  const ch = li.ChannelRecommendation || {};
  return {
    found: !!pr,
    customer: {
      accountName: str(cu.AccountName, 200), geo: str(cu.Geo, 80), region: str(cu.Region, 80), subRegion: str(cu.SubRegion, 80),
      country: str(cu.Country, 10), industry: str(cu.Industry, 120), subIndustry: str(cu.SubIndustry, 120),
      segment: str(cu.Segment, 80), companySize: str(cu.CompanySize, 80),
      eligiblePrograms: (Array.isArray(cu.EligiblePrograms) ? cu.EligiblePrograms : []).map((p) => str(p, 80)).filter(Boolean).slice(0, 20),
      publicProfileSummary: str(cu.PublicProfileSummary, 2000),
    },
    insights: {
      leadReadiness: core.pcLevelLabel(li.LeadReadinessScore),
      marketplaceEngagement: core.pcLevelLabel(pi.MarketplaceEngagementScore),
      solutionScore: core.pcLevelLabel(pi.SolutionScore),
      solutionCategory: str(pi.SolutionCategory, 120), solutionSubCategory: str(pi.SolutionSubCategory, 120),
      recommendedChannel: str(ch.RecommendedChannel, 40).toUpperCase(),
      outreachWindows: (Array.isArray(ch.BestOutreachWindows) ? ch.BestOutreachWindows : []).filter((w) => w && w.Day)
        .map((w) => ({ day: str(w.Day, 12).toUpperCase(), start: str(w.StartTimeUtc, 5), end: str(w.EndTimeUtc, 5) })).slice(0, 7),
    },
  };
}

function createPcLeadEnrich({
  db, partnerCentral, logger = console, now = () => new Date(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)), pollMs = POLL_MS, followMs = FOLLOW_MS, maxChecks = MAX_CHECKS,
}) {
  const leadRef = (id) => db.collection("leads").doc(id);
  const warn = (msg, extra) => { try { logger.warn(msg, extra); } catch { /* logging only */ } };

  // Replace leads/{id}.partnerCentral inside a transaction, only while the lead
  // exists. `fn(lead, pc)` returns the new pc (or null to leave it), and may return
  // { pc, extra } to write other lead fields in the same update.
  async function mutate(id, fn) {
    return db.runTransaction(async (tx) => {
      const ref = leadRef(id);
      const snap = await tx.get(ref);
      if (!snap.exists) return { gone: true };
      const lead = snap.data() || {};
      const out = fn(lead, lead.partnerCentral && typeof lead.partnerCentral === "object" ? lead.partnerCentral : null);
      if (!out) return { lead, skipped: true };
      const next = out.pc ? out : { pc: out };
      tx.update(ref, { partnerCentral: next.pc, ...(next.extra || {}) });
      return { lead, pc: next.pc, extra: next.extra || null };
    });
  }

  async function fail(id, reason) {
    return mutate(id, (lead, pc) => ({ ...(pc || {}), status: "error", reason: str(reason, 600), finishedAt: now() }));
  }

  // Claim the lead and send it. { ok, status, catalog, reason }.
  async function send(id, { force = false, by = BY } = {}) {
    let cfg;
    try { cfg = await partnerCentral.loadConfig(); } catch (err) { return { ok: false, reason: `Couldn't read the Partner Central setting: ${str(err && err.message, 200)}` }; }
    let claimed = null; let refused = "";
    const out = await mutate(id, (lead, pc) => {
      const why = notSendable(lead);
      if (why) {
        refused = why;
        if (pc && pc.status === "not-sent" && pc.reason === why) return null;
        return { ...(pc || {}), status: "not-sent", reason: why };
      }
      const busy = pc && (pc.status === "sending" || pc.status === "running");
      const sentAt = pc && isoOf(pc.sentAt);
      const stale = busy && pc.status === "sending" && sentAt && now().getTime() - Date.parse(sentAt) > STALE_SENDING_MS;
      if (busy && !stale) { refused = "Partner Central is already enriching this lead"; return null; }
      if (!force && pc && pc.status && pc.status !== "not-sent") { refused = "already sent"; return null; }
      const catalog = lead.test === true ? "Sandbox" : cfg.catalog;
      // A new engagement only in a new catalogue: an engagement lives in one.
      const keepEngagement = pc && pc.engagementId && pc.catalog === catalog;
      claimed = {
        ...(pc || {}), status: "sending", reason: "", catalog, attempts: (Number(pc && pc.attempts) || 0) + 1, checks: 0,
        engagementId: keepEngagement ? pc.engagementId : "", taskId: "", sentAt: now(), sentBy: str(by, 200), finishedAt: null,
      };
      return claimed;
    });
    if (out.gone) return { ok: false, reason: "That lead was not found." };
    if (!claimed) return { ok: false, reason: refused || "not sent" };
    const lead = out.lead;
    const test = lead.test === true;
    const ctx = { by: str(by, 200), sandbox: test, config: { ...cfg, catalog: claimed.catalog } };
    try {
      let engagementId = claimed.engagementId;
      if (!engagementId) {
        const eng = await partnerCentral.callAws("CreateEngagement", buildEngagement(id, lead, claimed.attempts, now()), ctx);
        engagementId = str(eng && (eng.Id || eng.Identifier), 80);
        if (!engagementId) throw new Error("AWS created the engagement but did not return its id");
        const saved = await mutate(id, (l, pc) => (pc ? { ...pc, engagementId } : null));
        if (saved.gone) return { ok: false, reason: "The lead was deleted while it was being sent." };
      }
      const task = await partnerCentral.callAws("StartProspectingFromEngagementTask", {
        Identifiers: [engagementId], TaskName: `ph-lead-${id}`.slice(0, 128), ClientToken: `ph-task-${id}-${claimed.attempts}`,
      }, ctx);
      const taskId = str(task && task.TaskId, 80);
      const taskStatus = str(task && task.TaskStatus, 20).toUpperCase();
      if (taskStatus === "FAILED" || !taskId) {
        const reason = `Partner Central did not start prospecting: ${str((task && (task.Message || task.ReasonCode)) || "no reason given", 300)}`;
        await fail(id, reason);
        return { ok: false, status: "error", catalog: claimed.catalog, reason };
      }
      const running = await mutate(id, (l, pc) => (pc ? { ...pc, status: "running", taskId, startedAt: now() } : null));
      if (running.gone) return { ok: false, reason: "The lead was deleted while it was being sent." };
      return { ok: true, status: "running", catalog: claimed.catalog };
    } catch (err) {
      const reason = str(err && err.message, 400) || "unknown error";
      warn("pcLeadEnrich: send failed", { leadId: id, error: reason });
      await fail(id, reason).catch(() => null);
      return { ok: false, status: "error", catalog: claimed.catalog, reason };
    }
  }

  // Read the finished engagement, store it, and promote the lead when its score says so.
  async function finish(id, pc, contextId, cfg) {
    const ctx = { by: BY, sandbox: pc.catalog === "Sandbox", config: { ...cfg, catalog: pc.catalog } };
    const eng = await partnerCentral.callAws("GetEngagement", { Identifier: pc.engagementId }, ctx);
    const got = readEngagement(eng, contextId);
    return mutate(id, (lead, cur) => {
      if (!cur || cur.taskId !== pc.taskId) return null; // sent again meanwhile: that run reports
      const at = now();
      const next = { ...cur, status: "done", reason: got.found ? "" : "Partner Central finished without a prospecting result", finishedAt: at, customer: got.customer, insights: got.insights };
      const view = core.normaliseLead(id, { ...lead, partnerCentral: next });
      const s = core.leadScore(view);
      let history = core.appendHistory(lead.history, core.historyEntry(BY, "note", `Enriched by AWS Partner Central (${next.catalog} catalogue): lead score ${s.score}.`, at.toISOString()));
      const extra = { history };
      if (core.shouldAutoPromote(view, { enabled: cfg.autoPromote !== false })) {
        next.autoPromotedAt = at;
        history = core.appendHistory(history, core.historyEntry(BY, "stage", `Moved from Lead to Hot Lead: lead score ${s.score} from AWS Partner Central (Hot Lead from ${core.HOT_LEAD_SCORE}).`, at.toISOString()));
        Object.assign(extra, { history, stage: "hot-lead", stageChangedAt: at, updatedAt: at });
      }
      return { pc: next, extra };
    });
  }

  // Follow a running task until it finishes, then hand over to the next trigger run.
  async function follow(id) {
    const started = now().getTime();
    let cfg;
    try { cfg = await partnerCentral.loadConfig(); } catch (err) { warn("pcLeadEnrich: no config", { error: String(err) }); return; }
    for (;;) {
      const snap = await leadRef(id).get();
      if (!snap.exists) return; // deleted: stop, never recreate
      const pc = (snap.data() || {}).partnerCentral;
      if (!pc || pc.status !== "running" || !pc.taskId) return;
      let task;
      try {
        task = await partnerCentral.callAws("GetProspectingFromEngagementTask", { TaskIdentifier: pc.taskId }, { by: BY, sandbox: pc.catalog === "Sandbox", config: { ...cfg, catalog: pc.catalog } });
      } catch (err) {
        await fail(id, str(err && err.message, 400));
        return;
      }
      const list = Array.isArray(task && task.Engagements) ? task.Engagements : [];
      const e = list.find((x) => x && x.EngagementIdentifier === pc.engagementId) || list[0] || {};
      const st = str(e.Status, 20).toUpperCase();
      if (st === "COMPLETED") {
        try { await finish(id, pc, e.EngagementContextId, cfg); } catch (err) { await fail(id, str(err && err.message, 400)); }
        return;
      }
      if (st === "FAILED") { await fail(id, `Partner Central could not enrich this lead: ${str(e.Message || e.ReasonCode || "no reason given", 300)}`); return; }
      if (now().getTime() - started + pollMs > followMs) {
        const checks = (Number(pc.checks) || 0) + 1;
        if (checks > maxChecks) { await fail(id, "Partner Central had not finished after about five hours. Send it again to retry."); return; }
        await mutate(id, (l, cur) => (cur && cur.taskId === pc.taskId && cur.status === "running" ? { ...cur, checks } : null)); // fires the trigger again
        return;
      }
      await sleep(pollMs);
    }
  }

  // The write trigger on leads/{id}.
  async function onLeadWrite(event) {
    const id = event && event.params && event.params.leadId;
    const after = event && event.data && event.data.after;
    if (!id || !after || !after.exists) return; // deleted: nothing to do, nothing at AWS to undo
    const before = event.data.before;
    const created = !before || !before.exists;
    const d = after.data() || {};
    const pc = d.partnerCentral && typeof d.partnerCentral === "object" ? d.partnerCentral : null;
    const prev = created ? null : ((before.data() || {}).partnerCentral || null);
    try {
      if (created && !pc) { await send(id); return; }
      if (pc && pc.status === "not-sent" && !notSendable(d)) { await send(id); return; } // completed since
      if (pc && pc.status === "running" && (!prev || prev.status !== "running" || Number(prev.checks || 0) !== Number(pc.checks || 0) || prev.taskId !== pc.taskId)) {
        await follow(id);
      }
    } catch (err) {
      warn("pcLeadEnrich: trigger failed", { leadId: id, error: String(err && err.message || err) });
    }
  }

  // POST /partnerCentral/v1/leads/{id}/enrich. Returns true when it answered.
  async function handle(req, res) {
    const path = String((req.path || req.url || "/").split("?")[0]).replace(/^\/partnerCentral(?=\/|$)/, "").replace(/\/+$/, "") || "/";
    const m = ROUTE.exec(path);
    if (!m) return false;
    const reply = (status, body) => res.status(status).set("Cache-Control", "no-store").json(body);
    if (req.method !== "POST") { reply(405, { error: "use POST" }); return true; }
    const who = await partnerCentral.authorise(req, "editor");
    if (!who.ok) { reply(who.status, { error: who.status === 403 ? "only an editor or admin can send a lead to Partner Central" : who.error }); return true; }
    const out = await send(m[1], { force: true, by: who.user.email });
    reply(out.reason === "That lead was not found." ? 404 : 200, out);
    return true;
  }

  return { onLeadWrite, send, follow, finish, handle };
}

module.exports = { createPcLeadEnrich, buildEngagement, readEngagement, notSendable, countryCode, leadContact, TEST_CONTACT, POLL_MS, FOLLOW_MS, MAX_CHECKS };
