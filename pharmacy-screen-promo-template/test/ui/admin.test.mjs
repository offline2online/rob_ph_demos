// The admin app's sign-in gate and Settings, in headless Chromium.
// No Firebase and no network: the Firebase SDK modules are replaced by a fake
// auth module (routed by Playwright), and a local server plays Hosting
// (/__/firebase/init.json, the static files) and both APIs with in-memory
// settings. The real APIs' own admin checks are tested in config-api/ and
// ph-proxy/; this checks what the page does with their answers.
//
//   cd pharmacy-screen-promo-template && npm run check:admin

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const PUBLIC = join(fileURLToPath(new URL("../..", import.meta.url)), "pharmacy-screen");
const SDK = "https://www.gstatic.com/firebasejs/12.9.0";

const USERS = {
  "admin-token": { uid: "u-admin", email: "admin@example.test", admin: true },
  "viewer-token": { uid: "u-viewer", email: "viewer@example.test", admin: false },
};

let server, base, browser;
let settings;
const calls = [];

function reset() {
  settings = { baseUrls: null, token: null };
  calls.length = 0;
}
const view = () => ({
  baseUrls: settings.baseUrls || ["https://ph.mipharmacy.net"],
  baseUrlsAreDefault: !settings.baseUrls,
  token: settings.token ? { set: true, last4: settings.token.slice(-4), setAt: "2026-11-20T00:00:00Z", setBy: "u-admin" } : { set: false },
});

async function body(req) {
  let s = "";
  for await (const c of req) s += c;
  return s ? JSON.parse(s) : undefined;
}

before(async () => {
  reset();
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const send = (status, obj) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (url.pathname === "/__/firebase/init.json") return send(200, { projectId: "demo-test", apiKey: "fake" });
    if (url.pathname.startsWith("/api/")) {
      const user = USERS[(req.headers.authorization || "").replace(/^Bearer /, "")];
      const b = await body(req);
      calls.push({ method: req.method, path: url.pathname, body: b });
      if (!user) return send(401, { error: { code: "unauthenticated", message: "Sign in required" } });
      if (!user.admin) return send(403, { error: { code: "forbidden", message: "Admin role required" } });
      if (url.pathname === "/api/admin/me") return send(200, user);
      if (url.pathname === "/api/settings/ph-api" && req.method === "GET") return send(200, { ok: true, settings: view() });
      if (url.pathname === "/api/settings/ph-api" && req.method === "PUT") {
        if (b.baseUrls) settings.baseUrls = b.baseUrls;
        if (b.token) settings.token = b.token;
        return send(200, { ok: true, settings: view() });
      }
      if (url.pathname === "/api/settings/ph-api/token" && req.method === "DELETE") {
        settings.token = null;
        return send(200, { ok: true, settings: view() });
      }
      return send(404, { error: { code: "not-found", message: "No such endpoint" } });
    }
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    if (p.endsWith("/")) p += "index.html";
    try {
      const data = await readFile(join(PUBLIC, p));
      const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
      res.writeHead(200, { "Content-Type": types[extname(p)] || "application/octet-stream" });
      res.end(data);
    } catch {
      res.writeHead(404); res.end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await new Promise((r) => server.close(r));
});

// A stand-in for firebase-auth.js: the "Google account" that signs in is the
// token in window.__nextToken; signInWithPopup and signOut notify listeners.
const FAKE_AUTH = `
  const listeners = new Set();
  const auth = { currentUser: null };
  const notify = () => listeners.forEach((f) => f(auth.currentUser));
  export function getAuth() { return auth; }
  export class GoogleAuthProvider {}
  export function onAuthStateChanged(a, f) { listeners.add(f); setTimeout(() => f(auth.currentUser)); return () => listeners.delete(f); }
  export async function signInWithPopup() {
    const token = window.__nextToken;
    auth.currentUser = { email: token.replace("-token", "") + "@example.test", getIdToken: async () => token };
    notify();
  }
  export async function signInWithRedirect() {}
  export async function signOut() { auth.currentUser = null; notify(); }
`;

async function openAdmin(token) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await page.route(`${SDK}/firebase-app.js`, (r) => r.fulfill({ contentType: "text/javascript", headers: { "Access-Control-Allow-Origin": "*" }, body: "export function initializeApp(c) { return { options: c }; }" }));
  await page.route(`${SDK}/firebase-auth.js`, (r) => r.fulfill({ contentType: "text/javascript", headers: { "Access-Control-Allow-Origin": "*" }, body: FAKE_AUTH }));
  await page.addInitScript((t) => { window.__nextToken = t; }, token);
  await page.goto(`${base}/admin/`);
  await page.locator("#view-signin").waitFor({ state: "visible" });
  page.errors = errors;
  return page;
}

test("signed out: sign-in is required and no API is called", async () => {
  reset();
  const page = await openAdmin("admin-token");
  assert.equal(await page.locator("#view-settings").isVisible(), false);
  assert.equal(await page.locator("#signin-btn").textContent().then((t) => t.includes("Sign in with Google")), true);
  assert.equal(calls.length, 0);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test("a signed-in account without the admin role is refused", async () => {
  reset();
  const page = await openAdmin("viewer-token");
  await page.click("#signin-btn");
  await page.locator("#view-refused").waitFor({ state: "visible" });
  assert.match(await page.locator("#view-refused").textContent(), /No admin access/);
  assert.equal(await page.locator("#view-settings").isVisible(), false);
  assert.ok(!calls.some((c) => c.path.startsWith("/api/settings")), "settings are not even requested");
  await page.click("#view-refused [data-signout]");
  await page.locator("#view-signin").waitFor({ state: "visible" });
  await page.close();
});

test("an admin sees Settings with the default base URL and saves a write-only token", async () => {
  reset();
  const page = await openAdmin("admin-token");
  await page.click("#signin-btn");
  await page.locator("#view-settings").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.getElementById("base-urls").value !== "");
  assert.equal(await page.inputValue("#base-urls"), "https://ph.mipharmacy.net");
  assert.equal(await page.locator("#token-set").isVisible(), false);
  assert.equal(await page.getAttribute("#token-input", "type"), "password");
  assert.equal(await page.isDisabled("#save-btn"), true, "nothing to save yet");

  await page.fill("#token-input", "secret-token-abcd1234");
  assert.equal(await page.isDisabled("#save-btn"), false);
  assert.match(await page.textContent("#save-status"), /unsaved changes/);
  await page.click("#save-btn");
  await page.locator("#token-set").waitFor({ state: "visible" });
  assert.equal(await page.textContent("#token-last4"), "1234");
  assert.equal(await page.locator("#token-input").isVisible(), false);
  assert.deepEqual(calls.find((c) => c.method === "PUT").body, { token: "secret-token-abcd1234" }, "base URLs unchanged are not sent");
  const html = await page.content();
  assert.ok(!html.includes("secret-token-abcd1234"), "the saved token is nowhere on the page");
  assert.equal(await page.isDisabled("#save-btn"), true);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test("an admin replaces the token, changes base URLs, and removes the token after confirming", async () => {
  reset();
  settings.token = "first-token-0000";
  const page = await openAdmin("admin-token");
  await page.click("#signin-btn");
  await page.locator("#token-set").waitFor({ state: "visible" });
  assert.equal(await page.textContent("#token-last4"), "0000");

  await page.click("#token-replace");
  await page.fill("#token-input", "second-token-9999");
  await page.fill("#base-urls", "https://ph.mipharmacy.net\nhttps://backup.example.test");
  await page.click("#save-btn");
  await page.waitForFunction(() => document.getElementById("token-last4").textContent === "9999");
  const put = calls.filter((c) => c.method === "PUT").at(-1).body;
  assert.deepEqual(put, { baseUrls: ["https://ph.mipharmacy.net", "https://backup.example.test"], token: "second-token-9999" });

  await page.click("#token-remove");
  assert.equal(await page.locator("#remove-dialog").isVisible(), true);
  await page.click("#remove-cancel");
  assert.equal(settings.token, "second-token-9999", "cancel removes nothing");
  await page.click("#token-remove");
  await page.click("#remove-confirm");
  await page.locator("#token-set").waitFor({ state: "hidden" });
  assert.equal(settings.token, null);
  assert.equal(await page.locator("#token-input").isVisible(), true);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test("no position: fixed in the admin page (it runs inside an HQ Admin iframe)", async () => {
  const css = await readFile(join(PUBLIC, "admin/admin.css"), "utf8");
  assert.doesNotMatch(css, /position:\s*fixed/);
});
