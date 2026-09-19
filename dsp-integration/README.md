# Display Types & DSP Integration: POC

This is a standalone proof of concept of the Display Types & DSP Integration
build. The engineering team will later merge it into the main Personalisation
Hub repo. Every dependency on the existing platform has a stand-in behind a
small interface.

- **Spec:** [docs/dsp-integration/REQUIREMENTS.md](docs/dsp-integration/REQUIREMENTS.md)
- **Brief:** [docs/dsp-integration/BUILD-BRIEF.md](docs/dsp-integration/BUILD-BRIEF.md)
- **Plan and progress:** [docs/dsp-integration/BUILD-PLAN.md](docs/dsp-integration/BUILD-PLAN.md)
- **API contract:** [openapi.yaml](docs/dsp-integration/api/openapi.yaml) and
  [API.md](docs/dsp-integration/api/API.md)
- **UI specification:** `prototype-reference/` (read-only). The look comes from
  the design skill in `.claude/skills/ph-designer/`.

## Layout

| Path | What it is |
|---|---|
| `packages/types/` | Shared TypeScript types generated from `openapi.yaml` (`npm run gen:types`), plus shared catalogues: providers, targeting variables, slot owners |
| `apps/api/` | Node + Fastify + SQLite (`node:sqlite`). All paths are served under `/api`. |
| `apps/api/src/db/migrations/` | Versioned, reversible SQL migrations. `0001` is the stand-in for the existing platform's records; `0002`+ are this build's additive changes. |
| `apps/api/src/platform/` | Stand-ins for the existing platform: `DisplayTypeSource`, `PlaylistSource`, `DisplaySource`, `StoreSource`, `CampaignSource` (including slot bookings for the hand-off), `PlaybackSource`, `AssetStore`, `AudienceSource` |
| `apps/api/src/repos/` | This build's own records: partners (credentials encrypted), company advertiser settings, variable access, exchange |
| `apps/api/src/seed/` | Seed data, taken from the prototype's `model/data.js` |
| `apps/dsp-mocks/` | Mock Google DV360, Amazon Ads and The Trade Desk APIs and OpenRTB bidders for testing, with a control API and a test page at `/`. The POC's DSP clients and the auction call these instead of real DSPs. |
| `apps/api/src/exchange/` | The exchange: OpenRTB 2.6 DOOH bid requests, pre-auction enforcement, the auction job, DSP creative queueing, hand-off to the campaign system, billing (dynamic VAC-d), and their CLIs |
| `packages/campaign-approval/` | Campaign approval as a drop-in module for the existing Campaigns section: adapter, state machine, service, routes, UI components, contract tests. See [CAMPAIGN-APPROVAL-INTEGRATION.md](docs/dsp-integration/CAMPAIGN-APPROVAL-INTEGRATION.md) |
| `apps/admin/` | Admin UI: React 18, Vite, Ant Design 5, Tailwind 4 and AG Grid (Alpine). It renders the content frame only, because it is iframed into HQ Admin. |
| `apps/admin/src/shared/` | Shared UI: save bar, draft state, unsaved-changes guard, delete dialog, InfoTip, list layout, collapsible panel, summary chips, AG Grid wrapper |
| `apps/admin/src/features/display-types/` | Display Types screen: list, form, panels, slot assignment, delete |
| `apps/admin/src/features/playlist-management/` | Playlist Management screen: rename and delete |
| `apps/admin/src/features/dsp-integration/` | DSP Integration section: list, one shared draft, Exchange settings, Advertiser settings (with the Auction schedule), Shared Targeting Variables, DSP pages and Add DSP, and the Booking schedule (linked from Available Inventory) |
| `apps/admin/src/features/advertisers/` | Advertisers screen (admin only) |
| `apps/admin/src/features/campaigns-poc/` | STAND-IN "Campaigns (POC)" table showing the approval components end to end; deleted on integration |

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
- `POC_ROLE` sets the stand-in session: `hq_admin` (admin and approver) or
  `hq_user` (neither).
- The API seeds an empty database on its first start. Delete
  `data/poc.sqlite` and `data/assets/` to reseed.
