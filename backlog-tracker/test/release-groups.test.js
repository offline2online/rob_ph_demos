// Release groups (Flow 9/9): projects that ship in one deployable share one
// train — the group's deployBranch, one lock, one Deploy to Main, one PR,
// one version bump. Each project keeps its own Backlog, columns and docs.
//
// Drives the pure rules (functions/release-groups.js, and its browser copy
// public/js/release-groups.js) and the REAL run-backlog-automation.js
// functions that read a train — reconcileLockedTrains, processDeployTrain's
// refusals, finishTrain, the revert blocker naming — against an in-memory
// Firestore behind a stubbed fetch, a fake `gh` on PATH and disposable local
// git repos. No network, never the real repo. A project with no group is
// covered unchanged by the existing train tests (train-lock*.test.js etc.).
//
// Run with:  node test/release-groups.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const rg = require("../functions/release-groups");

let passed = 0;
const failures = [];
const asyncTests = [];
function test(name, fn) { asyncTests.push([name, fn]); }

// ── Fixtures ────────────────────────────────────────────────────────────────
const GROUP = { id: "G", name: "PH Agent Console", deployBranch: "deploy/ph-agent-console", projectIds: ["BT", "SK"] };
const BT = { id: "BT", name: "Backlog Tracker & FAQs", deployBranch: "deploy/backlog-tracker-faqs", releaseGroupId: "G" };
const SK = { id: "SK", name: "Staff Kanban", deployBranch: "deploy/kanban-staff-board", releaseGroupId: "G" };
const DSP = { id: "DSP", name: "Display Types", deployBranch: "deploy/dsp-integration" };
const byId = { BT, SK, DSP };

// ── The pure rules ──────────────────────────────────────────────────────────
test("a project in a group trains on the group's branch and keeps its own as ownDeployBranch", () => {
  const p = rg.withReleaseGroup(BT, [GROUP]);
  assert.strictEqual(p.deployBranch, "deploy/ph-agent-console");
  assert.strictEqual(p.ownDeployBranch, "deploy/backlog-tracker-faqs");
  assert.deepStrictEqual(p.trainProjectIds, ["BT", "SK"]);
  assert.strictEqual(rg.trainKeyOf(p), "group:G");
  assert.strictEqual(rg.trainKeyOf(rg.withReleaseGroup(SK, [GROUP])), "group:G", "both members are one train");
});

test("reading a project through its group twice keeps its own branch", () => {
  const twice = rg.withReleaseGroup(rg.withReleaseGroup(BT, [GROUP]), [GROUP]);
  assert.strictEqual(twice.ownDeployBranch, "deploy/backlog-tracker-faqs");
  assert.strictEqual(twice.deployBranch, "deploy/ph-agent-console");
});

test("a project with no group is exactly as before", () => {
  const p = rg.withReleaseGroup(DSP, [GROUP]);
  assert.strictEqual(p.deployBranch, "deploy/dsp-integration");
  assert.strictEqual(p.releaseGroup, null);
  assert.ok(!("ownDeployBranch" in p));
  assert.deepStrictEqual(rg.trainProjectIdsOf(p), ["DSP"]);
  assert.strictEqual(rg.trainPrTitle(p, 2), "Deploy Display Types — 2 tickets");
});

test("membership needs both pointers: a group that doesn't list the project back doesn't count", () => {
  const p = rg.withReleaseGroup(BT, [{ ...GROUP, projectIds: ["SK"] }]);
  assert.strictEqual(p.deployBranch, "deploy/backlog-tracker-faqs");
  assert.deepStrictEqual(p.trainProjectIds, ["BT"]);
});

test("Deploy is offered only when every ticket on the shared train, in both projects, is approved", () => {
  const p = rg.withReleaseGroup(BT, [GROUP]);
  const both = [
    { id: "a", projectId: "BT", status: "ready-to-publish", deployCommit: "1" },
    { id: "b", projectId: "SK", status: "ready-to-publish", deployCommit: "2" },
    { id: "x", projectId: "DSP", status: "ready-for-testing", deployCommit: "3" },
  ];
  assert.strictEqual(rg.trainReadiness(p, both, byId).ready, true, "another project's train is not ours");
  const held = both.concat({ id: "c", projectId: "SK", title: "Fix the filter", status: "ready-for-testing", deployCommit: "4" });
  const r = rg.trainReadiness(p, held, byId);
  assert.strictEqual(r.ready, false);
  assert.strictEqual(r.heldByOtherProject, true);
  assert.strictEqual(r.reason, "Waiting for Staff Kanban: Fix the filter is in Ready for Testing");
  // From Staff Kanban's own side the blocker is its own visible card: no "Waiting for" line.
  assert.strictEqual(rg.trainReadiness(rg.withReleaseGroup(SK, [GROUP]), held, byId).reason, null);
});

test("a revert still coming off the shared train holds it too, named by project", () => {
  const p = rg.withReleaseGroup(BT, [GROUP]);
  const r = rg.trainReadiness(p, [
    { id: "a", projectId: "BT", status: "ready-to-publish", deployCommit: "1" },
    { id: "d", projectId: "SK", title: "Old", status: "backlog", deployCommit: "5", revertRequested: true },
  ], byId);
  assert.strictEqual(r.ready, false);
  assert.match(r.reason, /^Waiting for Staff Kanban: Old is still coming off the train$/);
});

test("header line, PR title and PR body speak for the group, tickets listed by project", () => {
  const p = rg.withReleaseGroup(BT, [GROUP]);
  assert.strictEqual(rg.shipsWithLine(p, byId), "Ships with Staff Kanban · PH Agent Console");
  assert.strictEqual(rg.shipsWithLine(rg.withReleaseGroup(DSP, [GROUP]), byId), null);
  assert.strictEqual(rg.trainPrTitle(p, 3), "Deploy PH Agent Console — 3 tickets");
  const body = rg.trainPrBody(p, [
    { id: "a", projectId: "BT", title: "Console fix" },
    { id: "b", projectId: "SK", title: "Kanban fix" },
  ], byId);
  assert.ok(body.includes("### Backlog Tracker & FAQs\n\n- Console fix\n  Backlog item: a"), body);
  assert.ok(body.includes("### Staff Kanban\n\n- Kanban fix\n  Backlog item: b"), body);
  assert.ok(body.indexOf("### Backlog Tracker") < body.indexOf("### Staff Kanban"));
  assert.ok(body.includes("`deploy/ph-agent-console`"));
});

test("group edits are refused while a train involved has tickets on it", () => {
  const items = [
    { projectId: "BT", status: "ready-for-testing", deployCommit: "1" },
    { projectId: "SK", status: "backlog", deployCommit: "2", revertRequested: true },
    { projectId: "SK", status: "published-live", deployCommit: "3" },
  ];
  assert.strictEqual(rg.trainLoad(items, ["BT"]), 1);
  assert.strictEqual(rg.trainLoad(items, ["SK"]), 1, "a pending revert still occupies it; a shipped card doesn't");
  const refusal = rg.groupEditRefusal([{ label: "PH Agent Console's shared train", count: 2 }, { label: "Display Types's own train", count: 0 }]);
  assert.match(refusal, /^Not changed: PH Agent Console's shared train has 2 tickets on it\. /);
  assert.strictEqual(rg.groupEditRefusal([{ label: "x", count: 0 }]), null);
  assert.strictEqual(rg.isValidGroupBranch("deploy/ph-agent-console"), true);
  assert.strictEqual(rg.isValidGroupBranch("main"), false);
});

test("the deploy queue never holds a group behind its own other member", () => {
  const queue = { entries: [{ projectId: "SK", deployBranch: "deploy/ph-agent-console" }, { projectId: "DSP", deployBranch: "deploy/dsp-integration" }, { projectId: "BT", deployBranch: "deploy/ph-agent-console" }] };
  const bt = rg.withReleaseGroup(BT, [GROUP]);
  assert.deepStrictEqual(rg.withoutGroupMates(queue, bt).entries.map((e) => e.projectId), ["DSP", "BT"], "the group-mate's entry is dropped, others keep their place");
  const dsp = rg.withReleaseGroup(DSP, [GROUP]);
  assert.strictEqual(rg.withoutGroupMates(queue, dsp), queue, "no group: the queue is unchanged");
});

test("the browser copy gives the same answers as the server's", async () => {
  const web = await import(path.join(__dirname, "../public/js/release-groups.js"));
  const items = [{ id: "c", projectId: "SK", title: "T", status: "ready-for-testing", deployCommit: "4" }, { id: "a", projectId: "BT", status: "ready-to-publish", deployCommit: "1" }];
  for (const proj of [BT, SK, DSP]) {
    const a = rg.withReleaseGroup(proj, [GROUP]);
    const b = web.withReleaseGroup(proj, [GROUP]);
    assert.deepStrictEqual(b, a);
    assert.deepStrictEqual(web.trainReadiness(b, items, byId).reason, rg.trainReadiness(a, items, byId).reason);
    assert.strictEqual(web.shipsWithLine(b, byId), rg.shipsWithLine(a, byId));
  }
  assert.strictEqual(web.groupEditRefusal([{ label: "x", count: 1 }]), rg.groupEditRefusal([{ label: "x", count: 1 }]));
});

// ── The automation, against an in-memory Firestore ──────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "release-groups-"));
const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
fs.writeFileSync(path.join(tmp, "sa.json"), JSON.stringify({ client_email: "t@example.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(tmp, "sa.json");
// Fake gh: every call logged; `pr view` answers an empty object.
const ghLog = path.join(tmp, "gh.log");
fs.writeFileSync(path.join(tmp, "gh"), `#!/bin/sh\necho "$@" >> "${ghLog}"\ncase "$1 $2" in "pr view") echo '{}';; esac\n`, { mode: 0o755 });
process.env.PATH = `${tmp}:${process.env.PATH}`;

const auto = require("../scripts/run-backlog-automation.js");
const { fdoc, tv } = auto;

let store = {};
const projectPatches = [];
function rowsOf(coll) { return Object.entries(store[coll] || {}); }
function matches(d, f) {
  const want = f.value.arrayValue ? f.value.arrayValue.values.map((v) => fdoc({ v }).v) : fdoc({ v: f.value }).v;
  const got = d[f.field.fieldPath];
  if (f.op === "IN") return want.includes(got);
  return got === want;
}
global.fetch = async (url, opts = {}) => {
  const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  const notFound = { ok: false, status: 404, json: async () => ({}), text: async () => "not found" };
  url = String(url);
  if (url.startsWith("https://oauth2.googleapis.com/token")) return ok({ access_token: "t", expires_in: 3600 });
  if (url.endsWith(":runQuery")) {
    const q = JSON.parse(opts.body).structuredQuery;
    const coll = q.from[0].collectionId;
    const f = q.where && q.where.fieldFilter;
    return ok(rowsOf(coll).filter(([, d]) => !f || matches(d, f))
      .map(([id, d]) => ({ document: { name: `x/${coll}/${id}`, fields: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, tv(v)])) } })));
  }
  if (url.endsWith(":commit")) {
    for (const w of JSON.parse(opts.body).writes) {
      const name = w.update ? w.update.name : w.transform.document;
      const id = name.split("/").pop();
      const card = store.backlogItems[id];
      if (!card) continue;
      if (w.update) Object.assign(card, fdoc(w.update.fields));
      for (const t of (w.updateTransforms || (w.transform && w.transform.fieldTransforms) || [])) {
        if (t.appendMissingElements) card.notes = (card.notes || []).concat(t.appendMissingElements.values.map((v) => fdoc({ v }).v));
      }
    }
    return ok({});
  }
  const m = url.match(/\/documents\/(projects|backlogItems|releaseGroups)\/([^?/]+)(\?|$)/);
  if (m && opts.method === "PATCH") {
    const fields = fdoc(JSON.parse(opts.body).fields || {});
    store[m[1]][m[2]] = Object.assign(store[m[1]][m[2]] || {}, fields);
    if (m[1] === "projects") projectPatches.push([m[2], fields]);
    return ok({});
  }
  if (m && (!opts.method || opts.method === "GET")) {
    const d = store[m[1]] && store[m[1]][m[2]];
    return d ? ok({ name: `x/${m[1]}/${m[2]}`, fields: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, tv(v)])) }) : notFound;
  }
  if (opts.method === "DELETE") return ok({});
  return notFound;
};

function sh(cwd, cmd, args) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function repoWithBranch(branch, commits) {
  const root = fs.mkdtempSync(path.join(tmp, "repo-"));
  const origin = path.join(root, "origin.git");
  const work = path.join(root, "work");
  fs.mkdirSync(origin); fs.mkdirSync(work);
  sh(origin, "git", ["init", "--bare", "--quiet"]);
  sh(work, "git", ["init", "--quiet", "-b", "main"]);
  sh(work, "git", ["config", "user.name", "test"]);
  sh(work, "git", ["config", "user.email", "test@example.com"]);
  fs.writeFileSync(path.join(work, "README.md"), "hello\n");
  sh(work, "git", ["add", "-A"]); sh(work, "git", ["commit", "-m", "init", "--quiet"]);
  sh(work, "git", ["remote", "add", "origin", origin]);
  sh(work, "git", ["push", "-u", "origin", "main", "--quiet"]);
  sh(work, "git", ["checkout", "-b", branch, "--quiet"]);
  const shas = {};
  for (const [id, file] of commits) {
    fs.writeFileSync(path.join(work, file), `${id}\n`);
    sh(work, "git", ["add", "-A"]);
    sh(work, "git", ["commit", "-m", `ticket ${id}\n\nBacklog item: ${id}`, "--quiet"]);
    shas[id] = sh(work, "git", ["rev-parse", "HEAD"]);
  }
  sh(work, "git", ["push", "-u", "origin", branch, "--quiet"]);
  sh(work, "git", ["checkout", "main", "--quiet"]);
  return { root, work, shas, head: () => sh(work, "git", ["ls-remote", "origin", `refs/heads/${branch}`]).split("\t")[0], main: () => sh(work, "git", ["rev-parse", "origin/main"]) };
}
async function inRepo(repo, fn) {
  const cwd = process.cwd();
  process.chdir(repo.work);
  try { return await fn(); } finally { process.chdir(cwd); }
}
function seed(projects, items) {
  store = {
    releaseGroups: { G: { name: GROUP.name, deployBranch: GROUP.deployBranch, projectIds: GROUP.projectIds } },
    projects: JSON.parse(JSON.stringify(projects)),
    backlogItems: JSON.parse(JSON.stringify(items)),
  };
  projectPatches.length = 0;
}
const member = (p, extra = {}) => ({ name: p.name, deployBranch: p.deployBranch, releaseGroupId: p.releaseGroupId, ...extra });

test("first approval locks both: a member whose own tickets are gone never resets the shared branch", async () => {
  const repo = repoWithBranch(GROUP.deployBranch, [["k1", "k.txt"]]);
  seed({ BT: member(BT, { trainLocked: true, trainStatus: "idle" }), SK: member(SK, { trainLocked: true, trainStatus: "idle" }) },
    { k1: { projectId: "SK", title: "Kanban fix", status: "ready-for-testing", deployCommit: repo.shas.k1, deployBranch: GROUP.deployBranch } });
  const before = repo.head();
  await inRepo(repo, () => auto.reconcileLockedTrains());
  assert.strictEqual(repo.head(), before, "the shared branch still carries Staff Kanban's ticket");
  assert.strictEqual(store.projects.BT.trainLocked, true);
  assert.strictEqual(store.projects.SK.trainLocked, true);
});

test("once the shared train is empty, one sweep resets it and unlocks every member", async () => {
  const repo = repoWithBranch(GROUP.deployBranch, []);
  seed({ BT: member(BT, { trainLocked: true, trainStatus: "idle", trainNote: "old" }), SK: member(SK, { trainLocked: true, trainStatus: "idle" }) },
    { k1: { projectId: "SK", status: "backlog" } });
  await inRepo(repo, () => auto.reconcileLockedTrains());
  assert.strictEqual(store.projects.BT.trainLocked, false);
  assert.strictEqual(store.projects.SK.trainLocked, false);
  assert.strictEqual(store.projects.BT.trainNote, null);
});

test("Deploy from either member refuses while the other has a ticket in Ready for Testing, and names it", async () => {
  seed({ BT: member(BT, { trainReady: true, trainLocked: true }), SK: member(SK, { trainLocked: true }) }, {
    a: { projectId: "BT", title: "Console fix", status: "ready-to-publish", deployCommit: "1111111" },
    k: { projectId: "SK", title: "Kanban fix", status: "ready-for-testing", deployCommit: "2222222" },
  });
  await auto.processDeployTrain({ id: "BT", ...store.projects.BT });
  for (const pid of ["BT", "SK"]) {
    assert.strictEqual(store.projects[pid].trainReady, false, pid);
    assert.match(store.projects[pid].trainNote, /still in Ready for Testing \(k in Staff Kanban\)/, pid);
    assert.match(store.projects[pid].trainNote, /deploy\/ph-agent-console/);
  }
});

test("Deploy on an empty shared train unlocks both members", async () => {
  seed({ BT: member(BT), SK: member(SK, { trainReady: true, trainLocked: true }) }, {});
  store.projects.BT.trainLocked = true;
  await auto.processDeployTrain({ id: "SK", ...store.projects.SK });
  assert.strictEqual(store.projects.BT.trainLocked, false);
  assert.strictEqual(store.projects.SK.trainLocked, false);
});

test("finishTrain flips the cards of both projects, syncs each project's docs and clears both trains", async () => {
  const repo = repoWithBranch(GROUP.deployBranch, [["a", "a.txt"], ["k", "k.txt"]]);
  seed({ BT: member(BT, { trainLocked: true, trainStatus: "deploying" }), SK: member(SK, { trainLocked: true, trainStatus: "deploying" }) }, {
    a: { projectId: "BT", title: "Console fix", status: "ready-to-publish", deployCommit: repo.shas.a },
    k: { projectId: "SK", title: "Kanban fix", status: "ready-to-publish", deployCommit: repo.shas.k },
  });
  const project = await auto.withGroup({ id: "BT", ...store.projects.BT });
  const onTrain = Object.entries(store.backlogItems).map(([id, d]) => ({ id, ...d }));
  await inRepo(repo, () => auto.finishTrain(project, GROUP.deployBranch, 42, onTrain, { touchesBacklogTracker: false }));
  assert.strictEqual(store.backlogItems.a.status, "published-live");
  assert.strictEqual(store.backlogItems.k.status, "published-live");
  assert.ok(store.backlogItems.k.notes.some((n) => /PR #42/.test(n.text)));
  for (const pid of ["BT", "SK"]) {
    assert.strictEqual(store.projects[pid].trainLocked, false, pid);
    assert.strictEqual(store.projects[pid].trainStatus, "idle", pid);
    assert.ok(projectPatches.some(([id, f]) => id === pid && "docsSync" in f), `${pid}'s docs were synced`);
  }
  assert.strictEqual(repo.head(), repo.main(), "the shared branch is reset to main once");
});

test("a revert blocked by the other project's ticket names it, with its project", () => {
  const later = new Map([["k", { projectId: "SK", title: "Kanban fix" }], ["z", { projectId: "DSP", title: "Elsewhere" }]]);
  const ids = auto.sameProjectIds(["k", "z"], later, ["BT", "SK"]);
  assert.deepStrictEqual(ids, ["k"], "a commit from outside the group (a main merge) is not a blocker");
  assert.deepStrictEqual(auto.sameProjectIds(["k", "z"], later, "BT"), [], "no group: today's rule");
  assert.deepStrictEqual(auto.blockerLabels(ids, later, "BT", byId), ["k (Staff Kanban: Kanban fix)"]);
  assert.deepStrictEqual(auto.blockerLabels(["k"], later, "SK", byId), ["k"]);
});

test("a project with no group reads only its own train", async () => {
  seed({ DSP: { name: DSP.name, deployBranch: DSP.deployBranch } }, {
    d: { projectId: "DSP", status: "ready-for-testing", deployCommit: "1" },
    a: { projectId: "BT", status: "ready-for-testing", deployCommit: "2" },
  });
  const p = await auto.withGroup({ id: "DSP", ...store.projects.DSP });
  assert.deepStrictEqual(p.trainProjectIds, ["DSP"]);
  assert.deepStrictEqual((await auto.itemsForTrain(p)).map((i) => i.id), ["d"]);
});

(async () => {
  for (const [name, fn] of asyncTests) {
    try { await fn(); passed += 1; console.log(`  ok  ${name}`); }
    catch (err) { failures.push([name, err]); console.log(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length) process.exit(1);
})();
