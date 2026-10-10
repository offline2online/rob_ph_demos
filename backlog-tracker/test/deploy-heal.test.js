// A transient backlog-tracker deploy failure heals itself (10 Oct 2026).
//
// PR #359 merged, its deploy-backlog-tracker.yml run (38087481082) failed on
// a one-off "Failed to make request to https://firestore.googleapis.com", and
// both cards on the train sat at "Deploy failure" until a person re-ran it.
// healFailedDeploy decides what the automation does about a failed run:
// adopt a newer successful deploy of main, wait for a newer one still going,
// re-run the failed run once if it is still the newest, else report it.
//
// Drives the REAL function with an injected `gh` — no network.
// Run with:  node test/deploy-heal.test.js
"use strict";
const assert = require("assert");
const { healFailedDeploy } = require("../scripts/run-backlog-automation.js");

function fakeGh({ attempt = 1, runs = [] }) {
  const calls = [];
  const gh = (args) => {
    calls.push(args.join(" "));
    if (args[0] === "run" && args[1] === "view") return JSON.stringify({ createdAt: "2026-10-10T21:24:08Z", attempt });
    if (args[0] === "run" && args[1] === "list") return JSON.stringify(runs);
    if (args[0] === "run" && args[1] === "rerun") return "";
    throw new Error(`unexpected gh ${args.join(" ")}`);
  };
  return { gh, calls, reruns: () => calls.filter((c) => c.startsWith("run rerun")) };
}
const self = { databaseId: 100, url: "u/100", createdAt: "2026-10-10T21:24:08Z", status: "completed", conclusion: "failure" };

let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`  ok  ${name}`); }

test("the newest failed run is re-run once, and only once for a whole train", () => {
  const f = fakeGh({ runs: [self] });
  const cache = new Map();
  assert.strictEqual(healFailedDeploy("100", cache, f.gh).action, "rerun");
  assert.strictEqual(healFailedDeploy("100", cache, f.gh).action, "rerun"); // the train's second card
  assert.deepStrictEqual(f.reruns(), ["run rerun 100 --repo offline2online/rob_ph_demos --failed"]);
});

test("a run that already failed its re-run is reported, not re-run again", () => {
  const f = fakeGh({ attempt: 2, runs: [self] });
  assert.strictEqual(healFailedDeploy("100", new Map(), f.gh).action, "report");
  assert.deepStrictEqual(f.reruns(), []);
});

test("a newer successful deploy of main is adopted — main is cumulative", () => {
  const newer = { databaseId: 101, url: "u/101", createdAt: "2026-10-10T22:00:00Z", status: "completed", conclusion: "success" };
  const f = fakeGh({ runs: [newer, self] });
  const v = healFailedDeploy("100", new Map(), f.gh);
  assert.strictEqual(v.action, "adopt");
  assert.strictEqual(v.run.url, "u/101");
  assert.deepStrictEqual(f.reruns(), []);
});

test("an older run is never re-run over a newer deploy still going", () => {
  const newer = { databaseId: 101, url: "u/101", createdAt: "2026-10-10T22:00:00Z", status: "in_progress", conclusion: "" };
  const f = fakeGh({ runs: [newer, self] });
  assert.strictEqual(healFailedDeploy("100", new Map(), f.gh).action, "wait");
  assert.deepStrictEqual(f.reruns(), []);
});

test("an older run is never re-run when a newer deploy also failed", () => {
  const newer = { databaseId: 101, url: "u/101", createdAt: "2026-10-10T22:00:00Z", status: "completed", conclusion: "failure" };
  const f = fakeGh({ runs: [newer, self] });
  assert.strictEqual(healFailedDeploy("100", new Map(), f.gh).action, "report");
  assert.deepStrictEqual(f.reruns(), []);
});

test("a gh error reports the failure rather than guessing", () => {
  const gh = () => { throw new Error("HTTP 502"); };
  assert.strictEqual(healFailedDeploy("100", new Map(), gh).action, "report");
});

console.log(`\n${passed} passed, 0 failed`);
