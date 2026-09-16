# Display Types & DSP Integration — Requirements

Source: *Real-Time Personalised Surface Architecture Specification v1.2*
(Personalisation Hub, 3 Sept 2026), §§4–10, plus the
`Display Types & Playlist Management` prototype
(`displaytypesandplaylists.jsx`). This project owns **System Two — Display
Types/Elements** and **System Three — The Surface Layer** from that spec.

See [`../shared/interface-contract.md`](../shared/interface-contract.md) for
the maintained boundary with the Live Visitor Profile project — that file,
not this one, is the source of truth for anything both projects depend on.
It is also mirrored/maintained inside the live backlog tracker as an
**interface** between the two projects — see that app.

## Core principles this project must uphold

- **Everything is surfaced through a campaign or an experience** — no fixed
  or special-cased surface purposes. A menu board, a promotional hero, a
  product carousel and an ordering interface are all campaigns rendered
  through display types (spec §2.2).
- **The trust boundary is a layout boundary** — commercial content (price,
  offer terms, disclosures) occupies a separate, PH-locked region no
  external agent or store-authored campaign can address (spec §2.3, §7).
- **Progressive enhancement, never a race** — a surface paints immediately
  with whatever is available (default/localised content) and enhances in
  place as better-targeted content resolves. Navigation and rotation
  controls are never blocked waiting on personalisation (spec §2.4, §4.3).

## Scope

This project owns:

### 1. The Render Ladder (spec §4)

Four tiers a surface can render at: **Default** (no data resolved) →
**Localised** (store/location context, no identity needed) →
**Personalised** (identity + populated attributes, including from a paired
device profile) → **Interactive** (live WebSocket, customer engages via a
paired device). Personalisation is not guaranteed — given how blank a
typical attribute envelope is, tiers 1–2 will carry most impressions.

- **Visibility deadlines drive resolution**, not a global timeout — the
  deadline is the moment an element actually becomes visible: rotation
  position for signage/carousels (`first_paint_budget + Σ playbackDuration`
  of preceding slots), scroll position for web (below-the-fold is unbounded
  until scrolled to), or collapsed to the moment of manual navigation.
- **Deferred visibility buys time** — a slower, higher-value source can
  still win a later slot or a below-the-fold placement even if it can never
  make first paint. Dwell time and page position are therefore
  personalisation levers, not just layout settings.
- **`plays` determines what a slot needs**: `single` (exactly one
  campaign), `sequential` (one visible, rotates), `simultaneous` (all
  visible cells must resolve by the same deadline — column count on a
  responsive grid changes how many), `static` (renders no campaigns at
  all).
- **Manual navigation collapses the deadline** to the moment of navigation,
  never blocks the navigation control itself, and freezes whatever content
  is currently in view (never swapped underneath an actively-looking
  customer).
- **Connection state is a second, orthogonal axis** (spec §4.2): Connected
  Store / Connected Display / Connected Store Website / Away From Store.
  Campaigns resolve on the tier axis; CTAs and menu items resolve on this
  one (a "Join the Queue" CTA belongs in Connected Display State
  regardless of personalisation tier). Store opening hours gate
  availability independently of both.

### 2. Display types (spec §5)

Defined against a **touch point** — Digital Signage, Kiosk, Responsive Web,
Mobile Store Site — which determines what a display type even means:

- **Signage/Kiosk**: a full canvas at a fixed resolution. Schema includes
  width/height, `maximumCampaignsPlayedInRotation` (slot count, -1 =
  unlimited), auto-play/rotation/transition modes, asset fill/positioning,
  a multi-zone flag, and a **phantom area** (a positioned overlay region
  outside campaign rotation — the natural home for a pairing QR, since it
  must survive campaign transitions).
- **Responsive Web**: an **element** assembled into a page (Hero, Carousel,
  Grid, List, Product Tiles, Order Summary, CTAs, FAQ, Rich Text, Site
  Footer) — one responsive definition serves desktop/tablet/mobile, so
  there's no separate mobile-app touch point. Per-breakpoint config: viewport
  width, column count, and **item count** (separate from columns — fewer
  items on mobile means fewer campaigns must resolve before that breakpoint
  paints).
- **Mobile Store Site**: the connected experience opened by scanning a QR —
  composed of modules (Site Header, Carousel, CTAs, Content, Footer), not
  elements.
- **Settings/features follow the touch point and are hidden, not disabled,
  when irrelevant**: canvas resolution/phantom zone/multi-zone are signage
  constructs invisible on web; In-Store Radio, MIST proximity, and
  Vision/AI need a physical surface and only appear on signage/kiosk.
- **Configuration inheritance**: `Company (availability) → Display Type
  (default) → Display/Device (override)`. An override always wins and is
  never reset by a later type-level change — the UI must make clear that a
  type-level edit won't reach an already-overridden display, and must
  visually distinguish an inherited value from an override. Diagnostic
  overlays (debug boxes) are never inheritable — set per display,
  temporarily, only.
- **Slot ownership** (`maximumCampaignsPlayedInRotation` capped): Headquarters
  (filled by campaign `priority`), Advertiser (RTB by default, or reserved to
  a named brand), Stores (delegated — see Retail Admin delegation below).
  Ownership stamps onto every render event for analytics partitioning and
  cannot be backfilled.
- **Multi-zone layouts**: established for signage (`zones`,
  `activeCampaignsByZone`); to be designed for web, where a template is a
  layout canvas the client drags display types onto.
- **Retail Admin delegation, two levels**: (1) near-term — a campaign
  flagged available to the staff tablet; staff activate it onto rotation,
  they don't author it; (2) future — store-level authoring within an
  allocated slot quota, needing an approval workflow, price-claim
  guardrails (the same PH-locked zone applies to store-authored content),
  and quota enforcement at render time, not just authoring time.

### 3. Playback: playlists, items, scenes

- **Playlist** — the rotation container, scheduled against store hours.
- **Playlist item** — references a campaign, carries `priority`,
  `playbackDuration`, `campaignType` (e.g. `LOCALISED, ON_ROTATION`), and
  `campaignCreativeSettings` with three states (`default` / `selected` /
  `unselected`) that map directly onto device pairing: unpaired renders
  `default`, a paired customer engaging an item renders `selected`,
  concurrent items render `unselected`.
- **Scene** — background plus a `text[]` array of positioned elements with
  their own entrance/exit animation. Each text element's `variants` array
  is the personalisation binding point — currently unspecified grammar; see
  open question 2 below, blocking for tier-3 rendering.

### 4. Templates — the Surface Layer (spec §6)

A **template** is a page composed of display types/elements — the single
place anything page-level (not element-level) is configured:

- **Responsive Web Page**, **Mobile Store Site**, **PWA** are the template
  types. Changing a template's type must seed the structure the new type
  requires (e.g. a web template switched to mobile store site needs modules
  seeded, not an empty canvas).
- **Template-level config**: width mode/max width, background, first-paint
  budget, fold position (a position, not a flag — a template declares how
  many elements sit above it; placement, not the element itself, decides
  deadline behaviour), and the **pairing overlay**.
- **The pairing overlay is not part of page layout** — a floating overlay
  above the page (web) or the phantom zone (signage), positioned by anchor
  + offset, holding position through scroll/rotation, because the pairing
  affordance must survive whatever the surface underneath is doing. States:
  Unpaired (QR visible) → Scanned (socket opens) → Paired (QR replaced
  in-place by a connected-device indicator reflecting device class — phone,
  glasses, watch).
- **Mobile Store Site composition**: ordered modules (Header, Carousel,
  CTAs, Content). Menu item (CTA) schema: pre-configured type (Custom,
  Join the Queue, Book an Appointment, Store Details,
  Mobile↔Display Experience — non-custom types are platform-handled, no URL
  needed), icon, name, URL (custom only, token-substituted), open-in-new-tab,
  multi-select visibility over the four connection states, and availability
  (24h or store opening hours). Where only one menu item exists, its URL
  loads directly rather than rendering a one-item menu.
- **Device pairing & profile sync** (spec §6.4): session ID generated per
  page load, QR rendered in the phantom area, WebSocket pairs phone ⇄ page,
  agent reads PH's published catalogue, agent shares profile + selected
  SKUs over the socket, PH validates against the live eligible set, page
  re-renders at tier 3, and the loop continues bidirectionally as the
  customer acts (order state back, recommendations updated). Graceful
  degradation: a dropped socket reverts to the last stable tier, never an
  empty surface.
- **Trust zones on every instance** (spec §7): `ph_locked` (price, terms,
  disclosures — PH only) vs. `agent_addressable` (configuration/selection
  within PH's eligible set). The agent turns the dial; it never writes the
  number on the display.

### 5. Channels (spec §6.8)

Digital signage and Responsive Web get the full ladder with streaming.
Mobile store site/PWA gets the full ladder and hosts the personal agent.
Messaging collapses to sequential messages. Email/Social freeze at
send/publish time — no live tier upgrade.

This project does **not** own the Attribute Registry, attribute
permissioning, or source-system integrations that populate visitor
data — that's Live Visitor Profile. It consumes visitor attributes only
through the token contract defined in the interface contract, and never
computes or displays a price/offer itself outside the PH-locked zone.

### 6. The sell side — advertiser & DSP interface

How an advertiser finds inventory, takes it, and fills it. This is the API
surface of the project, and the part a partner actually integrates against.

#### Two API tiers

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
semantics. Otherwise conformance with the DSPs rots the first time a bespoke
partner needs something.

#### Campaign model — baseline plus targeted overrides

Every reservation carries **exactly one baseline campaign, mandatory**, and
zero or more **targeted campaigns** that override it when their criteria are
met.

> Named *baseline*, not *default*, on purpose: `campaignCreativeSettings`
> already uses `default` / `selected` / `unselected` for the device-pairing
> axis (§3). Two unrelated things called "default" in one schema is a bug
> waiting to happen.

Each targeted campaign carries targeting rules over its partner's permitted
vocabulary and an explicit integer `priority`.

**Resolution, at the slot's visibility deadline:** evaluate targeted
campaigns in priority order; the highest-priority campaign whose rules all
evaluate true — against attributes that actually resolved *by that deadline*
— wins. Otherwise the baseline renders.

This is the render ladder (§1) applied inside a sold slot: the baseline is
tier 1, a store/environment-targeted campaign is tier 2, a visitor-targeted
one is tier 3. **A rule depending on an attribute that has not resolved by
the deadline is false, not pending** — the existing deadline contract, not a
second mechanism. The practical consequence for a partner is that a campaign
gated on a slow source is likelier to lose to its baseline in slot 1 than in
slot 5, and their UI has to say so.

Precedence must be explicit. Mutually exclusive rules (over 25°C, under 15°C)
are the easy case; overlapping ones are the normal case, and most-specific-
wins is unpredictable and unarguable-with. Priority is set by the partner
within their own campaign set for that slot; the baseline is pinned lowest.

#### Never dark

The fallback chain is **targeted → baseline → next eligible HQ campaign**. A
slot never renders empty. This holds for programmatic wins too: where a
winning advertiser has no usable baseline, the position falls back to HQ
rather than going dark.

#### Targeting vocabulary and per-partner permissions

The vocabulary is the Live Visitor Profile attribute registry (see the
interface contract), plus the environmental family added there for this work.
**Visitor attributes are targetable**, not just environmental ones.

**A partner can also contribute the attribute it wants to target.** Weather
and stock arrive this way today — the partner feeds them into the live
profile as an ordinary connector, then gates campaigns on them. Both are
expected to become PH defaults later (weather needs only a feed; `store_stock`
is also coming from the Products & Assets program), at which point they are
available to every partner rather than only the contributor. A contributed
attribute is namespaced to its owner and private to it by default.

- Every attribute carries a **per-partner enablement**. A trusted partner may
  be allowed a given visitor attribute; another may be allowed none. Managed
  partner by partner, against the same registry Live Visitor Profile owns.
- A partner sees only what it may use, via `GET /v1/targeting/attributes` —
  **permissioning shows up as a smaller vocabulary, never as a rejected
  request**.
- **Partners submit predicates; PH evaluates and decides.** No attribute
  value is returned at targeting time. Blackmores says `temp_c >= 25`; it
  never learns the temperature at a given store at a given moment, and never
  learns anything about the person in front of the screen.
- A match resolves to matched or not-matched. No PII crosses the boundary in
  either direction, which is what makes visitor-attribute targeting
  acceptable at all.

#### Advertiser whitelists and blacklists

On a DSP partner, the **client** maintains two lists of advertisers:

- **Whitelist** — only these may win a position.
- **Blacklist** — these may never win one.

These are the client's lists, not the DSP's. They filter what the exchange is
allowed to clear into a position and are **enforced at auction time, not
reconciled afterwards** — a blocked advertiser must never render, not render
and get credited back.

**Defined centrally, adopted by every connected DSP.** The lists live once, at
company level. A newly connected partner adopts them automatically — brand
safety should not depend on someone remembering to re-enter a blocklist on each
integration.

A partner can **unlink** and keep its own lists instead. This is the same
inheritance rule the project already uses for display types (§2): the override
wins, and a later edit to the company lists never reaches it. Two rules follow
from that, and both matter more here than they do for a display setting:

- **Unlinking copies the inherited lists down**, so the partner starts from what
  it already had rather than from nothing. Unlinking must never be a moment
  where a blacklist silently empties.
- **Relinking discards the partner's own lists.** It is destructive and says so.

Because an edit made centrally provably does not reach an unlinked partner, the
central screen shows **which partners are adopting and which have their own**,
with a count per partner. A change whose blast radius quietly misses two
partners is the failure this view exists to prevent.

An advertiser cannot sit on both; adding it to one removes it from the other.
Approved-and-blocked has no meaning, and a UI that permits it just defers the
argument to whoever reads the two lists later.

The lists take **free text as well as known seats**. A DSP's full advertiser
universe is not enumerable from our side, so a client must be able to block a
competitor we have never seen a bid from. Seats pulled on connect are offered
as shortcuts, not as the limit.

**The blacklist is not a mode — it always subtracts.** It applies to every
outcome on that partner and no position can opt out of it. Brand safety is not
a per-position choice, and a blocklist that can be bypassed by picking the
wrong dropdown value is not a control. The whitelist is the part a position
chooses to use.

A position's **Assigned to** picker therefore offers, for a DSP partner:

| Option | What sells |
|---|---|
| RTB bidding — any except *n* blocked | Everything the partner brings, minus the blacklist |
| Whitelist only (*n*) | Only advertisers on the whitelist (which cannot contain a blocked one) |
| A named advertiser | Reserved to that one seat |

Only for DSP partners. Direct/house has no auction to filter, so a position
there names its advertiser outright.

Two consequences follow from subtraction being unconditional, and both are
behaviours rather than warnings:

- **A blocked advertiser is withdrawn from the picker.** Naming it could only
  produce a position that never fills, so it is not offered.
- **Blocking an advertiser reaches positions already sold.** A position
  currently reserved to a name that is then blacklisted is flagged in place as
  unable to fill, rather than quietly continuing to look valid. It is left
  selected so the position does not change under whoever set it.

Because the two lists are mutually exclusive, whitelist-only needs no separate
subtraction — a name cannot be on both.

A list mode belongs to the partner that owns the lists, so re-pointing a
position at a different partner drops it back to open bidding rather than
carrying a filter the new partner cannot apply.

#### Playback analytics — which campaign, and why

Campaign playback analytics are fed back at **display and store level**. Each
playback record carries the campaign that played and **the trigger that
activated it**: which targeted campaign matched and on which rule, or that
the baseline filled the position.

So a partner has no control over evaluation but full visibility of outcome —
they supply the data PH evaluates, and they get back what fired and why.
Ideal end state: **associate transactions with campaign plays**, closing the
loop from impression to sale.

#### Programmatic on digital signage — a play window, not an impression

Per-impression RTB does not work on signage. Creatives are frequently video,
and in-store connectivity to screens is limited, so **assets must already be
resident on the player before they can be triggered**. An auction that clears
at impression time has nowhere to deliver the asset from.

The model is therefore an auction for a **play window** (assume 24 hours) and
not for an impression. The winner holds the position for that window.
Consequences worth stating, because they differ from web programmatic:

- The auction clears **ahead of** the window, which is what buys the time to
  distribute and cache assets.
- A win is **eligible on a given display only once that display confirms its
  assets are cached**. Eligibility is therefore per display, partial estate
  delivery is normal, and reporting has to express it.
- **The advertiser is known at write time.** Every render event can be
  stamped with both partner and advertiser as it is written — no second,
  post-hoc attribution path. This closes open questions 19–20 for signage;
  per-impression web/mobile programmatic may still need it.
- Never-dark still applies inside the window: the winner's baseline campaign
  fills any moment their targeted campaigns do not.

#### Approval

Each advertiser carries an **approval-required** flag.

- **Set:** a campaign cannot publish until approved. It sits in a pending
  state in the campaign table and is not eligible to render.
- **Not set:** publish is immediate.

The trust-zone rule applies either way. Advertiser creative may **never**
contain price, offer terms or disclosures — those are PH-locked (§4, spec
§7), and a price baked into supplied artwork is a compliance breach that an
automated dimension check will not catch. Automate what can be automated;
the flag is what puts a human in front of the rest.

#### API surface

Tier 1 follows each DSP's own specification. The tier-2 shape:

```
GET  /v1/inventory                 sellable: display type x slot x store set x window
POST /v1/inventory/forecast        projected impressions for a spec + targeting
POST /v1/reservations              reserve, or bid for a play window
GET  /v1/targeting/attributes      the vocabulary THIS partner may target
POST /v1/campaigns                 baseline (required) + targeted set
POST /v1/campaigns/{id}/assets     creative upload, validation, distribution
GET  /v1/campaigns/{id}/status     approval state, per-display cache state
GET  /v1/delivery                  playback records: what played, and why
```

```json
{
  "reservationId": "res_8812",
  "campaigns": [
    { "role": "baseline", "assetSet": "as_brand_evergreen" },
    { "role": "targeted", "priority": 10, "assetSet": "as_hot_day",
      "rules": { "all": [{ "attr": "env.temp_c", "op": "gte", "value": 25 }] } },
    { "role": "targeted", "priority": 20, "assetSet": "as_cold_day",
      "rules": { "all": [{ "attr": "env.temp_c", "op": "lt", "value": 15 }] } }
  ]
}
```

**Availability is a forecast, and targeting changes it.** "Is slot 2 free
across London for a fortnight" has no yes/no answer, and a campaign gated on
over 25°C in October delivers a fraction of its baseline. The forecast
endpoint takes the targeting rules as input for exactly this reason —
otherwise we sell guarantees we cannot meet.

### 7. The supply side — exposing in-store inventory to programmatic demand

§6 describes demand arriving through a partner. This section describes the
other direction: how the retailer's in-store screens become *buyable* by the
programmatic market at all. It is the part a POV has to answer, because it
decides what we build.

#### First, a correction the POV must not repeat

The brief asks how PH will "integrate to Publisher Supply Side Platforms
(e.g., TradeDesk, Google)". **The Trade Desk is a DSP, not an SSP** — it is the
largest independent *demand*-side platform and one of the biggest buyers of
programmatic DOOH, but it is a buyer, not a seller of inventory. Google runs
both sides under one brand: **Display & Video 360 is the DSP**, **Google Ad
Manager is the SSP / ad server**.

This is not pedantry, it changes what gets built. We do not integrate *to* The
Trade Desk as a supply platform. We make our inventory *buyable by* The Trade
Desk — either by exposing our own OpenRTB supply endpoint, or by publishing
into an SSP that already has The Trade Desk as demand.

**Personalisation Hub is the publisher.** The retailer owns the screens; PH is
the media-owner platform that operates them. PH therefore sits on the sell
side, and the real question is how PH's supply reaches buyers.

#### Three architectures

| | What it is | Trade-off |
|---|---|---|
| **A. PH as its own SSP** | PH exposes OpenRTB supply endpoints and holds direct relationships with each DSP | Most control and margin; needs demand relationships, exchange ops, and supply-chain transparency infrastructure we do not have today |
| **B. PH into an existing DOOH SSP** | PH becomes a supply source in a specialist DOOH SSP, which resells to many DSPs | Fastest route to broad demand including The Trade Desk; adds a fee layer and cedes some control over floors and buyer visibility |
| **C. Hybrid** | Direct and reserved deals held by PH; open-exchange fill via an SSP | Recommended |

**C is recommended, and the partner model already built supports it.** Direct
and named-advertiser demand is what §6 describes. An SSP becomes an additional
partner that fills whatever direct demand does not.

Specialist DOOH SSPs to evaluate for (B)/(C): **VIOOH, Vistar Media, Hivestack,
Broadsign Reach, Place Exchange, Magnite**. Google Ad Manager is a general SSP
whose DOOH support is narrower than the specialists' — it should not be assumed
equivalent just because DV360 is already in scope as demand.

#### Partner kinds — the model needs a third

Today a partner is either **Direct/house** or a **DSP**. An SSP is a third kind,
and it is not a variation on the second — the integration runs the other way:

| Kind | Direction | What a position sells to |
|---|---|---|
| Direct / house | PH holds the advertiser relationship | A named advertiser |
| DSP (demand partner) | PH exposes inventory to one named buyer | That buyer's demand, filtered by our lists |
| **SSP (supply partner)** | PH publishes inventory *into* an exchange | Whoever the exchange clears, within our rules |

The consequence for the UI: an SSP position is not "assigned to an advertiser".
It is **released to the exchange** under a floor, a category set and a
blocklist. The advertiser is not knowable at assignment time and often not
until the play has happened.

**This is what makes the advertiser blacklist load-bearing rather than
convenient.** With direct demand you choose who buys. With exchange demand you
cannot, so the blocklist is the only pre-emptive brand-safety control there is —
and it must be *transmitted to the SSP* as a buyer/advertiser block list, not
merely applied inside PH after the auction has cleared. A block applied locally
after a win is a credit note, not brand safety.

#### What a DOOH bid request carries, and why it differs

Programmatic DOOH is not display with a bigger screen. The differences change
the integration:

- **No user identity.** DOOH is a one-to-many broadcast medium: no cookies, no
  device graph, no user ID in the bid request. A bid request describes a
  *venue and a moment*, not a person. Everything in §6 about visitor targeting
  belongs to PH's own resolution, not to the exchange.
- **Venue taxonomy.** SSPs require a standardised venue type (the OpenOOH venue
  taxonomy — Retail → Grocery, Convenience, and so on) plus geo (lat/long and a
  store identifier). This has to be modelled per store and per display, and it
  is not something we currently hold.
- **Screen and loop context.** Resolution, aspect, orientation, slot duration,
  loop length and share of voice. The display type already carries most of
  this (§2); `maximumCampaignsPlayedInRotation` *is* the share-of-voice
  denominator.
- **Impression multiplier.** One play is not one impression — it is an
  estimated audience. The bid request carries a quantity/multiplier and billing
  runs on multiplied impressions. **This is where PH has a genuine advantage
  worth putting in the POV**: the Vision/AI passerby count and MIST proximity
  features already in the display type are exactly the sensor inputs that
  produce a measured multiplier rather than a modelled one.
- **Supply-chain transparency.** Publishing supply means a `sellers.json`
  equivalent and a `SupplyChain` object on the bid request, declaring whether
  the retailer or PH is the seller of record. That is a commercial decision
  before it is a technical one.

#### Pre-caching is the constraint that shapes the whole integration

Restating §6 because it is the first qualifying question for any SSP: in-store
connectivity is limited and DOOH creative is frequently video, so **assets must
be resident on the player before they can be triggered**. An auction that
clears at the moment of play has nowhere to deliver the asset from.

That rules out naive just-in-time RTB and drives the **play-window model** in
§6 — the auction clears ahead of the window, which is what buys the time to
distribute and cache. So when evaluating SSPs, ask first:

1. Does it support forward or window-based clearing, not only per-impression?
2. Does it support creative pre-approval and pre-delivery to the player?
3. Can a win be made conditional on a per-display cache confirmation?

An SSP that only clears at impression time is not usable for in-store video on
current connectivity, whatever demand it carries.

#### Proof of play, and why it is the billing record

DOOH bills on **proof of play**, not on the win notice. The player logs each
actual play; PH reconciles wins against plays and bills the multiplied
impressions that genuinely rendered. Plays that did not happen — screen
offline, store closed, loop cut short — are reported and not billed. Store
opening hours already gate availability (§2), and the §6 analytics feed is the
same pipeline: one set of playback records, two consumers, the partner and
billing.

#### Brand safety at exchange scale

With exchange demand the buyer is unknown ahead of time, so the controls have
to be structural rather than editorial:

- Venue and category exclusions, passed to the SSP.
- The advertiser blocklist, transmitted as a block list (above).
- Creative approval, per the per-advertiser flag in §6.
- **The PH-locked commercial zone** (§4, spec §7). No externally supplied
  creative may address the region carrying price, offer terms or disclosures.
  On signage this is enforced physically by the phantom area and zone layout,
  which is a stronger guarantee than a policy — a programmatic creative cannot
  render into a region it was never given.

#### Open before the POV is final

These need confirming against current vendor and IAB documentation rather than
asserted — this sandbox has no access to verify them, and version numbers in
this area move:

- The exact OpenRTB version and DOOH object support required by each candidate
  SSP, and which version of the OpenOOH venue taxonomy they expect.
- Which of the candidate SSPs support window-based clearing and creative
  pre-delivery (the qualifying question above).
- Whether the retailer or PH is the seller of record, and what that implies for
  `sellers.json` and the supply chain declaration.
- The audience measurement currency the market expects, and whether a
  sensor-derived multiplier is accepted for trading or only for reporting.

## Functional requirements

- **Display type library**, browsable by touch point, with slot count and
  ownership summary.
- **Display type editor** matching the schema in §5.4 above, with
  inheritance-aware editing (type-level default vs. per-display override,
  visually distinguished).
- **Slot ownership & quota editor**: internal / named advertiser / RTB /
  store-level quota (percentage or count based).
- **Multi-zone layout designer** for signage (optionally Mist-zone-driven);
  web layout composer allowing display types to be dragged onto a page
  canvas.
- **Trust zone assignment**, visibly distinct from agent-addressable
  regions in any editor preview.
- **Tier preview**: Default / Localised / Personalised (in-window and late)
  / Interactive, side by side — the single most important screen per the
  spec.
- **Pairing simulation**: QR scan → profile sync → phone-driven page
  update, shown side by side.
- **Channel preview**: the same surface rendered as web vs. email vs.
  messaging, showing where the ladder freezes.
- **Partner/DSP connection management**: credentials per partner, connection
  test, advertisers pulled on connect, and the positions sold through each.
- **Per-partner targeting attribute enablement**: which registry attributes
  this partner may target, visitor attributes off by default.
- **Company advertiser lists** — one central whitelist/blacklist, adopted by
  every connected DSP, showing which partners adopt and which have unlinked.
- **Per-DSP list override**: unlink (copying the inherited lists down) and
  relink (discarding the partner's own), with inherited lists shown read-only
  and visually distinct from an override.
- **Per-advertiser approval-required toggle**, and a campaign approval queue
  for the advertisers it is set on.
- **Campaign set editor** per reservation: one baseline, plus targeted
  campaigns with rules and explicit priority, showing which would win for a
  given set of attribute values.
- **Asset distribution status per display** — a programmatic win is not
  eligible on a display until that display has cached its assets.
- **Playback analytics feed** at display and store level, disclosing the
  campaign that played and the trigger that activated it.
- **SSP (supply) partner kind** alongside Direct and DSP: a position released
  to an exchange under a floor, category set and transmitted blocklist rather
  than assigned to a named advertiser.
- **Venue and screen metadata per store/display** — OpenOOH venue type, geo,
  resolution, orientation, loop length, share of voice — as required by a
  DOOH bid request.
- **Proof-of-play reconciliation**: wins matched against actual plays, with
  unrendered plays reported and excluded from billing.
- **Audience multiplier** per play, sensor-derived where Vision/AI or MIST is
  enabled on the display type, modelled otherwise.

## Open questions (from spec §11, scoped to this project)

2. Variant-selection grammar for `text[].variants` — **blocking** for tier-3
   rendering.
9. Catalogue exposure format for agent-readable publishing — MCP, Web MCP,
   or plain REST?
11. UCP manifest generation: live per request, or per campaign at publish?
12. Campaign approval. **Resolved for advertisers** (§6): a per-advertiser
    approval-required flag, pending campaigns held out of rotation. Still
    open for store-authored campaigns — HQ review required, or immediate
    publish by default?
14. Web multi-zone semantics: does responsive reflow need different
    rotation rules than a signage zone?
18. Freeze duration on the slot in view — does it upgrade the instant the
    customer navigates away, or only on next scheduled rotation?
19–20. RTB slot attribution/auction configuration. **Resolved for digital
    signage** (§6): the auction clears for a play window rather than an
    impression, so the advertiser is known at write time and a single write
    path suffices. Still open for per-impression web/mobile programmatic,
    where a post-hoc attribution write is still required.
23. Per-template deadline warnings — since placement (not display type)
    sets an element's deadline, where does a "this source is too slow for
    this slot" warning actually surface: the layout composer, the display
    type, or both?
24. Connection-state transitions mid-session — does the CTA menu re-render
    on each transition, and does an in-flight action survive it?
25. Voice-only sessions (smart glasses, no mobile surface) — distinct
    template class, or simply suppress the mobile surface?
26. Template resolution on override — does an in-flight paired session keep
    the template it opened with when a display's override changes mid-
    session?

### Raised by the sell-side design (§6), not carried from spec §11

27. **Play-window length** for signage programmatic. 24 hours is the working
    assumption; the real figure is a commercial decision crossed with how
    long asset distribution across the estate actually takes.
28. **Where environmental attributes are sourced and owned.** *Resolved:*
    partners contribute them to Live Visitor Profile as ordinary connectors,
    namespaced and private to the contributor. PH is expected to take weather
    and stock over as defaults later — stock via the Products & Assets
    program. What remains open is the promotion path: when PH's own feed
    lands, is the partner's attribute superseded, aliased, or left standing?
29. **Partial-estate delivery.** If only part of the estate cached its assets
    before the window opens, what was actually sold? Needs a guarantee model
    and a reporting shape, not just a status field.
30. **Minimum-volume floor on partner analytics.** Per-impression trigger
    disclosure is safe individually, but thin segments repeatedly queried are
    an inference channel. Is there a reporting floor, and at what N?
31. **Cross-partner visibility.** A contributed attribute is private to its
    owner by default. Is there ever a case for one partner targeting
    another's contributed data, and what grant would express it?
32. **Which supply architecture.** PH as its own SSP, PH into an existing DOOH
    SSP, or the hybrid recommended in §7. This is a commercial decision about
    demand relationships as much as a technical one, and it gates most of the
    rest of §7.
33. **Seller of record** — the retailer or PH — and what that implies for
    `sellers.json` and the supply-chain declaration.
34. **Is a sensor-derived audience multiplier tradeable**, or only reportable?
    PH can measure rather than model it; whether the market will trade on that
    measurement is a different question.
35. **Venue and geo metadata has no home yet.** OpenOOH venue type, lat/long
    and store identifier are required by any DOOH bid request and are not
    currently held against a store or a display.
36. **Transaction association.** The stated end state is tying transactions to
    campaign plays. That needs an identity join this project does not own and
    the interface contract does not currently describe.
