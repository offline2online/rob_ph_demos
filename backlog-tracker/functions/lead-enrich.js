"use strict";
// Promote › Leads: enrichment (the page's "Enrich" button).
//
//   POST /leadEnrich/v1/enrich   {leadId}     editor or admin, ID token in X-Firebase-ID-Token
//
// Looks the company's website up in two places and writes what it finds back
// onto the lead and its contacts:
//   • the website itself (title, description, the company's LinkedIn page);
//   • a technology-lookup service (tech stack, company details and named
//     contacts) when its key is stored under Settings → Integrations & MCP.
//     Without the key that source reports "not configured" and the run still
//     finishes with the first.
// A figure a person typed is never overwritten; only blanks are filled.
//
// Pure module: index.js injects Firestore, token checking, the key store and
// DNS, so test/lead-enrich.test.js runs it with no network and no credentials.
const dns = require("dns").promises;
const net = require("net");
const core = require("./leads-core");
const mediaKeys = require("./media-keys");

const ROLE_RANK = { viewer: 1, editor: 2, admin: 3 };
const FETCH_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 400 * 1024;

// ── Only ever call public addresses ──────────────────────────────────────
function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb")) return true;
    const m = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return m ? isPrivateAddress(m[1]) : false;
  }
  return true;
}

function hostOf(website) {
  try { return new URL(website).hostname.replace(/^www\./, ""); } catch { return ""; }
}

const entity = (s) => String(s || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();

// Title, description and the company LinkedIn page out of a home page.
function readPage(html) {
  const h = String(html || "");
  const title = entity((h.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
  const metas = [...h.matchAll(/<meta\s[^>]*>/gi)].map((m) => m[0]);
  const meta = (name) => {
    for (const tag of metas) {
      const n = (tag.match(/(?:name|property)\s*=\s*["']([^"']+)["']/i) || [])[1];
      if (n && n.toLowerCase() === name) return entity((tag.match(/content\s*=\s*["']([^"']*)["']/i) || [])[1]);
    }
    return "";
  };
  const description = meta("description") || meta("og:description");
  const li = (h.match(/https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/company\/[A-Za-z0-9._%-]+/i) || [])[0] || "";
  return { title: title.slice(0, 200), description: description.slice(0, 400), linkedinCompany: li };
}

function regionName(code) {
  const c = String(code || "").trim();
  if (c.length !== 2) return c.length > 2 ? c : "";
  try { return new Intl.DisplayNames(["en"], { type: "region" }).of(c.toUpperCase()) || ""; } catch { return ""; }
}

// BuiltWith-shaped answer -> { techStack[], company{}, people[] }.
function readTechLookup(json) {
  const r = (json && Array.isArray(json.Results) && json.Results[0]) || {};
  const names = new Set();
  const paths = (r.Result && Array.isArray(r.Result.Paths)) ? r.Result.Paths : [];
  for (const p of paths) for (const t of (p.Technologies || [])) if (t && t.Name) names.add(String(t.Name));
  const meta = r.Meta || {};
  const country = regionName(meta.Country);
  return {
    techStack: [...names].sort((a, b) => a.localeCompare(b)).slice(0, 80),
    company: { name: String(meta.CompanyName || ""), industry: String(meta.Vertical || ""), countries: country ? [country] : [] },
    people: (Array.isArray(meta.Names) ? meta.Names : []).map((n) => ({ name: String((n && n.Name) || ""), title: String((n && n.Type) || ""), email: String((n && n.Email) || "") })).filter((p) => p.name),
  };
}

function createLeadEnrich({ db, verifyIdToken, resolveConsoleUser, encKey, fetch: fetchImpl = globalThis.fetch, lookup = (h) => dns.lookup(h, { all: true }), logger = console, now = () => new Date() }) {
  const send = (res, status, body) => res.status(status).set("Cache-Control", "no-store").json(body);

  async function requireEditor(req) {
    const idToken = String(req.get("x-firebase-id-token") || "");
    if (!idToken) return { ok: false, status: 401, error: "sign in first" };
    let decoded;
    try { decoded = await verifyIdToken(idToken); } catch { return { ok: false, status: 401, error: "invalid sign-in" }; }
    const user = await resolveConsoleUser(decoded.email);
    if (!user) return { ok: false, status: 403, error: "not on the console user list" };
    if ((ROLE_RANK[user.role] || 0) < ROLE_RANK.editor) return { ok: false, status: 403, error: "viewers can't enrich leads" };
    return { ok: true, user };
  }

  async function assertPublicHost(host) {
    if (net.isIP(host)) { if (isPrivateAddress(host)) throw new Error("that address isn't public"); return; }
    const addrs = await lookup(host);
    if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error("that address isn't public");
  }

  // GET with a timeout, a size cap and a public-address check on every hop.
  async function safeGet(url, headers) {
    let current = url;
    for (let hop = 0; hop < 4; hop++) {
      const u = new URL(current);
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("not a web address");
      await assertPublicHost(u.hostname);
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
      try {
        const r = await fetchImpl(current, { headers: { "User-Agent": "PH-Console-LeadEnrich/1.0", ...(headers || {}) }, redirect: "manual", signal: ctl.signal });
        if (r.status >= 300 && r.status < 400 && r.headers.get("location")) { current = new URL(r.headers.get("location"), current).href; continue; }
        return { status: r.status, ok: r.ok, text: async () => String(await r.text()).slice(0, MAX_HTML_BYTES), json: () => r.json() };
      } finally { clearTimeout(timer); }
    }
    throw new Error("too many redirects");
  }

  async function techKey() {
    const key = mediaKeys.keyBytes(encKey());
    if (!key) return null;
    const snap = await db.collection(mediaKeys.COLLECTION).doc("builtwith").get();
    const d = snap.exists ? snap.data() || {} : null;
    if (!d || !d.box) return null;
    try { return mediaKeys.decrypt(key, "builtwith", d.box); } catch (err) { logger.warn("builtwith key unreadable", { error: String(err.message || err) }); return null; }
  }

  async function websiteSource(website) {
    try {
      const r = await safeGet(website);
      if (!r.ok) return { source: "website", status: "error", message: `The site answered HTTP ${r.status}.` };
      const page = readPage(await r.text());
      const bits = [page.title && "title", page.description && "description", page.linkedinCompany && "LinkedIn page"].filter(Boolean);
      return { source: "website", status: "ok", message: bits.length ? `Read the site's ${bits.join(", ")}.` : "Reached the site; nothing to read from it.", page };
    } catch (err) {
      return { source: "website", status: "error", message: `Couldn't read the site: ${String(err.message || err).slice(0, 120)}` };
    }
  }

  async function techSource(host) {
    let key;
    try { key = await techKey(); } catch (err) { logger.warn("tech key read failed", { error: String(err) }); }
    if (!key) return { source: "tech-stack", status: "not-configured", message: "No lookup key is stored (Settings → Integrations & MCP), so the tech stack wasn't looked up." };
    try {
      const r = await safeGet(`https://api.builtwith.com/v21/api.json?KEY=${encodeURIComponent(key)}&LOOKUP=${encodeURIComponent(host)}&NOMETA=no`);
      if (!r.ok) return { source: "tech-stack", status: "error", message: `The lookup service answered HTTP ${r.status}.` };
      const found = readTechLookup(await r.json());
      return { source: "tech-stack", status: "ok", message: `${found.techStack.length} technologies found.`, found };
    } catch (err) {
      return { source: "tech-stack", status: "error", message: `Couldn't reach the lookup service: ${String(err.message || err).slice(0, 120)}` };
    }
  }

  // The merge, kept apart from the fetching so the test can drive it.
  function applyEnrichment(lead, results, by, at) {
    const web = results.find((r) => r.source === "website");
    const tech = results.find((r) => r.source === "tech-stack");
    const found = tech && tech.found ? tech.found : null;
    const merged = core.mergeCompanyEnrichment(lead.company, found ? { industry: found.company.industry, countries: found.company.countries } : {});
    const people = found ? found.people : [];
    const contacts = lead.contacts.map((c) => {
      const p = people.find((x) => (c.email && x.email && x.email.toLowerCase() === c.email.toLowerCase()) || x.name.toLowerCase() === c.name.toLowerCase());
      if (!p) return c;
      const out = { ...c };
      const added = [];
      if (!c.email && p.email) { out.email = p.email; added.push("email"); }
      if (!c.jobTitle && p.title) { out.jobTitle = p.title.slice(0, core.LIMITS.jobTitle); added.push("jobTitle"); }
      out.enrichment = { at, by, source: "tech-stack", added, listedAs: p.title || null };
      return out;
    });
    const enrichment = {
      at, by,
      techStack: found ? found.techStack : (lead.enrichment && lead.enrichment.techStack) || [],
      summary: web && web.page ? (web.page.description || web.page.title || "") : (lead.enrichment && lead.enrichment.summary) || "",
      linkedinCompany: (web && web.page && web.page.linkedinCompany) || (lead.enrichment && lead.enrichment.linkedinCompany) || "",
      sources: results.map((r) => ({ source: r.source, status: r.status, message: r.message })),
      companyFieldsAdded: merged.changed,
    };
    return { company: merged.company, contacts, enrichment, changed: merged.changed };
  }

  async function handle(req, res) {
    const path = String((req.path || req.url || "/").split("?")[0]).replace(/^\/leadEnrich(?=\/|$)/, "").replace(/\/+$/, "") || "/";
    if (path !== "/v1/enrich") return send(res, 404, { error: "not found" });
    if (req.method !== "POST") return send(res, 405, { error: "POST only" });
    const who = await requireEditor(req);
    if (!who.ok) return send(res, who.status, { error: who.error });
    const leadId = String((req.body && req.body.leadId) || "").trim();
    if (!leadId) return send(res, 400, { error: "leadId is required" });
    const ref = db.collection("leads").doc(leadId);
    const snap = await ref.get();
    if (!snap.exists) return send(res, 404, { error: "no such lead" });
    if ((snap.data() || {}).test === true) return send(res, 400, { error: "test leads are not enriched" });
    const lead = core.normaliseLead(snap.id, snap.data());
    const website = core.normaliseUrl(lead.company.website);
    if (!website) return send(res, 400, { error: "Add the company's website first; that's what is looked up." });

    const results = await Promise.all([websiteSource(website), techSource(hostOf(website))]);
    // Re-read: a person may have edited the card while the lookups ran.
    const fresh = await ref.get();
    if (!fresh.exists) return send(res, 404, { error: "the lead was deleted meanwhile" });
    const current = core.normaliseLead(fresh.id, fresh.data());
    const at = now();
    const out = applyEnrichment(current, results, who.user.email, at);
    await ref.update({ company: out.company, contacts: out.contacts.map(stripId), enrichment: out.enrichment, updatedAt: at, updatedByEmail: who.user.email });
    return send(res, 200, {
      ok: true, leadId,
      sources: out.enrichment.sources, companyFieldsAdded: out.changed,
      techStack: out.enrichment.techStack.length, contactsEnriched: out.contacts.filter((c) => c.enrichment && c.enrichment.at === at).length,
    });
  }

  return { handle, applyEnrichment, readPage, readTechLookup };
}
// A contact's `enrichment` null (page-normalised) is dropped so the stored map stays clean.
function stripId(c) {
  const o = { id: c.id, name: c.name, jobTitle: c.jobTitle, buyingRole: c.buyingRole, email: c.email, linkedin: c.linkedin };
  if (c.enrichment) o.enrichment = c.enrichment;
  return o;
}

module.exports = { createLeadEnrich, readPage, readTechLookup, isPrivateAddress, hostOf };
