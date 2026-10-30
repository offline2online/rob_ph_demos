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
box, **Release report**, **+ New task**, and a settings cog (no ⋮ menu). AC: the
cog opens Kanban settings; Release report opens the report for the board's
selected release.

**Notifications (bell).** The console topbar carries a **Notifications** bell on every page, not only the Kanban. One notification per recipient, never to the person who acted, for: assigned to you (create, edit, drag, `kanban_assign_task`, MCP create); handed to you for testing, and returned to you from testing; a comment on a ticket you are assignee or reporter of, or watching; an @mention in a description or comment (wins over the other reason); your ticket closed (Completed or Withdrawn) by someone else. The ticket modal has a **Watch** toggle (`watchers[]`); the assignee and reporter watch automatically. The bell groups by ticket, shows an unread count and **Mark all read**, and a click opens the ticket. Cost per member is flat: one `limit(30)` listener ordered by `at` descending plus a `count()` of unread. The notifications are written by a Firestore trigger on `kanbanTasks` and its comments (`functions/kanban-notify.js`), so the board, MCP and voice paths notify the same way and no client writes one; there is no scheduled job: when a member marks notifications read (**Mark all read** on the bell, `kanban_mark_notifications_read`) their own read notifications older than 30 days are deleted, one query (`to`, `read`, `at`) of at most 200.

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
Every edit of a ticket's fields on the board also writes one activity line per
changed field, with the old and new value ("changed Priority from Medium to
High", "assigned to Duong", "changed Estimate from 1d to 2d", added/removed
labels, linked/unlinked tickets); status moves keep their own line.

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
in a **Filters** menu: Flagged only, Type, Priority, Sprint, Project, Label; the
button shows how many secondary filters are on. The Project filter is kept in the
address (`#staff-kanban?project=<id>`), so a reload or a shared link keeps it. Search sits in the page header and
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
equivalents): type, priority, sprint, project, due date, time logged, labels, comments,
attachments, parent epic, linked tickets, flag. All fields flow into filters
and the release report. **Release is optional**: it is never a required field (settings
can't make it so), a ticket created on the form or over MCP (`kanban_create_task`) may have
none, and one can be added later; unreleased tickets still show on the board and in
filters, and appear under "All releases" in the report.

**KB-TASK-4 Flags.** Any ticket can be flagged from its card or its modal (in the modal the Flag button sits on the same line as Priority);
flagged cards are amber with a filled flag.

**KB-TASK-5 Linked tickets.** Typed links (blocks, is blocked by, relates to,
duplicates, is duplicated by) to any other ticket. A link shows on both
tickets, with the reverse type (blocks ↔ is blocked by, duplicates ↔ is
duplicated by, relates to ↔ relates to), and removing it from either ticket
removes both. AC: linking A "blocks" B makes B read "is blocked by A"; removing
it from B clears it from A; a ticket can't be linked to itself. Stored on both
tickets, written in one batch (§12).

**KB-TASK-12 Acceptance criteria.** A ticket has a checklist of up to 50
acceptance criteria, each `{id, text, done}` with the text 1 to 500 characters,
so a generated page epic can list the fields, states, validation rules and API
calls its artifact shows. The task modal has an **Acceptance criteria** section
under the description (on new and existing tickets) where a member adds, edits,
removes, reorders (up / down) and ticks items; on an existing ticket each change
is saved at once, in a transaction against the latest copy (two people ticking
different items never overwrite each other), and writes its own activity line
(added / edited / removed / ticked / unticked / moved); on a new ticket the list
is saved with Create. The card shows **AC n/m** when there are any. Over MCP
`kanban_create_task` and `kanban_update_task` take `acceptanceCriteria` as an
array of strings or `{text, done}` (an update replaces the list; an item whose
text is unchanged keeps its id and state), `kanban_get_task` returns the items
with their ids, and `kanban_check_criteria` (`key`, `ids`, `done`) ticks or
unticks items without resending the list. 51 items or a 501-character item are
refused over MCP and by `firestore.rules` for a direct write. An open modal
follows a change made elsewhere without a reload. *Storage:* the rules cannot
loop and cap an operation at 1000 expressions, and a list of 50 maps checked
item by item exceeded that, so the checklist is stored as a list of strings
`<8-char id>\t<0|1>\t<text>` that the rules check whole (count, the shape of
every line, the 500-character limit); the page, MCP and tests see
`{id, text, done}` through `decodeCriteria`, and a direct write of objects is
refused. The card carries the counts only (`acTotal`, `acDone`), never the text.

**KB-TASK-13 Save only when something changed.** On an existing ticket the
modal's **Save** button is disabled until a field on the page differs from what
was loaded (title, description, any detail field, labels, links, attachments,
the flag, or text typed in the comment box); changing a value back turns it off
again. The same holds for **Save** on a comment being edited. A new ticket's
Create button is unaffected. AC: open a ticket, Save is disabled; edit the title,
it is enabled; restore the title, it is disabled; TC-69.

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
clear formatting. Plus: **@mentions** of staff (notified when the ticket or comment is saved, by the notification trigger), **URLs that
link themselves**, **screenshots** (upload, paste or drop; downscaled to ≤1400 px and held in
Storage, the description carrying their download URL — never a `data:` URI, so
a ticket doesn't fill its size limit and no listener downloads a picture), and
**screen recording** (record button → playable video). Comments use a compact
version of the same editor. Stored HTML is sanitised (DOMPurify) when shown.
**Editing and deleting comments.** Each comment shows its author (and an admin) a **⋮** menu: **Edit** (author only) opens the same compact editor inline and the saved comment carries an "edited" label; **Delete** asks in the console's own confirm modal, removes the comment and takes one off `commentCount` (ticket and card). Nobody edits another person's comment; an admin deletes anyone's. People newly @mentioned by an edit are notified, those it already named are not. Both are written to the activity log ("edited a comment", "deleted a comment"). Rules: a comment is updated only by its author and only `html`, `text`, `mentions` and `editedAt`; deleted by its author or an admin. Over MCP: `kanban_edit_comment` and `kanban_delete_comment` (KB-MCP-1).

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
of the modal. The details column runs the full height of the modal and folds away to the right (the button at the top of the column or the
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

**KB-PRJ-1 Project.** A ticket can name the console project it belongs to (a
`projects` document id, stored as `project`, at most 100 characters), so
generated epics trace back to the project and artifact they came from. It is an
optional field (shown by default; shown and required per Kanban settings),
sits in the task modal's side panel, filters the board, and shows by name on the
card. Over MCP `project` takes an id or a project's name (stored as the id), an
unknown one is refused with every other validation error, and `""` clears it;
`kanban_list_tasks` filters on it (pushed into the query), `kanban_get_task`
returns it with `projectName`, and `kanban_list_people` lists the projects.

**KB-MCP-1** Every field is readable and writable over the console's MCP
server, attributed to the calling member: `kanban_list_tasks` (filters as on
the board), `kanban_get_task`, `kanban_create_task`, `kanban_update_task`,
`kanban_move_task` (status + resolution; applies the testing hand-off),
`kanban_assign_task`, `kanban_comment`, `kanban_edit_comment` / `kanban_delete_comment` (by `commentId`, which `kanban_get_task` returns with each comment; your own comments only, an admin deletes any), `kanban_flag_task`,
`kanban_create_tasks` (up to 100 tickets in one call: the same fields as `kanban_create_task` plus a temporary `ref` that other rows use as their `epic`, the whole batch validated first with every problem returned by row and field, nothing written if any row fails unless `partial: true`, `dryRun` to validate only; keys from one counter transaction, writes in batches under 500, 500 tickets an hour per member, one audit row per call), `kanban_my_work` (the caller's open tickets by column, overdue, due this week, flagged, unread count), `kanban_create_contract_ticket` (API contract first: one all-or-nothing step creates the interface, an `api-contract` ticket with `project` and `interfaceId`, and "blocks" links to each named story, stored on both tickets; every problem returned together, nothing created on any; `kanban_get_task` returns `interface` {id, name, docsUrl} and the modal shows "Interface: <name>" linking to the project's Docs page),
`kanban_list_notifications` (unread first; `unread_only`, `limit`), `kanban_mark_notifications_read` (`ids` or `all`),
`kanban_search_tickets`, `kanban_release_report`, `kanban_check_criteria` (tick or
untick acceptance criteria by id, KB-TASK-12), `kanban_attach_file` (a
screenshot, image or pdf as base64, at most 5 MB decoded, stored under
`kanban/{PH-n}/`, images over 1400 px shrunk, optionally inline in the
description; 60 files an hour per member), `kanban_capture_screenshot` and
`kanban_capture_screenshots` (the board renders the page itself in headless
Chromium and puts the screenshot inline in the description in place of a
"Screenshot: …" line, KB-MCP-CAPTURE: only https pages on the artifact
domains, a non-200, not-found or redirected page is reported and attaches
nothing; up to 20 pages per call). Viewers get read tools only.
Staff can add and move tasks verbally through their agent.
Writes (`kanban_create_task`, `kanban_update_task`, `kanban_assign_task`)
refuse what the board can't show and report every problem in one error: an
assignee or reporter who isn't a console member (an alias folds to its owner,
KB-PPL-3), a release that isn't one (an id, name or version is accepted and
saved as the id), an epic that isn't an epic, a bad due date or estimate.
`kanban_list_tasks` with no release or status covers open tickets; a release
adds its closed ones, and status `done` the 300 most recently closed.
`kanban_get_task` returns the description as text and as `descriptionHtml`, and
the ticket's stored links (both directions are stored, so it reads one ticket
and no other for them; KB-TASK-5, TC-39). A link to a ticket that doesn't exist,
or to the ticket itself, is refused. A reassignment that leaves the same person
is not logged.
Reads stay bounded as the board grows (every tool answers in well under a
second whatever its size). The next rank in a column is one query
(`status` == column, `rank` desc, `limit 1`; no counter document, which would
take about one write a second); if its index is still building the tool reads
the column as before. `kanban_list_tasks` and `kanban_release_report` push the
filters into the query (assignee, status, release, project, type, priority,
sprint, flagged, label; equality and `array-contains` merge single-field
indexes), read at most 500 tickets per call by document id, and answer
`truncated` and `nextCursor` (pass it as `cursor`) when there are more;
`assignee: me` reads only that person's tickets. `kanban_get_task` reads the
ticket, its newest 100 comments and newest 100 activity lines (it says how many
it left out: `commentsOmitted`, `activityOmitted`), an epic's children (500 at
most) and nothing else. The member directory, settings, releases, sprints,
projects and the cards-or-tickets check are cached for 60 s in each function
instance (this instance's directory writes drop its copy). Every `kanban_*`
call writes one `mcpAuditLog` row with `ms`, so a slow tool shows up. The
backfill pages tickets, then cards, by document id, and the board asks for it
at most once per session per member.

## 12. Data model (production)

As built (`backlog-tracker/public/js/kanban/kanban-store.js`). People are
stored by lowercased email; release ids are the console's `releases` ids.

| Collection | Shape |
|---|---|
| `kanbanCards/{PH-n}` | The light copy the board reads: `key`, `type`, `title`, `status`, `resolution`, `open`, `closedAt`, `rank`, `assignee`, `previousAssignee`, `release`, `sprint`, `project`, `priority`, `flagged`, `estimate`, `logged`, `due`, `labels[]`, `epic`, `commentCount`, `attachmentCount`, `acTotal`, `acDone` (the acceptance-criteria counts, KB-TASK-12), `updatedAt/By` (what `core.cardOf` names; the rules refuse any other key, so no description, links or search tokens). **Every writer writes a ticket's card in the same batch or transaction as the ticket**: the page (`kanban-store.js` createTask / updateTask / deleteTask / addComment, children and epics too) and every MCP write in `functions/kanban.js`. |
| `kanbanTasks/{PH-n}` | The full ticket, read when its modal opens (and by search and `kanban_get_task`): `key`, `number`, `type` (task/bug/epic), `title`, `description` (HTML), `descriptionText`, `status`, `resolution` (completed/withdrawn when status = done, else null), `open` (status ≠ done), `closedAt` (when done), `rank`, `assignee`, `previousAssignee`, `reporter`, `release`, `sprint`, `project` (console project id or empty), `estimate` (hours or null), `logged` (hours), `priority`, `due` (YYYY-MM-DD), `labels[]`, `epic` (parent key), `links[] {type,key}` (on both tickets: "A blocks B" is `{blocks,B}` on A and `{is blocked by,A}` on B, written in one batch by the page and the MCP tools), `flagged`, `acceptanceCriteria[]` (at most 50 strings `<id>\t<0|1>\t<text>`, KB-TASK-12), `attachments[] {name,size,contentType,url,path}`, `commentCount`, `mentions[]`, `watchers[]` (people who asked to follow it), `searchTokens[]` (server search, KB-TASK-6), `createdAt/By`, `updatedAt/By` |
| `kanbanTasks/{PH-n}/comments/{id}` | `author`, `html`, `text`, `mentions[]`, `at`, `editedAt` (once edited) |
| `kanbanTasks/{PH-n}/activity/{id}` | `who`, `at`, `text` (moves, field changes with old and new value, links, flags); append-only |
| `kanbanCounters/main` | `nextNumber`, advanced in the same transaction as the ticket it numbers |
| `kanbanSettings/main` | `fields {key: {show, required}}`, `tester`, `currentRelease`, `releaseDates {releaseId: date}`, `labels[]`, `firstNames {email: name}`, `linksTwoSidedAt` (server-stamped), `updatedAt/By` |
| `kanbanSprints/{id}` | `name`, `start`, `end` |
| `kanbanNotifications/{id}` | `to`, `from`, `taskKey`, `taskTitle`, `kind` (assigned/testing/returned/commented/mention/closed), `via` (description/comment, for a mention), `read`, `at`; written only by the trigger, named from the event id so a retry writes nothing twice; the person notified may mark read, and delete theirs once read (rules). Indexes: `to`+`at` desc, `to`+`read`+`at` |
| `memberDirectory/{email}` | `email`, `displayName`, `photoUrl`, `photoUpdatedAt`, `disabled` (server-written) |
| Storage `kanban/{PH-n or new}/…` | screenshots, recordings, attachments |

Loading: the **cards** of every open ticket, of the 300 most recently closed,
and of every ticket in the release picked in the Release filter; an epic's
children come from cards too. The board's own queries are single-field. The server's
are equality and `array-contains` filters (merged from single-field indexes) plus
`orderBy(rank desc).limit(1)` per column (composite `status`+`rank`, declared in
`backlog-tracker/firestore.indexes.json` with the notification prune's `to`+`read`+`at`);
a query whose index is still building falls back to the earlier read, never an error. The modal always reads the full ticket fresh (a save can't
overwrite what the board doesn't hold; a title or label edit re-derives
`searchTokens` from the stored description). Board text search finds
description words through the server's `searchTokens` query on `kanbanTasks`.
The board draws a page of each column (Backlog 25, others 50, "Show 50 more"), so
the cost of a render follows what is on screen, not how many tickets are open (§13).

**Links backfill, also with nobody at a terminal:** links stored before they were
written on both tickets are one-sided. `POST /mcp/kanban/backfill-links` (any
member, rate-limited, sliced with `{done, after}`) adds the missing side with
`arrayUnion`, so running it twice changes nothing, and on its last slice stamps
`kanbanSettings/main.linksTwoSidedAt`. The board calls it once per session, only
while that stamp is missing.

**Backfill, with nobody at a terminal:** `POST /mcp/kanban/backfill` (any
member, rate-limited, idempotent, sliced with `{done, after}`) writes a card for
every ticket that lacks one or differs, removes cards whose ticket is gone, and
moves inline `data:` screenshots in descriptions to Storage
(`kanban/{PH-n}/…`). The board counts cards against tickets when it opens; while
the cards are behind it reads `kanbanTasks`, so no ticket ever disappears, calls
the endpoint, and moves to the cards when they have caught up. The MCP tools do
the same comparison on the server.

## 13. Non-functional

- **Security:** members write, viewers read (firestore.rules / storage.rules,
  same `consoleUsers` resolution as the board); only admins write settings;
  sanitise all stored HTML on render.
- **Performance:** the board downloads cards, not tickets: its payload scales
  with what a card shows (about 0.4 KB a ticket), not with descriptions, so 1,000
  open tickets of 150 KB each cost the board under 1 MB instead of ~150 MB, and
  editing a description sends the board one small card update. Search is
  server-side and capped at 50 results; screenshots are downscaled to ≤1400 px
  and held in Storage.
  First open (29 Oct 2026): the icon font is a subset (about 33 KB, not 3.9 MB),
  the console's scripts are served minified, the four Kanban modules are
  preloaded in parallel with `app.js` on `#staff-kanban`, and the rich-text
  editor (Quill) downloads when a ticket first opens, not at page start. See
  `backlog-tracker/README.md` → "Load performance".
  Render cost (29 Oct 2026): the board draws a page of each column, not every
  ticket: **Backlog its first 25 cards and every other column its first 50**,
  each with a "Show 50 more" row. Header counts and remaining effort cover every
  ticket in the filtered list, drawn or not. Every open card is still listened
  to (they are light); only drawing is paged. The Done column's total is a
  `count()` query, asked again when a ticket enters or leaves Done, not on every
  snapshot (no aggregate document: one document takes about one write a second).
  MCP (29 Oct 2026): with 10,000 closed and 2,000 open tickets, `kanban_move_task`
  and `kanban_create_task` read at most 5 documents, `kanban_list_tasks
  assignee: me` reads only that person's, and `kanban_get_task` reads the ticket,
  its newest 100 comments and 100 activity lines and an epic's children (see
  KB-MCP-1). `backlog-tracker/test/kanban-mcp.test.js` seeds that board.
  A listener's later snapshots carry only the changed cards (`docChanges()`),
  listener callbacks are coalesced into one render per animation frame, and a
  redraw keeps every card whose markup is unchanged, so a colleague's move
  patches that one card. Search is debounced 150 ms and matches against
  per-ticket text prepared once. Measured with the console's UI suite (2,000 and
  5,000 open tickets): first cards under 1.5 s, My tasks under 150 ms.
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
