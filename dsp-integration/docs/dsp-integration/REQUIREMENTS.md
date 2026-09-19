# Display Types & DSP Integration — Requirements

Source: *Real-Time Personalised Surface Architecture Specification v1.2*
(Personalisation Hub, 3 Sept 2026), plus the `Display Types & Playlist
Management` prototype (`displaytypesandplaylists.jsx`).

## Scope

This specification covers these areas, and only these:

1. **Updates to the existing Display Types section** of HQ Admin (§1).
2. **Playlist management**: editing and deleting playlists only (§2).
3. **Campaign asset approval**: advertisers submit campaign assets, and the
   retailer approves them in the **existing Campaigns section** where the
   advertiser requires approval. Whether an advertiser requires approval, and
   its floor multiplier, are set on a new admin-only **Advertisers** screen (§3).
4. **Pricing**: the currency, the CPM bid floor, audience scoring, the
   personalised and interactive multipliers and a floor multiplier per
   advertiser (§4).
5. **Inventory API**: what inventory exists and what is available, derived
   from the slots assigned on each display type (§5).
6. **DSP integration**: the advertiser/DSP interface and the shared targeting
   variables DSPs may use (§6), with Personalisation Hub acting as the
   supply-side platform (§7).

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
the render-ladder tier preview and per-channel behaviour, and the **QR
Control** and **CTAs** display types / element types. All other playlist
capabilities (items, scenes, scheduling) are handled by the existing platform
and are not changed by this project.

**Deferred to a later release:** managing targeting variables (this release
uses the default platform variables only, read-only), environmental
attributes such as weather and stock, deal IDs (preferred and
programmatic-guaranteed deals; this release sells through the open auction
only), and per-DSP bidder tuning (QPS ceiling and bid timeout use platform
defaults).

**Navigation.** The HQ Admin navigation items for this project, in order:
**Display Types**, **Playlist Management**, **DSP Integration**, then
**Advertisers**. A DSP has to be set up before any advertiser can be served,
so DSP Integration comes before Advertisers. Within DSP Integration, the
company pages are **Exchange settings**, **Advertiser settings** and
**Shared Targeting Variables**, followed by one page per DSP.

**Targeting vocabulary.** DSP targeting uses the platform's **existing
campaign targeting object**, the same variables as a campaign's Targeting tab
(§6), not a separate registry.
[`../shared/interface-contract.md`](../shared/interface-contract.md) remains
the maintained boundary with the Live Visitor Profile project for anything
else both projects depend on. It is also mirrored inside the live backlog
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
  slot assignment, zones, connect / disconnect, unlink / relink,
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
| **Exchange settings** | Sets up your organisation as the seller of record for its screens. Configurable here: organisation name, domain, seller ID and ad-ops contact email, all required. Once saved and complete, sellers.json is published at https://[domain]/sellers.json and every bid request carries your domain and seller ID in its SupplyChain; until then no DSP is sent bid requests. Not configurable (platform defaults): seller type (Publisher), OpenRTB 2.6, the DOOH object, the OpenOOH venue taxonomy, QPS and bid timeout. |
| **Advertiser settings** | Company-wide advertiser settings, applied to every DSP. Configurable here: Pricing (currency, floor CPM, personalised and interactive multipliers) and List management (advertiser and IAB category whitelists and blacklists). Read-only here: Where these apply (which DSPs use these lists or keep their own; unlink or relink on the DSP's page) and Available Inventory (advertiser-owned slots, set on Display Types). Per-advertiser campaign approval and floor multipliers are on the Advertisers screen. |
| **Shared Targeting Variables** | Variables shared through the API with connected DSPs. Once a variable is enabled for a DSP, that DSP's advertisers can use it in targeting conditions for more advanced campaign targeting; the platform evaluates the condition and never returns the value. They are the same variables as a campaign's Targeting tab. Choose which DSPs may use each one below; default platform variables only in this release. |

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

- **Existing schema, unchanged**: width/height,
  `maximumCampaignsPlayedInRotation` (slot count, -1 = unlimited),
  auto-play/rotation/transition modes, asset fill/positioning, the multi-zone
  flag, the QR Control phantom area (a positioned region outside campaign
  rotation) and the enabled features (In-Store Radio, MIST proximity, AI Agent
  Playback, Vision/AI). How these settings drive playback is unchanged.
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
    out of scope for this release.

  The explanation of the three owners is a tooltip on the **Slot
  assignment** label.
- **Multi-zone layouts** for signage (`zones`), each zone with its own
  playlist and, where sold, its own slots.
- **Venue and screen metadata** (new), needed for DOOH bid requests (§7):
  OpenOOH venue type, geo (lat/long) and store identifier per store, plus
  orientation and loop length per display. Resolution and share of voice are
  already carried by the display type.
- **Layout and saving** follow *Page layout* and *Saving changes* above: the
  form takes the full width beside the display type list, and changes
  (including zone playlists created on demand) are applied with Save
  changes.
- **Tooltips** (see *Help text*) on: *Slot assignment* (the three owners;
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

### Collapsed panels with summaries

The four panels — **Playlist Settings**, **Phantom Zone**, **Enabled
Features** and **Multi-Zone Layout** — are **collapsed by default**. Each
collapsed header shows a one-line summary as small chips, so what is enabled
or changed on a display type is visible without opening anything. Chips for
something enabled or changed are coloured; chips for defaults or "off" are
grey.

| Panel | Summary shows |
|---|---|
| **Playlist Settings** | When the rotation is capped: the slot count (e.g. *3 slots*) and **slot assignment by owner**, one chip each with its icon (e.g. *1 Headquarters*, *1 Advertiser*, *1 Stores*). *n settings changed* when any other playlist setting differs from its default. When nothing differs from the defaults (unlimited rotation, every setting inherited), a single grey *Default settings* chip. Unlimited rotation is the default and gets no chip of its own |
| **Phantom Zone** | Size (e.g. *250×250*) and position — *Default (Bottom Right)* when inherited — or *Not defined* |
| **Enabled Features** | One chip per enabled feature with its icon (*In-Store Radio*, *QR Control*, *MIST*, *AI Agent*, *Vision/AI*), or *None enabled*. Features not available to the company are not shown |
| **Multi-Zone Layout** | Number of zones (e.g. *3 zones*), or *Single zone* |

Opening a panel shows its full settings as before; the summary updates as
settings change.

## 2. Playlist management — edit and delete only

This project adds only two playlist capabilities. Everything else about
playlists, including what plays and when, is handled by the existing platform
and is unchanged.

- **Edit a playlist**: its name and its assignment to display types and
  zones.
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

## 3. Campaign asset approval

Applies to campaigns whose creative comes from outside the retailer: direct
partners submitting through the API (tier 2) and creative arriving through a
DSP (tier 1). Campaigns authored by HQ are unchanged.

### The Advertisers screen — admin only

A new **Advertisers** item in the HQ Admin navigation, placed **directly
below DSP Integration** and **accessible to admin users only**. It is purely
for per-advertiser settings; **campaigns are not approved here.**

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
POST /v1/campaigns                  create a campaign: baseline (required) + targeted versions
POST /v1/campaigns/{id}/assets      upload creative against the campaign
POST /v1/campaigns/{id}/submit      submit for retailer approval
GET  /v1/campaigns/{id}/status      approval status and rejection reason
```

For DSP demand, the creative referenced in a bid response must match an
approved creative ID. A bid carrying an unknown or unapproved creative is
discarded pre-auction, and the creative is placed in the approval queue (or
approved automatically, if the advertiser does not require approval) so it
can compete in later windows.

### Automated checks on upload

Run before a human sees anything; failures are returned to the advertiser
immediately with reasons and never reach the review queue:

- file type, file size and bitrate;
- dimensions and aspect ratio against the target display type's canvas or
  zone;
- duration against the slot's duration;
- a baseline campaign is present;
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
  advertiser that requires approval) returns it to *Awaiting approval*.
  Whether the previously approved version keeps running during re-review is
  open question 38.

### Retailer review — the existing Campaigns section

Approval takes place in Personalisation Hub's **existing Campaigns section**,
with a minimal change to the campaign table:

- **Status filter** on the campaign table with the four statuses above and a
  count on each, so the *Awaiting approval* queue is one click away.
- For a campaign **Awaiting approval**, the **activation status toggle is
  hidden** and an **Approve** icon is shown in its place, with a **Reject**
  action that requires a reason.
- **Once approved, Approve is replaced by the activation toggle.** From that
  point the advertiser can reserve, bid and activate the campaign through the
  API/DSP interface. The retailer can switch it off at any time with the same
  toggle.
- Campaigns approved automatically are marked as such under their status.
- The review view shows the creative rendered on the target display type's
  canvas, the advertiser and partner, a summary of the targeting rules and
  the automated check results.
- **Compliance check for the reviewer**: advertiser artwork must not contain
  price, offer terms or disclosures. A price baked into supplied artwork is a
  compliance breach that an automated dimension check will not catch, which
  is why a human approves.

### Enforcement and audit

- **Approval is enforced server-side**, not only in the UI. A campaign that
  is not *Approved* is excluded from inventory reservation, bidding and
  hand-off to the existing campaign system, and cannot be activated. Playback
  is not changed: the existing platform only plays active campaigns.
- Every decision records who approved or rejected (or that it was approved
  automatically), when, the reason, and the asset version it applies to.

## 4. Pricing — CPM bid floor and multipliers

The currency, the floor and the two campaign-type multipliers are configured
once, company-wide, in **DSP Integration → Advertiser settings → Pricing**;
the floor multiplier is set per advertiser on the **Advertisers** screen.
Every DSP inherits these; nothing pricing-related is set or shown on a DSP's
page. All values are defaults, overridable per retailer.

### Pricing field tooltips

| Field | Tooltip |
|---|---|
| **Pricing** (section) | Multipliers stack: effective floor = floor CPM × personalised × interactive × the advertiser's floor multiplier (set on the Advertisers screen). Bids below the effective floor never win. |
| **Currency** | Used for the floor CPM, every effective floor and billing. Bid requests carry it as the bid floor currency. |
| **Floor price (CPM)** | Cost per thousand assumed views (VAC-d). The minimum any bid must meet; bids below it never win. |
| **Personalised multiplier** | Applied when the visitor is checked in or otherwise identified, so the advert is one-to-one for that individual. Multiplies the floor CPM. |
| **Interactive multiplier** | Applied when the visitor interacts with the campaign and engages with the advertiser on that display, for example by scanning an interactive QR Control campaign. Multiplies the floor CPM. |

### Currency

- **Set once, in Advertiser settings → Pricing.** **Any ISO 4217 currency**
  can be chosen; the selector lists every currency by code and name (for
  example *AUD — Australian Dollar*). Default AUD.
- Applies to the floor CPM, every effective floor and billing. Bid requests
  carry it as the bid floor currency.

### Campaign types for pricing

- **Baseline / Localised**: the creative is the same for everyone in front of
  the screen, including localised versions targeted on **Localisation
  Variables** (§6). An advertiser submits a baseline campaign plus localised
  versions for its slot.
- **Personalised**: the visitor is **checked in or otherwise identified**,
  so the advert is **one-to-one for that individual**; targeted on
  **Personalisation Variables** (§6).
- **Interactive**: the visitor **interacts with the campaign and engages
  with the advertiser on that display**, for example through an interactive
  QR Control campaign, giving a direct connection to the shopper's phone and
  clean in-store attribution. (The pairing mechanics themselves are out of
  scope for this specification.)

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
- **A single base floor CPM** for all displays, irrespective of display type
  and playlist. **Default: 100**, in the company currency. Differentiation
  comes from each slot's VAC-d score (how many assumed views it delivers),
  not from hand-set per-screen prices.
- The floor price is the only price the platform must support for bidding:
  bids below the effective floor (below) do not win.

### Multipliers — stacked on the floor

| Lever | Default | Where it is set | Applies to |
|---|---|---|---|
| Floor CPM | 100 | Advertiser settings → Pricing | Every campaign |
| Personalised multiplier | **1.5** | Advertiser settings → Pricing | Personalised campaigns |
| Interactive multiplier | **3** | Advertiser settings → Pricing | Interactive campaigns |
| Advertiser floor multiplier | **1.0** | Advertisers screen | The whole stacked total, per advertiser |

- **Multipliers stack, they are not capped.** A personalised + interactive
  campaign has an effective floor of 100 × 1.5 × 3 = 450 CPM. Personalised
  surfaces items and reads intent; interactive is a qualified handoff worth
  substantially more.
- **The advertiser floor multiplier** reflects the retailer's relationship
  with that advertiser: for example **0.8** for a preferred supplier, **1.2**
  for a new one. It **scales the whole stacked total**, not just the floor.
  Example: 100 × 1.5 × 3 × 0.8 = 360 CPM. The Advertisers screen shows each
  advertiser's effective base floor (floor × its multiplier).
- **Personalised and interactive are flat per-event multipliers, decoupled
  from VAC-d**, because those tiers collapse a mass audience to one
  identified individual and one attributed action.
- **Localised campaigns price at the floor CPM** (times the advertiser
  multiplier) and trigger neither campaign-type multiplier.

### Billing

- **Dynamic VAC-d**: bill the CPM against realised VAC-d over the billing
  window (share of actual loop time), read from existing playback data.
- Because assets must be approved before they play (§3), the pricing and
  allocation model works over extended periods (daily, weekly or monthly)
  rather than purely in real time.
- **Pre-auction enforcement uses the effective floor CPM** for the campaign's
  type and advertiser: a bid for a personalised or interactive campaign must
  clear the multiplied floor, not the base floor.

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
                                           status per play window across a date range
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
- Assignment: open RTB, whitelist-only, or reserved to a named advertiser.
- **Status per play window**:

| Status | Meaning |
|---|---|
| **Available** | Open for this partner/advertiser to reserve or bid on |
| **Reserved** | Held for a named advertiser (shown as available only to that advertiser) |
| **Sold** | Won or booked for that window |
| **Unavailable** | Store closed, display offline, or otherwise not playable |

- **Pricing** for the requester, in the company currency: the base floor CPM
  and the effective floor CPM for localised, personalised and interactive
  campaigns (§4), including the requester's own advertiser floor multiplier.

### Visibility rules

- A partner or advertiser sees only positions it could actually buy.
  A blacklisted advertiser, or one excluded by a whitelist-only position,
  does not see that position; **permissioning shows up as a smaller list,
  never as a rejected request.**
- Positions reserved to another advertiser are not shown.
- **Availability is a forecast, and targeting changes it.** The forecast
  endpoint takes targeting rules as input, since a campaign gated on a single
  store segment delivers a fraction of an untargeted baseline.

### Available Inventory — the retailer's view

The same positions are shown to the retailer on **Advertisers / Inventory →
Available Inventory**: every advertiser-owned slot across the estate that
connected DSPs can bid on, one row per slot, with columns **Display type**,
**Playlist**, **Slot**, **Position** (with its DSP), **Targeting supported**
and an **Open** link to the display type. There is **no advertisers
column**. Every column carries a filter, as the platform's tables do.

Slots are made available by setting their owner to *Advertiser* on a display
type (explained in the section's tooltip); that part is not editable here.
**Targeting supported** is (Rob, 20 Sep): each slot says which kinds of
campaign it will take — **localised**, **personalised**, **interactive** —
ticked independently, with **localised only** as the default for a slot that
has never been changed. A slot always supports at least one, so the last one
ticked can't be unticked. What a slot supports is part of the contract with
DSPs: it is on the position in `GET /v1/inventory`, and a bid or reservation
for a campaign of any other type is refused with `targeting_not_supported`,
alongside the floor and list checks. Personalised and interactive campaigns
carry their own multipliers on the floor price (§4), so this is also the
control over what a slot can be sold for. **Admin only**: a marketing user
sees the ticks but can't change them.

## 6. DSP integration — the advertiser & DSP interface

How an advertiser finds inventory (§5), takes it and fills it. This is the API
surface of the project and the part a partner actually integrates against.
The retailer configures it under the **DSP Integration** navigation item.

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

### Campaigns and content packages — what an advertiser submits

An advertiser submits a campaign (content package) for its slot: **exactly
one baseline campaign, mandatory**, plus zero or more **targeted versions**,
each with targeting rules and an integer `priority`.

> Named *baseline*, not *default*, on purpose: `campaignCreativeSettings`
> already uses `default` / `selected` / `unselected`. Two unrelated things
> called "default" in one schema is a bug waiting to happen.

**Targeting rules use the existing Targeting tab structure**: each condition
is *data source → variable → operator → value(s)*; conditions within a group
are joined with **OR**, and groups are joined with **AND**. Operators are the
platform's existing ones (for example *includes selected*, *excludes
selected*, *equal*, *greater than*).

**What this project does with them:**

- **Validates** that every condition uses only variables permitted for the
  advertiser's DSP (*Which DSPs may target each variable*, below). A rule
  using a variable that isn't permitted is rejected with the variable named.
  SKU conditions accept a list of SKUs (open question 48 sets the maximum).
- **Stores** the validated campaign and its rules in the **existing campaign
  and targeting structure**, so it is stored and displayed exactly like a
  campaign built in HQ Admin.
- Once approved (§3) and won or reserved (§7), **hands it to the existing
  campaign system** for that slot.

**What this project does not do:** evaluate targeting, decide which version
plays, order or time the rotation, handle fallbacks when nothing matches, or
report on what played. All of that is existing Personalisation Hub behaviour
and is unchanged; the submitted campaign is evaluated, played and reported on
exactly like any other campaign.

### Shared Targeting Variables — Localisation and Personalisation Variables

**Shared Targeting Variables** are the variables shared through the API with
connected DSPs. **Once a variable is enabled for a DSP, that DSP's
advertisers can use it in targeting conditions for more advanced campaign
targeting.** They are the **same variables as a campaign's Targeting tab**.
This release exposes the **default platform variables only**, shown
read-only in **DSP Integration → Shared Targeting Variables** (the page and
its entry in the DSP Integration list carry this name), grouped under two
headings; managing (adding or editing) variables is a later release.

| Group | Variables, in display order |
|---|---|
| **Localisation Variables** | Store Open / Closed; Fixed Store Segments; Variable Store Segments; Display Tag(s); Suburb; Postcode; State; Country; Languages Spoken by Store Staff; Reason for Visit (Aggregate); Computer Vision Gender; Computer Vision Estimated Age |
| **Personalisation Variables** | Age; Gender; Purchase Intent; Visitor Segments; Device Type; Product Holdings; Product Type; Plan Type; Plan Value; Purchase History; Events; SKUs |

- **Localisation Variables** describe the store and the moment: whether the
  store is open or closed, the store record and its segments, display tags,
  the aggregate reason for visit of the people queueing there, and what
  **Vision/AI** detects in front of the display without identifying anyone:
  - **Store Open / Closed**: whether the store is open or closed at the time,
    from its store hours (values *Open*, *Closed*). It sits at the top of the
    list.
  - **Computer Vision Gender**: detected by Vision/AI for the person in front
    of the display (for example Female, Male).
  - **Computer Vision Estimated Age**: an age band estimated by Vision/AI
    (for example 18–24, 25–34, 35–44).

  The two Computer Vision variables only have values on displays with
  Vision/AI enabled; how the existing platform evaluates them is unchanged.
- **Personalisation Variables** describe the identified visitor and come
  from the Visitor API. Three of them need a note:
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
- **Defaults**: Localisation Variables (including the two Computer Vision
  variables) to *All connected DSPs*; **Personalisation Variables to None**.
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
**IAB categories**, in Advertiser settings → List management:

- **Whitelist**: only these may win a position.
- **Blacklist**: these may never win one.

These are the client's lists, not the DSP's. They filter what the exchange may
clear into a position and are **enforced at auction time, not reconciled
afterwards**.

**Defined centrally, adopted by every connected DSP.** A newly connected
partner adopts the advertiser lists automatically.

A partner can **unlink** and keep its own advertiser lists instead, using the
same inheritance rule as display types (§1): the override wins, and a later
edit to the company lists never reaches it.

- **Unlinking copies the inherited lists down**, so a blacklist never silently
  empties.
- **Relinking discards the partner's own lists.** It is destructive and says
  so.

**On a DSP's page:**

- **Centrally managed (adopting):** the lists are **not repeated**. The page
  says the DSP uses the company lists, with a **link to view them in
  Advertiser settings** and an **Unlink and edit** action.
- **Unlinked:** the page shows the DSP's **own** whitelist and blacklist,
  editable, with a **Relink to company lists** action.

**Where these apply** sits directly below List management in Advertiser
settings (above Available Inventory). It shows, per DSP, only **whether it
is adopting the company lists or has its own**, with a link to open that
DSP. It does not summarise list contents (no allowed/blocked counts); the
full lists are visible directly above, or on the DSP's page when unlinked. A
DSP with its own lists has a tooltip saying edits to the company lists don't
reach it until it is relinked.

An advertiser or category cannot sit on both lists; adding it to one removes
it from the other. The advertiser lists take **free text as well as known
seats**, since a DSP's full advertiser universe is not enumerable from our
side. Seats pulled on connect are offered as shortcuts, not as the limit.

**The blacklist is not a mode — it always subtracts.** It applies to every
outcome on that partner and no position can opt out of it. The whitelist is
the part a position chooses to use. (Both points are in the *List
management* tooltip.)

A position's **Assigned to** picker offers, for a DSP partner:

| Option | What sells |
|---|---|
| RTB bidding — any except *n* blocked | Everything the partner brings, minus the blacklist |
| Whitelist only (*n*) | Only advertisers on the whitelist (which cannot contain a blocked one) |
| A named advertiser | Reserved to that one seat |

Only for DSP partners. Direct/house has no auction to filter, so a position
there names its advertiser outright.

- **A blocked advertiser is withdrawn from the picker.**
- **Blocking an advertiser reaches positions already sold.** A position
  reserved to a name that is then blacklisted is flagged in place as unable to
  fill, and left selected so it does not change under whoever set it.
- Re-pointing a position at a different partner drops it back to open bidding
  rather than carrying a filter the new partner cannot apply.

### Campaign playback analytics — existing system

Campaign playback analytics (what played, where, when and why, at display
and store level, for the retailer and for advertisers) are provided by the
**existing Personalisation Hub analytics** and are **not changed by this
project**. Campaigns handed over from DSPs appear there like any other
campaign. This project builds no analytics, reports, dashboards or delivery
API.

### Selling a play window, not an impression

Per-impression RTB does not suit signage, where creatives are often video and
must be on the player before they can play. The auction is therefore for a
**play window** (assume 24 hours), cleared ahead of the window. The winner
holds the advertiser slot for that window: its approved campaign is handed to
the existing campaign system, which **distributes and plays it as it does
today**. Distribution, caching and playback are unchanged.

### API surface

Tier 1 follows each DSP's own specification. The tier-2 shape:

```
GET  /v1/inventory                 sellable positions and status (§5)
GET  /v1/inventory/{id}/availability   status per play window
POST /v1/inventory/forecast        projected assumed views for a spec + targeting
POST /v1/reservations              reserve, or bid (CPM) for a play window (Approved campaigns only)
GET  /v1/targeting/attributes      the shared targeting variables THIS partner may target
POST /v1/campaigns                 baseline (required) + targeted versions, rules validated
POST /v1/campaigns/{id}/assets     creative upload and automated validation
POST /v1/campaigns/{id}/submit     submit for retailer approval (§3)
GET  /v1/campaigns/{id}/status     approval status
```

Playback analytics are not part of this API; they come from the existing
system.

```json
{
  "reservationId": "res_8812",
  "campaigns": [
    { "role": "baseline", "assetSet": "as_brand_evergreen" },
    { "role": "targeted", "priority": 10, "assetSet": "as_metro_commuter",
      "rules": [
        [{ "source": "store", "variable": "fixed_store_segments", "op": "includes_selected", "values": ["Metro"] }],
        [{ "source": "store", "variable": "store_open_closed", "op": "equal", "values": ["Open"] }]
      ] },
    { "role": "targeted", "priority": 20, "assetSet": "as_replenish",
      "rules": [
        [{ "source": "visitor", "variable": "purchase_intent", "op": "equal", "values": ["replenish"] }]
      ] },
    { "role": "targeted", "priority": 30, "assetSet": "as_viewed_before",
      "rules": [
        [{ "source": "visitor", "variable": "skus", "op": "includes_selected", "values": ["SKU-10234", "SKU-55871"] }]
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
contents, the OpenRTB version (2.6), the DOOH object, the OpenOOH venue
taxonomy, the impression multiplier field, QPS ceiling and bid timeout.

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
   required, and nothing else. QPS ceiling (500) and bid timeout (300 ms) are
   platform defaults and are not shown or editable in this release.
5. **Advertiser whitelist / blacklist**: a link to the company lists when
   centrally managed, or the DSP's own lists when unlinked (§6).
6. **Save changes / Cancel**, always visible at the bottom (see *Saving
   changes*).

No advertiser ID is taken on the connection: the retailer sells to many
advertisers through each DSP, so the connection is not tied to one. The
DSP's advertisers are listed on the **Advertisers** screen, not on its page.
Currency, floor CPM, multipliers, category lists and targeting permissions
are set elsewhere and are neither set nor repeated on the DSP's page. Deal IDs
are deferred to a later release (open question 45).

### Which side each named platform sits on

| Platform | Side | What it means for us |
|---|---|---|
| **The Trade Desk** | **DSP — demand** | The largest independent DSP and a major DOOH buyer. A buyer that bids into our exchange |
| **Display & Video 360** | **DSP — demand** | Google's buy side. A demand partner (§6) |
| **Google Ad Manager** | **SSP / ad server — supply** | Google's sell side. What we are building an equivalent of, not something we connect into |

### What being the SSP means we build

1. **Bid request construction and the bidder integration.** An OpenRTB bid
   request per sellable position (§5), sent to every connected bidder within
   the platform's default QPS ceiling and timeout, then the auction over the
   responses.
2. **The auction.** The effective floor CPM and currency (§4), sent as the bid
   floor on the request, plus permitted categories, the advertiser blocklist
   and creative approval (§3), all applied **before** a bid can win. Open
   auction only in this release.
3. **Creative retrieval and hand-off.** The winning creative is fetched,
   confirmed approved and validated against the display type's canvas, then
   handed to the **existing campaign system** for that slot and window.
   Distribution to players, caching, playback and playback analytics are the
   existing platform's and are unchanged.
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
  above), and a QPS ceiling the exchange must respect (a platform default in
  this release).

The Trade Desk is the largest buyer of programmatic DOOH by spend and comes
third. That is defensible on integration effort, but the deepest demand pool
arrives last and open-auction fill will look thin until it does.

### What a DOOH bid request carries

- **No user identity.** A bid request describes a *venue and a moment*, not a
  person. Personalisation Variables and Computer Vision variables (§6) never
  cross into the exchange.
- **Venue taxonomy and geo** (§1).
- **Screen and loop context**: resolution, aspect, orientation, slot duration,
  loop length and share of voice. `maximumCampaignsPlayedInRotation` *is* the
  share-of-voice denominator.
- **Bid floor**: the effective floor CPM, in the company currency (§4).
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
closed, loop cut short) are not billed. This project **reads** that data for
billing only; it does not change how it is written or add any reporting on
it. As the exchange, disputes resolve against this data.

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
  id, touchPoint,                  // Digital Signage | Kiosk
  name, description, image,
  displayCanvasSize: { width, height },
  backgroundColor,
  defaultPlaylistId,
  playlistSettings: {              // null = "Default (…)", inherit
    assetPosition, assetFill,
    maximumCampaignsPlayedInRotation,   // -1 = Unlimited; n = slot count = share-of-voice denominator
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
  multiZone: { enabled, zones: [{ id, name, x, y, width, height, playlistId }] },
  phExtensions: {                  // THIS PROJECT's additions
    slots: [{ label, owner, partnerId, advertiser, listMode, storeScope, quota }],   // source of inventory (§5)
    venue: { openOohVenueType, orientation, loopLengthSec }
  }
}
```

- **`null` means inherit.** An inherited value renders as "Default (…)", with
  an "N overrides / all inherited" badge per panel.
- `phExtensions.slots` is sized to `maximumCampaignsPlayedInRotation`. It
  records who may fill each slot; it does not affect how the slot plays.
- The collapsed-panel summaries (§1) are derived from these fields; nothing
  extra is stored.
- Store-level geo (lat/long, store identifier) belongs on the store record;
  where it lives is open question 35.

### Display (existing, read only here)

```
display: { id, name, store, displayTypeId, … }   // Displays & Devices
```

Used only for the delete check in §1: a display type with any display whose
`displayTypeId` matches cannot be deleted.

### Playlist

The existing playlist, item and scene records, and how they play, are
unchanged by this project. Loop length is read for inventory display and
VAC-d billing only.

### Campaign (additions to the existing campaign record)

```
campaign: { …existing fields,
            source: hq | api | dsp,
            advertiserId, partnerId,
            pricingType: baseline | localised | personalised | interactive,
            status: draft | awaiting_approval | approved | rejected,   // shown as Draft / Awaiting approval / Approved / Rejected
            approval: { mode: manual | auto,
                        assetVersion, submittedAt,
                        reviewedBy, reviewedAt, reason,
                        checks: [{ name, passed, detail }] },
            activation: { enabled } }         // only settable once status = approved
```

Targeting rules use the campaign's existing targeting structure (AND groups
of OR conditions, each *source → variable → operator → values*), evaluated
by the existing platform. HQ-authored campaigns (`source: hq`) skip approval.

### Sell side

`partner`:
```
{ id, provider, name, status: draft | connected | error,
  lastSync,                               // last connection result, e.g. the DSP's error reason
  mode: test | live,                      // live only when connected and the bidder integration is complete
  creds: { …per DSP, see §7 },            // no advertiser ID
  bidder: { bidderEndpoint, seatIds },    // QPS and timeout are platform defaults (500 / 300 ms)
  seats: [{ id, name }],                  // advertisers pulled on connect; listed on the Advertisers screen
  listsLinked, allowList, blockList }     // own advertiser lists when unlinked
```

Company-level:

- **Advertiser settings**: `currency` (any ISO 4217 code; default `AUD`),
  `floorCpm`, `personalisedMultiplier`, `interactiveMultiplier` (defaults
  100 / 1.5 / 3), `audienceScoring` (MOVE/VAC-d inputs), advertiser and
  IAB-category whitelists and blacklists.
- **Advertisers** (admin only):
  `advertiserSettings: { [advertiser]: { approvalRequired, floorMultiplier } }`
  (defaults `true` / 1.0).
- **Shared targeting variables**: the platform's default variables, grouped
  as Localisation Variables and Personalisation Variables, each with example
  values (or a fixed tooltip text) for its tooltip, read-only in this
  release, plus `variableAccess: { [variableKey]: "all" | [partnerId] }`:
  `"all"` means every connected DSP (including later ones), a list names
  individual DSPs, `[]` means none. Unset keys take the defaults in §6.
- **Exchange**: `client {name, domain, contactEmail}` (the seller of record)
  and `sellersJson {sellerId}`. Seller type, confidentiality, `supplyChain`,
  OpenRTB options, QPS ceiling and bid timeout are fixed platform defaults.

Unsaved edits are held client-side only; the records above (display types
and playlists included) change only when **Save changes** is used. Deletes
are the exception: a confirmed delete applies immediately.

The `reservation` and `inventory position` records are spec only in this
release. There is no delivery or analytics record: playback analytics are
the existing system's.

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
- **Collapsed panels with summaries**: Playlist Settings, Phantom Zone,
  Enabled Features and Multi-Zone Layout collapsed by default, each header
  showing chips for what is enabled or changed (slot count and slot
  assignment by owner, or *Default settings*; phantom size/position; enabled
  features; zone count). *(Display Types)*
- **Slot ownership & quota editor**: HQ / named advertiser / RTB /
  whitelist-only / store quota. *(Display Types → Playlist Settings → Slot assignment)*
- **Multi-zone layout designer** for signage. *(Display Types → Multi-Zone Layout)*
- **Venue and screen metadata** per store and display. *(spec only)*

### Playlist management

- **Edit a playlist** (name, assignment to display types and zones).
  *(Playlist Management)*
- **Delete a playlist** through a confirmation dialog with Cancel; when the
  playlist is a default or zone playlist, the dialog lists where it is
  assigned and Delete is disabled. *(Playlist Management)*

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

### Advertisers (admin only)

- **Advertisers screen**, admin users only, directly below DSP Integration in
  the navigation: every advertiser across all DSPs, with a **Campaign
  approval** toggle (Required / Not required, default Required) and a
  **floor multiplier** (default 1.0) with the effective floor shown in the
  company currency, and a tooltip on each column. No campaign approval takes
  place here. *(Advertisers)*

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

### Pricing

- **Company-wide pricing**: currency (any ISO 4217 currency, listed by code
  and name), floor CPM, personalised multiplier, interactive multiplier,
  inherited by every DSP, each with the tooltip given in §4.
  *(DSP Integration → Advertiser settings → Pricing)*
- **Advertiser floor multiplier** per advertiser. *(Advertisers)*
- **Audience scoring framework** (MOVE/VAC-d) the retailer populates, automated
  where cameras are connected. *(spec only)*
- **Effective floor CPM per pricing type and advertiser**, applied
  pre-auction and sent as the bid floor with its currency. *(spec only)*
- **Dynamic VAC-d billing** from existing playback data. *(spec only)*

### Inventory

- **Inventory API**: list, detail, availability per play window and
  forecast, scoped to what the requester could buy. *(spec only)*
- **Available Inventory**: every advertiser-owned slot across the estate
  that connected DSPs can bid on (Display type, Playlist, Slot, Position,
  Targeting supported, and an Open link), with no advertisers column and a
  filter on every column. *(Advertisers / Inventory → Available Inventory)*
- **Targeting supported per slot**: which kinds of campaign a slot takes —
  localised, personalised, interactive — localised only by default, set by
  an admin, published on the position and enforced on every bid.
  *(Advertisers / Inventory → Available Inventory)*

### Shared targeting variables

- **Shared Targeting Variables page**: the variables shared through the API
  with connected DSPs, whose advertisers can use them once enabled; the
  default platform variables, read-only, under two headings, **Localisation
  Variables** (Store Open / Closed first, and including Reason for Visit
  (Aggregate), Computer Vision Gender and Computer Vision Estimated Age) and
  **Personalisation Variables** (Age, Gender, Purchase Intent, Visitor
  Segments, Device Type, then the rest, ending with Events and SKUs), each a
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

- **Exchange settings**: four seller-of-record fields and the published
  `sellers.json` status. *(DSP Integration → Exchange settings)*
- **Issues at the top of each DSP page**: connection error with the DSP's
  reason, missing credentials, and missing bidder fields; a single
  confirmation when there are none. *(DSP Integration → partner)*
- **DSP connection**: minimum credentials per DSP, connect / re-test /
  disconnect. *(DSP Integration → partner)*
- **Bidder integration**: endpoint and seat IDs only. *(DSP Integration → partner)*
- **Test / Live mode** per DSP. *(DSP Integration → partner → Mode)*
- **Company advertiser and category lists**, with the **Where these apply**
  adoption view (adopting or own lists, no counts) directly below them.
  *(DSP Integration → Advertiser settings → List management, Where these apply)*
- **Advertiser lists on a DSP's page**: a link to the company lists when
  centrally managed (with Unlink and edit); the DSP's own editable lists when
  unlinked (with Relink). *(DSP Integration → partner → Advertiser whitelist / blacklist)*
- **Campaign and content package submission**: one baseline plus prioritised
  targeted versions, validated and stored in the existing campaign
  structure. *(spec only)*
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
27. **Play-window length.** 24 hours is the working assumption; the real
    figure is a commercial decision crossed with how long the existing
    platform takes to distribute assets across the estate.
29. **Partial-estate delivery.** If a won campaign only played on part of the
    estate in its window (per existing playback data), what was sold and how
    is it billed? Needs a guarantee model.
30. **Minimum-volume floor on partner analytics.** *Moved out of this
    project:* campaign playback analytics, including what advertisers see,
    are the existing system's.
32. **Supply architecture.** *Resolved:* PH is the SSP; onboarding order
    DV360 → Amazon Ads DSP → The Trade Desk.
33. **Seller of record.** *Resolved:* the client running the instance.
34. **Is a sensor-derived audience multiplier tradeable**, or only
    reportable?
35. **Venue and geo metadata has no home yet** on the store record.
36. **Transaction association** (linking transactions to campaign plays).
    *Moved out of this project:* it belongs with the existing playback
    analytics.
37. **Waiving approval for trusted advertisers.** *Resolved* (§3): the
    per-advertiser Campaign approval toggle.
38. **Re-approval behaviour.** When an approved campaign is changed, does the
    previously approved version keep running until the new one is approved,
    or does the campaign stop?
39. **Who can approve.** Which HQ Admin role holds the approve permission in
    the Campaigns section, and is store-level approval ever needed?
40. **DSP creative audits.** DV360 and The Trade Desk run their own creative
    audits. Does retailer approval run in addition, and can a retailer
    pre-approve by creative ID?
41. **Advertiser notification.** Status polling only, or a webhook on
    approve/reject?
42. **Floor unit.** *Resolved* (§4): the floor is a CPM, a cost per thousand
    assumed views, which is the unit DSPs bid in.
43. **Variable management** (adding and editing targeting variables) is
    deferred to a later release; which variables should be manageable first?
44. **Environmental attributes** (weather, stock) are deferred to a later
    release; when they return, are they new data sources or variable store
    segments?
45. **Deals.** Preferred and programmatic-guaranteed deal IDs are deferred;
    this release is open auction only. When they return, are deals set per
    DSP or company-wide, and priced against the same floor?
46. **Per-DSP bidder tuning.** QPS ceiling and bid timeout are platform
    defaults (500 / 300 ms) in this release. Do any DSPs' onboarding
    requirements force per-DSP values, and if so where are they set?
47. **Deleting a display type with live advertiser positions.** Deleting a
    display type removes its advertiser slots from the inventory. Should the
    delete also be blocked while any of those positions is reserved or sold
    for a future play window?
48. **SKU list length.** What is the maximum number of SKUs one targeting
    condition can list (working default 100)? How far back the existing
    platform looks for viewed SKUs and Events is existing behaviour.
49. **Computer Vision variables and DSPs.** Computer Vision Gender and
    Estimated Age sit under Localisation Variables, so they default to *All
    connected DSPs*. Should they instead default to *None*, like
    Personalisation Variables, given they describe the person in front of
    the screen?
