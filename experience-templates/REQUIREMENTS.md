# Experience Templates — Requirements

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

## Open questions (from spec §11, scoped to this project)

2. Variant-selection grammar for `text[].variants` — **blocking** for tier-3
   rendering.
9. Catalogue exposure format for agent-readable publishing — MCP, Web MCP,
   or plain REST?
11. UCP manifest generation: live per request, or per campaign at publish?
12. Store-authored campaign approval: HQ review required, or immediate
    publish by default?
14. Web multi-zone semantics: does responsive reflow need different
    rotation rules than a signage zone?
18. Freeze duration on the slot in view — does it upgrade the instant the
    customer navigates away, or only on next scheduled rotation?
19–20. RTB slot attribution/auction configuration — a reserved slot stamps
    its advertiser at write time; an open RTB slot only knows the winner
    once the auction clears, so render events need a second, post-hoc write
    path. Needs its own floor price / permitted categories / competitive
    exclusion design, likely a separate retail-media surface.
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
