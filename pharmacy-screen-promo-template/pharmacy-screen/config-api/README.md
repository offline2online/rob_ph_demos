# Pharmacy Screen — config back end

The config store and REST API for the Pharmacy Screen Promo Template:
pharmacies (store code, name, colours, logo, per-promotion content),
promotions (shared; name, unique promo ID, template), templates (two
read-only built-ins plus custom clones with HTML, CSS and backgrounds) and
the service library. Admin endpoints need the admin role; one public endpoint
returns the published config a screen needs, with no secrets. Logos and
backgrounds go to object storage. Every write is audit-logged.

Spec: the project's requirements 9-13 and 20-21. The PH API token and the
Location API proxy are the other half of the back end, beside this folder in
`../ph-proxy/` (its own function, `pharmacyScreenPhApi`, and its own
`pharmacyScreen/private/` documents); nothing described here stores or sees
the token. The two functions share the admin claim and the `/api` path
space without overlapping: the proxy serves `/api/settings/**` and
`/api/device/**`, this API `/api/health`, `/api/screens/**` and
`/api/admin/**`.

## Layout

```
config-api/
  index.js                    Cloud Functions (2nd gen) entry: pharmacyScreenConfigApi
  src/api.js                  routes + HTTP behaviour, framework-neutral
  src/http.js                 Node / Cloud Functions request adapter
  src/service.js              every read and write (transactions, publishing, audit)
  src/validate.js             input checks and normalising
  src/publish.js              the public screen config, built by allow-list
  src/builtins.js             the two built-in templates (read-only, in code)
  src/adapters/
    memory-store.js           in-memory store (tests, dev server)
    firestore-store.js        Firestore store under pharmacyScreen/
    blobs.js                  object storage: in-memory and Cloud Storage
    auth.js                   Firebase Auth (admin claim) and fixed dev tokens
  rules/storage.rules         Storage rules for the media bucket
  scripts/dev-server.js       run locally with no cloud (npm run dev)
  scripts/set-admin-claim.js  grant / revoke the admin role
  test/                       node:test suites (see "Tests")
```

The Firestore rules are not here: a Firebase project has one ruleset, and
rob-ph-demos's is the repo-root `firestore.rules` (shared with the
menu-board demo). Its `pharmacyScreen` block is the one for this project.

## Adapters (how an AWS deployment slots in)

`createConfigApi({ store, blobs, auth, allowedOrigins, now, log })` takes
three small adapters and knows nothing about Firebase. The AWS deployment for
miPharmacy (`../../aws/`) supplies DynamoDB, S3 and OIDC adapters and a Lambda
entry that maps API Gateway events to `api.handle(...)` — the routes,
validation, publishing and audit stay as they are.

| Adapter | Methods | Firebase | AWS (`../../aws/adapters/`) | Local / tests |
| --- | --- | --- | --- | --- |
| store | `transaction(fn)` with `tx.get / tx.list / tx.set / tx.delete`; `get`, `list(coll, {orderBy, desc, limit})`, `newId()` | `firestore-store.js` | `dynamodb-store.js` | `memory-store.js` |
| blobs | `put(path, buffer, contentType) -> {path, url}`, `delete(path)` | `createGcsBlobs` | `s3-blobs.js` | `createMemoryBlobs` |
| auth | `identify(authorizationHeader) -> {uid, email, admin} \| null` | `createFirebaseAuth` | `oidc-auth.js` (Cognito or the retailer's IdP) | `createStaticAuth` |

A store transaction must be all-or-nothing and serialisable (reads before
writes); that is what makes store codes and promo IDs unique under concurrent
writes.

## Data model

Firestore (`PS_FIRESTORE_ROOT`, default `pharmacyScreen`):

| Path | What | Client access (rules) |
| --- | --- | --- |
| `pharmacyScreen/config/pharmacies/{id}` | `storeCode`, `name`, `colours {primary, accent}`, `logo {path, url, contentType} \| null`, `content {<promotion id>: {...}}`, `detached {<promotion id>: [section ids]}` (only when a section is managed separately), `tokens {<token name>: text}` (only when a token is set by hand; names as `js/tokens.js` `isSettableToken`, never a template slot; text up to 200 characters, 50 per pharmacy; blank values dropped) | none |
| `pharmacyScreen/config/promotions/{id}` | `name`, `promoId`, `templateId`, `master {...}` (the master template's content; only once saved) | none |
| `pharmacyScreen/config/templates/{id}` | custom templates: `name`, `kind`, `basedOn`, `html`, `css`, `backgrounds {portrait, landscape}` | none |
| `pharmacyScreen/config/services/{id}` | `label`, `icon`, `category`, `headline`, `accent`, `line1`, `line2`, `offeredBy [store codes]` | none |
| `pharmacyScreen/audit/entries/{id}` | one per write: `at`, `actorUid`, `actorEmail`, `action`, `entity`, `entityId`, `changedFields`, `before`, `after` (+ `promotionId`, `media`, `clonedFrom`, `fallbackTemplateId`, `promotionsFellBack` where relevant) | none |
| `pharmacyScreen/published/screens/{storeCode}` | the published screen config (below) | public read |

Every admin record also has `version`, `createdAt`, `createdBy`,
`updatedAt`, `updatedBy` (uids). Content is free-form JSON owned by the
editor and the screen (scenes, greeting, open-today bar…): the API bounds it
(200 KB per promotion, nesting depth 12) and refuses script-bearing markup
in any string, but does not fix its shape.

**Master template** (`src/inherit.js`) — a promotion's `master` is the
content every pharmacy uses for it by default. Its sections are `greeting`
(`greeting`, `introTitle`, `introSub`, `introDur`), `slots`, `close`,
`headlines`, `address` (`showAddress`), `occasions` and `footer`. A pharmacy
inherits each section unless `detached[<promotion id>]` lists it; then its own
`content` for that section is used and later master changes no longer reach
it. Fields in no section are always the pharmacy's. The published screen
config carries the resolved content, so screens never see `master` or
`detached`; saving a master republishes every pharmacy. Without a master, a
pharmacy's own content is used as before. `PATCH /api/admin/promotions/{id}`
with `master` (an object, or `null` to remove it) and
`PATCH /api/admin/pharmacies/{id}` with `detached` (an unknown section id is a
400) are the writes. Branding is never inherited.

**Built-in templates** — `builtin-promotion-scenes` ("Promotion scenes",
kind `promotion-scenes`) and `builtin-opening-hours` ("Opening hours", kind
`opening-hours`) — live in `src/builtins.js`, not in the store. Listing
templates returns them first. They cannot be changed, deleted or given
backgrounds (403); clone one to edit. A custom template keeps the `kind` of
what it was cloned from, and deleting it moves every promotion that used it
to the built-in of that kind.

**Occasion templates** — six more built-ins, kind `occasion`, one per
occasion: `builtin-occasion-christmas`, `-new-year`, `-australia-day`,
`-valentines-day`, `-easter`, `-anzac-day`. Each carries `occasion` (the
part after `builtin-occasion-`), which the published config passes on so the
screen draws that occasion (`../js/render.js` → `OCCASIONS`). The seeded
Occasions promotion (`promo=occasions`) uses `builtin-occasion-christmas`;
the admin editor's Occasion drop-down sets its `templateId` to another one.
They can't be cloned (400: there is no editable HTML version of an
occasion). A pharmacy's content for an occasion promotion keeps every
occasion's copy, `content.occasions.<occasion>.scenes[3]` (greeting, message,
sign-off: `title`, `sub`, `line1`, `line2`, `dur`), plus the promotion's
`footer`.

**Media** goes to the bucket `PS_MEDIA_BUCKET` (default
`<project>-pharmacy-screen-media`) under `pharmacyScreen/media/logos/{pharmacyId}/…`
and `pharmacyScreen/media/backgrounds/{templateId}/{orientation}-…`, named by
content hash. A replaced or deleted object is removed once no record points
at it (a cloned template shares its source's backgrounds until one is
replaced). Logos: PNG or WebP, up to 2 MB. Backgrounds: PNG, JPEG or WebP,
up to 5 MB. SVG is refused. The file's bytes must match its type.

### Published screen config

Rebuilt in the same transaction as every write that affects it (a pharmacy
edit republishes that pharmacy; a promotion or template edit republishes all;
a store code change or delete removes the old document). Copied field by
field (`src/publish.js`), so nothing else on the records can reach it:

```json
{
  "schemaVersion": 1,
  "storeCode": "VIC-MP-001",
  "name": "Beaumaris Pharmacy",
  "colours": { "primary": "#0a7d5a", "accent": "#f2a900" },
  "logo": "https://firebasestorage.googleapis.com/v0/b/…/o/pharmacyScreen%2Fmedia%2Flogos%2F…png?alt=media",
  "promotions": {
    "morning": {
      "promoId": "morning",
      "name": "Morning",
      "template": { "id": "builtin-promotion-scenes", "name": "Promotion scenes", "kind": "promotion-scenes", "builtIn": true, "html": "", "css": "", "backgrounds": { "portrait": null, "landscape": null } },
      "content": { "…": "this pharmacy's content for the promotion" }
    }
  },
  "tokens": { "Suburb": "Beaumaris" },
  "publishedAt": "2026-11-20T01:00:00.000Z"
}
```

`tokens` (the pharmacy's hand-set token values) is there only when it has any.

A built-in's `html`/`css` are empty: the screen renders built-ins with its
own engine.

## API

Base path `/api` (a request to the function URL without `/api` is routed the
same). JSON in and out; errors are `{"error": {"code", "message"}}` with
400 `invalid-request`, 401 `unauthenticated`, 403 `forbidden` / `read-only`,
404 `not-found` / `unknown-promo`, 405, 409 `duplicate-store-code` /
`duplicate-promo-id` / `version-conflict`, 413 `too-large`, 415
`unsupported-media-type`.

### Public (no sign-in, CORS `*`, cached 15 s)

| Method | Path | |
| --- | --- | --- |
| GET | `/api/health` | `{ok: true}` |
| GET | `/api/screens/{storeCode}` | published config for one pharmacy |
| GET | `/api/screens/{storeCode}?promo=<promoId>` | the same, with only that promotion (404 `unknown-promo` if none) |

The screen gets its store code from the Location API (via the proxy) by
device, then reads its config here — the campaign URL never carries a store
code.

### Admin (`Authorization: Bearer <Firebase ID token>` with the admin claim)

| Method | Path | |
| --- | --- | --- |
| GET | `/api/admin/me` | who you are |
| GET, POST | `/api/admin/pharmacies` | list (without `content`) / create |
| GET, PATCH, PUT, DELETE | `/api/admin/pharmacies/{id}` | read / update (fields sent are changed) / delete |
| PUT | `/api/admin/pharmacies/{id}/content/{promotionId}` | set one promotion's content |
| PUT, DELETE | `/api/admin/pharmacies/{id}/logo` | upload (raw image body, `Content-Type: image/png` or `image/webp`) / remove |
| GET, POST | `/api/admin/promotions` | list / create `{name, promoId, templateId}` |
| GET, PATCH, PUT, DELETE | `/api/admin/promotions/{id}` | read / update / delete |
| GET, POST | `/api/admin/templates` | list (built-ins first) / create a custom `{name, kind, html?, css?}` |
| GET, PATCH, PUT, DELETE | `/api/admin/templates/{id}` | read / update / delete (custom only; delete falls back) |
| POST | `/api/admin/templates/{id}/clone` | clone a built-in or custom `{name?}` (not an occasion template: 400) |
| PUT, DELETE | `/api/admin/templates/{id}/backgrounds/{portrait\|landscape}` | upload (raw image body) / remove |
| GET, POST | `/api/admin/services` | list / create |
| GET, PATCH, PUT, DELETE | `/api/admin/services/{id}` | read / update / delete |
| GET | `/api/admin/audit?limit=&entity=&entityId=` | newest first, up to 500 |

Rules the API enforces:

- **Store codes** are 2-32 letters, digits and hyphens, stored upper-case,
  and unique across pharmacies. **Promo IDs** are 1-40 lower-case letters,
  digits and hyphens (used as `promo=<id>`), unique across promotions. Both
  checks run inside the write transaction, so two concurrent writes cannot
  both claim one.
- **Optimistic concurrency**: send `If-Match: "<version>"` (or
  `expectedVersion` in the body or query) on an update or delete; if someone
  else saved first you get 409 `version-conflict` instead of overwriting
  them.
- Template HTML and content strings may not hold `<script>`, `<iframe>`,
  `<object>`, `<embed>`, `<frame>`, `<base>`, `<meta>`, `<link>`, inline
  event handlers or `javascript:` URLs; template CSS may not hold `</style>`,
  `@import`, `expression()` or `javascript:`. They render on unattended
  public screens.
- Fields a request sends that an entity doesn't have are dropped. Media
  references are set only by the upload endpoints.
- Refused requests (401/403/4xx) write nothing and log nothing.

## Configuration

All non-secret; set as function environment variables.

| Variable | Default | |
| --- | --- | --- |
| `PS_ADMIN_CLAIM` | `admin` | custom claim that marks an admin |
| `PS_ALLOWED_ORIGINS` | none | comma-separated origins allowed to call admin endpoints from a browser (the admin editor's origin) |
| `PS_MEDIA_BUCKET` | `<project>-pharmacy-screen-media` | bucket for logos and backgrounds; deploy `rules/storage.rules` to it |
| `PS_FIRESTORE_ROOT` | `pharmacyScreen` | top-level collection |
| `PS_REGION` | `us-central1` | function region (the same as the Location API proxy, `ph-proxy/`) |

Grant the admin role: `node scripts/set-admin-claim.js --project rob-ph-demos --uid <uid>`
(`--revoke` to take it away). The user gets it on their next sign-in or token
refresh.

## Run locally

```
cd pharmacy-screen-promo-template/pharmacy-screen/config-api
npm install
npm run dev            # http://localhost:8787/api, in-memory, token "dev-admin" (admin) / "dev-viewer" (non-admin)
curl -H "Authorization: Bearer dev-admin" localhost:8787/api/admin/templates
```

`npm run dev:seed` starts it already holding the seed data (`../seed/`: the five launch pharmacies, the
default promotions and the service library). To load the same data into Firestore, run the seed script
(`node ../seed/seed.js --project rob-ph-demos`, see `../seed/README.md`); it writes through
`src/service.js`, using its create functions' `{ id }` option (fixed ids, so a re-run finds its records; the
HTTP API never passes it).

## Tests

```
npm test               # API and validators against the in-memory adapters (no network)
                       # (PS_TEST_STORE=<module> runs the API suite on another store; aws/test/ uses it for DynamoDB)
npm run test:emulator  # Firestore + Storage rules and the Firestore adapter, on the emulators (needs Java)
```

`npm test` covers CRUD of every entity, 401/403 on every admin route,
template-delete fallback, unique store codes and promo IDs (including
concurrent creates), the public read returning no secret or admin fields,
the audit log, versions, uploads and validation. `test:emulator` loads the
real repo-root `firestore.rules` and `rules/storage.rules` and checks that no
client (anonymous, signed in, or even with the admin claim) can write
anything under `pharmacyScreen/`, that admin records and the audit log are
not client-readable, and that only the published config and media are
public.

## Deploying

Deployed to our test environment (Firebase project rob-ph-demos) by the
one-command deploy, `npm run deploy` in `pharmacy-screen-promo-template/`
(see that folder's README for the URLs). It deploys this folder as the
functions codebase `pharmacy-screen-config-api`, with the settings in
`.env.rob-ph-demos` (non-secret), rewrites `/api/screens/**`, `/api/admin/**`
and `/api/health` on the Hosting site to `pharmacyScreenConfigApi`, creates
the media bucket `rob-ph-demos-pharmacy-screen-media` and deploys
`rules/storage.rules` to that bucket only, never to the project's default
bucket (the menu-board demo uses it).

**The screen reads this** through `fromPublishedConfig()` in
`../js/live-data.js`, which maps it onto the render engine's
`fixtures/config.json` shape: a promotion's `template.kind` is the fixture's
`base` (`promotion-scenes` → `t_scenes`, `opening-hours` → `t_hours`,
`occasion` → `t_occ_<occasion>`),
`colours` is `brand`, `logo` is a URL, and `promotions` is keyed by promo ID
with that pharmacy's `content` inside. `../test/live-data.test.mjs` builds a
published config with `src/publish.js` and checks the mapping, so a change to
either side shows up there.
