// Tests the REAL public/js/rejection-summary.js — one line per time a ticket
// was sent back, and why. Plain ESM, no Firebase, no DOM.
// Run with:  node test/rejection-summary.test.mjs
import assert from "node:assert/strict";
import { rejectionsOf, rejectionSummaryHTML, lastRejectionLine } from "../public/js/rejection-summary.js";

// NBQ1scD9GFEr6YbQxSYX's real thread (20 Oct 2026), abridged: two automatic
// send-backs from before failure summaries, among build and landing notes.
const legacy = [
  { author: "rob@offline2online.com", text: "Filed from rob@offline2online.com's agent via MCP.", at: "2026-10-20T22:25:04.208Z" },
  { author: "claude", text: "Built the voice-first New item modal. Record item button on top…", at: "2026-10-20T22:35:50.000Z" },
  { author: "backlog-automation", text: "The console tests failed on this ticket's own commit a19b508 (https://x/1). Re-running it once to rule out a flaky test before anything is sent back. Nothing to do yet.", at: "2026-10-20T22:40:20.584Z" },
  { author: "backlog-automation", text: "Sent back automatically (Failed testing [tests]): console tests (firestore-rules-test.yml) failed on this ticket's own commit a19b508 while everything before it on deploy/backlog-tracker-faqs passed: https://x/1 (it failed again when re-run). Its commits are being reverted off the train.", at: "2026-10-20T22:44:13.932Z" },
  { author: "backlog-automation", text: "Taken off the train: reverted its commit (a19b508)…", at: "2026-10-20T22:44:44.895Z" },
  { author: "backlog-automation", text: "Sent back automatically (Failed testing [tests]): console tests (firestore-rules-test.yml) failed on this ticket's own commit fa303a1 while everything before it on deploy/backlog-tracker-faqs passed: https://x/2 (it failed again when re-run). It was already rebuilt once automatically; a person needs to look at it.", at: "2026-10-20T22:56:43.834Z" },
];
const r1 = rejectionsOf(legacy);
assert.equal(r1.length, 2, "only the two send-backs, not the re-run or revert notes");
assert.equal(r1[0].at.toISOString(), "2026-10-20T22:56:43.834Z", "newest first");
assert.equal(r1[0].line, "console tests failed (no detail recorded; the run is linked in the comment)");
assert.equal(r1[0].who, "automation");

// The new automatic note carries its Why: line.
const auto = { author: "backlog-automation", at: "2026-10-21T09:00:00Z",
  text: "Sent back automatically (Failed testing [tests]): Why: deployment train tests: START-HERE.md: the deploy map names every top-level folder — the deploy map in START-HERE.md does not name kanban-staff-board/\nconsole tests (firestore-rules-test.yml) failed on this ticket's own commit abc1234 while everything before it on deploy/x passed and main without it passes: https://x/3 (it failed again when re-run). Its commits are being reverted." };
assert.equal(rejectionsOf([auto])[0].line, "deployment train tests: START-HERE.md: the deploy map names every top-level folder — the deploy map in START-HERE.md does not name kanban-staff-board/");

// A person's Failed testing and Eject from train: category + first sentence.
const person = { author: "viewer", at: "2026-10-21T10:00:00Z", text: "Failed testing [Visual or layout issue]: The Record button overlaps the title on a phone. Also the timer jumps." };
const eject = { author: "rob@offline2online.com", at: "2026-10-21T11:00:00Z", text: "Ejected from train [Broke something else (regression)]: Quick comments stopped saving" };
const r2 = rejectionsOf([person, eject]);
assert.deepEqual(r2.map((r) => [r.kind, r.who, r.line]), [
  ["ejected", "rob@offline2online.com", "Broke something else (regression): Quick comments stopped saving"],
  ["sent-back", "a tester", "Visual or layout issue: The Record button overlaps the title on a phone"],
]);

// Held for a red main (the automation's own note, mainIsAlsoRed).
const held = { author: "backlog-automation", at: "2026-10-21T12:00:00Z",
  text: "Not sent back: main is broken, not this ticket. The console tests fail the same way on main without this ticket (ccccccc: https://gh/run/30): deployment train tests: x — y. It stays where it is. Fix main; the train then takes main and re-tests this ticket by itself." };
assert.deepEqual(rejectionsOf([held]).map((r) => [r.kind, r.line]), [["held", "main is broken: deployment train tests: x — y"]]);

// The HTML: nothing for a ticket never sent back; a headline with the count
// and the latest why; one row per rejection when there is more than one.
assert.equal(rejectionSummaryHTML({ notes: legacy.slice(0, 3) }), "");
assert.equal(rejectionSummaryHTML(null), "");
const html = rejectionSummaryHTML({ notes: [...legacy, auto] });
assert.match(html, /<b>Sent back 3×<\/b>/);
assert.match(html, /does not name kanban-staff-board\//);
assert.equal((html.match(/<li>/g) || []).length, 2, "the two earlier ones; the latest is the headline");
assert.match(html, /material-symbols-outlined/);
assert.match(rejectionSummaryHTML({ notes: [...legacy, held] }), /<b>Held, not sent back \(sent back 2× before\)<\/b>/);
assert.ok(!/<ol/.test(rejectionSummaryHTML({ notes: [person] })), "one rejection: just the headline");
assert.ok(!rejectionSummaryHTML({ notes: [{ author: "viewer", text: "Failed testing [Other]: <img src=x onerror=alert(1)>", at: "2026-10-21T10:00:00Z" }] }).includes("<img"), "escaped");

// The Backlog card's one line: the stored summary first.
assert.equal(lastRejectionLine({ lastFailureReason: { summary: "auth-gate: app.js is held back", text: "long" }, notes: legacy }), "auth-gate: app.js is held back");
assert.equal(lastRejectionLine({ lastFailureReason: { text: "x" }, notes: legacy }), "console tests failed (no detail recorded; the run is linked in the comment)");
assert.equal(lastRejectionLine({ lastFailureReason: { text: "Doesn't save. At all." }, notes: [] }), "Doesn't save");

console.log("rejection-summary: all assertions passed");
