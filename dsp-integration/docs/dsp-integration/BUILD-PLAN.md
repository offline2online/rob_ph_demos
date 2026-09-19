# Build plan — Display Types & DSP Integration

Status: **packages 1–3 built** (19 Sep 2026). Stopped for Rob to compare
Display Types against the prototype before package 4.

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
| `Partner.seats [{id, name}]` (19 Sep, Rob, Q1) | The slot picker and the DSP pages need each DSP's seats, which spec §8 has on the partner. They are filled from the DSP (mock) on connect |
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
- **The slot picker reads `Partner.seats`** (added 19 Sep, Q1). It no
  longer depends on the admin-only Advertisers endpoint.
- **Fix connection before package 6** links to the DSP page's route,
  `/dsp-integration/partners/{id}`. That route renders once package 6 is
  built.
- **Company feature availability is a stand-in.** It drives which Enabled
  Features can be switched on (spec §1: Company → Display Type → Display).
  The existing platform owns it and the contract doesn't expose it, so the
  admin UI holds the prototype's values in `model.ts`
  (`COMPANY_FEATURE_AVAILABILITY`). See Q3.
- **Zone playlists created on demand.** When zones are enabled, a
  "<Display Type> / Zone n" draft playlist is created. On Save, the stand-in
  `PUT …/record` or `POST` creates any referenced playlist that doesn't exist
  yet. This keeps "applied with Save changes" (spec §1) without a
  playlist-create endpoint.
- **Mobile site template seed.** The prototype seeds "Mobile Store Site" and
  "Order & Pay", neither of which is one of the select's options, so the
  prototype falls back to showing "Mobile App". The POC seeds "Mobile App",
  so both render the same.
- **Slot count follows the cap only with the flag on.** With the flag off,
  changing Maximum Campaigns Played In Rotation leaves `phExtensions.slots`
  alone, because that endpoint returns 404. With the flag on, the editor
  resizes the slots to the cap, and the next save stores them.
- **The feature flag reaches the admin UI** through the same env var,
  `DSP_INTEGRATION_ENABLED`, exposed to Vite through the `Flags` interface.
  No endpoint was added.

- **Seed assumptions.** Venue metadata (`openOohVenueType`, orientation,
  loop length) isn't in the prototype. It is seeded per display type, using
  `retail.grocery` from API.md's example bid request, and has no UI (the spec
  marks it spec-only). The loop length is the default playlist's total
  duration, except Menu Board, which uses API.md's example of 45s.
- **Unexpected server errors** return 500 with the contract's error shape.
  The contract has no dedicated code for them, so they use
  `validation_failed`.

- **React is pinned to 18.3 through root `overrides`.** Several dependencies'
  peer ranges would otherwise hoist React 19 alongside it. AntD v5
  officially supports React 18.

## 10. Questions (open)

1. ~~Partner seats~~ **Resolved (Rob, 19 Sep):** `seats` was added to
   `Partner` in the contract. They are filled on connect from the mock DSP
   APIs (§14), which Rob asked for so testers can control each DSP's seats
   and advertisers.
2. ~~Name field wording~~ **Resolved (Rob, 19 Sep):** the label is
   "Display Type Name", with the placeholder "Name this display type".
3. ~~Company feature availability~~ **Resolved (Rob, 19 Sep):** it is managed
   separately, outside this build. The admin UI keeps the prototype's values
   as a stand-in (§9), and no endpoint is added.

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
| 1 | Data model and migrations | Done | Workspace (`apps/api`, `packages/types` generated from openapi.yaml), 7 reversible migrations (0001 = existing-platform stand-in; 0002–0007 additive), platform stand-in sources, partner/company/exchange repos, `SecretsStore` (AES-256-GCM), `Flags`, stand-in session + `GET /admin/v1/session`, seed, strict contract response validator. 18 tests: migration round-trip, existing records load unchanged, encryption at rest, seed | `AssetStore`, `AudienceSource`, reservations/billing tables, partner tokens: built with the packages that use them (12, 13, 15, 16) | — |
| 2 | Shared UI | Done | `apps/admin` (React 18.3, Vite 6, AntD 5 themed with `phTheme`, Tailwind 4 `@theme`, AG Grid 32 Alpine vars, Material Symbols, Roboto). `SaveBar` (sticky, never fixed), `useDraft`, `UnsavedChangesProvider` (router blocker + in-page `guard`, AntD confirm "You have unsaved changes. Discard them?"), `DeleteDialog`, `InfoTip` (AntD Tooltip, flips below when there's no room), `ListPageLayout` (260px sticky list + full-width column), `AppShell` (title, divider, 230px nav collapsing to 56px icons below 900px). 11 tests | `ListEditor`, summary chips and collapsible panels move to the first package that uses them (3, 7) | — |
| 3 | Display Types | Done | API: stand-in `GET/POST /admin/v1/display-types`, `GET/PUT …/{id}/record` (creates referenced auto/zone playlists), `GET /admin/v1/playlists`, and this build's `PUT …/{id}/extensions` with server-side slot validation (one slot per rotation position, owner rules, partner and seat exist, named blocked advertiser withdrawn unless already set, whitelist-only needs a non-empty whitelist). Early read side of `GET /admin/v1/partners`, `/advertiser-settings`, `/advertisers` (§9). UI: nav "Display Types", title "Display Types Details", list (New display type, touch point, W×H, structure and feature badges), one-column form (preview, Touch Point, name, canvas, background, default playlist), four collapsed panels with summary chips, Slot assignment (cards and AG Grid table), broken-partner callout with Fix connection, save bar and unsaved-changes guard. Tests: API 40 (strict contract checks on every endpoint above), admin 23 (summary chips, slot helpers, page structure, flag off). Browser-checked at 1163px: no horizontal scroll, save bar enables only on change, tooltips open above and flip below near the top | Delete (bin icon and dialog) is package 4 | Q1–Q3 |
| 4 | Delete a display type | Done | `GET …/display-types/{id}/delete-check` and `DELETE …/display-types/{id}` (409 `has_dependents` listing each display and its store; the auto-created playlist is kept; Q47: the sold/reserved position count is logged, and reservations arrive in package 15). UI: a bin icon on each list row, and the delete dialog (blocked: warning, list of displays, Close, Delete disabled; allowed: permanent-delete text, Cancel, Delete). A confirmed delete applies immediately and leaves other unsaved edits as they were; an unsaved new type is removed from the draft only. Tests: API +3, admin +2. Browser-checked | — | — |
| 5 | Playlist Management | Done | API: `PUT /admin/v1/playlists/{id}/record` (rename only; rejects assignment fields), `GET …/delete-check` and `DELETE` (409 `has_dependents` for a default or zone playlist). UI: nav "Playlist Management", count line, AG Grid table (rename inline, auto-created pill, expandable assignments with Open →, delete) and delete dialogs. Changes apply immediately, as in the prototype (the spec doesn't list this page under *Saving changes*). Shared `Grid` component (fit to width, auto height), now also used by Slot assignment. Tests: API +4, admin +1. Browser-checked: rename, both delete dialogs, Open → | New playlist and assignment editing (decision 4) | — |
| 6 | DSP Integration nav + Exchange settings; sellers.json | Done | API: `GET/PUT /admin/v1/exchange` (all four fields required, bare domain, valid email; `published` and `sellersJsonUrl` once complete) and `GET /sellers.json` (PUBLISHER, not confidential; 404 until complete or with the flag off). UI: nav "DSP Integration" (flag-gated), a list column (COMPANY: Exchange settings, Advertiser settings, Shared Targeting Variables with their subtitles; PARTNER DSPS: DV360, Amazon Ads DSP and The Trade Desk with state and lists-link lines; contracts to icons below 900px), one draft and save bar for the whole section, a leave-page guard, and the Exchange settings page. Tests: API +7, admin +4. Browser-checked: edit, validation error, save, guard | The section opens on Exchange settings until package 7 adds Advertiser settings | — |
| 7–17 | — | Not started | — | — | — |

## 13. Prototype comparison (per screen)

Filled in as each package finishes. Differences are removed, not justified.
The items below are either Rob's decisions (§6), the defect fixes (§8), the
ph-designer look (the skill decides how it looks), or later packages. None is
a content difference.

### Display Types (package 3)

I compared it against `prototype-reference` running locally, with the
Menu Board — Long Format type selected and every panel open, at 1163px.
Title, list, form fields and order, panel titles, summary chips, every
select's options, slot cards, the slot table columns and options, the
broken-partner callout, the zone cards and the save bar all match.

| Where | Prototype | Build | Why |
|---|---|---|---|
| Nav | Four items | Display Types only | Playlist Management, DSP Integration and Advertisers arrive with packages 5, 6 and 10 |
| List | 4 Responsive Web types | Not present | Decision 1 |
| Touch Point | 5 options | Digital Signage, Kiosk | Decision 1 |
| Preview | Idle / Connected toggle | None | Decision 1 |
| Canvas size, Phantom Area(s) Size | Info icon with no tooltip | No icon | Defect fix 5 |
| Enabled Features | Hint sentence under each feature | Tooltip beside the label | Decision 2 |
| Enabled Features | Enable QR Control can be switched on without a phantom zone | Disabled until the zone is defined | Defect fix 3 |
| Enabled Features | Empty Vision/AI note | None | Defect fix 6 |
| Phantom Zone (off) | "No phantom zone on this display type. QR Control cannot be enabled without one." | Removed | Decision 2. The *Define phantom zone* tooltip already says this |
| Multi-Zone Layout (off) | "Single zone — the display runs the Default Playlist across the full canvas." | Removed | Decision 2. The collapsed chip already reads *Single zone* |
| Fix connection | Opens Advertiser settings | Opens that DSP's page | Defect fix 1 |
| Colour fields | Native colour inputs | AntD `ColorPicker` | ph-designer components |
| Field labels | `#333` | Muted `rgba(0,0,0,0.45)` | ph-designer `components.md` §13 |
| Name field | "Display Type / Element Name" | "Display Type Name" | Rob, 19 Sep (Q2) |
| Unsaved-changes prompt | `window.confirm` | AntD confirm with the same text, OK / Cancel | ph-designer components |

Kept on the page as status (decision 2): "Not enabled for this company —
contact Platform Admin.", the broken-partner callout, "On the blacklist —
this position cannot fill.", "Not connected", the preview caption, and the
save bar message.

### Exchange settings (package 6)

Compared against the prototype at 1163px. The list column (both section
labels, three company rows with their subtitles, the three DSP rows with
state and lists-link lines), the page heading and its tooltip, the
Published/Incomplete pill, SELLER OF RECORD with its tooltip, the four
required fields with their placeholders, the Domain tooltip and the
sellers.json callouts all match.

| Where | Prototype | Build | Why |
|---|---|---|---|
| Published pill and callout | Follow the unsaved fields as you type | Follow the saved settings | Spec §7: "once saved and complete, the screen shows where sellers.json is published and that it is live" |

### Delete a display type (package 4)

Checked against the prototype in the browser. The dialog title, icon, both
body texts, the assigned-display list (tv icon, name, "· store") and the
buttons (Close with Delete disabled; or Cancel and Delete) match. No
differences.

### Playlist Management (package 5)

Compared against the prototype's Playlist Management at 1163px. The count
line ("**n** Playlists · **m** unused"), the table columns (Playlist,
Assigned to, delete), the rename pencil with its inline input and
check/close, the "auto-created with …" pill, the "n assignments" expander
with its "Currently assigned to" list and **Open →**, the "unused" pill, and
both delete dialogs match.

| Where | Prototype | Build | Why |
|---|---|---|---|
| Header | **New playlist** | Not present | Decision 4 |
| Expanded row | "Reassign every display type and zone above before this playlist can be deleted." as a footer line | Tooltip on "Currently assigned to" | Decision 2 |
| Page | Footer paragraph "A playlist is created automatically …" | The page title's tooltip | Decision 2; spec *Help text*: page-title tooltips say what the page covers |
| Rows | Assignments for the web types | Not present | Decision 1 (no web display types in the seed) |
| Delete button | Outlined red button with a bin | AntD `danger` small button with a bin | ph-designer components |


## 14. Mock DSP APIs (Rob, 19 Sep 2026)

Rob's answers:
- Build it **with package 9**, the first package that calls it.
- Seats and advertisers are controlled through the **control API plus a
  small test page** served by the mock service. The page is separate from
  the product screens and never shipped with them.
- **`seats` is added to `Partner`.**

A separate local service, `apps/dsp-mocks/` (Fastify, its own port, default
4100). It serves mock versions of each DSP's real API, so the POC's DSP
clients make real HTTP calls in the providers' own request and response
shapes. It never calls a real DSP.

**This changes the brief's DSP decision.** The brief put an in-process mock
behind each `DspClient` interface. Instead, each `DspClient` becomes a real
HTTP client for that provider, pointed at the mock's base URL
(`DV360_BASE_URL`, `AMAZON_ADS_BASE_URL`, `TTD_BASE_URL`, all defaulting to
the local mock). On integration, engineering only changes the base URLs to
the real ones (sandbox first).

### What each mock implements

These are the endpoints that the connect and seat-pull flow (packages 9 and
17) and the bid flow (package 15) need. Nothing else.

| DSP | Auth, as the real API does it | Account and advertiser endpoints | Bidder |
|---|---|---|---|
| Google DV360 (Display & Video 360 API v4) | `POST /token`: OAuth 2.0 JWT-bearer grant, using the service account's signed assertion | `GET /v4/partners/{partnerId}`; `GET /v4/advertisers?partnerId=&pageSize=&pageToken=` returning `{advertisers:[{name, advertiserId, partnerId, displayName, entityStatus}], nextPageToken}` | `POST /openrtb2/bid` |
| Amazon Ads (Ads API + Login with Amazon) | `POST /auth/o2/token`: refresh-token grant with the LWA client ID and secret. Failures use the real error shape, e.g. `invalid_grant` | `GET /v2/profiles`; `GET /dsp/advertisers` (`Amazon-Advertising-API-ClientId` and `-Scope` headers), returning `{totalResults, response:[{advertiserId, name, currency, url, country, timezone}]}`; one base path per region (NA/EU/FE) | `POST /openrtb2/bid` |
| The Trade Desk (API v3) | `TTD-Auth` header carrying the API token | `POST /v3/advertiser/query/partner` `{PartnerId, PageStartIndex, PageSize}`, returning `{Result:[{AdvertiserId, AdvertiserName, PartnerId, CurrencyCode}], ResultCount, TotalFilteredCount, TotalUnfilteredCount}` | `POST /openrtb2/bid` |

The bidder answers OpenRTB 2.6 bid requests. Each bid comes from one of that
DSP's seats (`seatbid[].seat`) and one of its advertisers (`adomain`, `crid`,
`cat`, `price`).

### Control API and test page (for testers; not part of the product contract)

The mock service also serves a plain page at `/` that edits the same state
through the control API: seats, advertisers, auth failure and bidder
behaviour for each DSP. It uses the same ph-designer look, but it's a test
tool, not a product screen.

`/_control/{dsp}` for `google_dv360`, `amazon_dsp` and `the_trade_desk`:

- **Seats:** `GET/POST/DELETE /_control/{dsp}/seats`. A seat is `{seatId, name}`.
- **Advertisers:** `GET/POST/PATCH/DELETE /_control/{dsp}/advertisers`. An
  advertiser is `{id, name, seatId, domain, categories, currency}`. These are
  the advertisers the account API returns and the bidder bids as.
- **Auth behaviour:** `PUT /_control/{dsp}/auth`, e.g. `{accept: false,
  error: "invalid_grant"}` to reproduce "refresh token rejected".
- **Bidder behaviour:** `PUT /_control/{dsp}/bidder`, e.g. no-bid, a fixed
  price, bidding below the floor, an unapproved `crid`, or a blocked
  `adomain`, to test pre-auction enforcement.
- **Reset:** `POST /_control/reset` restores the seed state.

The seed mirrors the prototype:
- DV360 partner 884512 has seats 884512 and 884513, with Nestlé and Swisse.
- Amazon has L'Oréal, and its auth is set to reject the refresh token.
- The Trade Desk has one test advertiser.

State is in memory, so a restart resets it.

### How it reaches the product

Package 9's **Connect / Re-test connection** calls the provider's auth and
advertiser endpoints on the mock. It stores the seats and advertisers it gets
back on the partner, which is spec §8's `seats`, "pulled on connect". A
tester adds an advertiser through the control API, re-tests the connection,
and the new advertiser appears on the Advertisers screen and in the slot
picker.
