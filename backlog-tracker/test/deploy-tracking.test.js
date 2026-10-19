// Every deploy a train merge starts is recorded on the card it ships
// (deployRuns) and rolled up into deployConclusion, so a Display Types card is
// not "Deploy succeeded" on the console's own deploy while dsp-api-deploy.yml
// failed or the prototype was never rebuilt (26-28 Sep, 21-22 Sep 2026).
//
// Drives the REAL planDeployRuns / rollUpDeployRuns / resolveDeployRun /
// prototypeBuildCurrent with an injected `gh` and a disposable git repo.
// Run with:  node test/deploy-tracking.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const auto = require("../scripts/run-backlog-automation.js");
const { planDeployRuns, rollUpDeployRuns, resolveDeployRun, prototypeSourceStamp, prototypeBuildCurrent } = auto;

const AT = "2026-10-19T05:00:00.000Z";
const names = (runs) => runs.map((r) => r.workflow);
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`  ok  ${name}`); }

(async () => {
  await test("a DSP train with API source, admin source and version.js tracks the prototype and the API, not the console", () => {
    const paths = ["dsp-integration/apps/api/src/x.ts", "dsp-integration/apps/admin/src/App.tsx", "backlog-tracker/public/js/version.js"];
    const runs = planDeployRuns(paths, { console: true, hosted: ["dsp-api-deploy.yml"], faq: false }, AT);
    assert.deepStrictEqual(names(runs), ["dsp-prototype.yml", "dsp-api-deploy.yml"]);
    assert.ok(runs.every((r) => r.conclusion === "pending" && r.runUrl === null && r.dispatchedAt === AT));
  });
  await test("a backlog-tracker/public/js/app.js change tracks deploy-backlog-tracker.yml; faq/data adds faq-content.yml", () => {
    assert.deepStrictEqual(names(planDeployRuns(["backlog-tracker/public/js/app.js", "backlog-tracker/public/js/version.js"], { console: true }, AT)), ["deploy-backlog-tracker.yml"]);
    assert.deepStrictEqual(names(planDeployRuns(["faq/data/index.json", "backlog-tracker/public/js/version.js"], { console: true, faq: true }, AT)), ["deploy-backlog-tracker.yml", "faq-content.yml"]);
  });
  await test("a docs-only DSP train tracks nothing and rolls up to not-applicable", () => {
    const runs = planDeployRuns(["dsp-integration/README.md", "backlog-tracker/public/js/version.js"], { console: true }, AT);
    assert.deepStrictEqual(runs, []);
    assert.deepStrictEqual(rollUpDeployRuns(runs), { deployConclusion: "not-applicable", deployRunUrl: null });
  });
  await test("a dispatch that threw is not-dispatched", () => {
    const runs = planDeployRuns(["dsp-integration/apps/api/src/x.ts"], { console: false, hosted: [] }, AT);
    assert.strictEqual(runs.find((r) => r.workflow === "dsp-api-deploy.yml").conclusion, "not-dispatched");
    assert.strictEqual(rollUpDeployRuns(runs).deployConclusion, "pending", "the prototype check is still pending");
    assert.strictEqual(rollUpDeployRuns([runs[1]]).deployConclusion, "failure");
  });

  await test("roll-up: pending while any is, failure if any failed, success when all are; url is the failing run else the first pending", () => {
    const r = (workflow, conclusion, runUrl = null) => ({ workflow, dispatchedAt: AT, runUrl, conclusion });
    assert.deepStrictEqual(rollUpDeployRuns([r("a", "success", "u/a"), r("b", "pending", "u/b")]), { deployConclusion: "pending", deployRunUrl: "u/b" });
    assert.deepStrictEqual(rollUpDeployRuns([r("a", "failure", "u/a"), r("b", "pending", "u/b")]), { deployConclusion: "pending", deployRunUrl: "u/a" });
    assert.deepStrictEqual(rollUpDeployRuns([r("a", "success", "u/a"), r("b", "cancelled", "u/b")]), { deployConclusion: "failure", deployRunUrl: "u/b" });
    assert.deepStrictEqual(rollUpDeployRuns([r("a", "success", "u/a"), r("b", "success")]), { deployConclusion: "success", deployRunUrl: "u/a" });
  });

  // ── resolving, with a stubbed gh ────────────────────────────────────────
  const entry = (workflow, extra = {}) => ({ workflow, dispatchedAt: AT, runUrl: null, conclusion: "pending", ...extra });
  const ctxFor = (gh) => ({ runs: new Map(), heal: new Map(), gh, prototypeCurrent: () => false });
  const listing = (rows) => (args) => {
    if (args[0] === "run" && args[1] === "list") return JSON.stringify(rows);
    throw new Error(`unexpected gh ${args.join(" ")}`);
  };
  await test("a finished successful run is written with its url", () => {
    const gh = listing([{ databaseId: 5, url: "https://github.com/o/r/actions/runs/5", createdAt: "2026-10-19T05:00:05Z", status: "completed", conclusion: "success", event: "workflow_dispatch" }]);
    const out = resolveDeployRun(entry("dsp-api-deploy.yml"), ctxFor(gh));
    assert.strictEqual(out.conclusion, "success");
    assert.strictEqual(out.runUrl, "https://github.com/o/r/actions/runs/5");
  });
  await test("a cancelled dsp-api-deploy.yml run with a newer success is adopted", () => {
    const rows = [
      { databaseId: 7, url: "https://github.com/o/r/actions/runs/7", createdAt: "2026-10-19T05:30:00Z", status: "completed", conclusion: "success", event: "push" },
      { databaseId: 5, url: "https://github.com/o/r/actions/runs/5", createdAt: "2026-10-19T05:00:05Z", status: "completed", conclusion: "cancelled", event: "workflow_dispatch" },
    ];
    const gh = (args) => {
      if (args[0] === "run" && args[1] === "view") {
        return args.includes("status,conclusion,url")
          ? JSON.stringify({ status: "completed", conclusion: "cancelled", url: "https://github.com/o/r/actions/runs/5" })
          : JSON.stringify({ createdAt: "2026-10-19T05:00:05Z", attempt: 1 });
      }
      if (args[0] === "run" && args[1] === "list") { assert.ok(args.includes("dsp-api-deploy.yml"), "lists the workflow it was given"); return JSON.stringify(rows); }
      throw new Error(`unexpected gh ${args.join(" ")}`);
    };
    const out = resolveDeployRun(entry("dsp-api-deploy.yml", { runUrl: "https://github.com/o/r/actions/runs/5" }), ctxFor(gh));
    assert.strictEqual(out.conclusion, "success");
    assert.strictEqual(out.runUrl, "https://github.com/o/r/actions/runs/7");
  });
  await test("a failed faq-content.yml run is not adopted from a newer one", () => {
    const calls = [];
    const gh = (args) => {
      calls.push(args.join(" "));
      if (args[0] === "run" && args[1] === "list") return JSON.stringify([
        { databaseId: 9, url: "u/9", createdAt: "2026-10-19T06:00:00Z", status: "completed", conclusion: "success", event: "schedule" },
        { databaseId: 5, url: "u/5", createdAt: "2026-10-19T05:00:05Z", status: "completed", conclusion: "failure", event: "workflow_dispatch" },
      ]);
      throw new Error("unexpected");
    };
    const out = resolveDeployRun(entry("faq-content.yml"), ctxFor(gh));
    assert.strictEqual(out.conclusion, "failure");
    assert.strictEqual(out.runUrl, "u/5");
    assert.ok(!calls.some((c) => c.startsWith("run rerun")), "no re-run of a sync");
  });
  await test("a run still going stays pending; a train's cards share one lookup", () => {
    let lists = 0;
    const gh = (args) => { lists++; return JSON.stringify([{ databaseId: 5, url: "u/5", createdAt: "2026-10-19T05:00:05Z", status: "in_progress", conclusion: "", event: "workflow_dispatch" }]); };
    const ctx = ctxFor(gh);
    assert.strictEqual(resolveDeployRun(entry("dsp-api-deploy.yml"), ctx).conclusion, "pending");
    resolveDeployRun(entry("dsp-api-deploy.yml"), ctx);
    assert.strictEqual(lists, 1);
  });

  // ── the prototype check, in a disposable repo with the real script ─────
  await test("the prototype entry follows build-info.json's sourceStamp against origin/main", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-tracking-"));
    const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    git(root, "init", "-q", "--bare", "-b", "main", "origin.git");
    git(root, "clone", "-q", "origin.git", "work");
    const work = path.join(root, "work");
    git(work, "config", "user.email", "t@t"); git(work, "config", "user.name", "t");
    git(work, "checkout", "-q", "-b", "main");
    const put = (rel, text) => { const f = path.join(work, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
    put("dsp-integration/scripts/rebuild-prototype.sh", fs.readFileSync(path.join(__dirname, "..", "..", "dsp-integration", "scripts", "rebuild-prototype.sh"), "utf8"));
    put("dsp-integration/apps/admin/src/App.tsx", "v1\n");
    put("dsp-integration/apps/admin/public/demo/api-snapshot.json", "{}\n");
    put("dsp-integration/packages/x/index.ts", "x\n");
    put("dsp-integration/package.json", "{}\n");
    put("dsp-integration/package-lock.json", "{}\n");
    const commit = (m) => { git(work, "add", "-A"); git(work, "commit", "-q", "-m", m); git(work, "push", "-q", "origin", "main"); };
    commit("source");
    const g = (args, opts = {}) => execFileSync("git", args, { cwd: work, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
    const stamp = prototypeSourceStamp("HEAD", { git: g });
    put("dsp-integration/prototype/build-info.json", JSON.stringify({ commit: "abc", sourceStamp: stamp }));
    commit("rebuild");
    const script = () => { try { execFileSync("bash", ["dsp-integration/scripts/rebuild-prototype.sh", "--check"], { cwd: work, stdio: "pipe" }); return 0; } catch (e) { return e.status; } };
    assert.strictEqual(prototypeBuildCurrent({ git: g }), true, "JS stamp matches build-info.json");
    assert.strictEqual(script(), 0, "and so does the real script's --check");
    // Not a rebuild: a rebuild-only commit moves main without moving the stamp.
    put("dsp-integration/apps/admin/public/demo/api-snapshot.json", "{\"n\":1}\n");
    commit("snapshot only");
    assert.strictEqual(prototypeBuildCurrent({ git: g }), true);
    put("dsp-integration/apps/admin/src/App.tsx", "v2\n");
    commit("source change, no rebuild");
    assert.strictEqual(prototypeBuildCurrent({ git: g }), false);
    assert.strictEqual(script(), 1, "the script says stale too");
    const ctx = { runs: new Map(), heal: new Map(), prototypeCurrent: () => prototypeBuildCurrent({ git: g }) };
    assert.strictEqual(resolveDeployRun(entry("dsp-prototype.yml"), ctx).conclusion, "pending");
    fs.rmSync(root, { recursive: true, force: true });
  });

  console.log(`\n${passed} passed, 0 failed`);
})().catch((e) => { console.error(e); process.exit(1); });
