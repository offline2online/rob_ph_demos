// A ticket that changes only test files approves itself once its own train
// tests have passed (Rob, 17 Nov 2026), and a flaky-test ticket the build
// found already fixed closes itself. Pure rules from run-backlog-automation.js.
const assert = require("assert");
const { isTestOnlyChange, autoApprovePlan, autoConfirmNoChangePlan } = require("../scripts/run-backlog-automation.js");

// What counts as a test file.
for (const p of [
  "backlog-tracker/test/ui/staff-kanban.test.mjs", "backlog-tracker/test/README.md", "kanban-staff-board/test/lib/driver.mjs",
  "dsp-integration/apps/api/test/stability.test.ts", "dsp-integration/e2e/quick.spec.ts", "media-studio/src/__tests__/keys.js", "src/thing.spec.tsx",
]) assert.ok(isTestOnlyChange([p]), `${p} is a test file`);
for (const p of [
  "backlog-tracker/public/js/app.js", "backlog-tracker/functions/index.js", "backlog-tracker/firestore.rules", "backlog-tracker/REQUIREMENTS.md",
  ".github/workflows/firestore-rules-test.yml", "backlog-tracker/scripts/run-backlog-automation.js", "backlog-tracker/public/js/latest.js", "attest/file.js", "contest.js",
]) assert.ok(!isTestOnlyChange([p]), `${p} is not a test file`);
assert.ok(!isTestOnlyChange([]), "no files is not a test-only change");
assert.ok(!isTestOnlyChange(null));
assert.ok(!isTestOnlyChange(["backlog-tracker/test/a.test.js", "backlog-tracker/public/js/app.js"]), "one product file is enough to need a person");

const SHA = "611e9c1471cdcae84fc5502cdd353a73dcaea43b";
const card = (over = {}) => ({ id: "c1", status: "ready-for-testing", deployCommit: SHA, trainTest: { sha: SHA, state: "passed" }, ...over });
const TESTS = ["kanban-staff-board/test/lib/cases.mjs", "backlog-tracker/test/README.md"];

// Approved: test files only, tests passed on the card's own commit.
const plan = autoApprovePlan(card(), TESTS, "2026-11-17T00:00:00.000Z");
assert.deepStrictEqual(plan.fields, { status: "ready-to-publish", approvedVia: "auto-test-only", approvedAt: "2026-11-17T00:00:00.000Z", approvedByEmail: null });
assert.ok(!("trainLocked" in plan.fields), "it does not close the release");
assert.match(plan.note, /^Approved for deployment automatically: this ticket changes only test files \(2 files\) and its train tests passed on 611e9c1\./);

// Not approved: anything short of that.
assert.strictEqual(autoApprovePlan(card(), ["backlog-tracker/public/js/app.js", ...TESTS]), null, "a product file");
assert.strictEqual(autoApprovePlan(card(), null), null, "files could not be read");
for (const state of ["starting", "running", "failed", "not-run", "not-applicable"]) assert.strictEqual(autoApprovePlan(card({ trainTest: { sha: SHA, state } }), TESTS), null, `tests ${state}`);
assert.strictEqual(autoApprovePlan(card({ trainTest: { sha: "0ld", state: "passed" } }), TESTS), null, "a pass on an older commit");
assert.strictEqual(autoApprovePlan(card({ trainTest: null }), TESTS), null);
assert.strictEqual(autoApprovePlan(card({ revertRequested: true }), TESTS), null, "being taken off the release");
assert.strictEqual(autoApprovePlan(card({ deployCommit: null }), TESTS), null, "no commit on the train");
for (const status of ["backlog", "ready-to-publish", "published-live", "archived"]) assert.strictEqual(autoApprovePlan(card({ status }), TESTS), null, status);

// A flaky-test ticket with nothing to deploy closes itself; any other no-deploy card still needs its person.
const noChange = { id: "c2", status: "ready-for-testing", noDeploymentRequired: true, autoRaised: true, flakyCaseId: "TC-68" };
assert.deepStrictEqual(autoConfirmNoChangePlan(noChange).fields, { status: "published-live" });
assert.strictEqual(autoConfirmNoChangePlan({ ...noChange, autoRaised: false }), null, "a person's own no-deploy ticket");
assert.strictEqual(autoConfirmNoChangePlan({ ...noChange, flakyCaseId: null }), null);
assert.strictEqual(autoConfirmNoChangePlan({ ...noChange, deployCommit: SHA }), null, "it has a commit: it ships with the train");
assert.strictEqual(autoConfirmNoChangePlan({ ...noChange, noDeploymentRequired: false }), null);
assert.strictEqual(autoConfirmNoChangePlan({ ...noChange, status: "backlog" }), null);
console.log("auto-approve: ok");

// Two tickets built side by side each add a test to the same package.json
// script line: the patch is merged, not thrown away and rebuilt (17 Nov 2026).
{
  const { mergePackageJsonPatch } = require("../scripts/run-backlog-automation.js");
  const pkg = (chain, extra = {}) => `${JSON.stringify({ name: "t", scripts: { "test:train-lock": chain, other: "node x.js" }, ...extra }, null, 2)}\n`;
  const base = pkg("node a.test.js && node b.test.js");
  const train = pkg("node a.test.js && node release-groups.test.js && node b.test.js");
  const patch = pkg("node a.test.js && node b.test.js && node dashboard.test.mjs");
  const out = mergePackageJsonPatch("backlog-tracker/test/package.json", train, base, patch);
  assert.strictEqual(JSON.parse(out.text).scripts["test:train-lock"], "node a.test.js && node release-groups.test.js && node b.test.js && node dashboard.test.mjs", "both tickets' tests are kept");
  assert.ok(out.text.endsWith("}\n") && out.text.includes('\n  "name"'), "formatting is kept");
  assert.strictEqual(mergePackageJsonPatch("backlog-tracker/public/js/app.js", train, base, patch), null, "only package.json");
  assert.strictEqual(mergePackageJsonPatch("package.json", train, base, "{ not json"), null);
  assert.strictEqual(mergePackageJsonPatch("package.json", pkg("node a.test.js", { version: "2.0.0" }), pkg("node a.test.js", { version: "1.0.0" }), pkg("node a.test.js", { version: "3.0.0" })), null, "a version both changed is a person's");
  console.log("package.json patch merge: ok");
}
