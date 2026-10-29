# Staff Kanban — End-to-end test plan

Covers every requirement in [`../REQUIREMENTS.md`](../REQUIREMENTS.md). **This is the mandatory regression suite for any change to the
Staff Kanban board** (see "When these tests run"). Each test case (TC) is automated twice, and **every case runs in every profile of the
viewport matrix** (desktop, tablet and phone, mouse and touch):

- against the signed-off prototype, in [`../test/e2e.test.mjs`](../test/e2e.test.mjs)
  (Playwright + `node:test`);
- against the production build in the PH Agent Console, in
  `backlog-tracker/test/ui/staff-kanban.test.mjs`. TC-26 onwards are written once, in
  [`../test/lib/cases.mjs`](../test/lib/cases.mjs), and run by both. That runs the real console
  (`index.html`, `app.js`, `js/kanban/`) with the Firebase SDK stubbed, seeded
  with the prototype's own team, releases and 39 tickets. It's part of the
  console's `npm test` (and so of every console train's tests). The console run
  adds the cases marked KB-C below.

Run results are recorded in `E2E-REPORT-<date>.md` (prototype) and
`E2E-REPORT-<date>-console.md` (console).

## How to run

```bash
cd kanban-staff-board/test
npm install                                      # Playwright 1.56.1
npx playwright install chromium firefox webkit   # once per machine
npm test                                         # the whole matrix, 4 profiles at a time
npm run test:serial                              # the same cases in one process
```

The console suite: `cd backlog-tracker/test && npm ci && node ui/staff-kanban.test.mjs` (also part of `npm run test:ui`). Both take the
same switches: `KB_PROFILES`, `KB_ENGINES`, `KB_ONLY`, `KB_RETRIES`, `KB_JOBS` (see "Viewport matrix"). The server half of TC-44 and TC-45d
is `backlog-tracker/test/kanban-mcp.test.js` (`npm run test:mcp`).

Each case opens a fresh browser context (clean `localStorage`, so the demo data is the starting state) and fails on any uncaught page
error. A case that fails is run once more in a fresh context; a pass on the retry is printed as `FLAKY`. Speech recognition and the
microphone are stubbed with a scripted transcript; screen recording needs a real screen and is a manual check (M-1).

**Three kinds of line in the output besides ok / not ok.** `CONFIRM TC-nn: question → observed: …` is a result the spec doesn't define
("Expected: confirm"): the case records what the build does, passes, and the question is raised on the ticket. `KNOWN DEFECT TC-nn` is a
case that asserts the correct behaviour of a defect the suite found: it is reported until the defect is fixed (then `FIXED` says to
remove the `known` option). `NOT RUN` names an engine that isn't installed: those profiles are never counted as passes.

## When these tests run

This is the mandatory regression suite for the Staff Kanban board: **any change to the board is only finished when the whole suite is green,
in every viewport of the matrix, in both builds.** The whole suite runs, as a self-healing loop:

1. on every build that lands in **Ready for Testing**;
2. on **Deploy to Feature** (the train's feature branch, `deploy/kanban-staff-board`);
3. **before merge to `main`** (the train PR);
4. on **any console deployment that touches `backlog-tracker/`**.

A failure never blocks the workflow. Each failing case is **raised as a bug ticket** on the board, **approved for development
automatically**, **built onto the same train** and **re-tested until green**; all of those tickets and their fixes go to `main`
together with the train. A case that fails once and passes on the retry is not a failure: it is printed as `FLAKY` and counted in
the run report so it can be chased.

**What exists today, and what does not.** The suite, the matrix and the run reports are in this ticket. The wiring that raises
the bug tickets, approves them and re-tests is the companion ticket on Backlog Tracker & FAQs, "Self-healing Staff Kanban E2E loop on
every deployment", and is **not built yet**. What runs today:

| Where | What runs | How |
|---|---|---|
| Console train (any change under `backlog-tracker/`) | The console suite, Chromium profiles, in the `rules` check | `npm run test:ui` → `ui/staff-kanban.test.mjs`; the server half (TC-44, TC-45d) is in `npm run test:mcp` |
| Pull requests touching `kanban-staff-board/**` | The prototype suite | `.github/workflows/kanban-staff-board-tests.yml`: `npm test`. That workflow installs Chromium only and has a 15-minute limit; the companion ticket needs to install Firefox and WebKit (`npx playwright install --with-deps chromium firefox webkit`) and lift the limit. Until it does, the Firefox and WebKit profiles report "NOT RUN" and the Chromium profiles run in parallel |
| By hand | Either suite | `cd kanban-staff-board/test && npm test`; `cd backlog-tracker/test && node ui/staff-kanban.test.mjs` |

## Viewport matrix

Every case runs in each profile (`test/lib/profiles.mjs`, shared by both suites). A profile is an engine, a viewport and an
input type; the suites run it as a Playwright launch profile, one worker process per profile, several at a time (`KB_JOBS`).
A case that only makes sense on one kind of input says so in its "On" column.

| Profile id | Viewport | Input | Engines |
|---|---|---|---|
| `desktop-1440-<engine>` | 1440 × 900 | mouse | Chromium, Firefox, WebKit |
| `desktop-1024-chromium` | 1024 × 768, sidebar open | mouse | Chromium |
| `tablet-l-<engine>` | 1024 × 768 (landscape) | touch | Chromium, WebKit |
| `tablet-p-<engine>` | 768 × 1024 (portrait) | touch | Chromium, WebKit |
| `phone-390-<engine>` | 390 × 844 | touch | Chromium, WebKit |
| `phone-360-chromium` | 360 × 740 (small phone) | touch | Chromium |

Touch is real touch events over the DevTools protocol on Chromium. WebKit and Firefox have no such channel, so a touch gesture there is the
same sequence of pointer events a finger produces, sent to the page (the board listens to pointer events): it checks the board's logic, not
the engine's native scrolling, which only Chromium exercises (TC-52, TC-25).

```bash
KB_PROFILES=quick npm test                          # desktop 1440 and phone 390 in Chromium
KB_PROFILES=phone-390-chromium,tablet-p-chromium npm test
KB_ONLY=TC-45 npm test                              # one case family
KB_ENGINES=chromium npm test                        # without Firefox and WebKit
KB_RETRIES=0 npm test                               # no retry of a failed case
```

## Environments

See "Viewport matrix" above. TC-01 to TC-25 were written for desktop 1440, tablet 1024 touch and phone 390 and now run in all of them: a case that is
only about one kind of screen (TC-05, TC-10, TC-25 touch and phone; TC-09 and TC-18 from 1024 px up; TC-02, TC-04, TC-06 not on a phone) says so in the run report.

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

### TC-26 to TC-67, and TC-68

The 41 cases added on 21 Oct 2026 (profile and photos, creating and editing tickets, moving them, filters, search and the report) are in
[`E2E-TEST-PLAN-TC26-TC66.md`](E2E-TEST-PLAN-TC26-TC66.md), with their steps and expected results. They run in both suites and in the whole matrix like the rest.

### Differences in the console run

TC-01 to TC-25:

- **TC-10**: on a phone Staff Kanban sits in the tab bar's Build sheet (the console keeps four tabs), so the check is that Build is the current tab.
- **TC-13**: a reload re-seeds the stubbed database, so persistence is checked as the document written: link, mention (by email), the screenshot as a Storage URL uploaded under `kanban/PH-20/`, table and callout; a notification is written for the mentioned person.
- **TC-16b** (console only): a ticket the board isn't holding (closed long ago) is still found, through the server-side `searchTokens` query.
- **TC-21**: photos are the console's own (Profile → Upload photo; admins in Settings → Team & agent access), so the check is Rob's photo on the profile button, cards and chip, and a photo arriving from another person appearing without a reload.
- **TC-23**: the Agent Board is the console's real board; Back returns to it; on a phone and a narrow tablet the menu is the Build sheet or the hamburger.
- **TC-25** (and the swipe in TC-52): a real swipe is Chromium-only; in WebKit the carousel is scrolled by script.

TC-26 onwards:

- **TC-26 to TC-28**: the prototype keeps a 160 px JPEG data URL in its own state and shows an error toast; the console puts a 256 px JPEG in Storage at `avatars/<email>.jpg`, writes `photoUrl` on the member's row, and shows the error under the profile menu. The console's crop is checked by running `avatarBlobFromFile` on the same bytes.
- **TC-27**: the console falls back to the Google photo, then the initial; the prototype has no Google account, and Remove goes straight to the initial.
- **TC-29**: the prototype has no roles; the "editor and viewer cannot" half is console only. The rules refusing the write are tested in `avatar-rules.test.mjs`.
- **TC-30, TC-31, TC-44, TC-56, TC-57, TC-58**: console only (the prototype has no directory, server, roles or second session). They are skipped there, with the reason, in the run output.
- **TC-34**: the prototype accepts a negative estimate (`-2h` is read as 2h); the console refuses it. Raised as a question.
- **TC-36**: "two sessions" is simulated in the console by a write from the second session into the in-memory database; the prototype checks only that a deleted key is not reused.
- **TC-38**: the console uploads to Storage and refuses over 100 MB; the prototype lists name and size only.
- **TC-41**: the console's Label filter lists the labels in use; the prototype's is a fixed list.
- **TC-45d, TC-44 (server half)**: `kanban-mcp.test.js`, against the real MCP server with stubbed SDKs.
- **TC-48**: the second session is a second page in the same browser (prototype); in the console the stored `rank` order is checked.
- **TC-63**: the bell is console only (KB-C2, KB-C2b, KB-C2c, KB-C2d); the prototype shows toasts. Fan-out and MCP are in `backlog-tracker/test/kanban-mcp.test.js`.

### Console-only cases

| ID | Covers | Steps | Expected |
|---|---|---|---|
| KB-C1 | §2 roles, §13 security (every profile) | Sign in as a viewer; drag; open a ticket; open settings | No + New task; drag does nothing; no Save or Delete; fields disabled; nothing written; settings locked |
| KB-C2 | KB-MOD-3 | A mention of Rob is waiting; open the bell; click it | Unread count 1; "Huy mentioned you in a comment on PH-20"; opens PH-20; marked read |
| KB-C3 | KB-MOD-2 | The console has a Claude key (stubbed answer); Record task | Claude's title, release, epic, estimate and flag fill the form instead of the local stand-in's |
| KB-C2b | KB-MOD-3 | As KB-C2 on a phone: where is the panel? | The panel is inside the window. **Known defect**: on a phone it opens 32 px off the left edge |
| KB-C4 | KB-REP-1, KB-NAV-1 | Open `#staff-kanban/report?release=4-13`; back to the board | The report for PH 4.13; title "Release report"; the hash follows |
| KB-C5 | KB-NAV-1 | (Runs once, Chromium.) iPad 820x1180 and 1180x820 with touch: open the menu, tap Staff Kanban; open + New task | The board opens (`#staff-kanban`); the Record task dot is a 44 px circle with nothing overflowing |
| KB-C6 | KB-NAV-1 | (Runs once, Chromium.) iPad 1210x696 with touch: send pointerdown and pointerup on Staff Kanban with no click (what Chrome on Rob's iPad did, 21 Oct 2026); then tap it normally | The board opens from the touch alone, clicked once by the menu's touch fallback; a normal tap still clicks exactly once |
| KB-C7 | KB-MOD-2, KB-MOD-4a | Android user agent; + New task, Record task; the stub recogniser says "add a new Epic to the board", then "Jack Johnson", as Android does (each guess the whole utterance so far) | Live transcript "add a new Epic to the board Jack Johnson", each phrase once; no session runs in continuous mode; the agent's description has no repeats |
| KB-C8 | KB-MOD-4, KB-MOD-4a | Desktop user agent (Android with "Desktop site" on); open PH-23, comment mic; the recogniser sends every guess as a final in continuous mode | The comment box reads "Add a new Epic to the board Jack Johnson"; the first session is continuous, the next is not |

Server side, `backlog-tracker/test/kanban-mcp.test.js` covers KB-MCP-1 (every
tool over JSON-RPC as an editor and a viewer, keys from the counter, the
testing hand-off, mentions, audit), the member directory and the agent fill;
`backlog-tracker/test/kanban-rules.test.js` covers the Firestore rules in the
emulator (keys never reused, viewers read only, admins alone change settings,
the activity log is append-only, mentions private to their recipient).

## Manual checks (not automatable here)

| ID | Covers | Check |
|---|---|---|
| M-1 | KB-MOD-3 | Screen recording: record a window, stop sharing, the video plays in the ticket (Chrome / Edge / Firefox desktop) |
| M-2 | KB-MOD-2, KB-MOD-4 | Real speech recognition in Chrome, Edge and Safari (iOS and macOS); blocked-microphone message |
| M-3 | KB-BOARD-3 | Real-device drag on iOS Safari and Android Chrome |
| M-4 | §13 | Keyboard-only pass: board, Filters menu, picker, modal |

## Still to check on the live console

Storage rules (`kanban/…` uploads) and Claude's real answers can't be run in
CI: check an upload and a Record task once the console has deployed, with
the manual checks above (ticket "Run the Staff Kanban manual checks M-1 to M-4").

## Self-healing CI loop

These suites run on every deployment train that changes `backlog-tracker/` or
`kanban-staff-board/` (any project's). A failing case is raised automatically as
an "E2E auto-fix" bug carrying the case id and viewport, built onto the same
train, and the suite re-runs until green; three failed fixes for one case flag it
for Rob. Only the merge to main waits for green. See
`backlog-tracker/README.md` → "Self-healing Staff Kanban E2E loop".
