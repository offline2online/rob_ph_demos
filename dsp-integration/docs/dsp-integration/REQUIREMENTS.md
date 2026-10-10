# Display Types & DSP Integration — Requirements

Source: *Real-Time Personalised Surface Architecture Specification v1.2*
(Personalisation Hub, 3 Sept 2026), as rescoped 29–30 Sep 2026, plus the `Display Types & Playlist
Management` prototype (`displaytypesandplaylists.jsx`).

**Version:** 8 Oct 2026 (dated, not numbered). Scope follows the 29–30 Sep
2026 rescope to "the exchange", recorded as E2E Test Spec v2.4 (30 Sep); this
file never carried a version number of its own, and this changelog starts the
record.

**Changelog**

- **8 Oct 2026** — the windowed auction is retired (decision Rob; ticket
  SNSgusJ3spY5ljqooiwa, code in f11bb1f, migration 0059). There is **no
  company auction schedule** (`auctionOpensHours`, `auctionCutoffTime`), **no
  company play-window length** (`playWindowHours`, with its pending and
  deferred-change bookkeeping) and **no per-slot bid mode** (`bidMode`,
  advance | realtime). A position nobody holds a deal on is sold in real
  time, per impression. Only a position held for named advertisers
  (reserve) or assigned to a private auction (a buyers list) takes window
  bookings and bids. A window's length is the billing unit: the slot's
  `billingUnitHours`, else the display type's default, else a platform
  default of 24 hours (a named constant, not a setting). A window can be
  booked or bid on until it starts, or until a private auction has cleared
  it; what governs a deal is the buyers list's `activeFrom` / `activeTo` /
  `auctionCloses`. Mentions below of an auction opening, an auction cutoff,
  a company auction schedule, a company play window or an advance bid mode
  are superseded.
- **7 Oct 2026** — bid floor becomes a three-level hierarchy (Rob; ticket
  kqsRTYmg1tAYww1vgHMs, build DIlKVuz9yiFANxKz23yP, lists
  w0Iu6g6efYGjA3U6J1Nv): a **platform floor** (Advertiser settings, advanced),
  a **DSP floor** per connected DSP and a **buyers and targeting list floor**
  per list. The most specific floor that is set applies, a blank level
  inherits from the level above, and the platform floor is the minimum.
  Every description of a single base floor or a platform-only floor below is
  rewritten to point at §4 "The floor hierarchy".
- **7 Oct 2026** — the per-slot "Targeting supported" setting is removed
  (Rob; tickets HmJuWvvVTEZ0l3aUuwA9 and V391ZSMOfIhSQXc4bPT3). A slot no
  longer says which kinds of campaign it takes: what a buyer may target is
  defined on the buyers and targeting list, not on the slot. The column is
  gone from Available Inventory, `supportedTargeting` is gone from the
  position in `GET /v1/inventory`, `GET`/`PUT /admin/v1/available-inventory`
  and the slot, and any stored value is ignored. Two rules stay: a
  personalised campaign is accepted only in a `type: reserve` booking or on
  a deal (refused `targeting_not_supported` on an open real-time position), and interactive remains
  deferred. Mentions of the setting below this note are superseded.
- **5 Oct 2026** — interactive campaigns deferred for this release (Rob;
  ticket B2FBG5Ro9yqrcH3xICFz): the focus is the basic framework. They are
  hidden everywhere behind one flag, `INTERACTIVE_ENABLED` (false, in
  `packages/types` catalog), rather than deleted, so they can return. No
  Interactive cost per engagement field, tooltip or lever; no Interactive
  targeting option; no
  interactive reserve price column or QR Control greying on Available
  Inventory; no interactive effective floor, `costPerEngagement` or
  interactive reserve price on `GET /v1/inventory`; a campaign submission
  with an interactive layer, and any bid or reservation for one, is refused
  `targeting_not_supported`. QR Control stays a display-type feature in its
  own right. The stored `interactiveCpe` is kept untouched. Sections 4, 5,
  8 and the functional requirements below describe the deferred behaviour
  only as "deferred"; the earlier interactive wording is superseded.
- **8 Oct 2026** — personalised targeting is sold on deals as well as
  reserve bookings (Rob; ticket IYNdMlPtQ7rhplRwbK0q). The whole
  Personalisation Variables group (§6) is targetable on all three deal types
  (private_auction, preferred, guaranteed) and on reserve bookings, but stays
  out of the open real-time auction: an open or whitelist-only bid carrying a
  personalised rule is still refused `targeting_not_supported`, because the
  per-impression path cannot resolve personalised targeting and render
  approved creative inside `bidLookaheadSeconds`. A guaranteed deal with
  personalised targeting commits from the TARGETED assumed views, not the
  slot's whole VAC-d, so `floor(forecast × (1 − buffer%))` never
  over-commits. `booking.personalisedEligible` is true for a reserve-held
  window and for a deal-held window whose campaign is personalised. Supersedes
  the 5 Oct entry below and the "reserve only" wording in §4, §5 and §6.
- **5 Oct 2026** — (superseded 8 Oct: now also on deals) personalised versions are sold only through reserved
  slots (Rob; ticket Ba5QdLIzCbJGMHfawjAP): a personalised
  campaign is refused (`targeting_not_supported`) outside a `type: reserve`
  booking, and only a reserve-held window plays personalised versions
  (migration 0045). Reserve price tooltip updated.
- **2 Oct 2026** — seams and repositories awaitable, with a per-database
  transaction lock on SQLite, and the SQL made portable to Postgres
  (cUdX4dmT / gAi2mkcm; 9f51d91, 944fd91). Booking schedule numbers a
  multi-zone slot within its zone (`zoneName` / `zoneSlot`); every
  auto-created playlist starts with default settings (A0GyTNsA items 2–3,
  3gGKowhK).
- **1 Oct 2026 (later)** — interface contract v3 adopted (5kIApxS1; 5eb205c);
  a slot's Max campaigns enforced at bid and reservation, `maxCampaigns` on
  the Partner API position (sa1tXvaw; fcb25bc); venue stays on the display
  type as the POC stand-in for PH Core's value (fnaXoT6S; c3e3d4f);
  booking-schedule reach counts removed (GyBfGm4k; b94aa77).

- **5 Oct 2026** — personalised multiplier removed (supersedes the 30 Sep
  entry below): every play bills at the committed CPM, whichever version
  played; there is no personalised price anywhere. The bid floor and the
  advertiser floor multiplier are unchanged.

- **1 Oct 2026** — default VAC-d per display type with per-display override
  (`phExtensions.defaultVacd`, `displays.vacd_override`, migration 0035);
  reconciliation edits from the Scope & Seam Reconciliation Review (floor
  wording, §8 models, API surface, venue/geo and visitor-variable ownership).
- **30 Sep 2026** — personalised multiplier charged per play, not a floor
  (removed 5 Oct 2026); per-play version tier supplied by PH Core; unscored slots excluded from
  inventory, forecast and auction; sales lock (`salesLocked`); auth seams.
- **29 Sep 2026** — decisions of 29 Sep (Q35 venue/geo is PH Core's, Q43/Q44).
- **22 Sep 2026** — part-sold model retired.
- **21 Sep 2026** — project folder renamed to `dsp-integration/`.

## Scope

This specification covers these areas, and only these:

1. **Updates to the existing Display Types section** of HQ Admin (§1).
2. **Playlist management**: editing and deleting playlists only (§2).
3. **Campaign asset approval**: advertisers submit campaign assets, and the
   retailer approves them in the **existing Campaigns section** where the
   advertiser requires approval. Whether an advertiser requires approval, and
   its floor multiplier, are set on a new admin-only **Advertisers** screen (§3).
4. **Pricing**: the currency, the three-level CPM bid floor (platform, DSP,
   buyers and targeting list), audience scoring and a floor multiplier
   per advertiser (§4).
5. **Inventory API**: what inventory exists and what is available, derived
   from the slots assigned on each display type (§5).
6. **DSP integration**: the advertiser/DSP interface and the shared targeting
   variables DSPs may use (§6), with Personalisation Hub acting as the
   supply-side platform (§7).
7. **Analytics schema, measurement and cross-instance federation —
   foundation only** (§9): a versioned canonical event schema, computer
   vision as a measurement source, a source-instance identifier and an
   agent-to-agent platform interface. All four are spec-only groundwork
   agreed at the 22 Sep 2026 DSP analytics strategy session — none of it is
   built this release.

**Not changed by this project — existing Personalisation Hub functionality.**
Personalisation Hub already manages everything that plays on a website or
display, and reports on it, and has done for years. This project does
**not** change:

- playlists and what plays on a device: rotation, ordering, timing, loop
  length, first/last paint and visibility timing;
- **targeting evaluation and resolution**: deciding which campaign plays for
  a given store, display or visitor, including fallbacks when nothing
  matches;
- distribution and caching of assets to players, and rendering;
- playback logging;
- **campaign playback analytics**: reporting what played, where and why,
  for the retailer and for advertisers.

What this project adds is **control over which attributes an advertiser may
use for targeting** in the campaigns or content packages it submits,
validation of those targeting rules, selling advertiser slots to DSPs, and
**handing winning, approved campaigns to the existing campaign system**,
which then evaluates, plays and reports on them exactly as it does any other
campaign. Billing **reads** existing playback data; it adds no analytics or
reporting of its own.

**Out of scope, and removed from this specification:** experience templates
(Responsive Web pages, Mobile Store Site and PWA templates, the web layout
composer), the pairing overlay and device-pairing flow, trust/locked zones,
the render-ladder tier preview and per-channel behaviour, the **QR
Control** and **CTAs** display types / element types, the Live Visitor
Profile attribute layer (a separate, spec-only project), the deadline and
resolution contract, and deciding or rendering which version plays (that is
PH Core's). All other playlist
capabilities (items, scenes, scheduling) are handled by the existing platform
and are not changed by this project.

**Deferred to a later release:** managing targeting variables (this release
uses the default platform variables only, read-only), environmental
attributes such as weather and stock. (Deals and reserve-price booking —
programmatic guaranteed — are built: open questions 45 and 52.)

**Navigation.** The HQ Admin navigation items for this project, in order
(Rob, 24 Sep 2026; **Campaign Status** folded into **Campaign schedule**'s
own second tab, 26 Sep 2026 — it is no longer a nav item of its own; that
page is titled **Advertiser Bookings** and the tab **Upcoming Campaign
Approval** since 27 Sep 2026, see §7):
**Display Types**, **Playlist Management**, **Advertisers / Inventory**,
then **DSP Integration** at the bottom. The pages used day to day come
first; DSP Integration, set up once per DSP, comes last. **Advertisers /
Inventory** (and, from there, **Campaign schedule**'s Campaign status tab)
shows only while the retailer has DSP integration switched on (§7, *The DSP
integration switch*). Within DSP Integration, the
company pages are **Exchange settings**, **Advertiser settings** and
**Shared Targeting Variables**, followed by one page per DSP.

**Targeting vocabulary.** DSP targeting uses the platform's **existing
campaign targeting object**, the same variables as a campaign's Targeting tab
(§6), not a separate registry. This build consumes Live Visitor
Profile-defined variables only through PH Core's targeting object.
[`shared/interface-contract.md`](../../../shared/interface-contract.md) (**v3,
adopted 1 Oct 2026**) is the maintained boundary with the Live Visitor
Profile project for anything else both projects depend on: the targeting
vocabulary, the per-play version tier, audience scoring inputs and the
shared-attributes control. It is also mirrored inside the live backlog
tracker as an **interface** between the two projects.

## Core principles

- **Playback and playback analytics are unchanged.** Playlists, targeting
  evaluation, distribution to players, playback logging and campaign
  playback analytics stay exactly as they are. This project controls what
  advertisers may target and hands their approved campaigns to the existing
  campaign system (see *Scope*).
- **Extend the existing records, don't replace them.** Display type,
  playlist and campaign records stay byte-compatible with the platform's
  current records; this project's additions sit in clearly separated fields
  (§8).
- **Approval before eligibility, where the advertiser requires it.** For an
  advertiser set to *approval required*, no creative can be bid on, handed to
  the existing campaign system or activated until the retailer has approved
  it (§3).
- **Approve where campaigns already live.** Campaigns are approved in the
  existing Campaigns section; the Advertisers screen only holds per-advertiser
  settings.
- **Minimum setup.** A DSP is set up with only what is needed to connect,
  receive bid requests and go live. Protocol choices and tuning are platform
  defaults, not retailer settings (§7).
- **Nothing changes until it is saved.** Every editable page has visible
  **Save changes** and **Cancel** actions (see *Saving changes* below).
- **Confirm before deleting, and say why when you can't.** Deleting always
  goes through a confirmation dialog with Cancel; when something still
  depends on the item, the dialog says what and the delete is disabled (see
  *Deleting* below).
- **Explain with tooltips, not page copy.** Explanations sit in an info-icon
  tooltip next to the field, column or section they describe (see *Help
  text* below), not as paragraphs on the page.
- **One page layout.** Display Types and DSP Integration use the same layout:
  a list on the left and a single content column that takes the full
  remaining width (see *Page layout* below).
- **See it at a glance.** Collapsed sections summarise what is enabled and
  what differs from the defaults, so a display type can be read without
  opening anything (§1).
- **Show each setting in one place.** Company-wide settings are edited where
  they live and linked to, not repeated or summarised elsewhere.
- **Problems first.** Anything stopping a DSP from connecting or receiving
  bids is shown at the top of its page, not next to the field it concerns.
- **Scales with more DSPs.** Company-wide settings are chosen per DSP from
  pickers ("All connected DSPs" or individual DSPs), never as one column or
  toggle per DSP.
- **Controls apply before a win, not after.** Blocklists, floors, categories
  and approval are enforced before a bid can win, never reconciled
  afterwards (§7).

### Saving changes

Applies to every editable page this project adds or changes: the **Display
Types** form, **Exchange settings**, **Advertiser settings**, **Shared
Targeting Variables**, each **DSP page**, and the **Advertisers** screen. All
of them behave identically.

- Edits on the page (fields, toggles, list additions and removals, pickers,
  slot assignment, zones, connect / disconnect,
  Test / Live) are held as unsaved changes and take no effect until saved.
- A **Save changes** (primary) and **Cancel** bar is always visible at the
  bottom of the page, fixed to the bottom of the content area as the page
  scrolls.
- **Save changes is enabled only when something on the page has actually
  changed**; with no changes it is disabled and the bar says *No changes to
  save*. With changes it says *You have unsaved changes*.
- **Cancel** discards the unsaved changes and restores the saved values; it
  is likewise disabled when there is nothing to discard.
- Leaving the page (another display type, another item in the DSP
  Integration list, or another navigation item) with unsaved changes asks for
  confirmation before discarding them.
- Creating something new (a **New display type**, or adding a DSP) starts an
  unsaved change like any other: it is kept only once saved. Adding a DSP
  keeps its own **Add partner** / **Cancel** step first.

### Deleting

Applies to deleting a **display type** (§1) and a **playlist** (§2), and uses
the same dialog for both.

- Each item has a **delete (bin) icon**. Selecting it opens a **confirmation
  dialog** titled *Delete [name]?* with **Cancel** and **Delete**.
- **When nothing depends on the item**, the dialog explains that the delete
  is permanent and can't be undone; **Delete** removes it.
- **When something still depends on it**, the dialog shows a warning, lists
  what depends on it, and **Delete is disabled**; the only action is
  **Close**.
- A confirmed delete takes effect immediately; it is not held for Save
  changes. Any other unsaved changes on the page are left as they were.

### Help text

Applies to every page this project adds or changes.

- **Explanations are tooltips.** An info icon sits next to the page title,
  section heading, field label or table column it explains; the explanation
  shows on hover or keyboard focus. Explanatory paragraphs and hint lines
  under fields are not used.
- **Each tooltip is specific to what it sits next to**, not generic text
  repeated across the page.
- **A page-title tooltip states exactly what the page covers**: what is
  configurable there, what is read-only there, and what is a platform
  default or lives on another screen (the DSP Integration company pages are
  given below).
- **Tooltips never get cut off.** They open above the icon, or below it when
  there isn't room above (for example near the top of the page).
- **Status stays on the page.** Issues at the top of a DSP page, the Save
  changes bar message, delete-dialog warnings and empty states are shown
  directly, not in tooltips, because the user needs to see them without
  looking.

Page-title tooltips for the DSP Integration company pages:

| Page | Tooltip |
|---|---|
| **Exchange settings** | Sets up your organisation as the seller of record for its screens. Configurable here: organisation name, domain, seller ID and ad-ops contact email, all required. Once saved and complete, sellers.json is published at https://[domain]/sellers.json and every bid request carries your domain and seller ID in its SupplyChain; until then no DSP is sent bid requests. Not configurable (platform defaults): seller type (Publisher), the DOOH object, the OpenOOH venue taxonomy, QPS and bid timeout. Bid requests use OpenRTB 2.6 as the minimum supported version for programmatic DOOH; the exchange is designed to adopt 2.7, 2.8 and later versions per DSP as the market moves. |
| **Advertiser settings** | Company-wide advertiser settings, applied to every DSP. Configurable here: Pricing (currency and the platform floor CPM, the minimum of the floor hierarchy, §4; advanced), and Category lists (the IAB category whitelist and blacklist, chosen from the full IAB Content Taxonomy 1.0 — 26 tier-1 categories and their tier-2 subcategories, stored as "Tier 1" or "Tier 1 › Tier 2" and sent as the OpenRTB `bcat` codes (IAB8, IAB8-16) — and applied to every DSP; the same list invites buyers by category on a buyers list; each DSP's advertiser lists are on its own page). Per-advertiser campaign approval and floor multipliers, and the inventory advertisers can buy, are on Advertisers / Inventory. |
| **Shared Targeting Variables** | Variables shared through the API with connected DSPs. Once a variable is enabled for a DSP, that DSP's advertisers can use it in targeting conditions for more advanced campaign targeting; the platform evaluates the condition and never returns the value. They are the same variables as a campaign's Targeting tab. Choose which DSPs may use each one below; default platform variables only in this release. |

The **Enable DSP Integration** switch at the top of Exchange settings has
its own tooltip, kept high level (Rob, 24 Sep 2026): *"For retailers running their digital signage as a retail media network. Enabling DSP integration lets you sell ad inventory on your in-store screens to advertisers through their DSPs, opening up a new revenue opportunity from the screens you already have."*

Other tooltip wording is given in the relevant section below (for example
the pricing fields in §4).

### Page layout

Display Types and DSP Integration share one layout:

- a **list column** on the left (display types; or the company settings and
  DSPs), the same width on both screens (260 px), sticky while the page
  scrolls;
- a **single content column** to its right that **takes the full remaining
  width**, in reading order top to bottom, ending with the Save changes /
  Cancel bar.

The display type form is one column: preview, Touch Point, name, canvas
size, background, default playlist, then the panels. It is not split into a
fixed-width form beside a second column.

### Who sees each section (Rob, 20 Sep 2026)

- **DSP Integration is admin only.** Exchange settings, Advertiser settings,
  Shared Targeting Variables and the DSP pages are shown to admin users and
  no one else.
- **Display Types, Playlist Management, Advertisers / Inventory and Campaign
  Status** are shown to admin users **and to marketing users**.
- **Help desk users see none of it.**

On **Advertisers / Inventory**, a marketing user reads the advertisers and
the inventory but cannot change campaign approval or floor multipliers:
approval policy and pricing stay with an admin.

Enforced server-side as well as in the navigation, like everything else the
UI restricts. The POC's stand-in session carries the three roles
(`POC_ROLE`: `hq_admin`, `hq_marketing`, `hq_helpdesk`); on integration they
map to the platform's own roles.

## 1. Display types — updates to the existing section

The navigation item and screen are called **Display Types**. This project
extends the **Digital Signage** and **Kiosk** display types: a full canvas at
a fixed resolution. The **QR Control** and **CTAs** display types, and the
*CTAs* and *QR Control* element types, are not part of this release and are
not offered.

**Website and Mobile App** (ticket, 28 Sep 2026) were added to Touch Point
alongside Digital Signage and Kiosk — production's Add Display Type offers
all three (plus Mobile App), and the two were missing here. They reuse the
existing New/Edit Display Type flow and every field on it unchanged (Touch
Point, Display Type Name, Canvas Size, Background Color, Default Playlist,
Phantom Zone/QR Control, Playlist Settings) — nothing new was built, only
widened. Two differences, both because they have no physical screen or
advertising:

- **Canvas Size defaults to Website's own (1920×1080) or Mobile App's own
  (330×400, portrait)** when Touch Point is switched to one of them on a
  still-unsaved display type, the same way this build's own canvas has
  always defaulted for a new one — Digital Signage and Kiosk keep their
  existing behaviour (switching between them has never touched the canvas,
  and still doesn't).
- **Enabled Features and Multi-Zone Layout are hidden**, except QR Control
  (Phantom Zone/QR Control stays exactly as it is otherwise) — In-Store
  Radio, MIST, AI Agent and Vision/AI all assume a physical display to run
  on or around, which neither touch point has. Hidden rather than shown
  disabled, matching how the two display types themselves are additive
  rather than a variant of an existing one. Revisit if that's wrong
  ("unless confirmed otherwise").
- **Same slot editor as Digital Signage** (ticket 0jviesctpWGyOYtK20tg, Rob
  7 Oct 2026; it replaced the 28 Sep "HQ-only" rule and the 7 Oct "RTB-only"
  switch): Advertiser slots, Advertisers / Inventory, Available Inventory and
  the Inventory API all apply to them. Only the bid request differs.

Existing Website/Mobile App display type records (this build has none
seeded, but the platform does) load and save through the same endpoints,
unreshaped; Digital Signage/Kiosk playback and analytics are untouched.

- **Existing schema, unchanged**: width/height,
  `maximumCampaignsPlayedInRotation` (slot count, -1 = unlimited),
  auto-play/rotation/transition modes, asset fill/positioning, the multi-zone
  flag, the QR Control phantom area (a positioned region outside campaign
  rotation) and the enabled features (In-Store Radio, MIST proximity, AI Agent
  Playback, Vision/AI). How these settings drive playback is unchanged.
  **26 Sep 2026: auto-play/rotation/transition modes and asset fill/
  positioning moved off the display type onto the playlist it belongs to —
  edited from Playlist Management (§2), not from this page any more.**
  `maximumCampaignsPlayedInRotation` and slot ownership stay here: they size
  and sell this specific display type's positions (a position is sold per
  display type × slot — see the Display Types & DSP Integration API
  boundaries doc), so a playlist shared by more than one display type can
  still be capped, and have its slots owned, differently on each screen it
  fills. **The multi-zone flag and its zones (below) also moved onto a
  playlist — the display type's current Default Playlist — but stay edited
  here, on this page, never on Playlist Management**: see *Multi-zone
  layouts* below.
- **Configuration inheritance**: `Company (availability) → Display Type
  (default) → Display/Device (override)`. An override always wins and is
  never reset by a later type-level change. The UI must make clear that a
  type-level edit won't reach an already-overridden display, and must
  visually distinguish an inherited value from an override. Diagnostic
  overlays (debug boxes) are never inheritable; they are set per display,
  temporarily, only.
- **Slot ownership** (new, sized to `maximumCampaignsPlayedInRotation`).
  **The slots assigned here are the source of the inventory** that §5
  exposes. Ownership decides **who may fill** a slot; how the slot then plays
  is unchanged:
  - **Headquarters**: filled from eligible HQ campaigns, as today.
  - **Advertiser**: sold through a DSP — RTB by default, whitelist-only, or
    reserved to a named advertiser (§6).
  - **Stores**: delegated. A campaign is flagged as available to the staff
    tablet; staff activate it but do not author it. Store-level authoring is
    out of scope for this release. **Not offered in the first release**
    (ticket, 27 Sep 2026): the slot editor offers Headquarters and
    Advertiser only. A slot already saved as Stores still reads as Stores
    (greyed out in the owner list, with a tooltip saying it isn't supported
    in this release) until someone changes it; the API is unchanged.
  - **Website and Mobile App were Headquarters only** (ticket, 28 Sep 2026;
    superseded 7 Oct 2026 — they now offer the same owners as Digital Signage):
    no advertising at all for these two touch points. Advertiser and Stores
    stay on the owner list — shown, not hidden, so it's clear the option
    exists but doesn't apply here — greyed out with a tooltip saying
    advertising isn't available for this touch point; the API refuses
    anything but Headquarters. No reserve price, billing unit, max
    campaigns or venue metadata either, since none of those three apply to
    anything but an Advertiser-owned slot; the display type's `phExtensions`
    holds Headquarters slots only.

  **A slot is a playlist position** (ticket "Available Inventory: Max
  campaigns column + slot playlist statement"): assigning an advertiser a
  slot assigns them that fixed position in a playlist rotation, of which
  only one campaign plays at a time — PH Core's targeting evaluation decides
  which version plays (the mandatory default layer, or a localised/personalised
  upsell that resolves ahead of it, per §6). The playlist is retained per
  slot; this is the already-intended §6 model, stated explicitly here as
  part of that ticket's spec clarification. **Which playlist** (ticket
  "Available Inventory: playlist-primary table (drop Display type column)
  with Unassigned indicator", 27 Sep 2026): on a single-zone display type
  it's always the display type's own default playlist, as before; on a
  multi-zone one it's the zone the slot belongs to (`Slot.zoneId`,
  below) — a real Menu Board–shaped screen runs three zone playlists
  (Zone 1/2/3), each with its own rotation and its own advertiser slots or
  none at all, not one shared rotation across the whole screen.

  The explanation of the owners is a tooltip on the **Slot assignment**
  label.

  **The slot editor sets the label and the owner** (Rob, 20 Sep). Who a
  sellable position is assigned to — DSPs, named advertisers, the whitelist
  — is managed on *Advertisers / Inventory* (§5), and appears here
  read-only on the slot card. A Stores slot takes the default scope (*Store
  staff*); its scope is no longer editable anywhere in this build. Changing
  a slot's owner away from *Advertiser* drops the assignment with
  it, since the position is no longer sellable;
  changing anything else keeps them.

  **On a multi-zone display type, each zone has its own rotation and its
  own slots** (ticket, 28 Sep 2026 — Rob: "there's a separate playlist for
  every zone that gets created"; replaces the 27 Sep zone-tagging column,
  under which three zones "were still being seen as a single inventory
  slot"). Each zone runs its own playlist, so each zone carries its own
  *Maximum Campaigns Played In Rotation* (on the zone, in *Multi-Zone
  Layout*'s data; null = the default, Unlimited, no slots) and the display
  type's slot list is **one segment per zone, in zone order**, each segment
  sized by that zone's cap and every slot in it carrying that zone's id
  (`Slot.zoneId`). Both are edited on Playlist Management under **that
  zone's own playlist** — the cap select and the slot table there are that
  zone's, and nothing else's; there is no Zone column and no other zone's
  slots showing. The display type's Default Playlist, which lays out the
  zones, has no rotation of its own on a zoned display type and shows
  neither. Removing a zone removes its slots (and their positions); adding
  one back, or raising a zone's cap, adds new Headquarters slots for it;
  switching zones off returns to the display type's own cap with slots
  belonging to no zone. **Switching zones on keeps the display type's
  existing slots as the first zone's**, and that zone takes their count as
  its cap unless it already has one (28 Sep 2026 — before this, enabling
  zones dropped every slot from the draft, since no zone had a cap yet).
  The API's migration `0029` (layout moved onto the default playlist)
  copies an existing layout across; its first version didn't, which is
  what emptied the hosted Menu Board's zones the day it was deployed. So a Menu Board with three zones and two Advertiser
  slots a zone is **six positions** on Available Inventory, two under each
  zone's playlist. **A position is still identified by display type + slot
  number** (`PH-CORE-BOUNDARIES.md` "At most one campaign per display type,
  slot and play window") — the flat `slot` field spans every zone (so the
  segments make it 5 for "Zone 3's first slot"), and every internal
  reference to a position — `PUT`, the exchange, billing, migrations —
  keys on that flat number, unchanged by the rest of this paragraph.
  **What Available Inventory *shows* in its Slot column is different**
  (`AvailableInventoryRow.zoneSlot`, ticket 28 Sep 2026 — Rob: setting Zone
  2's first slot showed as "Slot 4" in the table, since each zone runs its
  own separate playlist and rotation and a flat cross-zone number isn't
  what that rotation actually uses): a display-only number that restarts
  at 1 for each zone's own segment, so Zone 3's first slot reads "Slot 1"
  there, same as Zone 1's and Zone 2's. Equal to `slot` when the display
  type isn't multi-zone. The booking schedule numbers it the same way —
  "Zone n / Slot m" (`BookingSchedule.positions[].zoneName` / `zoneSlot`,
  A0GyTNsA, 1 Oct 2026). Each position's share of voice, slot duration and
  billing are of its own zone's rotation, not of every zone's slots
  together. The API
  rejects a slot list whose length isn't the sum of the zone caps, or a slot
  in the wrong zone's segment; on a single-zone display type `zoneId` must
  be absent. A multi-zone display type saved before this (one shared slot
  list, some slots tagged to a zone, no cap on the zones) is read in the new
  shape without a migration step: tagged slots go to their zone, untagged
  ones to the first zone, and each zone's cap becomes the number it received.
- **Default Playlist offers "Add new playlist"** (ticket, 26 Sep 2026) — as
  its own outlined call-to-action button at the top right of the field,
  above the dropdown, not as the dropdown's last option (ticket, 27 Sep
  2026), so it reads as the way to add a playlist rather than as one of the
  playlists to pick. Choosing it creates a playlist scoped to this display type from the
  outset (shown as *auto-created* in Playlist Management, the same as a
  zone playlist created on demand) and selects it immediately — ready, once
  it is this display type's Default Playlist, to define its own multi-zone
  layout below.
  - **It opens with every section open** (ticket ThP7DPGo17FmPJdDKM7S,
    28 Sep 2026): Phantom Zone, Enabled Features, Multi-Zone Layout and
    Playlist Settings all expand on the click, and its five settings are
    editable before Save creates it.
  - **One set of new-playlist defaults** (Rob, 1 Oct 2026, A0GyTNsA;
    built 2 Oct, 3gGKowhK): every auto-created playlist — a new display
    type's own, one added this way, a zone playlist created on demand, a
    layout playlist — starts with every setting at its default, nothing
    overridden (`{}`), so its panel reads *Default settings* and it
    inherits `PLATFORM_DEFAULTS.playlistSettings`. This replaced the 27 Sep
    rule (added and zone playlists started with Auto-Rotation and
    Auto-Play Off) and ThP7DPGo's copy of the current default playlist's
    settings. The display type's own rotation likewise starts at
    *Default (Unlimited)*.
  - **While the Default Playlist is still this local, unsaved draft**, its
    own settings show here, **editable**, in the same five-field layout as
    Playlist Management's own Playlist Settings (§2), with a link across to
    Playlist Management — and what the panel shows is what Save creates
    the playlist with (the page sends those settings for the playlist Save
    created; before 28 Sep 2026 they were never sent, and the playlist came
    out with the server's own starting values instead). **While the display
    type itself is new, the same panel also holds Maximum Campaigns Played
    In Rotation and slot assignment** (ticket, 28 Sep 2026, "as we did in
    an earlier release"): there is no Playlist Management row to set them
    on until Save, so a Digital Signage screen's rotation and its
    Headquarters/Advertiser slots are set right here, before the first
    save; its collapsed header then carries the slot-count/owner chips
    beside the settings pill. The panel becomes a read-only preview the
    moment Save creates the playlist; from then on Playlist Management is
    the only place to edit any of it.
- **Multi-zone layouts** for signage (`zones`), each zone with its own
  playlist, its own Maximum Campaigns Played In Rotation and, where sold,
  its own slots (see *Slot ownership* above). **Layout is owned by the Default
  Playlist, not the display type** (same ticket): the same physical screen
  may be zoned one way under one playlist and run as a single canvas under
  another, so which playlist is picked as Default decides which zoning (if
  any) that screen currently shows. Zone geometry stays ratios/percentages
  of the display type's own canvas size — the display type keeps the
  physical truth (resolution/aspect); the playlist keeps the zoning
  decision. **Always edited here, on the Display Types form** — never in
  Playlist Management (§2), even though the data now lives on the playlist
  record.
- **Venue and screen metadata** — a dependency on PH Core, which owns it and is
  read read-only here (Q35, 29 Sep 2026; see api/PH-CORE-BOUNDARIES.md, "Venue
  and geo metadata"). Needed for DOOH bid requests (§7):
  OpenOOH venue type, geo (lat/long) and store identifier per store, plus
  orientation and loop length per display. Resolution and share of voice are
  already carried by the display type. **PH Core owns the completeness
  guarantee and the missing-data signal** (what it guarantees is present and
  valid before a display is sellable, and what it exposes when it is not),
  still to be defined by PH Core. The exchange excludes any position whose
  required venue/geo is absent, deterministically, and never builds a
  malformed bid request (ticket HxMMn84BcCP6y9S2jk3l, 4 Oct 2026).
- **Layout and saving** follow *Page layout* and *Saving changes* above: the
  form takes the full width beside the display type list, and changes
  (including zone playlists created on demand) are applied with Save
  changes.
- **Tooltips** (see *Help text*) on: *Slot assignment* (the owners;
  playback unchanged); *Define phantom zone* (it sits outside rotation and
  enables QR Control); the *Enabled Features* panel header (defaults
  inherited by every display of the type, overridable per display); *Enable
  zones* (each zone runs its own playlist).

### Deleting a display type

- Every display type in the list has a **delete (bin) icon**, which opens
  the confirmation dialog described under *Deleting*.
- **A display type cannot be deleted while any display is assigned to it.**
  The dialog then says the display type can't be deleted, gives the number
  of assigned displays, and **lists them** (display name and store). It tells
  the user to remove those displays from the platform, or assign them to
  another display type, first. **Delete is disabled.**
- With no displays assigned, the dialog confirms the delete is permanent,
  and **Delete** removes the display type and its settings. Its
  auto-created playlist is not deleted; it remains in Playlist Management as
  unused and can be deleted there.
- Displays and their display-type assignment live in **Displays & Devices**
  (existing); this project only reads them for the check.
- **Hard block while inventory is committed (open question 47, decision
  29 Sep 2026).** A display type also cannot be deleted while any of its
  advertiser positions is **reserved or sold for a current or future (not
  yet played) window** — deleting it would strand sold inventory owed
  delivery and reserved slots with promises against them. The delete is
  refused `409 has_dependents`, each blocking window named
  (`<position> · window <date> · sold|reserved`). Test mode bookings don't
  count. Once those windows have played out the delete proceeds. The same
  block applies to **changing the playlist assigned** to the display type
  (its default playlist or a zone's) and to **changing that playlist's
  settings** (§2): the playlist carries the play commitments.

### Collapsed panels with summaries

The three panels — **Phantom Zone**, **Enabled Features** and **Multi-Zone
Layout** — are **collapsed by default**. (**Playlist Settings** was a fourth
panel here; it moved to Playlist Management, §2, on 26 Sep 2026 and is no
longer part of this page.) Each collapsed header shows a one-line summary as
small chips, so what is enabled or changed on a display type is visible
without opening anything. Chips for something enabled or changed are
coloured; chips for defaults or "off" are grey.

| Panel | Summary shows |
|---|---|
| **Phantom Zone** | Size (e.g. *250×250*) and position — *Default (Bottom Right)* when inherited — or *Not defined* |
| **Enabled Features** | One chip per enabled feature with its icon (*In-Store Radio*, *QR Control*, *MIST*, *AI Agent*, *Vision/AI*), or *None enabled*. Features not available to the company are not shown. For Website/Mobile App, only QR Control ever appears here — the panel itself offers nothing else (ticket, 28 Sep 2026) |
| **Multi-Zone Layout** | Number of zones (e.g. *3 zones*), or *Single zone*. Not shown at all for Website/Mobile App (ticket, 28 Sep 2026) |

Opening a panel shows its full settings as before; the summary updates as
settings change.

## 2. Playlist management — edit and delete, plus each playlist's own settings

This project adds edit, delete and — as of 26 Sep 2026 — Playlist Settings to
this page. Everything else about playlists, including what plays and when,
is handled by the existing platform and is unchanged.

- **Sold slots are locked, not removed (ticket "Lock playlist slot against
  new sales when slots are sold", 30 Sep 2026).** The rules below operate
  at the **slot level, per playlist**, exactly as rows appear in
  Available Inventory — not on a whole playlist or a whole advertiser.
  1. **Hard block on removal.** Taking an advertiser off a slot (or
     replacing it with DSPs, a buyers list or the whitelist) while the slot
     has a live booking — reserved or sold for a window that has not
     finished playing, Test mode excluded — is refused `409 has_dependents`
     with the message that slots are sold and the advertiser can't be
     removed. Switching such a slot's owner away from Advertiser is refused
     the same way. Existing sold slots keep running as they are: nothing is
     deleted, reassigned or cancelled.
  2. **Lock against further sales.** From that refusal the admin can
     **lock the slot** (`PUT /admin/v1/available-inventory/lock`). A locked
     slot takes no new bid, reservation or auction win: its unsold upcoming
     windows read *unavailable*, the auction skips it (pending bids settle
     as lost) and the Partner API answers `409 conflict`. Windows already
     booked — including the remaining windows of a locked-rate term — are
     unaffected. Available Inventory marks the row **Locked to new sales**.
  3. **Auto-release.** The lock releases by itself as soon as the booking
     schedule shows no live booking on the slot (checked on the scheduler
     tick and whenever Available Inventory is read or saved). The release
     depends on **booking state only** — never on campaign playback or
     delivery analytics. There is no manual unlock. Once released, and with
     no live inventory left, the advertiser can be removed from the slot.
  Only a slot with a live booking can be locked; an unsold slot simply has
  its advertiser removed.
- **Edit a playlist**: its name and its assignment to display types and
  zones (assignment is still made on the Display Types form, §1; a playlist
  is only ever listed here with an *Open* action back to it).
- **Each playlist name is led by its touch point's icon** (ticket, 27 Sep
  2026): the icon of every display type the playlist fills (or, while it
  fills none, the display type it was auto-created for), with the touch
  point's name on hover — Digital Signage a TV, Kiosk the Touch Point
  field's own Kiosk icon, Website a globe, Mobile App a phone (added 28 Sep
  2026, ticket — the icons were already reserved for them). A playlist on no
  screen at all shows no icon.
- **Delete a playlist**, through the confirmation dialog described under
  *Deleting*:
  - Selecting the delete (bin) icon opens the dialog; nothing is deleted
    without confirming, and **Cancel** closes it with no change.
  - **While the playlist is a display type's default playlist or is assigned
    to a zone**, the dialog says it can't be deleted, lists each display type
    or zone it is assigned to, and **Delete is disabled**. It must be
    reassigned first; a display type or zone is never left without a
    playlist.
  - With no assignments, the dialog confirms the delete is permanent and
    **Delete** removes it.

### Playlist Settings — moved here from Display Types (26 Sep 2026)

The **Playlist Settings** panel that used to sit on the Display Types form
(§1) moved here: Asset Position, Asset Fill, Campaign Transition, Campaign
Auto-Rotation and Campaign Auto-Play now belong to the **playlist**, not the
display type, and are edited by expanding that playlist's own row in this
table.

- **Every row gets an expand control** — its own leftmost column, a chevron
  (▸ collapsed, ▾ expanded) that is deliberately bigger and more prominent
  than a plain in-line icon, so it reads as clickable at a glance. It shows
  for **every playlist, whether or not it is currently assigned to a display
  type** — a playlist's own settings can, and often should, be set up before
  it is ever assigned (fixing a testing round that found the earlier build's
  arrow too small, positioned mid-row rather than at the row's edge, and
  missing entirely for an unassigned ("unused") playlist).
- **Expanding a row shows that playlist's settings**, edited inline, exactly
  as the display type's old panel behaved — same fields, same
  inherit-or-override selects (*Default (…)* means inherit).
- **A "Save changes" bar** at the foot of the page, in the same pattern as
  Display Types' own: edits are held as a draft and only take effect on Save;
  Cancel discards them. Switching which playlist's row is expanded does not
  discard another playlist's pending edits.
- **No change while its inventory is committed (open question 47).** A
  playlist assigned to a display type whose positions are reserved or sold
  for a current or future window can't have its settings changed, and the
  display type can't be given a different playlist, until those windows have
  played: the save is refused `409 has_dependents`, naming each blocking
  window (§1 "Deleting a display type").
- **Maximum Campaigns Played In Rotation and slot assignment are not part of
  this move** — they stay on the display type (§1) because they size and
  sell that specific screen's positions, not the playlist's content. They
  are still edited from this same expanded row, but **per assignment**: a
  playlist used by only one display type or zone shows one such block; a
  playlist shared by more than one shows one per assignment, each labelled
  by display type and zone, since each can be capped — and have its slots
  owned — independently. **Under a zone's playlist the block is that
  zone's own** (ticket, 28 Sep 2026): its cap is the zone's Maximum
  Campaigns Played In Rotation and its slot table is that zone's own
  segment of the display type's slots, with no Zone column — see §1 *Slot
  ownership*. **A zoned display type's Default Playlist shows no cap or
  slots** (it lays out the zones; each zone's playlist carries the
  rotation), just a line saying so. **An unassigned playlist shows none of
  this section at all** — there is no display type to size a position
  against — only its own settings above.
- **Collapsed-row summary**: the same small-chip pattern as §1's old panel,
  now split between two independent things next to the expand arrow — this
  playlist's own settings (*n settings changed*, or a single grey *Default
  settings*), and, only when the playlist has exactly one assignment, that
  assignment's slot count and slot-assignment-by-owner chips (omitted with
  more than one assignment, since the count can differ per display type, and
  omitted entirely for an unassigned playlist).
- **Available Inventory's "Open" action** (§5), which used to land on the
  display type's own Playlist Settings panel, now opens Playlist Management
  with that display type's default playlist expanded instead.

## 3. Campaign asset approval

Applies to campaigns whose creative comes from outside the retailer: direct
partners submitting through the API (tier 2) and creative arriving through a
DSP (tier 1). Campaigns authored by HQ are unchanged. (Here and in §6,
"tier 1 / tier 2" are the partner API tiers, not the removed render tiers.)

### Advertisers / Inventory

A new **Advertisers / Inventory** item in the HQ Admin navigation, placed
**below Playlist Management and above DSP Integration** (Rob, 24 Sep 2026;
Campaign Status no longer sits between them — it folded into Campaign
schedule's own second tab, 26 Sep 2026). It carries per-advertiser settings
and, below them, the inventory those advertisers can buy (§5); **campaigns
are not approved here.**

**Direct advertisers (9 Oct 2026).** An advertiser with a direct relationship
with the retailer, not brought by any DSP, is added on this page (admin only,
saved at once; `POST /admin/v1/advertisers/direct`, table `direct_advertisers`,
migration 0063) from the **Add new Advertiser** button at the top right of the
page, which opens a pop-up asking for the name (no inline field), and removed
with the delete icon beside it in the Advertisers table
(`DELETE /admin/v1/advertisers/direct/{id}`, refused while it has campaigns or
bookings; DSP advertisers have no delete icon). It is listed with the DSP
advertisers (`direct: true`, empty `via`) and takes the same approval and floor
settings. Wherever a DSP name would accompany an advertiser it reads
**"Name (Direct)"**: the Via column, the Assigned to options, and the booking
schedule (its advertiser filter, offered only when no DSP is picked, and its
tiles). A DSP seat of the same name wins, so one advertiser is never listed
twice. Picking one in a slot's Assigned to holds that slot for it and saves
like a DSP advertiser (no DSP comes along, since it has none); before
9 Oct 2026 the save was refused as "not an advertiser on any connected DSP".

**Users page on the real API (10 Oct 2026, ticket H6BcvdNZUvdP8Ebh5Tve).**
`mockups/platform-users.html` (Company Settings → Users) reads and saves
through `GET/POST /admin/v1/users`, `PUT/DELETE /admin/v1/users/{email}`
(table `platform_users`, migration 0064; admin only; email lower-cased, fixed
after creation). Its Advertiser drop-down is `GET /admin/v1/advertisers`, the
same source as this page: DSP advertisers, then direct ones as "Name (Direct)".
Choosing **+ Add new advertiser…** in the modal calls
`POST /admin/v1/advertisers/direct` first, so the advertiser exists on both
pages at once, then saves the user against it. An Advertiser user must name a
known advertiser. Internal users (Admin, Marketing, Help Desk) are stored the
same way but have no sign-in behind them. **Signing in is PH Core's**
(`api/PH-CORE-BOUNDARIES.md`): the API only supplies
`GET /admin/v1/users/{email}/scope`, which returns the user's advertiser and
only that advertiser's campaigns (with approval status), for PH Core to apply
when it signs an Advertiser user in. This repo has no advertiser-facing login,
insights or analytics screen to scope; that part needs the platform.

**Admin and marketing users both see it** (Rob, 20 Sep): marketing reads it,
and only an admin changes approval, pricing, what a position is assigned to
or what targeting it supports. A read-only viewer sees a *Read only* pill in
place of *Admin only* and no Save changes bar.

- Lists every advertiser currently using the platform, across all DSPs, with
  the DSP(s) it comes through. Advertisers are pulled from each DSP on
  connect; this is the only screen that lists them (DSP pages do not).
- **Campaign approval** toggle per advertiser: **Required** or **Not
  required**.
  - **Required** (the default for a newly added advertiser): the advertiser's
    campaigns go to *Awaiting approval* on submission and cannot run until the
    retailer approves them in the Campaigns section.
  - **Not required**: submission is approved automatically (recorded as such
    in the audit trail) and the campaign can be activated immediately.
    Automated asset checks still run.
  - Changing the toggle applies to future submissions once saved. Campaigns
    already *Awaiting approval* stay in the queue for a decision.
- **Floor multiplier** per advertiser (default 1.0), with the resulting
  effective floor shown alongside, in the company currency (§4).
- Changes are applied with **Save changes** (see *Saving changes*).
- **Column tooltips** (see *Help text*): *Via* (the DSPs the advertiser's
  campaigns come through); *Campaign approval* (what Required and Not
  required do); *Floor multiplier* (default 1.0, e.g. 0.8 preferred, 1.2
  new); *Effective floor* (floor CPM × the advertiser's floor multiplier).

### Submission

Advertisers submit campaigns (content packages) and assets through the API
(§6):

```
POST /v1/campaigns                  create a campaign: default (mandatory) + targeted versions (optional upsells)
POST /v1/campaigns/{id}/assets      upload creative against the campaign
POST /v1/campaigns/{id}/submit      submit for retailer approval
GET  /v1/campaigns/{id}/status      approval status and rejection reason
GET  /v1/campaigns/{id}             read back the stored versions, targeting and assets
```

For DSP demand, the creative referenced in a bid response must resolve to
an approved PH creative. A bid carrying an unknown or unapproved creative is
discarded pre-auction, and the creative is placed in the approval queue (or
approved automatically, if the advertiser does not require approval) so it
can compete in later windows.

**Creative identity is PH's own, derived from the content** (decision, Rob,
4 Oct 2026; open question 40). PH fetches the creative and hashes the bytes;
that content hash (with the advertiser) is the creative's identity, and the
DSP's creative ID (crid) is only a reference label recorded against it,
never the key approval or safe reuse trusts.
- Identical bytes are one creative whatever crid any DSP attaches: the same
  creative arriving through DV360 and The Trade Desk under two different
  crids is **one** PH creative, de-duplicated by content and approved
  **once**, consistently across DSPs. Each DSP's crid is recorded against it.
- A crid rotated onto identical bytes resolves to the creative a reviewer
  already approved — no re-review. A crid reused for **different** bytes
  resolves to a different creative, which is reviewed on its own; the
  earlier creative keeps running as it was.
- The crid is never trusted alone: a crid's resolution is trusted only
  while its last fetch-and-hash is recent (`creativeReverifyMs`, default one
  hour) and its creative URL unchanged; otherwise the creative is fetched and
  hashed again before the bid can compete (one retrieval per DSP response).

**DSP creative audits are an advisory input, never a replacement**
(decision, Rob, 29 Sep 2026; open question 40). A DSP's own audit status —
DV360's review status (`ApprovalStatus`, `ExchangeReviewStatus`), The Trade
Desk's `approvedBy`, Amazon Ads DSP's asset-level moderation — is recorded
as an advisory `dsp_audit` check shown to the reviewer. It never approves a
creative on its own and never blocks one; PH's approval gate stays the
source of truth. **Pre-approval is by content hash**, riding
on *safe reuse* (below): once a human has approved a DSP creative, byte-
identical content is not re-audited, under any crid and through any DSP;
different content under the same crid is a different creative, reviewed on
its own.

### Automated checks on upload

Run before a human sees anything; failures are returned to the advertiser
immediately with reasons and never reach the review queue:

- file type, file size and bitrate. **File size is per asset, not per
  submission**: 100 MB for an image, 200 MB for a video. Applies to the
  default (mandatory) layer and every localised/personalised targeted
  version uploaded against a campaign via `POST /v1/campaigns/{id}/assets`,
  each checked independently. A file over its type's limit fails the
  `file_size` check and is returned to the advertiser immediately, never
  reaching the review queue — same as the other automated checks below.
  Stated in the API contract too (`openapi.yaml`'s `uploadAsset` request
  body, `API.md`'s Campaigns table) so the two do not diverge, and enforced
  in the POC by `assetLimits` in `apps/api/src/config.ts`
  (`apps/api/src/domain/assetChecks.ts`'s `file_size` check);
- shape, not pixels (decision, Rob, 30 Sep 2026): `aspect_ratio` passes when
  the asset's ratio is within ±5% of the target's — the display type's
  canvas, or, on a zoned display type, one of its zones' own dimensions (the
  player scales to fit; a near miss plays with modest black edges) — and
  `dimensions` is a floor: no smaller than 50% of that target in each
  dimension (1920×1080 → 960×540), so a tiny file is not upscaled into
  mush. Larger assets of the right shape are accepted (downscaling is clean).
  Images and videos alike; the same `fileChecks` runs on the Partner API
  upload and on the admin upload, so both agree, and each failure names its
  own reason (ratio vs floor);
- duration against the slot's duration;
- creative is present on the default campaign (decision, 22 Sep,
  superseding the earlier same-day "baseline optional" decision — ticket
  "Make default creative mandatory; retire localised-only booking path"):
  default is now mandatory on every submission, so its own creative is
  always required — a targeted version's creative no longer stands in
  for it;
- targeting rules use only variables permitted for the advertiser's DSP (§6).

### Campaign statuses

The status names are fixed and shown exactly as below, so users can filter
the campaign table on them without ambiguity:

| Status | Meaning |
|---|---|
| **Draft** | Created, not yet submitted |
| **Awaiting approval** | Submitted; waiting for a retailer decision |
| **Approved** | Approved (manually, or automatically where approval is not required); can be activated |
| **Rejected** | Rejected with a reason; the advertiser must submit a new version |

Activation (**Active** / **Inactive**) is a separate field, available only
once a campaign is *Approved*.

- **Any change to an approved campaign's assets or targeting rules** (for an
  advertiser that requires approval) creates a **pending edit**: the new
  version is *Awaiting approval* while the **previously approved version
  keeps running** — still activated, still eligible to reserve, bid, win
  and be handed off, and handed off with its own approved creative
  (decision, Rob, 29 Sep 2026; open question 38).
  - **Approving the pending edit atomically replaces the live version**:
    every hand-off after the approval plays the new creative and none
    before it does — no dark window, no double run. Each booking records
    the asset version it handed off.
  - **Rejecting the pending edit discards it**: the running version
    continues unaffected (*Approved*); the rejection and the discard stay in
    the audit trail (`rejected`, `edit_discarded`), and the advertiser sees
    the reason (`rejectedEdit` on `GET /v1/campaigns/{id}/status`) until its
    next edit, which builds on the live version under a new version id.
    Un-reject does not apply to a discarded edit.
  - A campaign that has never been approved is unchanged: nothing runs until
    it is, and a rejection is a plain rejection.
  - The status API exposes `liveAssetVersion` (the approved version that
    runs) and `pendingEdit`.
- **Draft is internal only; it never surfaces in a retailer-facing view**
  (ticket, 22 Sep). A campaign remains mechanically Draft between creation
  (`POST /v1/campaigns`) and submission (`POST /v1/campaigns/{id}/submit`)
  on the three-step API, but the retailer only ever sees one once it has
  been submitted. The campaign table's status filter and its per-status
  counts (below) show and count only **Awaiting approval**, **Approved**
  and **Rejected**; a still-Draft campaign is not a row in that table at
  all, not merely filtered out of one status.
- **Undo rejection.** A mistaken rejection can be reversed: an **Undo
  rejection** action, in the campaign's options/overflow menu, is available
  on a **Rejected** campaign and moves it back to *Awaiting approval* for a
  fresh decision. It never auto-approves, even for an advertiser who
  doesn't require approval — it undoes the rejection, it isn't a new
  submission. Same permission as approve/reject (open question 39). The
  reversal is recorded in the audit trail like any other decision (who, when
  and, optionally, why); the prior rejection reason stays in that history.

### Retailer review — the existing Campaigns section

Approval takes place in Personalisation Hub's **existing Campaigns section**,
with a minimal change to the campaign table:

- **Status filter** on the campaign table with **Awaiting approval**,
  **Approved** and **Rejected** — never Draft (above) — and a count on
  each, so the *Awaiting approval* queue is one click away.
- **The campaign name links through to the actual campaign** as managed in
  Personalisation Hub — the same canonical campaign detail page any other
  campaign opens to, not a placeholder. Submitted campaigns are stored and
  displayed exactly like a campaign built in HQ Admin (§6), so the existing
  campaign detail page is the link target; this project adds no separate
  detail view of its own. (The POC's own "Campaign Status" table is an
  explicit stand-in for this section, deleted on integration — see
  `CAMPAIGN-APPROVAL-INTEGRATION.md` — so its campaign name link opens the
  POC's own placeholder detail page only until then. In the POC it is no
  longer its own admin nav item — see *Campaign schedule* under §7 for where
  it now lives.)
- **One row is one campaign** (ticket IDGsyELBJsjlAYjizSqT, 10 Oct 2026,
  replacing "one row is one playlist"): an advertiser authors campaigns one
  at a time through the normal HQ Admin flow and submits each for approval,
  so each lands in this table as its own row (§6 "Campaigns and content
  packages" — the layers of a submission are still one campaign record).
  **Column order, left to right: a selection box, Activation, Advertiser,
  Received, Status, Campaign name, Touch points, Creative ID, DSP, Localised
  variables, Personalised variables, Last used**, then the row menu.
  **Campaign name** replaces *Playlist name* and links to the actual
  campaign (the link above); **hovering it** shows the campaign's details in
  the existing HQ Admin tooltip — advertiser, DSP, touch points, pricing and
  the localised/personalised variables. The *No. of campaigns* column is
  gone (it is one-for-one now). **Touch points** shows the touch points the
  campaign is active on (its brief's `touchPoints`). **Creative ID** shows
  the ID it is grouped under, or an em dash until it is assigned. **Rows are
  grouped by advertiser** (A–Z), keeping the triage order inside each group.
- **Localised variables / Personalised variables columns**: a high-level
  summary in the cell — the deduped Shared Targeting Variable names (§6
  "Shared Targeting Variables") targeted across that playlist's localised
  (respectively personalised) layer(s), or an em dash when that submission
  has none. **On hover, the exact targeting rules behind it** — the
  specific variable, operator and values from every layer of that pricing
  type on this playlist, consolidated into one view, not shown per layer
  separately.
- **There is no per-row accept or reject** (ticket IDGsyELBJsjlAYjizSqT).
  A campaign **Awaiting approval** has a checkbox instead, and its
  activation toggle is shown disabled until it is approved. Approving and
  rejecting are done on the ticked campaigns — see *Creative IDs* below.
  The campaign detail page keeps its own Approve/Reject control next to its
  status bar; approving there does **not** assign a creative ID.
- **Once approved, the activation toggle works** — in the table and on the
  detail page. From that point the advertiser can reserve, bid and activate
  the campaign through the API/DSP interface. The retailer can switch it
  off at any time with the same toggle.
- Campaigns approved automatically are marked as such under their status.
- The review view shows the creative rendered on the target display type's
  canvas, the advertiser and partner, a summary of the targeting rules and
  the automated check results.
- **Compliance check for the reviewer**: advertiser artwork must not contain
  price, offer terms or disclosures. A price baked into supplied artwork is a
  compliance breach that an automated dimension check will not catch, which
  is why a human approves.

### Creative IDs: campaigns are approved one at a time and grouped for the DSP to bid on

A DSP bidding in a **private auction** bids on a **creative ID**, not on one
campaign: the creative ID is the group of an advertiser's approved
campaigns that the bid applies to. The retailer assigns it as part of
approving (ticket IDGsyELBJsjlAYjizSqT).

- **Selection.** On *Upcoming Campaign Approval* the retailer ticks one or
  more campaigns that are **Awaiting approval** (only they have a box). A
  bar above the table shows what can be done with the selection.
- **A creative ID spans one advertiser's campaigns only.** The two assign
  actions appear **only when every ticked campaign belongs to one
  advertiser**; if the selection spans advertisers they are hidden (a hint
  says to choose one advertiser's campaigns) and **Reject…** stays.
- **Two approve actions**, both leading with "Approve" so the retailer
  knows this is the approval of the creative, and both naming the creative
  ID:
  - **Approve + assign to new creative ID** — mints a new ID across the
    ticked campaigns and approves each.
  - **Approve + assign to existing creative ID** — opens a picker listing
    **each of that advertiser's creative IDs with its member campaigns, and
    their touch points, expanded**, so the retailer matches by seeing the
    siblings rather than a bare ID. Choosing one approves the ticked
    campaigns into it. The picker never lists another advertiser's IDs.
- **All or nothing.** The request is checked before anything is written: a
  stale `assetVersion` (the creative changed after the retailer opened it),
  a campaign that is not Awaiting approval, a mixed selection or another
  advertiser's creative ID refuses the whole request and approves none of
  it.
- **The result goes back to the advertiser.** A campaign's status
  (`GET /v1/campaigns/{id}/status`) is one of: **pending**
  (`awaiting_approval`), **rejected** (with the reason) or **assigned to a
  creative ID** (`approved`, with `creativeId`).
- **Reject needs a reason.** **Reject…** on the selection opens a dialog
  whose Reject button stays disabled until a reason is typed. The same
  reason is recorded against each ticked campaign and reaches the advertiser
  as the campaign's status `reason`, to fix before resubmitting.
- **Resubmission.** When an advertiser updates a creative that has a
  creative ID, it goes back to **Awaiting approval** as a pending edit (the
  approved version keeps running, open question 38) and **keeps its creative
  ID**, because the assignment belongs to the campaign, not to one version
  of its creative. In the picker the ID it originally belonged to is
  **pre-highlighted and tagged "original (resubmission)"**, so approving it
  puts it back where it was; the table shows "(resubmission)" beside its ID.
  Rejecting the edit discards it and leaves the live version, and its ID,
  untouched.
- **Data and API.** Migration `0103_creative_ids` adds `creative_ids`
  (ID, advertiser) and `campaign_creative_ids` (campaign → ID).
  `POST /admin/v1/approvals/approve-assign` (approver scope) takes
  `items: [{campaignId, assetVersion}]` and an optional `creativeId`;
  `GET /admin/v1/creative-ids?advertiserId=` lists the IDs with their
  campaigns and touch points; `Approval.creativeId` and
  `CampaignStatus.creativeId` carry the assignment.
- **Auto-approved advertisers group their own campaigns** (ticket
  XnN1Kwl39F8C8DrOkwQn). An advertiser with *Approval required* off has
  every campaign approved on submission, so it never reaches the retailer's
  approval step and nobody else can assign its creative ID. Those
  campaigns (Approved, mode `auto`) get a tick box in the advertiser's
  campaign table in PH Core HQ admin (the same table, filtered to the
  advertiser). Ticking one advertiser's campaigns offers **Generate creative
  ID** (mints a new ID across them) and **Assign to existing creative ID**
  (the same picker, each ID shown with its member campaigns and touch
  points); there is no Approve or Reject, because they are already
  approved. An auto-approved selection cannot be mixed with campaigns
  awaiting the retailer. The advertiser then uses the ID in the DSP.
  `POST /admin/v1/approvals/assign-creative-id` (approver scope) takes
  `campaignIds` and an optional `creativeId`; every campaign must be
  Approved and belong to one advertiser who does not require approval
  (otherwise 400 — the retailer assigns that advertiser's IDs — or 409 if
  not approved), and an existing ID must belong to the same advertiser.
  All or nothing. The POC has no advertiser login, so the HQ admin session
  stands in for the advertiser.
- **Not covered here.** Bidding on a creative ID in the exchange, and
  assigning an ID from the campaign detail page, are separate work.

### Asset-level rejection detail (ticket, 22 Sep)

A campaign carries multiple assets — the mandatory default layer plus any
localised/personalised targeted versions (§3 *Submission*) — so a single
campaign-level rejection reason doesn't say WHICH asset failed. Automated
check results are already per-check (`checks: [{name, passed, detail}]`);
a human rejection now works the same way:

- **A rejection can name reasons against one or more specific assets**, not
  just the campaign as a whole: `reason` (required, as today) is the overall
  summary the advertiser sees first; an optional `assetReasons` — an array
  of `{assetId, reason}` — additionally pins one or more reasons to the
  specific asset(s) that failed (`assetId` is `"default"` or a targeted
  version id, matching `POST /v1/campaigns/{id}/assets`'s `version`).
- **The review view highlights which asset(s) failed**, with the reason on
  each, alongside the overall reason.
- **Automated check results are asset-scoped too**: every `Check` carries
  an optional `assetId` — set for a per-file check (`file_type`,
  `file_size`, `bitrate`, `dimensions`, `aspect_ratio`, `duration`) to the
  asset it ran against, left unset for a campaign-level check
  (`default_present`, `targeting_permitted`) that isn't about one asset.
- **The audit record retains per-asset reasons in history**: a `rejected`
  audit entry carries `assetReasons` the same shape as the live rejection,
  so a later reviewer (or an un-reject, §3 above) can see exactly which
  assets were called out, not just that *something* was rejected.

### Safe reuse of previously approved assets (ticket, 22 Sep)

Narrower than Amazon DSP's asset-level moderation (which lets any passed
asset skip re-review): here, an asset may skip re-review on resubmission
**only when BOTH** hold —

1. it is **unchanged** — byte-identical to the previously reviewed version
   (same content hash), and
2. it previously cleared **human** review, not merely automated checks.

Automated-pass alone must never exempt an asset from human review on its
own: the compliance check (no price/offer terms/disclosures in artwork,
above) is a human visual judgement, so waiving it on the strength of an
automated pass alone could let a compliance breach through on a resubmit
where nothing actually changed except another, unrelated asset. Any
**changed** asset, or a **first-time** asset, always re-reviews regardless
of any other asset's history. Represented in the POC as
`ApprovalService.wasAssetHumanCleared(campaignId, assetId, contentHash)`
(`packages/campaign-approval/src/server/service.ts`, backed by
`campaign_approval_asset_clearance` — a row is written only from a genuine
`approve()`, never from an auto-approve), **and wired into submission**
(open question 40, 29 Sep 2026): `approve()` clears every asset of the
version and its targeting rules; `submit()` and a change on upload approve
a version without review only when every asset and the targeting are
cleared at their current content (audit `reused_clearance`). Otherwise the
version goes to the reviewer with an advisory `previously_cleared` check on
each unchanged asset. For DSP creatives the key is PH's content-derived creative identity: the
creative's campaign id is derived from the advertiser and the content hash,
not from the DSP's crid, so a human clearance covers those exact bytes
across every DSP and crid they arrive under.

### Enforcement and audit

- **Approval is enforced server-side**, not only in the UI. A campaign that
  is not *Approved* is excluded from inventory reservation, bidding and
  hand-off to the existing campaign system, and cannot be activated. Playback
  is not changed: the existing platform only plays active campaigns.
- Every decision records who approved or rejected (or that it was approved
  automatically), when, the reason, and the asset version it applies to.
- **A Rejected campaign is auto-deleted after a retention window** (ticket,
  22 Sep) — rejected campaigns otherwise accumulate and clutter the
  retailer-facing queue, especially once an advertiser has already
  submitted a new version. Default **30 days** from the rejection
  timestamp, a single configurable value (`rejectedCampaignRetentionDays`
  in the POC — `apps/api/src/config.ts`), not hard-coded. **Scope: Rejected
  only** — Draft (already never shown to the retailer, above), Awaiting
  approval and Approved are untouched. **Delete means the campaign record
  and its uploaded assets are removed; the approval audit trail
  (`campaign_approval_audit`) is kept** — a deletion never erases the fact
  that a rejection happened, who made it, when, or why, even though the
  campaign it was about is gone. **Interaction with Undo rejection**: an
  un-rejected campaign is no longer Rejected, so it drops out of scope
  immediately — its clock only restarts if it is rejected again, from that
  new rejection's timestamp. Represented in the POC by
  `apps/api/src/domain/campaignRetention.ts`'s `sweepRejectedCampaigns`,
  run on a daily interval (`apps/api/src/exchange/scheduler.ts`'s
  `startCampaignRetentionScheduler`) the same way the auction and billing
  jobs already run — no separate cron infrastructure needed.

## 3a. SSP settings change history (9 Oct 2026; ticket W9b1lEcTUbEMphsmBma3)

Every change to a retailer-side SSP setting is kept in an append-only audit
log, shown to people on **DSP Integration → Change history** and queryable by
an agent at `GET /admin/v1/ssp-audit-log`. It exists so a floor that moves —
above all when an agent tunes per-display-type CPM — is never unexplained.

- **In scope**: the exchange settings; pricing and auction settings (floor
  CPM, bid lookahead, max play length, category lists, guarantee buffer, …);
  the per-advertiser floor multiplier; which DSPs may target each shared
  variable; every buyers list (deal); every display type's SSP extensions
  (slots: owner, reserve prices and the per-display-type floor, billing unit,
  assignment, deals, locks); and each DSP's bid settings (floor, committed
  plays, QPS, timeout, seats, lists). Anything changed outside the admin API
  (a seed script, a database edit) is not recorded.
- **One entry per field changed**: actor (type `human` or `agent`, id, name,
  and the HQ session it went through), object (type, id, label), change type
  (`created` / `updated` / `deleted`), dotted field path
  (`bidder.floorCpm`, `slots[2].reservePrice`; arrays of objects index from 1),
  old value, new value, time, the request, an optional reason, and a
  `changeId` shared by everything one save changed. A save that changes
  nothing, or is rejected, writes nothing.
- **Recorded around the request, not in each route** (`domain/sspAudit.ts`,
  hooks in `http/app.ts`): a snapshot of every in-scope setting before and
  after each admin write, diffed. A setting added to a route later — or the
  per-display-type floor stored on a slot — is covered without its route
  remembering to log it. Audited writes run one at a time so each diff holds
  only its own change, and the entries are written before the response
  leaves, so a client reading the history right after its save sees it.
- **Who made the change**: the session's HQ user, unless the request says it
  is an agent — `X-Actor-Type: agent` with `X-Actor-Id` (and optionally
  `X-Actor-Name`); `X-Change-Reason` adds a reason for either kind. An agent
  that does not give its id is refused (400). In the POC this is
  self-asserted; on integration the agent's identity comes from the
  platform's service credential (PH-CORE-BOUNDARIES).
- **Query** (admin only): `objectType`, `objectId`, `field` or `fieldPrefix`,
  `actorType`, `actorId`, `changeId`, `from`/`to`, `order` (newest first by
  default), `limit` (≤ 500) and `cursor`. "When did this display type's
  floor last change, and who changed it?" is
  `?objectType=display_type&objectId=<id>&fieldPrefix=slots[2]&limit=1`.
- **Storage**: `ssp_audit_log` (migration 0062). Nothing in the API updates or
  deletes a row.

## 4. Pricing — CPM bid floor and floor multiplier

The currency and the floor are configured
once, company-wide, in **DSP Integration → Advertiser settings → Pricing**;
the floor multiplier is set per advertiser on the **Advertisers** screen.
The currency and the platform floor are company-wide; a DSP's own floor is set
on that DSP's page and a buyers and targeting list's floor on the list
(§4 "The floor hierarchy"). All values are defaults, overridable per retailer.

### Pricing field tooltips

| Field | Tooltip |
|---|---|
| **Pricing** (section) | Effective floor = floor CPM × the advertiser's floor multiplier (set on Advertisers / Inventory), the same for every campaign type. Bids below it never win. Every play bills at the committed CPM. |
| **Currency** | Used for billing and every price shown. The bid floor signal on a request is in USD (§4, The floor hierarchy). |
| **Platform floor price (CPM)** | Cost per thousand assumed views (VAC-d). The minimum floor for every DSP and every buyers and targeting list, which can raise it but never go below it. Bids below the resolved floor never win. |
| **DSP floor price (CPM)** | Optional, per connected DSP. Blank inherits the platform floor; a value raises it for this DSP's bids and cannot go below the platform floor. |
| **Buyers and targeting list floor price (CPM)** | Optional, per list. Blank inherits the DSP floor; a value raises it for bids under this list and cannot go below the platform floor. |

**A tooltip explains its own field and relates it to the others; it does not
repeat them** (Rob, 20 Sep). The platform floor price tooltip carries the VAC-d
worked example.

### Currency

- **Set once, in Advertiser settings → Pricing.** **Any ISO 4217 currency**
  can be chosen; the selector lists every currency by code and name (for
  example *AUD — Australian Dollar*). Default AUD.
- Applies to billing and to every price shown in the console. The bid floor
  signal on the request is stated in USD (§4 "The floor hierarchy").
- **Phase 1: one instance, one currency, no conversion** (Rob, 4 Oct 2026).
  An instance runs inside one retailer's VPC and that retail media network
  trades in its own local currency. Billing and all
  pricing are in that currency (the floor signal on the request is in USD), and advertisers bid into the instance in the
  same currency. There is no cross-currency auction, no FX rates and no
  conversion engine.
- **A bid's currency is a validation check, not a conversion input.** A bid in
  the instance currency clears normally. A bid in any other currency is
  **rejected** with a clear reason (*"Bid in USD; the exchange trades in AUD
  and does not convert."*), never converted or compared against the floor.
  A bid naming no currency is rejected too: the OpenRTB "missing means USD"
  default is not applied.
- Multi-currency bidding and FX conversion are out of scope until a later
  phase.

### Campaign types for pricing

- **Default / Localised**: the creative is the same for everyone in front of
  the screen, including localised versions targeted on **Localisation
  Variables** (§6). An advertiser submits a mandatory default campaign plus
  optional localised versions for its slot.
- **Personalised**: the visitor is **checked in or otherwise identified**,
  so the advert is **one-to-one for that individual**; targeted on
  **Personalisation Variables** (§6).
- **Interactive** — *deferred for this release (5 Oct 2026)*: the visitor
  would interact with the campaign on that display, for example through a
  QR Control campaign. It is hidden everywhere behind `INTERACTIVE_ENABLED`
  and a submission, bid or reservation for one is refused
  `targeting_not_supported`. QR Control remains a display-type feature in
  its own right.

Which version plays, and when, is decided by the existing platform's
targeting evaluation, unchanged; pricing is applied from what actually
played (Billing, below).

### Audience scoring — assumed views come from VAC-d

- The Australian OMA **MOVE** out-of-home standard is the reference, and
  **VAC-d** (Visibility Adjusted Contacts, digital) is the metric for a
  digital signage slot, rather than ROTS. VAC-d is what supplies the
  **assumed views** the CPM floor is charged against.
- PH does not source MOVE data itself. It uses the MOVE methodology as a
  template and provides a framework each retailer populates with its own
  insights and analytics.
- Where a retailer has cameras connected to its screens, PH automates the
  analysis and scoring.

### Floor — a CPM

- **The floor is a CPM: a cost per thousand assumed views.** This is the unit
  DSPs bid in, so the floor applies directly to their bids with no
  conversion.
- **The floor is set at three levels, not one** (see "The floor hierarchy"
  below), and is the same for all displays, irrespective of display type and
  playlist. The platform floor **defaults to 100**. Differentiation
  comes from each slot's VAC-d score (how many assumed views it delivers),
  not from hand-set per-screen prices.
- The floor price is the only price the platform must support for bidding:
  bids below the effective floor (below) do not win.

### The floor hierarchy

Rob, 7 Oct 2026. The floor a bid must clear is resolved from three levels:

| Level | Set | Where |
|---|---|---|
| **Platform floor** | Once, company-wide | Advertiser settings (advanced) |
| **DSP floor** | Per connected DSP | That DSP's page |
| **Buyers and targeting list floor** | Per buyers and targeting list | The list |

- **Resolution.** The most specific floor that is set applies. A blank level
  inherits from the level above it (list ← DSP ← platform). The platform
  floor is the minimum: a DSP floor or a list floor can raise the floor but
  can never set it below the platform floor.
- **Units.** All floors are in USD. The resolved floor is sent on the bid
  request as `imp.bidfloor` with `bidfloorcur` `USD`, and a bid below it is
  rejected.
- **On top of the resolved floor.** VAC-d (the assumed views the CPM is
  charged against) and any personalised price (none today, see 5 Oct 2026)
  apply on top of the resolved floor, as does the advertiser floor
  multiplier (below).
- Every other mention of "the floor" in this document means this resolved
  floor unless it names the platform floor.

### The levers on the floor

| Lever | Default | Where it is set | Applies to |
|---|---|---|---|
| Platform floor CPM (minimum) | 100 | Advertiser settings → Pricing (advanced) | Every campaign |
| DSP floor CPM | blank (inherits) | The DSP's page | That DSP's bids |
| Buyers and targeting list floor CPM | blank (inherits) | The list | Bids under that list |
| Advertiser floor multiplier | **1.0** | Advertisers / Inventory | The floor, per advertiser |

- **Interactive is deferred** (5 Oct 2026): there is no engagement fee
  lever. The stored `interactiveCpe` setting is kept but neither shown nor
  edited, and no price for it is published.
- **The advertiser floor multiplier** reflects the retailer's relationship
  with that advertiser: for example **0.8** for a preferred supplier, **1.2**
  for a new one. Example: 100 × 0.8 = 80 CPM is what that advertiser's bids
  must clear, whatever the campaign type. Advertisers / Inventory shows each advertiser's effective
  floor (resolved floor × its multiplier).
- **Every play bills at the committed CPM** (Rob, 5 Oct 2026). The
  personalised multiplier added on 30 Sep 2026 is removed: the auction
  clears against the resolved floor (× the advertiser's floor multiplier) and a
  window bills at the clearing CPM whichever version played, so there is no
  personalised price anywhere. `PlaybackSource` plays still carry a nullable
  `tier` (`default` / `localised` / `personalised`) as reporting data; billing
  does not price on it (see api/PH-CORE-BOUNDARIES.md, "Playback").
- **Localised campaigns price at the resolved floor CPM** (times the advertiser
  multiplier).
- **Engagements are not billed**: interactive campaigns are deferred (5 Oct 2026).

### Billing

- **Dynamic VAC-d**: bill the CPM against realised VAC-d over each play
  window (share of actual loop time), read from existing playback data. A
  window is its slot's billing unit long (§5 "Billing unit", open question
  27): one line item per window, with expected play time and assumed views
  for that length.
- Because assets must be approved before they play (§3), the pricing and
  allocation model works over extended periods (daily, weekly or monthly)
  rather than purely in real time.
- **Private auctions using the two-period model bill the same way, at a
  fixed rate** (23 Sep 2026 — see §5 "Private auctions (buyers lists)" for
  the two-period model itself). A CPM is a rate, not a fixed sum: the brand
  wins at a bid CPM that then holds for the whole delivery term (no daily
  re-auction), and each billing unit (the slot's own play window — §5 "Billing
  unit"; the display type's default, else 24 hours, when the slot sets
  none) is billed at that agreed CPM against the realised VAC-d for
  that unit. The term total is simply the sum of its billing units'
  settlements at the one agreed rate. This sits between the two other
  risk profiles: **reserved** commits the brand to a premium rate (the
  reserve price) and holds the window, billed on realised VAC-d at that
  rate with no guaranteed volume and no make-good (§5 "Reserve price"); **open real-time** locks nothing, re-clearing price
  on every play (one auction per play, 7 Oct 2026: a win buys that one play, never a block of plays — blocks and volumes belong to deals); a **private auction using the two-period model** locks
  the rate but leaves volume variable — the brand pays for actual views,
  not a guaranteed number, but never re-bids for the term. Mechanically
  this needs no separate billing pipeline: the exchange (§7) books every
  later play window in the term as its own reservation at the locked CPM,
  and each is billed exactly as any other reservation already is.
- **Settlement is final; late playback data is disregarded for billing but
  reported as lost revenue from downtime** (decision Rob, 4 Oct 2026). Two
  linked rules:
  1. **An invoiced window never changes.** Billing settles a window on the
     playback data available at settlement, and the line item it writes is
     the invoice: playback that arrives *after* it is disregarded for billing
     — no re-bill, credit or true-up. Proof of play as known at settlement is
     final. Keeping displays online is the retailer's (the retail media
     network's) operational responsibility, not the advertiser's: an offline
     screen played nothing, so nothing is billed, and the retailer bears its
     own downtime as lost revenue. (Example: 1,000 screens playing, 100
     offline for 24 hours; the window is settled on what the 900 played, and
     the 100 backfill afterwards.)
  2. **The cut-off is the invoice, not the window end.** Playback that
     arrives between the window's end and settlement still counts. Only
     playback that arrives after the line item is written is late. "Arrives"
     means when the platform *received* the play, not when it was played
     (a received-at time per play, see `api/PH-CORE-BOUNDARIES.md`).
  3. **Late data is recorded, never silently dropped.** For each play that
     arrives after its window's line item exists, record what it *would*
     have been worth — its share of realised VAC-d at the window's cleared
     CPM (the reservation's snapshot) — as
     **lost revenue from display downtime**, attributable by store, display
     and over time so a recurring offline problem is visible and quantified.
     The same input has two outcomes: it never re-bills, and it is always
     recorded as would-have-been value. The figure is an operational report
     for the retailer; it is never shown on, or charged to, an advertiser's
     invoice.
  *Build status (4 Oct 2026):* built. Rule 1 holds because a window is
  billed once (`billing_line_items.reservation_id` is unique) and is never
  recomputed. Rule 2: the stand-in playback data carries `received_at`
  (migration 0043); billing counts the plays received by the moment it
  settles (`PlaybackSource.totals` `receivedBy`) and the line item records
  that moment, so a play received after it is late. A play with no
  received-at time is known at settlement, billed as before. Rule 3: the
  late-play ledger (`billing/late.ts`, table `late_plays`) records each late
  play once, at the line item's cleared CPM, never valuing a window above its own assumed views; it runs
  after billing on every scheduler tick and reads only what arrived since its
  last scan. The report is `GET /admin/v1/reports/lost-revenue?from&to&by=store|display|day`
  (per currency, by when the play played). Not built: an HQ Admin screen for
  it (the endpoint is the contract), and an advertiser-facing view, which
  rule 3 forbids.
- **Pre-auction enforcement uses the effective floor CPM** for the campaign's
  type and advertiser. The auction clears against the resolved floor (platform, DSP or list; scaled by
  the advertiser's `floorMultiplier`); there is no personalised price (5 Oct 2026).

## 5. Inventory API

Lets DSPs and advertisers see what inventory exists and what is available to
them. **Inventory is derived directly from the slots assigned on each display
type** (`phExtensions.slots`, §1): every slot owned by *Advertiser*, across
the stores and displays using that display type, is a sellable position.
HQ-owned and store-owned slots are never exposed.

Available to every connected partner. It is read-only and does not change the
tier-1 contract (§6); for tier-1 DSPs, the same positions are also offered
through their own inventory mechanisms where their spec supports it.

### Endpoints

```
GET  /v1/inventory                         sellable positions visible to this partner/advertiser
GET  /v1/inventory/{positionId}            one position in full
GET  /v1/inventory/{positionId}/availability?from=&to=
                                           status per play window across a date range (a position sold by
                                           window: `sale: "window"`); a real-time (open / whitelist-only)
                                           position answers `sale: "realtime"`, `windows: []` and
                                           `bidLookaheadSeconds` — sold per impression, nothing booked ahead
POST /v1/inventory/forecast                projected assumed views for a spec + targeting
```

`GET /v1/inventory` filters: display type, touch point, store or store set,
region, date range, status.

### What each position returns

- Position ID, display type, slot label, zone (for multi-zone).
- Store count and display count in scope.
- Screen and loop context: resolution, orientation, slot duration, loop
  length, share of voice (1 / `maximumCampaignsPlayedInRotation`).
- Assumed views (VAC-d) per play window.
- **Only scored slots are sellable** (decision, Rob, 30 Sep 2026). A slot
  with no audience score (no `audience_vacd` row for the display type and
  slot) reports 0 assumed views, and selling that would bill 0, so it is
  *unscored*: it is left out of `GET /v1/inventory` and the forecast,
  `GET /v1/inventory/{positionId}` answers 404, a bid or reservation on it
  is refused with a 409 that says why, and the auction skips it. There is
  deliberately no fallback estimate: an invented audience number would end
  up on invoices. A slot does **not** need a duration to be sold: duration
  belongs to the campaign asset (set when the advertiser uploads the creative,
  and what billing keys off), not the slot. HQ Admin's Available
  Inventory shows "No audience score yet." on the slot; saving is not
  blocked. A display type may carry a **default VAC-d**
  (`phExtensions.defaultVacd`, assumed views per play window per display,
  1 Oct 2026): a slot with no score of its own is scored from it as the sum
  over the type's displays, each at its own `displays.vacd_override` where
  one is set, so editing the default reaches every display still inheriting
  and leaves overridden ones alone. Only a type with no default and no slot
  score is unscored (e.g. the default was cleared). Rows are inserted by the
  seeds and, on integration, by the retailer's audience scoring; creating
  a display type in HQ Admin does not score it. `positionView.scored` says
  whether a position has a score.
- Assignment: open RTB, whitelist-only, reserved to a named advertiser, or a
  private auction (deal) restricted to a buyers list's invited buyers (see
  *Private auctions (buyers lists)* below).
- **Status per play window**:

| Status | Meaning |
|---|---|
| **Available** | Open for this partner/advertiser to reserve or bid on |
| **Reserved** | Held for a named advertiser (shown as available only to that advertiser); or committed at the reserve price, or inside a locked private-auction term — in those two cases the window is not auctioned and takes no bids until it plays |
| **Sold** | Won or booked for that window, by the one advertiser holding it |
| **Unavailable** | Store closed, display offline, or otherwise not playable |

A position's status is exactly one of these — no **Part-sold** status:
a slot goes to a single advertiser, whose submission carries a mandatory
default layer plus optional localised/personalised upsells, not several
advertisers splitting the position's capacity (§6 "Campaigns and content
packages" has the retired part-sold model and why it never shipped past
this document).

- **Pricing** for the requester, in the company currency: the platform floor CPM
  and the effective floor CPM (§4, the resolved floor for every campaign type), including the requester's own advertiser floor multiplier.
- **Reserve price** (decision, Rob, 22 Sep; real inheritance, 22 Sep): a CPM
  premium at which this position can be reserved in advance of real-time
  selling. A retailer lets an advertiser commit to a premium rate up front
  to hold the slot for a window, which takes that window out of real-time selling. The reserve price is the CPM the booking clears and is billed
  at — not an amount added to the floor — and it must itself clear the
  buyer's effective floor (§4). A booking is billed on realised VAC-d at
  that CPM, as a floor commitment: no guaranteed volume, no make-good (§4
  Billing). `null` when no reserve is set. **Reserved slots are the only slots
  that play personalised versions** (decision, Rob, 5 Oct 2026): once
  committed, the advertiser submits the personalised variations their
  creative needs alongside the mandatory default. Tooltip on the Reserve
  price column and the display type's reserve price field: *"The premium CPM
  an advertiser commits to up front to hold this slot for a window, out of the
  open auction. Reserved slots are the only slots that play personalised
  versions: once committed, the advertiser submits the personalised
  variations their creative needs alongside the default."* Genuine §1 configuration inheritance, not a copy action: a display
  type carries its own reserve price default, and a slot's own reserve
  price overrides it whenever one is set — a slot with none simply follows
  its display type, and setting the default reaches every slot on it
  automatically, with no per-slot action needed. **One simplification, kept
  deliberately narrow**: a slot's own value can only be a real premium, never
  an explicit "no reserve" while its display type has a default — clearing a
  slot's override always means "follow the default," the same reading
  `null` already carries everywhere else in this inheritance. An earlier
  design (a plain per-slot value with a "copy to every other slot" action,
  no stored default) failed testing for not actually running the
  inheritance the ticket asked for.

  **The booking flow** (Rob, 29 Sep 2026; open questions 45 and 52):
  1. **Commit.** A buyer sends `POST /v1/reservations` with `type: reserve`
     for a future window, any time before that window starts. Its
     `bidCpm` must be at least the reserve price (`400 validation_failed`
     otherwise); the booking is made at the reserve price, which must clear
     the buyer's effective floor (`422 below_floor` otherwise).
  2. **Held as Reserved.** The window is booked and handed off at once. Its
     availability reads **Reserved**; no auction clears it, bids
     already waiting on it are settled lost, and new bids are refused.
  3. **Honoured.** When the window plays, the booking stands at the reserve
     price.
  4. **Billed** on the window's realised VAC-d at the reserve price.

  On a private auction using the two-period model, the commitment locks the
  deal's whole delivery term at the reserve price (see "Private auctions
  (buyers lists)" → locked rate).

### Visibility rules

- A partner or advertiser sees only positions it could actually buy.
  A blacklisted advertiser, or one excluded by a whitelist-only position,
  does not see that position; **permissioning shows up as a smaller list,
  never as a rejected request.**
- Positions reserved to another advertiser are not shown.
- **Availability is a forecast, and targeting changes it.** The forecast
  endpoint takes targeting rules as input, since a campaign gated on a single
  store segment delivers a fraction of an untargeted baseline: predicates go
  in and a share comes out (`AudienceSource.targetedShare`). It is not the
  removed reach-count API and returns no per-display counts.

### Available Inventory — the retailer's view

The same positions are shown to the retailer on **Advertisers / Inventory →
Available Inventory**: every advertiser-owned slot across the estate that
connected DSPs can bid on, one row per slot. **Playlist-primary** (ticket
"Available Inventory: playlist-primary table (drop Display type column)
with Unassigned indicator", 27 Sep 2026 — this replaced an earlier layout
that led with a separate **Display type** column): columns are **Playlist**,
**Slot**, **Position**, **Assigned to**, **Reserve
price**, **Max campaigns**, **Max play length**, **Billing unit** and an **Open** link to the
display type. There is **no advertisers column** and no separate Display
type column. Every column carries a filter, as the platform's tables do.

**Playlist** is the primary column because a display type is not the right
unit of sellable inventory: a multi-zone display type (e.g. a Menu Board
split into Zone 1/2/3) can run several independent zone playlists, each with
its own advertiser slots or none at all (§1 "A slot is a playlist
position") — the table shows one row per advertiser slot, under the
playlist it belongs to (its zone's, on a multi-zone display type — each
zone has its own slots, 28 Sep 2026), and **a playlist with no advertiser
slot simply produces no row** ("Playlists with no advertiser slots do not
appear" — for a Menu Board with three zones, only the zones that actually
have an advertiser slot show up; three zones with two Advertiser slots each
are six rows). The Playlist cell also carries the two
enabled display-type features that used to sit on the removed Display type
column — **Vision/AI** and **QR Control** — so they aren't lost, plus an
**Unassigned** indicator (icon + label, tooltip explains it) when the
position's display type currently has **no physical display using it**
(Displays & Devices, `DisplaySource.summaryByDisplayType`): its advertiser
slots exist and can be configured and sold, but nothing is actually playing
them. This is the same "no displays" signal `GET /v1/inventory`'s
`windowStatus` already reads to mark a position **Unavailable** on the
Partner API (*What each position returns*, above) — Unassigned is that same
underlying fact, surfaced to the retailer instead of the DSP. **Not a
live/active state** — this build has no such concept, and Unassigned is
never about whether campaigns are currently playing, only whether any
display exists to play them at all.

Slots are made available by setting their owner to *Advertiser* on a playlist
(explained in the section's tooltip); that part is not editable here.
Two fields are: **Assigned to** (above), a multi-select that drops a pill
per choice into the cell, and **Reserve price**, a CPM input (blank = following the display type's default, or no
reserve if it has none either). Editing a slot that has no override of its
own edits its display type's shared default instead, reaching every other
slot on that display type at once; an **Override** action next to the input
lets one slot diverge with its own value (shown alongside a **reset to
default** action once it has), independent from then on (decision, Rob,
22 Sep; real inheritance, 22 Sep — see *Reserve price* under *What each
position returns*, above, for the currency, the billing note, the "override
always wins, no explicit opt-out" simplification, and what's not built yet).
**Admin only**, same as the other two; a marketing user reads it as plain
text — the resolved value, not which of the two levels it came from.
**Targeting is not set per slot** (Rob, 7 Oct 2026; there was a per-slot setting
for it from 20 Sep): what a buyer may target is
defined on the buyers and targeting list. The one rule that remains on the
slot side is that personalised versions are sold only through reserve
booking or on a deal: a personalised campaign is accepted in a reserve
booking (`POST /v1/reservations`, `type: reserve`) on a slot with a reserve
price (its own or inherited; Rob, 5 Oct 2026) and, since 8 Oct 2026, in a bid
or reservation on a position held by a buyers-list deal (private auction,
preferred, guaranteed); a bid for one on an open real-time position is refused
`targeting_not_supported`. **Admin only**: a
marketing user sees the fields but can't change them.

**Interactive is deferred** (5 Oct 2026). It is not offered in the picker;
a slot that had it ticked reads as the remaining types (localised by
default), the API drops it from a save instead of refusing it, and a
submission, bid or reservation for an interactive campaign is refused
`targeting_not_supported`. The earlier "Interactive needs QR Control"
greying and the interactive reserve price column are hidden with it; the
Playlist cell still flags a display type that has QR Control.

### Private auctions (buyers lists) (23 Sep 2026)

Today PH only exposes a floor price to the DSP: it cannot run a private
auction where a defined set of brands is invited to bid on a position. This
adds a third assignment mode alongside open RTB and reserved, sitting
entirely within Available Inventory / Advertisers — Managed Displays and
display types are unaffected, since slots are managed by the retail media
team here, not there.

**A buyers list is a reusable deal object**, created once and attached to
any number of positions — one deal, many slots, not one deal per slot.
It carries:

- **Name and description**, so it is distinguishable in its own table (below).
- **Invited buyers**: a **multi-select dropdown of the advertisers (seats)
  that connected DSPs have synced** — each option reads as the advertiser's
  name plus which DSP it comes from, grouped by DSP. Nobody types anything,
  and there is no identifier-type picker, no "PH brand entity" name match
  and no "other" (Rob, 4 Oct 2026; ticket W8wjh2wtFTnHZUO0Exuu — it
  replaced the earlier brandEntity / dspSeatId / other scheme, which gated a
  real auction on a loose name match). Each selected buyer is stored as the
  DSP and the seat ID that DSP issued (`{ partnerId, seatId }`), so it
  always carries a real identifier the DSP bids under. The API refuses an
  entry whose DSP is not connected or whose seat that DSP never synced.
  An entry whose seat later disappears from a re-sync stays on the list
  (shown "no longer synced" so it can be removed) and matches nobody.
- **Invited IAB categories** (ticket M9aTqeDgGfRZoL3AEw9i): an optional
  multi-select of **IAB Content Taxonomy categories**, so a list can invite
  a whole category of buyers (say, every automotive advertiser) without
  naming each one. It is a **union with the named advertisers above**: a
  seat is invited if it is one of the named buyers *or* its category is one
  of the invited categories. Only the IAB taxonomy is offered — no free-text
  or custom categories. Categories are **resolved live** against each
  seat's `Seat.category` (the category its DSP reports at sync) every time,
  never copied onto the list, so a re-sync that changes a seat's category,
  or a newly synced seat in an invited category, takes effect immediately
  with nothing to re-save. A seat with no reported category matches no
  category. A list with **no named buyers and no invited categories admits
  nobody** (it does not fall back to open RTB). The buyers-list table shows
  each list's **scope** — the named buyers and/or invited categories.
- **Delivery term**: inclusive `activeFrom`/`activeTo` — the span this deal
  is awarded for (a week, a month, a quarter); either or both may be
  open-ended. Outside it, the deal admits nobody — it does not fall back
  to open RTB. (Named "active time window" before the two-period model
  below split it from the auction window; the field names are unchanged.)
- **Auction window** (`auctionCloses`, 23 Sep 2026 — the two-period model):
  a second, narrower, optional period distinct from the delivery term
  above. Bidding for a private auction is **not** slot-by-slot per play —
  a brand bids to hold a slot position across the whole delivery term, not
  once per window — so a deal using this model carries its own one-time
  bidding deadline: invited brands may submit and revise bids until
  `auctionCloses`, and the first bid that clears within it locks the
  winning CPM for the rest of the delivery term (`lockedWin`; see "Locked
  rate" below). `auctionCloses` is null on a deal that isn't using this
  model — it keeps clearing a fresh auction every play window, exactly as
  a buyers list always has (unchanged default behaviour; this is
  additive, not a breaking change to every existing deal). Bidding on a
  window stays open until it starts or the private auction has cleared it;
  there is no company cutoff time (removed 8 Oct 2026).

**Explicitly not on the buyers list** — each already has its own home, and
duplicating it per deal would let one drift from the other:

- **Floor** is never set on the deal. It is inherited from the position
  (§4, driven by the display type/slot's own reserve and floor), the same as
  every other assignment mode. Rationale: the floor is the retailer's
  opportunity cost: if no invited brand clears it, the retailer shows its
  own mandatory default campaign rather than sell too cheap — a private
  auction that clears nothing falls through exactly the way an open auction
  with no qualifying bid already does.
- **A deal is per DSP and priced on top of the floor** (Rob, 29 Sep 2026;
  open question 45). It is bilateral: its invited buyers resolve to DSP
  seats, and a locked term binds one DSP's buyer; there is no company-wide
  deal. Its rate is a commitment on top of the same score-driven floor,
  never under it: a bid or reserve below the effective floor is refused
  `below_floor`, and a locked-term window whose rate has fallen below the
  floor in force when it is booked (the floor or a multiplier rose) is not
  sold and falls through to the default campaign. Programmatic guaranteed
  is the reserve-price booking flow (§5 "Reserve price"), delivered with it
  (open question 52).
- **Volume lives on the deal, never the open auction** (Rob, 7 Oct 2026;
  open question 45). A deal may carry `committedPlays` over its delivery
  term; delivery (`deliveredPlays`) is metered in plays from billing line
  items at the deal's positions, within the term, and the Buyers lists
  table shows only the committed figure, "M plays" (or "Per play"), never "N of M" (8 Oct 2026: a guaranteed deal is sold, not capped). The open auction holds
  no block of plays: no open-RTB position can carry a volume. This replaces
  the "re-auction after N plays" idea.
- **Buyers and targeting table column order** (Rob, 9 Oct 2026; ticket
  NaIaKMgfutxgGaN84SDi): Buyers and targeting, CPM (agreed/committed rate, always
  second), Deal type, Invited buyers, Committed volume, Estimated volume,
  Targeting, Delivery term. *Estimated volume* (was "Capacity") is an estimate
  of the plays per window available to the list from the criteria set on it,
  summed over its assigned positions; its tooltip says it is not a hard figure.
- **Auction resolution rule** (first- vs second-price) is a platform-wide
  setting, defaulting to first-price (this build only implements
  first-price — see §7's clearing rule) — never overridden per list.
- **The per-brand relationship variable** stays global, a property of the
  brand entity (§6's shared targeting variables) — never overridable per deal.

**A position's Assigned to** (Available Inventory) gets a third choice
alongside DSPs/named advertisers and the whitelist: pick an existing buyers
list, or create one inline via **"+ Add new buyers list…"**, which opens the
buyers-list modal and, on save, assigns the new list straight to that
position without touching its other fields. In the picker, the **Buyers
lists (private auction)** option group sits directly under **DSPs** and
above **Advertisers** (failed-testing feedback, 23 Sep — it originally sat
after Advertisers, which read as buried). An advertiser that buys through
more than one DSP gets **one** option, not one per DSP — e.g. "Unilever
(Google DSP, The Trade Desk)" — since two options sharing the same value
left a multi-select able to show only one as selected (also 23 Sep failed
testing). A buyers list is **mutually exclusive** with named advertisers and
the whitelist — assigning one clears the other two, same "newer choice
wins" rule already governing advertisers vs. whitelist. Underneath
Available Inventory, a **Buyers lists** table lists every buyers list
(name/description, invited buyer count, delivery term, and its rate —
"Clears every window", "Bidding closes `<auctionCloses>`" or "Locked:
`<cpm>` CPM"), with **Edit** and **Delete**; delete is refused
(`has_dependents`) while any slot is still assigned to it. Saving the modal (create or edit) always surfaces a message
on failure, even when the API's error carries no field-level `details` to
attach to one input — a save that fails silently is indistinguishable from
the option not being there at all, which is what made this ticket read as
broken in the hosted (read-only) demo, where every write is exactly that
kind of error (23 Sep).

**Entitlement is enforced the same way blacklist/whitelist already are**
(§6 "Advertiser lists"), at both bid intake (OpenRTB response and the API's
`POST /v1/reservations`) and again when the auction clears: a bid from a
seat that is not one of the deal's invited buyers (matched exactly on its DSP and seat ID, or by the DSP-reported category of its seat against the list's invited IAB categories), or that arrives outside
the deal's delivery term, is refused `not_invited`, naming the deal. Unlike
`reserved`, a deal position is **not** taken out of the open auction and
booked directly — until its rate locks (below), it runs as a real auction
(bid requests go out, first price clears among whoever qualifies), just
restricted to the invited buyers rather than every connected DSP. Which
DSPs actually receive bid requests for a deal position is **resolved live
from the buyers list's current invited buyers** every time (not cached on
the slot), so editing a list's invited buyers takes effect immediately on
every position it's attached to, with nothing to re-save per slot. A
buyers list that is deleted — or one whose invited buyers currently match
no connected DSP's seats — correctly admits **nobody**, not everybody:
this is the one place in the assignment model where an empty resolved DSP
list means "restricted to none" rather than "unrestricted."

**Locked rate (the two-period model, 23 Sep 2026)**: a deal with
`auctionCloses` set runs exactly like any other deal — a real auction,
bid requests going out each play window — until a bid clears at or before
that deadline. That clear is the term's one deciding auction: the winning
identity and CPM are written to `lockedWin` (once, never overwritten —
first clear wins) and every later play window in the delivery term is
booked **directly** at that rate, with no bid requests and no fresh
clearing (`exchange/auction.ts`'s `bookLockedTermWindow`). An invited
buyer's reserve-price commitment (§5 "Reserve price") locks the term the
same way, at the reserve price (`lockedWin.source: reserve`); its windows
are then held and booked as Reserved. Each such window
is still its own reservation, still billed on its own realised VAC-d for
that window (§4 "Billing") — dynamic VAC-d is unchanged, only the rate is
fixed for the term rather than re-cleared per unit. If `auctionCloses`
passes with nothing having cleared, the deal simply stops soliciting bids
for the rest of the delivery term — the same "falls through, no reserve
floor is ever crossed" outcome as an expired delivery term. A deal with no
`auctionCloses` never locks and keeps clearing fresh every window, exactly
as a buyers list always has.

**Billing unit** (`billingUnitHours` on a slot, with a display-type-level
default — same override-always-wins inheritance as reserve price, §5
"Reserve price" above; when neither is set the slot uses the platform
default of 24 hours/one day, a named constant rather than a setting — the
company-wide play-window length setting was removed 8 Oct 2026): the granularity a CPM is
quoted and charged against, surfaced in Available Inventory next to Reserve
price. **It is the source of truth for the slot's play-window length and
billing granularity** (open question 27, decision Rob, 29 Sep 2026): every
slot — not only private auctions using the two-period model — is
booked, bid on, handed off and billed in windows one billing unit long, each billed
on its own realised VAC-d (§4 "Billing"). Windows of every length are laid
back to back from the same fixed Monday 00:00 UTC, so a 7-day slot's
windows start on Mondays that are also daily slots' window starts, and one
auction clears both. Whole hours, 1 hour to 365 days. A slot's billing unit
can't change while it has live windows bid on, booked or not yet billed
under the current one; the save is refused `400 validation_failed`, naming
when the last one ends. (There is no company play-window length to change, so no deferred
change with an effective date: `playWindowHours` and its pending-change
bookkeeping were removed 8 Oct 2026, and a `billingUnitHours` change is
refused `400` for as long as the slot has unbilled windows.)

**Max campaigns** (`maxCampaigns` on a slot, with a display-type-level
default — same override-always-wins inheritance as reserve price and
billing unit above; platform default 5 when neither is set; 1-10
inclusive): the retailer-controlled maximum number of campaigns — the
mandatory default layer plus optional targeted versions — an advertiser
may submit for this slot (ticket "Available Inventory: Max campaigns
column + slot playlist statement"). Admin-editable, marketing read-only,
with a filter like every other column and an info tooltip: "The maximum
number of campaigns this advertiser can submit for this slot. To submit
more, purchase additional slots." **Purely a submission cap — it does not
feed the auction or billing.** It is the single authority on how many
campaigns an advertiser may submit for a slot, replacing the blanket
20-targeted-versions cap (§6, security submission bounds) for that slot
once a submission names it; without a resolvable slot, the platform-wide
20-cap still applies unchanged.

**Max play length** (`maxPlayLengthSec` on a slot, with a display-type-level
default and a company default in Advertiser settings — same
override-always-wins inheritance as the settings above: slot, else display
type, else company; platform default 15 seconds; whole seconds, 1-600): the
fixed duration of one play of the slot (ticket "Max play length as an
inherited slot setting", 7 Oct 2026). It is the divisor of the plays model:
`playsPerWindow` = floor(window / max play length) — never the loop length
and never a creative's own length. A creative longer than the slot's max play
length fails the upload duration check and is **rejected, not truncated**;
the upload check uses the longest max play length among the display type's
advertiser slots, and each slot's own value is re-checked at hand-off and at
real-time bid. Admin-editable on Available Inventory, marketing read-only.
*PH Core seam:* the loop must be built from the resolved slot length so a
play really lasts that long — see `api/PH-CORE-BOUNDARIES.md`, "Max play
length: the loop must be built from the resolved slot length".

**Plays per window** (derived, never typed; ticket "Derive plays per window
from slot length x slots / billing unit", 8 Oct 2026; `apps/api/src/domain/plays.ts`):
how many plays one slot gets on one display in one window.

```
loop length      = max slot length x slots in rotation
plays per window = floor(billing unit / loop length)
```

- **Billing unit** is the slot's play-window length (§5 "Billing unit").
- **Max slot length** is the resolved Max play length (§5 "Max play length":
  slot, else display type, else company). It binds **every** campaign on the
  loop, HQ campaigns included, so a position's play length never varies with
  who is booked or with a creative's own length.
- **Slots in rotation** is the number of positions in the playlist loop (Max
  campaigns in rotation, Playlist Management). **HQ positions are counted**
  as well as advertiser ones: HQ slots fill part of the same loop even though
  Available Inventory lists advertiser slots only. A position plays once per
  loop, so more slots in the loop means fewer plays per window.
- A window shorter than one loop holds 0 plays; there is always at least one
  slot in a rotation.

Available Inventory shows two read-only columns for it: **Slots playing** (the
loop's slot count, HQ included) and **Plays per window** (the formula above,
recalculated in the editor as the max slot length or billing unit is changed
before saving). *PH Core seam:* the loop PH Core builds must use the same
resolved max slot length and slot count so a play really lasts that long —
see `api/PH-CORE-BOUNDARIES.md`.

## 6. DSP integration — the advertiser & DSP interface

How an advertiser finds inventory (§5), takes it and fills it. This is the API
surface of the project and the part a partner actually integrates against.
The retailer configures it under the **DSP Integration** navigation item.


### Prioritised buyers lists — the waterfall (7 Oct 2026)

Decided by Rob, 7 Oct 2026 (Broadsign model): **priority is a property of how
a list is applied to a slot, not of the list.** A slot's "Assigned to" holds
an **ordered** list of buyers lists (`Slot.buyersListIds`, highest first;
`buyersListId` stays as the first for older readers; a slot saved with one
`buyersListId` is a one-tier waterfall). One list can be on many slots and
rank differently on each.

- **Exchange**: the auction walks the tiers top-down (`exchange/auction.ts`
  `clearPosition` → `auctionTier`). Each tier is the position as if only that
  list were assigned (`tierOf`), so invited buyers, deal ID, the three-level
  floor and the term are that list's own. The first tier with a valid winning
  bid at its floor takes the window; otherwise it falls through. A tier whose
  private auction has closed is passed over; a locked-rate tier books the
  window when reached. An API bid a tier refuses stays pending for the next
  tier. **One list per tier this release** — no same-tier price competition.
- **Admin**: Advertisers / Inventory shows the assigned lists as rows in
  priority order under the slot's picker; drag a row (or use the arrows) to
  reorder; a position badge shows the rank. New lists join at the foot. The
  priority rows only appear once two or more lists are assigned to the slot —
  with one list there is nothing to order, so none are shown
  (unless the slot also has an Open auction tier; see below).
- **API**: `assignedTo.buyersListIds` (ordered, no duplicates, each must
  exist); `buyersListId` alone is still accepted.
- Known edge: a reserve commitment (`type: reserve`) on a waterfall slot
  locks the term of the top tier's list.

#### Deals and the Open auction share one priority order (9 Oct 2026)

A DSP and a buyers list are not mutually exclusive on a slot. The priority order
is:

1. **Deals** — resolved ahead of time, on lookahead.
2. **An explicit Open auction separator** — real time, per play.
3. **The DSPs the Open auction runs across**, or **All DSPs**
   (`assignedTo.partnerIds` empty with `assignedTo.openAuction` true).

If no deal wins, the slot falls through to the Open auction.

- **Data**: `Slot.openAuction` / `assignedTo.openAuction`. Absent means false, so
  older slots are unchanged.
- **Admin**: a DSP group headed **DSPs (open auction)**, starting with **All
  DSPs**. All DSPs and named DSPs are alternatives. Picking one never clears
  deals, and adding a deal never clears DSPs.
- **Still exclusive**: named advertisers and the whitelist clear deals and the
  Open auction (the API answers 400).
- **Not yet in the exchange**: real-time Open auction fallthrough for a window
  no deal wins (tracked on a sibling ticket).

### The global deal — one deal ID for all open inventory (8 Oct 2026)

Decided by Rob, 8 Oct 2026 (mirrors Vistar's global deal ID). Open programmatic
DOOH is still early, and many DSPs can only transact on a deal ID. A single
**global deal** resolves to every open, exchange-eligible position on this
instance, so such a DSP targets one deal ID with its own targeting instead of
a deal per position.

- **Two layers of retailer control.** (1) An instance-level master switch in
  Exchange settings (`exchange.globalDealEnabled`, off for a new instance).
  (2) A per-slot **include in global deal** flag (`Slot.inGlobalDeal`),
  **defaulting on**: opt-out, not opt-in. It sits next to the Advertiser
  assignment on Advertisers / Inventory.
- **Deference rule.** The flag is suppressed whenever the slot is held for a
  named advertiser, whitelist-only or assigned to a buyers list (and an
  advertiser or seat on the blacklist is refused as on any open bid), so the
  default never exposes inventory the retailer meant to restrict. Being open
  and being in the global deal are not the same thing. The admin shows the
  flag disabled with the reason.
- **Bidding.** A global-deal bid competes exactly as on the open exchange:
  same base floor, first-price, same pre-auction checks, approval gate and USD
  rule. It does not lower the floor, grants no guaranteed delivery and is open
  inventory behind a deal handle, not a PMP/PG deal. The request carries
  `pmp.deals[0].id = PH-GLOBAL` with `private_auction: 0` and no `wseat`, so it
  is never mistaken for a private or locked deal at bid time; a real PMP deal
  still wins its own way. A bid quoting `PH-GLOBAL` where the position is not
  in the global deal is rejected.
- Surfaces: the per-slot flag on Advertisers / Inventory; the master switch and
  the ID in Exchange settings; `api/API.md` ("The global deal"). Tests: unit
  gate M11 (`apps/api/test/global-deal.test.ts`) and E2E run 3 cases P9–P11.

### Two API tiers

- **Tier 1 — baseline, mandatory.** Conform to the **published interface of
  Google DSP (Display & Video 360) and Amazon Ads DSP exactly**. We implement
  their contract; we do not design it. What a tier-1 partner can express is
  whatever their own spec carries, no more.
- **Tier 2 — extended, per relationship.** A PH-native API for direct and
  local partners (Blackmores is the worked example) where a bilateral
  agreement exists. This is where granular targeting beyond the DSP specs
  lives.

**Tier 2 is strictly additive.** A tier-1 partner must work correctly with
every tier-2 feature switched off, and no tier-2 feature may change tier-1
semantics.

**Neither tier is the eventual agent-to-agent, instance-to-instance surface**
(§9.4) — that is a separate, first-class surface for a PH instance's agent
to negotiate with another PH instance's agent, not a partner integrating
against either API tier here.

### Campaigns and content packages — what an advertiser submits

An advertiser submits a campaign (content package) for its slot: **exactly
one mandatory default layer**, plus zero or more **targeted versions**
(localised and/or personalised), each with targeting rules and an integer
`priority`, as optional upsells on that one purchase.

**default is mandatory on every submission (decision, Rob, 22 Sep,
superseding the earlier same-day "baseline optional" decision — ticket
"Make default creative mandatory; retire localised-only booking path").**
Earlier the same day, an advertiser was allowed to submit only localised
targeted versions and skip the baseline/default layer altogether, leaving
stores its criteria didn't match unsold to it. That model is retired:

- **A slot goes to one advertiser, not several.** The part-sold model this
  section used to describe — a slot's own fallback content, independent of
  any one advertiser's submission, filling in the capacity a localised
  variant's targeting didn't reach, so a second advertiser could buy the
  remainder — never actually shipped past this section's own documentation
  of the target model: the auction/reservation engine already enforced a
  single Available/Sold/Reserved/Unavailable unit per position and window
  throughout (§5, §7 Billing), so retiring the part-sold submission shape
  is retiring a plan, not a running behaviour. The **Part-sold** position
  status (§5) is removed along with it.
- **Personalised versions play in a reserve-held or deal-held window, never
  the open real-time auction** (Rob, 5 Oct 2026; widened to deals 8 Oct 2026):
  the open per-impression path cannot resolve personalised targeting and
  render approved creative inside the bid window, so it clears default and
  localised only. A reserve booking or a deal (private auction, preferred,
  guaranteed) is pre-committed, so the advertiser submits the personalised
  variations alongside the mandatory default; it bills on realised VAC-d at
  the booked rate, with no special billing. A guaranteed deal's committed
  volume comes from the targeted assumed views (the share of the slot's VAC-d
  its personalised versions reach, e.g. the gendered subset a camera
  detects), not the whole VAC-d.
- **localised and personalised are upsells on the one purchase**, not
  alternatives to it: a booking's tile stacks whichever of the two the
  advertiser's submission also carries, on top of the mandatory default
  base (ticket "Booking schedule: single-advertiser stacking tile" — see
  the booking schedule functional requirement below).
- Open questions 50 and 51 (below) — the target algorithm for clearing
  overlapping localised bids and billing a part-sold position — are
  **superseded, not answered**: there is no longer a part-sold position for
  either to apply to.
- **How many campaigns a submission may carry** (default + targeted
  versions) is bounded by the slot's own **Max campaigns** (§5, ticket
  "Available Inventory: Max campaigns column + slot playlist statement")
  once `POST /v1/campaigns` names that `displayTypeId` and `slot` — the
  single authority for that slot, replacing the platform-wide
  20-targeted-versions cap below. A submission naming no slot (or one that
  doesn't resolve to a real advertiser slot) still falls back to that
  platform-wide cap, unscoped to any one slot.

> Named *default*, not *baseline* (decision, Rob, 22 Sep, reversing this
> section's own earlier same-day note that warned off *default* because
> `campaignCreativeSettings` already uses `default` / `selected` /
> `unselected` for the existing platform's device-pairing scene state on a
> playlist item). That collision risk is judged narrow enough to accept:
> the two never appear in the same object — `campaignCreativeSettings` is
> nested under a playlist item's own settings, and this project's `default`
> is a sibling of `targeted` on a campaign's own targeting — so there is no
> single JSON blob where the same key means two different things, only two
> unrelated schemas that happen to share an English word. "Default" also
> maps directly onto the pricing floor (§4: the default layer prices at the
> same floor rate as localised), which "baseline" didn't make as obvious.
> Reviewers integrating this against the real platform should still search
> for `campaignCreativeSettings.default` before assuming the two can be
> handled identically in code that touches both.

**Targeting rules use the existing Targeting tab structure**: each condition
is *data source → variable → operator → value(s)*; conditions within a group
are joined with **OR**, and groups are joined with **AND**. Operators are the
platform's existing ones (for example *includes selected*, *excludes
selected*, *equal*, *greater than*).

**What this project does with them:**

- **Validates** that every condition uses only variables permitted for the
  advertiser's DSP (*Which DSPs may target each variable*, below). A rule
  using a variable that isn't permitted is rejected with the variable named.
  SKU conditions accept a list of at most **100 SKUs** — the same cap as
  the targeting grammar's 100 values per condition, not a separate limit
  (open question 48). More is refused `400 validation_failed`.
- **Stores** the validated campaign and its rules in the **existing campaign
  and targeting structure**, so it is stored and displayed exactly like a
  campaign built in HQ Admin.
- Once approved (§3) and won or reserved (§7), **hands it to the existing
  campaign system** for that slot.

**What this project does not do:** evaluate targeting, decide which version
plays, order or time the rotation, or report on what played. All of that is
existing Personalisation Hub behaviour and is unchanged; the submitted
campaign is evaluated, played and reported on exactly like any other
campaign. **Falling back when nothing more specific matches is simply the
mandatory default layer** now (decision, 22 Sep) — every submission has
one, so there is no separate "what plays when a slot has no fallback
content" question to answer.

### Shared Targeting Variables — Localisation and Personalisation Variables

**Shared Targeting Variables** are the variables shared through the API with
connected DSPs. **Once a variable is enabled for a DSP, that DSP's
advertisers can use it in targeting conditions for more advanced campaign
targeting.** They are the **same variables as a campaign's Targeting tab**.
This release exposes the **default platform variables only**, shown
read-only in **DSP Integration → Shared Targeting Variables** (the page and
its entry in the DSP Integration list carry this name), grouped under two
headings; managing (adding or editing) variables is a later release.
**Languages Spoken by Store Staff is not supported initially and was
removed from the default set (ticket, 22 Sep); a later release will add it
back.**

| Group | Variables, in display order |
|---|---|
| **Localisation Variables** | Store Open / Closed; Fixed Store Segments; Variable Store Segments; Display Tag(s); Suburb; Postcode; State; Country |
| **Personalisation Variables** | Gender (Computer Vision); Estimated Age (Computer Vision); Reason for Visit (Aggregate); Device Type (Aggregate); Purchase Intent; Purchase History; SKUs; Events; Age; Gender; Visitor Segments; Reason for Visit; Device Type; Product Holdings; Product Type; Plan Type; Plan Value |

- **Localisation Variables** describe the store and the moment: whether the
  store is open or closed, the store record and its segments, display tags,
  suburb, postcode, state and country:
  - **Store Open / Closed**: whether the store is open or closed at the time,
    from its store hours (values *Open*, *Closed*). It sits at the top of the
    list.
- **Personalisation Variables** describe the identified visitor. They are
  PH Core's visitor variables, populated by the Live Visitor Profile project
  and evaluated by PH Core; this build only grants and validates their use,
  per DSP, on Shared Targeting Variables. The list opens with the
  Computer Vision and aggregate variables, then Purchase Intent, Purchase
  History, SKUs and Events, then the rest. **Gender and Age each appear
  twice on purpose**: *Gender (Computer Vision)* and *Estimated Age
  (Computer Vision)* come from Vision/AI, *Gender* and *Age* from the
  systems that hold the customer record. They are distinct variables. Some
  of them need a note:
  - **Gender (Computer Vision)**: detected by Vision/AI for the person in
    front of the display (for example Female, Male). Nothing leaves the store.
  - **Estimated Age (Computer Vision)**: an age band estimated by Vision/AI
    (for example 18–24, 25–34, 35–44). The two Computer Vision variables only
    have values on displays with Vision/AI enabled; how the existing platform
    evaluates them is unchanged.
  - **Reason for Visit (Aggregate)** and **Device Type (Aggregate)**: the
    whole queue or store right now, not one visitor (the share waiting for
    the same reason, or carrying each device). *Reason for Visit* and
    *Device Type* below them are the individual visitor's.
  - **Device Type**: the device the visitor has with them in store (for
    example iPhone, Pixel, Samsung).
  - **Events**: events that occurred in store or in a previous web session
    (for example *Scanned QR code*, *Viewed product page*, *Added to cart*).
  - **SKUs**: the SKUs the visitor has looked at before. An advertiser
    **targets by listing SKUs**; the condition is met when the visitor's SKUs
    include any of the listed ones (evaluated by the existing platform).
- **Each group is a two-column table**: *Variable* and *DSPs that may target
  it*. There is no values column; instead each variable name has an **info
  icon** whose **tooltip, on hover or keyboard focus, shows example values**
  (for example *Fixed Store Segments — e.g. Airport, Metro, Regional*;
  *Variable Store Segments — e.g. Cold Day, iPhone 17 – Out of Stock*;
  *Device Type — e.g. iPhone, Pixel, Samsung*).
- **Other tooltips** (see *Help text*): the page title (wording in *Help
  text*); each group heading (what the group describes and its default DSP
  access); the *DSPs that may target it* column (All connected DSPs includes
  later ones; conditions are answered matched / not matched only).
- The two headings are this tab's grouping. Each variable still keeps its
  data source in the Targeting tab (Reason for Visit (Aggregate), for
  example, remains under *Queueing / Aggregate Visitor Data* there), so
  existing targeting is unaffected.
- Skills of Staff on Shift, weather, stock and partner-contributed attributes
  are not offered to DSPs in this release.

### Which DSPs may target each variable

Set in the same tab, one row per variable, with a **"DSPs that may target
it" multi-select** (the same pattern as other assignment pickers in HQ
Admin), not a toggle or column per DSP, so the table does not grow as DSPs
are added.

- The picker offers **All connected DSPs** (which includes any DSP connected
  later) or **individual configured DSPs**, each shown with its connection
  state. Choosing *All connected DSPs* supersedes individual selections.
- The selection shows in the table as pills: *All connected DSPs*, the named
  DSPs, or *None*.
- **Defaults**: Localisation Variables to *All connected DSPs*; **Personalisation Variables to None**.
- Changes are applied with **Save changes** (see *Saving changes*).
- A partner sees only what it may use, via `GET /v1/targeting/attributes`.
  **Permissioning shows up as a smaller vocabulary, never as a rejected
  request.** Submitted campaigns are validated against the same permissions.
- **Partners submit conditions; PH evaluates and decides**, using its
  existing targeting evaluation. No value is returned at targeting time. A
  partner can say *Fixed Store Segments includes Metro*, *Purchase Intent
  equal replenish* or *SKUs includes SKU-10234*; it never learns which
  segments a given store carries at a given moment, and never learns
  anything about the person in front of the screen.
- No PII crosses the boundary in either direction.

### Advertiser whitelists and blacklists

The **client** maintains whitelists and blacklists of **advertisers** and of
**IAB categories**:

- **Whitelist**: only these may win a position.
- **Blacklist**: these may never win one.

These are the client's lists, not the DSP's. They filter what the exchange may
clear into a position and are **enforced at auction time, not reconciled
afterwards**. The two kinds are managed in different places, for a reason:

- **Categories are central** (ticket vjykcgGWkfUjPB2xulel, 4 Oct 2026).
  IAB is one standard taxonomy every DSP speaks — the same codes across
  DV360, Amazon Ads and The Trade Desk — so there is **one category whitelist
  and one blacklist for the whole company**, in **Advertiser settings →
  Category lists**, and it applies to **every** DSP, including one connected
  later. There is **no per-DSP category override** and no link/unlink switch:
  no DSP has needed a different category policy, and a company-wide taxonomy
  is easier to reason about when it has a single source. (If one ever does,
  that is a new decision, not a hidden toggle.)
- **Advertisers are per DSP.** A seat or advertiser ID only means something
  to the DSP that issued it, so each DSP holds its own advertiser whitelist
  and blacklist, chosen from the seats and advertisers it has synced, on its
  own page. There is no company-wide advertiser list.

**Category entries are real IAB categories.** They are chosen from the IAB
taxonomy the platform carries a code for (Food & Drink IAB8, Health &
Fitness IAB7, Beauty IAB18-1, Retail IAB22, Family & Parenting IAB6,
Automotive IAB2, Finance IAB13, Travel IAB20), never typed. The bid request
carries the matching code (`bcat`), so an entry that is not a real category
could not be enforced against a bid. The API refuses anything else with
`400 validation_failed` naming the entry, and stores the canonical spelling
(a name matched without regard to case).

**On a DSP's page**, under **List management**, the DSP's own advertiser
whitelist and blacklist are editable, and **Category lists** is a read-only
note that the company IAB category lists apply to this DSP, with a link to
view and edit them in Advertiser settings.

An advertiser or category cannot sit on both lists; adding it to one removes
it from the other. Advertiser entries are chosen from the DSP's synced seats
only (no free text); category entries from the IAB taxonomy only.

**Advertiser and seat lists are managed per DSP, never centrally** (Rob,
4 Oct 2026). A seat ID or advertiser ID only means something inside the DSP
that issued it: the same advertiser is a different identifier on DV360, The
Trade Desk and Amazon, and a DSP's full advertiser universe is not
enumerable from our side, so free-text names cannot reliably be resolved to
the identifier the DSP actually bids under. A single holistic advertiser
list is therefore not feasible, and there is none.

Each DSP has its own advertiser lists:

- **Whitelist**: only these may win a whitelist-only position on this DSP.
- **Blacklist**: these may never win a position on this DSP.

Both are **built from that DSP's own synced seats and advertisers** (below),
so every entry is a real, authoritative identifier for that DSP. **No free
text:** the DSP page offers only the synced advertisers, and the API refuses
(`400 validation_failed`) an entry that is not one of the DSP's synced seat
IDs. They are **enforced at auction time, not reconciled afterwards**.

**Syncing.** A DSP's seats and advertisers are pulled when it is connected
and again on every re-connect (refresh). A refresh drops any list entry
whose seat the DSP no longer has; disconnecting clears the seats and, with
them, both advertiser lists. A DSP that has not been connected has nothing to choose
from, and its page says so.

**Existing data (migration 0040).** A DSP that adopted the company
advertiser lists took them as its own; every entry that was a seat name
became that seat's ID; an entry matching no synced seat was dropped (it
could not be resolved to an identifier the DSP bids under). The company's
advertiser list columns were removed.

**The blacklist is not a mode — it always subtracts.** It applies to every
outcome on that partner and no position can opt out of it. The whitelist is
the part a position chooses to use. (Both points are in the *Advertiser
lists* tooltip.)

A position's **Assigned to** control is one multi-select on *Advertisers /
Inventory* (Rob, 20 Sep), adding a pill per choice:

| Pill | What sells |
|---|---|
| Nothing chosen — *All DSPs* | Every connected DSP may bid, minus the blacklist |
| One or more **DSPs** | Only those DSPs may bid, minus the blacklist |
| One or more **advertisers** | Reserved to those seats; each one's DSP is added automatically |
| **Whitelist only** | Only advertisers on the whitelist of the DSP they bid through (which cannot contain a blocked one) |

Advertisers and *Whitelist only* are mutually exclusive — a position is
either held for named advertisers or open to the whitelist — and the newer
choice wins in the picker.

- **A blocked advertiser is withdrawn from the picker** (blocked on the DSP the seat belongs to).
- **Blocking an advertiser reaches positions already sold.** A position
  reserved to a name that is then blacklisted keeps it, so the position does
  not change under whoever set it; adding it again is rejected.
- A DSP that is not connected is still offered, and the display type flags
  the position as unable to fill until the connection is fixed.

### Campaign playback analytics — existing system

Campaign playback analytics (what played, where, when and why, at display
and store level, for the retailer and for advertisers) are provided by the
**existing Personalisation Hub analytics** and are **not changed by this
project**. Campaigns handed over from DSPs appear there like any other
campaign. This project builds no analytics, reports, dashboards or delivery
API. §9 reserves, spec only, the versioned canonical event schema a future
analytics rebuild would consume and the optional/nullable fields a future
proof-of-audience measurement path would populate — neither is built here,
and neither changes what this paragraph says about today's system.

### Selling a play window, or an impression (8 Oct 2026)

There is no company auction schedule and no per-slot bid mode (removed
8 Oct 2026). **A position nobody holds a deal on** (open, or whitelist-only)
**is sold in real time, one auction per impression** (see "Bid lookahead"
below). **Only a position held for named advertisers (reserve) or assigned
to a private auction (a buyers list) takes window bookings and bids**: it is
sold for a **play window**, ahead of the window, because creatives are often
video and must be on the player before they can play. A window's length is
its slot's billing unit (§5 "Billing unit"; open question 27, 29 Sep 2026) —
the slot's own, else its display type's default, else the platform default of
24 hours (a named constant, not a setting). A window can be booked or bid on
until it starts, or until a private auction has cleared it; the buyers list's
`activeFrom` / `activeTo` / `auctionCloses` govern a deal. The winner
holds the advertiser slot for that window: its approved campaign is handed to
the existing campaign system, which **distributes and plays it as it does
today**. Distribution, caching and playback are unchanged.

### API surface

Tier 1 follows each DSP's own specification. The tier-2 shape:

```
GET  /v1/inventory                 sellable positions and status (§5)
GET  /v1/inventory/{positionId}    one sellable position
GET  /v1/inventory/{positionId}/availability   status per play window
POST /v1/inventory/forecast        projected assumed views for a spec + targeting
POST /v1/reservations              reserve, or bid (CPM) for a play window (Approved campaigns only)
GET  /v1/reservations/{reservationId}   one reservation and its status
GET  /v1/targeting/attributes      the shared targeting variables THIS partner may target
POST /v1/campaigns                 default (required) + targeted versions, rules validated
POST /v1/campaigns/{id}/assets     creative upload and automated validation
POST /v1/campaigns/{id}/submit     submit for retailer approval (§3)
GET  /v1/campaigns/{id}            the campaign as stored (default + targeted versions; RbXpiw2Q, 30 Sep 2026)
GET  /v1/campaigns/{id}/status     approval status
```

Playback analytics are not part of this API; they come from the existing
system.

```json
{
  "reservationId": "res_8812",
  "campaigns": [
    { "role": "default", "assetSet": "as_brand_evergreen" },
    { "role": "targeted", "priority": 10, "assetSet": "as_metro_commuter",
      "rules": [
        [{ "source": "store", "variable": "fixed_store_segments", "op": "include", "values": ["Metro"] }],
        [{ "source": "store", "variable": "store_open_closed", "op": "equal", "values": ["Open"] }]
      ] },
    { "role": "targeted", "priority": 20, "assetSet": "as_replenish",
      "rules": [
        [{ "source": "visitor", "variable": "purchase_intent", "op": "equal", "values": ["replenish"] }]
      ] },
    { "role": "targeted", "priority": 30, "assetSet": "as_viewed_before",
      "rules": [
        [{ "source": "visitor", "variable": "skus", "op": "include", "values": ["SKU-10234", "SKU-55871"] }]
      ] }
  ]
}
```

`rules` is a list of AND groups; each group is a list of OR conditions,
matching the Targeting tab. This is the submission format; evaluation is the
existing platform's.

## 7. Personalisation Hub as the supply-side platform

§6 describes demand arriving through a partner. This section describes what
the platform is on the sell side: **the exchange that sells the client's
in-store screens.** We are building the supply platform, and DSPs are the
demand that connects to it.

**Who the seller is.** Personalisation Hub runs as an instance inside each
client's own VPC. The organisation running that instance owns the screens, is
the **seller of record** and operates the exchange; Personalisation Hub is the
software, not a party to the sale. `sellers.json` is published under the
client's domain, with the SupplyChain node carrying the client's domain as
`asi` and its seller ID as `sid`.

### The DSP integration switch (Rob, 24 Sep 2026)

At the top of **Exchange settings**, a master toggle row, **Enable DSP
Integration**, like HQ Admin's switches for its other features. It lets a
retailer switch DSP integration on and off.

- **Off the first time a retailer lands on DSP Integration.** Switched off,
  the switch is all Exchange settings shows, and the section's list shows
  Exchange settings, Shared Targeting Variables and Change history — not Advertiser settings or the partner DSPs (narrowed 9 Oct
  2026: the other pages are still used by direct advertisers).
- **Switching on** shows the seller-of-record fields below. Once they are
  saved and complete, `sellers.json` is published and the rest of the
  section appears: Advertiser settings and the DSP pages. Until then, a link
  to one of those pages opens Exchange settings instead.
- **Like every toggle in the section, it is an unsaved change until Save
  changes.** Switching it off before saving also drops unsaved edits to the
  fields it hides.
- **While it is off:**
  - Campaign schedule and its Campaign status tab are hidden, and a link
    to them opens the first page instead. **Advertisers / Inventory stays
    in the navigation and opens** (9 Oct 2026): direct advertisers, not
    going through a DSP, use it. DSP Integration stays too, as do Shared
    Targeting Variables and Change history inside it; only Advertiser
    settings and the partner DSPs are hidden.
  - No DSP is sent bid requests; the scheduled auction doesn't run.
  - The Partner API and `sellers.json` answer 404, exactly as with the
    build's feature flag off.
  - Windows already sold are still billed when they end: they were
    delivered.
  - On Playlist Management's expanded row → Slot assignment (moved off
    Display Types → Playlist Settings, 26 Sep 2026), **Advertiser is
    greyed out, not hidden**, in a slot's owner list (Rob, 24 Sep 2026).
    A slot that is already an Advertiser slot keeps it, with its
    assignment; no new Advertiser slot can be set up. Its tooltip says to
    enable DSP Integration. The API refuses a new Advertiser slot too.
- **Switching it off deletes nothing** (for testing, and for good): the
  seller-of-record fields, the DSPs and their credentials, advertiser
  settings, advertisers, campaigns and bookings all stay. Switching back on
  picks up where it left off.
- It is the retailer's runtime setting, one per instance. It is separate
  from the build's `dspIntegration` feature flag, which still decides
  whether any of this ships.

### Exchange settings — what the retailer supplies

Four fields, all required: **organisation**, **domain**, **seller ID** and
**ad-ops contact email**, applied with **Save changes**. Once saved and
complete, the screen shows where `sellers.json` is published and that it is
live. Until then no DSP is sent bid requests. The page title's tooltip
(wording in *Help text*) lists exactly what is configurable here and what
is a platform default; the *Domain* tooltip says where `sellers.json` is
published.

Fixed as **platform defaults**, not retailer settings: seller type
(Publisher), a non-confidential listing, the `sellers.json` and SupplyChain
contents, the DOOH object, the OpenOOH venue taxonomy, the impression
multiplier field, QPS ceiling and bid timeout.

**OpenRTB 2.6 is the minimum supported version for programmatic DOOH, not a
fixed platform default.** 2.6 is the floor: it introduced the DOOH object,
venue taxonomy hooks and impression multiplier that every DSP buying
programmatic out-of-home must speak. But the market will move to 2.7, 2.8
and beyond, and the platform must adopt later versions as DSPs and the
market move — this is what tier 1 already means (§6 "Two API tiers"): bid
requests are constructed per DSP in the exchange layer, so a later version
is a change contained within that construction, not a platform-wide
ripple. Treat the version as a per-DSP capability the exchange negotiates
or is configured with, defaulting to 2.6 as the minimum, rather than a
hardcoded global constant.

### DSP setup — what the retailer supplies per DSP

| DSP | Connection credentials |
|---|---|
| **Google DSP (DV360)** | Partner ID; service account email; private key (JSON) |
| **Amazon Ads DSP** | Region; LWA client ID; LWA client secret; refresh token; profile ID; entity ID |
| **The Trade Desk** | Supply source ID; TTD partner ID; API token; region |

A DSP's page holds only, in this order:

1. **Issues, at the top of the page**, directly under the DSP's name:
   - a **connection error**, with the reason reported by the DSP (for
     example *refresh token rejected*) and what to do about it;
   - **missing credentials**, named;
   - **cannot receive bids yet**, naming the missing bidder fields.

   With no issues, a single confirmation shows instead (ready in Test mode,
   or live and receiving bid requests).
2. **Mode: Test / Live.** A DSP starts in **Test**: it receives bid requests
   for its certification period, with no real spend and nothing handed to
   the campaign system. It can be switched to **Live** only once connected
   and with the bidder integration complete. This explanation is the *Mode*
   heading's tooltip.
3. **Connection credentials**, as above, with connect / re-test / disconnect.
   The DSP-specific setup note is the heading's tooltip; each field's hint
   is a tooltip on its label.
4. **Bidder integration**: **bidder endpoint** and **seat IDs**, both
   required, plus two optional per-DSP overrides (open question 46): **QPS
   ceiling** and **bidder timeout (ms)**. Left empty, each uses the platform
   default (500 QPS, 300 ms); set, the DSP's value wins — the same
   override-always-wins inheritance as reserve price, max campaigns and
   billing unit. The timeout is also sent as the bid request's `tmax`.
   Allowed ranges: 1–10,000 QPS, 50–2,000 ms; outside them the save is
   refused `400 validation_failed`.
5. **List management**: the DSP's own advertiser whitelist and blacklist,
   picked from the advertisers it synced (no free text); and a note that the
   company IAB category lists apply to it, with a link to Advertiser settings
   (§6).
6. **Save changes / Cancel**, always visible at the bottom (see *Saving
   changes*).

No advertiser ID is taken on the connection: the retailer sells to many
advertisers through each DSP, so the connection is not tied to one. The
DSP's advertisers are listed on the **Advertisers** screen, not on its page.
Currency, floor CPM, multipliers and targeting permissions are set elsewhere
and are neither set nor repeated on the DSP's page; category lists are set
in Advertiser settings too and apply to every DSP — there is no per-DSP
category override; the advertiser lists live only on the DSP's own page (§6).

### Which side each named platform sits on

| Platform | Side | What it means for us |
|---|---|---|
| **The Trade Desk** | **DSP — demand** | The largest independent DSP and a major DOOH buyer. A buyer that bids into our exchange |
| **Display & Video 360** | **DSP — demand** | Google's buy side. A demand partner (§6) |
| **Google Ad Manager** | **SSP / ad server — supply** | Google's sell side. What we are building an equivalent of, not something we connect into |

### What being the SSP means we build

1. **Bid request construction and the bidder integration.** An OpenRTB bid
   request per sellable position (§5), sent to every connected bidder within
   its QPS ceiling and timeout (the DSP's override, else the platform
   default), then the auction over the
   responses.
2. **The auction.** The effective floor CPM resolved through the floor hierarchy (§4), sent as `imp.bidfloor` with `bidfloorcur` USD
   on the request, plus permitted categories, the advertiser blocklist
   and creative approval (§3), all applied **before** a bid can win. Open
   auction only in this release.
3. **Creative retrieval and hand-off.** The creative is identified by its
   content hash, not the DSP's crid (§3 *Submission*). The winning creative is fetched,
   confirmed approved and validated against the display type's canvas, then
   handed to the **existing campaign system** for that slot and window.
   Distribution to players, caching, playback and playback analytics are the
   existing platform's and are unchanged. The booking carries
   `personalisedEligible`, true for a window held by a reserve booking
   (5 Oct 2026) or by a deal with a personalised campaign (8 Oct 2026):
   personalised versions are eligible to play there and nowhere else; a window
   on an open real-time position plays default and localised only.
4. **Supply-chain transparency.** A published `sellers.json` and a
   `SupplyChain` object on every bid request.
5. **Reconciliation and billing** from existing playback data.

### Inbound and outbound partner paths

- **Inbound (the bidding path)**: the DSP is configured with PH as a supply
  source and bids into us, using the bidder endpoint and seat IDs.
- **Outbound (the account path)**: the connection credentials are used for
  seat and advertiser discovery, and billing reconciliation.

The advertiser blocklist is enforced **pre-auction, on the bid**, using the
seat or advertiser identity in the bid response. With exchange demand the
buyer is unknown until the bid arrives, so this is the only point at which the
control can be applied.

### Demand onboarding order

**Google DSP (DV360) first, then Amazon Ads DSP, then The Trade Desk.**

Common to all three, built once:

- A published `sellers.json` and a `SupplyChain` object on every bid request.
- Seat and advertiser identity on the bid response.
- OpenRTB with DOOH support, the OpenOOH venue taxonomy and the impression
  multiplier field.
- A test or certification period against live traffic (the **Test** mode
  above), and a QPS ceiling the exchange must respect (the DSP's own
  override on its connection settings, else the platform default).

The Trade Desk is the largest buyer of programmatic DOOH by spend and comes
third. That is defensible on integration effort, but the deepest demand pool
arrives last and open-auction fill will look thin until it does.

### What a DOOH bid request carries

- **No user identity.** A bid request describes a *venue and a moment*, not a
  person. Personalisation Variables and Computer Vision variables (§6) never
  cross into the exchange.
- **Venue taxonomy and geo** (§1). Read from PH Core, which owns the
  completeness guarantee and the missing-data signal (api/PH-CORE-BOUNDARIES.md,
  "Venue and geo metadata"). A position whose required venue/geo (OpenOOH venue
  type, lat/long, store id) is absent is *not sellable*: the exchange leaves it
  out of inventory and the auction, like an unscored slot, rather than send a
  bid request a DSP may reject with no clear reason.
- **Screen and loop context**: resolution, aspect, orientation, slot duration,
  loop length and share of voice. `maximumCampaignsPlayedInRotation` *is* the
  share-of-voice denominator.
- **Bid floor**: the effective floor CPM resolved through the hierarchy, sent as `imp.bidfloor` with `bidfloorcur` USD (§4).
- **Impression multiplier.** One play is an estimated audience (the assumed
  views the CPM is charged against). The Vision/AI passerby count and MIST
  proximity features on the display type can produce a **counted** multiplier
  where most of the market estimates one. (This audience multiplier is
  separate from the price multipliers in §4.)

### Proof of play is the billing record

DOOH bills on **proof of play**, not on the win notice. The platform's
**existing playback data** shows what actually played; PH reconciles wins
against it and bills the CPM against the assumed views that genuinely
played, priced per §4. Plays that did not happen (screen offline, store
closed, loop cut short) are not billed. **Settlement is final**
(§4 "Billing"): playback received after a window's invoice is written is
disregarded for billing and instead reported as lost revenue from display
downtime, at the cleared rate. This project **reads** that data for
billing and for the lost-revenue ledger only; it does not change how it is
written or add any other reporting on it. As the exchange, disputes resolve against this data.

### Brand safety, structurally

- Venue and category exclusions, applied pre-auction.
- The advertiser blocklist, enforced on the bid.
- Retailer approval of advertiser creative, where the advertiser requires it
  (§3).

### To confirm before building

- The OpenRTB version and DOOH object support each target DSP expects, and
  which version of the OpenOOH venue taxonomy.
- What each DSP requires to onboard a new supply source: seat setup,
  `sellers.json` validation, inventory authorisation, minimum QPS.
- Each DSP's own creative audit process and how it interacts with retailer
  approval (§3).
- The audience measurement currency the market expects, and whether a
  sensor-derived multiplier is accepted for trading or only for reporting.

## 8. Data model

The display type, playlist and campaign records are the platform's
**existing** records, with this project's additions kept in clearly separated
fields. The canonical definition is `app/src/model/schema.js` and
`app/src/model/sellside.js`.

### Display type

```
{
  id, touchPoint,                  // Digital Signage | Kiosk | Website | Mobile App (Website/Mobile App added 28 Sep 2026, ticket — HQ-only, see §1)
  name, description, image,
  displayCanvasSize: { width, height },
  backgroundColor,
  defaultPlaylistId,
  playlistSettings: {              // null = "Default (…)", inherit
    assetPosition, assetFill,
    maximumCampaignsPlayedInRotation,   // -1 = Unlimited; n = slot count = share-of-voice denominator (single-zone; each zone has its own, below)
    campaignTransition, campaignAutoRotation, campaignAutoPlay
  },
  qrControl: {                     // existing QR CONTROL (PHANTOM ZONE) panel, unchanged
    enabled,
    phantomArea: { width, height, position, sizingMode },
    qrCode: { size, colour, position },
    connectedIconColour, mobileSiteTemplate,
    connected: { icon, showPoweredBy, poweredByText }
  },
  enabledFeatures: { inStoreRadio, proximityMist, aiAgentPlayback, visionAi },
  multiZone: { enabled, zones: [{ id, name, x, y, width, height, playlistId,
                                  maximumCampaignsPlayedInRotation }] },   // per zone (28 Sep 2026): null = Default (Unlimited, no slots); n = that zone's slot count
  phExtensions: {                  // THIS PROJECT's additions
    reservePrice,                  // the display type's own reserve price default; CPM or null (real inheritance, 22 Sep — §5)
    billingUnitHours,               // the display type's own billing-unit default = play-window length, in whole hours; null = the platform default of 24 (§5 "Billing unit"; OQ27, 29 Sep 2026)
    maxCampaigns,                  // the display type's own max-campaigns default; null = platform default of 5, 1-10 inclusive (§5, ticket "Max campaigns column + slot playlist statement")
    maxPlayLengthSec,              // the display type's own max-play-length default, whole seconds 1-600; null = the company default (Advertiser settings), platform default 15 (§5 "Max play length")
    slots: [{ label, owner, zoneId,   // zoneId: the zone this slot belongs to on a multi-zone display type (one segment per zone, in zone order); absent on a single-zone one
              partnerId, advertiser, listMode, buyersListId, storeScope, quota,
              reservePrice,         // this slot's own override; CPM, or null = inherit the display type's reservePrice above (§5)
              billingUnitHours,     // this slot's own override = its play-window length, in whole hours; null = inherit the display type's billingUnitHours above, else the platform default of 24 (§5; OQ27)
              maxCampaigns,         // this slot's own override; null = inherit the display type's maxCampaigns above, 1-10 inclusive when set (§5)
              maxPlayLengthSec }],  // this slot's own override = the fixed duration of one play, whole seconds 1-600; null = inherit the display type's maxPlayLengthSec above, else the company default (§5 "Max play length")
                                    // listMode: rtb | whitelist_only | deal | null; buyersListId set only when listMode is deal (§5 "Private auctions")
                                    // each slot also carries salesLocked / salesLockedUntil (set by PUT /admin/v1/available-inventory/lock, cleared by the scheduler; not writable through the slot editor)
    defaultVacd,                   // number | null: the display type's default VAC-d (ZSfSP5sr, 1 Oct 2026, migration 0035); a slot with neither this nor an audience_vacd row is unscored
    venue: { openOohVenueType, orientation, loopLengthSec }   // POC stand-in for a PH Core value (Q35): PH Core owns venue and geo; on integration this is read from its store/display record and the PUT stops accepting `venue`
  }
}
```

- **`null` means inherit.** An inherited value renders as "Default (…)", with
  an "N overrides / all inherited" badge per panel.
- `phExtensions.slots` is sized to `maximumCampaignsPlayedInRotation` — the
  display type's own on a single-zone display type, or the sum of each
  zone's own on a multi-zone one, one segment per zone (§1). It
  records who may fill each slot; it does not affect how the slot plays.
- The collapsed-panel summaries (§1) are derived from these fields; nothing
  extra is stored.
- Store-level geo (lat/long, store identifier) is PH Core's and read
  read-only (Q35); see api/PH-CORE-BOUNDARIES.md, "Venue and geo metadata".

### Display (existing, read only here)

```
display: { id, name, store, displayTypeId, … }   // Displays & Devices
```

Used only for the delete check in §1: a display type with any display whose
`displayTypeId` matches cannot be deleted.

### Buyers list (this project's own record — §5 "Private auctions")

```
buyersList: {
  id, name, description,
  invitedBuyers: [{ partnerId, seatId }],      // a seat a connected DSP synced (partners.seats); matched exactly
  activeFrom, activeTo,                        // the delivery term; ISO date-time or null = no bound (inclusive)
  auctionCloses,                               // the auction window's bidding deadline; ISO date-time or null = not using
                                                //   the two-period model — clears a fresh auction every play window (23 Sep 2026)
  lockedWin,                                   // null until the term's one-time auction clears; then:
                                                //   { cpm, partnerId, advertiserId, campaignId, pricingType, channel, lockedAt }
                                                //   — set once, never overwritten (23 Sep 2026, "Locked rate" above)
  createdAt, updatedAt
}
```

Independent of any one slot: a `phExtensions.slots[].buyersListId` (above)
points at it, and any number of slots may point at the same list. Deleting
a buyers list is refused (`has_dependents`) while a slot still points at it.
`auctionCloses` and `lockedWin` are the two-period model (23 Sep 2026, "Private
auctions (buyers lists)" above) — `auctionCloses` is admin-editable the same
way as `activeFrom`/`activeTo`; `lockedWin` is written only by the exchange
(`exchange/auction.ts`), never accepted on a create/update request.

### Playlist

The existing playlist, item and scene records, and how they play, are
unchanged by this project. Loop length is read for inventory display only;
plays per window are counted against the slot's max play length (§5), not
the loop length.

### Campaign (additions to the existing campaign record)

```
campaign: { …existing fields,
            source: hq | api | dsp,
            advertiserId, partnerId,
            pricingType: default | localised | personalised,  // interactive deferred (5 Oct 2026): refused targeting_not_supported
            status: draft | awaiting_approval | approved | rejected,   // shown as Draft / Awaiting approval / Approved / Rejected
            approval: { mode: manual | auto,
                        assetVersion, submittedAt,
                        reviewedBy, reviewedAt, reason,
                        assetReasons: [{ assetId, reason }],           // optional — which asset(s) a rejection named (ticket, 22 Sep)
                        checks: [{ name, passed, detail, assetId }] }, // assetId optional — set for a per-file check, unset for a campaign-level one
            activation: { enabled } }         // only settable once status = approved

asset: { …existing fields, id, campaignId, role,      // "default" or a targeted version id
         contentHash }                                // sha256 — the creative's identity and the basis for safe reuse, below

dspCreative (label): { partnerId, crid, campaignId,   // the crid is a reference label; campaignId (derived from
                       contentHash, iurl, verifiedAt } // advertiser + contentHash) is the PH creative it resolved to
```

A DSP-sourced creative's `campaign.id` is derived from (advertiser, asset
`contentHash`) — never from a crid. Several `dspCreative` labels (one per
DSP and crid) may point at one creative.

**Safe reuse tracking (ticket, 22 Sep)**, kept beside approval, not inside
the campaign record — it is a history of decisions, not campaign state:

```
campaignApprovalAssetClearance: { campaignId, assetId, contentHash, clearedBy, clearedAt }
```

One row per (campaign, asset) — written only when a human approves (never
from an automated pass or an auto-approve), overwritten on every later
human approval. An asset may skip re-review only when its current content
hash matches this row's (content hash primary; a DSP crid is only a
reference label) — see *Safe reuse of previously approved assets*,
§3, for the exact rule. A clearance also covers the targeting rules
(pseudo-asset `#targeting`, hashed over the rendered rules), so identical
files under changed targeting still re-review. Assets carry `contentHash`;
a rejected edit's assets are marked discarded, not deleted, so asset
versions never repeat.

Targeting rules use the campaign's existing targeting structure (AND groups
of OR conditions, each *source → variable → operator → values*), evaluated
by the existing platform. HQ-authored campaigns (`source: hq`) skip approval.

**Platform-side dependency, tracked here, not built by this project:**
`advertiserId`/`partnerId` above are on the campaign record this project
adds, but showing them is a platform change — **Advertiser** and **DSP**
columns need to be added to Personalisation Hub's own existing campaign
table (the same table §3 *Retailer review* adds the status filter and
Approve/Reject to), so a reviewer or marketing user can see who a
DSP-sourced campaign came from without opening it. Hand this to the core
platform team; this project's own POC "Campaign Status" stand-in already
carries Advertiser and DSP as columns (`CampaignStatusPage.tsx`) as a
reference for what the real table's columns should show.

`targeting.default` is mandatory on every submission (decision, 22 Sep,
superseding the earlier same-day "baseline optional" decision — §3, §6):
`targeting: { default: { pricingType }, targeted?: [...] }`, and
`pricingType` above is taken from `targeting.default.pricingType`.

### Sell side

`partner`:
```
{ id, provider, name, status: draft | connected | error,
  lastSync,                               // last connection result, e.g. the DSP's error reason
  mode: test | live,                      // live only when connected and the bidder integration is complete
  creds: { …per DSP, see §7 },            // no advertiser ID
  bidder: { bidderEndpoint, seatIds, qps?, timeoutMs? },  // qps/timeoutMs: per-DSP overrides (Q46); absent = platform default (500 / 300 ms)
  seats: [{ id, name }],                  // advertisers synced on connect and re-connect; listed on the Advertisers screen and the source of the lists below
  allowList, blockList }                  // this DSP's own advertiser whitelist/blacklist: seat IDs from `seats`, no free text (§6); category lists are company-wide
```

Company-level:

- **Advertiser settings**: `currency` (any ISO 4217 code; default `AUD`),
  `floorCpm`, `interactiveCpe` (kept, not
  editable while interactive is deferred; defaults 100 / 0.50). The auction schedule (`auctionOpensHours`,
  `playWindowHours`, `auctionCutoffTime`) was removed 8 Oct 2026 (migration
  0059): a window's length is the billing unit (slot, else display type, else
  the platform's 24 hours), not a setting.
  IAB-category whitelists and blacklists (`categoryWhitelist`,
  `categoryBlacklist`). There are no company-level advertiser lists: they
  are per DSP (partner `allowList` / `blockList`, §6).
- **Advertisers / Inventory** (an admin writes it; marketing reads it):
  `advertiserSettings: { [advertiser]: { approvalRequired, floorMultiplier } }`
  (defaults `true` / 1.0), and per sellable slot what it is assigned to
  (`partnerIds`, `advertisers`, list mode).
- **Shared targeting variables**: the platform's default variables, grouped
  as Localisation Variables and Personalisation Variables, each with example
  values (or a fixed tooltip text) for its tooltip, read-only in this
  release, plus `variableAccess: { [variableKey]: "all" | [partnerId] }`:
  `"all"` means every connected DSP (including later ones), a list names
  individual DSPs, `[]` means none. Unset keys take the defaults in §6.
- **Exchange**: `client {name, domain, contactEmail}` (the seller of record),
  `sellersJson {sellerId}` and `enabled` (the retailer's DSP integration
  switch, §7, migration 0023). Seller type, confidentiality, `supplyChain`,
  OpenRTB options are fixed platform defaults. QPS ceiling (500) and bid
  timeout (300 ms) are platform defaults a DSP's connection settings can
  override (Q46).
- **Platform instance identity (§9.3, spec only)**: `platformInstance:
  { instanceId, domain }`, held alongside — never inside — `client` /
  `sellersJson` above. `instanceId` is this project's own cross-instance
  identifier, anchored to the same stable `domain` `sellers.json` publishes
  under; it must never be, or be derived from, `sellersJson.sellerId`, which
  is a different identity to a different audience (§7, §9.3).

Unsaved edits are held client-side only; the records above (display types
and playlists included) change only when **Save changes** is used. Deletes
are the exception: a confirmed delete applies immediately.

The `reservation` and `inventory position` records are spec only in this
release. There is no delivery or analytics record: playback analytics are
the existing system's.

## 9. Analytics schema, measurement and cross-instance federation — foundation (22 Sep 2026 DSP analytics strategy session)

A separate strategy session on 22 Sep 2026 set four structural
future-proofing principles for where this project's analytics and
cross-instance ambitions go **after** this release, without committing to
build any of them now: (1) a versioned canonical event schema, with the
event model kept separate from its transport; (2) computer vision as a
measurement source, not only a targeting input; (3) a stable source-instance
identity, distinct from the `sellers.json` seller ID; (4) the eventual
inter-platform integration modelled as an agent-consumable surface, not a
plain REST endpoint. **Everything in this section is spec only** — it
reserves names, optional/nullable fields and documented direction so that
later work extends what already shipped instead of breaking or duplicating
it. It changes nothing about *Core principles*' "playback and playback
analytics are unchanged": the existing Personalisation Hub analytics system
remains authoritative for what is reported today, and stays so until a
schema-consuming replacement is separately commissioned.

### 9.1 Versioned canonical playback/analytics event schema

**Foundation ticket the other three in this section build on.**

- A single, versioned, canonical event schema becomes the single source of
  truth for what a play/impression/interaction event looks like, written to
  S3 partitions. DSP Integration reads **from** it, as one consumer among
  others (a future Amazon QuickSight reporting pipeline, a future analytics
  rebuild) — analytics stops being modelled as a downstream, DSP-specific
  concern and becomes the thing DSP Integration, among others, consumes.
- **Separates the event model from the transport** (a structural principle
  from the 22 Sep session): the schema defines what fields an event carries
  and what they mean; how/where events are batched, written or queried is a
  transport decision for whoever builds the schema-consuming pipeline, and
  is explicitly out of this ticket's scope.
- Every event carries a `schemaVersion` so a consumer can evolve
  independently of producers: an additive field is a compatible version
  bump; changing what an existing field means requires a new version, an
  additive migration path, and an entry in a schema changelog kept alongside
  the schema definition (see *Where it lives*, below) — never a silent
  redefinition of a field already in use.
- Every event carries a `source` (which system/service emitted it, e.g. the
  existing playback system, Vision/AI, MIST) and a `timestamp` (when the
  event occurred, not when it landed in S3, if the two differ).
- **Computer-vision / sensor-derived fields are OPTIONAL and NULLABLE from
  day one** (§9.2) — reserved now so the proof-of-audience evolution
  populates values into fields that already exist, rather than adding new
  fields or a new pipeline later. Every such field is paired with a
  `confidence` value; a producer with no CV signal for an event simply
  leaves both null.
- Illustrative shape (spec only — not a queue/topic/table decision, and not
  built this release):

  ```json
  {
    "schemaVersion": 1,
    "eventId": "evt_...",
    "eventType": "play | impression | interaction",
    "source": "existing-playback-system | vision-ai | mist | ...",
    "timestamp": "2026-09-22T12:00:00Z",
    "displayId": "...",
    "displayTypeId": "...",
    "campaignId": "...",
    "advertiserId": "...",
    "partnerId": "...",
    "playWindowId": "...",
    "assumedViews": 1,
    "cv": {
      "opportunityToSee": null,
      "dwellSeconds": null,
      "attentionSeconds": null,
      "estimatedAgeBand": null,
      "estimatedGender": null,
      "confidence": null
    }
  }
  ```

- **Where it lives.** This ticket reserves the shape and the two structural
  principles above; an exhaustive field-by-field reference (types, allowed
  values, the schema changelog) is follow-on work once a schema-consuming
  pipeline is actually commissioned — see open question 53.
- **Relationship to existing analytics** (*Scope*, §6 *Campaign playback
  analytics*): the existing Personalisation Hub analytics system remains the
  system of record for what's reported today. Nothing in this section reads
  from or writes to it, and this project still builds no analytics, reports,
  dashboards or delivery API of its own.

### 9.2 Computer vision as a measurement source (proof-of-audience)

*Depends on 9.1.*

- Elevates Computer Vision from a **targeting-only** input (§6's Gender (Computer
  Vision) / Estimated Age (Computer Vision) Personalisation Variables) to
  also being a **measurement source**: opportunity-to-see, dwell, attention
  seconds and anonymised age band / gender flow into the canonical event
  schema (§9.1) as populated values on the `cv` fields it already reserves —
  extending that schema, not standing up a separate pipeline.
- Moves the sell proposition from **proof-of-play** (§7 *Proof of play is
  the billing record* — did the creative play) toward **proof-of-audience**
  (was anyone there to see it, and roughly who). This is the audience
  multiplier already in the spec (§7 *What a DOOH bid request carries*; open
  question 34) evolving from a single per-play multiplier into a fuller
  measured-audience record.
- CV measurement flows into the **same** S3 partition and eventual Amazon
  QuickSight pipeline as any other canonical event (§9.1's "one schema, many
  consumers" principle) — not a CV-only parallel pipeline.
- **Outbound DSP contract** (spec only; extends §6 *API surface*):
  proof-of-audience fields, when populated, should surface to the DSP
  alongside existing proof-of-play/billing data, each with its `confidence`
  value so a DSP can apply its own threshold for treating a measurement as
  tradeable. The exact response shape is follow-on API work once a
  consuming report or endpoint is commissioned; not built this release.
- **Open question 34** (already in this document) — is a sensor-derived
  audience multiplier tradeable, or only reportable? This ticket does not
  answer that; it gives the multiplier a home in the canonical schema and a
  confidence value so that whichever way the commercial/legal answer lands,
  the data needed to support it already exists instead of requiring a second
  pipeline later.
- **Anonymisation is unchanged**: age band and gender are the same
  anonymised, non-identifying shape already used for the existing Computer
  Vision targeting variables (§6). This ticket does not change what Vision/AI
  is permitted to detect or retain — only that an already-anonymised
  detected value can optionally also be recorded as a measurement alongside
  a play event.

### 9.3 Source-instance identifier for cross-instance federation

*Prerequisite for 9.4; plumbing only.*

- Reserves a **source-instance identifier** on analytics and booking records
  now, so a later network-of-networks / federation release has a field to
  key off rather than retrofitting one across records that already exist by
  then.
- **Must not reuse the `sellers.json` seller ID** (§7 *Exchange settings*,
  `sellersJson.sellerId`, published as `sid` on the SupplyChain node). That
  identifier is the retailer's identity as a **seller of record to the
  outside ad ecosystem** — scoped to the OpenRTB supply chain and meant to
  be read by DV360, Amazon Ads DSP and The Trade Desk (domain → `asi`,
  seller ID → `sid`). In the federation case two PH instances (e.g.
  Blackmores and a retail-media partner, §9.4) are **peers**, not
  seller-and-demand-partner — overloading the seller ID to also mean "my
  identity to another PH instance" conflates two different trust
  relationships, and would break peer connections if a DSP ever changed how
  it wants seller identity presented.
- **Anchor the inter-platform identity to the stable domain instead**, as
  its own identifier that maps to the domain rather than the raw seller ID.
  Reserved, spec only this release: `platformInstance: { instanceId, domain
  }`, held **alongside**, not inside, `client`/`sellersJson` in the *Sell
  side* data model (§8) — `instanceId` is this identifier; `domain` is the
  same stable domain `sellers.json` already publishes under, kept as a
  separate field so the two can be cross-checked rather than conflated into
  one.
- **Where it's reserved**: the canonical event schema (§9.1 — an optional
  `sourceInstanceId` alongside `source`) and booking/reservation records
  (§8's `reservation`, itself already spec-only this release) — both
  surfaces are ready to carry it once federation is actually built.
  Reserving the field on records that are themselves still spec-only keeps
  this ticket to naming and placement, not implementation.
- This ticket does not build federation, does not define how instances
  discover or trust each other, and does not touch `sellers.json` or the
  SupplyChain object (§7) in any way — it only reserves where a future
  instance identity lives and states, explicitly, what it must not be
  confused with.

### 9.4 Agent-to-agent platform interface as a first-class surface

*Depends on 9.3 for instance identity; defines the exchange that identity
enables.*

- Defines the **inter-platform integration** — one PH instance's agent
  negotiating targeting, scheduling and optimisation with another PH
  instance's agent — as an **agent-consumable (MCP-layer) surface**, not a
  plain REST API endpoint, so the eventual network-of-networks phase extends
  an agentic contract rather than a human/system integration retrofitted for
  agents later. Structural principle 5 from the 22 Sep session.
- **Deliberately its own surface, not folded into the tier-2 PH-native API**
  (§6 *Two API tiers*). Tier 2 is designed for a human or system integrating
  against a REST contract under a bilateral agreement (Blackmores is its
  worked example); this is instance-to-instance **agent** exchange, a
  different kind of counterparty with a different contract shape.
- **Worked example** (Blackmores + a retail-media partner, each on their own
  PH instance): a connection between the two instances lets the advertiser
  enable the partner as a touchpoint. Targeting, scheduling and optimisation
  happen **agent-to-agent** between the two platforms — agents exchange
  **context and decisions**, never raw customer records (the same
  "predicates in, counts out" / no-PII-crossing-the-boundary principle §6
  already applies between platform and DSP; this is the same principle one
  level up, between platforms). Transactions on the partner side related to
  the advertiser feed back to the advertiser's instance for ongoing
  creative, campaign optimisation, scheduling and targeting.
- **Still open, and deliberately not ticketed here**: the identity bridge
  for closed-loop attribution — matching an advertiser exposure on one
  instance to a partner-side transaction on another, without either side
  exposing raw identity. Its natural home is the device graph / digital ID
  layer, not this project; noted here so it isn't lost, not answered here.
- This release does not build the agent-to-agent protocol, its transport,
  its authentication model, or the negotiation logic itself. This ticket is
  the decision that when it is built, it is built as an MCP-layer /
  agent-consumable surface and as a first-class surface of its own, not a
  REST endpoint or a feature of the tier-2 PH-native API.

### 9.5 Authentication seams — advertiser as a principal, scoped tokens, user login

*Specification only. Nothing here is built in this release; the POC keeps
its static partner tokens and its stand-in HQ admin. This section defines
the three seams so later releases (advertiser-direct submission, advertiser
login, Gen AI campaign authoring) are extensions of the identity and
credential model below, not rewrites of it. It is adjacent to §9.4, not the
same thing: §9.4 is PH-instance-to-PH-instance agent exchange; this is how
any caller — partner, advertiser or a person — proves who it is to this
build's own APIs.*

**Today's gap.** The Partner API collapses identity, authentication and
authorisation into one static bearer token per DSP partner, and the Admin
API has no authentication of its own (every caller is the stand-in HQ admin
and the service binds to `127.0.0.1`). That closes the door on an
advertiser submitting directly and, later, an advertiser logging in to
author campaigns with Gen AI. The three seams below separate the concerns.

#### Named boundaries

| Boundary | Name | Question it answers | Sibling ticket |
|---|---|---|---|
| 1 | **AUTH-IDENTITY** | *Who is calling?* | "[2 of 4] Auth boundary 1 — Advertiser as first-class authenticated principal" |
| 2 | **AUTH-CREDENTIAL** | *What proof do they present, and what may it do?* | "[3 of 4] Auth boundary 2 — Token endpoint + scope model" |
| 3 | **AUTH-LOGIN** | *How does a human become that caller?* | "[4 of 4] Auth boundary 3 — Advertiser user login resolving to advertiser scope" |

Each sibling ticket builds **only its own boundary** and may depend on the
boundaries before it, never the reverse: AUTH-IDENTITY has no knowledge of
tokens, AUTH-CREDENTIAL has no knowledge of logins.

#### AUTH-IDENTITY — principal types

- A **principal** is the authenticated caller of any API in this build. It
  is a first-class record with a `principalType` and a stable `principalId`;
  it is **not** a field on a campaign.
- Principal types from day one: **`partner`** (a connected DSP, today's
  only type), **`advertiser`** (a brand or agency acting for itself) and
  **`admin`** (a retailer user, today the stand-in HQ admin). Adding a type
  later is a new value, not a schema change.
- Auth middleware resolves every request to exactly one principal and hands
  handlers `{principalType, principalId, scopes}`. A handler never reads a
  raw token or header. An unauthenticated request is `401`; an
  authenticated one lacking the scope is `403`.
- An **advertiser principal** maps onto the existing advertiser record
  (§3 Advertisers / Inventory; PH Core's advertiser/campaign records —
  see `api/PH-CORE-BOUNDARIES.md` → "Authentication seams"). A partner
  principal may act **for** one or more advertisers; the advertiser a
  submission is for is named on the campaign, while *who submitted it* is
  the principal. The two are kept distinct so audit and billing can tell a
  DSP submitting on an advertiser's behalf from the advertiser itself.
- **Isolation rule:** a principal sees and changes only records it owns or
  is delegated. An advertiser principal can never read another
  advertiser's campaigns, creatives or bookings; a partner principal keeps
  today's rule (its own DSP's campaigns only).
- Every write records the acting principal (`principalType`, `principalId`)
  in the audit trail alongside the existing "Enforcement and audit" fields.

##### AUTH-IDENTITY boundary — what it fixes, where advertiser identity lives, and what crosses to PH Core

*Specification only; no behaviour change. The Partner API path is exactly as
it is today.*

**Principal model.** Caller identity is a discriminated union, and every
type is a peer — none is a special case of another:

| `principalType` | `principalId` is | Identity source | Authenticated today? |
|---|---|---|---|
| `partner` | the partner (DSP) id | this build's partner record (`PartnerRepo`), PH Core's partner identity on integration | **Yes** (static token) |
| `advertiser` | the `advertiserId` | this build's **advertiser record** (below) | No — recognised by the model, no credential yet |
| `admin` | the retailer user id | `SessionSource` (HQ Admin session) | Stand-in only |

The principal is resolved by one auth seam (`partnerFromRequest(req)` today,
generalised to a principal resolver). The resolver's contract is
`request → {principalType, principalId, scopes} | 401`; the partner branch
is the existing lookup, unchanged, and an advertiser branch is added beside
it later without altering what handlers receive. Handlers branch on
`principalType` only to apply the isolation rule above, never to re-parse
credentials.

**Where advertiser identity lives.** Today an advertiser exists only as an
`advertiserId` string hanging off a campaign or reservation and as the key
of `advertiser_settings`. The boundary makes it a **first-class advertiser
record owned by this build's repos** (an `advertisers` table behind an
`AdvertiserRepo`, read through the same repo layer as partners), not a
property of PH Core's campaign record:

- `advertiserId` — stable, opaque, unique, never reused; the `principalId`
  of an advertiser principal and the foreign key every other advertiser
  reference (campaign, reservation, `advertiser_settings`, audit) points at.
- `name`, `status` (`active` / `suspended`), `createdAt`, and an optional
  `externalRef` holding PH Core's own advertiser identifier when PH Core is
  the system of record (see below).
- **Credentials and logins are not part of this record.** The record says
  *who the advertiser is*; how a machine proves it is that advertiser is
  AUTH-CREDENTIAL, and how a person becomes it is AUTH-LOGIN. This
  keeps AUTH-IDENTITY free of any token or login knowledge.
- A `suspended` advertiser's principal authenticates to nothing; its
  existing campaigns and bookings are untouched (same rule as the DSP
  integration switch: nothing is lost by turning access off).

**Seam to PH Core.** This build does not become the master of advertisers.
Where PH Core holds advertiser records, the build's record is keyed by and
mirrors PH Core's identity, and PH Core must guarantee the points listed in
`api/PH-CORE-BOUNDARIES.md` → "Authentication seams" → *AUTH-IDENTITY —
advertiser identity*: a stable, unique, never-reused `advertiserId`; the
advertiser-to-campaign ownership; and propagation of advertiser
suspension or removal.

**Non-goals for this boundary.** The credential mechanism (token endpoint,
client secrets, scopes issuance — AUTH-CREDENTIAL), user login and roles
(AUTH-LOGIN), advertiser self-service screens, and any change to the
partner path, the Admin API, playback, or the public API.

**Acceptance.** This section and `api/PH-CORE-BOUNDARIES.md` name the
principal types, the advertiser principal's identity source and the seam to
PH Core; the Partner API behaves exactly as before.

#### AUTH-CREDENTIAL — short-lived scoped tokens

- Static per-partner bearer tokens are **replaced** by short-lived access
  tokens from a single **token endpoint** using the OAuth 2.0
  **client-credentials** grant. **One issuance path serves both partners and
  advertisers**; there is no second credential system for either.
- A **client** (client id + secret, rotatable, revocable) belongs to one
  principal; a principal may hold several clients (for example one per
  environment). Secrets are stored hashed, shown once, and never logged.
- Access tokens are short-lived (minutes, not days), carry
  `{principalType, principalId, scopes, expiry}`, and are verified at the
  edge/middleware without a database read on the hot path. Revoking a
  client or disconnecting a DSP takes effect within the token lifetime.
- **Capability = scope.** Scopes are named `resource:action`:

  | Scope | Meaning | When |
  |---|---|---|
  | `inventory:read` | Forecast and read inventory | now (partners) |
  | `creative:submit` | Submit and upload creative and content packages | **now** |
  | `campaign:read` | Read back own campaigns | now (partners) |
  | `campaign:author` | Create and edit campaign drafts | later (advertiser login + Gen AI) |
  | `campaign:publish` | Release a campaign into approval/activation | later |

  Partner clients are issued the scopes the retailer granted the DSP in
  its setup (§7 *DSP setup*); advertiser clients are issued only what the
  retailer granted that advertiser. A token can never carry a scope its
  client was not granted, and a request needing a scope the token lacks is
  `403 insufficient_scope`.
- The Partner API contract for tier-1 DSPs (§6) is unchanged for what they
  send: a DSP that cannot do OAuth client-credentials is handled at the
  adapter seam, not by weakening the token model.
- Until this is built, the static token is the single implementation of
  `partnerFromRequest(req)`; the middleware contract in AUTH-IDENTITY is
  what makes swapping it a local change.
- Endpoint, claims, scope catalogue (with `campaign:author` and
  `campaign:publish` reserved), the mapping of rate limiting / encryption /
  timing-safe comparison, and the migration path are specified in
  *AUTH-CREDENTIAL boundary* below.

##### AUTH-CREDENTIAL boundary — token endpoint, scope model, migration

*Specification only; no behaviour change. The static partner tokens keep
working until a later release builds this.*

**Boundary line.** AUTH-CREDENTIAL owns **machine-to-machine credentials and
scope enforcement** and nothing else. It does not own who a principal is
(AUTH-IDENTITY) or how a person signs in (AUTH-LOGIN); it only requires that
whatever AUTH-LOGIN produces resolves to a scope set from the catalogue
below, so that a login and a client secret end in the same token shape.

**Token endpoint.** `POST /v1/oauth/token`, the OAuth 2.0 client-credentials
grant (RFC 6749 §4.4), one endpoint for every principal type.

| | |
|---|---|
| Request | `application/x-www-form-urlencoded`: `grant_type=client_credentials`, `client_id`, `client_secret` (or HTTP Basic), optional `scope` (space-separated; a **subset** of what the client holds — omitted means all it holds) |
| Success | `200 {access_token, token_type: "Bearer", expires_in, scope}` |
| Failure | `400 invalid_scope` (asks for a scope the client does not hold), `401 invalid_client` (unknown client, wrong secret, revoked client, suspended advertiser or disconnected DSP — one indistinguishable answer, so the endpoint cannot be used to probe which ids exist), `429 rate_limited` |
| Lifetime | Default **10 minutes** (`expires_in: 600`); configurable 5–15 minutes. No refresh token: a client simply asks again. Open: signing-key rotation cadence. |
| Claims | `sub` = `principalId`, `principalType` (`partner` / `advertiser` / `admin`), `scope`, `client_id`, `iat`, `exp`, `jti`. Nothing secret, nothing personal. |
| Verification | Signed (asymmetric, `kid` in the header so keys rotate without downtime); checked in the auth middleware with no database read on the hot path, then resolved to `{principalType, principalId, scopes}` — the contract AUTH-IDENTITY already fixes. A handler never sees the token. |

**Clients.** A client is `{clientId, principalType, principalId, scopes,
status, createdAt, lastUsedAt, secretHash}`. A principal holds one or more
(for example one per environment). The secret is generated by the platform,
**shown once**, stored only as a salted hash, never logged, and rotatable
with an overlap window (old and new both valid until the old one is
revoked). Revoking a client, disconnecting a DSP or suspending an advertiser
stops new tokens at once and existing ones within the token lifetime; the
build's existing "no writes from a disconnected DSP" check stays in force
regardless of token validity.

**Scope catalogue.** Scopes are `resource:action`, lower-case, and are
**additive**: a scope never implies another. Adding a capability later adds
a row here and a check on the route — never a change to the endpoint, the
token shape or the middleware.

| Scope | Grants | Status | Granted to |
|---|---|---|---|
| `inventory:read` | Forecast and read inventory (Partner API `/v1/forecast`, `/v1/inventory`) | Defined, today's partner behaviour | partner |
| `creative:submit` | Submit and upload creative and content packages | **Release one** | partner, advertiser |
| `campaign:read` | Read back the principal's own campaigns, bookings and statuses | Defined, today's partner behaviour | partner, advertiser |
| `campaign:author` | Create and edit campaign drafts, including Gen AI authoring | **Reserved** — later release | advertiser |
| `campaign:publish` | Release a campaign into approval and activation | **Reserved** — later release | advertiser |

*Reserved* means the name is fixed now and no token may carry it until the
release that builds the capability; the endpoint refuses to issue a reserved
scope (`invalid_scope`) and no route checks it yet. Admin-only capabilities
keep their existing `SessionSource` role scopes (`admin`, `approver`,
`sections`) and are out of this catalogue.

**Enforcement.** Each route declares the one scope it needs. Missing or
invalid token → `401 invalid_token` (with `WWW-Authenticate`); valid token
without the scope → `403 insufficient_scope`, naming the scope. Scope is
checked **in addition to**, never instead of, the isolation rule (a principal
sees only records it owns or is delegated) and the DSP-connected check.

**One scope set for machines and people.** A scope set is a plain set of
catalogue names. An AUTH-LOGIN session resolves `{advertiserId, userId,
role}` to a **subset** of the advertiser's granted scopes and is issued a
token of the same shape and claims (with the `userId` added as an actor
claim for audit). Nothing downstream can tell the two apart, and nothing
here defines login, roles or sessions.

**Existing protections, mapped onto the new model.**

| Today (static token) | Under AUTH-CREDENTIAL |
|---|---|
| Per-partner token bucket, 50 requests/s, burst 100 (`http/rateLimit.ts`) | Keyed by **`principalId`**, not by token or client, so a principal cannot multiply its allowance by holding more clients. The token endpoint has its own, much tighter limit per `client_id` and per IP (credential-guessing defence). Same numbers and `429`/`Retry-After` behaviour for the API. |
| Secrets encrypted with AES-256-GCM (`SecretsStore`, random IV, 16-byte tag) | Client secrets are **hashed**, not encrypted — the platform never needs the plaintext back. Signing keys and any DSP-side credentials the build must present onward stay in `SecretsStore` under AES-256-GCM. |
| Timing-safe token comparison | Timing-safe comparison of the secret hash at the token endpoint; signature verification replaces token comparison on the hot path. A uniform error and uniform work for unknown client ids. |
| Immediate revocation | Bounded by the token lifetime (minutes); client revocation blocks new issuance instantly. Where "immediate" is required, the DSP-connected and advertiser-`active` checks remain per-request. |
| POC tokens are public, so the API refuses to start with them in production | Unchanged until cut-over; afterwards the static-token path does not exist in a production build. |

**Migration from static tokens.**

1. **Add, don't replace.** The middleware becomes a principal resolver that
   accepts a signed access token **or**, during migration only, a legacy
   static token (resolved exactly as `partnerFromRequest` does today, given
   the full set of partner scopes: `inventory:read`, `creative:submit`,
   `campaign:read`). The Partner API contract for DSPs does not change.
2. **Issue a client per partner**, with the scopes already granted in DSP
   setup, and show the secret once. Partners move at their own pace; the
   legacy path is logged per partner (`principalId`, no token value) so the
   retailer can see who has not moved.
3. **Deprecate with notice**, then **disable the legacy path** per
   environment by configuration, then remove it. Production builds already
   refuse the public POC tokens; after removal no static token exists.
4. **DSPs that cannot do client-credentials** are handled at the adapter
   seam (§6), never by weakening the token model or keeping a long-lived
   bearer token alive.
5. Advertiser clients are **never** issued a static token: they start on the
   new path.

**Non-goals.** Human login, roles and sessions (AUTH-LOGIN); the advertiser
record and principal model (AUTH-IDENTITY); authorization-code/PKCE flows;
token introspection and revocation lists; any change to the Admin API, the
public API, playback or distribution.

**Acceptance.** This section names the token endpoint, the scope catalogue
(with `campaign:author` and `campaign:publish` reserved), the mapping of the
existing protections and the migration path; `api/PH-CORE-BOUNDARIES.md`
names what issuance asks of PH Core; the Partner API behaves exactly as
before.

#### AUTH-LOGIN — users resolve to the advertiser scope

- **The credential is separate from the human.** An advertiser entity
  holds **both** a machine credential set (AUTH-CREDENTIAL clients) **and**
  user logins. Both resolve to **the same advertiser principal and the same
  scope set**.
- **Login-resolves-to-scope rule:** a signed-in advertiser user is issued
  an access token for their advertiser's principal, limited to the scopes
  their role within that advertiser allows (a subset of the advertiser's
  own grant, never more). Downstream code cannot tell, and must not care,
  whether the token came from a client secret or from a login.
- The future login + Gen AI campaign-authoring path is therefore a **front
  door onto the identity built in AUTH-IDENTITY**, issuing tokens through
  AUTH-CREDENTIAL's endpoint — not a second authentication system, a second
  advertiser record or a second permission model.
- Login itself (how a person proves who they are: federated SSO with the
  advertiser's identity provider, or PH-managed accounts; MFA; invitation
  and offboarding) is **deliberately not decided here**. It belongs to PH
  Core's user/identity service where it exists; this build only requires
  that it returns `{advertiserId, userId, role}` and that role maps to
  scopes.
- Retailer admin users remain the `admin` principal type, authenticated by
  the HQ Admin session (`SessionSource`); they are not advertiser users.

##### AUTH-LOGIN boundary — advertiser users, login-to-scope resolution, reserved Gen AI authoring

*Specification only; no behaviour change. Nothing here is built in this
release.*

**Boundary line.** AUTH-LOGIN owns the **human-to-scope resolution** and the
**advertiser ↔ users relationship**, and nothing else. It does not redefine
the principal (AUTH-IDENTITY) or the token mechanism and scope catalogue
(AUTH-CREDENTIAL); it consumes both.

**Advertiser ↔ users.** An advertiser has **zero or more** users. A user
belongs to exactly one advertiser in this build (a person working for two
advertisers holds two user records, so isolation never depends on which one
they "switch" to).

| Field | Meaning |
|---|---|
| `userId` | Stable, opaque, never reused. Owned by PH Core's user/identity service, not minted here. |
| `advertiserId` | The one advertiser the user acts for (AUTH-IDENTITY's `principalId`). |
| `role` | A named bundle of scopes within the advertiser (below). |
| `status` | `active` / `disabled`. Offboarding a user disables it; it never touches the advertiser, its clients or its campaigns. |

The advertiser holds **both** AUTH-CREDENTIAL clients and these users. Zero
users is the normal state until advertiser login is offered; an advertiser
with clients only (machine submission) needs nothing from this boundary. The
record stores no password, no factor and no profile data — only the
`userId`/`advertiserId`/`role`/`status` link.

**User-session-resolves-to-scope rule.** A login yields
`{advertiserId, userId, role}` from PH Core's identity service. The token
endpoint (AUTH-CREDENTIAL) turns that into an access token of the same
shape as a client token:

1. `sub` = `advertiserId`, `principalType` = `advertiser` — **the same
   principal** a client secret resolves to, not a new principal type.
2. `scope` = `role`'s scopes **∩ the advertiser's own granted scopes**. A
   user can never hold a scope the advertiser was not granted, and never
   more than the role allows.
3. `userId` is added as an **actor claim** (`act`), for audit only. The
   audit trail records `principalId` plus the acting `userId`; handlers
   never read it to decide access.
4. Suspended advertiser, disabled user or an `active`-check failure gives
   the same indistinguishable `401` as a bad client secret.

Authorisation stays **scope-based and caller-agnostic**: routes declare a
scope, middleware checks the token's scope set and the isolation rule, and
no handler branches on "machine token vs logged-in user". Revoking a user
takes effect within the token lifetime (minutes; no refresh token).

**Roles.** Roles are named scope bundles per advertiser, defined by the
retailer's grant and never wider than it. Indicative set, to be confirmed
when built:

| Role | Scopes (within the advertiser's grant) |
|---|---|
| `viewer` | `campaign:read` |
| `author` | `campaign:read`, `creative:submit`, `campaign:author` *(reserved)* |
| `publisher` | `author` + `campaign:publish` *(reserved)* |

**Reserved: Gen AI campaign authoring.** The authoring surface sits **behind
`campaign:author` and `campaign:publish`** (catalogue status *Reserved*): the
names are fixed now, no token may carry them and no route checks them until
the release that builds it. When it arrives it is a front door onto this
identity — advertiser login, then tokens through the existing endpoint — not
a second auth system, advertiser record or permission model. Guardrails and
permissions are **per advertiser**, expressed as the retailer's scope grant
plus per-advertiser policy, in the same place `advertiser_settings` lives:

- `campaign:author` lets a user create and edit **drafts** (including Gen AI
  generated ones); a draft is inert — never booked, never played.
- `campaign:publish` is the separate step that releases a draft into the
  **existing approval and activation flow**; Gen AI output gets no approval
  shortcut, and an advertiser may hold `author` without `publish`.
- Per-advertiser guardrails (brand rules, allowed formats, prohibited
  categories, generation limits) are retailer-set and enforced server-side
  at authoring and again at approval; none is decided here.

**Not the POC's stand-in session.** The Admin API's stand-in (`POC_ROLE`;
every caller is `hq_admin`, service bound to `127.0.0.1`) is the `admin`
principal's placeholder and **must never be the advertiser login**: an
advertiser user is never resolved through `SessionSource`, never inherits
`hq_admin`, and no advertiser-facing route may sit behind the stand-in.
Retailer admin users stay `admin` principals on the HQ Admin session.

**Non-goals.** How a person proves who they are (SSO, PH-managed accounts,
MFA, invitation, offboarding workflow — PH Core's identity service), the
token endpoint and scope catalogue (AUTH-CREDENTIAL), the principal and
advertiser record (AUTH-IDENTITY), advertiser self-service screens, and
building any Gen AI authoring.

**Acceptance.** This section documents the advertiser ↔ users relationship,
the user-session-resolves-to-scope rule and the reserved Gen AI authoring
scopes; `api/PH-CORE-BOUNDARIES.md` → *AUTH-LOGIN* names what user identity
asks of PH Core.

#### What this release does and does not do

- **Does:** fixes the vocabulary above (principal types, the three named
  boundaries, the scope names, the login-resolves-to-scope rule) so the
  Partner API, Admin API and data model can be written against it.
- **Does not:** build a token endpoint, advertiser accounts, advertiser
  login, Gen AI authoring, or change the static partner tokens. Nothing in
  the public API changes.
- **Open, not answered here:** token lifetime and signing-key rotation
  policy; whether advertiser-direct submission is offered per retailer or
  per platform; the login provider (see AUTH-LOGIN).

## Functional requirements

Each item is annotated with where it lives in the prototype, or marked *spec
only* where it is not built. **None of them changes playback, playlists,
targeting evaluation, distribution to players, playback logging or campaign
playback analytics.**

### Display types

- **Display type library**, browsable by touch point, with slot count and
  ownership summary; QR Control and CTAs display types not offered.
  *(Display Types)*
- **Display type editor** with inheritance-aware editing (type-level default
  vs. per-display override, visually distinguished), in a single full-width
  column beside the list, matching DSP Integration. *(Display Types)*
- **Delete a display type**: a bin icon on each display type in the list
  opens a confirmation dialog; when displays are assigned, the dialog lists
  them and Delete is disabled. *(Display Types)*
- **Collapsed panels with summaries**: Phantom Zone, Enabled Features and
  Multi-Zone Layout collapsed by default, each header showing chips for what
  is enabled or changed (phantom size/position; enabled features; zone
  count). *(Display Types)* Playlist Settings was a fourth such panel here;
  it moved to Playlist Management, 26 Sep 2026 — see below.
- **Multi-zone layout designer** for signage. *(Display Types → Multi-Zone Layout)*
- **Venue and screen metadata** per store and display: PH Core's, a read-only
  dependency (Q35; api/PH-CORE-BOUNDARIES.md, "Venue and geo metadata").
- **Playlist Settings panel** (ticket, 27 Sep 2026), last in the list: for
  a Default Playlist that's still an unsaved draft (a new display type's,
  or an "Add new playlist" one), the same five fields as Playlist
  Management's own row, editable, with a link across to Playlist
  Management, and what it shows is what Save creates the playlist with
  (28 Sep 2026); read-only with a "Settings managed within Playlist
  Management" line once the playlist is saved. **While the display type
  itself is new it also holds Maximum Campaigns Played In Rotation and
  slot assignment** (ticket, 28 Sep 2026), so a screen's rotation and its
  Headquarters/Advertiser slots can be set before the first save. Its
  collapsed header carries the same summary pills as the other panels
  (*Default settings*, or *N settings changed*, plus the slot-count/owner
  chips while it holds slots), and the Playlist Management link sits
  inside the panel, not on the header (failed-testing feedback, 27 Sep
  2026). *(Display Types → Default Playlist)*
- **A new display type starts at the defaults** (ticket, 28 Sep 2026):
  its auto-created playlist has nothing overridden (*Default settings*),
  and its rotation is *Default (Unlimited)* until a cap is picked.
  *(Display Types → New display type)*
- **Website and Mobile App: same slot editor as digital signage** (ticket
  0jviesctpWGyOYtK20tg, decision Rob 7 Oct 2026, superseding
  HAmTUHQVj63NDiY4hLk8): the playlist's slot editor offers the same Maximum
  Campaigns Played In Rotation, the same owner list (Headquarters /
  Advertiser) and the same Advertiser assignment on Advertisers / Inventory
  (reserve price, billing unit, max campaigns, named advertisers, buyers
  lists) as digital signage. There is no *Available for RTB* switch. The bid
  request still carries the OpenRTB `site` (Website) or `app` (Mobile App)
  object, never `dooh`, and no `imp.qty` (one impression per render,
  multiplier 1). A website or app has no camera audience, so it is never held
  back for lack of an audience score. PH Core stores the slot and calls the
  signal at render time (PH-CORE-BOUNDARIES.md → "Website and Mobile App
  slots"). *(Display Types → Playlists → Slot assignment)*
- **Website and Mobile App touch points** (ticket, 28 Sep 2026): offered
  alongside Digital Signage and Kiosk, HQ-only (no Advertiser/Stores slot,
  no reserve price/billing unit/max campaigns/venue metadata, out of
  Advertisers / Inventory, Available Inventory, the Inventory API and bid
  requests), their own canvas defaults (1920×1080 / 330×400) on a new
  display type, and Enabled Features/Multi-Zone Layout hidden except QR
  Control. *(Display Types → Touch Point)*

### Playlist management

- **Edit a playlist** (name, assignment to display types and zones).
  *(Playlist Management)*
- **Delete a playlist** through a confirmation dialog with Cancel; when the
  playlist is a default or zone playlist, the dialog lists where it is
  assigned and Delete is disabled. *(Playlist Management)*
- **Playlist Settings, as an expandable row** (moved off Display Types, 26
  Sep 2026): a leftmost, deliberately larger expand arrow on every playlist
  — assigned or not — reveals Asset Position/Fill, Campaign Transition,
  Auto-Rotation and Auto-Play, edited inline with the page's own Save
  changes bar. *(Playlist Management)*
- **A playlist auto-created for an existing display type starts with
  Auto-Rotation and Auto-Play off** (ticket, 27 Sep 2026), not the platform
  default of On/On that an unconfigured playlist used to silently inherit:
  a Default Playlist added from Display Types, or a zone playlist created
  on demand. A **new display type's own default playlist starts with
  nothing overridden** instead (ticket, 28 Sep 2026).
  *(ensureReferencedPlaylists, API)*
- **Slot ownership editor**: each slot's label and owner — Headquarters,
  Advertiser or Stores — and nothing else. With DSP integration switched
  off, Advertiser is greyed out for a slot that isn't one already. Shown
  inside the same expanded row, per assignment, alongside Maximum Campaigns
  Played In Rotation — both stay tied to the display type, since they size
  and sell that specific screen's positions; neither shows for an unassigned
  playlist. **Under a zone's playlist both are that zone's own** (ticket,
  28 Sep 2026): each zone has its own cap and its own slots, with no Zone
  column, and a zoned display type's Default Playlist shows neither.
  *(Playlist Management → Slot assignment)*

### Saving, deleting, help text and layout

- **Save changes / Cancel bar**, identical on the Display Types form,
  Exchange settings, Advertiser settings, Shared Targeting Variables, every
  DSP page and the Advertisers screen: always visible at the bottom of the
  page; Save changes enabled only when something has changed; Cancel
  restores the saved values. *(Display Types; DSP Integration; Advertisers)*
- **Unsaved-changes confirmation** when leaving a page with unsaved changes.
  *(Display Types; DSP Integration; Advertisers)*
- **Delete confirmation dialog**, shared by display types and playlists:
  Cancel and Delete, or a warning with what depends on the item and Delete
  disabled. *(Display Types; Playlist Management)*
- **Help text as tooltips**: info-icon tooltips next to page titles, section
  headings, field labels and table columns, specific to each; page-title
  tooltips state exactly what the page covers; tooltips open below when
  there isn't room above; no explanatory paragraphs or hint lines on the
  page. *(Display Types; DSP Integration; Advertisers)*
- **Shared page layout**: same-width list column and a full-width content
  column on Display Types and DSP Integration. *(Display Types; DSP Integration)*

### Advertisers / Inventory

- **Advertisers / Inventory screen**, below Playlist Management and above
  DSP Integration in the navigation (Campaign Status is no longer a nav item
  between them — see *Campaign schedule* below), editable by an admin and
  read-only for marketing: every
  advertiser across all DSPs, with a **Campaign approval** toggle (Required /
  Not required, default Required), a **floor multiplier** (default 1.0) with
  the effective floor shown in the company currency, its **campaigns by
  approval status** (which open Campaign Status filtered to it) and a
  **Bookings** link when it has any, plus a tooltip on each column. No
  campaign approval takes place here. *(Advertisers / Inventory)*

### Campaign asset approval — existing Campaigns section

- **Clear campaign statuses** (Draft / Awaiting approval / Approved /
  Rejected) with a status filter and counts on the campaign table.
  *(spec only — existing Campaigns section)*
- **Campaign table change**: activation toggle hidden while *Awaiting
  approval*; Approve icon and Reject-with-reason shown instead; toggle
  appears once approved; automatically approved campaigns marked.
  *(spec only — existing Campaigns section)*
- **Submission API**: create, upload assets, submit, status. *(spec only)*
- **Automated asset checks** on upload, including targeting permission
  checks, with reasons returned to the advertiser. *(spec only)*
- **Review view**: creative on the target canvas, advertiser, targeting
  summary, check results. *(spec only)*
- **Re-approval on change** and an **approval audit trail**, including
  automatic approvals. *(spec only)*
- **Server-side enforcement**: campaigns that are not *Approved* are excluded
  from reservation, bidding and hand-off, and cannot be activated.
  *(spec only)*
- **Campaign table now groups by playlist, not by layer** *(superseded 10 Oct 2026: one row is now one campaign — Campaign name, Touch points, Creative ID, grouped by advertiser; see "Retailer review" above. Kept as history.)*: Advertiser first,
  then Schedule, Playlist name (was Name), No. of campaigns (this
  submission's layer count), and Localised variables / Personalised
  variables — a high-level summary per column with the exact rules on
  hover. The playlist-name click-through is the existing campaign-name link
  above, not a second one. *(spec — existing Campaigns section; built in
  the POC's own Campaign Status stand-in,
  `apps/admin/src/features/campaign-status/CampaignStatusPage.tsx`, with the
  summary computed server-side by `GET /admin/v1/campaigns`)*
- **The per-status counts above the table filter it** (ticket, 27 Sep
  2026): clicking *Approved*, *Awaiting approval* or *Rejected* sets the
  Status column's own filter to that status (the column funnel shows it as
  on, and the clicked count is highlighted). The table stays filtered until
  the user clears it with that funnel's **Clear Filter**; the choice is kept
  in the URL (`status=`). *(POC Campaign Status stand-in)*

### Pricing

- **Company-wide pricing**: currency (any ISO 4217 currency, listed by code
  and name), the platform floor CPM,
  the minimum of the floor hierarchy, each with the tooltip given in §4.
  *(DSP Integration → Advertiser settings → Pricing)*
- **Advertiser floor multiplier** per advertiser. *(Advertisers)*
- **Audience scoring framework** (MOVE/VAC-d) the retailer populates, automated
  where cameras are connected. *(spec only)*
- **Floor hierarchy** (platform, DSP, buyers and targeting list; most specific set wins, blank inherits, platform is the minimum). *(Advertiser settings, DSP page, list)*
- **Effective floor CPM per pricing type and advertiser**, applied
  pre-auction and sent as `imp.bidfloor` with `bidfloorcur` USD. *(spec only)*
- **Dynamic VAC-d billing** from existing playback data. *(spec only)*

### Inventory

- **Inventory API**: list, detail, availability per play window and
  forecast, scoped to what the requester could buy. *(spec only)*
- **Available Inventory**: every advertiser-owned slot across the estate
  that connected DSPs can bid on (Display type, Playlist, Slot, Position,
  Assigned to, Reserve price, Max campaigns, Max play length, Billing
  unit, and an Open link), with no advertisers column and a filter on
  every column. *(Advertisers / Inventory → Available Inventory)*
- **Reserve price, inherited from its display type** (decision, 22 Sep; real
  inheritance, 22 Sep): a CPM premium to reserve the position in advance of
  real-time selling, or no reserve, set once on the display type and
  automatically reaching every slot on it — override just one slot to give
  it its own value, independent from then on; published on the position,
  resolved, and bookable: a buyer's reserve commitment holds the window as
  Reserved, out of real-time selling, billed on realised VAC-d at the
  reserve price (open questions 45 and 52, resolved 29 Sep 2026).
  *(Advertisers / Inventory → Available Inventory)*
- **Billing unit = play-window length** (open question 27, decision Rob,
  29 Sep 2026): the slot's billing unit (slot override, else display type
  default, else the platform's 24 hours) sets the length of
  every window it is booked, bid on and billed against, each billed on
  its own realised VAC-d. Windows of every length are aligned to Monday
  00:00 UTC. Admin-editable, marketing read-only; can't change while the
  slot has live or unbilled windows. *(Advertisers / Inventory → Available
  Inventory)*
- **Max campaigns, inherited from its display type** (ticket "Available
  Inventory: Max campaigns column + slot playlist statement"): the
  retailer-controlled maximum number of campaigns (default + targeted
  versions) this advertiser may submit for the slot — same
  override-always-wins inheritance as reserve price, default 5, 1-10
  inclusive — replacing the platform-wide 20-targeted-versions cap for
  that slot once a submission names it. Admin-editable, marketing
  read-only, filterable, with an info tooltip. Purely a submission cap —
  it does not feed the auction or billing.
  *(Advertisers / Inventory → Available Inventory)*
- **Display type column capability icons**: the Display type column carries
  an icon per capability the display type has enabled, alongside its name —
  Vision/AI (on-device computer vision, `visibility` icon), then QR Control
  (`qr_code_2` icon) — each a plain boolean read off the display type's own
  settings (ticket "show a computer vision icon when computer vision is
  enabled on a specific display type", 22 Sep). This is the display type's
  own hardware capability, distinct from a booking's personalised targeting
  rules happening to use a computer-vision variable (see "Personalised
  trigger icons" below, under Booking schedule) — the same underlying
  Vision/AI feature (Display Types → Enabled Features), read from a
  different angle. *(Advertisers / Inventory → Available Inventory)*
- **Assigned to per slot**: who may buy the position — any connected DSP by
  default, or named DSPs, named advertisers (reserved) or the whitelist —
  as a multi-select of pills, set by an admin and enforced on every bid.
  *(Advertisers / Inventory → Available Inventory)*
- **Personalised on reserve bookings and deals, never open real-time**: a
  personalised campaign is accepted in a `type: reserve` booking (on a slot
  with a reserve price, own or inherited) and on a deal-held position
  (private auction, preferred, guaranteed; 8 Oct 2026); targeting is defined on the buyers and targeting list,
  not per slot (7 Oct 2026). *(Advertisers / Inventory → Available Inventory)*
- **Campaign schedule** (renamed from "Booking schedule", ticket 26 Sep
  2026; **page title "Advertiser Bookings"** and the second tab **"Upcoming
  Campaign Approval"** since 27 Sep 2026 — its URL key stays
  `tab=campaign-status`): the page opened from Available Inventory or an
  advertiser now holds **two tabs** — **Booking schedule** (the
  landing/default tab, everything below in this bullet, unchanged) and
  **Upcoming Campaign Approval**
  (the full Campaign Status table — see "Campaign table now groups by
  playlist..." under *Campaign asset approval* above — shown at full
  width; Campaign Status is no longer its own item in the HQ Admin
  navigation, this tab is its only home now). The page as a whole **still
  stands alone in its own browser tab** (Rob, 21 Sep, unchanged by the 26
  Sep tab restructuring above): no Display Types / DSP Integration nav
  beside it (`RouteHandle.hideNav`). **The tab is kept in the
  URL** (ticket HSTgB0s6l56UWH71JwOv, 30 Sep 2026, reversing
  LH8iavmKqMB8mjHs9M8m of 28 Sep): Booking schedule is the default and
  carries no `tab` param; choosing Upcoming Campaign Approval sets
  `?tab=campaign-status`, so refreshing the browser stays on the tab you
  were on instead of dropping back to Booking schedule. Campaign detail's
  back link opens the same URL.
- **Booking schedule tab — forward booking only where it exists (8 Oct
  2026, ticket "Booking schedule: real-time positions show plays, not a
  forward grid").** Only deals and reserved slots commit inventory ahead, so
  only they get the booked / available grid and count towards the "N of M
  windows booked" rows and the header roll-up. An open or whitelist-only
  position is sold per impression: the API flags it `realTime` and gives
  `recentPlays` (live, non-test plays proved in the last 7 days, one grouped
  query); the tab reads **"Real time · sold per impression · N plays in the
  last 7 days"** with a dash in every window cell, never "Available". A
  booking made before a position went real-time still shows (it is real
  revenue). Plays-per-day availability for deal / reserved is ticket
  pXz9hpWIONwucHGJijsF's.
- **Booking schedule tab**: every advertiser position across its play
  windows, booked / available / unavailable, **at the top of the tab**,
  with booking revenue per display type and then what sold by campaign
  type below it (Rob, 21 Sep: the schedule is what the page is for; the
  money reads as its summary), and no second "Schedule" section header
  repeating the page's own title immediately above the table. Its DSP and
  advertiser filters are column
  filters, kept in the URL and applied by the server. **The advertiser
  filter lists only advertisers with something booked in the range on
  screen, and choosing one leaves only the positions it holds** (Rob,
  20 Sep) — the filter exists to find a booking, not to prove one is
  missing. An advertiser with nothing booked from the current window on is
  not offered a **Bookings** link on the advertisers table either.
  **Columns, left to right: Advertiser, DSP, Position** (ticket "remove the
  displays column and rather show that number of displays in brackets
  after the display name", 22 Sep, superseding the earlier same-day
  "Advertiser, DSP, Position, Displays" layout): the display count moved
  into the Position cell, in brackets after the display type name (e.g.
  "Landscape (18)"), rather than its own pinned column. That cell also now
  always carries the row's own play-window read — "N of M windows booked",
  plus how many of those carried each upsell layer — independent of the
  Daily/Weekly/Monthly view on screen (see "Play-window booked/available
  summary" below). The DSP column reads the actual booking's DSP
  (`booking.partnerName`), not the position's `partnerNames` (who is merely
  *eligible* to buy the slot) — the two can differ whenever a slot takes
  bids from more than one DSP, and only the former is guaranteed to match
  the advertiser shown beside it. *(Campaign schedule → Booking schedule tab)*
- **Plays per day on the Booking schedule** (decision Rob 9 Oct 2026;
  `GET /admin/v1/booking-schedule/capacity`, `domain/dailyCapacity.ts`): a
  "Plays per day" table under the schedule, one column per day. The window is
  still the clearing unit; the day is a roll-up of it. A slot's plays on a day
  are the plays of every billing-unit window running in the stores' trading
  hours (a store's `open_hour`/`close_hour`, migration 0061), not a flat
  24h ÷ billing unit: a 24/7 display on an 8h unit has three windows, an
  in-store display open for one 8h window has one, and a window only partly
  open counts the plays that fit. Per slot and day: total plays (whole estate);
  **pre-booked** plays, the reserve deals' commitment netted off firmly; and
  **available to bid**, the remainder, indicative (the auction decides; a
  pre-booked deal holds outright). Each localized segment (fixed or variable
  store segment, `stores.segments`) that any campaign targets is a further cut:
  its screens × plays per day, its own pre-booked plays netted off, the rest
  "available to bid within this cut". Segments overlap on screens, so the cuts
  are not additive to each other or to the estate figure. Day boundaries are
  UTC and store hours are hours of that day (no store time zones in this POC).
  Firm = reserve bookings only. Spec: §5, §6.
- **Play-window booked/available summary, wherever the page counts
  "windows"** (ticket "anytime you use the word Windows please show a
  representation of how many are booked versus … localised … personalised
  …", 22 Sep): the page's own "N play windows" header line now also reads
  "N of M booked (X localised, Y personalised)" — summed across every
  position on screen, respecting whatever advertiser/DSP filter is active
  — right next to the window count itself, not only inside the grid. The
  Position cell on every row (above) carries the same read for that one
  row, in every view (Daily included, where the earlier per-row rollup only
  showed in Weekly/Monthly). *(Campaign schedule → Booking schedule tab)*
- **Booking revenue table: % sold, Estimated revenue, no Billed revenue**
  (ticket "% of slots sold" and ticket "instead of booked revenue can you
  call it estimated revenue and remove the billed revenue column", both 22
  Sep): **columns, left to right: Display type, Booked windows, % sold,
  Estimated revenue.** % sold = this display type's booked windows ÷ its
  *sellable* windows over the period shown (booked or still available,
  excluding windows with no displays yet or before the earliest one still
  open to sell) — a dash when nothing was sellable at all, never a
  misleading 0%. **Only booked-ahead inventory counts (8 Oct 2026, ticket
  "% sold misleading for real-time positions"):** open and whitelist-only
  positions are sold per impression and never pre-booked, so they are left
  out of the sellable count; % sold reads over deal and reserved positions
  only, and a display type whose positions are all real-time shows a dash.
  Estimated revenue is likewise booked-ahead only; real-time revenue is
  realised per play and is not forecast here. "Booked revenue" is renamed **Estimated revenue** — more
  honest about what it is before a window has actually played: booked CPM ×
  assumed views, not confirmed spend. **Billed revenue is dropped from this
  table** — invoicing what actually played is the DSP's own concern, not
  this schedule's (it still appears in a booked tile's own hover, which
  covers one specific booking rather than a display type's whole period).
  *(Campaign schedule → Booking schedule tab)*
- **Single-advertiser stacking tile** (ticket "Booking schedule:
  single-advertiser stacking tile", 22 Sep, superseding the earlier
  same-day "layered reach breakdown, as three stacked pills" design):
  a slot goes to one advertiser (§6), so each booked window is **one tile
  per advertiser**, not three always-shown layer pills. The advertiser
  name sits at the top of the tile as the unit. Below it, the tile stacks
  whichever of the three layers that one purchase actually carries — the
  mandatory **default** layer always at the base, **localised** above it
  when the campaign also submitted a localised
  targeted version, and **personalised** at the very top when it submitted
  a personalised one. Only the layers actually provided are shown, so the
  tile has one of three possible heights and visibly expands and
  contracts with how successful the upsell has been with that advertiser —
  monetisation readable at a glance. This retires the earlier design's
  "Sold — other layer" pill entirely: with one advertiser per slot there is
  no second layer competing for the same window's capacity to mark as
  sold elsewhere. The localised row shows a pill with no count (the
  reach-count API left this build's scope on 30 Sep and is removed); the
  position's `displayCount` — displays using this display type across the
  whole retail footprint — is shown in brackets on the Position cell
  (above), not its own column. The personalised row carries no count
  either, since a personalised match can't be predicted ahead of time,
  showing trigger icons instead (below). In the Weekly
  and Monthly views, where a slot may have gone to a different advertiser on
  different days, each column instead rolls up how many windows in the
  period were booked at all and, of those, how many carried each upsell
  layer. **One combined hover per tile, not one per layer row** (ticket
  "devise a different approach to doing hover overs where all the details
  are potentially covered in a single hover over for that specific slot or
  tile", 22 Sep, superseding the earlier design where the tile, each layer
  row, and each lit personalised trigger icon each carried their own
  tooltip, nested three deep over a few square pixels and fighting each
  other for the pointer): the tile's single tooltip now folds in every
  layer's detail — lit trigger labels — that used to need a
  separate, nested hover to see; the layer rows and trigger icons
  themselves are purely visual. *(Campaign schedule → Booking schedule tab)*
- **Personalised trigger icons** (ticket "Booking schedule: personalised
  trigger icons", 22 Sep): on the personalised row of the tile, icons
  indicate the trigger mechanism the campaign's personalised targeting
  rules actually use, rather than a raw count of variations, because the
  mechanism predicts how frequently the multiplier will activate. A ladder
  of three, from broadest/most frequent to narrowest/rarest, derived from
  which **Personalisation Variables** (§6) a rule references: **computer
  vision** (any `Computer Vision *` variable — highest-frequency trigger,
  fires on almost anyone in front of the screen with no identification
  needed, likely to drive the majority of personalised presentations),
  **aggregate store-level** (any other store-sourced personalisation
  variable, e.g. Reason for Visit (Aggregate) or Device Type (Aggregate) —
  personalisation based on the aggregate of who is in the store,
  mid-frequency) and **individual** (any visitor-sourced variable —
  highest value but lowest frequency, requires the customer to be
  identified/checked in). More than one icon may be lit when a campaign's
  rules combine tiers; which icons are lit tells the viewer the expected
  activation frequency and therefore how reliably the personalised
  revenue will actually be earned. Which tier a play is billed at comes from
  PH Core's per-play tier; the icons and the variable grouping are a display
  heuristic and never decide billing. *(Campaign schedule → Booking schedule tab)*

### Shared targeting variables

- **Shared Targeting Variables page**: the variables shared through the API
  with connected DSPs, whose advertisers can use them once enabled; the
  default platform variables, read-only, under two headings, **Localisation
  Variables** (Store Open / Closed first) and **Personalisation Variables**
  (Gender (Computer Vision), Estimated Age (Computer Vision), Reason for
  Visit (Aggregate), Device Type (Aggregate), Purchase Intent, Purchase
  History, SKUs, Events, then Age, Gender, Visitor Segments and the rest), each a
  two-column table (*Variable*, *DSPs that may target it*) with an info
  tooltip of example values on each variable.
  *(DSP Integration → Shared Targeting Variables)*
- **DSP access per variable**: a multi-select per row (All connected DSPs or
  individual DSPs) shown as pills; Personalisation Variables default to None.
  *(DSP Integration → Shared Targeting Variables)*
- **Targeting permission validation** for submitted campaigns: rules in the
  Targeting tab structure, using only permitted variables, including
  targeting by a list of SKUs; stored in the existing targeting structure and
  evaluated by the existing platform. *(spec only)*

### DSP integration and exchange

- **DSP integration switch** (Rob, 24 Sep 2026): **Enable DSP Integration**
  at the top of Exchange settings, off at first; while off, only
  Advertiser settings, the partner DSPs and Campaign schedule (with its
  Campaign status tab) are hidden — Advertisers / Inventory and Shared
  Targeting Variables stay (9 Oct 2026) — no bid requests are sent, the Partner API and `sellers.json`
  answer 404, and nothing is deleted. What the switch is for is explained
  by the tooltip on the **DSP Integration page title**, not beside the
  switch (ticket pM0Bc2pO8WnxeV9UpI8e, 28 Sep 2026); Display Types Details
  has a page-title tooltip of its own. *(DSP Integration → Exchange
  settings)*
- **Exchange settings**: four seller-of-record fields and the published
  `sellers.json` status, shown once the switch is on. *(DSP Integration →
  Exchange settings)*
- **Issues at the top of each DSP page**: connection error with the DSP's
  reason, missing credentials, and missing bidder fields; a single
  confirmation when there are none. *(DSP Integration → partner)*
- **DSP connection**: minimum credentials per DSP, connect / re-test /
  disconnect. *(DSP Integration → partner)*
- **Bidder integration**: endpoint and seat IDs only. *(DSP Integration → partner)*
- **Test / Live mode** per DSP. *(DSP Integration → partner → Mode)*
- **Company IAB category lists**: one whitelist and blacklist for every DSP,
  chosen from the IAB taxonomy. *(DSP Integration → Advertiser settings → Category lists)*
- **Advertiser lists on a DSP's page**: the DSP's own, from its synced
  advertisers, plus a link to the central category lists.
  *(DSP Integration → partner → List management)*
- **Campaign and content package submission**: a mandatory default layer
  plus optional prioritised targeted versions, validated and stored in the
  existing campaign structure. *(spec only)*
- **Pre-auction enforcement**: effective floor CPM, categories, blocklist and
  approval, keyed on seat/advertiser identity in the bid response.
  *(spec only)*
- **Hand-off of winning, approved campaigns** to the existing campaign
  system for the slot and window. *(spec only)*
- **`sellers.json` and `SupplyChain`**, generated from the seller-of-record
  details. *(spec only; the prototype shows the published URL)*
- **Proof-of-play reconciliation and billing** from existing playback data.
  *(spec only)*
- **Audience multiplier** per play, sensor-derived where Vision/AI or MIST is
  enabled. *(spec only)*
- **Data view on every record** as JSON. *(spec only; the "Data model — JSON
  sample records" document on the board's Docs page serves this purpose)*

### Security, scale and the boundary with PH Core (review, 23 Sep 2026)

These govern how the exchange behaves under load and at its edges. They add
no screen and no copy. Details, measurements and what is deliberately left
are in `api/SECURITY-PERFORMANCE.md`; the seams with the existing platform
are in `api/PH-CORE-BOUNDARIES.md`.

- **One live sale per position and play window**, enforced by the
  database, not only by the application's check. Two clearings of the same
  window, or two reservations racing, can't both sell it; the loser is told
  why. The existing campaign system must likewise accept at most one
  booking per slot and window. *(migration 0021)*
- **Only a connected DSP can write.** Creating, uploading, submitting,
  reserving and bidding need the DSP to be connected; reads of its own
  campaigns stay open. Disconnecting a DSP stops it at once.
- **Partner API limits:** 50 requests/s per partner (bursts of 100), then
  `429 rate_limited` with `Retry-After`; 2 uploads in flight per partner;
  forecasts of at most 200 positions, each once; content packages bounded
  (name ≤ 200 characters, ≤ 10 AND groups, ≤ 20 conditions per group,
  values ≤ 200 characters). **How many campaigns** (default + targeted
  versions) a submission may carry is its slot's own **Max campaigns**
  (§5, ticket "Available Inventory: Max campaigns column + slot playlist
  statement") once `displayTypeId` and `slot` resolve to a real advertiser
  slot — retailer-controlled, default 5, 1-10 inclusive — replacing the
  platform-wide **≤ 20 targeted versions** cap for that slot; a submission
  naming no resolvable slot still falls back to that 20-cap as a
  package-size guard (approval precedes booking, so the slot is often
  unknown at submission). **The sellable count is enforced where the
  campaign meets the slot** (Rob, 1 Oct 2026): a bid or a reservation on a
  position whose Max campaigns is lower than the campaign's 1 + targeted
  versions is refused `too_many_versions`, and `GET /v1/inventory` exposes
  `maxCampaigns` on each position so a DSP knows the limit before bidding.
- **Bid responses are validated and bounded** before they are trusted:
  the request id echoed, impression 1, a finite price under a ceiling, a currency equal to the instance currency (§4: another currency, or none, is rejected, never converted and never read as USD), at most 10 bids and 64 KB per
  response, and one unknown creative retrieved per response, only from the
  DSP's own creative path.
- **An auction clears in about one bidder timeout per 16 positions**,
  however many DSPs there are: every DSP for a position is asked at once.
- **Every response** carries `nosniff`, a script-blocking CSP and, on the
  APIs, `no-store`; client errors keep their 4xx status; the public POC
  partner tokens can't be used in production.
- **Measured throughput** on one process, 1,008 positions: 1,205 req/s for
  one position, 608 req/s for a year of availability, and an auction in
  5.3 s with an 80 ms DSP round trip (`npm run bench`).

### Scale: 15,000 displays, in a client's VPC on EKS (review, 24 Sep 2026)

The exchange must serve a 15,000-display estate, and advertisers bidding
for slots on it, from a client's own AWS account on EKS. Measurements,
what changed and what is left are in `api/SCALE-15000-EKS.md`; the
deployment is `deploy/kubernetes/`.

- **What is sold scales with positions, not displays.** A play window is
  sold per position (display type × slot) across every display of that
  type (§6), so bid requests, bids and inventory grow with the number of
  positions — 60 to 2,400 for 15,000 displays, depending on how many
  formats the estate has — never with the 15,000.
- **Display counts, never display rows.** Every position, availability
  check, bid request and bid reads how many displays and stores a display
  type has from a count, not from the rows; a page of inventory on
  1,000-display types went from 20 to 850 requests a second.
- **One query for the estate** where a request asks about every position
  (the inventory's status filter), and the estate's positions indexed once
  per change to a display type.
- **Billing reads only what it can bill now** and counts a window's plays
  where they are stored: a window on 1,000 displays (1.9 million plays) is
  billed in under a second, and a tick with nothing to bill costs the same
  after 100,000 billed windows as on day one.
- **One auction per window, across processes**: a tick claims the window
  in the database before auctioning it (`auction_runs`), so several
  instances, a CronJob and the CLI never send DSPs a second round of bid
  requests. The scheduled work can run in the API process or from outside
  (`PH_SCHEDULER`, `npm run scheduler:tick`).
- **Settled bids are deleted** 90 days after their window
  (`PH_RESERVATION_RETENTION_DAYS`); won and reserved windows are kept.
- **Bounded memory:** at most 4 uploads in flight across all partners
  (`PH_MAX_UPLOADS_IN_FLIGHT`), on top of 2 per partner.
- **An admin-typed DSP endpoint cannot name the VPC**: private, loopback,
  link-local, instance-metadata and cluster-local hosts are refused; the
  cluster's egress policy is the second lock.
- **Two front doors**: the Partner API, `sellers.json` and creatives on a
  public load balancer behind a WAF; the Admin API on an internal one
  only, since the POC's Admin API relies on the platform's session.
- **Probes and shutdown**: `/healthz`, `/readyz` (503 until migrated),
  SIGTERM drains and closes the database; `API_HOST` binds beyond the
  machine.
- **Measured** on one process at 15,000 displays, 32 concurrent clients:
  a page of inventory 582–850 req/s, one position ~2,500 req/s, a bid
  ~1,000 req/s, a forecast ~1,350 req/s, whichever of the three estate
  shapes; the auction 12.7 s for 2,408 positions at an 80 ms DSP round
  trip (bounded by the round trip, not the estate).
- **One replica until the database is shared**: the SQLite file is one
  writer; N replicas need a Postgres adapter (engineering's integration
  work), after which the HPA, PDB and CronJob in
  `deploy/kubernetes/optional/` apply. The SQL is already portable and the
  repository layer already awaitable (1–2 Oct 2026; SCALE-15000-EKS.md),
  so the adapter is wired in `context.ts` alone.

### Stability under concurrency (review, 24 Sep 2026)

Before going live, the exchange was tried against the races and edge
cases a live estate produces (`api/SECURITY-PERFORMANCE.md` → "Stability
under concurrency and at the edges" has the table; the tests are
`apps/api/test/stability.test.ts` and `test/multiprocess.test.ts`). What
the system now guarantees:

- **No bid is ever stranded pending.** A bid placed while the auction is
  waiting on the bidders is in that auction; anything still pending when
  a position clears, when its auction fails, or when its window starts
  without an auction, is settled `lost` with a reason. Once a tick has
  claimed a window's auction, a new bid for it is refused.
- **One advertiser, one open bid per window**, enforced by the database
  (migration 0026), so two API instances taking the same bid at once take
  it once.
- **A DSP can't take the auction down.** An answer that isn't a bid
  response, or a fault clearing one position, is that position's outcome;
  every other position clears and the tick finishes.
- **One job can't stop another.** Billing, retention, settling and the
  auction are isolated in the tick; a failure is logged and reported, and
  the auction due that minute still runs.
- **Late recovery of a missed auction cutoff** was removed 8 Oct 2026 with
  the cutoff itself: a window can be booked or bid on until it starts.
- **API bids have the DSP bids' ceiling** (10,000 CPM).
- **Two processes starting on one empty database** both come up: one
  migrates and seeds, the other waits and serves.
- **Ties go to the earlier bid.**

### Authentication seams (§9.5, specification only)

- Every API caller resolves to one **principal** of type `partner`,
  `advertiser` or `admin`; `advertiser` is first-class from day one, not a
  field on a campaign. (**AUTH-IDENTITY**)
- Static partner bearer tokens are to be replaced by short-lived scoped
  tokens from one OAuth client-credentials token endpoint serving partners
  and advertisers alike; capability is a scope (`creative:submit` now;
  `campaign:author`, `campaign:publish` later). (**AUTH-CREDENTIAL**)
  Tokens last minutes, are issued at `POST /v1/oauth/token`, and are
  rate-limited per principal; static tokens migrate by running beside the
  new path, then being switched off.
- An advertiser's user logins and machine credentials resolve to the same
  advertiser principal and scope set. (**AUTH-LOGIN**)
- Nothing is built in this release; see §9.5 and
  `api/PH-CORE-BOUNDARIES.md` → "Authentication seams".

### Analytics schema, measurement and federation — foundation (§9)

- **Versioned canonical playback/analytics event schema**, S3-partitioned,
  with a `schemaVersion`, `source` and `timestamp` on every event and
  optional/nullable CV fields reserved from day one. *(spec only; the v1
  shape and a validator are reserved in `packages/types/src/analyticsEvent.ts`
  — nothing produces events yet)*
- **Computer vision as a measurement source**: opportunity-to-see, dwell,
  attention seconds and anonymised age band/gender populate the schema's
  reserved `cv` fields, each with a `confidence` value, extending
  proof-of-play toward proof-of-audience. *(spec only; the `cv` fields are
  reserved on the v1 event shape)*
- **Source-instance identifier** (`platformInstance: { instanceId, domain
  }`), reserved on the canonical event schema and on booking/reservation
  records, anchored to the stable domain and never the `sellers.json`
  seller ID. *(spec only; no columns — migration 0022 reserved
  `exchange.platform_instance_id` and `reservations.source_instance_id`,
  and migration 0032 dropped them again on 30 Sep 2026 because nothing
  used them; `sourceInstanceId` stays on the v1 event shape)*
- **Agent-to-agent platform interface**: the inter-platform integration
  defined as an agent-consumable (MCP-layer) surface, first-class and
  separate from the tier-2 PH-native API. *(spec only)*

## Decisions of 29 Sep 2026 (Rob) — spec alignment

These record where the decisions below change or confirm what the sections
above say. Where a section above still reads differently, this section wins
until that section is edited.

- **Approval rights (Q39; §3 "Campaign asset approval").** Approval is done
  by any user with access to the campaign approvals section. There is no
  dedicated approver role and no store-level approval step. Any wording
  above implying a specific HQ Admin approver role, or optional store-level
  approval, is superseded.
- **Sensor-derived audience (Q34; §4 "Pricing").**
  Camera- or sensor-detected audience attributes qualify a campaign as
  personalised but carry no price of their own: there is no sensor
  multiplier and, since 5 Oct 2026, no personalised multiplier. The tier
  PH Core supplies per play (30 Sep 2026) is reporting data, not how the
  exchange groups variables. See Q49 for the exposure default.
- **Partial-estate delivery (Q29; §4 "Billing", §5 "Reserved" and
  "Private auctions").** Partial-estate delivery bills on realised VAC-d,
  with no make-good or shortfall remedy in this build. Delivery risk sits
  where each mode already places it: the open auction promises no volume;
  a reserved slot has a fixed premium rate, billed on realised VAC-d, and
  the brand carries any shortfall;
  a two-period private auction locks the rate but volume varies, so the
  advertiser pays for actual views, never a guaranteed number.
- **Re-approval and DSP creative audits (Q38, Q40; §3).** An approved
  campaign keeps running while an edit is re-reviewed; approval swaps the
  edit in atomically, rejection discards it. A DSP's own audit is advisory
  only; a creative a human cleared is not re-audited when byte-identical
  content arrives, whatever its crid or DSP (identity is the content hash). The "safe reuse not wired into
  upload/submit" gap is closed.
- **Play-window length (Q27; §4 "Billing", §5 "Billing unit", §6 "Selling
  a play window").** A slot's billing unit is its play-window length and
  billing granularity, for every slot. The company play-window length
  setting was removed 8 Oct 2026; the default is a platform constant (24
  hours).
- **Deals and reserve-price booking (Q45, Q52; §4 "Billing", §5 "Reserve
  price" and "Private auctions").** Deals are per DSP, built on the buyers
  list, and priced on top of the same floor, never under it. A reserve-price
  booking holds its window as Reserved, out of the auction, and bills on
  realised VAC-d at the reserve price. The "reserved slots not wired to a
  booking flow" gap is closed.
- **Advertiser notification (Q41; §6 Partner API).** Campaign status is
  retrieved by polling `GET /v1/campaigns/{id}/status`. Webhook push is out
  of scope for this build.
- **Variables (Q43, Q44; §6, §9, Functional requirements).** Variables are
  platform-defined set values; retailers do not manage them. Environmental
  attributes (weather, stock levels) are platform-defined variables held as
  segments in the existing variable store, ingested from external signals
  and evaluated like any other variable, not new data sources.
  **FUTURE RELEASE:** retailers will later be able to add their own
  variables to a customer's live profile. Not in this build.
- **Shared attributes (Q49; §6).** CV Gender and Estimated Age are covered
  by the existing shared-attributes control, which the retailer turns on or
  off. No separate default-exposure decision remains open.
- **Venue and geo metadata (Q35; §5, §6, §8).** PH Core is the system of
  record and this project reads venue and geo metadata from it read-only,
  surfacing it into inventory and targeting. The exchange's store record
  holds no copy. See `api/PH-CORE-BOUNDARIES.md` ("Boundaries with PH Core").
- **Analytics (Q53, Q54; §4 "Billing", §9 "Analytics foundation").** The
  canonical event schema, its partition and its consuming pipeline are
  external: held by Personalisation Hub in the PWA player and managed
  outside this project. This project depends on them through an API
  contract listing the event values billing needs
  (`api/PH-CORE-BOUNDARIES.md` → "Analytics event values billing consumes").
- **Closed-loop attribution (Q55; §9).** The identity-bridge layer is a
  future, separate workstream needing privacy and consent design. Billing
  does not depend on it.
- **Federation (Q56; §7 PH as SSP, architecture).** The current model is
  single-instance, self-hosted per retailer VPC. Federation, cross-instance
  trust and discovery are a future workstream needing its own design
  (trust, identity, discovery, settlement).

## Open questions

Numbering is kept from earlier revisions for traceability; questions about
templates, pairing, trust zones, channels, playlist internals and
partner-contributed attributes have been removed with that scope.

12. Campaign approval. **Resolved** (§3): a per-advertiser Campaign approval
    toggle (Required / Not required, default Required) on the admin-only
    Advertisers screen; approval itself happens in the existing Campaigns
    section; HQ-authored campaigns skip approval.
19–20. RTB slot attribution/auction configuration. **Resolved for digital
    signage** (§6): the auction clears for a play window.
27. **Play-window length.** *Resolved (decision, Rob, 29 Sep 2026):* each
    slot's Billing unit (`billingUnitHours`: slot override, else display
    type default — the same override-always-wins inheritance as reserve
    price and max campaigns) is the source of truth for its play-window
    length and billing granularity. The company-wide play-window length
    setting was removed 8 Oct 2026; when neither slot nor display type sets
    one the platform default is 24 hours (a named constant). See §5 "Billing unit".
29. **Partial-estate delivery.** *Resolved (decision, Rob, 29 Sep 2026):* no
    guarantee or make-good model in this build. Every assignment mode bills
    on realised VAC-d (§4 "Billing"); plays that did not happen are not
    billed. See "Decisions of 29 Sep 2026" below.
30. **Minimum-volume floor on partner analytics.** *Moved out of this
    project:* campaign playback analytics, including what advertisers see,
    are the existing system's.
32. **Supply architecture.** *Resolved:* PH is the SSP; onboarding order
    DV360 → Amazon Ads DSP → The Trade Desk.
33. **Seller of record.** *Resolved:* the client running the instance.
34. **Sensor-derived audience multiplier.** *Resolved (decision, Rob, 29 Sep
    2026):* there is no separate sensor multiplier. A camera-detected
    attribute (e.g. gender, estimated age) makes the campaign *personalised*,
    which at that time took the personalised multiplier (1.5), charged per
    personalised play rather than as a floor (decision, Rob, 30 Sep 2026);
    that multiplier was removed on 5 Oct 2026, so it now bills at the
    committed CPM like every play. See open question 49 for exposure to DSPs.
35. **Venue and geo metadata.** *Resolved (decision, Rob, 29 Sep 2026):* PH
    Core already manages all store data, venue and geo metadata included,
    and is the system of record. This project reads it from Core and stores
    no copy on the exchange side. See `api/PH-CORE-BOUNDARIES.md`.
36. **Transaction association** (linking transactions to campaign plays).
    *Moved out of this project:* it belongs with the existing playback
    analytics.
37. **Waiving approval for trusted advertisers.** *Resolved* (§3): the
    per-advertiser Campaign approval toggle.
38. **Re-approval behaviour.** *Resolved (decision, Rob, 29 Sep 2026):* the
    previously approved version keeps running throughout re-review;
    approving the edit atomically replaces it; rejecting the edit discards
    it and the running version continues unaffected, with the audit trail
    retained (§3, *Campaign statuses*).
39. **Who can approve.** *Resolved (decision, Rob, 29 Sep 2026):* anyone with
    access to the campaign approvals section can approve. No dedicated
    approver role and no store-level approval step.
40. **DSP creative audits.** *Resolved (decision, Rob, 29 Sep 2026):* PH's
    own approval gate stays the source of truth. A DSP's audit status (DV360
    `ExchangeReviewStatus` / `ApprovalStatus`, The Trade Desk `approvedBy`
    for its DOOH supply approver, Amazon Ads DSP asset-level moderation) is
    an advisory input recorded for the reviewer, never a replacement for
    the retailer's approval. Pre-approval rides on safe reuse, keyed on
    PH's own content-derived creative identity (decision, Rob, 4 Oct 2026):
    once a human clears a creative, the byte-identical creative is not
    re-audited, under any crid and through any DSP, and one approval covers
    every DSP it arrives through; the DSP crid is a reference label, not the
    key. A reused crid on changed content is a new creative and re-reviews
    (§3, *Submission*, *Safe reuse*). The pre-auction fallback (an unknown or
    unapproved creative is discarded and queued for review) remains. A
    supply-side push of creatives ahead of a bid, and a rich "submit
    targeting for pre-approval" flow, remain tier-2 work.
41. **Advertiser notification.** *Resolved (decision, Rob, 29 Sep 2026):*
    polling only for this build (`GET /v1/campaigns/{id}/status`); webhooks
    are deferred as a fast-follow, to be revisited if a launch DSP needs push.
42. **Floor unit.** *Resolved* (§4): the floor is a CPM, a cost per thousand
    assumed views, which is the unit DSPs bid in. It is resolved through a
    three-level hierarchy (7 Oct 2026).
43. **Variable management.** *Resolved (decision, Rob, 29 Sep 2026):* none
    in this build. Variables are platform-defined set values that retailers
    do not manage. **Future release:** retailers will be able to add their
    own variables to a customer's live profile.
44. **Environmental attributes.** *Resolved (decision, Rob, 29 Sep 2026):*
    platform-defined variables held as segments in the existing variable
    store, ingested from external signals (weather, stock levels) and
    evaluated like any other variable. Not new data sources. See open
    question 43.
45. **Deals.** *Resolved (decision, Rob, 29 Sep 2026; built with open
    question 52):* deals are per DSP and bilateral — this buyer, these
    terms — built on the existing deal object, the buyers list (§5 "Private
    auctions (buyers lists)"). Company-wide deals are not modelled. A deal
    is priced against the same score-driven floor; its negotiated rate is a
    commitment on top of the floor, never under it, and a deal never
    bypasses the floor. Programmatic guaranteed is the reserve-price booking
    flow (§5 "Reserve price"; open question 52). *Volume (7 Oct 2026,
    Rob):* a committed number of plays over a term is carried by deals,
    never by the open auction, which stays per play and holds no block of
    plays. A buyers list carries an optional `committedPlays` (whole number
    >= 1, null = per play) and a read-only `deliveredPlays`, metered in
    plays from billing line items at the positions the deal is attached to,
    inside its delivery term (migration 0050). For a guaranteed deal the
    figure is the forecast plus the contingency buffer, set by the
    guaranteed deal path, not typed in.
46. **Per-DSP bidder tuning.** *Resolved (decision, Rob, 29 Sep 2026):*
    per-DSP QPS ceiling and bidder timeout overrides on the DSP's connection
    settings (§7 "DSP setup"), override-wins over the platform defaults
    (500 QPS, 300 ms) — the same inheritance as reserve price, max campaigns
    and billing unit.
47. **Deleting a display type with live advertiser positions.** *Resolved
    (decision, Rob, 29 Sep 2026):* hard block, `409 has_dependents`, on
    deleting a display type and on changing its assigned playlist while any
    of its positions is reserved or sold for a current or future window
    (§1 "Deleting a display type", §2).
48. **SKU list length.** *Resolved (decision, Rob, 29 Sep 2026):* 100,
    the same cap as the targeting grammar's 100 values per condition;
    overflow is `400 validation_failed` (§6). How far back the existing
    platform looks for viewed SKUs and Events is existing behaviour.
49. **Computer Vision variables and DSPs.** *Resolved (decision, Rob, 29 Sep
    2026):* Gender and Estimated Age are governed by the existing
    shared-attributes control, which the retailer turns on or off at their
    discretion. There is no separate default to decide.
50. **Auction clearing for overlapping localised bids.** *Superseded
    (decision, Rob, 22 Sep, ticket "Make default creative mandatory; retire
    localised-only booking path"), not answered.* This question was about
    clearing bids for a part-sold position — several advertisers each
    holding a localised slice of one slot's capacity. That model is
    retired the same day it was resolved: a slot goes to one advertiser,
    whose default layer is now mandatory, so there is no overlapping
    capacity between *different* advertisers left to clear. (What the
    resolution actually described — reserved slots first-come-first-served,
    real-time bids highest-bidder-takes-the-overlap — never shipped past
    this document either way; the reservation/auction engine has always
    enforced a single occupant per position and window, §5.)
51. **Billing a part-sold position.** *Superseded (decision, Rob, 22 Sep,
    same ticket as open question 50), not answered* — for the same reason:
    there is no part-sold position to bill pro rata across advertisers any
    more. Ordinary dynamic VAC-d billing against one advertiser's realised
    share (§4) already covers a booking that stacks default plus upsell
    layers, since it is still one advertiser, one CPM, one position.
52. **Reserve price booking flow.** *Resolved (decision, Rob, 29 Sep 2026)
    and built, delivered with open question 45:* a buyer commits to a
    reserve-priced position for a future window (`POST /v1/reservations`,
    `type: reserve`). The window is held as **Reserved**, out of the open
    auction, honoured at the reserve price when it plays and billed on
    realised VAC-d at that price — a floor commitment, not a flat guaranteed
    volume, with no make-good. On a two-period private auction the
    commitment locks the deal's term at the reserve price through the
    existing locked-rate machinery. See §5 "Reserve price" and "Private
    auctions (buyers lists)".
53. **Canonical event schema.** *Resolved (decision, Rob, 29 Sep 2026):*
    analytics is owned by Personalisation Hub inside the PWA player and
    managed outside this project. This project defines only the API contract
    of event values billing consumes (`api/PH-CORE-BOUNDARIES.md` → "Analytics
    event values billing consumes").
54. **Who hosts the schema's partition and pipeline.** *Resolved* with
    question 53: PH, in the PWA player, outside this project.
55. **The closed-loop attribution identity bridge** (§9.4). *Deferred
    (decision, Rob, 29 Sep 2026):* to be covered separately later, out of
    scope for this build. Billing does not depend on it.
56. **Federation trust and discovery** (§9.3, §9.4). *Deferred (decision,
    Rob, 29 Sep 2026):* a future direction, out of scope for this build.
    The platform is single-instance, self-hosted in one retailer's VPC.

## Guaranteed deal path (Rob, 7 Oct 2026)

A reserve is either a **preferred deal** (the premium window held at the reserve price, no volume promised — the existing reserve-price path, unchanged) or a **guaranteed deal** that also commits a delivery volume. Both wrap the same slot inventory. `POST /v1/reservations` takes `dealType: preferred | guaranteed` (default preferred; guaranteed only with `type: reserve`).

- **Forecast** for the window = plays × audience = the slot's VAC-d assumed views per window (`assumedViewsPerWindow`, the same figure billing realises against).
- **Committed volume** = `floor(forecast × (1 − buffer%))`. Expected delivery therefore sits above the guarantee and make-goods are rare. Returned as `forecastImpressions` / `guaranteedImpressions` and stored on the reservation (migration 0046).
- **Buffer**: `guaranteeBufferPct` on Advertiser settings (in the "Committed delivery volume" group, beside Default committed plays), default 10, 0–50, instance-wide. Omitted on save keeps the stored value.
- **To the DSP**: the reservation response carries `dspDeal` — DV360 Programmatic Guaranteed / Amazon guaranteed deal with `unitCount` = the committed impressions; a preferred deal maps to a preferred deal with no volume (`dsp/dealTerms.ts`).
- **Open (dependencies)**: the exact per-DSP guaranteed-deal field names are to be confirmed against each DSP's sandbox; make-good / under-delivery behaviour when delivery falls below the guarantee is not built — billing is unchanged (realised VAC-d at the reserve price).

## Bandwidth protection — restrict uncached creatives in defined hours (Rob, 7 Oct 2026)

Our version of Broadsign's network controls, reframed around pre-caching
rather than a daypart block. A retailer on a bandwidth-constrained in-store
network can stop live creative downloads contending with trading without going
dark on peak trade.

- The restriction applies only to a creative **not already cached on the
  player**. Cached creative bids, wins and plays normally throughout.
- In the restricted window a real-time bid may win only if its creative is
  cached (spec section 7, "Creative retrieval and hand-off"; the player's
  pre-caching is in PH-CORE-BOUNDARIES.md). Uncached bids are passed over, the
  next-best cached bid wins, and none cached is `no_fill`.
- The window is a fixed daily start and end (`fixed`, UTC) or the store's
  trading hours, while the store is **open** (`store_open`; "closed" is not
  needed). `off` is the default. Outside the window, uncached creative bids
  and downloads as normal.
- Cache state and store hours are PH Core's (the same store hours as the Store
  Open / Closed variable, section 6), so the player reports `cachedCrids` and
  `storeOpen` on each impression signal; a missing `storeOpen` never blocks.
- Set in Advertiser settings (`uncachedRestriction`, `uncachedRestrictionStart`,
  `uncachedRestrictionEnd`). Not yet: an admin screen for it. (The advance
  window auction that would have pre-cached known winners was removed 8 Oct 2026.)

## Bid lookahead — when a real-time slot's auction opens (Rob, 7 Oct 2026)

A real-time slot's auction has to resolve far enough ahead for the winning
creative to be downloaded and rendered in time. Pre-caching (PH-CORE-BOUNDARIES.md)
keeps the won creative renderable; the lookahead sets how early the per-impression auction opens (the only auction timing left: the company auction-opens setting was removed 8 Oct 2026).

- **Setting**: `bidLookaheadSeconds` on Advertiser settings (a "Real-time bidding"
  section; field **Bid lookahead**, in seconds). Company-wide, whole seconds, at
  least 1; anything else is refused with "Bid lookahead is a whole number of
  seconds, at least 1." (400). Default **35**, matching Broadsign Reach, whose
  Real-Time Audience API sends bid requests about 35 s before the expected
  programmatic slot. Omitted on save keeps the stored value (migration 0053).
- **Per slot, not on a clock**: the auction for a real-time slot opens at
  `slotStart − bidLookaheadSeconds` (`rtbAuctionOpensAt`, `domain/bidLookahead.ts`).
  The player's impression signal carries `slotStartsAt`; a signal earlier than
  that is refused, 409, naming when the auction opens. Without `slotStartsAt`
  the player is signalling at playout and the auction opens now, as before.
- Positions held for a deal (reserve or a private auction) are unaffected: they take window bookings and bids, not per-impression auctions.

## Deal type on the buyers list (Rob, 7 Oct 2026; ticket ke38J410jwLTYu9blGK7)

- **One deal object plus a type**, as DSPs and Broadsign model it. A buyers
  list carries `dealType`: `private_auction` (invited buyers bid; the
  two-period model, `auctionCloses` and the locked rate apply), `preferred`
  (fixed-price first look held at the reserve price; no volume, no auction
  window) or `guaranteed` (programmatic guaranteed; commits `committedPlays`).
- **The type decides the fields.** `committedPlays` is captured only for
  `guaranteed` (pre-filled from Default committed plays; the booked volume
  per window is still `floor(forecast × (1 − buffer%))`); `auctionCloses`
  only for `private_auction`. The API refuses the other combinations (400),
  and a list that is not guaranteed reports no effective committed volume.
  The floor price CPM (platform → DSP → list; most specific raises it, never
  below the platform floor) applies to every type.
- **Authoritative in one place.** On a position assigned to a buyers list, a
  reservation's `dealType` comes from the list (a private auction books as
  `preferred`: no volume). A reservation that names a different `dealType`
  is refused with 409, so the two can never disagree about volume. A
  position with no list keeps the reservation's own `dealType`.
- **Mapping to the DSP deal at bid time** is deal ID + type (`dspDealTerms`).
  Per-DSP deal field names are still to be confirmed against each DSP
  sandbox (DV360, Amazon Ads, The Trade Desk).
- Migration 0055: existing lists with committed plays become `guaranteed`,
  the rest `private_auction`. Older clients that omit `dealType` get the
  same inference.

### Testing every deal type end to end (Rob, 7 Oct 2026; ticket rFN7TfIXtValP5hfIq1o)

- **Run 7** (`apps/api/test/e2e/run7-deal-types.test.ts`, in `e2e:quick`) has
  one case group per way a slot transacts, each driven setup → inventory →
  approval → bid or reserve → auction → hand-off booking → billing: **D1**
  open RTB (first price above the effective floor; below it falls through;
  no deal on the request and no volume carried; the real-time per-impression
  path), **D2** private auction (deal ID on `pmp.deals`, uninvited and
  deal-less bids refused, two-period locked rate), **D3** preferred deal
  (reserve, `committedPlays` not captured, DSP told `preferred_deal`), **D4**
  programmatic guaranteed (committed volume `floor(forecast × (1 − buffer%))`,
  DV360 `programmatic_guaranteed` / Amazon `guaranteed_deal`, `unitCount` =
  committed impressions). Every type asserts that the buyers list's
  `dealType` decides which fields are captured and that billing is realised
  VAC-d at the cleared or reserve price, with no make-good.
- The Run 6 journey (`npm run e2e:journey`) adds Phase 5, cases M1–M8:
  preferred and guaranteed deals over the real API and tick processes.
- **Run 8 — the AWS demo (10 Dec 2026; ticket ZHPV0Lj5N883RKGfYThw)**
  (`apps/api/test/e2e/run8-aws-demo.test.ts`, in `e2e:quick`) covers both
  ways demand reaches the retailer against the per-campaign approval and
  creative ID spec (§3 "Creative IDs"). **Direct advertiser flow** — D1 two
  submissions wait with no creative ID, then are approved into one new ID;
  D2 a selection spanning advertisers is refused whole; D3 a rejection
  carries its reason to the advertiser, the fixed creative is resubmitted
  and joins an existing ID; D4 updating an approved creative is a pending
  edit that keeps its ID; D5 an advertiser that does not require approval is
  approved on submission and groups its own campaigns; D6 only an approved,
  activated campaign bids. **DSP flow** — S1 a new creative on a bid is
  queued, approved into a new ID, activated and wins the next window; S2 a
  second creative joins the first one's ID; S3 a rejected DSP creative stays
  out of the auction. The admin table's behaviour (checkboxes, advertiser
  scoping, picker, reason dialog) is the "Upcoming Campaign Approval —
  creative IDs" suite in `apps/admin/test/dsp-integration.test.tsx`. The
  person-run walkthrough, ending in an acceptance checklist, is
  `docs/dsp-integration/AWS-DEMO-TEST-FLOW.md`; keep the three in step when
  the approval flow changes.
- The DSP-specific guaranteed-deal field names are the mapping in
  `src/dsp/dealTerms.ts`; the mocks prove it is carried, not that a DSP
  accepts it. **Still to confirm against each DSP sandbox** (DV360, Amazon
  Ads). The board's *End-to-End Test Spec — DSP Demand Paths (v2)* doc
  (`f34VQZCy2kkWJfBP6Iwp`) is not in the repo; add Run 7 and Phase 5 to it
  with these case IDs.

## Default committed plays — the play config feeds the buyers list (Rob, 7 Oct 2026)

- **Setting**: `defaultCommittedPlays` on Advertiser settings (in the "Committed delivery
  volume" group beside the guarantee buffer; field **Default committed plays**). Company-wide, a whole number of
  plays, at least 1, or empty for none (per play); anything else is refused
  with "Default committed plays is a whole number of plays, at least 1, or
  empty." (400). Omitted on save keeps the stored value; `null` clears it
  (migration 0054).
- **Flow**: creating a buyers-and-targeting list pre-fills **Committed plays**
  from it. It is a default, not a cap: the field stays editable and the saved
  figure is the list's own. A changed default is picked up by the next new list
  (and by an open new-list form whose field is still untouched).
- **Unchanged**: editing a saved list never takes the default; existing lists'
  `committedPlays` and the "N of M plays" delivery metering are not touched.

## Buyers list: committed volume and rate inherit platform → DSP → list (Rob, 7 Oct 2026)

- **Bug**: the Buyers and targeting table and modal showed a list's own committed
  volume only, so a list with none read "Per play" / blank even when a default
  was set. Both fields now always show the value in force.
- **Hierarchy** (same pattern as the three-level bid floor): the platform
  default, overridden by the DSP's value where set, overridden by the list's own.
  - **Committed volume (plays)**: platform = Advertiser settings → Default
    committed plays; DSP = `bidder.committedPlays` (new, DSP page → Committed
    plays; whole number ≥ 1, `null` clears, else 400); list = `committedPlays`.
  - **Rate (USD CPM)**: the base bid floor — platform floor → DSP `floorCpm` →
    list `floorCpm`, never below the platform floor. Once a deal's auction clears
    its locked rate shows instead ("Locked: X CPM").
- **API**: `BuyersList.effectiveCommittedPlays` and `effectiveRateCpm`
  (`EffectiveTerm`: `min`, `max`, `source` = `buyer | dsp | platform | mixed |
  none`), read only. A list's invited buyers can sit on DSPs that resolve
  differently: then `min`≠`max` and `source` is `mixed`; the UI shows the range.
- **UI**: table cells show the value with its source underneath ("platform
  default", "from the DSP", "set on this list"); a list with its own volume keeps
  "N of M plays". The modal shows a line under Committed plays and Floor price
  ("Committed volume: … (platform default)", "Rate: USD … CPM (from the DSP)")
  and uses the inherited value as the empty field's placeholder.
  `nothing set at any level` still reads "Per play".

## Visual layout check — tablet and desktop (Rob, 8 Oct 2026; ticket A3QkqCjHRP58R0lSAtKM)

The test suite was all functional: nothing checked that fields share a row or
that a tooltip sits beside what it explains. A layout check now runs with the
suite and gates the deploy train.

- **What it covers**: every DSP integration admin page — Display Types,
  Playlist Management, Advertisers / Inventory (with Buyers and targeting),
  Advertiser Bookings, Campaign detail, Exchange settings, Advertiser settings,
  Shared targeting variables and each DSP's page — at **tablet (820 × 1180)
  and desktop (1440 × 900)**. **Mobile is out of scope and not captured.**
- **Rules (objective, geometry, `apps/admin/layout/rules.ts`)**:
  1. *Field rows* — a field wrapped onto a row of its own while its
     equal-width siblings share rows above it fails; fields marked
     `data-layout-pair="<name>"` must sit on one row.
  2. *Tooltips* — every info icon follows the text it explains on the same
     line, no more than 12 px away, vertically centred on it; an icon with no
     text before it, or at the far end of the row, fails.
  3. *Grid* — fields on one row share a label line and a control line (1.5 px
     tolerance); fields stacked in one column share a left edge.
- **Baseline**: `layout/known-issues.json` lists what was already misaligned
  when the check was added. They are reported on every run but do not fail it;
  anything else does. Fixing one means deleting its entry (a listed issue that
  no longer happens is flagged). Screenshots of each page and viewport are
  attached to the report; once `layout/baselines/.enforce` exists they are
  compared with the committed `baselines/<page>-<viewport>.png` (1 % pixel
  tolerance) and an unreviewed diff fails. Intended visual changes update the
  baselines in the same change (`--update-snapshots`).
- **Where it runs**: `npm run test:layout`, a step in `e2e-quick.yml` (the
  required check on the train and on PRs to `main`, so a failure blocks Deploy
  to Main) and in `e2e.config.json`'s quick and full modes. It builds the
  hosted-demo bundle and serves it itself; it needs no API process.

