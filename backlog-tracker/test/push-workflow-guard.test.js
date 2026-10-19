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

// The `on.push` trigger of a workflow: { branches, paths } or null (no push
// trigger). paths is null when there is no filter (the whole repo). Fails
// closed: a push trigger it cannot read throws an Error naming `file`, so the
// guard can never pass silently on a shape it does not understand. Handles
// `on: push`, `on: [push, …]`, `on: {push: …}`, a quoted "on":, any indent,
// and comment lines at any column inside the block.
function parsePush(text, file = "workflow") {
  const lines = text.split("\n");
  const idx = lines.findIndex((l) => /^(["']?)on\1[ \t]*:/.test(l));
  if (idx < 0) throw new Error(`${file}: no top-level on: trigger found, so its push trigger cannot be checked`);
  const head = lines[idx].replace(/^["']?on["']?[ \t]*:/, "").replace(/[ \t]+#.*$/, "").trim();
  if (head) return head.replace(/[\[\]{},]/g, " ").split(/\s+/).includes("push") ? { branches: [], paths: null } : null;
  const body = [];
  for (let i = idx + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i]) && !lines[i].startsWith("#")) break; // a column-0 comment does not end the block
    body.push(lines[i].replace(/\r$/, ""));
  }
  const clean = body.filter((l) => l.trim() && !/^\s*#/.test(l));
  if (!clean.length) return null;
  const unreadable = () => new Error(`${file}: mentions push under on: but its trigger could not be parsed`);
  if (/^ *-/.test(clean[0])) { // on:\n  - push
    return clean.some((l) => /^ *-[ \t]*["']?push["']?[ \t]*(#.*)?$/.test(l)) ? { branches: [], paths: null } : null;
  }
  const indent = clean[0].match(/^ */)[0].length;
  const at = clean.findIndex((l) => new RegExp(`^ {${indent}}["']?push["']?[ \\t]*:`).test(l));
  if (at < 0) {
    if (clean.some((l) => /\bpush\b/.test(l))) throw unreadable();
    return null;
  }
  const inline = clean[at].replace(/^ *["']?push["']?[ \t]*:/, "").replace(/[ \t]+#.*$/, "").trim();
  if (inline) { // push: {branches: [main]} — not worth a parser; the whole repo is reported
    if (!/^[{\[]/.test(inline)) throw unreadable();
    return { branches: [], paths: null };
  }
  const child = [];
  for (const l of clean.slice(at + 1)) {
    if (l.match(/^ */)[0].length <= indent) break;
    child.push(l);
  }
  const block = child.join("\n") + "\n";
  return { branches: listValues(block, "branches") || [], paths: listValues(block, "paths") };
}

// Trailing `**` or `**/*.md` becomes a folder prefix; a plain path stays exact.
const normalise = (p) => p.replace(/\*\*(\/\*\.md)?$/, "");
const covers = (pattern, source) => (source.endsWith("/") ? pattern.startsWith(source) : pattern === source);

// Problems for one workflow: [{ workflow, path, why }]. `lists` carries the
// script's tables so fixtures can stand in for them.
function problemsFor(file, text, lists) {
  let push;
  try { push = parsePush(text, file); } catch (err) { return [{ workflow: file, path: "(unparsed)", why: err.message }]; }
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
    let push = null;
    try { push = text === undefined ? null : parsePush(text, file); } catch { /* problemsFor reports the unreadable file */ }
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
  ...HOSTED_DEPLOYS.map((d) => [`HOSTED_DEPLOYS matches ${d.workflow}'s push paths`,
    [...d.sources].sort(), (parsePush(real[d.workflow], d.workflow) || { paths: [] }).paths.map(normalise).sort()]),
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
  // ── fail closed: every YAML shape a push trigger can take ─────────────────
  ["shape: `on: push` is a whole-repo push", names(problemsFor("s.yml", "on: push\njobs: {}\n", noLists)), ["s.yml (no paths filter: whole repo)"]],
  ["shape: `on: [push, workflow_dispatch]`", names(problemsFor("s.yml", "on: [push, workflow_dispatch]\n", noLists)), ["s.yml (no paths filter: whole repo)"]],
  ["shape: a quoted \"on\":", names(problemsFor("s.yml", "\"on\":\n  push:\n    paths:\n      - 'x/**'\n", noLists)).slice(0, 1), ["s.yml x/**"]],
  ["shape: four-space indentation", names(problemsFor("s.yml", "on:\n    push:\n        branches: [main]\n        paths:\n            - 'x/**'\n", noLists)), ["s.yml x/**"]],
  ["shape: a column-0 comment inside on:", names(problemsFor("s.yml", "on:\n  workflow_dispatch:\n# note\n  push:\n    branches: [main]\n    paths: ['x/**']\n", noLists)), ["s.yml x/**"]],
  ["shape: a comment between path items", names(problemsFor("s.yml", "on:\n  push:\n    branches: [main]\n    paths:\n      - 'x/**'\n# why\n      - 'y/**'\n", noLists)), ["s.yml x/**", "s.yml y/**"]],
  ["shape: a list under on:", names(problemsFor("s.yml", "on:\n  - push\n  - workflow_dispatch\n", noLists)), ["s.yml (no paths filter: whole repo)"]],
  ["shape: an inline map is reported, not skipped", names(problemsFor("s.yml", "on:\n  push: {branches: [main], paths: ['x/**']}\n", noLists)), ["s.yml (no paths filter: whole repo)"]],
  ["fail closed: no on: block is an error naming the file", problemsFor("s.yml", "name: x\njobs: {}\n", noLists).map((p) => p.why), ["s.yml: no top-level on: trigger found, so its push trigger cannot be checked"]],
  ["fail closed: push under on: that does not parse names the file", problemsFor("s.yml", "on:\n  workflow_dispatch:\n  pull_request:\n    # push to a fork\n  x: [push]\n", noLists).map((p) => p.why), ["s.yml: mentions push under on: but its trigger could not be parsed"]],
  ["a workflow without push is not reported for shape", problemsFor("s.yml", "on:\n  workflow_dispatch:\n  schedule:\n    - cron: '*/10 * * * *'\n", noLists), []],
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
