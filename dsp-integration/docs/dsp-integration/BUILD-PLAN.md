# Build plan — Display Types & DSP Integration

Status: **packages 1–11 built** (19 Sep 2026): the admin experience is
complete, behind the flag. Stopped for Rob's review before the exchange
packages (12–17).

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
| Condition `op` enum → the platform's operator keys: `include`, `match_exactly`, `exclude_or`, `exclude_and`, `equal`, `not_equal`, `greater_than`, `less_than`, `greater_than_or_equal`, `less_than_or_equal` (19 Sep, Rob, Q4) | The six assumed operators didn't match the real Targeting tab (which has *matches exactly*, excludes [OR]/[AND] and ≥/≤); rules are stored in the platform's structure, so the keys must map 1:1 |
| `POST /v1/reservations`: approved **and activated** campaigns only, and only while the window's auction is open (7 days before until the auction runs, 6 hours before); `Conflict` description names it (19 Sep, Rob, Q13/Q14). Wording only; no new fields or codes | Rob's answers to Q13 and Q14 |
| `GET /admin/v1/booking-schedule` and schemas `BookingSchedule`, `BookingRevenue`, `BookingRevenueTotals` (19 Sep, Rob) | Rob asked for a schedule of booked and available slots with booking revenue, linked from Available Inventory |
| `AdvertiserSettingsInput` (and so `AdvertiserSettings`): `auctionOpensHours`, `playWindowHours`, `auctionCutoffTime` (19 Sep, Rob's board ticket and Q13) | The auction schedule becomes retailer settings, replacing the POC config values |
| `ReservationCreate.bidCpm` required for both types: the bid, or the reservation price agreed through the DSP (19 Sep, Rob, Q11) | A reservation must record the price it was booked at |
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
- **Package 11 structure.** The module is `packages/campaign-approval/`
  (decision 6). Its migration is numbered 0100+ so it can't collide with the
  host's. `reviewedBy` records the session user's name. The stand-in screen
  adds a "Campaigns (POC)" nav item after Advertisers (flag-gated, marked
  STAND-IN in code), as the brief's *Package 11* asks.
- **The review panel's compliance note.** Spec §3's reviewer check
  ("advertiser artwork must not contain price, offer terms or disclosures")
  is the tooltip on the panel's Creative heading. There's no separate page
  text.
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

- **Package 12 validates targeting permission already.** `POST
  /v1/campaigns` has `422 variable_not_permitted` in the contract, so the
  permission check (`domain/targetingValidation.ts`) arrives with package
  12. Package 14 applies it to the forecast and adds its unit tests.
- **`source` on submitted campaigns.** Campaigns created through `POST
  /v1/campaigns` are `api`. `dsp` is kept for creative that arrives in a
  bid response (package 15), which spec §3 says goes to the approval queue.
- **An upload's version.** Every accepted upload (baseline or a targeted
  version) is a new asset version of the campaign (`v1`, `v2`, …), which is
  what approval is keyed on.

- **Package 15 decisions.**
  - `imp` carries both `video` and `banner` at the canvas size. API.md's
    example shows `video` only, but package 12 accepts image creative, which
    a DSP can only return through `banner`. `minduration` is 1 and
    `maxduration` the slot, matching the upload check (no longer than the
    slot).
  - No `device.geo`: stores have no location yet (spec open question 35).
  - `badv` needs domains, but the lists hold names. A blacklist entry that
    is a domain goes as is; a name goes as that advertiser's domain when the
    DSP returned one on connect. To match bids, seats now keep the
    advertiser's `domain` internally (the API still returns only `{id,
    name}`).
  - In the POC, bid requests always go to the mock DSP service (`bidders`
    in `config.ts`), never to the partner's configured bidder endpoint, so
    no real DSP is called. On integration they go to the partner's
    endpoint.
  - An unknown creative is fetched only from its DSP's own creative host,
    never from an arbitrary URL in a bid.
  - Reservations and every DSP bid are stored in `reservations` (migration
    0010) with their outcome and reason; crid → campaign is in
    `dsp_creatives` (migration 0011).

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

4. ~~Operators per variable~~ **Resolved (Rob, 19 Sep):** matched to the
   real Targeting tab on demo.personalisationhub.com (campaign 7722; the
   tab's `campaign-targetings/categories/{category}/operators` metadata, read
   only, nothing saved). The platform has five operator sets, and the
   contract's `op` enum now uses its keys (lower-cased) so stored rules map
   1:1: `include`, `match_exactly`, `exclude_or`, `exclude_and`, `equal`,
   `not_equal`, `greater_than`, `less_than`, `greater_than_or_equal`,
   `less_than_or_equal` (§7).

   | Our variable | Platform category | Operators |
   |---|---|---|
   | Fixed / Variable Store Segments, Display Tag(s), Suburb, State, Country, Languages | same names (Store / Location) | List: includes selected, matches exactly, excludes selected [OR], excludes selected [AND] |
   | Reason for Visit (Aggregate) | Queueing / Aggregate | Compare: equal, not equal, greater than, less than, ≥, ≤ |
   | Computer Vision Gender | CV Gender | Compare + matches exactly |
   | Computer Vision Estimated Age | CV Age | Compare |
   | Age | Visitor / Customer → Age | Compare |
   | Gender | Gender | equal, not equal |
   | Purchase Intent, Visitor Segments (Audience / Segments), Device Type (Individual), Product Holdings, Product Type, Plan Type, Plan Value, Purchase History, Events, SKUs | same (Visitor / Customer) | List |
   | Store Open / Closed | *not on the platform* | kept as equal, not equal |
   | Postcode | *not on the platform* | List, like Suburb |

   Store Open / Closed and Postcode don't exist on the Targeting tab; they
   are spec §6 defaults, so they stay with an assumed set. The fifth set
   (*equal* only) is for CV Passerby / CV No Visitor Detected, which aren't
   shared variables. REQUIREMENTS.md's example payloads still say
   `includes_selected`; the contract (`include`) wins.

5. ~~When do Connect and Disconnect take effect?~~ **Resolved (Rob, 19
   Sep):** immediately, as the contract says. While credential edits are
   unsaved, Connect is disabled with the tooltip "Save changes first".
6. ~~Renaming a DSP~~ **Resolved (Rob, 19 Sep):** the name is a plain
   heading, and the contract doesn't change.

7. ~~Serving creative files~~ **Accepted (Rob, 19 Sep):** the POC serves
   AssetStore files at `/assets/{file}`, outside `/api`, as a stand-in for
   the platform's asset hosting; on integration `assetUrl` becomes the
   platform's asset URL. No contract change. To be revisited later.

8. ~~Asset check limits~~ **Resolved (Rob, 19 Sep):** images up to 10 MB,
   video up to 100 MB (`assetLimits` in `config.ts`). The rest stays as
   built: PNG, JPEG or MP4; 20,000 kbps; at least the canvas (or a zone) in
   the same shape within 1%; a video no longer than its slot.
9. ~~How targeting shrinks a forecast~~ **Accepted (Rob, 19 Sep):** the
   `AudienceSource.targetedShare` seam, with the POC halving the audience per
   AND group, stays until the platform's own targeting data answers it.
10. ~~Stores in the design~~ **Resolved (Rob, 19 Sep):** stores, like
    display types, are managed by the primary Personalisation Hub platform;
    this build only has to read them. New `StoreSource` stand-in
    (`platform/StoreSource.ts`, migration 0014: a `stores` table with id,
    name and region, and `displays.store_id`; existing displays are linked
    from their store name). Store counts use unique platform store IDs, the
    inventory's `storeIds` filter takes platform store IDs, `region` matches
    the store's region, and the delete check names each display's store from
    the store record. Engineering points `StoreSource` at the platform.
11. ~~What a reservation costs~~ **Resolved (Rob, 19 Sep):** the price is
    agreed through the DSP, and we must record what it was booked at.
    `POST /v1/reservations` now requires `bidCpm` for `type: reserve` too —
    the agreed reservation price — which must clear the effective floor
    (`below_floor` otherwise); the reservation is booked at it
    (`clearingCpm`), and billing and the booking schedule use it.
12. ~~Category whitelist scope~~ **Accepted (Rob, 19 Sep):** the category
    blacklist applies to every bid; the category whitelist only on
    whitelist-only positions.
13. ~~When the auction runs~~ **Resolved (Rob, 19 Sep):** three retailer
    settings in **Advertiser settings → Auction schedule**, directly under
    Pricing, in this order: **Auction opens** (how long before the cutoff
    bidding opens; days + hours; default 7 days), **Play-window length**
    (days + hours; default 24 hours) and **Auction cutoff time** (daily,
    UTC, every half hour; default 18:00, the six hours before a midnight
    window Rob accepted). A window's auction closes at the last cutoff at or
    before it starts — the scheduled job clears it then — and bidding opens
    *Auction opens* before that. Windows start at UTC midnight and follow
    each other back to back from a Monday, so 7-day windows run Monday to
    Monday. The length can't change while future windows are bid on or
    booked (400 `validation_failed`, since existing bookings are keyed on
    it). Times are UTC because the platform's company time zone isn't
    available to this build.
14. ~~Does the hand-off activate the campaign?~~ **Resolved (Rob, 19 Sep):**
    no — a campaign must already be approved **and activated** before it
    can bid or be reserved, so a winning bid fits straight into the slot.
    Reservation, the auction (API and DSP bids) and the hand-off all refuse a
    campaign that isn't activated ("The campaign is approved but not
    activated.", code `not_approved` — the contract has no separate code).
    A DSP creative that is queued and approved still needs activating in the
    Campaigns table before its bids can win.

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
| 7 | Advertiser settings | Done | API: `PUT /admin/v1/advertiser-settings` (any ISO 4217 currency, positive floor and multipliers; an entry on both lists is rejected (`validation_failed`), matching case-insensitively; entries trimmed and de-duplicated) and `GET /admin/v1/available-inventory` (every advertiser-owned slot, no advertisers column). Pricing maths in `domain/pricing.ts` with the brief's unit tests (floor × personalised × interactive × advertiser multiplier; 450 and 360 examples); the Advertisers endpoint now uses it. UI: the Advertiser settings page (Pricing with the ISO 4217 currency picker, four list editors (adding to one list removes the entry from the other; seat and category suggestions), Where these apply with Open, Available Inventory as an AG Grid table with Open). The DSP Integration section now opens on it, as the prototype does. Shared `ListEditor`. Tests: API +9, admin +1. Browser-checked: moving an advertiser between lists, suggestions, save | — | — |
| 8 | Shared Targeting Variables | Done | API: `GET/PUT /admin/v1/targeting-variables` (24 default variables with tooltip text; access is `"all"` or DSP ids; unknown variables and unknown DSPs are rejected) and the Partner API's first endpoint, `GET /v1/targeting/attributes`. The caller gets only the variables enabled for it: `"all"` counts only if the DSP is connected, and a named DSP always does. Never values. Partner API auth: one static bearer token per seeded partner (`PARTNER_TOKENS`); 401 without one, 404 with the flag off. UI: the page (two groups, each an AG Grid Variable / DSPs table, example values as each variable's tooltip, header tooltip) and `DspPicker` (All connected DSPs or individual DSPs with connection state, shown as pills). Tests: API +6, admin +1. Browser-checked: picker, save. Operators re-matched to the real Targeting tab (Q4 resolved) | — | — |
| 9 | DSP page + Google DSP (DV360) | Done | **API and mocks:** `apps/dsp-mocks`, a mock DSP service (§14) with the DV360 token endpoint and API v4 (`/v4/partners/{id}`, `/v4/advertisers` with paging), a control API and a test page. A real DV360 client (`apps/api/src/dsp/googleDv360.ts`): it signs an RS256 service-account JWT, exchanges it at the token endpoint, checks partner access and pages through the advertisers, all against the mock by default (`DV360_TOKEN_URL`, `DV360_API_BASE_URL`). The seed now holds a real, freshly generated key file. Endpoints: `POST /admin/v1/partners` (Test, adopting the company lists, one per provider), `GET/PUT /admin/v1/partners/{id}` (secrets write-only; Live refused with 409 unless connected with the bidder integration complete; unlinking copies the company lists down and relinking discards the DSP's own; https bidder endpoint; Amazon region fixed once connected), and `POST …/connect` and `POST …/disconnect`. Tests: API +11 (run against the mock in-process), mocks +3 **UI:** the DSP page. In order: header (provider icon, the name as a plain heading (Q6), provider and last sync, status pill), issues at the top (connection error with the DSP's reason, missing credentials, missing bidder fields, or the green no-issues line), Mode (Test/Live, Live disabled until connected with the bidder integration complete), Connection credentials (per provider; every secret masked, including the DV360 key file), Connect / Re-test connection / Disconnect (immediate (Q5); Connect is disabled with "Save changes first" while credential edits are unsaved), Bidder integration, and Advertiser whitelist / blacklist (the linked callout with Unlink and edit, or the DSP's own lists with Relink and seat suggestions). The Add card (You will need, Add partner / Cancel) creates a draft DSP; Save changes creates it (`POST`, then `PUT`) and opens its page. Fixed a `useDraft` bug (a second refetch after a save could leave a stale draft) that affected every page. Tests: admin +5 | Connecting Amazon Ads DSP and The Trade Desk (package 17) | Q5, Q6 (answered) |
| 10 | Advertisers screen (admin only) | Done | API: `PUT /admin/v1/advertisers` (admin scope, 403 otherwise; known advertiser ids only; boolean approval; multiplier > 0; applies to future submissions). UI: the Advertisers nav item directly below DSP Integration, for admins only (flag on). The screen: an Admin only pill, then an AG Grid table (Advertiser, Via, Campaign approval switch with Required / Not required, Floor multiplier, Effective floor that updates as you type, each column with its tooltip), the empty state, and the save bar (decision 4). The prototype's intro line is the page-title tooltip (decision 2). Tests: API +3, admin +2. Browser-checked | — | — |
| 11 | Campaign approval (drop-in module) | Done | `packages/campaign-approval/`, which imports nothing from the app. Contents: the `CampaignSource` adapter interface and a POC adapter over the stand-in campaign store; the state machine (Draft → Awaiting approval → Approved / Rejected; a change returns an approved campaign to Awaiting approval; auto-approve when the advertiser doesn't require approval); an approval store kept beside the campaign (keyed by campaign and asset version) with an append-only audit log; the service with `isCampaignEligible`, `submit`, `approve`, `reject`, `changed` and `setActivation`; Fastify routes for the four contract endpoints (approver-only approve/reject; stale asset version → 409); its own migration (0100); UI components (`ApprovalStatusBadge`, `ApprovalActions`, `ApprovalStatusFilter`, `ApprovalReviewPanel`, `useCampaignApprovals`); and contract suites written against the adapter. The API wires it in: stand-in `GET /admin/v1/campaigns` and `PUT …/activation` (422 `not_approved` unless approved), a creative store (migration 0008, `AssetStore` in `data/assets/`, files served at `/assets/{file}`), and seeded example campaigns (approved automatically, awaiting, rejected, draft). Admin: the stand-in "Campaigns (POC)" screen (flag-gated, own folder). `docs/dsp-integration/CAMPAIGN-APPROVAL-INTEGRATION.md` covers all six steps. Tests: module 29 (state machine, component contract tests, contract suites on a reference adapter), API +18 (the same contract suites on the POC adapter, endpoints, enforcement), admin +1. Browser-checked: filter, review panel, approve, activate | — | — |
| 12 | Submission API | Done | Partner API `POST /v1/campaigns` (the advertiser must be one of the calling DSP's seats; baseline pricing type; targeted versions with unique ids, integer priority and rules in the Targeting-tab shape; rules checked against the variables the DSP may target → 422 `variable_not_permitted` naming each variable; stored through `CampaignSource.createCampaign` as `source: api`), `POST …/assets` (multipart, `@fastify/multipart`; the type is read from the bytes — PNG, JPEG or MP4 — never from the name; checks `file_type`, `file_size`, `bitrate`, `aspect_ratio`, `dimensions`, `duration` against the display type's canvas or a zone and the slot's share of the loop; any failure → 422 `checks_failed` with each reason, and nothing is stored; a pass writes a new asset version, and on a submitted campaign calls the approval module's `changed`, so it returns to Awaiting approval and stops — Q38), `POST …/submit` (adds `baseline_present` and `targeting_permitted`, re-checked against today's access; the eight checks are recorded for the reviewer; already awaiting/approved → 409; rejected → 409 until a new version is uploaded) and `GET …/status`. A partner sees only its own campaigns (others 404). Approval is enforced by the module's `isCampaignEligible` (activation now; reservation, auction and hand-off in 15–16). Tests: API +16 (contract-validated) | — | Q8 |
| 13 | Inventory API | Done | `GET /v1/inventory` (filters: advertiser, display type, touch point, stores, region, date range, window status; cursor pagination), `GET …/{positionId}`, `GET …/{positionId}/availability` and `POST …/forecast`. A position is an Advertiser-owned slot (`<displayTypeId>.s<slot>`); HQ and Stores slots are never exposed. Visibility (`domain/positions.ts`): a DSP that isn't connected sees nothing; a slot tied to another DSP is hidden; the caller's advertiser (or, without one, any of the DSP's seats) must be able to buy it — not blacklisted, on the whitelist for whitelist-only, the named advertiser for a reserved position. Each position returns screen and loop context (slot duration = loop ÷ slots, share of voice = 1 ÷ slots, OpenOOH venue type), store/display counts, assignment, assumed views per window, and the four effective floors for the caller's advertiser. Windows are 24 h (Q27), aligned to UTC midnight; the current and past windows are *unavailable*, as is a display type with no displays; a won or reserved window is *sold*; a position held for a named advertiser is *reserved* unless that advertiser is asking. Forecast = assumed views of the windows still available × the targeted share, priced at the effective floor (personalised when the rules use a Personalisation Variable). New: `AudienceSource` stand-in (migration 0009, seeded VAC-d) and the `reservations` table and repo (migration 0010, written from package 15). Tests: API +10 | Zone per position: slots aren't tied to zones in the data model, so `zone` is always `null` | Q9, Q10 |
| 14 | Targeting permission validation | Done | `domain/targetingValidation.ts` (from package 12) is the single check for submitted rules, used by `POST /v1/campaigns`, the submit re-check and now the forecast: every condition's variable must be enabled for the calling DSP ("All connected DSPs" only while it is connected) → 422 `variable_not_permitted` naming each variable once, including ones that aren't shared variables; the rules must be in the Targeting-tab shape (AND groups of OR conditions), with the variable's own source and one of its operators (Q4), and 1–100 values per condition (Q48) → 400. Rules are stored as submitted through `CampaignSource`; nothing evaluates them. `throwIfRejected` gives both routes the same errors. The forecast's rules now shrink it by `AudienceSource.targetedShare` (Q9). Tests: API +9 (unit tests for the validator, forecast with rules) | — | — |
| 15 | SSP auction | Done | `exchange/openrtb.ts`: an OpenRTB 2.6 request per position, window and DSP — `imp` (video and banner at the canvas size, `bidfloor` = the position's base effective floor in the company currency, `qty.multiplier` = assumed views with `sourcetype` 2 where Vision/AI or MIST counts them, `exp` = the window, screen and loop context in `imp.ext.ph`), `dooh` (OpenOOH venue type, publisher = the seller of record), `source.schain`, `cur`, `bcat` (IAB codes of the category blacklist), `badv` (blacklist domains), `tmax` 300, `at` 1; never a `user` or `device` object or any visitor data. `dsp/bidder.ts` sends it within 300 ms and paces each DSP to 500 QPS (Q46). `exchange/enforcement.ts` (shared with `POST /v1/reservations`): effective floor for the campaign's type and advertiser, blacklist (by name or `adomain`), whitelist-only positions, category lists, approval. `exchange/auction.ts` clears one window: DSP bids are checked against the bid's seat (one of the DSP's seat IDs) and advertiser identity (`adomain` → one of its advertisers); an unknown `crid` is fetched from the DSP's creative host only, checked like an upload, stored as a `dsp` campaign and submitted for approval (or approved automatically), and the bid is discarded; API bids are checked again at clearing; first price, highest bid wins, ties to the earlier bid; every bid is recorded with its outcome and reason. Test-mode DSPs receive requests and clear among themselves, but their wins never take the window. A position held for a named advertiser is booked by `type: reserve`, not auctioned. No DSP is sent requests until Exchange settings are complete. `POST /v1/reservations` and `GET …/{id}`. Scheduled job in `apps/api` plus `npm run auction:run [-- --window=YYYY-MM-DD]`. Mock DSPs: an OpenRTB bidder and creative host per DSP, with bidder behaviour (fixed price, no bid, below the floor, which advertiser bids, `crid` and `adomain` overrides) on the control API and test page. Tests: API +10 (including the OpenRTB 2.6/DOOH/SupplyChain/no-visitor-data contract test against a closed schema), mocks +2. Checked end to end with the CLI against the running mock service | Hand-off of the winner (package 16) | Q11, Q12, Q13 |
| 16 | Hand-off and billing | Done | `exchange/handoff.ts`: a live win (from the auction) or a reservation (at booking) is checked with `isCampaignEligible` once more, its baseline creative is validated against the display type's canvas, then booked into that slot and window through `CampaignSource.bookSlot` (stand-in table `campaign_slot_bookings`, migration 0012) — the existing campaign system's side, which distributes and plays it unchanged. A Test-mode win is never handed off; a refusal is recorded on the reservation ("Not handed off: …") and the slot falls back as today. `exchange/billing.ts`: dynamic VAC-d — after a window ends, each live, handed-off win is reconciled against the stand-in playback data (read only): realised VAC-d = assumed views × min(1, played time ÷ the slot's expected time across the displays), amount = realised ÷ 1000 × clearing CPM; plays that didn't happen aren't billed (Q29). Line items are stored only (`billing_line_items`, migration 0013); the scheduled job bills ended windows, and `npm run billing:print` prints them. Seed: a played 15 Sep Nestlé window (one Menu Board all day, one half, one offline → 618 of 1,236 views, 74.16 AUD). Tests: API +7. Checked end to end with `billing:print` | — | Q14 |
| 17 | Amazon Ads DSP and The Trade Desk | Done | `dsp/amazonDsp.ts`: Login with Amazon refresh-token grant (client ID + secret), then `GET /v2/profiles` (the profile must be available in the chosen region and belong to the entity) and `GET /dsp/advertisers` paged with the `Amazon-Advertising-API-ClientId` and `-Scope` headers; one host per region (NA/EU/FE), region fixed once connected (the API refuses a change and the DSP page now disables the select while connected); LWA's `invalid_grant` is reported as "Refresh token rejected: …". `dsp/theTradeDesk.ts`: `TTD-Auth` header, `POST /v3/advertiser/query/partner` paged; a 401 is reported as "API token rejected: …". Both keep each advertiser's domain (for matching `adomain` on bids). Mocks: Amazon LWA + Ads API under `/amazon/{na,eu,fe}` (seeded to reject the refresh token, EU profile 3390127745 / entity ENTITY8Q1R5T) and TTD API v3 under `/ttd`, both controllable from the test page. The credential forms come from the catalogue (package 9). Tests: API +6 (including a TTD bid through the auction), mocks +2. Browser-checked: Amazon's rejected token, then connected with the region locked; TTD added, saved and connected | — | — |

### Board tickets after the 17 packages

| Ticket | Status | What changed |
|---|---|---|
| Playlist page: the page behind the delete dialog "goes all weird" | Fixed | Opening a dialog re-rendered the table with new column definitions, which reset AG Grid's column widths to their defaults (the table shrank to half its width and cut off names); the wrapper's size didn't change, so nothing re-fitted it. `shared/Grid.tsx` now re-fits on `onNewColumnsLoaded`, which fixes every table. Browser-checked |
| Display Types: Enter activates Save changes | Built | `SaveBar` takes `saveOnEnter`; the Display Types page turns it on. Enter in a plain field saves when there are unsaved changes; it is left alone in text areas, dropdowns and date pickers, inside dialogs, with a modifier key, and where the field uses Enter itself (e.g. a list's add input). Tests: admin +4. Browser-checked (typed a name, pressed Enter, saved) |
| Shared Targeting Variables: Computer Vision first, sources spelled out, aggregates added (Rob, 20 Sep) | Built | In **Personalisation Variables**, in order: **Gender (Computer Vision)**, **Estimated Age (Computer Vision)**, **Reason for Visit (Aggregate)** and a new **Device Type (Aggregate)** (the share of each device carried in store; the platform's `DEVICE_TYPE_AGGREGATE`, so comparison operators — confirmed by Rob, 20 Sep, rather than the include/exclude operators the per-visitor Device Type uses), then Age, Gender and the rest. The three that moved come from Localisation. Tooltips now say where each reading comes from: Vision/AI at the edge for the Computer Vision pair ("nothing leaves the store"), the customer record (CRM, CDP or loyalty) for Age and Gender, and "everyone in the store right now, not one visitor" for the aggregates. 25 variables now. This **overrides spec §6**, which lists the Computer Vision pair and Reason for Visit under Localisation Variables, and it **revisits Q49**: in their new group they default to no DSP, not All connected DSPs (Rob chose this). Personalisation variables can now be store data as well as visitor data. Tests: API +0 (updated) | Browser-checked |
| Targeting variables: staff languages and an individual Reason for Visit (Rob, 20 Sep) | Built | The **Languages Spoken by Store Staff** tooltip now says these are the staff on shift right now — the ones signed into the staff tablet or Retail Admin through virtual queue management and appointments. New personalisation variable **Reason for Visit** (the one visitor in front of the screen), directly above Device Type, with list operators like the platform's own individual variable; the aggregate one above it keeps the comparison operators. Device Type's tooltip now says it is the visitor in front of the screen. 26 variables |
| Where DSP Integration opens (Rob, 20 Sep) | Built | The section opens on **Exchange settings** until the four seller-of-record fields are complete and `sellers.json` is published, and on **Advertiser settings** after that (`DspIndex`). Tests: admin +1. Browser-checked |
| Floor price and multiplier tooltips explain the maths (Rob's board ticket, 19 Sep) | Built | The Floor price (CPM) tooltip now carries Rob's worked example as a table — footfall → visibility (ROTS) → attention (VAC) → share of time → 27 VAC-d, then 100 × 27 ÷ 1,000 = $2.70 for a two-hour daypart. The Personalised tooltip carries the same example at 150 CPM ($4.05) and the Interactive one at 300 CPM ($8.10), stacked at 450 CPM ($12.15), noting that the advertiser's floor multiplier scales that again. `InfoTip`/`Field` take a tooltip width so the table fits. Tests: admin +1. Browser-checked |
| Booking schedule with booking revenue (Rob, 19 Sep; filed on the board) | Built | New admin endpoint `GET /admin/v1/booking-schedule?from=&to=` (contract addition) and a read-only page, **DSP Integration → Advertiser settings → Available Inventory → Booking schedule**: a revenue table per display type (booked windows, booked revenue = booked CPM × assumed views ÷ 1000, billed revenue from billing once played, with a total row), then the schedule — one row per advertiser slot, one column per play window: booked (advertiser, bookmark = reserved / gavel = won, the CPM it was booked at, booked revenue; hover for DSP, views and billed), Available, or — (can no longer be sold). Live bookings only; default the current window and the next 13; a date range of up to 92 days; no save bar. Not in the prototype: built from ph-designer patterns (SubPageHeader, SectionLabel, AG Grid with a pinned first column and horizontal scroll inside the grid, AntD RangePicker). Tests: API +3, admin +2. Browser-checked, including booked cells |
| Bidding play-window length and auction cutoff in Advertiser settings → Pricing | Built | The Auction schedule section (Q13): Auction opens, Play-window length, Auction cutoff time; contract fields added; migration 0015 |

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

### Advertisers (package 10)

Compared against the prototype at 1163px. The Admin only pill, the columns
and all four header tooltips, the violet sell icon, the approval switch with
its label, the multiplier input (step 0.05), the effective floor text
("AUD 80.00 CPM") and the empty state match.

| Where | Prototype | Build | Why |
|---|---|---|---|
| Top line | "Every advertiser using the platform, across all DSPs." as page text | The page-title tooltip | Decision 2 |
| Save | No save bar (bug) | The standard save bar | Decision 4 |

### DSP page and Add card (package 9)

Compared against the prototype's Google DSP and Amazon Ads DSP pages and The
Trade Desk Add card at 1163px. The section order and headings, every
tooltip, the issue callouts (texts and tones), the Test/Live control with its
disabled title, the credential fields per provider (labels, placeholders,
tooltips, Region options), the Connect / Re-test connection / Disconnect
buttons, the bidder fields, both list states with their actions and empty
texts, and the Add card's You will need list and buttons all match.

| Where | Prototype | Build | Why |
|---|---|---|---|
| Header | Editable name | The name as a heading | Q6 |
| Connect, Re-test, Disconnect | Change the draft (fake result) | Act immediately against the DSP; Connect disabled with "Save changes first" while credentials are unsaved | Q5 |
| Private key (JSON) | Plain textarea | Masked, like every secret | Defect fix 2 |
| Add card | Provider description paragraph | Tooltip on "You will need" | Decision 2 |
| Add partner | Draft partner | Draft partner, created on Save changes | Same; the spec: "kept only once saved" |

### Shared Targeting Variables (package 8)

Compared against the prototype at 1163px. The heading tooltip, both group
headings with their icons and tooltips, the two-column tables (Variable with
its example-values tooltip; DSPs that may target it with its header tooltip),
the 24 variables in order, the pills ("All connected DSPs", a named DSP, or
"None") and the picker (All connected DSPs with "Includes DSPs connected
later", a divider, one checkbox per DSP with its connection state, disabled
while All is ticked) all match.

| Where | Prototype | Build | Why |
|---|---|---|---|
| Picker | Hand-made dropdown | AntD `Popover` with `Checkbox` rows | ph-designer components |

### Advertiser settings (package 7)

Compared against the prototype at 1163px. The heading tooltip, PRICING (four
fields and every tooltip), LIST MANAGEMENT (four editors with labels, colours,
counts, empty texts, placeholders and suggestion chips), WHERE THESE APPLY
(Adopting / Own lists with its tooltip, Open) and AVAILABLE INVENTORY
(Display type, Playlist, Slot, Position with the DSP beneath, Open; no
advertisers column) all match.

| Where | Prototype | Build | Why |
|---|---|---|---|
| Available Inventory | Three rows (two are Carousel, a web type) | One row (Menu Board) | Decision 1 (no web display types in the seed) |
| Available Inventory | Built from the unsaved display types | Built from the saved display types (`GET /admin/v1/available-inventory`) | The contract's endpoint; the table is read-only |
| Removable pills | Custom pills | AntD `Tag` | ph-designer components |

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
