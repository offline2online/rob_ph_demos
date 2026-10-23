// Train tests run on every train push, and a failure reaches the cards
// while they are still in Ready for Testing — not first as a refused Deploy
// to Main (PR #301, 3 Oct 2026; for the DSP train's e2e-quick, PR #330,
// 6 Oct 2026). Drives the pure decision functions.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { TRAIN_TEST_WORKFLOWS, trainTestFailureTargets, touchesConsoleTests, trainTestsFor, testedHeadOf, nextTrainTestsRed, trainTestGate, newestRealRun, pickRedCulprit } = require("../scripts/run-backlog-automation.js");

const HEAD = "aaaaaaa1111111";
const cards = [{ id: "c1" }, { id: "c2", testsFailedSha: HEAD }, { id: "c3", testsFailedSha: "old" }];
const failed = { headSha: HEAD, status: "completed", conclusion: "failure", url: "u" };
const cases = [
  ["failed on the current head: every card not yet told", trainTestFailureTargets(failed, HEAD, cards).map((c) => c.id), ["c1", "c3"]],
  ["passed: nothing", trainTestFailureTargets({ ...failed, conclusion: "success" }, HEAD, cards), []],
  ["still running: nothing yet", trainTestFailureTargets({ ...failed, status: "in_progress", conclusion: "" }, HEAD, cards), []],
  ["failed on an older head (since fixed?): nothing", trainTestFailureTargets({ ...failed, headSha: "older" }, HEAD, cards), []],
  ["no run at all: nothing", trainTestFailureTargets(null, HEAD, cards), []],
  ["timed out counts as a failure", trainTestFailureTargets({ ...failed, conclusion: "timed_out" }, HEAD, [{ id: "c1" }]).map((c) => c.id), ["c1"]],
  ["a backlog-tracker path starts the tests", touchesConsoleTests(["backlog-tracker/public/js/app.js"]), true],
  ["a faq-only or other project's change doesn't", touchesConsoleTests(["faq/index.html", "dsp-integration/x.ts"]), false],
  ["a dsp-integration source change starts e2e-quick", trainTestsFor(["dsp-integration/apps/api/src/exchange/openrtb.ts"]).map((t) => t.workflow), ["e2e-quick.yml"]],
  ["a prototype rebuild alone starts nothing", trainTestsFor(["dsp-integration/prototype/assets/index.js", "dsp-integration/prototype/build-info.json"]), []],
  // Deploy to Main's version bump on a DSP train (PR #462, 23 Oct 2026)
  ["the version bump alone starts nothing", trainTestsFor(["backlog-tracker/public/js/version.js"]), []],
  ["a DSP train with its version bump starts only e2e-quick", trainTestsFor(["dsp-integration/apps/admin/src/x.tsx", "backlog-tracker/public/js/version.js"]).map((t) => t.workflow), ["e2e-quick.yml"]],
  ["a console change with its version bump still starts the console suites", trainTestsFor(["backlog-tracker/public/js/app.js", "backlog-tracker/public/js/version.js"]).map((t) => t.workflow), ["firestore-rules-test.yml", "kanban-staff-board-tests.yml"]],
  ["a change to both projects starts both", trainTestsFor(["backlog-tracker/x.js", "dsp-integration/y.ts"]).map((t) => t.workflow), ["firestore-rules-test.yml", "e2e-quick.yml", "kanban-staff-board-tests.yml"]],
  // board-docs.json (any project) is validated by the console tests
  ["a dsp-integration board-docs.json starts the console tests and e2e-quick", trainTestsFor(["dsp-integration/board-docs.json"]).map((t) => t.workflow), ["firestore-rules-test.yml", "e2e-quick.yml"]],
  ["a Retail-media-insights board-docs.json starts the console and RMI suites", trainTestsFor(["Retail-media-insights/board-docs.json"]).map((t) => t.workflow), ["firestore-rules-test.yml", "retail-media-insights-tests.yml"]],
  ["e2e-quick red: told once per workflow and head", trainTestFailureTargets(failed, HEAD, [{ id: "d1" }, { id: "d2", testsFailedShas: [`e2e-quick.yml@${HEAD}`] }, { id: "d3", testsFailedSha: HEAD }], "e2e-quick.yml").map((c) => c.id), ["d1", "d3"]],
  ["run on the head itself: the head", testedHeadOf(HEAD, HEAD, null), HEAD],
  ["only a prototype rebuild since the run: the run still speaks for the head", testedHeadOf("tick", HEAD, ["dsp-integration/prototype/index.html", "dsp-integration/apps/admin/public/demo/api-snapshot.json"]), "tick"],
  ["a source change since the run: stale, the head", testedHeadOf("tick", HEAD, ["dsp-integration/prototype/index.html", "dsp-integration/apps/api/src/x.ts"]), HEAD],
  ["run not behind the head (diverged): the head", testedHeadOf("tick", HEAD, null), HEAD],
  // projects/{id}.trainTestsRed — what hides Deploy to Main (PR #335, 7 Oct 2026)
  ["red on the tested commit: set", nextTrainTestsRed(null, "e2e-quick.yml", failed, HEAD, "t"), { "e2e-quick": { sha: HEAD, url: "u", at: "t" } }],
  ["already red on that commit: no change", nextTrainTestsRed({ "e2e-quick": { sha: HEAD } }, "e2e-quick.yml", failed, HEAD, "t"), undefined],
  ["green: cleared, other workflow kept", nextTrainTestsRed({ "e2e-quick": { sha: "x" }, "firestore-rules-test": { sha: "y" } }, "e2e-quick.yml", { ...failed, conclusion: "success" }, HEAD, "t"), { "firestore-rules-test": { sha: "y" } }],
  ["green with nothing red: no change", nextTrainTestsRed({}, "e2e-quick.yml", { ...failed, conclusion: "success" }, HEAD, "t"), undefined],
  ["still running: no change", nextTrainTestsRed({ "e2e-quick": { sha: "x" } }, "e2e-quick.yml", { ...failed, status: "in_progress", conclusion: "" }, HEAD, "t"), undefined],
  ["cancelled (superseded by a newer push): no change", nextTrainTestsRed({}, "e2e-quick.yml", { ...failed, conclusion: "cancelled" }, HEAD, "t"), undefined],
  ["run on a stale commit: no change", nextTrainTestsRed({}, "e2e-quick.yml", { ...failed, headSha: "older" }, HEAD, "t"), undefined],
  // trainTestGate — Deploy to Main opens no PR until the train's tests passed (PR #337, 7 Oct 2026)
  ["gate: passed on the head → green", trainTestGate([{ workflow: "e2e-quick.yml", label: "x", run: { ...failed, conclusion: "success" }, speaksForHead: true }]).state, "green"],
  ["gate: nothing required → green", trainTestGate([]).state, "green"],
  ["gate: still running → pending", trainTestGate([{ workflow: "e2e-quick.yml", label: "x", run: { ...failed, status: "in_progress", conclusion: "" }, speaksForHead: true }]).state, "pending"],
  ["gate: failed → red", trainTestGate([{ workflow: "e2e-quick.yml", label: "x", run: failed, speaksForHead: true }]).state, "red"],
  ["gate: cancelled by a newer push → missing (start one)", trainTestGate([{ workflow: "e2e-quick.yml", label: "x", run: { ...failed, conclusion: "cancelled" }, speaksForHead: true }]).state, "missing"],
  ["gate: passed, but on an older commit with source changes since → missing", trainTestGate([{ workflow: "e2e-quick.yml", label: "x", run: { ...failed, conclusion: "success" }, speaksForHead: false }]).state, "missing"],
  // pickRedCulprit — auto-eject the ticket that turned the train red (8 Oct 2026)
  ...(() => {
    const order = ["a", "rebuildA", "b", "rebuildB", "c"];
    const A = { id: "A", status: "ready-to-publish", deployCommit: "a" };
    const B = { id: "B", status: "ready-for-testing", deployCommit: "b" };
    const C = { id: "C", status: "ready-for-testing", deployCommit: "c" };
    const ok = { status: "completed", conclusion: "success" }, red = { status: "completed", conclusion: "failure" };
    return [
      ["culprit: first red after green, in testing", pickRedCulprit(order, [C, A, B], { a: ok, b: red, c: red })?.id, "B"],
      ["all green: nobody", pickRedCulprit(order, [A, B, C], { a: ok, b: ok, c: ok }), null],
      ["first red is approved: never ejected", pickRedCulprit(order, [A, B, C], { a: red, b: red, c: red }), null],
      ["a run before it still going: wait", pickRedCulprit(order, [A, B, C], { a: { status: "in_progress" }, b: red }), null],
      ["a run before it missing: wait", pickRedCulprit(order, [A, B, C], { b: red }), null],
      ["cancelled before it: no verdict", pickRedCulprit(order, [A, B, C], { a: { status: "completed", conclusion: "cancelled" }, b: red }), null],
      ["first ticket on the train red: it is the culprit", pickRedCulprit(order, [B, C], { b: red, c: red })?.id, "B"],
      ["deploy parked red: approved culprit with a green commit before it is ejected", pickRedCulprit(order, [A, { ...B, status: "ready-to-publish" }, C], { a: ok, b: red, c: red }, { deployParkedRed: true })?.id, "B"],
      ["deploy parked red: approved culprit first on the train (main may be red) is held", pickRedCulprit(order, [A, B, C], { a: red, b: red, c: red }, { deployParkedRed: true }), null],
      ["deploy not parked: approved culprit is held", pickRedCulprit(order, [A, { ...B, status: "ready-to-publish" }, C], { a: ok, b: red }), null],
      ["a Retail-media-insights change starts its own suite", trainTestsFor(["Retail-media-insights/frontend/revenue-deals.js"]).map((t) => t.workflow), ["retail-media-insights-tests.yml"]],
      ["a card whose commit left the train is ignored", pickRedCulprit(order, [{ id: "X", status: "ready-for-testing", deployCommit: "gone" }, A, C], { a: ok, c: red })?.id, "C"],
    ];
  })(),
  ["held run (action_required) is skipped for the newest real one", newestRealRun([{ headSha: "rebuild", status: "completed", conclusion: "action_required" }, { headSha: "fix", status: "completed", conclusion: "success" }]).headSha, "fix"],
  ["a running run counts", newestRealRun([{ headSha: "a", status: "in_progress", conclusion: "" }, { headSha: "b", status: "completed", conclusion: "failure" }]).headSha, "a"],
  ["only held runs: none", newestRealRun([{ headSha: "a", status: "completed", conclusion: "action_required" }]), null],
  ["gate: no run at all → missing", trainTestGate([{ workflow: "e2e-quick.yml", label: "x", run: null, speaksForHead: false }]).state, "missing"],
  ["gate: worst wins (green + red → red)", trainTestGate([{ workflow: "a.yml", label: "a", run: { ...failed, conclusion: "success" }, speaksForHead: true }, { workflow: "e2e-quick.yml", label: "x", run: failed, speaksForHead: true }]).workflows.map((w) => w.workflow), ["e2e-quick.yml"]],
  // Guard (PR #412, 18 Oct 2026): a project folder with its own test suite, or a
  // PR test workflow scoped to a folder, must be in TRAIN_TEST_WORKFLOWS —
  // otherwise its tickets are never tested on the train and the first anyone
  // hears of a failure is a red, parked Deploy to Main.
  ...(() => {
    const repo = path.join(__dirname, "..", "..");
    const wfDir = path.join(repo, ".github", "workflows");
    const covered = (prefix) => TRAIN_TEST_WORKFLOWS.some((t) => t.prefix === prefix);
    const out = [];
    for (const dir of fs.readdirSync(repo)) {
      const pkg = path.join(repo, dir, "package.json");
      if (!fs.existsSync(pkg)) continue;
      const scripts = (JSON.parse(fs.readFileSync(pkg, "utf8")).scripts) || {};
      if (scripts.test) out.push([`${dir}/ has a test script, so a train test workflow`, covered(`${dir}/`), true]);
    }
    for (const file of fs.readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f))) {
      const text = fs.readFileSync(path.join(wfDir, file), "utf8");
      const on = (text.match(/^on:\n([\s\S]*?)^\S/m) || [])[1] || "";
      const pr = (on.match(/^ {2}pull_request:\n((?: {4,}.*\n)*)/m) || [])[1] || "";
      if (!pr || !/^ {2}workflow_dispatch:/m.test(on)) continue;
      // A '!…' exclusion names nothing the workflow tests.
      const folders = new Set([...pr.matchAll(/'([^'./!][^'/]*)\/[^']*'/g)].map((m) => m[1]));
      for (const f of folders) out.push([`${file} tests ${f}/ on PRs, so it runs on that train`, TRAIN_TEST_WORKFLOWS.some((t) => t.workflow === file && t.prefix === `${f}/`), true]);
    }
    for (const t of TRAIN_TEST_WORKFLOWS) {
      const f = path.join(wfDir, t.workflow);
      out.push([`${t.workflow} exists and accepts workflow_dispatch`, fs.existsSync(f) && /^ {2}workflow_dispatch:/m.test(fs.readFileSync(f, "utf8")), true]);
    }
    return out;
  })(),
  // Run 6 on every train push, and a nightly that says what failed (19 Oct 2026):
  // the journey only ran after a train merged, so four breaking changes shipped.
  ...(() => {
    const repo = path.join(__dirname, "..", "..");
    const read = (...p) => fs.readFileSync(path.join(repo, ...p), "utf8");
    const quick = read(".github", "workflows", "e2e-quick.yml");
    const nightly = read(".github", "workflows", "e2e-nightly.yml");
    const scripts = JSON.parse(read("dsp-integration", "package.json")).scripts;
    const ri = read("backlog-tracker", "ROUTINE_INSTRUCTIONS.md").replace(/\s+/g, " ");
    const para = (ri.match(/run the DSP tests\*\*.*?\(set `PH_SECRETS_KEY`/) || [""])[0];
    const stepOf = (text, re) => text.split(/^ {6}- /m).find((s) => re.test(s)) || "";
    const used = (text) => [...new Set([...text.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]))];
    const journey = stepOf(quick, /npm run e2e:journey/);
    const out = [
      ["e2e-quick runs the journey, guarded by the scope check", journey.includes("steps.scope.outputs.run == 'true'"), true],
      ["e2e-quick runs the journey after e2e:quick", quick.indexOf("npm run e2e:journey") > quick.indexOf("npm run e2e:quick"), true],
      ["e2e-quick does not run the bench", /npm run bench/.test(quick), false],
      ["the 'run the DSP tests' paragraph was found", para.length > 0, true],
    ];
    for (const [file, text] of [["e2e-quick.yml", quick], ["e2e-nightly.yml", nightly]])
      for (const s of used(text)) out.push([`${file}: npm run ${s} is a dsp-integration script`, s in scripts, true]);
    for (const s of used(quick)) out.push([`ROUTINE_INSTRUCTIONS lists e2e-quick's npm run ${s}`, para.includes(`npm run ${s}`), true]);
    const report = stepOf(nightly, /id: report\b/), bugs = stepOf(nightly, /id: file_bugs\b/), red = stepOf(nightly, /name: Red night/);
    out.push(
      ["e2e-nightly: report step has an id and continue-on-error", /continue-on-error: true/.test(report), true],
      ["e2e-nightly: file_bugs step has an id and continue-on-error", /continue-on-error: true/.test(bugs), true],
      ["e2e-nightly: Red night runs with always()", /^\s+if: always\(\)\s*$/m.test(red), true],
      ["e2e-nightly: Red night reads quick, journey, bench and report", ["quick", "journey", "bench", "report"].every((id) => red.includes(`steps.${id}.outcome`)), true],
    );
    return out;
  })(),
];
let failedCount = 0;
for (const [label, got, want] of cases) {
  try { assert.deepStrictEqual(got, want); console.log(`  ok  ${label}`); }
  catch { failedCount++; console.log(`  FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}
console.log(`\n${cases.length - failedCount} passed, ${failedCount} failed`);
process.exit(failedCount ? 1 : 0);
