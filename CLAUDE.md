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

## Guidelines

- Always push to `main` branch
- Commit messages should be short and descriptive (e.g., "Add contact page", "Update hero image")
- No build step required — files are served as-is
- Keep assets organized (e.g., `css/`, `js/`, `images/` subdirectories)
