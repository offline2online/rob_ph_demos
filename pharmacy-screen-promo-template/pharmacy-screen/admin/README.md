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
| Master template | First entry of Promo preview: each promotion's default content, edited like a pharmacy's (no details or branding; preview in the default colours, with `${Suburb}`, `${StoreName}` and `${Phone}` shown as written: `previewPharmacy()` in `js/model.js`, preview only). A promotion with no master yet starts from a pharmacy's content (picked in the notice) until edited or **Save as master** | `PATCH /api/admin/promotions/{id}` (`master`) |
| Inheritance (on a pharmacy) | For a promotion with a master, each section (greeting, promotion slots, walk-in close, Open today bar; headlines, address) shows **Inherited from master** (read-only, `inert`) or **Managed separately**. **Edit for this pharmacy** makes it the pharmacy's own and shows a message that the master no longer reaches it; **Revert to master** inherits it again. A new pharmacy starts with the masters and inherits all of these. Seasonal content is not inherited: it is always the pharmacy's own (the Seasonal row below) | `PUT …/content/{promotionId}`, then `PATCH /api/admin/pharmacies/{id}` (`detached`) |
| Promotions (shared by all pharmacies) | Tabs, New promotion (name, promo ID, template, including an occasion, and Schedule), rename, change promo ID (unique), Schedule (No schedule by default, or Annual with Starts / Ends dates that repeat every year; not on Seasonal, whose seasons have a Dates card), delete (click twice) | `/api/admin/promotions` |
| Template | Drop-down and the Edit HTML modal: built-ins read-only, Clone template, rename, delete (its promotions fall back to the built-in), portrait/landscape backgrounds, HTML with `${…}` token chips, scoped CSS, Reset to default | `/api/admin/templates` |
| Scenes (scenes templates) | Top: Greeting, one scene per service (rich-text headline, accent line, chip label, searchable Material Symbols icon, line 1, line 2), per-scene duration, drag-and-drop and up/down reorder, delete, Add promotion from the whole service library (searchable, grouped; Close adds nothing) or blank, a just-added promotion deleted with one click, Tail: Walk-in close, Footer: Open today bar (show toggle and four messages with `${CloseTime}` / `${OpenTime}`; "Open today bar in the preview" tabs show each message in the preview, preview only) | `PUT /api/admin/pharmacies/{id}/content/{promotionId}` |
| Sales Promos (sale template) | The first tab (`model.js` → `orderPromotions`), with no promotion settings section and no Delete. Scene 1: headline lines 1 and 2, the brands (1–6: add, remove, reorder), caption line 1, caption line 2 worked out from the end date; scene 2: offer lead-in, value (1–99, with %), suffix, **End date** (a date picker, with its wording "Wednesday 2nd December" shown beside it), panel label; seconds per scene (hidden in the pharmacy view); Footer band (derived lines, or **Write my own**). "Sale has ended" on the tab and at the top once the end date is over at the store. The copy is the pharmacy's own (no Inherited / Managed separately bar) | `PUT /api/admin/pharmacies/{id}/content/{promotionId}` |
| Opening hours (hours templates) | Three rich-text headlines, each with its seconds on screen (1–60; default 2.7, 2.7, 2.6), show address toggle | the same |
| Seasonal (occasion templates) | **Currently active promotion** drop-down in place of Template (Fallback, Christmas, New Year's, Australia Day, Valentine's Day, Easter, Anzac Day): opens on what the pharmacy's screens play today (`model.js` `seasonOf`, the screen's `liveOccasion`, by the store's date, `model.js` `storeToday`; that line ends "· on display"), and picking one only previews and edits it (`occPick` in `editor.js`, never saved). **Activate on display** beside it (pharmacies only, not the master template) saves `content[<promotion id>].activation = {occasion, until}` (`activationUntil` in `js/render.js`: the season's scheduled end date; the Fallback during a season: that season's end; what the schedule plays anyway clears it) and reads **On display** when the one picked is already playing. The drop-down keeps one width (`.occ-pick` in `css/admin.css`), and in the pharmacy view takes the whole row (`.occ-only`), so the selected line is never squashed by the button. The Fallback shows a "When it plays" card and its three beats (2 s, 3 s, 2 s, fixed) instead of dates and seconds; a season shows then that season's **Dates** card (**Starts** / **Ends**, day and month, saved as `from` / `to` in the pharmacy's own content; its header reads **Every year: <start> to <end>**; Easter shows its worked-out Good Friday to Easter Monday instead; the same pickers in the pharmacy view) and its beats (Christmas 2, the others 3; seeded with seconds that total a 7 s loop, and sharing a 12 s loop when none are set): each with its seconds on screen (1–60), a rich-text **Main line** and, where the design has one, a plain **Small line above** (Australia Day's last beat: **Line below**). The preview draws the standalone design; paused, it holds the selected beat. Each occasion keeps its own copy. On a pharmacy the seasonal section is labelled **This pharmacy's own** (no Inherited / Managed separately toggle): its season, copy, dates and timings are never inherited live, and nothing done to the master reaches it. **Copy from master** (click twice; `copySeasonFromMaster` in `editor.js`) replaces the copy, dates and timings of the season on screen with the master's as they are now; it is disabled while the master has no seasonal copy. A pharmacy that has none of its own yet starts from what it plays (the master's), on the server before every write (`../config-api/src/seasonal.js` `ownSeasonal`) and in the editor (`model.js` `ownSeasonal`). Occasion templates have no Edit HTML (read-only, not cloneable) | `PUT …/content/{promotionId}` (a pharmacy's season, copy and dates), `PATCH /api/admin/promotions/{id}` (Master template: `templateId` and `master`) |
| + Add token | On the label row of every copy field, in the admin and pharmacy views (`rich-text.js`): the rich-text fields (each headline, the hours headlines, the seasonal Main lines, the Open today bar messages; `rt()`) and the plain ones (accent lines, Line 1 / Line 2, service chip labels, the seasonal Small line above / Line below; `pt()` / `bindPlainText()`): a menu of Store name, Suburb, Store code, State and Phone number (`ADD_TOKENS` in `js/tokens.js`; the store's data carries no "From Personalisation Hub" sub-line) that inserts `${Token}` at the caret (else at the end). Escape or a click elsewhere closes it. Under each copy field, the `${…}` tokens it uses as chips (`tokenChips`, any token name; hidden when none), updated as you type | the field's own save |
| Settings → Tokens | Every `${…}` token the pharmacy's promotions use (its own copy, the master template's sections it inherits, the Open today bar, template HTML; layout slots and the live `${StoreName}` / `${CloseTime}` / `${OpenTime}` excluded; `${StoreName}` is shown beside the Pharmacy name label in Pharmacy details; on screens it is the Location API's store name, the Pharmacy name only when that is blank), with the promotions using each and an input to set its value by hand (blank = the store's data, shown as the placeholder). Data tokens first, then the others by name; a value no promotion uses any more is still listed so it can be cleared (`model.js` `usedTokens`) | `PATCH /api/admin/pharmacies/{id}` (`tokens`) |
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
(`renderPromoMeta` hides `#promoMeta`); on the Seasonal promotion only the Currently active promotion drop-down and Activate on display show (each option is the season's name and its dates in brackets, "Christmas (15 Dec – 27 Dec)", in both views: `model.js` `seasonOptionLabel`, from the same `seasonDates` as the Dates card; `relabelSeasons` in `editor.js` updates them when a date changes). Seasonal is the pharmacy's own, as in the admin
view: the drop-down sets this pharmacy's season, the season's Dates card has the same **Starts** / **Ends** pickers
(Every year: start to end), both save to this pharmacy only, the section reads **This pharmacy's own**, and **Copy
from master** (click twice) takes the master's copy and dates for the season on screen. New / Delete promotion and the master template
are hidden, and every write handler for them returns early. Each inherited section's action reads "Edit"; every
scene's seconds-on-screen control is hidden (`hideTimings`: timings are set by an administrator); Add promotion is
hidden once a promotion has 3 slots (`PHARMACY_MAX_SLOTS`; the admin view allows 6); the `${Suburb}` hint
(`#dpHint`), "Remote config for this pharmacy" (`#cfgBox`) and the Copy experience URL / Playback duration row
under the preview (`#cpRow`, with its tooltip) are hidden; and "Restore to default"
replaces the "shared by all pharmacies" tag (`renderRestore` / `restoreDefaults`: two clicks, then the pharmacy's
content takes each master's copy and `detached` is cleared, so every section inherits again; seasonal content is
left alone: `detached` keeps `"occasions"` and the pharmacy keeps its own season, copy and dates). An unknown store code shows "Pharmacy not found". It never writes the
remembered pharmacy. The OIDC sign-in keeps the page's query across the round trip (`auth.js`, `pending.back`).
The link grants nothing: the server decides by the session. An administrator can open the pharmacy view for
any pharmacy. A Retail Admin session from Personalisation Hub is a store user: it always opens this view, for its
own store, without the admin role, and a store code in the URL that is not its own shows "Access denied". The
API holds a store user to the routes marked `store` in `../config-api/src/api.js` and to its own pharmacies
(`../config-api/src/service.js`); every other call still requires the admin role
([docs/PH-EMBED.md](../../docs/PH-EMBED.md)).

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
  for screen readers); the pharmacy picker and the promo URL pill shorten with an ellipsis instead of pushing
  controls onto a new row. The preview's "Sample opening hours" pill sits beside Play/Pause and always shows in
  full: the scene time has its own line under the scene bar, so the controls row only holds the two and fits one
  line in every preview column (in a column under 270px, such as a tablet frame's 240px one, Play/Pause shows as its
  icon, its name kept for screen readers).
- Nothing is `position: fixed`.
- The preview scrolls up with the page until its Portrait/Landscape tabs reach the very top of the frame, then
  stays there (`position: sticky; top: 0`) while the editor scrolls on. The preview screen is sized to the visible
  height (`100dvh`, falling back to `100vh`) less 274px for the tabs, the scene bar, the scene time, controls and Copy URL row, so the whole
  preview fits on a tablet with its browser bars showing.

`test/editor.e2e.mjs` checks this inside a stand-in PH shell (256px menu expanded, 70px collapsed) at 1280, 1440
and 1920px windows, toggling the menu back and forth with six extra promotions, and that with the menu expanded on
1024 and 1180px windows the preview stays beside the editor and in view in both orientations.

## Live preview

`../js/render.js` (the screen's own render engine) draws the selected promotion, fed the same config a screen
gets (`js/model.js` → `renderConfig()` maps the admin records). Portrait/Landscape tabs, the scene timeline
with total time, Play/Pause, click a scene to jump to its editor and focus an editor to show its scene, and
Copy experience URL (`pharmacy-screen.html?device=${UniqueDeviceID}&promo=<id>&orientation=<o>`, the full URL
in a wrapping tooltip on hover). In PH's content frame the Clipboard API is refused, so the button falls back
to the copy command on a selected text field (`copyText()` in `js/editor.js`); if that is refused too, the URL is
shown selected in a read-only field under the button (`#cpField`) for Ctrl+C / Cmd+C. Beside it, "Playback duration: Ns" is the number to enter in the campaign: the
promotion's total length plus one second, rounded up (`playbackSeconds()` in `js/model.js`), so the last scene
finishes. It updates live as scenes are added, removed or retimed, and its info icon's tooltip gives the campaign
setup steps (Creative tab → Experience URL → paste the URL, set the playback duration, save and activate). The
preview uses sample opening hours (`sampleCampaign()` in `js/model.js`: Monday to Friday 9:00–17:30, Saturday
9:00–13:00) and no suburb, and says so: the "Sample opening hours" pill (`#pvData`), under the preview directly to the right of
Play/Pause on the same row (`.controls .pvnote`, never shrunk, wrapped or cut short; nothing about it shows above the preview), with an info icon
(`#pvInfo`) whose tooltip (`#pvTip`) says each screen uses its own store's actual opening and closing hours from
Personalisation Hub, for the day and time the promotion plays. The tooltip opens above the controls row, from its
left edge and never wider than it, so it is not clipped in a narrow preview column or by the bottom of the frame.
The scene time ("1.1s / 11.0s · 5 scenes", `#tlTime`) is on its own line, right-aligned, under the scene bar.

## Files

| File | What it does |
|---|---|
| `index.html` | The page: sign-in gate, editor, Settings, Edit HTML dialog, preview. |
| `config.js` | Deployment settings: `apiBase`, `screenPage`, `auth` (`mode: 'ph'` with Personalisation Hub's origins in `auth.ph.parentOrigins` on our Firebase environment, the Firebase web config, or OIDC endpoints on AWS). Non-secret. |
| `css/admin.css` | The prototype's editor styles plus the sign-in gate and save status, laid out with container queries (see Layout above). The screen itself uses `../css/screen.css`. |
| `js/editor.js` | The editor: state, rendering, what each save sends, preview loop. |
| `js/save-queue.js` | The write queue: one chain of writes per record, debounced edits, the save-status pill's state, and `flush()` (waits for every write, including follow-ups, before the editor switches or deletes a pharmacy). |
| `js/rich-text.js` | Copy fields: rich text (headlines, bar messages: bold, regular, italic, accent, line break; `rt()`) and plain lines (`pt()`), each with + Add token and the tokens it uses. |
| `js/icon-picker.js` | The searchable Material Symbols picker for a service chip. |
| `js/model.js` | No DOM: admin records → render config, content defaults, validation, service filter, experience URL, playback duration, `editsSince()` (what changed while a create was in flight). Unit-tested in `../test/admin-model.test.mjs`. |
| `js/api.js` | API client for the config API and the PH API proxy. |
| `js/auth.js` | Sign-in. `auth.mode: 'ph'` (our Firebase environment): no sign-in of its own; the Personalisation Hub page that embeds the editor (HQ Admin or Retail Admin) hands over its session by `postMessage`, the server swaps it for a short editor session carrying the role (administrator, or store user for one store) and its stores, and anything else shows "Access denied" ([docs/PH-EMBED.md](../../docs/PH-EMBED.md)). The Firebase sign-in is the fallback while `PS_ADMIN_AUTH=ph+firebase` (`auth.ph.fallback: 'firebase'`). `auth.mode: 'firebase'`: Firebase Auth (Google or email and password); OpenID Connect with PKCE on AWS (Cognito or the retailer's identity provider, one Sign in button, tokens in this tab's session storage, silent refresh); or a pasted token for local development. |
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
`DEVICE-VIC-MP-001` … `005`, `TEST`). It serves its own `config.js` in token mode; the deployed one uses the
Personalisation Hub session (`auth.mode: 'ph'`; `npm run dev:ph` runs that mode locally, with `/__ph-host.html`
playing the PH page, and `npm run test:ph` tests it).

## Deploying

`npm run deploy` in `pharmacy-screen-promo-template/` publishes the editor with the screen on our test
environment (Firebase project `rob-ph-demos`; URLs in that folder's README). It stages `admin/` without its
`test/`, `tools/`, package files and README, publishes `seed/fixtures/` beside it (so Reset works), rewrites
`/api/**` to the two functions, and writes the published `config.js` with the project's Firebase web app
config and the sign-in `PS_ADMIN_AUTH` names: `ph` (`auth.mode: 'ph'`, sign-in from Personalisation Hub only),
`ph+firebase` (the default: the same, with `auth.ph.fallback: 'firebase'`) or `firebase` (`auth.mode: 'firebase'`);
see [docs/PH-EMBED.md](../../docs/PH-EMBED.md) and `docs/CONFIGURATION.md` → `PS_ADMIN_AUTH`. The committed
`config.js` keeps `firebase: null`. The Firebase sign-in is the fallback while `PS_ADMIN_AUTH=ph+firebase`: grant its admins the `admin`
claim (`config-api/scripts/set-admin-claim.js`). To serve it anywhere else, serve `pharmacy-screen/`
statically the same way, set `auth.firebase` in `config.js`, and add the editor's origin to
`PS_ALLOWED_ORIGINS` / `PH_ALLOWED_ORIGINS` if it is served from a different origin than the API.

On AWS (`../../aws/`), `npm run deploy:aws` serves the same staged files from S3 through CloudFront and writes
`config.js` with `auth.mode: 'oidc'` and the sign-in endpoints (Cognito's hosted sign-in, or the retailer's
provider). Admins are the members of the Cognito group `admin`, or carry the admin claim the stack names.
`../../aws/test/ui/admin-oidc.test.mjs` tests this sign-in in Chromium.
