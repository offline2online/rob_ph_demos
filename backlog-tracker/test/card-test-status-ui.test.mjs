// Tests the REAL public/js/card-test-status.js — plain ESM, no Firebase, no DOM.
// Run with:  node test/card-test-status-ui.test.mjs
import assert from "node:assert/strict";
import { currentTrainTest, trainTestChip, trainTestChipHTML, approvalWarningLines, approvalFields, approvedByLine, APPROVAL_WARNING_TITLE } from "../public/js/card-test-status.js";

const SHA = "a".repeat(40);
const card = (state, extra = {}, wf = {}) => ({
  id: "c", title: "T-" + state, status: "ready-for-testing", deployCommit: SHA,
  trainTest: { sha: SHA, state, since: "2026-10-19T10:00:00.000Z", workflows: [{ workflow: "firestore-rules-test.yml", label: "console tests", state, runUrl: "https://github.com/o/r/actions/runs/9", since: "2026-10-19T10:00:00.000Z", ...wf }] },
  ...extra,
});

// chip text, icon and link for each state
const expect = {
  "starting": ["Tests starting", "hourglass_empty", ""],
  "running": ["Tests running", "hourglass_top", ""],
  "passed": ["Tests passed", "check_circle", ""],
  "failed": ["Tests failed — view run", "error", "https://github.com/o/r/actions/runs/9"],
  "not-run": ["Tests not run — open", "do_not_disturb_on", "https://github.com/o/r/actions/runs/9"],
  "not-applicable": ["No train tests", "", ""],
};
for (const [state, [label, icon, href]] of Object.entries(expect)) {
  const c = trainTestChip(card(state));
  assert.equal(c.label, label, state); assert.equal(c.icon, icon, state); assert.equal(c.href, href, state);
}
const html = trainTestChipHTML(card("failed"));
assert.match(html, /material-symbols-outlined">error</); assert.match(html, /review-flag/); assert.match(html, /Tests failed — view run ↗/);
assert.match(html, /href="https:\/\/github.com\/o\/r\/actions\/runs\/9"/);
assert.match(trainTestChipHTML(card("running")), /^<span /, "no link, no anchor");
// the hover lists each workflow, its state and since when
assert.match(trainTestChip(card("running")).title, /console tests: running since 2026-10-19 10:00 UTC/);

// https links only
assert.equal(trainTestChip(card("failed", {}, { runUrl: "javascript:alert(1)" })).href, "");
assert.equal(trainTestChip(card("failed", {}, { runUrl: "http://x.test/run" })).href, "");
// not-run with no run → the workflow's Actions page
assert.equal(trainTestChip(card("not-run", {}, { runUrl: "" })).href, "https://github.com/offline2online/rob_ph_demos/actions/workflows/firestore-rules-test.yml");

// no chip on a Backlog card or for a stale sha
assert.equal(trainTestChip(card("passed", { status: "backlog" })), null);
assert.equal(trainTestChipHTML(card("passed", { status: "published-live" })), "");
assert.equal(trainTestChip(card("passed", { deployCommit: "b".repeat(40) })), null);
assert.equal(currentTrainTest({ status: "ready-for-testing", deployCommit: SHA }), null);
assert.equal(trainTestChip(card("passed", { status: "ready-to-publish" })).label, "Tests passed");

// the warning list holds only starting, running, failed and not-run tickets
const lines = approvalWarningLines(["starting", "running", "passed", "failed", "not-run", "not-applicable"].map((s) => card(s)));
assert.deepEqual(lines, ["T-starting — tests still running", "T-running — tests still running", "T-failed — tests failed", "T-not-run — tests not run"]);
assert.deepEqual(approvalWarningLines([card("passed"), card("not-applicable"), card("running", { deployCommit: "z" })]), []);
assert.equal(APPROVAL_WARNING_TITLE, "Approve before tests pass?");

// approvedByEmail is lowercased; nothing written without an email
const NOW = { sentinel: true };
assert.deepEqual(approvalFields("Sam@PersonalisationHub.com", NOW), { approvedByEmail: "sam@personalisationhub.com", approvedAt: NOW });
assert.deepEqual(approvalFields(null, NOW), {});

// "Approved by <email>", else approvedVia; time on hover
assert.deepEqual(approvedByLine({ approvedByEmail: "a@b.c", approvedAt: new Date("2026-10-19T10:00:00Z") }), { text: "Approved by a@b.c", title: "Approved 2026-10-19 10:00 UTC" });
assert.equal(approvedByLine({ approvedVia: "dsp-board" }).text, "Approved by dsp-board");
assert.equal(approvedByLine({ approvedByEmail: "a@b.c", approvedVia: "x" }).text, "Approved by a@b.c");
assert.equal(approvedByLine({}), null);
console.log("card-test-status-ui: ok");
