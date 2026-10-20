---
name: ph-build-agent
description: Board rules for any agent building, investigating or commenting on tickets from the PH Agent Console (backlog tracker), on every project. Load at the start of every build run (bound to the build phase). Triggers: "Notify Claude", "build the backlog", "work the ticket", "build run", "pick up tickets", any run that reads backlog items to build them.
---

# Personalisation Hub Build Agent — Board Rules

How to work tickets on the PH Agent Console so builds progress instead of stalling. These rules apply to every project on the board. A project's own README may add to them; it never loosens them.

Why this exists (Rob, 30 Sep 2026): build runs stalled by concluding a document didn't exist after searching only the repo, and by re-investigating tickets that were already decided, parked or waiting on something only Rob can supply. Backlog means "build me", so every stalled ticket got re-run, re-reviewed and re-commented on every run.

## How to use this skill

1. Before touching any ticket, read the project's documents on the board: `get_project_docs(projectId)`, including `docs`. Note which documents exist there.
2. For each ticket, read the description **and every comment**, oldest to newest, before deciding anything.
3. Classify the ticket with the table in §2, then act on that class only.
4. Leave at most one comment per ticket per run, saying what you did or exactly what is needed. Never repeat a comment whose substance is already on the ticket.

## 1. Where things live

- **Board documents are real documents.** Test specs, runbooks, test results, boundary documents, data models and reviews are often board project documents, not repo files.
  - Read: `get_project_docs(projectId, include: ["docs"])`.
  - Change: `update_project_document(docId, contentMd)`. It overwrites the whole document: copy the current text exactly and change only what the ticket asks. The previous version is kept in revision history.
  - **A repo search that finds nothing is not evidence that a document is missing.** Check the board first. Never write "not in this repo" as a reason to stop without having checked the board.
- **Repo and board pairs.** Where a repo document has a board counterpart (e.g. `PH-CORE-BOUNDARIES.md` and "Boundaries with PH Core"), change both in the same ticket.
- **README and REQUIREMENTS** are mirrored from the repo to the board by sync; the repo copy is the source of truth for those two only.

## 2. Classify every ticket before acting

| Signal on the ticket | Class | What to do |
|---|---|---|
| Newest description or comment from Rob starts **DECIDED** | Decided | Build it as written. Do not write another review or re-open the decision. |
| A comment from Rob starts **PARKED** (and no newer comment from Rob un-parks it) | Parked | Skip it entirely. Don't investigate, don't comment. Leave it in Backlog. |
| The ticket is flagged blocked on the board | Blocked | Skip it, unless a newer comment from Rob answers the block. |
| Only a board document needs changing | Doc-only | Edit the document, comment exactly what changed and that no deployment is needed. Don't set `patchReady`. |
| Needs a file that is neither in the repo nor on the board | Waiting on input | Say so once (§3). Don't re-investigate on later runs unless a newer comment says the input is available. |
| Can't be built without a product decision | Needs decision | Ask once (§3), with a recommended default for each question, then stop. |
| Anything else | Buildable | Build it. |

The newest comment from Rob wins over the description and over any earlier agent comment.

## 3. When you can't build

- Comment once, starting **BLOCKED — needs decision:** or **BLOCKED — waiting on input:**, followed by the specific question(s) or the exact input needed, and for a decision a recommended default for each question.
- When the board's blocked flag exists, set it with the same reason instead of relying on the comment prefix.
- On later runs, a ticket whose newest comment is your own BLOCKED comment, with nothing newer from Rob, is skipped.
- Never write a fresh review of the same ticket on each run.

## 4. Docs ship with the code

A ticket that changes behaviour is not done until the documents that describe it are right.

- In the same change as the code, update every affected document: the project's REQUIREMENTS and README (repo files; the board copy follows on merge), additional project documents, and interface contracts.
- Record it on the ticket with one note starting `[docs-impact]`: `Updated: <documents>` or `No doc impact: <reason>`. No behaviour change, or a change no document mentions, still needs the note.
- Review fails a ticket whose code and docs disagree or whose note is missing.

## 5. Do / Don't

**Do**
- Check the board before concluding anything is missing.
- Keep repo and board copies of paired documents in step.
- Update the affected docs in the same change and leave a `[docs-impact]` note (§4).
- Say what you changed, where, and whether it needs a deployment.

**Don't**
- Don't re-review DECIDED tickets or re-open settled decisions.
- Don't touch PARKED tickets.
- Don't repeat a comment already on the ticket.
- Don't set `patchReady` for a board-document-only change.
- Don't set pipeline or approval fields you weren't asked to set.

