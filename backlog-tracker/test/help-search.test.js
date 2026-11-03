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
};
let reads = 0, logSeq = 0;
const db = { collection: (name) => ({
  where: () => ({ get: async () => { reads++; return snap(name, (a) => a.status === "published"); } }),
  get: async () => { reads++; return snap(name); },
  add: async (v) => { docs.helpSearchLog["l" + logSeq++] = v; },
}) };
function snap(name, f = () => true) {
  const rows = Object.entries(docs[name]).filter(([, v]) => f(v));
  return { forEach: (fn) => rows.forEach(([id, v]) => fn({ id, data: () => v })) };
}
let t = 1_000_000;
let mapFetches = 0, mapOk = true, twinFetches = [], twinOk = true;
const fetchImpl = async (url) => {
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
const call = async (method, path, query = {}, body, ip = "1.1.1.1") => { const res = mkRes(); await api.handle({ method, path, query, body, ip, get: () => "" }, res); await new Promise((r) => setImmediate(r)); return res; };

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

  api = createHelpApi({ db, now: () => t, rateMax: 100000 });
  // 6. MCP: initialize, list, call search + fetch; notifications get 202; unknown tool errors
  api._reset();
  r = await call("POST", "/help-api/mcp", {}, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  assert.strictEqual(r.body.result.serverInfo.name, "personalisation-hub-help");
  assert.strictEqual((await call("POST", "/help-api/mcp", {}, { jsonrpc: "2.0", method: "notifications/initialized" })).code, 202);
  r = await call("POST", "/help-api/mcp", {}, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.deepStrictEqual(r.body.result.tools.map((x) => x.name), ["search_help", "get_help_article"]);
  assert.ok(r.body.result.tools.every((x) => x.annotations.readOnlyHint));
  r = await call("POST", "/help-api/mcp", {}, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search_help", arguments: { query: "add a store" } } });
  assert.strictEqual(r.body.result.structuredContent.results[0].id, "a1");
  r = await call("POST", "/help-api/mcp", {}, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_help_article", arguments: { id: "a1" } } });
  assert.ok(r.body.result.content[0].text.includes("## Steps") && r.body.result.content[0].text.includes("| A | B |") && !r.body.result.content[0].text.includes("<p>"));
  r = await call("POST", "/help-api/mcp", {}, { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_help_article", arguments: { id: "a2" } } });
  assert.strictEqual(r.body.result.isError, true);
  assert.ok(r.body.error === undefined && (await call("POST", "/help-api/mcp", {}, { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "nope" } })).body.error.code === -32602);
  assert.strictEqual((await call("GET", "/help-api/mcp")).code, 405);

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
  console.log("help-search ok");
})().catch((e) => { console.error(e); process.exit(1); });
