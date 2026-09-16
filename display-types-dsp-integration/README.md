# Display Types & DSP Integration

Managing display types, elements, playlists, and the advertising
partner/DSP connections that fill sold slots — **System Two (Display
Types/Elements)** and **System Three (The Surface Layer)** from the
*Real-Time Personalised Surface Architecture Specification v1.2*.

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

See [`REQUIREMENTS.md`](./REQUIREMENTS.md) for the actual functional spec, and
[`../shared/interface-contract.md`](../shared/interface-contract.md) for the
maintained boundary with `visitor-profile/`.

## Live prototype

**https://claude.ai/artifact/2cc25ZNLFP5AtQk2KmeY98** — the running prototype,
rebuilt from `prototype/` on each change. Private to its owner's account until
shared from the page's own share menu.

Also served from the repo itself, from whichever branch you want to look at:
`https://rawcdn.githack.com/offline2online/rob_ph_demos/<branch>/display-types-dsp-integration/prototype/index.html`
(`rawcdn`, not `raw` — see root `CLAUDE.md` for why).

## What's in this folder

| Path | What it is |
|---|---|
| `REQUIREMENTS.md` | The functional spec — Systems Two & Three of the surface architecture spec v1.2 |
| `README.md` | This orientation doc |
| `app/` | Vite + React source for the Display Types & Playlist Management prototype |
| `app/src/DisplayTypesAndPlaylists.jsx` | The whole prototype — display types, playlists, partners/DSPs (plus experience layout, gated off) |
| `prototype/` | **Built output, committed.** What GitHub Pages and a githack branch preview actually serve |

`app/` builds into `prototype/` (`npm install && npm run build` inside `app/`),
the same arrangement `menu-board-demo/product-app` → `menu-board-demo/product`
uses, so the repo keeps its no-server-side-build story. **Rebuild and commit
`prototype/` whenever `app/src` changes** — the committed bundle is the
deliverable, and a stale one is the failure mode here.

### Release scope

The first release is **three** screens. Experience Layout — templates, the
surface layer — is built and working but deliberately out of it, gated by
`SHOW_EXPERIENCE_LAYOUT` at the top of `app/src/DisplayTypesAndPlaylists.jsx`.
Set that to `true` and the nav item, the route and the template references come
back with no other change; it is a scope decision, not deleted code. With the
flag off the composer tree-shakes out of the bundle entirely.

In the nav:

- **Display Types / Elements** — the display type editor: canvas/resolution or
  responsive element config, playlist settings, phantom zone, enabled features,
  multi-zone layout, and **slot assignment** against the capped rotation.
- **Playlist Management** — playlists, items and the display types using them.
- **Partners / DSPs** — where advertiser demand comes from (see below).
- ~~**Experience Layout**~~ — out of scope for the first release, per above.

One consequence worth knowing: QR Control only appears on physical touch points
(signage, kiosk), because on web the pairing overlay is configured on the Layout
template. With Experience Layout out of scope, **web pairing has no home in the
first release** — it arrives when the composer does.

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
from it on connect, its **advertiser whitelist and blacklist**, and a table of
every display-type position currently sold through it.

The lists are defined **centrally** (Partners / DSPs → Advertiser lists) and
adopted by every connected DSP. A partner can unlink and keep its own —
unlinking copies the inherited lists down, relinking discards them, and the
central screen shows which partners adopt and which have their own.

A position's **Assigned to** picker then offers open RTB, whitelist-only, or
one named advertiser. **The blacklist is not a mode** — it subtracts from every
outcome and no position can opt out, so a blocked advertiser is withdrawn from
the picker and any position already reserved to it is flagged as unable to
fill.

The **API and campaign model** a partner integrates against — two API tiers,
baseline plus targeted campaigns, per-partner targeting permissions, the
approval flag, playback analytics, and the play-window model for signage
programmatic — is specified in [`REQUIREMENTS.md`](./REQUIREMENTS.md) §6. The
prototype currently covers the connection and slot-assignment half of that;
the campaign and inventory half is spec only.

**The supply side** — how in-store screens become buyable by the programmatic
market at all — is [`REQUIREMENTS.md`](./REQUIREMENTS.md) §7: the supply
architecture, what a DOOH bid request has to carry, proof-of-play billing, and
why pre-caching is the first qualifying question for any exchange. Note which
side each platform sits on: **The Trade Desk and DV360 are DSPs (demand)**;
Google Ad Manager is the SSP. PH is the publisher and sits on the sell side.

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
- **Inheritance matches display types**: company default, per-partner override,
  and the override is never reset by a later central edit.
- **The two lists are mutually exclusive**, and both take free text — a DSP's
  full advertiser universe is not enumerable from here, so a client must be
  able to block a competitor we have never seen a bid from.
- **Slot ownership cannot be backfilled.** An RTB position stamps the partner at
  write time and the winning advertiser at render time.

It is a **prototype, not a platform page** — iframed into HQ Admin, so it
renders no header, no sidebar, no breadcrumb and nothing `position: fixed`. It
starts at the page title and fills whatever frame the parent gives it. See the
`ph-designer` skill's `references/prototyping.md`.

Tracked on the Prototype Backlog board as
**"Display Types & DSP Integration"** (see root `CLAUDE.md` → "Prototype
Backlog") — that project's own Docs page
carries a live, board-native copy of `REQUIREMENTS.md`'s content
(`requirementsMd` field) and the interface contract (as an `interfaces`
collection record) — keep the repo files and those live records in sync.
