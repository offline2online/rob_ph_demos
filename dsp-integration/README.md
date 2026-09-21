# Display Types & DSP Integration: POC

This is a standalone proof of concept of the Display Types & DSP Integration
build. The engineering team will later merge it into the main Personalisation
Hub repo. Every dependency on the existing platform has a stand-in behind a
small interface.

Repo folder: `dsp-integration/` in `offline2online/rob_ph_demos`, merged to
`main` on 21 Sep 2026 (PR #176). It replaced `display-types-dsp-integration/`
(formerly `experience-templates/`), which was removed the same day; that
folder's history is on the tag `archive/display-types-dsp-integration`.

- **Spec:** [docs/dsp-integration/REQUIREMENTS.md](docs/dsp-integration/REQUIREMENTS.md)
  — the source of truth, mirrored into the board's Requirements block with
  `npm run board:sync` (see *Keeping the board in step*)
- **Brief:** [docs/dsp-integration/BUILD-BRIEF.md](docs/dsp-integration/BUILD-BRIEF.md)
- **Plan and progress:** [docs/dsp-integration/BUILD-PLAN.md](docs/dsp-integration/BUILD-PLAN.md)
- **API contract:** [openapi.yaml](docs/dsp-integration/api/openapi.yaml) and
  [API.md](docs/dsp-integration/api/API.md)
- **UI specification:** `prototype-reference/` (read-only). The look comes from
  the design skill in `.claude/skills/ph-designer/`.

## The hosted prototype

`prototype/` is a built, **read-only** copy of the admin UI, published at
<https://offline2online.github.io/rob_ph_demos/dsp-integration/prototype/>
so the screens can be opened from a URL and embedded in an iframe in HQ
Admin. It has no server: `apps/admin/scripts/capture-demo.mjs` takes a
snapshot of the API's read side, and `src/demo/staticApi.ts` answers from it
and refuses writes, saying so, rather than pretending a Save worked. Routes
live in the hash (`…/prototype/#/booking-schedule`) because a CDN has
nothing to rewrite paths with.

Refresh it after a change worth showing, with the dev API running:

```bash
npm run demo:capture -w @ph-dsp/admin
cd apps/admin && VITE_DEMO=1 npx vite build --base=/rob_ph_demos/dsp-integration/prototype/
cp -R dist/. ../../prototype/
```

## Keeping the board in step

The project's card on the [Prototype Backlog board](https://backlog-tracker-e4ed2.web.app/)
carries its own copy of `REQUIREMENTS.md` (`requirementsMd`) and `README.md`
(`readmeMd`). **The files here are the source of truth**; the board follows
them, in the same session a file changes:

```bash
npm run board:sync            # copy both files to the board, then verify
npm run board:sync -- --check # report drift without writing (exit 1 if stale)
```

It reads the files off disk, PATCHes the board, reads them back and fails
if they don't match byte for byte — so a spec never picks up errors from
being retyped. Set `BOARD_API_KEY` (the board automation user's password) in
`.env` first; without it the script stops and says so.

**Without the key, you can still tell whether the board has drifted.** Read
the project's docs over the board's MCP connector (`get_project_docs` with
`include: ["requirements", "readme"]`), which is large enough that the
result is saved to a file, and hand that file over:

```bash
npm run board:sync -- --check-mcp <saved-result.json>              # or - for stdin
npm run board:sync -- --check-mcp <saved-result.json> --print-diff # and show the diff
```

It reports each document's size on both sides, which sections moved, and
exits 1 if anything is behind — so an agent that can read the board but not
write to it can still say so, and say it in a way a script can act on. A
field missing from the read is reported as *not compared*, never as in
sync.

Exit codes are the same everywhere: **0** in sync, **1** drifted, **2**
couldn't run (no key, no file, unreadable input).

## Layout

| Path | What it is |
|---|---|
| `packages/types/` | Shared TypeScript types generated from `openapi.yaml` (`npm run gen:types`), plus shared catalogues: providers, targeting variables, slot owners |
| `apps/api/` | Node + Fastify + SQLite (`node:sqlite`). All paths are served under `/api`. |
| `apps/api/src/db/migrations/` | Versioned, reversible SQL migrations. `0001` is the stand-in for the existing platform's records; `0002`+ are this build's additive changes. |
| `apps/api/src/platform/` | Stand-ins for the existing platform: `DisplayTypeSource`, `PlaylistSource`, `DisplaySource`, `StoreSource`, `CampaignSource` (including slot bookings for the hand-off), `PlaybackSource`, `AssetStore`, `AudienceSource` |
| `apps/api/src/repos/` | This build's own records: partners (credentials encrypted), company advertiser settings, variable access, exchange |
| `apps/api/src/seed/` | Seed data, taken from the prototype's `model/data.js`, plus the sample bookings (`bookings.ts`, also `npm run db:bookings`) |
| `apps/dsp-mocks/` | Mock Google DV360, Amazon Ads and The Trade Desk APIs and OpenRTB bidders for testing, with a control API and a test page at `/`. The POC's DSP clients and the auction call these instead of real DSPs. |
| `apps/api/src/exchange/` | The exchange: OpenRTB 2.6 DOOH bid requests, pre-auction enforcement, the auction job, DSP creative queueing, hand-off to the campaign system, billing (dynamic VAC-d), and their CLIs |
| `packages/campaign-approval/` | Campaign approval as a drop-in module for the existing Campaigns section: adapter, state machine, service, routes, UI components, contract tests. See [CAMPAIGN-APPROVAL-INTEGRATION.md](docs/dsp-integration/CAMPAIGN-APPROVAL-INTEGRATION.md) |
| `apps/admin/` | Admin UI: React 18, Vite, Ant Design 5, Tailwind 4 and AG Grid (Alpine). It renders the content frame only, because it is iframed into HQ Admin. |
| `apps/admin/src/shared/` | Shared UI: save bar, draft state, unsaved-changes guard, delete dialog, InfoTip, list layout, collapsible panel, summary chips, AG Grid wrapper, column filters (`TableFilters.tsx` — the platform's search / funnel pattern; never hand-roll one) |
| `apps/admin/src/features/display-types/` | Display Types screen: list, form, panels, slot assignment, delete |
| `apps/admin/src/features/playlist-management/` | Playlist Management screen: rename and delete |
| `apps/admin/src/features/dsp-integration/` | DSP Integration section: list, one shared draft, Exchange settings, Advertiser settings (with the Auction schedule), Shared Targeting Variables, DSP pages and Add DSP |
| `apps/admin/src/features/booking-schedule/` | Booking schedule: its own page (opened in a new tab from Available Inventory or an advertiser), with filters, campaign-type summary and daily/weekly/monthly views |
| `apps/admin/src/features/advertisers/` | Advertisers / Inventory: the advertisers table (admin edits approval and floor multipliers) and Available Inventory, where a position's **Assigned to** (DSPs, named advertisers or the whitelist) and **Targeting supported** are set. Marketing users read both |
| `apps/admin/src/features/campaign-status/` | STAND-IN "Campaign Status" table and campaign page showing the approval components end to end; deleted on integration |
| `apps/admin/src/demo/`, `apps/admin/scripts/capture-demo.mjs` | The hosted prototype: a snapshot of the API's read side, and the shim that answers from it and refuses writes. Built into `prototype/` (see above) |
| `apps/admin/public/demo/` | That snapshot and the creatives it points at, committed so the demo can be rebuilt without a running API |
| `scripts/sync-board-docs.mjs` | `npm run board:sync` — pushes `REQUIREMENTS.md` and `README.md` to the board's Docs page and verifies them (see above) |

## Running it

```bash
cp .env.example .env
```

Set `PH_SECRETS_KEY` in `.env`; the file explains how to generate it. Then:

```bash
npm install
```

```bash
npm run dev:api
```

```bash
npm run dev:admin
```

```bash
npm run dev:mocks
```

```bash
npm test
```

- `DSP_INTEGRATION_ENABLED` is the `dspIntegration` feature flag, and it is
  off by default. When it is off:
  - DSP Integration, Advertisers and Slot assignment are hidden.
  - The Partner API and the new admin endpoints return 404.
- The Partner API (`/api/v1`) takes one static bearer token per seeded
  partner: `poc-token-google-dv360` or `poc-token-amazon-dsp` by default, or
  set your own with `PARTNER_TOKENS`.
- DSP connections: Google DSP (DV360), Amazon Ads DSP and The Trade Desk
  each have a real-shaped client (`apps/api/src/dsp/`) pointed at the mock
  DSP service. Amazon is seeded to reject its refresh token; accept it on the
  mock's test page to connect.
- `npm run dev:mocks` starts the mock DSP service on port 4100, with its test
  page at http://127.0.0.1:4100/. Use it to change each mock DSP's seats,
  advertisers, auth failures and bidder behaviour, then press **Re-test
  connection** on the DSP's page.
- The SSP auction runs as a scheduled job inside `npm run dev:api`. Each
  play window is cleared at its auction cutoff, and bids and reservations are
  taken from when bidding opens until then, for approved and activated
  campaigns only (Advertiser settings → Auction schedule; defaults 18:00 UTC,
  opening 7 days before, 24-hour windows). To clear one window
  now, with the mock DSP service running:

  ```bash
  npm run auction:run -- --window=2026-09-21
  ```

  Leave out `--window` for the next window that can be sold. A DSP's first
  bid with a new creative is discarded and the creative queued for
  approval; it competes from the next window once approved.
- Winning and reserved windows are handed off to the stand-in campaign
  system (booked into the slot for the window). After a window ends, it is
  billed against the stand-in playback data. To bill any ended windows
  and print every billing line item:

  ```bash
  npm run billing:print
  ```

  The seed includes one played window (15 Sep 2026).
- **Sample bookings.** A fresh database is seeded with three booked windows
  for every advertiser a connected DSP brings — some reserved at an agreed
  price, some won at auction — each with its own approved and activated
  campaign, so the booking schedule and its revenue tables have something in
  them. To add them to a database that already exists (they are additive,
  and skip any window that is taken):

  ```bash
  npm run db:bookings
  ```
- `POC_ROLE` sets the stand-in session: `hq_admin` (everything, including DSP
  Integration, saving advertiser settings and approving), `hq_marketing`
  (Display Types, Playlist Management, Advertisers / Inventory read-only, and
  Campaign Status) or `hq_helpdesk` (none of it).
- The API seeds an empty database on its first start. Delete
  `data/poc.sqlite` and `data/assets/` to reseed.
