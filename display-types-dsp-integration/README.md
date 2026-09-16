# Display Types & DSP Integration

Managing display types, elements, playlists, and the advertising
partner/DSP connections that fill sold slots — **System Two (Display
Types/Elements)** and **System Three (The Surface Layer)** from the
*Real-Time Personalised Surface Architecture Specification v1.2* — and the
exchange that sells the retailer's screens (REQUIREMENTS §6–§7).

Folder: `display-types-dsp-integration/`. Renamed from
`experience-templates/` when the first release narrowed to display types,
playlists and DSP partners.

**Call it "Display Types" in prose** — that is the agreed short form, and it
is what the rest of this repo's docs use. The full name is kept for this
file's title, the backlog board's project doc, and the interface contract's
title. Capitalised it means the project; lower-case "display types" means
the System Two object the project manages.

Split out as its own independently-managed project, following the same
pattern as `menu-board-demo/`: developed on its own feature branch(es),
merged to `main` on its own schedule, not tied to `visitor-profile/`'s
release cadence. See root `CLAUDE.md` → "Live Visitor Profile and Display
Types & DSP Integration" for the full split rationale.

See [`REQUIREMENTS.md`](./REQUIREMENTS.md) for the functional spec (§8 is the
data model), and [`../shared/interface-contract.md`](../shared/interface-contract.md)
for the maintained boundary with `visitor-profile/`.

## Live prototype

**https://claude.ai/artifact/2cc25ZNLFP5AtQk2KmeY98** — the running prototype,
republished from `prototype/` on each change. Private to its owner's account
until shared from the page's own share menu.

Also served from the repo itself, from whichever branch you want to look at:
`https://rawcdn.githack.com/offline2online/rob_ph_demos/<branch>/display-types-dsp-integration/prototype/index.html`
(`rawcdn`, not `raw` — see root `CLAUDE.md` for why).

## What's in this folder

| Path | What it is |
|---|---|
| `REQUIREMENTS.md` | The functional spec — Systems Two & Three of the surface architecture spec v1.2, the sell side, and the data model (§8) |
| `README.md` | This orientation doc |
| `app/` | Vite + React source |
| `app/src/App.jsx` | The content frame: nav, top-level state, the `SHOW_EXPERIENCE_LAYOUT` gate |
| `app/src/ui.jsx` | Design tokens and primitives, from the `ph-designer` skill's measured values |
| `app/src/model/schema.js` | **The PH-aligned data model** — display type, playlist, item, scene factories with the spec's field names; deadline and slot helpers |
| `app/src/model/sellside.js` | Partners/DSPs, targeting registry, exchange settings |
| `app/src/model/data.js` | Sample data, built only through the factories |
| `app/src/views/*.jsx` | One file per screen (below) |
| `app/src/assets.js` | The connected-state image |
| `prototype/` | **Built output, committed.** What GitHub Pages, a githack branch preview and the Artifact actually serve |

`app/` builds into `prototype/` (`npm install && npm run build` inside `app/`),
the same arrangement `menu-board-demo/product-app` → `menu-board-demo/product`
uses, so the repo keeps its no-server-side-build story. **Rebuild and commit
`prototype/` whenever `app/src` changes** — the committed bundle is the
deliverable, and a stale one is the failure mode here.

## The data model is the platform's

The records the prototype edits are Personalisation Hub's **existing**
display-type and playlist records (spec §5.4 / §3, and the live HQ Admin
*Display Types Details* form), with this project's additions under one
`phExtensions` sub-object so the base record stays byte-compatible. The
spec's own field names are used verbatim —
`playlistSettings.maximumCampaignsPlayedInRotation` (−1 = unlimited),
`items[].priority` / `playbackDuration` / `campaignType` /
`campaignCreativeSettings.{default,selected,unselected}`, `text[].variants`.
`null` on a setting means "inherit the platform default", rendered as
"Default (…)" exactly as the platform form does. The Display Types and Playlist
screens have a **Data (JSON)** panel or tab showing the record they edit. Full shape in
`REQUIREMENTS.md` §8; canonical definition in `app/src/model/schema.js`.

## Screens

Two groups in the nav. **Displays**:

- **Display Types / Elements** — the platform's Display Types Details form
  (touch point, name, description, canvas size, background, default
  playlist, Playlist Settings, QR Control (Phantom Zone), Display Type
  Image) plus what this project adds: Enabled Features, Multi-Zone Layout
  with a trust zone per zone, slot assignment against the capped rotation
  (owner, partner/advertiser, store quota, trust zone), inheritance badges,
  the displays using the type, and the JSON record.
- **Playlist Management** — playlists scheduled against store hours; items
  with priority, duration, campaign type and the three creative states,
  each showing its rotation position's visibility deadline; a scene editor
  (background, positioned text elements, animation, trust zone, variants).
- ~~**Experience Layout**~~ — templates, the surface layer. Built and
  working but **out of this release**, gated by `SHOW_EXPERIENCE_LAYOUT` in
  `app/src/App.jsx`; with the flag off `views/LayoutComposer.jsx`
  tree-shakes out of the bundle. One consequence: QR pairing on web is
  configured on the Layout template, so **web pairing has no home in this
  release**.

**Sell side**:

- **Partners / DSPs** — **Exchange settings** (seller of record,
  `sellers.json`, SupplyChain, OpenRTB DOOH options, pre-auction
  enforcement, play window, audience currency, reporting floor, bidder
  readiness); **Advertiser lists** (company whitelist/blacklist, who adopts
  and who has unlinked); per partner: outbound credentials, inbound bidder
  config, deals, inventory rules, **targeting attributes the partner may
  use** (visitor attributes off by default, contributed attributes marked),
  lists with unlink/relink, advertisers with the **approval-required**
  flag, positions sold and reservations. Tier 1 providers (Google DSP,
  Amazon Ads DSP, The Trade Desk, in onboarding order) and a tier-2
  **PH-native partner** (Blackmores is the worked example).

**Removed on 16 Sep 2026, not asked for**: a Render Preview screen (tier,
deadline, pairing and channel previews), a Campaigns & Reservations screen
(campaign sets with a rule evaluator, positions, asset cache state, approval
queue), an Inventory & Venues screen (venue/screen metadata, sellable
inventory, forecast, bid request) and a Delivery & Analytics screen
(playback records, proof of play, partner feed — analytics has its own
section elsewhere). All recoverable from git history (commit `cd5e875`) if
any of it is wanted later; the requirements still describe them as spec.

Design decisions worth keeping:

- **Credentials live on the partner, never on a display type or a slot.**
- **A new partner is created as "Not connected"** and stays out of the
  reserved list until its credentials test.
- **An advertiser belongs to one partner**, so moving a position clears the
  reservation rather than carrying a name the new partner cannot serve.
- **Disconnecting keeps the record.** Positions pointing at it go red and
  offer a "Fix connection" jump.
- **Inheritance matches display types**: company default, per-partner
  override, and the override is never reset by a later central edit.
  Unlinking copies the lists down; relinking discards.
- **The blacklist is not a mode** — it subtracts from every outcome on the
  bid, no position can opt out, a blocked advertiser is withdrawn from the
  picker and a position already reserved to it is flagged in place.
- **A rule on an unresolved attribute is false, not pending** (REQUIREMENTS
  §6) — the resolution rule is spec only in this release.
- **Never dark**: targeted → baseline → next eligible HQ campaign.
- **Slot ownership cannot be backfilled.** Partner at write time, winning
  advertiser at render time.

It is a **prototype, not a platform page** — iframed into HQ Admin, so it
renders no header, no sidebar, no breadcrumb and nothing `position: fixed`.
It starts at the page title and fills whatever frame the parent gives it,
with no horizontal scroll at the frame's ~1163px width. See the
`ph-designer` skill's `references/prototyping.md`.

## Verifying a change

```bash
cd display-types-dsp-integration/app && npm install && npm run build
```

then serve `../prototype/` statically and drive it with Playwright (the
sandbox blocks `fonts.googleapis.com`, so Material Symbols render as their
ligature names there — not a defect; intercept the font CSS request and
fulfil it empty to keep the layout honest). Check every nav item and tab for
page errors and for `scrollWidth > clientWidth` at 1163px.

Tracked on the Prototype Backlog board as
**"Display Types & DSP Integration"** (see root `CLAUDE.md` → "Prototype
Backlog") — that project's own Docs page carries a live, board-native copy
of `REQUIREMENTS.md` (`requirementsMd`), this README (`readmeMd`) and the
interface contract (as an `interfaces` collection record). Keep the repo
files and those live records in sync; the PH Agent Console MCP tools
(`set_project_requirements`, `set_project_readme`, `update_interface`)
write them.
