#!/usr/bin/env node
"use strict";

// Seed the Pharmacy Screen config store with what the concept prototype
// holds: the five launch pharmacies (branding, logo, morning / afternoon /
// closed / occasions content), the four default promotions, the 28-service
// library, and a check that the eight read-only built-in templates (Promotion
// scenes, Opening hours, six occasions) are there (they live in code,
// config-api/src/builtins.js, so there is nothing to write for them).
//
// Every write goes through the config service (../config-api/src/service.js),
// so the seed gets the same validation, published screen config and audit
// log as an edit made in the admin editor.
//
// Idempotent: a record the seed made before (same fixed id), or one with the
// same natural key (store code, promo ID, service label), is left exactly as
// it is, so a re-run creates no duplicates and never undoes someone's edit.
// The additions to an existing record: when this run creates a default
// promotion (e.g. Occasions, added after launch), each pharmacy the seed made
// earlier gets its fixture content for that promotion, if it has none yet;
// and a default promotion the seed made earlier with no master template yet
// gets the master (the content of the pharmacy promotions.json's masterFrom
// names, Beaumaris).
// Occasions copy (20 Nov 2026, the standalone designs): a pharmacy or a
// promotion master the seed made that still holds an occasion's old default
// copy (fixtures/occasions-legacy.json, never edited) gets that occasion's new
// default copy from the fixtures; copy anyone edited is kept as it is.
// With --reset, seeded records that differ from the fixtures are put back to
// the fixture values (records the seed doesn't know about are never touched,
// and a pharmacy's content for promotions other than the four defaults is
// kept).
//
//   node seed.js                                   dry run on an in-memory store (no cloud)
//   node seed.js --project rob-ph-demos            seed Firestore + the media bucket
//   node seed.js --project rob-ph-demos --reset    put seeded records back to the fixtures
//   options: --bucket <name> (default <project>-pharmacy-screen-media), --root <collection>
//            (default pharmacyScreen). FIRESTORE_EMULATOR_HOST / FIREBASE_STORAGE_EMULATOR_HOST
//            point it at the emulators. Credentials: Application Default Credentials.
//
// See README.md beside this file.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const CONFIG_API = path.join(__dirname, "..", "config-api");
const { createConfigService } = require(path.join(CONFIG_API, "src", "service"));
const { BUILTIN_TEMPLATES } = require(path.join(CONFIG_API, "src", "builtins"));
const { MEDIA_PREFIX } = require(path.join(CONFIG_API, "src", "adapters", "blobs"));
const { normalisePharmacy, normalisePromotion, normaliseService } = require(path.join(CONFIG_API, "src", "validate"));

const FIXTURES = path.join(__dirname, "fixtures");
const CAMPAIGN_DATA = path.join(__dirname, "..", "fixtures", "campaign-data.json");

const SEED_ACTOR = Object.freeze({ uid: "seed", email: null });

// Fixed record ids, so a re-run finds what an earlier run made.
const ids = {
  pharmacy: (key) => `seed-pharmacy-${key}`,
  promotion: (key) => `seed-promotion-${key}`,
  service: (key) => `seed-service-${key}`,
};

// ── fixtures ───────────────────────────────────────────────────────────────

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

// The whole seed as plain data. Also the mock data for local runs and tests:
// campaignData is the mock Location API response per device (real shape:
// store_location, store_info.opening_hours[], store_info.address_info), the
// same file the screen page reads in fixture mode.
function loadFixtures() {
  const pharmacies = readJson(path.join(FIXTURES, "pharmacies.json")).pharmacies.map((p) => ({
    ...p,
    logo: p.logo && {
      contentType: p.logo.contentType,
      bytes: Buffer.from(fs.readFileSync(path.join(FIXTURES, p.logo.file), "utf8").replace(/\s+/g, ""), "base64"),
    },
  }));
  return {
    pharmacies,
    promotions: readJson(path.join(FIXTURES, "promotions.json")).promotions,
    masterFrom: readJson(path.join(FIXTURES, "promotions.json")).masterFrom || null,
    templates: readJson(path.join(FIXTURES, "templates.json")).templates,
    legacyOccasions: readJson(path.join(FIXTURES, "occasions-legacy.json")).occasions,
    services: readJson(path.join(FIXTURES, "services.json")).services,
    campaignData: readJson(CAMPAIGN_DATA).devices,
  };
}

// The mock campaign_data response for a device, or null (as the proxy would 404).
function campaignDataFor(deviceId, fixtures = loadFixtures()) {
  return fixtures.campaignData[deviceId] || null;
}

// ── seeding ────────────────────────────────────────────────────────────────

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Equal as data, whatever order the store returns object keys in (Firestore maps are unordered).
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const sameData = (a, b) => same(canon(a), canon(b));

/**
 * Occasion copy (content.occasions) with every occasion still holding its old
 * default copy replaced by the new default from `fresh`; null when nothing
 * changes. Edited copy, and occasions `fresh` has no copy for, are kept.
 */
function upgradeOccasions(content, fresh, legacy) {
  if (!content || !content.occasions || typeof content.occasions !== "object" || !fresh || !fresh.occasions || !legacy) return null;
  let changed = false;
  const occasions = { ...content.occasions };
  for (const [id, copy] of Object.entries(occasions)) {
    if (legacy[id] && fresh.occasions[id] && sameData(copy, legacy[id])) {
      occasions[id] = fresh.occasions[id];
      changed = true;
    }
  }
  return changed ? { ...content, occasions } : null;
}
const logoHash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 20);
// The path setLogo() stores a logo under (content-hash named), to tell
// whether a stored logo is the fixture's without downloading it.
const logoPathFor = (id, logo) => `${MEDIA_PREFIX}logos/${id}/${logoHash(logo.bytes)}.${logo.contentType === "image/png" ? "png" : "webp"}`;

/**
 * Seed a config store. store/blobs are the config API's adapters.
 * Returns a report: { reset, pharmacies|promotions|services: {created, updated, unchanged}, templates: {builtIn} }.
 */
async function seedConfig({ store, blobs, reset = false, fixtures = loadFixtures(), now, log = () => {} }) {
  const svc = createConfigService({ store, blobs, now, log });
  const report = {
    reset,
    promotions: { created: [], updated: [], unchanged: [] },
    pharmacies: { created: [], updated: [], unchanged: [] },
    services: { created: [], updated: [], unchanged: [] },
    templates: { builtIn: [] },
  };

  // Built-in templates: in code, never written. Check the store offers
  // exactly the ones the fixtures describe.
  const listed = (await svc.listTemplates()).filter((t) => t.builtIn);
  for (const t of fixtures.templates) {
    const found = listed.find((x) => x.id === t.id);
    if (!found || found.name !== t.name || found.kind !== t.kind) {
      throw new Error(`Built-in template ${t.id} ("${t.name}") is missing or differs from config-api/src/builtins.js`);
    }
    report.templates.builtIn.push(t.id);
  }
  if (listed.length !== BUILTIN_TEMPLATES.length || listed.length !== fixtures.templates.length) {
    throw new Error(`Expected ${fixtures.templates.length} built-in templates, the config API has ${listed.length}`);
  }

  // Promotions first: pharmacy content is stored under each promotion's record id.
  const promotionIdByPromoId = {};
  const createdPromotionIds = new Set();
  // The master template (requirement 23): each default promotion's master is
  // the content of the pharmacy named by masterFrom (Beaumaris), so every
  // pharmacy inherits its page elements and keeps only its own branding.
  const masterPharmacy = fixtures.masterFrom ? (fixtures.pharmacies || []).find((ph) => ph.storeCode === fixtures.masterFrom) : null;
  const masterFor = (promoId) => (masterPharmacy && masterPharmacy.content && masterPharmacy.content[promoId]) || null;
  for (const p of fixtures.promotions) {
    const master = masterFor(p.promoId);
    const fields = { name: p.name, promoId: p.promoId, templateId: p.templateId, ...(master ? { master } : {}) };
    const rows = await store.list("promotions");
    const existing = rows.find((r) => r.id === ids.promotion(p.key)) || rows.find((r) => r.promoId === p.promoId);
    if (!existing) {
      const rec = await svc.createPromotion(SEED_ACTOR, fields, { id: ids.promotion(p.key) });
      promotionIdByPromoId[p.promoId] = rec.id;
      createdPromotionIds.add(rec.id);
      report.promotions.created.push(p.promoId);
      continue;
    }
    promotionIdByPromoId[p.promoId] = existing.id;
    const want = normalisePromotion(fields);
    const have = normalisePromotion({ name: existing.name, promoId: existing.promoId, templateId: existing.templateId, master: existing.master });
    if (reset && !same(want, have)) {
      await svc.updatePromotion(SEED_ACTOR, existing.id, fields);
      report.promotions.updated.push(p.promoId);
    } else if (!reset && master && !existing.master && existing.id === ids.promotion(p.key)) {
      // A promotion the seed made, with no master yet, gets the fixture's; a
      // master saved in the editor is never replaced without --reset, and a
      // promotion made by hand is left exactly as it is.
      await svc.updatePromotion(SEED_ACTOR, existing.id, { master });
      report.promotions.updated.push(p.promoId);
    } else if (!reset && master && existing.id === ids.promotion(p.key) && upgradeOccasions(existing.master, master, fixtures.legacyOccasions)) {
      // A master the seed made still holding old default occasion copy.
      await svc.updatePromotion(SEED_ACTOR, existing.id, { master: upgradeOccasions(existing.master, master, fixtures.legacyOccasions) });
      report.promotions.updated.push(p.promoId);
    } else {
      report.promotions.unchanged.push(p.promoId);
    }
  }

  // An edited promo ID moves the content key; anything the seed can't place is skipped, not guessed.
  const contentFor = (ph) => {
    const out = {};
    for (const [promoId, value] of Object.entries(ph.content || {})) {
      if (promotionIdByPromoId[promoId]) out[promotionIdByPromoId[promoId]] = value;
    }
    return out;
  };

  for (const ph of fixtures.pharmacies) {
    const content = contentFor(ph);
    const fields = { storeCode: ph.storeCode, name: ph.name, colours: ph.colours };
    const rows = await store.list("pharmacies");
    const existing = rows.find((r) => r.id === ids.pharmacy(ph.key)) || rows.find((r) => r.storeCode === ph.storeCode.toUpperCase());
    if (!existing) {
      const rec = await svc.createPharmacy(SEED_ACTOR, { ...fields, content }, { id: ids.pharmacy(ph.key) });
      if (ph.logo) await svc.setLogo(SEED_ACTOR, rec.id, ph.logo.contentType, ph.logo.bytes);
      report.pharmacies.created.push(ph.storeCode);
      continue;
    }
    if (!reset) {
      // A default promotion this run created: give a pharmacy the seed made its content for it (only if
      // missing). A pharmacy made by hand is left exactly as it is.
      const have = existing.content || {};
      const seeded = existing.id === ids.pharmacy(ph.key);
      const added = seeded ? Object.fromEntries(Object.entries(content).filter(([id]) => createdPromotionIds.has(id) && !have[id])) : {};
      // Old default occasion copy on a pharmacy the seed made: the new defaults.
      if (seeded) {
        for (const [id, value] of Object.entries(content)) {
          const up = !added[id] && upgradeOccasions(have[id], value, fixtures.legacyOccasions);
          if (up) added[id] = up;
        }
      }
      if (Object.keys(added).length) {
        await svc.updatePharmacy(SEED_ACTOR, existing.id, { content: { ...have, ...added } });
        report.pharmacies.updated.push(ph.storeCode);
      } else {
        report.pharmacies.unchanged.push(ph.storeCode);
      }
      continue;
    }
    // --reset: the fixture's fields and its content for the seeded
    // promotions; content for other promotions stays.
    const want = normalisePharmacy({ ...fields, content: { ...(existing.content || {}), ...content } });
    const have = normalisePharmacy({ storeCode: existing.storeCode, name: existing.name, colours: existing.colours, content: existing.content || {} });
    let changed = false;
    if (!same(want, have)) {
      await svc.updatePharmacy(SEED_ACTOR, existing.id, { ...fields, content: want.content });
      changed = true;
    }
    if (ph.logo && !(existing.logo && existing.logo.path === logoPathFor(existing.id, ph.logo))) {
      await svc.setLogo(SEED_ACTOR, existing.id, ph.logo.contentType, ph.logo.bytes);
      changed = true;
    }
    report.pharmacies[changed ? "updated" : "unchanged"].push(ph.storeCode);
  }

  for (const s of fixtures.services) {
    const { key, ...fields } = s;
    const rows = await store.list("services");
    const existing = rows.find((r) => r.id === ids.service(key)) || rows.find((r) => r.label === s.label);
    if (!existing) {
      await svc.createService(SEED_ACTOR, fields, { id: ids.service(key) });
      report.services.created.push(key);
      continue;
    }
    const want = normaliseService(fields);
    const { id: _id, version: _v, createdAt: _ca, createdBy: _cb, updatedAt: _ua, updatedBy: _ub, ...stored } = existing;
    if (reset && !same(want, normaliseService(stored))) {
      await svc.updateService(SEED_ACTOR, existing.id, fields);
      report.services.updated.push(key);
    } else {
      report.services.unchanged.push(key);
    }
  }

  return report;
}

function summarise(report) {
  const line = (name, r) => `${name}: ${r.created.length} created, ${r.updated.length} updated, ${r.unchanged.length} unchanged`;
  return [
    `Seed${report.reset ? " (--reset)" : ""}:`,
    `  ${line("promotions", report.promotions)}`,
    `  ${line("pharmacies", report.pharmacies)}`,
    `  ${line("services", report.services)}`,
    `  templates: ${report.templates.builtIn.length} built-in (read-only, in code)`,
  ].join("\n");
}

// ── CLI ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { reset: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--reset") opts.reset = true;
    else if (a === "--project" || a === "--bucket" || a === "--root") {
      const v = argv[++i];
      if (!v || v.startsWith("--")) throw new Error(`${a} needs a value`);
      opts[a.slice(2)] = v;
    } else if (a === "--help" || a === "-h") opts.help = true;
    else throw new Error(`Unknown option ${a}`);
  }
  return opts;
}

// firebase-admin is the config API's dependency (npm install in ../config-api).
function requireFromConfigApi(id) {
  try {
    return require(require.resolve(id, { paths: [CONFIG_API] }));
  } catch (err) {
    throw new Error(`Cannot load ${id}: run npm install in pharmacy-screen/config-api first (${err.message})`);
  }
}

async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(fs.readFileSync(__filename, "utf8").split("\n").filter((l) => l.startsWith("//   ")).map((l) => l.slice(5)).join("\n"));
    return;
  }
  let store;
  let blobs;
  if (opts.project) {
    const { initializeApp, getApps } = requireFromConfigApi("firebase-admin/app");
    const { getFirestore } = requireFromConfigApi("firebase-admin/firestore");
    const { getStorage } = requireFromConfigApi("firebase-admin/storage");
    const { createFirestoreStore } = require(path.join(CONFIG_API, "src", "adapters", "firestore-store"));
    const { createGcsBlobs } = require(path.join(CONFIG_API, "src", "adapters", "blobs"));
    if (!getApps().length) initializeApp({ projectId: opts.project });
    store = createFirestoreStore(getFirestore(), { root: opts.root || "pharmacyScreen" });
    blobs = createGcsBlobs(getStorage().bucket(opts.bucket || `${opts.project}-pharmacy-screen-media`));
    console.log(`Seeding project ${opts.project} (collection ${opts.root || "pharmacyScreen"})${process.env.FIRESTORE_EMULATOR_HOST ? " on the emulator" : ""}`);
  } else {
    const { createMemoryStore } = require(path.join(CONFIG_API, "src", "adapters", "memory-store"));
    const { createMemoryBlobs } = require(path.join(CONFIG_API, "src", "adapters", "blobs"));
    store = createMemoryStore();
    blobs = createMemoryBlobs();
    console.log("Dry run on an in-memory store (pass --project <id> to seed Firestore)");
  }
  const report = await seedConfig({ store, blobs, reset: opts.reset, log: (level, msg) => console.error(`[${level}] ${msg}`) });
  console.log(summarise(report));
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`Seed failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { seedConfig, loadFixtures, campaignDataFor, summarise, parseArgs, upgradeOccasions, ids, SEED_ACTOR };
