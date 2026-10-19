// GitHub never fires a workflow's `on: push` for a push or merge made with the
// automation's own GITHUB_TOKEN, and every train push and merge is made that
// way. Each push-triggered workflow was wired to an explicit dispatch only
// after its own incident (rules tests 22 Sep, faq-content 25 Sep, the hosted
// DSP API 28 Sep, dsp-board 1 Oct, Retail Media Insights tests 18 Oct). This
// fails when a push trigger is neither dispatched after a train nor excused.
// The YAML parser is a pure function here: the test package has no YAML library.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { TRAIN_MERGE_DISPATCHES, NOT_DISPATCHED_AFTER_TRAIN, HOSTED_DEPLOYS, GENERATED_BUILDS, TRAIN_TEST_WORKFLOWS, trainMergeNeeds } = require("../scripts/run-backlog-automation.js");

const WORKFLOWS_DIR = ".github/workflows/";

// `[a, 'b']` or a block list (`- a` lines) starting after `key:`.
function listValues(block, key) {
  const inline = block.match(new RegExp(`^ +${key}:[ \\t]*\\[(.*)\\]`, "m"));
  if (inline) return inline[1].split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
  const blk = block.match(new RegExp(`^ +${key}:[ \\t]*\\n((?: +-.*\\n?)+)`, "m"));
  if (!blk) return null;
  return [...blk[1].matchAll(/^ +-[ \t]*(.+?)[ \t]*$/gm)].map((m) => m[1].replace(/^['"]|['"]$/g, ""));
}

// The `on.push` trigger of a workflow: { branches, paths } or null.
// paths is null when there is no filter (the whole repo).
function parsePush(text) {
  const on = (text.match(/^on:[ \t]*\n([\s\S]*?)(?=^\S|(?![\s\S]))/m) || [])[1] || "";
  const push = on.match(/^ {2}push:[ \t]*\n((?: {4,}.*\n?|[ \t]*\n)*)/m);
  if (!push) return null;
  return { branches: listValues(push[1], "branches") || [], paths: listValues(push[1], "paths") };
}

// Trailing `**` or `**/*.md` becomes a folder prefix; a plain path stays exact.
const normalise = (p) => p.replace(/\*\*(\/\*\.md)?$/, "");
const covers = (pattern, source) => (source.endsWith("/") ? pattern.startsWith(source) : pattern === source);

// Problems for one workflow: [{ workflow, path, why }]. `lists` carries the
// script's tables so fixtures can stand in for them.
function problemsFor(file, text, lists) {
  const push = parsePush(text);
  if (!push) return [];
  const out = [];
  const excusedWhole = lists.excuses[file] !== undefined;
  const excusedPath = (p) => lists.excuses[`${file} ${p}`] !== undefined;
  const fix = "add a TRAIN_MERGE_DISPATCHES (or HOSTED_DEPLOYS / GENERATED_BUILDS) entry, or add a NOT_DISPATCHED_AFTER_TRAIN excuse with a reason";
  const toMain = !push.branches.length || push.branches.includes("main");
  const toTrain = !push.branches.length || push.branches.some((b) => b.startsWith("deploy/"));
  if (excusedWhole) return [];
  if (!push.paths) {
    out.push({ workflow: file, path: "(no paths filter: whole repo)", why: `${file} pushes on the whole repo; ${fix}` });
    return out;
  }
  if (toMain) {
    const sources = [...lists.hosted, ...lists.generated, ...lists.dispatches].filter((d) => d.workflow === file).flatMap((d) => d.sources);
    const prefixes = lists.tests.filter((t) => t.workflow === file).map((t) => t.prefix);
    for (const raw of push.paths) {
      const p = normalise(raw);
      const ok = sources.some((s) => covers(p, s)) || prefixes.some((x) => p.startsWith(x)) || p.startsWith(WORKFLOWS_DIR) || excusedPath(raw);
      if (!ok) out.push({ workflow: file, path: raw, why: `${file} runs on a push to main touching ${raw}, which no train merge dispatches; ${fix}` });
    }
  }
  if (toTrain && !lists.tests.some((t) => t.workflow === file) && !lists.generated.some((g) => g.workflow === file)) {
    out.push({ workflow: file, path: "deploy/* branch", why: `${file} runs on a push to a deploy/* branch, which nothing dispatches when a ticket lands; add it to TRAIN_TEST_WORKFLOWS or GENERATED_BUILDS, or add a NOT_DISPATCHED_AFTER_TRAIN excuse with a reason` });
  }
  return out;
}

function staleExcuses(files, excuses) {
  const out = [];
  for (const [key, reason] of Object.entries(excuses)) {
    const [file, ...rest] = key.split(" ");
    const pattern = rest.join(" ");
    const text = files[file];
    const push = text === undefined ? null : parsePush(text);
    if (!reason || !String(reason).trim()) out.push(`${key}: empty reason`);
    else if (text === undefined) out.push(`${key}: no workflow ${file}`);
    else if (pattern && !(push && push.paths && push.paths.includes(pattern))) out.push(`${key}: ${file} has no push path ${pattern}`);
  }
  return out;
}

const real = (() => {
  const dir = path.join(__dirname, "..", "..", WORKFLOWS_DIR);
  const files = {};
  for (const f of fs.readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) files[f] = fs.readFileSync(path.join(dir, f), "utf8");
  return files;
})();
const realLists = { excuses: NOT_DISPATCHED_AFTER_TRAIN, hosted: HOSTED_DEPLOYS, generated: GENERATED_BUILDS, dispatches: TRAIN_MERGE_DISPATCHES, tests: TRAIN_TEST_WORKFLOWS };
const noLists = { excuses: {}, hosted: [], generated: [], dispatches: [], tests: [] };
const retail = (extra = "") => `name: x\non:\n  push:\n    branches: [main]\n    paths:\n      - 'Retail-media-insights/**'\n${extra}  workflow_dispatch:\n`;
const names = (ps) => ps.map((p) => `${p.workflow} ${p.path}`);

const cases = [
  ["real repo: every push path is dispatched, tested on the train or excused",
    Object.entries(real).flatMap(([f, t]) => problemsFor(f, t, realLists)).map((p) => p.why), []],
  ["real repo: no stale excuse", staleExcuses(real, NOT_DISPATCHED_AFTER_TRAIN), []],
  ["HOSTED_DEPLOYS matches dsp-api-deploy.yml's push paths",
    [...HOSTED_DEPLOYS[0].sources].sort(), parsePush(real["dsp-api-deploy.yml"]).paths.map(normalise).sort()],
  ["real repo: every dispatch list workflow exists", [...TRAIN_MERGE_DISPATCHES, ...HOSTED_DEPLOYS].filter((d) => !real[d.workflow]).map((d) => d.workflow), []],
  ["fixture: unlisted deploy is reported with file and path", names(problemsFor("retail.yml", retail(), noLists)), ["retail.yml Retail-media-insights/**"]],
  ["fixture: the message names the file, the path and the fixes", /retail\.yml.*Retail-media-insights\/\*\*.*TRAIN_MERGE_DISPATCHES.*NOT_DISPATCHED_AFTER_TRAIN/.test(problemsFor("retail.yml", retail(), noLists)[0].why), true],
  ["fixture: excused by workflow is not reported", problemsFor("retail.yml", retail(), { ...noLists, excuses: { "retail.yml": "why" } }), []],
  ["fixture: excused by path is not reported", problemsFor("retail.yml", retail(), { ...noLists, excuses: { "retail.yml Retail-media-insights/**": "why" } }), []],
  ["fixture: a dispatch list entry covers it", problemsFor("retail.yml", retail(), { ...noLists, dispatches: [{ workflow: "retail.yml", sources: ["Retail-media-insights/"] }] }), []],
  ["fixture: stale excuse for a missing workflow", staleExcuses({ "retail.yml": retail() }, { "gone.yml": "why" }), ["gone.yml: no workflow gone.yml"]],
  ["fixture: stale excuse for a missing path", staleExcuses({ "retail.yml": retail() }, { "retail.yml nope/**": "why" }), ["retail.yml nope/**: retail.yml has no push path nope/**"]],
  ["fixture: excuse with no reason is stale", staleExcuses({ "retail.yml": retail() }, { "retail.yml": " " }), ["retail.yml: empty reason"]],
  ["fixture: push to main with no paths filter is reported",
    names(problemsFor("a.yml", "on:\n  push:\n    branches: [main]\n  workflow_dispatch:\n", noLists)), ["a.yml (no paths filter: whole repo)"]],
  ["fixture: deploy/* push for an unlisted workflow is reported",
    names(problemsFor("t.yml", "on:\n  push:\n    branches: [deploy/foo]\n    paths: ['foo/**']\n", noLists)), ["t.yml deploy/* branch"]],
  ["fixture: deploy/* push is fine for a TRAIN_TEST_WORKFLOWS entry",
    problemsFor("t.yml", "on:\n  push:\n    branches: [deploy/foo]\n    paths: ['foo/**']\n", { ...noLists, tests: [{ workflow: "t.yml", prefix: "foo/" }] }), []],
  ["fixture: a path under .github/workflows/ counts as covered",
    problemsFor("w.yml", "on:\n  push:\n    branches: [main]\n    paths:\n      - '.github/workflows/w.yml'\n", noLists), []],
  ["fixture: TRAIN_TEST_WORKFLOWS prefix covers a main push path",
    problemsFor("t.yml", "on:\n  push:\n    branches: [main]\n    paths: ['foo/a.js']\n", { ...noLists, tests: [{ workflow: "t.yml", prefix: "foo/" }] }), []],
  ["fixture: inline paths list parses like a block list",
    parsePush("on:\n  push:\n    branches: [main]\n    paths: ['a/**', 'b.json']\n").paths,
    parsePush("on:\n  push:\n    branches: [main]\n    paths:\n      - 'a/**'\n      - 'b.json'\n").paths],
  ["normalise: ** and **/*.md become prefixes, a file stays exact", ["a/**", "a/b/**/*.md", "a/c.json"].map(normalise), ["a/", "a/b/", "a/c.json"]],
  ["a workflow with no push trigger has no problems", problemsFor("d.yml", "on:\n  workflow_dispatch:\n", noLists), []],
  ["deploy condition: faq/css/faq.css dispatches deploy-backlog-tracker.yml", trainMergeNeeds("deploy-backlog-tracker.yml", ["faq/css/faq.css"]), true],
  ["deploy condition: dsp-integration/x.ts alone does not", trainMergeNeeds("deploy-backlog-tracker.yml", ["dsp-integration/x.ts"]), false],
  ["deploy condition: backlog-tracker/x.js does", trainMergeNeeds("deploy-backlog-tracker.yml", ["backlog-tracker/x.js"]), true],
  ["deploy condition: an unreadable file list deploys anyway", trainMergeNeeds("deploy-backlog-tracker.yml", null), true],
  ["faq-content dispatch: faq/data/ only", [trainMergeNeeds("faq-content.yml", ["faq/data/index.json"]), trainMergeNeeds("faq-content.yml", ["faq/css/faq.css"])], [true, false]],
];
let failedCount = 0;
for (const [label, got, want] of cases) {
  try { assert.deepStrictEqual(got, want); console.log(`  ok  ${label}`); }
  catch { failedCount++; console.log(`  FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}
console.log(`\n${cases.length - failedCount} passed, ${failedCount} failed`);
process.exit(failedCount ? 1 : 0);
