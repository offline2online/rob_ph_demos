# Interface Contract — Live Visitor Profile ↔ Experience Templates

This file is the shared boundary between two independently-run projects:

- **Live Visitor Profile** (`../visitor-profile/`) — owns visitor/personalisation
  attributes inside Personalisation Hub and the source systems that populate them.
- **Experience Templates** (`../experience-templates/`) — owns display types,
  zones/elements, layouts, and the templates/rules that decide what renders where.

It lives here, outside both project folders, on purpose: neither project owns it
unilaterally. A change to this contract should be made with both sides in mind,
and reviewed by whoever is driving each project's board at the time.

**Status: draft.** Written from the Personalisation Hub Confluence background
(`[Phase 2] Visitor Module`, `Experience Module`, `Manage Display Types` /
`Digital Signage - Creating & Managing Display Types`) plus the verbal scope
given for this split. Not yet checked against the actual requirements content —
replace/refine this once that lands.

## What crosses the boundary

Experience Templates needs to read visitor/personalisation data to decide what
to show; it should never need to know how that data was sourced, stored, or
permissioned. Live Visitor Profile needs to know what shape of data templates
actually expect to consume; it should never need to know how a template or
display type renders it.

## The Attribute Registry

Live Visitor Profile owns and publishes an **Attribute Registry**: the list of
every personalisation attribute available to drive an experience, in the
Module → Category → Sub-Category → Attribute structure already used on the
platform (see the Visitor Module doc's own worked example: `Visitor Profile →
Age`, `Location → MIST`, `Recent Interactions → Website`, etc.).

Each entry carries:

| Field | Type | Notes |
|---|---|---|
| `key` | string | Stable dotted id — see **Attribute keys** below. Never reused for a different meaning. |
| `module` | enum | `location` \| `visitor` \| `experience` (matches the platform's own 3-module split). |
| `category` / `subCategory` | string | As defined by the registry, e.g. `Visitor Profile` / `Age`. |
| `dataType` | enum | `string` \| `number` \| `boolean` \| `enum` \| `array` \| `date`. |
| `sourceSystem` | string | Where it's populated from (MIST, Dialogflow, Website/App SDK, POS, CRM, Loyalty, manual HQ Admin entry, etc.). |
| `sharePermitted` | boolean | Visitor/customer consent flag for this category (per the Visitor Module doc's opt-out-by-category model). |

### Attribute keys

Dotted, lowercase, kebab-cased segments: `<module>.<category>.<sub-category>`,
e.g. `visitor.profile.age`, `visitor.location.mist`, `visitor.recent-interactions.website`.
Experience Templates references attributes **only** by this key — never by
guessing internal storage shape.

### Consent is not optional to check

If `sharePermitted` is `false` (or the attribute is simply absent for a given
visitor), Experience Templates must treat that identically to "this attribute
does not exist" — no fallback that reaches past the registry for the raw value.
This is the platform's existing privacy model (Visitor Module doc: a visitor
can turn off a whole category and it must disappear from every downstream
system, not just get hidden in one UI).

## Template token syntax

Templates/rules reference an attribute with `${Visitor.<key>}`, consistent with
the token style already used elsewhere on the platform (e.g. `${{ActiveCampaigns}}`
in Dialogflow rules, `${ProductPrice}` in vibe-coded experience tokens). An
unknown key or a type mismatch renders as empty — it must never throw and take
the whole template down with it.

## Where the registry actually lives

Not yet decided — open question, not yet fixed by this contract:

- A static file in this repo (e.g. `visitor-profile/attribute-registry.json`)
  that Experience Templates reads directly, versus
- A live HQ Admin-managed config (Firestore, matching how the existing
  `menu-board-demo` prototypes read live config) that both projects call at
  runtime.

Whichever Live Visitor Profile lands on, Experience Templates reads it —
it never maintains its own copy or edits it directly.

## Versioning & change process

- Adding a new attribute to the registry is a **minor**, backward-compatible
  change — safe to ship without coordinating.
- Renaming, removing, or retyping an existing `key` is a **breaking** change —
  requires a note in the Changelog below *and* a heads-up on the Experience
  Templates board before merging, since existing templates may already
  reference the old key.

## Changelog

- 2026-09-08 — Initial draft contract created alongside the Live Visitor
  Profile / Experience Templates project split.

## Open questions

- Real-time vs. batch refresh cadence per source system?
- Final token syntax — confirm it matches whatever the real Personalisation
  Hub Experience/Rules engine already expects (see Confluence `Experience
  Module` / `Experience Rules Phase 3` for existing rule-engine precedent).
- Should zone/display-type dimensions themselves ever depend on a visitor
  attribute (e.g. language), or is that always a fixed property of the
  Experience Templates side?
