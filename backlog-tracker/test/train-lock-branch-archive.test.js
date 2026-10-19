// Exercises archiveAndResetOrphanedBranch()/dateStamp() from
// scripts/run-backlog-automation.js — point 3 of "Ready for Dev CTA stays
// hidden after all train tickets are deleted (stuck trainLocked)": when
// reconcileLockedTrains() finds a project's train empty with nothing
// merged, this is what tags any commits the branch holds that never
// reached main (a card deleted outright, or reverted history that nets to
// zero but is still real history) as archive/<branch>-<date> and resets
// the branch back to main.
//
// Runs against two disposable, LOCAL-ONLY git repos under a fresh
// os.tmpdir() directory (a bare "origin" and a working clone) — never the
// real offline2online/rob_ph_demos repo, per this ticket's own
// instructions. run-backlog-automation.js is `require()`d (not spawned),
// which is safe because its own main() is guarded behind
// `require.main === module` specifically so this works.
//
// Run with:  node test/train-lock-branch-archive.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

function sh(cwd, cmd, args) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function makeDisposableRepoPair() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "train-lock-archive-test-"));
  const bareOrigin = path.join(root, "origin.git");
  const work = path.join(root, "work");
  fs.mkdirSync(bareOrigin);
  fs.mkdirSync(work);
  sh(bareOrigin, "git", ["init", "--bare", "--quiet"]);
  sh(work, "git", ["init", "--quiet", "-b", "main"]);
  sh(work, "git", ["config", "user.name", "test"]);
  sh(work, "git", ["config", "user.email", "test@example.com"]);
  fs.writeFileSync(path.join(work, "README.md"), "hello\n");
  sh(work, "git", ["add", "-A"]);
  sh(work, "git", ["commit", "-m", "initial commit", "--quiet"]);
  sh(work, "git", ["remote", "add", "origin", bareOrigin]);
  sh(work, "git", ["push", "-u", "origin", "main", "--quiet"]);
  return { root, bareOrigin, work };
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

function remoteTags(work) {
  const out = sh(work, "git", ["ls-remote", "--tags", "origin"]);
  return out
    ? out.split("\n").map((l) => l.split("\t")[1]).filter(Boolean).map((ref) => ref.replace(/^refs\/tags\//, ""))
    : [];
}

function remoteBranchSha(work, branch) {
  const out = sh(work, "git", ["ls-remote", "origin", `refs/heads/${branch}`]);
  return out ? out.split("\t")[0] : null;
}

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (err) { failures.push([name, err]); console.log(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
}

// reconcileLockedTrains() talks to Firestore, so the script needs a (generated,
// never-used) service-account key before it is required.
const crypto = require("crypto");
const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), "train-sweep-key-"));
const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
fs.writeFileSync(path.join(keyDir, "sa.json"), JSON.stringify({ client_email: "t@example.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(keyDir, "sa.json");

const scriptPath = require.resolve("../scripts/run-backlog-automation.js");
const { archiveAndResetOrphanedBranch, dateStamp, trainSweepPlan, trainCommitsAheadOfMain, reconcileLockedTrains } = require(scriptPath);

test("dateStamp() is a plain YYYY-MM-DD", () => {
  assert.match(dateStamp(), /^\d{4}-\d{2}-\d{2}$/);
});

test("a deploy branch that doesn't exist on origin is a no-op", () => {
  const { root, work } = makeDisposableRepoPair();
  const originalCwd = process.cwd();
  try {
    process.chdir(work);
    const result = archiveAndResetOrphanedBranch("deploy/never-created");
    assert.deepStrictEqual(result, { ok: true, tag: null });
  } finally {
    process.chdir(originalCwd);
    cleanup(root);
  }
});

test("THE ORPHANED-COMMITS CASE: a branch ahead of main gets tagged archive/<branch>-<date> and reset to main", () => {
  const { root, work, bareOrigin } = makeDisposableRepoPair();
  const originalCwd = process.cwd();
  const branch = "deploy/orphan-project";
  try {
    // Simulate a card deleted outright while its commit was still live on
    // the train: two commits on the integration branch that never reached
    // main and never went through processRevertFromTrain either.
    sh(work, "git", ["checkout", "-b", branch, "--quiet"]);
    fs.writeFileSync(path.join(work, "a.txt"), "a\n");
    sh(work, "git", ["add", "-A"]);
    sh(work, "git", ["commit", "-m", "ticket A", "--quiet"]);
    fs.writeFileSync(path.join(work, "b.txt"), "b\n");
    sh(work, "git", ["add", "-A"]);
    sh(work, "git", ["commit", "-m", "ticket B (its own card was deleted)", "--quiet"]);
    const orphanedTip = sh(work, "git", ["rev-parse", "HEAD"]);
    sh(work, "git", ["push", "-u", "origin", branch, "--quiet"]);
    sh(work, "git", ["checkout", "main", "--quiet"]);

    process.chdir(work);
    const result = archiveAndResetOrphanedBranch(branch);

    assert.strictEqual(result.ok, true, result.error);
    assert.ok(result.tag, "a tag should have been created");
    assert.strictEqual(result.tag, `archive/${branch}-${dateStamp()}`);

    // The tag is really on origin, pointing at the orphaned work.
    assert.ok(remoteTags(work).includes(result.tag), "the tag should be pushed to origin");
    const tagTarget = sh(work, "git", ["rev-parse", `refs/tags/${result.tag}`]);
    assert.strictEqual(tagTarget, orphanedTip, "the tag should point at the branch's orphaned tip, not main");

    // The branch itself is reset to main on origin — nothing left dangling
    // for the next train to trip over.
    const mainSha = sh(work, "git", ["rev-parse", "origin/main"]);
    const branchShaAfter = remoteBranchSha(work, branch);
    assert.strictEqual(branchShaAfter, mainSha, "the integration branch should be reset to main on origin");

    // The orphaned work is still fetchable from the tag even though
    // nothing on the board points at it any more.
    sh(work, "git", ["fetch", "origin", `refs/tags/${result.tag}`, "--quiet"]);
    const filesAtTag = sh(work, "git", ["ls-tree", "-r", "--name-only", result.tag]);
    assert.ok(filesAtTag.includes("a.txt") && filesAtTag.includes("b.txt"), "the archived tag should still contain the orphaned files");
  } finally {
    process.chdir(originalCwd);
    cleanup(root);
  }
});

test("a branch already equal to main (e.g. every ticket was already reverted, net zero) is reset with no tag created", () => {
  const { root, work } = makeDisposableRepoPair();
  const originalCwd = process.cwd();
  const branch = "deploy/already-clean";
  try {
    sh(work, "git", ["push", "-u", "origin", "main:" + branch, "--quiet"]);
    process.chdir(work);
    const result = archiveAndResetOrphanedBranch(branch);
    assert.strictEqual(result.ok, true, result.error);
    assert.strictEqual(result.tag, null, "nothing ahead of main means nothing worth archiving");
  } finally {
    process.chdir(originalCwd);
    cleanup(root);
  }
});

test("a second orphaned train the same day gets a distinctly-suffixed tag rather than colliding", () => {
  const { root, work } = makeDisposableRepoPair();
  const originalCwd = process.cwd();
  const branch = "deploy/repeat-offender";
  try {
    sh(work, "git", ["checkout", "-b", branch, "--quiet"]);
    fs.writeFileSync(path.join(work, "c1.txt"), "1\n");
    sh(work, "git", ["add", "-A"]);
    sh(work, "git", ["commit", "-m", "first orphaned commit", "--quiet"]);
    sh(work, "git", ["push", "-u", "origin", branch, "--quiet"]);
    sh(work, "git", ["checkout", "main", "--quiet"]);

    process.chdir(work);
    const first = archiveAndResetOrphanedBranch(branch);
    assert.strictEqual(first.ok, true, first.error);
    assert.ok(first.tag);

    // A second batch of tickets lands on the same (freshly reset) branch,
    // gets deleted too, all on the same calendar day.
    process.chdir(originalCwd);
    sh(work, "git", ["fetch", "origin", branch, "--quiet"]);
    sh(work, "git", ["checkout", "-B", branch, `origin/${branch}`, "--quiet"]);
    fs.writeFileSync(path.join(work, "c2.txt"), "2\n");
    sh(work, "git", ["add", "-A"]);
    sh(work, "git", ["commit", "-m", "second orphaned commit", "--quiet"]);
    sh(work, "git", ["push", "origin", branch, "--quiet"]);
    sh(work, "git", ["checkout", "main", "--quiet"]);

    process.chdir(work);
    const second = archiveAndResetOrphanedBranch(branch);
    assert.strictEqual(second.ok, true, second.error);
    assert.ok(second.tag);
    assert.notStrictEqual(second.tag, first.tag, "the second archive tag must not collide with the first");
    assert.strictEqual(second.tag, `${first.tag}-2`);
  } finally {
    process.chdir(originalCwd);
    cleanup(root);
  }
});

// ── adopting hand-pushed `Backlog item:` commits ─────────────────────────
const card = (id, status, extra = {}) => ({ id, status, ...extra });
const live = (sha, itemId) => ({ sha, itemId });

test("trainSweepPlan adopts an unstamped Ready for Testing card, newest sha as deployCommit, oldest first", () => {
  const plan = trainSweepPlan([card("A", "ready-for-testing")], [live("s1", "A"), live("s2", null), live("s3", "A")]);
  assert.deepStrictEqual(plan.adopt, [{ itemId: "A", deployCommit: "s3", deployCommits: ["s1", "s3"] }]);
  assert.deepStrictEqual(plan.tell, []);
});

test("trainSweepPlan adopts an Approved for Deployment card too", () => {
  const plan = trainSweepPlan([card("A", "ready-to-publish")], [live("s1", "A")]);
  assert.strictEqual(plan.adopt.length, 1);
});

test("trainSweepPlan never adopts Backlog / Archived / Live, reverting or no-deploy cards, or other projects' ids", () => {
  const items = [
    card("B", "backlog"), card("C", "archived"), card("D", "published-live"),
    card("E", "ready-for-testing", { revertRequested: true }),
    card("F", "ready-for-testing", { noDeploymentRequired: true }),
    card("G", "ready-for-testing", { deployCommit: "x" }),
  ];
  const commits = ["B", "C", "D", "E", "F", "G", "OTHER"].map((id, i) => live(`s${i}`, id));
  assert.deepStrictEqual(trainSweepPlan(items, commits).adopt, []);
});

test("trainSweepPlan: a Ticket: commit adopts nothing, but its unstamped card is told; archived trailer cards are told too", () => {
  const items = [card("A", "ready-to-publish"), card("Z", "archived")];
  const plan = trainSweepPlan(items, [live("s1", null), live("s2", "Z")]);
  assert.deepStrictEqual(plan.adopt, []);
  assert.deepStrictEqual(plan.tell.sort(), ["A", "Z"]);
});

function commitOn(work, file, message) {
  fs.writeFileSync(path.join(work, file), `${file}\n`);
  sh(work, "git", ["add", "-A"]);
  sh(work, "git", ["commit", "-m", message, "--quiet"]);
  return sh(work, "git", ["rev-parse", "HEAD"]);
}

test("trainCommitsAheadOfMain lists only live commits ahead of main with trailer ids; a main merge adopts nothing", () => {
  const { root, work } = makeDisposableRepoPair();
  const originalCwd = process.cwd();
  const branch = "deploy/helper";
  try {
    sh(work, "git", ["checkout", "-b", branch, "--quiet"]);
    const a = commitOn(work, "a.txt", "ticket A\n\nBacklog item: AAA");
    const b = commitOn(work, "b.txt", "ticket B\n\nBacklog item: BBB");
    sh(work, "git", ["revert", "--no-edit", b]);
    const c = commitOn(work, "c.txt", "ticket C\n\nBacklog item: CCC");
    sh(work, "git", ["push", "-u", "origin", branch, "--quiet"]);
    // main moves on, then is merged into the branch
    sh(work, "git", ["checkout", "main", "--quiet"]);
    commitOn(work, "m.txt", "main work\n\nBacklog item: MMM");
    sh(work, "git", ["push", "origin", "main", "--quiet"]);
    sh(work, "git", ["checkout", branch, "--quiet"]);
    sh(work, "git", ["merge", "main", "--no-edit", "--quiet"]);
    sh(work, "git", ["push", "origin", branch, "--quiet"]);
    sh(work, "git", ["checkout", "main", "--quiet"]);

    process.chdir(work);
    const got = trainCommitsAheadOfMain(branch);
    const withIds = got.filter((x) => x.itemId);
    assert.deepStrictEqual(withIds, [{ sha: a, itemId: "AAA" }, { sha: c, itemId: "CCC" }]);
    assert.ok(!got.some((x) => x.itemId === "MMM" || x.itemId === "BBB"));
    assert.deepStrictEqual(trainCommitsAheadOfMain("deploy/none"), []);
  } finally {
    process.chdir(originalCwd);
    cleanup(root);
  }
});

// In-memory Firestore behind a stubbed fetch.
let projects = {};
let cards = {};
const noteLog = [];
function enc(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return { integerValue: String(v) };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  return { stringValue: String(v) };
}
function dec(v) {
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(dec);
  if ("mapValue" in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, dec(x)]));
  return v.stringValue;
}
global.fetch = async (url, opts = {}) => {
  const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  url = String(url);
  if (url.startsWith("https://oauth2.googleapis.com/token")) return ok({ access_token: "t", expires_in: 3600 });
  if (url.endsWith(":runQuery")) {
    const q = JSON.parse(opts.body).structuredQuery;
    const coll = q.from[0].collectionId;
    const f = q.where.fieldFilter;
    const want = dec(f.value);
    const src = coll === "projects" ? projects : cards;
    return ok(Object.entries(src).filter(([, d]) => d[f.field.fieldPath] === want)
      .map(([id, d]) => ({ document: { name: `x/${coll}/${id}`, fields: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, enc(v)])) } })));
  }
  if (url.endsWith(":commit")) {
    for (const w of JSON.parse(opts.body).writes) {
      const name = (w.update ? w.update.name : w.transform.document);
      const id = name.split("/").pop();
      if (w.update) Object.assign(cards[id], Object.fromEntries(Object.entries(w.update.fields).map(([k, v]) => [k, dec(v)])));
      const t = (w.updateTransforms || w.transform.fieldTransforms)[0];
      cards[id].notes = (cards[id].notes || []).concat(t.appendMissingElements.values.map(dec));
      noteLog.push(id);
    }
    return ok({});
  }
  const m = url.match(/\/(projects|backlogItems)\/([^?/]+)\?/);
  if (m && opts.method === "PATCH") {
    const fields = Object.fromEntries(Object.entries(JSON.parse(opts.body).fields).map(([k, v]) => [k, dec(v)]));
    Object.assign((m[1] === "projects" ? projects : cards)[m[2]], fields);
    return ok({});
  }
  throw new Error(`unexpected fetch ${url}`);
};

async function sweepCase(seed, setup, fn) {
  const { root, work } = makeDisposableRepoPair();
  const originalCwd = process.cwd();
  const branch = "deploy/sweep";
  projects = { P: { name: "Sweep", deployBranch: branch, trainLocked: true, trainStatus: "idle", trainNote: "old" } };
  cards = JSON.parse(JSON.stringify(seed)); noteLog.length = 0;
  try {
    sh(work, "git", ["checkout", "-b", branch, "--quiet"]);
    const shas = setup(work);
    sh(work, "git", ["push", "-u", "origin", branch, "--quiet"]);
    sh(work, "git", ["checkout", "main", "--quiet"]);
    process.chdir(work);
    const before = remoteBranchSha(work, branch);
    await reconcileLockedTrains();
    await fn({ work, branch, before, shas });
  } finally {
    process.chdir(originalCwd);
    cleanup(root);
  }
}

const asyncTests = [];
function atest(name, fn) { asyncTests.push([name, fn]); }

atest("sweep (a): an unstamped card with its trailer commit is adopted; branch not reset, still locked", () =>
  sweepCase({ AAA: { projectId: "P", status: "ready-for-testing" } },
    (w) => commitOn(w, "a.txt", "fix\n\nBacklog item: AAA"),
    async ({ work, branch, before, shas }) => {
      assert.strictEqual(cards.AAA.deployCommit, shas);
      assert.deepStrictEqual(cards.AAA.deployCommits, [shas]);
      assert.strictEqual(cards.AAA.deployBranch, branch);
      assert.strictEqual(cards.AAA.notes.filter((n) => /^Adopted hand-pushed commit/.test(n.text)).length, 1);
      assert.strictEqual(remoteBranchSha(work, branch), before);
      assert.deepStrictEqual(remoteTags(work), []);
      assert.strictEqual(projects.P.trainLocked, true);
      assert.strictEqual(projects.P.trainNote, "old");
    }));

atest("sweep (b): the trailer belongs to an archived card — tagged, reset, unlocked, nothing stamped", () =>
  sweepCase({ ZZZ: { projectId: "P", status: "archived" } },
    (w) => commitOn(w, "z.txt", "old\n\nBacklog item: ZZZ"),
    async ({ work, branch, before }) => {
      assert.strictEqual(remoteBranchSha(work, branch), sh(work, "git", ["rev-parse", "origin/main"]));
      assert.strictEqual(remoteTags(work).length, 1);
      assert.strictEqual(projects.P.trainLocked, false);
      assert.strictEqual(cards.ZZZ.deployCommit, undefined);
    }));

atest("sweep (c): an Approved card whose commit says Ticket: — tagged, reset, the card is told, trainNote null", () =>
  sweepCase({ TTT: { projectId: "P", status: "ready-to-publish" } },
    (w) => commitOn(w, "t.txt", "hand fix\n\nTicket: TTT"),
    async ({ work }) => {
      const [tag] = remoteTags(work);
      assert.ok(tag && tag.startsWith("archive/deploy/sweep-"));
      assert.strictEqual(cards.TTT.deployCommit, undefined);
      assert.strictEqual(cards.TTT.notes.length, 1);
      assert.ok(cards.TTT.notes[0].text.includes(tag));
      assert.strictEqual(projects.P.trainNote, null);
      assert.strictEqual(projects.P.trainLocked, false);
    }));

(async () => {
  for (const [name, fn] of asyncTests) {
    try { await fn(); passed += 1; console.log(`  ok  ${name}`); }
    catch (err) { failures.push([name, err]); console.log(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
  }
  fs.rmSync(keyDir, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length) {
    for (const [name, err] of failures) console.error(`--- ${name}\n${err && err.stack ? err.stack : err}\n`);
    process.exit(1);
  }
})();
