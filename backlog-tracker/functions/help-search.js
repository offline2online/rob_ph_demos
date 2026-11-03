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
//   GET  /help-api/llms.txt, /help-api/webmcp.js  the /llms.txt entry and the WebMCP
//                                                  tool snippet for the Support Centre
//
// What it will NEVER return: a draft, a retired article, an article outside
// the requested (default: live) release range, or `pendingRevision` text.
// It reads only the live fields of faqArticles with status "published", and
// links each result to the personalisationhub.com/support-centre/ URL the
// WordPress publish step recorded (faqArticles.wpPublish.url) — an article
// with no recorded URL is not returned, because every result must link.
//
// Rate limited per address (instance-local fixed window, like mcp-server.js's
// open endpoints), cached for a short time (the whole published set for 60 s,
// each identical query for 60 s), and every search is logged to
// helpSearchLog by query so zero-result queries show up as content gaps in
// the next release audit (release-audit.js -> zeroResultQueries).
//
// The release range check and the scoring mirror mcp-server.js's search_faq
// and the WordPress index's scoring (title 5, summary 3, keyword 3, question
// variant 4, body 1; direct answer 2). Separate deployables, no shared module.
"use strict";

const SEARCH_LIMIT_DEFAULT = 8;
const SEARCH_LIMIT_MAX = 20;
const QUERY_MAX = 300;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 60;
const DATA_TTL_MS = 60 * 1000;
const RESULT_TTL_MS = 60 * 1000;
const RESULT_CACHE_MAX = 500;
const SUPPORT_HOST = "personalisationhub.com";
const SERVER_INFO = { name: "personalisation-hub-help", version: "1.0.0" };
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const ARTICLE_TYPES = new Set(["guide", "faq", "reference"]);

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

// The recorded WordPress permalink, only if it is an https link to the
// Support Centre. Anything else (missing, retired, other host) means "not
// published there" and the article is left out.
function supportUrl(a) {
  const w = a && a.wpPublish;
  if (!w || w.status === "retired" || typeof w.url !== "string") return null;
  try {
    const u = new URL(w.url);
    if (u.protocol !== "https:") return null;
    if (u.hostname !== SUPPORT_HOST && !u.hostname.endsWith(`.${SUPPORT_HOST}`)) return null;
    return u.toString();
  } catch { return null; }
}

function normaliseQuery(q) {
  return String(q == null ? "" : q).toLowerCase().replace(/\s+/g, " ").trim().slice(0, QUERY_MAX);
}
function termsOf(q) {
  return normaliseQuery(q).split(/[^a-z0-9£$€%+#.'-]+/i).map((t) => t.replace(/^[.'-]+|[.'-]+$/g, "")).filter((t) => t.length > 1);
}

function scoreArticle(a, terms) {
  const title = String(a.title || "").toLowerCase();
  const summary = String(a.summary || "").toLowerCase();
  const keywords = (a.keywords || []).map((k) => String(k).toLowerCase());
  const variants = (a.questionVariants || []).map((k) => String(k).toLowerCase());
  const direct = String(a.directAnswer || "").toLowerCase();
  const hay = `${title}\n${summary}\n${keywords.join(" ")}\n${variants.join(" ")}\n${direct}\n${String(a.bodyMd || "").toLowerCase()}`;
  let score = 0;
  for (const t of terms) {
    if (title.includes(t)) score += 5;
    if (summary.includes(t)) score += 3;
    if (keywords.some((k) => k.includes(t))) score += 3;
    if (variants.some((k) => k.includes(t))) score += 4;
    if (direct.includes(t)) score += 2;
    if (hay.includes(t)) score += 1;
  }
  return score;
}

// The public shape of an article: live fields only.
function publicSummary(a, categoryName) {
  return {
    id: a.id,
    title: a.title || "",
    directAnswer: a.directAnswer || null,
    summary: a.summary || "",
    url: supportUrl(a),
    articleType: ARTICLE_TYPES.has(a.articleType) ? a.articleType : null,
    category: categoryName || null,
    lastUpdated: toIso(a.updatedAt),
  };
}

function createHelpApi({ db, now = () => Date.now(), logger = null, rateMax = RATE_MAX }) {
  let data = null; // { at, articles, cats, releases }
  const results = new Map(); // key -> { at, body }
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
    catSnap.forEach((d) => { cats[d.id] = (d.data() || {}).name || ""; });
    relSnap.forEach((d) => { const v = d.data() || {}; releases.push({ id: d.id, name: v.name || "", version: v.version || null, status: v.status || "draft", order: Number(v.order) || 0 }); });
    data = { at: t, articles, cats, releases };
    return data;
  }

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
    return d.articles.filter((a) => a.status === "published" && supportUrl(a) && (!release || inRange(a, byId, release.order)));
  }

  async function search({ query, release, limit, via = "http" }) {
    const q = normaliseQuery(query);
    const terms = termsOf(q);
    if (!terms.length) return { status: 400, body: { error: "bad_request", error_description: "q (the question or words to look for) is required." } };
    const n = Math.min(Math.max(parseInt(limit, 10) || SEARCH_LIMIT_DEFAULT, 1), SEARCH_LIMIT_MAX);
    const d = await load();
    const rel = resolveRelease(d, release);
    if (rel.error) return { status: 404, body: { error: "unknown_release", error_description: rel.error } };
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
    scored.sort((x, y) => y.score - x.score || String(x.a.title).localeCompare(String(y.a.title)));
    const body = {
      query: q,
      release: releaseSummary(rel.release),
      matched: scored.length,
      results: scored.slice(0, n).map(({ a }, i) => ({ rank: i + 1, ...publicSummary(a, d.cats[a.categoryId]) })),
    };
    if (results.size >= RESULT_CACHE_MAX) results.clear();
    results.set(key, { at: now(), body });
    log(q, rel.release, scored.length, via, false);
    return { status: 200, body, cached: false };
  }

  async function article({ id, slug, release }) {
    const d = await load();
    const rel = resolveRelease(d, release);
    if (rel.error) return { status: 404, body: { error: "unknown_release", error_description: rel.error } };
    const wantId = typeof id === "string" ? id.trim() : "";
    const wantSlug = typeof slug === "string" ? slug.trim() : "";
    if (!wantId && !wantSlug) return { status: 400, body: { error: "bad_request", error_description: "id or slug is required." } };
    const a = eligible(d, rel.release, rel.byId).find((x) => (wantId && x.id === wantId) || (wantSlug && x.slug === wantSlug));
    if (!a) return { status: 404, body: { error: "not_found", error_description: "No published article with that id or slug for this release. Use search first." } };
    const body = {
      ...publicSummary(a, d.cats[a.categoryId]),
      slug: a.slug || null,
      keywords: a.keywords || [],
      questionVariants: a.questionVariants || [],
      release: releaseSummary(rel.release),
      bodyMd: a.bodyMd || "",
    };
    return { status: 200, body };
  }

  function articleMarkdown(b) {
    const lines = [`# ${b.title}`, ""];
    if (b.directAnswer) lines.push(`> ${b.directAnswer}`, "");
    lines.push(b.bodyMd || "", "", `Source: ${b.url}`);
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
  // Returns seconds to wait when over the limit, else 0.
  function limited(req) {
    const t = now(); const key = clientIp(req);
    let e = buckets.get(key);
    if (!e || e.resetAt <= t) { e = { count: 0, resetAt: t + RATE_WINDOW_MS }; buckets.set(key, e); }
    e.count += 1;
    if (buckets.size > 5000) for (const [k, v] of buckets) if (v.resetAt <= t) buckets.delete(k);
    return e.count > rateMax ? Math.max(1, Math.ceil((e.resetAt - t) / 1000)) : 0;
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
      return r.status === 200 ? toolText(articleMarkdown(r.body)) : toolText(r.body.error_description, true);
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

  function baseUrl(req) {
    const host = (req.get && (req.get("x-forwarded-host") || req.get("host"))) || "backlog-tracker-e4ed2.web.app";
    return `https://${String(host).split(",")[0].trim()}/help-api`;
  }

  function llmsTxt(req) {
    const b = baseUrl(req);
    return [
      "## Help search for AI agents",
      "",
      "Personalisation Hub's published help articles can be searched directly. Public, read-only, no sign-in.",
      "",
      `- [Search API](${b}/search?q=how+do+I+add+a+store): GET, returns ranked results (title, direct answer, summary, URL, article type, category, last updated). Optional release= (id or version).`,
      `- [Full article as markdown](${b}/article?id=ARTICLE_ID&format=md): GET, the id comes from a search result.`,
      `- [MCP server](${b}/mcp): streamable-HTTP MCP endpoint (stateless) with tools search_help and get_help_article.`,
      `- [WebMCP tool for the Support Centre pages](${b}/webmcp.js): registers search_help in the browser.`,
      "",
    ].join("\n");
  }

  function webmcp(req) {
    const b = baseUrl(req);
    return `// WebMCP: lets an in-browser agent search the Support Centre's help articles.
(function () {
  var mc = navigator.modelContext;
  if (!mc || typeof mc.registerTool !== "function") return;
  mc.registerTool({
    name: "search_help",
    description: "Search Personalisation Hub's published help articles. Returns ranked results with title, direct answer, summary, URL, article type, category and last updated.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, release: { type: "string" } }, required: ["query"] },
    annotations: { readOnlyHint: true },
    execute: function (args) {
      var u = ${JSON.stringify(b)} + "/search?q=" + encodeURIComponent(args.query) + (args.release ? "&release=" + encodeURIComponent(args.release) : "");
      return fetch(u).then(function (r) { return r.json(); }).then(function (j) {
        return { content: [{ type: "text", text: JSON.stringify(j) }] };
      });
    }
  });
})();
`;
  }

  async function handle(req, res) {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Accept, Mcp-Protocol-Version");
    res.set("X-Content-Type-Options", "nosniff");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    const path = route(req);
    try {
      const wait = limited(req);
      if (wait) {
        res.status(429).set("Retry-After", String(wait)).json({ error: "rate_limited", error_description: `Too many requests from this address. Try again in ${wait} seconds.` });
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
        res.set("Cache-Control", "public, max-age=60");
        const wantsMd = q.format === "md" || /text\/markdown/.test(String((req.get && req.get("accept")) || ""));
        if (wantsMd) res.status(200).type("text/markdown; charset=utf-8").send(articleMarkdown(r.body));
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
      if (path === "/llms.txt" && req.method === "GET") {
        res.set("Cache-Control", "public, max-age=300").status(200).type("text/plain; charset=utf-8").send(llmsTxt(req));
        return;
      }
      if (path === "/webmcp.js" && req.method === "GET") {
        res.set("Cache-Control", "public, max-age=300").status(200).type("application/javascript; charset=utf-8").send(webmcp(req));
        return;
      }
      res.status(404).json({ error: "not_found", error_description: "Endpoints: GET /help-api/search, GET /help-api/article, POST /help-api/mcp, GET /help-api/llms.txt, GET /help-api/webmcp.js." });
    } catch (err) {
      if (logger) logger.error("help search failed", { path, error: String(err && err.stack ? err.stack : err) });
      if (!res.headersSent) res.status(500).json({ error: "server_error" });
    }
  }

  return { handle, search, article, mcpMessage, TOOLS, _reset() { data = null; results.clear(); buckets.clear(); } };
}

module.exports = { createHelpApi, scoreArticle, supportUrl, inRange, termsOf, normaliseQuery, SERVER_INFO };
