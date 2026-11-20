"use strict";
// PH session sign-in (src/ph-session.js), offline: a fake PH and a fake signer.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createApi } = require("../src/create-api");
const { memorySettingsStore, memoryAuditLog } = require("../src/stores");
const { actorFromClaims } = require("../src/auth");

const NOW = Date.parse("2026-11-21T00:00:00Z");
const jwt = (payload) => ["h", Buffer.from(JSON.stringify(payload)).toString("base64url"), "sig"].join(".");
const HQ = jwt({ user_id: 12, role: "ADMIN", exp: NOW / 1000 + 3600 });
const HELP = jwt({ user_id: 13, role: "HELP_DESK", exp: NOW / 1000 + 3600 });
const STORE = jwt({ user_id: 77, store_id: 457, exp: NOW / 1000 + 30 * 86400 });
const NOCODE = jwt({ user_id: 78, store_id: 458, exp: NOW / 1000 + 3600 });
const BAD = jwt({ user_id: 1, role: "ADMIN", exp: NOW / 1000 + 3600, forged: true });

function setup({ env = {}, ph } = {}) {
  const calls = [];
  const lines = [];
  const fetchImpl = async (url, opts) => {
    const u = new URL(url);
    const token = String(opts.headers.authorization || "").replace(/^Bearer /, "");
    calls.push({ origin: u.origin, path: u.pathname });
    assert.equal(opts.redirect, "error");
    if (ph === "down") throw new TypeError("fetch failed");
    const reply = (status, data) => ({ status, json: async () => ({ data }) });
    if (u.pathname === "/auth-api/v1/me") {
      if (token === HQ) return reply(200, { email: "owner@example.com", id: 12, role: "ADMIN" });
      if (token === HELP) return reply(200, { email: "help@ph.example", id: 13, role: "HELP_DESK" });
      return reply(401, null);
    }
    if (u.pathname === "/retail-admin-api/v1/me/store") {
      if (token === STORE) return reply(200, { id: 457, store_id: "457", dealer_code: "VIC-MP-003", glb_store_code: "VIC-MP-003", name: "Ocean Grove Terrace Pharmacy" });
      if (token === NOCODE) return reply(200, { id: 458, dealer_code: "", glb_store_code: null });
      return reply(401, null);
    }
    return reply(404, null);
  };
  const minted = [];
  const api = createApi({
    env,
    settingsStore: memorySettingsStore(),
    auditLog: memoryAuditLog(),
    secretStore: null,
    auth: { verify: async () => null },
    fetchImpl,
    baseLogger: { info: (l) => lines.push(l), warn: (l) => lines.push(l), error: (l) => lines.push(l), log: (l) => lines.push(l) },
    now: () => NOW,
    mintSession: async (uid, claims) => {
      minted.push({ uid, claims });
      return `custom:${uid}`;
    },
  });
  const post = (body, { ip = "10.0.0.1", method = "POST" } = {}) => api.handle({ method, path: "/api/auth/ph-session", headers: {}, body, ip });
  return { api, post, calls, minted, lines };
}

test("an HQ Admin session becomes an admin editor session", async () => {
  const { post, minted, calls } = setup();
  const res = await post({ token: HQ, host: "hq-admin" });
  assert.equal(res.status, 200);
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.deepEqual({ ...res.body.session, token: undefined }, { token: undefined, role: "hq", admin: true, stores: [], expiresAt: new Date(NOW + 3600000).toISOString() });
  assert.equal(res.body.session.token, "custom:ph-hq-12");
  assert.deepEqual(minted[0].claims, { ph: true, admin: true, stores: [], sx: NOW / 1000 + 3600, phEmail: "owner@example.com" });
  assert.deepEqual(calls, [{ origin: "https://ph.mipharmacy.net", path: "/auth-api/v1/me" }]);
});

test("a Retail Admin session becomes a store session for that store only", async () => {
  const { post, minted } = setup();
  const res = await post({ token: STORE, host: "retail-admin" });
  assert.equal(res.status, 200);
  assert.equal(res.body.session.role, "store");
  assert.equal(res.body.session.admin, false);
  assert.deepEqual(res.body.session.stores, ["VIC-MP-003"]);
  // The PH token lasts 30 days; the editor session is capped (8 hours by default).
  assert.deepEqual(minted[0], { uid: "ph-store-77", claims: { ph: true, admin: false, stores: ["VIC-MP-003"], sx: NOW / 1000 + 8 * 3600 } });
});

test("the host label is only a hint: PH decides the role, so a store token labelled hq-admin is still a store session", async () => {
  const { post, minted, calls } = setup();
  const res = await post({ token: STORE, host: "hq-admin" });
  assert.equal(res.status, 200);
  assert.equal(minted[0].claims.admin, false);
  assert.deepEqual(calls.map((c) => c.path), ["/auth-api/v1/me", "/retail-admin-api/v1/me/store"]);
  const none = setup();
  assert.equal((await none.post({ token: HQ })).body.session.admin, true);
});

test("a token PH does not accept, a malformed one, or none: 401 and nothing minted", async () => {
  const { post, minted, calls } = setup();
  for (const body of [{ token: BAD }, { token: "not-a-token" }, { token: "" }, {}, null, "junk", { token: "a.b.c d" }, { token: `${"a".repeat(5000)}.b.c` }]) {
    const res = await post(body);
    assert.equal(res.status, 401, JSON.stringify(body).slice(0, 40));
    assert.equal(res.body.error.code, "PH_SESSION_REJECTED");
  }
  assert.equal(minted.length, 0);
  assert.equal(calls.length, 2); // only the well-formed one reached PH
});

test("roles: HELP_DESK is refused unless configured; a store with no code is refused", async () => {
  const a = setup();
  const res = await a.post({ token: HELP, host: "hq-admin" });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, "PH_ROLE_NOT_ALLOWED");
  const b = setup({ env: { PH_SESSION_HQ_ROLES: "ADMIN, HELP_DESK" } });
  assert.equal((await b.post({ token: HELP, host: "hq-admin" })).status, 200);
  const c = setup();
  assert.equal((await c.post({ token: NOCODE, host: "retail-admin" })).status, 403);
});

test("PH unreachable is a 502, not a sign-in; GET is refused; switched off it is a 404", async () => {
  const down = setup({ ph: "down" });
  const res = await down.post({ token: HQ });
  assert.equal(res.status, 502);
  assert.equal(down.minted.length, 0);
  const a = setup();
  assert.equal((await a.post({ token: HQ }, { method: "GET" })).status, 405);
  const off = setup({ env: { PH_SESSION_AUTH: "off" } });
  assert.equal((await off.post({ token: HQ })).status, 404);
});

test("sign-in attempts are rate limited per client, and the PH token never reaches a log line", async () => {
  const { post, lines } = setup({ env: { PH_SESSION_RATE_LIMIT_PER_IP_PER_MIN: "3" } });
  for (let i = 0; i < 3; i++) assert.equal((await post({ token: HQ })).status, 200);
  const limited = await post({ token: HQ });
  assert.equal(limited.status, 429);
  assert.ok(limited.headers["Retry-After"]);
  assert.equal((await post({ token: HQ }, { ip: "10.0.0.2" })).status, 200);
  assert.ok(lines.length > 0);
  for (const l of lines) assert.ok(!String(l).includes(HQ) && !String(l).includes(HQ.split(".")[1]), "token in a log line");
});

test("the proxy's own auth reads the same session claims", () => {
  const now = () => NOW;
  assert.equal(actorFromClaims({ uid: "a", ph: true, admin: true, sx: NOW / 1000 - 1 }, { now }), null);
  assert.equal(actorFromClaims({ uid: "a", ph: true, admin: true, sx: NOW / 1000 + 5 }, { now }).admin, true);
  assert.equal(actorFromClaims({ uid: "g", admin: true }, { now, requirePhSession: true }), null);
  assert.equal(actorFromClaims({ uid: "s", ph: true, stores: ["VIC-MP-003"], sx: NOW / 1000 + 5 }, { now }).admin, false);
});
