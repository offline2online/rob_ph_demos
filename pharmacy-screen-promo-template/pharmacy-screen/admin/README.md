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
| Promotions (shared by all pharmacies) | Tabs, New promotion (name, promo ID, template, including an occasion), rename, change promo ID (unique), delete (click twice) | `/api/admin/promotions` |
| Template | Drop-down and the Edit HTML modal: built-ins read-only, Clone template, rename, delete (its promotions fall back to the built-in), portrait/landscape backgrounds, HTML with `${…}` token chips, scoped CSS, Reset to default | `/api/admin/templates` |
| Scenes (scenes templates) | Top: Greeting, one scene per service (rich-text headline, accent line, chip label, searchable Material Symbols icon, line 1, line 2), per-scene duration, drag-and-drop and up/down reorder, delete, Add promotion from the whole service library (searchable, grouped; Close adds nothing) or blank, a just-added promotion deleted with one click, Tail: Walk-in close, Footer: Open today bar (show toggle and four messages with `${CloseTime}` / `${OpenTime}`) | `PUT /api/admin/pharmacies/{id}/content/{promotionId}` |
| Opening hours (hours templates) | Three rich-text headlines, show address toggle | the same |
| Occasions (occasion templates) | **Occasion** drop-down in place of Template (Christmas, New Year's, Australia Day, Valentine's Day, Easter, Anzac Day; shared by all pharmacies, it is the promotion's template), then that occasion's Greeting, Message and Sign-off (rich-text headline, accent line, line 1, line 2, seconds on screen) and the Open today bar. Each occasion keeps its own copy. Occasion templates have no Edit HTML (read-only, not cloneable) | `PATCH /api/admin/promotions/{id}` (occasion), `PUT …/content/{promotionId}` (copy) |
| Settings | Store record read from the Location API through the proxy for a device ID (read-only, with field paths); Personalisation Hub API base URL and write-only token (Save / Replace / Remove; only its last 4 characters are ever shown) | `GET /api/device/{id}/campaign_data`, `/api/settings/ph-api` |

Edits save as you type (debounced, about half a second), with "Saving… / All changes saved" beside the title.
Every write carries the record's version (`If-Match`), so an edit made on top of another admin's newer save
is refused (409) and the editor asks you to reload instead of overwriting it. The server checks the admin
role on every call and writes an audit entry for every save; nothing is kept in browser storage except view
preferences (orientation, last pharmacy, last device ID looked up per store).

A new pharmacy is created as soon as its name and store code are valid. You can keep editing while that
request runs: when it finishes, whatever you changed in the meantime (details, and any promotion's content)
is saved to the new pharmacy, and the pill stays on "Saving…" until it has. Switching or deleting a pharmacy
waits for every save in flight first.

A pharmacy's content is stored per promotion record id. Switching a promotion to a template of the other kind
keeps the content of both kinds (a content object can hold `slots` and `headlines`), so switching back loses
nothing.

## Layout in the Personalisation Hub frame

The editor is shown in Personalisation Hub's content area, beside the left-hand menu, so its width changes when
the menu is expanded or collapsed. It lays itself out to the width of that frame, not the browser window, and
adjusts as soon as the menu changes, with no reload:

- CSS container queries, no viewport media queries: `body` is the frame container (`frame`), the editor column
  (`.edcol`) and the preview (`.pv`) are containers of their own. The preview column takes `clamp(360px, 36%, 400px)`
  of the frame and the editor the rest; below a 920px frame the preview moves under the editor.
- Nothing wraps onto a second line. The promotion tabs stay on one line and scroll sideways when they don't fit,
  with left/right arrows and faded edges, and the selected tab is kept in view (also when the frame is resized).
  In a narrow editor column (700px or less) Reset, Settings and Edit HTML show as icons (their names stay in the tooltip and
  for screen readers); the pharmacy picker, the promo URL pill and the preview's store-data pill shorten with an
  ellipsis instead of pushing controls onto a new row.
- Nothing is `position: fixed`.

`test/editor.e2e.mjs` checks this inside a stand-in PH shell (256px menu expanded, 70px collapsed) at 1280, 1440
and 1920px windows, toggling the menu back and forth with six extra promotions.

## Live preview

`../js/render.js` (the screen's own render engine) draws the selected promotion, fed the same config a screen
gets (`js/model.js` → `renderConfig()` maps the admin records). Portrait/Landscape tabs, the scene timeline
with total time, Play/Pause, click a scene to jump to its editor and focus an editor to show its scene, and
Copy experience URL (`pharmacy-screen.html?device=${UniqueDeviceID}&promo=<id>&orientation=<o>`, the full URL
in a wrapping tooltip on hover). Beside it, "Playback duration: Ns" is the number to enter in the campaign: the
promotion's total length plus one second, rounded up (`playbackSeconds()` in `js/model.js`), so the last scene
finishes. It updates live as scenes are added, removed or retimed, and its info icon's tooltip gives the campaign
setup steps (Creative tab → Experience URL → paste the URL, set the playback duration, save and activate). Store data comes from the device looked up in Settings; until one is, the
preview uses sample hours and no suburb, and says so.

## Files

| File | What it does |
|---|---|
| `index.html` | The page: sign-in gate, editor, Settings, Edit HTML dialog, preview. |
| `config.js` | Deployment settings: `apiBase`, `screenPage`, `auth` (Firebase web config, or OIDC endpoints on AWS). Non-secret. |
| `css/admin.css` | The prototype's editor styles plus the sign-in gate and save status, laid out with container queries (see Layout above). The screen itself uses `../css/screen.css`. |
| `js/editor.js` | The editor: state, rendering, what each save sends, preview loop. |
| `js/save-queue.js` | The write queue: one chain of writes per record, debounced edits, the save-status pill's state, and `flush()` (waits for every write, including follow-ups, before the editor switches or deletes a pharmacy). |
| `js/rich-text.js` | Rich-text fields (headlines, bar messages): bold, regular, italic, accent, line break. |
| `js/icon-picker.js` | The searchable Material Symbols picker for a service chip. |
| `js/model.js` | No DOM: admin records → render config, content defaults, validation, service filter, experience URL, playback duration, `editsSince()` (what changed while a create was in flight). Unit-tested in `../test/admin-model.test.mjs`. |
| `js/api.js` | API client for the config API and the PH API proxy. |
| `js/auth.js` | Sign-in: Firebase Auth (Google or email and password); OpenID Connect with PKCE on AWS (Cognito or the retailer's identity provider, one Sign in button, tokens in this tab's session storage, silent refresh); or a pasted token for local development. |
| `js/icons.js` | The Material Symbols names for the icon picker. |
| `tools/dev-server.mjs` | Everything on one local origin, in memory, loaded with the seed (below). For tests it also returns `downHosts` (add a PH base URL's host and the mock Location API refuses it: failover) and `logLines` (every line the config API and the proxy logged). Used by `test/editor.e2e.mjs` and `../test/e2e/full-stack.test.mjs`. |
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

`npm run deploy` in `pharmacy-screen-promo-template/` publishes the editor with the screen on our test
environment (Firebase project `rob-ph-demos`; URLs in that folder's README). It stages `admin/` without its
`test/`, `tools/`, package files and README, publishes `seed/fixtures/` beside it (so Reset works), rewrites
`/api/**` to the two functions, and writes the published `config.js` with the project's Firebase web app
config (`auth.mode: 'firebase'`). The committed `config.js` keeps `firebase: null`. Grant admins the `admin`
claim (`config-api/scripts/set-admin-claim.js`). To serve it anywhere else, serve `pharmacy-screen/`
statically the same way, set `auth.firebase` in `config.js`, and add the editor's origin to
`PS_ALLOWED_ORIGINS` / `PH_ALLOWED_ORIGINS` if it is served from a different origin than the API.

On AWS (`../../aws/`), `npm run deploy:aws` serves the same staged files from S3 through CloudFront and writes
`config.js` with `auth.mode: 'oidc'` and the sign-in endpoints (Cognito's hosted sign-in, or the retailer's
provider). Admins are the members of the Cognito group `admin`, or carry the admin claim the stack names.
`../../aws/test/ui/admin-oidc.test.mjs` tests this sign-in in Chromium.
