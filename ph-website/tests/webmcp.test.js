// Offline test of the WebMCP loader (snippets/ph-agent-endpoint/webmcp.js)
// against a stubbed navigator.modelContext and a stubbed fetch.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const snip = path.join(__dirname, "..", "snippets");
const loader = fs.readFileSync(path.join(snip, "ph-agent-endpoint", "webmcp.js"), "utf8");
const BASE = "https://personalisationhub.com/wp-json/ph-agent/v1/";
const NAMES = ["describe_platform", "list_industries", "get_industry", "get_feature", "search_help", "get_help_article", "start_free_trial", "book_demo"];
const tools = NAMES.map((n) => ({ name: n, description: n, inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } }));

function run(nav, extra) {
  const calls = [];
  const fetch = (url, opts) => {
    calls.push(url);
    const body = url === BASE + "tools" ? { tools } : { content: [{ type: "text", text: "result of " + decodeURIComponent(url.slice(BASE.length)) }] };
    return Promise.resolve({ json: () => Promise.resolve(body) });
  };
  const win = Object.assign({ PH_AE_REST: BASE }, extra || {});
  vm.runInNewContext(loader, { navigator: nav, window: win, fetch, encodeURIComponent, JSON, Promise });
  return { calls, win };
}
const tick = () => new Promise((r) => setTimeout(r, 10));

(async () => {
  // No WebMCP: exits at once, no request, no error.
  let r = run({});
  await tick();
  assert.strictEqual(r.calls.length, 0, "no requests without navigator.modelContext");
  r = run({ modelContext: {} });
  assert.strictEqual(r.calls.length, 0, "no requests with an empty modelContext");

  // registerTool: the list is fetched once, eight tools registered once each.
  const reg = [];
  r = run({ modelContext: { registerTool: (t) => reg.push(t) } });
  await tick();
  assert.deepStrictEqual(r.calls, [BASE + "tools"], "one request: the list");
  assert.deepStrictEqual(reg.map((t) => t.name), NAMES, "eight tools registered once");
  reg.forEach((t) => assert.strictEqual(t.annotations.readOnlyHint, true));
  const out = await reg[4].execute({ query: "add a store" });
  assert.strictEqual(r.calls[1], BASE + "tools/search_help?args=" + encodeURIComponent('{"query":"add a store"}'), "execute calls the endpoint");
  assert.strictEqual(out.content[0].text.indexOf("result of tools/search_help"), 0, "execute returns the endpoint's CallToolResult");
  await reg[7].execute();
  assert.ok(r.calls[2].endsWith("tools/book_demo?args=%7B%7D"), "no-arg tool sends {}");

  // provideContext fallback.
  let ctx;
  r = run({ modelContext: { provideContext: (c) => (ctx = c) } });
  await tick();
  assert.strictEqual(ctx.tools.length, 8, "provideContext fallback registers eight");

  // A second copy of the loader on the same page does nothing.
  const reg2 = [];
  const win = { PH_AE_REST: BASE };
  const nav = { modelContext: { registerTool: (t) => reg2.push(t) } };
  const calls = [];
  const fetch = () => { calls.push(1); return Promise.resolve({ json: () => Promise.resolve({ tools }) }); };
  for (let i = 0; i < 2; i++) vm.runInNewContext(loader, { navigator: nav, window: win, fetch, encodeURIComponent, JSON, Promise });
  await tick();
  assert.strictEqual(reg2.length, 8, "registered once even if loaded twice");

  // A failing list is silent; a failing call becomes isError.
  r = run({ modelContext: { registerTool: () => { throw new Error("duplicate"); } } });
  await tick();
  const failing = [];
  vm.runInNewContext(loader, { navigator: { modelContext: { registerTool: (t) => failing.push(t) } }, window: { PH_AE_REST: BASE }, fetch: (u) => (u === BASE + "tools" ? Promise.resolve({ json: () => Promise.resolve({ tools }) }) : Promise.reject(new Error("offline"))), encodeURIComponent, JSON, Promise });
  await tick();
  const e = await failing[0].execute({});
  assert.strictEqual(e.isError, true, "network failure on a call is an isError result");

  // Size and the Support Centre no longer registers tools itself.
  assert.ok(Buffer.byteLength(loader) < 2048, "loader under 2 KB");
  assert.ok(!/modelContext|initWebMcp/.test(fs.readFileSync(path.join(snip, "ph-support-centre", "sc.js"), "utf8")), "sc.js does not register WebMCP tools");
  console.log("ph-website webmcp: all checks passed");
})().catch((err) => { console.error("FAIL:", err.message); process.exit(1); });
