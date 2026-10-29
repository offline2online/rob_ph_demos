// Which build/deploy CTA a project header shows in each pipeline phase
// (5 Oct 2026). "Deving…" belongs to Backlog → Ready for Testing only; it was
// showing — and spinning indefinitely — beside Deploy to Main on Display Types
// because notifyClaudeButtonHTML's in-progress branch never looked at the
// train phase, and an old notifyRoutine record stayed "in-progress" until its
// 20-minute timeout, which the board only noticed on its next Firestore write.
//
// Pulls the REAL functions out of public/js/app.js and runs them in a vm
// context with just the board state they read — no DOM, no Firebase.
//
// Run with:  node test/header-phase.test.mjs
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "..", "public", "js", "app.js"), "utf8");

function extract(name) {
  const start = src.indexOf(`\nfunction ${name}(`);
  assert.ok(start >= 0, `app.js defines ${name}`);
  let i = src.indexOf("{", src.indexOf(")", start)), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) break;
  }
  return src.slice(start, i + 1);
}
function constant(name) {
  const m = src.match(new RegExp(`\\nconst ${name} = [^;]+;`));
  assert.ok(m, `app.js defines ${name}`);
  return m[0];
}

const code = [
  "NOTIFY_ROUTINE_STALE_MS", "NOTIFY_STILL_BUILDING_MS", "DEPLOY_ROUTINE_STALE_MS", "DEPLOY_HANDOVER_STALE_MS",
  "NOTIFY_OPTIMISTIC_STALE_MS", "DEPLOY_OPTIMISTIC_STALE_MS",
].map(constant).join("\n") + "\n" + [
  "tsMillis", "anyMillis", "perItemBuildFinished", "perItemRoutineFinished", "isTrainLocked", "isProjectFinalised",
  "projectInDeployPhase", "deployHandedOver", "stalledSentIds", "sentTicketStateLines", "notifyStalledChipHTML", "notifyClaudeButtonCore", "notifyClaudeButtonHTML",
  "trainItemsForProject", "pendingTrainRevertsForProject", "legacyDeployItemsForProject", "deployNotifyButtonHTML",
].map(extract).join("\n") + "\nlet timedSpinnerShown = false;";

function board(project, cards) {
  const ctx = {
    GENERAL_PROJECT_ID: "general",
    items: cards, allItems: cards,
    notifyOptimisticClicks: {}, deployOptimisticClicks: {},
    escapeHTML: (s) => String(s), safeHttpUrl: (s) => s,
    backlogCountForProject: (pid) => cards.filter((c) => c.projectId === pid && c.status === "backlog").length,
    getSelectedSet: () => new Set(),
    isBuildableBacklogItem: (i) => i.status === "backlog" && !(i.blocked && i.blocked.reason) && !i.patchReady,
    waitingOnAnswerChipHTML: () => "",
    Date,
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return { html: () => ctx.notifyClaudeButtonHTML(project), deploy: () => ctx.deployNotifyButtonHTML(project), ctx };
}

const ts = (ms) => ({ toMillis: () => ms });
const now = Date.now();
const P = "p1";
let passed = 0; const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`FAIL  ${name}\n      ${err && err.stack || err}`); }
}

test("a build in flight in the Backlog phase shows Deving…", () => {
  const cards = [{ id: "a", projectId: P, status: "backlog" }];
  const project = { id: P, notifyRoutine: { status: "in-progress", mode: "per-item", firedAt: ts(now - 60e3), sessionUrl: "https://claude.ai/code/s", sentItemIds: ["a"] } };
  assert.match(board(project, cards).html(), /Deving/);
});

test("a locked train (approved card) never shows Deving…, even with an in-progress record", () => {
  const cards = [{ id: "a", projectId: P, status: "ready-to-publish", deployCommit: "abc" }];
  const project = { id: P, trainLocked: true, notifyRoutine: { status: "in-progress", firedAt: ts(now - 60e3), sessionUrl: "https://claude.ai/code/s", sentItemIds: ["a", "gone"] } };
  assert.strictEqual(board(project, cards).html(), "");
});

test("a handed-over deploy (trainReady) never shows Deving…", () => {
  const cards = [{ id: "b", projectId: P, status: "backlog" }];
  const project = { id: P, trainReady: true, notifyRoutine: { status: "in-progress", mode: "per-item", firedAt: ts(now - 60e3), sessionUrl: "x", sentItemIds: ["b"] } };
  assert.strictEqual(board(project, cards).html(), "");
});

test("a running Deploy Routine never shows Deving…", () => {
  const cards = [{ id: "b", projectId: P, status: "backlog" }];
  const project = { id: P, deployRoutine: { status: "in-progress", firedAt: ts(now - 60e3) }, notifyRoutine: { status: "in-progress", mode: "per-item", firedAt: ts(now - 60e3), sessionUrl: "x", sentItemIds: ["b"] } };
  assert.strictEqual(board(project, cards).html(), "");
});

test("an older single-session record is over once its cards left Backlog", () => {
  const cards = [{ id: "a", projectId: P, status: "ready-for-testing" }, { id: "n", projectId: P, status: "backlog" }];
  const project = { id: P, notifyRoutine: { status: "in-progress", firedAt: ts(now - 60e3), sessionUrl: "x", sentItemIds: ["a"] } };
  const html = board(project, cards).html();
  assert.doesNotMatch(html, /Deving/);
  assert.match(html, /Ready for Dev/, "the next Backlog card can be sent");
});

test("a spinner marks the board for the stale-clearing tick", () => {
  const cards = [{ id: "a", projectId: P, status: "backlog" }];
  const project = { id: P, notifyRoutine: { status: "in-progress", mode: "per-item", firedAt: ts(now - 60e3), sessionUrl: "x", sentItemIds: ["a"] } };
  const b = board(project, cards);
  b.html();
  assert.strictEqual(vm.runInContext("timedSpinnerShown", b.ctx), true);
});

// 20 Oct 2026: Deploy to Main stopped on a merge conflict and the button came
// straight back as an ordinary "Deploy to Main" — every click looked unheard.
test("a whole approved train offers Deploy to Main", () => {
  const cards = [{ id: "a", projectId: P, status: "ready-to-publish", deployCommit: "abc" }];
  const html = board({ id: P, trainLocked: true }, cards).deploy();
  assert.match(html, /Deploy to Main/);
  assert.doesNotMatch(html, /blocked/);
});

test("a deploy parked on a merge conflict says so, with the reason, and can still be retried", () => {
  const cards = [{ id: "a", projectId: P, status: "ready-to-publish", deployCommit: "abc" }];
  const project = { id: P, trainLocked: true, trainStatus: "conflict", trainReady: false, trainNote: "Merging main into deploy/x conflicted on README.md" };
  const html = board(project, cards).deploy();
  assert.match(html, /Deploy blocked — retry/);
  assert.match(html, /deploy-notify-btn-conflict/);
  assert.match(html, /conflicted on README\.md/, "the pipeline's reason is on the button");
  assert.match(html, /data-project-id="p1"/, "still a live button, so a click retries");
});

test("a conflicted deploy the pipeline is retrying shows Deploying…, not the blocked button", () => {
  const cards = [{ id: "a", projectId: P, status: "ready-to-publish", deployCommit: "abc" }];
  const project = { id: P, trainLocked: true, trainStatus: "deploying", trainReady: true };
  const html = board(project, cards).deploy();
  assert.match(html, /Deploying/);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
