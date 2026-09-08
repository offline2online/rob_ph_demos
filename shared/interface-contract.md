# Interface Contract — Live Visitor Profile ↔ Experience Templates

This file is the shared boundary between two independently-run projects:

- **Live Visitor Profile** (`../visitor-profile/`) — System One (the
  Attribute Layer) of the *Real-Time Personalised Surface Architecture
  Specification v1.2*: attributes, precedence, connectors, the resolver.
- **Experience Templates** (`../experience-templates/`) — Systems Two and
  Three of the same spec: display types/elements and the surface/template
  layer that renders resolved attributes into content.

It lives here, outside both project folders, on purpose: neither project
owns it unilaterally. A change to this contract should be made with both
sides in mind. **It is also mirrored inside the live backlog tracker**
(`backlog-tracker/`, https://backlog-tracker-e4ed2.web.app/) as an
**interface** record linking the "Live Visitor Profile" and "Experience
Templates" projects there — that copy is what the team actually maintains
day to day; this file should stay in sync with it (whichever is edited
first, port the change to the other).

## Core principle both sides must hold

**Inbound data selects; Personalisation Hub decides.** Attributes crossing
this boundary only influence *which* authoritative content Experience
Templates surfaces. They never define, mint, or modify an offer or a price.
Nothing that crosses from Live Visitor Profile to Experience Templates ever
writes into a PH-locked commercial region (see **Trust zones** below).

## What crosses the boundary

Experience Templates reads resolved visitor/personalisation attributes to
decide what to show; it never needs to know how a value was sourced, cached,
or permissioned. Live Visitor Profile never needs to know how a template or
display type renders a value — only the shape it's expected to consume.

## The attribute envelope

Live Visitor Profile resolves and hands over attributes in three families
(all available to Experience Templates as targeting variables):

1. **Device/display context** — platform-supplied, one authoritative
   source, no precedence chain: `device_udid`, `display_name`,
   `mist_site_id`, `display_ids`.
2. **Interaction/campaign data** — mostly PH-derived (Experience Templates'
   own output feeding back in), no precedence chain: `active_campaign`,
   `touch_point`, `matched_intent_campaign`, `interaction_entities`,
   `interaction_attributes`.
3. **Visitor/customer data** — the contested, inbound envelope; the only
   family with a real per-attribute precedence chain: `first_name`,
   `company_name`, `gender`, `Age`, `loyalty_tier`, `visitor_type_id`,
   `reason_for_visit_id`, `visitor_segments`, `purchase_history`,
   `product_holdings`, `plan_types`, `plan_values`, `product_type`,
   `purchase_intent`, `SKUs`, `events`, `page_view`, `device_type`.

A real envelope is almost entirely blank — **this is normal, not an
error.** Experience Templates must never treat a blank/absent attribute as
a fault; it simply means default or localised content renders instead.

### Writability classes (only one needs a chain)

| Class | Who writes | Has a precedence chain? |
|---|---|---|
| Inbound | External systems, Visitor API, consumer agent, vision | **Yes** |
| Derived | PH itself (i.e. Experience Templates' own targeting engine) | No |
| Platform context | Player/session | No — single source |
| Interaction | Session + tier-4 agent | Partial — writes are claims |

Experience Templates must not expect or render a source-precedence UI for
anything outside the Inbound class — there's nothing there to configure.

## Blank is default

A blank or absent attribute value means default/localised content is
served. Targeting rules take effect **only** once a value is actually
populated — this is not a fallback search, it's the resolver stopping.
Experience Templates must never keep searching past a blank for "any"
value.

## Resolution timing — the deadline contract

Live Visitor Profile's resolver runs **per slot-decision**, against a
deadline Experience Templates supplies: the moment an element actually
becomes visible (rotation position for signage/carousels, scroll position
for web, or the moment of manual navigation, whichever collapses it
first). A source that hasn't answered by that deadline is treated as
silent and falls through the chain — never preferred against, never a race
to answer first. Because deadlines differ per slot/placement, **the same
attribute can resolve to different values in different slots within one
interaction** — every resolved record is stamped with the slot it was
resolved for.

Experience Templates owns computing and supplying the deadline (it knows
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

Experience Templates must render an unverified (level-1-only) value for
creative/targeting purposes only, and must never let it reach the
PH-locked pricing path. This is enforced structurally by the trust-zone
split below, not by trusting Experience Templates to check the level
itself on every render.

## Trust zones — the locked commercial region

| Zone | Addressable by | Contains |
|---|---|---|
| **Agent-addressable** | Consumer AI agent (tier 4), store-authored campaigns | Configuration/selection within PH's eligible set — product, option, quantity, variant |
| **PH-locked** | Personalisation Hub only | Price, offer terms, finance figures, comparison rates, disclosures, compliance copy |

An agent or a store-authored campaign can select *which* eligible thing
renders (via SKUs, configuration intent); it can never write the number
that ends up on the display. Experience Templates enforces this as a
structural boundary in every template/display type, regardless of which
source (device profile, decisioning engine, store authoring) supplied the
selection.

## Agent-driven selection (the paired-device case)

When a customer's own device/agent is the source: Experience Templates
exposes the live eligible catalogue for a surface (product/campaign feed);
the agent selects from it and publishes its selection (typically `SKUs`,
`purchase_intent`, `product_type`) back over the paired connection; Live
Visitor Profile's resolver treats this exactly like any other inbound
source (`source_id: "device_profile"`), competing field-by-field on the
same precedence rules as any enterprise system. **Server-side validation is
mandatory**: Experience Templates must reject (silently to the surface, but
logged) any agent-selected SKU that isn't in the live eligible set for that
surface/store/moment — expired, out of stock, or never eligible.

## Volatility classes (informs caching, not a contract Experience Templates configures)

- **Persistent** — resolved once against an identity, retained.
- **Stable** — long TTL.
- **Volatile** — short TTL or re-resolved every interaction (`SKUs`,
  `purchase_intent`, session-derived fields).

Live Visitor Profile owns setting/enforcing volatility; Experience
Templates just receives whatever is currently resolved at request time —
it never caches a value itself past what the resolver already decided.

## Connection state — a second axis Experience Templates alone owns

Connected Store / Connected Display / Connected Store Website / Away From
Store is orthogonal to the render tier and is **not** part of the attribute
envelope from Live Visitor Profile — Experience Templates derives it from
its own pairing/session state and uses it to decide CTA/menu-item
visibility, never campaign targeting (that's the tier axis, driven by
attributes).

## Versioning & change process

- Adding a new attribute to the schema is a **minor**, backward-compatible
  change — safe to ship without coordinating.
- Renaming, removing, or retyping an existing attribute, or changing the
  deadline/resolution contract above, is a **breaking** change — requires a
  note in the Changelog below *and* a heads-up on the Experience Templates
  board before merging, since existing templates may already reference the
  old shape.
- Keep this file and the backlog tracker's own "Live Visitor Profile ↔
  Experience Templates" interface record in sync — treat a divergence
  between them as a bug in whichever one is stale.

## Changelog

- 2026-09-08 — Rewritten against the real *Real-Time Personalised Surface
  Architecture Specification v1.2* (attribute schema, writability classes,
  deadline/resolution model, trust zones, agent-driven selection). Also
  set up as a maintained interface record inside the backlog tracker.
- 2026-09-08 — Initial draft contract created alongside the Live Visitor
  Profile / Experience Templates project split (superseded by the above).

## Open questions carried over from the spec

- Variant-selection grammar for binding an attribute to a template's
  `text[].variants` — blocking for tier-3 rendering on the Experience
  Templates side (spec open question 2).
- Device-profile write scope: which attributes may an agent legitimately
  assert vs. claim only (spec open question 6)?
- Ranking authority when an agent publishes multiple eligible SKUs but a
  template has one hero slot — agent order vs. Experience Templates'
  campaign `priority` (spec open question 8)?
