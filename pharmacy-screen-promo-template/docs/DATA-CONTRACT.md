# Data contract

What the Pharmacy Screen reads from Personalisation Hub, what it stores, and what each screen shows when
something is missing. The code wins over this file; `pharmacy-screen/test/handover-docs.test.mjs` checks the
template token list below against `pharmacy-screen/js/tokens.js`.

```
PH player ──GET pharmacy-screen.html?device=${UniqueDeviceID}&promo=…&orientation=…──▶ static site
screen    ──GET /api/device/{device}/campaign_data──▶ PH API proxy ──GET {baseUrl}/location-api/device/{device}/campaign_data (x-api-key)──▶ PH
screen    ──GET /api/screens/{store_code}──▶ config API (published config, public, no secrets)
```

## 1. Location API (Personalisation Hub)

### Request (made by the proxy only)

```http
GET {baseUrl}/location-api/device/{UniqueDeviceID}/campaign_data
x-api-key: <PH API token, decrypted in the proxy's memory>
Accept: application/json
```

- `{baseUrl}`: each saved base URL in turn (Admin → Settings; default `https://ph.mipharmacy.net`), the last
  one that answered first, one request at a time, `PH_PROXY_TIMEOUT_MS` (8 s) each.
- `{UniqueDeviceID}`: the `device=` value of the campaign URL, which the PH player fills with the screen's own
  ID. The proxy accepts `[A-Za-z0-9._:-]`, 1–128 characters, and refuses an unswapped `${UniqueDeviceID}`
  without calling PH.
- PH maps the device to its display and store. The URL never carries a store code.

### Fields used

Only these are kept; the proxy drops everything else before answering the screen
(`pharmacy-screen/ph-proxy/src/location-proxy.js` → `trimCampaignData`).

| Field (under `data`) | Type | Used for |
|---|---|---|
| `store_location.store_code` | string | Which pharmacy's config to load (`/api/screens/{store_code}`) |
| `store_location.store_name` | string | The store name, `${StoreName}`: the Location API's value for this device wins; the config's pharmacy name is used only when it is blank |
| `store_location.store_timezone` | IANA zone, e.g. `Australia/Melbourne` | Store time for the "Open today" bar and today's hours (default `Australia/Melbourne` if empty) |
| `store_info.opening_hours[]` | array | Weekly hours and the bar state |
| `…opening_hours[].open_day` / `close_day` | `MONDAY` … `SUNDAY` | A session may close the next day (crossing midnight) |
| `…opening_hours[].open_time` / `close_time` | `HH:MM:SS`, store local time | |
| `…opening_hours[].is_active` | boolean | `false` sessions are ignored |
| special hours (PH's `specialHours[]`) | array | Dated exceptions to the weekly hours (Christmas Day closed, Christmas Eve 08:30-19:00), set in Personalisation Hub. Returned as `store_info.special_hours[]` (always present; `[]` when PH sends none): the first list found at `store_info.specialHours`, `store_info.special_hours`, `data.specialHours`, `data.special_hours`, `store_location.specialHours` (a list, or an object holding one as `specialHours`) |
| `…special_hours[].date` | `YYYY-MM-DD`, the store's own date | Must be a real date, or the entry is dropped |
| `…special_hours[].name` | string or `""` | PH's name for the day ("Christmas Eve", "Boxing Day"), shown beside the date; `""` shows the date alone (40 characters at most) |
| `…special_hours[].open` | boolean | `false`: closed all that date, whatever the weekly hours say. `true`: the times below replace that weekday's weekly hours for that date, even when they are the same. Anything but a boolean drops the entry |
| `…special_hours[].open_time` / `close_time` | `HH:MM` (PH's `openTime` / `closeTime`; `open_time` / `close_time` and `HH:MM:SS` accepted), or `null` when closed | An open entry without both drops. A close not after the open runs past midnight, as a weekly session does; two entries on one date are two sessions. PH's `appointmentSlots`, `storeId` and `schoolHolidays` are not kept |
| `store_info.address_info.suburb` | string | `${Suburb}`; blank removes the token with its leading comma or line break |
| `store_info.address_info.address` | string | Opening hours template ("show address") |
| `store_info.address_info.postcode`, `state` | string | Passed through; not drawn today |
| `store_info.address_info.phone_number` | string | `${Phone}`, the opening hours contact line |
| store logo | https or `data:image/…` URL | Returned as `store_info.logo_url` once the Location API provides one (PH-181): the first of `store_info.logo_url \| logo \| store_logo`, `store_location.logo_url \| logo \| store_logo`, `data.logo_url \| logo`. Until then the logo uploaded in the editor is used |

### Full sample response

Upstream (PH), for device `DEVICE-VIC-MP-001` (the mock data in `pharmacy-screen/fixtures/campaign-data.json`;
PH may send more fields, which are ignored):

```json
{
  "data": {
    "store_location": {
      "store_code": "VIC-MP-001",
      "store_name": "Beaumaris Pharmacy",
      "store_timezone": "Australia/Melbourne"
    },
    "store_info": {
      "opening_hours": [
        { "open_day": "MONDAY",    "open_time": "08:30:00", "close_day": "MONDAY",    "close_time": "19:00:00", "is_active": true },
        { "open_day": "TUESDAY",   "open_time": "08:30:00", "close_day": "TUESDAY",   "close_time": "19:00:00", "is_active": true },
        { "open_day": "WEDNESDAY", "open_time": "08:30:00", "close_day": "WEDNESDAY", "close_time": "19:00:00", "is_active": true },
        { "open_day": "THURSDAY",  "open_time": "08:30:00", "close_day": "THURSDAY",  "close_time": "19:00:00", "is_active": true },
        { "open_day": "FRIDAY",    "open_time": "08:30:00", "close_day": "FRIDAY",    "close_time": "19:00:00", "is_active": true },
        { "open_day": "SATURDAY",  "open_time": "09:00:00", "close_day": "SATURDAY",  "close_time": "13:30:00", "is_active": true }
      ],
      "specialHours": [
        { "name": "Christmas Eve",  "date": "2026-12-24", "open": true, "openTime": "08:30", "closeTime": "19:00", "appointmentSlots": 0 },
        { "name": "Christmas Day",  "date": "2026-12-25", "open": false },
        { "name": "Boxing Day",     "date": "2026-12-26", "open": false }
      ],
      "address_info": {
        "address": "1A East Concourse, Beaumaris",
        "suburb": "Beaumaris",
        "postcode": "",
        "state": "Victoria",
        "phone_number": "03 9589 2676"
      }
    }
  }
}
```

What the proxy returns to the screen (`GET /api/device/DEVICE-VIC-MP-001/campaign_data`):

```json
{
  "ok": true,
  "data": {
    "store_location": { "store_code": "VIC-MP-001", "store_name": "Beaumaris Pharmacy", "store_timezone": "Australia/Melbourne" },
    "store_info": {
      "opening_hours": [ { "open_day": "MONDAY", "open_time": "08:30:00", "close_day": "MONDAY", "close_time": "19:00:00", "is_active": true } ],
      "special_hours": [
        { "name": "Christmas Eve", "date": "2026-12-24", "open": true, "open_time": "08:30", "close_time": "19:00" },
        { "name": "Christmas Day", "date": "2026-12-25", "open": false, "open_time": null, "close_time": null }
      ],
      "address_info": { "suburb": "Beaumaris", "address": "1A East Concourse, Beaumaris", "postcode": "", "state": "Victoria", "phone_number": "03 9589 2676" },
      "logo_url": null
    }
  },
  "meta": { "server": "https://ph.mipharmacy.net", "fetchedAt": "2026-11-20T01:00:00.000Z", "cached": false }
}
```

(`opening_hours` and `special_hours` shortened here; every active session and every valid special entry is
returned. `specialHours` is where the mock data carries them, in the shape the account owner pasted for Beaumaris on
26 Nov 2026; where PH's real campaign_data carries them is not yet confirmed, hence the list of places above. If
`special_hours` is `[]` for a store that has special hours set in PH, PH's campaign_data does not include them yet.) The admin editor reads the same route for a
pharmacy's **Screen device ID** (Settings → Pharmacy details) and previews with this exact shape through the
screen's own `storeModel()`; it compares `store_location.store_code` with the pharmacy's store code before saving
the ID, and treats `DEVICE_NOT_FOUND` (404), `INVALID_DEVICE_ID` (400), `NOT_CONFIGURED` (503) /
`UPSTREAM_AUTH_FAILED` (502) and any other failure ("could not be reached") as its four messages
(`admin/js/model.js` → `lookupError`). `meta.fetchedAt` is shown as when the details were read. A session crossing midnight looks like
`{"open_day": "FRIDAY", "open_time": "18:00:00", "close_day": "SATURDAY", "close_time": "02:00:00"}`; fixture
device `TEST-LATE-NIGHT` has one, and `TEST-NO-SUBURB` has no suburb.

Mock devices in `fixtures/campaign-data.json` (used with `mockapi=1`, by the local dev server and by the
tests): `TEST`, `DEVICE-VIC-MP-001` … `DEVICE-VIC-MP-005`, `TEST-NO-SUBURB`, `TEST-LATE-NIGHT`. The local dev server
(`admin/tools/dev-server.mjs`) also knows `DEVICE-VIC-MP-006` (Brighton Pharmacy, a store no seeded pharmacy has,
for adding a pharmacy from its device ID) and the test site's Beaumaris device
`6890ee6121f42e90ded7baa4d80cc63b2a2b4eb4bfad71c88601712b5397aece`.

## 2. Promo IDs

A promotion is shared by every pharmacy: a name, a promo ID (the `promo=` value) and a template. Promo IDs
are 1–40 lower-case letters, digits and hyphens, unique across promotions.

| Promo ID | Name | Template | Plays |
|---|---|---|---|
| `sale` | Sales Promos (the first tab; a built-in: it can't be deleted and its promo ID and template are fixed) | Sales promo (`builtin-sale`, kind `sale`, reserved for this promotion) | Two scenes on the brand shell in the pharmacy's own colours and logo, a 10 s loop at the defaults (playback duration 11 s): **the brands** (headline in the wedge, 1–6 brand cards popping in, a caption; 3.5 s) and, after a 0.65 s transition in which the brand colour fills the screen above the footer band, **the offer** (rays, "UP TO", the value counting up from 0, "OFF", the pulsing end-date panel, the brand list; 5.85 s). The footer band shows the sale. Copy in `content[<promotion id>].sale` (below). It plays whatever its `endDate`: Personalisation Hub schedules it, and the end date is wording only |
| `morning` | Morning | Promotion scenes (`builtin-promotion-scenes`) | Greeting, service chips, one scene per service, "Walk in today" close; "Open today" bar |
| `afternoon` | Afternoon | Promotion scenes | The same, with afternoon copy |
| `closed` | Closed | Opening hours (`builtin-opening-hours`) | Rotating headlines, the full week's hours and, when the store has special hours in the next 90 days, its "Special hours" list (the nearest 6), "Public Holidays: Please call to confirm" (left out while that list is shown), phone |
| `occasions` | Seasonal | The Fallback and the six seasonal templates (published as the Fallback, or as the activated season while an activation runs) | A running "Activate on display" (`content[<promotion id>].activation`), else the season whose dates hold the store's date, else the Fallback (the pharmacy's brand colours, logo and name, "Thank you, ${Suburb}, for supporting your local pharmacy", exactly 7 s). For a season: its standalone animation, its copy as beats, each for its own seconds (seeded: 7 s of beats, playback duration 8 s; with no seconds set, 12 s and 13 s), played once with the last beat held; no "Open today" bar |

**Sales Promos copy** (`content[<promotion id>].sale`, every field optional; the screen fills a missing one from
the defaults, the Big Brand Sale): `headline1`, `headline2` (text), `brands` (1–6 names, at most 30 characters
each), `lead` ("UP TO"), `value` (whole number 1–99, shown with %), `suffix` ("OFF"), `caption` (caption line 1),
`endDate` (`"YYYY-MM-DD"`; its wording, "Wednesday 2nd December", is worked out from it and feeds caption
line 2, the panel and the footer; it never decides when the sale plays), `panelLabel` ("SALE FINISHES"), `s1` / `s2` (seconds of scene 1 and 2, 1–60;
the transition adds 0.65 s) and `footer` (`{custom: true, line1, line2}` only while the footer is written by hand).
The config API refuses a bad value (400). `sale` belongs to no master section: a pharmacy's own copy, once saved,
always wins, and the promotion's master supplies the copy of a pharmacy that has none (seeded: the Big Brand Sale).

Admins can add more (Admin → New promotion). Which promotion plays when is scheduled in Personalisation Hub
Core, not here: Morning, Afternoon, Sales Promos and Closed carry no schedule in the template or the editor; only
Seasonal plays by dates of its own (each season's). A promotion can carry a **Schedule**: No schedule (the default, nothing stored) or Annual, a start
and an end date (`"MM-DD"`, inclusive) that repeat every year. The dates are saved with the promotion and published
in its screen config (`schedule`) for scheduling; the screen itself still plays whatever promotion `promo=` names.

The screen plays the promotion once through and then holds its last scene (a Seasonal promotion: its last beat)
until the player loads its next campaign, so the campaign's playback duration only needs to cover one play-through
(the editor's Playback duration). It plays from the start again each time the page is loaded or shown again.
`loop=1` on the URL loops it forever instead ([CONFIGURATION.md](CONFIGURATION.md) → "Query parameters").

## 3. Template tokens

Copy and template HTML use Personalisation Hub's token format, `${TokenName}`.

**In copy** (headlines, accent lines, lines 1 and 2, service chip labels, the seasonal lines, bar messages):

| Token | Value |
|---|---|
| `${Suburb}` | `store_info.address_info.suburb`. With no suburb it is removed together with its leading comma and/or line break ("Good morning,<br>${Suburb}" → "Good morning") |
| `${StoreName}` | `store_location.store_name` from the Location API for this device (Christmas and New Year's sign-offs); the pharmacy's name from the editor only when the API has none |
| `${CloseTime}` | Close time of today's current or next session, e.g. `7PM` ("Open today" bar) |
| `${OpenTime}` | Open time of today's next session, e.g. `8.30AM` ("Open today" bar) |
| `${Phone}` | `store_info.address_info.phone_number` |
| `${State}` | `store_info.address_info.state`, e.g. `Victoria` |
| `${StoreCode}` | `store_location.store_code`, e.g. `VIC-MP-001` |

Every copy field in the editor has **+ Add token** on its label row, in the admin and the pharmacy views alike
(`pharmacy-screen/admin/js/rich-text.js`): the rich-text fields (each scene's headline, the hours headlines, the
seasonal beats' Main lines and the bar messages) and the plain ones (accent lines, Line 1 / Line 2, service chip
labels and the seasonal Small line above / Line below). It opens a menu of Store name (`${StoreName}`), Suburb, Store
code, State and Phone number that inserts the token at the caret, else at the end (`ADD_TOKENS` in
`pharmacy-screen/js/tokens.js`). The store-data entries have no "From Personalisation Hub" sub-line. Under each copy
field, the `${…}` tokens its copy uses are shown as chips, in order of first use and updated as you type (any token
name; the row is hidden when there are none). Brand name, Website, Languages spoken by store staff and Localised copy
are not in the menu; copy that already uses `${BrandName}`, `${Website}`, `${LanguagesSpoken}` or `${LocalisedCopy}`
still shows a value set for it in Settings → Tokens (they have no store data behind them, so nothing shows until one
is set).

**In a custom template's HTML** (Admin → Edit HTML shows these as chips; `TEMPLATE_TOKENS` in
`pharmacy-screen/js/tokens.js`):

| Token | Templates | Value |
|---|---|---|
| `${Logo}` | all | The pharmacy logo (Location API logo, else the uploaded one) |
| `${Headline}` | all | The scene's headline, sized to fit the brand panel |
| `${AccentLine}` | scenes | The accent line under the headline |
| `${Content}` | scenes | The scene body (tiles or icon, line 1, line 2) as the built-in draws it |
| `${Icon}` | scenes | The scene's large icon tile |
| `${ServiceLabel}` | scenes | The service chip label |
| `${Line1}` | scenes | Line 1 |
| `${Line2}` | scenes | Line 2 |
| `${Tiles}` | scenes | The row of icon tiles (greeting and close scenes) |
| `${Decor}` | occasion | Reserved: the occasion templates are drawn whole (`js/occasions.js`), so it renders as nothing |
| `${Footer}` | scenes | The "Open today" bar, or nothing when it is hidden |
| `${OpenToday}` | scenes | The bar's message text only |
| `${HoursCard}` | hours | The weekly opening hours card, plus its "Special hours" list (the nearest 6) when the store has special hours in the next 90 days |
| `${HolidayNote}` | hours | "Public Holidays: Please call to confirm", or empty while `${HoursCard}` shows the "Special hours" list |
| `${ContactLine}` | hours | Phone (and address when "show address" is on) |
| `${Chevron}` | all | The brand chevron graphic |
| `${ViewBox}` | all | SVG view box of the screen (`0 0 1080 1920` or `0 0 1920 1080`) |
| `${EdgePath}` | all | SVG path of the brand panel's edge (triangle or arrow) |
| `${Suburb}` | all | As above |
| `${StoreName}` | all | As above |
| `${Phone}` | all | `store_info.address_info.phone_number` |
| `${State}` | all | `store_info.address_info.state` |
| `${StoreCode}` | all | `store_location.store_code` |

**Set by hand.** A pharmacy can give any token a value of its own (Admin → Settings → **Tokens**, stored as
the pharmacy's `tokens`). A value set there wins over the store's data: `${Suburb}`, `${Phone}`, `${State}` and `${StoreCode}` show it
instead of the Location API's value, and any other token name (letters, digits and underscores, starting with a letter,
e.g. `${Website}`) used in copy or template HTML shows it instead of nothing. With a value set, `${Phone}` also
resolves in promotion copy. `${StoreName}` is always the store name from the Location API, falling back to the
Pharmacy name (Settings → Pharmacy details shows the token beside that field) when the API has none, and `${CloseTime}` / `${OpenTime}` are always today's times, so none of the three can be set
by hand (`LIVE_TOKENS` in `pharmacy-screen/js/tokens.js`); a value stored for one earlier is ignored by the screen
and dropped the next time the pharmacy is saved. The layout slots (`${Headline}`, `${Logo}`, `${Content}` and the
rest of the table above, other than `${Suburb}`, `${StoreName}`, `${Phone}`, `${State}` and `${StoreCode}`) cannot be set. Values are plain text, at most 200 characters, and at most 50 per
pharmacy.

Template HTML may not contain `<script>`, `<iframe>`, `<object>`, `<embed>`, `<frame>`, `<base>`, `<meta>`,
`<link>`, inline event handlers or `javascript:` URLs; template CSS may not contain `</style>`, `@import`,
`expression()` or `javascript:`. The API refuses them (they render on unattended public screens).

## 4. Per-pharmacy config schema

Stored by the config API (Firestore `pharmacyScreen/config/…` on Firebase, DynamoDB on AWS); every admin
record also has `version`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`. Full API:
`pharmacy-screen/config-api/README.md`.

```jsonc
// pharmacy
{
  "storeCode": "VIC-MP-001",              // 2-32 letters, digits, hyphens; stored upper-case; unique; must equal PH's store_code
  "name": "Beaumaris Pharmacy",           // admin label; ${StoreName} only when the Location API has no store_name
  "colours": { "primary": "#0f1050", "accent": "#5ee6b0" },
  "logo": { "path": "…", "url": "https://…", "contentType": "image/webp" },   // or null; set by the upload endpoint
  "content": {                            // keyed by promotion record id
    "<promotion id, scenes template>": {
      "greeting": "Good morning,<br>${Suburb}", "introTitle": "Three reasons to walk in", "introSub": "No fuss. Just ask in store.",
      "introDur": 3,
      "slots": [ { "label": "Blood pressure", "icon": "monitor_heart", "title": "Blood pressure checks",
                   "sub": "Free, as often as you like", "line1": "Know your numbers", "line2": "Pop in this morning", "dur": 2 } ],
      "close": { "title": "Walk in today", "sub": "Speak directly with a pharmacist", "line1": "…", "line2": "…", "dur": 2 },
      "footer": { "show": true,
                  "open": "Open today until <span class=\"acc\">${CloseTime}</span>",
                  "closing": "Closing soon · <span class=\"acc\">${CloseTime}</span>",
                  "before": "Opens today at <span class=\"acc\">${OpenTime}</span>",
                  "closed": "Closed now" }
    },
    "<promotion id, opening hours template>": {
      "headlines": ["Sorry, we're closed", "Serving ${Suburb}", "Public Holidays:<br><span class=\"reg\">Please call to confirm</span>"],
      "headlineDurs": [2.7, 2.7, 2.6],
      "showAddress": false
    },
    "<promotion id, occasion template>": {
      "activation": { "occasion": "christmas", "until": "2026-12-27" },  // optional, one-off: "Activate on display"
      "occasions": { "christmas": { "from": "12-15", "to": "12-27", "beats": [ { "text": "Merry Christmas, ${Suburb}", "dur": 3 }, { "label": "With warm wishes", "text": "from the whole ${StoreName} team", "dur": 4 } ] } /* one per occasion; Christmas 2 beats, the others 3 */ }
    }
  }
}
```

- Scene durations (`dur`, `introDur`) are 1–60 seconds; missing ones use the defaults (greeting 3 s, service 2 s,
  close 2 s). The Closed headlines' seconds are `headlineDurs[i]` (optional, `null` or missing for the default:
  2.7, 2.7, 2.6 for three headlines; part of the `headlines` master section). An occasion beat's seconds are its
  optional `dur`; missing ones share the design's 12 s loop equally (Christmas 6 s each, the others 4 s). The seed
  sets every beat's `dur` so each season's loop totals 7 s (`pharmacy-screen/seed/README.md` → "Season timings").
- Occasion beats: `text` is the main line (rich text), `label` the small label line, present only on the beats
  whose design has one. Copy saved in the earlier shape (`scenes[3]` of `title`, `sub`, `line1`, `line2`) still
  plays: unedited as the new defaults, edited beat by beat (`title` as the main line, `sub` as the label).
- Rich text (headlines, bar messages) keeps only bold, italic, line breaks and `<span class="reg">` /
  `<span class="acc">`; everything else is stripped.
- Content is bounded at 200 KB per promotion.
- Occasion keys: `fallback` (no dates, fixed beats of 2, 3 and 2 seconds: its `dur`, `from` and `to` are ignored),
  then the seasons `christmas`, `new-year`, `australia-day`, `valentines-day`, `easter`, `anzac-day`.
- `activation` (optional): `occasion` (an occasion key) and `until` (`YYYY-MM-DD`, the last day, in the store's
  time zone). Written by the editor's **Activate on display**: `until` is the scheduled end date of that season's
  current or next run by the pharmacy's dates (the Fallback during a season: that season's end). While the store's
  date is on or before `until` the screen plays `occasion`; after it, the schedule again, so it never carries into
  the next year. A malformed one is ignored (and not published). The older `season` field (the Season drop-down
  before 23 Nov 2026) may still be stored; it is not published and nothing reads it.
- Season dates: `from` and `to` (optional, `MM-DD`, inclusive, every year; `from` after `to` runs over New Year).
  Missing or invalid, the defaults apply: Christmas `12-15`–`12-27`, New Year's `12-28`–`01-05`, Australia Day
  `01-26`, Valentine's Day `02-14`, Easter Good Friday to Easter Monday (worked out for each year), Anzac Day
  `04-25`. The screen plays a running `activation`, else the season whose dates hold the store's date, else the
  Fallback.
- Seasonal content is each pharmacy's own (`config-api/src/seasonal.js`): its `activation` and every season's copy, dates and timings in `content[<promotion id>].occasions`, with
  `detached[<promotion id>]` always including `"occasions"` for a Seasonal promotion. The server gives a pharmacy
  without them its own copy of what it plays (the master's; `season` from the promotion's `templateId`) before and
  after every write, so a change to the master never reaches a live store. The master is only where a new pharmacy
  starts and what the editor's **Copy from master** copies.

Master template: a promotion's optional `master` holds the default content (the same shape as one entry of
`content` above) that every pharmacy inherits section by section; a pharmacy's optional
`"detached": { "<promotion id>": ["greeting", "slots", "close", "footer", "headlines", "address", "occasions"] }`
lists the sections it manages itself (its own `content` is used for those). Branding is never inherited, and
neither is seasonal content (`"occasions"` is always listed for a Seasonal promotion). The published screen config
below carries the resolved content only: for a Seasonal promotion its `template` is the season of a running
"Activate on display" (its `until` not yet past on the UTC date of the publish), else the Fallback
(`builtin-occasion-fallback`). The current screen decides from `content` (activation, else the season by the
store's date, else the Fallback); the template is what an older player, which does not read `activation`, plays.
`content` carries `activation` when one is set and well formed, and no `season`.

**Store segment.** Whether a pharmacy shows these promotions at all is decided in Personalisation Hub, not here:
the campaign that plays `promo=occasions` is targeted at the promotion store segment. A pharmacy in the segment
plays the schedule above (and the Fallback between seasons); a pharmacy outside it is not sent the campaign, so its
screens play whatever else Personalisation Hub schedules for them.

Tokens set by hand: a pharmacy's optional `"tokens": { "<token name>": "<text>" }` (section 3, "Set by hand");
blank values are dropped and the field is left out when none are set. The published screen config carries it
as it is.

Promotion: `{ "name", "promoId", "templateId", "schedule"?, "master"? }`, where `schedule` is `{ "type": "none" }`
(the default; nothing is stored) or `{ "type": "annual", "from": "MM-DD", "to": "MM-DD" }`. Custom template: `{ "name", "kind", "basedOn", "html", "css",
"backgrounds": { "portrait", "landscape" } }`. Service (library slot): `{ "label", "icon", "category",
"headline", "accent", "line1", "line2", "offeredBy": [store codes] }`.

### Published screen config (what a screen reads)

`GET /api/screens/{storeCode}`: public, no sign-in, no secrets, cached 5 s. Rebuilt in the same transaction
as every write that affects it, copied field by field (`config-api/src/publish.js`):

```json
{
  "schemaVersion": 1,
  "storeCode": "VIC-MP-001",
  "name": "Beaumaris Pharmacy",
  "colours": { "primary": "#0f1050", "accent": "#5ee6b0" },
  "logo": "https://…/pharmacyScreen/media/logos/…webp",
  "promotions": {
    "morning": {
      "promoId": "morning",
      "name": "Morning",
      "template": { "id": "builtin-promotion-scenes", "name": "Promotion scenes", "kind": "promotion-scenes", "builtIn": true,
                    "html": "", "css": "", "backgrounds": { "portrait": null, "landscape": null } },
      "content": { "greeting": "Good morning,<br>${Suburb}", "slots": [], "close": {}, "footer": {} }
    }
  },
  "tokens": { "Suburb": "Beaumaris" },
  "publishedAt": "2026-11-20T01:00:00.000Z"
}
```

`tokens` is present only when the pharmacy has set a token by hand. A promotion's `schedule`
(`{ "type": "annual", "from": "MM-DD", "to": "MM-DD" }`) is present only when it has an annual schedule.

## 5. PH API token

| | |
|---|---|
| Set | Admin → Settings → Personalisation Hub API → API token (admin role) |
| Read back | Never. `GET /api/settings/ph-api` returns `token: {set, last4, setAt, setBy}` only |
| At rest | AES-256-GCM with a fresh data key; the data key wrapped by KMS (Cloud KMS on Firebase, AWS KMS on AWS); the record holds `{ciphertext, iv, tag, wrappedKey, keyId, keyVersion}` and `last4` |
| Decrypted | Only in the proxy function, in memory, cached up to 15 s |
| Sent | Only to PH as `x-api-key`, never to a screen, a browser or a log |
| Audit | Every save, replace and remove: actor and last 4 only |

## 6. Error states

### What each screen shows

| Situation | Proxy / API answer | Screen shows |
|---|---|---|
| No `device`, or an unswapped `${UniqueDeviceID}`, or a malformed ID | `400 INVALID_DEVICE_ID` | "Invalid screen URL" |
| PH does not know the device | `404 DEVICE_NOT_FOUND` | "Screen not set up" in the brand panel, with the device ID at the bottom (register the device in PH) |
| The store has no config (no pharmacy with that store code) | `/api/screens/{code}` 404 | "Screen not set up" ("Store VIC-MP-00X has no screen content yet.") |
| `promo=` names no promotion | | "Promotion not found" |
| Every server fails and nothing is cached | `502 UPSTREAM_UNAVAILABLE`, network errors | "Screen data could not load" with a red "Offline · retrying" badge; it keeps polling |
| Every server fails but the screen has data | | The last good screen, unchanged (kept in memory and `localStorage`); the debug panel shows the failures |
| No token saved | `503 NOT_CONFIGURED` | "Screen data could not load" (or the last good screen) |
| PH refuses the token on every server | `502 UPSTREAM_AUTH_FAILED` | The same; replace the token in Settings |
| Token can't be decrypted | `503 TOKEN_UNREADABLE` | The same; save the token again |
| Rate limit with a recent answer | `200`, `meta.stale: true` | The store as last known |
| Rate limit with no recent answer | `429 RATE_LIMITED` + `Retry-After` | The last good screen, or "Screen data could not load" |

### Proxy errors (`{ "ok": false, "error": { "code", "message" } }`)

| Status | Code | Meaning |
|---|---|---|
| 400 | `INVALID_DEVICE_ID` | Missing or malformed device ID |
| 400 | `INVALID_BASE_URL`, `INVALID_TOKEN`, `INVALID_BODY` | Settings input refused (https only, at most 5 URLs; token 8–4096 characters, no spaces) |
| 401 | `UNAUTHENTICATED` | Settings call without a valid sign-in |
| 403 | `FORBIDDEN` | Signed in without the admin role |
| 404 | `DEVICE_NOT_FOUND` | PH does not map this device to a store |
| 429 | `RATE_LIMITED` | Over a rate limit with no recent answer |
| 502 | `UPSTREAM_AUTH_FAILED` | Every PH server refused the token |
| 502 | `UPSTREAM_UNAVAILABLE` | No PH server answered |
| 503 | `NOT_CONFIGURED` | No token saved |
| 503 | `SECRET_STORE_NOT_CONFIGURED` | No KMS key configured (`PH_TOKEN_KMS_KEY`) |
| 503 | `TOKEN_UNREADABLE` | The stored token could not be decrypted |

### Config API errors (`{ "error": { "code", "message" } }`)

400 `invalid-request`, 401 `unauthenticated`, 403 `forbidden` / `read-only` (built-in templates), 404
`not-found` / `unknown-promo`, 405, 409 `duplicate-store-code` / `duplicate-promo-id` / `version-conflict`,
413 `too-large`, 415 `unsupported-media-type`. On AWS, a promotion or template edit that would republish more
than about 90 pharmacies in one transaction is refused with `too-many-writes` before anything is written.
