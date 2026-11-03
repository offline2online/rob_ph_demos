// Public, read-only help search for AI agents and assistants.
//
// One small HTTPS function (`helpSearch`, served at /help-api/** on the
// console's Hosting site) with no sign-in, three faces over the same logic:
//   GET  /help-api/search?q=…&release=…&limit=…   ranked results (JSON)
//   GET  /help-api/article?id=… | ?slug=…         one full article (JSON, or
//                                                  markdown with format=md / Accept: text/markdown)
//   POST /help-api/mcp                            a stateless public MCP server
//                                                  (initialize, tools/list, tools/call:
//                                                  search_help, get_help_article)
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

const { htmlToMarkdown } = require("./html-to-md");

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
const SERVER_INFO = { name: "personalisation-hub-help", version: "1.0.0" };
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
function createHelpApi({ db, now = () => Date.now(), logger = null, rateMax = RATE_MAX, alert = null, fetchImpl = (typeof fetch === "function" ? fetch : null) }) {
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
    const articles = []; const cats = {}; const releases = [];
    artSnap.forEach((d) => { const v = d.data() || {}; if (v.status === "published") articles.push({ ...v, id: d.id }); });
    catSnap.forEach((d) => { const v = d.data() || {}; cats[d.id] = { name: v.name || "", parentId: v.parentId || null }; });
    relSnap.forEach((d) => { const v = d.data() || {}; releases.push({ id: d.id, name: v.name || "", version: v.version || null, status: v.status || "draft", order: Number(v.order) || 0 }); });
    data = { at: t, articles, cats, releases };
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
    const fwd = String((req.get && req.get("x-forwarded-for")) || "").split(",")[0].trim();
    return fwd || req.ip || "unknown";
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

  // ── MCP (stateless, public, read-only) ──────────────────────────────────
  const TOOLS = [
    {
      name: "search_help",
      title: "Search Personalisation Hub help",
      description: "Search the published Personalisation Hub help articles. Returns ranked results with title, direct answer, summary, personalisationhub.com URL, article type, category and last updated. Call get_help_article for the full text.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The question or words to look for." },
          limit: { type: "integer", minimum: 1, maximum: SEARCH_LIMIT_MAX, description: `Default ${SEARCH_LIMIT_DEFAULT}.` },
          release: { type: "string", description: "Only articles that apply to this release (id or version string). Default: the current live release." },
        },
        required: ["query"], additionalProperties: false,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
      name: "get_help_article",
      title: "Get a help article as markdown",
      description: "The full markdown text of one published help article, by the id or slug returned from search_help.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Article id from search_help." },
          slug: { type: "string", description: "Article slug, if you have no id." },
          release: { type: "string", description: "Only return the article if it applies to this release (id or version string)." },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
  ];

  const toolText = (obj, isError = false) => ({ content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }], ...(isError ? { isError: true } : {}) });

  async function callTool(name, args) {
    const a = args && typeof args === "object" ? args : {};
    if (name === "search_help") {
      const r = await search({ query: a.query, release: a.release, limit: a.limit, via: "mcp" });
      return r.status === 200 ? { ...toolText(r.body), structuredContent: r.body } : toolText(r.body.error_description, true);
    }
    if (name === "get_help_article") {
      const r = await article({ id: a.id, slug: a.slug, release: a.release });
      return r.status === 200 ? toolText(await articleMarkdown(r.body)) : toolText(r.body.error_description, true);
    }
    return null;
  }

  async function mcpMessage(msg) {
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
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: "Read-only search over Personalisation Hub's published help articles. Call search_help with a question, then get_help_article for the full text. Always cite the article url.",
        });
      }
      case "ping": return reply({});
      case "tools/list": return reply({ tools: TOOLS });
      case "tools/call": {
        const p = msg.params || {};
        const out = await callTool(p.name, p.arguments);
        return out ? reply(out) : fail(-32602, `Unknown tool: ${String(p.name).slice(0, 80)}`);
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
        res.set("Cache-Control", "public, max-age=60").set("X-Cache", r.cached ? "HIT" : "MISS");
        const wantsMd = q.format === "md" || /text\/markdown/.test(String((req.get && req.get("accept")) || ""));
        if (wantsMd) res.status(200).type("text/markdown; charset=utf-8").send(await articleMarkdown(r.body));
        else res.status(200).json(r.body);
        return;
      }
      if (path === "/mcp") {
        if (req.method === "GET") { res.status(405).set("Allow", "POST").json({ error: "method_not_allowed", error_description: "POST JSON-RPC messages to this endpoint." }); return; }
        if (req.method !== "POST") { res.status(405).set("Allow", "POST").json({ error: "method_not_allowed" }); return; }
        const body = req.body;
        if (Array.isArray(body)) {
          if (body.length > 20) { res.status(400).json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Batch too large" } }); return; }
          const out = (await Promise.all(body.map(mcpMessage))).filter(Boolean);
          if (!out.length) { res.status(202).send(""); return; }
          res.status(200).json(out);
          return;
        }
        const out = await mcpMessage(body);
        if (!out) { res.status(202).send(""); return; }
        res.status(200).json(out);
        return;
      }
      res.status(404).json({ error: "not_found", error_description: "Endpoints: GET /help-api/search, GET /help-api/article, POST /help-api/mcp." });
    } catch (err) {
      if (logger) logger.error("help search failed", { path, error: String(err && err.stack ? err.stack : err) });
      outcome = "error";
      if (!res.headersSent) res.status(500).json({ error: "server_error" });
    } finally {
      try { record(outcome, req); } catch (e) { if (logger) logger.warn("help api monitor failed", { error: String(e) }); }
    }
  }

  return { handle, search, article, mcpMessage, testAlert, TOOLS, _reset() { data = null; urlMap = null; mdTwins.clear(); results.clear(); articles.clear(); buckets.clear(); lastAlert.clear(); mon = { startedAt: 0, requests: 0, rateLimited: 0, errors: 0, clients: new Map() }; } };
}

module.exports = { createHelpApi, STOP_WORDS, scoreArticle, safeSupportUrl, inRange, termsOf, normaliseQuery, SERVER_INFO };
