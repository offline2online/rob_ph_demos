# experience-templates

Managing display types, elements, layouts, and templates — **System Two
(Display Types/Elements)** and **System Three (The Surface Layer)** from the
*Real-Time Personalised Surface Architecture Specification v1.2*.

Split out as its own independently-managed project, following the same
pattern as `menu-board-demo/`: developed on its own feature branch(es),
merged to `main` on its own schedule, not tied to `visitor-profile/`'s
release cadence. See root `CLAUDE.md` → "Live Visitor Profile & Experience
Templates" for the full split rationale.

See [`REQUIREMENTS.md`](./REQUIREMENTS.md) for the actual functional spec, and
[`../shared/interface-contract.md`](../shared/interface-contract.md) for the
maintained boundary with `visitor-profile/`.

## What's in this folder

| File | What it is |
|---|---|
| `REQUIREMENTS.md` | The functional spec — Systems Two & Three of the surface architecture spec v1.2 |
| `README.md` | This orientation doc |
| `prototype/index.html` | **Board mock-up.** Self-contained HTML/CSS/JS — no bundler, no CDN JavaScript — so it renders as-is from GitHub Pages, githack, or inside the HQ Admin iframe |
| `prototype/ExperienceTemplatesBoard.jsx` | The same four screens as a React 18 + Ant Design 5 component, matching `menu-board-demo/product-app`'s stack |
| `prototype/boardData.js` | Demo fixtures shared by the JSX component (shapes follow `REQUIREMENTS.md`) |

The prototype covers four screens: **Display Types** (library, filterable by
touch point, with slot-ownership and inheritance columns), **Playlists**
(rotation items with derived visibility deadlines), **Templates** (the surface
layer — composition, fold position, pairing overlay) and **Tier Preview** (the
render ladder side by side, which the spec calls the single most important
screen).

It is a **prototype, not a platform page** — it is iframed into HQ Admin, so it
renders no header, no sidebar, no breadcrumb and nothing `position: fixed`. It
starts at the page title and fills whatever frame the parent gives it. See the
`ph-designer` skill's `references/prototyping.md` for why.

The JSX is not wired to a build in this repo yet; it is the reference
implementation to drop into a Vite app (or into `menu-board-demo/product-app`'s
existing one). The HTML mock-up is what renders today.

Tracked on the Prototype Backlog board as **"Experience Templates"** (see
root `CLAUDE.md` → "Prototype Backlog") — that project's own Docs page
carries a live, board-native copy of `REQUIREMENTS.md`'s content
(`requirementsMd` field) and the interface contract (as an `interfaces`
collection record) — keep the repo files and those live records in sync.
