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
  request per page; search runs client-side over it. Written with one
  category/article per line inside an otherwise pretty-printed structure
  (`backlog-tracker/scripts/faq-index-lib.js`'s `serializeIndex`), not a
  single minified line — so two commits editing different articles land on
  different lines and git merges them automatically instead of conflicting
  on the one line the whole file used to be. It's always fully derivable
  from `data/articles/*.json` plus the categories list; nothing should ever
  hand-edit it directly.
- **`data/releases.json`** — every release (`{id, name, version, status,
  order}`, order ascending), exported by `faq-export.js` from the console's
  Releases page. An article whose metadata carries `introducedInReleaseId`
  / `removedInReleaseId` is shown only for the releases in that range:
  `js/faq-data.js` resolves the page's `?release=<id or version>` or, by
  default, the highest-order live release, and filters both the article
  lists and a single article page (out of range reads as "not found", like
  a draft). No file, no releases, or none live and none asked for means no
  filtering at all. See `backlog-tracker/REQUIREMENTS.md` →
  "`releases/{releaseId}`".
- **A `faq/data/index.json` merge conflict resolves itself, most of the
  time.** Because it aggregates every article's metadata into one file, it
  used to conflict whenever two different commits touched *any* two
  articles between them — even on different lines, if the diffs were close
  together — since it was written as a single JSON.stringify'd line (fixed
  by the one-per-line format above, which handles most cases on its own
  now). For whatever's left — e.g. the same article edited on both sides —
  `run-backlog-automation.js`'s deployment-train merge step rebuilds
  `index.json` from `data/articles/*.json` (which, being separate files,
  merge on their own) plus a categories list taken from whichever side
  exported more recently, whenever `index.json` is the *only* file that
  conflicted; see `backlog-tracker/ROUTINE_INSTRUCTIONS.md`'s own note on
  this under "Outcomes that are not a merge" for the exact mechanism, and
  what still falls back to a human (a genuine same-article conflict, or a
  conflict on some other file too).
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

## Article scoping (`programId` / `projectId`)

Every `faqArticles` document carries two optional scoping fields, both set
in the console's article editor (or via the MCP `create_faq_article` tool):

- **`programId`** — which product/program (`programs` collection, e.g.
  "Personalisation Hub", "PH Agent Console") the article documents. This is
  the field that matters for **FAQ impact review** (the Deploy flow's step
  3b in `backlog-tracker/ROUTINE_INSTRUCTIONS.md`): when a project deploys,
  the candidate articles it may propose a revision for are exactly those
  whose `programId` equals that project's own `programId` (read off
  `projects/{id}.programId`), unioned with any article whose `projectId`
  names that project directly (below). An article with no `programId` and
  no matching `projectId` is invisible to every project's deploy review —
  it can drift arbitrarily out of date with no automated check ever
  flagging it, which is exactly what happened to the console's own FAQ
  impact review before every `faqArticles` doc had a `programId` set.
- **`projectId`** — set only when an article documents one specific project
  within a program rather than the whole product (e.g. Personalisation Hub
  has more than one project on the backlog board). Leave it unset for an
  article that applies to the whole program.

The console's "New article"/"Edit article" page now requires a program to
be chosen before saving, the same way it already requires a category —
picking a project first auto-fills its program as a starting point (still
overridable). `backlog-tracker/scripts/backfill-faq-program.js` is the
one-off (repeatable) script that assigns a program to any pre-existing
article that predates this requirement.

## Files

- `index.html`, `category.html`, `article.html`, `search.html` — pages. No
  inline scripts (a CSP `<meta>` restricts scripts to this origin).
- `js/faq-data.js` — data layer (static snapshot, session cache, Firestore
  freshness check, DOMPurify rendering, search scoring).
- `js/page-*.js` — one module per page; `js/page-common.js` boots embed
  mode, version stamp and the search box.
- `js/search-box.js` — live search dropdown with keyboard navigation.
- `js/copy-block.js` — one-click **Copy** button on every `<pre><code>` block
  in an article (prompts to paste into an AI assistant, commands, JSON).
  Added at render time by `page-article.js`, because the sanitiser strips
  `<button>` from article HTML — so nothing is authored per article: any
  code block gets it. An optional `data-copy-label="Copy prompt"` on the
  `<pre>` changes the button text. Clipboard API first, hidden-textarea
  `execCommand("copy")` fallback, and if both fail the block is selected
  for a keyboard copy.
  Blocks taller than 4 rendered lines start collapsed behind a fade with a
  **Show more** toggle (Copy still copies the whole block);
  `data-collapse-lines="8"` changes the threshold and `data-collapse="false"`
  switches collapsing off for that block.
- `js/icons.js` — inline SVG Material Symbols (no icon web font is loaded).
- `js/vendor/purify.min.js` — DOMPurify 3.4.15, vendored (no third-party CDN).
- `js/firebase-config.js` — project id + API key for the REST freshness
  check (public identifiers; access is governed by Firestore rules).
- `css/faq.css` — styling (PH teal, Roboto). `.article-body` rules are the
  rendering contract with the console's editor (tables, callouts, code,
  and Quill's `ql-indent-N` list items — the editor saves a nested list as
  a flat list whose sub-items carry that class; an `<ol>` containing one
  switches to CSS counters so those sub-items are lettered instead of
  taking the next number).

## Security / embedding notes

- Article HTML is sanitised with DOMPurify at render time, every time;
  only YouTube/Vimeo iframes are allowed, links get `rel="noopener"`.
- Firestore writes to the FAQ collections require a signed-in allowlisted
  Google account (`backlog-tracker/firestore.rules` → `isFaqEditor`).
- The embedding `<iframe>` should carry `allow="clipboard-write"` so the
  Copy buttons can use the Clipboard API inside the frame; without it they
  fall back to `execCommand("copy")`, which still works in current browsers.
- When embedded, the site hides its own header and posts
  `{type: "ph-faq:height", height}` to the parent so the host page can size
  the iframe. The Firebase Hosting site sends
  `Content-Security-Policy: frame-ancestors 'self' https://personalisationhub.com https://www.personalisationhub.com`,
  so only the marketing site can embed it (the GitHub Pages copy has no
  such header).
- It also posts `{type: "ph-faq:scrollTop"}` once, right when embed mode
  boots on every page (not repeated from the height ResizeObserver). Since
  the iframe is sized to fit its content with no scrollbar of its own, it's
  the **host page** that actually scrolls, and a full navigation inside the
  iframe (an article's Previous/Next/Related links, a category link, a
  search result) doesn't reset the host's own scroll position on its own —
  without this, a reader who scrolled down before clicking a link lands
  mid-way or at the bottom of whatever loads next. **This message only does
  something once the host's own JS listens for it and scrolls the iframe
  back into view** (e.g. `iframe.scrollIntoView({block: "start"})` or
  `window.scrollTo` to the iframe's offset) — that listener lives in the
  personalisationhub.com support centre page, outside this repo, and isn't
  wired up yet as of this note.

## Content standard

All content follows `docs/CONTRIBUTING-docs.md`. The September 2026 audit and
rewrite is documented in `docs/faq-audit-2026-09.md`.
