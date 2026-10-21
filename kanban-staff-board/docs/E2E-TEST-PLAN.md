# Staff Kanban — End-to-end test plan

Covers every requirement in [`../REQUIREMENTS.md`](../REQUIREMENTS.md). Each
test case (TC) is automated in [`../test/e2e.test.mjs`](../test/e2e.test.mjs)
(Playwright + `node:test`, Chromium) against the prototype in `../prototype/`,
and the same cases are the acceptance tests for the production build in the
PH Agent Console. Run results are recorded in `E2E-REPORT-<date>.md`.

## How to run

```bash
cd kanban-staff-board/test
npm install                      # Playwright 1.56.1
npx playwright install chromium  # once per machine
npm test                         # 25 cases, about 45 seconds
```

CI: `.github/workflows/kanban-staff-board-tests.yml` runs the suite on every
pull request that touches `kanban-staff-board/**`, and on demand.

Each case opens a fresh browser context (clean `localStorage`, so the demo data
is the starting state) and fails on any uncaught page error. Speech
recognition and the microphone are stubbed with a scripted transcript; screen
recording needs a real screen and is a manual check (M-1).

## Environments

| Name | Viewport | Input |
|---|---|---|
| Desktop | 1440 × 900 (also 1024, 1100, 1600–2000 tall where noted) | mouse, keyboard |
| Tablet touch | 1024 × 768, touch | touch (press-and-hold drag) |
| Phone | 390 × 844, touch | touch, tap |

## Test cases

| TC | Covers | Steps | Expected |
|---|---|---|---|
| TC-01 | KB-NAV-1, KB-BOARD-1, KB-TASK-1 | Open Staff Kanban | Six columns in order with counts; heading and nav read "Staff Kanban"; every card key is `PH-n` |
| TC-02 | KB-BOARD-3 | Drag PH-34 from Backlog to In Progress | Card in In Progress; toast "moved to In Progress" |
| TC-03 | KB-BOARD-5 | Drag PH-19 to Ready for Testing, then back to In Progress | Reassigned to Rob with "From Đức"; returned to Đức |
| TC-04 | KB-BOARD-2, KB-BOARD-4 | Start dragging PH-21; drop on Withdrawn | Last column's cards hidden; two targets at 3:1 height; card done/withdrawn; header withdrawn count 3; targets gone |
| TC-05 | KB-BOARD-3 | Touch: press-and-hold PH-27, drag to In Progress | Card moved; the task did not open |
| TC-06 | KB-LANE-1 | Select Linh and Huy; drag PH-29 into Linh's In Progress; collapse and expand | Two lanes; card reassigned to Linh; collapse hides 6 cells; Expand all restores |
| TC-07 | KB-FLT-1 | My tasks | Every card shows Rob |
| TC-08 | KB-FLT-1, KB-FLT-2 | Filters → Type Bug; Done; Clear; scroll 400 px; change Release; Flagged only | Menu stays open while adjusting; only bugs; button reads "Filters 1"; scroll stays at 400; only flagged cards |
| TC-09 | KB-BOARD-7, KB-FLT-3 | At 1440 and 1024 px turn every primary filter on; scroll 800 px | Filter bar on one line; pinned bar at top 0; header cells line up with lane cells |
| TC-10 | KB-BOARD-8 | Phone: tap "Ready for Testing" tab; scroll board to column 2; scroll page | No sideways page scroll; column in view; tab follows the swipe; pinned bar at top |
| TC-11 | KB-MOD-1, KB-MOD-6, KB-TASK-1 | New task; switch types; save empty; save with title and "1d 4h" | No Status/Comments; details order; buttons Raise bug / Create epic / Create task; "Title is required"; PH-40 created in Backlog showing "1d 4h left" |
| TC-12 | KB-MOD-2 | New task → Record task → speak a bug report → Stop | Title, description, Highest, Huy, 4h; "Raise bug"; ≥6 fields marked Agent |
| TC-13 | KB-MOD-3 | Edit PH-20 description: URL, @mention, pasted screenshot, table, warning callout; save; reload | All five survive the reload |
| TC-14 | KB-MOD-3, KB-MOD-4 | PH-23: dictate a comment with the round mic; add @Huy; Add comment | Mic 36 × 36, shows stop while listening; comment saved with text and mention; "Huy notified" |
| TC-15 | KB-TASK-2, KB-TASK-7 | New epic → Add bug → create; add PH-36 via search; remove it | Bug prefilled with the epic; returns to the epic listing it; PH-36 added then removed; child card shows the epic |
| TC-16 | KB-TASK-6 | PH-1 "Add an existing ticket": empty, "36", "archived articles", "SQLite" | Match count shown; PH-36 by number and by title; PH-24 by description with the word highlighted |
| TC-17 | KB-TASK-4 | Flag PH-27 from its card; flag PH-28 from its modal | Both amber; card flag doesn't open the task |
| TC-18 | KB-MOD-5 | PH-20 at 760 px tall: scroll the modal; fold the details column; reopen another task | Save always visible; description gains >150 px; folded state remembered |
| TC-19 | KB-SET-1, KB-SET-2 | Settings: show + require Sprint; tester = Minh; create a task; move PH-19 to testing | "Sprint is required"; PH-19 reassigned to Minh |
| TC-20 | KB-REP-1 | Open the report; status=all; click Huy's row; status=Withdrawn | Defaults to PH 4.12; ≥5 bars; Completed and Withdrawn columns; URL gains assignee=huy; only PH-38 and PH-39 |
| TC-21 | KB-PPL-2 | Load; upload Minh's photo in Settings; remove own photo | Rob's photo on profile button and his cards; Minh's photo on his filter chip; removal restores the initial |
| TC-22 | KB-NAV, §13 accessibility | Hover / tap the (i) beside Record task, desktop and phone | Tooltip fully inside the window |
| TC-23 | KB-NAV-1 | Open Agent Board; click Staff Kanban | Separate pages; nav highlights the current one |
| TC-24 | KB-BOARD-2, KB-TASK-7 | PH-26 Status → Withdrawn; open epic PH-1 | Status menu lists Completed and Withdrawn separately; card withdrawn and struck through; epic counts it as withdrawn |
| TC-25 | KB-LANE-1, KB-BOARD-8 | Phone: select Rob and Huy; tab Ready for Testing; swipe left | Every lane shows Ready for Testing; swipe moves all lanes to Approved |

## Manual checks (not automatable here)

| ID | Covers | Check |
|---|---|---|
| M-1 | KB-MOD-3 | Screen recording: record a window, stop sharing, the video plays in the ticket (Chrome / Edge / Firefox desktop) |
| M-2 | KB-MOD-2, KB-MOD-4 | Real speech recognition in Chrome, Edge and Safari (iOS and macOS); blocked-microphone message |
| M-3 | KB-BOARD-3 | Real-device drag on iOS Safari and Android Chrome |
| M-4 | §13 | Keyboard-only pass: board, Filters menu, picker, modal |

## Production additions (when the console build lands)

The same TCs run against the console with the Firebase emulator, plus:
Firestore and Storage rules (members write, viewers read, admins only for
settings; KB §13), MCP tools (KB-MCP-1: each tool, viewer refused writes,
attribution), server-side search at volume (KB-TASK-6), Claude agent fill
(KB-MOD-2), mention notifications (KB-MOD-3).
