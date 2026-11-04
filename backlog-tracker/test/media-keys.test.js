// functions/media-keys.js — Media Studio provider keys, stored encrypted.
// No Firebase, no network: Firestore, ID-token checks and fetch are stubbed.
// Run: node test/media-keys.test.js
"use strict";
const assert = require("assert");
const crypto = require("crypto");
const { createMediaKeysApi, encrypt, decrypt, keyId, normaliseSiteUrl, wpBasic } = require("../functions/media-keys");

const KEY_A = crypto.randomBytes(32).toString("base64");
const KEY_B = crypto.randomBytes(32).toString("base64");
const BOARD = "board-key-123";
const GEMINI = "AIzaSyTESTKEY-0123456789abcdefWXYZ";

function fakeDb() {
  const state = {};
  const col = (name) => {
    state[name] = state[name] || {};
    return {
      doc: (id) => ({
        async get() { const d = state[name][id]; return { exists: d !== undefined, data: () => d }; },
        async set(data, opts) { state[name][id] = opts && opts.merge ? { ...(state[name][id] || {}), ...data } : { ...data }; },
        async delete() { delete state[name][id]; },
      }),
      async add(data) { const id = `a${Object.keys(state[name]).length}`; state[name][id] = data; return { id }; },
    };
  };
  return { collection: col, state };
}

const USERS = { "rob@offline2online.com": { email: "rob@offline2online.com", role: "admin" }, "ed@x.com": { email: "ed@x.com", role: "editor" } };
function makeApi({ db = fakeDb(), enc = KEY_A, fetch } = {}) {
  let encValue = enc;
  const api = createMediaKeysApi({
    db,
    verifyIdToken: async (t) => { if (!t.startsWith("tok:")) throw new Error("bad"); return { email: t.slice(4) }; },
    resolveConsoleUser: async (email) => USERS[email] || null,
    encKey: () => encValue,
    boardKey: () => BOARD,
    fetch: fetch || (async () => { throw new Error("no network in tests"); }),
    logger: { warn() {}, error() {}, info() {} },
  });
  return { api, db, setEnc: (v) => { encValue = v; } };
}

async function call(api, method, path, { token, board, body, ip = "1.2.3.4" } = {}) {
  const headers = { "x-firebase-id-token": token ? `tok:${token}` : "", "x-board-key": board || "", "x-forwarded-for": ip };
  const req = { method, path: `/mediaKeys${path}`, body, get: (h) => headers[h.toLowerCase()] || "" };
  const res = { statusCode: 0, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, set(k, v) { this.headers[k] = v; return this; }, json(b) { this.body = b; return this; } };
  await api.handle(req, res);
  return res;
}

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

check("encrypt/decrypt round-trips, binds the provider, detects tampering and a different key", async () => {
  const key = Buffer.from(KEY_A, "base64");
  const box = encrypt(key, "gemini", GEMINI);
  assert.ok(!JSON.stringify(box).includes(GEMINI), "ciphertext must not contain the key");
  assert.strictEqual(decrypt(key, "gemini", box), GEMINI);
  assert.throws(() => decrypt(key, "ltx", box), "moved to another slot must fail (AAD)");
  const tampered = { ...box, ct: Buffer.from(Buffer.from(box.ct, "base64").map((b, i) => (i === 0 ? b ^ 1 : b))).toString("base64") };
  assert.throws(() => decrypt(key, "gemini", tampered));
  assert.throws(() => decrypt(Buffer.from(KEY_B, "base64"), "gemini", box), /different MEDIA_KEYS_ENC_KEY/);
  assert.notStrictEqual(encrypt(key, "gemini", GEMINI).iv, box.iv, "fresh IV per write");
  assert.strictEqual(box.keyId, keyId(key));
});

check("only an admin can see status or save; nobody signed out gets in", async () => {
  const { api } = makeApi();
  assert.strictEqual((await call(api, "GET", "/v1/status")).statusCode, 401);
  assert.strictEqual((await call(api, "GET", "/v1/status", { token: "ed@x.com" })).statusCode, 403);
  assert.strictEqual((await call(api, "GET", "/v1/status", { token: "nobody@x.com" })).statusCode, 403);
  assert.strictEqual((await call(api, "POST", "/v1/keys/gemini", { token: "ed@x.com", body: { value: GEMINI } })).statusCode, 403);
  assert.strictEqual((await call(api, "GET", "/v1/status", { board: BOARD })).statusCode, 401, "the board key is not an admin");
});

check("save stores only ciphertext; status never returns the value", async () => {
  const { api, db } = makeApi();
  const r = await call(api, "POST", "/v1/keys/gemini", { token: "rob@offline2online.com", body: { value: `  ${GEMINI} ` } });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.hint, "…WXYZ");
  const stored = JSON.stringify(db.state.mediaProviderKeys);
  assert.ok(!stored.includes(GEMINI), "plaintext must never reach Firestore");
  const s = await call(api, "GET", "/v1/status", { token: "rob@offline2online.com" });
  assert.ok(!JSON.stringify(s.body).includes(GEMINI), "status must never carry the key");
  const g = s.body.providers.find((p) => p.id === "gemini");
  assert.deepStrictEqual([g.set, g.hint, g.updatedBy, g.readable], [true, "…WXYZ", "rob@offline2online.com", true]);
  assert.strictEqual(s.body.providers.find((p) => p.id === "ltx").set, false);
  assert.ok(Object.values(db.state.mediaKeyAudit).some((a) => a.action === "set" && a.provider === "gemini" && !JSON.stringify(a).includes(GEMINI)));
});

check("validation: short keys, spaces, WordPress format and https site URL", async () => {
  const { api } = makeApi();
  const admin = { token: "rob@offline2online.com" };
  assert.strictEqual((await call(api, "POST", "/v1/keys/gemini", { ...admin, body: { value: "short" } })).statusCode, 400);
  assert.strictEqual((await call(api, "POST", "/v1/keys/ltx", { ...admin, body: { value: "has space in the middle of it" } })).statusCode, 400);
  assert.strictEqual((await call(api, "POST", "/v1/keys/wordpress", { ...admin, body: { value: "nocolonhere", siteUrl: "https://wp.test" } })).statusCode, 400);
  assert.strictEqual((await call(api, "POST", "/v1/keys/wordpress", { ...admin, body: { value: "rob:abcd efgh ijkl", siteUrl: "http://wp.test" } })).statusCode, 400);
  assert.strictEqual((await call(api, "POST", "/v1/keys/wordpress", { ...admin, body: { value: "rob:abcd efgh ijkl", siteUrl: "https://wp.test/" } })).statusCode, 200);
  assert.strictEqual((await call(api, "POST", "/v1/keys/nope", { ...admin, body: { value: GEMINI } })).statusCode, 404);
  assert.strictEqual(normaliseSiteUrl("https://user:pw@wp.test"), null);
  assert.strictEqual(wpBasic("rob:abcd efgh"), Buffer.from("rob:abcdefgh").toString("base64"));
});

check("runtime: board key only, decrypted env names, logged, throttled after 10 misses", async () => {
  const { api, db } = makeApi();
  await call(api, "POST", "/v1/keys/gemini", { token: "rob@offline2online.com", body: { value: GEMINI } });
  await call(api, "POST", "/v1/keys/wordpress", { token: "rob@offline2online.com", body: { value: "rob:abcd efgh ijkl", siteUrl: "https://wp.test" } });
  assert.strictEqual((await call(api, "GET", "/v1/runtime", { token: "rob@offline2online.com" })).statusCode, 401, "an admin's sign-in does not read plaintext");
  const ok = await call(api, "GET", "/v1/runtime", { board: BOARD });
  assert.strictEqual(ok.statusCode, 200);
  assert.deepStrictEqual(ok.body.env, { GEMINI_API_KEY: GEMINI, WP_AUTH: "rob:abcd efgh ijkl", WP_SITE_URL: "https://wp.test" });
  assert.ok(db.state.mediaProviderKeys.gemini.lastUsedAt);
  assert.ok(Object.values(db.state.mediaKeyAudit).some((a) => a.action === "runtime-read"));
  for (let i = 0; i < 10; i += 1) assert.strictEqual((await call(api, "GET", "/v1/runtime", { board: "wrong", ip: "9.9.9.9" })).statusCode, 401);
  assert.strictEqual((await call(api, "GET", "/v1/runtime", { board: BOARD, ip: "9.9.9.9" })).statusCode, 429, "locked out even with the right key");
  assert.strictEqual((await call(api, "GET", "/v1/runtime", { board: BOARD, ip: "5.5.5.5" })).statusCode, 200, "other callers unaffected");
});

check("a replaced encryption key reads as 're-enter', not garbage", async () => {
  const { api, setEnc } = makeApi();
  await call(api, "POST", "/v1/keys/gemini", { token: "rob@offline2online.com", body: { value: GEMINI } });
  setEnc(KEY_B);
  const s = await call(api, "GET", "/v1/status", { token: "rob@offline2online.com" });
  assert.strictEqual(s.body.providers.find((p) => p.id === "gemini").readable, false);
  const r = await call(api, "GET", "/v1/runtime", { board: BOARD });
  assert.deepStrictEqual(r.body.env, {});
  assert.match(r.body.problems[0], /re-enter/);
  setEnc("unset");
  assert.strictEqual((await call(api, "POST", "/v1/keys/gemini", { token: "rob@offline2online.com", body: { value: GEMINI } })).statusCode, 503);
});

check("test: Gemini lists models with the stored key; LTX empty job; WordPress users/me", async () => {
  const seen = [];
  const fetch = async (url, opts = {}) => {
    seen.push({ url, opts });
    if (url.includes("generativelanguage")) return new Response(JSON.stringify({ models: [{ name: "models/gemini-3-pro-image-preview" }, { name: "models/veo-3.1-generate-preview" }] }), { status: 200 });
    if (url.includes("api.ltx.io")) return new Response("{}", { status: 422 });
    if (url.includes("wp.test")) return new Response(JSON.stringify({ slug: "rob", capabilities: { upload_files: true } }), { status: 200 });
    throw new Error(url);
  };
  const { api, db } = makeApi({ fetch });
  const admin = { token: "rob@offline2online.com" };
  await call(api, "POST", "/v1/keys/gemini", { ...admin, body: { value: GEMINI } });
  await call(api, "POST", "/v1/keys/ltx", { ...admin, body: { value: "ltxv_abcdefghijklmnop" } });
  await call(api, "POST", "/v1/keys/wordpress", { ...admin, body: { value: "rob:abcd efgh", siteUrl: "https://wp.test" } });
  const g = await call(api, "POST", "/v1/keys/gemini/test", admin);
  assert.deepStrictEqual([g.statusCode, g.body.ok], [200, true]);
  assert.strictEqual(seen[0].opts.headers["x-goog-api-key"], GEMINI);
  const l = await call(api, "POST", "/v1/keys/ltx/test", admin);
  assert.strictEqual(l.body.ok, true);
  assert.strictEqual(seen[1].opts.body, "{}", "the LTX check never sends a real job");
  const w = await call(api, "POST", "/v1/keys/wordpress/test", admin);
  assert.match(w.body.message, /Signed in as rob/);
  assert.strictEqual(db.state.mediaProviderKeys.gemini.lastTest.ok, true);
  assert.strictEqual((await call(api, "DELETE", "/v1/keys/ltx", admin)).statusCode, 200);
  assert.strictEqual(db.state.mediaProviderKeys.ltx, undefined);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of checks) {
    try { await fn(); console.log(`  ok  ${name}`); } catch (err) { failed += 1; console.log(`  FAIL ${name}\n       ${err.message}`); }
  }
  console.log(failed ? `media-keys: ${failed} failed` : `media-keys: all ${checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
})();
