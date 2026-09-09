# faq

Consumer-facing FAQ / Help Center — front page + search, category pages,
article pages — styled after
<https://help.personalisationhub.com/support/home>.

A plain static site published via GitHub Pages like everything else at the
repo root, but its content (categories + articles) isn't stored as files
here — it reads live from the **same Firestore project `backlog-tracker`
uses** (`backlog-tracker-e4ed2`, collections `faqCategories`/
`faqArticles`). Editing is done entirely from `backlog-tracker`'s own FAQ
Center admin page, not by editing files in this folder.

- `index.html` — front page + search.
- `category.html` — a category's article list.
- `article.html` — a single article.
- `css/`, `js/` — shared styling and the Firestore-reading client code
  (`js/faq-data.js` mirrors `backlog-tracker/public/js/app.js`'s own
  markdown renderer — keep the two in sync if either changes).

Seeded content (`backlog-tracker/scripts/seed-faq-data.js`) is the real
Personalisation Hub Help Center content, imported verbatim from a
Freshdesk export — not placeholder text. See root `CLAUDE.md` → "FAQ /
Help Center" and `backlog-tracker/README.md` → "FAQ / Help Center" for the
full data model and seeding details.
