"use strict";

// The seed against the in-memory adapters (no network). Covers the ticket's
// test steps:
//   1. an empty store gets five pharmacies, four promotions (Occasions on Christmas), eight built-in
//      templates (two plus six occasions) and 28 services
//   2. a second run creates no duplicates and changes nothing
//   3. an edited pharmacy survives a re-run without --reset (and --reset puts it back)
// plus the fixtures themselves: they match the concept prototype data the
// screen page already plays (fixtures/config.json) and the mock Location API
// data (fixtures/campaign-data.json).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { seedConfig, loadFixtures, campaignDataFor, summarise, parseArgs, upgradeTimings, ids } = require("../seed");
const { createMemoryStore } = require("../../config-api/src/adapters/memory-store");
const { createMemoryBlobs } = require("../../config-api/src/adapters/blobs");
const { createConfigService } = require("../../config-api/src/service");

const CODES = ["VIC-MP-001", "VIC-MP-002", "VIC-MP-003", "VIC-MP-004", "VIC-MP-005"];

function setup() {
  const store = createMemoryStore();
  const blobs = createMemoryBlobs();
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 10, 20, 0, 0, tick++)).toISOString();
  const svc = createConfigService({ store, blobs, now });
  return { store, blobs, now, svc, seed: (opts = {}) => seedConfig({ store, blobs, now, ...opts }) };
}

test("step 1: an empty store gets 5 pharmacies, 4 promotions, 8 templates, 28 services", async () => {
  const { store, blobs, svc, seed } = setup();
  const report = await seed();
  assert.deepEqual(report.pharmacies.created.sort(), CODES);
  assert.deepEqual(report.promotions.created, ["morning", "afternoon", "closed", "occasions"]);
  assert.equal(report.services.created.length, 28);
  assert.deepEqual(report.templates.builtIn, ["builtin-promotion-scenes", "builtin-opening-hours", ...["builtin-occasion-christmas", "builtin-occasion-new-year", "builtin-occasion-australia-day", "builtin-occasion-valentines-day", "builtin-occasion-easter", "builtin-occasion-anzac-day"]]);

  const pharmacies = await svc.listPharmacies();
  assert.deepEqual(pharmacies.map((p) => p.storeCode), CODES);
  assert.deepEqual(pharmacies.map((p) => p.name), [
    "Beaumaris Pharmacy",
    "North Ringwood Family Pharmacy",
    "Ocean Grove Terrace Pharmacy",
    "Vermont South Pharmacy",
    "O'Brien's Pharmacy",
  ]);
  const promotions = await svc.listPromotions();
  assert.deepEqual(promotions.map((p) => [p.promoId, p.name, p.templateId]).sort(), [
    ["afternoon", "Afternoon", "builtin-promotion-scenes"],
    ["closed", "Closed", "builtin-opening-hours"],
    ["morning", "Morning", "builtin-promotion-scenes"],
    ["occasions", "Seasonal", "builtin-occasion-christmas"],
  ]);
  const templates = await svc.listTemplates();
  assert.deepEqual(templates.map((t) => [t.name, t.builtIn]), [["Promotion scenes", true], ["Opening hours", true],
    ["Christmas", true], ["New Year's", true], ["Australia Day", true], ["Valentine's Day", true], ["Easter", true], ["Anzac Day", true]]);
  assert.equal((await svc.listServices()).length, 28);

  // Every pharmacy has its logo (WebP in the media store) and content for all four promotions,
  // and its published screen config carries them.
  for (const p of pharmacies) {
    assert.equal(p.logo.contentType, "image/webp");
    const obj = blobs.objects.get(p.logo.path);
    assert.ok(obj && obj.buffer.toString("ascii", 0, 4) === "RIFF" && obj.buffer.toString("ascii", 8, 12) === "WEBP", `${p.storeCode} logo is a WebP`);
    assert.deepEqual(p.promotionsWithContent, promotions.map((x) => x.id).sort());
    const screen = await svc.getScreenConfig(p.storeCode);
    assert.equal(screen.logo, p.logo.url);
    assert.deepEqual(Object.keys(screen.promotions), ["afternoon", "closed", "morning", "occasions"]);
    assert.deepEqual([screen.promotions.occasions.template.kind, screen.promotions.occasions.template.occasion], ["occasion", "christmas"]);
    assert.deepEqual(screen.promotions.occasions.content.occasions.christmas.beats[1], { label: "With warm wishes", text: "from the whole ${StoreName} team", dur: 4 });
    assert.ok(!/StoreName/.test(JSON.stringify(screen.promotions.occasions.content.occasions.easter)), "Easter signs off with the suburb only");
    assert.equal(screen.promotions.closed.template.kind, "opening-hours");
    assert.ok(screen.promotions.morning.content.greeting.startsWith("Good morning"));
    assert.ok(Array.isArray(screen.promotions.closed.content.headlines));
  }
  // Records sit under the seed's fixed ids, and the audit log names the seed.
  assert.ok(await store.get("pharmacies", ids.pharmacy("vic-mp-001")));
  assert.ok(await store.get("promotions", ids.promotion("morning")));
  assert.ok(await store.get("services", ids.service("vacc")));
  assert.ok((await svc.listAudit({ limit: 500 })).every((a) => a.actorUid === "seed"));
});

test("step 2: a second run makes no duplicates and no changes", async () => {
  const { store, seed } = setup();
  await seed();
  const before = store.dump();
  const report = await seed();
  assert.deepEqual(store.dump(), before, "nothing written, not even an audit entry");
  for (const k of ["pharmacies", "promotions", "services"]) {
    assert.equal(report[k].created.length, 0);
    assert.equal(report[k].updated.length, 0);
  }
  assert.equal(report.services.unchanged.length, 28);
  // --reset on an untouched store changes nothing either.
  await seed({ reset: true });
  assert.deepEqual(store.dump(), before);
});

test("step 3: an edit survives a re-run without --reset; --reset puts the fixture back", async () => {
  const { store, svc, seed } = setup();
  await seed();
  const actor = { uid: "u-admin", email: "admin@example.com", admin: true };
  const id = ids.pharmacy("vic-mp-002");
  const promoMorning = ids.promotion("morning");
  await svc.updatePharmacy(actor, id, { name: "North Ringwood Pharmacy & Clinic", colours: { accent: "#123456" } });
  await svc.setPharmacyContent(actor, id, promoMorning, { greeting: "Hello, ${Suburb}" });
  await svc.updatePromotion(actor, promoMorning, { name: "Breakfast" });
  await svc.updateService(actor, ids.service("bp"), { line2: "Edited copy" });
  await svc.removeLogo(actor, ids.pharmacy("vic-mp-003"));

  const edited = store.dump();
  const report = await seed();
  assert.deepEqual(store.dump(), edited, "a plain re-run keeps every edit");
  assert.equal(report.pharmacies.updated.length + report.pharmacies.created.length, 0);

  const reset = await seed({ reset: true });
  assert.deepEqual(reset.pharmacies.updated.sort(), ["VIC-MP-002", "VIC-MP-003"]);
  assert.deepEqual(reset.promotions.updated, ["morning"]);
  assert.deepEqual(reset.services.updated, ["bp"]);
  const ph = await svc.getPharmacy(id);
  assert.equal(ph.name, "North Ringwood Family Pharmacy");
  assert.deepEqual(ph.colours, { primary: "#035c2f", accent: "#f39a4a" });
  assert.ok(ph.content[promoMorning].greeting.startsWith("Good morning"));
  assert.ok((await svc.getPharmacy(ids.pharmacy("vic-mp-003"))).logo);
  assert.equal((await svc.getPromotion(promoMorning)).name, "Morning");
  assert.equal((await svc.getService(ids.service("bp"))).line2, "Walk-ins welcome");
  // and a second --reset is then a no-op
  const after = store.dump();
  await seed({ reset: true });
  assert.deepEqual(store.dump(), after);
});

test("records made by hand with the same natural key are not duplicated or overwritten", async () => {
  const { store, svc, seed } = setup();
  const actor = { uid: "u-admin", email: null, admin: true };
  await svc.createPromotion(actor, { name: "Mornings", promoId: "morning", templateId: "builtin-promotion-scenes" });
  await svc.createPharmacy(actor, { storeCode: "VIC-MP-001", name: "Beaumaris (hand made)", colours: { primary: "#000000", accent: "#ffffff" } });
  await svc.createService(actor, { label: "Blood pressure", headline: "Mine" });
  const report = await seed();
  assert.deepEqual(report.promotions.unchanged, ["morning"]);
  assert.deepEqual(report.pharmacies.unchanged, ["VIC-MP-001"]);
  assert.deepEqual(report.services.unchanged, ["bp"]);
  assert.equal((await svc.listPromotions()).length, 4);
  assert.equal((await svc.listPharmacies()).length, 5);
  assert.equal((await svc.listServices()).length, 28);
  assert.equal((await svc.listPharmacies()).find((p) => p.storeCode === "VIC-MP-001").name, "Beaumaris (hand made)");
  // Seeded pharmacies' morning content is stored under the hand-made promotion's id.
  const handMorning = (await svc.listPromotions()).find((p) => p.promoId === "morning").id;
  assert.ok((await svc.getPharmacy(ids.pharmacy("vic-mp-002"))).content[handMorning]);
});

test("fixtures: 28 services from the prototype, offered by the five launch store codes", () => {
  const f = loadFixtures();
  assert.equal(f.services.length, 28);
  assert.equal(new Set(f.services.map((s) => s.key)).size, 28);
  assert.equal(new Set(f.services.map((s) => s.label)).size, 28, "labels are unique (the natural key)");
  assert.deepEqual([...new Set(f.services.map((s) => s.category))].sort(), ["Care", "Health checks", "Medicines", "Prescriptions", "Shop", "Vaccinations"]);
  for (const s of f.services) {
    for (const k of ["label", "icon", "category", "headline", "accent", "line1", "line2"]) assert.ok(s[k], `${s.key}.${k}`);
    assert.ok(s.offeredBy.length > 0 && s.offeredBy.every((c) => CODES.includes(c)), `${s.key}.offeredBy`);
  }
  for (const code of CODES) assert.ok(f.services.some((s) => s.offeredBy.includes(code)), `${code} offers something`);
});

test("fixtures match the screen page's prototype data and the mock Location API data", () => {
  const f = loadFixtures();
  const screen = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "fixtures", "config.json"), "utf8"));
  assert.deepEqual(f.pharmacies.map((p) => p.storeCode).sort(), CODES);
  for (const p of f.pharmacies) {
    const s = screen.pharmacies.find((x) => x.storeCode === p.storeCode);
    assert.ok(s, `${p.storeCode} is in fixtures/config.json`);
    assert.equal(p.name, s.name);
    assert.deepEqual(p.colours, { primary: s.brand.p, accent: s.brand.a });
    assert.equal(`data:${p.logo.contentType};base64,${p.logo.bytes.toString("base64")}`, s.logo, `${p.storeCode} logo is the prototype's`);
    for (const promo of ["morning", "afternoon", "closed", "occasions"]) assert.deepEqual(p.content[promo], s.content[promo], `${p.storeCode} ${promo} content`);

    const cd = campaignDataFor(p.device, f);
    assert.ok(cd, `${p.device} has mock campaign_data`);
    assert.equal(cd.data.store_location.store_code, p.storeCode);
    assert.ok(cd.data.store_location.store_timezone);
    assert.ok(Array.isArray(cd.data.store_info.opening_hours) && cd.data.store_info.opening_hours.length > 0);
    assert.ok(cd.data.store_info.address_info && "suburb" in cd.data.store_info.address_info);
  }
  assert.equal(campaignDataFor("NO-SUCH-DEVICE", f), null);
  assert.deepEqual(f.promotions.map((p) => p.promoId), ["morning", "afternoon", "closed", "occasions"]);
});

test("a store seeded before Occasions existed gets the Occasions promotion and its content; a re-run is a no-op", async () => {
  const { store, svc, seed } = setup();
  const f = loadFixtures();
  // The launch seed: three promotions, no occasions content.
  const old = { ...f, promotions: f.promotions.filter((p) => p.promoId !== "occasions"), pharmacies: f.pharmacies.map((p) => { const { occasions: _o, ...content } = p.content; return { ...p, content }; }) };
  await seed({ fixtures: old });
  const edited = await svc.getPharmacy(ids.pharmacy("vic-mp-001"));
  const morningId = (await svc.listPromotions()).find((p) => p.promoId === "morning").id;
  edited.content[morningId].greeting = "Edited greeting";
  await svc.updatePharmacy({ uid: "u-admin", email: null, admin: true }, edited.id, { content: edited.content });

  const report = await seed();
  assert.deepEqual(report.promotions.created, ["occasions"]);
  assert.deepEqual(report.pharmacies.updated.sort(), CODES);
  const occ = (await svc.listPromotions()).find((p) => p.promoId === "occasions");
  assert.equal(occ.templateId, "builtin-occasion-christmas");
  for (const p of await svc.listPharmacies()) {
    const screen = await svc.getScreenConfig(p.storeCode);
    assert.equal(screen.promotions.occasions.template.occasion, "christmas");
    assert.ok(screen.promotions.occasions.content.occasions.christmas, `${p.storeCode} has occasions content`);
  }
  assert.equal((await svc.getPharmacy(ids.pharmacy("vic-mp-001"))).content[morningId].greeting, "Edited greeting", "other content untouched");

  const before = store.dump();
  const again = await seed();
  assert.equal(again.promotions.created.length + again.pharmacies.updated.length + again.pharmacies.created.length, 0);
  assert.deepEqual(store.dump(), before, "re-running is a no-op");
});

test("a promotion the seed made as Occasions is renamed Seasonal; a renamed one is left alone; a re-run is a no-op", async () => {
  const { store, svc, seed } = setup();
  const f = loadFixtures();
  // Seeded before the rename: the default promotion is called Occasions.
  const old = { ...f, promotions: f.promotions.map((p) => (p.key === "occasions" ? { ...p, name: "Occasions" } : p)) };
  await seed({ fixtures: old });
  assert.equal((await svc.listPromotions()).find((p) => p.promoId === "occasions").name, "Occasions");
  const report = await seed();
  assert.deepEqual(report.promotions.updated, ["occasions"]);
  const occ = (await svc.listPromotions()).find((p) => p.promoId === "occasions");
  assert.deepEqual([occ.name, occ.promoId, occ.templateId], ["Seasonal", "occasions", "builtin-occasion-christmas"]);
  const before = store.dump();
  assert.equal((await seed()).promotions.updated.length, 0);
  assert.deepEqual(store.dump(), before, "re-running is a no-op");
  // Renamed by hand to something else: kept.
  await svc.updatePromotion({ uid: "u-admin", email: null, admin: true }, occ.id, { name: "Holidays" });
  await seed();
  assert.equal((await svc.listPromotions()).find((p) => p.promoId === "occasions").name, "Holidays");
});

test("an environment seeded with the old occasion copy: seed-made records get the new defaults, edited copy is kept", async () => {
  const { store, svc, seed } = setup();
  const f = loadFixtures();
  const legacy = f.legacyOccasions;
  // What an earlier seed wrote: every occasion's old three-scene default copy, on the pharmacies and the master.
  const oldCopy = () => JSON.parse(JSON.stringify(legacy));
  const old = { ...f, pharmacies: f.pharmacies.map((p) => ({ ...p, content: { ...p.content, occasions: { occasions: oldCopy() } } })) };
  await seed({ fixtures: old });
  const occId = (await svc.listPromotions()).find((p) => p.promoId === "occasions").id;
  // Someone edits Easter on Beaumaris (still the old shape), and Christmas on the master.
  const ph = await svc.getPharmacy(ids.pharmacy("vic-mp-001"));
  ph.content[occId].occasions.easter.scenes[0].title = "Hoppy Easter";
  await svc.updatePharmacy({ uid: "u-admin", email: null, admin: true }, ph.id, { content: ph.content });
  const promo = (await svc.listPromotions()).find((p) => p.id === occId);
  const master = JSON.parse(JSON.stringify(promo.master));
  master.occasions.christmas.scenes[0].title = "Merry Xmas";
  await svc.updatePromotion({ uid: "u-admin", email: null, admin: true }, occId, { master });

  const report = await seed();
  assert.deepEqual(report.pharmacies.updated.sort(), CODES);
  assert.deepEqual(report.promotions.updated, ["occasions"]);
  const fresh = f.pharmacies[0].content.occasions.occasions;
  for (const p of await svc.listPharmacies()) {
    const occ = (await svc.getPharmacy(p.id)).content[occId].occasions;
    assert.deepEqual(occ.christmas, fresh.christmas, `${p.storeCode} christmas`);
    if (p.storeCode === "VIC-MP-001") assert.equal(occ.easter.scenes[0].title, "Hoppy Easter", "hand-edited copy is kept");
    else assert.deepEqual(occ.easter, fresh.easter, `${p.storeCode} easter`);
  }
  const m = (await svc.listPromotions()).find((p) => p.id === occId).master.occasions;
  assert.equal(m.christmas.scenes[0].title, "Merry Xmas", "an edited master occasion is kept");
  assert.deepEqual(m["anzac-day"], fresh["anzac-day"], "an unedited master occasion gets the new copy");

  const before = store.dump();
  const again = await seed();
  assert.equal(again.pharmacies.updated.length + again.promotions.updated.length, 0);
  assert.deepEqual(store.dump(), before, "re-running is a no-op");
});

// The seconds on screen the owner set on the live master (read from the published config on 21 Nov 2026).
const SEASON_SECONDS = {
  christmas: [3, 4],
  "new-year": [2, 2, 3],
  "australia-day": [2, 2, 3],
  "valentines-day": [3, 2, 2],
  easter: [2, 3, 2],
  "anzac-day": [3, 2, 2],
};
const withoutSeconds = (occasions) => Object.fromEntries(Object.entries(occasions).map(([id, o]) => [id, { ...o, beats: o.beats.map(({ dur: _d, ...b }) => b) }]));

test("fixtures: every season's beats carry their seconds on screen and total exactly 7", async () => {
  const f = loadFixtures();
  assert.deepEqual(f.pharmacies.map((p) => p.storeCode).sort(), CODES);
  for (const p of f.pharmacies) {
    const occ = p.content.occasions.occasions;
    assert.deepEqual(Object.keys(occ), Object.keys(SEASON_SECONDS), `${p.storeCode} has the six seasons`);
    for (const [id, o] of Object.entries(occ)) {
      for (const [i, b] of o.beats.entries()) assert.ok(Number.isFinite(b.dur) && b.dur >= 1 && b.dur <= 60, `${p.storeCode} ${id} beat ${i + 1} has its seconds`);
      assert.deepEqual(o.beats.map((b) => b.dur), SEASON_SECONDS[id], `${p.storeCode} ${id} seconds per beat`);
      assert.equal(o.beats.reduce((a, b) => a + b.dur, 0), 7, `${p.storeCode} ${id} totals 7 s`);
    }
  }
  // A fresh environment: the master (Beaumaris's content) and every store's screen play each season on a 7 s loop.
  const { svc, seed } = setup();
  await seed();
  const master = (await svc.listPromotions()).find((p) => p.promoId === "occasions").master.occasions;
  for (const [id, secs] of Object.entries(SEASON_SECONDS)) assert.deepEqual(master[id].beats.map((b) => b.dur), secs, `master ${id}`);
  for (const code of CODES) {
    const occ = (await svc.getScreenConfig(code)).promotions.occasions.content.occasions;
    for (const [id, secs] of Object.entries(SEASON_SECONDS)) assert.deepEqual(occ[id].beats.map((b) => b.dur), secs, `${code} ${id}`);
  }
});

test("an environment seeded before the season timings: seasons with no seconds get them, timings and copy someone edited are kept", async () => {
  const { store, svc, seed } = setup();
  const f = loadFixtures();
  // What the seed wrote before 21 Nov 2026: the same copy with no seconds on any beat.
  const old = { ...f, pharmacies: f.pharmacies.map((p) => ({ ...p, content: { ...p.content, occasions: { occasions: withoutSeconds(p.content.occasions.occasions) } } })) };
  await seed({ fixtures: old });
  const actor = { uid: "u-admin", email: null, admin: true };
  const occId = (await svc.listPromotions()).find((p) => p.promoId === "occasions").id;
  // On the master someone set Christmas's first beat to 8 s (one beat only), and moved Easter's dates.
  const master = JSON.parse(JSON.stringify((await svc.getPromotion(occId)).master));
  master.occasions.christmas.beats[0].dur = 8;
  Object.assign(master.occasions.easter, { from: "04-01", to: "04-08" });
  await svc.updatePromotion(actor, occId, { master });
  // On Beaumaris someone set every New Year's beat, and reworded an Anzac Day line without touching its seconds.
  const ph = await svc.getPharmacy(ids.pharmacy("vic-mp-001"));
  ph.content[occId].occasions["new-year"].beats.forEach((b) => { b.dur = 5; });
  ph.content[occId].occasions["anzac-day"].beats[1].text = "We will remember them";
  await svc.updatePharmacy(actor, ph.id, { content: ph.content });

  const report = await seed();
  assert.deepEqual(report.pharmacies.updated.sort(), CODES);
  assert.deepEqual(report.promotions.updated, ["occasions"]);
  assert.equal(report.pharmacies.created.length + report.promotions.created.length, 0);
  const fresh = f.pharmacies[0].content.occasions.occasions;
  const m = (await svc.getPromotion(occId)).master.occasions;
  assert.deepEqual(m.christmas.beats.map((b) => b.dur), [8, undefined], "a season with seconds set on any beat is left as it is");
  assert.deepEqual(m.easter, { ...fresh.easter, from: "04-01", to: "04-08" }, "edited dates are kept, the seconds are added");
  for (const id of ["new-year", "australia-day", "valentines-day", "anzac-day"]) assert.deepEqual(m[id], fresh[id], `master ${id} gets the new timings`);
  for (const p of await svc.listPharmacies()) {
    const occ = (await svc.getPharmacy(p.id)).content[occId].occasions;
    for (const [id, secs] of Object.entries(SEASON_SECONDS)) {
      if (p.storeCode === "VIC-MP-001" && id === "new-year") assert.deepEqual(occ[id].beats.map((b) => b.dur), [5, 5, 5], "edited timings are kept");
      else assert.deepEqual(occ[id].beats.map((b) => b.dur), secs, `${p.storeCode} ${id}`);
    }
    if (p.storeCode === "VIC-MP-001") assert.equal(occ["anzac-day"].beats[1].text, "We will remember them", "reworded copy is kept");
    else assert.deepEqual(occ, fresh, `${p.storeCode} equals the fixtures`);
  }

  const before = store.dump();
  const again = await seed();
  assert.equal(again.pharmacies.updated.length + again.promotions.updated.length, 0);
  assert.deepEqual(store.dump(), before, "re-running is a no-op");
  // A promotion and a pharmacy made by hand (not the seed's ids) are never given timings.
  const hand = setup();
  await hand.svc.createPromotion(actor, { name: "Seasonal", promoId: "occasions", templateId: "builtin-occasion-christmas", master: old.pharmacies[0].content.occasions });
  await hand.seed();
  const handMaster = (await hand.svc.listPromotions()).find((p) => p.promoId === "occasions").master.occasions;
  assert.ok(Object.values(handMaster).every((o) => o.beats.every((b) => b.dur === undefined)), "a hand-made promotion's master is left as it is");
});

test("season timings are only added where every beat can take one", () => {
  const fresh = { occasions: { christmas: { beats: [{ text: "A", dur: 3 }, { text: "B", dur: 4 }] } } };
  const up = (christmas) => upgradeTimings({ occasions: { christmas } }, fresh);
  assert.deepEqual(up({ from: "12-01", to: "12-26", beats: [{ text: "X" }, { label: "L", text: "Y" }] }), { occasions: { christmas: { from: "12-01", to: "12-26", beats: [{ text: "X", dur: 3 }, { label: "L", text: "Y", dur: 4 }] } } });
  assert.equal(up({ beats: [{ text: "X", dur: 6 }, { text: "Y" }] }), null, "seconds set on one beat");
  assert.equal(up({ beats: [{ text: "X" }] }), null, "a different number of beats");
  assert.equal(up({ scenes: [{ title: "X" }] }), null, "the old scenes shape");
  assert.equal(up({ beats: [{ text: "X", dur: 3 }, { text: "Y", dur: 4 }] }), null, "already timed");
  assert.equal(upgradeTimings({ occasions: { easter: { beats: [{ text: "X" }] } } }, fresh), null, "a season the fixtures have no timings for");
  assert.equal(upgradeTimings({ greeting: "Hi" }, fresh), null, "content with no seasons");
  assert.equal(upgradeTimings(null, fresh), null);
});

test("the legacy occasion copy the seed upgrades is the copy the screen treats as unedited", async () => {
  const { LEGACY_OCCASION_COPY } = await import("../../js/render.js");
  const legacy = loadFixtures().legacyOccasions;
  assert.deepEqual(Object.fromEntries(Object.entries(legacy).map(([k, v]) => [k, v.scenes])), LEGACY_OCCASION_COPY);
});

test("summary and arguments", () => {
  assert.deepEqual(parseArgs(["--project", "rob-ph-demos", "--reset"]), { project: "rob-ph-demos", reset: true });
  assert.throws(() => parseArgs(["--project"]), /needs a value/);
  assert.throws(() => parseArgs(["--nope"]), /Unknown option/);
  const text = summarise({ reset: false, pharmacies: { created: [1, 2], updated: [], unchanged: [] }, promotions: { created: [1], updated: [], unchanged: [] }, services: { created: [], updated: [], unchanged: [1] }, templates: { builtIn: [1, 2] } });
  assert.match(text, /pharmacies: 2 created, 0 updated, 0 unchanged/);
  assert.match(text, /templates: 2 built-in/);
});

test("master template: each default promotion's master is Beaumaris's content, inherited by every pharmacy", async () => {
  const { store, svc, seed } = setup();
  await seed();
  const f = loadFixtures();
  assert.equal(f.masterFrom, "VIC-MP-001");
  const beaumaris = f.pharmacies.find((p) => p.storeCode === "VIC-MP-001");
  for (const p of await svc.listPromotions()) {
    assert.deepEqual(p.master, beaumaris.content[p.promoId], `${p.promoId} master is Beaumaris's`);
    for (const code of CODES) {
      const screen = await svc.getScreenConfig(code);
      assert.deepEqual(screen.promotions[p.promoId].content, beaumaris.content[p.promoId], `${code} plays the master's ${p.promoId}`);
    }
  }
  // Branding stays each pharmacy's own.
  const ringwood = await svc.getScreenConfig("VIC-MP-002");
  assert.equal(ringwood.name, "North Ringwood Family Pharmacy");
  assert.deepEqual(ringwood.colours, { primary: "#035c2f", accent: "#f39a4a" });

  // A seeded promotion with no master yet (a store seeded before the master existed) gets it on a re-run; an edited
  // master is kept without --reset and put back with it.
  const actor = { uid: "u-admin", email: null, admin: true };
  await svc.updatePromotion(actor, ids.promotion("closed"), { master: null });
  await svc.updatePromotion(actor, ids.promotion("morning"), { master: { ...beaumaris.content.morning, introTitle: "Edited master" } });
  const report = await seed();
  assert.deepEqual(report.promotions.updated, ["closed"]);
  assert.deepEqual((await svc.getPromotion(ids.promotion("closed"))).master, beaumaris.content.closed);
  assert.equal((await svc.getPromotion(ids.promotion("morning"))).master.introTitle, "Edited master");
  const reset = await seed({ reset: true });
  assert.deepEqual(reset.promotions.updated, ["morning"]);
  assert.deepEqual((await svc.getPromotion(ids.promotion("morning"))).master, beaumaris.content.morning);
  const after = store.dump();
  await seed();
  assert.deepEqual(store.dump(), after);
});
