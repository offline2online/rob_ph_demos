# Live Visitor Profile — Requirements

**Status: draft.** This was scaffolded from the verbal project scope
("managing the attributes in Personalisation Hub, and also the source
systems") plus real background material found in the Personalisation Hub
Confluence export (Google Drive) — not yet from the actual "Live Visitor
Profile & Experience Templates" Claude Cowork folder this project is meant to
be split out of, which this session could not reach. Replace/expand this once
that content is available.

See [`../shared/interface-contract.md`](../shared/interface-contract.md) for
the boundary this project shares with the Experience Templates project —
that file, not this one, is the source of truth for anything both projects
depend on.

## Scope

This project owns:

1. **The Attribute Registry** — the definition of every personalisation
   attribute Personalisation Hub can hold about a visitor, organised as
   Module → Category → Sub-Category → Attribute (the existing platform
   structure — see the `[Phase 2] Visitor Module` Confluence page for the
   worked example: `Location`, `Visitor Profile`, `Product Holdings`, `Recent
   Interactions`, `Unused Features`, `Purchase History`, `Preferences`,
   `Loyalty & Rewards`, `Predicted Intent`, `Visitor Segments`).
2. **HQ Admin control over attribute sharing** — which attributes/categories
   an enterprise client has approved for use by connected systems, including
   a visitor/customer-facing opt-out per category (e.g. "don't use my Recent
   Interactions to personalise my experience").
3. **Source system integrations** that populate and update the profile —
   MIST (webhook, zones, beacons, dwell time), Dialogflow, website/app (MIST
   SDK, cookies), retail/POS, CRM/loyalty systems — including how a visitor
   identified by different identifiers (hashed email, Dialogflow ID, browser
   cookie ID, MIST ID) gets merged into a single profile rather than
   fragmenting into duplicates.
4. **Publishing the Attribute Registry** in the shape the Experience
   Templates project consumes it in, per the interface contract.

This project does **not** own display types, layouts, zones, playlists, or
how an experience actually renders — that's Experience Templates.

## Functional requirements (draft)

- HQ Admin can view and manage the full Attribute Registry: Module, Category,
  Sub-Category, Attribute, data type, source system, and share-permitted flag.
- A visitor/customer can control which Categories a client/brand may use to
  personalise their experience; declining a category removes it from every
  downstream system, not just one screen.
- Profile merge logic: when a hashed identifier that already exists on file
  arrives via a new touchpoint, the system merges into the existing profile
  rather than creating a duplicate.
- Each source system integration writes into the registry's attribute shape
  (not its own ad hoc format) so Experience Templates always sees one
  consistent contract regardless of which system populated a given value.

## Open questions

- Which source systems are actually in scope for this prototype phase vs.
  future phases (MIST, Dialogflow, and website/app SDK look highest priority
  based on existing Confluence material — confirm)?
- Where does attribute permissioning actually get configured — is this a new
  HQ Admin screen, or does it extend an existing one?
- Confirm the real requirements content from the Claude Cowork folder this
  was meant to be split from, and reconcile against this draft.
