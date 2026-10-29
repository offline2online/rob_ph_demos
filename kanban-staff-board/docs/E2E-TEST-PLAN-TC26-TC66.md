# Staff Kanban — End-to-end test plan, TC-26 to TC-66

Continues [`E2E-TEST-PLAN.md`](E2E-TEST-PLAN.md) (TC-01 to TC-25, console-only cases, viewport matrix, how to run, when these tests run).

## Cases

Written 21 Oct 2026 from the ticket "Staff Kanban: full E2E regression suite across desktop, tablet and phone (TC-26 onwards)".
Each case runs in the whole viewport matrix unless its "On" column says otherwise. "Both" means the prototype and
the console run it; "Console" means only the console has the feature.

**Profile and photos (KB-PPL-1/2, KB-SET-2)**

| TC | Covers | On | Steps | Expected |
|---|---|---|---|---|
| TC-26 | KB-PPL-2 | Both | Upload your own photo as JPG, PNG and WebP (phone: Profile tab → Upload photo); then look everywhere a person appears | Stored as a square crop; shown on the profile button, the filter chip, cards, the lane header, comments, the @mention list, the release report and Settings → Team |
| TC-27 | KB-PPL-2 | Both | Replace the photo; remove it | The new photo replaces the old everywhere. After Remove: the Google photo where there is one (console), then the initial |
| TC-28 | KB-PPL-2 | Both | Upload a text file, an 11 MB image and a corrupt "PNG" | A clear message for each ("not an image", "over 10 MB", "couldn't be read"); the photo is unchanged and nothing is written to Storage or the member directory |
| TC-29 | KB-SET-2 | Both; roles console only | An admin sets another member's photo (prototype: Settings → Team; console: Settings → Team & agent access). An editor and a viewer open the same page | The member's chip shows the photo. For an editor and a viewer the control is not there (the rules refusing the write are tested in `avatar-rules.test.mjs`) |
| TC-30 | KB-PPL-1 | Console | An admin changes "Shown as" for Lê Quang Huy in Kanban settings | The new name is on cards, the filter chip, the assignee list, the @mention list and the report; Vietnamese names render and sort (Đ with D, ả with a); clearing the box goes back to the first word of the full name |
| TC-31 | KB-PPL-1 | Console | A member is added to the directory while the board is open; later they're disabled | A chip and an assignee option appear without a reload. Disabled: gone from both, still named on the tickets they hold |

**Create and edit tickets (KB-TASK, KB-MOD)**

| TC | Covers | On | Steps | Expected |
|---|---|---|---|---|
| TC-32 | KB-TASK-2/3, KB-MOD-1 | Both | Turn every optional field on in Settings. Create a Task, a Bug and an Epic with every field filled (priority, assignee, release, sprint, estimate, time logged, due date, labels, a link, a description, a parent epic, an attachment). Reopen each | Every value is kept; the card shows the type and remaining estimate and the attachment count; the label filter finds all three; the release report lists the task and the bug, not the epic |
| TC-33 | KB-SET-1, KB-MOD-1 | Both | New task with the default settings; open an existing ticket | Sprint, Due date, Labels, Attachments and Linked tickets aren't on Create. On Edit they sit under "5 more fields" and can still be set and saved |
| TC-34 | KB-BOARD-1 | Both | Create with estimates `1d 4h`, `6h`, `30m`, `0`; save `soon`; save a negative; log more than the estimate | The card reads 1d 4h / 6h / 30m left and "No estimate"; invalid text is refused with the format shown; time logged over the estimate leaves 0 remaining, never a negative; the column header's effort moves when a ticket is added. **Expected: confirm** for the negative |
| TC-35 | KB-MOD-1 | Both | New task with a title and description; Cancel, then Esc, then a click outside | No ticket is created each time; the next ticket takes the next key (PH-40), so the counter did not move |
| TC-36 | KB-TASK-1 | Both; two sessions console | (Console) while session A's form is open, session B takes PH-40; A saves. Delete the newest ticket, create another | A gets PH-41 (a distinct key). The next key is higher than the deleted one: keys are never reused |
| TC-37 | KB-TASK-7 | Both | Open a task, Delete, answer Cancel; Delete again and confirm. Delete epic PH-1 | Cancel keeps it; confirming removes the card. The epic's children stay on the board and no longer show a parent epic |
| TC-38 | KB-TASK | Both | Attach two files, remove one, save; try an over-size file | Count on the card is right; the console stores each in Storage (name, URL and path) and refuses a file over 100 MB with a message. **Expected: confirm** that an attachment can be opened and what the size limit is |
| TC-38b | KB-TASK | Both | Open a ticket twice, then remove one attachment | Exactly one is removed. Fixed 29 Oct 2026: the form's click handler is bound once |
| TC-39 | KB-TASK-5 | Both | Link PH-20 to four tickets with each link type; link it to itself | All four are listed with their type; a ticket can't be linked to itself. The link shows on the other ticket with the reverse type, and removing it from either side removes both |
| TC-39b | KB-TASK-5 | Both | Open a ticket twice, then remove one link | Exactly one is removed. Fixed with TC-38b |
| TC-40 | KB-BOARD-6 | Both | Create a ticket due in 2020 and one due in 2030 | The first reads overdue, the second doesn't; the card shows the due date and the remaining estimate; a completed card shows no due date |
| TC-41 | KB-FLT-1 | Both | Add an existing label and a new one; use the Label filter; search for the label | The label filter and the search find the ticket. **Expected: confirm** that a new label is offered in the filter |
| TC-42 | §13 security | Both | Put `<img onerror>` and `<script>` in the title and the description (typed and pasted as HTML), a comment; use a title of 200 characters with no breaks | Nothing runs; the title is shown as text; pasted HTML is cleaned; the long title wraps inside its column and the modal; no sideways page scroll |
| TC-43 | KB-MOD-3 | Both | Edit every field of PH-20 and save; reopen | Every value is kept; the activity log has the Status line and one line per other changed field with old and new values (e.g. "changed Priority from Medium to Lowest", "assigned to Thao") |
| TC-44 | KB-MCP-1 | Console (server half in `kanban-mcp.test.js`) | A ticket is created, moved and closed by a write the server makes (MCP), while the board is open | The card appears, moves and closes without a reload and the counts follow. `kanban_get_task` returns what a person did on the board (status, priority, activity, comments) |

**Moving tickets (KB-BOARD-1 to 5, KB-LANE-1)**

| TC | Covers | On | Steps | Expected |
|---|---|---|---|---|
| TC-45a | KB-BOARD-3 | Mouse profiles | One ticket (PH-28, 5h) is dragged through all 42 moves between Backlog, Ready for Dev, In Progress, Ready for Testing, Approved for Deployment, Completed and Withdrawn: the circuit visits every ordered pair once | After each move: the card is in the right column and only there; the source count is one lower and the target one higher; the remaining effort moved by 5h; status, resolution, `open`, `closedAt` (console) are right; the activity line reads "From → To"; the toast names the ticket; the assignee follows the testing hand-off |
| TC-45b | KB-BOARD-3 | Touch profiles | The same 42 moves by press-and-hold drag (phone: the closing targets by touch, the other columns by the Status menu, as TC-53 says) | As TC-45a: every move offered by drag can be made by drag (console: asserted; the prototype still lists the moves its full-height targets block) |
| TC-45c | KB-BOARD-2 | All | The same 42 moves by the Status menu in the ticket | As TC-45a |
| TC-45d | KB-MCP-1 | Server (`kanban-mcp.test.js`) | The same 42 moves by `kanban_move_task` | As TC-45a, from the stored document |
| TC-46 | KB-BOARD-2 | All | Close PH-27 as Completed and as Withdrawn, then reopen it into each of the five open columns | Resolution cleared (and `closedAt`, `open` in the console), the struck-through style gone, the title not struck through |
| TC-47 | KB-BOARD-5 | All | Into Ready for Testing: unassigned; already the tester; from each of the other six places. Out: to Approved, Backlog, Completed, Withdrawn | The tester takes it, with "From <developer>" and a toast; if they already hold it nothing is reassigned and there's no chip; back to In Progress returns it to the developer. Also with `kanbanSettings/main` holding no tester or current release (unit: `kanban-core.test.mjs`, `kanban-mcp.test.js`): the tester is Rob, the current release the earliest unreleased by version, and the settings page reads "Not set (… is used)". **Expected: confirm** for unassigned tickets and for leaving to Approved, Backlog or closed |
| TC-48 | KB-BOARD-3 | All | In Ready for Dev drag the bottom card to the top, the top card to the middle and a middle card to the bottom | The order is as dropped; it is kept after a reload and in a second session (prototype), or in the stored `rank` order (console) |
| TC-49 | KB-BOARD-7 | All | Empty Approved for Deployment; drag a card into it. Drag a card to the very bottom of In Progress | Dropped into the empty column; last in the tall one |
| TC-50 | KB-BOARD-4 | All | Drop outside the board; on its own place; cancel the pointer (touch); press Esc | Nothing moves or is logged; the ghost, marker and closing targets go away. Esc ends a drag in progress and the card returns (console: asserted) |
| TC-51 | KB-BOARD-3 | All | Hold a card near the bottom, top, right and left edges | The page scrolls down and up; where the board overflows it scrolls left. Console: the board also scrolls at the right edge, over the closing targets, and on a phone the page scrolls in the strip just above the slim bar |
| TC-52 | KB-BOARD-3 | Touch | Tap a card; swipe up and sideways over it | A tap opens it; a swipe scrolls (real touch on Chromium) and never drags or opens |
| TC-53 | KB-BOARD-4/8 | Phone | Pick a card up; drop on Completed and on Withdrawn; move another by the Status menu | Console: the two targets are a slim bar across the width above the tab bar; both drops work; letting go of a card picked up low on the screen, or sliding along the bar, closes nothing; no sideways page scroll. **Expected: confirm** where the carousel should be after a Status move |
| TC-54 | KB-LANE-1 | All (phone: two lanes) | Select Linh, Huy and Unassigned. Drag across columns inside Linh's lane, then into the Unassigned lane, then onto a collapsed lane | The card is reassigned; lane counts and remaining effort follow. **Expected: confirm** what a collapsed lane does |
| TC-55 | KB-FLT-1 | All | Filter to Huy and move his card to Ready for Testing | The card leaves the view (it is now Rob's); the task count and column counts are right; it is back when the filter is cleared |
| TC-56 | KB-BOARD-3 | Console | While a card is held, another session moves it; the card is dropped | One card; the board shows what is stored; a later move by the other session is followed. **Expected: confirm** who wins |
| TC-57 | §13 | Console | The write is refused (permissions) | The card is back where it was, an error toast says so, nothing is stored |
| TC-58 | §2 roles | Console | A viewer tries to drag a card and change its Status | Nothing moves, Status is locked, nothing is written |
| TC-59 | KB-TASK-7 | All | Complete, withdraw and reopen a child of PH-1 | n/m done and the bar follow; a withdrawn child leaves the total; the epic's modal says the same |

**Board, filters, search, report**

| TC | Covers | On | Steps | Expected |
|---|---|---|---|---|
| TC-60 | KB-FLT-1 | All | Search by key, by title words, by description words and by label; search for nonsense; clear | Matches equal what the data says should match; nonsense shows "0 tasks" and an empty hint in every column; clearing brings all 39 back |
| TC-61 | KB-FLT-1/2 | All | 47 combinations of primary filters (nobody, My tasks, one person, two, Unassigned, a release) with secondary ones (Flagged, Type, Priority, Sprint, Label) and pairs of secondary ones; Clear filters after each; the Release filter on the released PH 4.11 | The cards shown equal the data filtered by the same rules; the Filters button counts the secondary ones; Clear brings every ticket back |
| TC-62 | KB-REP-1 | All | Open the report for PH 4.12 with every status; reload the URL; move PH-33 to Completed and PH-29 to Withdrawn | Outstanding, remaining effort, completed/withdrawn and each person's remaining effort equal the data, before and after; epics aren't listed; the same URL shows the same report |
| TC-63 | KB-NAV-2, KB-MOD-3/4 | All; notifications console | @mention Huy and yourself in a description, Linh and yourself in a comment; assign a ticket to Huy; Huy comments on yours; move one to Ready for Testing; Watch a ticket | The others are told ("Huy notified"); you aren't; (console) one notification per recipient and none for the person who acted: assigned, commented (assignee, reporter, watchers), testing, mention; the bell is in the topbar on every page and groups by ticket; 150 seeded notifications show the newest 30 with the full unread count; over MCP `kanban_list_notifications` lists them and `kanban_mark_notifications_read` clears the badge without a reload |
| TC-64 | KB-BOARD-7, §13 | Tablet | Portrait and landscape: scroll, add swimlanes, open New task with a window half the height (on-screen keyboard) | No sideways page scroll; the filter bar and headers are pinned and line up with the columns; Save and the title stay on screen |
| TC-65 | §13 | Touch | Rotate mid-edit and mid-drag | The form keeps its title, estimate and description and saves; after the drag nothing is left over and there is one card. **Expected: confirm** whether the drag should cancel |
| TC-66 | KB-NAV-1 | All | Report → Settings, Back, Back, Forward, Forward; open the report, settings and board by URL | Each step shows the right page and the URL; deep links open the right page cold |
| TC-68 | KB-TASK-12 | Console | A ticket with 5 acceptance criteria: open it; tick 2; edit, add, move and remove one; another member (MCP) unticks one; create a ticket with 3 criteria | The modal shows the 5 and the card "AC 0/5"; each tick is saved at once with an activity line and the card follows ("AC 2/5"); edits, adds, moves and removals are saved and logged; the open modal and the card follow the other member's untick without a reload; the new ticket is saved with its 3 and shows "AC 0/3". The 51-item and 501-character limits are in `kanban-core.test.mjs`, `kanban-mcp.test.js` and `kanban-rules.test.js` |

Console-only additions to the signed-off set, now in the matrix: KB-C1 to KB-C4 (below). KB-C5 and KB-C6 set their own iPad sizes and run once.

