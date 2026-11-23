// The PH Agent Context backfill runs after a pipeline deploy (J3aBXuFlCsuXJ4404vAO).
//
// context-backfill.yml re-indexes after "Deploy backlog-tracker" through
// `on: workflow_run`, but GitHub creates no such event for a deploy started
// with the automation's own GITHUB_TOKEN. Every pipeline deploy is started
// that way, so the documentation library (876 Confluence pages) shipped with
// nothing in the index. sweepContextBackfill now dispatches the backfill
// itself after the newest successful console deploy, once per deploy run.
//
// Drives the REAL functions with an injected `gh` and a stubbed fetch, so
// there is no network.
// Run with:  node test/context-backfill-dispatch.test.js
"use strict";
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

// firestoreHeaders() signs a JWT with the service account key: give it a throwaway one.
const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const keyFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ctx-backfill-")), "sa.json");
fs.writeFileSync(keyFile, JSON.stringify({ client_email: "sa@test.example", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = keyFile;

const { contextBackfillPlan, sweepContextBackfill, CONTEXT_BACKFILL_WORKFLOW } = require("../scripts/run-backlog-automation.js");

const ok = (id, event = "workflow_dispatch") => ({ databaseId: id, event, status: "completed", conclusion: "success", url: `u/${id}` });

// A Firestore stand-in for the one marker document.
function fakeFirestore(initial) {
  let marker = initial || null;
  const writes = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    const json = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
    if (u.startsWith("https://oauth2.googleapis.com/token")) return json(200, { access_token: "t", expires_in: 3600 });
    if (!u.includes("/systemStatus/contextBackfill")) throw new Error(`unexpected fetch ${u}`);
    if ((opts.method || "GET") === "GET") {
      if (!marker) return json(404, { error: "not found" });
      return json(200, { fields: { deployRunId: { doubleValue: marker.deployRunId } } });
    }
    const fields = JSON.parse(opts.body).fields;
    marker = { deployRunId: Number(fields.deployRunId.doubleValue) };
    writes.push({ url: u, fields });
    return json(200, {});
  };
  return { writes, marker: () => marker };
}
function fakeGh(runs, { failDispatch = false } = {}) {
  const calls = [];
  const gh = (args) => {
    calls.push(args.join(" "));
    if (args[0] === "run" && args[1] === "list") return JSON.stringify(runs);
    if (args[0] === "workflow" && args[1] === "run") { if (failDispatch) throw new Error("HTTP 500"); return ""; }
    throw new Error(`unexpected gh ${args.join(" ")}`);
  };
  return { gh, calls, dispatches: () => calls.filter((c) => c.startsWith("workflow run")) };
}

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`FAIL  ${name}\n      ${err && err.stack ? err.stack.split("\n").slice(0, 6).join("\n      ") : err}`); }
}

(async () => {
  await test("plan: the newest successful deploy with no marker is backfilled", () => {
    const plan = contextBackfillPlan([ok(5), ok(9), ok(7)], null);
    assert.strictEqual(plan.run.databaseId, 9);
    assert.strictEqual(plan.dispatch, true);
  });
  await test("plan: a deploy already handled, or an older one, does nothing", () => {
    assert.strictEqual(contextBackfillPlan([ok(5), ok(9)], { deployRunId: 9 }), null);
    assert.strictEqual(contextBackfillPlan([ok(5)], { deployRunId: 9 }), null);
  });
  await test("plan: failed, cancelled and running deploys never start a backfill", () => {
    const runs = [
      { databaseId: 10, event: "workflow_dispatch", status: "completed", conclusion: "failure" },
      { databaseId: 11, event: "workflow_dispatch", status: "completed", conclusion: "cancelled" },
      { databaseId: 12, event: "workflow_dispatch", status: "in_progress", conclusion: "" },
    ];
    assert.strictEqual(contextBackfillPlan(runs, null), null);
    assert.strictEqual(contextBackfillPlan(runs.concat([ok(8)]), { deployRunId: 8 }), null);
  });
  await test("plan: a deploy from a person's push is recorded but not dispatched (its workflow_run starts the backfill)", () => {
    const plan = contextBackfillPlan([ok(4), ok(6, "push")], { deployRunId: 4 });
    assert.strictEqual(plan.run.databaseId, 6);
    assert.strictEqual(plan.dispatch, false);
  });

  await test("sweep: dispatches context-backfill.yml with apply=true once, then records the deploy run", async () => {
    const db = fakeFirestore(null);
    const f = fakeGh([ok(41), ok(42)]);
    const plan = await sweepContextBackfill({ gh: f.gh });
    assert.strictEqual(plan.run.databaseId, 42);
    assert.deepStrictEqual(f.dispatches(), [`workflow run ${CONTEXT_BACKFILL_WORKFLOW} --repo offline2online/rob_ph_demos --ref main -f apply=true`]);
    assert.strictEqual(db.marker().deployRunId, 42);
    // The next tick sees the marker: no second dispatch.
    assert.strictEqual(await sweepContextBackfill({ gh: f.gh }), null);
    assert.strictEqual(f.dispatches().length, 1);
  });
  await test("sweep: the deploy list is read for the console deploy on main only", async () => {
    fakeFirestore({ deployRunId: 42 });
    const f = fakeGh([ok(42)]);
    await sweepContextBackfill({ gh: f.gh });
    assert.ok(/^run list --repo offline2online\/rob_ph_demos --workflow deploy-backlog-tracker\.yml --branch main /.test(f.calls[0]), f.calls[0]);
  });
  await test("sweep: a failed dispatch throws and leaves the marker, so the next tick retries", async () => {
    const db = fakeFirestore({ deployRunId: 41 });
    const bad = fakeGh([ok(42)], { failDispatch: true });
    await assert.rejects(() => sweepContextBackfill({ gh: bad.gh }), /HTTP 500/);
    assert.strictEqual(db.marker().deployRunId, 41);
    assert.strictEqual(db.writes.length, 0);
    const good = fakeGh([ok(42)]);
    await sweepContextBackfill({ gh: good.gh });
    assert.strictEqual(good.dispatches().length, 1);
    assert.strictEqual(db.marker().deployRunId, 42);
  });

  await test("context-backfill.yml takes the apply input the sweep sends, and still runs after a pushed deploy", () => {
    const yml = fs.readFileSync(path.join(__dirname, "..", "..", ".github", "workflows", CONTEXT_BACKFILL_WORKFLOW), "utf8");
    assert.ok(/workflow_dispatch:\s*\n\s*inputs:\s*\n\s*apply:/.test(yml), "workflow_dispatch has an `apply` input");
    assert.ok(/APPLY: \$\{\{ github\.event_name == 'workflow_run' \|\| inputs\.apply \}\}/.test(yml), "apply=true writes the index");
    assert.ok(/workflow_run:\s*\n\s*workflows: \["Deploy backlog-tracker"\]/.test(yml), "still follows a pushed deploy");
  });
  await test("the automation job may dispatch workflows (actions: write)", () => {
    const yml = fs.readFileSync(path.join(__dirname, "..", "..", ".github", "workflows", "backlog-automation.yml"), "utf8");
    assert.ok(/permissions:[\s\S]*?\n\s*actions: write/.test(yml));
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
})();
