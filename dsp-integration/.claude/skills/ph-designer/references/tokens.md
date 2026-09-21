# Personalisation Hub — Design Tokens

All values read from computed styles on the live platform, August 2026.

---

## 1. Colour

### Brand

| Token | Value | Where it appears |
|---|---|---|
| `primary` | `#169bc2` | Primary buttons, active sidebar item background, tab ink bar, switch track (on), checkbox (checked), links, active settings-nav text, pagination active border |
| `primary-accent` | `#38b0cf` | Engagement-score percentage, active tab bottom border, hover states |
| `primary-active` | `#09759c` | Pressed state |
| `primary-tint` | `rgba(22,155,194,0.10)` | Active tab background, active settings-nav row background |
| `primary-soft` | `#e8fdff` | Table row hover, light info surfaces |
| `ai-violet` | `#9747ff` | The far end of the AI gradient |

### The AI gradient

Anything driven by the platform's AI assistant is marked with a teal→violet gradient rather than
a flat colour. This is a first-class part of the design language, not decoration.

| Token | Value |
|---|---|
| `ai-gradient` | `linear-gradient(135deg, #169bc2, #9747ff)` |
| `ai-gradient-surface` | `linear-gradient(135deg, rgba(22,155,194,0.2), rgba(151,71,255,0.2))` |
| `ai-gradient-fab` | `linear-gradient(in oklab, #169bc2 0%, #9747ff 100%)` |

`ai-gradient` is applied to text via `background-clip: text`; `ai-gradient-surface` fills the AI
action button; `ai-gradient-fab` fills the floating assistant button. See
`components.md` §1 and §21.

`primary-tint` is the exact measured value of an active tab background —
`color(srgb 0.0862745 0.607843 0.760784 / 0.1)`. Express it as `rgba(22,155,194,0.1)`.

### Neutrals

| Token | Value | Usage |
|---|---|---|
| `header-bg` | `#000000` | Top bar, both apps |
| `sidebar-bg` | `#333333` | Left sidebar, both apps |
| `sidebar-item` | `rgba(255,255,255,0.65)` | Idle sidebar text |
| `sidebar-item-active` | `#ffffff` | Active sidebar text (on `#169bc2`) |
| `surface` | `#ffffff` | Page background and cards — HQ Admin content is white |
| `surface-alt` | `#fafafa` | Table header rows |
| `surface-muted` | `#f5f5f5` | Retail Admin stat tiles |
| `text` | `#333333` | Body text, HQ Admin titles |
| `text-antd` | `rgba(0,0,0,0.88)` | Retail Admin body/titles (AntD default) |
| `text-muted` | `rgba(0,0,0,0.45)` | Field labels, breadcrumb links, helper text |
| `text-micro` | `#9ca3af` | 10px KPI micro-labels (Tailwind `gray-400`) |
| `border` | `#d9d9d9` | Input and control borders |
| `border-subtle` | `#f0f0f0` | Card-tab borders, table row rules |
| `divider` | `rgba(5,5,5,0.06)` | Horizontal rules under page titles |
| `grid-text` | `#181d1f` | AG Grid header and cell text |
| `grid-border` | `rgba(24,29,31,0.15)` | AG Grid row and header borders |

### Semantic

| Token | Value | Usage |
|---|---|---|
| `success` | `#52c41a` | Active status dot, "Available" staff, On Rotation |
| `warning` | `#faad14` | Playback issues, alert bars, "Serving Customers" |
| `error` | `#ff4d4f` | Offline dot, "Unavailable", Thermal Critical |
| `info` | `#1677ff` | AntD default info/link blue |

### KPI icon tints

Campaign Insights cards use a 40×40 `rounded-lg` (8px) tile behind each icon:

| Metric | Tile background |
|---|---|
| Total Plays | `#f3f0ff` (violet) |
| Total Playback Time | `#ecfdf5` (emerald) |
| Total Views | `#fef2f2` (red) |
| Avg View Duration | `#fff8e1` (amber) |

---

## 2. Typography

Font stack (Roboto is loaded as a webfont — do not substitute a system stack):

```css
font-family: Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif;
```

Icon font — **Material Symbols Outlined** (Google's free set):

```html
<link rel="stylesheet"
  href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;600;700&family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" />
```

| Role | Size / weight | Colour | Notes |
|---|---|---|---|
| HQ Admin page title | `20px / 700` | `#333333` | Tailwind `text-xl font-bold`, often `truncate` |
| Retail Admin page title | `20px / 500` | `rgba(0,0,0,0.88)` | AntD `Typography.Title` |
| Body / table cell / form field | `14px / 400` | `#333333` | Base size |
| Tab label (idle) | `14px / 400` | `#333333` | |
| Tab label (active) | `14px / 500` | `#169bc2` | |
| Count line | `14px / 400` | `#333333` | Number wrapped in `<b>` |
| Table header (AG Grid) | `13px / 700` | `#181d1f` | |
| Table header (Retail Admin) | `14px / 600` | `rgba(0,0,0,0.88)` | on `#fafafa` |
| KPI value | `18px / 600` | `#333333` | |
| KPI micro-label | `10px / 500`, `letter-spacing: 0.5px` | `#9ca3af` | ALL CAPS |
| Section divider label | `12px`, ALL CAPS | `rgba(0,0,0,0.45)` | e.g. `GENERAL QUEUEING SETTINGS` |
| Form field label | `14px / 400` | `rgba(0,0,0,0.45)` | Sits above the input; required marker is a red `*` **before** the label |
| Breadcrumb (link) | `14px / 400` | `rgba(0,0,0,0.45)` | |
| Breadcrumb (current) | `14px / 400` | `#333333` | |
| Sidebar item | `14px / 400`, ALL CAPS | see neutrals | line-height `40px` |

---

## 3. Layout & spacing

| Measure | Value |
|---|---|
| Header height | `64px` |
| Sidebar width (expanded) | `256px` |
| Sidebar width (Retail Admin collapsed) | `70px` |
| Sidebar item height | `40px` |
| Sidebar item padding | `0 16px 0 24px` |
| Sidebar item radius | `8px` |
| Main content padding | `20px` |
| Settings secondary-nav width | `~245px` |
| Retail Admin content column | `~900px` centred (`~550px` for single-column forms) |
| Tab height | `46px` (padding `12px 8px`) |
| Tab ink bar | `2px`, `#169bc2` |
| Card-tab height | `40px` (padding `8px 16px`) |
| Button height | `32px` (padding `0 15px`) |
| Input padding | `4px 11px` |

### AG Grid metrics (HQ Admin)

| Measure | Value |
|---|---|
| Header block height | `80px` (label row + filter row) |
| Row height — with thumbnail (Campaigns) | `99px` |
| Row height — text only (Devices, Stores) | `42px` |
| Cell padding | `0 15px` |
| Row / header border | `1px solid rgba(24,29,31,0.15)` |
| Wrapper background | `#ffffff` |

### Radius

| Element | Radius |
|---|---|
| Buttons, inputs, selects | `6px` |
| Cards, sidebar items, card-tab top corners | `8px` |
| Checkbox | `4px` |
| Pills / badges / switch | `9999px` |
| KPI icon tile | `8px` |

---

## 4. `design-tokens.json`

```json
{
  "color": {
    "primary": "#169bc2",
    "primaryAccent": "#38b0cf",
    "primaryActive": "#09759c",
    "primaryTint": "rgba(22,155,194,0.10)",
    "primarySoft": "#e8fdff",
    "aiViolet": "#9747ff",
    "aiGradient": "linear-gradient(135deg, #169bc2, #9747ff)",
    "aiGradientSurface": "linear-gradient(135deg, rgba(22,155,194,0.2), rgba(151,71,255,0.2))",
    "aiGradientFab": "linear-gradient(in oklab, #169bc2 0%, #9747ff 100%)",
    "headerBg": "#000000",
    "sidebarBg": "#333333",
    "sidebarItem": "rgba(255,255,255,0.65)",
    "sidebarItemActive": "#ffffff",
    "surface": "#ffffff",
    "surfaceAlt": "#fafafa",
    "surfaceMuted": "#f5f5f5",
    "text": "#333333",
    "textAntd": "rgba(0,0,0,0.88)",
    "textMuted": "rgba(0,0,0,0.45)",
    "textMicro": "#9ca3af",
    "border": "#d9d9d9",
    "borderSubtle": "#f0f0f0",
    "divider": "rgba(5,5,5,0.06)",
    "gridText": "#181d1f",
    "gridBorder": "rgba(24,29,31,0.15)",
    "success": "#52c41a",
    "warning": "#faad14",
    "error": "#ff4d4f",
    "info": "#1677ff",
    "kpiTint": {
      "violet": "#f3f0ff",
      "emerald": "#ecfdf5",
      "red": "#fef2f2",
      "amber": "#fff8e1"
    }
  },
  "font": {
    "family": "Roboto, \"Helvetica Neue\", Helvetica, Arial, sans-serif",
    "icon": "Material Symbols Outlined",
    "size": { "micro": "10px", "caption": "12px", "gridHeader": "13px", "base": "14px", "kpi": "18px", "title": "20px" },
    "weight": { "regular": 400, "medium": 500, "semibold": 600, "bold": 700 }
  },
  "radius": { "control": "6px", "card": "8px", "checkbox": "4px", "pill": "9999px" },
  "size": {
    "headerHeight": "64px",
    "sidebarWidth": "256px",
    "sidebarRailWidth": "70px",
    "sidebarItemHeight": "40px",
    "contentPadding": "20px",
    "settingsNavWidth": "245px",
    "buttonHeight": "32px",
    "tabHeight": "46px",
    "cardTabHeight": "40px"
  },
  "grid": {
    "headerHeight": "80px",
    "rowHeightMedia": "99px",
    "rowHeightText": "42px",
    "cellPadding": "0 15px"
  }
}
```

---

## 5. CSS custom properties

```css
:root {
  --ph-primary: #169bc2;
  --ph-primary-accent: #38b0cf;
  --ph-primary-active: #09759c;
  --ph-primary-tint: rgba(22, 155, 194, 0.1);
  --ph-primary-soft: #e8fdff;
  --ph-ai-violet: #9747ff;
  --ph-ai-gradient: linear-gradient(135deg, #169bc2, #9747ff);
  --ph-ai-gradient-surface: linear-gradient(135deg, rgba(22, 155, 194, 0.2), rgba(151, 71, 255, 0.2));
  --ph-ai-gradient-fab: linear-gradient(in oklab, #169bc2 0%, #9747ff 100%);

  --ph-header-bg: #000000;
  --ph-sidebar-bg: #333333;
  --ph-sidebar-item: rgba(255, 255, 255, 0.65);

  --ph-surface: #ffffff;
  --ph-surface-alt: #fafafa;
  --ph-surface-muted: #f5f5f5;

  --ph-text: #333333;
  --ph-text-muted: rgba(0, 0, 0, 0.45);
  --ph-text-micro: #9ca3af;

  --ph-border: #d9d9d9;
  --ph-border-subtle: #f0f0f0;
  --ph-divider: rgba(5, 5, 5, 0.06);

  --ph-grid-text: #181d1f;
  --ph-grid-border: rgba(24, 29, 31, 0.15);

  --ph-success: #52c41a;
  --ph-warning: #faad14;
  --ph-error: #ff4d4f;

  --ph-radius-control: 6px;
  --ph-radius-card: 8px;
  --ph-header-h: 64px;
  --ph-sidebar-w: 256px;
  --ph-content-pad: 20px;

  --ph-font: Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif;
}
```

---

## 6. Ant Design theme

```jsx
import { ConfigProvider } from 'antd';

export const phTheme = {
  token: {
    colorPrimary: '#169bc2',
    colorSuccess: '#52c41a',
    colorWarning: '#faad14',
    colorError: '#ff4d4f',
    colorText: '#333333',
    colorTextSecondary: 'rgba(0,0,0,0.45)',
    colorBorder: '#d9d9d9',
    colorBorderSecondary: '#f0f0f0',
    colorSplit: 'rgba(5,5,5,0.06)',
    colorBgLayout: '#ffffff',
    colorBgContainer: '#ffffff',
    borderRadius: 6,
    borderRadiusLG: 8,
    fontSize: 14,
    fontFamily: 'Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif',
    controlHeight: 32,
  },
  components: {
    Layout: { headerBg: '#000000', headerColor: '#ffffff', headerHeight: 64, siderBg: '#333333', bodyBg: '#ffffff' },
    Menu: {
      darkItemBg: '#333333',
      darkSubMenuItemBg: '#2a2a2a',
      darkItemSelectedBg: '#169bc2',
      darkItemColor: 'rgba(255,255,255,0.65)',
      darkItemSelectedColor: '#ffffff',
      itemHeight: 40,
      itemBorderRadius: 8,
    },
    Tabs: {
      inkBarColor: '#169bc2',
      itemActiveColor: '#169bc2',
      itemSelectedColor: '#169bc2',
      itemColor: '#333333',
      cardBg: 'transparent',
    },
    Button: { defaultColor: '#333333', paddingInline: 15 },
    Breadcrumb: { itemColor: 'rgba(0,0,0,0.45)', lastItemColor: '#333333', separatorColor: 'rgba(0,0,0,0.45)' },
    Switch: { handleSize: 18, trackHeight: 22 },
  },
};

// Usage
<ConfigProvider theme={phTheme}><App /></ConfigProvider>
```

---

## 7. Tailwind config

Tailwind v4 is in use. With v4, prefer `@theme` in CSS:

```css
@import "tailwindcss";

@theme {
  --color-primary: #169bc2;
  --color-primary-accent: #38b0cf;
  --color-primary-active: #09759c;
  --color-primary-soft: #e8fdff;
  --color-sidebar: #333333;
  --color-header: #000000;
  --color-ink: #333333;
  --color-muted: rgba(0, 0, 0, 0.45);
  --color-grid-text: #181d1f;
  --font-sans: Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif;
}
```

For a Tailwind v3 project:

```js
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#169bc2',
        'primary-accent': '#38b0cf',
        'primary-active': '#09759c',
        'primary-soft': '#e8fdff',
        sidebar: '#333333',
        header: '#000000',
        ink: '#333333',
      },
      fontFamily: { sans: ['Roboto', '"Helvetica Neue"', 'Helvetica', 'Arial', 'sans-serif'] },
    },
  },
};
```

---

## 8. AG Grid theme

```css
.ag-theme-alpine {
  --ag-font-family: Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif;
  --ag-font-size: 14px;
  --ag-foreground-color: #181d1f;
  --ag-background-color: #ffffff;
  --ag-header-background-color: #ffffff;
  --ag-header-foreground-color: #181d1f;
  --ag-border-color: rgba(24, 29, 31, 0.15);
  --ag-row-hover-color: #e8fdff;
  --ag-selected-row-background-color: #e8fdff;
  --ag-cell-horizontal-padding: 15px;
  --ag-header-height: 40px;
  --ag-row-height: 42px;
  --ag-checkbox-checked-color: #169bc2;
}
```

Header cell labels are `13px / 700`. For a grid with media thumbnails set `rowHeight={99}`.
