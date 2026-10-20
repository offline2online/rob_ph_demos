// The sign-in wall's decision logic, as a test: the REAL public/js/auth-gate.js
// under jsdom (loading the real public/index.html), with the Firebase Auth
// SDK it imports from gstatic replaced by a controllable stub, `fetch`
// scripted per scenario, and `import("./app.js")` pointed at a stub that only
// records that it was loaded.
//
// Why (27 Sep 2026): "after login you're stuck on the sign-in screen until
// you reload" and "every refresh shows the logo card". Both came from the
// wall resolving membership through one Cloud Function call in the critical
// path. The rewrite resolves from the ID token's claim first, then the
// person's own consoleUsers row over REST, and runs the function in the
// background — and nothing in the pipeline exercised that file at all.
//
// Run with:  node test/auth-gate.test.mjs
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, "..", "public");
const gateSrc = fs.readFileSync(path.join(publicDir, "js", "auth-gate.js"), "utf8");
const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "auth-gate-"));
const define = (obj, key, value) => Object.defineProperty(obj, key, { value, configurable: true, writable: true });
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

// One stub module for firebase-app.js and firebase-auth.js. Everything it
// does is driven by globalThis.__gate, which each scenario sets up.
const AUTH_STUB = `
const ctl = () => globalThis.__gate;
export const initializeApp = () => ({});
export const getApps = () => [];
export const getApp = () => ({});
export const getAuth = () => ctl().auth;
export class GoogleAuthProvider { setCustomParameters() {} }
export const setPersistence = async () => {};
export const browserLocalPersistence = {};
export const getRedirectResult = async () => null;
export const onAuthStateChanged = (auth, cb) => { ctl().authCb = cb; if (ctl().fireInitial !== false) setTimeout(() => cb(ctl().initialUser), 5); };
export const signInWithPopup = async () => ctl().popup ? ctl().popup() : null;
export const signInWithRedirect = async () => { ctl().redirected = true; };
export const signInWithEmailAndPassword = async () => null;
export const sendPasswordResetEmail = async () => {};
export const sendEmailVerification = async () => { ctl().verificationSent = true; };
export const signOut = async () => { ctl().signedOut = true; ctl().auth.currentUser = null; };
`;
const APP_STUB = `globalThis.__gate.appLoaded = true; globalThis.__gate.appLoadedAt = Date.now();`;

let scenarioCount = 0;
function makeUser({ email = "sam@personalisationhub.com", emailVerified = true, claims = {} } = {}) {
  return {
    email, emailVerified,
    getIdToken: async () => "id-token",
    getIdTokenResult: async () => ({ claims }),
    reload: async () => {},
  };
}
function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// Boots one scenario: fresh DOM, fresh module copy, scripted network.
async function boot({ remembered = false, rememberedRole = null, initialUser = null, fireInitial = true, popup = null, claimsSync = null, ownRow = null, settleMs = 60, deniedBefore = false } = {}) {
  scenarioCount += 1;
  const dom = new JSDOM(html, { url: "https://backlog-tracker.test/", pretendToBeVisual: true });
  const { window } = dom;
  for (const key of ["window", "document", "localStorage", "sessionStorage", "HTMLElement", "Element", "Node", "Event"]) define(globalThis, key, window[key]);
  try { window.localStorage.clear(); window.sessionStorage.clear(); } catch { /* ignore */ }
  if (deniedBefore) window.sessionStorage.setItem("ph-console-denied", "1");
  if (remembered) window.localStorage.setItem("ph-console-signed-in", "1");
  if (rememberedRole) window.localStorage.setItem("ph-console-role", rememberedRole);

  const fetches = [];
  const fetchStub = async (url, opts) => {
    fetches.push({ url: String(url), at: Date.now() });
    if (String(url).endsWith("/mcp/claims/sync")) {
      if (typeof claimsSync === "function") return claimsSync();
      if (claimsSync === "hang") return new Promise(() => {});
      return claimsSync ? response(claimsSync.status, claimsSync.body) : response(500, {});
    }
    if (String(url).includes("/documents/consoleUsers/")) {
      if (typeof ownRow === "function") return ownRow();
      return ownRow ? response(ownRow.status, ownRow.body) : response(500, {});
    }
    return response(404, {});
  };
  define(window, "fetch", fetchStub); define(globalThis, "fetch", fetchStub);

  const ctl = { auth: { currentUser: initialUser }, initialUser, fireInitial, popup, appLoaded: false, fetches };
  globalThis.__gate = ctl;

  const dir = path.join(tmp, `s${scenarioCount}`);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "sdk.mjs"), AUTH_STUB);
  fs.writeFileSync(path.join(dir, "app.mjs"), APP_STUB);
  let src = gateSrc;
  src = src.replace(/"https:\/\/www\.gstatic\.com\/firebasejs\/[^"]+"/g, JSON.stringify(pathToFileURL(path.join(dir, "sdk.mjs")).href));
  src = src.replace('import("./app.js")', `import(${JSON.stringify(pathToFileURL(path.join(dir, "app.mjs")).href)})`);
  // Every other relative import ("./firebase-config.js", "./local-cache.js",
  // whatever auth-gate.js imports next) resolves to the real file in
  // public/js. The gate is evaluated from this temp dir, so a hard-coded
  // list here broke all 15 scenarios the day auth-gate.js gained an import
  // (local-cache.js, train PR #301, 3 Oct 2026) and blocked Deploy to Main.
  src = src.replace(/(from\s+|import\s+)"\.\/([\w.-]+\.js)"/g, (m, kw, file) =>
    `${kw}${JSON.stringify(pathToFileURL(path.join(publicDir, "js", file)).href)}`);
  fs.writeFileSync(path.join(dir, "gate.mjs"), src);

  // What the page shows BEFORE any auth answer arrives — the "logo flash".
  const beforeAuth = await import(pathToFileURL(path.join(dir, "gate.mjs")).href).then(() => ({
    gateHidden: window.document.getElementById("auth-gate").hidden,
    appHidden: window.document.querySelector(".app").hidden,
    booting: window.document.documentElement.dataset.booting === "1",
    bootText: window.document.getElementById("boot-status").textContent,
  }));
  await tick(settleMs);
  const $ = (id) => window.document.getElementById(id);
  return {
    window, ctl, fetches, beforeAuth,
    state: () => ({
      gateHidden: $("auth-gate").hidden,
      appHidden: window.document.querySelector(".app").hidden,
      booting: window.document.documentElement.dataset.booting === "1",
      role: window.document.documentElement.dataset.consoleRole || null,
      status: $("auth-gate-status").textContent,
      signInVisible: !$("auth-gate-signin").hidden,
      signOutVisible: !$("auth-gate-signout").hidden,
      retryVisible: !$("auth-gate-retry").hidden,
      verifyVisible: !$("auth-gate-verify").hidden,
      appLoaded: ctl.appLoaded,
      remembered: window.localStorage.getItem("ph-console-signed-in"),
      rememberedRole: window.localStorage.getItem("ph-console-role"),
      topbarUser: $("topbar-user").textContent,
    }),
  };
}

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`FAIL  ${name}\n      ${err && err.message}`); }
}

await test("a remembered session shows the console shell straight away — never the sign-in card", async () => {
  const s = await boot({ remembered: true, rememberedRole: "viewer", initialUser: makeUser({ claims: { consoleRole: "viewer" } }), claimsSync: "hang" });
  assert.strictEqual(s.beforeAuth.gateHidden, true, "the card (and its logo) must not appear while auth restores");
  assert.strictEqual(s.beforeAuth.appHidden, false);
  assert.strictEqual(s.beforeAuth.booting, true);
  assert.match(s.beforeAuth.bootText, /Restoring your session/);
  const st = s.state();
  assert.strictEqual(st.appLoaded, true, "app.js loads from the cached claim alone");
  assert.strictEqual(st.role, "viewer");
  assert.strictEqual(st.booting, false, "the boot line goes once app.js is in");
  assert.strictEqual(st.topbarUser, "sam@personalisationhub.com");
});

await test("with a role claim on the token, the board starts without waiting on any network call", async () => {
  const s = await boot({ initialUser: makeUser({ claims: { consoleRole: "editor" } }), claimsSync: "hang", ownRow: () => new Promise(() => {}) });
  const st = s.state();
  assert.strictEqual(st.appLoaded, true);
  assert.strictEqual(st.gateHidden, true);
  assert.strictEqual(st.role, "editor");
  assert.strictEqual(st.remembered, "1");
  assert.strictEqual(st.rememberedRole, "editor");
  assert.ok(s.fetches.some((f) => f.url.endsWith("/mcp/claims/sync")), "the claim repair still runs, in the background");
  assert.ok(s.ctl.appLoadedAt <= s.fetches.find((f) => f.url.endsWith("/mcp/claims/sync")).at + 5, "app.js is not held back behind the function");
});

await test("no claim yet: the person's own consoleUsers row decides, even when the function never answers", async () => {
  const s = await boot({ initialUser: makeUser(), claimsSync: "hang", ownRow: { status: 200, body: { fields: { role: { stringValue: "viewer" } } } } });
  const st = s.state();
  assert.strictEqual(st.appLoaded, true);
  assert.strictEqual(st.role, "viewer");
});

await test("no claim, no row, not an owner: refused with the add-me message, and nothing loads", async () => {
  const s = await boot({ initialUser: makeUser({ email: "nobody@example.com" }), claimsSync: { status: 403, body: {} }, ownRow: { status: 404, body: {} } });
  const st = s.state();
  assert.strictEqual(st.appLoaded, false);
  assert.strictEqual(st.gateHidden, false);
  assert.match(st.status, /isn't on the PH Agent Console user list/);
  assert.strictEqual(st.signOutVisible, true);
  assert.strictEqual(st.remembered, null);
});

await test("a disabled row is a refusal, not an empty board", async () => {
  const s = await boot({ initialUser: makeUser(), claimsSync: "hang", ownRow: { status: 200, body: { fields: { role: { stringValue: "editor" }, disabled: { booleanValue: true } } } } });
  const st = s.state();
  assert.strictEqual(st.appLoaded, false);
  assert.match(st.status, /isn't on the PH Agent Console user list/);
});

await test("an owner with no row is an admin, whatever the network says", async () => {
  const s = await boot({ initialUser: makeUser({ email: "rob@offline2online.com" }), claimsSync: "hang", ownRow: { status: 404, body: {} } });
  const st = s.state();
  assert.strictEqual(st.appLoaded, true);
  assert.strictEqual(st.role, "admin");
});

await test("both membership sources down: a retry, not a blank page", async () => {
  const s = await boot({ initialUser: makeUser(), claimsSync: { status: 503, body: {} }, ownRow: { status: 503, body: {} } });
  const st = s.state();
  assert.strictEqual(st.appLoaded, false);
  assert.match(st.status, /Couldn't check your access/);
  assert.strictEqual(st.retryVisible, true);
});

await test("the function's role wins over a stale cached claim, live", async () => {
  const s = await boot({ initialUser: makeUser({ claims: { consoleRole: "viewer" } }), claimsSync: { status: 200, body: { role: "editor", email: "sam@personalisationhub.com", claimUpdated: true } } });
  const st = s.state();
  assert.strictEqual(st.appLoaded, true);
  assert.strictEqual(st.role, "editor", "the background sync corrected the role on <html>");
  assert.strictEqual(st.rememberedRole, "editor");
});

await test("removed while signed in: the background sync signs the person out with a reason", async () => {
  const s = await boot({ initialUser: makeUser({ claims: { consoleRole: "editor" } }), claimsSync: { status: 403, body: {} } });
  const st = s.state();
  assert.strictEqual(s.ctl.signedOut, true);
  assert.match(st.status, /no longer on the PH Agent Console user list/);
  assert.strictEqual(st.gateHidden, false);
  assert.strictEqual(st.remembered, null);
});

await test("signed out: the sign-in card with both routes, and the remembered flag is dropped", async () => {
  const s = await boot({ remembered: true, initialUser: null });
  const st = s.state();
  assert.strictEqual(st.gateHidden, false);
  assert.strictEqual(st.signInVisible, true);
  assert.strictEqual(s.window.document.getElementById("auth-gate-password").hidden, false);
  assert.strictEqual(st.remembered, null);
  assert.strictEqual(st.appLoaded, false);
});

await test("an unverified address is told to verify, with a button, instead of seeing an empty board", async () => {
  const s = await boot({ initialUser: makeUser({ emailVerified: false }) });
  const st = s.state();
  assert.strictEqual(st.appLoaded, false);
  assert.match(st.status, /hasn't been verified/);
  assert.strictEqual(st.verifyVisible, true);
  s.window.document.getElementById("auth-gate-verify").click();
  await tick(20);
  assert.strictEqual(s.ctl.verificationSent, true);
});

await test("a popup sign-in that resolves starts the board even if onAuthStateChanged never fires", async () => {
  const user = makeUser({ claims: { consoleRole: "editor" } });
  const s = await boot({ initialUser: null, fireInitial: false, popup: async () => { s.ctl.auth.currentUser = user; return { user }; }, claimsSync: "hang" });
  // The initial callback never fired, so the card is still resolving; click Sign in.
  s.window.document.getElementById("auth-gate-signin").hidden = false;
  s.window.document.getElementById("auth-gate-signin").click();
  await tick(60);
  const st = s.state();
  assert.strictEqual(st.appLoaded, true, "handleUser ran from the popup result itself");
  assert.strictEqual(st.gateHidden, true);
});

await test("a blocked popup falls back to the redirect flow", async () => {
  const s = await boot({ initialUser: null, popup: async () => { const e = new Error("blocked"); e.code = "auth/popup-blocked"; throw e; } });
  s.window.document.getElementById("auth-gate-signin").click();
  await tick(30);
  assert.strictEqual(s.ctl.redirected, true);
});

await test("the same user reported twice runs one membership check, not two", async () => {
  const user = makeUser();
  let rowReads = 0;
  const s = await boot({ initialUser: user, claimsSync: "hang", ownRow: async () => { rowReads += 1; await tick(20); return response(200, { fields: { role: { stringValue: "editor" } } }); }, settleMs: 5 });
  s.ctl.authCb(user); // e.g. getRedirectResult and onAuthStateChanged both reporting
  await tick(80);
  assert.strictEqual(rowReads, 1);
  assert.strictEqual(s.state().appLoaded, true);
});

await test("after a listener-denied reload the cached claim is ignored and the network decides", async () => {
  // Simulates app.js having just reloaded the page because Firestore
  // refused the listeners: the token still carries a role claim (removed
  // members keep theirs for up to an hour), but the row is gone.
  const s = await boot({ initialUser: makeUser({ claims: { consoleRole: "editor" } }), claimsSync: { status: 403, body: {} }, ownRow: { status: 404, body: {} }, deniedBefore: true });
  const st = s.state();
  assert.strictEqual(st.appLoaded, false, "the claim alone must not restart the board — that was a reload loop");
  assert.match(st.status, /isn't on the PH Agent Console user list/);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
