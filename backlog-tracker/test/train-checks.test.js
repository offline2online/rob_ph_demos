// A train PR merges only once its required checks have PASSED
// (bPcnbXZNC4vFnhft8AMz). PR #292 merged 6 s after opening on the strength of
// a 1-second "WIP" app check, before e2e-quick had registered — run the
// rollup shapes that produced that, and the ones that must still merge.
const assert = require("assert");
const { trainChecksState, REQUIRED_TRAIN_CHECKS } = require("../scripts/run-backlog-automation.js");

const ok = (name) => ({ name, status: "COMPLETED", conclusion: "SUCCESS" });
const cases = [
  ["nothing reported yet", [], "pending"],
  ["only an unrelated app check (PR #292's WIP)", [ok("WIP")], "pending"],
  ["e2e-quick queued", [ok("WIP"), { name: "e2e-quick", status: "QUEUED" }], "pending"],
  ["e2e-quick in progress", [{ name: "e2e-quick", status: "IN_PROGRESS" }], "pending"],
  ["e2e-quick passed", [ok("WIP"), ok("e2e-quick")], "success"],
  ["e2e-quick failed", [ok("WIP"), { name: "e2e-quick", status: "COMPLETED", conclusion: "FAILURE" }], "failure"],
  ["e2e-quick passed but another check failed", [ok("e2e-quick"), { name: "lint", status: "COMPLETED", conclusion: "FAILURE" }], "failure"],
  ["a commit-status context counts too", [{ context: "e2e-quick", state: "SUCCESS" }], "success"],
  ["e2e-quick cancelled by GitHub (no runner) — re-run, not red", [{ name: "e2e-quick", status: "COMPLETED", conclusion: "CANCELLED" }], "infra"],
  ["a real failure beats a cancellation", [{ name: "e2e-quick", status: "COMPLETED", conclusion: "FAILURE" }, { name: "rules", status: "COMPLETED", conclusion: "CANCELLED" }], "failure"],
];
let failed = 0;
assert.deepStrictEqual(REQUIRED_TRAIN_CHECKS, ["e2e-quick"]);
for (const [label, rollup, want] of cases) {
  const got = trainChecksState(rollup);
  if (got === want) console.log(`  ok  ${label}`);
  else { failed++; console.log(`  FAIL ${label}: got ${got}, want ${want}`); }
}

// ── The PR's repeat of a suite the deploy gate already passed (16 Nov 2026) ──
{
  const { withoutGateTestedChecks, workflowDisplayName, trainChecksState: tcs } = require("../scripts/run-backlog-automation.js");
  const rollup = [
    { name: "e2e-quick", workflowName: "e2e-quick", status: "COMPLETED", conclusion: "SUCCESS" },
    { name: "ui-kanban (2)", workflowName: "Rules & MCP server tests", status: "IN_PROGRESS", conclusion: "" },
    { name: "rules", workflowName: "Rules & MCP server tests", status: "COMPLETED", conclusion: "SUCCESS" },
    { name: "personal-email-check", workflowName: "Personal email check", status: "IN_PROGRESS", conclusion: "" },
  ];
  // Nothing passed by the gate: every check counts, as before.
  assert.strictEqual(withoutGateTestedChecks(rollup, []), rollup);
  assert.strictEqual(tcs(rollup), "pending");
  // The console suite passed on the head before the version bump: its repeat is not waited for…
  const left = withoutGateTestedChecks(rollup, ["Rules & MCP server tests", null]);
  assert.deepStrictEqual(left.map((c) => c.name), ["e2e-quick", "personal-email-check"]);
  // …but any other check still is,
  assert.strictEqual(tcs(left), "pending");
  assert.strictEqual(tcs(withoutGateTestedChecks(rollup.slice(0, 3), ["Rules & MCP server tests"])), "success");
  // a red repeat does not park a train whose suite passed on the same content,
  const redRepeat = [rollup[0], { name: "ui-touch (1)", workflowName: "Rules & MCP server tests", status: "COMPLETED", conclusion: "FAILURE" }];
  assert.strictEqual(tcs(redRepeat), "failure");
  assert.strictEqual(tcs(withoutGateTestedChecks(redRepeat, ["Rules & MCP server tests"])), "success");
  // and a required check is never dropped, even when the gate ran its workflow.
  const dsp = [{ name: "e2e-quick", workflowName: "e2e-quick", status: "IN_PROGRESS", conclusion: "" }];
  assert.strictEqual(tcs(withoutGateTestedChecks(dsp, ["e2e-quick"])), "pending");
  // The names come from the workflow files themselves.
  const cwd = process.cwd();
  process.chdir(require("path").join(__dirname, "../.."));
  try {
    assert.strictEqual(workflowDisplayName("firestore-rules-test.yml"), "Rules & MCP server tests");
    assert.strictEqual(workflowDisplayName("no-such-workflow.yml"), null);
  } finally { process.chdir(cwd); }
  console.log("train-checks: the PR's repeat of a gate-tested suite is not waited for");
}
console.log(`\n${cases.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
