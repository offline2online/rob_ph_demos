# faq — Personalisation Hub Help Centre (public site)

Consumer-facing help centre: front page + search, category pages (with
folders), article pages, search results. Served at the ROOT of its own
Firebase Hosting site (`ph-help-centre` in project `backlog-tracker-e4ed2`,
hosting target `help` in `backlog-tracker/firebase.json`, custom domain
**help.personalisationhub.com**) and iframed into the support centre on
personalisationhub.com. The same folder is also published by GitHub Pages
at `/faq/` like the rest of the repo root, which is handy for previews.
The footer's "Agent portal sign-in" link (hidden when embedded) and the
`/console` redirect lead to the admin console at
backlog-tracker-e4ed2.web.app. Old Freshdesk article URLs
(`/support/solutions/articles/<id>…`) redirect to the matching article.

## How content flows

```
admin console (backlog-tracker → FAQ Management)  ──edits──▶  Firestore (faqCategories / faqArticles)
        ▲                                                            │
        │ faq-sync.js (repo → Firestore, on push to main)            │ faq-export.js (Firestore → repo, hourly + on demand)
        │                                                            ▼
      faq/data/index.json + faq/data/articles/<id>.json   ──served by──▶  this site (GitHub Pages CDN)
```

- **`data/index.json`** — every category/folder and every article's metadata
  (title, summary, keywords, docType, status, order). One small cached
  request per page; search runs client-side over it.
- **`data/articles/<id>.json`** — one file per article body (HTML). Fetched
  only for the article being read.
- **`data/retired.json`** — ids the September 2026 rewrite retired
  (duplicates that were merged); `faq-sync.js` flips them to draft.
- Editing still happens in the console. `.github/workflows/faq-content.yml`
  exports Firestore → `data/` hourly (and via Actions → "FAQ content" →
  Run workflow), and the article page also fetches the single article
  document from Firestore's REST API in the background and swaps in a newer
  published revision, so an edit is visible on its page immediately.
- Bulk content work done in git (like the rewrite) lands in `data/` and the
  same workflow syncs it repo → Firestore on push, without overwriting
  anything edited in the console since the last sync.
- A "Notify Claude — Deploy" on the board proposes article updates for the
  tickets merging (`faqArticles.pendingRevision`, scoped to the project's
  product/program); they reach this site only after a person approves them
  in the console's FAQ Management and the ticket is Merged to Main — see
  `backlog-tracker/REQUIREMENTS.md` → "FAQ revision review". Neither
  `faq-export.js` nor this site ever reads `pendingRevision`.

## Files

- `index.html`, `category.html`, `article.html`, `search.html` — pages. No
  inline scripts (a CSP `<meta>` restricts scripts to this origin).
- `js/faq-data.js` — data layer (static snapshot, session cache, Firestore
  freshness check, DOMPurify rendering, search scoring).
- `js/page-*.js` — one module per page; `js/page-common.js` boots embed
  mode, version stamp and the search box.
- `js/search-box.js` — live search dropdown with keyboard navigation.
- `js/icons.js` — inline SVG Material Symbols (no icon web font is loaded).
- `js/vendor/purify.min.js` — DOMPurify 3.4.15, vendored (no third-party CDN).
- `js/firebase-config.js` — project id + API key for the REST freshness
  check (public identifiers; access is governed by Firestore rules).
- `css/faq.css` — styling (PH teal, Roboto). `.article-body` rules are the
  rendering contract with the console's editor (tables, callouts, code).

## Security / embedding notes

- Article HTML is sanitised with DOMPurify at render time, every time;
  only YouTube/Vimeo iframes are allowed, links get `rel="noopener"`.
- Firestore writes to the FAQ collections require a signed-in allowlisted
  Google account (`backlog-tracker/firestore.rules` → `isFaqEditor`).
- When embedded, the site hides its own header and posts
  `{type: "ph-faq:height", height}` to the parent so the host page can size
  the iframe. The Firebase Hosting site sends
  `Content-Security-Policy: frame-ancestors 'self' https://personalisationhub.com https://www.personalisationhub.com`,
  so only the marketing site can embed it (the GitHub Pages copy has no
  such header).

## Content standard

All content follows `docs/CONTRIBUTING-docs.md`. The September 2026 audit and
rewrite is documented in `docs/faq-audit-2026-09.md`.
