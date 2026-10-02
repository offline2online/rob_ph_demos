# Interface Contract v3.1 (2 Oct 2026) — Live Visitor Profile ↔ Display Types & DSP Integration

**Adopted 1 Oct 2026 (Rob; tickets 5kIApxS1EURW899JXwm2 / 2BqGzhNmGhrhct0ptpfG).** Replaces the 22 Sep 2026 record (v2), which was written before the 29–30 Sep rescope and still assigns rendering, the deadline contract, trust-zone enforcement, agent-SKU validation and the reach-count dependency to Display Types & DSP Integration. **v3.1 (2 Oct 2026, Rob; tickets DDOjJoYjraKROu4Ainj5 / GxHWPoDc3NaO1webGKg1)** settles rows 3–4 and closes v3's two open questions — see the changelog. This file is the source of truth; the board interface record `EIIhnzWmieAnEyXffudb` carries the identical text.

## The two sides

- **Live Visitor Profile** (`visitor-profile/`, board project *Live Visitor Profile & Personas*, spec-only) — System One, the Attribute Layer: the attribute schema, writability classes, per-field source precedence, connectors, entitlement verification, resolution timing. It populates the **Personalisation Variables** the platform's targeting evaluation reads.
- **Display Types & DSP Integration** (`dsp-integration/`, "the exchange") — OpenRTB DOOH bid requests, pre-auction enforcement, the auction, creative queueing, hand-off to the existing campaign system, dynamic VAC-d billing, the Partner API, and the admin screens that configure them. It **permissions and validates** which platform variables a DSP may target. It never evaluates a targeting rule, never resolves an attribute, never renders, and never decides which version plays.
- **Personalisation Hub Core** is the third party both sides depend on but neither owns: the existing campaign targeting object and its evaluation, playback and playback analytics, store/display records. Anything either side needs from PH Core is documented in that side's own boundary document (`dsp-integration/docs/dsp-integration/api/PH-CORE-BOUNDARIES.md` for the exchange), not here.

## Core principle both sides must hold

**Inbound data selects; Personalisation Hub decides.** Attributes only ever influence *which* authoritative content the platform surfaces. They never define, mint or modify an offer or a price. Nothing in this contract gives the exchange, a DSP or an advertiser an attribute *value*: predicates go in, matched / not-matched comes out, and no PII crosses in either direction.

## What crosses the boundary today

| # | What | Direction | Owner of the definition | Consumer and why |
|---|---|---|---|---|
| 1 | **Targeting vocabulary** — the platform-defined variables a DSP may be allowed to target, in two groups: *Localisation Variables* (store, moment, display, Vision/AI aggregate) and *Personalisation Variables* (the identified visitor). The list is REQUIREMENTS §6 "Shared Targeting Variables". | LVP/PH Core → exchange | The platform (Q43/Q44, 29 Sep 2026: variables are platform-defined set values; retailers do not manage them; environmental attributes are platform variables held as segments, not new data sources). LVP owns what populates the Personalisation Variables. | The exchange shows the list read-only on *Shared Targeting Variables*, stores per-DSP permission, exposes the permitted subset on `GET /v1/targeting/attributes`, and rejects a submitted rule that uses an unpermitted variable (422 `variable_not_permitted`). Defaults: Localisation → all connected DSPs; Personalisation → none. |
| 2 | **Permission semantics** — a DSP sees only the vocabulary it may use (a smaller list, never a rejected request); matches resolve matched / not-matched; playback analytics disclose which campaign fired, never an attribute value. | both | Shared rule | The exchange enforces at submission and forecast; PH Core enforces at evaluation. A permission bug must fail closed at the exchange's validation, not at render. |
| 3 | **Per-play version and tier** — every play PH Core reports carries the campaign version it showed (`versionId`, the approved asset version the exchange handed over on the booking) and its tier: `default`, `localised` or `personalised` (30 Sep 2026; versionId kept in v3.1, 2 Oct). | PH Core (fed by LVP's resolution) → exchange | PH Core's targeting evaluation decides the tier; which attributes make a play *personalised* is that classification's business, including sensor/camera-derived attributes (Q34, 29 Sep: sensor-derived audience qualifies as personalised). | Billing: a personalised play bills at committed price × the personalised multiplier snapshotted on the reservation; everything else at the committed price; a null tier bills as default. The exchange cannot infer the tier and must never try. `versionId` is the audit trail for "plays the version it was handed": billing does not price on it. |
| 4 | **Audience scoring inputs for VAC-d** (`AudienceSource`) — per slot: whether it is **scored** at all, the assumed views per play window (VAC-d: each display's counted or modelled figure or per-display override, otherwise the display type's default VAC-d), and whether the figure is **counted** (Vision/AI, MIST proximity) or modelled. | PH Core / retailer scoring → exchange; the default VAC-d exchange → `AudienceSource` | Per-display counted/modelled VAC-d and the per-display override: the retailer's scoring framework (MOVE methodology, REQUIREMENTS §4) and, where cameras are connected, PH's automated analysis; LVP's vision connector is one source of counted audience. **A display type's default VAC-d is the exchange's own display-type setting** (migration 0035), resolved by the exchange and passed to `AudienceSource.forSlot` — the audience source never reads it from the exchange's tables (v3.1). | Inventory, forecast, the OpenRTB `qty` multiplier and billing. An **unscored** slot is left out of inventory, forecast and the auction and a bid on it is refused (30 Sep 2026); 0 means unknown, never "nobody watching". `targetedShare(rules)` is a predicate-in, number-out estimate — no attribute value crosses. |
| 5 | **Shared-attributes control for Computer Vision Gender / Estimated Age** — whether the retailer exposes them at all is the existing shared-attributes switch (Q49). | retailer setting, read by both | PH Core | The exchange lists the two CV variables under Localisation only while they are exposed. |

## Explicitly NOT part of this contract (removed in v3)

- **Rendering, the surface/template layer, tier-3/tier-4 rendering, the variant-selection grammar.** PH Core owns which version renders; layouts and templates are held out of the exchange's first release.
- **The deadline / resolution-timing contract.** Resolution timing is internal to Live Visitor Profile and the platform's slot decision. The exchange supplies no deadline.
- **Trust zones / the PH-locked commercial region.** Enforced structurally by the platform's templates, which the exchange does not build. The exchange's only "lock" is the sales lock on a sold slot, which is unrelated.
- **Agent-driven selection and agent-selected SKU validation.** Internal to Live Visitor Profile (its scope item 7). The exchange's `SKUs` is a targeting variable (list of SKUs an advertiser targets, ≤ 100 values) and a free-text campaign brief, nothing more.
- **Verification / entitlement levels and volatility classes.** Internal to Live Visitor Profile. The exchange consumes only the per-play tier (row 3).
- **Partner-supplied attributes as connectors.** Superseded by Q43/Q44: environmental attributes are platform variables held as segments; partner-contributed attributes, weather and stock are not offered to DSPs in this release.
- **Booking-schedule reach counts (display count per display type, localised match count).** Removed with the reach-count API. Decided 1 Oct 2026: the exchange's `ReachCountSource` stand-in, the `reach` field on `GET /admin/v1/booking-schedule` and the FR text are removed (ticket GyBfGm4kwHrO302CWl0j); the localised layer shows without a count.
- **Connection state** (Connected Store / Display / Website / Away From Store) — an HQ Admin / platform concern, not the exchange's.

## Versioning & change process

- Adding a variable to the vocabulary is a **minor** change, made by the platform; the exchange picks it up read-only.
- Renaming, removing or retyping a variable, changing the tier vocabulary, or changing what `AudienceSource` must report is a **breaking** change: changelog entry here plus a heads-up on both boards before merging.
- Keep `shared/interface-contract.md` and the board interface record in sync; a divergence is a bug in whichever is stale. The repo file is the source of truth.

## Changelog

- 2026-10-02 — **v3.1** (minor). Row 3 keeps the per-play `versionId` alongside the tier (the audit trail; billing uses the tier). Row 4: a display type's default VAC-d is the exchange's setting, passed to `AudienceSource`; PH Core / the scoring framework owns only per-display counted or modelled VAC-d and the override. Closed both open questions: a display type with no retailer scoring is scored by its default VAC-d (unset = unscored and unsellable), counted figures coming from PH Core / LVP vision when connected; the minimum-volume floor on partner playback analytics is PH Core's call — recorded as a PH Core requirement in `dsp-integration/docs/dsp-integration/api/PH-CORE-BOUNDARIES.md`, and the exchange shares no per-play attribute data.
- 2026-10-01 — **v3.** Rescoped to the 29–30 Sep 2026 decisions: removed rendering, the deadline contract, trust zones, agent-driven selection, verification levels, volatility classes, partner-supplied attributes and the reach-count dependency; added the per-play version tier (row 3), audience scoring inputs (row 4) and the shared-attributes control (row 5); folder renamed `display-types-dsp-integration/` → `dsp-integration/` (21 Sep).
- 2026-09-29 — Decisions touching the PH Core boundary (venue/geo owned by PH Core; analytics owned by PH in the PWA player) — recorded in the repo file only; moved to the exchange's PH-CORE-BOUNDARIES.md where they belong.
- 2026-09-22 — v2: added Booking schedule reach counts (now removed).
- 2026-09-15 — Environmental family and partner targeting permissions (superseded in part by Q43/Q44).
- 2026-09-08 — Rewritten against the Real-Time Personalised Surface Architecture Specification v1.2.

## Open questions

None open (v3.1 closed both carried from v3 — see the changelog).
