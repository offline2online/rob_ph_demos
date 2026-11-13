#!/usr/bin/env node
/**
 * End-to-end check of the agent endpoints on PRODUCTION. The PH Website session
 * runs this after the WordPress deploy (ticket "Security gate and go-live").
 *
 *   node ph-website/tests/e2e-live.mjs              run every check, print a pass/fail table
 *   node ph-website/tests/e2e-live.mjs --dry-run    list every check, no network
 *   node ph-website/tests/e2e-live.mjs --stress     also push the WordPress tool route past its 429 limit (120/min)
 *   node ph-website/tests/e2e-live.mjs --json       machine-readable results
 *   --site <url>  --help-api <url>  --mcp <url>     override the origins (staging, local); the help API and MCP
 *                                                    default to the site's own /help-api and /mcp (the proxy, 1.8.0)
 *   --console <url>                                  the console's help API, checked only to show it still answers
 *                                                    (it is never advertised; nothing public may name it)
 *
 * Read-only: GET requests, one JSON-RPC POST, no writes. The only side effect
 * is that the CTA hop records one agent click per CTA (via=e2e) and that the
 * 429 checks use up this machine's rate-limit budget for a minute.
 * Exit code: 0 all passed (skips allowed), 1 a check failed, 2 could not run.
 * Needs Node 18+. The console-error check uses Playwright's Chromium when it
 * can be loaded and is reported SKIP otherwise.
 */
import { createRequire } from "node:module";

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const SITE = opt("--site", "https://personalisationhub.com").replace(/\/+$/, "");
const HELP = opt("--help-api", `${SITE}/help-api`).replace(/\/+$/, "");
const MCP = opt("--mcp", `${SITE}/mcp`).replace(/\/+$/, "");
const CONSOLE_HELP = opt("--console", "https://backlog-tracker-e4ed2.web.app/help-api").replace(/\/+$/, "");
// Nothing personalisationhub.com serves may name the agent console's host (14 Nov 2026).
const CONSOLE_HOST = /backlog-tracker|\.web\.app\b|firebaseapp\.com|cloudfunctions\.net/i;
const noConsole = (text, where) => { const m = String(text).replace(/\\\//g, "/").match(CONSOLE_HOST); ok(!m, `${where} names the console host (${m && m[0]})`); };
const TOOLS = `${SITE}/wp-json/ph-agent/v1/tools`;
const TRIAL = "https://aws.amazon.com/marketplace/pp/prodview-3uiwcnbrpvj76";
const DEMO = "https://calendly.com/rob-offline2online";

const FEATURES = ["digital-signage", "retail-queue-management", "retail-appointment-bookings", "white-label-retail-media-platform", "store-sites", "personalisation", "localisation-geo-targeting", "ai-agents"];
const LEGAL = ["privacy-policy", "legal", "support"];
const INDUSTRIES = ["convenience", "hospitality", "telco", "pharmacy", "retail-media", "grocery", "fashion", "qsr", "banking"];
const TOOL_NAMES = ["describe_platform", "list_industries", "get_industry", "get_feature", "search_help", "get_help_article", "start_free_trial", "book_demo", "get_installation_spec", "calculate_business_model"];
const LEAKS = /Fatal error|Warning:|Notice:|Stack trace|Traceback|\/var\/www|\/home\/|wp-content\/plugins|PDOException|mysqli|at .+\.(js|php):\d+/i;
const DEMO_NAMES = /lindt|mipharmacy|amazon-signage|australian-pork|coca-cola|webdemo|lego-comp/i;

class Skip extends Error {}
const fail = (m) => { throw new Error(m); };
const ok = (c, m) => { if (!c) fail(m); };

async function get(url, init = {}) {
  const r = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(20000), ...init });
  const text = await r.text();
  return { status: r.status, headers: r.headers, text, json() { try { return JSON.parse(text); } catch { return fail(`not JSON from ${url}: ${text.slice(0, 120)}`); } } };
}
const toolUrl = (name, args) => `${TOOLS}/${name}${args ? `?args=${encodeURIComponent(JSON.stringify(args))}` : ""}`;
const callTool = async (name, args) => (await get(toolUrl(name, args), { headers: { Accept: "application/json" } })).json();
const textOf = (res) => (res.content || []).map((c) => c.text || "").join("\n");

const checks = [];
const add = (group, name, run, opts = {}) => checks.push({ group, name, run, ...opts });

/* ---- every page type: HTML + JSON-LD + markdown twin ---- */
function ldBlocks(html) {
  return [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => JSON.parse(m[1]));
}
function checkGraph(blocks, path) {
  ok(blocks.length > 0, `${path}: no JSON-LD`);
  const nodes = blocks.flatMap((b) => (b["@graph"] ? b["@graph"] : [b]));
  for (const n of nodes) ok(n && typeof n["@type"] === "string", `${path}: a JSON-LD node has no @type`);
  const ids = nodes.map((n) => n["@id"]).filter(Boolean);
  ok(ids.length === new Set(ids).size || nodes.length > 0, `${path}: duplicate @id`);
  return nodes;
}
const pageChecks = [
  ["home", "/"], ...FEATURES.map((s) => ["feature " + s, `/${s}/`]), ...LEGAL.map((s) => ["legal " + s, `/${s}/`]),
  ["industries hub", "/industries/"], ...INDUSTRIES.map((s) => ["industry " + s, `/industries/${s}/`]),
  ["blog index", "/blog/"], ["support centre", "/support-centre/"],
];
for (const [label, path] of pageChecks) {
  add("pages", `${label}: 200, valid JSON-LD, no leaks`, async () => {
    const r = await get(SITE + path);
    ok(r.status === 200, `${path} answered ${r.status}`);
    ok(!LEAKS.test(r.text), `${path} shows a PHP or path leak`);
    const nodes = checkGraph(ldBlocks(r.text), path);
    if (path === "/" || FEATURES.some((s) => path === `/${s}/`)) {
      ok(nodes.some((n) => n["@type"] === "Organization"), `${path}: no Organization node`);
    }
  });
  add("twins", `${label}: ?format=md is markdown`, async () => {
    const r = await get(`${SITE}${path}?format=md`);
    ok(r.status === 200, `${path}?format=md answered ${r.status}`);
    ok(/text\/markdown/i.test(r.headers.get("content-type") || ""), `${path}?format=md content-type is ${r.headers.get("content-type")}`);
    ok(/^#\s+\S/m.test(r.text) && !/<(html|body|script)\b/i.test(r.text), `${path}?format=md is not clean markdown`);
    ok(!DEMO_NAMES.test(r.text.slice(0, 20000)), `${path}?format=md names a demo/client page`);
  });
}
add("twins", "a page off the allow-list has no twin", async () => {
  const r = await get(`${SITE}/lindt-chocolate/?format=md`);
  ok(!/text\/markdown/i.test(r.headers.get("content-type") || ""), "demo page served a markdown twin");
});

/* ---- llms.txt ---- */
add("llms.txt", "served as text with the agent sections", async () => {
  const r = await get(`${SITE}/llms.txt`);
  ok(r.status === 200, `/llms.txt answered ${r.status}`);
  for (const h of ["## Industries", "## Platform", "## For AI agents"]) ok(r.text.includes(h), `llms.txt lacks "${h}"`);
  ok(r.text.includes(`(${SITE}/mcp)`) && r.text.includes(`(${SITE}/help-api/`), "llms.txt does not give the personalisationhub.com MCP server and help API");
  noConsole(r.text, "llms.txt");
  ok(!DEMO_NAMES.test(r.text), "llms.txt names a demo or client page");
  ok(!LEAKS.test(r.text), "llms.txt shows a leak");
});
add("llms.txt", "every link is on the site or the help API and resolves", async () => {
  const r = await get(`${SITE}/llms.txt`);
  const links = [...r.text.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]);
  ok(links.length > 5, "llms.txt has almost no links");
  const bad = []; let n = 0;
  for (const u of [...new Set(links)].filter((x) => x.startsWith(SITE)).slice(0, 40)) {
    // /mcp is a JSON-RPC endpoint: a GET there answers 405 (POST only), which is how it resolves.
    n++; const g = await get(u); const want = u.split("?")[0].replace(/\/+$/, "") === `${SITE}/mcp` ? 405 : 200; if (g.status !== want) bad.push(`${u} ${g.status}`);
  }
  ok(!bad.length, `broken llms.txt links: ${bad.join(", ")}`);
  ok(n > 0, "no site links to check");
});

/* ---- the ten tools, over the WordPress REST route ---- */
add("tools", "tool list has all ten, read-only", async () => {
  const d = (await get(TOOLS)).json();
  ok(JSON.stringify((d.tools || []).map((t) => t.name).sort()) === JSON.stringify([...TOOL_NAMES].sort()), `tool names are ${(d.tools || []).map((t) => t.name)}`);
  ok(d.tools.every((t) => t.annotations && t.annotations.readOnlyHint === true && t.inputSchema), "a tool is missing readOnlyHint or inputSchema");
});
add("tools", "describe_platform", async () => { const r = await callTool("describe_platform"); ok(!r.isError && /Personalisation Hub/.test(textOf(r)), "no platform text"); });
add("tools", "list_industries lists live industries", async () => { const r = await callTool("list_industries"); ok(!r.isError && r.structuredContent.industries.length >= 1, "no industries"); });
for (const s of INDUSTRIES.slice(0, 3)) add("tools", `get_industry ${s}`, async () => { const r = await callTool("get_industry", { slug: s }); ok(!r.isError && /^#/m.test(textOf(r)), `no markdown for ${s}`); });
add("tools", "calculate_business_model lists Telco Retail and returns an estimate with a pre-filled link", async () => {
  const l = await callTool("calculate_business_model", {}); ok(!l.isError && (l.structuredContent.calculators || []).some((c) => c.industry === "telco"), "telco calculator not listed");
  const r = await callTool("calculate_business_model", { industry: "telco", inputs: { stores: 100 } });
  ok(!r.isError && r.structuredContent.estimate.total > 0 && /\/industries\/telco\/\?.*stores=100/.test(r.structuredContent.link), "no estimate or pre-filled link");
});
add("llms", "llms.txt lists the business model calculator", async () => { const t = (await get(`${SITE}/llms.txt`)).text; ok(/## Business model calculator/.test(t) && /Telco Retail/.test(t), "no calculator section"); });
add("ai-search", "robots.txt names the sitemap and the AI crawlers", async () => {
  const t = (await get(`${SITE}/robots.txt`)).text;
  ok(/^Sitemap:\s*https:\/\/personalisationhub\.com\/sitemaps\.xml/mi.test(t), "robots.txt has no Sitemap line");
  for (const a of ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "Claude-User", "PerplexityBot", "Perplexity-User", "Google-Extended", "Applebot-Extended", "CCBot", "Bingbot"]) ok(new RegExp(`^User-agent:\\s*${a}\\s*$`, "mi").test(t), `robots.txt does not name ${a}`);
});
add("ai-search", "llms-full.txt is plain text with llms.txt first and the twins after it", async () => {
  const r = await get(`${SITE}/llms-full.txt`); ok(r.status === 200, `answered ${r.status}`);
  ok(/text\/plain/i.test(r.headers.get("content-type") || ""), "not text/plain");
  ok(r.text.startsWith("# Personalisation Hub") && /## Key facts/.test(r.text) && /\nURL: https:\/\/personalisationhub\.com\/industries\/telco\//.test(r.text), "llms.txt or the telco twin is missing");
});
add("ai-search", "/.well-known/mcp.json is a server card whose tools match the REST tool list", async () => {
  const r = await get(`${SITE}/.well-known/mcp.json`); ok(r.status === 200, `answered ${r.status}`);
  const card = JSON.parse(r.text); const live = JSON.parse((await get(TOOLS)).text).tools;
  ok(card.endpoint === MCP && card.endpoint.startsWith(`${SITE}/`), "card endpoint is not the personalisationhub.com MCP server");
  noConsole(r.text, "/.well-known/mcp.json");
  ok(JSON.stringify(card.tools) === JSON.stringify(live), "card tools differ from /wp-json/ph-agent/v1/tools");
  ok(live.every((t) => t.title && t.description.length >= 80 && t.annotations.readOnlyHint === true && t.annotations.idempotentHint === true && t.annotations.openWorldHint === false), "a tool lacks a title, a description or an annotation");
});
add("ai-search", "the home title tag carries the brand", async () => { const t = (await get(`${SITE}/`)).text; const m = t.match(/<title>([^<]*)<\/title>/i); ok(m && /Personalisation Hub/.test(m[1]), `home title is "${m && m[1]}"`); });
add("tools", "get_feature still accepts the old retail-media-platform slug", async () => { const r = await callTool("get_feature", { slug: "retail-media-platform" }); ok(!r.isError && /^#/m.test(textOf(r)), "alias no longer works"); });
add("tools", "get_feature digital-signage", async () => { const r = await callTool("get_feature", { slug: "digital-signage" }); ok(!r.isError && /^#/m.test(textOf(r)), "no markdown"); });
add("tools", "search_help returns articles on the Support Centre", async () => {
  const r = await callTool("search_help", { query: "how do I add a store", limit: 3 });
  ok(!r.isError, `search_help: ${textOf(r)}`);
  const hits = r.structuredContent.results; ok(hits.length >= 1, "no results");
  ok(hits.every((h) => h.url.startsWith(`${SITE}/support-centre/`)), "a result URL is off the Support Centre");
  ok(!/ph_help_|"cid"|hash|programme/i.test(JSON.stringify(r)), "internal fields in search results");
});
add("tools", "get_help_article reads the first search hit", async () => {
  const s = await callTool("search_help", { query: "add a store", limit: 1 });
  ok(s.structuredContent && s.structuredContent.results.length, "no hit to read");
  const r = await callTool("get_help_article", { url: s.structuredContent.results[0].url });
  ok(!r.isError && /^#/m.test(textOf(r)), `get_help_article: ${textOf(r)}`);
});
add("tools", "start_free_trial and book_demo carry the exact links", async () => {
  const t = await callTool("start_free_trial"); const d = await callTool("book_demo");
  ok(t.structuredContent.url === TRIAL && /\/go\/free-trial\/\?via=webmcp$/.test(t.structuredContent.trackedUrl), "free trial link wrong");
  ok(d.structuredContent.url === DEMO && /\/go\/demo\/\?via=webmcp$/.test(d.structuredContent.trackedUrl), "demo link wrong");
});
add("tools", "bad input is a plain isError", async () => {
  for (const [n, a] of [["get_industry", { slug: "../../etc/passwd" }], ["search_help", { query: "" }], ["start_free_trial", { x: 1 }], ["nope", {}]]) {
    const r = await callTool(n, a); ok(r.isError === true, `${n} ${JSON.stringify(a)} was not an error`);
    ok(!LEAKS.test(JSON.stringify(r)), `${n} error leaks internals`);
  }
});

/* ---- the CTA hop ---- */
add("cta", "/go/free-trial/ and /go/demo/ 302 to the exact links", async () => {
  const a = await get(`${SITE}/go/free-trial/?via=e2e`); const b = await get(`${SITE}/go/demo/?via=remote-mcp`);
  ok(a.status === 302 && a.headers.get("location") === TRIAL, `free-trial hop: ${a.status} ${a.headers.get("location")}`);
  ok(b.status === 302 && b.headers.get("location") === DEMO, `demo hop: ${b.status} ${b.headers.get("location")}`);
  ok(/noindex/i.test(a.headers.get("x-robots-tag") || ""), "hop is indexable");
});
add("cta", "no open redirect", async () => {
  for (const u of ["/go/free-trial/?via=https://evil.example&to=https://evil.example&url=//evil.example", "/go/https://evil.example/", "/go//evil.example/", "/go/evil/"]) {
    const r = await get(SITE + u); const loc = r.headers.get("location") || "";
    ok(!/evil\.example/i.test(loc), `${u} redirects to ${loc}`);
  }
});

/* ---- headers, CORS, errors ---- */
add("security", "tool route: CORS open without credentials, nosniff, cacheable", async () => {
  const r = await get(toolUrl("describe_platform"), { headers: { Origin: "https://agent.example" } });
  ok(r.headers.get("access-control-allow-origin") === "*", `ACAO is ${r.headers.get("access-control-allow-origin")}`);
  ok(!r.headers.get("access-control-allow-credentials"), "credentials allowed");
  ok(/nosniff/i.test(r.headers.get("x-content-type-options") || ""), "no nosniff");
  ok(/max-age=300/.test(r.headers.get("cache-control") || ""), `cache-control ${r.headers.get("cache-control")}`);
});
add("security", "tool errors are not cached", async () => {
  const r = await get(toolUrl("get_industry", { slug: "nope" })); ok(/no-store/.test(r.headers.get("cache-control") || ""), `cache-control ${r.headers.get("cache-control")}`);
});
add("security", "oversized and malformed args are refused cleanly", async () => {
  const big = await get(`${TOOLS}/search_help?args=${encodeURIComponent(JSON.stringify({ query: "a".repeat(3000) }))}`);
  ok(big.json().isError === true && !LEAKS.test(big.text), "3000-char args not refused");
  const bad = await get(`${TOOLS}/search_help?args=%7Bnot-json`); ok(bad.json().isError === true && !LEAKS.test(bad.text), "malformed args not refused");
});
add("security", "traversal and SSRF through get_help_article are refused", async () => {
  for (const url of ["https://evil.example/support-centre/x/", "https://personalisationhub.com/support-centre/../wp-admin/", "https://personalisationhub.com/support-centre/%2e%2e/x/", "http://169.254.169.254/latest/meta-data/", "file:///etc/passwd", "https://personalisationhub.com@evil.example/support-centre/a/", "/digital-signage/"]) {
    const r = await callTool("get_help_article", { url }); ok(r.isError === true, `${url} was not refused`);
  }
});
add("security", "help API: CORS, nosniff, CSP, no stack traces", async () => {
  const r = await get(`${HELP}/search?q=store`, { headers: { Origin: "https://agent.example" } });
  ok(r.status === 200, `search answered ${r.status}`);
  ok(r.headers.get("access-control-allow-origin") === "*", "ACAO not *");
  ok(/nosniff/i.test(r.headers.get("x-content-type-options") || ""), "no nosniff");
  ok(/default-src 'none'/.test(r.headers.get("content-security-policy") || ""), `CSP is ${r.headers.get("content-security-policy")}`);
  ok(r.headers.get("x-ratelimit-limit"), "no X-RateLimit-Limit");
  const e = await get(`${HELP}/nope`); ok(e.status === 404 && !LEAKS.test(e.text), `unknown route: ${e.status}`);
  const m = await get(MCP); ok(m.status === 405, `GET /mcp answered ${m.status}`);
  noConsole(r.text + e.text + m.text, "help API answers");
  const q = await get(`${HELP}/search?q[]=a&q[]=b&limit=%27%20OR%201=1`); ok(q.status < 500 && !LEAKS.test(q.text), `odd query answered ${q.status}`);
});
add("security", "help API article: unknown id is 404, json and markdown do not share a cache entry", async () => {
  const s = (await get(`${HELP}/search?q=store&limit=1`)).json(); ok(s.results && s.results.length, "search found nothing");
  const id = s.results[0].id;
  const j = await get(`${HELP}/article?id=${encodeURIComponent(id)}`); ok(j.status === 200 && j.json().bodyMd !== undefined, "json article");
  ok(/accept/i.test(j.headers.get("vary") || ""), `Vary is "${j.headers.get("vary")}"`);
  const m = await get(`${HELP}/article?id=${encodeURIComponent(id)}`, { headers: { Accept: "text/markdown" } }); ok(/markdown/.test(m.headers.get("content-type") || ""), "markdown not served");
  for (const bad of ["../../etc/passwd", "x'; DROP", "%00", "a".repeat(5000)]) {
    const r = await get(`${HELP}/article?id=${encodeURIComponent(bad)}`); ok(r.status === 404 || r.status === 400, `id ${bad.slice(0, 20)} answered ${r.status}`); ok(!LEAKS.test(r.text), "leak in article error");
  }
});

/* ---- the remote MCP server ---- */
// /mcp allows 30 messages a minute per address (a batch counts each): wait out a 429 once rather than fail the run on its own budget.
const rpc = async (body) => {
  const send = () => get(MCP, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
  const r = await send();
  if (r.status !== 429) return r;
  await new Promise((res) => setTimeout(res, (Math.min(65, Number(r.headers.get("retry-after")) || 60) + 1) * 1000));
  return send();
};
add("mcp", "initialize, tools/list (ten tools), tools/call", async () => {
  const i = (await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } } })).json();
  ok(i.result && i.result.serverInfo, "initialize failed");
  const l = (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json(); ok(l.result.tools.length === 10, `tools/list has ${l.result.tools && l.result.tools.length}`);
  const c = (await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "start_free_trial", arguments: {} } })).json();
  ok(/via=remote-mcp/.test(JSON.stringify(c.result)) && !/via=webmcp/.test(JSON.stringify(c.result)), "CTA via not rewritten for remote MCP");
});
add("mcp", "unknown tool, bad JSON-RPC and oversized batch are clean errors", async () => {
  const u = (await rpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "drop_tables", arguments: {} } })).json(); ok(u.error, "unknown tool not an error");
  const g = await rpc({ nope: true }); ok(g.status < 500 && !LEAKS.test(g.text), `garbage answered ${g.status}`);
  const b = await rpc(Array.from({ length: 21 }, (_, i) => ({ jsonrpc: "2.0", id: i, method: "ping" }))); ok(b.status === 400, `21-message batch answered ${b.status}`);
});

add("mcp", "search_help, get_help_article and calculate_business_model over personalisationhub.com/mcp, no console host anywhere", async () => {
  const all = [];
  const call = async (id, name, args) => { const r = await rpc({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }); all.push(r.text); return r.json(); };
  const i = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } } }); all.push(i.text);
  all.push((await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" })).text);
  const s = await call(3, "search_help", { query: "add a store", limit: 3 });
  const hits = (s.result && s.result.structuredContent && s.result.structuredContent.results) || [];
  ok(!s.result.isError && hits.length && hits.every((h) => h.url.startsWith(`${SITE}/support-centre/`)), "search_help over /mcp found nothing on the Support Centre");
  const a = await call(4, "get_help_article", { url: hits[0].url }); ok(!a.result.isError && /^#/m.test(textOf(a.result)), "get_help_article over /mcp");
  const b = await call(5, "calculate_business_model", { industry: "telco", inputs: { stores: 100 } }); ok(!b.result.isError && b.result.structuredContent.estimate.total > 0, "calculate_business_model over /mcp");
  noConsole(all.join("\n"), "an MCP answer");
});
add("mcp", "the console's own help API still answers (kept for existing clients, never advertised)", async () => {
  const r = await get(`${CONSOLE_HELP}/search?q=store&limit=1`); ok(r.status === 200 && Array.isArray(r.json().results), `console search answered ${r.status}`);
});

/* ---- no public output names the console host (sitemap pages, twins, llms, robots, REST tools, proxy) ---- */
add("no-console-host", "every sitemap URL and its markdown twin, llms.txt, llms-full.txt, robots.txt, the server card and the REST tools", async () => {
  const seen = new Set(); const pages = []; const queue = [`${SITE}/sitemaps.xml`];
  while (queue.length && seen.size < 60) {
    const u = queue.shift(); if (seen.has(u)) continue; seen.add(u);
    const x = await get(u); if (x.status !== 200) continue;
    noConsole(x.text, u);
    for (const m of x.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) { const loc = m[1].replace(/&amp;/g, "&"); if (/\.xml(\?|$)/.test(loc)) queue.push(loc); else pages.push(loc); }
  }
  ok(pages.length > 5, `sitemaps list only ${pages.length} pages`);
  const bad = [];
  for (const u of [...new Set(pages)].slice(0, 600)) {
    for (const v of [u, `${u}${u.includes("?") ? "&" : "?"}format=md`]) { const g = await get(v); if (CONSOLE_HOST.test(g.text.replace(/\\\//g, "/"))) bad.push(v); }
  }
  for (const p of ["/llms.txt", "/llms-full.txt", "/robots.txt", "/.well-known/mcp.json", "/wp-json/ph-agent/v1/tools", "/help-api/", "/help-api/search?q=store", "/help-api/nope"]) { const g = await get(SITE + p); if (CONSOLE_HOST.test(g.text.replace(/\\\//g, "/"))) bad.push(p); }
  for (const [n, a] of [["describe_platform"], ["search_help", { query: "store", limit: 3 }], ["get_installation_spec"], ["calculate_business_model", { industry: "telco" }], ["start_free_trial"], ["book_demo"], ["list_industries"]]) {
    const t = await get(toolUrl(n, a)); if (CONSOLE_HOST.test(t.text.replace(/\\\//g, "/"))) bad.push(`ph-agent/v1/tools/${n}`);
  }
  ok(!bad.length, `names the console host: ${bad.slice(0, 8).join(", ")}${bad.length > 8 ? ` (+${bad.length - 8})` : ""}`);
});

/* ---- 429 ---- */
add("rate limit", "help API answers 429 with Retry-After past its limit (last: spends this address's minute)", async () => {
  let seen = null;
  for (let i = 0; i < 90 && !seen; i++) { const r = await get(`${HELP}/search?q=store${i % 3}`); if (r.status === 429) seen = r; }
  ok(seen, "no 429 within 90 requests");
  ok(Number(seen.headers.get("retry-after")) >= 1, "429 without Retry-After");
  ok(/no-store/.test(seen.headers.get("cache-control") || ""), "429 is cacheable");
  ok(seen.json().error === "rate_limited" && !LEAKS.test(seen.text), "429 body");
  ok(!/\d+\.\d+\.\d+\.\d+/.test(seen.text), "429 echoes an address");
}, { last: true });
add("rate limit", "WordPress tool route answers 429 past 120 a minute (--stress only)", async () => {
  if (!flag("--stress")) throw new Skip("pass --stress to run");
  let seen = null;
  for (let i = 0; i < 160 && !seen; i++) { const r = await get(`${TOOLS}/book_demo?args=${encodeURIComponent(JSON.stringify({}))}&n=${i}`); if (r.status === 429) seen = r; }
  ok(seen && Number(seen.headers.get("retry-after")) >= 1, "no 429 with Retry-After within 160 requests");
}, { last: true });

/* ---- browser: no console errors, WebMCP loader ---- */
for (const [label, path] of [["home", "/"], ["feature page", "/digital-signage/"], ["industry page", "/industries/retail-media/"], ["blog", "/blog/"], ["support centre", "/support-centre/"]]) {
  add("browser", `${label}: no console errors or failed requests`, async () => {
    let chromium;
    try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { throw new Skip("playwright not installed"); }
    const b = await chromium.launch({ args: ["--no-sandbox"] });
    try {
      const page = await b.newPage(); const errs = [];
      page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 200)); });
      page.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
      page.on("response", (r) => { if (r.url().startsWith(SITE) && r.status() >= 400 && !/favicon|\.map$/.test(r.url())) errs.push(`${r.status()} ${r.url()}`); });
      await page.goto(SITE + path, { waitUntil: "networkidle", timeout: 45000 });
      // WebMCP: with navigator.modelContext present, tools register from the REST route
      ok(!errs.length, `console/network errors: ${errs.slice(0, 3).join(" | ")}`);
    } finally { await b.close(); }
  });
}

/* ---- run ---- */
if (flag("--dry-run")) {
  console.log(`e2e-live: ${checks.length} checks (dry run, no network). site=${SITE} help-api=${HELP} mcp=${MCP}`);
  checks.forEach((c, i) => console.log(`${String(i + 1).padStart(3)}  [${c.group}] ${c.name}${c.last ? "  (runs last)" : ""}`));
  process.exit(0);
}
const ordered = [...checks.filter((c) => !c.last), ...checks.filter((c) => c.last)];
const results = [];
for (const c of ordered) {
  const t = Date.now();
  try { await c.run(); results.push({ ...c, state: "PASS", ms: Date.now() - t }); }
  catch (e) { results.push({ ...c, state: e instanceof Skip ? "SKIP" : "FAIL", note: String(e.message || e).slice(0, 220), ms: Date.now() - t }); }
}
const nFail = results.filter((r) => r.state === "FAIL").length;
if (flag("--json")) console.log(JSON.stringify({ site: SITE, helpApi: HELP, at: new Date().toISOString(), results: results.map(({ group, name, state, note, ms }) => ({ group, name, state, note, ms })) }, null, 2));
else {
  console.log(`\n${"state".padEnd(5)}  ${"group".padEnd(10)}  check`);
  for (const r of results) console.log(`${r.state.padEnd(5)}  ${r.group.padEnd(10)}  ${r.name}${r.note ? `\n${" ".repeat(19)}-> ${r.note}` : ""}`);
  const n = (s) => results.filter((r) => r.state === s).length;
  console.log(`\n${n("PASS")} passed, ${nFail} failed, ${n("SKIP")} skipped of ${results.length}  (${SITE})`);
}
process.exit(nFail ? 1 : 0);
