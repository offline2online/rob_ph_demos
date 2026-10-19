// A revert re-tests the train, and each ticket is judged on a run that did
// not contain a reverted ticket (9 Oct and 15 Oct 2026: the ticket above an
// auto-ejected one was sent back for the ejected change's failure).
const assert = require("assert");
const { afterRevertDispatches, cardEvidenceRun, pickRedCulprit } = require("../scripts/run-backlog-automation.js");

const c = (sha, message = `Ticket ${sha}\n\nBacklog item: ${sha}`, generatedOnly = false) => ({ sha, message, generatedOnly });
const revert = (sha, of) => c(sha, `Revert "x"\n\nThis reverts commit ${of}.`);
const run = (conclusion, status = "completed") => ({ status, conclusion, url: `run-${conclusion}` });
const red = [run("failure")], green = [run("success")], going = [run("", "in_progress")];

// 15 Oct replay
const oct15 = [c("c18ba55"), c("b11bc10"), c("5494b38"), c("28ac5f8"), revert("4a01822", "5494b38")];
const order = oct15.map((x) => x.sha);
const cards = [{ id: "B", status: "ready-for-testing", deployCommit: "b11bc10" }, { id: "L", status: "ready-for-testing", deployCommit: "28ac5f8" }];
const verdict = (runsBySha) => {
  const runs = {};
  for (const k of cards) { const r = cardEvidenceRun(oct15, k.deployCommit, runsBySha); if (r) runs[k.deployCommit] = r; }
  return { runs, culprit: (pickRedCulprit(order, cards, runs) || {}).id || null };
};
const base = { b11bc10: green };
assert.strictEqual(cardEvidenceRun(oct15, "28ac5f8", { ...base, "28ac5f8": red }), null, "stale failure is no evidence");
assert.strictEqual(verdict({ ...base, "28ac5f8": red }).culprit, null, "waits for the fresh run");
assert.strictEqual(verdict({ ...base, "28ac5f8": red, "4a01822": green }).culprit, null, "green after the revert: not red");
assert.strictEqual(verdict({ ...base, "28ac5f8": red, "4a01822": green }).runs["28ac5f8"].conclusion, "success");
assert.strictEqual(verdict({ ...base, "28ac5f8": red, "4a01822": red }).culprit, "L", "red after the revert: culprit");
assert.strictEqual(verdict({ ...base, "28ac5f8": red, "4a01822": going }).culprit, null, "running run: wait");

// 9 Oct replay: vzp9 (b7a0d2a) sits above XkC4 (437e65e), which is then reverted
const oct9 = [c("437e65e"), c("b7a0d2a"), revert("1c8a3ab", "437e65e")];
assert.strictEqual(cardEvidenceRun(oct9, "b7a0d2a", { b7a0d2a: red }), null, "vzp9 is not judged on the run that held XkC4");
assert.strictEqual(cardEvidenceRun(oct9, "b7a0d2a", { b7a0d2a: red, "1c8a3ab": green }).conclusion, "success");

// Segments
const plain = [c("a1"), c("b2")];
assert.strictEqual(cardEvidenceRun(plain, "a1", { a1: red, b2: green }).conclusion, "failure", "no reverts or rebuilds: its own run");
assert.strictEqual(cardEvidenceRun(plain, "zzz", { a1: red }), null, "unknown commit");
const rebuilt = [c("a1"), c("r2", "Rebuild the hosted prototype", true), c("b3")];
assert.strictEqual(cardEvidenceRun(rebuilt, "a1", { a1: red, r2: green, b3: red }).conclusion, "success", "a rebuild-only commit with its own run counts");
assert.strictEqual(cardEvidenceRun(rebuilt, "a1", { a1: red, r2: [run("action_required")] }).conclusion, "failure", "a held rebuild run is skipped");
const merged = [c("a1"), c("m2", "Merge branch 'main' into deploy/x"), c("r3", "Rebuild", true)];
assert.strictEqual(cardEvidenceRun(merged, "a1", { a1: red, m2: green, r3: green }).conclusion, "failure", "a merge of main ends the candidates");

// afterRevertDispatches
const dsp = afterRevertDispatches(["dsp-integration/apps/admin/src/App.tsx"]);
assert.deepStrictEqual(dsp.tests.map((t) => t.workflow), ["e2e-quick.yml"]);
assert.deepStrictEqual(dsp.rebuilds, ["dsp-prototype.yml"]);
assert.deepStrictEqual(afterRevertDispatches(["backlog-tracker/public/js/app.js"]).tests.map((t) => t.workflow), ["firestore-rules-test.yml"]);
const gen = afterRevertDispatches(["dsp-integration/prototype/index.html"]);
assert.deepStrictEqual([gen.tests, gen.rebuilds], [[], []], "generated output alone starts nothing");

console.log("train-eject-after-revert: all passed");
