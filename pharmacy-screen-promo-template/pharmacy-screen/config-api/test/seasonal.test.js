"use strict";

// Seasonal content is each pharmacy's own (src/seasonal.js): nothing done to
// the master of a Seasonal promotion reaches a store's screens.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createConfigApi } = require("../src/api");
const { createMemoryStore } = require("../src/adapters/memory-store");
const { createMemoryBlobs } = require("../src/adapters/blobs");
const { createStaticAuth } = require("../src/adapters/auth");

const COLOURS = { primary: "#0A7D5A", accent: "#f2a900" };
const season = (text, extra = {}) => ({ beats: [{ text, dur: 3 }, { text: "second", dur: 4 }], ...extra });
const MASTER = { occasions: { christmas: season("Merry Christmas"), easter: season("Happy Easter") } };

async function setup() {
  let tick = 0;
  const store = createMemoryStore();
  const api = createConfigApi({
    store,
    blobs: createMemoryBlobs(),
    auth: createStaticAuth({ hq: { uid: "hq", admin: true }, ocean: { uid: "s", admin: false, stores: ["VIC-MP-003"] } }),
    now: () => new Date(Date.UTC(2026, 10, 21, 0, 0, tick++)).toISOString(),
  });
  const call = async (method, path, { as = "hq", body } = {}) => {
    const h = { authorization: `Bearer ${as}` };
    if (body !== undefined) h["content-type"] = "application/json";
    return api.handle({ method, path, headers: h, query: {}, body: body === undefined ? undefined : Buffer.from(JSON.stringify(body)) });
  };
  const ok = async (...a) => { const r = await call(...a); assert.ok(r.status < 300, `${a[0]} ${a[1]} -> ${r.status} ${JSON.stringify(r.body)}`); return r.body; };
  const beau = await ok("POST", "/api/admin/pharmacies", { body: { storeCode: "VIC-MP-001", name: "Beaumaris", colours: COLOURS } });
  const ocean = await ok("POST", "/api/admin/pharmacies", { body: { storeCode: "VIC-MP-003", name: "Ocean Grove", colours: COLOURS } });
  const promo = await ok("POST", "/api/admin/promotions", { body: { name: "Seasonal", promoId: "seasonal", templateId: "builtin-occasion-christmas", master: MASTER } });
  const morning = await ok("POST", "/api/admin/promotions", { body: { name: "Morning", promoId: "morning", templateId: "builtin-promotion-scenes", master: { greeting: "Good morning" } } });
  const screen = async (code) => (await ok("GET", `/api/screens/${code}`, { as: null })).promotions;
  return { call, ok, store, beau, ocean, promo, morning, screen };
}

test("a store starts from the master, then nothing done to the master reaches it", async () => {
  const { ok, promo, screen } = await setup();
  const before = { a: (await screen("VIC-MP-001")).seasonal, b: (await screen("VIC-MP-003")).seasonal };
  assert.equal(before.a.template.occasion, "christmas");
  assert.equal(before.a.content.occasions.christmas.beats[0].text, "Merry Christmas");

  // Copy, dates, timings and the season itself, all changed on the master.
  const edited = { occasions: { christmas: { beats: [{ text: "CHANGED", dur: 9 }, { text: "x", dur: 9 }], from: "12-01", to: "12-31" }, easter: season("CHANGED TOO") } };
  await ok("PATCH", `/api/admin/promotions/${promo.id}`, { body: { master: edited } });
  await ok("PATCH", `/api/admin/promotions/${promo.id}`, { body: { templateId: "builtin-occasion-easter" } });
  await ok("PATCH", `/api/admin/promotions/${promo.id}`, { body: { name: "Seasons" } });

  for (const [code, was] of [["VIC-MP-001", before.a], ["VIC-MP-003", before.b]]) {
    const now = (await screen(code)).seasonal;
    assert.deepEqual(now.content, was.content, `${code} content`);
    assert.deepEqual(now.template, was.template, `${code} season`);
    assert.equal(now.name, "Seasons"); // the promotion's own name is not seasonal content
  }
});

test("stores that were inheriting when this shipped keep exactly what they played", async () => {
  const { ok, store, promo, screen, beau } = await setup();
  // As stored before this change: no own seasonal content, nothing detached.
  const rec = await store.get("pharmacies", beau.id);
  await store.transaction(async (tx) => tx.set("pharmacies", beau.id, { ...rec, content: {}, detached: {} }));
  const before = (await screen("VIC-MP-001")).seasonal;
  await ok("PATCH", `/api/admin/promotions/${promo.id}`, { body: { master: { occasions: { christmas: season("CHANGED") } }, templateId: "builtin-occasion-easter" } });
  const after = (await screen("VIC-MP-001")).seasonal;
  assert.deepEqual(after.content, before.content);
  assert.deepEqual(after.template, before.template);
  const stored = (await ok("GET", `/api/admin/pharmacies/${beau.id}`));
  assert.equal(stored.content[promo.id].season, "christmas");
  assert.deepEqual(stored.detached[promo.id], ["occasions"]);
  assert.equal(stored.version, rec.version, "taking its own copy is not an edit: the version an editor holds stays valid");
});

test("each store picks its own season and dates; only its own screen follows", async () => {
  const { ok, call, promo, ocean, screen } = await setup();
  const mine = (await ok("GET", `/api/admin/pharmacies/${ocean.id}`, { as: "ocean" })).content[promo.id];
  mine.season = "easter";
  mine.occasions.christmas.from = "12-10";
  mine.occasions.christmas.to = "12-26";
  await ok("PUT", `/api/admin/pharmacies/${ocean.id}/content/${promo.id}`, { as: "ocean", body: mine });
  const o = (await screen("VIC-MP-003")).seasonal, b = (await screen("VIC-MP-001")).seasonal;
  assert.equal(o.template.occasion, "easter");
  assert.equal(o.template.id, "builtin-occasion-easter");
  assert.equal(o.content.occasions.christmas.from, "12-10");
  assert.equal(b.template.occasion, "christmas");
  assert.equal(b.content.occasions.christmas.from, undefined);
  // A store user still cannot touch the master.
  assert.equal((await call("PATCH", `/api/admin/promotions/${promo.id}`, { as: "ocean", body: { templateId: "builtin-occasion-easter" } })).status, 403);
  // A season that does not exist falls back to the promotion's, never to nothing.
  await ok("PUT", `/api/admin/pharmacies/${ocean.id}/content/${promo.id}`, { as: "ocean", body: { ...mine, season: "halloween" } });
  assert.equal((await screen("VIC-MP-003")).seasonal.template.occasion, "christmas");
});

test("copy from master is the store's own act: clearing its seasonal content takes the master as it is now", async () => {
  const { ok, promo, ocean, screen } = await setup();
  await ok("PATCH", `/api/admin/promotions/${promo.id}`, { body: { master: { occasions: { christmas: season("New master line"), easter: season("Happy Easter") } } } });
  assert.equal((await screen("VIC-MP-003")).seasonal.content.occasions.christmas.beats[0].text, "Merry Christmas");
  // Restore to default in the pharmacy view: content emptied, nothing detached.
  const a = await ok("PUT", `/api/admin/pharmacies/${ocean.id}/content/${promo.id}`, { as: "ocean", body: {} });
  await ok("PATCH", `/api/admin/pharmacies/${ocean.id}`, { as: "ocean", body: { detached: {} } });
  assert.equal(a.content[promo.id].occasions.christmas.beats[0].text, "New master line", "the answer carries what was stored");
  assert.equal((await screen("VIC-MP-003")).seasonal.content.occasions.christmas.beats[0].text, "New master line");
  assert.equal((await screen("VIC-MP-001")).seasonal.content.occasions.christmas.beats[0].text, "Merry Christmas");
  // And it is independent again from there.
  await ok("PATCH", `/api/admin/promotions/${promo.id}`, { body: { master: { occasions: { christmas: season("Later") } } } });
  assert.equal((await screen("VIC-MP-003")).seasonal.content.occasions.christmas.beats[0].text, "New master line");
});

test("a pharmacy created later starts from the master as it is then; other promotions still inherit live", async () => {
  const { ok, promo, morning, screen } = await setup();
  await ok("PATCH", `/api/admin/promotions/${promo.id}`, { body: { master: { occasions: { christmas: season("This year's line") } }, templateId: "builtin-occasion-easter" } });
  const fresh = await ok("POST", "/api/admin/pharmacies", { body: { storeCode: "VIC-MP-009", name: "New", colours: COLOURS } });
  assert.equal(fresh.content[promo.id].season, "easter");
  const s = (await screen("VIC-MP-009")).seasonal;
  assert.equal(s.template.occasion, "easter");
  assert.equal(s.content.occasions.christmas.beats[0].text, "This year's line");
  // Morning is untouched by any of this: a master edit reaches every store.
  await ok("PATCH", `/api/admin/promotions/${morning.id}`, { body: { master: { greeting: "G'day" } } });
  for (const code of ["VIC-MP-001", "VIC-MP-003", "VIC-MP-009"]) assert.equal((await screen(code)).morning.content.greeting, "G'day", code);
});
