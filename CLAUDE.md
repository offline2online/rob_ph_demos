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

**Every card moved to "Ready for Testing" needs a `testUrl`** set to the live page the fix actually lives on (e.g. the GitHub Pages URL for `menu-board-demo/hq-admin.html`, `retail-admin.html`, or `menu-board.html`) — the board shows a quick-launch icon at the top of the card for it, so a tester can jump straight into testing instead of hunting down the right URL first.

## Guidelines

- Always push to `main` branch
- Commit messages should be short and descriptive (e.g., "Add contact page", "Update hero image")
- No build step required — files are served as-is
- Keep assets organized (e.g., `css/`, `js/`, `images/` subdirectories)
