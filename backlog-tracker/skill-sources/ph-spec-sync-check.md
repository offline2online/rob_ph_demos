---
name: ph-spec-sync-check
description: Deploy-phase drift check. After a train is verified for Deploy to Main, compare the deployed changes with the project's spec and documents and file a Backlog ticket for each gap. Never edits documents. Trigger on: "Notify Claude — Deploy", "spec sync", "docs drift".
---

# Spec sync check (deploy phase)

Lightweight and read-only. It exists because build and review can miss a doc gap; this is the last net.

1. Read the combined train diff (`git diff main...origin/<deployBranch>`) once.
2. Read the project's documents: REQUIREMENTS, README, additional project documents (`get_project_docs`), interface contracts touching the project.
3. A gap is: behaviour the diff changes that a document still describes the old way, or behaviour it adds that no document mentions. Ignore pure refactors, tests and wording.
4. For each distinct gap, file ONE Backlog ticket: title `Docs drift: <document> — <gap>`, an `## Outcome` naming the document, the diff lines and the ticket ids that caused it. Skip a gap an open ticket already covers.
5. Docs in sync: file nothing.

Never rewrite a document, change a status, or block the merge. Report tickets filed (or "in sync") in the deploy summary.

Bind it with `settings/phaseSkillBindings.deploy = ["ph-spec-sync-check"]` (admin write).
