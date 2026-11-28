---
name: ph-build-agent
description: Board rules for any agent building, investigating or commenting on tickets from the PH Agent Console (backlog tracker), on every project. Load at the start of every build run (bound to the build phase). Triggers: "Notify Claude", "Ready for Dev", "build the backlog", "work the ticket", "build run", "pick up tickets", any run that reads backlog items to build them.
---

# Personalisation Hub Build Agent: Board Rules

How to work tickets on the PH Agent Console so builds progress instead of stalling. These rules apply to every project on the board. A project's own README may add to them; it never loosens them.

Why this exists (Rob, 30 Sep 2026): build runs stalled by concluding a document didn't exist after searching only the repo, and by re-investigating tickets that were already decided, parked or waiting on something only a person can supply. Backlog means "build me", so every stalled ticket got re-run, re-reviewed and re-commented on every run.

In this skill "a person" means a console member commenting as themselves, not an agent and not the automation.

## How to use this skill

1. Before touching any ticket, read the project's documents on the board. Start with its start-here document if it has one (`startHereDocId` from `list_projects`, then `get_project_document`), then `list_project_documents` or `get_project_docs(projectId, include: ["docs"])`. Note which documents exist there.
2. For each ticket, read the description **and every comment**, oldest to newest, before deciding anything.
3. Classify the ticket with the table in section 2, then act on that class only.
4. Leave at most one comment per ticket per run, saying what you did or exactly what is needed. Never repeat a comment whose substance is already on the ticket.

A session fired by the board's Routine has no MCP connection and reads and writes the same things through the board API, as `ROUTINE_INSTRUCTIONS.md` sets out. The rules here are the same either way.

## 1. Where things live

- **Board documents are real documents.** Test specs, runbooks, test results, boundary documents, data models and reviews are often board project documents, not repo files.
  - Read: `get_project_document`, or `get_project_docs(projectId, include: ["docs"])` for all of them.
  - Change: `update_project_document(docId, contentMd)`. It overwrites the whole document (20,000 characters at most): copy the current text exactly and change only what the ticket asks. The previous version is kept in revision history.
  - **A repo search that finds nothing is not evidence that a document is missing.** Check the board first. Never write "not in this repo" as a reason to stop without having checked the board.
- **Repo and board pairs.** Where a repo document has a board counterpart (for example `PH-CORE-BOUNDARIES.md` and "Boundaries with PH Core"), change both in the same ticket.
- **Copies of repo files are read-only on the board.** README, REQUIREMENTS and any document mirrored from a repo file follow the repo: edit the repo file in your change and the board copy follows on merge. Do not edit the board copy.

## 2. Classify every ticket before acting

| Signal on the ticket | Class | What to do |
|---|---|---|
| Newest description or comment from a person starts **DECIDED** | Decided | Build it as written. Do not write another review or re-open the decision. |
| A comment from a person starts **PARKED** (and no newer comment from a person un-parks it) | Parked | Skip it entirely. Don't investigate, don't comment. Leave it in Backlog. |
| The ticket is flagged blocked on the board | Blocked | Skip it, unless a newer comment from a person answers the block. |
| The ticket needs the advanced model and this session is not running on it | Wrong model | Don't build it on a lesser model. Leave it for a run on the right model and say so once. |
| Only a board document needs changing | Doc-only | Edit the document, comment exactly what changed and that no deployment is needed. Don't set `patchReady`. |
| Needs a file or a tool that is neither in the repo, on the board nor reachable from this session | Waiting on input | Flag it once (section 3). Don't re-investigate on later runs unless a newer comment says the input is available. |
| Can't be built without a product decision | Needs decision | Ask once (section 3), with a recommended default for each question, then stop. |
| Anything else | Buildable | Build it. |

The newest comment from a person wins over the description and over any earlier agent comment.

**Thin tickets.** Only a missing or thin Outcome stops a build. A Test steps, Dependencies or Spec reference section left as a placeholder is yours to fill in from the code and the spec before you build (see `ph-ticket-intake`). Never invent an Outcome.

## 3. When you can't build

- Flag the ticket with `set_blocked`: reason `needs-decision` or `waiting-on-input`, and a one-line note (200 characters at most) naming what is needed. Blocked tickets are skipped by later runs automatically, and the flag clears when a person answers.
- Put the detail in one comment: the specific question or the exact input needed, and for a decision a recommended default for each question.
- On later runs, a ticket still flagged with nothing newer from a person is skipped. Never write a fresh review of the same ticket on each run.
- If the run lists tools the project requires and this session cannot reach one, flag it as the run instructs and stop. Do not work around a missing tool by guessing at what it would have returned.

## 4. Build what the ticket says

- Build the Outcome, and make every Test step pass. The review acceptance-tests each ticket against its own Outcome and Test steps.
- A change that renders anything (a page, screen, component, form or table) is built against `ph-designer`, read before you write markup. Build only what the prototype or spec shows.
- Stay inside the ticket. A fix you notice in passing goes into a new Backlog ticket, not into this change.

## 5. Docs ship with the code

A ticket that changes behaviour is not done until the documents that describe it are right.

- In the same change as the code, update every affected document: the project's REQUIREMENTS and README (repo files; the board copy follows on merge), additional project documents, and interface contracts.
- Record it on the ticket with one note starting `[docs-impact]`: `Updated: <documents>` or `No doc impact: <reason>`. No behaviour change, or a change no document mentions, still needs the note.
- Review fails a ticket whose code and docs disagree or whose note is missing.

## 6. Do / Don't

**Do**
- Check the board before concluding anything is missing.
- Keep repo and board copies of paired documents in step.
- Update the affected docs in the same change and leave a `[docs-impact]` note (section 5).
- Say what you changed, where, how it was tested, and whether it needs a deployment.
- Report a genuine, specific gap in a governing skill with `report_skill_miss`.

**Don't**
- Don't re-review DECIDED tickets or re-open settled decisions.
- Don't touch PARKED tickets.
- Don't repeat a comment already on the ticket.
- Don't set `patchReady` for a board-document-only change.
- Don't set pipeline, approval or deployment fields you weren't asked to set.
- Don't build an advanced-model ticket on a lesser model.
- Don't change another member's agent ticket. You can read it and comment on it.
