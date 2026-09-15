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

| Path | What it is |
|---|---|
| `REQUIREMENTS.md` | The functional spec — Systems Two & Three of the surface architecture spec v1.2 |
| `README.md` | This orientation doc |
| `app/` | Vite + React source for the Display Types & Playlist Management prototype |
| `app/src/DisplayTypesAndPlaylists.jsx` | The whole prototype — display types, experience layout, playlists, partners/DSPs |
| `prototype/` | **Built output, committed.** What GitHub Pages and a githack branch preview actually serve |

`app/` builds into `prototype/` (`npm install && npm run build` inside `app/`),
the same arrangement `menu-board-demo/product-app` → `menu-board-demo/product`
uses, so the repo keeps its no-server-side-build story. **Rebuild and commit
`prototype/` whenever `app/src` changes** — the committed bundle is the
deliverable, and a stale one is the failure mode here.

Four screens, in the left-hand nav:

- **Display Types / Elements** — the display type editor: canvas/resolution or
  responsive element config, playlist settings, phantom zone, enabled features,
  multi-zone layout, and **slot assignment** against the capped rotation.
- **Experience Layout** — templates composed of display types, with the pairing
  overlay and per-breakpoint preview.
- **Playlist Management** — playlists, items and the display types using them.
- **Partners / DSPs** — where advertiser demand comes from (see below).

### Partners / DSPs

A capped rotation is what makes a position sellable, but a position is only
sellable if demand can actually reach it. That demand arrives through a partner
DSP, so the DSP is the connection and the advertisers on it are what a position
can be reserved to. Two providers are supported:

- **Google DSP** (Display & Video 360) — partner ID, advertiser ID, and either a
  service-account JSON key or an OAuth 2.0 client; optional Ad Manager network
  code for the exchange side.
- **Amazon Ads DSP** (Amazon Ads API) — region (which fixes the API endpoint),
  LWA client ID/secret, refresh token, profile ID, advertiser ID and entity ID.

Alongside **Direct / house** — advertisers sold direct, no DSP and no auction,
always present and not disconnectable.

Each partner also carries its inventory rules (auction type, floor CPM and
currency, permitted categories, competitive exclusions), the advertisers pulled
from it on connect, and a table of every display-type position currently sold
through it.

Design decisions worth keeping:

- **Credentials live on the partner, never on a display type or a slot.**
  Rotating a key fixes every position at once.
- **A new partner is created as "Not connected"** and stays out of the reserved
  list until its credentials test, so a position can never be sold to demand
  that cannot be delivered.
- **An advertiser belongs to one partner**, so moving a position to a different
  partner clears the reservation rather than carrying a name that partner
  cannot serve.
- **Disconnecting keeps the record.** Positions pointing at it go red and offer
  a "Fix connection" jump, rather than silently reverting to Headquarters.
- **Slot ownership cannot be backfilled.** An RTB position stamps the partner at
  write time and the winning advertiser at render time.

It is a **prototype, not a platform page** — iframed into HQ Admin, so it
renders no header, no sidebar, no breadcrumb and nothing `position: fixed`. It
starts at the page title and fills whatever frame the parent gives it. See the
`ph-designer` skill's `references/prototyping.md`.

Tracked on the Prototype Backlog board as **"Experience Templates"** (see
root `CLAUDE.md` → "Prototype Backlog") — that project's own Docs page
carries a live, board-native copy of `REQUIREMENTS.md`'s content
(`requirementsMd` field) and the interface contract (as an `interfaces`
collection record) — keep the repo files and those live records in sync.
