// Card state line (RC6wVNJJcPjNTR5hov9W, "Flow 7/9"): public/js/card-state.js
// and its CommonJS copy functions/card-state.js.
//
// 1. Every status × flag combination the board can hold returns exactly one
//    line and one waitingOn from the fixed list.
// 2. The thresholds table drives the warning state.
// 3. The ES module (browser) and the CommonJS copy (Cloud Functions, MCP,
//    automation) are the same source and give the same output.
// 4. trainStuckPatch: trainStuckSince set and cleared for each of the five
//    stuck states, and exactly one escalation per spell.
// 5. needsAttention / waitingOnMe / deployGate.
import assert from "assert";
import fs from "fs";
import { createRequire } from "module";
import * as esm from "../public/js/card-state.js";
const require = createRequire(import.meta.url);
const cjs = require("../functions/card-state.js");

let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log(`  ok  ${name}`); }

const H = 3600 * 1000;
const NOW = Date.parse("2026-11-16T12:00:00Z");
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

test("the CommonJS copy is the ES module minus `export` (run scripts/gen-card-state-cjs.sh)", () => {
  const a = fs.readFileSync(new URL("../public/js/card-state.js", import.meta.url), "utf8").replace(/^export /gm, "").trimEnd();
  const b = fs.readFileSync(new URL("../functions/card-state.js", import.meta.url), "utf8")
    .replace(/^"use strict";\n\/\/ GENERATED[^\n]*\n/, "").replace(/\nmodule\.exports[^\n]*\n?$/, "").trimEnd();
  assert.strictEqual(b, a);
});

// ── The enumeration ─────────────────────────────────────────────────────
const STATUSES = ["backlog", "ready-for-testing", "ready-to-publish", "published-live", "archived"];
const FLAGS = {
  none: {},
  patchReady: { patchReady: true },
  buildAfterTrain: { buildAfterTrain: true },
  heldPatch: { patchReady: true, buildAfterTrain: true },
  queuedAfter: { queuedAfter: { itemId: "dep1", title: "Ahead" } },
  needsDecision: { blocked: { reason: "needs-decision", note: "A or B", setAt: iso(30 * H) } },
  waitingInput: { blocked: { reason: "waiting-on-input", note: "a file", setAt: iso(2 * H) } },
  modelUnavailable: { blocked: { reason: "model-unavailable", setAt: iso(H) } },
  toolsUnavailable: { blocked: { reason: "tools-unavailable", missing: ["wordpress-mcp"], setAt: iso(H) } },
  waitingDependency: { blocked: { reason: "waiting-on-dependency", note: "Waiting for: Dep" }, dependsOnItemIds: ["dep1"] },
  dependencyStuck: { blocked: { reason: "waiting-on-dependency", note: "Waiting for: Dep", stuckOn: { itemId: "dep1" } }, dependsOnItemIds: ["dep1"] },
  dependsOn: { dependsOnItemIds: ["dep1"] },
  revertRequested: { revertRequested: true },
  revertBlocked: { revertRequested: true, revertBlockedBy: ["Later ticket"] },
  buildingNoBeat: { lastFire: { status: "started", at: iso(5 * 60000), buildAttemptId: "a1" }, buildAttemptId: "a1" },
  buildingBeat: { lastFire: { status: "started", at: iso(30 * 60000), buildAttemptId: "a1" }, buildAttemptId: "a1", buildSession: { attemptId: "a1", phase: "testing", heartbeatAt: iso(3 * 60000) } },
  buildingLong: { lastFire: { status: "started", at: iso(3 * H), buildAttemptId: "a1" }, buildAttemptId: "a1", buildSession: { attemptId: "a1", phase: "building", heartbeatAt: iso(60000) } },
  fireRetrying: { lastFire: { status: "retrying", at: iso(60000), attempts: 1 } },
  fireFailed: { lastFire: { status: "failed", at: iso(60000), attempts: 3 } },
  buildErrored: { buildSession: { status: "error", reportedAt: iso(60000) } },
  round3: { testRound: 3 },
  mergeReady: { mergeReady: true },
  revertReady: { revertReady: true },
  deployPending: { mergeCommit: "m1", deployConclusion: "pending" },
  deploySuccess: { mergeCommit: "m1", deployConclusion: "success" },
  deployFailure: { mergeCommit: "m1", deployConclusion: "failure" },
};
const PROJECTS = {
  idle: { id: "p1", name: "P", trainStatus: "idle" },
  deploying: { id: "p1", name: "P", trainStatus: "deploying" },
  testsRunning: { id: "p1", name: "P", trainStatus: "deploying", trainHold: "tests-running" },
  testsRed: { id: "p1", name: "P", trainStatus: "deploying", trainHold: "tests-red", trainTestsRed: { "backlog-tracker-tests": { sha: "x" } } },
  queued: { id: "p1", name: "P", trainStatus: "deploying", trainHold: "queued", trainNote: "Queued behind DSP's deploy; starts by itself when that merges." },
  conflict: { id: "p1", name: "P", trainStatus: "conflict" },
  awaitingMerge: { id: "p1", name: "P", trainStatus: "awaiting-human-merge" },
  locked: { id: "p1", name: "P", trainLocked: true },
  redIdle: { id: "p1", name: "P", trainTestsRed: { "t": { sha: "x" } } },
};
const SIBLINGS = {
  none: [],
  testing: [{ id: "s1", projectId: "p1", title: "Sibling in testing", status: "ready-for-testing", deployCommit: "c1" }],
  reverting: [{ id: "s2", projectId: "p1", title: "Sibling coming off", status: "backlog", revertRequested: true }],
};

for (const [name, m] of [["esm", esm], ["cjs", cjs]]) {
  test(`${name}: every status × flag × project × sibling combination returns one line and one waitingOn`, () => {
    let n = 0;
    for (const status of STATUSES) for (const [fk, flags] of Object.entries(FLAGS)) for (const [pk, project] of Object.entries(PROJECTS)) for (const [sk, sibs] of Object.entries(SIBLINGS)) {
      const item = { id: "i1", projectId: "p1", title: "T", status, statusEnteredAt: iso(5 * H), updatedAt: iso(5 * H), deployCommit: status === "ready-for-testing" || status === "ready-to-publish" ? "c0" : undefined, ...flags };
      const ctx = { itemsById: Object.fromEntries([item, ...sibs, { id: "dep1", title: "Dep", status: "backlog", projectId: "p1" }].map((i) => [i.id, i])), projectItems: [item, ...sibs] };
      const s = m.cardState(item, project, NOW, ctx);
      const where = `${status}/${fk}/${pk}/${sk}`;
      assert.ok(typeof s.line === "string" && s.line.trim() && !/undefined|null|NaN/.test(s.line), `${where}: line "${s.line}"`);
      assert.ok(m.WAITING_ON.includes(s.waitingOn), `${where}: waitingOn ${s.waitingOn}`);
      assert.ok(typeof s.state === "string" && s.state, where);
      assert.ok(["open", "answer", "test", "approve", "deploy"].includes(s.action), `${where}: action ${s.action}`);
      n += 1;
    }
    assert.strictEqual(n, STATUSES.length * Object.keys(FLAGS).length * Object.keys(PROJECTS).length * Object.keys(SIBLINGS).length);
  });
}

test("a card from before statusEnteredAt, buildSession or testRound still gets a line (falls back to updatedAt)", () => {
  const s = esm.cardState({ status: "ready-for-testing", updatedAt: iso(3 * H) }, null, NOW);
  assert.strictEqual(s.line, "Ready to test · 3 h");
  assert.strictEqual(s.waitingOn, "tester");
  assert.strictEqual(esm.cardState({}, null, NOW).line, "In Backlog · not started");
});

test("the lines the ticket names", () => {
  const ctx = { itemsById: { dep1: { id: "dep1", title: "Dep", status: "backlog" }, a: { id: "a", title: "Ahead" } } };
  const L = (flags, status = "backlog", project = PROJECTS.idle, c = ctx) => esm.cardState({ id: "i", projectId: "p1", status, statusEnteredAt: iso(5 * H), ...flags }, project, NOW, c).line;
  assert.strictEqual(L(FLAGS.buildingBeat), "Building · testing · heard from 3 min ago");
  assert.strictEqual(L({ queuedAfter: { itemId: "a" } }), "Queued: builds after Ahead");
  assert.strictEqual(L({ blocked: { reason: "waiting-on-input", setAt: iso(50 * H) } }), "Waiting for your answer · 2 d");
  assert.strictEqual(L({ testRound: 2 }, "ready-for-testing"), "Ready to test · round 2 · 5 h");
  assert.strictEqual(L({ deployCommit: "c0" }, "ready-to-publish", PROJECTS.idle, { itemsById: {}, projectItems: [{ id: "i", projectId: "p1", status: "ready-to-publish", deployCommit: "c0" }, ...SIBLINGS.testing] }), "Approved · waits for Sibling in testing to be approved");
  assert.strictEqual(L(FLAGS.buildAfterTrain), "Rebuild waits for this release to merge");
  assert.strictEqual(L(FLAGS.revertBlocked), "Being taken off the release · blocked by Later ticket");
  assert.match(L({}, "ready-to-publish", { ...PROJECTS.testsRunning, trainHoldSince: iso(12 * 60000) }), /^Deploying · tests running 12 min$/);
  assert.strictEqual(L(FLAGS.deploySuccess, "published-live"), "Live · deploy checked");
  assert.strictEqual(L({}, "ready-to-publish", PROJECTS.queued), "Queued behind DSP's deploy");
});

test("waitingOn names who the card waits for", () => {
  const W = (flags, status = "backlog", project = PROJECTS.idle) => esm.cardState({ id: "i", status, statusEnteredAt: iso(H), ...flags }, project, NOW, { itemsById: {} }).waitingOn;
  assert.strictEqual(W({}, "ready-for-testing"), "tester");
  assert.strictEqual(W({ deployCommit: "c" }, "ready-to-publish"), "approver");
  assert.strictEqual(W(FLAGS.needsDecision), "decision");
  assert.strictEqual(W(FLAGS.buildingBeat), "automation");
  assert.strictEqual(W(FLAGS.queuedAfter), "another ticket");
  assert.strictEqual(W({}, "ready-to-publish", PROJECTS.queued), "another project");
  assert.strictEqual(W({}), "nobody");
});

test("the thresholds table drives the warning state", () => {
  const T = esm.AGE_THRESHOLDS;
  assert.deepStrictEqual(Object.keys(T).sort(), ["backlog-blocked", "building", "ready-for-testing", "ready-to-publish"]);
  const warn = (status, ms, flags = {}) => esm.cardState({ status, statusEnteredAt: iso(ms), ...flags }, PROJECTS.idle, NOW, { itemsById: {} }).warn;
  assert.strictEqual(warn("ready-for-testing", T["ready-for-testing"] - 60000), false);
  assert.strictEqual(warn("ready-for-testing", T["ready-for-testing"]), true);
  assert.strictEqual(warn("ready-to-publish", T["ready-to-publish"], { deployCommit: "c" }), true);
  assert.strictEqual(warn("ready-to-publish", T["ready-to-publish"] - 60000, { deployCommit: "c" }), false);
  assert.strictEqual(warn("backlog", 0, { blocked: { reason: "needs-decision", setAt: iso(T["backlog-blocked"]) } }), true);
  assert.strictEqual(warn("backlog", 0, { blocked: { reason: "needs-decision", setAt: iso(H) } }), false);
  assert.strictEqual(warn("backlog", 0, FLAGS.buildingLong), true, "a build running past 2 h");
  assert.strictEqual(warn("backlog", 0, FLAGS.buildingBeat), false);
  assert.strictEqual(warn("backlog", 100 * H), false, "an unstarted Backlog card never warns");
});

test("ageLabel: quiet ages", () => {
  assert.deepStrictEqual([0, 3 * 60000, 2 * H, 47 * H, 72 * H].map(esm.ageLabel), ["just now", "3 min", "2 h", "47 h", "3 d"]);
});

// ── Train stuck clock ────────────────────────────────────────────────────
const train = (status, extra = {}) => ({ id: `t-${status}`, projectId: "p1", title: `T ${status}`, status, deployCommit: "c1", ...extra });
const STUCK_CASES = {
  "conflict": [{ id: "p1", trainStatus: "conflict" }, [train("ready-to-publish")]],
  "awaiting-human-merge": [{ id: "p1", trainStatus: "awaiting-human-merge" }, [train("ready-to-publish")]],
  "tests-red-no-culprit": [{ id: "p1", trainStatus: "deploying", trainHold: "tests-red", trainTestsRed: { w: {} } }, [train("ready-to-publish")]],
  "locked-unapproved": [{ id: "p1", trainLocked: true }, [train("ready-to-publish"), train("ready-for-testing")]],
  "revert-blocked": [{ id: "p1" }, [{ id: "r", projectId: "p1", status: "backlog", revertRequested: true, revertBlockedBy: ["Later"] }]],
};
for (const [name, m] of [["esm", esm], ["cjs", cjs]]) {
  test(`${name}: trainStuckSince set and cleared for each of the five stuck states, one escalation per spell`, () => {
    for (const [reason, [project, items]] of Object.entries(STUCK_CASES)) {
      assert.strictEqual(m.trainStuckReason(project, items), reason);
      // Enters: stamped.
      let p = { ...project };
      let patch = m.trainStuckPatch(p, items, NOW);
      assert.deepStrictEqual(patch, { trainStuckSince: new Date(NOW).toISOString(), trainStuckReason: reason, trainStuckEscalatedAt: null }, reason);
      p = { ...p, ...patch };
      // Still stuck, under the threshold: no write.
      const limit = m.TRAIN_STUCK_THRESHOLDS[reason];
      assert.strictEqual(m.trainStuckPatch(p, items, NOW + limit - 1), null, `${reason}: before threshold`);
      // Past the threshold: one escalation.
      patch = m.trainStuckPatch(p, items, NOW + limit);
      assert.ok(patch && patch.trainStuckEscalatedAt, `${reason}: escalated`);
      p = { ...p, ...patch };
      let escalations = 1;
      for (let k = 1; k <= 20; k++) {
        const again = m.trainStuckPatch(p, items, NOW + limit + k * H);
        if (again && again.trainStuckEscalatedAt) escalations += 1;
        assert.strictEqual(again, null, `${reason}: no repeat`);
      }
      assert.strictEqual(escalations, 1);
      // The state ends: cleared, and a clean project gets no write.
      const cleared = m.trainStuckPatch({ ...p, trainStatus: "idle", trainHold: null, trainTestsRed: null, trainLocked: false }, [], NOW + 2 * limit);
      assert.deepStrictEqual(cleared, { trainStuckSince: null, trainStuckReason: null, trainStuckEscalatedAt: null }, `${reason}: cleared`);
      assert.strictEqual(m.trainStuckPatch({ id: "p1" }, [], NOW), null);
    }
    assert.strictEqual(m.TRAIN_STUCK_THRESHOLDS["locked-unapproved"], 12 * H);
    assert.strictEqual(m.TRAIN_STUCK_THRESHOLDS["conflict"], 2 * H);
  });
}

test("a red train with a pinned culprit is not 'no culprit'; a change of reason restarts the clock", () => {
  const items = [train("ready-to-publish", { trainTest: { state: "failed", sha: "c1" } })];
  assert.strictEqual(esm.trainStuckReason({ id: "p1", trainHold: "tests-red", trainTestsRed: { w: {} } }, items), null);
  const p = { id: "p1", trainStatus: "conflict", trainStuckSince: iso(5 * H), trainStuckReason: "awaiting-human-merge", trainStuckEscalatedAt: iso(H) };
  assert.strictEqual(esm.trainStuckPatch(p, [], NOW).trainStuckReason, "conflict");
  assert.strictEqual(esm.trainStuckPatch(p, [], NOW).trainStuckEscalatedAt, null);
});

// ── Deploy gate (header reason) ──────────────────────────────────────────
test("deployGate names why Deploy to Main is missing, with the next action", () => {
  const approved = train("ready-to-publish");
  assert.strictEqual(esm.deployGate({ id: "p1" }, [approved, { ...train("ready-for-testing"), title: "Half done" }]).line, "Deploy to Main appears when Half done is approved or sent back");
  assert.strictEqual(esm.deployGate({ id: "p1" }, [approved, { id: "r", projectId: "p1", title: "Rejected", status: "backlog", revertRequested: true }]).line, "Deploy to Main appears when the revert of Rejected finishes");
  assert.strictEqual(esm.deployGate(PROJECTS.queued, [approved]).line, "Queued behind DSP's deploy");
  assert.match(esm.deployGate({ id: "p1", trainTestsRed: { "backlog-tracker-tests": {} } }, [approved]).line, /^Tests failing: backlog-tracker-tests — nobody is pinned/);
  assert.match(esm.deployGate({ id: "p1", trainTestsRed: { "w": {} } }, [{ ...approved, title: "Breaker", trainTest: { state: "failed", sha: "c1" } }]).line, /Breaker is being sent back/);
  assert.strictEqual(esm.deployGate({ id: "p1" }, [approved]), null, "nothing in the way: the button shows");
  assert.strictEqual(esm.deployGate({ id: "p1" }, []), null);
});

// ── Needs attention ──────────────────────────────────────────────────────
test("needsAttention lists a stale Ready for Testing card, a blocked card and a red train, oldest first", () => {
  const projects = [{ id: "p1", name: "One", trainStatus: "deploying", trainHold: "tests-red", trainTestsRed: { w: {} }, trainStuckReason: "tests-red-no-culprit", trainStuckSince: iso(3 * H) }];
  const items = [
    { id: "stale", projectId: "p1", title: "Stale", status: "ready-for-testing", deployCommit: "c1", statusEnteredAt: iso(30 * H), createdByEmail: "owner@example.com" },
    { id: "blocked", projectId: "p1", title: "Blocked", status: "backlog", blocked: { reason: "needs-decision", setAt: iso(10 * H) }, createdByEmail: "someone@ph.example" },
    { id: "quiet", projectId: "p1", title: "Quiet", status: "backlog", statusEnteredAt: iso(100 * H) },
    { id: "live", projectId: "p1", title: "Live", status: "published-live", deployConclusion: "success" },
  ];
  const list = esm.needsAttention(items, projects, NOW);
  assert.deepStrictEqual(list.map((e) => e.id), ["stale", "blocked", "p1"]);
  assert.strictEqual(list[0].action, "test");
  assert.strictEqual(list[0].warn, true);
  assert.strictEqual(list[1].action, "answer");
  assert.strictEqual(list[2].kind, "train");
  assert.match(list[2].line, /no ticket is pinned/);
  assert.deepStrictEqual(cjs.needsAttention(items, projects, NOW), list, "same output from the CommonJS copy");
  // Waiting on me.
  const mine = list.filter((e) => esm.waitingOnMe(e, { email: "owner@example.com", canApprove: false }));
  assert.deepStrictEqual(mine.map((e) => e.id), ["stale"]);
  const approver = list.filter((e) => esm.waitingOnMe(e, { email: "x@ph.example", canApprove: true }));
  assert.deepStrictEqual(approver.map((e) => e.id), ["stale", "p1"]);
  assert.deepStrictEqual(list.filter((e) => esm.waitingOnMe(e, { email: "someone@ph.example" })).map((e) => e.id), ["blocked"]);
});

test("a stuck train under its threshold is not listed; an escalated one is", () => {
  const p = { id: "p1", name: "One", trainStatus: "conflict", trainStuckReason: "conflict", trainStuckSince: iso(30 * 60000) };
  assert.strictEqual(esm.needsAttention([], [p], NOW).length, 0);
  assert.strictEqual(esm.needsAttention([], [{ ...p, trainStuckSince: iso(3 * H) }], NOW).length, 1);
  assert.strictEqual(esm.needsAttention([], [{ ...p, trainStuckEscalatedAt: iso(0) }], NOW).length, 1);
});

test("statusEnteredPatch: only a real status change, never a loop, a writer's own stamp wins", () => {
  assert.deepStrictEqual(esm.statusEnteredPatch({ status: "backlog" }, { status: "ready-for-testing" }, "now"), { statusEnteredAt: "now" });
  assert.deepStrictEqual(esm.statusEnteredPatch(undefined, { status: "backlog" }, "now"), { statusEnteredAt: "now" }, "a new card");
  assert.strictEqual(esm.statusEnteredPatch({ status: "backlog" }, { status: "backlog", title: "x" }, "now"), null);
  assert.strictEqual(esm.statusEnteredPatch({ status: "backlog", statusEnteredAt: iso(H) }, { status: "archived", statusEnteredAt: iso(0) }, "now"), null, "stamped by the writer");
  assert.deepStrictEqual(esm.statusEnteredPatch({ status: "backlog", statusEnteredAt: iso(H) }, { status: "archived", statusEnteredAt: iso(H) }, "now"), { statusEnteredAt: "now" });
  assert.strictEqual(esm.statusEnteredPatch({ status: "x" }, undefined, "now"), null, "a delete");
});

test("tools-unavailable (Flow 8/9): names the missing tool, waits on a decision, and shows on Needs attention", () => {
  const card = { id: "t1", projectId: "p", status: "backlog", title: "Hero copy", blocked: { reason: "tools-unavailable", missing: ["wordpress-mcp"], setAt: iso(30 * H) } };
  const st = esm.cardState(card, {}, NOW);
  assert.strictEqual(st.state, "tools-unavailable");
  assert.match(st.line, /^Not built: this session has no wordpress-mcp/);
  assert.strictEqual(st.waitingOn, "decision");
  assert.ok(esm.needsAttention([card], [{ id: "p", name: "P" }], NOW).some((x) => x.id === "t1"), "listed for a person");
  assert.match(esm.cardState({ ...card, blocked: { reason: "tools-unavailable", setAt: iso(H) } }, {}, NOW).line, /^Not built: a tool this project needs is missing/);
});

console.log(`card-state: ${passed} passed`);
