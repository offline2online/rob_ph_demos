# Live Visitor Profile — Requirements

Source: *Real-Time Personalised Surface Architecture Specification v1.2*
(Personalisation Hub, 3 Sept 2026), §§2–3, 7–9, plus the
`Visitor's Live Profile / Source Control` prototype (`visitorliveprofile.jsx`).
This project owns **System One — The Attribute Layer** from that spec.

See [`../shared/interface-contract.md`](../shared/interface-contract.md) for
the maintained boundary with the Experience Templates project — that file,
not this one, is the source of truth for anything both projects depend on.
It is also mirrored/maintained inside the live backlog tracker as an
**interface** between the two projects — see that app.

## Core principle

**Inbound data selects; Personalisation Hub decides.** Attributes from any
external source only influence *which* authoritative content surfaces. They
never define, mint, or modify an offer or a price (spec §2.1). This is the
single rule everything else in this project exists to enforce.

## Scope

This project owns:

1. **The attribute schema** — three families, all available as targeting
   variables (spec §3.1):
   - **Device/display context** (platform-supplied): `device_udid`,
     `display_name`, `mist_site_id`, `display_ids`.
   - **Interaction/campaign data** (mostly PH-derived): `active_campaign`,
     `touch_point`, `matched_intent_campaign`, `interaction_entities`,
     `interaction_attributes`.
   - **Visitor/customer data** (the inbound envelope): `first_name`,
     `company_name`, `gender`, `Age`, `loyalty_tier`, `visitor_type_id`,
     `reason_for_visit_id`, `visitor_segments`, `purchase_history`,
     `product_holdings`, `plan_types`, `plan_values`, `product_type`,
     `purchase_intent`, `SKUs`, `events`, `page_view`, `device_type`.
   - A real payload is almost entirely blank — this is the normal case, not
     an edge case (spec §3.1.3).
2. **Writability classes** (spec §3.2) — only **inbound** attributes get a
   source-precedence chain. Derived (PH-authored) and platform-context
   attributes appear in the schema browser as targeting variables but have
   no chain to configure; showing an empty/meaningless chain for e.g.
   `matched_intent_campaign` would confuse the administrator.
3. **Per-field source precedence** — for each inbound attribute, an ordered
   chain of connectors, each with `max_age_s` (freshness bound) and
   `min_confidence` (threshold). First source in the chain that is enabled,
   has a value, is fresh enough, and confident enough, wins. A blank/absent
   value is not an error and does not search further down the chain — it
   resolves to the attribute's own default (spec §3.8.1, "blank is
   default").
4. **Connectors / source systems** — a registry of both:
   - **Built-in** platform sources (Vision on-device, Consumer Agent/Device,
     Virtual Queue & Appointments, Session/Player) — always available, not
     configurable, but rank in any precedence chain like any other source.
   - **Connected systems** a client configures: Digital Identity Provider,
     CRM, Customer Data Platform, Decisioning Engine, Loyalty System, POS —
     each with transport, endpoint, auth token, identity-key mapping
     (`sends`/`resolvesFrom`), timeout, cache TTL, and whether it emits a
     confidence score.
5. **The agent-controlled on-device profile** (spec §3.5) — a source
   maintained entirely on the customer's own device by their personal AI
   agent, never held by the retailer, entering the resolver as an ordinary
   source (`source_id: "device_profile"`) that competes field-by-field like
   any other. This is the mechanism that lifts an anonymous prospect to
   tier 3 personalisation with no CRM record.
6. **Entitlement verification** (spec §3.5.3) — a three-level model for
   attributes that gate pricing/entitlement (e.g. `loyalty_tier`), not just
   presentation:
   - **Level 1 — Claim**: agent asserts a value. Never reaches the pricing
     path.
   - **Level 2 — Signed credential**: device holds a retailer-issued signed
     credential; applies once PH verifies signature/issuer/expiry.
   - **Level 3 — Server-side resolution**: PH resolves identity and queries
     the authoritative system directly.
   An attribute marked `verify: true` cannot be satisfied by a non-
   authoritative source at level 1 — it resolves as **unverified**: usable
   for creative targeting, excluded from entitlement.
7. **Agent-driven SKU selection** (spec §3.5.2) — PH publishes the live
   eligible catalogue for a surface; a consumer agent selects and publishes
   relevant SKUs over the paired connection; PH validates every published
   SKU against the live eligible set server-side and silently (but audited)
   rejects anything not currently eligible. The agent can only *select from*
   what PH has published — never invent a product, offer, or price.
8. **Resolution timing** — attribute resolution runs **per slot-decision**,
   against a deadline set by the moment an element becomes visible, not
   once per interaction. A source that hasn't answered by its slot's
   deadline is treated as silent and falls through — this is not a race to
   answer first; precedence still decides among sources that *did* arrive
   in time (spec §3.9, §4.1). The same attribute can therefore resolve
   differently across slots within a single interaction.
9. **Digital identity / device graph** (spec §3.7) — phase 1: an identity
   vendor connector supplying device ID / cross-touchpoint identity,
   occupying a special position (other connectors are queried against the
   identity it resolves). Phase 2 (future): PH-native identity, with
   `ph_customer_id` as PH's own identifier and vendor identifiers mapped to
   it.

This project does **not** own display types, layouts, zones, playlists,
templates, or how a resolved attribute value actually gets rendered — that's
Experience Templates. It publishes resolved attributes; Experience
Templates consumes them via the token contract (see the interface
contract).

## Functional requirements

- **Attribute schema browser**: every attribute across all three families,
  grouped as PH groups them, showing writability class, volatility, current
  winning source (if any), and populated/blank state.
- **Per-field precedence editor** (inbound attributes only): reorder the
  source chain; add/remove a source; set `max_age_s` and `min_confidence`
  per link; set the attribute's `volatility` class and its `default` value
  when nothing qualifies.
- **Add custom attribute**: name, type (`string`/`number`/`array`/
  `lookup`/`boolean`), volatility, default — joins the schema and becomes an
  ordinary targeting variable with its own (initially empty) precedence
  chain.
- **Connector management**: list built-in and configured connectors
  separately; add/edit a configured connector (name, system type, transport,
  endpoint URL, PH API token, identity-key mapping, timeout, cache TTL,
  whether it emits confidence); paste a sample response and get field →
  attribute mapping suggestions.
- **Resolution timing controls**: first-paint budget and slot playback
  duration, with a live preview of which sources resolve in time for each
  slot's deadline given current connector latencies.
- **Health & diagnostics**: per-connector latency (p50/p95), error rate,
  last successful call.
- **Confidence thresholds are required from v1** (spec §3.8.3) — a value
  below a chain link's `min_confidence` must be skipped, not just flagged.
- **`Age`/`gender` is the required worked example** for the confidence
  threshold UI — CRM (authoritative, no confidence check) vs. vision
  estimation (probabilistic, e.g. 0.75/0.9 thresholds already used
  elsewhere on the platform).
- **`purchase_intent` is the required worked example for precedence
  inversion** — the on-device agent profile outranks enterprise decisioning
  on freshness even though it's less authoritative, which is why precedence
  must be configured per-field, never globally per-source.

## Open questions (from spec §11, scoped to this project)

1. Where does the Pega/decisioning join live — PH pushes attributes for it
   to match, or it hands PH a resolved segment? **Blocking** for the
   connector model.
3. Empty-array representation: the envelope uses `[""]` for an empty array;
   the resolver must treat this identically to `[]`.
4. Schema casing: `Age` and `SKUs` diverge from snake_case elsewhere —
   normalise before external systems/agents consume the schema, or document
   as intentional.
5. Lookup-table exposure: `visitor_type_id` / `reason_for_visit_id` are
   foreign keys — the UI needs label sets, not raw integers.
6. Device-profile write scope: does the agent write the full visitor
   schema, or an explicit writable subset? (Asserting `visitor_segments` or
   `purchase_history` is an unsubstantiated entitlement claim; asserting
   `purchase_intent` or `SKUs` is legitimate.)
7. Profile portability: is the on-device profile scoped to one retailer, or
   portable across PH deployments/retailers?
15. Identity resolution ownership: identity graph in PH from day one, or a
    resolved ID handed in until phase 2?
22. Vision confidence thresholds and attribute `min_confidence` are
    currently configured on separate screens with no visible relationship —
    Source Control should read the vision thresholds rather than
    duplicating them.
