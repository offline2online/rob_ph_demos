// An approved train is never parked by GitHub's own hiccups, and a parked one
// resumes by itself once its PR is green (5 Oct 2026).
//
// PR #327 (Display Types): the "rules" check was never given a runner ("The
// job was not acquired by Runner of type hosted even after multiple
// attempts") and GitHub cancelled it after 15 minutes. The pipeline read that
// as red CI, parked the train, and waited for a second Deploy to Main click.
// PR #323 the same day: a test was fixed on the train, CI went green, and the
// train still sat parked until someone clicked again.
//
// Drives the REAL run-backlog-automation.js functions with a fake `gh` on
// PATH and an in-memory Firestore behind a stubbed fetch — no network.
// Run with:  node test/train-resume.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "train-resume-"));
const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
fs.writeFileSync(path.join(tmp, "sa.json"), JSON.stringify({ client_email: "t@example.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(tmp, "sa.json");

// Fake gh: `gh pr view N ...` prints $GH_PR_JSON; every call is logged.
const ghLog = path.join(tmp, "gh.log");
fs.writeFileSync(path.join(tmp, "gh"), `#!/bin/sh\necho "$@" >> "${ghLog}"\ncase "$1 $2" in "pr view") cat "${path.join(tmp, "pr.json")}";; esac\n`, { mode: 0o755 });
process.env.PATH = `${tmp}:${process.env.PATH}`;

const auto = require("../scripts/run-backlog-automation.js");
const { trainChecksState, isInfraCheck, rerunInfraChecks, resumeRedTrains, TRAIN_CI_INFRA_RERUNS } = auto;

// In-memory projects + a fetch that speaks just enough Firestore REST.
let projects = {};
const patches = [];
function enc(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return { integerValue: String(v) };
  return { stringValue: String(v) };
}
function dec(v) {
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("doubleValue" in v) return v.doubleValue;
  if ("integerValue" in v) return Number(v.integerValue);
  return v.stringValue;
}
global.fetch = async (url, opts = {}) => {
  const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  if (String(url).startsWith("https://oauth2.googleapis.com/token")) return ok({ access_token: "t", expires_in: 3600 });
  if (String(url).endsWith(":runQuery")) {
    const q = JSON.parse(opts.body).structuredQuery;
    const f = q.where.fieldFilter;
    const want = dec(f.value);
    return ok(Object.entries(projects).filter(([, p]) => p[f.field.fieldPath] === want)
      .map(([id, p]) => ({ document: { name: `x/projects/${id}`, fields: Object.fromEntries(Object.entries(p).map(([k, v]) => [k, enc(v)])) } })));
  }
  const m = String(url).match(/\/projects\/([^?/]+)\?/);
  if (m && opts.method === "PATCH") {
    const fields = Object.fromEntries(Object.entries(JSON.parse(opts.body).fields).map(([k, v]) => [k, dec(v)]));
    patches.push({ id: m[1], fields });
    Object.assign(projects[m[1]], fields);
    return ok({});
  }
  throw new Error(`unexpected fetch ${url}`);
};

const done = (name, conclusion, extra = {}) => ({ name, status: "COMPLETED", conclusion, ...extra });
const setPr = (pr) => fs.writeFileSync(path.join(tmp, "pr.json"), JSON.stringify(pr));
const ghCalls = () => (fs.existsSync(ghLog) ? fs.readFileSync(ghLog, "utf8").trim().split("\n").filter(Boolean) : []);

let passed = 0; const failures = [];
async function test(name, fn) {
  projects = {}; patches.length = 0; try { fs.unlinkSync(ghLog); } catch {}
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`FAIL  ${name}\n      ${err && err.stack || err}`); }
}

(async () => {
  await test("a check GitHub cancelled (no runner) is 'infra', not a test failure", async () => {
    const rules = done("rules", "CANCELLED", { detailsUrl: "https://github.com/o/r/actions/runs/37369865858/job/111964145261" });
    assert.strictEqual(isInfraCheck(rules), true);
    assert.strictEqual(trainChecksState([done("e2e-quick", "SUCCESS"), rules]), "infra");
    assert.strictEqual(trainChecksState([done("e2e-quick", "TIMED_OUT")]), "infra");
    assert.strictEqual(trainChecksState([done("e2e-quick", "STARTUP_FAILURE")]), "infra");
  });

  await test("a real failure still wins over a cancellation", async () => {
    assert.strictEqual(trainChecksState([done("e2e-quick", "FAILURE"), done("rules", "CANCELLED")]), "failure");
  });

  await test("rerunInfraChecks re-runs each cancelled check's workflow run once, and nothing else", async () => {
    const n = rerunInfraChecks([
      done("rules", "CANCELLED", { detailsUrl: "https://github.com/o/r/actions/runs/111/job/1" }),
      done("rules-2", "TIMED_OUT", { detailsUrl: "https://github.com/o/r/actions/runs/111/job/2" }),
      done("e2e-quick", "SUCCESS", { detailsUrl: "https://github.com/o/r/actions/runs/222/job/3" }),
    ]);
    assert.strictEqual(n, 1);
    assert.deepStrictEqual(ghCalls(), ["api -X POST repos/offline2online/rob_ph_demos/actions/runs/111/rerun"]);
    assert.strictEqual(TRAIN_CI_INFRA_RERUNS, 2);
  });

  await test("a train parked on red CI resumes once its PR is green (fix pushed or re-run passed)", async () => {
    projects = { dsp: { trainStatus: "conflict", trainReady: false, trainCiRedPr: 327, trainCiRedSha: "aaa" } };
    setPr({ number: 327, state: "OPEN", headRefOid: "bbb", statusCheckRollup: [done("e2e-quick", "SUCCESS"), done("rules", "SUCCESS")] });
    await resumeRedTrains();
    assert.strictEqual(projects.dsp.trainReady, true, "re-armed: processDeployTrain merges it this same run");
    assert.strictEqual(projects.dsp.trainStatus, "deploying");
    assert.strictEqual(projects.dsp.trainCiRedPr, null);
  });

  await test("still red on the same PR: stays parked", async () => {
    projects = { dsp: { trainStatus: "conflict", trainReady: false, trainCiRedPr: 327, trainCiRedSha: "aaa" } };
    setPr({ number: 327, state: "OPEN", headRefOid: "aaa", statusCheckRollup: [done("e2e-quick", "FAILURE")] });
    await resumeRedTrains();
    assert.strictEqual(patches.length, 0);
    assert.strictEqual(projects.dsp.trainReady, false);
  });

  await test("a merge conflict (no trainCiRedPr) is left for a person", async () => {
    projects = { dsp: { trainStatus: "conflict", trainReady: false } };
    setPr({ number: 327, state: "OPEN", headRefOid: "aaa", statusCheckRollup: [done("e2e-quick", "SUCCESS")] });
    await resumeRedTrains();
    assert.strictEqual(patches.length, 0);
  });

  await test("a PR closed without merging just forgets the red marker", async () => {
    projects = { dsp: { trainStatus: "conflict", trainReady: false, trainCiRedPr: 327, trainCiRedSha: "aaa" } };
    setPr({ number: 327, state: "CLOSED", headRefOid: "aaa", statusCheckRollup: [] });
    await resumeRedTrains();
    assert.strictEqual(projects.dsp.trainReady, false);
    assert.strictEqual(projects.dsp.trainCiRedPr, null);
  });

  await test("a PR someone merged by hand re-arms too, so the cards are recorded as live", async () => {
    projects = { dsp: { trainStatus: "conflict", trainReady: false, trainCiRedPr: 327, trainCiRedSha: "aaa" } };
    setPr({ number: 327, state: "MERGED", headRefOid: "aaa", statusCheckRollup: [done("e2e-quick", "FAILURE")] });
    await resumeRedTrains();
    assert.strictEqual(projects.dsp.trainReady, true);
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failures.length ? 1 : 0);
})();
