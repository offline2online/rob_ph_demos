// The deployed admin editor's sign-in gate, in headless Chromium: the staged
// Hosting tree (scripts/deploy.mjs stage()) with the admin/config.js the deploy
// writes (Firebase mode, this project's web app config). No Firebase and no
// network: the Firebase SDK modules are replaced by a fake (routed by
// Playwright) and a local server plays Hosting and the config API's
// /api/admin/** answers. The editor itself is tested in
// pharmacy-screen/admin/test/editor.e2e.mjs (token mode, real APIs); the APIs'
// own admin checks in config-api/ and ph-proxy/. This checks that the gate
// fails closed: the editor (#app) shows only after /api/admin/me returns 200.
//
//   cd pharmacy-screen-promo-template && npm run check:admin

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname, normalize } from "node:path";
import { createRequire } from "node:module";
import { ROOT, stage, writeAdminConfig } from "../../scripts/deploy.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const SDK = "https://www.gstatic.com/firebasejs/";

// Signed-in users the fake SDK knows, by email; the password is the ID token
// the fake returns, which the stub API maps to a role.
const USERS = { "admin-token": { admin: true }, "viewer-token": { admin: false } };

let server, base, browser, out;
let meStatus = null; // force /api/admin/me to answer this status
let serveCommittedConfig = false;
const calls = [];

const FAKE_APP = `export function initializeApp(cfg) { window.__fbConfig = cfg; return { cfg }; }`;
const FAKE_AUTH = `
let user = null; const subs = [];
const mk = (email, token) => ({ email, getIdToken: async () => token });
export function getAuth(app) { return { app }; }
export function onAuthStateChanged(auth, cb) { subs.push(cb); setTimeout(() => cb(user), 0); return () => { const i = subs.indexOf(cb); if (i >= 0) subs.splice(i, 1); }; }
export class GoogleAuthProvider {}
export async function signInWithPopup() { throw new Error('popup-blocked'); }
export async function signInWithEmailAndPassword(auth, email, password) { user = mk(email, password); for (const cb of [...subs]) cb(user); return { user }; }
export async function signOut() { user = null; }
`;

before(async () => {
  out = mkdtempSync(join(tmpdir(), "ps-admin-gate-"));
  stage(ROOT, out);
  writeAdminConfig({ apiKey: "fake-api-key", projectId: "demo-test", appId: "1:2:web:3" }, out);
  const pub = join(out, "public");
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const send = (status, obj) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (url.pathname.startsWith("/api/")) {
      calls.push(url.pathname);
      if (url.pathname === "/api/admin/me" && meStatus) return send(meStatus, { error: { code: "internal", message: "Something went wrong on the server." } });
      const user = USERS[(req.headers.authorization || "").replace(/^Bearer /, "")];
      if (!user) return send(401, { error: { code: "unauthenticated", message: "Sign in required" } });
      if (!user.admin) return send(403, { error: { code: "forbidden", message: "Admin role required" } });
      if (url.pathname === "/api/admin/me") return send(200, { uid: "u-admin", admin: true });
      return send(200, []);
    }
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    if (p.endsWith("/")) p += "index.html";
    const file = serveCommittedConfig && p === "/admin/config.js" ? join(ROOT, "pharmacy-screen/admin/config.js") : join(pub, p);
    try {
      const data = await readFile(file);
      const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
      res.writeHead(200, { "Content-Type": types[extname(p)] || "application/octet-stream" });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});

after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((r) => server.close(r));
});

async function open({ sdk = "fake" } = {}) {
  calls.length = 0;
  const ctx = await browser.newContext();
  await ctx.route("**/*", (route) => {
    const u = route.request().url();
    if (u.startsWith(base)) return route.continue();
    if (u.startsWith(SDK) && sdk === "fake") {
      return route.fulfill({ status: 200, contentType: "text/javascript", body: u.endsWith("/firebase-app.js") ? FAKE_APP : FAKE_AUTH });
    }
    return route.abort(); // no network: fonts, and the SDK itself when sdk !== "fake"
  });
  const page = await ctx.newPage();
  await page.goto(`${base}/admin/`);
  return { ctx, page };
}

const signIn = async (page, token) => {
  await page.waitForSelector("#gateFirebase:not([hidden])");
  await page.fill("#gateEmail", "someone@example.test");
  await page.fill("#gatePassword", token);
  await page.click("#gateEmailForm button[type=submit]");
};
const blocked = async (page) => {
  await page.waitForSelector("#gateBlocked:not([hidden])", { timeout: 10000 });
  return { title: await page.textContent("#gateTitle"), text: await page.textContent("#gateBlockedTx") };
};
const appHidden = (page) => page.$eval("#app", (e) => e.hidden);

test("sign-in is required: the deployed config signs in with Firebase, and nothing is asked of the API first", async () => {
  const { ctx, page } = await open();
  await page.waitForSelector("#gateFirebase:not([hidden])");
  assert.equal(await appHidden(page), true);
  assert.deepEqual(calls, []);
  assert.deepEqual(await page.evaluate(() => window.__fbConfig), { apiKey: "fake-api-key", authDomain: "demo-test.firebaseapp.com", projectId: "demo-test", appId: "1:2:web:3" });
  await ctx.close();
});

test("the committed config (no web app) is refused, not signed in to some other project", async () => {
  serveCommittedConfig = true;
  try {
    const { ctx, page } = await open();
    const b = await blocked(page);
    assert.equal(b.title, "Sign-in is not set up");
    assert.equal(await appHidden(page), true);
    assert.deepEqual(calls, []);
    await ctx.close();
  } finally {
    serveCommittedConfig = false;
  }
});

test("the Firebase SDK fails to load: blocked, no editor, no API call", async () => {
  const { ctx, page } = await open({ sdk: "unreachable" });
  const b = await blocked(page);
  assert.equal(b.title, "Sign-in could not load");
  assert.equal(await appHidden(page), true);
  assert.equal(await page.isHidden("#gateFirebase"), true);
  assert.deepEqual(calls, []);
  await ctx.close();
});

test("a signed-in non-admin is refused", async () => {
  const { ctx, page } = await open();
  await signIn(page, "viewer-token");
  const b = await blocked(page);
  assert.equal(b.title, "Admin role required");
  assert.equal(await appHidden(page), true);
  assert.deepEqual(calls, ["/api/admin/me"]);
  await ctx.close();
});

test("/api/admin/me answers 500: blocked with the error, the editor never loads", async () => {
  meStatus = 500;
  try {
    const { ctx, page } = await open();
    await signIn(page, "admin-token");
    const b = await blocked(page);
    assert.equal(b.title, "The editor could not load");
    assert.equal(await appHidden(page), true);
    assert.deepEqual(calls, ["/api/admin/me"]);
    await ctx.close();
  } finally {
    meStatus = null;
  }
});

test("an admin gets past the gate: the editor asks for its data only after /api/admin/me", async () => {
  const { ctx, page } = await open();
  await signIn(page, "admin-token");
  await page.waitForFunction(() => document.querySelector("#gateBlocked").hidden && performance.getEntriesByType("resource").some((e) => e.name.endsWith("/api/admin/pharmacies")), null, { timeout: 10000 });
  assert.equal(calls[0], "/api/admin/me");
  assert.ok(calls.includes("/api/admin/pharmacies"));
  await ctx.close();
});
