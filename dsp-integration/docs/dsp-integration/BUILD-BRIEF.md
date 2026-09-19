# Build brief — Display Types & DSP Integration

For Claude Code, working in this repo. Build the feature end to end, directly
(not through the backlog board). Once the build is done and working, the rest
(testing, approval, deploy) is managed on the board.

**This is a proof of concept, built as the `dsp-integration/` folder of the
`rob_ph_demos` repository, that the engineering team will later merge into the
primary Personalisation Hub repo.** The existing **Campaigns
section is not in this repo** and you will not get access to it. Anything
that must eventually live in the Campaigns section (package 11) is built as
a self-contained, drop-in module with a clear integration seam; see
*Package 11* below.

## This is a standalone POC — build the stand-ins

This repo starts empty. The existing Personalisation Hub platform is in a
separate repo you don't have. **Build this as a standalone, runnable proof of
concept**, with a stand-in for every existing-platform dependency, each
behind a small interface so engineering can swap in the real thing when they
merge it into the main repo. These decisions are made; don't reopen them:

| Area | Decision for the POC |
|---|---|
| Stack | TypeScript throughout. Admin UI: React + Vite with **Ant Design v5, Tailwind CSS v4 and AG Grid (Alpine)**, exactly as the `ph-designer` skill specifies. API: Node.js with Fastify. One repo: `apps/admin`, `apps/api`, `packages/` for shared types. |
| Data | SQLite through a repository layer with plain, Postgres-compatible SQL and versioned migrations. Seed data = the prototype's sample data (`prototype-reference/src/model/data.js`). |
| Existing platform stand-ins | Display types, playlists, displays, campaigns, playback data and asset storage live in `apps/api/src/platform/`, each behind an interface (`DisplayTypeSource`, `PlaylistSource`, `DisplaySource`, `CampaignSource`, `PlaybackSource`, `AssetStore`). Their endpoints are the *POC stand-in* group in the API contract. |
| UI components | **Use the `ph-designer` skill** (`.claude/skills/ph-designer/`). Read its SKILL.md and `references/prototyping.md`, `tokens.md`, `hq-admin.md` and `components.md` before building any screen. Ant Design components themed with the skill's `ConfigProvider` tokens; AG Grid Alpine for every table; Material Symbols (Outlined) icons; Roboto. Don't copy the prototype's hand-made components (`ui.jsx`) and don't use any other library. Where the skill has no documented pattern for something the prototype shows, use the nearest documented pattern and note it in `BUILD-PLAN.md`. |
| Auth and roles | Stand-in session: `hq_admin` (admin + approver) and `hq_user` (neither), chosen by the `POC_ROLE` env var (default `hq_admin`). **No switcher or any other UI for it.** Partner API: one static bearer token per seeded partner, from config. |
| Secrets | DSP credentials encrypted at rest (AES-256-GCM) with a key from the env var `PH_SECRETS_KEY` in a local `.env` that is never committed; behind a `SecretsStore` interface. |
| Feature flag | `DSP_INTEGRATION_ENABLED` env var, read through a `Flags` interface. |
| DSPs | No sandbox accounts yet. Build each DSP client behind a `DspClient` interface, with a mock implementation used by default: connect succeeds or fails per the seed data (Amazon Ads DSP seeded with "refresh token rejected"), and a mock bidder that returns bids. Don't call real DSP APIs. |
| sellers.json | Served by `apps/api` at `/sellers.json`. |
| Assets | Local folder `data/assets/` (git-ignored) behind `AssetStore`. |
| Assumed views (VAC-d) | Seeded numbers per display type slot behind an `AudienceSource` interface. No scoring framework UI (spec: spec only). |
| Reservations | Stored (needed for `GET /v1/reservations/{id}`). |
| Stand-in playback data | Seeded, read-only play records `{displayId, campaignId, playedAt, durationSec}` behind `PlaybackSource`, used only for billing. |
| Git | This POC lives as the folder **`dsp-integration/` inside the `rob_ph_demos` repository** (`offline2online/rob_ph_demos`). Don't create a separate git repo in this folder. Work on the `rob_ph_demos` branch `feature/dsp-integration`, and only change files inside `dsp-integration/`; never touch other folders in the repo. Commit as you go; push only when Rob asks. |

Anything not in this table or the spec: ask, don't decide.

## Build only what is specified — nothing extra

This is the most important rule in this brief.

- **Build exactly what the spec, the prototype and the API contract
  describe. Nothing more.** No extra screens, panels, sections, fields,
  columns, buttons, toggles, filters, badges, charts, empty-state copy,
  helper text, settings, endpoints, parameters or "nice to have" behaviour.
- **The prototype is the UI specification for content and structure.**
  Every screen must match it: same sections in the same order, same fields
  and labels, same tooltips, same buttons. If the prototype doesn't show it,
  don't build it. Don't "improve" layouts, add explanatory copy, or add
  features the prototype lacks.
- **The `ph-designer` skill is the specification for look and components.**
  Build each element the prototype shows with the skill's components and
  tokens. The skill decides how it looks; the prototype decides what is there.
- **Content frame only.** These screens are iframed into HQ Admin (skill:
  `references/prototyping.md`), so render no platform header, sidebar or
  breadcrumb and nothing `position: fixed`. The prototype's own left
  navigation (Display Types, Playlist Management, DSP Integration,
  Advertisers) is part of the content frame and stays.
- **The API contract is the API specification.** Implement exactly the
  endpoints, fields, permissions and error codes in
  `docs/dsp-integration/api/openapi.yaml`.
- **If something seems missing or wrong, stop and ask.** Write it in
  `BUILD-PLAN.md` under *Questions* and wait. Don't fill the gap yourself.
- **No refactoring or tidying of existing code** beyond what a package
  strictly needs to plug in.
- Before finishing each package, compare every screen you built against the
  prototype and list any difference in `BUILD-PLAN.md`. Differences are
  removed, not justified.

## Do not change playback (existing functionality)

Personalisation Hub already manages everything that plays on a website or
display, and has done for years. **This build must not change any of it:**

- playlists and what plays on a device: rotation, ordering, timing, loop
  length, first/last paint, visibility deadlines;
- targeting evaluation and resolution: deciding which campaign plays for a
  given store, display or visitor, including fallbacks;
- asset distribution and caching to players, and rendering;
- playback logging (what the player records when something plays);
- **campaign playback analytics** (what played, where, and why), for the
  retailer and for advertisers.

**What this build does instead:**

- controls **which attributes an advertiser may use for targeting**
  (Shared Targeting Variables, per DSP);
- **validates** the targeting rules in the campaigns or content packages an
  advertiser submits, so they only use attributes that advertiser's DSP is
  permitted, and stores them in the **existing campaign targeting
  structure**;
- sells slots (auction, floors, lists) and **hands winning, approved
  campaigns to the existing campaign system**, which then plays them exactly
  as it plays any other campaign;
- **reads** existing playback data for **billing reconciliation only**,
  without changing how it is written. Playback analytics and reporting stay
  with the existing system; don't build dashboards, reports or a delivery
  API.

If anything in the spec appears to require changing playback, targeting
evaluation, distribution or playback logging, **stop and ask**; this section
overrides the spec on that point.

## Sources of truth

- **Spec:** `docs/dsp-integration/REQUIREMENTS.md` (copied from the board's
  project Docs page, "Display Types & DSP Integration"). If it and this brief
  disagree, the spec wins, except on the two rules above (nothing extra;
  don't change playback), where this brief wins.
- **API contract:** `docs/dsp-integration/api/openapi.yaml` (machine
  readable) and `docs/dsp-integration/api/API.md` (reference). Build every
  endpoint against it and generate request/response tests from it. If an
  endpoint must change, update both files in the same commit and note why in
  `BUILD-PLAN.md`; don't add endpoints on your own.
- **Prototype (look and behaviour):** https://claude.ai/artifact/2cc25ZNLFP5AtQk2KmeY98
- **Design system:** the `ph-designer` skill in `.claude/skills/ph-designer/`
  (measured from the live platform). Look, components and tokens come from
  here.
- **Prototype source:** `prototype-reference/` in this repo (read-only; the
  copy on the `rob_ph_demos` branch is out of date, don't use it). The
  *Direct / house* option in the slot picker is in scope (spec §6: "Direct/house
  has no auction to filter, so a position there names its advertiser
  outright"). Reuse the model shapes in
  `model/schema.js` and `model/sellside.js` (targeting variables, example
  values, DSP credential fields) and the UI behaviour in `ui.jsx`
  (SaveBar, InfoTip), `views/PartnersView.jsx`, `views/AdvertisersView.jsx`
  and `DisplayTypesAndPlaylists.jsx`. It is a prototype: rebuild it in the
  platform's own components, styling and state management; don't copy it in.

## How to work

1. **Map the repo first. Don't write code yet.** Find where HQ Admin's Display
   Types, Playlists and Campaigns screens live, the display type / playlist /
   campaign models and APIs, the Displays & Devices records, auth and roles,
   secrets handling, how campaigns and their targeting are created today (so
   this build can hand campaigns to it), and where existing playback data
   can be read for billing. Read-only for anything playback-related. Then
   write `docs/dsp-integration/BUILD-PLAN.md`: for each work package below,
   the files you will change or add. **Stop and show me the plan before
   building.**
2. Work on branch `feature/dsp-integration`. One commit (or small set) per
   work package, in the order below, each building and passing tests.
3. Put all new behaviour behind a feature flag `dspIntegration` (off by
   default), so the branch can merge before DSPs are live.
4. When the platform's existing structure makes the spec awkward or
   ambiguous, stop and ask. Don't guess on data model, auth or money.
5. After each package, update `BUILD-PLAN.md` with what was done, what was
   deferred, and any spec question raised.

## Guardrails (non-negotiable)

- **Additive changes only** to existing display type, playlist and campaign
  records; reversible migrations; existing records load unchanged.
- **Server-side enforcement** of everything the UI restricts: approval,
  delete checks, admin-only Advertisers, DSP variable access, lists.
- **No visitor data leaves the platform.** Personalisation and Computer
  Vision variable values never go into bid requests, API responses or
  partner analytics. Targeting answers are matched / not matched only.
- **DSP credentials** encrypted at rest with the platform's existing secrets
  handling; never logged; never returned in full to the UI.
- **No real spend.** DSPs run in Test mode unless a human switches them to
  Live. No auto-switch.
- Spelling: "personalisation" with an S everywhere.

## Work packages, in build order

| # | Package | Spec |
|---|---|---|
| 1 | Data model and migrations (display type `phExtensions`, campaign additions, partner record, company advertiser settings, `variableAccess`, exchange) | §8 |
| 2 | Shared UI: draft + Save changes / Cancel bar, unsaved-changes guard, delete dialog, InfoTip tooltips, 260px list + full-width page layout | Core principles |
| 3 | Display Types updates: rename nav, remove QR Control and CTAs types, layout, slot ownership editor, collapsed panels with summary chips, tooltips | §1 |
| 4 | Delete a display type (blocked while displays are assigned; lists them) | §1 |
| 5 | Playlist Management edit and delete with confirmation dialog | §2 |
| 6 | DSP Integration nav + Exchange settings; publish `sellers.json` | §7, Help text |
| 7 | Advertiser settings: pricing, lists, Where these apply, Available Inventory | §4, §5, §6 |
| 8 | Shared Targeting Variables page, per-DSP access, `GET /v1/targeting/attributes` | §6 |
| 9 | DSP page + Google DSP (DV360) connection, seats pulled on connect | §7 |
| 10 | Advertisers screen (admin only) | §3 |
| 11 | Campaign approval as a drop-in module for the existing Campaigns section, with a stand-in POC campaign table (see *Package 11*) | §3 |
| 12 | Campaign submission API, automated asset checks, approval enforcement | §3 |
| 13 | Inventory API | §5 |
| 14 | Targeting permission validation: submitted rules may only use variables permitted for the DSP; stored in the existing targeting structure; no evaluation logic | §6 |
| 15 | SSP auction: OpenRTB 2.6 DOOH bid requests, bid floor, pre-auction enforcement | §7, §4 |
| 16 | Hand-off of winning, approved campaigns to the existing campaign system; billing (dynamic VAC-d) reconciled against existing playback data (no analytics or reporting) | §7, §4 |
| 17 | Amazon Ads DSP and The Trade Desk connections | §7 |

Packages 1–11 are the admin experience and can ship behind the flag on their
own. 12–17 are the exchange; build them against DSP sandboxes / test seats
only.

## Package 11 — campaign approval as a drop-in module

The behaviour is spec §3 (*Campaign statuses*, *Retailer review*,
*Enforcement and audit*). The final home is the existing campaign table in
the primary repo, which you can't see. Build it so the engineering team can
plug it into that table during code review with minimal work.

**Structure:** one self-contained module, `campaign-approval/`, with no
imports from the rest of the app except the shared UI components (package 2)
and the adapter below.

- **Adapter (the only seam to the real campaigns).** A small interface, e.g.
  `CampaignSource`: `getCampaign(id)`, `listCampaigns(filter)`,
  `setActivation(id, enabled)`, `onCampaignChanged(listener)`. Ship one POC
  implementation backed by this repo's own campaign store (campaigns created
  through the submission API in package 12, plus seeded examples). On
  integration, engineering writes one adapter against the real campaign
  service and nothing else in the module changes.
- **Approval state kept beside the campaign, not inside it.** Store approval
  in its own table/collection keyed by `campaignId` + `assetVersion`
  (`status`, `mode` manual/auto, `submittedAt`, `reviewedBy`, `reviewedAt`,
  `reason`, `checks[]`) plus an append-only audit log. This avoids editing a
  campaign model this repo doesn't own. §8's campaign fields are the target
  shape; the integration guide explains how to move them onto the campaign
  record if engineering prefers.
- **Backend service and API:** a state machine (Draft → Awaiting approval →
  Approved | Rejected; asset or targeting change on an approved campaign →
  Awaiting approval; auto-approve when the advertiser doesn't require
  approval). Endpoints exactly as in the API contract:
  `GET /admin/v1/approvals?status=` (with counts per status),
  `POST /admin/v1/campaigns/{id}/approve`,
  `POST /admin/v1/campaigns/{id}/reject` (reason required),
  `GET /admin/v1/campaigns/{id}/approval` (state + audit).
  Approve/reject are HQ Admin role only.
- **Enforcement hook:** export one function, `isCampaignEligible(campaignId)`,
  and call it everywhere this repo decides eligibility: reservation, bidding
  and hand-off to the existing campaign system (packages 12–16). Playback
  itself is not touched: an unapproved campaign simply can't be activated,
  and the existing platform only plays active campaigns. The integration
  guide tells engineering where the primary repo should call it (activation).
- **Drop-in UI components**, props-only, each usable on its own inside an
  existing table row or header:
  - `ApprovalStatusBadge` — the status, with "Approved automatically" where
    relevant.
  - `ApprovalActions` — when Awaiting approval, renders Approve and
    Reject-with-reason instead of the activation toggle; once Approved,
    renders its `children` (the host table's existing activation toggle,
    passed through untouched).
  - `ApprovalStatusFilter` — Draft / Awaiting approval / Approved /
    Rejected, with counts.
  - `ApprovalReviewPanel` — creative on the target canvas, advertiser and
    DSP, targeting summary, automated check results, Approve / Reject.
  - `useCampaignApprovals(campaignIds)` — hook that loads approval state for
    the rows on screen.
- **Stand-in POC campaign table.** A simple "Campaigns (POC)" screen behind
  the `dspIntegration` flag that looks like the existing campaign table and
  uses the components above, so the flow can be demoed end to end. Label it
  clearly as a stand-in, keep it in its own folder, and delete nothing else
  when it's removed.
- **Integration guide:** write
  `docs/dsp-integration/CAMPAIGN-APPROVAL-INTEGRATION.md` for the
  engineering team. It must cover, step by step:
  1. writing the real `CampaignSource` adapter;
  2. where to place each component in the existing campaign table (status
     column, filter above the table, `ApprovalActions` wrapped around the
     existing activation toggle, review panel on row open), with a short
     before/after code snippet for each;
  3. where the primary repo must call `isCampaignEligible`;
  4. running the migration for the approval table (or moving the fields onto
     the campaign record);
  5. deleting the stand-in POC table;
  6. the component contract tests to run after plugging in.
- **Contract tests** for each component and the adapter interface, written
  against the adapter (not the POC store), so engineering can run the same
  tests against the real campaign table.

## Defaults for open questions

Use these until Rob decides; make each configurable and list it in the PR.

| Open question | Default |
|---|---|
| 27 Auction play-window length | 24 hours |
| 29 Partial-estate delivery | Bill only plays that happened, per existing playback data |
| 38 Old version during re-review | Stops until the new version is approved |
| 39 Who can approve | HQ Admin role only |
| 41 Advertiser notification | Status polling; leave a webhook hook |
| 46 Per-DSP QPS / timeout | Platform defaults 500 QPS / 300 ms |
| 47 Delete type with sold positions | Don't block; log sold/reserved count |
| 48 SKU list length | Max 100 SKUs per condition, checked at validation (look-back is existing platform behaviour) |
| 49 Computer Vision variable default | All connected DSPs (as spec) |

## Testing

- Unit tests for: effective floor maths (floor × personalised × interactive
  × advertiser multiplier), targeting permission validation (a rule using a
  variable not permitted for the DSP is rejected with the variable named),
  list precedence (blacklist always subtracts), delete checks, approval state
  machine.
- Regression check: existing playlists, targeting and playback behave
  exactly as before with the `dspIntegration` flag on and off.
- API tests for every endpoint in `openapi.yaml`, generated from it, including
  permission cases (a DSP sees a smaller list, never an error; non-admin gets
  403 on Advertisers). A test fails if a response has fields the contract
  doesn't define.
- Contract test: generated bid requests validate as OpenRTB 2.6 with a DOOH
  object and SupplyChain, and contain no visitor data.
- UI checks at 1163px: no horizontal scroll; save bar enables only on change;
  tooltips open and aren't clipped.

## Definition of done

- All 17 packages built on `feature/dsp-integration`, flag off by default.
- Tests pass; `BUILD-PLAN.md` complete, listing deferred items and open
  questions hit.
- `CAMPAIGN-APPROVAL-INTEGRATION.md` written, and the campaign-approval
  contract tests pass against the POC adapter.
- `openapi.yaml` and `API.md` match the built API exactly.
- A screen-by-screen comparison against the prototype in `BUILD-PLAN.md`,
  with no differences left.
- A PR opened against main, not merged. Rob then moves it through test,
  security and privacy review, and deploy on the board.
