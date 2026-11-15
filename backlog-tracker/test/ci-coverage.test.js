// Every *.test.js / *.test.mjs here must be run by the "Rules & MCP server
// tests" workflow, or be listed in EXCLUDED with a reason. Ten files had
// never run in CI when this was written (19 Oct 2026); nothing failed when a
// new test was added without being wired in. train-tests.test.js guards the
// workflow's folders; this guards its test files.
//
// The workflow runs npm scripts by name, and scripts call other scripts, so
// reachability is worked out by expanding package.json through `npm run` and
// `&&`, collecting every `node <file>` target (quoted ones included).
const assert = require("assert");
const fs = require("fs");
const path = require("path");

// { "file.test.js": "why CI does not run it" }. Empty on purpose.
const EXCLUDED = {};

const TEST_FILE = /\.test\.m?js$/;

function npmRunNames(text) {
  return [...text.matchAll(/\bnpm run ([\w:.-]+)/g)].map((m) => m[1]);
}

// Names the workflow runs: `npm run <name>` on any `run:` line (a block
// scalar's continuation lines count too, since they are plain indented text).
function workflowScripts(workflowText) {
  const names = [];
  for (const line of workflowText.split("\n")) {
    const m = line.match(/^\s*(?:-\s*)?run:\s*(.*)$/);
    if (m) names.push(...npmRunNames(m[1]));
  }
  return names;
}

// Test files and missing script names reached from `roots` through scripts.
function reach(roots, scripts) {
  const files = new Set();
  const missing = new Set();
  const seen = new Set();
  const visit = (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    const cmd = scripts[name];
    if (cmd === undefined) { missing.add(name); return; }
    for (const m of cmd.matchAll(/\bnode\s+(?:--\S+\s+)*([\w./-]+\.m?js)\b/g)) files.add(path.basename(m[1]));
    // `node ui/run-ui.mjs a.test.mjs b.test.mjs` runs every file it is given (with one retry).
    for (const m of cmd.matchAll(/\bnode\s+ui\/run-ui\.mjs((?:\s+[\w./-]+\.m?js)+)/g)) m[1].trim().split(/\s+/).forEach((f) => files.add(path.basename(f)));
    npmRunNames(cmd).forEach(visit);
  };
  roots.forEach(visit);
  return { files, missing: [...missing] };
}

// Every problem as a string; [] means the tree is consistent.
function unreachedTests(workflowText, scripts, testFiles, excluded) {
  const problems = [];
  const wf = reach(workflowScripts(workflowText), scripts);
  const local = reach(["test"], scripts);
  const names = Object.keys(excluded);
  for (const n of wf.missing) problems.push(`the workflow runs \`npm run ${n}\` but package.json has no such script`);
  for (const f of testFiles.filter((f) => TEST_FILE.test(f)).sort()) {
    if (wf.files.has(f) || f in excluded) continue;
    const wired = Object.keys(scripts).filter((s) => workflowScripts(workflowText).includes(s));
    problems.push(`${f} is not run by CI. Add \`node ${f}\` to one of the scripts the workflow runs (${wired.join(", ")}), or add it to EXCLUDED in ci-coverage.test.js with a reason.`);
  }
  for (const f of names) {
    if (!testFiles.includes(f)) problems.push(`EXCLUDED lists ${f}, which does not exist; remove the entry`);
    else if (wf.files.has(f)) problems.push(`EXCLUDED lists ${f}, but CI runs it; remove the entry`);
  }
  // Test files only: CI also runs helpers that are not tests (ui/flaky-report.mjs).
  const onlyLocal = [...local.files].filter((f) => TEST_FILE.test(f) && !wf.files.has(f)).sort();
  const onlyCi = [...wf.files].filter((f) => TEST_FILE.test(f) && !local.files.has(f)).sort();
  if (onlyLocal.length || onlyCi.length) {
    problems.push(`\`npm test\` and CI run different files (only local: ${onlyLocal.join(", ") || "none"}; only CI: ${onlyCi.join(", ") || "none"}); make the \`test\` script run exactly the scripts the workflow runs`);
  }
  return problems;
}

// The workflow's jobs: { name: text of that job }. Jobs are the two-space
// keys under `jobs:`.
function workflowJobs(workflowText) {
  const body = workflowText.slice(workflowText.search(/^jobs:\s*$/m));
  const jobs = {};
  let name = null;
  for (const line of body.split("\n").slice(1)) {
    const m = line.match(/^ {2}([\w-]+):\s*$/);
    if (m) { name = m[1]; jobs[name] = ""; continue; }
    if (name) jobs[name] += line + "\n";
  }
  return jobs;
}

// Problems with how the workflow is split into jobs: a test file run by two
// jobs (the same cases twice per train), or a job with no time limit (a hung
// run then holds a train for GitHub's six hours).
function jobProblems(workflowText, scripts) {
  const problems = [];
  const ranBy = new Map();
  for (const [job, text] of Object.entries(workflowJobs(workflowText))) {
    if (!/^\s+timeout-minutes:\s*\d+/m.test(text)) problems.push(`job \`${job}\` has no timeout-minutes`);
    for (const f of reach(workflowScripts(text), scripts).files) ranBy.set(f, [...(ranBy.get(f) || []), job]);
  }
  for (const [f, jobs] of [...ranBy].sort()) if (TEST_FILE.test(f) && jobs.length > 1) problems.push(`${f} is run by ${jobs.length} jobs (${jobs.join(", ")}); keep each test file in exactly one`);
  return problems;
}

module.exports = { EXCLUDED, unreachedTests, reach, workflowScripts, workflowJobs, jobProblems };

if (require.main === module) {
  const wfText = fs.readFileSync(path.join(__dirname, "../../.github/workflows/firestore-rules-test.yml"), "utf8");
  const scripts = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8")).scripts;
  const testFiles = fs.readdirSync(__dirname).filter((f) => TEST_FILE.test(f));

  // The real tree.
  const real = unreachedTests(wfText, scripts, testFiles, EXCLUDED);
  assert.deepStrictEqual(real, [], "\n" + real.join("\n"));
  assert.deepStrictEqual(EXCLUDED, {}, "EXCLUDED should stay empty unless a test genuinely cannot run in CI");
  // What a build session runs before handing a patch back (ROUTINE_INSTRUCTIONS.md):
  // everything CI runs except the emulator, which needs Java. A session that
  // ran a hand-picked subset handed back 7dVoY12l's patch with
  // mcp-client.test.mjs red (26 Oct 2026).
  assert.strictEqual(scripts["test:offline"], scripts.test.replace(/ && npm run test:rules$/, ""),
    "test:offline must be `test` without its final test:rules step");

  // One job per test file, a time limit on every job.
  const split = jobProblems(wfText, scripts);
  assert.deepStrictEqual(split, [], "\n" + split.join("\n"));
  assert.ok(Object.keys(workflowJobs(wfText)).length >= 5, "the console workflow runs as parallel jobs (rules, offline, ui-*)");

  // Each Staff Kanban UI case file belongs to exactly one train workflow: the
  // console suite to this workflow, the prototype suite to
  // kanban-staff-board-tests.yml. Until 14 Nov 2026 a backlog-tracker/ change
  // started both, and the test plan's cases ran twice per train.
  const kanbanWf = fs.readFileSync(path.join(__dirname, "../../.github/workflows/kanban-staff-board-tests.yml"), "utf8");
  const kanbanJobs = workflowJobs(kanbanWf);
  for (const [job, text] of Object.entries(kanbanJobs)) assert.ok(/^\s+timeout-minutes:\s*\d+/m.test(text), `kanban-staff-board-tests.yml job ${job} has a timeout`);
  assert.ok(!/backlog-tracker\/test\/ui\/[\w.-]*\.test\.mjs|npm run test:ui/.test(kanbanWf), "kanban-staff-board-tests.yml runs no console UI suite");
  assert.ok(kanbanJobs.test && /working-directory:\s*kanban-staff-board\/test/.test(kanbanJobs.test), "…it runs the prototype suite in kanban-staff-board/test");
  const consoleReach = reach(workflowScripts(wfText), scripts).files;
  assert.ok(consoleReach.has("staff-kanban.test.mjs") && !consoleReach.has("e2e.test.mjs"), "the console workflow owns ui/staff-kanban.test.mjs and not the prototype's e2e.test.mjs");
  const { TRAIN_TEST_WORKFLOWS, trainTestsFor } = require("../scripts/run-backlog-automation.js");
  const proto = TRAIN_TEST_WORKFLOWS.find((t) => t.workflow === "kanban-staff-board-tests.yml");
  assert.ok(proto && ![proto.prefix, ...(proto.extraPrefixes || [])].some((x) => x.startsWith("backlog-tracker/")), "a backlog-tracker/ change does not start the prototype suite");
  assert.deepStrictEqual(trainTestsFor(["backlog-tracker/public/js/kanban/kanban-page.js"]).map((t) => t.workflow), ["firestore-rules-test.yml"], "a console train runs the Staff Kanban cases once, in the console workflow");

  // Synthetic input.
  const wf = "steps:\n  - name: a\n    run: npm run t:a\n  - name: b\n    run: npm run t:rules\n";
  const sc = { test: "npm run t:a && npm run t:rules", "t:a": "node a.test.js && npm run t:n", "t:n": "node n.test.mjs", "t:rules": "firebase emulators:exec --only firestore 'node r.test.js'" };
  const files = ["a.test.js", "n.test.mjs", "r.test.js"];
  assert.deepStrictEqual(unreachedTests(wf, sc, files, {}), [], "nested npm run and quoted node target count as covered");
  const zz = unreachedTests(wf, sc, [...files, "zz.test.js"], {});
  assert.strictEqual(zz.length, 1);
  assert.ok(zz[0].startsWith("zz.test.js ") && zz[0].includes("node zz.test.js") && zz[0].includes("t:a"), "unwired file named with the fix");
  assert.deepStrictEqual(unreachedTests(wf, sc, [...files, "zz.test.js"], { "zz.test.js": "needs a GPU" }), [], "EXCLUDED file is allowed");
  assert.ok(unreachedTests(wf, sc, files, { "gone.test.js": "x" })[0].includes("gone.test.js"), "EXCLUDED entry for a missing file");
  assert.ok(unreachedTests(wf, sc, files, { "a.test.js": "x" })[0].includes("CI runs it"), "EXCLUDED entry that is also reached");
  assert.ok(unreachedTests(wf + "    run: npm run nope\n", sc, files, {})[0].includes("no such script"), "workflow script with no definition");
  assert.ok(unreachedTests(wf, { ...sc, test: "npm run t:a" }, files, {}).some((p) => p.includes("different files")), "local test drifting from CI");
  assert.deepStrictEqual(unreachedTests(wf, { ...sc, "t:n": "node n.test.mjs && npm run t:a" }, files, {}), [], "a script cycle ends");
  assert.deepStrictEqual(unreachedTests("steps:\n  - run: npm run t:ui\n", { test: "npm run t:ui", "t:ui": "node ui/run-ui.mjs ui/a.test.mjs b.test.mjs" }, ["a.test.mjs", "b.test.mjs"], {}), [], "every file handed to run-ui.mjs counts as covered");
  const twoJobs = "jobs:\n  one:\n    timeout-minutes: 5\n    steps:\n      - run: npm run t:a\n  two:\n    steps:\n      - run: npm run t:a\n";
  const jp = jobProblems(twoJobs, sc);
  assert.ok(jp.some((x) => x.includes("job `two` has no timeout-minutes")), "a job without a time limit is named");
  assert.ok(jp.some((x) => x.startsWith("a.test.js is run by 2 jobs")), "a test file in two jobs is named");
  console.log("ci-coverage: all assertions passed");
}
