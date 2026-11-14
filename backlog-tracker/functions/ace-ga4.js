"use strict";
// ── ACE opportunity stages → GA4 (Measurement Protocol) ───────────────────
// Run hourly: .github/workflows/ace-ga4.yml POSTs to the `aceToGa4` function
// with the board key (X-Board-Key). This project has no Cloud Scheduler jobs on
// purpose (see index.js). For every website lead that carries
// a GA4 client_id (leads/{id}.gaClientIds, captured from the visitor's _ga
// cookie by the website's PH GA4 snippet and stored by lead-ingest.js), find
// its ACE opportunity and send each stage milestone to GA4 once:
//
//   ace_opportunity_qualified   ACE stage reached Qualified or any later stage
//                               (a skipped stage still counts as qualified)
//   ace_opportunity_launched    ACE stage is Launched
//   ace_opportunity_won         the console lead is Closed Won. ACE itself has
//                               no "won" stage (Launched is its last open
//                               stage), so the console's own outcome is used.
//
// Params on every event: ace_stage, company_name (offline only, never sent from
// a browser), industry, lead_source, plus session_id when the website captured
// one (so GA4 can credit the session the lead came from).
//
// Matching a lead to an opportunity, first hit wins: leads/{id}.aceOpportunityId,
// then the AWS account id, then the website's domain, then the company name.
//
// Safety rails:
//   • only while Partner Central's catalogue is "AWS": in "Sandbox" every hit
//     goes to GA4's validation endpoint (/debug/mp/collect) and nothing is
//     recorded as sent, so sandbox data never lands in reports;
//   • test leads and network operator inquiries are skipped; one GA4 client per opportunity (the newest);
//   • aceGa4Sync/{opportunityId} records what was sent, so a re-run sends
//     nothing twice and a failed send is retried next hour;
//   • the Measurement Protocol secret is the GA4_MP_API_SECRET function
//     secret: never in the repo, never in WordPress, never in a browser.

const MEASUREMENT_ID = "G-LBEF15GKVQ";
const STATE = "aceGa4Sync";
const ACE_ORDER = ["Prospect", "Qualified", "Technical Validation", "Business Validation", "Committed", "Launched"];
const EVENTS = { qualified: "ace_opportunity_qualified", launched: "ace_opportunity_launched", won: "ace_opportunity_won" };

const domainOf = (u) => {
  const s = String(u || "").trim().toLowerCase();
  if (!s) return "";
  try { return new URL(/^https?:\/\//.test(s) ? s : `https://${s}`).hostname.replace(/^www\./, ""); } catch { return ""; }
};
const nameKey = (n) => String(n || "").toLowerCase().replace(/\b(ltd|limited|plc|inc|llc|gmbh|pty|co|corp|group)\b\.?/g, "").replace(/[^a-z0-9]+/g, "");

/** The milestones a lead/opportunity pair has reached. Pure. */
function milestones(aceStage, leadStage) {
  const rank = ACE_ORDER.indexOf(String(aceStage || ""));
  const out = [];
  if (rank >= ACE_ORDER.indexOf("Qualified")) out.push("qualified");
  if (aceStage === "Launched") out.push("launched");
  if (leadStage === "closed-won") out.push("won");
  return out;
}

/** The opportunity for a lead, or null. Pure. */
function matchOpportunity(lead, opps) {
  const list = Array.isArray(opps) ? opps : [];
  const c = (lead && lead.company) || {};
  if (lead && lead.aceOpportunityId) { const hit = list.find((o) => o.id === lead.aceOpportunityId); if (hit) return hit; }
  const acct = String(c.awsAccountId || "");
  if (/^\d{12}$/.test(acct)) { const hit = list.find((o) => o.awsAccountId === acct); if (hit) return hit; }
  const dom = domainOf(c.website);
  if (dom) { const hit = list.find((o) => domainOf(o.website) === dom); if (hit) return hit; }
  const nk = nameKey(c.name);
  if (nk) { const hit = list.find((o) => nameKey(o.customer) === nk); if (hit) return hit; }
  return null;
}

const slug = (v) => String(v || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

/** The Measurement Protocol body for one milestone. Pure. */
function mpBody({ lead, opp, milestone, nowMs }) {
  const ga = (lead.gaClientIds || [])[lead.gaClientIds.length - 1];
  const params = {
    ace_stage: milestone === "won" ? "won" : milestone,
    company_name: String(opp.customer || (lead.company && lead.company.name) || "").slice(0, 100),
    industry: slug(lead.sourceIndustry || (lead.company && lead.company.industry)) || "none",
    lead_source: String(ga.leadSource || lead.sourceLabel || lead.source || "website").slice(0, 100),
    engagement_time_msec: 1,
  };
  if (ga.sessionId) params.session_id = ga.sessionId;
  const body = { client_id: ga.clientId, non_personalized_ads: false, events: [{ name: EVENTS[milestone], params }] };
  // GA4 accepts a back-dated event up to 72 hours old: date it to the change when that is recent enough.
  const changed = Date.parse(milestone === "won" ? lead.stageChangedAtIso || "" : opp.lastModifiedDate || "");
  if (Number.isFinite(changed) && nowMs - changed < 71 * 3600e3 && changed <= nowMs) body.timestamp_micros = String(changed * 1000);
  return body;
}

const { keyMatches } = require("./lead-ingest");

function createAceGa4Job({ db, partnerCentral, apiSecret, boardKey = () => "", fetch: fetchImpl = globalThis.fetch, logger = console, now = () => new Date() }) {
  async function run() {
    const secret = String(apiSecret() || "");
    if (!secret || secret === "unset") { logger.warn("aceToGa4: GA4_MP_API_SECRET is not set, nothing sent"); return { skipped: "no secret" }; }
    const leads = (await db.collection("leads").get()).docs
      .map((d) => ({ id: d.id, ...d.data() }))
      // Only company leads: a network operator inquiry (leadType "operator") is a person, never an ACE
      // opportunity, so matching one by name could credit the wrong visitor.
      .filter((l) => l.test !== true && (l.leadType || "company") === "company" && Array.isArray(l.gaClientIds) && l.gaClientIds.some((g) => g && g.clientId));
    if (!leads.length) return { leads: 0, sent: 0 };
    const ace = await partnerCentral.aceOpportunities({ by: "aceToGa4" });
    const live = ace.catalog === "AWS";
    const endpoint = `https://www.google-analytics.com/${live ? "" : "debug/"}mp/collect?measurement_id=${MEASUREMENT_ID}&api_secret=${encodeURIComponent(secret)}`;
    const summary = { leads: leads.length, catalog: ace.catalog, matched: 0, sent: 0, validated: 0, failed: 0 };
    for (const lead of leads) {
      const opp = matchOpportunity(lead, ace.opportunities);
      if (!opp) continue;
      summary.matched++;
      lead.stageChangedAtIso = lead.stageChangedAt && typeof lead.stageChangedAt.toDate === "function" ? lead.stageChangedAt.toDate().toISOString() : "";
      const ref = db.collection(STATE).doc(opp.id);
      const state = (await ref.get()).data() || {};
      const sent = state.sent || {};
      for (const m of milestones(opp.stage, lead.stage)) {
        if (sent[m]) continue;
        const body = mpBody({ lead, opp, milestone: m, nowMs: now().getTime() });
        let ok = false; let detail = "";
        try {
          const res = await fetchImpl(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
          const text = await res.text();
          if (live) ok = res.status >= 200 && res.status < 300; // /mp/collect answers 204 and never validates
          else { const v = JSON.parse(text || "{}"); ok = !(v.validationMessages || []).length; detail = JSON.stringify(v.validationMessages || []).slice(0, 300); }
        } catch (err) { detail = String((err && err.message) || err).slice(0, 300); }
        if (!live) { summary.validated += ok ? 1 : 0; if (!ok) logger.warn("aceToGa4: validation failed", { opp: opp.id, m, detail }); continue; }
        if (!ok) { summary.failed++; logger.error("aceToGa4: send failed", { opp: opp.id, m, detail }); continue; }
        sent[m] = now().toISOString();
        summary.sent++;
        await ref.set({ leadId: lead.id, clientId: body.client_id, lastStage: opp.stage, sent, updatedAt: now() }, { merge: true });
      }
    }
    logger.info("aceToGa4 run", summary);
    return summary;
  }
  // POST /  header X-Board-Key: <BOARD_API_KEY>  →  200 with the run summary.
  async function handle(req, res) {
    const send = (status, body) => res.status(status).set("Cache-Control", "no-store").json(body);
    if (req.method !== "POST") { res.set("Allow", "POST"); return send(405, { error: "POST only" }); }
    if (!keyMatches(req.get("x-board-key"), boardKey())) return send(401, { error: "invalid key" });
    try { return send(200, { ok: true, ...(await run()) }); } catch (err) {
      logger.error("aceToGa4 failed", { error: String((err && err.message) || err) });
      return send(500, { error: String((err && err.message) || err).slice(0, 300) });
    }
  }
  return { run, handle };
}

module.exports = { createAceGa4Job, milestones, matchOpportunity, mpBody, domainOf, nameKey, MEASUREMENT_ID, EVENTS, STATE };
