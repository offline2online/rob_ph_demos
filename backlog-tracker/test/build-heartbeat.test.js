// Build sessions report a heartbeat; silence is caught from the heartbeat, not
// from the start time, and a ticket is never built twice (14 Nov 2026).
//
// Why: a session that died was only noticed after 75 minutes and restarted
// after 90 ("hasn't reported back" notes on 39 tickets), and the restart often
// overlapped a session that was only slow ("A second build session" notes on
// 14 tickets). Each fire now carries a buildAttemptId; the session sends
// buildSession.heartbeatAt / .phase / .attemptId, and its patch carries
// patchAttemptId.
//
// The rules are pure (functions/notify-routine.js); the sweep and the patch
// refusal are the REAL scripts/run-backlog-automation.js under a stubbed
// fetch — no emulator, credentials or network.
//
// Run with:  node test/build-heartbeat.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "build-heartbeat-"));
const keyFile = path.join(dir, "sa.json");
const { privateKey } = require("crypto").generateKeyPairSync("rsa", { modulusLength: 2048 });
fs.writeFileSync(keyFile, JSON.stringify({ client_email: "t@t", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = keyFile;

const docs = new Map();
let projectFields = {};
const deleted = [];
const DOC = (id) => `projects/backlog-tracker-e4ed2/databases/(default)/documents/backlogItems/${id}`;
global.fetch = async (url, o = {}) => {
  const reply = (status, body = {}) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  const method = o.method || "GET";
  if (url.includes("oauth2")) return reply(200, { access_token: "t", expires_in: 3600 });
  if (url.endsWith(":runQuery")) return reply(200, [...docs].map(([name, fields]) => ({ document: { name, fields } })));
  if (url.endsWith(":commit")) {
    for (const w of JSON.parse(o.body).writes) {
      const name = w.update ? w.update.name : w.transform.document;
      const d = docs.get(name);
      if (!d) return reply(404, {});
      if (w.update) for (const k of w.updateMask.fieldPaths) d[k] = w.update.fields[k];
      for (const ft of (w.updateTransforms || w.transform.fieldTransforms || [])) {
        const have = (d[ft.fieldPath] && d[ft.fieldPath].arrayValue.values) || [];
        d[ft.fieldPath] = { arrayValue: { values: [...have, ...ft.appendMissingElements.values] } };
      }
    }
    return reply(200, { writeResults: [{}] });
  }
  if (method === "DELETE") { deleted.push(url); return reply(200); }
  if (url.includes("/backlogItems/") && /\/(pipeline|patchParts)/.test(url)) return method === "GET" ? reply(404, {}) : reply(200);
  if (url.includes("/projects/") && !url.includes("/backlogItems/")) return reply(200, { fields: projectFields });
  if (method === "PATCH") {
    const d = docs.get(DOC(url.split("/backlogItems/")[1].split("?")[0]));
    const fields = JSON.parse(o.body).fields || {};
    const mask = [...url.matchAll(/updateMask\.fieldPaths=([^&]+)/g)].map((m) => decodeURIComponent(m[1]));
    for (const k of mask) if (!(k in fields)) delete d[k];
    for (const [k, v] of Object.entries(fields)) d[k] = v;
    return reply(200);
  }
  return reply(200);
};

const auto = require("../scripts/run-backlog-automation.js");
const nr = require("../functions/notify-routine.js");
const {
  silentBuildSession, silentBuildNote, staleAttemptPatch, heartbeatMs, isBeating, notifyRoutineOutcome, inFlightItemIds,
  FIRST_HEARTBEAT_MS, HEARTBEAT_SILENT_MS, BUILD_CEILING_MS, LEGACY_SILENT_MS, STALL_MS, BUILD_PHASES,
} = nr;

const NOW = Date.parse("2026-11-14T12:00:00Z");
const iso = (minAgo) => new Date(NOW - minAgo * 60 * 1000).toISOString();
const ATTEMPT = "aaaaaaaaaaaaaaaa";
// A card whose session was started `firedMin` minutes ago by a fire that
// carried a build attempt id.
const building = (firedMin, over = {}) => ({
  id: "t1", projectId: "P1", status: "backlog", buildAttemptId: ATTEMPT,
  lastFire: { status: "started", sessionId: "s1", sessionUrl: "https://claude.ai/code/s1", at: iso(firedMin), buildAttemptId: ATTEMPT },
  ...over,
});
const beat = (minAgo, phase = "testing", attemptId = ATTEMPT) => ({ heartbeatAt: iso(minAgo), phase, attemptId });

function reset(cards, project = {}) {
  docs.clear(); deleted.length = 0;
  projectFields = Object.fromEntries(Object.entries(project).map(([k, v]) => [k, auto.tv(v)]));
  for (const c of cards) {
    const { id, ...rest } = c;
    docs.set(DOC(id), Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, auto.tv(v)])));
  }
}
const card = (id) => auto.fdoc(docs.get(DOC(id)));
const notes = (id) => (card(id).notes || []).map((n) => n.text);

let passed = 0; let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); } catch (err) { failed++; console.log(`FAIL  ${name}\n      ${err.stack}`); }
}

(async () => {
  await test("the windows: first heartbeat 10 min, silence 20 min, ceiling 3 h; four phases", async () => {
    assert.strictEqual(FIRST_HEARTBEAT_MS, 10 * 60 * 1000);
    assert.strictEqual(HEARTBEAT_SILENT_MS, 20 * 60 * 1000);
    assert.strictEqual(BUILD_CEILING_MS, 3 * 60 * 60 * 1000);
    assert.deepStrictEqual(BUILD_PHASES, ["reading", "building", "testing", "packaging"]);
  });

  await test("no first heartbeat within 10 minutes of the fire → one restart, then escalate", async () => {
    assert.strictEqual(silentBuildSession(building(9), NOW), null, "still inside the first 10 minutes");
    const next = silentBuildSession(building(11), NOW);
    assert.deepStrictEqual({ action: next.action, kind: next.kind }, { action: "retry", kind: "no-first-heartbeat" });
    assert.match(silentBuildNote(building(11), next), /sent no first heartbeat within 10 minutes; starting it again/);
    const again = silentBuildSession(building(11, { buildSessionRetries: 1 }), NOW);
    assert.strictEqual(again.action, "escalate", "the retry cap is unchanged: one restart");
    assert.strictEqual(auto.BUILD_SESSION_RETRIES, 1);
  });

  await test("a beating session at 100 minutes is not restarted", async () => {
    const c = building(100, { buildSession: beat(3) });
    assert.strictEqual(silentBuildSession(c, NOW), null);
    assert.strictEqual(auto.silentBuildSessionAction(c, NOW), null);
    assert.ok(isBeating(c, NOW));
    assert.strictEqual(silentBuildSession(building(100, { buildSession: beat(19) }), NOW), null, "19 minutes is still beating");
  });

  await test("silent for 20 minutes → restart, and the note names the phase", async () => {
    const c = building(60, { buildSession: beat(20, "testing") });
    const next = silentBuildSession(c, NOW);
    assert.deepStrictEqual(next, { action: "retry", kind: "quiet", phase: "testing", quietMs: 20 * 60 * 1000 });
    assert.strictEqual(silentBuildNote(c, next), "Build session went quiet 20 minutes ago during testing; starting it again.");
    const esc = silentBuildSession({ ...c, buildSessionRetries: 1 }, NOW);
    assert.strictEqual(esc.action, "escalate");
    assert.match(silentBuildNote(c, esc), /went quiet 20 minutes ago during testing, and so did the attempt before it/);
  });

  await test("the 3 hour ceiling: a session still beating is flagged for a person, not restarted", async () => {
    const c = building(181, { buildSession: beat(2, "building") });
    const next = silentBuildSession(c, NOW);
    assert.strictEqual(next.action, "ceiling");
    assert.match(silentBuildNote(c, next), /running for 3 hours and is still reporting during building .*It was not started again/);
    assert.strictEqual(silentBuildSession(building(179, { buildSession: beat(2) }), NOW), null, "under the ceiling it is left alone");
    // Past the ceiling AND quiet is an ordinary dead session.
    assert.strictEqual(silentBuildSession(building(200, { buildSession: beat(30) }), NOW).action, "retry");
  });

  await test("a heartbeat from a superseded attempt does not count; nor does one from the future", async () => {
    const zombie = building(15, { buildSession: beat(1, "testing", "bbbbbbbbbbbbbbbb") });
    assert.strictEqual(heartbeatMs(zombie, NOW), 0);
    assert.strictEqual(silentBuildSession(zombie, NOW).kind, "no-first-heartbeat", "the new session is silent, whatever the old one says");
    const future = building(30, { buildSession: { heartbeatAt: new Date(NOW + 3600000).toISOString(), phase: "testing", attemptId: ATTEMPT } });
    assert.strictEqual(heartbeatMs(future, NOW), NOW, "clamped to now");
  });

  await test("a fire from before heartbeats (no attempt id) keeps the 90 minute rule", async () => {
    const legacy = (min, over = {}) => ({ id: "t1", status: "backlog", lastFire: { status: "started", sessionId: "s1", at: iso(min) }, ...over });
    assert.strictEqual(LEGACY_SILENT_MS, 90 * 60 * 1000);
    assert.strictEqual(silentBuildSession(legacy(30), NOW), null, "never told to beat: not restarted at 10 minutes");
    assert.strictEqual(silentBuildSession(legacy(95), NOW).kind, "legacy");
    assert.match(silentBuildNote(legacy(95), silentBuildSession(legacy(95), NOW)), /never reported back\. Starting it again\./);
  });

  await test("a session that reported, a patch handed over, a flagged card or one off the Backlog is left alone", async () => {
    assert.strictEqual(silentBuildSession(building(60, { buildSession: { status: "done", reportedAt: iso(5) } }), NOW), null);
    assert.strictEqual(silentBuildSession(building(60, { patchReady: true }), NOW), null);
    assert.strictEqual(silentBuildSession(building(60, { blocked: { reason: "waiting-on-input" } }), NOW), null);
    assert.strictEqual(silentBuildSession(building(60, { status: "ready-for-testing" }), NOW), null);
  });

  await test("the sweep: a quiet session gets ONE note with the phase and is started again", async () => {
    reset([building(60, { buildSession: beat(25, "testing"), notes: [] })], { name: "P" });
    await auto.sweepSilentBuildSessions(NOW);
    assert.deepStrictEqual(notes("t1"), ["Build session went quiet 25 minutes ago during testing; starting it again."]);
    assert.strictEqual(card("t1").buildSessionRetries, 1);
    assert.ok(!card("t1").blocked, "a restart, not a flag");
  });

  await test("the sweep: a beating session is never restarted, however long it runs under the ceiling", async () => {
    reset([building(170, { buildSession: beat(4, "testing"), notes: [] })], { name: "P" });
    await auto.sweepSilentBuildSessions(NOW);
    assert.deepStrictEqual(notes("t1"), []);
    assert.ok(!card("t1").buildSessionRetries);
  });

  await test("the sweep: at the ceiling the card is flagged for a person and nothing is started", async () => {
    reset([building(185, { buildSession: beat(4, "testing"), notes: [] })], { name: "P" });
    await auto.sweepSilentBuildSessions(NOW);
    assert.strictEqual(card("t1").blocked.reason, "waiting-on-input");
    assert.ok(!card("t1").buildSessionRetries, "not counted as a restart");
    assert.strictEqual(notes("t1").length, 1);
    assert.match(notes("t1")[0], /It was not started again/);
    assert.strictEqual(card("t1").buildSession.attemptId, ATTEMPT, "the running session's record is left alone");
  });

  await test("the sweep: a second silence marks the card errored and flags it", async () => {
    reset([building(40, { buildSession: beat(30, "packaging"), buildSessionRetries: 1, notes: [] })], { name: "P" });
    await auto.sweepSilentBuildSessions(NOW);
    assert.strictEqual(card("t1").buildSession.status, "error");
    assert.strictEqual(card("t1").blocked.reason, "waiting-on-input");
    assert.strictEqual(card("t1").buildSessionRetries, 0);
  });

  await test("the project record stays open for a beating session past 75 minutes, and stalls for a silent one", async () => {
    const routine = { status: "in-progress", mode: "per-item", firedAt: iso(80), sentItemIds: ["t1"] };
    assert.ok(80 * 60 * 1000 > STALL_MS);
    assert.strictEqual(notifyRoutineOutcome(routine, [building(80, { buildSession: beat(3) })], NOW).outcome, "open");
    assert.strictEqual(notifyRoutineOutcome(routine, [building(80, { buildSession: beat(40) })], NOW).outcome, "stalled");
    assert.strictEqual(notifyRoutineOutcome({ ...routine, firedAt: iso(181) }, [building(181, { buildSession: beat(3) })], NOW).outcome, "stalled", "not past the ceiling");
    // And a further click never starts a second session for it.
    assert.deepStrictEqual(inFlightItemIds(routine, [building(80, { buildSession: beat(3) })], NOW), ["t1"]);
    assert.deepStrictEqual(inFlightItemIds(routine, [building(80, { buildSession: beat(40) })], NOW), []);
  });

  await test("staleAttemptPatch: only a patch whose attempt id is no longer the card's", async () => {
    assert.strictEqual(staleAttemptPatch({ buildAttemptId: "new", patchAttemptId: "old" }), true);
    assert.strictEqual(staleAttemptPatch({ buildAttemptId: "new", patchAttemptId: "new" }), false, "the current attempt lands");
    assert.strictEqual(staleAttemptPatch({ buildAttemptId: "new" }), false, "a patch with no id (hand-made, or an older session) is not stale");
    assert.strictEqual(staleAttemptPatch({ patchAttemptId: "old" }), false);
    assert.strictEqual(staleAttemptPatch({ buildAttemptId: "new", patchAttemptId: null }), false);
  });

  await test("processApplyPatch refuses a stale attempt's patch with a note, lands nothing and starts no rebuild", async () => {
    reset([{
      id: "t1", projectId: "P1", status: "backlog", title: "T", desc: "## Outcome\nx", patchReady: true,
      buildAttemptId: "bbbbbbbbbbbbbbbb", patchAttemptId: ATTEMPT, patchBaseSha: "c".repeat(40),
      patchFiles: [{ path: "backlog-tracker/x.js", content: "x" }], notes: [],
    }], { name: "P", deployBranch: "deploy/x" });
    await auto.processApplyPatch({ id: "t1", ...card("t1") });
    const c = card("t1");
    assert.strictEqual(c.patchReady, false);
    assert.ok(!c.deployCommit, "nothing landed");
    assert.ok(!c.patchAttemptId, "the stale id is cleared");
    assert.strictEqual(c.status, "backlog");
    assert.ok(!c.autoRebuilds && !c.blocked, "not rebuilt and not flagged: the current session carries on");
    assert.strictEqual(notes("t1").length, 1);
    assert.match(notes("t1")[0], /superseded handed back a patch \(attempt aaaaaaaa; the current attempt is bbbbbbbb\)\. It was not landed/);
    assert.ok(deleted.some((u) => u.includes("/backlogItems/t1/")), "its patch files are dropped");
  });

  await test("the stale-attempt check runs before anything else in processApplyPatch; a landing clears the id", async () => {
    const src = fs.readFileSync(path.join(__dirname, "../scripts/run-backlog-automation.js"), "utf8");
    const body = src.slice(src.indexOf("async function processApplyPatch("));
    const guard = body.indexOf("staleAttemptPatch(item)");
    assert.ok(guard > 0);
    assert.ok(guard < body.indexOf("hasIntakePlaceholder(item.desc)"), "before a refusal that would start a rebuild");
    assert.ok(guard < body.indexOf("workflowPathsIn(item.patchFiles)"), "before any git work");
    assert.match(body, /patchAttempts: 0,\n\s+patchAttemptId: null, \/\/ landed/);
    assert.match(src.slice(src.indexOf("function noDiffPatchFields(")).slice(0, 400), /patchAttemptId: null,/, "a no-diff landing clears it too");
  });

  await test("ROUTINE_INSTRUCTIONS.md and the fire text tell a session the same rule", async () => {
    const md = fs.readFileSync(path.join(__dirname, "../ROUTINE_INSTRUCTIONS.md"), "utf8");
    for (const s of ["## Heartbeat and build attempt", "buildSession.heartbeatAt", "buildSession.phase", "buildSession.attemptId", "patchAttemptId", "at least every 10 minutes",
      "## Sessions run the affected tests; the train runs everything", "npm run test:fast", "ph-website/tests/tour.test.mjs", "Train-only unless your patch touches them", "npm run test:fast-ui"]) {
      assert.ok(md.includes(s), `ROUTINE_INSTRUCTIONS.md mentions ${s}`);
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"));
    assert.ok(pkg.scripts["test:fast"], "the fast offline checks are one command");
    assert.ok(!/test:app-boots|test:ui|test:rules|test:mcp-app/.test(pkg.scripts["test:fast"]), "and need no browser or emulator");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})();
