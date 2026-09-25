// scripts/seeding-requested.js: the two insert-only deploy seeds
// (seed-faq-data.js, migrate-artifact-data.js) run only when a person
// asked — a manual "Run workflow" of deploy-backlog-tracker.yml with its
// `seed` box ticked, or SEED_DATA=1 by hand. In particular the dispatch
// run-backlog-automation.js makes after every merge is a workflow_dispatch
// WITHOUT that input, and must not seed: that is the run that kept
// resurrecting deleted help-centre articles (XFeVboxWduEPT2zGcj8y) after a
// step-level `if:` on the event name alone had "fixed" it.
//
// Run with:  node test/seeding-requested.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { seedingRequested } = require("../scripts/seeding-requested");

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (err) { failures.push([name, err]); console.log(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
}

function eventFile(payload) {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "seeding-requested-test-")), "event.json");
  fs.writeFileSync(p, JSON.stringify(payload));
  return p;
}

test("outside Actions: only SEED_DATA=1 seeds", () => {
  assert.strictEqual(seedingRequested({}).requested, false);
  assert.strictEqual(seedingRequested({ SEED_DATA: "1" }).requested, true);
  assert.strictEqual(seedingRequested({ SEED_DATA: "true" }).requested, false, "exactly 1, nothing looser");
});

test("a push-triggered deploy never seeds", () => {
  const r = seedingRequested({ GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "push", GITHUB_EVENT_PATH: eventFile({}) });
  assert.strictEqual(r.requested, false);
  assert.match(r.reason, /push/);
});

test("the pipeline's own post-merge dispatch (no seed input) never seeds", () => {
  for (const inputs of [undefined, {}, { seed: "false" }, { seed: false }]) {
    const r = seedingRequested({ GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_EVENT_PATH: eventFile({ inputs }) });
    assert.strictEqual(r.requested, false, JSON.stringify(inputs));
    assert.match(r.reason, /seed box/);
  }
});

test("a manual dispatch with the seed box ticked seeds (string or boolean true, as GitHub may send either)", () => {
  for (const seed of ["true", true]) {
    const r = seedingRequested({ GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_EVENT_PATH: eventFile({ inputs: { seed } }) });
    assert.strictEqual(r.requested, true, String(seed));
  }
});

test("an unreadable event payload is treated as not requested", () => {
  const r = seedingRequested({ GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_EVENT_PATH: "/nonexistent/event.json" });
  assert.strictEqual(r.requested, false);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
