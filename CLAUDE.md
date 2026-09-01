# rob_ph_demos

## Project Overview

This is a static site repository used to publish HTML and static resources (CSS, JS, images, etc.) to the internet via GitHub.

- **Remote**: git@github.com:offline2online/rob_ph_demos.git
- **Branch**: `main` (default publishing branch)
- **Purpose**: Upload static files and push to GitHub for hosting

## Repository Structure

- `index.html` — Main entry point
- Static assets (CSS, JS, images) go directly in the repo root or organized subdirectories

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

The prototype backlog ("Prototype Pipeline") is tracked as a Claude Artifact board, not a file in this repo:
https://claude.ai/code/artifact/0573d999-a32a-499f-bc2f-d10ba7b494a4

Columns: Backlog → Ready for Testing → Ready to Publish → Published Live. New feature/bug requests land in Backlog; once a card is moved to "Ready for Testing" with an approval, push the change and mark it "Published Live". Read this artifact (via the Artifact tool, `action: "read"`) to check current backlog items before starting prototype work.

**Always keep the board in sync with reality** — every time work on a card actually changes state (a fix is ready to test, a push lands on `main`, an investigation turns up a finding, feedback comes in), read the artifact fresh and republish it with that card updated before ending the turn. Never leave a card sitting one step behind what's actually true in the repo.

**Every card moved to "Ready for Testing" needs a `testUrl`** — the board shows a quick-launch icon at the top of the card for it, so a tester can jump straight into testing instead of hunting down the right URL first. While a card sits in this column the fix is, by definition, not on `main` yet, so `testUrl` must point at a preview of the *feature branch*, never the published `offline2online.github.io` site (that's still serving the old code) — use `https://raw.githack.com/offline2online/rob_ph_demos/<branch>/<path>` (e.g. `.../claude/prototype-backlog-review-oruk9v/menu-board-demo/hq-admin.html`), which proxies a specific branch's file with a real `text/html` content-type so it actually renders. Only once the card moves to "Published Live" does the equivalent `offline2online.github.io` URL become the right one to reference (though by then the card no longer shows the icon at all).

### "Notify Claude" — how it actually works

The Backlog column header has a **Notify Claude** button (visible only once Backlog has ≥1 card). Clicking it sets a top-level `notifyClaudeRequestedAt` timestamp on the board state and republishes — the button then shows a disabled "Claude notified" state until it's cleared.

**Important limitation, confirmed directly:** this platform does not support waking a remote Claude Code session on artifact republish, and an attempt to stand up a recurring scheduled check-in (a Routine polling the board) to substitute for that was blocked by the permission system as a standing autonomous action. So neither pressing the button nor moving a card to "Ready to Publish" pushes a live notification into any Claude session — **there is no automatic wake-up**. Per the user's explicit choice, this is intentionally a manual-ping model: the button is a visible "queued for Claude" signal on the board, and the user separately tells Claude in chat when to act. Do not re-attempt an automatic wake/poll mechanism unless the user asks again.

When told (in chat) to check the board, read it fresh and:
1. If `notifyClaudeRequestedAt` is newer than `notifyClaudeHandledAt` (or the latter is unset): work through every card in Backlog the same way as any other backlog sweep (investigate/fix, commit + push to the feature branch, add a Claude note, set `testUrl`, move to "Ready for Testing"), then set `notifyClaudeHandledAt` to now and republish.
2. Independently: if "Ready for Testing" is empty AND "Ready to Publish" has one or more cards, that itself is the trigger to run the publish workflow for all of them — no further "please publish" confirmation is required per card, since moving a card to "Ready to Publish" (via the board's own "Ready to publish" approval button) already is the user's explicit approval. Fast-forward push each one's already-committed fix to `main`, mark it "Published Live" with a `claudeNote`, and republish the board.

## Guidelines

- Always push to `main` branch
- Commit messages should be short and descriptive (e.g., "Add contact page", "Update hero image")
- No build step required — files are served as-is
- Keep assets organized (e.g., `css/`, `js/`, `images/` subdirectories)
