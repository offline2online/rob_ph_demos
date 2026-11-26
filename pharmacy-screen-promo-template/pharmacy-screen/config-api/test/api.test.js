"use strict";

// The config API end to end over its HTTP surface, against the in-memory
// adapters. Covers the ticket's test steps 1-4:
//   1. CRUD each entity with an admin token; non-admin refused
//   2. deleting a custom template falls promotions back to the built-in
//   3. promo IDs and store codes unique
//   4. the screen read endpoint returns config without secret fields
// plus the audit log, uploads, versions and validation. Step 5 (rules) is
// test/rules.test.js, run against the emulators.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createConfigApi } = require("../src/api");
const { createMemoryStore } = require("../src/adapters/memory-store");
const { createMemoryBlobs } = require("../src/adapters/blobs");
const { createStaticAuth } = require("../src/adapters/auth");

const ADMIN = "Bearer admin-token";
const VIEWER = "Bearer viewer-token";

// PS_TEST_STORE: a module whose createTestStore() returns another store with the same contract, to run this
// whole suite against it (aws/test/ runs it against the DynamoDB store). Default: the in-memory store.
function setup() {
  const store = process.env.PS_TEST_STORE ? require(process.env.PS_TEST_STORE).createTestStore() : createMemoryStore();
  const blobs = createMemoryBlobs();
  let tick = 0;
  const api = createConfigApi({
    store,
    blobs,
    auth: createStaticAuth({
      "admin-token": { uid: "u-admin", email: "admin@example.com", admin: true },
      "viewer-token": { uid: "u-viewer", email: "viewer@example.com", admin: false },
    }),
    allowedOrigins: ["https://admin.example.com"],
    now: () => new Date(Date.UTC(2026, 10, 20, 0, 0, tick++)).toISOString(),
  });
  const call = async (method, path, { auth = ADMIN, body, headers = {}, query = {} } = {}) => {
    const h = { ...headers };
    if (auth) h.authorization = auth;
    let buf;
    if (Buffer.isBuffer(body)) buf = body;
    else if (body !== undefined) {
      buf = Buffer.from(JSON.stringify(body));
      h["content-type"] = h["content-type"] || "application/json";
    }
    return api.handle({ method, path, headers: h, query, body: buf });
  };
  return { api, store, blobs, call };
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("fake-png-body")]);
const PNG2 = Buffer.concat([PNG, Buffer.from("2")]);

const beaumaris = {
  storeCode: "vic-mp-001",
  name: "Beaumaris Pharmacy",
  colours: { primary: "#0A7D5A", accent: "#f2a900" },
};

async function seedBasics(call) {
  const ph = (await call("POST", "/api/admin/pharmacies", { body: beaumaris })).body;
  const morning = (await call("POST", "/api/admin/promotions", { body: { name: "Morning", promoId: "morning", templateId: "builtin-promotion-scenes" } })).body;
  return { ph, morning };
}

// ── 1. CRUD and access ──────────────────────────────────────────────────

test("pharmacies: create, read, list, update, delete", async () => {
  const { call } = setup();
  const created = await call("POST", "/api/admin/pharmacies", { body: beaumaris });
  assert.equal(created.status, 201);
  const ph = created.body;
  assert.equal(ph.storeCode, "VIC-MP-001", "store code upper-cased");
  assert.equal(ph.colours.primary, "#0a7d5a", "colours lower-cased");
  assert.equal(ph.version, 1);
  assert.equal(ph.logo, null);

  assert.deepEqual((await call("GET", `/api/admin/pharmacies/${ph.id}`)).body.name, "Beaumaris Pharmacy");
  const list = await call("GET", "/api/admin/pharmacies");
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].content, undefined, "list leaves content out");

  const upd = await call("PATCH", `/api/admin/pharmacies/${ph.id}`, { body: { name: "Beaumaris Pharmacy & Clinic", colours: { accent: "#123456" } } });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.name, "Beaumaris Pharmacy & Clinic");
  assert.deepEqual(upd.body.colours, { primary: "#0a7d5a", accent: "#123456" }, "partial colours merge");
  assert.equal(upd.body.version, 2);
  assert.equal(upd.body.createdBy, "u-admin");

  const del = await call("DELETE", `/api/admin/pharmacies/${ph.id}`);
  assert.equal(del.status, 200);
  assert.equal((await call("GET", `/api/admin/pharmacies/${ph.id}`)).status, 404);
  assert.equal((await call("GET", "/api/screens/VIC-MP-001", { auth: null })).status, 404, "unpublished on delete");
});

test("promotions: create, read, list, update, delete", async () => {
  const { call } = setup();
  const c = await call("POST", "/api/admin/promotions", { body: { name: "Morning", promoId: "Morning", templateId: "builtin-promotion-scenes" } });
  assert.equal(c.status, 201);
  assert.equal(c.body.promoId, "morning", "promo ID lower-cased");
  const id = c.body.id;
  assert.equal((await call("GET", `/api/admin/promotions/${id}`)).body.name, "Morning");
  assert.equal((await call("GET", "/api/admin/promotions")).body.length, 1);
  const u = await call("PUT", `/api/admin/promotions/${id}`, { body: { name: "Mornings", promoId: "am" } });
  assert.equal(u.status, 200);
  assert.equal(u.body.promoId, "am");
  assert.equal(u.body.templateId, "builtin-promotion-scenes", "unsent fields kept");
  assert.equal((await call("POST", "/api/admin/promotions", { body: { name: "X", promoId: "x", templateId: "nope" } })).status, 400, "unknown template refused");
  assert.equal((await call("DELETE", `/api/admin/promotions/${id}`)).status, 200);
  assert.equal((await call("GET", "/api/admin/promotions")).body.length, 0);
});

test("templates: built-ins listed and read-only; custom clone, edit, delete", async () => {
  const { call } = setup();
  const list = (await call("GET", "/api/admin/templates")).body;
  assert.deepEqual(list.map((t) => [t.id, t.builtIn]), [["builtin-promotion-scenes", true], ["builtin-opening-hours", true], ["builtin-sale", true],
    ...["fallback", "christmas", "new-year", "australia-day", "valentines-day", "easter", "anzac-day"].map((o) => [`builtin-occasion-${o}`, true])]);
  assert.deepEqual(list.filter((t) => t.kind === "occasion").map((t) => [t.name, t.occasion]), [
    ["Fallback", "fallback"], ["Christmas", "christmas"], ["New Year's", "new-year"], ["Australia Day", "australia-day"], ["Valentine's Day", "valentines-day"], ["Easter", "easter"], ["Anzac Day", "anzac-day"]]);
  // Occasion templates are read-only and can't be cloned (there is no HTML version of an occasion).
  assert.equal((await call("PATCH", "/api/admin/templates/builtin-occasion-easter", { body: { name: "Mine" } })).status, 403);
  const occClone = await call("POST", "/api/admin/templates/builtin-occasion-easter/clone", { body: { name: "Easter copy" } });
  assert.equal(occClone.status, 400);
  assert.match(occClone.body.error.message || JSON.stringify(occClone.body), /seasonal template: it has no editable HTML.*Currently active promotion drop-down/);

  // The sale template is read-only and can't be cloned either.
  const saleClone = await call("POST", "/api/admin/templates/builtin-sale/clone", { body: { name: "Sale copy" } });
  assert.equal(saleClone.status, 400);
  assert.match(saleClone.body.error.message, /Sales Promos template: it has no editable HTML/);
  assert.equal((await call("PATCH", "/api/admin/templates/builtin-promotion-scenes", { body: { name: "Mine" } })).status, 403);
  assert.equal((await call("DELETE", "/api/admin/templates/builtin-opening-hours")).status, 403);
  assert.equal((await call("PUT", "/api/admin/templates/builtin-opening-hours/backgrounds/portrait", { body: PNG, headers: { "content-type": "image/png" } })).status, 403);

  const clone = await call("POST", "/api/admin/templates/builtin-opening-hours/clone", { body: { name: "Hours — winter" } });
  assert.equal(clone.status, 201);
  assert.equal(clone.body.kind, "opening-hours");
  assert.equal(clone.body.basedOn, "builtin-opening-hours");
  assert.equal(clone.body.builtIn, false);
  const tid = clone.body.id;

  const edit = await call("PATCH", `/api/admin/templates/${tid}`, { body: { html: "<div class=\"h\">${Headline}</div>", css: ".h{color:var(--accent)}" } });
  assert.equal(edit.status, 200);
  assert.equal(edit.body.html, "<div class=\"h\">${Headline}</div>");
  assert.equal((await call("PATCH", `/api/admin/templates/${tid}`, { body: { kind: "promotion-scenes" } })).status, 400, "kind is fixed");

  const copyOfCopy = await call("POST", `/api/admin/templates/${tid}/clone`);
  assert.equal(copyOfCopy.status, 201);
  assert.equal(copyOfCopy.body.name, "Hours — winter (copy)");
  assert.equal(copyOfCopy.body.html, edit.body.html);

  const blank = await call("POST", "/api/admin/templates", { body: { name: "Blank scenes", kind: "promotion-scenes" } });
  assert.equal(blank.status, 201);
  assert.equal((await call("POST", "/api/admin/templates", { body: { name: "Bad", kind: "video" } })).status, 400);

  assert.equal((await call("DELETE", `/api/admin/templates/${tid}`)).status, 200);
  assert.equal((await call("GET", `/api/admin/templates/${tid}`)).status, 404);
  assert.equal((await call("GET", "/api/admin/templates")).body.length, 12, "ten built-ins and the two customs left");
});

test("services: create, read, list, update, delete", async () => {
  const { call } = setup();
  const c = await call("POST", "/api/admin/services", {
    body: { label: "Flu vaccination", icon: "vaccines", category: "Vaccinations", headline: "Flu shots <b>today</b>", accent: "No appointment needed", line1: "Walk in", line2: "", offeredBy: ["vic-mp-002", "VIC-MP-001", "VIC-MP-001"] },
  });
  assert.equal(c.status, 201);
  assert.deepEqual(c.body.offeredBy, ["VIC-MP-001", "VIC-MP-002"], "store codes normalised, de-duplicated, sorted");
  const id = c.body.id;
  assert.equal((await call("GET", `/api/admin/services/${id}`)).body.icon, "vaccines");
  assert.equal((await call("GET", "/api/admin/services")).body.length, 1);
  const u = await call("PATCH", `/api/admin/services/${id}`, { body: { line2: "Bulk-billed for eligible patients" } });
  assert.equal(u.body.line2, "Bulk-billed for eligible patients");
  assert.equal(u.body.label, "Flu vaccination");
  assert.equal((await call("POST", "/api/admin/services", { body: { icon: "x" } })).status, 400, "label required");
  assert.equal((await call("DELETE", `/api/admin/services/${id}`)).status, 200);
  assert.equal((await call("GET", "/api/admin/services")).body.length, 0);
});

test("admin endpoints: no token 401, non-admin 403 on every route, admin allowed", async () => {
  const { call } = setup();
  const { ph, morning } = await seedBasics(call);
  const routes = [
    ["GET", "/api/admin/pharmacies"],
    ["POST", "/api/admin/pharmacies", beaumaris],
    ["GET", `/api/admin/pharmacies/${ph.id}`],
    ["PATCH", `/api/admin/pharmacies/${ph.id}`, { name: "Hacked" }],
    ["PUT", `/api/admin/pharmacies/${ph.id}/content/${morning.id}`, { greeting: "x" }],
    ["DELETE", `/api/admin/pharmacies/${ph.id}`],
    ["DELETE", `/api/admin/pharmacies/${ph.id}/logo`],
    ["GET", "/api/admin/promotions"],
    ["POST", "/api/admin/promotions", { name: "N", promoId: "n", templateId: "builtin-promotion-scenes" }],
    ["PATCH", `/api/admin/promotions/${morning.id}`, { name: "Hacked" }],
    ["DELETE", `/api/admin/promotions/${morning.id}`],
    ["GET", "/api/admin/templates"],
    ["POST", "/api/admin/templates/builtin-promotion-scenes/clone", {}],
    ["GET", "/api/admin/services"],
    ["POST", "/api/admin/services", { label: "x" }],
    ["GET", "/api/admin/audit"],
  ];
  for (const [method, path, body] of routes) {
    assert.equal((await call(method, path, { auth: null, body })).status, 401, `${method} ${path} without a token`);
    assert.equal((await call(method, path, { auth: "Bearer forged", body })).status, 401, `${method} ${path} with an unknown token`);
    assert.equal((await call(method, path, { auth: VIEWER, body })).status, 403, `${method} ${path} as non-admin`);
  }
  assert.equal((await call("PUT", `/api/admin/pharmacies/${ph.id}/logo`, { auth: VIEWER, body: PNG, headers: { "content-type": "image/png" } })).status, 403);
  // Nothing the refused calls tried took effect.
  assert.equal((await call("GET", `/api/admin/pharmacies/${ph.id}`)).body.name, "Beaumaris Pharmacy");
  assert.equal((await call("GET", "/api/admin/promotions")).body.length, 1);
  assert.equal((await call("GET", "/api/admin/me")).body.admin, true);
});

// ── 2. template delete falls back ───────────────────────────────────────

test("deleting a custom template falls its promotions back to the matching built-in", async () => {
  const { call } = setup();
  const { ph } = await seedBasics(call);
  const scenes = (await call("POST", "/api/admin/templates/builtin-promotion-scenes/clone", { body: { name: "Scenes v2" } })).body;
  const hours = (await call("POST", "/api/admin/templates/builtin-opening-hours/clone", { body: { name: "Hours v2" } })).body;
  const p1 = (await call("POST", "/api/admin/promotions", { body: { name: "Afternoon", promoId: "afternoon", templateId: scenes.id } })).body;
  const p2 = (await call("POST", "/api/admin/promotions", { body: { name: "Closed", promoId: "closed", templateId: hours.id } })).body;
  const p3 = (await call("POST", "/api/admin/promotions", { body: { name: "Evening", promoId: "evening", templateId: hours.id } })).body;
  assert.equal((await call("GET", "/api/screens/VIC-MP-001", { auth: null })).body.promotions.closed.template.id, hours.id);

  const del = await call("DELETE", `/api/admin/templates/${hours.id}`);
  assert.equal(del.status, 200);
  assert.equal(del.body.fallbackTemplateId, "builtin-opening-hours");
  assert.deepEqual([...del.body.promotionsFellBack].sort(), [p2.id, p3.id].sort());

  assert.equal((await call("GET", `/api/admin/promotions/${p2.id}`)).body.templateId, "builtin-opening-hours");
  assert.equal((await call("GET", `/api/admin/promotions/${p3.id}`)).body.templateId, "builtin-opening-hours");
  assert.equal((await call("GET", `/api/admin/promotions/${p1.id}`)).body.templateId, scenes.id, "other template's promotions untouched");

  const screen = (await call("GET", "/api/screens/VIC-MP-001", { auth: null })).body;
  assert.equal(screen.promotions.closed.template.id, "builtin-opening-hours", "published config follows");
  assert.equal(screen.promotions.closed.template.builtIn, true);
  assert.equal(screen.promotions.afternoon.template.id, scenes.id);

  // The scenes clone falls back to Promotion scenes, not Opening hours.
  await call("DELETE", `/api/admin/templates/${scenes.id}`);
  assert.equal((await call("GET", `/api/admin/promotions/${p1.id}`)).body.templateId, "builtin-promotion-scenes");
  assert.ok(ph.id);
});

// ── 3. uniqueness ───────────────────────────────────────────────────────

test("store codes are unique (case-insensitive), on create and on update", async () => {
  const { call } = setup();
  await call("POST", "/api/admin/pharmacies", { body: beaumaris });
  const dup = await call("POST", "/api/admin/pharmacies", { body: { ...beaumaris, storeCode: "VIC-MP-001", name: "Other" } });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.code, "duplicate-store-code");
  const other = (await call("POST", "/api/admin/pharmacies", { body: { ...beaumaris, storeCode: "VIC-MP-002", name: "North Ringwood" } })).body;
  const clash = await call("PATCH", `/api/admin/pharmacies/${other.id}`, { body: { storeCode: "vic-mp-001" } });
  assert.equal(clash.status, 409);
  assert.equal((await call("PATCH", `/api/admin/pharmacies/${other.id}`, { body: { storeCode: "VIC-MP-002", name: "Same code is fine" } })).status, 200, "keeping your own code is not a clash");
  assert.equal((await call("GET", "/api/admin/pharmacies")).body.length, 2);
});

test("store codes are unique under concurrent creates", async () => {
  const { call } = setup();
  const results = await Promise.all([1, 2, 3, 4].map((n) => call("POST", "/api/admin/pharmacies", { body: { ...beaumaris, name: `P${n}` } })));
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409, 409]);
});

test("promo IDs are unique, on create and on update", async () => {
  const { call } = setup();
  const m = (await call("POST", "/api/admin/promotions", { body: { name: "Morning", promoId: "morning", templateId: "builtin-promotion-scenes" } })).body;
  const dup = await call("POST", "/api/admin/promotions", { body: { name: "Morning 2", promoId: "MORNING", templateId: "builtin-promotion-scenes" } });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.code, "duplicate-promo-id");
  const a = (await call("POST", "/api/admin/promotions", { body: { name: "Afternoon", promoId: "afternoon", templateId: "builtin-promotion-scenes" } })).body;
  assert.equal((await call("PATCH", `/api/admin/promotions/${a.id}`, { body: { promoId: "morning" } })).status, 409);
  assert.equal((await call("PATCH", `/api/admin/promotions/${m.id}`, { body: { promoId: "morning", name: "Morning!" } })).status, 200);
  assert.equal((await call("POST", "/api/admin/promotions", { body: { name: "Bad", promoId: "has space", templateId: "builtin-promotion-scenes" } })).status, 400);
});

// ── 4. public screen read ───────────────────────────────────────────────

test("screen read endpoint: public, published config only, no secret or admin fields", async () => {
  const { call } = setup();
  const { ph, morning } = await seedBasics(call);
  const closed = (await call("POST", "/api/admin/promotions", { body: { name: "Closed", promoId: "closed", templateId: "builtin-opening-hours" } })).body;
  await call("PUT", `/api/admin/pharmacies/${ph.id}/content/${morning.id}`, { body: { greeting: "Good morning, ${Suburb}", scenes: [{ headline: "Flu <b>shots</b>", duration: 3 }] } });
  await call("PUT", `/api/admin/pharmacies/${ph.id}/logo`, { body: PNG, headers: { "content-type": "image/png" } });
  // Fields a client tries to slip in are dropped on write…
  await call("PATCH", `/api/admin/pharmacies/${ph.id}`, { body: { apiToken: "ph_live_SECRET", internalNotes: "staff only", logo: { path: "evil", url: "https://evil" } } });

  const res = await call("GET", "/api/screens/vic-mp-001", { auth: null });
  assert.equal(res.status, 200);
  assert.equal(res.headers["Access-Control-Allow-Origin"], "*");
  const cfg = res.body;
  assert.deepEqual(Object.keys(cfg).sort(), ["colours", "logo", "name", "promotions", "publishedAt", "schemaVersion", "storeCode"]);
  assert.equal(cfg.storeCode, "VIC-MP-001");
  assert.match(cfg.logo, /^http:\/\/localhost\/media\/pharmacyScreen\/media\/logos\//, "logo is a URL, not the record");
  assert.deepEqual(Object.keys(cfg.promotions).sort(), ["closed", "morning"]);
  assert.deepEqual(Object.keys(cfg.promotions.morning).sort(), ["content", "name", "promoId", "template"]);
  assert.deepEqual(Object.keys(cfg.promotions.morning.template).sort(), ["backgrounds", "builtIn", "css", "html", "id", "kind", "name"]);
  assert.equal(cfg.promotions.morning.content.greeting, "Good morning, ${Suburb}");
  assert.deepEqual(cfg.promotions.closed.content, {});
  assert.equal(closed.promoId, "closed");

  // …and nothing private reaches the public document.
  const text = JSON.stringify(cfg);
  for (const banned of ["SECRET", "apiToken", "internalNotes", "evil", "u-admin", "admin@example.com", "createdBy", "updatedBy", "version\"", "\"path\"", "x-api-key", "token"]) {
    assert.ok(!text.includes(banned), `published config must not contain ${banned}`);
  }

  const one = await call("GET", "/api/screens/VIC-MP-001", { auth: null, query: { promo: "Morning" } });
  assert.deepEqual(Object.keys(one.body.promotions), ["morning"], "?promo= narrows to one promotion");
  assert.equal((await call("GET", "/api/screens/VIC-MP-001", { auth: null, query: { promo: "nope" } })).body.error.code, "unknown-promo");
  assert.equal((await call("GET", "/api/screens/VIC-MP-999", { auth: null })).status, 404);
  assert.equal((await call("GET", "/api/screens/..%2F..%2Fconfig", { auth: null })).status, 404, "junk store code is a plain 404");
  assert.equal((await call("POST", "/api/screens/VIC-MP-001", { auth: null, body: {} })).status, 405, "no writes on the public route");
});

test("published config follows every change: rename, store code change, promotion edits", async () => {
  const { call } = setup();
  const { ph, morning } = await seedBasics(call);
  await call("PATCH", `/api/admin/pharmacies/${ph.id}`, { body: { name: "Renamed" } });
  assert.equal((await call("GET", "/api/screens/VIC-MP-001", { auth: null })).body.name, "Renamed");

  await call("PATCH", `/api/admin/promotions/${morning.id}`, { body: { promoId: "am" } });
  assert.deepEqual(Object.keys((await call("GET", "/api/screens/VIC-MP-001", { auth: null })).body.promotions), ["am"]);

  await call("PATCH", `/api/admin/pharmacies/${ph.id}`, { body: { storeCode: "VIC-MP-010" } });
  assert.equal((await call("GET", "/api/screens/VIC-MP-001", { auth: null })).status, 404, "old code unpublished");
  assert.equal((await call("GET", "/api/screens/VIC-MP-010", { auth: null })).status, 200);

  await call("DELETE", `/api/admin/promotions/${morning.id}`);
  assert.deepEqual((await call("GET", "/api/screens/VIC-MP-010", { auth: null })).body.promotions, {});
});

test("promotion schedule: no schedule by default; Annual keeps a start and end date and is published", async () => {
  const { call } = setup();
  const { morning } = await seedBasics(call);
  assert.equal(morning.schedule, undefined, "no schedule by default");
  const screen = async () => (await call("GET", "/api/screens/VIC-MP-001", { auth: null })).body.promotions.morning;
  assert.equal((await screen()).schedule, undefined);

  const annual = { type: "annual", from: "11-01", to: "01-15" };
  const u = await call("PATCH", `/api/admin/promotions/${morning.id}`, { body: { schedule: annual } });
  assert.equal(u.status, 200);
  assert.deepEqual(u.body.schedule, annual);
  assert.deepEqual((await screen()).schedule, annual, "published with the promotion");

  const c = await call("POST", "/api/admin/promotions", { body: { name: "Winter", promoId: "winter", templateId: "builtin-promotion-scenes", schedule: { type: "annual", from: "06-01", to: "08-31" } } });
  assert.equal(c.status, 201);
  assert.deepEqual(c.body.schedule, { type: "annual", from: "06-01", to: "08-31" });

  const none = await call("PATCH", `/api/admin/promotions/${morning.id}`, { body: { schedule: { type: "none" } } });
  assert.equal(none.body.schedule, undefined, "No schedule removes the dates");
  assert.equal((await screen()).schedule, undefined);

  for (const bad of [{ type: "weekly" }, { type: "annual", from: "13-01", to: "01-01" }, { type: "annual", from: "02-30", to: "03-01" }, { type: "annual", from: "01-01" }, "annual"]) {
    assert.equal((await call("PATCH", `/api/admin/promotions/${morning.id}`, { body: { schedule: bad } })).status, 400, JSON.stringify(bad));
  }
});

// ── audit, versions, uploads, validation ────────────────────────────────

test("every write is audit-logged with who, what and which fields", async () => {
  const { call } = setup();
  const { ph, morning } = await seedBasics(call);
  await call("PATCH", `/api/admin/pharmacies/${ph.id}`, { body: { name: "B2" } });
  await call("PUT", `/api/admin/pharmacies/${ph.id}/content/${morning.id}`, { body: { greeting: "Hi" } });
  await call("PUT", `/api/admin/pharmacies/${ph.id}/logo`, { body: PNG, headers: { "content-type": "image/png" } });
  await call("DELETE", `/api/admin/pharmacies/${ph.id}/logo`);
  const t = (await call("POST", "/api/admin/templates/builtin-promotion-scenes/clone", { body: { name: "T" } })).body;
  await call("PATCH", `/api/admin/templates/${t.id}`, { body: { css: "a{}" } });
  await call("PUT", `/api/admin/templates/${t.id}/backgrounds/landscape`, { body: PNG, headers: { "content-type": "image/png" } });
  await call("DELETE", `/api/admin/templates/${t.id}/backgrounds/landscape`);
  await call("DELETE", `/api/admin/templates/${t.id}`);
  const s = (await call("POST", "/api/admin/services", { body: { label: "S" } })).body;
  await call("PATCH", `/api/admin/services/${s.id}`, { body: { label: "S2" } });
  await call("DELETE", `/api/admin/services/${s.id}`);
  await call("PATCH", `/api/admin/promotions/${morning.id}`, { body: { name: "M2" } });
  await call("DELETE", `/api/admin/promotions/${morning.id}`);
  await call("DELETE", `/api/admin/pharmacies/${ph.id}`);
  // Refused writes are not logged.
  await call("PATCH", `/api/admin/pharmacies/${ph.id}`, { auth: VIEWER, body: { name: "x" } });

  const audit = (await call("GET", "/api/admin/audit", { query: { limit: "100" } })).body;
  const actions = audit.map((a) => `${a.entity}:${a.action}`).reverse();
  assert.deepEqual(actions, [
    "pharmacy:create", "promotion:create", "pharmacy:update", "pharmacy:update", "pharmacy:upload", "pharmacy:remove-media",
    "template:clone", "template:update", "template:upload", "template:remove-media", "template:delete",
    "service:create", "service:update", "service:delete", "promotion:update", "promotion:delete", "pharmacy:delete",
  ]);
  assert.ok(audit.every((a) => a.actorUid === "u-admin" && a.at), "actor and time on every entry");
  const rename = audit.find((a) => a.entity === "pharmacy" && a.action === "update" && a.changedFields.includes("name"));
  assert.deepEqual(rename.changedFields, ["name"]);
  assert.equal(rename.before.name, "Beaumaris Pharmacy");
  assert.equal(rename.after.name, "B2");
  const contentEdit = audit.find((a) => a.promotionId === morning.id);
  assert.match(contentEdit.after.content[morning.id], /^sha256:/, "content summarised, not copied");
  const byEntity = (await call("GET", "/api/admin/audit", { query: { entity: "service" } })).body;
  assert.equal(byEntity.length, 3);
});

test("optimistic concurrency: a stale version is refused with 409", async () => {
  const { call } = setup();
  const { ph } = await seedBasics(call);
  assert.equal((await call("PATCH", `/api/admin/pharmacies/${ph.id}`, { body: { name: "A" }, headers: { "if-match": "\"1\"" } })).status, 200);
  const stale = await call("PATCH", `/api/admin/pharmacies/${ph.id}`, { body: { name: "B" }, headers: { "if-match": "1" } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, "version-conflict");
  assert.equal((await call("PATCH", `/api/admin/pharmacies/${ph.id}`, { body: { name: "C", expectedVersion: 2 } })).status, 200);
  assert.equal((await call("GET", `/api/admin/pharmacies/${ph.id}`)).body.name, "C");
});

test("uploads: logo and backgrounds go to object storage; old objects removed; bad files refused", async () => {
  const { call, blobs } = setup();
  const { ph } = await seedBasics(call);
  const up = await call("PUT", `/api/admin/pharmacies/${ph.id}/logo`, { body: PNG, headers: { "content-type": "image/png" } });
  assert.equal(up.status, 200);
  const first = up.body.logo.path;
  assert.ok(first.startsWith("pharmacyScreen/media/logos/"));
  assert.ok(blobs.objects.has(first));
  const up2 = await call("PUT", `/api/admin/pharmacies/${ph.id}/logo`, { body: PNG2, headers: { "content-type": "image/png" } });
  assert.ok(blobs.objects.has(up2.body.logo.path));
  assert.ok(!blobs.objects.has(first), "replaced logo deleted");

  assert.equal((await call("PUT", `/api/admin/pharmacies/${ph.id}/logo`, { body: Buffer.from("<svg onload=alert(1)>"), headers: { "content-type": "image/svg+xml" } })).status, 415, "SVG refused");
  assert.equal((await call("PUT", `/api/admin/pharmacies/${ph.id}/logo`, { body: Buffer.from("GIF89a-not-a-png"), headers: { "content-type": "image/png" } })).status, 400, "content must match its type");
  assert.equal((await call("PUT", `/api/admin/pharmacies/${ph.id}/logo`, { body: Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]), headers: { "content-type": "image/png" } })).status, 413);
  assert.equal((await call("PUT", "/api/admin/pharmacies/nope/logo", { body: PNG, headers: { "content-type": "image/png" } })).status, 404);

  // Template backgrounds; a clone shares the object until one is replaced.
  const t = (await call("POST", "/api/admin/templates/builtin-promotion-scenes/clone", { body: { name: "T" } })).body;
  const bg = await call("PUT", `/api/admin/templates/${t.id}/backgrounds/portrait`, { body: PNG, headers: { "content-type": "image/png" } });
  assert.equal(bg.status, 200);
  const bgPath = bg.body.backgrounds.portrait.path;
  const t2 = (await call("POST", `/api/admin/templates/${t.id}/clone`)).body;
  assert.equal(t2.backgrounds.portrait.path, bgPath);
  await call("DELETE", `/api/admin/templates/${t.id}`);
  assert.ok(blobs.objects.has(bgPath), "still used by the clone, so kept");
  await call("DELETE", `/api/admin/templates/${t2.id}/backgrounds/portrait`);
  assert.ok(!blobs.objects.has(bgPath), "deleted once nothing uses it");
  assert.equal((await call("PUT", `/api/admin/templates/${t2.id}/backgrounds/sideways`, { body: PNG, headers: { "content-type": "image/png" } })).status, 404);

  await call("DELETE", `/api/admin/pharmacies/${ph.id}`);
  assert.ok(!blobs.objects.has(up2.body.logo.path), "pharmacy delete removes its logo");
});

test("validation: bad input is a 400 with a reason, unsafe markup refused", async () => {
  const { call } = setup();
  const { ph, morning } = await seedBasics(call);
  const cases = [
    ["POST", "/api/admin/pharmacies", { ...beaumaris, storeCode: "VIC-MP-009", colours: { primary: "red", accent: "#000000" } }],
    ["POST", "/api/admin/pharmacies", { ...beaumaris, storeCode: "bad code!" }],
    ["POST", "/api/admin/pharmacies", { storeCode: "VIC-MP-009", colours: beaumaris.colours }],
    ["PUT", `/api/admin/pharmacies/${ph.id}/content/${morning.id}`, { greeting: "<script>alert(1)</script>" }],
    ["PUT", `/api/admin/pharmacies/${ph.id}/content/${morning.id}`, { scenes: [{ headline: "<img src=x onerror=alert(1)>" }] }],
    ["PUT", `/api/admin/pharmacies/${ph.id}/content/${morning.id}`, { link: "javascript:alert(1)" }],
    ["POST", "/api/admin/templates", { name: "X", kind: "promotion-scenes", html: "<iframe src=//evil></iframe>" }],
    ["POST", "/api/admin/templates", { name: "X", kind: "promotion-scenes", css: "@import url(//evil.css);" }],
    ["POST", "/api/admin/templates", { name: "X", kind: "promotion-scenes", css: "</style><script>x</script>" }],
  ];
  for (const [method, path, body] of cases) {
    const r = await call(method, path, { body });
    assert.equal(r.status, 400, `${method} ${path} ${JSON.stringify(body)}`);
    assert.equal(r.body.error.code, "invalid-request");
    assert.ok(r.body.error.message.length > 5);
  }
  // Copy with ordinary characters is fine.
  assert.equal((await call("PUT", `/api/admin/pharmacies/${ph.id}/content/${morning.id}`, { body: { headline: "Buy one = get one <b>free</b> <span class=\"accent\">today</span>" } })).status, 200);
  assert.equal((await call("PUT", `/api/admin/pharmacies/${ph.id}/content/nope`, { body: {} })).status, 404, "content only for a real promotion");
  assert.equal((await call("POST", "/api/admin/pharmacies", { body: "not json", headers: { "content-type": "text/plain" } })).status, 415);
  assert.equal((await call("GET", "/api/admin/nothing-here")).status, 404);
  assert.equal((await call("GET", `/api/admin/pharmacies/${ph.id}%2Fx%2Fy`)).status, 404, "encoded slash in an id");
  assert.equal((await call("GET", "/api/admin/pharmacies/%E0%A4%A")).status, 404, "malformed escape");
});

test("CORS: admin routes answer only allowed origins; preflight works", async () => {
  const { call } = setup();
  const ok = await call("GET", "/api/admin/pharmacies", { headers: { origin: "https://admin.example.com" } });
  assert.equal(ok.headers["Access-Control-Allow-Origin"], "https://admin.example.com");
  const other = await call("GET", "/api/admin/pharmacies", { headers: { origin: "https://evil.example" } });
  assert.equal(other.headers["Access-Control-Allow-Origin"], undefined);
  const pre = await call("OPTIONS", "/api/admin/pharmacies", { auth: null, headers: { origin: "https://admin.example.com" } });
  assert.equal(pre.status, 204);
  assert.match(pre.headers["Access-Control-Allow-Headers"], /Authorization/);
  assert.equal(ok.headers["Cache-Control"], "no-store");
});

test("a function URL without the /api prefix routes the same", async () => {
  const { call } = setup();
  await seedBasics(call);
  assert.equal((await call("GET", "/screens/VIC-MP-001", { auth: null })).status, 200);
  assert.equal((await call("GET", "/admin/pharmacies")).status, 200);
});

test("an Occasions promotion: picking an occasion is its template, and the published config says which", async () => {
  const { call } = setup();
  const { ph } = await seedBasics(call);
  const occ = (await call("POST", "/api/admin/promotions", { body: { name: "Occasions", promoId: "occasions", templateId: "builtin-occasion-christmas" } })).body;
  const copy = { occasions: { easter: { scenes: [{ title: "Happy Easter,<br>${Suburb}" }, { title: "M" }, { title: "S" }] } } };
  assert.equal((await call("PUT", `/api/admin/pharmacies/${ph.id}/content/${occ.id}`, { body: copy })).status, 200);
  let cfg = (await call("GET", "/api/screens/VIC-MP-001", { auth: null })).body;
  // Published as the fallback: the screen plays a running "Activate on display", else the season whose dates hold
  // the store's date, else the fallback (js/render.js liveOccasion).
  assert.deepEqual([cfg.promotions.occasions.template.id, cfg.promotions.occasions.template.kind, cfg.promotions.occasions.template.occasion], ["builtin-occasion-fallback", "occasion", "fallback"]);
  // The old Season pick no longer moves a screen, and is not published.
  const mine = (await call("GET", `/api/admin/pharmacies/${ph.id}`)).body.content[occ.id];
  assert.equal((await call("PUT", `/api/admin/pharmacies/${ph.id}/content/${occ.id}`, { body: { ...mine, season: "easter" } })).status, 200);
  cfg = (await call("GET", "/api/screens/VIC-MP-001", { auth: null })).body;
  assert.equal(cfg.promotions.occasions.template.occasion, "fallback");
  assert.equal(cfg.promotions.occasions.content.season, undefined);
  assert.equal(cfg.promotions.occasions.content.occasions.easter.scenes[0].title, "Happy Easter,<br>${Suburb}");
  // "Activate on display" is published with the content; a malformed one is left out.
  const act = { occasion: "christmas", until: "2026-12-27" };
  assert.equal((await call("PUT", `/api/admin/pharmacies/${ph.id}/content/${occ.id}`, { body: { ...mine, activation: act } })).status, 200);
  cfg = (await call("GET", "/api/screens/VIC-MP-001", { auth: null })).body;
  assert.deepEqual(cfg.promotions.occasions.content.activation, act);
  // While it runs (the publish is dated 20 Nov 2026) the template is the activated season too, so a screen still on
  // a player from before Activate on display, which plays the template's season, shows it as well.
  assert.deepEqual([cfg.promotions.occasions.template.id, cfg.promotions.occasions.template.occasion], ["builtin-occasion-christmas", "christmas"]);
  // Over (its last day before the publish date): published as the fallback again.
  assert.equal((await call("PUT", `/api/admin/pharmacies/${ph.id}/content/${occ.id}`, { body: { ...mine, activation: { occasion: "easter", until: "2026-11-19" } } })).status, 200);
  cfg = (await call("GET", "/api/screens/VIC-MP-001", { auth: null })).body;
  assert.equal(cfg.promotions.occasions.template.occasion, "fallback");
  // Its last day is still running.
  assert.equal((await call("PUT", `/api/admin/pharmacies/${ph.id}/content/${occ.id}`, { body: { ...mine, activation: { occasion: "easter", until: "2026-11-20" } } })).status, 200);
  cfg = (await call("GET", "/api/screens/VIC-MP-001", { auth: null })).body;
  assert.equal(cfg.promotions.occasions.template.occasion, "easter");
  for (const bad of [{ occasion: "halloween", until: "2026-12-27" }, { occasion: "christmas", until: "12-27" }, "christmas"]) {
    assert.equal((await call("PUT", `/api/admin/pharmacies/${ph.id}/content/${occ.id}`, { body: { ...mine, activation: bad } })).status, 200);
    cfg = (await call("GET", "/api/screens/VIC-MP-001", { auth: null })).body;
    assert.equal(cfg.promotions.occasions.content.activation, undefined, JSON.stringify(bad));
    assert.equal(cfg.promotions.occasions.template.occasion, "fallback", JSON.stringify(bad));
  }
  // The promotion's own template moves no existing store either.
  assert.equal((await call("PATCH", `/api/admin/promotions/${occ.id}`, { body: { templateId: "builtin-occasion-anzac-day" } })).status, 200);
  cfg = (await call("GET", "/api/screens/VIC-MP-001", { auth: null })).body;
  assert.equal(cfg.promotions.occasions.template.occasion, "fallback");
});

test("master template: a promotion's master is inherited section by section; detached sections are the pharmacy's own", async () => {
  const { call } = setup();
  const { ph, morning } = await seedBasics(call);
  const own = { greeting: "Hi, ${Suburb}", introTitle: "Own intro", introSub: "Own sub", slots: [{ label: "Own", title: "Own slot" }], close: { title: "Own close" }, custom: "kept" };
  await call("PUT", `/api/admin/pharmacies/${ph.id}/content/${morning.id}`, { body: own });
  const screen = async () => (await call("GET", "/api/screens/VIC-MP-001?promo=morning", { auth: null })).body.promotions.morning.content;
  // No master yet: the pharmacy's own content, as before.
  assert.equal((await screen()).introTitle, "Own intro");

  const master = { greeting: "Good morning, ${Suburb}", introTitle: "Master intro", introSub: "Master sub", slots: [{ label: "BP", title: "Blood pressure" }], close: { title: "Walk in today" }, footer: { show: false } };
  const r = await call("PATCH", `/api/admin/promotions/${morning.id}`, { body: { master } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.master, master);
  // A name change keeps the master.
  assert.deepEqual((await call("PATCH", `/api/admin/promotions/${morning.id}`, { body: { name: "Mornings" } })).body.master, master);
  // Every section inherited; a field in no section stays the pharmacy's.
  let c = await screen();
  assert.equal(c.introTitle, "Master intro");
  assert.deepEqual(c.slots, master.slots);
  assert.deepEqual(c.footer, { show: false });
  assert.equal(c.custom, "kept");

  // Detach the greeting and the slots: the pharmacy's own copies play; the rest still follows the master.
  const d = await call("PATCH", `/api/admin/pharmacies/${ph.id}`, { body: { detached: { [morning.id]: ["slots", "greeting", "slots"] } } });
  assert.equal(d.status, 200);
  assert.deepEqual(d.body.detached, { [morning.id]: ["greeting", "slots"] });
  c = await screen();
  assert.deepEqual([c.greeting, c.introTitle, c.introSub, c.slots[0].label, c.close.title], ["Hi, ${Suburb}", "Own intro", "Own sub", "Own", "Walk in today"]);
  await call("PATCH", `/api/admin/promotions/${morning.id}`, { body: { master: { ...master, introTitle: "Changed", close: { title: "Changed close" } } } });
  c = await screen();
  assert.equal(c.introTitle, "Own intro", "a detached section is not reached by master changes");
  assert.equal(c.close.title, "Changed close", "an inherited one is");
  // Saving content keeps the detached list; a detached section without its own copy drops out (template default).
  await call("PUT", `/api/admin/pharmacies/${ph.id}/content/${morning.id}`, { body: { greeting: "Hey" } });
  assert.deepEqual((await call("GET", `/api/admin/pharmacies/${ph.id}`)).body.detached, { [morning.id]: ["greeting", "slots"] });
  c = await screen();
  assert.equal(c.greeting, "Hey");
  assert.equal(c.slots, undefined);
  // Back to the master for everything: the field disappears from the record.
  const back = await call("PATCH", `/api/admin/pharmacies/${ph.id}`, { body: { detached: {} } });
  assert.equal(back.body.detached, undefined);
  assert.equal((await screen()).introTitle, "Changed");
  // Removing the master returns to the pharmacy's own content.
  assert.equal((await call("PATCH", `/api/admin/promotions/${morning.id}`, { body: { master: null } })).body.master, undefined);
  assert.equal((await screen()).greeting, "Hey");

  // Validation: unknown sections, bad shapes and unsafe markup are refused.
  assert.equal((await call("PATCH", `/api/admin/pharmacies/${ph.id}`, { body: { detached: { [morning.id]: ["logo"] } } })).status, 400);
  assert.equal((await call("PATCH", `/api/admin/pharmacies/${ph.id}`, { body: { detached: { [morning.id]: "greeting" } } })).status, 400);
  assert.equal((await call("PATCH", `/api/admin/promotions/${morning.id}`, { body: { master: [] } })).status, 400);
  assert.equal((await call("PATCH", `/api/admin/promotions/${morning.id}`, { body: { master: { greeting: "<script>x</script>" } } })).status, 400);
  // The admin-only fields never reach the public view.
  const pub = (await call("GET", "/api/screens/VIC-MP-001", { auth: null })).body;
  assert.ok(!("detached" in pub) && !("master" in pub.promotions.morning));
});

test("tokens set by hand: saved on the pharmacy, published to its screens, blank values cleared, slots refused", async () => {
  const { call } = setup();
  const { ph } = await seedBasics(call);
  const pub = async () => (await call("GET", "/api/screens/VIC-MP-001", { auth: null })).body;
  assert.ok(!("tokens" in (await pub())), "no tokens: the published config keeps its earlier shape");

  const r = await call("PATCH", `/api/admin/pharmacies/${ph.id}`, { body: { tokens: { Suburb: "  Beaumaris ", Website: "mipharmacy.example", Phone: "" } } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.tokens, { Suburb: "Beaumaris", Website: "mipharmacy.example" }, "trimmed; blank values dropped");
  assert.deepEqual((await pub()).tokens, { Suburb: "Beaumaris", Website: "mipharmacy.example" });
  // Another field's save keeps them.
  assert.deepEqual((await call("PATCH", `/api/admin/pharmacies/${ph.id}`, { body: { name: "Renamed" } })).body.tokens, { Suburb: "Beaumaris", Website: "mipharmacy.example" });

  // Validation: template slots, bad names, non-text and over-long values are refused.
  for (const tokens of [{ Headline: "x" }, { "my token": "x" }, { "1st": "x" }, { Suburb: 5 }, { Suburb: "x".repeat(201) }, ["Suburb"]]) {
    assert.equal((await call("PATCH", `/api/admin/pharmacies/${ph.id}`, { body: { tokens } })).status, 400, JSON.stringify(tokens).slice(0, 40));
  }
  // ${StoreName} (the pharmacy name) and ${CloseTime} / ${OpenTime} (today's hours) are filled live: a value sent
  // for one, or stored before that rule, is dropped rather than refused, so an older record still saves.
  const live = await call("PATCH", `/api/admin/pharmacies/${ph.id}`, { body: { tokens: { Suburb: "Beaumaris", StoreName: "Set Name", CloseTime: "9PM", OpenTime: "8AM" } } });
  assert.equal(live.status, 200);
  assert.deepEqual(live.body.tokens, { Suburb: "Beaumaris" });
  assert.deepEqual((await pub()).tokens, { Suburb: "Beaumaris" });
  // Clearing every value removes the field from the record and the published config.
  const back = await call("PATCH", `/api/admin/pharmacies/${ph.id}`, { body: { tokens: {} } });
  assert.equal(back.body.tokens, undefined);
  assert.ok(!("tokens" in (await pub())));
});

test("screen read endpoint: an ETag lets a poll that finds nothing new cost a 304 with no body", async () => {
  const { call } = setup();
  const { ph } = await seedBasics(call);
  const first = await call("GET", "/api/screens/VIC-MP-001", { auth: null });
  assert.equal(first.status, 200);
  assert.match(first.headers.ETag, /^"[A-Za-z0-9_-]{27}"$/);
  assert.equal(first.headers["Cache-Control"], "public, max-age=5");
  const same = await call("GET", "/api/screens/VIC-MP-001", { auth: null, headers: { "if-none-match": first.headers.ETag } });
  assert.equal(same.status, 304);
  assert.equal(same.body, null);
  assert.equal(same.headers.ETag, first.headers.ETag);
  // A CDN's weak form of the same tag matches too.
  assert.equal((await call("GET", "/api/screens/VIC-MP-001", { auth: null, headers: { "if-none-match": `W/${first.headers.ETag}, "other"` } })).status, 304);
  // An edit changes the tag, so the next poll gets the new config.
  await call("PATCH", `/api/admin/pharmacies/${ph.id}`, { body: { name: "Beaumaris Chemist" } });
  const after = await call("GET", "/api/screens/VIC-MP-001", { auth: null, headers: { "if-none-match": first.headers.ETag } });
  assert.equal(after.status, 200);
  assert.notEqual(after.headers.ETag, first.headers.ETag);
  assert.equal(after.body.name, "Beaumaris Chemist");
  // Admin answers are never cacheable and carry no tag.
  const admin = await call("GET", "/api/admin/pharmacies");
  assert.equal(admin.headers["Cache-Control"], "no-store");
  assert.equal(admin.headers.ETag, undefined);
});

test("template HTML: an event handler hidden behind a quoted '>' is refused; ordinary copy and markup are not", async () => {
  const { call } = setup();
  const clone = (await call("POST", "/api/admin/templates/builtin-promotion-scenes/clone", { body: { name: "Mine" } })).body;
  for (const html of ['<img title=">" src=x onerror=alert(1)>', "<div title='>' onclick=x()>a</div>", '<svg><a title=">"\nonmouseover=x()>', '<p title="a" ONLOAD = "x">']) {
    const res = await call("PATCH", `/api/admin/templates/${clone.id}`, { body: { html } });
    assert.equal(res.status, 400, html);
  }
  for (const html of ['<div class="s-top"><h2>Buy one = get one</h2><p title="a > b">only = this</p></div>', '<svg viewBox="0 0 10 10"><path d="M0 0"/></svg>']) {
    const res = await call("PATCH", `/api/admin/templates/${clone.id}`, { body: { html } });
    assert.equal(res.status, 200, html);
  }
});

// ── public endpoint abuse limits and CSP reports ────────────────────────

function limitedApi({ limit, logs = [] } = {}) {
  let t = Date.parse("2026-11-23T00:00:00Z");
  const api = createConfigApi({
    store: createMemoryStore(),
    blobs: createMemoryBlobs(),
    auth: createStaticAuth({}),
    log: (level, msg) => logs.push(`${level} ${msg}`),
    screensPerClientLimit: limit,
    clock: () => t,
  });
  return { api, logs, advance: (ms) => { t += ms; } };
}

test("screen read: a per-client limit per minute; 429 is never cached; other clients and a new minute are unaffected", async () => {
  const { api, advance } = limitedApi({ limit: 5 });
  const get = (code, ip) => api.handle({ method: "GET", path: `/api/screens/${code}`, headers: {}, query: {}, ip });
  const codes = [];
  for (let i = 0; i < 7; i++) codes.push((await get(`GUESS-${i}`, "203.0.113.9")).status);
  assert.deepEqual(codes, [404, 404, 404, 404, 404, 429, 429]);
  const r = await get("GUESS-9", "203.0.113.9");
  assert.equal(r.body.error.code, "rate-limited");
  assert.equal(r.headers["Cache-Control"], "no-store");
  assert.ok(Number(r.headers["Retry-After"]) >= 1);
  assert.equal((await get("GUESS-1", "198.51.100.4")).status, 404, "another address");
  assert.equal((await get("GUESS-1")).status, 404, "no address passed (local dev servers): not limited");
  assert.equal((await api.handle({ method: "GET", path: "/api/health", headers: {}, query: {}, ip: "203.0.113.9" })).status, 200, "only /api/screens/** is limited");
  advance(60000);
  assert.equal((await get("GUESS-1", "203.0.113.9")).status, 404, "a new minute");
});

test("the screen read's client address follows the proxy's rule (src/rate-limit.js = ph-proxy/src/client-ip.js)", () => {
  const { clientIpFromHeaders } = require("../src/rate-limit");
  const twin = require("../../ph-proxy/src/client-ip").clientIpFromHeaders;
  const cases = [
    [{ "x-forwarded-for": "1.2.3.4, 203.0.113.9" }, {}],
    [{ "x-forwarded-for": "6.6.6.6, 203.0.113.9, 35.1.1.1" }, { trustedHops: 2 }],
    [{ "x-forwarded-for": "203.0.113.9" }, { trustedHops: 2 }],
    [{}, { fallback: "169.254.1.1" }],
    [{ "x-forwarded-for": " , " }, {}],
    [{ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }, { trustedHops: "junk" }],
  ];
  for (const [h, o] of cases) assert.equal(clientIpFromHeaders(h, o), twin(h, o), JSON.stringify(h));
  const index = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "index.js"), "utf8");
  assert.match(index, /clientIpFromHeaders\(req\.headers/, "index.js keys the limit on the trusted address");
});

test("CSP reports: 204 always; one short, sanitised log line per violation; extensions and junk ignored; rate limited", async () => {
  const { api, logs } = limitedApi({ limit: 0 });
  const post = (body, type = "application/csp-report", ip = "203.0.113.9") =>
    api.handle({ method: "POST", path: "/api/csp-report", headers: { "content-type": type }, query: {}, body: Buffer.from(typeof body === "string" ? body : JSON.stringify(body)), ip });
  const report = {
    "csp-report": {
      "document-uri": "https://screens.example.com/pharmacy-screen.html?device=DEV-SECRET-1&promo=morning",
      "effective-directive": "script-src-elem",
      "blocked-uri": "https://evil.example.com/x.js?token=abc",
      "source-file": "https://screens.example.com/assets/js/player.0123456789.js",
      "line-number": 42,
      disposition: "report",
    },
  };
  const r = await post(report);
  assert.equal(r.status, 204);
  assert.equal(r.body, null);
  assert.equal(r.headers["Cache-Control"], "no-store");
  assert.equal(logs.length, 1);
  assert.equal(logs[0], "warn [csp] report script-src-elem blocked https://evil.example.com on /pharmacy-screen.html at /assets/js/player.0123456789.js:42");
  assert.doesNotMatch(logs[0], /DEV-SECRET|token=/, "no query strings logged");
  // The Reporting API's shape.
  await post([{ type: "csp-violation", body: { documentURL: "https://s.example/admin/", effectiveDirective: "connect-src", blockedURL: "https://x.example/a", disposition: "report" } }, { type: "deprecation", body: {} }], "application/reports+json");
  assert.equal(logs.at(-1), "warn [csp] report connect-src blocked https://x.example on /admin/");
  assert.equal(logs.length, 2);
  // Extensions, junk and oversized bodies: 204, nothing logged.
  assert.equal((await post({ "csp-report": { "blocked-uri": "chrome-extension://abc/x.js", "effective-directive": "script-src" } })).status, 204);
  assert.equal((await post("not json")).status, 204);
  assert.equal((await post({ "csp-report": { "blocked-uri": "x".repeat(9000) } })).status, 204);
  assert.equal(logs.length, 2);
  await post({ "csp-report": { "blocked-uri": "inline", "effective-directive": "script-src-elem\u0000\n", "document-uri": "https://s.example/admin/" } });
  assert.equal(logs.at(-1), "warn [csp] report script-src-elem?? blocked inline on /admin/");
  // Per client: 30 a minute are logged, the rest still get 204.
  for (let i = 0; i < 40; i++) assert.equal((await post(report, undefined, "198.51.100.7")).status, 204);
  assert.equal(logs.filter((l) => l.includes("evil.example")).length, 1 + 30);
  assert.equal((await api.handle({ method: "GET", path: "/api/csp-report", headers: {}, query: {} })).status, 405);
  const pre = await api.handle({ method: "OPTIONS", path: "/api/csp-report", headers: {}, query: {} });
  assert.equal(pre.headers["Access-Control-Allow-Methods"], "POST, OPTIONS");
});

test("the screen read's default limit fits a shared-address estate: 600 a minute everywhere it is set", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const root = path.join(__dirname, "..", "..", "..");
  const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
  // A screen asks every 15 s (js/live-data.js CONFIG_POLL_MS), so 600 is about 150 screens behind one address.
  assert.match(read("pharmacy-screen/js/live-data.js"), /CONFIG_POLL_MS = 15000;/);
  for (const p of ["pharmacy-screen/config-api/index.js", "aws/lambda/config-api.js"]) {
    assert.match(read(p), /count\(env\.PS_RATE_LIMIT_SCREENS_PER_IP_PER_MIN, 600\)/, p);
  }
  assert.match(read(".env.example"), /^PS_RATE_LIMIT_SCREENS_PER_IP_PER_MIN=600$/m);
  assert.match(read("docs/CONFIGURATION.md"), /\| `PS_RATE_LIMIT_SCREENS_PER_IP_PER_MIN` \|[^\n]*\| `600` \| `600` \|/);
});

test("Sales Promos: a built-in that can't be deleted or re-pointed; the sale template is its own; its copy is checked and published", async () => {
  const { call } = setup();
  const ph = (await call("POST", "/api/admin/pharmacies", { body: beaumaris })).body;
  // The sale template is reserved for promo ID sale.
  assert.equal((await call("POST", "/api/admin/promotions", { body: { name: "Clearance", promoId: "clearance", templateId: "builtin-sale" } })).status, 400);
  const master = { sale: { headline1: "BIG BRAND", headline2: "SALE", brands: ["TOSHI", "NATIO"], value: 30, endDate: "2026-12-02" } };
  const sale = (await call("POST", "/api/admin/promotions", { body: { name: "Sales Promos", promoId: "sale", templateId: "builtin-sale", master } })).body;
  assert.equal(sale.templateId, "builtin-sale");
  // Its promo ID and template stay; its name can change.
  const moved = await call("PATCH", `/api/admin/promotions/${sale.id}`, { body: { promoId: "sales" } });
  assert.equal(moved.status, 409);
  assert.equal(moved.body.error.code, "builtin-promotion");
  assert.equal((await call("PATCH", `/api/admin/promotions/${sale.id}`, { body: { templateId: "builtin-promotion-scenes" } })).status, 409);
  const renamed = await call("PATCH", `/api/admin/promotions/${sale.id}`, { body: { name: "Sales" } });
  assert.equal(renamed.status, 200);
  // It can't be deleted.
  const del = await call("DELETE", `/api/admin/promotions/${sale.id}`);
  assert.equal(del.status, 409);
  assert.match(del.body.error.message, /built-in promotion and can't be deleted/);
  // A pharmacy with no sale copy of its own publishes the master's; its own copy, once saved, wins.
  let pub = (await call("GET", "/api/screens/VIC-MP-001", { auth: null })).body;
  assert.equal(pub.promotions.sale.template.kind, "sale");
  assert.deepEqual(pub.promotions.sale.content.sale.brands, ["TOSHI", "NATIO"]);
  const own = { sale: { ...master.sale, value: 25, brands: ["CETAPHIL"], endDate: "2026-12-09" } };
  assert.equal((await call("PUT", `/api/admin/pharmacies/${ph.id}/content/${sale.id}`, { body: own })).status, 200);
  pub = (await call("GET", "/api/screens/VIC-MP-001", { auth: null })).body;
  assert.deepEqual([pub.promotions.sale.content.sale.value, pub.promotions.sale.content.sale.brands, pub.promotions.sale.content.sale.endDate], [25, ["CETAPHIL"], "2026-12-09"]);
  // Bad copy is refused: a date that doesn't exist, an offer out of range, too many brands.
  const put = (body) => call("PUT", `/api/admin/pharmacies/${ph.id}/content/${sale.id}`, { body });
  for (const bad of [{ endDate: "2026-02-30" }, { endDate: "2 Dec" }, { value: 0 }, { value: 100 }, { value: 12.5 }, { brands: [] }, { brands: ["A", "B", "C", "D", "E", "F", "G"] }, { brands: ["X".repeat(31)] }, { s1: 0 }, { footer: { line1: "x" } }]) {
    const r = await put({ sale: { ...master.sale, ...bad } });
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
});
