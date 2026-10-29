# Staff Kanban — Requirements

**Project:** Kanban Staff Board (PH Agent Console), promoted from concept
`vmhUoPiogxiJq1YmtJph` ("Kanban — Staff Task Board (Jira replacement)").
**Repo folder:** `kanban-staff-board/`. **Status (21 Oct 2026):** built in the
PH Agent Console (`backlog-tracker/`: page `public/js/kanban/`, rules in
`firestore.rules` / `storage.rules`, server and MCP tools in
`functions/kanban.js`) and passing the whole test plan against the console;
see `docs/E2E-REPORT-2026-10-21-console.md`. `prototype/` stays as the signed-off
reference behaviour, and `docs/E2E-TEST-PLAN.md` is how both are verified.

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
Kanban". AC: both entries present; the active one is highlighted; on a phone
it is in the tab bar's Build sheet (the console's tab bar stays at four tabs:
Build, Publish, Search, Profile). Route `#staff-kanban`, with
`#staff-kanban/report?…` and `#staff-kanban/settings`.

**KB-NAV-2** The Staff Kanban page header holds the title, task count, search
box, **Release report**, **+ New task**, the mentions bell and a settings cog (no ⋮ menu). AC: the
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
task; the page scrolls when dragging near an edge. A drag drops nothing until
the finger has moved: pressing and holding a card and letting go in place
leaves it where it was. Esc cancels a drag in progress and the card returns
(as in Jira and Trello). The drop place is worked out again whenever the page
or the board scrolls under a held finger, so a card lands where it was last
shown.

**KB-BOARD-4 Closing targets.** While any card is dragged, the Completed /
Withdrawn column's cards hide and two large drop targets fill the visible
height over that column: Completed (three quarters) and Withdrawn (one
quarter), each with icon, label and count. On a tablet they cover that
column only, clipped to what is on screen; while it is scrolled out of view
they are a slim strip at the right edge and the board scrolls sideways under
a finger held at the edge. On a phone they are a slim bar across the screen
above the tab bar that grows to the tall targets only when the card nears
it, so every other part of the board stays reachable. AC: targets appear
only while dragging; dropping sets status `done` with the matching
resolution; a drop on a target counts only if the finger entered it after
the drag began (letting go where the target appeared under the finger does
not close the card).

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
AC: no horizontal page overflow at 390 px; swipe and tab both change column;
the mentions bell panel opens inside the window (KB-NAV-2).

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
and the release report. **Release is optional**: it is never a required field (settings
can't make it so), a ticket created on the form or over MCP (`kanban_create_task`) may have
none, and one can be added later; unreleased tickets still show on the board and in
filters, and appear under "All releases" in the report.

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
Production: the transcript goes to Claude (`claude-opus-5-5`, structured JSON,
low effort) through `POST /mcp/kanban/agent-fill` (`functions/kanban.js`); until
the `ANTHROPIC_API_KEY` repo secret is set, and whenever Claude doesn't answer,
the page uses the local stand-in (`agentDraft()` in `kanban-core.js`), as the
prototype does.

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

**KB-MOD-4a Each phrase written once, Android included (21 Oct 2026).**
Reported from an Android phone on Record task: "add add add a new add a new
Epic…". Android Chrome in continuous mode reports every in-progress guess as
a final, each the whole utterance so far. So on Android, Record task and both
mics listen one utterance per session (restarted when it ends), and on every
device a final that only carries the previous one further replaces it rather
than being appended. That also covers an Android device whose user agent
doesn't say so ("Desktop site", tablets); after two such finals in one
session the page stops using continuous mode for the rest of the visit.
Shared with the console's other mics: `backlog-tracker/public/js/dictation-results.js`
(the prototype carries a copy in `kanban.js`). Tested by KB-C7/KB-C8 in
`backlog-tracker/test/ui/staff-kanban.test.mjs` and
`backlog-tracker/test/dictation-results.test.mjs`.

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

**KB-SET-2** Ready for Testing reassignment target; current release (when none is
stored the tester is Rob and the current release is the earliest unreleased one
by version, on the board, the report and `kanban_release_report`; the page shows
an unset field as "Not set (X is used)", never a value the server lacks); each
release's date (releases themselves are the console's Releases page); sprints
(name, start, end); the team list with photos and "Shown as" names. Members
read settings; only admins change them.

## 10. People and photos

**KB-PPL-1** Assignee lists show every console member by first name: the first
word of their console name, or the "Shown as" name an admin sets in Kanban
settings → Team (for names where the given name comes last, e.g. Lê Quang Huy → Huy).
Members come from `memberDirectory`, a copy of `consoleUsers` without roles kept
by a Cloud Function, since the full member list is admin-only.
**KB-PPL-3** One person, one entry. An alias (`PERSON_ALIASES` in
`kanban-core.js`: today `rob@personalisationhub.com` → `rob@offline2online.com`)
is a second address the same person signs in with. It has no member row or
directory entry, is never listed or offered as a person, and anything that
names it (assignee, reporter, a mention, an agent signed in as it, "me")
means its owner. The deploy folds existing data across
(`backlog-tracker/scripts/apply-person-aliases.js`). The voice fill knows who
is speaking (from the sign-in token), so "for me", "I need to" or "remind me"
assigns the ticket to the speaker.
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
Writes (`kanban_create_task`, `kanban_update_task`, `kanban_assign_task`)
refuse what the board can't show and report every problem in one error: an
assignee or reporter who isn't a console member (an alias folds to its owner,
KB-PPL-3), a release that isn't one (an id, name or version is accepted and
saved as the id), an epic that isn't an epic, a bad due date or estimate.
`kanban_list_tasks` with no release or status covers open tickets; a release
adds its closed ones, and status `done` the 300 most recently closed.
`kanban_get_task` returns the description as text and as `descriptionHtml`, and
links in both directions (blocks / is blocked by, relates to, duplicates / is
duplicated by; KB-TASK-5, TC-39). A reassignment that leaves the same person
is not logged.

## 12. Data model (production)

As built (`backlog-tracker/public/js/kanban/kanban-store.js`). People are
stored by lowercased email; release ids are the console's `releases` ids.

| Collection | Shape |
|---|---|
| `kanbanTasks/{PH-n}` | `key`, `number`, `type` (task/bug/epic), `title`, `description` (HTML), `descriptionText`, `status`, `resolution` (completed/withdrawn when status = done, else null), `open` (status ≠ done), `closedAt` (when done), `rank`, `assignee`, `previousAssignee`, `reporter`, `release`, `sprint`, `estimate` (hours or null), `logged` (hours), `priority`, `due` (YYYY-MM-DD), `labels[]`, `epic` (parent key), `links[] {type,key}`, `flagged`, `attachments[] {name,size,contentType,url,path}`, `commentCount`, `mentions[]`, `searchTokens[]` (server search, KB-TASK-6), `createdAt/By`, `updatedAt/By` |
| `kanbanTasks/{PH-n}/comments/{id}` | `author`, `html`, `text`, `mentions[]`, `at` |
| `kanbanTasks/{PH-n}/activity/{id}` | `who`, `at`, `text` (moves, reassignments, flags); append-only |
| `kanbanCounters/main` | `nextNumber`, advanced in the same transaction as the ticket it numbers |
| `kanbanSettings/main` | `fields {key: {show, required}}`, `tester`, `currentRelease`, `releaseDates {releaseId: date}`, `labels[]`, `firstNames {email: name}`, `updatedAt/By` |
| `kanbanSprints/{id}` | `name`, `start`, `end` |
| `kanbanNotifications/{id}` | `to`, `from`, `taskKey`, `taskTitle`, `kind` (description/comment), `read`, `at` |
| `memberDirectory/{email}` | `email`, `displayName`, `photoUrl`, `photoUpdatedAt`, `disabled` (server-written) |
| Storage `kanban/{PH-n or new}/…` | screenshots, recordings, attachments |

Loading: every open ticket, the 300 most recently closed, and every ticket of
the release picked in the Release filter. All queries are single-field, so no
composite index is needed.

## 13. Non-functional

- **Security:** members write, viewers read (firestore.rules / storage.rules,
  same `consoleUsers` resolution as the board); only admins write settings;
  sanitise all stored HTML on render.
- **Performance:** board loads one release's tasks by default; search is
  server-side and capped at 50 results; screenshots downscaled to ≤1400 px.
  First open (29 Oct 2026): the icon font is a subset (about 33 KB, not 3.9 MB),
  the console's scripts are served minified, the four Kanban modules are
  preloaded in parallel with `app.js` on `#staff-kanban`, and the rich-text
  editor (Quill) downloads when a ticket first opens, not at page start. See
  `backlog-tracker/README.md` → "Load performance".
- **Accessibility:** keyboard-operable picker, menus and modal; ARIA on tabs,
  toggles and dialogs; tooltips reachable by focus and tap.
- **Responsive:** desktop ≥1024 px with sidebar; tablet (iPad portrait and
  landscape: the menu's Staff Kanban link works by touch, and icons are boxed to
  one em so the Record task button stays a clean circle even before the icon font
  loads); phone 390 px with no sideways page scroll.

## 14. Interfaces

- **Agent Board** (Backlog Tracker & FAQs project): separate pipeline; no
  shared tickets.
- **Console members** (`consoleUsers`): people, roles, photos.
- **Console releases** (`releases`): fix versions.
- **MCP server** (`backlog-tracker/functions/mcp-server.js`, tools in
  `functions/kanban.js`): KB-MCP-1 tools, plus `kanban_list_people`.
