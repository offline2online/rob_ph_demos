# Admin user guide

For the people who set up pharmacies and their screen content. The editor opens inside Personalisation Hub:
**Pharmacy Promos** in HQ Admin and **Display Promotions** in Retail Admin. There is no separate sign-in: it
uses your Personalisation Hub sign-in, and signing out of Personalisation Hub closes it.

- **HQ Admin users with the `ADMIN` role are administrators**: the full editor, everything in this guide.
- **Retail Admin users are store users** for their own store: the [pharmacy view](#pharmacy-view) of that one
  pharmacy. They edit its copy of each promotion, choose which sections it manages itself and can **Restore to
  default**. They cannot see another pharmacy, the master template or Settings.
- Anyone else, or the editor's address (`https://<site>/admin/`) opened outside Personalisation Hub, sees
  "Access denied".

The Firebase sign-in is the fallback while `PS_ADMIN_AUTH=ph+firebase`: where the Personalisation Hub page hands no session over, the editor at `https://<site>/admin/` asks you to sign in with your work account, and you need the admin role or you see "Admin role required".

On an AWS installation you sign in at `https://<site>/admin/` with your work account (admin role). How sign-in
from Personalisation Hub works is in [PH-EMBED.md](PH-EMBED.md).

Edits **save as you type**: "Saving…" then "All changes saved" beside the title. If someone else saved the same
record after you opened it, the editor asks you to reload instead of overwriting their change. Every save is
recorded in the audit log.

The right-hand side is a **live preview** drawn by the screen's own code: Portrait and Landscape tabs, the
scene timeline with its total time, Play and Pause. Click a scene to jump to its fields; click into a field to
show its scene. The **Sample opening hours** label, on its own row under the Portrait and Landscape tabs, says the preview's hours are sample ones (Monday to
Friday 9:00 am to 5:30 pm, Saturday 9:00 am to 1:00 pm); its info tooltip explains that each screen uses its own
store's actual opening and closing hours from Personalisation Hub, for the day and time the promotion plays.
It stays beside the editor when Personalisation Hub's left menu is expanded (it just gets narrower), so you can
keep the menu open while you edit.

The editor has two pages. The **promotions** page (the one it opens on) has the **Promo preview** drop-down at
the top: pick a pharmacy there to edit and preview its copy for each promotion. **Settings** (the cog beside
it) holds everything about the pharmacies themselves (adding one, its details and its branding) and the
Personalisation Hub API. **Back to promotions** returns.

## Add a pharmacy

1. Open **Settings** and click **Add pharmacy** in the *Pharmacies* section.
2. Enter the **Pharmacy name** (shown on screens as `${StoreName}`) and the **Store code**. The store code
   must be exactly the store's `store_code` in Personalisation Hub (e.g. `VIC-MP-006`): that is how a screen
   finds its pharmacy. It is checked as you type and must be unique.
3. The pharmacy is created as soon as both are valid. Carry on editing; nothing is lost.
4. In Personalisation Hub, register the pharmacy's screens to that store and add them to the campaign
   ([DEPLOYMENT.md](DEPLOYMENT.md) → "Register screens in PH"). Nothing else is needed: the campaign URL is the
   same for every pharmacy.

In Settings, switch pharmacies with the *Pharmacies* picker; the promotions page's **Promo preview** drop-down
lists the same pharmacies and follows it. **Delete** asks you to click again to confirm. **Reset** puts a
launch pharmacy (VIC-MP-001 to 005) back to its sample content.

## Master template

The **Promo preview** drop-down's first entry, **Master template**, holds the default content of every promotion: the
greeting, the promotion slots, the walk-in close, the Open today bar, the opening-hours headlines and address
toggle, and the seasonal copy. Edit it like a pharmacy's content; the preview uses the default colours and shows the tokens as written, so
`${Suburb}`, `${StoreName}` and `${Phone}` appear in the copy exactly as typed ("Good morning, ${Suburb}",
"Phone ${Phone}"); `${CloseTime}` / `${OpenTime}` show the sample hours' times. A pharmacy's preview fills them in. Every pharmacy uses it, including each one you add, so a change here reaches every
screen that inherits it. Seasonal is the exception: the master's seasonal copy, dates and season are only where a
new pharmacy starts and what **Copy from master** copies; a change to them reaches no live store ([Seasonal](#seasonal)). A promotion with no master saved yet starts from a pharmacy's content (pick which one)
until you edit it or click **Save as master**.

On a pharmacy, each section of a promotion says where it comes from:

- **Inherited from master**: read-only here; edit it in the master template. **Edit for this pharmacy** makes it
  this pharmacy's own, starting from the master's copy. A message confirms the section is now managed
  separately: changes to the master no longer reach it.
- **Managed separately**: this pharmacy's own copy. **Revert to master** inherits the master's again (its own
  copy is replaced).

Name, store code, logo and colours are always each pharmacy's own.

## Branding and logo

In **Settings** → *Branding*, for the pharmacy picked in *Pharmacies*:

- **Primary** and **Accent** colours: the brand panel, text and highlights. Icon tiles use a brighter version
  of the primary automatically.
- **Upload logo**: a transparent PNG (or WebP), up to 2 MB.
  **Replace logo** or remove it the same way. Once Personalisation Hub's Location API returns a store logo,
  screens use that one instead.

## Promotions

Promotions are **shared by all pharmacies**: the tabs across the top. Each has a name, a **promo ID** (what the
campaign URL's `promo=` names) and a template. The defaults are Morning (`morning`), Afternoon (`afternoon`),
Closed (`closed`) and Seasonal (`occasions`). Each pharmacy fills in its own copy for each one.

- **New promotion**: Name, Promo ID (lower-case letters, digits and hyphens, unique), Template, **Schedule** →
  **Create promotion**. It appears for every pharmacy. Schedule is **No schedule** by default; choose **Annual**
  to give it a start and an end date (day and month, inclusive) that repeat every year. A Seasonal template has no
  Schedule here: its seasons have their own dates (Dates card).
- Change an existing promotion's **Schedule** under its promo ID and template (No schedule, or Annual with
  Starts / Ends). Personalisation Hub Core still decides when a campaign plays; the dates go out with the
  promotion's screen config.
- Rename it or change its promo ID in **Promotion name** / **Promo ID**. Changing a promo ID means changing
  the campaign URL in PH too.
- **Delete promotion** (click again to delete for all pharmacies).
- **Copy experience URL** beside the preview gives the exact campaign URL for this promotion and orientation (if
  your browser does not allow copying, the URL appears selected under the button: press Ctrl+C, or Cmd+C on a Mac);
  **Playback duration** is the number of seconds to enter in the campaign.

Which promotion plays when is set in Personalisation Hub's scheduling, not here.

On a screen, a promotion plays once through and then stays on its last scene until the screen moves on to its
next campaign; the next time it comes round, it plays from the start. A screen that shows only this one campaign
can loop it instead: add `&loop=1` to the end of its campaign URL. The preview here always loops.

## Promotion scenes (Morning, Afternoon and similar)

The scenes play in order:

| Part | What you edit |
|---|---|
| **Top: Greeting** | Headline (e.g. "Good morning,&lt;br&gt;${Suburb}"), the chips row title and subtitle, seconds |
| One scene per service | Headline, accent line, chip label, icon (searchable), line 1, line 2, seconds on screen |
| **Tail: Walk-in close** | Headline ("Walk in today"), accent line, line 1, line 2, seconds |
| **Footer: Open today bar** | Show or hide it, and its four messages: open, last 30 minutes, before opening, after closing |

**Add promotions from the service library**: click **Add promotion** under the scenes. The picker lists all 28
ready-made services (vaccinations, blood pressure checks, …), grouped by category and searchable. Pick one to
add it with its copy and icon, then adjust the copy for this pharmacy. **Blank promotion** adds an empty scene.
Service copy needs TGA advertising review before go-live.

- **Reorder** scenes by dragging, or with the up/down buttons.
- **Delete** a scene (click again to confirm; one you have just added deletes with one click).
- **Timings**: each scene has its own seconds on screen (1–60). The timeline and Playback duration update as
  you change them. The Closed headlines and every season beat have the same control.

**Copy tips**

- Headlines are rich text: bold, italic, regular weight, accent colour and line breaks.
- **+ Add token**, on the right of each headline's label, lists the tokens you can use: Store name, Suburb, Brand
  name, Store code, State, Phone number, Website, Languages spoken by store staff and Localised copy. Pick one to
  insert it where the cursor is (e.g. `${StoreCode}`). Store name, Suburb, Store code, State and Phone number come
  from the pharmacy and Personalisation Hub; Brand name, Website, Languages spoken and Localised copy show the
  value set for the pharmacy in **Settings → Tokens**, and nothing until one is set.
- `${Suburb}` becomes the store's suburb from Personalisation Hub. If a store has no suburb it disappears with
  the comma or line break before it.
- Bar messages use `${CloseTime}` and `${OpenTime}` (worked out in the store's time zone), e.g. "Open today until
  ${CloseTime}".
- To see each bar message in the preview, use **Open today bar in the preview** under the bar: Store's time (what
  screens do), While open, Last 30 minutes, Before opening or After closing. The message shown is marked "In
  preview". Clicking into a message you can edit shows it too; clicking anywhere else in the promotion goes back to
  the store's time. This only changes the preview: screens always show the message for the store's own time.
- Long headlines shrink automatically to stay inside the brand panel; if one becomes very small, shorten it.
- "Public Holidays: Please call to confirm" is always shown; you don't need to write it.

## Opening hours (Closed)

Three rotating **headlines** (e.g. "Sorry, we're closed", "Serving ${Suburb}"), each with its own seconds on screen
(1–60; by default 2.7, 2.7 and 2.6, an 8-second loop), and **Show address under phone**.
The weekly hours, the public holiday line and the phone number come from Personalisation Hub.

## Seasonal

The Seasonal promotion (`promo=occasions`) changes by itself through the year. Each season has dates, the same
every year: Christmas 15–27 December, New Year's 28 December–5 January, Australia Day 26 January, Valentine's
Day 14 February, Easter Good Friday to Easter Monday (Easter moves, so its dates are worked out each year) and
Anzac Day 25 April. On those dates, in the store's time zone, the screens play that season, and at midnight
they move on to the next season by themselves: nobody needs to change anything. To change a season's dates,
pick the season and set **Starts** and **Ends** in its **Dates** card (above its beats). The card's header shows
the schedule as it repeats, for example **Every year: 15 Dec to 27 Dec** (Easter: this year's Good Friday to
Easter Monday).

In place of Template, the Seasonal promotion has a **Season** drop-down: Christmas, New Year's, Australia
Day, Valentine's Day, Easter, Anzac Day. It picks the season you are editing and previewing, and the season the
screens play outside every season's dates. Each line shows the season's start and end dates in brackets after its
name, for example **Christmas (15 Dec – 27 Dec)** (one date for a one-day season: **Australia Day (26 Jan)**;
Easter shows this year's Good Friday to Easter Monday). They are the dates in the season's **Dates** card, and
change as soon as you change them there. The Season drop-down and the **Dates** card save to the pharmacy on
screen: only that pharmacy's screens follow. With **Master template** on screen they change only the master, which
is where a new pharmacy starts and reaches no live store. Each season is its own full-screen animation (Christmas: a lit tree; New Year's: fireworks;
Australia Day: the flag; Valentine's Day: rising hearts; Easter: bouncing eggs; Anzac Day: a dawn glow and a
poppy), with no logo, brand colours or Open today bar. Its copy plays as beats (Christmas has two, the others
three), each for its own seconds on screen; on the screen they play once and the last one stays. As installed
every season's beats take 7 seconds (the editor shows
**Loop 7s**): for each beat each pharmacy edits its seconds on screen (1–60), the **Main
line** and, where the design has one, the small label line. Set the campaign's playback duration to the one the
editor shows beside Copy experience URL (**8 seconds** with the installed timings). Every season keeps its own copy and dates, so
switching back and forth loses nothing. On a pharmacy the seasonal section reads **This pharmacy's own**: its season and every
season's copy, dates and timings belong to that pharmacy, and nothing done to the master template reaches them.
**Copy from master** (click twice) replaces the copy, dates and timings of the season on screen with the master's
as they are now. **Restore to default** leaves seasonal content alone. Use `${Suburb}` in any line, and `${StoreName}` in Christmas and New
Year's. A line that is too long is made smaller to fit. Anzac Day is commemorative: fades only.

## Templates

A template is the layout a promotion uses. Built-ins: **Promotion scenes**, **Opening hours** and the six
seasonal templates. Built-ins are read-only; seasonal templates can't be cloned.

1. Select the promotion and click **Edit HTML** beside its Template.
2. On a built-in, click **Clone template**, and give the copy a **Template name**.
3. Edit its **HTML**: click a token chip to insert it (`${Headline}`, `${Logo}`, `${Footer}`, …; the full list is in
   [DATA-CONTRACT.md](DATA-CONTRACT.md) → "Template tokens") and its **CSS** (applies only inside the screen).
   Scripts, frames and external styles are refused.
4. **Background**: upload a portrait and a landscape image (PNG, JPEG or WebP, up to 5 MB; 4 MB on AWS).
5. **Done**. **Reset to default** puts the HTML back to the built-in's.
6. Pick the template for any promotion in the Template drop-down: templates are reusable across promotions.

Deleting a custom template moves the promotions that used it back to the built-in of the same kind.

## Pharmacy view

Add a store code to the editor's link to open it for **one pharmacy only**:
`https://<site>/admin/?store=VIC-MP-002` (or `?storeCode=VIC-MP-002`). Retail Admin's **Display Promotions**
page opens this view for you, for your own store. The page is titled
**Display Promotions** and shows only that pharmacy's promotions and the live preview: there is no Promo preview
drop-down and no Settings. The link keeps working after a reload and after signing in again. A store code no pharmacy has shows
"Pharmacy not found"; the link without a store code opens the full editor as before.

In the pharmacy view:

- **Its own content is editable.** **Edit** makes any inherited section its own; edit every line, add
  promotions from the service library or blank, reorder and delete them, and **Revert to master** to inherit
  that section again. Edits save as you type and reach that pharmacy's screens as usual.
- **Restore to default**, at the top of the page in place of "shared by all pharmacies", puts every section of
  every promotion back to the master template ("Inherited from master") in one go. Click it twice: the second
  click discards the pharmacy's own changes. It is greyed out while every section already inherits. It leaves
  Seasonal alone: the season, its copy and its dates stay this pharmacy's own.
- **Timings are set by an administrator only.** No scene shows its seconds on screen (greeting, promotion slots,
  walk-in close, opening-hours headlines, season beats); the screens play the timings set in the full editor.
- **At most 3 promotion slots.** Add promotion is hidden once a promotion has 3 slots; delete one to add another.
- **Seasonal is the pharmacy's own.** The Season drop-down picks the season this pharmacy's screens play outside
  every season's dates, and the Dates card sets when each season plays by itself every year. Both, and the
  season's copy, belong to this pharmacy: changing them changes only its screens, and nothing an administrator
  does to the master template changes them. **Copy from master** (click twice) replaces the copy and dates of
  the season on screen with the master's as they are now.
- **No promotion settings on Morning, Afternoon or Closed.** The grey section with the promotion name, promo ID,
  template, **Edit HTML** and the `promo=` line is not shown on any promotion but Seasonal: they are shared by
  every pharmacy and only an administrator changes them, in the full editor.
- **Not shown**: the promotion name, promo ID and template section (except the Season drop-down), scene timings, Promo preview, Settings (the pharmacy's details, tokens and branding, the other pharmacies and
  the Personalisation Hub API settings), the master template, New promotion and Delete promotion, the
  "Use ${Suburb} in any line…" hint and "Remote config for this pharmacy" under the promotions, and **Copy experience
  URL** with the **Playback duration** and its info tooltip under the preview. An administrator sets the
  pharmacy's details, tokens and branding, and sets up the campaign, in the full editor.

The link narrows what the editor shows; it does not give anyone access. An administrator can open the pharmacy
view for any pharmacy. A Retail Admin user opens it for their own store without the admin role, and a store code
in the link that is not their store shows "Access denied" ([PH-EMBED.md](PH-EMBED.md)).

## Settings

**Settings** (the cog beside Promo preview) shows:

- **Pharmacies**: the pharmacy picker, **Add pharmacy**, **Reset** and **Delete** ("Add a pharmacy" above).
- **Pharmacy details**: name and store code. The name is the `${StoreName}` token, shown beside the
  **Pharmacy name** label: change the name here to change it on screens.
- **Tokens**: every `${…}` token this pharmacy's promotions and templates use, including the master template's
  sections it inherits, with the promotions that use each. Leave a token blank to show the store's own data
  (the placeholder says where it comes from: the suburb, phone number, state and store code from Personalisation
  Hub). `${StoreName}`
  (the Pharmacy name above) and `${CloseTime}` / `${OpenTime}` (today's hours, which change through the day) are
  filled in live and are not listed. Type a value to show it on this pharmacy's screens instead, for
  example when Personalisation Hub has the wrong suburb. A token only a custom template or your own copy uses
  (e.g. `${Website}`) shows nothing until it has a value here. Changes save as you type and show in the
  preview; clear the field to go back to the store's data. Available once the pharmacy is created.
- **Branding**: colours and logo ("Branding and logo" above).
- **Personalisation Hub API**: the **API base URL** and the **API token (x-api-key)**. The token is write-only;
  after saving you see only that it is set and its last 4 characters, with Replace and Remove. Usually set once
  by IT ([DEPLOYMENT.md](DEPLOYMENT.md) → "Set the PH API base URL and token").
