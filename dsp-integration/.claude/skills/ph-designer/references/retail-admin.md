# Retail Admin — Layout & Page Catalogue

Route namespace: `/retail-admin-web/*`. Audience: in-store staff, primarily on a tablet.
Reached from HQ Admin via **Stores / Branches → row `⋯` → Visit Retail Manager Website**
(opens in a new tab).

Retail Admin is a **separate application** with its own shell. It is not the HQ Admin content
frame, and it does not use AG Grid.

Retail Admin can also host iframed prototypes: CTA Settings has a
`RETAIL ADMIN - LEFT HAND NAV MENU` section alongside the HQ Admin one, and a CTA registered
there appears in this app's sidebar instead. The content-frame rules are identical — see
`prototyping.md`.

---

## 1. The shell

```
┌──────────────┬────────────────────────────────────────────────────────────┐
│ Retail Admin │  ☰                    [BRAND LOGO]                    (DH•)│ 64px, #000
│ DEMO STORE   ├────────────────────────────────────────────────────────────┤
│              │  Retail Admin / Queueing & Appointments / Queue            │ breadcrumb
│ 👥 QUEUEING  │  Queueing & Appointments      Queue & Appointment History  │ title row
│    & APPTS   │  ──────────────────────────────────────────────────────    │
│ 🖥 DISPLAYS  │                                                            │
│    & DEVICES⌄│  ⚠ Please Note: Queue is Currently Closed…                 │ alert
│ 🏪 STORE     │                                                            │
│    INFO    ⌄ │  ┌──────────────────────────────────────────────────────┐  │
│              │  │ STAFF (All) 👤•        • 0 Available  • 0 Serving …   │  │
│              │  │ Store Stats                                       ⓘ  │  │
│              │  │ ┌────────┐┌────────┐┌────────┐┌────────┐             │  │
│              │  │ │ 0 min  ││ 0 min  ││ 0 min  ││   0    │             │  │
│              │  │ └────────┘└────────┘└────────┘└────────┘             │  │
│              │  └──────────────────────────────────────────────────────┘  │
│ Powered by   │  QUEUE ⓘ    APPOINTMENTS ⓘ                                 │ primary tabs
│ PersonalisationHub                                                        │
└──────────────┴────────────────────────────────────────────────────────────┘
                        Privacy   FAQ   Version: 3.3                          footer
```

### Header (64px, `#000000`)

Hamburger left, **tenant brand logo centred**, circular user avatar with initials and a status
dot at the right. (HQ Admin puts its logo on the left — this is the quickest way to tell the two
apps apart in a screenshot.)

### Sidebar (`#333333`) — collapsible

Two states, toggled by the hamburger:

- **Collapsed (`70px`)**: icon rail only, plus a small `Powered by` mark at the bottom.
- **Expanded (`256px`)**: `Retail Admin` heading in white with the store name (`DEMO STORE`)
  beneath it in muted grey, ALL CAPS nav items with leading icons, expandable groups with a
  `⌄` / `⌃` chevron, and `Powered by PersonalisationHub` pinned to the bottom.

Navigation:

| Item | Children |
|---|---|
| `QUEUEING & APPTS` | — |
| `DISPLAYS & DEVICES` | `Manage Displays` |
| `STORE INFO` | `Store Profile`, `Store Hours`, `Store Segments` |

Child items sit indented in white; the selected child is bold.

### Breadcrumb

`/` separators (HQ Admin uses `>`). Ancestors muted, current page `#333333` bold.

### Footer

Centred, muted, small: `Privacy   FAQ   Version: 3.3`.

### Content column

Not full-bleed. Content is centred with a maximum width of roughly `900px`; single-column forms
narrow further to about `550px`.

### Typography difference

Retail Admin uses AntD `Typography` defaults — page titles are `20px / 500` in
`rgba(0,0,0,0.88)`, not the `20px / 700` `#333333` of HQ Admin.

---

## 2. Page archetypes

### A. Operational dashboard (Queueing & Appointments)

```jsx
<>
  <div className="flex items-center justify-between">
    <Title level={4} className="!mb-0">Queueing & Appointments</Title>
    <Button type="text">Queue &amp; Appointment History</Button>
  </div>
  <Divider className="!my-4" />

  <Alert type="warning" showIcon
    message="Please Note: Queue is Currently Closed. Visitors can only be added to Queue by Store Staff" />

  <Card className="mt-4">
    <StaffBar />       {/* STAFF (All) + avatars, availability legend right */}
    <div className="mt-4 mb-2 font-medium">Store Stats <InfoIcon className="float-right" /></div>
    <StatTileRow tiles={[
      { value: '0 min', label: 'Current Est. Waiting time' },
      { value: '0 min', label: 'Avg. Waiting time' },
      { value: '0 min', label: 'Avg. Serve Time' },
      { value: '0',     label: 'Total Served Today' },
    ]} />
  </Card>

  <Tabs className="mt-6" items={[
    { key: 'queue', label: <>QUEUE <InfoIcon /></> },
    { key: 'appts', label: <>APPOINTMENTS <InfoIcon /></> },
  ]} />

  <Card>
    <Tabs items={[
      { key: 'waiting', label: 'Waiting' },
      { key: 'progress', label: 'In Progress' },
      { key: 'hold', label: 'On Hold' },
    ]} tabBarExtraContent={<Button type="primary" disabled>Add Visitor to Queue</Button>} />
    <Alert type="warning" showIcon message="This Queue is Currently Empty" />
  </Card>
</>
```

Note the **two tab levels**: outer tabs are ALL CAPS with an ⓘ per label; inner tabs inside the
card are sentence case. Both use the teal underline style.

### B. Centred table page (Manage Displays)

Content sits in a centred column. A right-aligned **solid teal** `Edit` button sits above the
table — Retail Admin uses solid `#169bc2` fills for primary actions, unlike HQ Admin's tinted
variant.

The table is a plain table: header row in `#fafafa` at `14px / 600`, generous rows (~`92px`)
separated by thin `#f0f0f0` rules, a display thumbnail, a status dot, bold display name, and a
`⋯` menu at the right.

Columns: `Display`, `Display Type`, `Active Campaign`, `Playback Duration`, `⋯`.

### C. Centred form page (Store Profile)

A narrow (~`550px`) centred column:

1. Store logo, centred
2. Store name in bold muted caps, centred (`DEMO STORE`)
3. Stacked fields — label above input, labels `14px` in `rgba(0,0,0,0.45)`
4. Read-only fields render as disabled inputs with a grey fill
5. Inputs with a leading Material Symbols glyph where meaningful (`call`, `language`)

### D. Nested-tab settings page (Store Hours)

```jsx
<Title level={4}>Opening Hours &amp; Appointment Settings</Title>
<Divider />
<Tabs items={[{ key: 'hours', label: 'Opening Hours' }, { key: 'appts', label: 'Appointment Settings' }]} />
<Tabs type="card" items={[
  { key: 'regular', label: 'Opening Hours' },
  { key: 'holiday', label: 'Special Holiday Hours' },
]} />
<Table … />
```

- Outer tabs: underline style, teal active.
- Inner tabs: **card style** — `40px` tall, `8px 8px 0 0` radius, `1px #f0f0f0` border with the
  bottom edge removed on the active tab, active label `#169bc2` at weight 500 on white.
- The table is bordered with a header checkbox, per-row checkboxes, `MONDAY`–`SUNDAY` in caps,
  time pickers with a clock suffix, and a `# of Appointment Slots` select. Unchecked days show
  `Closed` as plain text with the remaining cells blank.
- An `Additional Comments` textarea follows the table.

---

## 3. Page catalogue

| Page | Route | Archetype | Notes |
|---|---|---|---|
| Queue | `/queueing/manage/queue?queueView=waiting` | A | Sub-tabs `Waiting` / `In Progress` / `On Hold`; `Add Visitor to Queue` is disabled while the queue is closed; empty state is a warning alert, not an illustration |
| Appointments | `/queueing/manage/…` | A | Same shell, `APPOINTMENTS` outer tab |
| Queue & Appointment History | linked from the title row | — | Text action, top-right |
| Manage Displays | `/displays-and-devices/manage-displays` | B | Store-wide connectivity warning alert above the table (`Seems like you are experiencing a Store Wide Internet issue. Contact Admin.`) |
| Store Profile | `/store-info/…` | C | Read-only address, suburb, postcode, state, country, phone, website |
| Store Hours | `/store-info/opening-hours` | D | `Opening Hours` / `Special Holiday Hours` and `Appointment Settings` |
| Store Segments | `/store-info/…` | — | Store-manager-editable variable segments (fixed segments are HQ-only) |

---

## 4. Retail Admin specifics worth remembering

- **Touch targets.** This runs on a tablet. Keep interactive rows and buttons at `40px` or more.
- **Alerts carry the empty and warning states.** Retail Admin favours a full-width amber alert
  bar over an illustrated empty state.
- **Status legend.** `• 0 Available` (green) · `• 0 Serving Customers` (amber) ·
  `• 1 Unavailable` (red), right-aligned on the staff bar, separated by thin vertical rules.
- **Staff bar.** The label `STAFF`, then a circular `All` toggle outlined in teal, then staff
  avatars each with a small status dot at the lower right.
- **Stat tiles.** `#f5f5f5` background, radius `8px`, centred: large bold value over a small
  muted label. Four across on a tablet-width viewport.
- **Primary buttons are solid `#169bc2`.** Do not carry HQ Admin's tinted button style across.
