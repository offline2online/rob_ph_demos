// Leak test for the public help endpoints: /help-api/search, /help-api/article
// (JSON and markdown) and the remote MCP server (/help-api/mcp). Seeds drafts,
// a pending revision, a retire proposal, out-of-range release articles and
// internal-only fields, then asserts none of it appears in ANY response.
// No network: Firestore and fetch are stubbed. Run: node test/help-leak.test.js
const assert = require("assert");
const { createHelpApi } = require("../functions/help-search");

// Every sentinel below must never be seen in a response body.
const LEAKS = [
  "LEAK_DRAFT", "LEAK_PENDING", "LEAK_RETIRE", "LEAK_FUTURE", "LEAK_REMOVED",
  "LEAK_PH_HELP_ID", "LEAK_HASH", "LEAK_PROGRAMME", "LEAK_PROJECT", "LEAK_INTERNAL",
  "LEAK_SECRET_TOOL", "LEAK_UPSTREAM_PATH",
];
const FORBIDDEN_KEYS = ["pendingRevision", "retireProposal", "ph_help_id", "ph_help_hash", "contentHash", "hash", "programme", "projectId", "project", "internalNotes", "status", "bodyHtml"];

const U = (slug) => `https://personalisationhub.com/support-centre/stores/${slug}/`;
const docs = {
  faqArticles: {
    pub: { title: "Add a store", summary: "Create a store", keywords: ["store"], questionVariants: ["How do I add a store?"], directAnswer: "Open Stores.", articleType: "guide", categoryId: "c1", status: "published", slug: "add-a-store", bodyMd: "<p>Open Stores.</p>", introducedInReleaseId: "r1", order: 1,
      pendingRevision: { title: "LEAK_PENDING", bodyMd: "LEAK_PENDING body", summary: "LEAK_PENDING" },
      retireProposal: { reason: "LEAK_RETIRE" },
      ph_help_id: "LEAK_PH_HELP_ID", ph_help_hash: "LEAK_HASH", contentHash: "LEAK_HASH", hash: "LEAK_HASH",
      programme: "LEAK_PROGRAMME", projectId: "LEAK_PROJECT", project: "LEAK_PROJECT", internalNotes: "LEAK_INTERNAL" },
    draft: { title: "LEAK_DRAFT store", summary: "store LEAK_DRAFT", categoryId: "c1", status: "draft", slug: "draft", bodyMd: "LEAK_DRAFT", introducedInReleaseId: "r1" },
    future: { title: "LEAK_FUTURE store", summary: "store", categoryId: "c1", status: "published", slug: "future", bodyMd: "LEAK_FUTURE", introducedInReleaseId: "r2" },
    removed: { title: "LEAK_REMOVED store", summary: "store", categoryId: "c1", status: "published", slug: "removed", bodyMd: "LEAK_REMOVED", introducedInReleaseId: "r1", removedInReleaseId: "r1" },
    retired: { title: "LEAK_RETIRE store", summary: "store", categoryId: "c1", status: "retired", slug: "retired", bodyMd: "LEAK_RETIRE", introducedInReleaseId: "r1" },
  },
  faqCategories: { c1: { name: "HQ Admin" } },
  releases: { r1: { name: "5.0", version: "5.0", status: "live", order: 1 }, r2: { name: "6.0", version: "6.0", status: "draft", order: 2 } },
  helpSearchLog: {},
};
const snap = (name, f = () => true) => { const rows = Object.entries(docs[name]).filter(([, v]) => f(v)); return { forEach: (fn) => rows.forEach(([id, v]) => fn({ id, data: () => v })) }; };
const db = { collection: (name) => ({ where: () => ({ get: async () => snap(name, (a) => a.status === "published") }), get: async () => snap(name), add: async () => {} }) };

const WPT = "https://personalisationhub.com/wp-json/ph-agent/v1/tools";
const NAMES = ["describe_platform", "list_industries", "get_industry", "get_feature", "search_help", "get_help_article", "start_free_trial", "book_demo"];
const fetched = [];
const fetchImpl = async (url) => {
  fetched.push(url);
  if (url.endsWith("?format=md")) return { ok: true, status: 200, headers: { get: () => "text/markdown" }, text: async () => "# Add a store\n\nOpen Stores.\n" };
  if (url === "https://personalisationhub.com/wp-json/ph-help/v1/published") return { ok: true, status: 200, json: async () => ({ articles: [{ id: "pub", url: U("add-a-store") }] }) };
  if (url === WPT) return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ tools: [...NAMES, "LEAK_SECRET_TOOL"].map((n) => ({ name: n, description: n, inputSchema: { type: "object" }, annotations: { readOnlyHint: true } })) }) };
  if (url.startsWith(WPT + "/")) return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ content: [{ type: "text", text: "ok " + url.slice(WPT.length + 1).split("?")[0] }] }) };
  throw new Error("unexpected fetch (no network in this test): " + url);
};

const api = createHelpApi({ db, now: () => 1_000_000, rateMax: 100000, fetchImpl });
const mkRes = () => { const r = { code: 200, headers: {}, body: undefined, set(k, v) { r.headers[k] = v; return r; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; }, send(b) { r.body = b; return r; }, type(x) { r.headers["Content-Type"] = x; return r; } }; return r; };
const call = async (method, path, query = {}, body) => { const res = mkRes(); await api.handle({ method, path, query, body, ip: "1.1.1.1", get: () => "" }, res); await new Promise((r) => setImmediate(r)); return res; };

function keysOf(v, out = new Set()) { if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.add(k); keysOf(x, out); } return out; }
function assertClean(endpoint, res, allow = []) {
  const text = typeof res.body === "string" ? res.body : JSON.stringify(res.body);
  for (const s of LEAKS.filter((x) => !allow.includes(x))) assert.ok(!text.includes(s), `LEAK in ${endpoint}: response contains ${s}`);
  const keys = keysOf(typeof res.body === "object" ? res.body : {});
  for (const k of FORBIDDEN_KEYS) assert.ok(!keys.has(k), `LEAK in ${endpoint}: response has internal field "${k}"`);
}

(async () => {
  // /help-api/search: every probe word that matches a seeded private article
  for (const q of ["store", "LEAK_DRAFT", "LEAK_PENDING", "LEAK_FUTURE", "LEAK_REMOVED", "LEAK_RETIRE", "LEAK_INTERNAL", "LEAK_HASH", "LEAK_PROGRAMME"]) {
    for (const release of [undefined, "5.0", "6.0", "r1", "r2"]) {
      // An explicit request for the draft release 6.0 legitimately includes its own (published) articles.
      const own = release === "6.0" || release === "r2" ? ["LEAK_FUTURE"] : [];
      assertClean(`/help-api/search?q=${q}&release=${release}`, await call("GET", "/help-api/search", { q, release }), own);
    }
  }
  const s = await call("GET", "/help-api/search", { q: "store" });
  assert.deepStrictEqual(s.body.results.map((x) => x.id), ["pub"], "only the published, in-range article is found");

  // /help-api/article: the public one is clean; every private one is a 404
  assertClean("/help-api/article?id=pub", await call("GET", "/help-api/article", { id: "pub" }));
  assertClean("/help-api/article?id=pub&format=md", await call("GET", "/help-api/article", { id: "pub", format: "md" }));
  for (const id of ["draft", "future", "removed", "retired"]) {
    const r = await call("GET", "/help-api/article", { id });
    assert.strictEqual(r.code, 404, `/help-api/article?id=${id} must be 404`);
    assertClean(`/help-api/article?id=${id}`, r);
    const m = await call("GET", "/help-api/article", { slug: id, format: "md" });
    assert.strictEqual(m.code, 404, `/help-api/article?slug=${id}&format=md must be 404`);
    assertClean(`/help-api/article?slug=${id}&format=md`, m);
  }

  // /help-api/mcp: tools/list only the eight, tools/call only those, nothing private
  const rpc = (method, params, id = 1) => call("POST", "/help-api/mcp", {}, { jsonrpc: "2.0", id, method, params });
  let r = await rpc("tools/list");
  assertClean("/help-api/mcp tools/list", r);
  assert.deepStrictEqual(r.body.result.tools.map((t) => t.name), NAMES, "tools/list: only the eight allow-listed tools");
  r = await rpc("initialize", { protocolVersion: "2025-03-26" });
  assertClean("/help-api/mcp initialize", r);
  const before = fetched.length;
  r = await rpc("tools/call", { name: "LEAK_SECRET_TOOL", arguments: {} });
  assertClean("/help-api/mcp tools/call LEAK_SECRET_TOOL", { body: { error: r.body.error && r.body.error.code } });
  assert.ok(r.body.error, "a tool outside the allow-list is refused");
  assert.strictEqual(fetched.length, before, "a refused tool never reaches the site");
  for (const name of ["../wp/v2/users", "wp-json/wp/v2/pages?status=draft", "get_feature/../../x"]) {
    r = await rpc("tools/call", { name, arguments: {} });
    assert.ok(r.body.error, `${name} refused`);
  }
  r = await rpc("tools/call", { name: "get_feature", arguments: { slug: "digital-signage" } });
  assertClean("/help-api/mcp tools/call get_feature", r);
  // Every upstream request goes to the two fixed WordPress paths, never a private route.
  for (const u of fetched) assert.ok(/^https:\/\/personalisationhub\.com\/(wp-json\/(ph-agent\/v1\/tools|ph-help\/v1\/published)|support-centre\/)/.test(u), "unexpected upstream URL: " + u);
  console.log("help-leak: all checks passed");
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
