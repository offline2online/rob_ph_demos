# faq — Personalisation Hub Help Centre (public site)

**Retired as a public site (3 Nov 2026).** The Help Centre is now the native
Support Centre on personalisationhub.com (WordPress, `/support-centre/`).
Every `help.personalisationhub.com` URL 301s there from the Firebase Hosting
site `ph-help-centre` (hosting target `help`, `backlog-tracker/firebase.json`):
`/article.html`, `/category.html`, `/search.html` and `/index.html` forward to
the same path under `/support-centre/` (WordPress resolves them, query string
kept), Freshdesk `/support/solutions/articles/<id>…` goes to WordPress's
`faq-art-<id>` handler, and anything else goes to `/support-centre/`.
`/console` still 302s to the admin console. The iframe embed mode, the
height/scroll postMessage and the frame-ancestors CSP are gone. The pages in
this folder no longer render: each `faq/*.html` is `noindex`, has a canonical
link to the Support Centre, loads `js/redirect.js` first (an external script,
as the CSP is `script-src 'self'`) which `location.replace`s to
`https://personalisationhub.com/support-centre/` (+ `article.html`,
`category.html` or `search.html`, query string kept), and shows a plain link
for readers without JavaScript (GitHub Pages cannot send a 301). `data/`
stays exactly as is: WordPress reads it from the repo and faq-export keeps
writing it. Articles are still edited in
the console's FAQ Management; its "Live at" links open the WordPress page.
**Rollback:** redeploy the previous `firebase.json` help block (git revert of
this change) and re-add the CSP header.

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
- The same published content is also served live (no commit) at
  `https://backlog-tracker-e4ed2.web.app/help-api/data/index.json`, `releases.json`
  and `articles/<id>.json` for the WordPress Support Centre sync; a change
  pings that site to re-read it. The hourly export stays the versioned record
  and fallback.
- Bulk content work done in git (like the rewrite) lands in `data/` and the
  same workflow syncs it repo → Firestore on push, without overwriting
  anything edited in the console since the last sync. "Edited" means the
  article's live fields no longer match the `contentHash` the last sync stored
  (`backlog-tracker/scripts/faq-sync-lib.js`), so an article that only has a
  pending revision or retire proposal parked on it still takes a repo change
  (13 Nov 2026: before this, proposing a revision bumped `updatedAt` and every
  later repo fix to that article was skipped as a conflict). A deployment-train
  merge is made with the workflow's own token and fires no push event, so
  `run-backlog-automation.js`'s `finishTrain` dispatches that sync itself
  whenever the train changed `data/` — before this (25 Sep 2026) a content
  ticket's edit sat in the repo until the next hourly export overwrote it
  with Firestore's older copy.
- **Deleting in the console sticks.** Deleting an article (or an empty
  category) in FAQ Management writes a tombstone
  (`faqDeletedArticles/<id>`, `faqDeletedCategories/<id>`) before removing
  the document. `faq-export.js` drops the file on its next run;
  `faq-sync.js` and the Freshdesk seed (`seed-faq-data.js`, which now runs
  only when a deploy is dispatched by hand with its `seed_faq` input
  ticked) never recreate a tombstoned id, even while its file is still in
  `data/`. Before 25 Sep 2026 every pipeline-dispatched deploy re-ran the
  seed and brought deleted articles straight back. Restoring one
  deliberately means removing its tombstone with the service account first.
- A "Notify Claude — Deploy" on the board proposes article updates for the
  tickets merging (`faqArticles.pendingRevision`, scoped to the project's
  product/program); they reach this site only after a person approves them
  in the console's FAQ Management and the ticket is Merged to Main — see
  `backlog-tracker/REQUIREMENTS.md` → "FAQ revision review". Neither
  `faq-export.js` nor this site ever reads `pendingRevision`.

## SEO & agent fields

Each article can carry `seoTitle`, `metaDescription`, `directAnswer`,
`questionVariants` and `articleType` (`guide` | `faq` | `reference`), edited in
the console's article editor ("SEO & agents") and exported into
`faq/data/articles/<id>.json` only when set. The article page shows
`directAnswer` at the top of the article. The WordPress Support Centre publish
step reads the rest from the export. See `backlog-tracker/REQUIREMENTS.md` →
"FAQ revision review".

**Descriptions never cut mid-word (13 Nov 2026).** The Support Centre uses
`metaDescription` as the page's meta and social description, and with none set
it used to cut the summary at 155 characters wherever it fell ("…queu",
"…campai"). Every published article whose summary is longer than 155
characters now has its own `metaDescription` (155 characters or fewer, ending
on a full word). For one that doesn't, the export and the live feed add a
derived `seoDescription` — the summary cut at a word boundary, ending "…"
(`descriptionFromSummary` in `backlog-tracker/functions/faq-feed.js`) — which
the Support Centre reads first. It is never stored in Firestore, and an
editor's `metaDescription` always wins. `backlog-tracker/test/faq-copy.test.js`
checks every published description, and that the retired word "franchise",
client names ("One NZ") and US spellings (optimiz-, personaliz-, "Javascript",
"enroll" other than Google's own "Enroll device" label) stay out of published
copy.

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
