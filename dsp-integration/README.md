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
| `apps/api/src/platform/` | Stand-ins for the existing platform: `DisplayTypeSource`, `PlaylistSource`, `DisplaySource`, `CampaignSource`, `PlaybackSource` |
| `apps/api/src/repos/` | This build's own records: partners (credentials encrypted), company advertiser settings, variable access, exchange |
| `apps/api/src/seed/` | Seed data, taken from the prototype's `model/data.js` |
| `apps/admin/` | Admin UI: React 18, Vite, Ant Design 5, Tailwind 4 and AG Grid (Alpine). It renders the content frame only, because it is iframed into HQ Admin. |
| `apps/admin/src/shared/` | Shared UI: save bar, draft state, unsaved-changes guard, delete dialog, InfoTip, list layout, collapsible panel, summary chips, AG Grid wrapper |
| `apps/admin/src/features/display-types/` | Display Types screen: list, form, panels, slot assignment, delete |
| `apps/admin/src/features/playlist-management/` | Playlist Management screen: rename and delete |
| `apps/admin/src/features/dsp-integration/` | DSP Integration section: list, one shared draft, Exchange settings |

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
npm test
```

- `DSP_INTEGRATION_ENABLED` is the `dspIntegration` feature flag, and it is
  off by default. When it is off:
  - DSP Integration, Advertisers and Slot assignment are hidden.
  - The Partner API and the new admin endpoints return 404.
- `POC_ROLE` sets the stand-in session: `hq_admin` (admin and approver) or
  `hq_user` (neither).
- The API seeds an empty database on its first start. Delete
  `data/poc.sqlite` to reseed.
