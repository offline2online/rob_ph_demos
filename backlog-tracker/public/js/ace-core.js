// Promote › Leads: the rules behind the ACE opportunities table
// (leads-page.js). Pure functions, no DOM and no network, so
// test/ace.test.mjs drives them directly. The rows themselves are built on the
// server from the AWS Partner Central Selling API (functions/partner-central.js
// → normaliseOpportunity), so the table matches what AWS sees.

export const ACE_STAGES = ["Prospect", "Qualified", "Technical Validation", "Business Validation", "Committed", "Launched", "Closed Lost"];
export const ACE_REVIEW_STATUSES = ["Pending Submission", "Submitted", "In review", "Approved", "Rejected", "Action Required"];

const same = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();

// Ordered counts, known values first (in AWS's own order), then anything new.
function countBy(rows, field, known) {
  const counts = new Map(known.map((k) => [k, 0]));
  for (const r of rows) {
    const v = String(r[field] || "").trim() || "Not set";
    const key = [...counts.keys()].find((k) => same(k, v)) || v;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n > 0).map(([label, count]) => ({ label, count }));
}

export function summarise(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return { total: list.length, byStage: countBy(list, "stage", ACE_STAGES), byReview: countBy(list, "reviewStatus", ACE_REVIEW_STATUSES) };
}

const norm = (s) => String(s || "").toLowerCase().replace(/\b(ltd|limited|plc|inc|llc|gmbh|corp|corporation|co|the)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();

// The lead whose company is this opportunity's customer, or null.
export function matchLead(row, leads) {
  const target = norm(row && row.customer);
  if (!target) return null;
  return (leads || []).find((l) => l && l.company && norm(l.company.name) === target) || null;
}

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

// mailto: to the AWS seller, subject naming the opportunity and customer.
export function mailtoFor(row) {
  const email = row && row.awsSeller && String(row.awsSeller.email || "").trim();
  if (!email || !EMAIL.test(email)) return "";
  const name = String(row.name || row.id || "").trim();
  const subject = `${name}${row.customer ? ` – ${row.customer}` : ""}`.trim();
  const first = String(row.awsSeller.name || "").split(" ")[0];
  const body = `Hi ${first || "there"},\n\nA quick question on the ${name || "opportunity"}${row.customer ? ` with ${row.customer}` : ""} in AWS Partner Central.\n`;
  return `mailto:${encodeURIComponent(email).replace(/%40/g, "@")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// Only Partner Central itself.
export function partnerCentralHref(row) {
  const u = row && row.partnerCentralUrl;
  return typeof u === "string" && u.startsWith("https://partnercentral.awspartner.com/") ? u : "";
}

export function formatMonthly(m) {
  if (!m || !Number.isFinite(m.amount)) return "";
  try { return new Intl.NumberFormat("en-GB", { style: "currency", currency: m.currency || "USD", maximumFractionDigits: 0 }).format(m.amount); }
  catch { return `${m.currency || ""} ${Math.round(m.amount)}`.trim(); }
}

export function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return "";
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

// Review-status tone for the status dot: green approved, amber in progress, red needs a person.
export function reviewTone(status) {
  const s = String(status || "").toLowerCase();
  if (s === "approved") return "ok";
  if (s === "action required" || s === "rejected") return "bad";
  if (s === "pending submission" || s === "submitted" || s === "in review") return "warn";
  return "none";
}

// A target close date strictly before today (UTC date compare), so the current day is not overdue.
export function isPastDate(iso, now = new Date()) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(iso || ""));
  return !!m && m[1] < new Date(now).toISOString().slice(0, 10);
}

// The four KPI cards: count, expected monthly revenue (one total per currency), approved, needs action.
export function kpis(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const totals = new Map();
  for (const r of list) {
    const m = r && r.expectedMonthly;
    if (!m || !Number.isFinite(m.amount)) continue;
    const cur = m.currency || "USD";
    totals.set(cur, (totals.get(cur) || 0) + m.amount);
  }
  return {
    total: list.length,
    revenue: [...totals.entries()].map(([currency, amount]) => ({ currency, amount })),
    approved: list.filter((r) => reviewTone(r.reviewStatus) === "ok").length,
    needsAction: list.filter((r) => reviewTone(r.reviewStatus) === "bad").length,
  };
}

// ── Editing an opportunity in the console (ace-detail.js) ─────────────────
// The fields the dialog edits, in the order shown. The server validates again
// (functions/partner-central.js → sanitiseAceInput).
export const ACE_EDIT_FIELDS = ["name", "customer", "stage", "targetCloseDate", "nextSteps", "description", "website", "monthlyAmount", "currency"];

export function formValues(row) {
  const r = row || {};
  const m = r.expectedMonthly;
  return {
    name: r.name || "", customer: r.customer || "", stage: r.stage || "", targetCloseDate: r.targetCloseDate || "",
    nextSteps: r.nextSteps || "", description: r.description || "", website: r.website || "",
    monthlyAmount: m && Number.isFinite(m.amount) ? String(m.amount) : "", currency: (m && m.currency) || "USD",
  };
}

// Only the fields the person changed, so a save never rewrites what they did not touch.
export function changedValues(original, current) {
  const out = {};
  for (const k of ACE_EDIT_FIELDS) if (String(original[k] == null ? "" : original[k]).trim() !== String(current[k] == null ? "" : current[k]).trim()) out[k] = String(current[k] == null ? "" : current[k]).trim();
  return out;
}

// Messages for the dialog's status line; empty when the values can be sent.
export function validateForm(values, { creating = false } = {}) {
  const v = values || {};
  const errors = [];
  if (!String(v.name || "").trim() || !String(v.customer || "").trim()) errors.push(creating ? "Enter a title and customer." : "An opportunity needs a title and a customer.");
  if (v.targetCloseDate && !/^\d{4}-\d{2}-\d{2}$/.test(v.targetCloseDate)) errors.push("Expected delivery date must be a date.");
  if (v.monthlyAmount !== "" && v.monthlyAmount != null && !(Number(v.monthlyAmount) >= 0)) errors.push("Monthly AWS revenue must be a number.");
  return errors;
}

// "Saved to AWS ACE", with the score AWS now holds.
export function savedMessage(row, verb = "Saved to AWS ACE") {
  const s = row && row.score;
  return `${verb}. ${s != null && s !== "" ? `Score ${s}.` : "Score not available yet."}`;
}

// Documents stay in the console (the Selling API cannot attach files).
export const ACE_DOC_MAX = 50 * 1024 * 1024;
const DOC_TYPES = {
  pdf: "application/pdf", zip: "application/zip", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
export const ACE_DOC_ACCEPT = Object.keys(DOC_TYPES).map((e) => `.${e}`).join(",");

// { ok, contentType } or { ok:false, error } for a chosen file.
export function checkDocument(file) {
  if (!file) return { ok: false, error: "Choose a file." };
  const ext = (String(file.name || "").split(".").pop() || "").toLowerCase();
  const contentType = DOC_TYPES[ext];
  if (!contentType) return { ok: false, error: "Attach a PDF, Office file, image or zip." };
  if (file.size > ACE_DOC_MAX) return { ok: false, error: "That file is over 50 MB." };
  if (!(file.size > 0)) return { ok: false, error: "That file is empty." };
  return { ok: true, contentType };
}

export const docFileName = (name) => String(name || "document").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "").slice(-120) || "document";
// Storage keeps "<timestamp>-<name>"; show the name.
export const docDisplayName = (stored) => String(stored || "").replace(/^\d{10,}-/, "");

export function formatDateTime(iso) {
  const t = Date.parse(String(iso || ""));
  return Number.isFinite(t) ? formatDate(new Date(t).toISOString()) : "";
}
