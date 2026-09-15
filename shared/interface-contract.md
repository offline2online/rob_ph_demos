# Interface Contract — Live Visitor Profile ↔ Display Types & DSP Integration

This file is the shared boundary between two independently-run projects:

- **Live Visitor Profile** (`../visitor-profile/`) — System One (the
  Attribute Layer) of the *Real-Time Personalised Surface Architecture
  Specification v1.2*: attributes, precedence, connectors, the resolver.
- **Display Types & DSP Integration**
  (`../display-types-dsp-integration/`) — Systems Two and Three of the same
  spec: display types/elements and the surface/template layer that renders
  resolved attributes into content. **Short form: "Display Types"** — used
  throughout the rest of this file. Capitalised it is the project; lower-case
  "display types" is the System Two object the project manages.

It lives here, outside both project folders, on purpose: neither project
owns it unilaterally. A change to this contract should be made with both
sides in mind. **It is also mirrored inside the live backlog tracker**
(`backlog-tracker/`, https://backlog-tracker-e4ed2.web.app/) as an
**interface** record linking the "Live Visitor Profile" and "Display Types
& DSP Integration" projects there — that copy is what the team actually
maintains day to day; this file should stay in sync with it (whichever is
edited first, port the change to the other).

## Core principle both sides must hold

**Inbound data selects; Personalisation Hub decides.** Attributes crossing
this boundary only influence *which* authoritative content Display Types
surfaces. They never define, mint, or modify an offer or a price.
Nothing that crosses from Live Visitor Profile to Display Types ever
writes into a PH-locked commercial region (see **Trust zones** below).

## What crosses the boundary

Display Types reads resolved visitor/personalisation attributes to
decide what to show; it never needs to know how a value was sourced, cached,
or permissioned. Live Visitor Profile never needs to know how a template or
display type renders a value — only the shape it's expected to consume.

## The attribute envelope

Live Visitor Profile resolves and hands over attributes in four families
(all available to Display Types as targeting variables):

1. **Device/display context** — platform-supplied, one authoritative
   source, no precedence chain: `device_udid`, `display_name`,
   `mist_site_id`, `display_ids`.
2. **Interaction/campaign data** — mostly PH-derived (Display Types'
   own output feeding back in), no precedence chain: `active_campaign`,
   `touch_point`, `matched_intent_campaign`, `interaction_entities`,
   `interaction_attributes`.
3. **Visitor/customer data** — the contested, inbound envelope; the only
   family with a real per-attribute precedence chain: `first_name`,
   `company_name`, `gender`, `Age`, `loyalty_tier`, `visitor_type_id`,
   `reason_for_visit_id`, `visitor_segments`, `purchase_history`,
   `product_holdings`, `plan_types`, `plan_values`, `product_type`,
   `purchase_intent`, `SKUs`, `events`, `page_view`, `device_type`.

4. **Environmental/contextual** — describes the *place and moment*, not the
   person: `env.temp_c`, `env.condition`, `env.daypart`, `store_segments`
   (fixed and variable), `display_tags`, `store_stock` / SKU availability,
   `store_hours_state`. **Inbound, so it carries a precedence chain like
   family 3** — it is separated out by *subject*, not by writability,
   because who may target it is a different decision (see **Partner
   targeting permissions**). An advertiser gating a campaign on "over 25°C"
   needs this family and nothing from family 3.

   Most of this family arrives today as a **partner-supplied attribute**
   (below) rather than a platform feed. Weather and stock are both expected
   to become PH defaults once PH runs the feeds itself — weather needs only
   a feed, and `store_stock` is also coming from the Products & Assets
   program. Until then a partner brings its own.

A real envelope is almost entirely blank — **this is normal, not an
error.** Display Types must never treat a blank/absent attribute as
a fault; it simply means default or localised content renders instead.

### Writability classes (only one needs a chain)

| Class | Who writes | Has a precedence chain? |
|---|---|---|
| Inbound | External systems, Visitor API, consumer agent, vision | **Yes** |
| Derived | PH itself (i.e. Display Types' own targeting engine) | No |
| Platform context | Player/session | No — single source |
| Interaction | Session + tier-4 agent | Partial — writes are claims |

Families 3 and 4 are both Inbound; families 1 and 2 are not. The family says
what an attribute is *about*; the class says who may write it and whether a
chain applies.

Display Types must not expect or render a source-precedence UI for
anything outside the Inbound class — there's nothing there to configure.

## Blank is default

A blank or absent attribute value means default/localised content is
served. Targeting rules take effect **only** once a value is actually
populated — this is not a fallback search, it's the resolver stopping.
Display Types must never keep searching past a blank for "any"
value.

## Resolution timing — the deadline contract

Live Visitor Profile's resolver runs **per slot-decision**, against a
deadline Display Types supplies: the moment an element actually
becomes visible (rotation position for signage/carousels, scroll position
for web, or the moment of manual navigation, whichever collapses it
first). A source that hasn't answered by that deadline is treated as
silent and falls through the chain — never preferred against, never a race
to answer first. Because deadlines differ per slot/placement, **the same
attribute can resolve to different values in different slots within one
interaction** — every resolved record is stamped with the slot it was
resolved for.

Display Types owns computing and supplying the deadline (it knows
rotation position, scroll/fold position, and navigation events); Live
Visitor Profile owns applying it during resolution. Neither side unilaterally
decides a global timeout.

## Verification / entitlement levels

Attributes that gate pricing or entitlement (not just presentation, e.g.
`loyalty_tier`) carry three possible verification levels:

1. **Claim** — asserted only, e.g. by the on-device agent. Must never
   reach a pricing decision.
2. **Signed credential** — cryptographically verifiable, applies once
   verified.
3. **Server-side resolution** — PH resolves identity and queries the
   authoritative system directly. Strongest form.

Display Types must render an unverified (level-1-only) value for
creative/targeting purposes only, and must never let it reach the
PH-locked pricing path. This is enforced structurally by the trust-zone
split below, not by trusting Display Types to check the level
itself on every render.

## Partner-supplied attributes

A partner may contribute its own attributes to the live profile — weather and
stock are the worked examples. This is an **ownership property that cuts
across the families above**, not a family of its own: a partner can just as
well contribute something visitor-shaped as something environmental.

Mechanically there is nothing new here. A partner feed enters as an ordinary
**connector** in Live Visitor Profile's registry and ranks in a precedence
chain like any other source, with the same `max_age_s` and `min_confidence`
bounds. What is new is ownership:

- **Every attribute has an owner** — Personalisation Hub, or the partner that
  contributed it.
- **Namespace partner-contributed attributes**, so two partners each
  contributing "temperature" do not collide and neither can shadow a PH
  default.
- **Default scope is private to the contributing partner.** A partner's own
  data is not targeting vocabulary for its competitors, and cross-partner
  visibility must be a deliberate grant, not a side effect of contribution.
- **Promotion is expected, not exceptional.** When PH runs its own feed for a
  signal a partner already contributes, that attribute becomes a PH default
  available to everyone. Both sources then coexist in one precedence chain,
  which is what the chain is for — but whether the partner's own attribute is
  superseded, aliased to the default, or left standing is an open question.
- **A partner feed is a claim.** It carries the verification levels above, so
  it may inform creative selection freely and must never reach a pricing or
  entitlement decision. The trust-zone split enforces this structurally; it
  does not depend on the partner being honest about its own data.

## Partner targeting permissions

Attributes from this envelope are targetable by third-party advertisers and
DSPs (see Display Types' `REQUIREMENTS.md` §6). That makes the registry the
enforcement point, so the rules live here rather than on the sell side.

- **Per-partner enablement, per attribute.** A trusted partner may be granted
  a given visitor attribute; another may be granted none. Family 4 is on by
  default; family 3 is off by default and enabled deliberately.
- **Partners submit predicates; Personalisation Hub evaluates and decides.**
  No attribute value is ever returned to a partner at targeting time.
- **A partner sees only the vocabulary it may use** — permissioning surfaces
  as a smaller attribute list, never as a rejected request. This keeps a
  partner from discovering what exists by probing for errors.
- **Matches resolve to matched / not-matched.** Playback analytics disclose
  which campaign fired and which rule triggered it; they never disclose an
  attribute value, and no PII crosses the boundary in either direction.
- Live Visitor Profile owns the registry and therefore owns these grants.
  Display Types consumes the permitted vocabulary and enforces nothing
  itself — a permission bug must fail closed at the registry, not at render.

## Trust zones — the locked commercial region

| Zone | Addressable by | Contains |
|---|---|---|
| **Agent-addressable** | Consumer AI agent (tier 4), store-authored campaigns | Configuration/selection within PH's eligible set — product, option, quantity, variant |
| **PH-locked** | Personalisation Hub only | Price, offer terms, finance figures, comparison rates, disclosures, compliance copy |

An agent or a store-authored campaign can select *which* eligible thing
renders (via SKUs, configuration intent); it can never write the number
that ends up on the display. Display Types enforces this as a
structural boundary in every template/display type, regardless of which
source (device profile, decisioning engine, store authoring) supplied the
selection.

## Agent-driven selection (the paired-device case)

When a customer's own device/agent is the source: Display Types
exposes the live eligible catalogue for a surface (product/campaign feed);
the agent selects from it and publishes its selection (typically `SKUs`,
`purchase_intent`, `product_type`) back over the paired connection; Live
Visitor Profile's resolver treats this exactly like any other inbound
source (`source_id: "device_profile"`), competing field-by-field on the
same precedence rules as any enterprise system. **Server-side validation is
mandatory**: Display Types must reject (silently to the surface, but
logged) any agent-selected SKU that isn't in the live eligible set for that
surface/store/moment — expired, out of stock, or never eligible.

## Volatility classes (informs caching, not a contract Display Types configures)

- **Persistent** — resolved once against an identity, retained.
- **Stable** — long TTL.
- **Volatile** — short TTL or re-resolved every interaction (`SKUs`,
  `purchase_intent`, session-derived fields).

The Environmental family spans the range and should not be treated as one
class: weather tolerates a long TTL and must not be resolved per impression,
`store_stock` is volatile and stale values mis-target, and `store_segments` /
`display_tags` are effectively stable configuration. A targeted campaign is
only as timely as the class behind the attribute it gates on.

Live Visitor Profile owns setting/enforcing volatility; Display Types just
receives whatever is currently resolved at request time — it never caches a
value itself past what the resolver already decided.

## Connection state — a second axis Display Types alone owns

Connected Store / Connected Display / Connected Store Website / Away From
Store is orthogonal to the render tier and is **not** part of the attribute
envelope from Live Visitor Profile — Display Types derives it from
its own pairing/session state and uses it to decide CTA/menu-item
visibility, never campaign targeting (that's the tier axis, driven by
attributes).

## Versioning & change process

- Adding a new attribute to the schema is a **minor**, backward-compatible
  change — safe to ship without coordinating.
- Renaming, removing, or retyping an existing attribute, or changing the
  deadline/resolution contract above, is a **breaking** change — requires a
  note in the Changelog below *and* a heads-up on the Display Types board
  before merging, since existing templates may already reference the old
  shape.
- Keep this file and the backlog tracker's own "Live Visitor Profile ↔
  Display Types" interface record in sync — treat a divergence between them
  as a bug in whichever one is stale.

## Changelog

- 2026-09-15 — Partner-supplied attributes: partners may contribute their own
  attributes (weather, stock) as ordinary connectors ranked in a precedence
  chain. Corrects the Environmental family, added earlier the same day, from
  "single source per signal" to Inbound-with-a-chain — it is separated by
  subject, not writability. Adds attribute ownership, namespacing, default
  private scope, and the promotion path to a PH default.
- 2026-09-15 — **Breaking.** Added a fourth attribute family,
  **Environmental/contextual** (weather, store segments, display tags, store
  stock, daypart, store-hours state), and a **Partner targeting permissions**
  section governing third-party advertiser/DSP targeting against this
  envelope. Driven by the advertiser interface in Display Types'
  `REQUIREMENTS.md` §6. Per the versioning rule above this needs a heads-up
  on the Live Visitor Profile board before merging: **which system populates
  family 4 is not yet decided** (Display Types open question 28).
- 2026-09-08 — Rewritten against the real *Real-Time Personalised Surface
  Architecture Specification v1.2* (attribute schema, writability classes,
  deadline/resolution model, trust zones, agent-driven selection). Also
  set up as a maintained interface record inside the backlog tracker.
- 2026-09-08 — Initial draft contract created alongside the Live Visitor
  Profile / Display Types project split (superseded by the above).

## Open questions carried over from the spec

- Variant-selection grammar for binding an attribute to a template's
  `text[].variants` — blocking for tier-3 rendering on the Display Types
  side (spec open question 2).
- Device-profile write scope: which attributes may an agent legitimately
  assert vs. claim only (spec open question 6)?
- Ranking authority when an agent publishes multiple eligible SKUs but a
  template has one hero slot — agent order vs. Display Types'
  campaign `priority` (spec open question 8)?
- When a partner-contributed attribute is promoted to a PH default, is the
  partner's own attribute superseded, aliased to the default, or left
  standing alongside it? `store_stock` will hit this first, since the
  Products & Assets program is bringing its own.
- Can a partner ever target another partner's contributed attribute, and if
  so by what grant? Default is private to the contributor.
- Is there a minimum-volume floor on the playback analytics fed back to a
  partner? Per-impression trigger disclosure is safe on its own; thin
  segments queried repeatedly are an inference channel (Display Types open
  question 30).
