# Build plan — Display Types & DSP Integration

Status: **plan only, nothing built.** Waiting on the *Questions* in §6
before package 1 starts (brief, *How to work* step 1).

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
  - Count line "**n** Playlists · **m** unused". **New playlist** opens an
    inline input.
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
  - No save bar in the prototype (see Q4).

**Seed data** (`model/data.js`, becomes `apps/api/src/seed/`):
- Display types:
  - Landscape (Digital Signage, 1920×1080)
  - Portrait (Digital Signage, 1080×1920)
  - Menu Board — Long Format (Digital Signage, 5760×1080, 3 slots, 3 zones)
  - 4 Responsive Web types (see Q1)
- 12 playlists and 6 displays.
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
   - API: `GET /admin/v1/playlists`, `PUT …/{id}/record`,
     `GET …/delete-check`, `DELETE`.
   - Creating a playlist needs an endpoint the contract lacks (Q6).
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

## 6. Questions (open — need an answer before building)

### Git
- **G1.** *Resolved:* branch created from `main`; only `dsp-integration/`
  is staged.
- **G2.** The Definition of done says "A PR opened against main", but the
  brief says to push only when you ask. I'll leave the PR until you ask.
  Is that right?

### Prototype vs spec — which wins?
1. **Out-of-scope UI in the prototype.** The prototype renders things the
   spec removes:
   - Responsive Web, Mobile App and Mobile Store Site touch points, and 4
     seeded Responsive Web display types
   - Element Type, the web preview and its settings
   - the pairing *Idle / Connected* toggle on the signage preview
   - The QR Control *Mobile site template* select is an existing schema field.

   Proposal: Touch Point offers Digital Signage and Kiosk only; the web
   types are left out of the seed; the Idle/Connected toggle is dropped; the
   Mobile site template select stays. OK?
2. **Explanatory copy on the page.** The spec says explanations are tooltips,
   never paragraphs or hint lines. The prototype shows about 25 explanatory
   sentences on the page. Examples:
   - the hint under each Enabled Features toggle
   - "Single zone — the display runs the Default Playlist…"
   - the Playlist Management footer paragraph
   - "Every advertiser using the platform, across all DSPs."
   - the Add card description and "You will need" list

   Proposal:
   - Keep on the page what the spec calls status: issues, callouts about
     state, the save bar message, delete-dialog warnings and empty states.
   - Move each explanatory sentence into the tooltip of the element it
     describes.
   - Drop a sentence where no element fits.

   Do you want that, or should I build the prototype's copy exactly?
3. **Direct / house.** You've said it's in scope (spec §6). But in the
   prototype it can't be reached: it isn't a slot owner, it isn't an option
   in the partner picker, and no seed partner creates the "house book" page.
   The contract also has no way to express it: `Provider` is
   DV360/Amazon/TTD only, the slot `owner` is `internal`/`advertiser`/
   `retail`, and `listMode` is `rtb`/`whitelist_only`. How should it work?
   Proposal:
   - The *Assigned to* partner select gets a **Direct / house** option. Its
     advertiser select lists named advertisers only, with no RTB or
     whitelist options.
   - Stored as `partnerId: "house"` with `advertiser` set.
   - No house page in the DSP list.
   - It needs a contract note on `partnerId`. Where do house advertisers
     come from, since they have no DSP seats? Free text?
4. **Advertisers save bar.** The prototype has none, so edits can never be
   saved. The spec requires Save changes on this screen and the contract has
   `PUT /admin/v1/advertisers`. Proposal: add the standard save bar, as the
   spec says.
5. **Slot quota.** The spec's functional requirements list a "store quota"
   in the slot editor, and the contract's slot has `quota`. The prototype
   has no quota field. Should I build it (what does it look like?) or leave
   it out?
6. **Playlist Management.**
   - The prototype saves immediately (no save bar), which matches the spec
     not listing it under *Saving changes*.
   - Its **New playlist** button has no endpoint in the contract (the POC
     stand-in group has list, PUT record and delete only).
   - Assignments are view-only. The spec (§2) says "edit… its assignment to
     display types and zones", and `PUT …/record` takes `assignments`, but
     the prototype has no editor for them.

   Should I drop New playlist or add an endpoint? And build an assignment
   editor (no design) or rename only?
7. **Prototype defects.** Proposal:
   - **Fix connection** opens the broken DSP, not Advertiser settings.
   - Mask the private-key field (the guardrail says credentials are never
     shown in full).
   - Enforce QR Control needing a phantom zone. The spec tooltip says
     defining the zone "makes Enable QR Control available".
   - Relinking keeps the prototype's warning callout with no extra dialog.
   - The two label info icons with no text (*Display Canvas Size*,
     *Phantom Area(s) Size*) are dropped rather than given invented text.
   - The empty Vision/AI note is dropped.

   OK?

### Contract gaps
8. **Activation.** `CampaignSource.setActivation` and the POC table's
   activation toggle have no endpoint. The approval schema has no
   activation state, and nothing lists campaigns with their activation.
   Can I add a POC stand-in endpoint, for example
   `GET /admin/v1/campaigns` and `PUT /admin/v1/campaigns/{id}/activation`,
   rejecting with `not_approved` when the campaign isn't approved?
9. **Review panel creative.** The spec says the panel shows "creative
   rendered on the target display type's canvas". The `Approval` schema has
   no display type, canvas size or asset URL, and no endpoint serves
   uploaded assets. Can I add `displayTypeId` and `assets[]` (url, version)
   to `Approval`, plus an asset read endpoint?
10. **Session.** API.md and openapi say the session is "set by the POC's
    user switcher", but the brief says no switcher and no UI. The contract
    also requires a `ph_session` cookie, but nothing issues one. Proposal:
    the API treats every admin request as the `POC_ROLE` user. The two
    stale "user switcher" phrases are corrected in both contract files.
11. **Running the auction.** Nothing in the contract triggers the OpenRTB
    auction for a play window. Tier-2 `POST /v1/reservations` bids exist,
    but they don't run DSP auctions. Proposal: an internal scheduler in
    `apps/api` that clears each window ahead of time, plus an npm script to
    run one window for the demo. No endpoint. OK?
12. **Billing output.** No endpoint or screen is specified. Proposal: billing
    lines written to a `billing_lines` table by a job, with tests and no
    API. OK?

### Behaviour and structure
13. **Flag off.** What should `dspIntegration=false` show? Proposal:
    - The DSP Integration, Advertisers and Campaigns (POC) nav items are
      hidden.
    - `/v1/*` and the DSP/advertiser/approval admin endpoints return 404.
    - The slot owners Advertiser and Stores are hidden on Display Types.
    - Display Types and Playlist Management otherwise work the same.
14. **Where campaign-approval lives.** The brief says one module,
    `campaign-approval/`, and `packages/` for shared code. I propose
    `packages/campaign-approval/`, containing both server and UI code. OK?
15. **Advertiser identity.** The prototype keys advertisers by lower-cased
    name, but the contract uses `advertiserId`. Proposal: a stable slug id
    per seat name (for example `loreal`), shared across DSPs. OK?

## 7. Defaults in use (brief, *Defaults for open questions*)

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

## 8. Progress

| # | Package | Status | Done | Deferred | Questions hit |
|---|---|---|---|---|---|
| 1–17 | — | Not started | — | — | G2, 1–15 |

## 9. Prototype comparison (per screen)

Filled in as each package finishes. Differences are removed, not justified.
