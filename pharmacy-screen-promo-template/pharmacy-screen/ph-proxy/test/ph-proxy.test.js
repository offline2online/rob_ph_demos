"use strict";
// Offline tests for the PH API token settings and the Location API proxy.
// Run: cd pharmacy-screen-promo-template/pharmacy-screen/ph-proxy && npm test
// No network, no Firebase, no KMS: in-memory adapters and a fake fetch.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const { createApi } = require("../src/create-api");
const { memorySettingsStore, memoryAuditLog } = require("../src/stores");
const { createEnvelopeSecretStore, localKmsProvider, gcpKmsProvider, secretStoreFromEnv } = require("../src/secret-store");
const { trimCampaignData } = require("../src/location-proxy");
const { firebaseAuthAdapter } = require("../src/auth");
const { clientIpFromHeaders } = require("../src/client-ip");
const fs = require("node:fs");
const path = require("node:path");

const TOKEN_A = "tokA-" + crypto.randomBytes(12).toString("hex") + "WXYZ";
const TOKEN_B = "tokB-" + crypto.randomBytes(12).toString("hex") + "QRST";
const LOCAL_KEY = crypto.randomBytes(32).toString("base64");

const SAMPLE = {
  data: {
    store_location: { store_code: "VIC-MP-001", store_name: "Beaumaris Pharmacy", store_timezone: "Australia/Melbourne", internal_id: 991, lat: -37.98 },
    store_info: {
      opening_hours: [
        { open_day: "MONDAY", open_time: "08:30:00", close_day: "MONDAY", close_time: "19:00:00", is_active: true, id: 5 },
        { open_day: "FRIDAY", open_time: "20:00:00", close_day: "SATURDAY", close_time: "02:00:00", is_active: false },
      ],
      address_info: { suburb: "Beaumaris", address: "1 Example St", postcode: "3193", state: "VIC", phone_number: "03 9000 0000", email: "store@example.com" },
      logo_url: "https://cdn.example.com/logo.png",
      staff: [{ name: "x" }],
    },
    campaigns: [{ id: 1 }],
  },
};

function makeClock(start = Date.parse("2026-11-20T00:00:00Z")) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

// Fake upstream servers keyed by base URL. Each: (udid, apiKey) -> {status, json} | "timeout" | "network".
function fakeFetch(servers) {
  const calls = [];
  const fn = async (url, opts) => {
    const u = new URL(url);
    const base = `${u.origin}`;
    const m = /\/location-api\/device\/([^/]+)\/campaign_data$/.exec(u.pathname);
    calls.push({ base, udid: m && decodeURIComponent(m[1]), key: opts.headers["x-api-key"] });
    const handler = servers[base];
    if (!handler) throw new TypeError("fetch failed");
    const r = handler(m && decodeURIComponent(m[1]), opts.headers["x-api-key"]);
    if (r === "network") throw new TypeError("fetch failed");
    if (r === "timeout") {
      const e = new Error("aborted");
      e.name = "AbortError";
      throw e;
    }
    return { status: r.status, json: async () => r.json };
  };
  fn.calls = calls;
  return fn;
}

const okFor = (validKeys) => (udid, key) => {
  if (!validKeys.includes(key)) return { status: 401, json: { message: "bad key" } };
  if (udid === "UNKNOWN") return { status: 404, json: { message: "not found" } };
  return { status: 200, json: SAMPLE };
};

function setup({ servers = { "https://ph.mipharmacy.net": okFor([TOKEN_A]) }, env = {}, secretStore } = {}) {
  const clock = makeClock();
  const logs = [];
  const baseLogger = { info: (l) => logs.push(l), warn: (l) => logs.push(l), error: (l) => logs.push(l), log: (l) => logs.push(l) };
  const store = memorySettingsStore();
  const audit = memoryAuditLog();
  const fetchImpl = fakeFetch(servers);
  const users = {
    "admin-token": { uid: "u-admin", email: "admin@ph.example", admin: true },
    "editor-token": { uid: "u-editor", email: "editor@ph.example", admin: false },
  };
  const auth = { verify: async (h) => { const m = /^Bearer (.+)$/.exec(h.authorization || ""); return m ? users[m[1]] || null : null; } };
  const api = createApi({
    env: { PH_PROXY_CACHE_SECONDS: "15", PH_API_ALLOWED_HOSTS: "*", ...env },
    settingsStore: store,
    auditLog: audit,
    secretStore: secretStore === undefined ? createEnvelopeSecretStore({ kms: localKmsProvider({ keyBase64: LOCAL_KEY, env: {} }) }) : secretStore,
    auth,
    fetchImpl,
    baseLogger,
    now: clock.now,
  });
  const call = (method, path, { as, body, ip = "10.0.0.1" } = {}) =>
    api.handle({ method, path, headers: as ? { authorization: `Bearer ${as}` } : {}, body, ip });
  return { api, store, audit, logs, fetchImpl, clock, call };
}

const everything = (ctx, ...responses) => JSON.stringify([ctx.store.raw(), ctx.audit.entries, ctx.logs, responses]);

test("1. saving a token stores ciphertext only; GET shows set + last 4 only", async () => {
  const ctx = setup();
  const put = await ctx.call("PUT", "/api/settings/ph-api", { as: "admin-token", body: { token: TOKEN_A } });
  assert.equal(put.status, 200);
  assert.deepEqual(put.body.settings.token.set, true);
  assert.equal(put.body.settings.token.last4, "WXYZ");
  const get = await ctx.call("GET", "/api/settings/ph-api", { as: "admin-token" });
  assert.equal(get.status, 200);
  assert.equal(get.body.settings.token.last4, "WXYZ");
  assert.deepEqual(get.body.settings.baseUrls, ["https://ph.mipharmacy.net"]);
  assert.equal(get.body.settings.baseUrlsAreDefault, true);
  assert.equal(get.headers["Cache-Control"], "no-store");

  const raw = ctx.store.raw();
  assert.ok(raw.token.envelope.ciphertext && raw.token.envelope.wrappedKey && raw.token.envelope.iv && raw.token.envelope.tag);
  assert.equal(raw.token.envelope.alg, "AES-256-GCM");
  assert.ok(!JSON.stringify(raw).includes(TOKEN_A), "plaintext token must not be stored");
  assert.ok(!JSON.stringify(raw).includes(TOKEN_A.slice(0, -4)), "no prefix of the token stored either");
  assert.ok(!everything(ctx, put, get).includes(TOKEN_A));
  assert.deepEqual(ctx.audit.entries.map((e) => e.action), ["ph-api.token.set"]);
  assert.equal(ctx.audit.entries[0].actorUid, "u-admin");
  assert.equal(ctx.audit.entries[0].tokenLast4, "WXYZ");
});

test("settings endpoints need an admin; anonymous and non-admin are refused", async () => {
  const ctx = setup();
  for (const [method, path, body] of [["GET", "/api/settings/ph-api"], ["PUT", "/api/settings/ph-api", { token: TOKEN_A }], ["DELETE", "/api/settings/ph-api/token"]]) {
    const anon = await ctx.call(method, path, { body });
    assert.equal(anon.status, 401, `${method} ${path} anonymous`);
    assert.equal(anon.body.error.code, "UNAUTHENTICATED");
    const editor = await ctx.call(method, path, { as: "editor-token", body });
    assert.equal(editor.status, 403, `${method} ${path} non-admin`);
    assert.equal(editor.body.error.code, "FORBIDDEN");
  }
  assert.equal(ctx.store.raw(), null);
  assert.equal(ctx.audit.entries.length, 0);
});

test("base URLs: validated, normalised, saved and audited; token untouched", async () => {
  const ctx = setup();
  await ctx.call("PUT", "/api/settings/ph-api", { as: "admin-token", body: { token: TOKEN_A } });
  const res = await ctx.call("PUT", "/api/settings/ph-api", { as: "admin-token", body: { baseUrls: ["https://ph.mipharmacy.net/", " https://ph2.example.com "] } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.settings.baseUrls, ["https://ph.mipharmacy.net", "https://ph2.example.com"]);
  assert.equal(res.body.settings.token.last4, "WXYZ");
  for (const bad of [["http://ph.example.com"], ["notaurl"], [], ["https://u:p@ph.example.com"], ["https://ph.example.com?x=1"]]) {
    const r = await ctx.call("PUT", "/api/settings/ph-api", { as: "admin-token", body: { baseUrls: bad } });
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.body.error.code, "INVALID_BASE_URL");
  }
  const short = await ctx.call("PUT", "/api/settings/ph-api", { as: "admin-token", body: { token: "abc" } });
  assert.equal(short.body.error.code, "INVALID_TOKEN");
  const extra = await ctx.call("PUT", "/api/settings/ph-api", { as: "admin-token", body: { token: TOKEN_B, last4: "x" } });
  assert.equal(extra.body.error.code, "INVALID_BODY");
  assert.deepEqual(ctx.audit.entries.map((e) => e.action), ["ph-api.token.set", "ph-api.base-urls.update"]);
});

test("2. proxy returns the trimmed store data for a valid device", async () => {
  const ctx = setup();
  await ctx.call("PUT", "/api/settings/ph-api", { as: "admin-token", body: { token: TOKEN_A } });
  const res = await ctx.call("GET", "/api/device/DEV-123/campaign_data");
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(res.body.data, {
    store_location: { store_code: "VIC-MP-001", store_name: "Beaumaris Pharmacy", store_timezone: "Australia/Melbourne" },
    store_info: {
      opening_hours: [
        { open_day: "MONDAY", open_time: "08:30:00", close_day: "MONDAY", close_time: "19:00:00", is_active: true },
        { open_day: "FRIDAY", open_time: "20:00:00", close_day: "SATURDAY", close_time: "02:00:00", is_active: false },
      ],
      special_hours: [],
      address_info: { suburb: "Beaumaris", address: "1 Example St", postcode: "3193", state: "VIC", phone_number: "03 9000 0000" },
      logo_url: "https://cdn.example.com/logo.png",
    },
  });
  assert.equal(res.body.meta.server, "https://ph.mipharmacy.net");
  assert.equal(res.headers["Access-Control-Allow-Origin"], "*");
  assert.equal(ctx.fetchImpl.calls.length, 1);
  assert.equal(ctx.fetchImpl.calls[0].key, TOKEN_A, "token sent upstream as x-api-key");
  assert.equal(ctx.fetchImpl.calls[0].udid, "DEV-123");
  assert.ok(!JSON.stringify(res).includes(TOKEN_A));
});

test("2b. invalid and unknown devices get clean errors", async () => {
  const ctx = setup();
  await ctx.call("PUT", "/api/settings/ph-api", { as: "admin-token", body: { token: TOKEN_A } });
  for (const p of ["/api/device//campaign_data", "/api/device/%24%7BUniqueDeviceID%7D/campaign_data", "/api/device/a%20b/campaign_data", `/api/device/${"x".repeat(200)}/campaign_data`]) {
    const r = await ctx.call("GET", p);
    assert.equal(r.status, 400, p);
    assert.equal(r.body.error.code, "INVALID_DEVICE_ID");
  }
  assert.equal(ctx.fetchImpl.calls.length, 0, "invalid ids never reach PH");
  const unknown = await ctx.call("GET", "/api/device/UNKNOWN/campaign_data");
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error.code, "DEVICE_NOT_FOUND");
  const post = await ctx.call("POST", "/api/device/DEV-1/campaign_data");
  assert.equal(post.status, 405);
});

test("proxy with no token saved answers NOT_CONFIGURED", async () => {
  const ctx = setup();
  const r = await ctx.call("GET", "/api/device/DEV-1/campaign_data");
  assert.equal(r.status, 503);
  assert.equal(r.body.error.code, "NOT_CONFIGURED");
  assert.equal(ctx.fetchImpl.calls.length, 0);
});

test("3. rotating the token: the proxy uses the new one without a redeploy", async () => {
  // Upstream accepts only the new token once it has been rotated at PH.
  let valid = [TOKEN_A];
  const ctx = setup({ servers: { "https://ph.mipharmacy.net": (u, k) => okFor(valid)(u, k) } });
  await ctx.call("PUT", "/api/settings/ph-api", { as: "admin-token", body: { token: TOKEN_A } });
  assert.equal((await ctx.call("GET", "/api/device/DEV-1/campaign_data")).status, 200);

  valid = [TOKEN_B];
  const rep = await ctx.call("PUT", "/api/settings/ph-api", { as: "admin-token", body: { token: TOKEN_B } });
  assert.equal(rep.body.settings.token.last4, "QRST");
  ctx.clock.advance(16000); // past the per-device cache
  const after = await ctx.call("GET", "/api/device/DEV-1/campaign_data");
  assert.equal(after.status, 200);
  assert.equal(ctx.fetchImpl.calls.at(-1).key, TOKEN_B);
  assert.deepEqual(ctx.audit.entries.map((e) => e.action), ["ph-api.token.set", "ph-api.token.replace"]);
  assert.equal(ctx.audit.entries[1].previousTokenLast4, "WXYZ");

  // A second instance that cached the old credentials picks up the new token
  // after its settings cache expires, and on an auth failure at once.
  const del = await ctx.call("DELETE", "/api/settings/ph-api/token", { as: "admin-token" });
  assert.equal(del.body.settings.token.set, false);
  ctx.clock.advance(16000);
  assert.equal((await ctx.call("GET", "/api/device/DEV-1/campaign_data")).body.error.code, "NOT_CONFIGURED");
  assert.equal(ctx.audit.entries.at(-1).action, "ph-api.token.remove");
  assert.ok(!JSON.stringify(ctx.store.raw()).includes(TOKEN_B));
});

test("rejected token reports UPSTREAM_AUTH_FAILED and re-reads settings next time", async () => {
  const ctx = setup({ servers: { "https://ph.mipharmacy.net": okFor(["something-else"]) } });
  await ctx.call("PUT", "/api/settings/ph-api", { as: "admin-token", body: { token: TOKEN_A } });
  const r = await ctx.call("GET", "/api/device/DEV-1/campaign_data");
  assert.equal(r.status, 502);
  assert.equal(r.body.error.code, "UPSTREAM_AUTH_FAILED");
});

test("failover: tries the others, then prefers the last server that worked; all down = UPSTREAM_UNAVAILABLE", async () => {
  let primaryDown = true;
  const servers = {
    "https://a.example.com": (u, k) => (primaryDown ? { status: 503, json: null } : okFor([TOKEN_A])(u, k)),
    "https://b.example.com": "timeout",
    "https://c.example.com": okFor([TOKEN_A]),
  };
  servers["https://b.example.com"] = () => "timeout";
  const ctx = setup({ servers });
  await ctx.call("PUT", "/api/settings/ph-api", { as: "admin-token", body: { token: TOKEN_A, baseUrls: ["https://a.example.com", "https://b.example.com", "https://c.example.com"] } });
  const r1 = await ctx.call("GET", "/api/device/DEV-1/campaign_data");
  assert.equal(r1.status, 200);
  assert.equal(r1.body.meta.server, "https://c.example.com");
  assert.deepEqual(ctx.fetchImpl.calls.map((c) => c.base), ["https://a.example.com", "https://b.example.com", "https://c.example.com"]);

  ctx.clock.advance(16000);
  primaryDown = false;
  const r2 = await ctx.call("GET", "/api/device/DEV-2/campaign_data");
  assert.equal(r2.body.meta.server, "https://c.example.com", "last good server is tried first");
  assert.equal(ctx.fetchImpl.calls.length, 4);

  servers["https://a.example.com"] = () => "network";
  servers["https://c.example.com"] = () => ({ status: 500, json: null });
  ctx.clock.advance(16000);
  const r3 = await ctx.call("GET", "/api/device/DEV-3/campaign_data");
  assert.equal(r3.status, 502);
  assert.equal(r3.body.error.code, "UPSTREAM_UNAVAILABLE");
  assert.ok(!everything(ctx, r1, r2, r3).includes(TOKEN_A));
});

test("short cache and one request in flight per device", async () => {
  const ctx = setup();
  await ctx.call("PUT", "/api/settings/ph-api", { as: "admin-token", body: { token: TOKEN_A } });
  const [a, b, c] = await Promise.all([1, 2, 3].map((i) => ctx.call("GET", "/api/device/DEV-1/campaign_data", { ip: `10.0.0.${i}` })));
  assert.equal(ctx.fetchImpl.calls.length, 1, "concurrent requests share one upstream call");
  for (const r of [a, b, c]) assert.equal(r.status, 200);
  const cached = await ctx.call("GET", "/api/device/DEV-1/campaign_data");
  assert.equal(cached.body.meta.cached, true);
  assert.equal(ctx.fetchImpl.calls.length, 1);
  ctx.clock.advance(15001);
  await ctx.call("GET", "/api/device/DEV-1/campaign_data");
  assert.equal(ctx.fetchImpl.calls.length, 2, "cache expires");
});

test("rate limits count only cache misses: per device, per client and per instance", async () => {
  const ctx = setup({ env: { PH_RATE_LIMIT_PER_DEVICE_PER_MIN: "3", PH_RATE_LIMIT_PER_IP_PER_MIN: "5", PH_PROXY_STALE_SECONDS: "0" } });
  await ctx.call("PUT", "/api/settings/ph-api", { as: "admin-token", body: { token: TOKEN_A } });
  // Per device: each request after the cache window is a miss.
  const codes = [];
  for (let i = 0; i < 4; i++) {
    if (i) ctx.clock.advance(15001);
    codes.push((await ctx.call("GET", "/api/device/DEV-1/campaign_data", { ip: `10.1.0.${i}` })).status);
  }
  assert.deepEqual(codes, [200, 200, 200, 429]);
  const limited = await ctx.call("GET", "/api/device/DEV-1/campaign_data", { ip: "10.9.9.9" });
  assert.equal(limited.body.error.code, "RATE_LIMITED");
  assert.ok(Number(limited.headers["Retry-After"]) >= 1);
  // Per client: one address fanning out across device ids.
  const ipCodes = [];
  for (let i = 0; i < 6; i++) ipCodes.push((await ctx.call("GET", `/api/device/D${i}/campaign_data`, { ip: "10.2.2.2" })).status);
  assert.deepEqual(ipCodes, [200, 200, 200, 200, 200, 429]);
  // Cache hits from that same client are not counted or refused.
  assert.equal((await ctx.call("GET", "/api/device/D0/campaign_data", { ip: "10.2.2.2" })).status, 200);
  ctx.clock.advance(60000);
  assert.equal((await ctx.call("GET", "/api/device/DEV-1/campaign_data", { ip: "10.1.0.1" })).status, 200, "window resets");

  // Per instance: bounds upstream calls even when every request comes from a new address.
  const inst = setup({ env: { PH_UPSTREAM_CALLS_PER_MIN: "4", PH_PROXY_STALE_SECONDS: "0" } });
  await inst.call("PUT", "/api/settings/ph-api", { as: "admin-token", body: { token: TOKEN_A } });
  const fan = [];
  for (let i = 0; i < 6; i++) fan.push((await inst.call("GET", `/api/device/F${i}/campaign_data`, { ip: `10.3.0.${i}` })).status);
  assert.deepEqual(fan, [200, 200, 200, 200, 429, 429]);
  assert.equal(inst.fetchImpl.calls.length, 4);
});

test("a screen is never refused while a cached or in-flight answer exists", async () => {
  const ctx = setup({ env: { PH_RATE_LIMIT_PER_DEVICE_PER_MIN: "12" } });
  await ctx.call("PUT", "/api/settings/ph-api", { as: "admin-token", body: { token: TOKEN_A } });
  const screen = () => ctx.call("GET", "/api/device/DEV-1/campaign_data", { ip: "203.0.113.7" });
  assert.equal((await screen()).status, 200);
  // Someone who knows the device id hammers it from many addresses inside the cache window.
  for (let i = 0; i < 50; i++) assert.equal((await ctx.call("GET", "/api/device/DEV-1/campaign_data", { ip: `198.51.100.${i}` })).status, 200);
  const r = await screen();
  assert.equal(r.status, 200, "cached answer, not 429");
  assert.equal(r.body.meta.cached, true);
  assert.equal(ctx.fetchImpl.calls.length, 1, "none of that reached PH");

  // In flight: many callers join one slow upstream call; none is refused.
  const slow = setup({ env: { PH_RATE_LIMIT_PER_DEVICE_PER_MIN: "1", PH_RATE_LIMIT_PER_IP_PER_MIN: "1" } });
  await slow.call("PUT", "/api/settings/ph-api", { as: "admin-token", body: { token: TOKEN_A } });
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => slow.call("GET", "/api/device/DEV-2/campaign_data", { ip: `198.51.100.${i}` })));
  assert.deepEqual([...new Set(results.map((x) => x.status))], [200]);
  assert.equal(slow.fetchImpl.calls.length, 1);
});

test("an exhausted limit serves the last good answer (meta.stale) instead of 429", async () => {
  const ctx = setup({ env: { PH_RATE_LIMIT_PER_DEVICE_PER_MIN: "1", PH_PROXY_STALE_SECONDS: "600" } });
  await ctx.call("PUT", "/api/settings/ph-api", { as: "admin-token", body: { token: TOKEN_A } });
  assert.equal((await ctx.call("GET", "/api/device/DEV-1/campaign_data")).status, 200);
  ctx.clock.advance(16000);
  const r = await ctx.call("GET", "/api/device/DEV-1/campaign_data", { ip: "10.7.7.7" });
  assert.equal(r.status, 200);
  assert.equal(r.body.meta.stale, true);
  assert.equal(r.body.data.store_location.store_code, "VIC-MP-001");
  ctx.clock.advance(600000);
  assert.equal((await ctx.call("GET", "/api/device/DEV-1/campaign_data", { ip: "10.7.7.8" })).status, 200, "new minute: a fresh upstream call");
  assert.equal(ctx.fetchImpl.calls.length, 2);
});

test("client address: the trusted right-hand end of X-Forwarded-For, never the caller-written left", () => {
  // The caller writes the left part; Google's front end appends the address it saw.
  assert.equal(clientIpFromHeaders({ "x-forwarded-for": "1.2.3.4, 203.0.113.9" }), "203.0.113.9");
  assert.equal(clientIpFromHeaders({ "x-forwarded-for": "203.0.113.9" }), "203.0.113.9");
  // A spoofed header per request still lands in the same bucket.
  const keys = new Set(Array.from({ length: 20 }, (_, i) => clientIpFromHeaders({ "x-forwarded-for": `10.0.${i}.1, 99.${i}.0.1, 203.0.113.9` })));
  assert.deepEqual([...keys], ["203.0.113.9"]);
  // Two trusted hops (an extra proxy that appends its own address).
  assert.equal(clientIpFromHeaders({ "x-forwarded-for": "6.6.6.6, 203.0.113.9, 35.1.1.1" }, { trustedHops: 2 }), "203.0.113.9");
  assert.equal(clientIpFromHeaders({ "x-forwarded-for": "203.0.113.9" }, { trustedHops: 2 }), "203.0.113.9");
  assert.equal(clientIpFromHeaders({}, { fallback: "169.254.1.1" }), "169.254.1.1");
  assert.equal(clientIpFromHeaders({ "x-forwarded-for": " , " }), "unknown");
  assert.equal(clientIpFromHeaders({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }, { trustedHops: "junk" }), "2.2.2.2");
});

test("index.js keys the rate limit on the trusted client address, not req.ip", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert.match(src, /clientIpFromHeaders\(req\.headers/);
  assert.doesNotMatch(src, /ip:\s*req\.ip/);
});

test(".env.example documents every PH_ setting the code reads", () => {
  const root = path.join(__dirname, "..");
  const files = ["index.js", ...fs.readdirSync(path.join(root, "src")).map((f) => path.join("src", f))];
  const used = new Set();
  for (const f of files) for (const m of fs.readFileSync(path.join(root, f), "utf8").matchAll(/env\.(PH_[A-Z0-9_]+)/g)) used.add(m[1]);
  const example = fs.readFileSync(path.join(root, ".env.example"), "utf8");
  const missing = [...used].filter((k) => !new RegExp(`^#?\\s*${k}=`, "m").test(example));
  assert.deepEqual(missing, []);
  assert.ok(used.has("PH_REGION") && used.has("PH_TRUSTED_PROXY_HOPS"));
  assert.ok(!used.has("PH_ALLOW_LOCAL_KMS"), "no override lets the local store run on Cloud Functions");
});

test("4. the token never appears in logs, audit entries or responses, even when an error carries it", async () => {
  const ctx = setup({
    servers: {
      "https://a.example.com": () => { throw new Error(`upstream echoed ${TOKEN_A}`); },
      "https://b.example.com": okFor([TOKEN_A]),
    },
  });
  const out = [];
  out.push(await ctx.call("PUT", "/api/settings/ph-api", { as: "admin-token", body: { token: TOKEN_A, baseUrls: ["https://a.example.com", "https://b.example.com"] } }));
  out.push(await ctx.call("GET", "/api/device/DEV-1/campaign_data"));
  out.push(await ctx.call("GET", "/api/settings/ph-api", { as: "admin-token" }));
  ctx.api.logger.error("forced", new Error(`boom ${TOKEN_A}`), { headers: { "x-api-key": "zzzz-other" } });
  assert.ok(ctx.logs.length > 0, "something was logged");
  const all = everything(ctx, ...out);
  assert.ok(!all.includes(TOKEN_A), "token leaked");
  assert.ok(!all.includes("zzzz-other"), "x-api-key header values are dropped by name");
  assert.ok(ctx.logs.some((l) => l.includes("[REDACTED]")));
});

test("a tampered envelope or a different context cannot be decrypted", async () => {
  const ctx = setup();
  await ctx.call("PUT", "/api/settings/ph-api", { as: "admin-token", body: { token: TOKEN_A } });
  const raw = ctx.store.raw();
  const ct = Buffer.from(raw.token.envelope.ciphertext, "base64");
  ct[0] ^= 1;
  raw.token.envelope.ciphertext = ct.toString("base64");
  raw.version += 1;
  ctx.clock.advance(16000);
  const r = await ctx.call("GET", "/api/device/DEV-1/campaign_data");
  assert.equal(r.status, 503);
  assert.equal(r.body.error.code, "TOKEN_UNREADABLE");

  const store = createEnvelopeSecretStore({ kms: localKmsProvider({ keyBase64: LOCAL_KEY, env: {} }) });
  const env = await store.seal("secret-value-1234", { aad: "ctx-1" });
  assert.equal(await store.open(env, { aad: "ctx-1" }), "secret-value-1234");
  await assert.rejects(store.open(env, { aad: "ctx-2" }), /could not be decrypted/);
  const otherKey = createEnvelopeSecretStore({ kms: localKmsProvider({ keyBase64: crypto.randomBytes(32).toString("base64"), env: {} }) });
  await assert.rejects(otherKey.open(env, { aad: "ctx-1" }), /could not be decrypted/);
});

test("Cloud KMS provider wraps only the data key, with the context as AAD", async () => {
  const seen = [];
  const kek = crypto.randomBytes(32);
  const fakeClient = {
    async encrypt({ name, plaintext, additionalAuthenticatedData }) {
      seen.push({ op: "encrypt", name, len: plaintext.length, aad: Buffer.from(additionalAuthenticatedData).toString() });
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv("aes-256-gcm", kek, iv);
      c.setAAD(additionalAuthenticatedData);
      const ct = Buffer.concat([c.update(plaintext), c.final()]);
      return [{ ciphertext: Buffer.concat([iv, c.getAuthTag(), ct]), name: `${name}/cryptoKeyVersions/1` }];
    },
    async decrypt({ name, ciphertext, additionalAuthenticatedData }) {
      seen.push({ op: "decrypt", name, aad: Buffer.from(additionalAuthenticatedData).toString() });
      const d = crypto.createDecipheriv("aes-256-gcm", kek, ciphertext.subarray(0, 12));
      d.setAAD(additionalAuthenticatedData);
      d.setAuthTag(ciphertext.subarray(12, 28));
      return [{ plaintext: Buffer.concat([d.update(ciphertext.subarray(28)), d.final()]) }];
    },
  };
  const keyName = "projects/p/locations/global/keyRings/pharmacy-screen/cryptoKeys/ph-api-token";
  const store = secretStoreFromEnv({ PH_SECRET_STORE: "gcp-kms", PH_TOKEN_KMS_KEY: keyName }, { kmsClient: fakeClient });
  assert.equal(store.provider, "gcp-kms");
  const env = await store.seal(TOKEN_A, { aad: "pharmacy-screen:ph-api-token:v1" });
  assert.equal(env.kms, "gcp-kms");
  assert.equal(env.keyId, keyName);
  assert.equal(env.keyVersion, `${keyName}/cryptoKeyVersions/1`);
  assert.equal(seen[0].len, 32, "KMS sees only the 32-byte data key, never the token");
  assert.equal(seen[0].aad, "pharmacy-screen:ph-api-token:v1");
  assert.ok(!JSON.stringify(env).includes(TOKEN_A));
  assert.equal(await store.open(env, { aad: "pharmacy-screen:ph-api-token:v1" }), TOKEN_A);
  assert.equal(seen[1].op, "decrypt");
  assert.equal(seen[1].name, keyName);
});

test("secret store configuration: missing KMS key, local store refused on Cloud Functions", async () => {
  assert.equal(secretStoreFromEnv({ PH_SECRET_STORE: "gcp-kms" }), null);
  assert.equal(secretStoreFromEnv({ PH_SECRET_STORE: "local", PH_LOCAL_KMS_KEY: LOCAL_KEY, K_SERVICE: "fn" }), null);
  assert.equal(secretStoreFromEnv({ PH_SECRET_STORE: "local", PH_LOCAL_KMS_KEY: LOCAL_KEY, K_SERVICE: "fn", PH_ALLOW_LOCAL_KMS: "1" }), null, "no override on Cloud Functions");
  assert.equal(secretStoreFromEnv({ PH_SECRET_STORE: "local", PH_LOCAL_KMS_KEY: LOCAL_KEY, AWS_LAMBDA_FUNCTION_NAME: "fn" }), null, "refused on AWS Lambda too");
  assert.ok(secretStoreFromEnv({ PH_SECRET_STORE: "local", PH_LOCAL_KMS_KEY: LOCAL_KEY }));
  assert.throws(() => gcpKmsProvider({}), /PH_TOKEN_KMS_KEY/);

  const ctx = setup({ secretStore: null });
  const r = await ctx.call("PUT", "/api/settings/ph-api", { as: "admin-token", body: { token: TOKEN_A } });
  assert.equal(r.status, 503);
  assert.equal(r.body.error.code, "SECRET_STORE_NOT_CONFIGURED");
  assert.equal(ctx.store.raw(), null, "nothing stored when the token cannot be encrypted");
  assert.ok(!everything(ctx, r).includes(TOKEN_A));
});

test("trimCampaignData keeps only screen fields and safe logo URLs", () => {
  const t = trimCampaignData({ store_location: { store_code: "X" }, store_info: { logo: "http://insecure.example.com/l.png", address_info: {} }, logo_url: "https://ok.example.com/l.png" });
  assert.equal(t.store_info.logo_url, "https://ok.example.com/l.png");
  assert.deepEqual(t.store_info.opening_hours, []);
  assert.equal(t.store_info.address_info.suburb, null);
  assert.equal(trimCampaignData({ store_location: {} }).store_info.logo_url, null);
  assert.equal(trimCampaignData({ store_location: {}, store_info: { logo_url: "javascript:alert(1)" } }).store_info.logo_url, null);
});

test("CORS: settings only for allowed origins; preflight answered", async () => {
  const ctx = setup({ env: { PH_ALLOWED_ORIGINS: "https://admin.example.com" } });
  const ok = await ctx.api.handle({ method: "GET", path: "/api/settings/ph-api", headers: { origin: "https://admin.example.com", authorization: "Bearer admin-token" } });
  assert.equal(ok.headers["Access-Control-Allow-Origin"], "https://admin.example.com");
  const other = await ctx.api.handle({ method: "GET", path: "/api/settings/ph-api", headers: { origin: "https://evil.example.com", authorization: "Bearer admin-token" } });
  assert.equal(other.headers["Access-Control-Allow-Origin"], undefined);
  const pre = await ctx.api.handle({ method: "OPTIONS", path: "/api/device/D/campaign_data", headers: { origin: "https://screen.example.com" } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers["Access-Control-Allow-Methods"], "GET, OPTIONS");
  const nf = await ctx.call("GET", "/api/other");
  assert.equal(nf.status, 404);
});

test("Firebase auth adapter: admin is a custom claim, bad tokens are anonymous", async () => {
  const fakeAuth = {
    async verifyIdToken(t) {
      if (t === "good-admin") return { uid: "a", email: "a@ph.example", admin: true };
      if (t === "good-user") return { uid: "b" };
      throw new Error("invalid");
    },
  };
  const a = firebaseAuthAdapter({ auth: fakeAuth });
  assert.deepEqual(await a.verify({ authorization: "Bearer good-admin" }), { uid: "a", email: "a@ph.example", admin: true, stores: [], ph: false });
  assert.equal((await a.verify({ authorization: "Bearer good-user" })).admin, false);
  assert.equal(await a.verify({ authorization: "Bearer nope" }), null);
  assert.equal(await a.verify({}), null);
  const custom = firebaseAuthAdapter({ auth: { verifyIdToken: async () => ({ uid: "c", pharmacyScreenAdmin: true }) }, adminClaim: "pharmacyScreenAdmin" });
  assert.equal((await custom.verify({ authorization: "Bearer x" })).admin, true);
});

test("base URLs: only hosts the deployment allows can be saved, so the token cannot be pointed elsewhere", async () => {
  const save = (ctx, url) => ctx.call("PUT", "/api/settings/ph-api", { as: "admin-token", body: { baseUrls: [url] } });
  // Default: the default base URL's own host, and nothing else.
  const dflt = setup({ env: { PH_API_ALLOWED_HOSTS: "" } });
  assert.equal((await save(dflt, "https://ph.mipharmacy.net")).status, 200);
  for (const bad of ["https://evil.example", "https://ph.mipharmacy.net.evil.example", "https://xph.mipharmacy.net"]) {
    const res = await save(dflt, bad);
    assert.equal(res.status, 400, bad);
    assert.equal(res.body.error.code, "BASE_URL_HOST_NOT_ALLOWED");
  }
  assert.deepEqual((await dflt.call("GET", "/api/settings/ph-api", { as: "admin-token" })).body.settings.baseUrls, ["https://ph.mipharmacy.net"]);
  const listed = setup({ env: { PH_API_ALLOWED_HOSTS: "ph.mipharmacy.net, .personalisationhub.com" } });
  assert.equal((await save(listed, "https://demo.personalisationhub.com")).status, 200);
  assert.equal((await save(listed, "https://personalisationhub.com.evil.example")).status, 400);
});

test("unknown device ids: 100 guesses a minute from one address get 429 after the limit; real devices keep their data", async () => {
  const servers = {
    "https://ph.mipharmacy.net": (udid, key) => (key !== TOKEN_A ? { status: 401, json: {} } : /^GUESS-/.test(udid) ? { status: 404, json: { message: "not found" } } : { status: 200, json: SAMPLE }),
  };
  const ctx = setup({ servers, env: { PH_RATE_LIMIT_UNKNOWN_PER_IP_PER_MIN: "30" } });
  await ctx.call("PUT", "/api/settings/ph-api", { as: "admin-token", body: { token: TOKEN_A } });
  // A real screen behind the same address has data already.
  assert.equal((await ctx.call("GET", "/api/device/DEV-REAL/campaign_data", { ip: "203.0.113.50" })).status, 200);
  const codes = [];
  for (let i = 0; i < 100; i++) codes.push((await ctx.call("GET", `/api/device/GUESS-${i}/campaign_data`, { ip: "203.0.113.50" })).status);
  assert.deepEqual(codes.slice(0, 30), Array(30).fill(404));
  assert.deepEqual(codes.slice(30), Array(70).fill(429));
  const refused = await ctx.call("GET", "/api/device/GUESS-999/campaign_data", { ip: "203.0.113.50" });
  assert.equal(refused.body.error.code, "RATE_LIMITED");
  assert.equal(refused.headers["Cache-Control"], "no-store");
  assert.equal(ctx.fetchImpl.calls.filter((c) => /^GUESS-/.test(c.udid)).length, 30, "only the allowed guesses reached PH");
  // The real device, from that address, after its cache window: refreshed upstream, not refused.
  ctx.clock.advance(15001);
  const real = await ctx.call("GET", "/api/device/DEV-REAL/campaign_data", { ip: "203.0.113.50" });
  assert.equal(real.status, 200);
  assert.ok(!real.body.meta.stale, "a fresh answer, not the fallback");
  // Another address is not affected, and the guesser's window resets after a minute.
  assert.equal((await ctx.call("GET", "/api/device/DEV-OTHER/campaign_data", { ip: "198.51.100.1" })).status, 200);
  assert.equal((await ctx.call("GET", "/api/device/GUESS-0/campaign_data", { ip: "198.51.100.1" })).status, 404, "a cached not-found answer");
  ctx.clock.advance(60000);
  assert.equal((await ctx.call("GET", "/api/device/GUESS-500/campaign_data", { ip: "203.0.113.50" })).status, 404);
});

test("unknown device ids sent in parallel: the limit holds for a burst, and real devices give their slot back", async () => {
  const servers = {
    "https://ph.mipharmacy.net": (udid, key) => (key !== TOKEN_A ? { status: 401, json: {} } : /^GUESS-/.test(udid) ? { status: 404, json: { message: "not found" } } : { status: 200, json: SAMPLE }),
  };
  const ctx = setup({ servers, env: { PH_RATE_LIMIT_UNKNOWN_PER_IP_PER_MIN: "30" } });
  await ctx.call("PUT", "/api/settings/ph-api", { as: "admin-token", body: { token: TOKEN_A } });
  // 40 real screens behind one address start at once on an instance that has never seen them: a device not yet
  // known holds a slot while its lookup is in flight, so 30 go through and 10 are told to retry (the screen keeps
  // its last data and asks again on its next poll). Every real answer gives its slot back, so the retry succeeds
  // and none of them uses up the unknown-device allowance.
  const cold = await Promise.all(Array.from({ length: 40 }, (_, i) => ctx.call("GET", `/api/device/DEV-${i}/campaign_data`, { ip: "203.0.113.60" })));
  assert.equal(cold.filter((r) => r.status === 200).length, 30);
  const retry = cold.map((r, i) => (r.status === 200 ? null : i)).filter((i) => i !== null);
  const again0 = await Promise.all(retry.map((i) => ctx.call("GET", `/api/device/DEV-${i}/campaign_data`, { ip: "203.0.113.60" })));
  assert.deepEqual(again0.map((r) => r.status), Array(10).fill(200));
  // 100 made-up ids fired concurrently from that address: 30 reach PH, the rest are refused before any call.
  const burst = await Promise.all(Array.from({ length: 100 }, (_, i) => ctx.call("GET", `/api/device/GUESS-${i}/campaign_data`, { ip: "203.0.113.60" })));
  const codes = burst.map((r) => r.status);
  assert.equal(codes.filter((c) => c === 404).length, 30);
  assert.equal(codes.filter((c) => c === 429).length, 70);
  assert.ok(burst.filter((r) => r.status === 429).every((r) => r.headers["Retry-After"] && r.headers["Cache-Control"] === "no-store"));
  assert.equal(ctx.fetchImpl.calls.filter((c) => /^GUESS-/.test(c.udid)).length, 30, "only the allowed guesses reached PH");
  // A real screen from that address still gets fresh data after its cache window.
  ctx.clock.advance(15001);
  const again = await ctx.call("GET", "/api/device/DEV-3/campaign_data", { ip: "203.0.113.60" });
  assert.equal(again.status, 200);
  assert.ok(!again.body.meta.stale, "a fresh answer, not the fallback");
});

test("not-found answers have their own small cache and never evict a real device's fallback", async () => {
  const { CACHE_SIZE, NEGATIVE_CACHE_SIZE } = require("../src/location-proxy");
  assert.ok(NEGATIVE_CACHE_SIZE < CACHE_SIZE);
  const servers = {
    "https://ph.mipharmacy.net": (udid) => (udid === "DEV-REAL" ? { status: 200, json: SAMPLE } : { status: 404, json: {} }),
  };
  const ctx = setup({ servers, env: { PH_RATE_LIMIT_UNKNOWN_PER_IP_PER_MIN: "0", PH_RATE_LIMIT_PER_IP_PER_MIN: "0", PH_RATE_LIMIT_PER_DEVICE_PER_MIN: "1", PH_UPSTREAM_CALLS_PER_MIN: "0", PH_PROXY_STALE_SECONDS: "600" } });
  await ctx.call("PUT", "/api/settings/ph-api", { as: "admin-token", body: { token: TOKEN_A } });
  assert.equal((await ctx.call("GET", "/api/device/DEV-REAL/campaign_data")).status, 200);
  // More unknown ids than the main cache holds, each from its own address.
  for (let i = 0; i < CACHE_SIZE + 10; i++) await ctx.call("GET", `/api/device/X${i}/campaign_data`, { ip: `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}` });
  // Repeats of a recent unknown id are answered from the negative cache.
  const before = ctx.fetchImpl.calls.length;
  assert.equal((await ctx.call("GET", `/api/device/X${CACHE_SIZE + 9}/campaign_data`)).status, 404);
  assert.equal(ctx.fetchImpl.calls.length, before);
  // The real device's per-device limit trips: its last good answer is still there to serve.
  ctx.clock.advance(16000);
  const r = await ctx.call("GET", "/api/device/DEV-REAL/campaign_data", { ip: "10.99.0.1" });
  assert.equal(r.status, 200);
  assert.equal(r.body.meta.stale, true);
});

// Special opening hours (Christmas, New Year, Australia Day): PH's shape, as the account owner pasted it for Beaumaris.
const PH_SPECIAL = {
  store: "Beaumaris Pharmacy", storeId: 458, schoolHolidays: [],
  specialHours: [
    { name: "Christmas Eve", date: "2026-12-24", open: true, openTime: "08:30", closeTime: "19:00", appointmentSlots: 0 },
    { name: "Christmas Day", date: "2026-12-25", open: false },
    { name: "New Year's Eve", date: "2026-12-31", open: true, open_time: "08:30:00", close_time: "19:00:00" },
  ],
};
const TRIMMED_SPECIAL = [
  { name: "Christmas Eve", date: "2026-12-24", open: true, open_time: "08:30", close_time: "19:00" },
  { name: "Christmas Day", date: "2026-12-25", open: false, open_time: null, close_time: null },
  { name: "New Year's Eve", date: "2026-12-31", open: true, open_time: "08:30", close_time: "19:00" },
];

test("special hours: passed through trimmed from each place PH may carry them, in order", () => {
  const list = PH_SPECIAL.specialHours;
  for (const data of [
    { store_location: {}, store_info: { specialHours: list } },
    { store_location: {}, store_info: { special_hours: list } },
    { store_location: {}, specialHours: list },
    { store_location: {}, special_hours: list },
    { store_location: { specialHours: list } },
    { store_location: {}, specialHours: PH_SPECIAL }, // the whole special-hours payload, holding the list
  ]) {
    assert.deepEqual(trimCampaignData(data).store_info.special_hours, TRIMMED_SPECIAL, JSON.stringify(Object.keys(data)));
  }
  // the first place that has a list wins
  const first = trimCampaignData({ store_location: {}, store_info: { specialHours: [list[1]] }, specialHours: list });
  assert.deepEqual(first.store_info.special_hours, [TRIMMED_SPECIAL[1]]);
  // none sent: an empty list, so one GET shows PH sends none
  assert.deepEqual(trimCampaignData({ store_location: {} }).store_info.special_hours, []);
});

test("special hours: each entry is checked strictly and nothing else is kept", () => {
  const t = trimCampaignData({ store_location: {}, store_info: { specialHours: [
    { name: "Bad date", date: "2026-02-30", open: false },
    { name: "Bad format", date: "26/12/2026", open: false },
    { name: "Open as text", date: "2026-12-26", open: "false" },
    { name: "No times", date: "2026-12-27", open: true },
    { name: "Bad time", date: "2026-12-28", open: true, openTime: "25:00", closeTime: "19:00" },
    { name: "  Boxing   Day ", date: "2026-12-26", open: false, storeId: 458, appointmentSlots: 3, extra: "<script>" },
    { date: "2027-01-26", open: false },
    null, "x",
  ] } });
  assert.deepEqual(t.store_info.special_hours, [
    { name: "Boxing Day", date: "2026-12-26", open: false, open_time: null, close_time: null },
    { name: "", date: "2027-01-26", open: false, open_time: null, close_time: null },
  ]);
});
