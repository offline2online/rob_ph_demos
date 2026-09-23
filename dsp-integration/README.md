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
- **Boundaries with PH Core:** [PH-CORE-BOUNDARIES.md](docs/dsp-integration/api/PH-CORE-BOUNDARIES.md)
  — every seam this build needs from the existing platform, what each must
  guarantee, and what engineering replaces on integration
- **Security and performance:** [SECURITY-PERFORMANCE.md](docs/dsp-integration/api/SECURITY-PERFORMANCE.md)
  — the 23 Sep 2026 review: findings, fixes, limits and measured throughput
- **UI specification:** `prototype-reference/` (read-only). The look comes from
  the design skill in `.claude/skills/ph-designer/`.

## The hosted prototype

`prototype/` is a built copy of the admin UI, published at
<https://offline2online.github.io/rob_ph_demos/dsp-integration/prototype/>
so the screens can be opened from a URL and embedded in an iframe in HQ
Admin. **It saves** (23 Sep 2026): GitHub Pages only serves files, so the
API runs as a Cloud Function in the `backlog-tracker-e4ed2` Firebase project
(`deploy/firebase/`, deployed by `.github/workflows/dsp-api-deploy.yml` —
see [deploy/firebase/README.md](deploy/firebase/README.md)), and on start-up
`src/demo/staticApi.ts` sends every `/api` call there. Everyone using the
link shares one set of data, and **there is no login** — every visitor is
the stand-in HQ admin — so it is for demo data only; the workflow's
`reset = RESET` input restores the demo estate.

If that API doesn't answer, the page falls back to a **read-only snapshot**
(`apps/admin/scripts/capture-demo.mjs` captures the API's read side at
build time) and refuses writes, saying so, rather than pretending a Save
worked. Routes live in the hash (`…/prototype/#/booking-schedule`) because a
CDN has nothing to rewrite paths with.

**It is rebuilt for you.** `.github/workflows/dsp-prototype.yml` runs
`scripts/rebuild-prototype.sh` on a runner for `main` and for
`deploy/dsp-integration` — on a push that touches the source, on a
dispatch from the board automation the moment it puts a ticket on the
train, reverts one off it or merges a train, and every ten minutes as a
safety net — and commits the result to the branch it built from. The
bundle is a checked-in build, so without this a ticket's change was
invisible to its own test link until someone rebuilt by hand; on 21–22 Sep
2026 three tickets failed testing that way and two trains "went live"
without the live site changing. Whether a link shows a change yet is in
`prototype/build-info.json` next to it: `commit` is what the bundle was
built from, and `sourceStamp` is a hash of the source tree, which is how
the script knows there is nothing to do.

**A test link must point at a commit, not the branch.** githack caches a
branch URL: `index.html` refreshes within minutes, but the fixed-path
`demo/api-snapshot.json` was still serving the 21 Sep 10:19 capture a day
later — a fresh bundle over a day-old snapshot, which is what three
"Failed testing" rounds were actually looking at. A commit URL is
immutable, so caching it is correct. After the workflow pushes a rebuild
of a train it runs `npm run board:tickets -- --relink-prototype <sha>
--branch <train>`, which re-points every testing card on that train at
`https://rawcdn.githack.com/offline2online/rob_ph_demos/<sha>/dsp-integration/prototype/…`
and says so on the card.

To rebuild by hand (no `.env` needed — it starts the API on a spare port
against a throwaway database, seeds it, captures the snapshot, builds, and
replaces `prototype/`):

```bash
scripts/rebuild-prototype.sh            # only if the source moved since the last build
scripts/rebuild-prototype.sh --force    # regardless
scripts/rebuild-prototype.sh --check    # exit 1 if stale, write nothing
```

If you push a rebuild to the train yourself, the same rule as any other
hand-pushed train commit applies (root `CLAUDE.md`, "Putting a commit on
a deployment train by hand") — though a rebuild has no ticket to stamp, so
it simply rides along with the tickets that do.

The base is **relative**, so the bundle works wherever it is served from —
GitHub Pages, a githack preview of a branch, or an iframe pointed at either.
Anything opening a new tab must use `externalUrl()` for the same reason: a
bare `/booking-schedule` asks the host for a page it hasn't got.

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

### Moving tickets when the work reached main another way

The board's own **Deploy to Main** action merges a project's `deployBranch`
and moves its cards; the MCP connector deliberately refuses status writes.
Neither helps when work reached `main` some other way — as this POC did,
through PR #176 — so the cards sit in Backlog with nothing able to move
them. That is what this is for:

```bash
npm run board:tickets                                          # what is where; writes nothing
npm run board:tickets -- --from backlog --to published-live    # dry run: names what would move
npm run board:tickets -- --from backlog --to published-live --yes
npm run board:tickets -- --deploy-branch deploy/dsp-integration --yes
```

Writes need `--yes`, and every move is read back afterwards. Statuses are
`backlog`, `ready-for-testing`, `ready-to-publish`, `published-live`,
`archived`. It needs `BOARD_API_KEY` too — the board is behind sign-in, so
nothing here can even read it without the key.

## Layout

| Path | What it is |
|---|---|
| `packages/types/` | Shared TypeScript types generated from `openapi.yaml` (`npm run gen:types`), plus shared catalogues: providers, targeting variables, slot owners, and the reserved §9 canonical analytics event schema v1 (`analyticsEvent.ts` — nothing produces events yet) |
| `apps/api/` | Node + Fastify + SQLite (`node:sqlite`). All paths are served under `/api`. |
| `apps/api/src/db/migrations/` | Versioned, reversible SQL migrations. `0001` is the stand-in for the existing platform's records; `0002`+ are this build's additive changes. `0020` adds hot-path indexes, `0021` makes "one live winner per position and window" a database guarantee, `0022` reserves the §9.3 instance identity (unused) |
| `apps/api/src/http/rateLimit.ts` | The Partner API's per-partner token bucket (429 `rate_limited`) |
| `apps/api/bench/load.ts` | `npm run bench` — load benchmark for the Partner API and the auction, at demo scale or a synthetic large estate (see SECURITY-PERFORMANCE.md) |
| `apps/api/src/platform/` | Stand-ins for the existing platform: `DisplayTypeSource`, `PlaylistSource`, `DisplaySource`, `StoreSource`, `CampaignSource` (including slot bookings for the hand-off), `PlaybackSource`, `AssetStore`, `AudienceSource` |
| `apps/api/src/repos/` | This build's own records: partners (credentials encrypted), company advertiser settings, variable access, exchange, buyers lists (private-auction deals) |
| `apps/api/src/seed/` | Seed data, taken from the prototype's `model/data.js` (the minimal base the tests count), plus the sample bookings (`bookings.ts`, also `npm run db:bookings`) and the **demo estate** (`demo.ts`, also `npm run db:demo`): four advertiser slots on Landscape and three on Portrait, twelve stores, three DSPs with a dozen advertisers, campaigns in every approval state and bookings in every layer on every position. A fresh database gets it by default; `rm data/poc.sqlite` (or `npm run db:demo`) to see it on an existing one |
| `apps/dsp-mocks/` | Mock Google DV360, Amazon Ads and The Trade Desk APIs and OpenRTB bidders for testing, with a control API and a test page at `/`. The POC's DSP clients and the auction call these instead of real DSPs. |
| `apps/api/src/exchange/` | The exchange: OpenRTB 2.6 DOOH bid requests, pre-auction enforcement, the auction job, DSP creative queueing, hand-off to the campaign system, billing (dynamic VAC-d), and their CLIs |
| `packages/campaign-approval/` | Campaign approval as a drop-in module for the existing Campaigns section: adapter, state machine, service, routes, UI components, contract tests. See [CAMPAIGN-APPROVAL-INTEGRATION.md](docs/dsp-integration/CAMPAIGN-APPROVAL-INTEGRATION.md) |
| `apps/admin/` | Admin UI: React 18, Vite, Ant Design 5, Tailwind 4 and AG Grid (Alpine). It renders the content frame only, because it is iframed into HQ Admin. |
| `apps/admin/src/shared/` | Shared UI: save bar, draft state, unsaved-changes guard, delete dialog, InfoTip, list layout, collapsible panel, summary chips, AG Grid wrapper, column filters (`TableFilters.tsx` — the platform's search / funnel pattern; never hand-roll one) |
| `apps/admin/src/features/display-types/` | Display Types screen: list, form, panels, slot assignment, delete |
| `apps/admin/src/features/playlist-management/` | Playlist Management screen: rename and delete |
| `apps/admin/src/features/dsp-integration/` | DSP Integration section: list, one shared draft, Exchange settings, Advertiser settings (with the Auction schedule), Shared Targeting Variables, DSP pages and Add DSP |
| `apps/admin/src/features/booking-schedule/` | Booking schedule: its own page (opened in a new tab from Available Inventory or an advertiser), with filters, campaign-type summary and daily/weekly/monthly views |
| `apps/admin/src/features/advertisers/` | Advertisers / Inventory: the advertisers table (admin edits approval and floor multipliers) and Available Inventory, where a position's **Assigned to** (DSPs, named advertisers, a buyers list's private auction, or the whitelist) and **Targeting supported** are set; underneath, the **Buyers lists** table creates/edits/deletes the reusable private-auction deals (`BuyersListModal.tsx`, `BuyersListsTable.tsx` — spec "Private auctions (buyers lists)"). Marketing users read all of it |
| `apps/admin/src/features/campaign-status/` | STAND-IN "Campaign Status" table and campaign page showing the approval components end to end; deleted on integration |
| `apps/admin/src/demo/`, `apps/admin/scripts/capture-demo.mjs` | The hosted prototype: the shim that sends `/api` calls to the hosted API (`VITE_API_URL`), or — if it doesn't answer — answers from a snapshot of the API's read side and refuses writes. Built into `prototype/` (see above) |
| `deploy/firebase/` | The hosted API: the POC API and mock DSPs as a Cloud Function (`functions/src/host.ts`, `index.ts`), its bundle build (`build.mjs`) and a local stand-in (`local-server.ts`). See its README |
| `apps/admin/public/demo/` | That snapshot and the creatives it points at, committed so the demo can be rebuilt without a running API |
| `scripts/sync-board-docs.mjs` | `npm run board:sync` — pushes `REQUIREMENTS.md` and `README.md` to the board's Docs page and verifies them (see above) |
| `scripts/board-tickets.mjs` | `npm run board:tickets` — reports where this project's tickets are, and moves them between statuses when work reached `main` outside the board's own Deploy to Main (see above) |

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
  set your own with `PARTNER_TOKENS`. Those defaults are public, so with
  `NODE_ENV=production` the API refuses to start unless `PARTNER_TOKENS` is
  set to tokens of your own. Each partner may make 50 requests/s (bursts of
  100; `PARTNER_RATE_PER_SECOND`, `PARTNER_RATE_BURST`), then gets
  `429 rate_limited`.
- `npm run bench` measures the Partner API and the auction under load
  (`-- --scale=250 --bidder-ms=80` for a large estate with realistic DSP
  latency); results and what they mean are in
  [SECURITY-PERFORMANCE.md](docs/dsp-integration/api/SECURITY-PERFORMANCE.md).
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
- **Rejected-campaign retention** also runs as a scheduled job inside
  `npm run dev:api` (`startCampaignRetentionScheduler`,
  `apps/api/src/exchange/scheduler.ts`, daily by default): a Rejected
  campaign and its assets are deleted once the rejection is older than
  `Config.rejectedCampaignRetentionDays` (default 30) — never its audit
  trail. See `apps/api/src/domain/campaignRetention.ts` and REQUIREMENTS.md
  §3 *Enforcement and audit*.
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
