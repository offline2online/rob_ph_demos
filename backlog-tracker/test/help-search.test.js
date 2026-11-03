// Public help search: published-only, in-range, never pendingRevision, links
// to the recorded Support Centre URL, rate limit + cache, MCP, query log.
// Run with: node test/help-search.test.js
const assert = require("assert");
const { createHelpApi } = require("../functions/help-search");
const { zeroResultQueries, buildAuditRequestText } = require("../functions/release-audit");

const U = (slug) => `https://personalisationhub.com/support-centre/stores/${slug}/`;
const fallback = (id) => `https://personalisationhub.com/support-centre/article.html?id=${id}`;
const docs = {
  faqArticles: {
    a1: { title: "Add a store", summary: "Create a store in HQ Admin", keywords: ["store", "branch"], questionVariants: ["How do I add a store?"], directAnswer: "Open Stores and choose Add store.", articleType: "guide", categoryId: "c1", status: "published", slug: "add-a-store", bodyMd: "<h2>Steps</h2><p>Open <strong>Stores</strong>.</p><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>", updatedAt: "2026-11-01T00:00:00Z", introducedInReleaseId: "r1",
      pendingRevision: { title: "SECRET PENDING", bodyMd: "SECRET PENDING BODY", summary: "SECRET" } },
    a2: { title: "Draft store thing", summary: "store", categoryId: "c1", status: "draft", slug: "d", bodyMd: "draft body", },
    a3: { title: "Future store feature", summary: "store", categoryId: "c1", status: "published", slug: "future", bodyMd: "x", introducedInReleaseId: "r2" },
    a4: { title: "Old store feature", summary: "store", categoryId: "c1", status: "published", slug: "old", bodyMd: "x", introducedInReleaseId: "r1", removedInReleaseId: "r2" },
    a5: { title: "Store missing from the WordPress map", summary: "store", docType: "reference", categoryId: "c1", status: "published", slug: "nomap", bodyMd: "x", introducedInReleaseId: "r1", order: 5 },
    a6: { title: "Store with a foreign URL in the map", summary: "store", categoryId: "c1", status: "published", slug: "foreign", bodyMd: "x", introducedInReleaseId: "r1", order: 6 },
    a8: { title: "Billing", summary: "invoices and payments", keywords: ["invoice"], questionVariants: ["Where is my invoice?"], categoryId: "c1", status: "published", slug: "billing", bodyMd: "body mentions teleport", introducedInReleaseId: "r1", order: 8 },
    a9: { title: "Invoice history", summary: "see invoices", categoryId: "c1", status: "published", slug: "inv", bodyMd: "x", introducedInReleaseId: "r1", order: 9 },
    a11: { title: "How QR Control works", summary: "QR control for displays", categoryId: "c2", status: "published", slug: "qr", bodyMd: "x", introducedInReleaseId: "r1", order: 11 },
    a12: { title: "The only thing", summary: "the", categoryId: "c2", status: "published", slug: "the", bodyMd: "x", introducedInReleaseId: "r1", order: 12 },
    a10: { title: "Invoice exports", summary: "see invoices", categoryId: "c1", status: "published", slug: "inv2", bodyMd: "x", introducedInReleaseId: "r1", order: 3 },
  },
  faqCategories: { c0: { name: "Stores & Retail Data" }, c1: { name: "HQ Admin", parentId: "c0" }, c2: { name: "Top only" } },
  releases: { r1: { name: "5.0", version: "5.0", status: "live", order: 1 }, r2: { name: "6.0", version: "6.0", status: "draft", order: 2 } },
  helpSearchLog: {},
  agentToolLog: {},
};
let reads = 0, logSeq = 0;
const db = { collection: (name) => ({
  where: () => ({ get: async () => { reads++; return snap(name, (a) => a.status === "published"); } }),
  get: async () => { reads++; return snap(name); },
  add: async (v) => { docs[name]["l" + logSeq++] = v; },
}) };
function snap(name, f = () => true) {
  const rows = Object.entries(docs[name]).filter(([, v]) => f(v));
  return { forEach: (fn) => rows.forEach(([id, v]) => fn({ id, data: () => v })) };
}
let t = 1_000_000;
let mapFetches = 0, mapOk = true, twinFetches = [], twinOk = true;
const WPT = "https://personalisationhub.com/wp-json/ph-agent/v1/tools";
const NAMES = ["describe_platform", "list_industries", "get_industry", "get_feature", "search_help", "get_help_article", "start_free_trial", "book_demo"];
let wpCalls = [], wpMode = "ok", wpText = "v1";
let wpResultOverride = null;
const wpResult = (name, q) => wpResultOverride && name === "book_demo" ? wpResultOverride(name) : ({ content: [{ type: "text", text: `${name} ${q} ${wpText}` }], structuredContent: { name } });
const wpFetch = async (url, opts) => {
  wpCalls.push(url);
  if (wpMode === "down") return { ok: false, status: 503, headers: { get: () => null }, text: async () => "" };
  if (wpMode === "hang") return new Promise((_, rej) => opts.signal && opts.signal.addEventListener("abort", () => rej(new Error("aborted"))));
  if (wpMode === "huge") return { ok: true, status: 200, headers: { get: () => String(10 * 1024 * 1024) }, text: async () => "{}" };
  const body = url === WPT
    ? { tools: [...NAMES, "secret_write_tool"].map((n) => ({ name: n, description: n, inputSchema: { type: "object" }, annotations: { readOnlyHint: true } })) }
    : wpResult(url.slice(WPT.length + 1).split("?")[0], decodeURIComponent((url.split("?args=")[1]) || ""));
  return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) };
};
const fetchImpl = async (url, opts) => {
  if (url.startsWith(WPT)) return wpFetch(url, opts);
  if (url.endsWith("?format=md")) {
    twinFetches.push(url);
    if (!twinOk) return { ok: false, status: 503, text: async () => "" };
    return { ok: true, status: 200, headers: { get: () => "text/markdown" }, text: async () => "# Add a store\n\n## Steps\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n" };
  }
  mapFetches++; assert.strictEqual(url, "https://personalisationhub.com/wp-json/ph-help/v1/published");
  if (!mapOk) return { ok: false, status: 503, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => ({ articles: [{ id: "a1", url: U("add-a-store") }, { id: "a6", url: "https://evil.example/x/" }, { id: "a8", url: U("billing") }] }) };
};
let api = createHelpApi({ db, now: () => t, rateMax: 100000, fetchImpl });
const small = () => createHelpApi({ db, now: () => t, rateMax: 5, fetchImpl });
const mkRes = () => { const r = { code: 200, headers: {}, body: undefined, set(k, v) { r.headers[k] = v; return r; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; }, send(b) { r.body = b; return r; }, type(x) { r.headers["Content-Type"] = x; return r; } }; return r; };
const call = async (method, path, query = {}, body, ip = "1.1.1.1", hdr = {}) => { const res = mkRes(); await api.handle({ method, path, query, body, ip, get: (k) => hdr[String(k).toLowerCase()] || "" }, res); await new Promise((r) => setImmediate(r)); return res; };

(async () => {
  // 1. relevant, linked, complete, and only the right articles
  let r = await call("GET", "/help-api/search", { q: "how do I add a store" });
  assert.strictEqual(r.code, 200);
  assert.strictEqual(r.body.results[0].id, "a1", JSON.stringify(r.body));
  const top = r.body.results[0];
  assert.strictEqual(top.title, "Add a store"); assert.strictEqual(top.directAnswer, "Open Stores and choose Add store.");
  assert.strictEqual(top.summary, "Create a store in HQ Admin"); assert.strictEqual(top.url, "https://personalisationhub.com/support-centre/stores/add-a-store/");
  assert.strictEqual(top.articleType, "guide"); assert.strictEqual(top.category, "Stores & Retail Data"); assert.strictEqual(top.folder, "HQ Admin"); assert.strictEqual(top.lastUpdated, "2026-11-01T00:00:00Z");
  assert.strictEqual(r.body.release.version, "5.0");

  // 1b. questions search like their keywords: stop words dropped, stop-word-only queries kept
  const ids = (x) => x.body.results.map((y) => y.id);
  assert.deepStrictEqual(ids(await call("GET", "/help-api/search", { q: "how do I add a store" })), ids(await call("GET", "/help-api/search", { q: "add a store" })));
  assert.strictEqual((await call("GET", "/help-api/search", { q: "what is QR control" })).body.results[0].id, "a11");
  r = await call("GET", "/help-api/search", { q: "the" }); assert.strictEqual(r.body.results[0].id, "a12");
  assert.strictEqual(r.body.results[0].category, "Top only"); assert.ok(!("folder" in r.body.results[0]));
  const { termsOf } = require("../functions/help-search");
  assert.deepStrictEqual(termsOf("How do I add a store?"), ["add", "store"]); assert.deepStrictEqual(termsOf("to the"), ["to", "the"]);

  // 2. release parameter: id or version; out-of-range gone, unknown release 404
  r = await call("GET", "/help-api/search", { q: "store", release: "6.0" });
  assert.deepStrictEqual(r.body.results.map((x) => x.id).sort(), ["a1", "a3", "a5", "a6"]); // a4 was removed in 6.0
  r = await call("GET", "/help-api/search", { q: "store", release: "r1" });
  assert.deepStrictEqual(r.body.results.map((x) => x.id).sort(), ["a1", "a4", "a5", "a6"]);
  r = await call("GET", "/help-api/search", { q: "store", release: "9.9" }); assert.strictEqual(r.code, 404);

  // 3. never drafts or pending text
  const everything = JSON.stringify([
    (await call("GET", "/help-api/search", { q: "store" })).body,
    (await call("GET", "/help-api/search", { q: "secret pending" })).body.results,
    (await call("GET", "/help-api/article", { id: "a1" })).body,
  ]);
  assert.ok(!/SECRET|draft|Draft|evil\.example/i.test(everything), everything);
  assert.strictEqual((await call("GET", "/help-api/article", { id: "a2" })).code, 404);
  assert.strictEqual((await call("GET", "/help-api/article", { id: "a3" })).code, 404); // out of the live release's range

  // 4. full article as markdown: the WordPress twin, cached; HTML-to-markdown when WordPress is down
  r = await call("GET", "/help-api/article", { id: "a1", format: "md" });
  assert.ok(String(r.body).includes("## Steps") && String(r.body).includes("| A | B |") && !/<p>/.test(String(r.body)) && String(r.body).includes("Source: https://personalisationhub.com/support-centre/"));
  assert.deepStrictEqual(twinFetches, [U("add-a-store") + "?format=md"]);
  await call("GET", "/help-api/article", { id: "a1", format: "md" }); assert.strictEqual(twinFetches.length, 1); // cached 5 minutes
  assert.ok(!String(r.body).includes("SECRET"));
  api._reset(); twinOk = false;
  r = await call("GET", "/help-api/article", { id: "a1", format: "md" });
  assert.ok(String(r.body).startsWith("# Add a store") && String(r.body).includes("## Steps") && String(r.body).includes("**Stores**") && String(r.body).includes("| A | B |") && !/<[a-z]/.test(String(r.body)), r.body);
  twinOk = true; api._reset();
  r = await call("GET", "/help-api/article", { slug: "add-a-store" }); assert.ok(r.body.bodyMd.includes("<h2>Steps</h2>")); assert.strictEqual(r.body.url, top.url);
  assert.strictEqual(r.body.category, "Stores & Retail Data"); assert.strictEqual(r.body.folder, "HQ Admin");
  assert.strictEqual((await call("GET", "/help-api/search", { q: "" })).code, 400);

  // 4b. URLs: from the WordPress map (cached), fallback when missing, foreign host or the map is down
  r = await call("GET", "/help-api/search", { q: "store" });
  const byId = Object.fromEntries(r.body.results.map((x) => [x.id, x]));
  assert.strictEqual(byId.a1.url, U("add-a-store"));
  assert.strictEqual(byId.a5.url, fallback("a5")); assert.strictEqual(byId.a5.articleType, "reference"); // docType fallback
  assert.strictEqual(byId.a6.url, fallback("a6")); // foreign host never returned
  const f0 = mapFetches; await call("GET", "/help-api/search", { q: "billing" }); await call("GET", "/help-api/article", { id: "a1" });
  assert.strictEqual(mapFetches, f0); // map cached
  api._reset(); mapOk = false;
  r = await call("GET", "/help-api/search", { q: "add a store" }); assert.strictEqual(r.code, 200);
  assert.strictEqual(r.body.results[0].url, fallback("a1"));
  mapOk = true; api._reset();

  // 4c. the Support Centre's scoring: all terms must match, title 12/8, keyword 5, variant 4, summary 2, order breaks ties, no body matching
  const sc = require("../functions/help-search").scoreArticle;
  const A = docs.faqArticles.a8;
  assert.strictEqual(sc(A, ["bill"]), 12); assert.strictEqual(sc(A, ["ill"]), 8); assert.strictEqual(sc(A, ["invoice"]), 5 + 4 + 2);
  assert.strictEqual(sc(A, ["billing", "nonsense"]), 0); // any-term matching is gone
  assert.strictEqual(sc(A, ["teleport"]), 0); // body is not scored
  r = await call("GET", "/help-api/search", { q: "invoice" });
  assert.deepStrictEqual(r.body.results.map((x) => x.id), ["a10", "a9", "a8"].sort((x, y) => (sc(docs.faqArticles[y], ["invoice"]) - sc(docs.faqArticles[x], ["invoice"])) || docs.faqArticles[x].order - docs.faqArticles[y].order));
  assert.strictEqual((await call("GET", "/help-api/search", { q: "teleport" })).body.matched, 0);
  assert.strictEqual((await call("GET", "/help-api/search", { q: "billing nonsense" })).body.matched, 0);

  // 5. cache: an identical query is served from cache without re-reading
  api._reset();
  await call("GET", "/help-api/search", { q: "add a store" }, undefined, "9.9.9.9");
  const before = reads;
  r = await call("GET", "/help-api/search", { q: "  Add A  Store ", }, undefined, "9.9.9.9");
  assert.strictEqual(r.headers["X-Cache"], "HIT"); assert.strictEqual(reads, before);

  // 5b. rate limit: 429 with Retry-After, then the window resets
  api = small();
  for (let i = 0; i < 5; i++) assert.strictEqual((await call("GET", "/help-api/search", { q: "store" }, undefined, "2.2.2.2")).code, 200);
  r = await call("GET", "/help-api/search", { q: "store" }, undefined, "2.2.2.2");
  assert.strictEqual(r.code, 429); assert.ok(Number(r.headers["Retry-After"]) >= 1);
  assert.strictEqual((await call("GET", "/help-api/search", { q: "store" }, undefined, "3.3.3.3")).code, 200); // another address is fine
  t += 61_000;
  assert.strictEqual((await call("GET", "/help-api/search", { q: "store" }, undefined, "2.2.2.2")).code, 200);

  api = createHelpApi({ db, now: () => t, rateMax: 100000, fetchImpl });
  // 6. MCP: a live proxy of the site's eight tools. initialize, list, call; notifications get 202; unknown tool errors
  api._reset(); wpCalls = []; wpMode = "ok";
  r = await call("POST", "/help-api/mcp", {}, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  assert.strictEqual(r.body.result.serverInfo.name, "personalisation-hub-help");
  assert.strictEqual((await call("POST", "/help-api/mcp", {}, { jsonrpc: "2.0", method: "notifications/initialized" })).code, 202);
  r = await call("POST", "/help-api/mcp", {}, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.deepStrictEqual(r.body.result.tools.map((x) => x.name), NAMES); // the site's list, allow-listed: secret_write_tool is dropped
  assert.ok(r.body.result.tools.every((x) => x.annotations.readOnlyHint));
  assert.strictEqual(r.headers["X-Cache"], "MISS");
  r = await call("POST", "/help-api/mcp", {}, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.strictEqual(r.headers["X-Cache"], "HIT"); assert.strictEqual(wpCalls.length, 1);
  // every tool answers exactly what the site's endpoint answers, for the same arguments
  for (const n of NAMES) {
    const args = n === "get_industry" ? { slug: "telco" } : {};
    r = await call("POST", "/help-api/mcp", {}, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: n, arguments: args } });
    const direct = await (await wpFetch(`${WPT}/${n}${n === "get_industry" ? "?args=" + encodeURIComponent(JSON.stringify(args)) : ""}`)).text();
    assert.deepStrictEqual(r.body.result, JSON.parse(direct).content ? JSON.parse(direct) : null, n);
    assert.strictEqual(r.headers["X-Cache"], "MISS");
  }
  // RevOps: one agentToolLog row per tool call, no IP / arguments / user agent; CTA tools point at the tracked hop for this source
  const rows = () => Object.values(docs.agentToolLog);
  assert.strictEqual(rows().length, NAMES.length, "one row per tools/call");
  assert.ok(rows().every((x) => x.source === "remote-mcp" && x.referrer === null && x.at instanceof Date && typeof x.cached === "boolean"));
  assert.ok(rows().every((x) => Object.keys(x).sort().join() === "at,cached,ok,referrer,source,tool"), "no fields beyond tool, source, referrer, time, cache, ok");
  assert.deepStrictEqual(rows().map((x) => x.tool), NAMES);
  logSeq += 0;
  r = await call("POST", "/help-api/mcp", {}, { jsonrpc: "2.0", id: 20, method: "tools/call", params: { name: "get_industry", arguments: { slug: "secret-customer" } } }, "9.9.9.9", { referer: "https://agent.example/chat?q=private#x", "user-agent": "X" });
  const last = rows()[rows().length - 1];
  assert.strictEqual(last.referrer, "agent.example"); assert.ok(!JSON.stringify(last).includes("secret-customer") && !JSON.stringify(last).includes("9.9.9.9") && !JSON.stringify(last).includes("private"));
  const nRows = rows().length;
  await call("POST", "/help-api/mcp", {}, { jsonrpc: "2.0", id: 21, method: "tools/list" });
  await call("POST", "/help-api/mcp", {}, { jsonrpc: "2.0", id: 22, method: "tools/call", params: { name: "secret_write_tool" } });
  assert.strictEqual(rows().length, nRows, "tools/list and unknown tools are not tool-call events");
  // the CTA tools: trackedUrl is rewritten for this source, the exact url is untouched
  wpResultOverride = (n) => ({ content: [{ type: "text", text: `x https://personalisationhub.com/go/demo/?via=webmcp` }], structuredContent: { url: "https://calendly.com/rob-offline2online", trackedUrl: "https://personalisationhub.com/go/demo/?via=webmcp" } });
  r = await call("POST", "/help-api/mcp", {}, { jsonrpc: "2.0", id: 23, method: "tools/call", params: { name: "book_demo", arguments: { cta: 1 } } });
  assert.strictEqual(r.body.result.structuredContent.trackedUrl, "https://personalisationhub.com/go/demo/?via=remote-mcp");
  assert.strictEqual(r.body.result.structuredContent.url, "https://calendly.com/rob-offline2online");
  assert.ok(!JSON.stringify(r.body.result).includes("via=webmcp"));
  wpResultOverride = null;
  // a repeat is a HIT with no new site request; different args are a different entry; key order doesn't matter
  const wpBefore = wpCalls.length;
  r = await call("POST", "/help-api/mcp", {}, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_industry", arguments: { slug: "telco" } } });
  assert.strictEqual(r.headers["X-Cache"], "HIT"); assert.strictEqual(wpCalls.length, wpBefore);
  r = await call("POST", "/help-api/mcp", {}, { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "search_help", arguments: { query: "store", limit: 3 } } });
  r = await call("POST", "/help-api/mcp", {}, { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "search_help", arguments: { limit: 3, query: "store" } } });
  assert.strictEqual(r.headers["X-Cache"], "HIT");
  assert.ok(wpCalls.every((u) => u.startsWith(WPT)), "fixed origin only");
  // not on the allow-list: never reaches the site
  const n0 = wpCalls.length;
  r = await call("POST", "/help-api/mcp", {}, { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "secret_write_tool" } });
  assert.strictEqual(r.body.error.code, -32602);
  r = await call("POST", "/help-api/mcp", {}, { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "../../wp-admin" } });
  assert.strictEqual(r.body.error.code, -32602); assert.strictEqual(wpCalls.length, n0);
  r = await call("POST", "/help-api/mcp", {}, { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "search_help", arguments: { query: "x".repeat(2500) } } });
  assert.strictEqual(r.body.result.isError, true); assert.strictEqual(wpCalls.length, n0);
  assert.strictEqual((await call("GET", "/help-api/mcp")).code, 405);
  // 5 minutes later the site is read again, so a published change shows up with no redeploy
  wpText = "v2"; t += 5 * 60_000 + 1;
  r = await call("POST", "/help-api/mcp", {}, { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "describe_platform" } });
  assert.ok(r.body.result.content[0].text.endsWith("v2")); assert.strictEqual(r.headers["X-Cache"], "MISS");

  // 6a. the site is unreachable: a plain isError within the timeout, the failure remembered 30 s only, the last good answer kept
  api = createHelpApi({ db, now: () => t, rateMax: 100000, fetchImpl, wpTimeoutMs: 150 });
  wpMode = "hang"; wpCalls = [];
  let t0 = Date.now();
  r = await call("POST", "/help-api/mcp", {}, { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "book_demo" } });
  assert.ok(Date.now() - t0 < 1000);
  assert.strictEqual(r.body.result.isError, true); assert.ok(!/Error:|at \w/.test(r.body.result.content[0].text));
  r = await call("POST", "/help-api/mcp", {}, { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "book_demo" } });
  assert.strictEqual(r.body.result.isError, true); assert.strictEqual(wpCalls.length, 1, "failure cached, no hammering");
  r = await call("POST", "/help-api/mcp", {}, { jsonrpc: "2.0", id: 9, method: "tools/list" });
  assert.strictEqual(r.body.error.code, -32603);
  wpMode = "ok"; t += 31_000;
  r = await call("POST", "/help-api/mcp", {}, { jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "book_demo" } });
  assert.ok(!r.body.result.isError, "recovers after 30 s");
  wpMode = "down"; wpText = "v3"; t += 5 * 60_000 + 1;
  r = await call("POST", "/help-api/mcp", {}, { jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "book_demo" } });
  assert.ok(!r.body.result.isError && r.body.result.content[0].text.endsWith("v2"), "last good answer kept"); // v2 was the last good text for this entry
  wpMode = "huge"; t += 31_000 + 5 * 60_000;
  r = await call("POST", "/help-api/mcp", {}, { jsonrpc: "2.0", id: 12, method: "tools/call", params: { name: "get_feature", arguments: { slug: "x" } } });
  assert.strictEqual(r.body.result.isError, true, "oversized site response refused");
  wpMode = "ok"; wpText = "v1"; api = createHelpApi({ db, now: () => t, rateMax: 100000, fetchImpl }); api._reset();

  // 6b. WebMCP and llms.txt are WordPress-side: not served here. CORS open, no writes possible
  assert.strictEqual((await call("GET", "/help-api/llms.txt")).code, 404);
  assert.strictEqual((await call("GET", "/help-api/webmcp.js")).code, 404);
  r = await call("GET", "/help-api/search", { q: "store" }); assert.strictEqual(r.headers["Access-Control-Allow-Origin"], "*");
  assert.strictEqual((await call("POST", "/help-api/search", { q: "store" })).code, 404);

  // 7. the usage log records each query and whether it returned anything
  api._reset(); Object.keys(docs.helpSearchLog).forEach((k) => delete docs.helpSearchLog[k]);
  await call("GET", "/help-api/search", { q: "add a store" }, undefined, "5.5.5.5");
  await call("GET", "/help-api/search", { q: "quantum teleport" }, undefined, "5.5.5.5");
  await call("GET", "/help-api/search", { q: "quantum teleport" }, undefined, "5.5.5.5");
  const logs = Object.values(docs.helpSearchLog);
  assert.strictEqual(logs.length, 3);
  assert.deepStrictEqual(logs.map((l) => l.zeroResults), [false, true, true]);
  assert.ok(logs.every((l) => l.query && l.at instanceof Date && !("ip" in l)));
  const gaps = zeroResultQueries(logs);
  assert.deepStrictEqual(gaps, [{ query: "quantum teleport", count: 2 }]);
  const text = buildAuditRequestText({ releaseId: "R", release: { name: "x" }, projects: [], searchGaps: gaps });
  assert.ok(text.includes('"quantum teleport" (2x)'));
  assert.ok(!buildAuditRequestText({ releaseId: "R", release: {}, projects: [] }).includes("content gaps"));

  // 8. agent-endpoint hardening: per-endpoint limits, headers, article cache, alerting
  {
    const alerts = [];
    api = createHelpApi({ db, now: () => t, rateMax: 10, fetchImpl, alert: async (a) => { alerts.push(a); } });
    // headers on every response; MCP has its own, smaller budget (5 of 10)
    r = await call("GET", "/help-api/search", { q: "store" }, undefined, "7.7.7.7");
    assert.strictEqual(r.headers["X-RateLimit-Limit"], "10"); assert.strictEqual(r.headers["X-RateLimit-Remaining"], "9");
    for (let i = 0; i < 5; i++) assert.strictEqual((await call("POST", "/help-api/mcp", {}, { jsonrpc: "2.0", id: i, method: "ping" }, "8.8.8.8")).code, 200);
    r = await call("POST", "/help-api/mcp", {}, { jsonrpc: "2.0", id: 9, method: "ping" }, "8.8.8.8");
    assert.strictEqual(r.code, 429); assert.strictEqual(r.headers["X-RateLimit-Limit"], "5"); assert.ok(Number(r.headers["Retry-After"]) >= 1);
    assert.strictEqual(r.headers["Cache-Control"], "no-store"); assert.strictEqual(r.body.error, "rate_limited");
    // the MCP limit does not eat the same client's search budget, and article is limited too
    assert.strictEqual((await call("GET", "/help-api/search", { q: "store" }, undefined, "8.8.8.8")).code, 200);
    for (let i = 0; i < 10; i++) await call("GET", "/help-api/article", { id: "a1" }, undefined, "6.6.6.6");
    assert.strictEqual((await call("GET", "/help-api/article", { id: "a1" }, undefined, "6.6.6.6")).code, 429);
    // article repeat calls are served from cache without re-reading
    api._reset();
    await call("GET", "/help-api/article", { id: "a1" }, undefined, "4.4.4.4");
    const rd = reads;
    r = await call("GET", "/help-api/article", { id: "a1" }, undefined, "4.4.4.4");
    assert.strictEqual(r.headers["X-Cache"], "HIT"); assert.strictEqual(reads, rd); assert.strictEqual(r.code, 200);
    assert.strictEqual((await call("GET", "/help-api/article", { id: "a2" }, undefined, "4.4.4.4")).code, 404); // never cached into a draft leak
    // abuse alert: a burst of 429s sends exactly one alert naming the top client, then cools down
    api._reset(); alerts.length = 0;
    for (let i = 0; i < 70; i++) await call("GET", "/help-api/search", { q: "store" }, undefined, "5.4.3.2");
    await new Promise((x) => setImmediate(x));
    assert.strictEqual(alerts.length, 1, JSON.stringify(alerts));
    assert.strictEqual(alerts[0].kind, "abuse"); assert.ok(alerts[0].text.includes("5.4.3.2")); assert.ok(alerts[0].stats.rateLimited >= 50);
    for (let i = 0; i < 20; i++) await call("GET", "/help-api/search", { q: "store" }, undefined, "5.4.3.2");
    assert.strictEqual(alerts.length, 1); // cooldown
    t += 31 * 60 * 1000;
    for (let i = 0; i < 70; i++) await call("GET", "/help-api/search", { q: "store" }, undefined, "5.4.3.2");
    await new Promise((x) => setImmediate(x));
    assert.strictEqual(alerts.length, 2);
    // error alert: failing reads (5xx) trip it
    const broken = createHelpApi({ db: { collection: () => ({ where: () => ({ get: async () => { throw new Error("boom"); } }), get: async () => { throw new Error("boom"); } }) }, now: () => t, rateMax: 1000, fetchImpl, alert: async (a) => { alerts.push(a); } });
    alerts.length = 0;
    for (let i = 0; i < 6; i++) { const res = mkRes(); await broken.handle({ method: "GET", path: "/help-api/search", query: { q: "store" }, ip: "1.2.3.4", get: () => "" }, res); assert.strictEqual(res.code, 500); }
    await new Promise((x) => setImmediate(x));
    assert.deepStrictEqual(alerts.map((a) => a.kind), ["errors"]);
    // a test alert always goes out and carries the stats
    alerts.length = 0;
    assert.strictEqual(api.testAlert(), true); assert.strictEqual(api.testAlert(), true);
    await new Promise((x) => setImmediate(x));
    assert.deepStrictEqual(alerts.map((a) => a.kind), ["test", "test"]);
    // an alert that fails to deliver never breaks the request
    const bad = createHelpApi({ db, now: () => t, rateMax: 1, fetchImpl, alert: async () => { throw new Error("webhook down"); } });
    api = bad; await call("GET", "/help-api/search", { q: "store" }, undefined, "9.1.1.1");
    for (let i = 0; i < 60; i++) assert.ok([200, 429].includes((await call("GET", "/help-api/search", { q: "store" }, undefined, "9.1.1.1")).code));
    api = createHelpApi({ db, now: () => t, rateMax: 100000, fetchImpl });
  }
  // 9. the published map failing: retried after 30 s (not 5 min), last good map kept, map-less results not cached
  {
    api = createHelpApi({ db, now: () => t, rateMax: 100000, fetchImpl });
    mapOk = false; mapFetches = 0;
    r = await call("GET", "/help-api/search", { q: "add a store" });
    assert.strictEqual(r.body.results[0].url, fallback("a1")); assert.strictEqual(mapFetches, 1);
    r = await call("GET", "/help-api/search", { q: "add a store" });
    assert.notStrictEqual(r.headers["X-Cache"], "HIT"); // built without a map: never cached
    r = await call("GET", "/help-api/article", { id: "a1" });
    assert.notStrictEqual((await call("GET", "/help-api/article", { id: "a1" })).headers["X-Cache"], "HIT");
    t += 10 * 1000; mapFetches = 0;
    await call("GET", "/help-api/search", { q: "add a store" });
    assert.strictEqual(mapFetches, 0); // inside the 30 s failure window
    t += 25 * 1000; mapOk = true;
    r = await call("GET", "/help-api/search", { q: "add a store" });
    assert.strictEqual(mapFetches, 1); assert.strictEqual(r.body.results[0].url, U("add-a-store")); // recovered after 30 s
    assert.strictEqual((await call("GET", "/help-api/search", { q: "add a store" })).headers["X-Cache"], "HIT");
    // a refresh that fails keeps the last good map, and those results may be cached
    t += 6 * 60 * 1000; mapOk = false; mapFetches = 0;
    r = await call("GET", "/help-api/search", { q: "add a store" });
    assert.strictEqual(mapFetches, 1); assert.strictEqual(r.body.results[0].url, U("add-a-store"));
    assert.strictEqual((await call("GET", "/help-api/search", { q: "add a store" })).headers["X-Cache"], "HIT");
    mapOk = true;
    api = createHelpApi({ db, now: () => t, rateMax: 100000, fetchImpl });
  }
  console.log("help-search ok");
})().catch((e) => { console.error(e); process.exit(1); });
