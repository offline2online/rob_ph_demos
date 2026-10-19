// docsImpact (scripts/docs-impact.js) and its gate in processApplyPatch:
// a patch that changes an API or schema without its spec is refused unless
// the build says why. No network, credentials or emulator.
//
// Run with:  node test/docs-impact.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const di = require("../scripts/docs-impact.js");

let passed = 0; const failures = [];
function test(name, fn) {
  const cwd = process.cwd();
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`FAIL  ${name}\n      ${err && err.stack || err}`); }
  finally { process.chdir(cwd); }
}
const sh = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const repoRoot = path.resolve(__dirname, "..", "..");
const CLI = path.join(__dirname, "..", "scripts", "docs-impact.js");

const DOC = "dsp-integration/docs/dsp-integration/REQUIREMENTS.md";
const MIG = "dsp-integration/apps/api/src/db/migrations/0100_x.up.sql";
const rule = { when: ["dsp-integration/apps/api/src/db/migrations/**"], require: [DOC], why: "schema changes are specified", manifest: "dsp-integration/board-docs.json" };

test("globs: ** spans segments (or none), * stays in one", () => {
  const g = di.globToRegExp("dsp-integration/**/openapi.yaml");
  assert.ok(g.test("dsp-integration/openapi.yaml"));
  assert.ok(g.test("dsp-integration/docs/dsp-integration/api/openapi.yaml"));
  assert.ok(!g.test("dsp-integration/docs/openapi.yml"));
  const m = di.globToRegExp("dsp-integration/packages/*/migrations/**");
  assert.ok(m.test("dsp-integration/packages/campaign-approval/migrations/0101_x.up.sql"));
  assert.ok(!m.test("dsp-integration/packages/a/b/migrations/x.sql"));
  assert.ok(di.globToRegExp("a.b/*.js").test("a.b/x.js") && !di.globToRegExp("a.b/*.js").test("aXb/x.js"));
});

test("docsImpactCheck: unmet, met, any-one-of, none, only the unmet of two", () => {
  const u = di.docsImpactCheck([MIG], [rule]);
  assert.strictEqual(u.length, 1);
  assert.deepStrictEqual(u[0].matched, [MIG]);
  assert.deepStrictEqual(u[0].rule.require, [DOC]);
  assert.deepStrictEqual(di.docsImpactCheck([MIG, DOC], [rule]), []);
  const two = { ...rule, require: ["README.md", DOC] };
  assert.deepStrictEqual(di.docsImpactCheck([MIG, "README.md"], [two]), []);
  assert.deepStrictEqual(di.docsImpactCheck([MIG], []), []);
  const other = { when: ["x/**"], require: ["x/SPEC.md"], manifest: "m" };
  const both = di.docsImpactCheck([MIG, "x/a.js", "x/SPEC.md"], [rule, other]);
  assert.strictEqual(both.length, 1);
  assert.strictEqual(both[0].rule, rule);
});

test("validateDocsImpact flags dead globs, missing requires, '..', leading '/', long why", () => {
  const tracked = [MIG, DOC];
  const exists = (p) => tracked.includes(p);
  const opts = { exists, trackedPaths: tracked };
  assert.deepStrictEqual(di.validateDocsImpact([rule], opts), []);
  const errs = (r) => di.validateDocsImpact([{ ...rule, ...r }], opts).join("\n");
  assert.match(errs({ when: ["dsp-integration/apps/api/migrations/**"] }), /matches no tracked file/);
  assert.match(errs({ require: ["nope.md"] }), /does not exist/);
  assert.match(errs({ when: ["../x"] }), /no "\.\."/);
  assert.match(errs({ when: ["/etc/**"] }), /leading "\/"/);
  assert.match(errs({ require: ["a/../b.md"] }), /no "\.\."/);
  assert.match(errs({ when: [] }), /non-empty/);
  assert.match(errs({ why: "x".repeat(201) }), /200 characters/);
  assert.deepStrictEqual(di.validateDocsImpact([{ ...rule, why: "x".repeat(200) }], opts), []);
});

test("note texts: refusal caps paths at 5 and names doc, why and manifest; waiver cuts at 500", () => {
  const many = Array.from({ length: 8 }, (_, i) => `dsp-integration/apps/api/src/db/migrations/00${i}_x.sql`);
  const note = di.refusalNote({ rule, matched: many });
  assert.ok(note.startsWith("Not built: this patch changes "));
  assert.ok(note.includes(many[4]) && !note.includes(many[5]) && note.includes("+3 more"));
  assert.ok(note.includes(DOC) && note.includes("schema changes are specified") && note.includes("rule in dsp-integration/board-docs.json"));
  assert.ok(note.includes("patchDocsImpact"));
  const w = di.waiverNote({ rule, matched: [MIG] }, "z".repeat(900));
  assert.ok(w.startsWith(`Spec not updated: changes ${MIG} without ${DOC}. The build says: `));
  assert.strictEqual(w.match(/z{20,}/)[0].length, 500);
});

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-impact-"));
  sh(dir, "init", "--quiet", "-b", "train");
  sh(dir, "config", "user.name", "t"); sh(dir, "config", "user.email", "t@example.com");
  fs.mkdirSync(path.join(dir, "dsp-integration/docs/dsp-integration"), { recursive: true });
  fs.mkdirSync(path.join(dir, "dsp-integration/apps/api/src/db/migrations"), { recursive: true });
  fs.writeFileSync(path.join(dir, DOC), "# Spec\n");
  fs.writeFileSync(path.join(dir, "dsp-integration/apps/api/src/db/migrations/0099_a.up.sql"), "select 1;\n");
  fs.writeFileSync(path.join(dir, "dsp-integration/board-docs.json"), JSON.stringify({ projectId: "p", docsImpact: [{ when: rule.when, require: rule.require, why: rule.why }] }));
  fs.mkdirSync(path.join(dir, "node_modules/x"), { recursive: true });
  fs.writeFileSync(path.join(dir, "node_modules/x/board-docs.json"), "{ not json");
  sh(dir, "add", "-A", "-f"); sh(dir, "commit", "-m", "base", "--quiet");
  return dir;
}
const staged = (dir) => sh(dir, "diff", "--cached", "--name-only").split("\n").filter(Boolean);

test("disposable repo: staged migration is unmet; unchanged doc copy still unmet; edited doc meets it", () => {
  const dir = repo();
  const { rules, problems } = di.loadDocsImpactRules(dir);
  assert.deepStrictEqual(problems, [], "node_modules manifests are skipped");
  assert.strictEqual(rules.length, 1);
  assert.strictEqual(rules[0].manifest, "dsp-integration/board-docs.json");
  fs.writeFileSync(path.join(dir, MIG), "create table t(id int);\n");
  sh(dir, "add", "-A");
  assert.strictEqual(di.docsImpactCheck(staged(dir), rules).length, 1);
  fs.writeFileSync(path.join(dir, DOC), "# Spec\n"); // identical content
  sh(dir, "add", "-A");
  assert.ok(!staged(dir).includes(DOC));
  assert.strictEqual(di.docsImpactCheck(staged(dir), rules).length, 1);
  fs.writeFileSync(path.join(dir, DOC), "# Spec\n\n## Table t\n");
  sh(dir, "add", "-A");
  assert.deepStrictEqual(di.docsImpactCheck(staged(dir), rules), []);
});

test("a manifest that does not parse is reported, not thrown", () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, "bad-board-docs.json"), "x");
  fs.mkdirSync(path.join(dir, "sub"));
  fs.writeFileSync(path.join(dir, "sub/board-docs.json"), "{ nope");
  sh(dir, "add", "-A");
  const { problems, rules } = di.loadDocsImpactRules(dir);
  assert.strictEqual(problems.length, 1);
  assert.match(problems[0], /sub\/board-docs\.json: does not parse/);
  assert.strictEqual(rules.length, 1);
});

test("CLI exits 1 with an unmet rule and 0 without", () => {
  const dir = repo();
  const run = (...a) => spawnSync("node", [CLI, ...a], { cwd: dir, encoding: "utf8" });
  assert.strictEqual(run().status, 0);
  fs.writeFileSync(path.join(dir, MIG), "create table t(id int);\n");
  const bad = run();
  assert.strictEqual(bad.status, 1);
  assert.match(bad.stdout, /Not built: this patch changes .*0100_x\.up\.sql/);
  fs.writeFileSync(path.join(dir, DOC), "# Spec\n\n## t\n");
  assert.strictEqual(run().status, 0);
  sh(dir, "add", "-A"); sh(dir, "commit", "-m", "both", "--quiet");
  const base = sh(dir, "rev-parse", "HEAD~1");
  assert.strictEqual(run("--base", base).status, 0);
});

test("run-backlog-automation.js: gate sits between the staged diff and the commit, refuses cleanly, clears the reason on landing", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "run-backlog-automation.js"), "utf8");
  const body = src.slice(src.indexOf("async function processApplyPatch("));
  const a = body.indexOf("changedPaths = stagedChangedPaths()");
  const g = body.indexOf("docsImpactCheck(");
  const c = body.indexOf("commitOnTrain(");
  assert.ok(a > 0 && g > a && c > g, "gate order");
  const branch = body.slice(g, body.indexOf("if (!changedPaths.length)", g));
  assert.ok(branch.includes("discardWorkingTree()") && /patchReady: false/.test(branch) && branch.includes("patchAttempts: 0"));
  assert.ok(branch.includes("queueBuildRequest("));
  const landing = body.slice(body.indexOf("deployCommit: sha,"));
  assert.ok(/patchDocsImpact: null/.test(landing), "landing clears patchDocsImpact");
  const rules = fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8");
  assert.ok(!rules.includes("patchDocsImpact"), "no rules change");
});

test("every real board-docs.json passes validateDocsImpact", () => {
  const { rules, problems } = di.loadDocsImpactRules(repoRoot);
  assert.deepStrictEqual(problems, []);
  const tracked = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n").filter(Boolean);
  const errs = di.validateDocsImpact(rules, { exists: (p) => fs.existsSync(path.join(repoRoot, p)), trackedPaths: tracked });
  assert.deepStrictEqual(errs, []);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
