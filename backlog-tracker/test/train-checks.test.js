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
  ["e2e-quick cancelled", [{ name: "e2e-quick", status: "COMPLETED", conclusion: "CANCELLED" }], "failure"],
];
let failed = 0;
assert.deepStrictEqual(REQUIRED_TRAIN_CHECKS, ["e2e-quick"]);
for (const [label, rollup, want] of cases) {
  const got = trainChecksState(rollup);
  if (got === want) console.log(`  ok  ${label}`);
  else { failed++; console.log(`  FAIL ${label}: got ${got}, want ${want}`); }
}
console.log(`\n${cases.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
