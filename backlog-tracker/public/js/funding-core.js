// Promote › Leads → lead summary → AWS funding: the rules behind the section
// (leads-page.js draws it). Pure functions only, driven by test/leads.test.mjs.
//
// leadFunding/{leadId} is written only by functions/partner-central.js
// (POST /partnerCentral/v1/funding/{leadId}/check | refresh | poc-approved):
//   catalog, sessionId, opportunityId, status, structured, programs[], replyText,
//   pendingApprovals, checkedAt, checkedBy, pocApproved {at, by, amount, currency, reference} | null
// programs[] = { key: poc|sandbox|map|other, name, eligible: true|false|null, reason,
//                estimatedAmount|null, currency, budgetAvailable|null, draftId|null }
// Drafts only: the account lead submits each draft in Partner Central by hand.

// A check is suggested once a lead is a Hot Lead (or further on, still open), or has an ACE opportunity.
export const FUNDING_SUGGEST_STAGES = ["hot-lead", "demo", "post-demo"];
const ORDER = { poc: 0, sandbox: 1, map: 2, other: 3 };
const DRAFT_PROGRAMS = ["poc", "sandbox"]; // the two flows the console drafts
export const CLAIM_SKILL = "aws-ace-poc-claim";

function ms(v) {
  if (!v) return 0;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? 0 : t;
}
const num = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

export function normaliseFunding(raw) {
  if (!raw || typeof raw !== "object") return null;
  const programs = (Array.isArray(raw.programs) ? raw.programs : []).filter((p) => p && typeof p === "object").map((p) => ({
    key: ORDER[p.key] !== undefined ? p.key : "other",
    name: String(p.name || "Funding programme"),
    eligible: p.eligible === true ? true : p.eligible === false ? false : null,
    reason: String(p.reason || ""),
    estimatedAmount: num(p.estimatedAmount),
    currency: /^[A-Z]{3}$/.test(String(p.currency || "")) ? p.currency : "USD",
    budgetAvailable: num(p.budgetAvailable),
    draftId: p.draftId ? String(p.draftId) : null,
  })).sort((a, b) => ORDER[a.key] - ORDER[b.key]);
  const poc = raw.pocApproved && typeof raw.pocApproved === "object" ? raw.pocApproved : null;
  return {
    catalog: String(raw.catalog || ""), sessionId: String(raw.sessionId || ""), opportunityId: String(raw.opportunityId || ""),
    status: String(raw.status || ""), structured: raw.structured === true, programs,
    replyText: String(raw.replyText || ""), pendingApprovals: Number(raw.pendingApprovals) > 0 ? Math.round(Number(raw.pendingApprovals)) : 0,
    checkedAtMs: ms(raw.checkedAt), checkedBy: String(raw.checkedBy || ""),
    pocApproved: poc ? { atMs: ms(poc.at), by: String(poc.by || ""), amount: num(poc.amount), currency: /^[A-Z]{3}$/.test(String(poc.currency || "")) ? poc.currency : "USD", reference: String(poc.reference || "") } : null,
  };
}

// Whether the lead card shows the AWS funding section, and why a check is suggested.
// { show, suggested, reason } — reason is "Hot Lead" / "<stage>" or "ACE opportunity".
export function fundingSuggestion(lead, funding) {
  const l = lead || {};
  if (l.leadType === "operator") return { show: false, suggested: false, reason: "" };
  const checked = !!(funding && funding.checkedAtMs);
  const ace = !!l.aceOpportunityId;
  const hot = FUNDING_SUGGEST_STAGES.includes(l.stage);
  const reason = ace ? "ACE opportunity" : hot ? (l.stage === "hot-lead" ? "Hot Lead" : "open opportunity") : "";
  const show = !!funding || ((ace || hot) && l.stage !== "closed-lost");
  return { show, suggested: show && !checked && !!reason, reason };
}

export function fundingMoney(n, currency = "USD") {
  if (n === null || n === undefined) return "";
  try { return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(n); } catch { return `${currency} ${Math.round(n)}`; }
}

// One programme's line: the dot tone, the label, and the detail line under it.
// Budget shows only when the agent returned it; amounts are the agent's estimate.
export function programView(p, funding) {
  const tone = p.eligible === true ? "green" : p.eligible === false ? "red" : "amber";
  const label = p.eligible === true ? "Eligible" : p.eligible === false ? "Not eligible" : "Unclear";
  const parts = [];
  if (p.estimatedAmount !== null) parts.push(`Agent estimate ${fundingMoney(p.estimatedAmount, p.currency)}`);
  if (p.budgetAvailable !== null) parts.push(`Budget available ${fundingMoney(p.budgetAvailable, p.currency)}`);
  let draft = "";
  if (DRAFT_PROGRAMS.includes(p.key) && p.eligible !== false) {
    if (p.draftId) draft = `Draft ${p.draftId}: submit it in Partner Central`;
    else if (funding && funding.pendingApprovals) draft = "Draft waits for an admin's approval";
    else if (p.eligible === true) draft = "No draft yet";
  }
  return { tone, label, detail: parts.join(" · "), draft, reason: p.reason };
}

// After the POC is approved, the claim / proof-of-execution sign-off document is due.
export function claimDue(funding) {
  return !!(funding && funding.pocApproved);
}
