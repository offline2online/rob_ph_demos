# Build plan — Display Types & DSP Integration

Status: **plan approved 19 Sep 2026** (answers in §6). Building packages
1–3, then stopping for Rob to compare Display Types against the prototype.

## 1. Setup and git

- The POC lives in the folder `dsp-integration/` inside `offline2online/rob_ph_demos`.
  I only change files in that folder, commit as I go, and don't push until
  Rob asks.
- Branch `feature/dsp-integration` was created from `main` (19 Sep 2026).
  Uncommitted changes outside this folder are left untouched; only
  `dsp-integration/` paths are ever staged.
- Current contents of the folder:

  ```
  .claude/skills/ph-designer/      design system skill (SKILL.md + 5 references)
  .gitignore                       .DS_Store, .env, data/assets/, node_modules/
  docs/dsp-integration/            BUILD-BRIEF.md, REQUIREMENTS.md, BUILD-PLAN.md
  docs/dsp-integration/api/        API.md, openapi.yaml
  prototype-reference/             read-only prototype source (UI spec)
  ```

## 2. Repo map

This is a greenfield POC. The brief's *This is a standalone POC* table gives
the stand-in for each existing-platform dependency.

| Brief's "find" item | In the POC |
|---|---|
| Display Types / Playlists screens | New: `apps/admin/src/features/display-types`, `…/playlist-management` |
| Campaigns screen | Not in the POC; stand-in *Campaigns (POC)* screen only (package 11) |
| Display type, playlist, display, campaign models and APIs | `apps/api/src/platform/` behind `DisplayTypeSource`, `PlaylistSource`, `DisplaySource`, `CampaignSource`; API = contract group *POC stand-in* |
| Displays & Devices | `DisplaySource`, seeded, read-only (delete check only) |
| Auth and roles | Stand-in session from `POC_ROLE` (`hq_admin` or `hq_user`); partner bearer tokens from config |
| Secrets | `SecretsStore`, AES-256-GCM, key `PH_SECRETS_KEY` in an uncommitted `.env` |
| How campaigns and targeting are created | `CampaignSource` stand-in, which stores targeting as AND-groups of OR-conditions |
| Playback data for billing | `PlaybackSource`, seeded `{displayId, campaignId, playedAt, durationSec}`, read-only |
| Assets | `AssetStore` → `data/assets/` (git-ignored) |
| Assumed views (VAC-d) | `AudienceSource`, seeded per display type slot |
| Feature flag | `Flags` interface reading `DSP_INTEGRATION_ENABLED` (flag name `dspIntegration`), off by default |
| DSPs | `DspClient` per provider with a mock by default (Amazon seeded "refresh token rejected"), plus a mock bidder; no real calls |

### Design system (ph-designer)

I read `SKILL.md`, `prototyping.md`, `tokens.md`, `hq-admin.md` and
`components.md`. These are the rules I'll apply:

- **Content frame only.** No header, sidebar, breadcrumb, AI FAB or
  `position: fixed`. White background with 20px padding, and a fluid height.
  The prototype's own left nav stays.
- **Theme.** AntD v5 `ConfigProvider` using `phTheme` from `tokens.md` §6,
  plus Tailwind v4 `@theme` from §7. Roboto everywhere; icons are Material
  Symbols Outlined (webfont).
- **Tables.** AG Grid in the `ag-theme-alpine` class with the variables from
  `tokens.md` §8, 42px text rows, 13px/700 headers. No filter row,
  checkbox column, `⋯` column or pagination unless the prototype shows one
  (see *Nearest-pattern notes*).
- **Page chrome.** Page title is `text-xl font-bold`, followed by a divider.
  Section headings are ALL CAPS muted dividers (`components.md` §11). Form
  labels are muted, sit above the field, and carry a red `*` before the
  label. `InfoTip` is AntD `Tooltip` with an `info` symbol.
- **Controls.** Toggles are AntD `Switch`. Status pills are outlined pills
  (§5). Status dots follow §4. Callouts use AntD `Alert`. Panels use the
  collapsible section pattern (§14). Test/Live uses `Segmented` (§15).
- **Save bar.** `position: sticky; bottom: 0` rather than fixed, because
  fixed positioning is banned in an iframe. Buttons are **Save changes**
  (primary) and **Cancel**, using the prototype's wording rather than the
  skill's "Save Changes".
- **Versions.** React 18.3 (AntD v5's supported major), Vite 5, AntD 5,
  Tailwind 4, and AG Grid Community 32.x (the last major that ships the
  `ag-theme-alpine` CSS classes the skill specifies).

**Nearest-pattern notes** (the skill has no pattern for these, so I'll use
the closest documented one):

| Prototype element | Nearest skill pattern |
|---|---|
| 230px app nav and 260px list column | Settings secondary nav (§10), at the prototype's widths |
| Collapsed-panel summary chips | Outlined pill (§5): coloured when on, grey when default |
| Slot cards strip | Card (8px radius, `#f0f0f0` border) |
| Removable list pills and suggestions | Tag input (§13): AntD `Tag` closable, plus `Input` and **Add** |
| DSP access multi-select | AntD `Select mode="multiple"` shown as pills |
| Delete dialog | AntD `Modal` with an `Alert type="warning"` when blocked |
| Unsaved-changes guard | AntD `Modal.confirm` replacing `window.confirm` |

## 3. Prototype inventory

This is drawn from `prototype-reference/src`. File:line references are kept
in my working notes. It shows what each screen contains; the conflicts with
the spec are in §6.

- **App.**
  - Titles: *Display Types Details*, *Playlist Management*, *DSP
    Integration*, *Advertisers*.
  - Nav: 230px, collapses to 56px icons below 900px. Icons:
    `dashboard_customize`, `playlist_play`, `handshake`, `sell`.
  - The unsaved-changes guard runs on nav change, list selection and Add.
  - Experience Layout is hidden (`SHOW_EXPERIENCE_LAYOUT = false`), so it is
    not built.
- **Display Types.**
  - List column (260px): **New display type**. Each row shows the touch-point
    icon, name, bin icon, W×H, structure badges and feature badges.
  - Form, one column in this order: Preview, Touch Point, Name, Canvas size,
    Background Color, Default Playlist.
  - Four collapsed panels with summary chips:
    - **Playlist Settings**: 4 selects with "Default (…)", then **Slot
      assignment** (slot cards, then a `#` / Label / Owner / Assigned to
      table), then Auto-Rotation and Auto-Play.
    - **Phantom Zone**
    - **Enabled Features**
    - **Multi-Zone Layout**: Quick split 2/3/4/6, zone cards, Add zone.
  - Save bar.
  - Delete dialog, blocked (lists displays) and allowed.
- **Playlist Management.**
  - Count line "**n** Playlists · **m** unused". (The prototype's **New
    playlist** is not built, per decision 4.)
  - Table: Playlist (inline rename pencil, "auto-created with …" pill),
    Assigned to (expandable list with **Open →**), bin.
  - Delete dialog, blocked and allowed.
  - No save bar: changes save immediately.
- **DSP Integration.**
  - List column:
    - COMPANY: Exchange settings, Advertiser settings, Shared Targeting
      Variables.
    - PARTNER DSPS: Google DSP, Amazon Ads DSP and The Trade Desk, each with
      state and lists-link lines.
  - Add card: *Add {DSP}*, then **Add partner** / **Cancel**.
  - Exchange settings: 4 fields, Published/Incomplete pill, sellers.json
    callout.
  - Advertiser settings:
    - PRICING: currency, floor, 2 multipliers.
    - LIST MANAGEMENT: 4 list editors.
    - WHERE THESE APPLY: Adopting/Own lists and **Open**.
    - AVAILABLE INVENTORY: Display type / Playlist / Slot / Position /
      **Open**.
  - Shared Targeting Variables: 2 groups × 12 variables, each row with a
    DSP picker.
  - DSP page, in order:
    1. Header (name input, status pill)
    2. Issues
    3. MODE Test/Live
    4. CONNECTION CREDENTIALS (per provider), **Connect / Re-test
       connection**, **Disconnect**
    5. BIDDER INTEGRATION
    6. ADVERTISER WHITELIST / BLACKLIST (linked callout + **Unlink and
       edit**, or own lists + **Relink to company lists**)
    7. Save bar
- **Advertisers.**
  - "Admin only" pill.
  - Table: Advertiser, Via, Campaign approval (Switch plus
    Required/Not required), Floor multiplier, Effective floor. All columns
    have tooltips except Advertiser.
  - The prototype had no save bar (a bug, since fixed). The standard save bar
    is built (decision 4).

**Seed data** (`model/data.js`, becomes `apps/api/src/seed/`):
- Display types:
  - Landscape (Digital Signage, 1920×1080)
  - Portrait (Digital Signage, 1080×1920)
  - Menu Board — Long Format (Digital Signage, 5760×1080, 3 slots, 3 zones)
  - The prototype's 4 Responsive Web types are **not seeded** (decision 1).
    Their slots go too, so Available Inventory seeds one row: Menu Board —
    Long Format, slot 2.
- 12 playlists (kept as existing records; the web types' playlists become
  unused) and 6 displays.
- Partners: Google DSP (connected, Live) and Amazon Ads DSP (error, Test,
  own lists); The Trade Desk not set up.
- Advertisers: L'Oréal, Nestlé, Swisse.
- Company lists and pricing with default values.
- Exchange: Demo Retail Group / demoretail.example / drg-4471.
- The prototype's provider key `google_dsp` is stored as the contract's
  `google_dv360`.

## 4. Proposed structure

```
dsp-integration/
  package.json                     npm workspaces
  apps/admin/                      React 18 + Vite + AntD 5 + Tailwind 4 + AG Grid (Alpine)
    src/theme/                     phTheme, Tailwind @theme, AG Grid vars, Material Symbols
    src/shared/                    package 2 shared UI
    src/features/display-types/
    src/features/playlist-management/
    src/features/dsp-integration/
    src/features/advertisers/
    src/features/campaigns-poc/    stand-in table (delete-safe)
    src/api/                       typed client (TanStack Query)
  apps/api/                        Node + Fastify + SQLite
    src/platform/                  stand-in sources + POC stand-in routes
    src/db/                        repository layer, migrations (up/down, Postgres-compatible SQL)
    src/admin/                     /admin/v1 routes
    src/partner/                   /v1 routes
    src/exchange/                  pricing, lists, targeting validation, OpenRTB, auction, hand-off, billing
    src/secrets/  src/flags/  src/auth/  src/dsp/
    src/seed/
  packages/types/                  shared TS types (generated from openapi.yaml)
  packages/campaign-approval/      package 11 drop-in module: adapter/, server/, ui/, tests/ (Q14)
  tests/api/                       generated from openapi.yaml, strict (no undeclared fields)
  tests/ui/                        Playwright at 1163px
  prototype-reference/  docs/  .claude/
```

## 5. Files per work package

Every package is flag-gated, ships with tests beside it, gets its own commit,
and ends with a `BUILD-PLAN.md` update.

1. **Data model and migrations.**
   - Tooling: `packages/types`, and `apps/api/src/db/migrations/0001…`,
     each with a down migration.
   - Stand-in tables with the §8 existing shapes, plus `phExtensions`.
   - Campaign additions: `source`, `advertiserId`, `partnerId`,
     `pricingType`, `activation`.
   - New tables: `partners` (creds encrypted), `company_advertiser_settings`,
     `advertiser_settings`, `variable_access`, `exchange`, `reservations`.
   - Seed data.
   - `SecretsStore`, `Flags`, the auth stand-in and the platform sources.
   - Tests: old-shape records load unchanged; migrations round-trip.
2. **Shared UI** (`apps/admin/src/shared/`):
   - `SaveBar` and `useDraft` (dirty check)
   - `UnsavedChangesGuard` (nav, list selection, route)
   - `DeleteDialog`
   - `InfoTip` (AntD Tooltip, auto-flips)
   - `ListPageLayout` (260px sticky list plus full-width column)
   - `AppNav`, `Grid` (AG Grid wrapper), `SectionLabel`, `SummaryChip`,
     `ListEditor`
3. **Display Types.**
   - `features/display-types/`: `DisplayTypesPage`, `DisplayTypeList`,
     `DisplayTypeForm`, `Preview`, `TouchPointSelect`.
   - `panels/`: PlaylistSettings, PhantomZone, EnabledFeatures, MultiZone.
   - `SlotAssignment` (cards + grid), `panelSummaries.ts` + tests.
   - API: `GET/POST /admin/v1/display-types`,
     `GET/PUT …/{id}/record`, `PUT …/{id}/extensions`.
4. **Delete a display type.**
   - `DeleteDisplayType.tsx`.
   - API: `GET …/delete-check` and `DELETE …/{id}` (409 `has_dependents`),
     logging the sold/reserved count (Q47 default).
   - Unit tests for the delete check.
5. **Playlist Management.**
   - `features/playlist-management/`: `PlaylistManagementPage`,
     `PlaylistRow`, `DeletePlaylist`.
   - API: `GET /admin/v1/playlists`, `PUT …/{id}/record` (name only),
     `GET …/delete-check`, `DELETE`. Rename and delete only (decision 4).
6. **DSP Integration nav and Exchange settings.**
   - `features/dsp-integration/`: `DspIntegrationPage`, `DspList`,
     `ExchangeSettings`.
   - API: `admin/exchange.ts`, and `/sellers.json` (404 until complete).
7. **Advertiser settings.**
   - `AdvertiserSettings/`: `Pricing`, `ListManagement`, `WhereTheseApply`,
     `AvailableInventory`.
   - `currencies.ts` (ISO 4217 code + name via `Intl`).
   - API: `admin/advertiserSettings.ts`, `admin/availableInventory.ts`.
   - `exchange/lists.ts`, with tests showing the blacklist always
     subtracts and nothing sits on both lists.
8. **Shared Targeting Variables.**
   - `SharedTargetingVariables`, `DspAccessPicker`.
   - API: `admin/targetingVariables.ts`, and `partner/targeting.ts`
     (per-DSP filtered, no values).
   - `exchange/variables.ts` (24 defaults from `sellside.js`).
9. **DSP page + Google DSP (DV360).**
   - `DspPage/`: `Issues`, `Mode`, `Credentials`, `BidderIntegration`,
     `AdvertiserLists`, plus `AddPartnerCard`.
   - API: `admin/partners.ts`, `dsp/DspClient.ts`,
     `dsp/googleDv360.mock.ts` (seats pulled on connect), `issues.ts`.
   - Live is rejected with `conflict` unless the DSP is connected and its
     bidder fields are complete. Secrets are returned only as `{set:true}`.
10. **Advertisers.**
    - `features/advertisers/AdvertisersPage`.
    - API: `admin/advertisers.ts`, which returns 403 for `hq_user`. The nav
      item is hidden for non-admin sessions.
11. **Campaign approval.**
    - `packages/campaign-approval/`:
      - `adapter/CampaignSource.ts` and `adapter/pocCampaignSource.ts`
      - `server/`: stateMachine, approvalRepo (keyed by `campaignId` +
        `assetVersion`), append-only audit log, routes (`/admin/v1/approvals`,
        `…/approval`, `…/approve`, `…/reject`), `isCampaignEligible`
      - migration
      - `ui/`: ApprovalStatusBadge, ApprovalActions, ApprovalStatusFilter,
        ApprovalReviewPanel, `useCampaignApprovals`
      - contract tests written against `CampaignSource`
    - `apps/admin/src/features/campaigns-poc/`.
    - `docs/dsp-integration/CAMPAIGN-APPROVAL-INTEGRATION.md`.
12. **Submission API.**
    - `partner/campaigns.ts` (create, assets, submit, status).
    - `exchange/assetChecks.ts` (8 checks).
    - `AssetStore`.
    - Approval enforcement via `isCampaignEligible`.
13. **Inventory API.**
    - `partner/inventory.ts` (list, detail, availability, forecast).
    - `exchange/positions.ts` (from `phExtensions.slots`, hides what the
      caller can't buy).
    - `exchange/pricing.ts` (effective floor, unit-tested).
    - `AudienceSource`.
14. **Targeting permission validation.**
    - `exchange/targetingValidation.ts`: returns 422 naming each variable,
      and rejects conditions with more than 100 values. Rules are stored
      through `CampaignSource`. No evaluation.
15. **SSP auction.**
    - `exchange/openrtb/` (request builder, DOOH, schain).
    - `exchange/auction.ts`: floor, badv/bcat, whitelist, approved `crid`,
      all applied pre-auction.
    - `partner/reservations.ts`.
    - `dsp/mockBidder.ts`.
    - Contract test: OpenRTB 2.6, DOOH, schain, no `user` or visitor data.
16. **Hand-off and billing.**
    - `exchange/handoff.ts` (calls `isCampaignEligible`, then
      `CampaignSource`; Test-mode wins are never handed off).
    - `exchange/billing.ts`: dynamic VAC-d from `PlaybackSource`, reading
      only realised plays (Q47/Q29 defaults). No reporting.
17. **Amazon Ads DSP and The Trade Desk.**
    - `dsp/amazonDsp.mock.ts` and `dsp/theTradeDesk.mock.ts`, with their
      credential forms.

## 6. Decisions (Rob, 19 Sep 2026)

These override the prototype where they differ.

1. **Touch points:** Digital Signage and Kiosk only. Not built: web touch
   points, web display types, web element/preview controls, and the
   Idle/Connected pairing toggle.
2. **Copy:** status text stays on the page; explanations become tooltips on
   the element they describe, per the spec's *Help text* rules.
3. **Direct / house:** out of scope for this release. Not built, and not in
   the slot picker.
4. **Gaps against the spec:**
   - Advertisers gets the standard save bar.
   - No slot quota field.
   - No **New playlist**.
   - Playlist assignments are made on the Display Types form.
   - Playlist Management renames and deletes only;
     `PUT /admin/v1/playlists/{id}/record` takes `name` only.
5. **Contract changes.** See §7.
6. **Flag, structure and defects:**
   - With `dspIntegration` off, DSP Integration, Advertisers, Campaigns
     (POC) and *Slot assignment* are hidden (so are the owner chips in the
     Playlist Settings summary). The Partner API (`/v1/*`) and every new
     admin endpoint return 404.
   - The POC stand-in endpoints and the display type/playlist delete
     endpoints stay available.
   - `packages/campaign-approval/` and slug advertiser IDs (e.g. `loreal`)
     are confirmed.
   - The 6 prototype defects are fixed (§8).
- **G1** (branch) resolved. **G2**: the PR waits until Rob asks, since
  pushing is on request only.

## 7. Contract changes (openapi.yaml + API.md, one commit, 19 Sep 2026)

All approved by Rob (decision 5). The reason for each change is given.

| Change | Why |
|---|---|
| `GET /admin/v1/campaigns` (POC stand-in), new `Campaign` schema | The stand-in POC campaign table needs the existing campaign list; `CampaignSource.listCampaigns` had no endpoint |
| `PUT /admin/v1/campaigns/{id}/activation` (POC stand-in), `422 not_approved` unless Approved | The existing activation toggle (`CampaignSource.setActivation`, wrapped by `ApprovalActions`) had no endpoint |
| `Approval.creative {assetUrl, mimeType, width, height}` and `Approval.canvas {width, height}` | The review panel must render the creative on the target canvas (spec §3); the schema had neither |
| Session wording: role from `POC_ROLE`, no switcher, no cookie | The contract said "user switcher", contradicting the brief |
| `PUT /admin/v1/playlists/{id}/record` takes `name` only | Decision 4: assignments are made on the Display Types form |
| *Jobs with no API* note: auction job + `npm run auction:run`; billing line items only + `npm run billing:print` | Nothing in the contract triggered the auction or described billing output; no UI, report or endpoint |

## 8. Prototype defects fixed (decision 6)

1. **Fix connection** (broken-slot callout) opens that DSP's page, not
   Advertiser settings.
2. The DV360 **Private key (JSON)** field is masked like every other secret.
   Credentials are never shown in full.
3. **Enable QR Control** needs a phantom zone. It is disabled until *Define
   phantom zone* is on, as its tooltip says.
4. **Relink to company lists** keeps the prototype's warning callout, which
   says relinking discards the DSP's own lists, and adds no extra dialog.
   The relink is held as an unsaved change like any other edit.
5. The label info icons with no tooltip text (*Display Canvas Size
   (Resolution)*, *Phantom Area(s) Size*) are removed rather than given
   invented text.
6. The always-empty Vision/AI preset note is not rendered.

## 9. Package notes and deviations

- **Package 3 reads data from later packages.** The *Assigned to* picker
  needs partners, their seats and the company lists. Package 3 therefore
  implements the read side of `GET /admin/v1/partners` and
  `GET /admin/v1/advertiser-settings` early (flag-gated, exactly as in the
  contract). Their `PUT`s and screens stay in packages 7 and 9.
- **Seats aren't in the contract.** The `Partner` schema has no `seats`
  (spec §8 has `seats: [{id, name}]`). This is question Q1 below. Until it's
  answered, package 3 reads each DSP's advertisers from
  `GET /admin/v1/advertisers` (`via`), which is admin-only.
- **Fix connection before package 6** links to the DSP page's route,
  `/dsp-integration/partners/{id}`. That route renders once package 6 is
  built.
- **The feature flag reaches the admin UI** through the same env var,
  `DSP_INTEGRATION_ENABLED`, exposed to Vite through the `Flags` interface.
  No endpoint was added.

## 10. Questions (open)

1. **Partner seats.** The spec (§8) gives a partner `seats: [{id, name}]`.
   The slot picker lists each seat, and each DSP page offers them as list
   suggestions. The contract's `Partner` schema has no `seats`. Can I add
   `seats: [{id, name}]` to `Partner`? Until then the picker uses
   `/admin/v1/advertisers`, so an `hq_user` session sees no named
   advertisers there.

## 11. Defaults in use (brief, *Defaults for open questions*)

- Q27: 24-hour window
- Q29: bill realised plays only
- Q38: the old version stops during re-review
- Q39: HQ Admin approves
- Q41: polling, with a webhook hook
- Q46: 500 QPS / 300 ms
- Q47: don't block the delete; log the sold/reserved count
- Q48: at most 100 SKUs per condition
- Q49: Computer Vision variables go to All connected DSPs

Each is configurable in `apps/api/src/config.ts`.

## 12. Progress

| # | Package | Status | Done | Deferred | Questions hit |
|---|---|---|---|---|---|
| 1 | Data model and migrations | Not started | — | — | — |
| 2 | Shared UI | Not started | — | — | — |
| 3 | Display Types | Not started | — | — | Q1 |
| 4–17 | — | Not started | — | — | — |

## 13. Prototype comparison (per screen)

Filled in as each package finishes. Differences are removed, not justified.
