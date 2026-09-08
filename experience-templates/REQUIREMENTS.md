# Experience Templates — Requirements

**Status: draft.** This was scaffolded from the verbal project scope
("managing display types and the elements and the layouts and templates")
plus real background material found in the Personalisation Hub Confluence
export (Google Drive) — not yet from the actual "Live Visitor Profile &
Experience Templates" Claude Cowork folder this project is meant to be split
out of, which this session could not reach. Replace/expand this once that
content is available.

See [`../shared/interface-contract.md`](../shared/interface-contract.md) for
the boundary this project shares with the Live Visitor Profile project —
that file, not this one, is the source of truth for anything both projects
depend on.

## Scope

This project owns:

1. **Display Types** — the default set (single-portrait, single-landscape,
   dual-portrait, dual-landscape, 4x4-video-wall — per `Digital Signage -
   Creating & Managing Display Types`) plus user-defined custom display
   types, each with a resolution and a default playlist.
2. **Zones** — segmenting a display type's canvas into multiple areas, each
   with its own default playlist, position, margins, transparency, and
   "hide on visitor interaction" behaviour; a "phantom area" reserved for the
   platform's own dynamic QR codes that other generated content must avoid.
3. **Layouts & elements** — the JSON structure a display type/zone payload
   takes (`Manage Display Types` Confluence page has the concrete shape:
   `width`/`height`, `background_color`, `advanced_settings` such as asset
   positioning, fill mode, campaign rotation/transition/auto-play modes).
4. **Templates** — scene/campaign templates (per `Campaign Master Data
   Template`): scenes with entrance/exit animations, backgrounds (including a
   GenAI prompt field), text elements with position/sizing, and a phantom
   area definition per scene.
5. **Experience Rules** that decide which template/content plays where, for
   whom, referencing visitor attributes via the token contract defined in
   the interface contract (not by reaching into Live Visitor Profile's data
   directly).

This project does **not** own the Attribute Registry, visitor attribute
permissioning, or source-system integrations that populate visitor data —
that's Live Visitor Profile. It consumes visitor attributes only through the
`${Visitor.<key>}` token contract.

## Functional requirements (draft)

- HQ Admin can create, edit, and list Display Types, each with a resolution,
  a default playlist, and (optionally) multiple Zones.
- Zones default to fully transparent and can be resized/repositioned; a zone
  matching an existing display type's dimensions can reuse that display
  type's own playlist.
- A phantom area can be enabled on any display type/zone, with QR
  position/size/colour settings consolidated on the display type's own
  details page — no other generated content or campaign copy may render
  inside it.
- Multiple simultaneous campaigns (video/image) across different zones on
  one display must play without stutter.
- Campaign/GenAI creative generation must target the correct dimensions for
  the selected display-type/zone and must respect phantom-area exclusions.
- Experience Rules can reference visitor attributes (via the token contract)
  to decide what plays — e.g. store data, MIST zone/beacon triggers,
  Dialogflow intents, visitor type (new vs. return), device type — mirroring
  the existing `Experience Module` rule categories.

## Open questions

- Which of the five default display types are actually needed for this
  prototype phase, vs. later?
- Is the Experience Rules engine itself in scope here, or just the templates
  it renders (rules may belong to a separate/future project)?
- Confirm the real requirements content from the Claude Cowork folder this
  was meant to be split from, and reconcile against this draft.
