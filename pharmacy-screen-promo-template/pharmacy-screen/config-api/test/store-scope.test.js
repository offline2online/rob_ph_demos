"use strict";

// Store users: a Personalisation Hub Retail Admin session carries the store
// codes it may edit (ph-proxy/src/ph-session.js). The config API must hold
// them to their own pharmacies' overrides, whatever the browser sends.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createConfigApi } = require("../src/api");
const { createMemoryStore } = require("../src/adapters/memory-store");
const { createMemoryBlobs } = require("../src/adapters/blobs");
const { createStaticAuth, actorFromClaims } = require("../src/adapters/auth");

const COLOURS = { primary: "#0A7D5A", accent: "#f2a900" };

async function setup() {
  let tick = 0;
  const api = createConfigApi({
    store: createMemoryStore(),
    blobs: createMemoryBlobs(),
    auth: createStaticAuth({
      hq: { uid: "ph-hq-1", admin: true },
      ocean: { uid: "ph-store-7", admin: false, stores: ["VIC-MP-003"] },
      nobody: { uid: "ph-store-9", admin: false, stores: [] },
    }),
    now: () => new Date(Date.UTC(2026, 10, 21, 0, 0, tick++)).toISOString(),
  });
  const call = (method, path, { as = "hq", body, headers = {} } = {}) => {
    const h = { ...headers, authorization: `Bearer ${as}` };
    let buf;
    if (Buffer.isBuffer(body)) buf = body;
    else if (body !== undefined) {
      buf = Buffer.from(JSON.stringify(body));
      h["content-type"] = h["content-type"] || "application/json";
    }
    return api.handle({ method, path, headers: h, query: {}, body: buf });
  };
  const ocean = (await call("POST", "/api/admin/pharmacies", { body: { storeCode: "VIC-MP-003", name: "Ocean Grove Terrace Pharmacy", colours: COLOURS } })).body;
  const other = (await call("POST", "/api/admin/pharmacies", { body: { storeCode: "VIC-MP-001", name: "Beaumaris Pharmacy", colours: COLOURS } })).body;
  const promo = (await call("POST", "/api/admin/promotions", { body: { name: "Morning", promoId: "morning", templateId: "builtin-promotion-scenes" } })).body;
  return { call, ocean, other, promo };
}

test("a store user sees only their own pharmacy", async () => {
  const { call, ocean, other } = await setup();
  const me = await call("GET", "/api/admin/me", { as: "ocean" });
  assert.equal(me.status, 200);
  assert.deepEqual(me.body.stores, ["VIC-MP-003"]);
  assert.equal(me.body.admin, false);

  const list = await call("GET", "/api/admin/pharmacies", { as: "ocean" });
  assert.deepEqual(list.body.map((p) => p.storeCode), ["VIC-MP-003"]);
  assert.equal((await call("GET", `/api/admin/pharmacies/${ocean.id}`, { as: "ocean" })).status, 200);
  assert.equal((await call("GET", `/api/admin/pharmacies/${other.id}`, { as: "ocean" })).status, 403);
  // Same answer for an id that does not exist, so ids cannot be probed.
  assert.equal((await call("GET", "/api/admin/pharmacies/nope", { as: "ocean" })).status, 403);
  // What the editor needs to draw the page.
  for (const p of ["promotions", "templates", "services"]) assert.equal((await call("GET", `/api/admin/${p}`, { as: "ocean" })).status, 200, p);
});

test("a store user edits only their own overrides; Restore to default works for their store", async () => {
  const { call, ocean, other, promo } = await setup();
  const content = { greeting: "Open late on Thursdays" };
  const own = await call("PUT", `/api/admin/pharmacies/${ocean.id}/content/${promo.id}`, { as: "ocean", body: content });
  assert.equal(own.status, 200);
  const detach = await call("PATCH", `/api/admin/pharmacies/${ocean.id}`, { as: "ocean", body: { detached: { [promo.id]: ["greeting"] } } });
  assert.equal(detach.status, 200);
  // Restore to default: content back to nothing, nothing detached.
  assert.equal((await call("PUT", `/api/admin/pharmacies/${ocean.id}/content/${promo.id}`, { as: "ocean", body: {} })).status, 200);
  const restored = await call("PATCH", `/api/admin/pharmacies/${ocean.id}`, { as: "ocean", body: { detached: {} } });
  assert.equal(restored.status, 200);
  assert.deepEqual(restored.body.detached || {}, {});

  // Another store: refused, and nothing changed.
  assert.equal((await call("PUT", `/api/admin/pharmacies/${other.id}/content/${promo.id}`, { as: "ocean", body: content })).status, 403);
  assert.equal((await call("PATCH", `/api/admin/pharmacies/${other.id}`, { as: "ocean", body: { detached: {} } })).status, 403);
  const untouched = (await call("GET", `/api/admin/pharmacies/${other.id}`)).body;
  assert.equal(untouched.version, other.version);
});

test("a store user cannot change pharmacy details, the master, or anything an administrator owns", async () => {
  const { call, ocean, promo } = await setup();
  for (const body of [{ name: "Renamed" }, { storeCode: "VIC-MP-001" }, { colours: { primary: "#000000" } }, { tokens: { Phone: "1" } }, { detached: {}, name: "Renamed" }]) {
    assert.equal((await call("PATCH", `/api/admin/pharmacies/${ocean.id}`, { as: "ocean", body })).status, 403, JSON.stringify(body));
  }
  const refused = [
    ["PUT", `/api/admin/pharmacies/${ocean.id}`, { name: "x" }],
    ["DELETE", `/api/admin/pharmacies/${ocean.id}`],
    ["POST", "/api/admin/pharmacies", { storeCode: "VIC-MP-009", name: "New", colours: COLOURS }],
    ["PUT", `/api/admin/pharmacies/${ocean.id}/logo`, Buffer.from("x")],
    ["DELETE", `/api/admin/pharmacies/${ocean.id}/logo`],
    ["PATCH", `/api/admin/promotions/${promo.id}`, { master: {} }],
    ["POST", "/api/admin/promotions", { name: "x", promoId: "x", templateId: "builtin-promotion-scenes" }],
    ["DELETE", `/api/admin/promotions/${promo.id}`],
    ["PATCH", "/api/admin/templates/builtin-promotion-scenes", { name: "x" }],
    ["POST", "/api/admin/templates/builtin-promotion-scenes/clone", {}],
    ["POST", "/api/admin/services", { name: "x" }],
    ["GET", "/api/admin/audit"],
  ];
  for (const [method, path, body] of refused) assert.equal((await call(method, path, { as: "ocean", body })).status, 403, `${method} ${path}`);
  assert.equal((await call("GET", `/api/admin/pharmacies/${ocean.id}`)).body.name, "Ocean Grove Terrace Pharmacy");
});

test("a signed-in user with no admin role and no store gets nothing", async () => {
  const { call } = await setup();
  for (const p of ["me", "pharmacies", "promotions", "templates", "services"]) assert.equal((await call("GET", `/api/admin/${p}`, { as: "nobody" })).status, 403, p);
});

test("session claims: a PH session past its end is refused; requirePhSession refuses any other sign-in", () => {
  const now = () => Date.parse("2026-11-21T00:00:00Z");
  const sx = Math.floor(now() / 1000);
  assert.deepEqual(actorFromClaims({ uid: "a", ph: true, admin: true, stores: [], sx: sx + 60 }, { now }), { uid: "a", email: null, admin: true, stores: [], ph: true });
  assert.equal(actorFromClaims({ uid: "a", ph: true, admin: true, sx: sx - 1 }, { now }), null);
  assert.equal(actorFromClaims({ uid: "a", ph: true, admin: true }, { now }), null);
  // Another kind of sign-in: allowed unless the deployment is PH-only, and never given stores.
  assert.deepEqual(actorFromClaims({ uid: "g", email: "owner@example.com", admin: true, stores: ["VIC-MP-003"] }, { now }).stores, []);
  assert.equal(actorFromClaims({ uid: "g", admin: true }, { now, requirePhSession: true }), null);
  // Store codes that could not be a store code are dropped.
  assert.deepEqual(actorFromClaims({ uid: "s", ph: true, stores: ["VIC-MP-003", "a/b", 7], sx: sx + 60 }, { now }).stores, ["VIC-MP-003"]);
});
