// The admin editor's sign-in on AWS (auth mode "oidc"), in headless Chromium,
// end to end with no cloud: the staged site (scripts/deploy.mjs stageSite) with
// the config.js the stack writes (infra/admin-config.js), the real config API
// and PH API proxy on in-memory stores, verifying real signed ID tokens with
// adapters/oidc-auth.js — and a separate fake identity provider on its own
// origin, playing Cognito's hosted sign-in: /authorize (checks client, redirect
// URI and PKCE challenge), /token (code + verifier, refresh), /logout.
//
//   cd pharmacy-screen-promo-template/aws && npm run test:ui

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname, normalize } from "node:path";
import { createRequire } from "node:module";
import { stageSite, ROOT } from "../../scripts/deploy.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { adminConfig, adminConfigJs } = require("../../infra/admin-config.js");
const { createTestIdp } = require("../jwt.js");
const { createOidcAuth } = require("../../adapters/oidc-auth.js");
const PS = join(ROOT, "pharmacy-screen");
const { createConfigApi } = require(join(PS, "config-api/src/api.js"));
const { createMemoryStore } = require(join(PS, "config-api/src/adapters/memory-store.js"));
const { createMemoryBlobs } = require(join(PS, "config-api/src/adapters/blobs.js"));
const { seedConfig } = require(join(PS, "seed/seed.js"));
const { createApi: createPhApi } = require(join(PS, "ph-proxy/src/create-api.js"));
const { memorySettingsStore, memoryAuditLog } = require(join(PS, "ph-proxy/src/stores.js"));
const { createEnvelopeSecretStore, localKmsProvider } = require(join(PS, "ph-proxy/src/secret-store.js"));

const CLIENT_ID = "admin-editor-client";
const idp = createTestIdp({ clientId: CLIENT_ID });
let site, siteBase, idpServer, idpBase, browser, pub;
let configOverride = null;
let tokenTtl = 3600;
const apiCalls = [];
const idpLog = [];
const codes = new Map();
let user = { sub: "admin-1", email: "admin@example.com", "cognito:groups": ["admin"] };

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const readBody = (req) => new Promise((resolve) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => resolve(Buffer.concat(c))); });
const idToken = () => idp.sign({ ...user, exp: Math.floor(Date.now() / 1000) + tokenTtl });

before(async () => {
  pub = stageSite(join(mkdtempSync(join(tmpdir(), "ps-aws-oidc-")), "site"));
  const auth = createOidcAuth({ issuer: idp.issuer, audience: CLIENT_ID, fetchImpl: idp.fetchImpl });
  const store = createMemoryStore();
  const blobs = createMemoryBlobs();
  await seedConfig({ store, blobs });
  const configApi = createConfigApi({ store, blobs, auth, allowedOrigins: [] });
  const phApi = createPhApi({
    env: {},
    settingsStore: memorySettingsStore(),
    auditLog: memoryAuditLog(),
    secretStore: createEnvelopeSecretStore({ kms: localKmsProvider({ keyBase64: crypto.randomBytes(32).toString("base64"), env: {} }) }),
    auth,
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    baseLogger: { info() {}, warn() {}, error() {}, log() {} },
  });

  // The fake identity provider, on its own origin.
  idpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    idpLog.push(`${req.method} ${url.pathname}`);
    const cors = { "Access-Control-Allow-Origin": siteBase, "Content-Type": "application/json" };
    if (url.pathname === "/authorize") {
      const q = url.searchParams;
      const redirect = q.get("redirect_uri");
      if (q.get("client_id") !== CLIENT_ID || redirect !== `${siteBase}/admin/` || q.get("response_type") !== "code" || q.get("code_challenge_method") !== "S256" || !q.get("code_challenge")) {
        res.writeHead(400);
        return res.end("bad authorize request");
      }
      const code = crypto.randomBytes(12).toString("hex");
      codes.set(code, { challenge: q.get("code_challenge"), redirect, scope: q.get("scope") });
      res.writeHead(302, { Location: `${redirect}?code=${code}&state=${encodeURIComponent(q.get("state"))}` });
      return res.end();
    }
    if (url.pathname === "/token" && req.method === "POST") {
      const f = new URLSearchParams((await readBody(req)).toString());
      if (f.get("client_id") !== CLIENT_ID) { res.writeHead(400, cors); return res.end("{}"); }
      if (f.get("grant_type") === "authorization_code") {
        const c = codes.get(f.get("code"));
        codes.delete(f.get("code"));
        const verified = c && c.redirect === f.get("redirect_uri") && b64url(crypto.createHash("sha256").update(f.get("code_verifier") || "").digest()) === c.challenge;
        if (!verified) { res.writeHead(400, cors); return res.end(JSON.stringify({ error: "invalid_grant" })); }
        res.writeHead(200, cors);
        return res.end(JSON.stringify({ id_token: idToken(), access_token: "at", refresh_token: "rt-1", expires_in: tokenTtl, token_type: "Bearer" }));
      }
      if (f.get("grant_type") === "refresh_token" && f.get("refresh_token") === "rt-1") {
        res.writeHead(200, cors);
        return res.end(JSON.stringify({ id_token: idToken(), access_token: "at", expires_in: tokenTtl, token_type: "Bearer" }));
      }
      res.writeHead(400, cors);
      return res.end(JSON.stringify({ error: "invalid_grant" }));
    }
    if (url.pathname === "/logout") {
      res.writeHead(302, { Location: url.searchParams.get("logout_uri") });
      return res.end();
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => idpServer.listen(0, "127.0.0.1", r));
  idpBase = `http://127.0.0.1:${idpServer.address().port}`;

  // CloudFront's part: the staged site, the config.js, and /api/** to the two back ends.
  site = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname.startsWith("/api/")) {
      apiCalls.push(url.pathname);
      const body = await readBody(req);
      const ph = /^\/api\/(settings|device)\//.test(url.pathname);
      const out = ph
        ? await phApi.handle({ method: req.method, path: url.pathname, headers: req.headers, body: body.length ? JSON.parse(body) : undefined, ip: "127.0.0.1" })
        : await configApi.handle({ method: req.method, path: url.pathname, headers: req.headers, query: Object.fromEntries(url.searchParams), body });
      res.writeHead(out.status, out.headers || {});
      return res.end(out.body === null || out.body === undefined ? "" : JSON.stringify(out.body));
    }
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    if (p.endsWith("/")) p += "index.html";
    if (p === "/admin/config.js") {
      const cfg = configOverride || adminConfig({ clientId: CLIENT_ID, authorizeUrl: `${idpBase}/authorize`, tokenUrl: `${idpBase}/token`, logoutUrl: `${idpBase}/logout`, logoutParam: "logout_uri" });
      res.writeHead(200, { "Content-Type": "text/javascript" });
      return res.end(adminConfigJs(cfg));
    }
    try {
      const data = await readFile(join(pub, p));
      const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".b64": "text/plain" };
      res.writeHead(200, { "Content-Type": types[extname(p)] || "application/octet-stream" });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => site.listen(0, "127.0.0.1", r));
  siteBase = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch();
});

after(async () => {
  if (browser) await browser.close();
  for (const s of [site, idpServer]) if (s) await new Promise((r) => s.close(r));
});

async function open(ctx) {
  apiCalls.length = 0;
  idpLog.length = 0;
  const context = ctx || (await browser.newContext());
  await context.route("**/*", (route) => {
    const u = route.request().url();
    return u.startsWith(siteBase) || u.startsWith(idpBase) ? route.continue() : route.abort(); // no network
  });
  const page = await context.newPage();
  await page.goto(`${siteBase}/admin/`);
  return { context, page };
}
const editorShown = (page) => page.waitForSelector("#app:not([hidden])", { timeout: 15000 });
const blocked = async (page) => {
  await page.waitForSelector("#gateBlocked:not([hidden])", { timeout: 15000 });
  return page.textContent("#gateTitle");
};

test("signed out: the gate offers Sign in, and nothing is asked of the API", async () => {
  const { context, page } = await open();
  await page.waitForSelector("#gateOidc:not([hidden])");
  assert.equal(await page.textContent("#gateOidcBtn"), "loginSign in");
  assert.equal(await page.$eval("#app", (e) => e.hidden), true);
  assert.deepEqual(apiCalls, []);
  await context.close();
});

test("an admin signs in through the provider (code + PKCE) and the editor opens; a reload stays signed in", async () => {
  const { context, page } = await open();
  await page.click("#gateOidcBtn");
  await editorShown(page);
  assert.deepEqual(idpLog, ["GET /authorize", "POST /token"]);
  assert.equal(new URL(page.url()).search, "", "the one-time code is removed from the address bar");
  assert.equal(apiCalls[0], "/api/admin/me");
  assert.ok(apiCalls.includes("/api/admin/pharmacies"), "the editor loads its data with the verified ID token");
  idpLog.length = 0;
  apiCalls.length = 0;
  await page.reload();
  await editorShown(page);
  assert.deepEqual(idpLog, [], "no trip to the provider on reload");
  await context.close();
});

test("an expired ID token is refreshed once, without leaving the page, even with several requests waiting", async () => {
  const { context, page } = await open();
  await page.click("#gateOidcBtn");
  await editorShown(page);
  // An hour later: the ID token has expired, the refresh token has not.
  await page.evaluate(() => {
    const s = JSON.parse(sessionStorage.getItem("ps-admin-oidc"));
    sessionStorage.setItem("ps-admin-oidc", JSON.stringify({ ...s, exp: Date.now() - 1000, issuedAt: 0 }));
  });
  idpLog.length = 0;
  await page.reload();
  await editorShown(page);
  assert.deepEqual(idpLog, ["POST /token"], "one refresh_token grant, no redirect");
  await context.close();
});

test("a provider issuing tokens shorter than the editor's 60 s margin is not asked again on every request", async () => {
  tokenTtl = 30;
  try {
    const { context, page } = await open();
    await page.click("#gateOidcBtn");
    await editorShown(page);
    assert.deepEqual(idpLog, ["GET /authorize", "POST /token"]);
    await context.close();
  } finally {
    tokenTtl = 3600;
  }
});

test("a signed-in non-admin is refused, and Sign out goes through the provider's logout", async () => {
  const prev = user;
  user = { sub: "staff-1", email: "staff@example.com", "cognito:groups": ["staff"] };
  try {
    const { context, page } = await open();
    await page.click("#gateOidcBtn");
    assert.equal(await blocked(page), "Admin role required");
    assert.equal(await page.$eval("#app", (e) => e.hidden), true);
    assert.deepEqual(apiCalls, ["/api/admin/me"]);
    idpLog.length = 0;
    await page.click("#gateSignOut");
    await page.waitForSelector("#gateOidc:not([hidden])");
    assert.deepEqual(idpLog, ["GET /logout"]);
    assert.equal(await page.evaluate(() => sessionStorage.getItem("ps-admin-oidc")), null, "tokens cleared");
    await context.close();
  } finally {
    user = prev;
  }
});

test("a sign-in that comes back with an error, or a state that doesn't match, is not accepted", async () => {
  for (const q of ["?error=access_denied&state=x", "?code=stolen&state=not-mine"]) {
    const context = await browser.newContext();
    await context.route("**/*", (route) => (route.request().url().startsWith(siteBase) ? route.continue() : route.abort()));
    const page = await context.newPage();
    idpLog.length = 0;
    apiCalls.length = 0;
    await page.goto(`${siteBase}/admin/${q}`);
    await page.waitForSelector("#gateOidc:not([hidden])");
    assert.equal(await page.textContent("#gateMsg"), "Sign-in did not complete. Try again.");
    assert.deepEqual(idpLog, [], `${q}: no token request`);
    assert.deepEqual(apiCalls, []);
    assert.equal(new URL(page.url()).search, "");
    await context.close();
  }
});

test("a config without the provider's details is refused, not half signed in", async () => {
  configOverride = adminConfig({ clientId: "", authorizeUrl: "", tokenUrl: "" });
  try {
    const { context, page } = await open();
    assert.equal(await blocked(page), "Sign-in is not set up");
    assert.deepEqual(apiCalls, []);
    await context.close();
  } finally {
    configOverride = null;
  }
});
