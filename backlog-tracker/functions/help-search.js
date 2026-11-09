// Public, read-only help search for AI agents and assistants.
//
// One small HTTPS function (`helpSearch`, served at /help-api/** on the
// console's Hosting site) with no sign-in, three faces over the same logic:
//   GET  /help-api/search?q=…&release=…&limit=…   ranked results (JSON)
//   GET  /help-api/article?id=… | ?slug=…         one full article (JSON, or
//                                                  markdown with format=md / Accept: text/markdown)
//   POST /help-api/mcp                            a stateless public MCP server
//                                                  (initialize, tools/list, tools/call:
//                                                  the eight read-only tools the site's
//                                                  WebMCP defines, proxied live from
//                                                  /wp-json/ph-agent/v1/tools)
//   GET  /help-api/data/index.json                the live feed the WordPress Support
//        /help-api/data/releases.json             Centre sync reads: the published
//        /help-api/data/articles/<id>.json        content in faq/data's own shape (the
//                                                  fields come from faq-feed.js, the code
//                                                  faq-export.js uses), published only
//
// What it will NEVER return: a draft, a retired article, an article outside
// the requested (default: live) release range, or `pendingRevision` text.
// It reads only the live fields of faqArticles with status "published", and
// links each result to its personalisationhub.com/support-centre/ URL, taken
// from the WordPress site's public map GET /wp-json/ph-help/v1/published
// ({articles:[{id,url,…}]}, cached here), falling back to
// /support-centre/article.html?id=<id>, which always resolves.
//
// Rate limited per address and per endpoint class (search/article 60 a minute,
// MCP 30; instance-local fixed window, like mcp-server.js's open endpoints;
// 429 with Retry-After and X-RateLimit-* headers), cached for a short time
// (the whole published set for 60 s, each identical search or article for
// 60 s, X-Cache HIT|MISS), monitored in 5-minute windows (a burst of 429s or
// of 5xx posts one alert to the team webhook, then stays quiet 30 minutes),
// and every search is logged to
// helpSearchLog by query so zero-result queries show up as content gaps in
// the next release audit (release-audit.js -> zeroResultQueries).
//
// The release range check mirrors mcp-server.js's search_faq. Scoring is the
// Support Centre's exact scoring so agents and site search agree: every query
// term (longer than 1 character) must match; per term title +12 if it starts
// with the term, else +8 if it contains it; keyword +5; question variant +4;
// summary +2; sorted by score desc, then article order asc. No body or
// direct-answer scoring, no any-term matching. Filler words (STOP_WORDS, the
// same list the WordPress Support Centre search uses) are dropped before the
// all-terms rule; a query made only of them keeps its original terms.
"use strict";

const crypto = require("crypto");
const { htmlToMarkdown } = require("./html-to-md");
const feed = require("./faq-feed");

const SEARCH_LIMIT_DEFAULT = 8;
const SEARCH_LIMIT_MAX = 20;
const QUERY_MAX = 300;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 60;
// The MCP endpoint takes up to 20 messages per request, so it gets half the
// budget of the single-call search/article routes (counted per request).
const MCP_RATE_DIVISOR = 2;
// Monitoring (5-minute windows): an alert goes to the team's webhook when a
// window shows abuse (many 429s) or trouble (5xx count or share), then stays
// quiet for ALERT_COOLDOWN_MS per kind so one incident is one message.
const MONITOR_WINDOW_MS = 5 * 60 * 1000;
const ALERT_COOLDOWN_MS = 30 * 60 * 1000;
const ALERT_RATE_LIMITED_MIN = 50;
const ALERT_ERRORS_MIN = 5;
const ALERT_ERROR_SHARE = 0.2;
const ALERT_ERROR_SHARE_MIN_REQUESTS = 20;
const DATA_TTL_MS = 60 * 1000;
const RESULT_TTL_MS = 60 * 1000;
const RESULT_CACHE_MAX = 500;
const SUPPORT_HOST = "personalisationhub.com";
const PUBLISHED_MAP_URL = `https://${SUPPORT_HOST}/wp-json/ph-help/v1/published`;
const FALLBACK_URL = (id) => `https://${SUPPORT_HOST}/support-centre/article.html?id=${encodeURIComponent(id)}`;
const MD_TTL_MS = 5 * 60 * 1000;
const MD_CACHE_MAX = 300;
const MD_MAX_CHARS = 400000;
// Keep identical to the WordPress Support Centre search's list.
const STOP_WORDS = new Set(("a an the and or of to in on for with at by from about into is are am be do does did can could should would will how what when where which who why i my me we our us you your it its this that these those there please").split(" "));
const URL_MAP_TTL_MS = 5 * 60 * 1000;
// A failed map fetch is retried after this, not after the full TTL.
const URL_MAP_FAIL_TTL_MS = 30 * 1000;
const URL_FETCH_TIMEOUT_MS = 4000;
// The remote MCP server proxies the WordPress tool contract (ph-agent/v1).
const WP_TOOLS_BASE = `https://${SUPPORT_HOST}/wp-json/ph-agent/v1/tools`;
const WP_TOOL_NAMES = ["describe_platform", "list_industries", "get_industry", "get_feature", "search_help", "get_help_article", "start_free_trial", "book_demo", "get_installation_spec", "calculate_business_model"];
const WP_TTL_MS = 5 * 60 * 1000;
const WP_FAIL_TTL_MS = 30 * 1000;
const WP_TIMEOUT_MS = 4000;
const WP_MAX_BYTES = 256 * 1024;
const WP_ARGS_MAX = 2000;
const WP_CACHE_MAX = 300;
const SERVER_INFO = { name: "personalisation-hub", title: "Personalisation Hub", version: "2.1.0", websiteUrl: "https://personalisationhub.com" };
// Agent-facing orientation, returned by initialize. Every tool name must appear (test).
const SERVER_INSTRUCTIONS = [
  "Personalisation Hub is a self-hosted personalisation platform for businesses with physical locations. It covers AI-native digital signage, in-store personalisation, a white-label retail media platform, queue management and appointment booking, and store sites. It runs in the customer's own AWS account, with a 30-day free trial on AWS Marketplace.",
  "",
  "Which tool answers what:",
  "- Overview of the platform: describe_platform.",
  "- An industry: list_industries, then get_industry.",
  "- A capability: get_feature.",
  "- How-to and setup questions: search_help, then get_help_article.",
  "- ROI or a business case: calculate_business_model.",
  "- Deploying it: get_installation_spec.",
  "- Trying or buying: start_free_trial or book_demo.",
  "",
  "Rules: cite the URLs the tools return. Never invent prices; pricing is on the AWS Marketplace listing. Use only what the tools return.",
].join("\n");
// Read-only text resources proxied from the site (llms-full.txt is listed only once it is live).
const WP_RESOURCES = [
  { uri: "https://personalisationhub.com/llms.txt", name: "llms.txt", title: "Personalisation Hub: llms.txt", description: "Short, agent-readable index of Personalisation Hub.", mimeType: "text/plain", always: true },
  { uri: "https://personalisationhub.com/llms-full.txt", name: "llms-full.txt", title: "Personalisation Hub: llms-full.txt", description: "Full agent-readable description of Personalisation Hub.", mimeType: "text/plain", always: false },
];
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

function inRange(a, releasesById, targetOrder) {
  if (a.introducedInReleaseId) {
    const r = releasesById[a.introducedInReleaseId];
    if (!r || !(r.order <= targetOrder)) return false;
  }
  if (a.removedInReleaseId) {
    const r = releasesById[a.removedInReleaseId];
    if (!r || !(targetOrder < r.order)) return false;
  }
  return true;
}

function toIso(v) {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (typeof v.toDate === "function") return v.toDate().toISOString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v._seconds === "number") return new Date(v._seconds * 1000).toISOString();
  return null;
}

// Only an https link on the Support Centre's own host is ever returned.
function safeSupportUrl(u) {
  if (typeof u !== "string") return null;
  try {
    const x = new URL(u);
    if (x.protocol !== "https:") return null;
    if (x.hostname !== SUPPORT_HOST && !x.hostname.endsWith(`.${SUPPORT_HOST}`)) return null;
    return x.toString();
  } catch { return null; }
}

function normaliseQuery(q) {
  return String(q == null ? "" : q).toLowerCase().replace(/\s+/g, " ").trim().slice(0, QUERY_MAX);
}
function rawTermsOf(q) {
  return normaliseQuery(q).split(/[^a-z0-9£$€%+#.'-]+/i).map((t) => t.replace(/^[.'-]+|[.'-]+$/g, "")).filter((t) => t.length > 1);
}
function termsOf(q) {
  const all = rawTermsOf(q);
  const kept = all.filter((t) => !STOP_WORDS.has(t));
  return kept.length ? kept : all;
}

// Returns 0 unless EVERY term matches somewhere.
function scoreArticle(a, terms) {
  const title = String(a.title || "").toLowerCase();
  const summary = String(a.summary || "").toLowerCase();
  const keywords = (a.keywords || []).map((k) => String(k).toLowerCase());
  const variants = (a.questionVariants || []).map((k) => String(k).toLowerCase());
  let score = 0;
  for (const t of terms) {
    let ts = 0;
    if (title.startsWith(t)) ts += 12; else if (title.includes(t)) ts += 8;
    if (keywords.some((k) => k.includes(t))) ts += 5;
    if (variants.some((k) => k.includes(t))) ts += 4;
    if (summary.includes(t)) ts += 2;
    if (ts === 0) return 0;
    score += ts;
  }
  return score;
}

// The public shape of an article: live fields only.
function publicSummary(a, cat, url) {
  const out = {
    id: a.id,
    title: a.title || "",
    directAnswer: a.directAnswer || null,
    summary: a.summary || "",
    url,
    articleType: a.articleType || a.docType || null,
    category: (cat && cat.category) || null,
    lastUpdated: toIso(a.updatedAt),
  };
  if (cat && cat.folder) out.folder = cat.folder;
  return out;
}

// `alert({kind, text, stats})` is called (not awaited) when monitoring trips;
// the function in index.js posts it to NOTIFY_WEBHOOK_URL so it reaches Rob.
function createHelpApi({ db, now = () => Date.now(), logger = null, rateMax = RATE_MAX, alert = null, fetchImpl = (typeof fetch === "function" ? fetch : null), wpTimeoutMs = WP_TIMEOUT_MS }) {
  const mcpRateMax = Math.max(1, Math.floor(rateMax / MCP_RATE_DIVISOR));
  let mon = { startedAt: 0, requests: 0, rateLimited: 0, errors: 0, clients: new Map() };
  const lastAlert = new Map(); // kind -> time
  let data = null; // { at, articles, cats, releases }
  let urlMap = null; // { at, urls: {id -> url}, ok } ok = a map (fresh or last good) is in hand
  const results = new Map(); // key -> { at, body }
  const articles = new Map(); // key -> { at, res }
  const buckets = new Map();

  async function load() {
    const t = now();
    if (data && t - data.at < DATA_TTL_MS) return data;
    const [artSnap, catSnap, relSnap] = await Promise.all([
      db.collection("faqArticles").where("status", "==", "published").get(),
      db.collection("faqCategories").get(),
      db.collection("releases").get(),
    ]);
    const articles = []; const cats = {}; const releases = []; const catRows = []; const releaseRows = [];
    artSnap.forEach((d) => { const v = d.data() || {}; if (v.status === "published") articles.push({ ...v, id: d.id }); });
    catSnap.forEach((d) => { const v = d.data() || {}; cats[d.id] = { name: v.name || "", parentId: v.parentId || null }; catRows.push(feed.categoryRecord(d.id, v)); });
    relSnap.forEach((d) => { const v = d.data() || {}; releases.push({ id: d.id, name: v.name || "", version: v.version || null, status: v.status || "draft", order: Number(v.order) || 0 }); releaseRows.push(feed.releaseRecord(d.id, v)); });
    data = { at: t, articles, cats, releases, catRows, releaseRows };
    return data;
  }

  // article id -> live Support Centre URL, from the WordPress site's public
  // map, cached. A failed fetch keeps the last good map (or none: every
  // result then uses the always-resolving article.html?id= fallback).
  async function loadUrls() {
    const t = now();
    if (urlMap && t - urlMap.at < (urlMap.ok && !urlMap.failed ? URL_MAP_TTL_MS : URL_MAP_FAIL_TTL_MS)) return urlMap.urls;
    let urls = urlMap ? urlMap.urls : {};
    let failed = false;
    try {
      if (!fetchImpl) throw new Error("no fetch");
      const ctl = typeof AbortController === "function" ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), URL_FETCH_TIMEOUT_MS) : null;
      try {
        const res = await fetchImpl(PUBLISHED_MAP_URL, { headers: { Accept: "application/json" }, signal: ctl ? ctl.signal : undefined });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const j = await res.json();
        const next = {};
        for (const row of (j && Array.isArray(j.articles) ? j.articles : [])) {
          const u = row && safeSupportUrl(row.url);
          if (row && row.id != null && u) next[String(row.id)] = u;
        }
        urls = next;
      } finally { if (timer) clearTimeout(timer); }
    } catch (e) { failed = true; if (logger) logger.warn("help url map unavailable", { error: String(e) }); }
    // A failed refresh keeps the last good map and retries in 30 s; with no
    // good map at all it is cached as failed for 30 s only.
    urlMap = { at: t, urls, failed, ok: !failed || Object.keys(urls).length > 0 };
    return urls;
  }
  // Top-level category (as in the Support Centre breadcrumb) plus the folder
  // the article sits in, when it sits in one.
  function catOf(d, a) {
    const c = d.cats[a.categoryId];
    if (!c) return null;
    const parent = c.parentId ? d.cats[c.parentId] : null;
    return parent ? { category: parent.name, folder: c.name || null } : { category: c.name, folder: null };
  }
  const urlFor = (urls, a) => urls[a.id] || FALLBACK_URL(a.id);

  // Same resolution as mcp-server.js: id, then version string; default is
  // the highest-order live release; none live and none asked for = no filter.
  function resolveRelease(d, requested) {
    const byId = Object.fromEntries(d.releases.map((r) => [r.id, r]));
    const wanted = typeof requested === "string" ? requested.trim() : "";
    if (wanted) {
      const release = byId[wanted] || d.releases.find((r) => r.version && r.version === wanted);
      if (!release) return { error: `No release with id or version "${wanted.slice(0, 80)}".` };
      return { release, byId };
    }
    const live = d.releases.filter((r) => r.status === "live").sort((x, y) => y.order - x.order);
    return { release: live[0] || null, byId };
  }
  const releaseSummary = (r) => (r ? { id: r.id, name: r.name, version: r.version } : null);

  function eligible(d, release, byId) {
    return d.articles.filter((a) => a.status === "published" && (!release || inRange(a, byId, release.order)));
  }

  async function search({ query, release, limit, via = "http" }) {
    const q = normaliseQuery(query);
    const terms = termsOf(q);
    if (!terms.length) return { status: 400, body: { error: "bad_request", error_description: "q (the question or words to look for) is required." } };
    const n = Math.min(Math.max(parseInt(limit, 10) || SEARCH_LIMIT_DEFAULT, 1), SEARCH_LIMIT_MAX);
    const d = await load();
    const rel = resolveRelease(d, release);
    if (rel.error) return { status: 404, body: { error: "unknown_release", error_description: rel.error } };
    const urls = await loadUrls();
    const key = `${q}|${rel.release ? rel.release.id : ""}|${n}`;
    const hit = results.get(key);
    if (hit && now() - hit.at < RESULT_TTL_MS) {
      log(q, rel.release, hit.body.matched, via, true);
      return { status: 200, body: hit.body, cached: true };
    }
    const scored = [];
    for (const a of eligible(d, rel.release, rel.byId)) {
      const score = scoreArticle(a, terms);
      if (score > 0) scored.push({ score, a });
    }
    const ord = (a) => (Number.isFinite(Number(a.order)) ? Number(a.order) : Number.MAX_SAFE_INTEGER);
    scored.sort((x, y) => y.score - x.score || ord(x.a) - ord(y.a) || String(x.a.title).localeCompare(String(y.a.title)));
    const body = {
      query: q,
      release: releaseSummary(rel.release),
      matched: scored.length,
      results: scored.slice(0, n).map(({ a }, i) => ({ rank: i + 1, ...publicSummary(a, catOf(d, a), urlFor(urls, a)) })),
    };
    // Results built without any map (all article.html?id= fallbacks) are not cached.
    if (urlMap && urlMap.ok) {
      if (results.size >= RESULT_CACHE_MAX) results.clear();
      results.set(key, { at: now(), body });
    }
    log(q, rel.release, scored.length, via, false);
    return { status: 200, body, cached: false };
  }

  async function article({ id, slug, release }) {
    const wantId = typeof id === "string" ? id.trim() : "";
    const wantSlug = typeof slug === "string" ? slug.trim() : "";
    if (!wantId && !wantSlug) return { status: 400, body: { error: "bad_request", error_description: "id or slug is required." } };
    const ckey = `${wantId.slice(0, 200)}|${wantSlug.slice(0, 200)}|${typeof release === "string" ? release.trim().slice(0, 80) : ""}`;
    const cached = articles.get(ckey);
    if (cached && now() - cached.at < RESULT_TTL_MS) return { ...cached.res, cached: true };
    const out = await articleUncached({ wantId, wantSlug, release });
    if (out.status === 200 && urlMap && urlMap.ok) {
      if (articles.size >= RESULT_CACHE_MAX) articles.clear();
      articles.set(ckey, { at: now(), res: out });
    }
    return { ...out, cached: false };
  }

  async function articleUncached({ wantId, wantSlug, release }) {
    const d = await load();
    const rel = resolveRelease(d, release);
    if (rel.error) return { status: 404, body: { error: "unknown_release", error_description: rel.error } };
    const urls = await loadUrls();
    const a = eligible(d, rel.release, rel.byId).find((x) => (wantId && x.id === wantId) || (wantSlug && x.slug === wantSlug));
    if (!a) return { status: 404, body: { error: "not_found", error_description: "No published article with that id or slug for this release. Use search first." } };
    const body = {
      ...publicSummary(a, catOf(d, a), urlFor(urls, a)),
      slug: a.slug || null,
      keywords: a.keywords || [],
      questionVariants: a.questionVariants || [],
      release: releaseSummary(rel.release),
      bodyMd: a.bodyMd || "",
    };
    return { status: 200, body };
  }

  // The WordPress page's own markdown twin (<url>?format=md), cached 5 minutes
  // per article. Null when the article has no recorded WordPress URL or the
  // site can't be reached; the caller then converts the body itself.
  const mdTwins = new Map(); // url -> { at, text|null }
  async function fetchTwin(url) {
    const t = now();
    const hit = mdTwins.get(url);
    if (hit && t - hit.at < MD_TTL_MS) return hit.text;
    let text = null;
    try {
      if (!fetchImpl) throw new Error("no fetch");
      const ctl = typeof AbortController === "function" ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), URL_FETCH_TIMEOUT_MS) : null;
      try {
        const res = await fetchImpl(`${url}${url.includes("?") ? "&" : "?"}format=md`, { headers: { Accept: "text/markdown, text/plain;q=0.8" }, signal: ctl ? ctl.signal : undefined });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const ct = String((res.headers && res.headers.get && res.headers.get("content-type")) || "");
        const raw = typeof res.text === "function" ? await res.text() : "";
        // an HTML page here means the twin isn't served for this URL
        if (raw.trim() && !/text\/html/i.test(ct) && !/^\s*<(!doctype|html)\b/i.test(raw)) text = raw.slice(0, MD_MAX_CHARS).trim();
      } finally { if (timer) clearTimeout(timer); }
    } catch (e) { if (logger) logger.warn("help markdown twin unavailable", { error: String(e) }); }
    if (mdTwins.size >= MD_CACHE_MAX) mdTwins.clear();
    mdTwins.set(url, { at: t, text });
    return text;
  }

  async function articleMarkdown(b) {
    const twin = b.url && b.url.startsWith(`https://${SUPPORT_HOST}/`) && !b.url.includes("article.html?id=") ? await fetchTwin(b.url) : null;
    let body = twin != null ? twin : htmlToMarkdown(b.bodyMd || "");
    const hasTitle = /^#\s+\S/.test(body);
    const lines = [];
    if (!hasTitle) {
      lines.push(`# ${b.title}`, "");
      if (b.directAnswer) lines.push(`> ${b.directAnswer}`, "");
    }
    lines.push(body, "", `Source: ${b.url}`);
    if (b.lastUpdated) lines.push(`Last updated: ${b.lastUpdated}`);
    return lines.join("\n");
  }

  // Usage log: one small document per search, no address, no user data.
  function log(q, release, matched, via, cached) {
    Promise.resolve().then(() => db.collection("helpSearchLog").add({
      query: q, release: release ? (release.version || release.id) : null,
      resultCount: matched, zeroResults: matched === 0, via, cached: !!cached,
      at: new Date(now()),
    })).catch((e) => { if (logger) logger.warn("help search log failed", { error: String(e) }); });
  }

  function clientIp(req) {
    // The first x-forwarded-for entry is whatever the caller wrote, so keying on it lets
    // anyone dodge the limit by changing a header (pen test PT-01). Use the edge's own
    // client address; failing that count from the RIGHT, where our proxies append: the
    // entry before the last hop. Anything a caller prepends only moves entries left.
    const hdr = (k) => String((req.get && req.get(k)) || "").trim();
    const edge = hdr("fastly-client-ip");
    if (edge) return edge;
    const hops = hdr("x-forwarded-for").split(",").map((x) => x.trim()).filter(Boolean);
    if (hops.length >= 2) return hops[hops.length - 2];
    return hops[0] || req.ip || "unknown";
  }
  // Per client AND per endpoint class, so a client hammering the MCP route
  // cannot use up its search budget, and the reverse. Returns
  // { wait, limit, remaining, reset }; wait is seconds when over, else 0.
  function limited(req, klass) {
    const t = now(); const key = `${clientIp(req)}|${klass}`;
    const limit = klass === "mcp" ? mcpRateMax : rateMax;
    let e = buckets.get(key);
    if (!e || e.resetAt <= t) { e = { count: 0, resetAt: t + RATE_WINDOW_MS }; buckets.set(key, e); }
    e.count += 1;
    if (buckets.size > 5000) for (const [k, v] of buckets) if (v.resetAt <= t) buckets.delete(k);
    const over = e.count > limit;
    return { wait: over ? Math.max(1, Math.ceil((e.resetAt - t) / 1000)) : 0, limit, remaining: Math.max(0, limit - e.count), reset: Math.ceil(e.resetAt / 1000) };
  }

  // ── Monitoring and alerting ─────────────────────────────────────────────
  function sendAlert(kind, text, stats) {
    const t = now();
    const prev = lastAlert.get(kind);
    if (kind !== "test" && prev !== undefined && t - prev < ALERT_COOLDOWN_MS) return false;
    lastAlert.set(kind, t);
    if (logger) logger.error(`help api alert: ${kind}`, { text, stats });
    if (alert) Promise.resolve().then(() => alert({ kind, text, stats })).catch((e) => { if (logger) logger.warn("help api alert delivery failed", { error: String(e) }); });
    return true;
  }
  function snapshot() {
    const top = [...mon.clients.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    return { windowMinutes: MONITOR_WINDOW_MS / 60000, requests: mon.requests, rateLimited: mon.rateLimited, errors: mon.errors, topLimitedClients: top.map(([c, n]) => ({ client: c, rateLimited: n })) };
  }
  function checkThresholds() {
    const s = snapshot();
    if (s.rateLimited >= ALERT_RATE_LIMITED_MIN) {
      sendAlert("abuse", `Help API abuse: ${s.rateLimited} rate-limited (429) requests in ${s.windowMinutes} minutes out of ${s.requests}. Top clients: ${s.topLimitedClients.map((c) => `${c.client} (${c.rateLimited})`).join(", ") || "n/a"}.`, s);
    }
    if (s.errors >= ALERT_ERRORS_MIN || (s.requests >= ALERT_ERROR_SHARE_MIN_REQUESTS && s.errors / s.requests >= ALERT_ERROR_SHARE)) {
      sendAlert("errors", `Help API errors: ${s.errors} server errors (5xx) out of ${s.requests} requests in ${s.windowMinutes} minutes.`, s);
    }
  }
  // Called once per request with its outcome. The client address is kept in
  // memory for the window only (to name the top offenders) and never stored.
  function record(outcome, req) {
    const t = now();
    if (!mon.startedAt || t - mon.startedAt >= MONITOR_WINDOW_MS) mon = { startedAt: t, requests: 0, rateLimited: 0, errors: 0, clients: new Map() };
    mon.requests += 1;
    if (outcome === "rate_limited") {
      mon.rateLimited += 1;
      if (mon.clients.size < 500) { const c = clientIp(req); mon.clients.set(c, (mon.clients.get(c) || 0) + 1); }
    } else if (outcome === "error") mon.errors += 1;
    if (outcome !== "ok") checkThresholds();
  }
  // A deliberate test alert, to prove delivery end to end (index.js exposes it
  // behind the board key). Returns true when it was handed to the webhook.
  function testAlert() {
    return sendAlert("test", "Test alert from the Help API monitoring: if you can read this, abuse and error alerts reach you.", snapshot());
  }

  // ── Live data feed (same files as faq/data, published articles only) ──────
  // Built from the same 60 s snapshot as search, so a retire or publish shows
  // within a minute. Text is rendered once per snapshot and carries an ETag.
  let feedCache = null; // { at: data.at, files: Map(path -> text) }
  async function feedFile(file) {
    const d = await load();
    if (!feedCache || feedCache.at !== d.at) {
      const records = d.articles.filter((a) => a.status === "published").map((a) => feed.articleRecord(a.id, a, new Date(d.at).toISOString()));
      const cats = feed.sortCategories(d.catRows.slice());
      const stamp = records.map((r) => r.updatedAt).sort().pop() || "1970-01-01T00:00:00Z";
      const files = new Map();
      files.set("index.json", feed.serializeIndex(feed.buildIndex(cats, records, stamp)));
      files.set("releases.json", feed.serializeReleases(feed.sortReleases(d.releaseRows.slice())));
      for (const r of records) files.set(`articles/${r.id}.json`, feed.serializeArticle(r));
      feedCache = { at: d.at, files };
    }
    return feedCache.files.get(file) || null;
  }

  // ── MCP (stateless, public, read-only) ──────────────────────────────────
  // Not a copy of anything: tools/list and tools/call read the WordPress
  // site's own tool contract live (GET /wp-json/ph-agent/v1/tools[/{name}]),
  // the same one the WebMCP tools on its pages use, so the two always agree
  // and a published change reaches agents with no redeploy. Fixed origin,
  // allow-listed names only, 5 minutes per (tool, args), 4 s timeout, size cap.
  // A failure is remembered 30 s only and the last good answer is kept.
  const wp = new Map(); // key -> { at, good: {at, value} | null, failAt }
  const stable = (v) => (v && typeof v === "object" ? (Array.isArray(v) ? `[${v.map(stable).join(",")}]` : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`) : JSON.stringify(v));

  async function wpFetchJson(url) { return JSON.parse(await wpFetchText(url, "application/json")); }
  async function wpFetchText(url, accept) {
    if (!fetchImpl) throw new Error("no fetch");
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    let timer;
    const timeout = new Promise((_, rej) => { timer = setTimeout(() => { if (ctl) ctl.abort(); rej(new Error("timeout")); }, wpTimeoutMs); });
    try {
      return await Promise.race([(async () => {
        const r = await fetchImpl(url, { headers: { Accept: accept }, ...(ctl ? { signal: ctl.signal } : {}) });
        if (!r.ok) throw new Error(`status ${r.status}`);
        const len = Number(r.headers && r.headers.get && r.headers.get("content-length"));
        if (len > WP_MAX_BYTES) throw new Error("too large");
        const text = await r.text();
        if (text.length > WP_MAX_BYTES) throw new Error("too large");
        return text;
      })(), timeout]);
    } finally { clearTimeout(timer); }
  }

  // Returns { value, cached } or { error } (never throws).
  async function wpCached(key, url, valid, fetcher = wpFetchJson) {
    const t = now();
    let e = wp.get(key);
    if (e && e.good && t - e.good.at < WP_TTL_MS) return { value: e.good.value, cached: true };
    if (e && e.failAt && t - e.failAt < WP_FAIL_TTL_MS) return e.good ? { value: e.good.value, cached: true, stale: true } : { error: "unavailable" };
    try {
      const value = await fetcher(url);
      if (!valid(value)) throw new Error("unexpected shape");
      e = { at: t, good: { at: t, value }, failAt: 0 };
      wp.set(key, e);
      if (wp.size > WP_CACHE_MAX) { for (const [k, v] of wp) { if (!v.good || t - v.good.at >= WP_TTL_MS) wp.delete(k); if (wp.size <= WP_CACHE_MAX) break; } if (wp.size > WP_CACHE_MAX) wp.delete(wp.keys().next().value); }
      return { value, cached: false };
    } catch (err) {
      if (logger) logger.warn("remote MCP: site fetch failed", { key, error: String(err && err.message ? err.message : err) });
      const prev = wp.get(key);
      wp.set(key, { at: t, good: prev ? prev.good : null, failAt: t });
      return prev && prev.good ? { value: prev.good.value, cached: true, stale: true } : { error: "unavailable" };
    }
  }

  const isTools = (v) => v && Array.isArray(v.tools) && v.tools.length > 0;
  const isResult = (v) => v && typeof v === "object" && Array.isArray(v.content);
  const errResult = (msg) => ({ content: [{ type: "text", text: msg }], isError: true });
  const UNAVAILABLE = "The Personalisation Hub site could not be reached just now. Try again in a minute.";

  const isText = (v) => typeof v === "string" && v.trim().length > 0;
  const textOf = (uri) => wpCached(`res|${uri}`, uri, isText, (u) => wpFetchText(u, "text/plain, text/markdown;q=0.9"));
  async function listResources(ctx) {
    const out = [];
    for (const { always, ...res } of WP_RESOURCES) {
      const r = await textOf(res.uri);
      if (ctx && ctx.cache) ctx.cache.push(!!r.cached);
      if (always || !r.error) out.push(res);
    }
    return out;
  }

  async function listTools() {
    const r = await wpCached("tools", WP_TOOLS_BASE, isTools);
    if (r.error) return r;
    // Only the allow-listed names are ever served, exactly as the site defines them.
    return { ...r, value: r.value.tools.filter((x) => x && WP_TOOL_NAMES.includes(x.name)) };
  }

  // Agent traffic as RevOps signals (ticket "RevOps signals"): one row per
  // tools/call in agentToolLog. Tool, source, referrer HOST (never the full
  // URL), time and whether the answer came from cache. No IP, no user agent,
  // no arguments, no result text.
  function referrerHost(req) {
    const h = (k) => String((req && req.get && req.get(k)) || "");
    const raw = h("origin") || h("referer");
    try { const host = raw ? new URL(raw).hostname.toLowerCase() : ""; return host && host.length <= 100 ? host : null; } catch (e) { return null; }
  }
  function logAgentTool(tool, referrer, cached, ok) {
    Promise.resolve().then(() => db.collection("agentToolLog").add({
      tool, source: "remote-mcp", referrer: referrer || null, at: new Date(now()), cached: !!cached, ok: !!ok,
    })).catch((e) => { if (logger) logger.warn("agent tool log failed", { error: String(e) }); });
  }
  // The site's CTA tools carry trackedUrl with via=webmcp; for this server it is via=remote-mcp.
  const CTA_TOOLS = ["start_free_trial", "book_demo", "get_installation_spec"];
  function forRemote(name, result) {
    if (!CTA_TOOLS.includes(name) || !result || result.isError) return result;
    return JSON.parse(JSON.stringify(result).split("?via=webmcp").join("?via=remote-mcp"));
  }

  async function callTool(name, args) {
    if (typeof name !== "string" || !WP_TOOL_NAMES.includes(name)) return null;
    const a = args === undefined || args === null ? {} : args;
    if (typeof a !== "object" || Array.isArray(a)) return { result: errResult("arguments must be an object."), cached: false };
    const json = stable(a);
    if (json.length > WP_ARGS_MAX) return { result: errResult("arguments are too long."), cached: false };
    const url = `${WP_TOOLS_BASE}/${name}${json === "{}" ? "" : `?args=${encodeURIComponent(JSON.stringify(a))}`}`;
    const r = await wpCached(`${name}|${json}`, url, isResult);
    if (r.error) return { result: errResult(UNAVAILABLE), cached: false };
    return { result: r.value, cached: !!r.cached };
  }

  // ctx.cache collects each upstream answer's HIT/MISS for the X-Cache header.
  async function mcpMessage(msg, ctx) {
    const id = msg && Object.prototype.hasOwnProperty.call(msg, "id") ? msg.id : undefined;
    const reply = (result) => ({ jsonrpc: "2.0", id, result });
    const fail = (code, message) => ({ jsonrpc: "2.0", id: id === undefined ? null : id, error: { code, message } });
    if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return fail(-32600, "Invalid request");
    if (id === undefined) return null; // notification
    switch (msg.method) {
      case "initialize": {
        const asked = msg.params && msg.params.protocolVersion;
        return reply({
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false }, prompts: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: SERVER_INSTRUCTIONS,
        });
      }
      case "ping": return reply({});
      case "tools/list": {
        const r = await listTools();
        if (ctx && ctx.cache) ctx.cache.push(!!r.cached);
        return r.error ? fail(-32603, UNAVAILABLE) : reply({ tools: r.value });
      }
      case "resources/list": return reply({ resources: await listResources(ctx) });
      case "resources/templates/list": return reply({ resourceTemplates: [] });
      case "resources/read": {
        const uri = msg.params && msg.params.uri;
        const res = WP_RESOURCES.find((x) => x.uri === uri);
        if (!res) return fail(-32002, `Resource not found: ${String(uri).slice(0, 120)}`);
        const r = await textOf(res.uri);
        if (ctx && ctx.cache) ctx.cache.push(!!r.cached);
        if (r.error) return fail(-32603, UNAVAILABLE);
        return reply({ contents: [{ uri: res.uri, mimeType: res.mimeType, text: r.value }] });
      }
      case "prompts/list": return reply({ prompts: [] });
      case "tools/call": {
        const p = msg.params || {};
        const out = await callTool(p.name, p.arguments);
        if (!out) return fail(-32602, `Unknown tool: ${String(p.name).slice(0, 80)}`);
        if (ctx && ctx.cache) ctx.cache.push(out.cached);
        logAgentTool(p.name, ctx && ctx.referrer, out.cached, !out.result.isError);
        return reply(forRemote(p.name, out.result));
      }
      default: return fail(-32601, `Method not found: ${msg.method.slice(0, 80)}`);
    }
  }

  // ── HTTP ────────────────────────────────────────────────────────────────
  function route(req) {
    let p = String(req.path || req.url || "/").split("?")[0];
    p = p.replace(/^\/help-api(?=\/|$)/, "");
    p = p.replace(/\/+$/, "");
    return p || "/";
  }

  async function handle(req, res) {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Accept, Mcp-Protocol-Version");
    res.set("X-Content-Type-Options", "nosniff");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    const path = route(req);
    let outcome = "ok";
    try {
      const klass = path === "/mcp" ? "mcp" : "read";
      const rl = limited(req, klass);
      res.set("X-RateLimit-Limit", String(rl.limit)).set("X-RateLimit-Remaining", String(rl.remaining)).set("X-RateLimit-Reset", String(rl.reset));
      if (rl.wait) {
        outcome = "rate_limited";
        res.status(429).set("Retry-After", String(rl.wait)).set("Cache-Control", "no-store").json({ error: "rate_limited", error_description: `Too many requests from this address. Try again in ${rl.wait} seconds.` });
        return;
      }

      const q = req.query || {};
      if (path === "/search" && req.method === "GET") {
        const r = await search({ query: q.q || q.query, release: q.release, limit: q.limit });
        if (r.status === 200) res.set("Cache-Control", "public, max-age=60");
        res.set("X-Cache", r.cached ? "HIT" : "MISS").status(r.status).json(r.body);
        return;
      }
      if (path === "/article" && req.method === "GET") {
        const r = await article({ id: q.id, slug: q.slug, release: q.release });
        if (r.status !== 200) { res.status(r.status).json(r.body); return; }
        res.set("Cache-Control", "public, max-age=60").set("Vary", "Accept").set("X-Cache", r.cached ? "HIT" : "MISS"); // Accept picks JSON or markdown at one URL: a shared cache must not mix them (PT-06)
        const wantsMd = q.format === "md" || /text\/markdown/.test(String((req.get && req.get("accept")) || ""));
        if (wantsMd) res.status(200).type("text/markdown; charset=utf-8").send(await articleMarkdown(r.body));
        else res.status(200).json(r.body);
        return;
      }
      if (req.method === "GET" && /^\/data\/(index\.json|releases\.json|articles\/[A-Za-z0-9_-]{1,128}\.json)$/.test(path)) {
        const text = await feedFile(path.slice("/data/".length));
        if (text == null) { res.status(404).json({ error: "not_found", error_description: "No published article with that id." }); return; }
        const etag = `"${crypto.createHash("sha1").update(text).digest("hex")}"`;
        res.set("Cache-Control", "public, max-age=60").set("ETag", etag);
        if (String((req.get && req.get("if-none-match")) || "").split(",").map((x) => x.trim().replace(/^W\//, "")).includes(etag)) { res.status(304).send(""); return; }
        res.status(200).type("application/json; charset=utf-8").send(text);
        return;
      }
      if (path === "/mcp") {
        if (req.method === "GET") { res.status(405).set("Allow", "POST").json({ error: "method_not_allowed", error_description: "POST JSON-RPC messages to this endpoint." }); return; }
        if (req.method !== "POST") { res.status(405).set("Allow", "POST").json({ error: "method_not_allowed" }); return; }
        const body = req.body;
        if (Array.isArray(body)) {
          if (body.length > 20) { res.status(400).json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Batch too large" } }); return; }
          // A batch is up to 20 calls: charge the extra 19 to the same budget (PT-03).
          for (let i = 1; i < body.length; i += 1) limited(req, "mcp");
          const ctx = { cache: [], referrer: referrerHost(req) };
          const out = (await Promise.all(body.map((m) => mcpMessage(m, ctx)))).filter(Boolean);
          if (ctx.cache.length) res.set("X-Cache", ctx.cache.every(Boolean) ? "HIT" : "MISS");
          if (!out.length) { res.status(202).send(""); return; }
          res.status(200).json(out);
          return;
        }
        const ctx = { cache: [], referrer: referrerHost(req) };
        const out = await mcpMessage(body, ctx);
        if (ctx.cache.length) res.set("X-Cache", ctx.cache.every(Boolean) ? "HIT" : "MISS");
        if (!out) { res.status(202).send(""); return; }
        res.status(200).json(out);
        return;
      }
      res.status(404).json({ error: "not_found", error_description: "Endpoints: GET /help-api/search, GET /help-api/article, GET /help-api/data/*, POST /help-api/mcp." });
    } catch (err) {
      if (logger) logger.error("help search failed", { path, error: String(err && err.stack ? err.stack : err) });
      outcome = "error";
      if (!res.headersSent) res.status(500).json({ error: "server_error" });
    } finally {
      try { record(outcome, req); } catch (e) { if (logger) logger.warn("help api monitor failed", { error: String(e) }); }
    }
  }

  return { handle, search, article, mcpMessage, testAlert, TOOL_NAMES: WP_TOOL_NAMES, _reset() { wp.clear(); data = null; feedCache = null; urlMap = null; mdTwins.clear(); results.clear(); articles.clear(); buckets.clear(); lastAlert.clear(); mon = { startedAt: 0, requests: 0, rateLimited: 0, errors: 0, clients: new Map() }; } };
}

module.exports = { createHelpApi, STOP_WORDS, scoreArticle, safeSupportUrl, inRange, termsOf, normaliseQuery, SERVER_INFO, SERVER_INSTRUCTIONS, WP_TOOL_NAMES };
