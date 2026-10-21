# Staff Kanban — End-to-end run against the console build, 21 Oct 2026

**Result: 30 / 30 passed, three consecutive runs (90 / 90), no flaky cases.**
That is the 25 signed-off test-plan cases plus TC-16b and the four console-only
cases (KB-C1 to KB-C4), against the production build in the PH Agent Console.

| | |
|---|---|
| Build under test | `backlog-tracker/public/` (the real `index.html`, `app.js`, `js/kanban/`) on `deploy/kanban-staff-board` |
| Suite | `backlog-tracker/test/ui/staff-kanban.test.mjs` (plan: `E2E-TEST-PLAN.md`) |
| Data | The prototype's own team, releases and 39 tickets (`test/ui/fixtures/kanban-seed.json`, generated from `prototype/js/data.js`), as the Firestore documents the console reads |
| Runner | Node 22, Chromium 1194 (headless), the console's UI harness: Firebase SDK stubbed in memory, no network |
| Duration | about 41 s per run |

## Results

| ID | Case | Result | ms |
|---|---|---|---|
| TC-01 | Six columns, counts, PH keys, pinned header row, nav entry | Pass | 692 |
| TC-02 | Drag Backlog → In Progress; the write and its activity line | Pass | 1178 |
| TC-03 | Testing hand-off to Rob and back to the developer | Pass | 1774 |
| TC-04 | Completed (3/4) / Withdrawn (1/4) drop targets; `open` / `closedAt` written | Pass | 1091 |
| TC-05 | Touch press-and-hold drag | Pass | 1926 |
| TC-06 | Swimlanes; drag between lanes reassigns; collapse / expand | Pass | 1449 |
| TC-07 | My tasks | Pass | 612 |
| TC-08 | Filters menu; scroll position kept on filter change | Pass | 1303 |
| TC-09 | Pinned filter bar + headers; one line at 1440 and 1024 | Pass | 2652 |
| TC-10 | Phone carousel: tabs, swipe, no sideways page scroll | Pass | 1867 |
| TC-11 | New task: validation, type buttons, PH-40 from the counter | Pass | 1080 |
| TC-12 | Voice: Record task fills the ticket (stubbed speech, local fill) | Pass | 1529 |
| TC-13 | Rich description saved: link, mention, screenshot in Storage, table, callout; mention notified | Pass | 1922 |
| TC-14 | Rich comment with @mention; dictated comment; round mic; comment written and counted | Pass | 1928 |
| TC-15 | Epic: add bug from inside, add/remove existing ticket | Pass | 1932 |
| TC-16 | Ticket search by number, title and description | Pass | 1180 |
| TC-16b | Server search finds a ticket the board isn't holding | Pass | 1143 |
| TC-17 | Flags from card and modal | Pass | 1389 |
| TC-18 | Pinned action bar; collapsible details column | Pass | 1073 |
| TC-19 | Settings: required field; tester reassignment | Pass | 1910 |
| TC-20 | Release report: default, URL filters, Completed/Withdrawn | Pass | 1431 |
| TC-21 | Profile photos, including one arriving without a reload | Pass | 680 |
| TC-22 | Tooltips inside the window (desktop, phone) | Pass | 1714 |
| TC-23 | Agent Board separate from Staff Kanban; Back works | Pass | 1062 |
| TC-24 | Completed vs Withdrawn in the Status menu; epic progress | Pass | 1424 |
| TC-25 | Phone swimlanes follow the current column; swipe | Pass | 1253 |
| KB-C1 | Viewer: sees the board, changes nothing | Pass | 1261 |
| KB-C2 | Mentions bell | Pass | 792 |
| KB-C3 | Claude's draft preferred over the local fill | Pass | 1359 |
| KB-C4 | Deep link to the report; the hash follows the page | Pass | 645 |

## The rest of the build

| Suite | Result |
|---|---|
| `backlog-tracker/test/kanban-rules.test.js`, Firestore rules in the emulator | 43 / 43 |
| `backlog-tracker/test/kanban-mcp.test.js`, server and the eleven MCP tools | 19 / 19 |
| `backlog-tracker/test/kanban-core.test.mjs`, the shared rules | 7 / 7 |
| The console's whole `npm test` (every existing suite, with the above) | pass |

## Side by side with the prototype

The same screens from the signed-off prototype (left) and the console build
(right), same data: [`validation/`](validation/). Board, swimlanes, task modal,
new task, epic, drag targets, release report, phone board and phone modal match.
The differences are deliberate:

- Avatars use the console's own colour for each person, and people are listed by first name (you first) rather than the prototype's fixed order.
- A mentions bell sits beside + New task (the prototype only showed a toast).
- The release report opens from the page header, not a sidebar entry.
- On a phone, Staff Kanban is in the tab bar's Build sheet: the console keeps four tabs.
- Profile photos are the console's own (Profile → Upload photo), not a Kanban setting; Kanban settings shows the team and lets an admin set the name the board uses ("Shown as").
- Kanban settings gains release dates and sprints, which the prototype held as mock data.

## Found and fixed while building

- The release report crashed on load: a local list shadowed the people list (`Cannot access 'people' before initialization`). Caught by TC-20 and KB-C4.
- A person's new photo didn't show until reload. Caught by TC-21.
- @mention suggestions put a full-name match ("Đỗ Minh Đức" for "mi") above a first-name match ("Minh"). First names now come first. Caught by TC-13.
- Before the icon font loads, the Unassigned avatar's icon name spilled over its neighbour and took its clicks. Avatars now clip. Caught by TC-09.
- The console's tab bar is pinned at four tabs by its own tests; the fifth "Kanban" tab was taken out.

## Still to check on the live console

Storage uploads (rules), Claude's real answers once `ANTHROPIC_API_KEY` is set,
and the manual checks M-1 to M-4 (ticket "Run the Staff Kanban manual checks
M-1 to M-4 on the console build").
