# experience-templates

Managing display types, elements, layouts, and templates — **System Two
(Display Types/Elements)** and **System Three (The Surface Layer)** from the
*Real-Time Personalised Surface Architecture Specification v1.2*.

Split out as its own independently-managed project, following the same
pattern as `menu-board-demo/`: developed on its own feature branch(es),
merged to `main` on its own schedule, not tied to `visitor-profile/`'s
release cadence. See root `CLAUDE.md` → "Live Visitor Profile & Experience
Templates" for the full split rationale.

See [`REQUIREMENTS.md`](./REQUIREMENTS.md) for the actual functional spec —
this project is still spec-only (no implementation files yet). See
[`../shared/interface-contract.md`](../shared/interface-contract.md) for the
maintained boundary with `visitor-profile/`.

Tracked on the Prototype Backlog board as **"Experience Templates"** (see
root `CLAUDE.md` → "Prototype Backlog") — that project's own Docs page
carries a live, board-native copy of `REQUIREMENTS.md`'s content
(`requirementsMd` field) and the interface contract (as an `interfaces`
collection record) — keep the repo files and those live records in sync.
