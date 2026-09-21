# Personalisation Hub — Component Recipes

Every value here was measured from the live platform. Import tokens from `tokens.md`.

```jsx
import {
  Layout, Menu, Breadcrumb, Typography, Tabs, Button, Input, Select, Switch,
  Checkbox, Radio, Table, Modal, Alert, Empty, Divider, Pagination, Tooltip, Dropdown,
} from 'antd';
import { AgGridReact } from 'ag-grid-react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';

const { Title, Text } = Typography;
```

Icons throughout are **Material Symbols (Outlined)** — `<span className="material-symbols-outlined">storefront</span>`,
or `react-icons/md` (`<MdOutlineStorefront />`) in React. The placeholder `<XIcon />`
components below all stand for Material Symbols.

---

## 1. Buttons

HQ Admin and Retail Admin differ on the primary action. Get this right.

```jsx
/* AI ACTION BUTTON — the platform's most distinctive control.
   Any action driven by the AI assistant uses the teal→violet gradient:
   a 20%-opacity gradient fill, no border, and gradient-clipped label text.
   "Launch a New Campaign" is one of these — it is NOT a plain primary button. */
<Button
  className="border-none!"
  style={{ background: 'linear-gradient(135deg, rgba(22,155,194,.2), rgba(151,71,255,.2))' }}
  icon={<AiSparkleIcon />}
>
  <span style={{
    backgroundImage: 'linear-gradient(135deg, #169bc2, #9747ff)',
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    color: 'transparent',
  }}>
    Launch a New Campaign
  </span>
</Button>

/* Solid teal primary — 404 "Back to Home", Retail Admin actions */
<Button type="primary">Back to Home</Button>

/* HQ Admin — secondary page action */
<Button type="text">Campaign Prioritisation</Button>

/* HQ Admin — inline text action (Add New Store(s), Manage Display Types, Add Display Type) */
<Button type="text" className="px-0">Add New Store(s)</Button>

/* Retail Admin — primary action: SOLID teal, never the AI gradient */
<Button type="primary">Edit</Button>

/* Outlined teal — used for rule-builder adders */
<Button className="border-primary text-primary" icon={<PlusIcon />}>
  Add new "OR" Condition
</Button>

/* Disabled save pair — the resting state of most settings forms */
<div className="flex gap-2">
  <Button type="primary" disabled>Save Changes</Button>
  <Button disabled>Cancel</Button>
</div>
```

Measured: height `32px`, radius `6px`, padding `0 15px`, font `14px / 400`, no shadow.

---

## 2. Tabs

Two styles, both teal.

```jsx
/* Underline tabs — list pages, campaign detail, Retail Admin */
<Tabs items={[
  { key: 'brief', label: 'Campaign Brief' },
  { key: 'targeting', label: 'Targeting' },
]} />
```

Measured: tab height `46px`, padding `12px 8px`. Idle label `14px / 400` `#333333`.
Active label `14px / 500` `#169bc2` on a `rgba(22,155,194,0.1)` background, with a `2px`
`#169bc2` ink bar.

```jsx
/* Card tabs — Platform Admin sub-sections, Retail Admin nested settings */
<Tabs type="card" items={[
  { key: 'queue', label: 'Queue Settings' },
  { key: 'appts', label: 'Appointment Settings' },
  { key: 'shared', label: 'Shared Settings' },
]} />
```

Measured: height `40px`, padding `8px 16px`, radius `8px 8px 0 0`, border `1px #f0f0f0` with the
bottom edge transparent on the active tab, active label `#169bc2` at weight 500 on white.

---

## 3. AG Grid data table (HQ Admin)

```jsx
<div className="ag-theme-alpine w-full h-full mt-2">
  <AgGridReact
    rowData={rows}
    columnDefs={columns}
    rowHeight={99}              /* 42 for text-only tables */
    headerHeight={40}
    floatingFiltersHeight={40}  /* the second header row */
    rowSelection="multiple"
    suppressCellFocus
  />
</div>
<div className="flex justify-end mt-3">
  <Pagination defaultPageSize={25} pageSizeOptions={[25, 50, 100]} showSizeChanger showQuickJumper />
</div>
```

The header is a two-row block totalling `80px`: a label row (`13px / 700`, `#181d1f`) and a
filter row holding funnel icons, text inputs, or a select per column. Cell padding `0 15px`.
Row and header borders `1px solid rgba(24,29,31,0.15)`. Row hover `#e8fdff`.

A checkbox column comes first; a `⋯` actions column comes last.

### 3.1 Column filters — how HQ Admin does it

Measured on **Displays & Devices → Assigned Devices**, 20 Sep 2026. Copy this exactly;
it is the pattern for every table.

**A column gets one filter, never two.** The label row shows only the column name — no
funnel, not even when a filter is active. Everything lives in the filter row beneath it.

**1. Search filter** — for open text (Name, Store Code, Store Name):

- a plain input in the filter row, `32px`, radius `6px`, border `1px #d9d9d9`, primary
  border and ring on focus. No funnel, no placeholder text;
- filters as you type (contains, case-insensitive);
- once it holds text, a small grey round **✕** appears inside it at the right. That ✕ is
  how it is cleared — there is no other control.

**2. Set filter** — for a column with a known set of values (Status, Type, State):

- a **funnel icon alone** in the filter row, centred, no input;
- **grey outline** (`#9ca3af`) when nothing is chosen, **solid primary** (`#169bc2`) when
  something is;
- clicking it opens a small popup (white, radius `6px`, shadow, `min-width 200px`):
  - a `Search...` box at the top **only when the list is long** (roughly 8+ values);
  - one **checkbox per value**, in the column's own order, each showing what the cell
    shows (a status dot keeps its dot);
  - **several values can be ticked** — they filter as OR;
  - a primary **`Clear Filter`** button at the bottom right, disabled while nothing is
    ticked. Unticking every box and Clear Filter do the same thing;
- the popup stays open while values are ticked, so several can be set in one go.

**Never** put a select straight into the filter row as the set filter; the funnel plus
popup is the platform's pattern.

**The count line above the table** reads `3 Displays & Devices` unfiltered, and
`Showing 2 of 3 Displays & Devices` as soon as any filter is on.

**Filter state belongs in the URL** (`?filter[0][field]=…&filter[0][values][0]=…`,
`?search[0][field]=…&search[0][keyword]=…`), so a filtered table can be linked and
reloaded.

**A filter always lives in its column**, never as a select (or anything else) above the
table — including when the server, not the grid, does the filtering. If a page must filter
server-side, give the data its own column and put the funnel there: same icon, same popup,
same states; the chosen value goes in the URL and the request.

In this repo all of that is `apps/admin/src/shared/TableFilters.tsx`: `searchColumn(label)`,
`setColumn(label, values)`, `externalSetColumn(label, values, chosen, onChange)` for the
server-applied case, and `showingCount(shown, total, noun)`. Spread one of them into a
column definition; never hand-roll a filter cell and never lift a filter out of the table.

A checkbox column comes first; a `⋯` actions column comes last.

```jsx
const columns = [
  { field: 'select', headerCheckboxSelection: true, checkboxSelection: true, width: 60 },
  { field: 'status', headerName: 'Status', width: 144, cellRenderer: StatusDot, filter: true },
  { field: 'strategy', headerName: 'Playback Strategy', width: 170, cellRenderer: StrategyPill, filter: true },
  { field: 'name', headerName: 'Name', width: 300, cellRenderer: NameWithThumb, floatingFilter: true },
  { field: 'playlists', headerName: 'Playlist(s)', width: 200, filter: true },
  { field: 'actions', headerName: '', width: 76, cellRenderer: RowMenu, pinned: 'right' },
];
```

---

## 4. Status dot

```jsx
const StatusDot = ({ status }) => (
  <span
    className="inline-block w-2 h-2 rounded-full"
    style={{ background: { active: '#52c41a', warning: '#faad14', offline: '#ff4d4f' }[status] }}
  />
);
```

Used for campaign, device and staff state. Green = active/available, amber = serving/issues,
red = offline/unavailable.

---

## 5. Playback strategy pill

Outlined pill, transparent fill — **not** a solid badge.

```jsx
const StrategyPill = ({ value }) => (
  <div className="flex items-center justify-center h-6 px-4 py-1 rounded-full border border-gray-300">
    {value}   {/* LOCALISED | TRIGGERED */}
  </div>
);
```

Measured: height `24px`, padding `4px 16px`, radius `9999px`, border `1px` grey-300, text
`14px / 400` `#333333`.

---

## 6. Count line

Every list and drill-down page carries one directly beneath the title divider. The number is
bold; the noun is not.

```jsx
<div className="flex items-center ml-2"><div><b>{count}</b> {noun}</div></div>
// 63 Campaigns · 12 Stores · 3 Displays & Devices · 14 display types · 4 items
```

---

## 7. KPI card (Campaign Insights)

```jsx
const KpiCard = ({ icon, tint, label, value }) => (
  <div className="flex items-center gap-3 rounded-lg border border-black/5 px-4 py-3">
    <div className="flex items-center justify-center rounded-lg shrink-0 w-10 h-10" style={{ background: tint }}>
      {icon}
    </div>
    <div>
      <div className="uppercase" style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.5px', color: '#9ca3af' }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 600, color: '#333333' }}>{value}</div>
    </div>
  </div>
);

// Tints in order: #f3f0ff (plays), #ecfdf5 (playback time), #fef2f2 (views), #fff8e1 (avg duration)
```

---

## 8. Engagement score bar

```jsx
const EngagementScore = ({ value }) => (
  <div className="flex items-center gap-4 border-t border-b border-black/5 py-3">
    <span className="uppercase" style={{ fontSize: 12, letterSpacing: '0.5px', color: 'rgba(0,0,0,0.45)' }}>
      Engagement Score
    </span>
    <div className="flex-1 h-1.5 rounded-full bg-gray-100">
      <div className="h-full rounded-full" style={{ width: `${value}%`, background: '#38b0cf' }} />
    </div>
    <span style={{ fontSize: 18, fontWeight: 600, color: '#38b0cf' }}>{value}%</span>
  </div>
);
```

Note the accent `#38b0cf`, not the primary `#169bc2`.

---

## 9. Stat tile (Retail Admin / Insights)

```jsx
const StatTile = ({ value, label }) => (
  <div className="flex-1 rounded-lg text-center py-6 px-4" style={{ background: '#f5f5f5' }}>
    <div className="text-2xl font-bold" style={{ color: '#333333' }}>{value}</div>
    <div className="mt-1" style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{label}</div>
  </div>
);
```

---

## 10. Settings secondary nav

```jsx
const SecondaryNav = ({ items, activeKey, onSelect }) => (
  <div className="w-[245px] shrink-0 bg-white border-r border-[#f0f0f0]">
    {items.map(item => (
      <div key={item.key}>
        <div
          onClick={() => onSelect(item.key)}
          className="flex items-center justify-between px-4 py-3 cursor-pointer text-sm"
          style={
            activeKey === item.key || item.children?.some(c => c.key === activeKey)
              ? { color: '#169bc2', background: item.children ? 'transparent' : 'rgba(22,155,194,0.1)' }
              : { color: '#333333' }
          }
        >
          {item.label}
          {item.children && <ChevronIcon open={item.open} />}
        </div>
        {item.children?.map(child => (
          <div
            key={child.key}
            onClick={() => onSelect(child.key)}
            className="px-4 py-3 pl-8 cursor-pointer text-sm"
            style={
              activeKey === child.key
                ? { color: '#169bc2', background: 'rgba(22,155,194,0.1)' }
                : { color: '#333333' }
            }
          >
            {child.label}
          </div>
        ))}
      </div>
    ))}
  </div>
);
```

Nav data:

```js
export const companySettingsNav = [
  { key: 'platform-setup', label: 'Platform Set-up' },
  { key: 'brand-logo', label: 'Brand / Logo / Guidelines' },
  { key: 'campaign-settings', label: 'Campaign Settings' },
  { key: 'retail-admin-setup', label: 'Retail Admin Set-up' },
  { key: 'retail-settings', label: 'Retail Settings', children: [
    { key: 'store-segments', label: 'Store Segments' },
    { key: 'display-tags', label: 'Display Tags' },
    { key: 'cta-settings', label: 'CTA Settings' },
  ]},
];

export const platformAdminNav = [
  { key: 'security', label: 'Security (IP Restrictions)' },
  { key: 'enabled-features', label: 'Enabled Features', children: [
    { key: 'google-maps', label: 'Google Maps/Places' },
    { key: 'digital-signage', label: 'Digital Signage' },
    { key: 'campaign-monitoring', label: 'Campaign Monitoring Settings' },
    { key: 'queueing', label: 'Queueing / Appointments' },
    { key: 'mobile-store-sites', label: 'Mobile Store Sites' },
    { key: 'api-auth', label: 'API Authentication' },
    { key: 'google-business', label: 'Google Business Profile' },
    { key: 'qr-control', label: 'QR Control' },
    { key: 'ai-models', label: 'AI Models / Integrations' },
    { key: 'ai-agents', label: 'AI Agents / Skills' },
    { key: 'mist', label: 'MIST (Proximity)' },
  ]},
];
```

---

## 11. Form section divider

```jsx
const FormSectionDivider = ({ label }) => (
  <div className="uppercase mt-6 mb-3"
    style={{ fontSize: 12, letterSpacing: '0.5px', color: 'rgba(0,0,0,0.45)' }}>
    {label}
  </div>
);
// GENERAL QUEUEING SETTINGS · MOBILE SITE LOOK & FEEL · DEFINED CAMPAIGN TARGETING RULES
// COMPANY LOGO/ICON USED ON DARK BACKGROUNDS (this one renders in #333, not muted)
```

---

## 12. Toggle setting row

The workhorse of Platform Admin.

```jsx
const ToggleRow = ({ label, tooltip, checked, onChange }) => (
  <div className="flex items-center justify-between py-4 border-b border-black/5">
    <span className="flex items-center gap-2">
      {label}
      {tooltip && <Tooltip title={tooltip}><InfoIcon /></Tooltip>}
    </span>
    <Switch checked={checked} onChange={onChange} />
  </div>
);
```

Never hardcode the switch colour — `ConfigProvider` supplies `#169bc2`. Track height `22px`,
radius `9999px`.

---

## 13. Form fields

```jsx
<div className="mb-4">
  <label className="block mb-1" style={{ fontSize: 14, color: 'rgba(0,0,0,0.45)' }}>
    <span style={{ color: '#ff4d4f' }}>*</span> Platform Email address (AWS SES Email)
  </label>
  <Input suffix={<span style={{ color: '#52c41a', fontWeight: 600 }}>Verified</span>} />
</div>
```

- The required marker is a red `*` **before** the label, not after.
- Labels are muted grey and sit above the input.
- ⓘ tooltips are right-aligned on the label row.
- Right-aligned actions (`+ Add Token`) sit on the label row, opposite the label.
- Read-only fields render as disabled inputs with a grey fill.
- Tag inputs render removable chips with an `✕`, plus an empty input beneath for the next value.

---

## 14. Collapsible section (Storyboard & Copy, Creative)

A bordered card with a grey header strip.

```jsx
const CollapsibleSection = ({ title, children }) => {
  const [open, setOpen] = useState(true);
  return (
    <div className="border border-[#f0f0f0] rounded-lg mb-4">
      <div onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-4 py-3 bg-[#fafafa] cursor-pointer rounded-t-lg">
        <ChevronIcon open={open} />
        <span className="uppercase" style={{ fontSize: 12, letterSpacing: '0.5px' }}>{title}</span>
      </div>
      {open && <div className="p-4">{children}</div>}
    </div>
  );
};
// HEADLINE · SUB HEADLINE · LEGAL COPY (Ts&Cs) · BODY COPY · ONSITE BANNERS · LANDSCAPE PLAYLIST
```

---

## 15. Segmented toggle

```jsx
/* Campaign Type — dark active segment */
<Segmented options={[
  { label: 'Image', value: 'image', icon: <ImageIcon /> },
  { label: 'Video', value: 'video', icon: <VideoIcon /> },
]} />

/* Landscape / Portrait preview toggle — light active segment */
<Segmented options={['Landscape', 'Portrait']} />
```

---

## 16. Targeting rule builder

```jsx
<FormSectionDivider label="Defined Campaign Targeting Rules" />
<div className="flex items-center justify-end gap-2 -mt-8">
  <span>Override current campaign</span>
  <Tooltip title="…"><HelpIcon /></Tooltip>
  <Switch />
</div>

<Text type="secondary">Select 'Add New AND/OR Condition' to Add Targeting Rules</Text>

<div className="border border-[#f0f0f0] rounded-lg p-4 mt-2">
  <div className="flex items-center gap-3">
    <Select className="w-56" defaultValue="Store / Location Data" />
    <Select className="w-56" defaultValue="Variable Store Segments" />
    <Select className="w-44" defaultValue="excludes selected [OR]" />
    <Select className="flex-1" mode="multiple" />
    <Button type="text" icon={<TrashIcon />} />
  </div>
  <Divider className="!my-3" />
  <Button className="border-primary text-primary" icon={<PlusIcon />}>Add new "OR" Condition</Button>
</div>

<Button className="border-primary text-primary mt-4" icon={<PlusIcon />}>Add New "AND" Condition</Button>
```

---

## 17. Alerts

Retail Admin leans on these for warnings and empty states.

```jsx
<Alert type="warning" showIcon
  message="Please Note: Queue is Currently Closed. Visitors can only be added to Queue by Store Staff" />

<Alert type="warning" showIcon message="This Queue is Currently Empty" />
```

Full width, light amber fill, amber icon, `14px` text.

---

## 18. Empty state (HQ Admin)

```jsx
<Empty
  image={<BrokenLinkIcon style={{ fontSize: 40, color: '#d9d9d9' }} />}
  description={
    <>
      <div style={{ color: 'rgba(0,0,0,0.45)' }}>No IP Address added yet.</div>
      <div style={{ fontWeight: 600, marginTop: 8 }}>
        Currently all IP Addresses have access to the Platform.
      </div>
    </>
  }
/>
```

An AG Grid with no rows shows a plain `Empty data` marker inside the grid body.

---

## 19. Row actions menu

```jsx
<Dropdown menu={{ items: [
  { key: 'edit', label: 'View/Edit Store Details' },
  { key: 'retail', label: 'Visit Retail Manager Website' },
  { key: 'delete', label: 'Delete' },
]}}>
  <Button type="text" icon={<EllipsisIcon />} />
</Dropdown>
```

Horizontal `⋯`, always the last column. Row hover tints to `#e8fdff`.

---

## 20. Upload panel (Brand / Logo)

```jsx
<div className="relative flex items-center justify-center rounded-lg py-10" style={{ background: '#333333' }}>
  <img src={logo} alt="" className="max-h-16" />
  <Button type="text" icon={<UploadIcon />} className="absolute right-4 text-white">Update</Button>
</div>
<Text type="secondary" className="block mt-2">Max. 1MB - use a transparent PNG file.</Text>
```

The dark panel exists so brands can check their logo against the dark surfaces the platform uses.

---

## 21. AI assistant FAB

```jsx
<button
  className="fixed z-1000 cursor-grab active:cursor-grabbing touch-none rounded-full w-16 h-16
             flex items-center justify-center text-white shadow-lg"
  style={{ background: 'linear-gradient(in oklab, #169bc2 0%, #9747ff 100%)', right: 24, bottom: 24 }}
>
  <ChatSparkleIcon />
</button>
```

Present on every HQ Admin page, and draggable. Same teal→violet gradient as the AI action
button — the two read as one family.

**Do not render this in a prototype.** `position: fixed` anchors to the iframe rather than the
viewport, and the parent shell already supplies the assistant.

---

## 22. Icons

```jsx
/* Font approach — Material Symbols Outlined */
<span className="material-symbols-outlined">storefront</span>

/* React approach — react-icons/md, what the platform's own icon picker emits */
import { MdOutlineStorefront } from 'react-icons/md';
<MdOutlineStorefront />
```

```css
.material-symbols-outlined {
  font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
  vertical-align: middle;
}
```

| Context | Size |
|---|---|
| Inline with body text | `16px` |
| Sidebar nav, buttons, table actions | `20px` |
| Standalone / empty-state glyphs | `24px`–`40px` |

Icons inherit `currentColor` — never hardcode an icon colour where the surrounding text already
carries the right one.
