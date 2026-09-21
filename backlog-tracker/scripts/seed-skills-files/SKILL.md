---
name: ph-designer
description: >
  Personalisation Hub UI/UX design system for building apps and interfaces that match the exact
  look and feel of the Personalisation Hub platform. Use this skill IMMEDIATELY whenever the user
  asks to build any UI, app, page, component, dashboard, admin screen, form, table, or interface
  -- even if they don't explicitly mention "Personalisation Hub". Ensures output visually matches
  PH's HQ Admin and Retail Admin using the correct component library, colour palette, typography,
  layout patterns, and interaction conventions. Trigger on: "build a UI", "create a screen",
  "design a component", "make an admin view", "staff interface", "queue management",
  "retail dashboard", "HQ admin", "retail admin", "mobile site", "mobile store site",
  "Personalisation Hub", "campaign page", "storyboard", "displays and devices",
  "stores and branches", "platform admin", "company settings", or any frontend/React/HTML
  task in PH context.
---

# Personalisation Hub — Frontend Designer Skill

Everything in this skill was measured from the live platform (`demo.personalisationhub.com`,
August 2026) by reading computed styles out of the DOM. Values are real, not approximated.

## How to use this skill

1. **Ask first: is this a prototype or a platform page?** Almost all new project work —
   menu boards and the like — is a **prototype iframed into HQ Admin**, which means you build
   the content frame *only* and render no header, sidebar or breadcrumb. This is the single
   most consequential decision in the whole skill. Read `references/prototyping.md` before
   anything else.
2. **Identify the surface** you are building — HQ Admin or Retail Admin. They are two separate
   applications with different shells, different table libraries, and different heading styles.
   Getting this wrong makes everything downstream wrong.
3. **Read `references/tokens.md`** — always. Colour, type, spacing, radius, and the ready-made
   Ant Design `ConfigProvider` theme and Tailwind config.
4. **Read the surface reference** — `references/hq-admin.md` or `references/retail-admin.md`.
   Each contains the shell, the page archetypes, and a catalogue of every real page.
5. **Read `references/components.md`** for the component recipes (buttons, tabs, tables, KPI
   cards, status indicators, forms, empty states).

Do not invent components. If a pattern is not in this skill, find the nearest documented pattern
and follow it rather than reaching for something new.

---

## 1. Tech stack (non-negotiable)

| Layer | Technology | Notes |
|---|---|---|
| Framework | React (functional components + hooks) | Vite build |
| Component library | **Ant Design v5** | CSS-variable mode enabled (`css-var-*` classes) |
| Utility styling | **Tailwind CSS v4** | Used heavily alongside AntD; v4 emits `oklch()` colours |
| Data grid (HQ Admin only) | **AG Grid**, `ag-theme-alpine` | NOT `antd` `<Table>` — see below |
| Tables (Retail Admin) | Plain semantic tables / AntD table styling | Retail Admin has no AG Grid |
| Icons | **Google Material Symbols** (free) | Outlined style — see §1.1 |
| Fonts | **Roboto** (webfont) | `Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif` |

### 1.1 Icons — Google Material Symbols

The platform uses **Google's free Material icon set**. Use Material Symbols (Outlined)
everywhere.

```html
<link rel="stylesheet"
  href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" />
```

```jsx
<span className="material-symbols-outlined">storefront</span>
```

```css
.material-symbols-outlined {
  font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
  font-size: 20px;              /* 16px inline, 20px nav and controls, 24px standalone */
  vertical-align: middle;
}
```

In React, `react-icons/md` is the in-repo equivalent and is what the platform's own CTA icon
picker emits — `<MdOutlineStorefront />` renders an SVG with
`viewBox="0 0 24 24" height="1em" width="1em" fill="currentColor"`. Either approach is fine;
always size icons in `em` or with an explicit `font-size` so they track the adjacent text.

Material Symbols is the platform's only icon set. Any other icon library in PH code is a bug —
replace it with the nearest Material Symbol rather than matching it.

Icon names follow Material's own vocabulary — `storefront`, `local_convenience_store`,
`local_grocery_store`, `restore`, `settings_backup_restore`. The CTA icon picker in Company
Settings lists these in title case with an `Outline` prefix for the outlined variant
(`Outline Storefront`).

### The two most common mistakes

1. **Using `antd`'s `<Table>` for an HQ Admin list page.** Every HQ Admin data table is AG Grid
   with the Alpine theme. It has a two-row header (labels, then a filter row), column-level
   filter funnels, horizontal scroll, and AntD pagination rendered *beneath* the grid.
   Retail Admin, by contrast, uses ordinary tables.
2. **Assuming a system font stack.** The platform loads and applies **Roboto**. Never substitute
   `-apple-system`, and never import a Google Font other than Roboto.

---

## 2. The two surfaces at a glance

|  | HQ Admin (`/hq-admin/*`) | Retail Admin (`/retail-admin-web/*`) |
|---|---|---|
| Audience | Head office / brand marketers | In-store staff, on tablet |
| Shell | Own header + sidebar + breadcrumb | Own header + sidebar + breadcrumb + footer |
| Sidebar | 256px, fixed, ALL CAPS items | Collapsible: 70px icon rail ↔ 256px expanded |
| Header | Black 64px, logo left, env badge + brand right | Black 64px, brand logo **centred**, avatar right |
| Page title | `text-xl font-bold` → 20px/700 `#333333` | AntD `Title` → 20px/500 `rgba(0,0,0,0.88)` |
| Data tables | AG Grid (`ag-theme-alpine`) | Plain tables |
| Content width | Full width, 20px padding | Often a centred column (~900px / ~550px for forms) |
| Footer | None | `Privacy · FAQ · Version: x.x` |

**Both are full standalone applications.** Build the header, sidebar and breadcrumb — nothing
else provides them.

---

## 3. Core tokens (summary — full set in `references/tokens.md`)

```
Primary            #169bc2      buttons, active nav, tab ink, switches, links
Primary accent     #38b0cf      engagement figures, active tab borders, hover
Primary tint       rgba(22,155,194,0.10)   active tab background, active settings-nav row
AI violet          #9747ff      far end of the AI gradient
AI gradient        linear-gradient(135deg, #169bc2, #9747ff)
Sidebar            #333333      both apps
Header             #000000      both apps
Body text          #333333      NOT antd's rgba(0,0,0,0.88) in HQ Admin
Muted text         rgba(0,0,0,0.45)
Divider            rgba(5,5,5,0.06)
Border             #d9d9d9
Page background    #ffffff      HQ Admin content area is WHITE, not grey
Success / Warning / Error   #52c41a / #faad14 / #ff4d4f
```

Radius: `6px` controls · `8px` cards, sidebar items, card-tabs top corners · `9999px` pills.
Base font size `14px`. Sidebar item height `40px`. Header height `64px`.

---

## 4. Design principles

**Do**

- Set `#169bc2` once via `ConfigProvider.token.colorPrimary`; never hardcode it per component.
- Use Roboto for text and Google Material Symbols (Outlined) for every icon.
- Put a count line under every list-page title, with the number in `<b>` — `**63** Campaigns`.
- Mark every AI-driven action with the teal→violet **AI gradient** — a 20% gradient fill with
  gradient-clipped label text. `Launch a New Campaign` and the floating assistant both use it.
  Non-AI primary actions use a solid teal fill.
- Use plain text buttons (`type="text"`) for secondary page actions and drill-down links.
- Use ALL CAPS muted labels to divide form sections.
- Use status dots (green / amber / red) for device, campaign and staff state.
- Keep HQ Admin content full-bleed; keep Retail Admin content in a centred column.
- Use Material Symbols (Outlined) for every icon.

**Don't**

- Don't use `antd` `<Table>` in HQ Admin — use AG Grid Alpine.
- Don't use a flat colour for an AI action — it must carry the gradient.
- Don't apply `#f5f5f5` to the HQ Admin page background — it is white.
- Don't use Material UI, Bootstrap, Chakra, or any component library other than Ant Design.
- Don't use border-radius above 8px except for pills and avatars.
- Don't skip the `ConfigProvider` wrapper.
- Don't use any icon set other than Google Material Symbols.
- Don't render a header, sidebar or breadcrumb in a **prototype** — the parent shell owns them.
- Don't use `position: fixed` in a prototype; it anchors to the iframe, not the viewport.

---

## 5. Reference files

| File | Contents |
|---|---|
| `references/prototyping.md` | **Read first.** How projects get iframed into HQ Admin via a CTA Experience URL, and what a content frame may and may not render |
| `references/tokens.md` | Full colour / type / spacing tables, `design-tokens.json`, AntD theme, Tailwind config |
| `references/hq-admin.md` | HQ Admin shell, four page archetypes, full page catalogue |
| `references/retail-admin.md` | Retail Admin shell, page archetypes, full page catalogue |
| `references/components.md` | Component recipes with measured values |

---

*Icon set: Google Material Symbols (Outlined).*

*Audited live against demo.personalisationhub.com — 22 August 2026. Covers HQ Admin (Campaigns
list + Targeting/Storyboard/Creative tabs, Displays & Devices + drill-downs, Stores / Branches,
Insights / Analytics, Company Settings, Platform Admin) and Retail Admin (Queueing &
Appointments, Manage Displays, Store Profile, Store Hours). Mobile Store Site was not reachable
during the audit and is deliberately not documented — do not infer it from the admin surfaces.*
