# Staff Kanban — End-to-end run across the viewport matrix, 21 Oct 2026

Both suites, every case (TC-01 to TC-66, KB-C1 to KB-C5), in every profile of the matrix. This sits beside
[`E2E-REPORT-2026-10-21-console.md`](E2E-REPORT-2026-10-21-console.md) (desktop 1440 only, 30 cases), which stays as it was.

## Result

**Prototype: 6 of 6 Chromium profiles pass. Console: 5 of 6 pass; one failure was a timing race in the test itself, fixed and re-run, not re-run as a full matrix (see below).
Firefox and WebKit were not run: neither engine is installed in the environment that produced this report.** 5 of the 11 profiles of the matrix
(`desktop-1440-firefox`, `desktop-1440-webkit`, `tablet-l-webkit`, `tablet-p-webkit`, `phone-390-webkit`) have therefore not been run anywhere yet. They print
`NOT RUN` and are never counted as passes. Run `npx playwright install chromium firefox webkit` and `npm test` to complete them.

| Profile | Prototype | Console |
|---|---|---|
| Desktop 1440×900 · mouse · Chromium | Pass: 62 passed, 6 skipped, 212 s | Pass: 68 passed, 252 s (1 flaky pass on retry: TC-34) |
| Desktop 1024×768, sidebar open · mouse · Chromium | Pass: 62, 6 skipped, 224 s | Pass: 68, 260 s |
| Tablet landscape 1024×768 · touch · Chromium | Pass: 66, 6 skipped, 321 s | Pass: 72, 365 s |
| Tablet portrait 768×1024 · touch · Chromium | Pass: 64, 6 skipped, 317 s | **TC-34 failed**, 69 passed, 361 s |
| Phone 390×844 · touch · Chromium | Pass: 62, 6 skipped, 373 s | Pass: 69, 405 s |
| Phone small 360×740 · touch · Chromium | Pass: 62, 6 skipped, 357 s | Pass: 69, 394 s |
| Desktop 1440 Firefox; desktop 1440, tablet landscape, tablet portrait and phone 390 WebKit | **Not run** (engine not installed) | **Not run** |

The skipped prototype cases are the console-only ones (TC-30, TC-31, TC-44, TC-56, TC-57, TC-58), skipped with their reason.
A full matrix takes about 10 minutes with 4 profiles in parallel on 4 cores. Server side: `kanban-mcp.test.js` 21 / 21 (TC-45d: all 42 moves through `kanban_move_task`; TC-44 server half).

**The console TC-34 failure.** On tablet portrait the card still read "No estimate" when the test looked, a moment before the write showed on the board (and the
validation message was read before it was drawn). The case now waits for both. It then passed three times in a row on that profile. The full
matrix was **not** re-run after that change, so the console column above is the run before the fix. Everything else in the console column passed on the first attempt apart from the retried TC-34 on desktop 1440.

## What the suite found

**Known defects** (cases that assert the correct behaviour and are reported rather than failed until fixed; they are not failures of the run):

| Case | Defect | Seen in |
|---|---|---|
| TC-38b, TC-39b | Opening a ticket adds another "Remove" click handler to the form, so after N opens, removing one attachment or link removes N. Reproduced by hand in the prototype: one remove after reopening dropped two of three attachments | Prototype and console |
| KB-C2b | On a phone the mentions bell panel opens 32 px off the left edge (390 px wide: from −32 to 326) | Console |

**Questions raised for a decision ("Expected: confirm").** Each is printed as `CONFIRM` by the run and listed on the ticket:

1. TC-34: a negative estimate. The prototype accepts `-2h` as 2h; the console refuses it.
2. TC-38: can an attachment be opened, and what is the size limit (prototype: none; console: 100 MB)?
3. TC-39: should a link show on both tickets, with the reverse type? Today only on the ticket it was added to.
4. TC-41: should a label created on a ticket appear in the Label filter? The prototype's list is fixed; the console's isn't.
5. TC-43: should the activity log record edits other than Status? Today it doesn't.
6. TC-47: who holds an unassigned ticket after Ready for Testing, and a ticket that leaves Ready for Testing to Approved, Backlog or closed? Today the tester keeps it.
7. TC-50: should Esc cancel a drag? Today it doesn't.
8. TC-51, TC-45b, TC-48, TC-49: when the last column is off screen (≤ 1240 px wide, or a phone), the Completed/Withdrawn targets are pinned over the right edge (the bottom of the screen on a phone), and the board only auto-scrolls when the pointer is not over them. So by touch you cannot drag to the columns that sit under them, cannot scroll right while dragging, and on a phone cannot scroll down. Per run, 3 to 10 of the 42 moves could not be dragged on tablets and phones and were made by the Status menu.
9. TC-53: after a Status-menu move on a phone, should the carousel stay or follow the card (today it stays)? And a card picked up in the lower part of a phone screen sits under the Completed target: letting go without moving **completes it**. Intended?
10. TC-54: what should dropping a card onto a collapsed lane do? (Tablet and desktop: not possible. Phone: it drops.)
11. TC-56: two people moving one card at once: the later write wins today.
12. TC-65: rotating a device mid-drag carries the drag on; where the card lands is up to where the finger is.

## Scope and honesty notes

- **Touch.** Chromium profiles use real touch events (DevTools protocol). WebKit and Firefox have no equivalent here, so there the same pointer events a finger produces are sent to the page; native scrolling is only exercised on Chromium (TC-25, TC-52).
- **On a phone**, TC-45b makes the closing-target moves by touch and all other columns by the Status menu, as the ticket's TC-53 says.
- **Two sessions** (TC-36, TC-56) and **MCP changes** (TC-44) in the console suite are simulated by writing the second session's or the server's documents into the in-memory database the page listens to; the real server is covered by `kanban-mcp.test.js`.
- **Not covered**: real Storage and Firestore rules (rules tests exist: `kanban-rules.test.js`, `avatar-rules.test.mjs`), real speech, real devices (M-1 to M-4), Firefox and WebKit as above.
- **Retries.** A failed case is run once more; a pass on the retry is printed `FLAKY` (one in each suite, both TC-34 on first sight).
