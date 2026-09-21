# Prototyping — Iframing a Project into HQ Admin

**Read this before building anything.** Most new project work at Personalisation Hub — the menu
boards project is the standard example — is not a platform page. It is a **separate application
that gets iframed into HQ Admin**. What you build, and what you must *not* build, changes
completely depending on which of the two you are making.

---

## 1. The two build modes

| | **Prototype (default)** | **Platform page** |
|---|---|---|
| What it is | A standalone project framed into HQ Admin via a CTA | A page that ships inside the HQ Admin or Retail Admin codebase |
| Header | **Never render** — the parent shell provides it | Build it |
| Sidebar | **Never render** — the parent shell provides it | Build it |
| Breadcrumb | **Never render** — the parent shell provides it | Build it |
| Root element | Your content frame, filling 100% width/height | Full app shell |
| Routing | Your own, internal to the prototype | The platform's router |

**If the user says "prototype", "menu boards", "mock up", "let's try", or names a project
rather than a platform section — assume prototype.** When it is genuinely ambiguous, ask; the
cost of guessing wrong is rebuilding the whole thing.

---

## 2. How the iframe is wired up

Prototypes are registered as a **CTA with an Experience URL**, under
**Company Settings → Retail Settings → CTA Settings** (route
`/hq-admin/company-settings/retail-settings/header-links`).

That page has two independent sections, because a CTA can be added to either app's navigation:

- `HQ ADMIN - LEFT HAND NAV MENU`
- `RETAIL ADMIN - LEFT HAND NAV MENU`

Each lists its CTAs in a table of `CTA Name` · `Experience URL` · `Action`, with a
`+ Add Category URL` button above it.

### The `Add New Category URL` modal

| Field | Required | Notes |
|---|---|---|
| `Icon` | no | Searchable Material icon picker. Names are title case with an `Outline` prefix for outlined variants — `Outline Storefront`, `Local Convenience Store` |
| `CTA Name` | **yes** | The label that appears in the left-hand nav |
| `Experience URL` | **yes** | Where your prototype is hosted. Carries a `+ Add Token` action for interpolating platform tokens into the URL |

Footer: `Cancel` / `Save`.

### What happens at runtime

1. The CTA appears as a new item in the HQ Admin left-hand sidebar, styled exactly like the
   built-in nav items (ALL CAPS, 40px, `8px` radius, teal `#169bc2` block when active) with
   the chosen Material icon.
2. Selecting it keeps the platform chrome — black header, dark sidebar, breadcrumb — and loads
   your **Experience URL into an iframe filling the content area**.
3. Your prototype renders inside that frame. It has roughly `1163px × 814px` at a 1400px-wide
   desktop viewport, and it must not assume a fixed size.

```
┌──────────────┬────────────────────────────────────────────────────────────┐
│              │ ☰  PersonalisationHub          [Production]  [brand]        │  ← platform
│  [brand]     ├────────────────────────────────────────────────────────────┤     shell
│              │  Home  >  Menu Boards                                      │     (not yours)
│ CAMPAIGNS    ├────────────────────────────────────────────────────────────┤
│ DISPLAYS &…  │ ┌────────────────────────────────────────────────────────┐ │
│ STORES /…    │ │                                                        │ │
│ INSIGHTS /…  │ │   <iframe src="{Experience URL}">                      │ │
│ ▸ MENU       │ │       ← YOUR PROTOTYPE LIVES HERE, AND ONLY HERE       │ │
│   BOARDS     │ │                                                        │ │
│              │ └────────────────────────────────────────────────────────┘ │
└──────────────┴────────────────────────────────────────────────────────────┘
```

### Tokens in the Experience URL

`+ Add Token` interpolates platform context into the URL, so the prototype knows which tenant,
store or display it is running for — e.g.
`https://menu-boards.example.com/?store=${StoreCode}&brand=${BrandName}`.

Read them back with `URLSearchParams` on load and treat every one as optional; a prototype
opened without tokens must still render something sensible.

```js
const params = new URLSearchParams(window.location.search);
const storeCode = params.get('store') ?? null;
```

---

## 3. Building the content frame

```jsx
export default function App() {
  return (
    <ConfigProvider theme={phTheme}>
      {/* No Layout.Header. No Layout.Sider. No Breadcrumb. */}
      <div className="min-h-screen w-full bg-white p-5" style={{ fontFamily: 'Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif' }}>
        <div className="flex items-center justify-between">
          <span className="text-xl font-bold">Menu Boards</span>
          <Button type="text">Some action</Button>
        </div>
        <div className="h-px bg-[rgba(5,5,5,0.06)] my-4" />
        {/* content */}
      </div>
    </ConfigProvider>
  );
}
```

Rules for the frame:

- **Start at the page title.** The breadcrumb above it belongs to the parent.
- **Background `#ffffff`, padding `20px`** — match the HQ Admin content area exactly, so the
  seam between shell and iframe is invisible.
- **Height is fluid.** Use `min-h-screen` / `100%`, never a hard pixel height. The frame is
  resized by the parent and by the user's viewport.
- **Never `position: fixed` to the viewport edges.** Inside an iframe that anchors to the frame,
  not the browser window, and it will land in the wrong place. This rules out the AI FAB and any
  fixed toolbar — the parent already provides the assistant.
- **Keep all navigation internal.** A prototype that needs multiple screens routes within
  itself; it does not try to drive the parent's sidebar.
- **Same design system throughout.** Tokens, typography, components and the AI gradient all
  apply unchanged — a prototype should be indistinguishable from a native page.

### Linking out of the frame

To navigate the *parent* window rather than the iframe:

```jsx
<a href={url} target="_top">Open in the platform</a>
// or
window.top.location.href = url;
```

A plain `window.location` change only navigates inside the frame, which strands the user in a
page with no chrome.

CTA Settings also offers a `Show/Add a back-link` option and a `Show Log-out button` checkbox,
which add a way back out of an experience — check whether these are enabled before building
your own back affordance, so you do not end up with two.

---

## 4. Hosting checklist

Because the prototype is loaded cross-origin into HQ Admin:

- Serve over **HTTPS**. A mixed-content frame is blocked outright.
- Do **not** send `X-Frame-Options: DENY` or `SAMEORIGIN`. Either header stops the platform from
  framing the prototype at all — this is the most common reason a new prototype shows a blank
  content area.
- If you set `Content-Security-Policy`, it must include
  `frame-ancestors https://*.personalisationhub.com` (add your own demo/staging host too).
- Cookies the prototype sets need `SameSite=None; Secure` to survive being in a third-party
  frame — or avoid cookies and keep state in memory.
- Give the page a sane `<title>`; some views surface it.

---

## 5. Quick decision reminder

> Building a menu board, a demo experience, or anything the team calls a *project*?
> → **Prototype.** Content frame only. No header, no sidebar, no breadcrumb, no fixed
> positioning. Register it as a CTA with an Experience URL and it appears in the HQ Admin
> left-hand nav.

> Building a Campaigns table, a Platform Admin settings screen, a Retail Admin queue view?
> → **Platform page.** Build the full shell per `hq-admin.md` / `retail-admin.md`.
