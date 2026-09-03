# rob_ph_demos

## Project Overview

This is a static site repository used to publish HTML and static resources (CSS, JS, images, etc.) to the internet via GitHub.

- **Remote**: git@github.com:offline2online/rob_ph_demos.git
- **Branch**: `main` (default publishing branch)
- **Purpose**: Upload static files and push to GitHub for hosting

## Repository Structure

- `index.html` — Main entry point
- Static assets (CSS, JS, images) go directly in the repo root or organized subdirectories

## Cloud Functions need a separate manual deploy

`menu-board-demo/functions/` (Cloud Functions for Firebase — the scheduled offer-expiry sweep, the AI provider calls) is **not** part of the static site. Pushing a change there to `main` does **not** make it live — GitHub Pages only serves the static HTML/JS/CSS, and this sandbox has no `firebase` CLI or deploy credentials, so **Claude cannot deploy a functions change itself**. Whoever owns Firebase deploy access needs to separately run `firebase deploy --only functions` (or `npm run deploy` inside `menu-board-demo/functions`) before a functions fix actually takes effect. Always say this explicitly when committing a functions/ change — don't imply "pushed to main" means "live" the way it does for everything else in this repo.

## Common Workflows

### Publish changes
Use the `/publish` skill to stage all changes, commit with a message, and push to `main`:
```
/publish
```

### Manual git flow
```bash
git add .
git commit -m "your message"
git push origin main
```

## Prototype Backlog

The prototype backlog is tracked as a Claude Artifact board, not a file in this repo:
https://claude.ai/code/artifact/0573d999-a32a-499f-bc2f-d10ba7b494a4

**The board is multi-project** — it's no longer a single fixed "Prototype Pipeline". `STATE.projects[]` holds one or more independent projects, each with its own full pipeline (Backlog → Ready for Testing → Live on Feature Branch → Merged to Main (Live) → its own Archive), rendered as a collapsible section on the same page. The original board was renamed **"Products and Pricing"** (its `id` is `products-and-pricing`) and holds all the pre-existing cards; a client can have several concurrent prototypes/projects tracked side by side.

- **Adding a project**: the page-level "New project" button opens a name-entry modal and creates a new, empty project with the identical pipeline — its own Backlog/Testing/Live-on-branch/Merged columns and its own Archive.
- **Renaming a project**: the pencil icon next to a project's name (`.project-rename-btn`) turns it into an inline text input — commits on Enter/blur, cancels on Escape. Not a one-time setup step; any project can be renamed at any time.
- **Collapsing a project**: the chevron button on a project's header toggles its body closed, so a client managing several prototypes can collapse the ones they aren't focused on. This is a per-viewer display preference kept in `sessionStorage`, not published `STATE` — collapsing doesn't trigger a republish or affect what other viewers see.
- **Card ids stay globally unique** across all projects, so a card's own status/category/notes are still edited by id alone without needing to know which project it's in. Only creating a card (`addCard`) and opening a project's own Archive page need an explicit project id.
- Old flat single-board saves (`STATE.cards`, no `STATE.projects`) are migrated automatically on load into the "Products and Pricing" project — nothing needs manual conversion.

Within each project, the columns are: **Backlog → Ready for Testing → Live on Feature Branch → Merged to Main (Live)**. The last two column *labels* changed (their underlying status keys, `ready-to-publish` and `published-live`, did not) specifically to make the git-merge step unambiguous: a card only reaches "Live on Feature Branch" once it's been tested and is genuinely working on the branch, and it does **not** move itself into "Merged to Main (Live)" — that transition has its own distinct green **"Merge to main"** button on the card (separate from the blue "Confirm live on branch" button that moves a card out of Ready for Testing), so the person driving the board always has one deliberate, clearly-labelled click that corresponds to the actual `git merge`/fast-forward push to `main`, never an implicit "next column" click. New feature/bug requests land in a project's Backlog; once a card is moved to "Ready for Testing" with an approval and then confirmed "Live on Feature Branch", push the change and mark it "Merged to Main (Live)" (clicking that card's own "Merge to main" button). Read this artifact (via the Artifact tool, `action: "read"`) to check current backlog items — across every project — before starting prototype work.

**Always keep the board in sync with reality** — every time work on a card actually changes state (a fix is ready to test, a push lands on `main`, an investigation turns up a finding, feedback comes in), read the artifact fresh and republish it with that card updated before ending the turn. Never leave a card sitting one step behind what's actually true in the repo.

**Every card moved to "Ready for Testing" needs a `testUrl`** — the board shows a quick-launch icon at the top of the card for it, so a tester can jump straight into testing instead of hunting down the right URL first. While a card sits in this column, or in "Live on Feature Branch" after it, the fix is, by definition, not on `main` yet, so `testUrl` must point at a preview of the *feature branch*, never the published `offline2online.github.io` site (that's still serving the old code) — use `https://raw.githack.com/offline2online/rob_ph_demos/<branch>/<path>` (e.g. `.../claude/prototype-backlog-review-oruk9v/menu-board-demo/hq-admin.html`), which proxies a specific branch's file with a real `text/html` content-type so it actually renders. Only once the card is clicked through to "Merged to Main (Live)" does the equivalent `offline2online.github.io` URL become the right one to reference (though by then the card no longer shows the icon at all).

### "Notify Claude" — how it actually works

Each project's Backlog column header has its own **Notify Claude** button (visible only once that project's Backlog has ≥1 card). Clicking it sets `notifyClaudeRequestedAt` on that **project** (`STATE.projects[i].notifyClaudeRequestedAt` — this moved off the top-level `STATE` object when the board went multi-project) and republishes — the button then shows a disabled "Claude notified" state until it's cleared.

**Important limitation, confirmed directly:** this platform does not support waking a remote Claude Code session on artifact republish, and an attempt to stand up a recurring scheduled check-in (a Routine polling the board) to substitute for that was blocked by the permission system as a standing autonomous action. So neither pressing the button nor moving a card to "Ready to Publish" pushes a live notification into any Claude session — **there is no automatic wake-up**. Per the user's explicit choice, this is intentionally a manual-ping model: the button is a visible "queued for Claude" signal on the board, and the user separately tells Claude in chat when to act. Do not re-attempt an automatic wake/poll mechanism unless the user asks again.

When told (in chat) to check the board, read it fresh and, **for every project in `STATE.projects[]`**:
1. If that project's `notifyClaudeRequestedAt` is newer than its `notifyClaudeHandledAt` (or the latter is unset): work through every card in that project's Backlog the same way as any other backlog sweep (investigate/fix, commit + push to the feature branch, add a Claude note, set `testUrl`, move to "Ready for Testing"), then set that project's `notifyClaudeHandledAt` to now and republish.
2. Independently, per project: if that project's "Ready for Testing" is empty AND its "Live on Feature Branch" has one or more cards, that itself is the trigger to run the publish workflow for all of them — no further "please publish" confirmation is required per card, since a card reaching "Live on Feature Branch" (via the board's own "Confirm live on branch" approval button) already is the user's explicit approval to test it there; clicking a card's own "Merge to main" button is what then represents the actual `git merge`/fast-forward push. Fast-forward push each one's already-committed fix to `main`, mark it "Merged to Main (Live)" with a `claudeNote`, and republish the board.

### GitHub commit badge on Merged to Main (Live) cards

Every "Merged to Main (Live)" card shows a clickable commit badge at the top linking to `https://github.com/offline2online/rob_ph_demos/commit/<sha>`. The board doesn't store a structured commit field for this — it parses the sha straight out of the card's own `claudeNote` text with a regex looking for `main as [commit ]<sha>`. **This means the existing `claudeNote` phrasing convention ("Pushed to main as commit `<sha>`. Live now." / "...cherry-picked commit `<x>` onto main as `<sha>`...") is now load-bearing for the UI, not just descriptive text** — always phrase a Merged to Main (Live) `claudeNote` that way (the sha that's actually live on `main`, not an intermediate branch commit) so the badge picks it up correctly.

### Archiving Merged to Main (Live) cards

Merged to Main (Live) cards have an **Archive** action (next to the feedback/delete icons). Archiving sets `status: "archived"` and `archivedAt` — archived cards keep all their data (including the commit link) but stop matching any of the four board columns, so they simply disappear from the board rather than being deleted. Each project's own **Archived (N)** button (in that project's header) opens the same dedicated full-page table (not a modal), scoped to that project's cards only — sortable by clicking a column heading (Type / Area / Ticket / Date) and filterable by area, type, and a free-text search — each row carrying a **Restore** button that sets `status` back to `"published-live"` (the underlying key for "Merged to Main (Live)" — unchanged by the column rename). When asked to archive/restore a card, use these same fields rather than deleting cards outright — deletion (the trash icon) is reserved for Backlog cards only now.

### Every card carries an `category` (area impacted)

Every card — New Item form included — has a `category` field, one of a fixed set (`CATEGORIES` in the board's own JS): `Pricing & Offers`, `Product Assets`, `HQ Admin`, `Retail Admin`, `Menu Board`, `Prototype Pipeline Board`, `Backend / Infrastructure`, `Uncategorised`. It's what the Archived page's Area column, filter, and colour-coded badge are keyed on — the "quick snapshot by area" only works if this field is kept accurate.

- **A brand-new ticket gets a best-effort guess, not a final answer.** The New Item form runs a keyword heuristic (`suggestCategory()`, same spirit as the existing Feature/Bug guess) live as the description is typed or dictated, pre-selecting the Area dropdown — but it's just a starting point, same as the Feature/Bug toggle.
- **The real classification is a step in every backlog sweep, not optional.** When investigating/fixing a Backlog card (the standard "investigate/fix, commit + push, add a Claude note, set `testUrl`, move to Ready for Testing" workflow above), also set `category` to whatever the ticket actually turned out to be about, based on the real analysis — correcting the initial guess if it was off, or filling it in if it was still `Uncategorised`. This is the "automated once analysed" classification: automated in the sense that it's now a mandatory, unskippable part of the same workflow pass, not a separate manual step someone has to remember.
- The category can also be changed directly from the small select on any card (any column, not just Backlog) — use this to correct a stale/wrong area on an existing card rather than leaving it wrong.

### Mic dictation (New Item / Feedback forms)

The mic button now explicitly requests microphone permission (`getUserMedia`) before starting Web Speech dictation, and surfaces a specific, visible error message (blocked permission, no device, no browser support, network needed, etc.) instead of silently doing nothing when dictation can't start — this couldn't be verified end-to-end from this sandbox (no live network path to the browser's speech-recognition backend, and no real microphone hardware), so if a user still reports the mic doing nothing, ask what error text now appears rather than assuming it's still silent. The New Item and Feedback textareas also auto-grow to fit what's been typed or dictated (capped near half the viewport, with the modal itself scrolling beyond that), so captured speech stays visible instead of scrolling inside a fixed-height box.

## These prototypes run iframed inside the real Personalisation Hub platform

`hq-admin.html` and `retail-admin.html` are not viewed standalone in real use — they're **iframed into the actual Personalisation Hub platform** (confirmed directly by the user; also already documented in-code, e.g. hq-admin.html's own comments about "the parent platform's own sidebar" and the mic-permission-inside-iframe backlog item). This means:

- **A screenshot of either page in real use will show the real platform's own chrome around our content** — its branded top bar/logo, its left-hand icon sidebar, its own breadcrumbs (e.g. "Retail Admin / Menu Boards"). That outer chrome is the platform's, not this repo's, and seeing it is normal — **it is not a sign the user is looking at the wrong system or a different codebase.** Don't ask "is this our prototype or the real platform?" — assume iframe chrome and move on to the actual content/bug.
- **The reverse can also be true**: some screens the user screenshots (e.g. a card-style "Menu Boards" list with items/price/category, RRP shown as a plain secondary line rather than a struck-through price) may be a **native page of the real platform itself**, not our iframed content at all — e.g. nothing in this repo renders price as a stacked "RRP £X" label the way one such screen did. If a screenshot's content/layout doesn't match anything `grep`-able in this repo (page title, exact copy, that specific price/badge presentation), say so plainly rather than continuing to hunt for the bug in this codebase — it may need fixing on the platform side, outside this repo's reach.
- When debugging a visual report, check which case applies: platform chrome around our real content (debug here) vs. a platform-native screen that merely happens to show the same product data (out of scope here).
- **It's a mix, confirmed directly (1 Sep 2026) — check per screen, don't assume either way for HQ/Retail Admin pricing:**
  - `hq-admin.html`'s own **Products & Pricing list/grid** (`offline2online.github.io/rob_ph_demos/menu-board-demo/hq-admin.html`) is confirmed genuinely this repo's own code, live and in real use — verified directly against a screenshot of that exact GitHub Pages URL showing the grid's real "Local offer"/"Targeted" pills, which only exist in this repo's code.
  - But the **per-product detail editor** you reach by clicking into a product (tabs: Product Assets / Product Details / Pricing / Stockists) is the real Personalisation Hub platform's own native page, NOT this repo's `product-app`/React pricing tab — its copy ("Badge for External Displays" targeting, a concept that doesn't exist anywhere in this repo) and layout don't match. Don't assume clicking through from the grid stays in this repo's code.
  - The store-level "Menu Boards" list (branded PersonalisationHub chrome, card-style rows, RRP shown as a plain secondary line) has similarly been confirmed as platform-native, not this repo's `retail-admin.html`.
  - **hq-admin.html's grid deliberately shows only HQ's own RRP/offer in its Price column, never a store's override** — a "Local offer ×N" pill flags that a store-level price exists (click it to jump to the per-product pricing page) without picking one store's price to display in an aggregate, all-stores view. That's intentional design, not a bug — don't try to make this specific grid show the discounted local price inline.
  - Bottom line: verify per-screen against copy/markup you can `grep` in this repo before deciding whether a pricing bug is fixable here or belongs to the real platform.

## Guidelines

- Always push to `main` branch
- Commit messages should be short and descriptive (e.g., "Add contact page", "Update hero image")
- No build step required — files are served as-is
- Keep assets organized (e.g., `css/`, `js/`, `images/` subdirectories)
