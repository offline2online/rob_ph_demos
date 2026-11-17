// Promote › Prospects (TAM) › Contacts: the pure rules (no Firebase, tested in
// test/prospect-contacts.test.mjs). Companies and contacts, the usual CRM
// model: a contact is one person, stored once in prospectContacts/{id}, linked
// to the TAM company (prospects/{id}, a company in a country) they work for, or
// "Unmatched" until someone links them.
//
// One person, one record: the LinkedIn profile URL is the identity. A profile
// URL is normalised to https://www.linkedin.com/in/<slug>/ and a contact that
// has one is stored under the id "li-<slug>", so adding the same profile twice
// (the Chrome extension clicked twice, a pasted URL, two tabs) writes the same
// document and updates it instead of creating a second one.
//
// The contacts from the TAM spreadsheet arrived on the company records
// themselves (prospects/{id}.contacts[], name | role | last contact). They are
// copied into the collection once each, under "tam-<prospectId>-<name>", so
// importing again adds only what is new (seedContacts).
import { companyKey, slugId } from "./prospects-core.js";

export const CONTACTS_COLLECTION = "prospectContacts";
export const UNMATCHED = "__unmatched__";
export const SOURCES = {
  spreadsheet: "TAM spreadsheet",
  manual: "Added by hand",
  url: "LinkedIn URL",
  extension: "Chrome extension",
};
export const LIMITS = { name: 120, role: 200, companyName: 120, email: 200, notes: 2000, lastContact: 80, source: 80, linkedinUrl: 300 };

const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
export const isEmail = (v) => /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(String(v || "").trim());

// A LinkedIn person's profile URL → "https://www.linkedin.com/in/<slug>/".
// "" for an empty value, null for anything that is not a profile (a company
// page, a search, another site). Accepts a country subdomain (uk.linkedin.com),
// no scheme, a query or hash, and a deeper path (/in/jo/details/experience/).
export function normaliseLinkedInProfileUrl(v) {
  const raw = String(v == null ? "" : v).trim();
  if (!raw) return "";
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase();
  if (host !== "linkedin.com" && !/^[a-z]{2,3}\.linkedin\.com$/.test(host) && host !== "www.linkedin.com") return null;
  const m = u.pathname.match(/^\/in\/([^/]+)/i);
  if (!m) return null;
  let slug;
  try { slug = decodeURIComponent(m[1]); } catch { slug = m[1]; }
  slug = slug.trim().toLowerCase();
  if (!slug || slug.length > 100 || /[\s/?#]/.test(slug)) return null;
  return `https://www.linkedin.com/in/${encodeURIComponent(slug)}/`;
}
const slugOf = (url) => { const m = String(url || "").match(/\/in\/([^/]+)\/$/); if (!m) return ""; try { return decodeURIComponent(m[1]); } catch { return m[1]; } };

// The document id for a contact with a LinkedIn profile: stable, so the same profile is the same document.
export function contactIdForLinkedIn(url) {
  const n = normaliseLinkedInProfileUrl(url);
  if (!n) return "";
  const s = slugOf(n).normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
  return s ? `li-${s}` : "";
}
// The id for a contact imported from a company record's contacts list.
export function seedContactId(prospectId, name) {
  const p = String(prospectId || "").replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 100);
  const n = slugId(name);
  return p && n ? `tam-${p}-${n}` : "";
}

// A best guess at the person's name from the profile URL's slug ("jo-bloggs-1a2b3c" → "Jo Bloggs"), to prefill the form.
export function nameFromLinkedInUrl(url) {
  const n = normaliseLinkedInProfileUrl(url);
  if (!n) return "";
  const parts = slugOf(n).split("-").filter(Boolean);
  while (parts.length > 1 && /\d/.test(parts[parts.length - 1])) parts.pop();
  if (parts.some((p) => /\d/.test(p))) return "";
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ").slice(0, LIMITS.name);
}

// ── Matching a company name to a TAM company ────────────────────────────────
// Legal and filler words that don't tell two companies apart.
const NOISE = new Set("the group plc ltd limited inc incorporated llc corp corporation co company pty gmbh ag sa nv bv ab as spa holdings holding international retail stores uk and".split(" ")); // one string, so no word reads as an icon name to icon-font.test.mjs
const words = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").split(/[^a-z0-9]+/).filter(Boolean);
export const coreName = (s) => words(s).filter((w) => !NOISE.has(w)).join("");
// Of several country records of one company, the head-office one, then the first by country.
function pickRecord(list) {
  return list.slice().sort((a, b) => {
    const ha = companyKey(a.country) && companyKey(a.country) === companyKey(a.hqCountry) ? 0 : 1;
    const hb = companyKey(b.country) && companyKey(b.country) === companyKey(b.hqCountry) ? 0 : 1;
    return ha - hb || String(a.country || "").localeCompare(String(b.country || "")) || String(a.id).localeCompare(String(b.id));
  })[0] || null;
}
// The TAM record a company name (as LinkedIn or a person wrote it) belongs to, or null.
// Exact name first, then the name without legal words ("Tesco PLC" = "Tesco"), then one
// name inside the other as whole words of at least 4 letters ("Aldi" in "Aldi Süd").
export function matchProspect(companyName, prospects) {
  const list = (Array.isArray(prospects) ? prospects : []).filter((p) => p && p.id && p.name);
  const key = companyKey(companyName);
  if (!key) return null;
  const exact = list.filter((p) => companyKey(p.name) === key);
  if (exact.length) return pickRecord(exact);
  const core = coreName(companyName);
  if (!core) return null;
  const same = list.filter((p) => coreName(p.name) === core);
  if (same.length) return pickRecord(same);
  if (core.length < 4) return null;
  // One name inside the other, at a word boundary ("Aldi" in "Aldi Süd", "Schwarz Group (Lidl)" holds "Lidl").
  const inside = list.filter((p) => {
    const pw = words(p.name).filter((w) => !NOISE.has(w)), cw = words(companyName).filter((w) => !NOISE.has(w));
    if (!pw.length || !cw.length) return false;
    const pj = ` ${pw.join(" ")} `, cj = ` ${cw.join(" ")} `;
    const short = pw.join("").length <= cw.join("").length ? pj : cj, long = short === pj ? cj : pj;
    return short.replace(/ /g, "").length >= 4 && long.includes(short);
  });
  return inside.length ? pickRecord(inside) : null;
}

// ── Records ─────────────────────────────────────────────────────────────────
const tsIso = (v) => {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (typeof v.toDate === "function") { try { return v.toDate().toISOString(); } catch { return ""; } }
  if (v instanceof Date) return v.toISOString();
  if (typeof v.seconds === "number") return new Date(v.seconds * 1000).toISOString();
  return "";
};
export function normaliseContact(id, d) {
  const x = d && typeof d === "object" ? d : {};
  return {
    id: String(id || ""),
    name: str(x.name, LIMITS.name),
    role: str(x.role, LIMITS.role),
    companyName: str(x.companyName, LIMITS.companyName),
    prospectId: str(x.prospectId, 100),
    companyKey: str(x.companyKey, 60),
    linkedinUrl: normaliseLinkedInProfileUrl(x.linkedinUrl) || "",
    email: isEmail(x.email) ? String(x.email).trim().toLowerCase() : "",
    notes: String(x.notes == null ? "" : x.notes).slice(0, LIMITS.notes),
    lastContact: str(x.lastContact, LIMITS.lastContact),
    source: str(x.source, LIMITS.source),
    removed: x.removed === true,
    createdAt: tsIso(x.createdAt),
    updatedAt: tsIso(x.updatedAt),
  };
}
export const isUnmatched = (c) => !c.prospectId;

// The fields to store from a form, a pasted URL or the extension: { fields, errors }.
// `prospect` is the TAM record picked (or matched), null for Unmatched.
export function contactFromInput(input, prospect) {
  const x = input && typeof input === "object" ? input : {};
  const errors = [];
  const name = str(x.name, LIMITS.name);
  if (!name) errors.push("Enter the contact's name.");
  const li = normaliseLinkedInProfileUrl(x.linkedinUrl);
  if (li === null) errors.push("The LinkedIn URL must be a person's profile, like https://www.linkedin.com/in/their-name/.");
  const emailRaw = String(x.email == null ? "" : x.email).trim();
  if (emailRaw && !isEmail(emailRaw)) errors.push("The email isn't a valid address.");
  const fields = {
    name,
    role: str(x.role, LIMITS.role),
    companyName: prospect ? str(prospect.name, LIMITS.companyName) : str(x.companyName, LIMITS.companyName),
    prospectId: prospect ? String(prospect.id) : "",
    companyKey: prospect ? slugId(prospect.name) : "",
    linkedinUrl: li || "",
    email: emailRaw && isEmail(emailRaw) ? emailRaw.toLowerCase().slice(0, LIMITS.email) : "",
    notes: String(x.notes == null ? "" : x.notes).trim().slice(0, LIMITS.notes),
    source: str(x.source, LIMITS.source),
  };
  if (x.lastContact != null) fields.lastContact = str(x.lastContact, LIMITS.lastContact);
  return { fields, errors };
}

// The contact already on file for this person, if any: the same LinkedIn profile,
// else (for a record with no profile yet) the same name at the same company.
export function findExisting(contacts, { linkedinUrl, name, companyKey: ck }) {
  const list = Array.isArray(contacts) ? contacts : [];
  const li = normaliseLinkedInProfileUrl(linkedinUrl);
  if (li) {
    const byUrl = list.find((c) => c.linkedinUrl === li);
    if (byUrl) return byUrl;
  }
  const nk = companyKey(name);
  if (!nk || !ck) return null;
  return list.find((c) => !c.linkedinUrl && c.companyKey === ck && companyKey(c.name) === nk) || null;
}

// The contacts on the TAM records (the spreadsheet import) that are not in the collection yet.
// `existingIds` holds every id in the collection, removed ones included, so a removed contact stays removed.
export function seedContacts(prospects, existingIds) {
  const have = existingIds instanceof Set ? existingIds : new Set(existingIds || []);
  const out = [];
  for (const p of Array.isArray(prospects) ? prospects : []) {
    for (const c of Array.isArray(p && p.contacts) ? p.contacts : []) {
      const id = seedContactId(p.id, c && c.name);
      if (!id || have.has(id)) continue;
      have.add(id);
      const r = contactFromInput({ name: c.name, role: c.role, email: c.email, lastContact: c.lastContact || "", source: SOURCES.spreadsheet }, p);
      if (r.errors.length) continue;
      out.push({ id, fields: r.fields });
    }
  }
  return out;
}

// What the Chrome extension read off a LinkedIn profile → the form's input.
export function inputFromExtension(payload) {
  const x = payload && typeof payload === "object" ? payload : {};
  return {
    name: str(x.name, LIMITS.name),
    role: str(x.headline, LIMITS.role),
    companyName: str(x.company, LIMITS.companyName),
    linkedinUrl: String(x.url || x.linkedinUrl || ""),
    source: SOURCES.extension,
  };
}

// The list: not removed, matching the search (name, role, company, email) and the company filter
// ("" all, UNMATCHED, or a company key). Newest first unless the grid sorts it.
export function filterContacts(contacts, { q = "", company = "" } = {}) {
  const needle = String(q || "").trim().toLowerCase();
  return (Array.isArray(contacts) ? contacts : []).filter((c) => {
    if (c.removed) return false;
    if (company === UNMATCHED && !isUnmatched(c)) return false;
    if (company && company !== UNMATCHED && c.companyKey !== company) return false;
    if (!needle) return true;
    return [c.name, c.role, c.companyName, c.email].some((v) => String(v || "").toLowerCase().includes(needle));
  });
}
// A company's contacts, for its record.
export const contactsForCompany = (contacts, ck) => (ck ? (Array.isArray(contacts) ? contacts : []).filter((c) => !c.removed && c.companyKey === ck).sort((a, b) => a.name.localeCompare(b.name)) : []);

// The company filter's options: Unmatched, then every company that has a contact, by name.
export function companyOptions(contacts) {
  const seen = new Map();
  for (const c of Array.isArray(contacts) ? contacts : []) if (!c.removed && c.companyKey && !seen.has(c.companyKey)) seen.set(c.companyKey, c.companyName || c.companyKey);
  return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
}

export const fmtAdded = (iso) => { const t = Date.parse(iso); return Number.isNaN(t) ? "" : new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); };
