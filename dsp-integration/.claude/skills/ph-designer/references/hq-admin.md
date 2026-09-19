# HQ Admin — Layout & Page Catalogue

Route namespace: `/hq-admin/*`. Audience: head office, brand and marketing teams, desktop.

> **Building a prototype rather than a platform page?** Everything in §1 (the shell) is provided
> for you — do not render it. See `prototyping.md` first.

---

## 1. The shell

HQ Admin renders its own chrome. Build all of it.

```
┌──────────────┬────────────────────────────────────────────────────────────┐
│              │ ☰  [PH logo] PersonalisationHub    [Production ✎]  [brand] │ 64px, #000
│  [brand      ├────────────────────────────────────────────────────────────┤
│   logo]      │  Home  >  Campaigns                                        │ breadcrumb
│              │                                                            │
│ CAMPAIGNS    │  Campaigns                            [right-side meta]    │ title row
│ DISPLAYS &   │  ──────────────────────────────────────────────────────    │ divider
│  DEVICES     │                                                            │
│ STORES /     │  63 Campaigns          [Prioritisation] [Launch a New…]    │ count + actions
│  BRANCHES    │                                                            │
│ INSIGHTS /   │  ┌──────────────────────────────────────────────────────┐  │
│  ANALYTICS   │  │  AG Grid                                             │  │
│              │  └──────────────────────────────────────────────────────┘  │
│              │                                     ‹ 1 2 3 › 25/page      │
│ COMPANY      │                                                            │
│  SETTINGS    │                                                     ( 💬 ) │ draggable AI FAB
│ PLATFORM     │                                                            │
│  ADMIN       │                                                            │
└──────────────┴────────────────────────────────────────────────────────────┘
   256px, #333                    content padding 20px, background #ffffff
```

### Header (64px, `#000000`)

Left → right: hamburger toggle, PersonalisationHub mark (multi-colour square) + wordmark in
white with `Hub` bold. Right: environment pill (black rounded-full, rocket icon, label such as
`Production`, pencil icon), then the tenant brand logo.

### Sidebar (256px, `#333333`)

Tenant brand logo at the top. Nav items are ALL CAPS, `14px`, `40px` tall, radius `8px`,
padding `0 16px 0 24px`, each with a leading Material Symbols icon at `20px`.

- Idle: `rgba(255,255,255,0.65)`
- Active: white text on a full-width `#169bc2` block

Primary group: `CAMPAIGNS`, `DISPLAYS & DEVICES`, `STORES / BRANCHES`, `INSIGHTS / ANALYTICS`.
Pinned to the bottom: `COMPANY SETTINGS`, `PLATFORM ADMIN`.

### Breadcrumb

`>` separators. Ancestors `rgba(0,0,0,0.45)`, current page `#333333`. Reflects the full nested
path, e.g. `Home > Company Settings > Retail Settings > Store Segments`.

### AI assistant FAB

A draggable circular button fixed bottom-right (`64px`, chat-sparkle icon,
`position: fixed; z-index: 1000; cursor: grab`), filled with the AI gradient
`linear-gradient(in oklab, #169bc2 0%, #9747ff 100%)`. Present on every HQ Admin page.

---

## 2. Page archetypes

### A. List page

Campaigns, Displays & Devices, Stores / Branches.

```jsx
<div className="p-5">
  {/* Title row — optional right-side meta */}
  <div className="flex items-center justify-between">
    <span className="text-xl font-bold truncate max-w-3/4">Stores / Branches</span>
    <span className="text-sm">Total connected displays <b>3</b> <DisplayIcon /></span>
  </div>
  <div className="h-px bg-[rgba(5,5,5,0.06)] my-4" />

  {/* Optional tabs */}
  <Tabs items={[{ key: 'assigned', label: 'Assigned Devices' }, { key: 'unassigned', label: 'Unassigned Devices' }]} />

  {/* Count + actions */}
  <div className="flex items-center justify-between mb-2">
    <div><b>12</b> Stores</div>
    <div className="flex gap-4">
      <Button type="text">Campaign Prioritisation</Button>
      <AiActionButton icon={<AiSparkleIcon />}>Launch a New Campaign</AiActionButton>
    </div>
  </div>

  {/* AG Grid + AntD pagination below */}
  <div className="ag-theme-alpine w-full h-full mt-2">
    <AgGridReact … />
  </div>
</div>
```

Rules:

- The count line always has the number in `<b>`.
- Right-hand actions are AntD buttons: `type="text"` for secondary. Where the main action is
  AI-driven — `Launch a New Campaign` is the canonical case — use the **AI action button**:
  a 20% teal→violet gradient fill, no border, gradient-clipped label text. See
  `components.md` §1. A non-AI primary action uses a solid teal fill instead.
- Some list pages use plain text actions instead of buttons (`Add New Store(s)`,
  `Manage Display Types`, `Offline Device Notifications`) — dark `#333`, no border, right-aligned.
- Pagination sits beneath the grid, right-aligned: `‹ 1 2 3 ›`, a `25 / page` size selector, and
  on some pages a `Go to ___ Page` jumper. Active page = white background, `#169bc2` border,
  weight 600.
- A `KEY:` legend row may sit at the bottom-left explaining status icons.

### B. Drill-down page

Reached from a table row or a text link. Adds a back arrow and extends the breadcrumb.

```jsx
<div className="flex items-center gap-3">
  <Button type="text" icon={<ArrowLeftIcon />} onClick={() => navigate(-1)} />
  <span className="text-xl font-bold">Manage Display Types</span>
</div>
<div className="h-px bg-[rgba(5,5,5,0.06)] my-4" />
<div className="flex items-center justify-between">
  <div><b>14</b> display types</div>
  <Button type="text">Add Display Type</Button>
</div>
```

### C. Settings page (secondary left nav)

Used by **every** Company Settings and Platform Admin page.

```
┌─────────────────────┬──────────────────────────────────────────────┐
│ Platform Set-up     │  Store Segments                              │  title
│ Brand / Logo /…     │  ──────────────────────────────────────────  │  divider
│ Campaign Settings   │  Descriptive paragraph(s), muted.            │
│ Retail Admin Set-up │                                              │
│ Retail Settings   ⌃ │  Variable Store Segments ⓘ                   │  sub-section
│   Store Segments    │  4 items            Add New Variable Segment │
│   Display Tags      │  ┌────────────────────────────────────────┐  │
│   CTA Settings      │  │ Name                                   │  │  #fafafa header
│                     │  │ Cold Day                            🗑  │  │
└─────────────────────┴──────────────────────────────────────────────┘
   ~245px white panel                content
```

The secondary nav is a white panel about `245px` wide with a right border, sitting inside the
content area. It is **part of your page** — build it.

- Idle item: `#333333`, `14px`
- Active item: `#169bc2` text on a `rgba(22,155,194,0.10)` row background, full panel width
- An expanded parent whose child is selected shows `#169bc2` text plus a `⌃` chevron
- Children are indented

Content column: title, `1px` divider, muted description paragraphs, then the form or tables.

### D. Campaign detail page

The richest archetype.

```jsx
<div className="p-5">
  <div className="flex items-center justify-between">
    <span className="text-xl font-bold">OPTUS | iPhone 17 Pro — Active Audience</span>
    <div className="flex items-center gap-2">
      <span className="text-muted">Status</span>
      <Dot color="#52c41a" />
      <b>Activated - Not Running</b>
      <Switch checked />
    </div>
  </div>

  {/* Campaign Insights KPI row */}
  <div className="font-semibold mt-4 mb-2">Campaign Insights (16 Aug - 22 Aug)</div>
  <div className="grid grid-cols-4 gap-4">…KpiCard…</div>

  {/* Engagement score bar */}
  <EngagementScore value={8} />

  <Tabs items={[
    { key: 'brief',      label: 'Campaign Brief' },
    { key: 'targeting',  label: 'Targeting' },
    { key: 'scheduling', label: 'Scheduling' },
    { key: 'storyboard', label: 'Storyboard & Copy' },
    { key: 'creative',   label: 'Creative' },
  ]} />
</div>
```

Status block: the word `Status` in muted grey, a coloured dot, the status text in **bold**
`#333`, then a teal `Switch`. Green dot = Activated, red = Not Activated.

---

## 3. Page catalogue

### Campaigns — `/hq-admin/campaigns`

| Page | Archetype | Notes |
|---|---|---|
| Campaign list | A | Columns: checkbox, Status (dot), Playback Strategy (pill), Name (thumbnail + bold name), Enabled Touch-point(s) (icon chips with green check badges), Playlist(s), Target Audience, row `⋯` menu. Row height `99px`. Actions: `Campaign Prioritisation` (text), `Launch a New Campaign` (AI gradient). Playback strategy values are **`LOCALISED`** and **`TRIGGERED`** |
| Campaign detail | D | Five tabs; KPI row and engagement bar persist across all tabs |
| Campaign Brief tab | Vertical form | Name, Details, URL + Add Token, Promoted Products, SKUs, Audiences, Objective |
| Targeting tab | Rule builder | `DEFINED CAMPAIGN TARGETING RULES` divider; `Override current campaign` toggle top-right; each rule group is a bordered card holding a row of selects (`Store / Location Data` → `Variable Store Segments` → `excludes selected [OR]` → tag select) plus a trash icon; outlined teal `+ Add new "OR" Condition` inside the group and `+ Add New "AND" Condition` beneath; disabled `Save Changes` / `Cancel` pair at the bottom |
| Scheduling tab | Form | Date/time configuration |
| Storyboard & Copy tab | Two-column | Left: `Campaign Type` segmented control (`Image` / `Video`, dark active), then bordered collapsible cards with grey headers (chevron + ALL CAPS title) — `HEADLINE`, `SUB HEADLINE`, `LEGAL COPY`, `BODY COPY` — each holding labelled inputs with a clear `ⓧ` suffix. Right: `Landscape` / `Portrait` segmented toggle, then Scene cards (`Scene 1`) with a `Scene Prompt` textarea carrying a mic icon, a `Clear all` button, and a `First Frame` image preview |
| Creative tab | Nested tabs | Card-tabs `Campaign Assets` / `Call to Action`, then a collapsible panel per touch point (e.g. `ONSITE BANNERS`) with helper text and the asset preview |

### Displays & Devices — `/hq-admin/displays-and-devices`

| Page | Archetype | Notes |
|---|---|---|
| Assigned Devices | A + tabs | Tabs `Assigned Devices` / `Unassigned Devices`. Text actions `Manage Display Types`, `Offline Device Notifications`. Columns: checkbox, Status dot, Type, Name, Store Code, Store Name, Playback Audit (icon + count chips), State. Bottom `KEY:` legend — **On Rotation** (green), **Triggered Campaigns** (teal), **Playback issues** (amber), **Thermal Warning** (orange), **Thermal Critical** (red) |
| Unassigned Devices | A + tabs | Filter row uses per-column text inputs with `Input` placeholders. Columns: Registration Code, Asset ID, Device ID, Device Make, Device Model |
| Manage Display Types | B | Columns: Touch Point (glyph), Name, Display Resolution (W x H), Default Playlist(s), Display Settings (icon buttons), `⋯`. Action: `Add Display Type` |
| Offline Device Notifications | B | Email addresses, device counts, offline threshold, frequency, activation toggle |

### Stores / Branches — `/hq-admin/stores-branches`

| Page | Archetype | Notes |
|---|---|---|
| Store list | A | Title-row meta: `Total connected displays  3`. Action `Add New Store(s)` (text). Columns: checkbox, Store Code (+ copy icon), Brand Name, Store Name, State, Enabled Features (icon set), displays count + status dot, staff count, Store Segments, `⋯`. Row `⋯` menu: **View/Edit Store Details**, **Visit Retail Manager Website** (opens Retail Admin in a new tab), **Delete** |
| Add New Stores | Modal | Two-panel: search results list left, Google Map right, `Add Store Manually` in the footer |

### Insights / Analytics — `/hq-admin/retail-insights`

Filter bar sits **above** the tabs: a date `RangePicker` (`16 Aug, 2026 → 22 Aug, 2026`) plus
`All Stores`, `All Display Types`, `All Campaigns (63)` selects.

Tabs: `Campaign Performance`, `Visitor Insights`, `Store Insights`, `Upcoming Appointments`,
`Downloads`.

Campaign Performance content: a bordered card titled `Campaign Performance Summary` with an ⓘ,
four grey stat tiles (`Playback Duration`, `Playback Count`, `Total Views`,
`Avg View Duration`), an `ENGAGEMENT SCORE` bar row, then a chart panel.

### Company Settings — `/hq-admin/company-settings` (archetype C)

Nav: `Platform Set-up`, `Brand / Logo / Guidelines`, `Campaign Settings`, `Retail Admin Set-up`,
`Retail Settings ⌃` → `Store Segments`, `Display Tags`, `CTA Settings`.

| Page | Notes |
|---|---|
| Platform Set-up | Prose intro with bolded lead-ins (`Highest Priority:`, `Please Note`). Fields: Platform Email address with a green `Verified` suffix inside the input; Email Sender Name with a right-aligned `+ Add Token` action above it; Admin / Marketing / Helpdesk Users as removable tag inputs |
| Brand / Logo / Guidelines | Brand Name, Primary Business Category select, disabled `Save Changes` / `Cancel` pair, then the ALL CAPS divider `COMPANY LOGO/ICON USED ON DARK BACKGROUNDS` and dark `#333` upload panels showing the logo with an `⬆ Update` text action and a size hint below (`Max. 1MB - use a transparent PNG file.`) |
| Store Segments | Two sub-sections, each: label + ⓘ, then `4 items` left / `Add New Variable Store Segment` right, then a table with a `#fafafa` header, bold values, and a trash icon per row |
| CTA Settings | Route is `/retail-settings/header-links`. Two independent sections — `HQ ADMIN - LEFT HAND NAV MENU` and `RETAIL ADMIN - LEFT HAND NAV MENU` — each with a `N Categories` count, an outlined `+ Add Category URL` button, and a table of CTA Name / Experience URL / Action. Below: `Show Log-out button` and `Show/Add a back-link` checkboxes. The `Add New Category URL` modal takes Icon (Material icon picker), CTA Name, and Experience URL (with `+ Add Token`). **This is how prototypes are mounted into the platform — see `prototyping.md`** |

### Platform Admin — `/hq-admin/platform-admin` (archetype C)

Nav: `Security (IP Restrictions)`, `Enabled Features ⌃` → `Google Maps/Places`,
`Digital Signage`, `Campaign Monitoring Settings`, `Queueing / Appointments`,
`Mobile Store Sites`, `API Authentication`, `Google Business Profile`, `QR Control`,
`AI Models / Integrations`, `AI Agents / Skills`, `MIST (Proximity)`.

| Page | Notes |
|---|---|
| Security (IP Restrictions) | Warning prose with a bolded `Urgent note:`. `0 Record(s) [Max 400 records]` left, `Add New IP Address` right. Table: Description, Approved IP Address(es) [CIDR Schema], Activation Status. Empty state: broken-link glyph, `No IP Address added yet.`, then bold `Currently all IP Addresses have access to the Platform.` |
| Digital Signage | Master toggle row `Enable Digital Signage` + ⓘ with the switch right-aligned; card-tabs `Amazon Signage / FireTV` and `ChromeOS / Android`; a numbered set-up list with inline teal external links |
| Queueing / Appointments | Card-tabs `Queue Settings` / `Appointment Settings` / `Shared Settings`. Master toggle row, then ALL CAPS dividers (`ENABLE QUEUEING BASED ON STORE'S OPENING & CLOSING TIMES`, `GENERAL QUEUEING SETTINGS`), radio groups with inline number inputs inside sentences, and per-setting toggle rows separated by rules |
| Mobile Store Sites | `3 Mobile Site Templates` + `Add New Template`; table of template names with copy and delete icons; `MOBILE SITE LOOK & FEEL` divider; `Customise Mobile Store Site Template` with edit + ⓘ icons; `Javascript code snippet` and `Preview Mobile Site` buttons |
| API Authentication | `Add New Platform`; table of Platform Name, masked Secret/Token, eye + delete icons |
| AI Models / Integrations | `Create Integration`; table of Name, Model, Provider, Base URL, `⋯` |

### 404

Full-bleed white page: a `404` numeral behind a unicorn illustration holding an "On Strike"
placard, the heading `The Unicorns have gone on Strike`, muted `Please try again later.`, and a
solid teal `Back to Home` button.
