# Staff Kanban — Requirements

**Project:** Kanban Staff Board (PH Agent Console), promoted from concept
`vmhUoPiogxiJq1YmtJph` ("Kanban — Staff Task Board (Jira replacement)").
**Repo folder:** `kanban-staff-board/`. **Status (21 Oct 2026):** clickable,
front-end-only prototype in `prototype/` covers every requirement below; the
production build inside the PH Agent Console (`backlog-tracker/`) has not
started. This file is the spec for that build; `prototype/` is the reference
behaviour, and `docs/E2E-TEST-PLAN.md` is how both are verified.

Requirement IDs (`KB-…`) are referenced by the test plan, the automated suite
(`test/e2e.test.mjs`) and the build tickets. Each lists its acceptance
criteria (AC).

---

## 1. Purpose and scope

An internal, **human** task board that replaces the cancelled Jira
subscription. It lives in the PH Agent Console beside, and clearly separate
from, the Agent Board (which tracks agent-built tickets through the
deployment train). Staff create, assign, move and report on their own work;
every action is also available to their AI agent over MCP.

**Principles:** very simple; mirror established Jira practice rather than
invent new models; match the console's look and feel exactly (the
`ph-designer` skill, the console's own `styles.css` / `apple.css`, Material
Symbols Outlined); spell "personalisation" with an S; helper text in (i)
tooltips, never as copy under charts or tables.

**Out of scope for the first release:** sprints planning boards (sprint is a
field and a filter only), time-tracking timers, custom workflows/columns,
external (non-member) users.

## 2. Users and roles

| Role | Source | Can |
|---|---|---|
| Member (editor) | `consoleUsers/{email}`, role `editor` | create, edit, move, comment on any task; upload their own photo |
| Admin | role `admin` | everything a member can, plus Kanban settings and other people's photos |
| Viewer | role `viewer` | read the board and report only |
| Tester | `kanbanSettings.tester` (default Rob) | receives every task moved to Ready for Testing |

People are shown by **first name** everywhere (from `consoleUsers.displayName`,
first word), with their profile photo or initial.

## 3. Navigation and shell

**KB-NAV-1** The console sidebar lists **Agent Board** and **Staff Kanban** as
separate entries under Build; the page heading and browser title read "Staff
Kanban". AC: both entries present; the active one is highlighted; the phone
tab bar has a Staff Kanban tab.

**KB-NAV-2** The Staff Kanban page header holds the title, task count, search
box, **Release report**, **+ New task** and a settings cog (no ⋮ menu). AC: the
cog opens Kanban settings; Release report opens the report for the board's
selected release.

## 4. Board

**KB-BOARD-1 Columns.** Backlog → Ready for Dev → In Progress → Ready for
Testing → Approved for Deployment → Completed / Withdrawn. AC: six columns in
that order; each header shows the count and remaining effort (estimate minus
logged, never below zero; `1d = 8h`).

**KB-BOARD-2 Completed / Withdrawn.** The last column holds two resolutions
with separate counts: **Completed** and **Withdrawn**. AC: the header shows
both counts; inside the column each has its own section and drop zone;
withdrawn cards are greyed with the title struck through; the Status menu
lists Completed and Withdrawn separately.

**KB-BOARD-3 Drag and drop.** Cards move by drag and drop with a mouse, and by
press-and-hold (about 250 ms) then drag on touch. AC: a drop marker shows the
insertion point; order within a column is kept (rank); a plain tap opens the
task; the page scrolls when dragging near an edge.

**KB-BOARD-4 Closing targets.** While any card is dragged, the Completed /
Withdrawn column's cards hide and two large drop targets fill the visible
height over that column: Completed (three quarters) and Withdrawn (one
quarter), each with icon, label and count. On a phone they sit full width
above the tab bar. AC: targets appear only while dragging; dropping sets
status `done` with the matching resolution.

**KB-BOARD-5 Testing hand-off.** Moving a task into Ready for Testing
reassigns it to the tester and remembers the developer; moving it back to In
Progress or Ready for Dev returns it to that developer. AC: card shows "From
<developer>"; a toast states the reassignment; the activity log records it.

**KB-BOARD-6 Cards.** Show type icon, key (`PH-n`), priority, flag, title,
parent epic (under the title), time-logged progress, remaining estimate or due
date, comment and attachment counts, and the assignee's avatar. Epic cards show
child progress ("2/8 done", withdrawn children excluded).

**KB-BOARD-7 Page scroll and pinned headers.** The board scrolls as one page
(columns have no inner scrollbars). The console topbar scrolls away; the
filter bar and column headers stay pinned at the top. Columns stretch to the
tallest so a card can be dropped anywhere down a column.

**KB-BOARD-8 Phone.** One column per screen as a sideways carousel (swipe,
snap); a pinned strip of column tabs shows and changes the current column.
AC: no horizontal page overflow at 390 px; swipe and tab both change column.

## 5. Filters and swimlanes

**KB-FLT-1 Primary filters** (always visible, pinned): staff avatars (multi-
select, first names, "Unassigned"), **My tasks**, **Release**. **Secondary**
in a **Filters** menu: Flagged only, Type, Priority, Sprint, Label; the button
shows how many secondary filters are on. Search sits in the page header and
matches key, title, description text and labels. **Clear filters** resets all.

**KB-FLT-2 Keep position.** Changing any filter keeps the page's scroll
position (and the phone's current column).

**KB-FLT-3 Desktop fit.** The filter bar stays on one line from 1024 px wide
with the sidebar open, with every filter on.

**KB-LANE-1 Swimlanes.** Selecting one or more staff splits the board into one
lane per selected person (Jira's "swimlanes by assignee"), each with a full-
width header (photo, first name, count, remaining effort) that expands or
collapses its row; Expand all / Collapse all. The header of the lane being
scrolled through is pinned under the column headers. Dragging a card into
another person's lane reassigns it. On a phone every lane shows the current
column and swiping changes it for all lanes.

## 6. Tasks

**KB-TASK-1 Keys.** Every ticket has a key `PH-<n>`, sequential, never reused.

**KB-TASK-2 Types.** Task, Bug, Epic (no Story). An Epic is an ordinary ticket;
once saved it can be chosen as the **Parent epic** of any task or bug.

**KB-TASK-3 Core fields** (always on the form): title, description, reporter,
assignee, status, release (fix version), estimate. **Optional fields** (Jira
equivalents): type, priority, sprint, due date, time logged, labels, comments,
attachments, parent epic, linked tickets, flag. All fields flow into filters
and the release report.

**KB-TASK-4 Flags.** Any ticket can be flagged from its card or its modal;
flagged cards are amber with a filled flag.

**KB-TASK-5 Linked tickets.** Typed links (blocks, is blocked by, relates to,
duplicates) to any other ticket.

**KB-TASK-6 Ticket search picker.** Wherever a ticket is chosen (linked
tickets, adding an existing ticket to an epic) the user types a number (`36`,
`PH-36`) or words from the title or description; results rank exact key, key
prefix, title prefix, title words, description words (with a highlighted
snippet), show at most 50 with a "keep typing" note, and support arrow keys +
Enter. Production: server-side search, so it works with millions of tickets.

**KB-TASK-7 Epics.** An epic's modal lists its children (status, flag,
assignee, remove ×) with **Add task**, **Add bug** and **Add an existing
ticket**. Adding a child saves the epic first (creating a new one), opens the
child with the epic, release, sprint and labels prefilled, and returns to the
epic afterwards. Changing an epic's type or deleting it unlinks its children.

## 7. Create / edit modal

**KB-MOD-1 New task.** Always starts in Backlog (no Status field, no
Comments). The heading and primary button follow the type: **Create task**,
**Raise bug**, **Create epic**. Right-hand details column order: Priority,
Type, Parent epic, Assignee, Reporter, Release, Estimate, Time logged (then
any other shown optional fields; Status last when editing).

**KB-MOD-2 Voice first.** One **Record task** button captures speech (live
transcript, timer, red stop state, keeps listening through pauses until
stopped). On stop, an agent writes the title and description and sets
priority, type, assignee, release, estimate, due date, sprint, labels, parent
epic and flag when mentioned; filled fields are marked "Agent" for checking.
**Fill in the ticket from this description** does the same for typed text.
Clear errors for blocked/missing microphone or unsupported browser.
Production: the transcript is sent to Claude (a console Cloud Function); the
prototype uses a local stand-in (`agentDraft()`).

**KB-MOD-3 Rich text.** Description uses the Help Centre article editor's
toolbar (Quill 1.3.7): headings H1–H4, bold/italic/underline/strike,
alignment, lists, quote, inline code, code block, Note/Important/Warning
callouts, link, image (with alt text), video, tables with row/column controls,
clear formatting. Plus: **@mentions** of staff (notified on save), **URLs that
link themselves**, **screenshots** (upload, paste or drop; downscaled), and
**screen recording** (record button → playable video). Comments use a compact
version of the same editor. Stored HTML is sanitised (DOMPurify) when shown.

**KB-MOD-4 Dictation.** The description (when editing) and the comment box
each have a round 36 px mic that turns into a red stop button while
listening; one recording at a time.

**KB-MOD-5 Layout.** Delete / Cancel / primary button are pinned to the bottom
of the modal. The details column folds away to the right (header button or
"Details" tab) so the description gets the full width; the choice is
remembered and the column reopens if a required field in it is empty.

**KB-MOD-6 Validation.** Required fields (per settings) are marked and
checked on save; estimate and time logged accept `1d 4h`, `6h`, `30m`.

## 8. Release report

**KB-REP-1** Linked from the board; defaults to the current release; every
filter (release, status, staff member, type, priority, sprint, label, epic) is
kept in the URL so a view can be shared. Shows: outstanding tasks (with
completed / withdrawn / flagged counts), remaining effort, time logged,
release date with working days left; remaining effort per staff member against
capacity (6 focused hours per working day); a breakdown table per person with
totals (Completed and Withdrawn as separate columns when shown); the task list
grouped by person. Epics are excluded from effort figures. Explanations live in
(i) tooltips only.

## 9. Settings (admin)

**KB-SET-1** Per optional field: show on the create/edit form, and required.
Core fields always shown (title and status always required). Hidden fields
stay editable on an existing ticket under "N more fields" and over MCP.

**KB-SET-2** Ready for Testing reassignment target; current release; the team
list with photos.

## 10. People and photos

**KB-PPL-1** Assignee lists show every console member by first name.
**KB-PPL-2** Profile photos (shared console feature, ticket
`cQZRViGdvsqJrnNk00GF` on Backlog Tracker & FAQs): uploaded photo, else Google
photo, else initial — used on cards, filters, lanes, comments, mentions and the
report.

## 11. MCP

**KB-MCP-1** Every field is readable and writable over the console's MCP
server, attributed to the calling member: `kanban_list_tasks` (filters as on
the board), `kanban_get_task`, `kanban_create_task`, `kanban_update_task`,
`kanban_move_task` (status + resolution; applies the testing hand-off),
`kanban_assign_task`, `kanban_comment`, `kanban_flag_task`,
`kanban_search_tickets`, `kanban_release_report`. Viewers get read tools only.
Staff can add and move tasks verbally through their agent.

## 12. Data model (production)

| Collection | Shape |
|---|---|
| `kanbanTasks/{key}` | `key`, `number`, `type` (task/bug/epic), `title`, `descriptionHtml`, `descriptionText`, `status`, `resolution` (completed/withdrawn when status = done), `rank`, `assigneeEmail`, `previousAssigneeEmail`, `reporterEmail`, `releaseId` (console `releases`), `sprintId`, `estimateHours`, `loggedHours`, `priority`, `dueDate`, `labels[]`, `epicKey`, `links[] {type,key}`, `flagged`, `attachments[]` (Storage paths), `mentions[]`, `createdAt/By`, `updatedAt/By` |
| `kanbanTasks/{key}/comments/{id}` | `authorEmail`, `html`, `text`, `mentions[]`, `at` |
| `kanbanTasks/{key}/activity/{id}` | `who`, `at`, `text` (moves, reassignments, flags) |
| `kanbanSettings/main` | `fields {key: {show, required}}`, `testerEmail`, `currentReleaseId` |
| `kanbanCounters/main` | `nextNumber` (transaction) |
| `kanbanSprints/{id}` | `name`, `start`, `end` |
| Storage `kanban/{key}/…` | screenshots and recordings |

Releases reuse the console's existing `releases` collection.

## 13. Non-functional

- **Security:** members write, viewers read (firestore.rules / storage.rules,
  same `consoleUsers` resolution as the board); only admins write settings;
  sanitise all stored HTML on render.
- **Performance:** board loads one release's tasks by default; search is
  server-side and capped at 50 results; screenshots downscaled to ≤1400 px.
- **Accessibility:** keyboard-operable picker, menus and modal; ARIA on tabs,
  toggles and dialogs; tooltips reachable by focus and tap.
- **Responsive:** desktop ≥1024 px with sidebar; tablet; phone 390 px with no
  sideways page scroll.

## 14. Interfaces

- **Agent Board** (Backlog Tracker & FAQs project): separate pipeline; no
  shared tickets.
- **Console members** (`consoleUsers`): people, roles, photos.
- **Console releases** (`releases`): fix versions.
- **MCP server** (`backlog-tracker/functions/mcp-server.js`): KB-MCP-1 tools.
