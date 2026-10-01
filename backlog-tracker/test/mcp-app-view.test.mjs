// The MCP App views (functions/mcp-app-views.js) inside a real Chromium,
// driven by a scripted MCP Apps HOST: a page that embeds the view in a
// sandboxed iframe the way Claude does and speaks the SEP-1865 postMessage
// protocol to it — answers ui/initialize, sends ui/notifications/tool-input
// and ui/notifications/tool-result, fields ui/open-link and tools/call,
// requests ui/resource-teardown — asserting what the view does at each
// step. mcp-server.test.js proves the tools and resources are served right;
// this proves the HTML they serve actually renders and behaves under the
// protocol, which nothing else exercises. The first cut of these views
// (PR #208, 24 Sep 2026) shipped with no way of knowing it never would.
//
//   cd backlog-tracker/test && npm install && npm run test:mcp-app
//
// Needs a Chromium: PLAYWRIGHT_CHROMIUM (a path) if playwright-core can't
// find one itself; /opt/pw-browsers/chromium (the Claude Code sandbox's) is
// picked up automatically; a GitHub runner's Google Chrome via the `chrome`
// channel otherwise.
import assert from "node:assert";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const views = require("../functions/mcp-app-views.js");

// ── Fixtures: what the server's two tools put in structuredContent ────────
const readyResult = {
  content: [{ type: "text", text: "Ready for Testing — Deploy Playground: 2 ticket(s)" }],
  structuredContent: {
    kind: "ready-for-testing", projectId: "depproj", projectLabel: "Deploy Playground", count: 2,
    items: [
      {
        id: "rft1", projectId: "depproj", project: "Deploy Playground",
        title: "<script>evil()</script> Fix RRP grid", type: "bug", category: "HQ Admin",
        testSummary: "Fixed the stale RRP — refetches on price change now.", desc: "The RRP shown is stale.",
        previewUrl: "https://rawcdn.githack.com/offline2online/rob_ph_demos/abc123/index.html",
        testVersion: "1.5.70", board: "https://backlog-tracker-e4ed2.web.app/#item-rft1",
      },
      {
        id: "rft2", projectId: "depproj", project: "Deploy Playground",
        title: "Sketchy link", type: "feature", category: "Menu Board",
        testSummary: null, desc: "x", previewUrl: null, testVersion: null,
        board: "https://backlog-tracker-e4ed2.web.app/#item-rft2",
      },
    ],
  },
};
const refreshedResult = {
  content: [{ type: "text", text: "Ready for Testing — Deploy Playground: 1 ticket(s)" }],
  structuredContent: { ...readyResult.structuredContent, count: 1, items: [readyResult.structuredContent.items[1]] },
};
const approvedResult = {
  content: [{ type: "text", text: "Approved for Deployment — Deploy Playground: 1 ticket(s)" }],
  structuredContent: {
    kind: "approved-for-deployment", projectId: "depproj", projectLabel: "Deploy Playground", count: 1,
    readyToDeploy: true,
    readyLine: "This project's whole train is Approved for Deployment — ask your agent to call approve_deploy_to_main to fire Deploy to Main.",
    items: [{
      id: "dep1", projectId: "depproj", project: "Deploy Playground", title: "Approved one", type: "feature", category: "HQ Admin",
      testSummary: null, desc: "x", previewUrl: "https://rawcdn.githack.com/offline2online/rob_ph_demos/abc123/index.html",
      testVersion: "1.5.71", onTrain: true, deployCommit: "sha-dep1", prNumber: null, deployBranch: "deploy/depproj",
      board: "https://backlog-tracker-e4ed2.web.app/#item-dep1",
    }],
  },
};
// `</script>` inside a JSON string would end the host page's own script tag.
const embed = (v) => JSON.stringify(v).replace(/</g, "\\u003c");

// ── The scripted host ─────────────────────────────────────────────────────
const hostPage = (kind) => `<!doctype html><html><head><meta charset="utf-8"><title>host</title></head><body>
<iframe id="view" name="view" sandbox="allow-scripts" src="/view?kind=${kind}" style="width:640px;height:200px;border:0"></iframe>
<script>
window.__log = [];
const FIXTURES = ${embed({ ready: readyResult, refreshed: refreshedResult, approved: approvedResult })};
const kind = ${embed(kind)};
const frame = document.getElementById("view");
function send(msg) { frame.contentWindow.postMessage(msg, "*"); }
window.addEventListener("message", (ev) => {
  if (ev.source !== frame.contentWindow) return;
  const msg = ev.data;
  window.__log.push(msg);
  if (msg.method === "ui/initialize") {
    send({ jsonrpc: "2.0", id: msg.id, result: {
      protocolVersion: "2026-01-26",
      hostInfo: { name: "scripted-host", version: "0" },
      hostCapabilities: { openLinks: {}, serverTools: {} },
      hostContext: {
        theme: "dark", displayMode: "inline",
        styles: { variables: { "--color-background-primary": "#30302e", "--color-text-primary": "#faf9f5" }, css: { fonts: "/* host fonts */" } },
      },
    } });
  } else if (msg.method === "ui/notifications/initialized") {
    send({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: { projectId: "depproj" } } });
    send({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: kind === "approved-for-deployment" ? FIXTURES.approved : FIXTURES.ready });
  } else if (msg.method === "ui/open-link") {
    send({ jsonrpc: "2.0", id: msg.id, result: {} });
  } else if (msg.method === "tools/call") {
    send({ jsonrpc: "2.0", id: msg.id, result: FIXTURES.refreshed });
  }
});
function ask(id, method, params) {
  return new Promise((resolve) => {
    const onMsg = (ev) => { if (ev.source === frame.contentWindow && ev.data && ev.data.id === id && !ev.data.method) { window.removeEventListener("message", onMsg); resolve(ev.data); } };
    window.addEventListener("message", onMsg);
    send({ jsonrpc: "2.0", id, method, params });
  });
}
window.__teardown = () => ask(9001, "ui/resource-teardown", { reason: "test" });
window.__unknown = () => ask(9002, "ui/no-such-method", {});
</script></body></html>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/host") { res.setHeader("content-type", "text/html"); res.end(hostPage(url.searchParams.get("kind"))); return; }
  if (url.pathname === "/view") { res.setHeader("content-type", "text/html"); res.end(views.boardViewHTML(url.searchParams.get("kind"))); return; }
  res.writeHead(404); res.end();
}).listen(0);
const port = server.address().port;

const launch = { headless: true };
if (process.env.PLAYWRIGHT_CHROMIUM) launch.executablePath = process.env.PLAYWRIGHT_CHROMIUM;
else if (fs.existsSync("/opt/pw-browsers/chromium")) launch.executablePath = "/opt/pw-browsers/chromium";
const browser = await chromium.launch(launch).catch(() => chromium.launch({ headless: true, channel: "chrome" }));
const context = await browser.newContext();

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (err) { failures.push([name, err]); console.log(`FAIL  ${name}\n      ${err && err.message}`); }
}
const until = async (fn, what, ms = 5000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};
async function openHost(kind) {
  const page = await context.newPage();
  const errors = [];
  const popups = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("popup", (p) => popups.push(p));
  // The only external fetch the view makes is Roboto; keep the test offline.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(`http://127.0.0.1:${port}/host?kind=${kind}`);
  const frame = await until(() => page.frame({ name: "view" }), "the view frame");
  const log = () => page.evaluate(() => window.__log);
  return { page, frame, errors, popups, log };
}

console.log("\nMCP App views under a scripted MCP Apps host, in Chromium\n");

const ready = await openHost("ready-for-testing");
await test("the view opens the handshake: ui/initialize first, ui/notifications/initialized after the host answers", async () => {
  const log = await until(async () => { const l = await ready.log(); return l.some((m) => m.method === "ui/notifications/initialized") ? l : null; }, "initialized");
  assert.strictEqual(log[0].method, "ui/initialize");
  assert.strictEqual(log[0].params.protocolVersion, views.MCP_APPS_PROTOCOL_VERSION);
  assert.strictEqual(log[0].params.appInfo.version, views.VIEW_VERSION);
  assert.deepStrictEqual(log[0].params.appCapabilities.availableDisplayModes, ["inline"]);
  const init = log.findIndex((m) => m.method === "ui/initialize");
  const done = log.findIndex((m) => m.method === "ui/notifications/initialized");
  assert.ok(done > init, "initialized must follow initialize");
});

await test("the tool result renders as cards, with every user string as text and no script injected", async () => {
  await ready.frame.waitForSelector("article.card");
  await until(async () => (await ready.frame.locator("article.card").count()) === 2, "two cards");
  const titles = await ready.frame.locator("article.card h2").allTextContents();
  assert.deepStrictEqual(titles, ["<script>evil()</script> Fix RRP grid", "Sketchy link"]);
  assert.strictEqual(await ready.frame.locator("article.card script").count(), 0);
  assert.strictEqual(await ready.frame.evaluate(() => window.__evilRan === true), false);
  assert.strictEqual((await ready.frame.locator("#headline").textContent()).trim(), "Ready for Testing — Deploy Playground");
  assert.match(await ready.frame.locator("#count").textContent(), /^2 tickets waiting on review$/);
  assert.match(await ready.frame.locator("article.card").first().locator(".body").first().textContent(), /Fixed the stale RRP/);
  assert.match(await ready.frame.locator("article.card").first().locator("details summary").textContent(), /Show original request/);
  const pills = await ready.frame.locator("article.card").first().locator(".pill").allTextContents();
  assert.deepStrictEqual(pills, ["Bug", "HQ Admin", "Test version: v1.5.70"]);
  assert.strictEqual(await ready.frame.locator(".skeleton").count(), 0, "skeleton placeholders are gone once data arrives");
  assert.match(await ready.frame.locator("#foot").textContent(), /Read-only/);
});

await test("links: an https previewUrl is a 'Test this' link, a missing one gets no link, and every link is noopener", async () => {
  const first = ready.frame.locator("article.card").nth(0);
  const second = ready.frame.locator("article.card").nth(1);
  assert.strictEqual(await first.locator("a.primary").getAttribute("href"), "https://rawcdn.githack.com/offline2online/rob_ph_demos/abc123/index.html");
  assert.strictEqual(await second.locator("a.primary").count(), 0);
  assert.strictEqual(await second.locator("a.quiet").getAttribute("href"), "https://backlog-tracker-e4ed2.web.app/#item-rft2");
  for (const rel of await ready.frame.locator("article.card a").evaluateAll((as) => as.map((a) => a.rel))) assert.match(rel, /noopener/);
});

await test("the view reports its size to the host once rendered", async () => {
  const sizes = await until(async () => { const l = (await ready.log()).filter((m) => m.method === "ui/notifications/size-changed"); return l.length ? l : null; }, "size-changed");
  assert.ok(sizes.some((m) => m.params.height > 100), `expected a content-sized height, got ${JSON.stringify(sizes.map((m) => m.params))}`);
});

await test("host context is applied: theme and style variables reach the document", async () => {
  assert.strictEqual(await ready.frame.evaluate(() => document.documentElement.getAttribute("data-theme")), "dark");
  assert.strictEqual(await ready.frame.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-background-primary").trim()), "#30302e");
  assert.strictEqual(await ready.frame.evaluate(() => getComputedStyle(document.body).backgroundColor), "rgb(48, 48, 46)");
  assert.strictEqual(await ready.frame.evaluate(() => document.getElementById("host-fonts").textContent), "/* host fonts */");
});

await test("clicking a link goes through the host (ui/open-link), never a popup from the sandbox", async () => {
  await ready.frame.locator("article.card").first().locator("a.primary").click();
  const open = await until(async () => (await ready.log()).find((m) => m.method === "ui/open-link"), "ui/open-link");
  assert.strictEqual(open.params.url, "https://rawcdn.githack.com/offline2online/rob_ph_demos/abc123/index.html");
  assert.strictEqual(ready.popups.length, 0);
});

await test("Refresh re-runs the same read-only tool through the host with the tool's own arguments", async () => {
  const btn = ready.frame.locator("#refresh");
  assert.strictEqual(await btn.isVisible(), true, "offered because the host advertised serverTools");
  await btn.click();
  const call = await until(async () => (await ready.log()).find((m) => m.method === "tools/call"), "tools/call");
  assert.strictEqual(call.params.name, "get_ready_for_testing_board");
  assert.deepStrictEqual(call.params.arguments, { projectId: "depproj" });
  await until(async () => (await ready.frame.locator("article.card").count()) === 1, "re-render with one card");
  assert.match(await ready.frame.locator("#count").textContent(), /^1 ticket waiting on review$/);
});

await test("the view answers ui/resource-teardown, and an unknown request with -32601", async () => {
  const torn = await ready.page.evaluate(() => window.__teardown());
  assert.deepStrictEqual(torn.result, {});
  const unknown = await ready.page.evaluate(() => window.__unknown());
  assert.strictEqual(unknown.error.code, -32601);
});

await test("no script error in the view or the host", async () => {
  assert.deepStrictEqual(ready.errors, []);
});

const approved = await openHost("approved-for-deployment");
await test("the Approved for Deployment view shows the deploy-readiness line and train context", async () => {
  await approved.frame.waitForSelector("article.card");
  assert.strictEqual((await approved.frame.locator("#headline").textContent()).trim(), "Approved for Deployment — Deploy Playground");
  assert.match(await approved.frame.locator("#count").textContent(), /^1 ticket waiting to ship$/);
  const banner = approved.frame.locator("#banner");
  assert.strictEqual(await banner.isVisible(), true);
  assert.strictEqual(await banner.getAttribute("class"), "banner ok");
  assert.match(await banner.textContent(), /approve_deploy_to_main/);
  const pills = await approved.frame.locator("article.card .pill").allTextContents();
  assert.deepStrictEqual(pills, ["Feature", "HQ Admin", "Test version: v1.5.71", "On train: deploy/depproj"]);
  assert.match(await approved.frame.locator("#foot").textContent(), /Deploy to Main stays on the board/);
  assert.deepStrictEqual(approved.errors, []);
});

await test("opened outside a host, the view says so instead of waiting forever", async () => {
  const page = await context.newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(`http://127.0.0.1:${port}/view?kind=ready-for-testing`);
  assert.match(await page.locator("#count").textContent(), /MCP Apps host/);
  assert.strictEqual(await page.locator(".skeleton").count(), 0);
  await page.close();
});

await browser.close();
server.close();
console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const [name, err] of failures) console.error(`--- ${name}\n${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
}
