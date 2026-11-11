"use strict";
// Promote › Leads and Prospects (TAM): company enrichment, done by an agent.
//
//   POST /leadEnrich/v1/enrich   {leadId} or {prospectId}   editor or admin, ID token in X-Firebase-ID-Token
//        Queues a run: writes enrichment.request {id, status: "queued"} on the
//        record and answers 202 at once. The page shows "Researching…" from
//        its own snapshot and the findings appear there when the run ends.
//   onEnrichWrite(collection, event)   the Firestore trigger (index.js) on
//        leads/{id} and prospects/{id}: runs when a record is CREATED, and when
//        a queued request appears. Its own writes never queue one, so it
//        cannot loop.
//
// The research is free of paid data providers and needs no email address:
//   • an agent (Claude with web search and web fetch, under the console's
//     existing ANTHROPIC_API_KEY) researches the company by name and website
//     and answers with industry, countries, HQ, store count, size, tech stack
//     and vendors, LinkedIn page, summary, logo, recent news and recent
//     financials, each news item and financial source with its link and date,
//     and what matters for selling retail media and personalisation: its
//     retail media network, personalisation and loyalty, in-store screens,
//     primary cloud, the people who own those areas and why it is a fit;
//   • the company's own home page (title, description, LinkedIn link and the
//     icon it declares), read directly.
// What is found is written to the record AND to the record it is linked to
// (a lead's prospectId, a prospect's leadId), and on a prospect also to the
// company's shared profile (prospectCompanies/{companyDocId}).
//
// Enrichment only adds or updates; it never blanks a known field. A field a
// person typed is never overwritten: a field is only changed when it is blank,
// or when it still holds the value enrichment itself wrote last time
// (enrichment.filled). Lists (countries, markets, vendors, tech stack) only grow.
//
// Pure module: index.js injects Firestore, token checking, the Anthropic key
// and DNS, so test/lead-enrich.test.js runs it with no network and no credentials.
const dns = require("dns").promises;
const net = require("net");
const crypto = require("crypto");
const leadsCore = require("./leads-core");
const prospectsCore = require("./prospects-core");

const ROLE_RANK = { viewer: 1, editor: 2, admin: 3 };
const FETCH_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 400 * 1024;
const AGENT_MODEL = "claude-opus-5-5";
// One request is streamed (a web-research turn runs for minutes; an unstreamed
// call timed out before it finished), and the whole run stops asking for more
// before the trigger's own 540 s limit.
const AGENT_TIMEOUT_MS = 300000;
const AGENT_BUDGET_MS = 420000;
const MAX_CONTINUATIONS = 4;
const COMPANY_COLLECTION = "prospectCompanies";

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
const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
// Addresses written to a record: http(s) only, at most 500 characters.
function httpUrl(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s || s.length > 500) return "";
  try { const u = new URL(s); return u.protocol === "https:" || u.protocol === "http:" ? u.href : ""; } catch { return ""; }
}
const day = (v) => { const s = str(v, 40); const m = /^(\d{4}-\d{2}(?:-\d{2})?)/.exec(s); return m ? m[1] : s.slice(0, 20); };
const uniq = (list, n, len) => {
  const seen = new Set(), out = [];
  for (const x of list || []) {
    const v = str(x, len);
    if (v && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); out.push(v); }
  }
  return out.slice(0, n);
};

// Title, description, the company LinkedIn page and the declared icons out of a home page.
function readPage(html, base) {
  const h = String(html || "");
  const title = entity((h.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
  const metas = [...h.matchAll(/<meta\s[^>]*>/gi)].map((m) => m[0]);
  const meta = (name) => {
    for (const tag of metas) {
      const n = (tag.match(/(?:name|property)\s*=\s*["']([^"']+)["']/i) || [])[1];
      if (n && n.toLowerCase() === name) { const c = tag.match(/content\s*=\s*(?:"([^"]*)"|'([^']*)')/i) || []; return entity(c[1] != null ? c[1] : c[2]); }
    }
    return "";
  };
  const description = meta("description") || meta("og:description");
  const li = (h.match(/https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/company\/[A-Za-z0-9._%-]+/i) || [])[0] || "";
  // The site's own icon: an apple-touch-icon (the largest the site offers) first, then any icon.
  const abs = (href) => { try { return httpUrl(new URL(entity(href), base || undefined).href); } catch { return ""; } };
  const icons = { touch: "", icon: "" };
  for (const m of h.matchAll(/<link\s[^>]*>/gi)) {
    const tag = m[0];
    const rel = ((tag.match(/rel\s*=\s*["']([^"']+)["']/i) || [])[1] || "").toLowerCase();
    const href = (tag.match(/href\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!href || !rel) continue;
    if (!icons.touch && /apple-touch-icon/.test(rel)) icons.touch = abs(href);
    else if (!icons.icon && /(^|\s)icon(\s|$)/.test(rel)) icons.icon = abs(href);
  }
  return { title: title.slice(0, 200), description: description.slice(0, 400), linkedinCompany: li, iconUrl: icons.touch || icons.icon };
}

// ── The agent ────────────────────────────────────────────────────────────
const AGENT_SYSTEM = [
  "You research a company for the sales team of Personalisation Hub, a platform retailers use to run a retail media network and personalised content on in-store screens, digital signage, menu boards, kiosks and their mobile store site.",
  "Use web search and web fetch. Use only public sources; never guess, and never invent a link.",
  "Find, where available: the company's industry; the countries and markets it trades in; its head-office city and country; how many stores or sites it has;",
  "its size (employees, annual revenue); its technology stack and technology vendors (e.g. e-commerce platform, POS, CRM, CDP, cloud, digital signage, retail media or ad tech);",
  "its LinkedIn company page; a two or three sentence summary of what it does; a direct link to its logo or icon image;",
  "its recent news (up to five items from the last twelve months, newest first, each with the article's link and date);",
  "and its most recent financials (latest reported revenue, profit or trading update, with the period and source links and dates).",
  "Then research what matters for retail media and personalisation, each as one to three plain sentences, empty when nothing public is known:",
  "retailMedia: whether it runs or is building a retail media network or sells advertising to its suppliers and brands, what it is called, who powers it, which channels it covers (online, app, in-store screens) and anything said about its scale or plans;",
  "personalisation: how it personalises offers, content or pricing for customers today, its customer data and the platforms behind it;",
  "inStoreDigital: its in-store screens, digital signage, digital menu boards, kiosks, electronic shelf labels or digital out-of-home estate, and the suppliers named;",
  "loyalty: its loyalty programme or app, with member or user numbers when published;",
  "primaryCloud: its main cloud provider (AWS, Microsoft Azure or Google Cloud) when a public source says so;",
  "people: up to eight current senior people who would own retail media, marketing, digital, customer or loyalty, data, store operations or IT, each with name, job title and their LinkedIn profile link when you find one;",
  "fit: two or three sentences on why this company is or is not a good prospect for in-store retail media and personalisation, based only on what you found.",
  "Put any other useful fact you find (ownership, parent company, founded, CEO, stock ticker) in facts.",
  "Leave a field empty, or the list empty, when you cannot find it. Write in British English.",
  "When you are done, reply with ONE JSON object in a ```json code block, and nothing after it, with exactly these keys:",
  '{"name":"","website":"","industry":"","countries":[],"hqCity":"","hqCountry":"","storeCount":null,"employees":"","revenue":"",',
  '"techStack":[],"vendors":[],"linkedinCompany":"","summary":"","logoUrl":"",',
  '"retailMedia":"","personalisation":"","inStoreDigital":"","loyalty":"","primaryCloud":"","fit":"",',
  '"people":[{"name":"","title":"","linkedin":""}],',
  '"news":[{"title":"","url":"","date":"YYYY-MM-DD","source":""}],',
  '"financials":{"summary":"","period":"","sources":[{"title":"","url":"","date":"YYYY-MM-DD"}]},',
  '"facts":[{"label":"","value":""}]}',
  "storeCount is a number or null. Dates are YYYY-MM-DD (YYYY-MM when the day is unknown).",
].join(" ");

// The last JSON object in the agent's answer (a ```json block, else the last {...}).
function parseAgentJson(text) {
  const t = String(text || "");
  const blocks = [...t.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((m) => m[1]);
  const tries = blocks.reverse();
  const first = t.indexOf("{"), last = t.lastIndexOf("}");
  if (first >= 0 && last > first) tries.push(t.slice(first, last + 1));
  for (const c of tries) { try { const o = JSON.parse(c.trim()); if (o && typeof o === "object" && !Array.isArray(o)) return o; } catch { /* next */ } }
  return null;
}

// A person's LinkedIn profile (linkedin.com/in/...), else nothing.
function personLinkedin(v) {
  const u = httpUrl(v);
  try { return u && /(^|\.)linkedin\.com$/i.test(new URL(u).hostname) && /^\/in\//i.test(new URL(u).pathname) ? u : ""; } catch { return ""; }
}

// Anything the agent said -> the clean shape the records take. Nothing unchecked
// reaches Firestore: lengths are capped and every address is http(s).
function cleanFindings(raw) {
  const o = raw && typeof raw === "object" ? raw : {};
  const site = o.website ? prospectsCore.normaliseUrl(o.website) : "";
  const scText = typeof o.storeCount === "string" ? (o.storeCount.replace(/(\d),(?=\d{3}\b)/g, "$1").match(/\d+(?:\.\d+)?/) || [])[0] : null;
  const sc = typeof o.storeCount === "number" ? o.storeCount : (scText ? Number(scText) : null);
  const li = prospectsCore.normaliseLinkedinUrl(o.linkedinCompany);
  const link = (x) => ({ title: str(x && x.title, 200), url: httpUrl(x && x.url), date: day(x && x.date) });
  const news = (Array.isArray(o.news) ? o.news : []).map((x) => ({ ...link(x), source: str(x && x.source, 80) })).filter((x) => x.title && x.url).slice(0, 5);
  const f = o.financials && typeof o.financials === "object" ? o.financials : {};
  const fin = { summary: str(f.summary, 600), period: str(f.period, 60), sources: (Array.isArray(f.sources) ? f.sources : []).map(link).filter((x) => x.url).slice(0, 4) };
  return {
    name: str(o.name, 120),
    website: site || "",
    industry: str(o.industry, 120),
    countries: uniq((Array.isArray(o.countries) ? o.countries : []).map(prospectsCore.canonicalCountry), 40, 60),
    hqCity: str(o.hqCity, 80),
    hqCountry: str(prospectsCore.canonicalCountry(o.hqCountry), 60),
    storeCount: typeof sc === "number" && Number.isFinite(sc) && sc > 0 ? Math.round(sc) : null,
    employees: str(o.employees, 60),
    revenue: str(o.revenue, 80),
    techStack: uniq(Array.isArray(o.techStack) ? o.techStack : [], 40, 80),
    vendors: uniq(Array.isArray(o.vendors) ? o.vendors : [], 40, 80),
    linkedinCompany: li || "",
    summary: str(o.summary, 1000),
    logoUrl: httpUrl(o.logoUrl),
    retailMedia: str(o.retailMedia, 800),
    personalisation: str(o.personalisation, 800),
    inStoreDigital: str(o.inStoreDigital, 800),
    loyalty: str(o.loyalty, 500),
    primaryCloud: str(o.primaryCloud, 60),
    fit: str(o.fit, 800),
    people: (Array.isArray(o.people) ? o.people : []).map((x) => ({ name: str(x && x.name, 100), title: str(x && x.title, 120), linkedin: personLinkedin(x && x.linkedin) })).filter((x) => x.name && x.title).slice(0, 8),
    news,
    financials: fin.summary || fin.sources.length ? fin : null,
    facts: (Array.isArray(o.facts) ? o.facts : []).map((x) => ({ label: str(x && x.label, 60), value: str(x && x.value, 200) })).filter((x) => x.label && x.value).slice(0, 12),
  };
}

// One request. Streamed where the SDK offers it: a research turn runs for
// minutes, longer than an unstreamed call is allowed to stay open.
async function send(client, params) {
  const m = client.beta.messages;
  if (typeof m.stream === "function") return m.stream(params).finalMessage();
  return m.create(params);
}
// The answer's words. Web-search citations split one sentence across several
// text blocks, so they are joined with nothing between them: a newline there
// lands inside a JSON string and breaks it.
const textOf = (res) => ((res && res.content) || []).filter((b) => b.type === "text").map((b) => b.text).join("");

// Researches one company. Returns the agent's JSON, or throws with the reason
// (which the record then shows): a refusal, a cut-off answer, no JSON at all.
async function claudeResearch({ apiKey, Anthropic, company, website, country, clock = Date.now }) {
  const Client = Anthropic || require("@anthropic-ai/sdk").default || require("@anthropic-ai/sdk");
  const client = new Client({ apiKey, timeout: AGENT_TIMEOUT_MS, maxRetries: 1 });
  const ask = [
    `Company: ${company}`,
    website ? `Website: ${website}` : "Website: not known (find it).",
    country ? `Country of interest: ${country}` : "",
    `Today is ${new Date().toISOString().slice(0, 10)}.`,
  ].filter(Boolean).join("\n");
  const base = { model: AGENT_MODEL, fallbacks: "default", betas: ["server-side-fallback-2026-07-01"], system: AGENT_SYSTEM };
  const messages = [{ role: "user", content: ask }];
  const started = clock();
  let res;
  for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
    res = await send(client, {
      ...base,
      max_tokens: 32000,
      output_config: { effort: "medium" },
      tools: [
        { type: "web_search_20260209", name: "web_search", max_uses: 12 },
        { type: "web_fetch_20260209", name: "web_fetch", max_uses: 8 },
      ],
      messages,
    });
    if (res.stop_reason !== "pause_turn") break;
    if (clock() - started > AGENT_BUDGET_MS) break;
    // A long server-tool turn paused: send it back as it is and the server resumes it.
    messages.push({ role: "assistant", content: res.content });
  }
  if (!res) throw new Error("no answer came back");
  if (res.stop_reason === "refusal") throw new Error("the model declined to research this company");
  const text = textOf(res);
  const found = parseAgentJson(text);
  if (found) return found;
  if (!text.trim()) throw new Error(res.stop_reason === "pause_turn" ? "the research ran out of time before it answered" : `the research ended with no answer (${res.stop_reason || "unknown"})`);
  // It researched but the answer isn't readable JSON (cut off, or prose around
  // it): one short call with no tools turns those notes into the JSON.
  const fix = await send(client, {
    ...base,
    max_tokens: 16000,
    output_config: { effort: "low" },
    messages: [{ role: "user", content: `${ask}\n\nThese are your research notes on this company. Reply with only the JSON object described, in a \`\`\`json code block, using only what the notes say.\n\n<notes>\n${text.slice(-60000)}\n</notes>` }],
  });
  const fixed = fix && fix.stop_reason !== "refusal" ? parseAgentJson(textOf(fix)) : null;
  if (!fixed) throw new Error("the research finished but its answer could not be read");
  return fixed;
}

// ── Merging, kept apart from the fetching so the test can drive it ──────
// A field may change when it is blank, or still holds what enrichment wrote last time.
const blank = (v) => v == null || v === "" || (Array.isArray(v) && !v.length);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function ownable(current, filledBefore) { return blank(current) || (filledBefore !== undefined && same(current, filledBefore)); }
const union = (have, add, n, len) => uniq([...(have || []), ...(add || [])], n, len);
const keep = (next, prev) => (blank(next) ? (prev === undefined ? (Array.isArray(next) ? [] : next == null ? null : "") : prev) : next);

// The enrichment map both records carry: the newest non-empty value, else the one before.
function enrichmentMap(prev, f, logoUrl, sources, meta) {
  const p = prev && typeof prev === "object" ? prev : {};
  const hq = [f.hqCity, f.hqCountry].filter(Boolean).join(", ");
  return {
    at: meta.at, by: meta.by,
    summary: f.summary || p.summary || f.siteDescription || "",
    logoUrl: keep(logoUrl, p.logoUrl),
    hq: keep(hq, p.hq),
    employees: keep(f.employees, p.employees),
    revenue: keep(f.revenue, p.revenue),
    techStack: union(p.techStack, f.techStack, 60, 80),
    vendors: union(p.vendors, f.vendors, 60, 80),
    linkedinCompany: keep(f.linkedinCompany, p.linkedinCompany),
    retailMedia: keep(f.retailMedia, p.retailMedia),
    personalisation: keep(f.personalisation, p.personalisation),
    inStoreDigital: keep(f.inStoreDigital, p.inStoreDigital),
    loyalty: keep(f.loyalty, p.loyalty),
    primaryCloud: keep(f.primaryCloud, p.primaryCloud),
    fit: keep(f.fit, p.fit),
    people: f.people.length ? f.people : (Array.isArray(p.people) ? p.people : []),
    news: f.news.length ? f.news : (Array.isArray(p.news) ? p.news : []),
    financials: f.financials || p.financials || null,
    facts: f.facts.length ? f.facts : (Array.isArray(p.facts) ? p.facts : []),
    sources,
  };
}

function applyToLead(data, f, logoUrl, sources, meta) {
  const lead = leadsCore.normaliseLead("x", data);
  const prev = lead.enrichment || {};
  const filled = prev.filled && typeof prev.filled === "object" ? { ...prev.filled } : {};
  const company = { ...((data && data.company) || {}) };
  const changed = [];
  const set = (k, v) => { if (blank(v) || same(company[k], v)) return; if (!ownable(company[k], filled[k])) return; company[k] = v; filled[k] = v; changed.push(k); };
  set("industry", str(f.industry, 120));
  set("storeCount", f.storeCount);
  if (!company.website && f.website && f.website.length <= 300) { company.website = f.website; changed.push("website"); }
  const countries = uniq([...(lead.company.countries || []), ...[f.hqCountry, ...f.countries].filter(Boolean)], 60, 60);
  if (countries.length > (lead.company.countries || []).length) { company.countries = countries; changed.push("countries"); }
  const enrichment = { ...enrichmentMap(prev, f, logoUrl, sources, meta), filled, companyFieldsAdded: changed };
  if (prev.request) enrichment.request = prev.request;
  return { company, enrichment, changed };
}

function applyToProspect(data, f, logoUrl, sources, meta) {
  const p = prospectsCore.normaliseProspect("x", data);
  const prev = data && data.enrichment && typeof data.enrichment === "object" ? data.enrichment : {};
  const filled = prev.filled && typeof prev.filled === "object" ? { ...prev.filled } : {};
  const fields = {};
  const changed = [];
  const stored = (k) => (data || {})[k];
  const set = (k, v) => { if (blank(v) || same(stored(k), v)) return; if (!ownable(stored(k), filled[k])) return; fields[k] = v; filled[k] = v; changed.push(k); };
  set("industry", prospectsCore.normaliseIndustry(f.industry));
  set("hqCountry", str(f.hqCountry, 60));
  set("storeCount", f.storeCount);
  set("linkedinUrl", f.linkedinCompany);
  if (!stored("website") && f.website && f.website.length <= 300) { fields.website = f.website; changed.push("website"); }
  const markets = uniq([...p.markets, ...f.countries], 60, 60);
  if (markets.length > p.markets.length) { fields.markets = markets; changed.push("markets"); }
  const vendors = uniq([...p.vendors, ...f.vendors, ...f.techStack], 60, 80);
  if (vendors.length > p.vendors.length) { fields.vendors = vendors; changed.push("vendors"); }
  const enrichment = { ...enrichmentMap(prev, f, logoUrl, sources, meta), filled, companyFieldsAdded: changed };
  if (prev.filledProfile) enrichment.filledProfile = prev.filledProfile;
  if (prev.request) enrichment.request = prev.request;
  return { fields, enrichment, changed };
}

// The company's shared profile (the TAM detail view): summary, logo, tech stack,
// latest news and the date it was last researched.
function applyToProfile(profile, f, logoUrl, filledBefore, today) {
  const cur = profile && typeof profile === "object" ? profile : {};
  const filled = filledBefore && typeof filledBefore === "object" ? { ...filledBefore } : {};
  const set = {};
  const put = (k, v) => { if (blank(v) || same(cur[k], v) || !ownable(cur[k], filled[k])) return; set[k] = v; filled[k] = v; };
  put("summary", str(f.summary || f.siteDescription, 2000));
  put("logoUrl", logoUrl);
  put("primaryCloud", str(f.primaryCloud, 60));
  const newsLine = f.news.slice(0, 3).map((n) => `${n.date ? `${n.date} · ` : ""}${n.title}${n.source ? ` (${n.source})` : ""}`).join("\n").slice(0, 1000);
  put("latestNews", newsLine);
  const stack = uniq([...(Array.isArray(cur.techStack) ? cur.techStack : []), ...f.techStack], 40, 40);
  if (stack.length > (Array.isArray(cur.techStack) ? cur.techStack.length : 0)) set.techStack = stack;
  set.lastResearchedAt = today;
  return { set, filled };
}

// Why the agent call failed, in words a person can act on.
function agentError(err) {
  const status = err && err.status;
  const msg = String(err && err.message ? err.message : err).replace(/\s+/g, " ").slice(0, 160);
  if (status === 401 || status === 403) return "the ANTHROPIC_API_KEY was refused (check the key and its workspace).";
  if (status === 429) return "the Anthropic account is rate limited or out of credit. Try again shortly.";
  if (status === 400) return `the request was rejected (${msg}).`;
  if (status >= 500 || status === 529) return "Anthropic's service was unavailable. Try again shortly.";
  if (/timed? ?out|timeout|aborted/i.test(msg)) return "it took too long and was stopped. Try again.";
  return /[.!?]$/.test(msg) ? msg : `${msg}.`;
}

function createLeadEnrich({
  db, verifyIdToken, resolveConsoleUser, anthropicKey = () => "", Anthropic,
  research, fetch: fetchImpl = globalThis.fetch, lookup = (h) => dns.lookup(h, { all: true }),
  logger = console, now = () => new Date(), serverTimestamp,
}) {
  const send = (res, status, body) => res.status(status).set("Cache-Control", "no-store").json(body);
  const stamp = () => (serverTimestamp ? serverTimestamp() : now());

  async function requireEditor(req) {
    const idToken = String(req.get("x-firebase-id-token") || "");
    if (!idToken) return { ok: false, status: 401, error: "sign in first" };
    let decoded;
    try { decoded = await verifyIdToken(idToken); } catch { return { ok: false, status: 401, error: "invalid sign-in" }; }
    const user = await resolveConsoleUser(decoded.email);
    if (!user) return { ok: false, status: 403, error: "not on the console user list" };
    if ((ROLE_RANK[user.role] || 0) < ROLE_RANK.editor) return { ok: false, status: 403, error: "viewers can't enrich records" };
    return { ok: true, user };
  }

  async function assertPublicHost(host) {
    if (net.isIP(host)) { if (isPrivateAddress(host)) throw new Error("that address isn't public"); return; }
    const addrs = await lookup(host);
    if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error("that address isn't public");
  }

  // GET with a timeout, a size cap and a public-address check on every hop.
  async function safeGet(url) {
    let current = url;
    for (let hop = 0; hop < 4; hop++) {
      const u = new URL(current);
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("not a web address");
      await assertPublicHost(u.hostname);
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
      try {
        const r = await fetchImpl(current, { headers: { "User-Agent": "PH-Console-LeadEnrich/2.0" }, redirect: "manual", signal: ctl.signal });
        if (r.status >= 300 && r.status < 400 && r.headers.get("location")) { current = new URL(r.headers.get("location"), current).href; continue; }
        return { status: r.status, ok: r.ok, url: current, headers: r.headers, text: async () => String(await r.text()).slice(0, MAX_HTML_BYTES) };
      } finally { clearTimeout(timer); }
    }
    throw new Error("too many redirects");
  }

  async function websiteSource(website) {
    if (!website) return { source: "website", status: "skipped", message: "No website known, so the home page wasn't read." };
    try {
      const r = await safeGet(website);
      if (!r.ok) return { source: "website", status: "error", message: `The site answered HTTP ${r.status}.` };
      const page = readPage(await r.text(), r.url);
      const bits = [page.title && "title", page.description && "description", page.linkedinCompany && "LinkedIn page", page.iconUrl && "icon"].filter(Boolean);
      return { source: "website", status: "ok", message: bits.length ? `Read the site's ${bits.join(", ")}.` : "Reached the site; nothing to read from it.", page };
    } catch (err) {
      return { source: "website", status: "error", message: `Couldn't read the site: ${String(err.message || err).slice(0, 120)}` };
    }
  }

  // The site's /favicon.ico when the page declares no icon, if it really is an image.
  async function faviconOf(website) {
    if (!website) return "";
    try {
      const url = new URL("/favicon.ico", website).href;
      const r = await safeGet(url);
      const type = String((r.headers && r.headers.get && r.headers.get("content-type")) || "");
      return r.ok && /^image\//i.test(type) ? httpUrl(r.url) : "";
    } catch { return ""; }
  }

  async function agentSource(company, website, country) {
    const key = anthropicKey();
    if (!key || key === "unset") return { source: "agent", status: "not-configured", message: "The research agent isn't set up yet (ANTHROPIC_API_KEY), so only the website was read." };
    try {
      const raw = await (research || claudeResearch)({ apiKey: key, Anthropic, company, website, country });
      if (!raw) return { source: "agent", status: "error", message: "The research agent returned nothing usable." };
      if (blank(Object.values(cleanFindings(raw)).filter((v) => !blank(v)))) return { source: "agent", status: "error", message: "The research agent found nothing about this company." };
      const found = cleanFindings(raw);
      const n = [found.industry, found.hqCountry, found.storeCount, found.summary, found.logoUrl, found.linkedinCompany].filter((x) => !blank(x)).length + found.techStack.length + found.news.length + (found.financials ? 1 : 0);
      return { source: "agent", status: "ok", message: `Web research found ${n} ${n === 1 ? "detail" : "details"}, ${found.news.length} news ${found.news.length === 1 ? "item" : "items"}${found.financials ? " and recent financials" : ""}.`, found };
    } catch (err) {
      const why = agentError(err);
      logger.warn("enrichment agent failed", { company, status: err && err.status, error: String(err && err.message ? err.message : err).slice(0, 500) });
      return { source: "agent", status: "error", message: `The research agent failed: ${why}` };
    }
  }

  // One research run for a company: the agent first (it may find the website), then the site.
  async function research_(company, website, country) {
    const agent = await agentSource(company, website, country);
    const empty = cleanFindings({});
    const f = agent.found || empty;
    const site = website || f.website || "";
    const web = await websiteSource(site);
    const page = web.page || {};
    // The site's own description only stands in when no summary was ever found.
    f.siteDescription = str(page.description, 1000);
    if (!f.linkedinCompany && page.linkedinCompany) f.linkedinCompany = prospectsCore.normaliseLinkedinUrl(page.linkedinCompany) || "";
    if (!f.website && site) f.website = site;
    const logoUrl = page.iconUrl || f.logoUrl || (web.status === "ok" ? await faviconOf(site) : "");
    const sources = [agent, web].map((r) => ({ source: r.source, status: r.status, message: r.message }));
    return { f, logoUrl, sources };
  }

  function requestOf(data) {
    const e = data && data.enrichment;
    return e && typeof e === "object" && e.request && typeof e.request === "object" ? e.request : null;
  }

  // Runs one enrichment on leads/{id} or prospects/{id}, and its linked record.
  async function enrichRecord(collection, id, by, trigger) {
    const ref = db.collection(collection).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return { ok: false, error: "no such record" };
    const data = snap.data() || {};
    if (collection === "leads" && data.test === true) return { ok: false, error: "test leads are not enriched" };
    const req = requestOf(data) || { id: `auto-${crypto.randomBytes(4).toString("hex")}`, by, trigger };
    const startedAt = now();
    await ref.update({ "enrichment.request": { ...req, status: "running", startedAt } });

    const isLead = collection === "leads";
    const name = isLead ? str(data.company && data.company.name, 120) : str(data.name, 120);
    const website = isLead ? leadsCore.normaliseUrl(data.company && data.company.website) || "" : prospectsCore.normaliseUrl(data.website) || "";
    const country = isLead ? "" : str(data.country, 60);
    let result;
    try { result = await research_(name, website, country); } catch (err) {
      await ref.update({ "enrichment.request": { ...req, status: "error", startedAt, finishedAt: now(), message: String(err && err.message ? err.message : err).slice(0, 200) } });
      return { ok: false, error: "enrichment failed" };
    }
    const at = now();
    const meta = { at, by: by || req.by || "auto" };
    // The run is done when the agent answered. The home page alone (a title
    // and an icon) is still written, but the run says the research failed.
    const ok = result.sources.some((s) => s.source === "agent" && s.status === "ok");
    const wrote = ok || result.sources.some((s) => s.status === "ok");
    const done = { ...req, status: ok ? "done" : "error", startedAt, finishedAt: at, message: result.sources.filter((s) => ok || s.status !== "ok").map((s) => s.message).join(" ") };
    const out = { collection, id, changed: [], linked: null };

    // Re-read: a person may have edited the record while the research ran.
    const writeLead = async (lref, own) => {
      const fresh = await lref.get();
      if (!fresh.exists || (fresh.data() || {}).test === true) return null;
      const r = applyToLead(fresh.data(), result.f, result.logoUrl, result.sources, meta);
      const cur = requestOf(fresh.data());
      if (own) r.enrichment.request = cur && cur.id !== req.id ? cur : done; else if (cur) r.enrichment.request = cur; else delete r.enrichment.request;
      await lref.update({ company: r.company, enrichment: r.enrichment, updatedAt: stamp() });
      return r.changed;
    };
    const writeProspect = async (pref, own) => {
      const fresh = await pref.get();
      if (!fresh.exists) return null;
      const pdata = fresh.data() || {};
      const r = applyToProspect(pdata, result.f, result.logoUrl, result.sources, meta);
      const cur = requestOf(pdata);
      if (own) r.enrichment.request = cur && cur.id !== req.id ? cur : done; else if (cur) r.enrichment.request = cur; else delete r.enrichment.request;
      // The company's shared profile, merged field by field.
      const ckey = prospectsCore.slugId(pdata.name);
      if (ckey) {
        const cref = db.collection(COMPANY_COLLECTION).doc(ckey);
        const csnap = await cref.get();
        const profile = csnap.exists ? ((csnap.data() || {}).profile || {}) : {};
        const pr = applyToProfile(profile, result.f, result.logoUrl, r.enrichment.filledProfile, at.toISOString().slice(0, 10));
        r.enrichment.filledProfile = pr.filled;
        await cref.set({ name: str(pdata.name, 120), profile: pr.set, updatedAt: stamp(), updatedByEmail: meta.by.includes("@") ? meta.by : "enrichment" }, { merge: true });
      }
      await pref.update({ ...r.fields, enrichment: r.enrichment, updatedAt: stamp() });
      return r.changed;
    };

    if (isLead) {
      out.changed = (await writeLead(ref, true)) || [];
      const pid = str((await ref.get()).data().prospectId, 120);
      if (pid) out.linked = { collection: "prospects", id: pid, changed: await writeProspect(db.collection("prospects").doc(pid), false) };
    } else {
      out.changed = (await writeProspect(ref, true)) || [];
      const lid = str(data.leadId, 120);
      if (lid) out.linked = { collection: "leads", id: lid, changed: await writeLead(db.collection("leads").doc(lid), false) };
    }
    return { ok, wrote, ...out, sources: result.sources };
  }

  // A website lead for a company not yet in the TAM creates the TAM record and
  // the lead together (lead-ingest.js). The lead's own run fills both, so the
  // new TAM record does not start a second, identical research run.
  async function coveredByNewLead(prospect) {
    const lid = str(prospect && prospect.leadId, 120);
    if (!lid) return false;
    try {
      const snap = await db.collection("leads").doc(lid).get();
      if (!snap.exists) return false;
      const lead = snap.data() || {};
      if (lead.test === true) return false;
      const c = lead.createdAt;
      const made = c && typeof c.toDate === "function" ? c.toDate() : (c ? new Date(c) : null);
      return Boolean(made) && !Number.isNaN(made.getTime()) && Math.abs(now() - made) < 2 * 60 * 1000;
    } catch { return false; }
  }

  // The Firestore trigger: a created record, or a newly queued request.
  async function onEnrichWrite(collection, event) {
    const before = event && event.data && event.data.before && event.data.before.exists ? event.data.before.data() : null;
    const after = event && event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;
    if (!after) return null;
    const id = event.params && (event.params.leadId || event.params.prospectId || event.params.id);
    if (!id) return null;
    const rb = requestOf(before), ra = requestOf(after);
    const created = !before;
    const queued = ra && ra.status === "queued" && (!rb || rb.id !== ra.id);
    if (!created && !queued) return null;
    if (collection === "leads" && after.test === true) return null;
    try {
      if (created && !queued && collection === "prospects" && (await coveredByNewLead(after))) return null;
      return await enrichRecord(collection, String(id), queued ? ra.by : "auto", created && !queued ? "created" : "requested");
    } catch (err) {
      logger.error("enrichment run failed", { collection, id, error: String(err && err.message ? err.message : err) });
      return null;
    }
  }

  async function handle(req, res) {
    const path = String((req.path || req.url || "/").split("?")[0]).replace(/^\/leadEnrich(?=\/|$)/, "").replace(/\/+$/, "") || "/";
    if (path !== "/v1/enrich") return send(res, 404, { error: "not found" });
    if (req.method !== "POST") return send(res, 405, { error: "POST only" });
    const who = await requireEditor(req);
    if (!who.ok) return send(res, who.status, { error: who.error });
    const body = req.body || {};
    const leadId = String(body.leadId || "").trim();
    const prospectId = String(body.prospectId || "").trim();
    if (!leadId && !prospectId) return send(res, 400, { error: "leadId or prospectId is required" });
    const collection = leadId ? "leads" : "prospects";
    const id = leadId || prospectId;
    const ref = db.collection(collection).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return send(res, 404, { error: leadId ? "no such lead" : "no such prospect" });
    const data = snap.data() || {};
    if (leadId && data.test === true) return send(res, 400, { error: "test leads are not enriched" });
    const name = leadId ? str(data.company && data.company.name, 120) : str(data.name, 120);
    if (!name) return send(res, 400, { error: "Name the company first; that's what is researched." });
    const cur = requestOf(data);
    if (cur && (cur.status === "queued" || cur.status === "running")) {
      const since = cur.startedAt && typeof cur.startedAt.toDate === "function" ? cur.startedAt.toDate() : (cur.startedAt ? new Date(cur.startedAt) : null);
      // A run that never finished (over 10 minutes) doesn't block a new one.
      if (!since || now() - since < 10 * 60 * 1000) return send(res, 202, { ok: true, queued: true, already: true, requestId: cur.id, collection, id });
    }
    const request = { id: crypto.randomBytes(8).toString("hex"), at: now(), by: who.user.email, status: "queued", trigger: "requested" };
    await ref.update({ "enrichment.request": request });
    return send(res, 202, { ok: true, queued: true, requestId: request.id, collection, id });
  }

  return { handle, onEnrichWrite, enrichRecord };
}

module.exports = {
  createLeadEnrich, readPage, isPrivateAddress, hostOf, parseAgentJson, cleanFindings,
  applyToLead, applyToProspect, applyToProfile, claudeResearch, agentError, AGENT_SYSTEM, AGENT_MODEL,
};
