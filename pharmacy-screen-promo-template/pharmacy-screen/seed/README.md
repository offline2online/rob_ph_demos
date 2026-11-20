# Pharmacy Screen — seed data

A repeatable seed that loads the config store with everything the concept prototype holds, and the same
fixtures as mock data for local runs and tests.

| What | Where | Count |
|---|---|---|
| Launch pharmacies: store code, name, primary/accent colours, logo, morning/afternoon/closed/occasions content | `fixtures/pharmacies.json`, logos in `fixtures/logos/<store code>.webp.b64` (base64 of the transparent WebP from the prototype's `LOGOS`) | 5: VIC-MP-001 Beaumaris Pharmacy, VIC-MP-002 North Ringwood Family Pharmacy, VIC-MP-003 Ocean Grove Terrace Pharmacy, VIC-MP-004 Vermont South Pharmacy, VIC-MP-005 O'Brien's Pharmacy |
| Default promotions | `fixtures/promotions.json` | 4: Morning (`promo=morning`), Afternoon (`promo=afternoon`), Closed (`promo=closed`), Occasions (`promo=occasions`, on Christmas) |
| Built-in templates "Promotion scenes", "Opening hours" and the six occasions (Christmas, New Year's, Australia Day, Valentine's Day, Easter, Anzac Day) | `fixtures/templates.json` (description only: they are read-only and live in code, `../config-api/src/builtins.js`, so the seed checks them and writes nothing) | 8 |
| Service library: copy, icon, category, offered-by store codes | `fixtures/services.json` (field names are the config API's: `headline` is the prototype's title, `accent` its sub line) | 28 |
| Mock Location API `campaign_data` per device (`store_location`, `store_info.opening_hours[]`, `store_info.address_info`) | `../fixtures/campaign-data.json`, shared with the screen page; each pharmacy's `device` names its entry (`DEVICE-VIC-MP-001` …) | 5 launch devices + test devices |

Service copy needs TGA advertising review before go-live (requirement 13).

## Run it

```bash
cd pharmacy-screen-promo-template/pharmacy-screen/seed
node seed.js                                   # dry run on an in-memory store: prints what an empty store gets
node seed.js --project rob-ph-demos            # Firestore (pharmacyScreen/…) and the media bucket
node seed.js --project rob-ph-demos --reset    # put seeded records back to the fixture values
npm test                                       # the seed's tests (node:test, in-memory, no install)
```

`--project` needs `npm install` in `../config-api` (it uses that folder's `firebase-admin`) and Application
Default Credentials. `--bucket` (default `<project>-pharmacy-screen-media`) and `--root` (default
`pharmacyScreen`) match the config API's `PS_MEDIA_BUCKET` / `PS_FIRESTORE_ROOT`. With
`FIRESTORE_EMULATOR_HOST` / `FIREBASE_STORAGE_EMULATOR_HOST` set (e.g. inside `firebase emulators:exec`) it
seeds the emulators.

For a local API already holding the seed: `cd ../config-api && npm run dev:seed`.

## How it behaves

- **Through the config service.** Every write goes through `../config-api/src/service.js`, so seeded records
  are validated, the published screen config is built and each write is audit-logged (actor uid `seed`).
  Logos are uploaded like an admin upload.
- **Idempotent.** Records are created under fixed ids (`seed-pharmacy-vic-mp-001`, `seed-promotion-morning`,
  `seed-service-vacc`). A record with that id, or with the same natural key (store code, promo ID, service
  label), counts as already there and is left exactly as it is: a re-run makes no duplicates and writes
  nothing, not even an audit entry.
- **A default promotion added after launch reaches existing stores.** When a run creates a default promotion
  (Occasions, on a store seeded before it existed), each pharmacy the seed made (fixed id) gets its fixture
  content for that promotion if it has none; nothing else on it changes, and hand-made pharmacies are left as
  they are. The next run is a no-op.
- **Never overwrites edits unless `--reset`.** With `--reset`, a seeded record that differs from the fixture
  is put back (pharmacy name, colours, logo and its content for the four default promotions; promotion name,
  promo ID and template, so Occasions goes back to Christmas; service copy). Content for other promotions and records the seed doesn't know about
  are never touched. A second `--reset` changes nothing.
- **Master template.** `fixtures/promotions.json`'s `masterFrom` (`VIC-MP-001`, Beaumaris) names the pharmacy
  whose fixture content becomes each default promotion's `master`, so every pharmacy inherits Beaumaris's
  page elements and keeps its own branding. A seeded promotion with no master yet (a store seeded before the
  master existed) gets it on a plain re-run; a master edited in the editor is kept unless `--reset`, and a
  promotion made by hand is left as it is.
- Pharmacy content is keyed by promo ID in the fixtures and stored under each promotion's record id, as the
  API stores it.

`test/seed.test.js` covers the ticket's test steps (empty store → 5 / 4 / 8 / 28; second run changes
nothing; an edit survives a re-run, `--reset` restores it; a store seeded before Occasions gets it, then a re-run
is a no-op) and checks the fixtures against the prototype data
the screen page plays (`../fixtures/config.json`) and the mock Location API data.
