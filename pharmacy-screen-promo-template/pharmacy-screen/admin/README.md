# Admin editor (`admin/`)

The signed-in admin web app for the Pharmacy Screen Promo Template: the concept prototype's editor (v41),
saving to the config API instead of browser storage. Static ES modules, no build step, PH design system
(Roboto, Material Symbols, `#169bc2`). It renders the content frame only, with nothing `position: fixed`, so
it can be iframed into HQ Admin.

Spec: the project's requirements 7 and 9-19.

## What it edits

| Area | What | Saved through |
|---|---|---|
| Toolbar | Pharmacy picker, Add pharmacy, Reset (launch pharmacies: back to the seed content), Delete (click twice) | `/api/admin/pharmacies` |
| Pharmacy details | Name, store code (unique, checked as you type and again by the API) | `PATCH /api/admin/pharmacies/{id}` |
| Branding | Primary and accent colours; logo (transparent PNG) upload, replace, remove | `PATCH …/{id}`, `PUT/DELETE …/{id}/logo` |
| Promotions (shared by all pharmacies) | Tabs, New promotion (name, promo ID, template), rename, change promo ID (unique), delete (click twice) | `/api/admin/promotions` |
| Template | Drop-down and the Edit HTML modal: built-ins read-only, Clone template, rename, delete (its promotions fall back to the built-in), portrait/landscape backgrounds, HTML with `${…}` token chips, scoped CSS, Reset to default | `/api/admin/templates` |
| Scenes (scenes templates) | Greeting, one scene per service (rich-text headline, accent line, chip label, searchable Material Symbols icon, line 1, line 2), per-scene duration, drag-and-drop and up/down reorder, delete, Add promotion from the service library (filtered to this pharmacy's services) or blank, Walk-in close, Open today bar (show toggle and four messages with `${CloseTime}` / `${OpenTime}`) | `PUT /api/admin/pharmacies/{id}/content/{promotionId}` |
| Opening hours (hours templates) | Three rich-text headlines, show address toggle | the same |
| Settings | Store record read from the Location API through the proxy for a device ID (read-only, with field paths); Personalisation Hub API base URL and write-only token (Save / Replace / Remove; only its last 4 characters are ever shown) | `GET /api/device/{id}/campaign_data`, `/api/settings/ph-api` |

Edits save as you type (debounced, about half a second), with "Saving… / All changes saved" beside the title.
Every write carries the record's version (`If-Match`), so an edit made on top of another admin's newer save
is refused (409) and the editor asks you to reload instead of overwriting it. The server checks the admin
role on every call and writes an audit entry for every save; nothing is kept in browser storage except view
preferences (orientation, last pharmacy, last device ID looked up per store).

A pharmacy's content is stored per promotion record id. Switching a promotion to a template of the other kind
keeps the content of both kinds (a content object can hold `slots` and `headlines`), so switching back loses
nothing.

## Live preview

`../js/render.js` (the screen's own render engine) draws the selected promotion, fed the same config a screen
gets (`js/model.js` → `renderConfig()` maps the admin records). Portrait/Landscape tabs, the scene timeline
with total time, Play/Pause, click a scene to jump to its editor and focus an editor to show its scene, and
Copy template URL (`pharmacy-screen.html?device=${UniqueDeviceID}&promo=<id>&orientation=<o>`, the full URL
in a wrapping tooltip on hover). Store data comes from the device looked up in Settings; until one is, the
preview uses sample hours and no suburb, and says so.

## Files

| File | What it does |
|---|---|
| `index.html` | The page: sign-in gate, editor, Settings, Edit HTML dialog, preview. |
| `config.js` | Deployment settings: `apiBase`, `screenPage`, `auth` (Firebase web config). Non-secret. |
| `css/admin.css` | The prototype's editor styles plus the sign-in gate and save status. The screen itself uses `../css/screen.css`. |
| `js/editor.js` | The editor: state, rendering, saving, preview loop. |
| `js/model.js` | No DOM: admin records → render config, content defaults, validation, service filter, template URL. Unit-tested in `../test/admin-model.test.mjs`. |
| `js/api.js` | API client for the config API and the PH API proxy. |
| `js/auth.js` | Sign-in: Firebase Auth (Google or email and password), or a pasted token for local development. |
| `js/icons.js` | The Material Symbols names for the icon picker. |
| `tools/dev-server.mjs` | Everything on one local origin, in memory, loaded with the seed (below). |
| `test/editor.e2e.mjs` | End-to-end tests in Chromium against the dev server. |

## Run it locally

```bash
cd pharmacy-screen-promo-template/pharmacy-screen/admin
npm run dev       # http://localhost:8790/admin/  access token: dev-admin (dev-viewer is a signed-in non-admin)
npm test          # end-to-end tests (Playwright + Chromium, ~1 minute)
```

The dev server runs the config API and the PH API proxy in memory with the seed data, a local key standing in
for KMS, and a mock Location API answering from `../fixtures/campaign-data.json` for any saved token (devices
`DEVICE-VIC-MP-001` … `005`, `TEST`). It serves its own `config.js` in token mode; the deployed one uses
Firebase Auth.

## Deploying

Serve `pharmacy-screen/` statically (the editor imports `../js/` and `../css/`), with `/api/**` rewritten to
the two functions as their READMEs say (`config-api/README.md` → "Deploying", `ph-proxy/README.md`). Set
`auth.firebase` in `config.js` to the Firebase web app config, add the editor's origin to
`PS_ALLOWED_ORIGINS` / `PH_ALLOWED_ORIGINS` if it is served from a different origin than the API, and grant
admins the `admin` claim (`config-api/scripts/set-admin-claim.js`). Reset is offered only where
`seed/fixtures/` is served beside the editor. Wiring this into the one-command deploy is the "Deploy to our
test environment" ticket.
