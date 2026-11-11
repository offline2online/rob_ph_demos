// Promote › Prospects (TAM) › company detail view: the data rules behind
// prospect-detail.js (the page) and the compact block on a Leads card
// (leads-page.js). Pure functions only: no DOM, no Firestore, so
// test/prospect-detail.test.mjs drives them directly.
//
// The detail belongs to the COMPANY, not to one country record. Prospects are one
// record per company per country (ALDI · Australia, ALDI · Netherlands), so the
// org chart, the AWS team, the ACE opportunity and the document library live once
// in `prospectCompanies/{companyDocId(name)}` and every country record of that
// company (and its lead) reads and writes the same document. The per-country
// `prospects/{id}` record keeps its own fields (country, status, priority,
// stores, contacts, insights, awsAccountId). The document is:
//   name      the company's display name
//   profile   { summary, logoUrl, techStack[], primaryCloud, emailFormats[],
//               productsOfInterest[], latestNews, staffOwner, lastResearchedAt }
//   people[]  the org chart: { id, name, title, photoUrl, reportsTo (a person id or ""), buyingRole,
//               email, awsAccountId (12 digits or ""), engagement[] }   (up to 100)
//   awsTeam[] { id, name, role, email, dealRole, engages[] (person ids), source: "ace" | "manual" }  (up to 30)
//   aceOpportunity  { id, sellerName, sellerEmail } | null, the ACE opportunity this company is on;
//               its seller is the AWS account manager row, filled in by awsTeamWithAce()
//   documents[] { id, title, kind, version, date, url, tags[], sharedWith[{ name, email, aws, at }] }  (up to 100)
// Existing vendors and the AWS account ID stay on the country record; the profile shows them.
import { BUYING_ROLES, BUYING_ROLE_KEYS, roleLabel, normaliseAwsAccountId } from "./leads-core.js";
import { slugId } from "./prospects-core.js";

export { BUYING_ROLES, roleLabel, normaliseAwsAccountId };

// The document id of a company's shared detail: companyKey(name), the lower-case
// letters and digits of the name (cut at 60 characters like a prospect's id).
// "" when the name has no letters or digits, and then there is nowhere to keep it.
export const companyDocId = (name) => slugId(name);
export const COMPANY_COLLECTION = "prospectCompanies";

export const AWS_ROLES = [
  { key: "account-manager", label: "AWS account manager" },
  { key: "solutions-architect", label: "Solutions architect" },
  { key: "pdm", label: "Partner development manager" },
  { key: "specialist", label: "Specialist" },
];
export const AWS_ROLE_KEYS = AWS_ROLES.map((r) => r.key);
export const awsRoleLabel = (key) => (AWS_ROLES.find((r) => r.key === key) || { label: "AWS team" }).label;

export const ENGAGEMENTS = [
  { key: "demo", label: "Demo" },
  { key: "calculator", label: "Calculator download" },
  { key: "website", label: "Website form" },
  { key: "meeting", label: "Meeting" },
];
export const ENGAGEMENT_KEYS = ENGAGEMENTS.map((e) => e.key);
export const engagementLabel = (key) => (ENGAGEMENTS.find((e) => e.key === key) || { label: String(key || "") }).label;

export const DOC_KINDS = [
  { key: "industry-one-pager", label: "Industry one-pager" },
  { key: "prospect-pack", label: "Prospect pack" },
  { key: "deck", label: "Deck" },
  { key: "business-case", label: "Business case" },
  { key: "funding", label: "Funding document" },
  { key: "other", label: "Other" },
];
export const DOC_KIND_KEYS = DOC_KINDS.map((k) => k.key);
export const docKindLabel = (key) => (DOC_KINDS.find((k) => k.key === key) || { label: "Other" }).label;

export const LIMITS = { people: 100, awsTeam: 30, documents: 100, shared: 20, list: 40, text: 200, summary: 2000, news: 1000, url: 500, tag: 40, tags: 12 };

const str = (v, max) => String(v == null ? "" : v).trim().slice(0, max);
const list = (v, max = LIMITS.text, cap = LIMITS.list) => {
  const parts = Array.isArray(v) ? v : String(v == null ? "" : v).split(/[,;\n]/);
  const seen = new Set();
  const out = [];
  for (const p of parts) { const s = str(p, max); if (s && !seen.has(s.toLowerCase())) { seen.add(s.toLowerCase()); out.push(s); } }
  return out.slice(0, cap);
};
// Only web addresses are kept: a stored "javascript:" link would run when clicked.
export function safeHttpUrl(v) {
  const s = str(v, LIMITS.url);
  if (!s) return "";
  try { const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`); return u.protocol === "https:" || u.protocol === "http:" ? u.href : ""; } catch { return ""; }
}
export const isEmail = (v) => /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(String(v || "").trim());
const email = (v) => { const s = str(v, 200).toLowerCase(); return isEmail(s) ? s : ""; };
const isoDay = (v) => { const s = str(v, 30); const t = Date.parse(s); return s && !Number.isNaN(t) ? new Date(t).toISOString().slice(0, 10) : ""; };
const idOf = (v, prefix, n) => str(v, 40).replace(/[^A-Za-z0-9_-]/g, "") || `${prefix}${n}`;

export function mailto(address, subject) {
  const a = email(address);
  return a ? `mailto:${a}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}` : "";
}
export function initials(name) {
  const parts = str(name, 80).split(/[\s._-]+/).filter(Boolean);
  return ((parts[0] || "?")[0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

// ── Normalising what is stored (tolerant of anything an older writer left out)
export function cleanPerson(p, i) {
  const x = p || {};
  return {
    id: idOf(x.id, "p", i),
    name: str(x.name, 120),
    title: str(x.title, 120),
    photoUrl: safeHttpUrl(x.photoUrl),
    reportsTo: str(x.reportsTo, 40),
    buyingRole: BUYING_ROLE_KEYS.includes(x.buyingRole) ? x.buyingRole : "",
    email: email(x.email),
    awsAccountId: normaliseAwsAccountId(x.awsAccountId) || "",
    engagement: (Array.isArray(x.engagement) ? x.engagement : []).filter((e) => ENGAGEMENT_KEYS.includes(e)).filter((e, k, a) => a.indexOf(e) === k),
  };
}
export function cleanAwsMember(m, i) {
  const x = m || {};
  return {
    id: idOf(x.id, "a", i),
    name: str(x.name, 120),
    role: AWS_ROLE_KEYS.includes(x.role) ? x.role : "specialist",
    email: email(x.email),
    dealRole: str(x.dealRole, LIMITS.text),
    engages: list(x.engages, 40, LIMITS.people),
    source: x.source === "ace" ? "ace" : "manual",
  };
}
export function cleanDocument(d, i) {
  const x = d || {};
  const v = Number(x.version);
  return {
    id: idOf(x.id, "d", i),
    title: str(x.title, 160),
    kind: DOC_KIND_KEYS.includes(x.kind) ? x.kind : "other",
    version: Number.isFinite(v) && v >= 1 ? Math.min(Math.floor(v), 999) : 1,
    date: isoDay(x.date),
    url: safeHttpUrl(x.url),
    tags: list(x.tags, LIMITS.tag, LIMITS.tags),
    sharedWith: (Array.isArray(x.sharedWith) ? x.sharedWith : []).slice(0, LIMITS.shared).map((s) => ({
      name: str(s && s.name, 120), email: email(s && s.email), aws: !!(s && s.aws), at: isoDay(s && s.at),
    })).filter((s) => s.name || s.email),
  };
}
export function cleanProfile(p) {
  const x = p || {};
  return {
    summary: str(x.summary, LIMITS.summary),
    logoUrl: safeHttpUrl(x.logoUrl),
    techStack: list(x.techStack),
    primaryCloud: str(x.primaryCloud, 60),
    emailFormats: list(x.emailFormats, 80, 10),
    productsOfInterest: list(x.productsOfInterest),
    latestNews: str(x.latestNews, LIMITS.news),
    staffOwner: str(x.staffOwner, 200),
    lastResearchedAt: isoDay(x.lastResearchedAt),
  };
}
export function cleanAce(a) {
  if (!a || typeof a !== "object") return null;
  const sellerName = str(a.sellerName, 120), sellerEmail = email(a.sellerEmail);
  if (!sellerName && !sellerEmail) return null;
  return { id: str(a.id, 80), sellerName, sellerEmail };
}

// The four extra keys of a stored prospect document, normalised.
export function normaliseDetail(d) {
  const x = d || {};
  const people = (Array.isArray(x.people) ? x.people : []).slice(0, LIMITS.people).map(cleanPerson).filter((p) => p.name);
  // Ids stay unique; a manager that is not in the chart leaves the person at the top.
  const seen = new Set();
  for (const p of people) { let id = p.id, n = 1; while (seen.has(id)) id = `${p.id}-${++n}`; p.id = id; seen.add(id); }
  for (const p of people) if (p.reportsTo === p.id || !seen.has(p.reportsTo)) p.reportsTo = "";
  return {
    profile: cleanProfile(x.profile),
    people,
    awsTeam: (Array.isArray(x.awsTeam) ? x.awsTeam : []).slice(0, LIMITS.awsTeam).map(cleanAwsMember).filter((m) => m.name),
    aceOpportunity: cleanAce(x.aceOpportunity),
    documents: (Array.isArray(x.documents) ? x.documents : []).slice(0, LIMITS.documents).map(cleanDocument).filter((d) => d.title),
  };
}

// ── Org chart ───────────────────────────────────────────────────────────────
// A reporting tree. Everyone with no (valid) manager is a root; a loop in the
// data (A reports to B, B to A) is broken by promoting one member of it to a
// root, so every person appears exactly once.
export function buildTree(people) {
  const byId = new Map(people.map((p) => [p.id, { ...p, children: [] }]));
  const roots = [];
  const reaches = (start, target) => { // does following reportsTo from start meet target?
    const seen = new Set();
    for (let id = start; id && byId.has(id) && !seen.has(id); id = byId.get(id).reportsTo) { if (id === target) return true; seen.add(id); }
    return false;
  };
  for (const node of byId.values()) {
    const parent = node.reportsTo && byId.get(node.reportsTo);
    if (!parent || reaches(parent.id, node.id)) roots.push(node); else parent.children.push(node);
  }
  return roots;
}
export function countRoles(people) {
  const out = {};
  for (const r of BUYING_ROLE_KEYS) out[r] = 0;
  for (const p of people) if (p.buyingRole) out[p.buyingRole] += 1;
  return out;
}

// ── Lead overlay ────────────────────────────────────────────────────────────
// A person is a lead contact when the linked lead has a contact with the same
// email, or (no email on either) the same name. Their engagement is what is
// recorded on the person, plus "Demo" when the lead has reached the demo stage.
const norm = (s) => String(s || "").trim().toLowerCase();
export function leadOverlay(people, lead) {
  const contacts = lead && Array.isArray(lead.contacts) ? lead.contacts : [];
  const stageDemo = !!lead && (lead.stage === "demo" || lead.stage === "post-demo" || lead.stage === "closed-won");
  const out = new Map();
  for (const p of people) {
    const c = contacts.find((k) => (p.email && norm(k.email) === p.email) || (!p.email && !k.email && norm(k.name) && norm(k.name) === norm(p.name)));
    const engagement = [...p.engagement];
    if (c && stageDemo && !engagement.includes("demo")) engagement.push("demo");
    out.set(p.id, { isLead: !!c, engagement });
  }
  return out;
}
// What is missing, in plain words. `overlay` comes from leadOverlay().
export function leadGaps(people, overlay) {
  const gaps = [];
  if (!people.length) return gaps;
  const engaged = people.filter((p) => { const o = overlay.get(p.id); return o && (o.isLead || o.engagement.length); });
  if (!engaged.length) gaps.push("No one at this company has engaged yet.");
  else if (!engaged.some((p) => p.buyingRole === "decision-maker")) gaps.push("No decision maker engaged yet.");
  if (!people.some((p) => p.buyingRole === "decision-maker")) gaps.push("No decision maker identified in the org chart.");
  return gaps;
}

// ── AWS account team ────────────────────────────────────────────────────────
// The ACE opportunity's seller is the AWS account manager. It is added as an
// "ace" row when the team does not already have that person, and refreshed
// (not duplicated) when it does; a manual row for the same email wins.
export function awsTeamWithAce(team, ace) {
  const out = team.map((m) => ({ ...m }));
  const a = cleanAce(ace);
  if (!a) return out;
  const same = out.find((m) => (a.sellerEmail && m.email === a.sellerEmail) || (!a.sellerEmail && norm(m.name) === norm(a.sellerName)));
  if (same) { if (same.source === "ace") { same.name = a.sellerName || same.name; same.role = "account-manager"; } return out; }
  out.unshift({ id: "ace-seller", name: a.sellerName || a.sellerEmail, role: "account-manager", email: a.sellerEmail, dealRole: "Assigned seller on the ACE opportunity", engages: [], source: "ace" });
  return out;
}
// Who each AWS person is engaging: member id -> the people they work with.
export function awsEngagement(team, people) {
  const byId = new Map(people.map((p) => [p.id, p]));
  return new Map(team.map((m) => [m.id, m.engages.map((id) => byId.get(id)).filter(Boolean)]));
}

// ── Documents ───────────────────────────────────────────────────────────────
// Newest first; versions of one document (same title and kind) are grouped,
// latest version first, so the library shows the current one with its history.
export function groupDocuments(docs) {
  const groups = new Map();
  for (const d of docs) {
    const key = `${d.kind}|${norm(d.title)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(d);
  }
  const out = [...groups.values()].map((g) => g.slice().sort((a, b) => b.version - a.version || b.date.localeCompare(a.date)));
  return out.sort((a, b) => b[0].date.localeCompare(a[0].date) || a[0].title.localeCompare(b[0].title));
}
export function nextVersion(docs, title, kind) {
  const same = docs.filter((d) => d.kind === kind && norm(d.title) === norm(title));
  return same.reduce((m, d) => Math.max(m, d.version), 0) + 1;
}
export const sharedWithAws = (d) => d.sharedWith.some((s) => s.aws);

// ── Compact view for a lead card ────────────────────────────────────────────
export function compactSummary(detail, lead) {
  const people = detail.people;
  const overlay = leadOverlay(people, lead);
  const team = awsTeamWithAce(detail.awsTeam, detail.aceOpportunity);
  const roles = countRoles(people);
  return {
    peopleCount: people.length,
    roles: BUYING_ROLES.filter((r) => roles[r.key]).map((r) => ({ key: r.key, label: r.label, count: roles[r.key] })),
    gaps: leadGaps(people, overlay),
    aws: team.slice(0, 4).map((m) => ({ name: m.name, role: awsRoleLabel(m.role), email: m.email })),
    awsMore: Math.max(0, team.length - 4),
    empty: !people.length && !team.length,
  };
}

// ── An AWS person attached to a customer account (10 Nov 2026) ──────────────
// Someone from AWS comes in as a contact on the AWS record (Leads › AWS tile);
// staff then attach them to a customer company as part of its AWS account
// team. The same person (email, else name) is not added twice: attaching again
// only changes their role. Returns { team, added } or { error }.
export function withAwsPerson(team, person, role) {
  const list = (team || []).map(cleanAwsMember);
  const p = person || {};
  const em = email(p.email);
  const name = str(p.name, 120);
  const r = AWS_ROLE_KEYS.includes(role) ? role : "account-manager";
  if (!name) return { error: "This AWS contact has no name." };
  const i = list.findIndex((m) => (em ? m.email === em : m.name.toLowerCase() === name.toLowerCase()));
  if (i >= 0) { list[i] = { ...list[i], role: r }; return { team: list, added: false }; }
  if (list.length >= LIMITS.awsTeam) return { error: `An account's AWS team holds up to ${LIMITS.awsTeam} people.` };
  return { team: [...list, cleanAwsMember({ id: `a${Date.now().toString(36)}${list.length}`, name, email: em, role: r, dealRole: "", engages: [], source: "manual" }, list.length)], added: true };
}

// ── What an editor's save writes ────────────────────────────────────────────
// Re-cleans everything, so nothing the form held can reach the document in a
// shape the rules would refuse.
export function detailForSave(detail) {
  const d = normaliseDetail(detail);
  return { profile: d.profile, people: d.people, awsTeam: d.awsTeam, aceOpportunity: d.aceOpportunity, documents: d.documents };
}
