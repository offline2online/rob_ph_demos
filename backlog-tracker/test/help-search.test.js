// Public help search: published-only, in-range, never pendingRevision, links
// to the recorded Support Centre URL, rate limit + cache, MCP, query log.
// Run with: node test/help-search.test.js
const assert = require("assert");
const { createHelpApi } = require("../functions/help-search");
const { zeroResultQueries, buildAuditRequestText } = require("../functions/release-audit");

const W = (slug) => ({ url: `https://personalisationhub.com/support-centre/stores/${slug}/`, status: "in-sync" });
const docs = {
  faqArticles: {
    a1: { title: "Add a store", summary: "Create a store in HQ Admin", keywords: ["store", "branch"], questionVariants: ["How do I add a store?"], directAnswer: "Open Stores and choose Add store.", articleType: "guide", categoryId: "c1", status: "published", slug: "add-a-store", bodyMd: "## Steps\nOpen Stores.", wpPublish: W("add-a-store"), updatedAt: "2026-11-01T00:00:00Z", introducedInReleaseId: "r1",
      pendingRevision: { title: "SECRET PENDING", bodyMd: "SECRET PENDING BODY", summary: "SECRET" } },
    a2: { title: "Draft store thing", summary: "store", categoryId: "c1", status: "draft", slug: "d", bodyMd: "draft body", wpPublish: W("d") },
    a3: { title: "Future store feature", summary: "store", categoryId: "c1", status: "published", slug: "future", bodyMd: "x", wpPublish: W("future"), introducedInReleaseId: "r2" },
    a4: { title: "Old store feature", summary: "store", categoryId: "c1", status: "published", slug: "old", bodyMd: "x", wpPublish: W("old"), introducedInReleaseId: "r1", removedInReleaseId: "r2" },
    a5: { title: "Store not on WordPress yet", summary: "store", categoryId: "c1", status: "published", slug: "nowp", bodyMd: "x", introducedInReleaseId: "r1" },
    a6: { title: "Retired store page", summary: "store", categoryId: "c1", status: "published", slug: "ret", bodyMd: "x", wpPublish: { url: "https://personalisationhub.com/support-centre/x/", status: "retired" } },
    a7: { title: "Store elsewhere", summary: "store", categoryId: "c1", status: "published", slug: "elsewhere", bodyMd: "x", wpPublish: { url: "https://evil.example/x/", status: "in-sync" } },
  },
  faqCategories: { c1: { name: "Stores" } },
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
let api = createHelpApi({ db, now: () => t, rateMax: 100000 });
const small = () => createHelpApi({ db, now: () => t, rateMax: 5 });
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
  assert.strictEqual(top.articleType, "guide"); assert.strictEqual(top.category, "Stores"); assert.strictEqual(top.lastUpdated, "2026-11-01T00:00:00Z");
  assert.strictEqual(r.body.release.version, "5.0");

  // 2. release parameter: id or version; out-of-range gone, unknown release 404
  r = await call("GET", "/help-api/search", { q: "store", release: "6.0" });
  assert.deepStrictEqual(r.body.results.map((x) => x.id).sort(), ["a1", "a3"]); // a4 was removed in 6.0
  r = await call("GET", "/help-api/search", { q: "store", release: "r1" });
  assert.deepStrictEqual(r.body.results.map((x) => x.id).sort(), ["a1", "a4"]);
  r = await call("GET", "/help-api/search", { q: "store", release: "9.9" }); assert.strictEqual(r.code, 404);

  // 3. never drafts, pending text, unpublished-on-WordPress, retired or foreign-host articles
  const everything = JSON.stringify([
    (await call("GET", "/help-api/search", { q: "store" })).body,
    (await call("GET", "/help-api/search", { q: "secret pending" })).body.results,
    (await call("GET", "/help-api/article", { id: "a1" })).body,
  ]);
  assert.ok(!/SECRET|draft|Draft|nowp|Retired|evil\.example|Store elsewhere|not on WordPress/i.test(everything), everything);
  for (const id of ["a2", "a5", "a6", "a7"]) assert.strictEqual((await call("GET", "/help-api/article", { id })).code, 404, id);
  assert.strictEqual((await call("GET", "/help-api/article", { id: "a3" })).code, 404); // out of the live release's range

  // 4. full article as markdown matches the live body
  r = await call("GET", "/help-api/article", { id: "a1", format: "md" });
  assert.ok(String(r.body).includes("## Steps\nOpen Stores.") && String(r.body).includes("Source: https://personalisationhub.com/support-centre/"));
  assert.ok(!String(r.body).includes("SECRET"));
  r = await call("GET", "/help-api/article", { slug: "add-a-store" }); assert.strictEqual(r.body.bodyMd, "## Steps\nOpen Stores."); assert.strictEqual(r.body.url, top.url);
  assert.strictEqual((await call("GET", "/help-api/search", { q: "" })).code, 400);

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
  assert.ok(r.body.result.content[0].text.includes("Open Stores."));
  r = await call("POST", "/help-api/mcp", {}, { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_help_article", arguments: { id: "a2" } } });
  assert.strictEqual(r.body.result.isError, true);
  assert.ok(r.body.error === undefined && (await call("POST", "/help-api/mcp", {}, { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "nope" } })).body.error.code === -32602);
  assert.strictEqual((await call("GET", "/help-api/mcp")).code, 405);

  // 6b. llms.txt entry + WebMCP snippet, CORS open, no writes possible
  r = await call("GET", "/help-api/llms.txt"); assert.ok(/\/help-api\/mcp/.test(r.body) && /\/help-api\/search/.test(r.body));
  r = await call("GET", "/help-api/webmcp.js"); assert.ok(/registerTool/.test(r.body) && /search_help/.test(r.body));
  assert.strictEqual(r.headers["Access-Control-Allow-Origin"], "*");
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
