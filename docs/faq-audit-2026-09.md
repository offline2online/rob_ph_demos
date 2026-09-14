---
title: Help Centre audit and rewrite — September 2026
description: What was found in the FAQ site and its content, what changed, and what still needs a human to verify.
status: Delivered 14 September 2026
---

# Help Centre audit and rewrite — September 2026

Scope: the public FAQ / Help Centre at `faq/` (edited from the Agent Console's FAQ Management page), reviewed against the live Freshdesk help centre, the Personalisation Hub YouTube how-to videos, and the HQ Admin / Retail Admin demo tenant. Every article was rewritten to the format already used for the Platform Installation articles (`docs/CONTRIBUTING-docs.md`), missing articles were added, the categories were reordered into the sequence a new customer works through, and the site itself was hardened and sped up.

## 1. Findings

### Content

| # | Finding | Severity | Resolution |
|---|---|---|---|
| C1 | 104 of 109 articles were the raw Freshdesk export: single run-on paragraphs, steps that ended in "see steps below" because the steps were screenshots or Scribe embeds that never made it into the export. | High | Every article rewritten. Steps recovered from the 30 Scribe walkthroughs behind the live articles, 23 YouTube transcripts, and a screen-by-screen capture of the demo tenant's HQ Admin and Retail Admin (exact labels, routes, fields, defaults). |
| C2 | Titles were shouting prefixes (`SET-UP \| …`, `QUEUEING \| …`, `STEP 3 - …`) that duplicated the category. | Medium | Sentence-case, verb-first titles; the prefix's job is now done by folders inside categories. |
| C3 | Category order was arbitrary (Queue Management first, Getting Started third). | High | 12 categories in new-customer order (see §2). Home page tiles are numbered; category and article pages have previous/next in that order. |
| C4 | Broken link: the installation articles linked to a pre-installation check-list (`faq-art-51000290582`) that did not exist in this site. | High | Article written (reference checklist). |
| C5 | Duplicates: two "register a display" articles (51000491526 / 51000506170); two store-segment and two display-tag articles. | Medium | Merged; superseded ids listed in `faq/data/retired.json` and set to draft by the sync so old links fail closed rather than showing stale text. |
| C6 | No coverage for large parts of the current product: campaign brief/creative/AI generation, insights, campaign prioritisation, activation, company settings, HQ users, CTA settings, AI models and agents, MIST proximity, computer-vision privacy, appointment templates, calendar blocking, special holiday hours, queue history, queue settings, glossary, security posture, support. | High | 34 new articles (140 total, 139 published + 1 draft stub for the empty AEM Screens article). |
| C7 | Getting Started had only a 200-word executive summary and a use-case list. | High | New "About Personalisation Hub" with benefits by feature, "Benefits by industry" (retail & consumer electronics, retail media networks, telco, banking & financial services, hospitality & QSR, grocery/pharmacy, airports & venues, automotive), "Your first 30 days" set-up tutorial, security & data explanation, support and free-trial FAQs. |
| C8 | 10 draft articles (3rd-party guides etc.) were invisible and mostly still valid. | Low | Rewritten and published (except the empty AEM stub). |
| C9 | Mixed US/UK spelling and banned words (simply, just, please…). | Low | House lint (`personalisation` with an S everywhere, Australian English, banned-word list) — 0 findings across all 140 articles. |

### Security

| # | Finding | Severity | Resolution |
|---|---|---|---|
| S1 | `faqArticles` and `faqCategories` were world-writable and deletable — anyone with the project id (in the site's source) could deface or wipe the public help centre. | Critical | `backlog-tracker/firestore.rules`: writes require a signed-in Google account with a verified email on the editor allowlist (`isFaqEditor`); field validation and size limits tightened. Console gained a "Sign in with Google" bar on the FAQ pages; every save, reorder, publish toggle and delete goes through `requireFaqEditor()`. **One-time step for you:** enable the Google provider under Authentication → Sign-in method in the Firebase console for `backlog-tracker-e4ed2`, and adjust the allowlist emails in the rules if needed. |
| S2 | Article HTML rendered from an open store; DOMPurify loaded from a third-party CDN, pinned to 3.0.6, no integrity hash. | High | DOMPurify 3.4.15 vendored locally; sanitised on every render with an explicit iframe host allowlist (YouTube/Vimeo only), `rel="noopener noreferrer"` forced on external links, `style`/form/object/svg forbidden. |
| S3 | Inline scripts and no Content-Security-Policy. | Medium | All page logic moved to external modules; CSP `<meta>` restricts scripts to same origin, connections to Firestore only, frames to the video hosts. |
| S4 | `id` and `q` query parameters used unvalidated. | Medium | Ids validated against `^[A-Za-z0-9_-]{1,120}$`; query capped at 200 chars; everything rendered through `escapeHTML` or `textContent`. |
| S5 | GitHub Pages cannot send `frame-ancestors` / `X-Frame-Options`. | Info | Documented in `faq/README.md`; if embedding must be restricted to personalisationhub.com, front the site with a proxy/CDN that adds the header. |

### Performance and stability

| # | Finding | Severity | Resolution |
|---|---|---|---|
| P1 | Every page loaded the Firebase JS SDK (~300 KB) and ran 4 Firestore queries (page + search box each fetched all categories and all articles, bodies included). | High | No SDK. One cached request for `data/index.json` (85 KB, ~20 KB gzipped) shared by page and search via a memoised promise + 5-minute sessionStorage cache; one request for the article body being read. |
| P2 | Material Symbols variable font (~400 KB) loaded on every page for a dozen icons. | Medium | Inline SVG icons (`js/icons.js`, 9 KB). |
| P3 | If Firestore was slow or unreachable the site showed "Loading…" forever. | High | Static snapshot on the GitHub Pages CDN is the primary source; Firestore is only consulted in the background for a newer article revision, with a 2.5 s timeout. Explicit error states replace the infinite spinner. |
| P4 | Search matched substrings on a single term with no ranking. | Low | Multi-term scoring (title > keywords > summary), keyboard navigation, ARIA combobox. |
| P5 | No table of contents, no previous/next, no "last updated". | Low | Added on article pages; folders rendered as sections on category pages. |

## 2. New information architecture

| Order | Category | Articles | Folders |
|---|---|---|---|
| 1 | Getting Started | 9 | — |
| 2 | Platform Installation | 14 | Install the platform · AWS deployment reference |
| 3 | Company Set-up & Users | 9 | — |
| 4 | Stores & Retail Data | 12 | HQ Admin · Retail Admin (staff tablet) |
| 5 | Displays & Devices | 17 | Set up displays · Monitor and manage displays · Active integrations on a display |
| 6 | Digital Signage & Campaigns | 14 | Create and run campaigns · Localise campaigns |
| 7 | Personalisation & AI | 13 | — |
| 8 | Mobile Store Sites | 11 | — |
| 9 | Queue Management | 24 | Set up queueing · Staff profile · Managing the queue · Store managers |
| 10 | Appointment Bookings | 5 | — |
| 11 | Integrations & 3rd Party Guides | 8 | — |
| 12 | Troubleshooting | 4 | — |

Document types: 106 how-to, 12 reference, 12 explanation, 10 FAQ. Every how-to has Before you begin → Steps → Verify it worked → Related, and journey articles chain with a Next step link.

## 3. How content is published now

1. **Authoring in git** (this rewrite): `faq/data/` is the snapshot the site serves. On push to `main` the `FAQ content` workflow runs `faq-sync.js`, which upserts it into Firestore without overwriting anything edited in the console since the last sync.
2. **Editing in the console**: saves go to Firestore as before (now sign-in gated). The article page shows a newer revision immediately (REST freshness check); the hourly export (`faq-export.js`) commits the change into `faq/data/` so the index, search and category pages follow. Run it on demand from Actions → FAQ content → Run workflow.
3. **Deploy**: pushing this change to `main` triggers the existing backlog-tracker deploy (rules + console) and GitHub Pages (site).

## 4. What still needs a human

- **Enable Google sign-in** in the Firebase console (S1) before the first console edit after deploy — otherwise saves fail with permission-denied. Confirm the allowlisted emails in `backlog-tracker/firestore.rules`.
- **Verify the 107 `TODO(verify)` items** — labels or behaviours that no source confirmed (mostly dialog field labels that were not opened on the demo tenant, and a few behaviours such as how calendar blocks scope per store). They are stripped from the public HTML and listed in `docs/faq-audit-2026-09-todos.md`. None blocks publishing; each is phrased so the surrounding text stands without it.
- **Retire Freshdesk** when ready: point `help.personalisationhub.com` at GitHub Pages (CNAME) and add the iframe on personalisationhub.com (`<iframe src="…/faq/">`; the page posts `ph-faq:height` messages for auto-sizing).
- **Screenshots** were deliberately not added (standard §5.6). If any procedure turns out to need one, add it in the console editor with alt text.
- **Not covered**: articles for the Insights/Analytics dashboards beyond campaign performance, and the AEM Screens player install (empty source; left as a draft stub).
