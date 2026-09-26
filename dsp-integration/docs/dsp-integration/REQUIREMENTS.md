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
4. **Pricing**: the currency, the CPM bid floor, audience scoring, a
   personalised multiplier, a cost per engagement, and a floor multiplier
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

**Navigation.** The HQ Admin navigation items for this project, in order
(Rob, 24 Sep 2026): **Display Types**, **Playlist Management**, **Campaign
Status**, **Advertisers / Inventory**, then **DSP Integration** at the
bottom. The pages used day to day come first; DSP Integration, set up once
per DSP, comes last. **Campaign Status** and **Advertisers / Inventory**
show only while the retailer has DSP integration switched on (§7, *The DSP
integration switch*). Within DSP Integration, the
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
| **Exchange settings** | Sets up your organisation as the seller of record for its screens. Configurable here: organisation name, domain, seller ID and ad-ops contact email, all required. Once saved and complete, sellers.json is published at https://[domain]/sellers.json and every bid request carries your domain and seller ID in its SupplyChain; until then no DSP is sent bid requests. Not configurable (platform defaults): seller type (Publisher), the DOOH object, the OpenOOH venue taxonomy, QPS and bid timeout. Bid requests use OpenRTB 2.6 as the minimum supported version for programmatic DOOH; the exchange is designed to adopt 2.7, 2.8 and later versions per DSP as the market moves. |
| **Advertiser settings** | Company-wide advertiser settings, applied to every DSP. Configurable here: Pricing (currency, floor CPM, the personalised multiplier and the interactive cost per engagement), the Auction schedule (when bidding opens, play-window length, auction cutoff) and List management (advertiser and IAB category whitelists and blacklists). Read-only here: Where these apply (which DSPs use these lists or keep their own; unlink or relink on the DSP's page). Per-advertiser campaign approval and floor multipliers, and the inventory advertisers can buy, are on Advertisers / Inventory. |
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

  **A slot is a playlist position** (ticket "Available Inventory: Max
  campaigns column + slot playlist statement"): assigning an advertiser a
  slot assigns them that fixed position in the display type's one playlist
  rotation, of which only one campaign plays at a time — the highest-priority
  version resolving on available data (the mandatory default layer, or a
  localised/personalised upsell that resolves ahead of it, per §6). The
  playlist is retained per slot; this is the already-intended §6 model,
  stated explicitly here as part of that ticket's spec clarification.

  The explanation of the three owners is a tooltip on the **Slot
  assignment** label.

  **The slot editor sets the label and the owner, nothing else** (Rob,
  20 Sep). Who a sellable position is assigned to — DSPs, named advertisers,
  the whitelist — is managed on *Advertisers / Inventory* (§5), and appears
  here read-only on the slot card. A Stores slot takes the default scope
  (*Store staff*); its scope is no longer editable anywhere in this build.
  Changing a slot's owner away from *Advertiser* drops the assignment and
  the supported targeting with it, since the position is no longer sellable;
  changing anything else keeps them.
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

### Advertisers / Inventory

A new **Advertisers / Inventory** item in the HQ Admin navigation, placed
**below Campaign Status and above DSP Integration** (Rob, 24 Sep 2026). It carries per-advertiser settings and,
below them, the inventory those advertisers can buy (§5); **campaigns are
not approved here.**

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
```

For DSP demand, the creative referenced in a bid response must match an
approved creative ID. A bid carrying an unknown or unapproved creative is
discarded pre-auction, and the creative is placed in the approval queue (or
approved automatically, if the advertiser does not require approval) so it
can compete in later windows.

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
- dimensions and aspect ratio against the target display type's canvas or
  zone;
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
  advertiser that requires approval) returns it to *Awaiting approval*.
  Whether the previously approved version keeps running during re-review is
  open question 38.
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
  POC's own placeholder detail page only until then.)
- **One row is one playlist, not one row per campaign** (ticket "Campaign
  Status: Playlist name column, submitted count, localised/personalised
  targeting columns, Advertiser first"): an advertiser submits exactly one
  content package per slot — the mandatory default layer plus its optional
  localised/personalised upsells (§6 "Campaigns and content packages") —
  stored on the one existing campaign record, so the table's row is that
  record, not one row per layer. **Column order, left to right: Advertiser,
  Schedule, Playlist name, No. of campaigns, Localised variables,
  Personalised variables** (Status, DSP and the activation toggle keep
  their existing places relative to these). **Playlist name** replaces
  *Name* — the submission's own name — and its click-through is the
  campaign-name link above, filtered to this playlist: because every layer
  of the submission already lives on the one record, opening it already
  shows every campaign the advertiser submitted for this slot, so this is
  not a second, separate link target. **No. of campaigns** is the layer
  count for that one submission — the mandatory default plus however many
  targeted versions — checked against the slot's own Max campaigns cap at
  submission time (§5, ticket "Available Inventory: Max campaigns column +
  slot playlist statement"), not recomputed on this table.
- **Localised variables / Personalised variables columns**: a high-level
  summary in the cell — the deduped Shared Targeting Variable names (§6
  "Shared Targeting Variables") targeted across that playlist's localised
  (respectively personalised) layer(s), or an em dash when that submission
  has none. **On hover, the exact targeting rules behind it** — the
  specific variable, operator and values from every layer of that pricing
  type on this playlist, consolidated into one view, not shown per layer
  separately.
- For a campaign **Awaiting approval**, the **activation status toggle is
  hidden** and a **consolidated segmented Approve/Reject control** is shown
  in its place (ticket, 26 Sep) — one pill, not two loose actions: left half
  Accept (tick), right half Reject (cross), with a divider between them and
  a colour-coded hover/press state (green left, red right; neutral at
  rest) so intent is clear before committing. Accepting the left half
  approves directly; the right half still requires a reason — pressing it
  opens the reject-with-reason popover and the rejection only commits once
  a reason is entered and confirmed there, exactly as before. Presentation
  only: no change to who may approve/reject or to the reason requirement.
  The campaign detail page (linked from the playlist name, above) shows the
  same control next to its own status bar, whose activation toggle is kept
  visible but **disabled** while Awaiting approval, so the table and the
  detail page read identically.
- **Once approved, the segmented control is replaced by the activation
  toggle** — in the table and, with the status bar's toggle switching from
  disabled to live, on the detail page too. From that point the advertiser
  can reserve, bid and activate the campaign through the API/DSP interface.
  The retailer can switch it off at any time with the same toggle.
- Campaigns approved automatically are marked as such under their status.
- The review view shows the creative rendered on the target display type's
  canvas, the advertiser and partner, a summary of the targeting rules and
  the automated check results.
- **Compliance check for the reviewer**: advertiser artwork must not contain
  price, offer terms or disclosures. A price baked into supplied artwork is a
  compliance breach that an automated dimension check will not catch, which
  is why a human approves.

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
`approve()`, never from `submit()`'s auto-approve path) — a building block
a submission flow can call before deciding whether to route a resubmitted
asset back into the review queue. **Not yet wired into the POC's own
upload/submit endpoints** (`apps/api/src/routes/partner/campaigns.ts`):
today every resubmission still re-runs its automated checks and, if the
advertiser requires approval, re-enters the queue regardless of whether an
individual asset was unchanged — the service-level primitive above is
ready for that wiring, which is the natural next step.

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

## 4. Pricing — CPM bid floor and multipliers

The currency, the floor and the two campaign-type multipliers are configured
once, company-wide, in **DSP Integration → Advertiser settings → Pricing**;
the floor multiplier is set per advertiser on the **Advertisers** screen.
Every DSP inherits these; nothing pricing-related is set or shown on a DSP's
page. All values are defaults, overridable per retailer.

### Pricing field tooltips

| Field | Tooltip |
|---|---|
| **Pricing** (section) | Effective floor = floor CPM × the personalised multiplier (personalised campaigns) × the advertiser's floor multiplier (set on Advertisers / Inventory). Bids below it never win. An interactive campaign clears the same floor and pays the cost per engagement on top. |
| **Currency** | Used for the floor CPM, every effective floor and billing. Bid requests carry it as the bid floor currency. |
| **Floor price (CPM)** | Cost per thousand assumed views (VAC-d). The minimum any bid must meet; bids below it never win. |
| **Personalised multiplier** | Applied when the visitor is checked in or otherwise identified, so the advert is one-to-one for that individual. It multiplies the **floor price**: at 1.5, a floor of 100 becomes 150 CPM for a personalised campaign, and the advertiser's own floor multiplier scales that again. |
| **Interactive cost per engagement** | What an advertiser pays each time someone engages with an interactive campaign — scanning its QR Control code to carry on with the brand on their own phone. Charged per engagement, **on top of the CPM**: an interactive campaign still clears the floor price (or the personalised floor) for its plays, and adds this for each scan. The advertiser's floor multiplier does not scale it. Set it to 0 to leave engagements unpriced. |

**A tooltip explains its own field and relates it to the others; it does not
repeat them** (Rob, 20 Sep). The floor price tooltip carries the VAC-d
worked example; the personalised and interactive tooltips refer to the floor
rather than restating how it is arrived at.

### Currency

- **Set once, in Advertiser settings → Pricing.** **Any ISO 4217 currency**
  can be chosen; the selector lists every currency by code and name (for
  example *AUD — Australian Dollar*). Default AUD.
- Applies to the floor CPM, every effective floor and billing. Bid requests
  carry it as the bid floor currency.

### Campaign types for pricing

- **Default / Localised**: the creative is the same for everyone in front of
  the screen, including localised versions targeted on **Localisation
  Variables** (§6). An advertiser submits a mandatory default campaign plus
  optional localised versions for its slot.
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

### The levers on the floor

| Lever | Default | Where it is set | Applies to |
|---|---|---|---|
| Floor CPM | 100 | Advertiser settings → Pricing | Every campaign |
| Personalised multiplier | **1.5** | Advertiser settings → Pricing | Personalised campaigns |
| Interactive cost per engagement | **0.50** | Advertiser settings → Pricing | Each engagement with an interactive campaign |
| Advertiser floor multiplier | **1.0** | Advertisers / Inventory | The floor, per advertiser |

- **Interactive is a price per engagement, not a multiplier** (Rob,
  20 Sep). The point of an interactive campaign is to get someone to scan
  the QR code and carry on with the brand on their own phone, so it is
  charged **per engagement, on top of the CPM**: the campaign clears the
  ordinary floor (or the personalised floor) for its plays, and adds the fee
  for each scan. It is an amount in the company currency, to the cent, and
  **the advertiser's floor multiplier does not scale it**. 0 leaves
  engagements unpriced.
- **The advertiser floor multiplier** reflects the retailer's relationship
  with that advertiser: for example **0.8** for a preferred supplier, **1.2**
  for a new one. Example: 100 × 1.5 × 0.8 = 120 CPM for a personalised
  campaign. Advertisers / Inventory shows each advertiser's effective base
  floor (floor × its multiplier).
- **Personalised is a flat multiplier, decoupled from VAC-d**, because that
  tier collapses a mass audience to one identified individual.
- **Localised campaigns price at the floor CPM** (times the advertiser
  multiplier) and trigger neither.
- **Engagements are not billed in this build.** The stand-in playback data
  has plays, not scans, so the fee is published to DSPs on the position
  (`costPerEngagement`) and priced here, but billing still bills the CPM
  against realised VAC-d. Wiring it up needs an engagement count from the
  platform.

### Billing

- **Dynamic VAC-d**: bill the CPM against realised VAC-d over the billing
  window (share of actual loop time), read from existing playback data.
- Because assets must be approved before they play (§3), the pricing and
  allocation model works over extended periods (daily, weekly or monthly)
  rather than purely in real time.
- **Private auctions using the two-period model bill the same way, at a
  fixed rate** (23 Sep 2026 — see §5 "Private auctions (buyers lists)" for
  the two-period model itself). A CPM is a rate, not a fixed sum: the brand
  wins at a bid CPM that then holds for the whole delivery term (no daily
  re-auction), and each billing unit (the slot's own granularity — default
  one day) is billed at that agreed CPM against the realised VAC-d for
  that unit. The term total is simply the sum of its billing units'
  settlements at the one agreed rate. This sits between the two other
  risk profiles: **reserved** is a fixed premium with the brand carrying
  full delivery risk; **open real-time** locks nothing, re-clearing price
  every auction; a **private auction using the two-period model** locks
  the rate but leaves volume variable — the brand pays for actual views,
  not a guaranteed number, but never re-bids for the term. Mechanically
  this needs no separate billing pipeline: the exchange (§7) books every
  later play window in the term as its own reservation at the locked CPM,
  and each is billed exactly as any other reservation already is.
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
- Assignment: open RTB, whitelist-only, reserved to a named advertiser, or a
  private auction (deal) restricted to a buyers list's invited buyers (see
  *Private auctions (buyers lists)* below).
- **Status per play window**:

| Status | Meaning |
|---|---|
| **Available** | Open for this partner/advertiser to reserve or bid on |
| **Reserved** | Held for a named advertiser (shown as available only to that advertiser) |
| **Sold** | Won or booked for that window, by the one advertiser holding it |
| **Unavailable** | Store closed, display offline, or otherwise not playable |

A position's status is exactly one of these — no **Part-sold** status:
a slot goes to a single advertiser, whose submission carries a mandatory
default layer plus optional localised/personalised upsells, not several
advertisers splitting the position's capacity (§6 "Campaigns and content
packages" has the retired part-sold model and why it never shipped past
this document).

- **Pricing** for the requester, in the company currency: the base floor CPM
  and the effective floor CPM for localised, personalised and interactive
  campaigns (§4), including the requester's own advertiser floor multiplier.
- **Reserve price** (decision, Rob, 22 Sep; real inheritance, 22 Sep): a CPM
  premium at which this position can be reserved in advance of the open
  auction — a retailer lets an advertiser pay a premium up front to
  guarantee the slot for a window, taking it out of the open auction for
  that window (the advertiser then carries the delivery risk, not billed
  against realised dynamic VAC-d; see §4 Billing). `null` when no reserve is
  set. Genuine §1 configuration inheritance, not a copy action: a display
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
  inheritance the ticket asked for. **Published on the position, resolved;
  not yet wired to a booking flow** (the prototype ships the setting, the
  inheritance and the publishing only, per the scope note on the ticket
  that added it — see open question 52).

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
**Playlist**, **Slot**, **Position**, **Assigned to**, **Targeting
supported**, **Reserve price**, **Max campaigns**, **Billing unit** and an
**Open** link to the display type. There is **no advertisers column**.
Every column carries a filter, as the platform's tables do.

Slots are made available by setting their owner to *Advertiser* on a display
type (explained in the section's tooltip); that part is not editable here.
Three fields are: **Assigned to** (above), **Targeting supported** — each a
multi-select that drops a pill per choice into the cell — and **Reserve
price**, a CPM input (blank = following the display type's default, or no
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
sees them but can't change them.

**Interactive needs QR Control** (Rob, 20 Sep). There is nothing for a
visitor to engage with otherwise, so the **Display type** column flags the
display types that have QR Control enabled, and on a slot whose display type
does not, *Interactive* is greyed out in the picker and reads **"QR Control
required to support an interactive engagement"**. The API refuses it too.

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
- **Invited buyers**: a list of entries, each an identifier type plus a
  value. The identifier type is **flexible per retailer**, not hard-wired to
  one scheme — a PH brand entity (the advertiser's name, matched
  case-insensitively, same as the existing advertiser lists), a DSP's own
  seat ID (matched exactly against the seat record pulled on connect), or
  another identifier a retailer uses elsewhere. `other` is recorded on the
  list for reference but has no automated match in this build — the DSP
  side of that identifier scheme isn't something this POC's stand-ins model.
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
  additive, not a breaking change to every existing deal).

**Explicitly not on the buyers list** — each already has its own home, and
duplicating it per deal would let one drift from the other:

- **Floor** is never set on the deal. It is inherited from the position
  (§4, driven by the display type/slot's own reserve and floor), the same as
  every other assignment mode. Rationale: the floor is the retailer's
  opportunity cost: if no invited brand clears it, the retailer shows its
  own mandatory default campaign rather than sell too cheap — a private
  auction that clears nothing falls through exactly the way an open auction
  with no qualifying bid already does.
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
seat that is not one of the deal's invited buyers, or that arrives outside
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
clearing (`exchange/auction.ts`'s `bookLockedTermWindow`). Each such window
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
"Reserve price" above; platform default 24 hours/one day when neither is
set): the granularity a CPM is quoted and charged against, surfaced in
Available Inventory next to Reserve price. Informational in this build —
dynamic VAC-d billing still runs per play window (Advertiser settings →
Auction schedule); it names what that window length is expected to equal
for a private-auction slot using the two-period model, rather than driving
a separate billing cadence.

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
  SKU conditions accept a list of SKUs (open question 48 sets the maximum).
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
| **Localisation Variables** | Store Open / Closed; Fixed Store Segments; Variable Store Segments; Display Tag(s); Suburb; Postcode; State; Country; Reason for Visit (Aggregate); Computer Vision Gender; Computer Vision Estimated Age |
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

A position's **Assigned to** control is one multi-select on *Advertisers /
Inventory* (Rob, 20 Sep), adding a pill per choice:

| Pill | What sells |
|---|---|
| Nothing chosen — *All DSPs* | Every connected DSP may bid, minus the blacklist |
| One or more **DSPs** | Only those DSPs may bid, minus the blacklist |
| One or more **advertisers** | Reserved to those seats; each one's DSP is added automatically |
| **Whitelist only** | Only advertisers on the whitelist (which cannot contain a blocked one) |

Advertisers and *Whitelist only* are mutually exclusive — a position is
either held for named advertisers or open to the whitelist — and the newer
choice wins in the picker.

- **A blocked advertiser is withdrawn from the picker.**
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
POST /v1/campaigns                 default (required) + targeted versions, rules validated
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
    { "role": "default", "assetSet": "as_brand_evergreen" },
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

### The DSP integration switch (Rob, 24 Sep 2026)

At the top of **Exchange settings**, a master toggle row, **Enable DSP
Integration**, like HQ Admin's switches for its other features. It lets a
retailer switch DSP integration on and off.

- **Off the first time a retailer lands on DSP Integration.** Switched off,
  the switch is all Exchange settings shows, and the section's list shows
  only Exchange settings.
- **Switching on** shows the seller-of-record fields below. Once they are
  saved and complete, `sellers.json` is published and the rest of the
  section appears: Advertiser settings, Shared Targeting Variables and the
  DSP pages. Until then, a link to one of those pages opens Exchange
  settings instead.
- **Like every toggle in the section, it is an unsaved change until Save
  changes.** Switching it off before saving also drops unsaved edits to the
  fields it hides.
- **While it is off:**
  - Campaign Status and Advertisers / Inventory are hidden from the
    navigation, and a link to either (or to the booking schedule) opens
    the first page instead. DSP Integration stays, because the switch is
    there.
  - No DSP is sent bid requests; the scheduled auction doesn't run.
  - The Partner API and `sellers.json` answer 404, exactly as with the
    build's feature flag off.
  - Windows already sold are still billed when they end: they were
    delivered.
  - On Display Types → Playlist Settings → Slot assignment, **Advertiser is
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
    reservePrice,                  // the display type's own reserve price default; CPM or null (real inheritance, 22 Sep — §5)
    billingUnitHours,               // the display type's own billing-unit default, in hours; null = platform default of 24 (§5 "Private auctions" — two-period model, 23 Sep)
    maxCampaigns,                  // the display type's own max-campaigns default; null = platform default of 5, 1-10 inclusive (§5, ticket "Max campaigns column + slot playlist statement")
    slots: [{ label, owner, partnerId, advertiser, listMode, buyersListId, storeScope, quota,
              reservePrice,         // this slot's own override; CPM, or null = inherit the display type's reservePrice above (§5)
              billingUnitHours,     // this slot's own override, in hours; null = inherit the display type's billingUnitHours above (§5)
              maxCampaigns }],      // this slot's own override; null = inherit the display type's maxCampaigns above, 1-10 inclusive when set (§5)
                                    // listMode: rtb | whitelist_only | deal | null; buyersListId set only when listMode is deal (§5 "Private auctions")
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

### Buyers list (this project's own record — §5 "Private auctions")

```
buyersList: {
  id, name, description,
  invitedBuyers: [{ identifierType, value }],  // identifierType: brandEntity | dspSeatId | other
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
unchanged by this project. Loop length is read for inventory display and
VAC-d billing only.

### Campaign (additions to the existing campaign record)

```
campaign: { …existing fields,
            source: hq | api | dsp,
            advertiserId, partnerId,
            pricingType: default | localised | personalised | interactive,
            status: draft | awaiting_approval | approved | rejected,   // shown as Draft / Awaiting approval / Approved / Rejected
            approval: { mode: manual | auto,
                        assetVersion, submittedAt,
                        reviewedBy, reviewedAt, reason,
                        assetReasons: [{ assetId, reason }],           // optional — which asset(s) a rejection named (ticket, 22 Sep)
                        checks: [{ name, passed, detail, assetId }] }, // assetId optional — set for a per-file check, unset for a campaign-level one
            activation: { enabled } }         // only settable once status = approved

asset: { …existing fields, id, campaignId, role,      // "default" or a targeted version id
         contentHash }                                // sha256 — the basis for safe reuse, below
```

**Safe reuse tracking (ticket, 22 Sep)**, kept beside approval, not inside
the campaign record — it is a history of decisions, not campaign state:

```
campaignApprovalAssetClearance: { campaignId, assetId, contentHash, clearedBy, clearedAt }
```

One row per (campaign, asset) — written only when a human approves (never
from an automated pass or an auto-approve), overwritten on every later
human approval. An asset may skip re-review only when its current content
hash matches this row's — see *Safe reuse of previously approved assets*,
§3, for the exact rule.

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
  bidder: { bidderEndpoint, seatIds },    // QPS and timeout are platform defaults (500 / 300 ms)
  seats: [{ id, name }],                  // advertisers pulled on connect; listed on the Advertisers screen
  listsLinked, allowList, blockList }     // own advertiser lists when unlinked
```

Company-level:

- **Advertiser settings**: `currency` (any ISO 4217 code; default `AUD`),
  `floorCpm`, `personalisedMultiplier`, `interactiveCpe` (defaults
  100 / 1.5 / 0.50), the auction schedule (`auctionOpensHours`,
  `playWindowHours`, `auctionCutoffTime`; defaults 168 / 24 / 18:00 UTC),
  `audienceScoring` (MOVE/VAC-d inputs), advertiser and IAB-category
  whitelists and blacklists.
- **Advertisers / Inventory** (an admin writes it; marketing reads it):
  `advertiserSettings: { [advertiser]: { approvalRequired, floorMultiplier } }`
  (defaults `true` / 1.0), and per sellable slot what it is assigned to
  (`partnerIds`, `advertisers`, list mode) and the targeting it supports
  (`supportedTargeting`, localised only by default).
- **Shared targeting variables**: the platform's default variables, grouped
  as Localisation Variables and Personalisation Variables, each with example
  values (or a fixed tooltip text) for its tooltip, read-only in this
  release, plus `variableAccess: { [variableKey]: "all" | [partnerId] }`:
  `"all"` means every connected DSP (including later ones), a list names
  individual DSPs, `[]` means none. Unset keys take the defaults in §6.
- **Exchange**: `client {name, domain, contactEmail}` (the seller of record)
  and `sellersJson {sellerId}`. Seller type, confidentiality, `supplyChain`,
  OpenRTB options, QPS ceiling and bid timeout are fixed platform defaults.
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

- Elevates Computer Vision from a **targeting-only** input (§6's Computer
  Vision Gender / Computer Vision Estimated Age Localisation Variables) to
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
- **Slot ownership editor**: each slot's label and owner — Headquarters,
  Advertiser or Stores — and nothing else. With DSP integration switched
  off, Advertiser is greyed out for a slot that isn't one already.
  *(Display Types → Playlist Settings → Slot assignment)*
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

### Advertisers / Inventory

- **Advertisers / Inventory screen**, below Campaign Status and above DSP
  Integration in the navigation, editable by an admin and read-only for marketing: every
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
- **Campaign table now groups by playlist, not by layer**: Advertiser first,
  then Schedule, Playlist name (was Name), No. of campaigns (this
  submission's layer count), and Localised variables / Personalised
  variables — a high-level summary per column with the exact rules on
  hover. The playlist-name click-through is the existing campaign-name link
  above, not a second one. *(spec — existing Campaigns section; built in
  the POC's own Campaign Status stand-in,
  `apps/admin/src/features/campaign-status/CampaignStatusPage.tsx`, with the
  summary computed server-side by `GET /admin/v1/campaigns`)*

### Pricing

- **Company-wide pricing**: currency (any ISO 4217 currency, listed by code
  and name), floor CPM, personalised multiplier, interactive cost per
  engagement,
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
  Assigned to, Targeting supported, Reserve price, Max campaigns, Billing
  unit, and an Open link), with no advertisers column and a filter on
  every column. *(Advertisers / Inventory → Available Inventory)*
- **Reserve price, inherited from its display type** (decision, 22 Sep; real
  inheritance, 22 Sep): a CPM premium to reserve the position in advance of
  the open auction, or no reserve, set once on the display type and
  automatically reaching every slot on it — override just one slot to give
  it its own value, independent from then on; published on the position,
  resolved — not yet wired to a booking flow (open question 52).
  *(Advertisers / Inventory → Available Inventory)*
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
- **Targeting supported needs QR Control for interactive**: flagged on the
  display type, greyed out with the reason where it is off, refused by the
  API. *(Advertisers / Inventory → Available Inventory)*
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
- **Targeting supported per slot**: which kinds of campaign a slot takes —
  localised, personalised, interactive — localised only by default, set by
  an admin, published on the position and enforced on every bid.
  *(Advertisers / Inventory → Available Inventory)*
- **Booking schedule**: every advertiser position across its play windows,
  booked / available / unavailable, **at the top of its own page**, with
  booking revenue per display type and then what sold by campaign type
  below it (Rob, 21 Sep: the schedule is what the page is for; the money
  reads as its summary). **Stands alone in its own tab** (Rob, 21 Sep): no
  Display Types / DSP Integration nav beside it (`RouteHandle.hideNav`),
  and no second "Schedule" section header repeating the page's own title
  immediately above the table. Its DSP and advertiser filters are column
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
  the advertiser shown beside it. *(Advertisers / Inventory → Booking
  schedule)*
- **Play-window booked/available summary, wherever the page counts
  "windows"** (ticket "anytime you use the word Windows please show a
  representation of how many are booked versus … localised … personalised
  …", 22 Sep): the page's own "N play windows" header line now also reads
  "N of M booked (X localised, Y personalised)" — summed across every
  position on screen, respecting whatever advertiser/DSP filter is active
  — right next to the window count itself, not only inside the grid. The
  Position cell on every row (above) carries the same read for that one
  row, in every view (Daily included, where the earlier per-row rollup only
  showed in Weekly/Monthly). *(Advertisers / Inventory → Booking schedule)*
- **Booking revenue table: % sold, Estimated revenue, no Billed revenue**
  (ticket "% of slots sold" and ticket "instead of booked revenue can you
  call it estimated revenue and remove the billed revenue column", both 22
  Sep): **columns, left to right: Display type, Booked windows, % sold,
  Estimated revenue.** % sold = this display type's booked windows ÷ its
  *sellable* windows over the period shown (booked or still available,
  excluding windows with no displays yet or before the earliest one still
  open to sell) — a dash when nothing was sellable at all, never a
  misleading 0%. "Booked revenue" is renamed **Estimated revenue** — more
  honest about what it is before a window has actually played: booked CPM ×
  assumed views, not confirmed spend. **Billed revenue is dropped from this
  table** — invoicing what actually played is the DSP's own concern, not
  this schedule's (it still appears in a booked tile's own hover, which
  covers one specific booking rather than a display type's whole period).
  *(Advertisers / Inventory → Booking schedule)*
- **Single-advertiser stacking tile** (ticket "Booking schedule:
  single-advertiser stacking tile", 22 Sep, superseding the earlier
  same-day "layered reach breakdown, as three stacked pills" design):
  a slot goes to one advertiser (§6), so each booked window is **one tile
  per advertiser**, not three always-shown layer pills. The advertiser
  name sits at the top of the tile as the unit. Below it, the tile stacks
  whichever of the three layers that one purchase actually carries — the
  mandatory **default** layer always at the base, **localised** above it
  when the campaign also submitted a localised (or interactive — they
  share this layer, since both vary by store rather than by visitor)
  targeted version, and **personalised** at the very top when it submitted
  a personalised one. Only the layers actually provided are shown, so the
  tile has one of three possible heights and visibly expands and
  contracts with how successful the upsell has been with that advertiser —
  monetisation readable at a glance. This retires the earlier design's
  "Sold — other layer" pill entirely: with one advertiser per slot there is
  no second layer competing for the same window's capacity to mark as
  sold elsewhere. The localised row shows the booking's reach against this
  row's `displayCount` — displays using this display type across the whole
  retail footprint, shown in brackets on the Position cell (above), not its
  own column any more — how many of those displays its targeting matched,
  from the server's `ReachCountSource` stand-in for the interface contract's
  "Booking schedule reach counts"; the personalised row carries no reach
  count, since a personalised match can't be predicted ahead of time,
  showing trigger icons instead (below) rather than a count. In the Weekly
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
  layer's detail — reach counts, lit trigger labels — that used to need a
  separate, nested hover to see; the layer rows and trigger icons
  themselves are purely visual. *(Advertisers / Inventory → Booking
  schedule)*
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
  revenue will actually be earned. *(Advertisers / Inventory → Booking
  schedule)*

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

- **DSP integration switch** (Rob, 24 Sep 2026): **Enable DSP Integration**
  at the top of Exchange settings, off at first; while off, Campaign Status
  and Advertisers / Inventory are hidden, no bid requests are sent, the
  Partner API and `sellers.json` answer 404, and nothing is deleted.
  *(DSP Integration → Exchange settings)*
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
- **Company advertiser and category lists**, with the **Where these apply**
  adoption view (adopting or own lists, no counts) directly below them.
  *(DSP Integration → Advertiser settings → List management, Where these apply)*
- **Advertiser lists on a DSP's page**: a link to the company lists when
  centrally managed (with Unlink and edit); the DSP's own editable lists when
  unlinked (with Relink). *(DSP Integration → partner → Advertiser whitelist / blacklist)*
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
  naming no resolvable slot still falls back to that 20-cap.
- **Bid responses are validated and bounded** before they are trusted:
  the request id echoed, impression 1, a finite price under a ceiling, a
  missing currency read as USD (OpenRTB), at most 10 bids and 64 KB per
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
  writer; N replicas need Postgres, and with it an asynchronous
  repository layer (engineering's integration work), after which the HPA,
  PDB and CronJob in `deploy/kubernetes/optional/` apply.

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
- **A missed cutoff is recovered**: the window is auctioned late while it
  hasn't started, and settled once it has.
- **API bids have the DSP bids' ceiling** (10,000 CPM).
- **Two processes starting on one empty database** both come up: one
  migrates and seeds, the other waits and serves.
- **Ties go to the earlier bid.**

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
  seller ID. *(spec only; reserved as nullable, unused columns —
  `exchange.platform_instance_id`, `reservations.source_instance_id`,
  migration 0022 — and `sourceInstanceId` on the v1 event)*
- **Agent-to-agent platform interface**: the inter-platform integration
  defined as an agent-consumable (MCP-layer) surface, first-class and
  separate from the tier-2 PH-native API. *(spec only)*

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
    reportable? *Still open* — §9.2 gives the multiplier a schema home and a
    `confidence` value so either answer is supportable without a second
    pipeline, but does not itself answer the question.
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
40. **DSP creative audits — partially resolved (review, Sept 2026).** DV360,
    Amazon Ads DSP and The Trade Desk each run their own buy-side creative
    audit, and each also exposes a hook PH can occupy as the exchange/
    publisher-side reviewer, so retailer approval running *in addition* to
    the DSP's own audit is achievable with all three:
    - **DV360**: the Creative resource carries `ReviewStatusInfo`
      (`ApprovalStatus`) for DV360's own audit, and separately an
      `ExchangeReviewStatus` (servable / rejected, per exchange). PH, as the
      SSP, is an exchange review authority under DV360's model — retailer
      approval maps onto setting the creative's status for PH's exchange
      via that hook.
    - **The Trade Desk**: already models a DOOH supply-side approver.
      `/v3/creative` carries a flag for whether a creative requires approval
      by VIOOH (their DOOH supply partner); approval is read from
      `approvedBy` (`null` = awaiting/not approved, a username = approved).
      PH occupies the equivalent DOOH-SSP approver role in that same shape.
    - **Amazon Ads DSP**: creative moderation is asset-level, with
      per-asset rejection reasons, and publisher policy is enforced at the
      moment a creative is associated to a line item — the point at which a
      PH approval decision would need to bite.
    - **Still open**: these are each DSP's *buy-side* API, not a confirmed
      supply-side handshake into PH's exchange — how creative and targeting
      actually get submitted to PH's exchange for the *retailer's* approval
      (as opposed to the DSP's own audit), and whether a retailer can
      pre-approve by creative ID ahead of a bid, remain unanswered. A rich
      "submit targeting for pre-approval" flow is realistically tier-2
      (Blackmores-style) work; through tier-1 onboarding (§3, DV360 →
      Amazon Ads DSP → The Trade Desk), lean on the three hooks above plus
      the pre-auction fallback (§3, *Submission*: a bid carrying an unknown
      or unapproved creative is discarded pre-auction and queued for
      review) to catch anything that slips through.
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
52. **Reserve price booking flow.** §5's reserve price (decision 22 Sep) is
    published on the position but not wired to a booking flow: a "reserve"
    reservation (`POST /v1/reservations`, `type: reserve`) still clears
    against the ordinary floor, not the position's `reservePrice`, and
    nothing takes the slot out of the open auction for the window it
    covers. This is a form of programmatic guaranteed (open question 45,
    "Deals" — deferred), so building the flow means either resolving that
    deferral or treating a reserve-price booking as its own, narrower
    mechanism.
53. **Canonical event schema — the exhaustive reference.** §9.1 reserves the
    shape and principles (versioning, `source`/`timestamp`, optional/nullable
    CV fields); a field-by-field reference with types, allowed values and a
    schema changelog is not yet written, and has no owning document yet
    (candidate: a new `docs/dsp-integration/EVENT-SCHEMA.md`, alongside
    `openapi.yaml`/`API.md`).
54. **Who hosts the canonical event schema's S3 partition and its consuming
    pipeline** (§9.1) — this project, the existing analytics platform, or a
    new shared service? Not decided; §9.1 only fixes the event model, not
    who owns the transport.
55. **The closed-loop attribution identity bridge** (§9.4) — matching an
    advertiser exposure on one PH instance to a partner-side transaction on
    another, without either side exposing raw identity. Flagged as the
    natural remit of the device graph / digital ID layer, not this project;
    not yet ticketed anywhere.
56. **Federation trust and discovery** (§9.3, §9.4) — how two PH instances
    establish that a `platformInstance.instanceId` is who it claims to be,
    and how one instance's agent discovers another's, are both undefined.
    §9.3 only reserves the identifier; §9.4 only fixes the surface's shape
    (agent-consumable, not REST) — neither answers how instances actually
    find or trust each other.
