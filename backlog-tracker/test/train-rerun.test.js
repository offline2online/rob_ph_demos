// A failed train test is re-run once before anyone acts on it, and the notes
// name whose commit failed.
//
// Drives the REAL exports with an injected `gh` — no network.
// Run with:  node test/train-rerun.test.js
"use strict";
const assert = require("assert");
const { trainRunVerdict, culpritAction, rerunTrainRun, trainFailureNotes, flakyPassKey, flakyNote } = require("../scripts/run-backlog-automation.js");

let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`  ok  ${name}`); }
const run = (status, conclusion, attempt) => ({ id: 7, status, conclusion, attempt });

test("trainRunVerdict covers every status, conclusion and attempt", () => {
  assert.strictEqual(trainRunVerdict(null), "none");
  assert.strictEqual(trainRunVerdict(run("in_progress", "", 1)), "running");
  assert.strictEqual(trainRunVerdict(run("queued", null, 2)), "running");
  assert.strictEqual(trainRunVerdict(run("completed", "success", 1)), "passed");
  assert.strictEqual(trainRunVerdict(run("completed", "success", 2)), "passed");
  for (const c of ["failure", "timed_out", "startup_failure"]) {
    assert.strictEqual(trainRunVerdict(run("completed", c, 1)), "rerun", c);
    assert.strictEqual(trainRunVerdict(run("completed", c, 2)), "failed", c);
    assert.strictEqual(trainRunVerdict(run("completed", c, 3)), "failed", c);
  }
  assert.strictEqual(trainRunVerdict({ status: "completed", conclusion: "failure" }), "rerun"); // no attempt: the first
  for (const c of ["cancelled", "skipped", "neutral", "action_required"]) assert.strictEqual(trainRunVerdict(run("completed", c, 1)), "none", c);
});

test("rerunTrainRun calls exactly gh run rerun <id> --repo <repo> --failed, once per run per sweep", () => {
  const calls = [];
  const gh = (args) => { calls.push(args.join(" ")); return ""; };
  assert.strictEqual(rerunTrainRun(1001, gh), true);
  assert.strictEqual(rerunTrainRun("1001", gh), true);
  assert.deepStrictEqual(calls, ["run rerun 1001 --repo offline2online/rob_ph_demos --failed"]);
});

test("a throwing gh returns false and does not throw", () => {
  assert.strictEqual(rerunTrainRun(1002, () => { throw new Error("HTTP 403"); }), false);
});

test("culpritAction: rerun on attempt 1, eject on attempt 2, wait while running", () => {
  assert.strictEqual(culpritAction(run("completed", "failure", 1)), "rerun");
  assert.strictEqual(culpritAction(run("completed", "failure", 2)), "eject");
  assert.strictEqual(culpritAction(run("in_progress", "", 2)), "wait");
  assert.strictEqual(culpritAction(run("completed", "success", 2)), "wait");
});

const A = "a".repeat(40), B = "b".repeat(40), MERGE = "c".repeat(40);
const cards = () => [
  { id: "cardA", title: "Ticket A", deployCommit: A },
  { id: "cardB", title: "Ticket B", deployCommit: B, deployCommits: [B] },
];
const base = { workflow: "e2e-quick.yml", label: "DSP tests (e2e-quick)", url: "https://gh/run/1" };

test("trainFailureNotes: the owner is told it is theirs, the others whose it is", () => {
  const notes = trainFailureNotes({ ...base, sha: A, cards: cards(), afterRerun: true });
  const own = notes.find((n) => n.id === "cardA").text;
  const other = notes.find((n) => n.id === "cardB").text;
  assert.ok(own.includes("FAILED on this ticket's own commit aaaaaaa (it failed again when re-run)"), own);
  assert.ok(own.includes("use Failed testing"), own);
  assert.ok(other.includes("not this ticket's change") && other.includes("Ticket A (cardA)"), other);
  assert.ok(other.includes("Nothing to do on this ticket"), other);
});

test("trainFailureNotes: an owner sent back gets no notes for anyone", () => {
  assert.deepStrictEqual(trainFailureNotes({ ...base, sha: "d".repeat(40), cards: cards(), ownerId: "gone" }), []);
});

test("trainFailureNotes: no owner gives every card the generic text", () => {
  const notes = trainFailureNotes({ ...base, sha: MERGE, cards: cards() });
  assert.strictEqual(notes.length, 2);
  for (const n of notes) assert.ok(n.text.includes("not any ticket's own commit (a merge of main or a revert)"), n.text);
});

test("trainFailureNotes: a card that already holds the workflow@sha key gets nothing", () => {
  const c = cards();
  c[1].testsFailedShas = [`e2e-quick.yml@${A}`];
  const notes = trainFailureNotes({ ...base, sha: A, cards: c });
  assert.deepStrictEqual(notes.map((n) => n.id), ["cardA"]);
});

const passedOnRerun = { id: 9, status: "completed", conclusion: "success", attempt: 2, headSha: A, url: "https://gh/run/9" };

test("flaky pass: attempt 2 success with a :rerun key gives one note, a second sweep none", () => {
  const card = { id: "cardA", deployCommit: A, trainTestReruns: [`e2e-quick.yml@${A}:rerun`] };
  const key = flakyPassKey(card, "e2e-quick.yml", passedOnRerun);
  assert.strictEqual(key, `e2e-quick.yml@${A}:flaky`);
  const text = flakyNote("DSP tests (e2e-quick)", A, passedOnRerun.url);
  assert.ok(text.startsWith("Passed on re-run: DSP tests (e2e-quick) failed on this ticket's commit aaaaaaa"), text);
  card.trainTestReruns.push(key);
  assert.strictEqual(flakyPassKey(card, "e2e-quick.yml", passedOnRerun), null);
});

test("flaky pass: attempt 2 success without the key (a person re-ran it) gives none", () => {
  assert.strictEqual(flakyPassKey({ id: "cardA", deployCommit: A }, "e2e-quick.yml", passedOnRerun), null);
  assert.strictEqual(flakyPassKey({ id: "cardA", trainTestReruns: [`e2e-quick.yml@${A}:rerun`] }, "e2e-quick.yml", { ...passedOnRerun, attempt: 1 }), null);
});

console.log(`\n${passed} passed`);
