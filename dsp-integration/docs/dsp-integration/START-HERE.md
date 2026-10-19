# Start here — Display Types & DSP Integration

This is the index of every document about this build, and the order to read
them in. It is mirrored to the project's documents on the PH Agent Console
as "0 — Start here", so a person or an agent opening the project sees it
first.

**The repo wins.** Every document marked *mirror* below is rewritten from
its repo file on every merge to `main`, and checked byte for byte
(`scripts/sync-board-docs.mjs` → `MIRRORS`, and backlog-tracker's
post-merge sync). To change one, edit the file in
`offline2online/rob_ph_demos`, never the board copy. Board-only documents
have no repo file: they are edited on the board.

The board holds at most 20,000 characters per document, so a longer file
is mirrored in parts, cut at its headings. Each part's name says which
part it is. A pull request that would push a part over the limit fails
`e2e-quick` (`npm run board:sync -- --check-cut`), before it can merge.

## Porting this build into PH Core (engineering)

Read in this order:

1. **Handover review and porting checklist** — *mirror, 2 parts* ·
   `dsp-integration/docs/dsp-integration/api/HANDOVER-REVIEW.md`
   - How the components separate.
   - What the 18 Oct 2026 review fixed and measured.
   - What is left for engineering.
   - The porting order.
2. **Boundaries with PH Core** — *mirror, 7 parts* ·
   `dsp-integration/docs/dsp-integration/api/PH-CORE-BOUNDARIES.md`
   - Every seam and what it must guarantee.
   - Whose each table is.
   - What engineering replaces.
3. **Campaign approval integration guide** — *mirror, 2 parts* ·
   `dsp-integration/docs/dsp-integration/CAMPAIGN-APPROVAL-INTEGRATION.md`
   - Plugging the approval module into the existing Campaigns section.
4. **API reference** — *mirror, 5 parts* ·
   `dsp-integration/docs/dsp-integration/api/API.md`
   - The Partner API, the Admin API, sellers.json and OpenRTB.
   - The contract itself is `api/openapi.yaml`, in the repo only.
5. **EKS deployment guide** — *mirror* · `dsp-integration/deploy/kubernetes/README.md`
   - The image and manifests for a client's VPC.
   - Sizing.
   - Security posture.
6. **Reviews behind the limits and measurements** — *mirrors*:
   - **Security, scalability and performance review** (23 Sep 2026) ·
     *2 parts* · `api/SECURITY-PERFORMANCE.md`
   - **Scale review — 15,000 displays on EKS** (24 Sep 2026) ·
     *2 parts* · `api/SCALE-15000-EKS.md`
   - **Admin API performance review** (3 Oct 2026) ·
     `api/ADMIN-API-PERFORMANCE.md`
7. **Requirements** — the project's Requirements block ·
   `dsp-integration/docs/dsp-integration/REQUIREMENTS.md`. It is the
   specification, and the source of truth for behaviour.

## Working this project's tickets (agents and staff)

- **README** — the project's README block · `dsp-integration/README.md`
  - Read its "For agents working this project's tickets" section first.
  - It also covers how the hosted prototype is built and how the board is
    kept in step.
- **Board-only documents**, edited on the board and not in the repo:
  - End-to-End Test Spec — DSP Demand Paths (v2)
  - Run 6 Runbook — agent instructions
  - E2E Testing Strategy
  - Data model — JSON sample records
  - The Scope & Seam Reconciliation reviews
  - The daily **E2E Test Results** documents

  A repo search that finds none of these is not evidence they don't exist.
- **AWS demo — test flow** (10 Dec 2026) — *mirror* ·
  `dsp-integration/docs/dsp-integration/AWS-DEMO-TEST-FLOW.md`. The
  person-run rehearsal, each step mapped to its automated case.

## Where the code is

`dsp-integration/` in `offline2online/rob_ph_demos`. Its parts:

| Path | What it is |
|---|---|
| `apps/api` | The exchange |
| `apps/admin` | The admin UI, iframed into HQ Admin |
| `packages/campaign-approval` | The approval module |
| `packages/types` | Shared types, generated from the contract |
| `apps/dsp-mocks` | Mock DSPs, for tests only |
| `deploy/kubernetes` | Deployment to a client's EKS |
| `deploy/firebase` | The public hosted demo |

The hosted prototype is at
<https://offline2online.github.io/rob_ph_demos/dsp-integration/prototype/>.
It is demo data only, with no login.
