# Admin editor (`admin/`)

The signed-in admin web app for the Pharmacy Screen Promo Template: the concept prototype's editor (v41),
saving to the config API instead of browser storage. Static ES modules, no build step, PH design system
(Roboto, Material Symbols, `#169bc2`). It renders the content frame only, with nothing `position: fixed`, so
it can be iframed into HQ Admin.

Spec: the project's requirements 7, 9-19 and 25 (the pharmacy view).

## What it edits

| Area | What | Saved through |
|---|---|---|
| Toolbar | **Promo preview** drop-down (the pharmacy whose content is edited and previewed, or the **Master template** first; otherwise the same list as Settings → Pharmacies) and the Settings / Back to promotions toggle | `GET /api/admin/pharmacies/{id}` |
| Master template | First entry of Promo preview: each promotion's default content, edited like a pharmacy's (no details or branding; preview in the default colours). A promotion with no master yet starts from a pharmacy's content (picked in the notice) until edited or **Save as master** | `PATCH /api/admin/promotions/{id}` (`master`) |
| Inheritance (on a pharmacy) | For a promotion with a master, each section (greeting, promotion slots, walk-in close, Open today bar; headlines, address; occasion copy) shows **Inherited from master** (read-only, `inert`) or **Managed separately**. **Edit for this pharmacy** makes it the pharmacy's own and shows a message that the master no longer reaches it; **Revert to master** inherits it again. A new pharmacy starts with the masters and inherits everything | `PUT …/content/{promotionId}`, then `PATCH /api/admin/pharmacies/{id}` (`detached`) |
| Promotions (shared by all pharmacies) | Tabs, New promotion (name, promo ID, template, including an occasion, and Schedule), rename, change promo ID (unique), Schedule (No schedule by default, or Annual with Starts / Ends dates that repeat every year; not on Seasonal, whose seasons have a Dates card), delete (click twice) | `/api/admin/promotions` |
| Template | Drop-down and the Edit HTML modal: built-ins read-only, Clone template, rename, delete (its promotions fall back to the built-in), portrait/landscape backgrounds, HTML with `${…}` token chips, scoped CSS, Reset to default | `/api/admin/templates` |
| Scenes (scenes templates) | Top: Greeting, one scene per service (rich-text headline, accent line, chip label, searchable Material Symbols icon, line 1, line 2), per-scene duration, drag-and-drop and up/down reorder, delete, Add promotion from the whole service library (searchable, grouped; Close adds nothing) or blank, a just-added promotion deleted with one click, Tail: Walk-in close, Footer: Open today bar (show toggle and four messages with `${CloseTime}` / `${OpenTime}`; "Open today bar in the preview" tabs show each message in the preview, preview only) | `PUT /api/admin/pharmacies/{id}/content/{promotionId}` |
| Opening hours (hours templates) | Three rich-text headlines, each with its seconds on screen (1–60; default 2.7, 2.7, 2.6), show address toggle | the same |
| Seasonal (occasion templates) | **Season** drop-down in place of Template (Christmas, New Year's, Australia Day, Valentine's Day, Easter, Anzac Day; shared by all pharmacies, it is the promotion's template and what plays outside every season's dates), then that season's **Dates** card (**Starts** / **Ends**, day and month, saved as `from` / `to`; its header reads **Every year: <start> to <end>**; Easter shows its worked-out Good Friday to Easter Monday instead; read-only in the pharmacy view: the same header, **Starts** / **Ends** as read-only fields, no pickers) and its beats (Christmas 2, the others 3; by default sharing a 12 s loop): each with its seconds on screen (1–60), a rich-text **Main line** and, where the design has one, a plain **Small line above** (Australia Day's last beat: **Line below**). The preview draws the standalone design; paused, it holds the selected beat. Each occasion keeps its own copy. Occasion templates have no Edit HTML (read-only, not cloneable) | `PATCH /api/admin/promotions/{id}` (occasion), `PUT …/content/{promotionId}` (copy) |
| Settings → Tokens | Every `${…}` token the pharmacy's promotions use (its own copy, the master template's sections it inherits, the Open today bar, template HTML; layout slots and the live `${StoreName}` / `${CloseTime}` / `${OpenTime}` excluded; `${StoreName}` is shown beside the Pharmacy name label in Pharmacy details), with the promotions using each and an input to set its value by hand (blank = the store's data, shown as the placeholder). Data tokens first, then the others by name; a value no promotion uses any more is still listed so it can be cleared (`model.js` `usedTokens`) | `PATCH /api/admin/pharmacies/{id}` (`tokens`) |
| Settings → Pharmacies | Pharmacy picker, Add pharmacy, Reset (launch pharmacies: back to the seed content), Delete (click twice) | `/api/admin/pharmacies` |
| Settings → Pharmacy details | Name, store code (unique, checked as you type and again by the API) | `PATCH /api/admin/pharmacies/{id}` |
| Settings → Branding | Primary and accent colours; logo (transparent PNG) upload, replace, remove | `PATCH …/{id}`, `PUT/DELETE …/{id}/logo` |
| Settings → Personalisation Hub API | API base URL and write-only token (Save / Replace / Remove; only its last 4 characters are ever shown) | `/api/settings/ph-api` |

**Pharmacy view** (`admin/?store=<store code>` or `?storeCode=`, read by `model.js` `storeFromQuery`): after
sign-in the editor is locked to that pharmacy (`S.lock` in `editor.js`, `applyLock`): the page is titled
"Display Promotions" and shows only the promotions. The toolbar (Promo preview and Settings) is hidden, so the
pharmacy's details, tokens and branding, Settings → Pharmacies and Personalisation Hub API are not reachable; its
content is edited as in the admin view. The grey promotion section (promotion name, promo ID, template, Edit HTML
and the `promo=` line) is not shown on Morning, Afternoon, Closed or any other non-occasion promotion
(`renderPromoMeta` hides `#promoMeta`); on the Seasonal promotion only the Season drop-down shows, the season's Dates card is read-only (Every year: start to end), and the drop-down can be
changed (it sets the shared promotion's season, as in the admin view). New / Delete promotion and the master template
are hidden, and every write handler for them returns early. Each inherited section's action reads "Edit"; every
scene's seconds-on-screen control is hidden (`hideTimings`: timings are set by an administrator); Add promotion is
hidden once a promotion has 3 slots (`PHARMACY_MAX_SLOTS`; the admin view allows 6); the `${Suburb}` hint
(`#dpHint`), "Remote config for this pharmacy" (`#cfgBox`) and the Copy experience URL / Playback duration row
under the preview (`#cpRow`, with its tooltip) are hidden; and "Restore to default"
replaces the "shared by all pharmacies" tag (`renderRestore` / `restoreDefaults`: two clicks, then the pharmacy's
content takes each master's copy and `detached` is cleared, so every section inherits again). An unknown store code shows "Pharmacy not found". It never writes the
remembered pharmacy. The OIDC sign-in keeps the page's query across the round trip (`auth.js`, `pending.back`).
The API is unchanged: it still requires the admin role for every call.

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
  of the frame and the editor the rest. Below a 920px frame (a tablet with the menu expanded: 1024 − 256 = 768px)
  the preview stays beside the editor and narrows to `clamp(240px, 38%, 360px)` (landscape `min(640px, 44%)`), so it
  never disappears below the editor; only a phone-sized frame (600px or less) puts the preview under the editor.
- Nothing wraps onto a second line. The promotion tabs stay on one line and scroll sideways when they don't fit,
  with left/right arrows and faded edges, and the selected tab is kept in view (also when the frame is resized).
  In a narrow editor column (700px or less) Reset, Settings and Edit HTML show as icons (their names stay in the tooltip and
  for screen readers); the pharmacy picker, the promo URL pill and the preview's sample-hours pill shorten with an
  ellipsis instead of pushing controls onto a new row.
- Nothing is `position: fixed`.
- The preview scrolls up with the page until its Portrait/Landscape tabs reach the very top of the frame, then
  stays there (`position: sticky; top: 0`) while the editor scrolls on. The preview screen is sized to the visible
  height (`100dvh`, falling back to `100vh`) less 190px for the scene bar, controls and Copy URL row, so the whole
  preview fits on a tablet with its browser bars showing.

`test/editor.e2e.mjs` checks this inside a stand-in PH shell (256px menu expanded, 70px collapsed) at 1280, 1440
and 1920px windows, toggling the menu back and forth with six extra promotions, and that with the menu expanded on
1024 and 1180px windows the preview stays beside the editor and in view in both orientations.

## Live preview

`../js/render.js` (the screen's own render engine) draws the selected promotion, fed the same config a screen
gets (`js/model.js` → `renderConfig()` maps the admin records). Portrait/Landscape tabs, the scene timeline
with total time, Play/Pause, click a scene to jump to its editor and focus an editor to show its scene, and
Copy experience URL (`pharmacy-screen.html?device=${UniqueDeviceID}&promo=<id>&orientation=<o>`, the full URL
in a wrapping tooltip on hover). Beside it, "Playback duration: Ns" is the number to enter in the campaign: the
promotion's total length plus one second, rounded up (`playbackSeconds()` in `js/model.js`), so the last scene
finishes. It updates live as scenes are added, removed or retimed, and its info icon's tooltip gives the campaign
setup steps (Creative tab → Experience URL → paste the URL, set the playback duration, save and activate). The
preview uses sample opening hours (`sampleCampaign()` in `js/model.js`: Monday to Friday 9:00–17:30, Saturday
9:00–13:00) and no suburb, and says so: the "Sample opening hours" pill beside Play (`#pvData`) with an info icon
(`#pvInfo`) whose tooltip (`#pvTip`) says each screen uses its own store's actual opening and closing hours from
Personalisation Hub, for the day and time the promotion plays. The tooltip opens from the left edge of the
controls row and is never wider than it, so it is not clipped in a narrow preview column.

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
