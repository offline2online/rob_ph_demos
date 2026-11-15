// Late arrivals, the deploy queue and shared files between trains
// (wPoSOXfp8Em06Vzp3Cz7, from the board flow review of 14 Nov 2026).
//
// Three things went wrong together on the night of 13–14 Nov 2026:
//   A. a ticket landed on a train that was already closing, on top of its
//      version bump, and Deploy to Main refused to go;
//   B. three projects deployed at once, each bumped version.js to the same
//      number, and every one merged after the first had to merge main, re-bump
//      and re-run a 33-minute suite (the version line itself conflicted on
//      PR #585 and the approved deploy was dropped);
//   C. nobody could see that two trains changed the same files until
//      trainStatus "conflict" at deploy time.
//
// The decisions live here, pure — plain data in, plain answers out, no git,
// no network — so test/deploy-queue.test.js can pin each one. The git and
// Firestore half is scripts/run-backlog-automation.js (processApplyPatch,
// processDeployTrain, finishTrain, tryAutoResolveTrainMergeConflict).
"use strict";

const VERSION_JS = "backlog-tracker/public/js/version.js";

// A queue head that has made no progress for this long is passed over: the
// trains behind it go ahead, and it keeps its place for when it moves again.
const QUEUE_STALL_MS = 60 * 60 * 1000;
// A conflicted train nobody retries stops being kept in line after a day.
const QUEUE_CONFLICT_KEEP_MS = 24 * 60 * 60 * 1000;

// Top-level folders that ship through one deploy workflow: two trains that
// both change anything under the same group deploy the same site, so they
// are related even when no single file is shared.
const DEPLOY_GROUPS = [
  { workflow: "deploy-backlog-tracker.yml", prefixes: ["backlog-tracker/", "faq/"] },
];

// The paths a project owns, when projects/{id}.ownedPaths is not set. The
// three projects that share backlog-tracker/ are written out; every other
// project owns its repoFolder.
const DEFAULT_OWNED_PATHS = {
  oTcLAbnhUUO2S7NkbsuV: ["backlog-tracker/", "faq/", "docs/", "CLAUDE.md", ".github/workflows/"], // Backlog Tracker & FAQs
  New5VKTF2QBqT3T4YEla: ["kanban-staff-board/", "backlog-tracker/functions/kanban", "backlog-tracker/public/js/kanban/", "backlog-tracker/public/css/kanban.css"], // Staff Kanban
  ezm0maxN6hmtogaW5M2P: ["ph-website/"], // PH Website
};

const IN_FLIGHT = new Set(["deploying", "awaiting-human-merge"]);
const ON_TRAIN = new Set(["ready-for-testing", "ready-to-publish"]);

function toMillis(v) {
  if (!v) return 0;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  if (typeof v === "string") { const t = Date.parse(v); return Number.isNaN(t) ? 0 : t; }
  if (typeof v === "object" && typeof v.seconds === "number") return v.seconds * 1000;
  return 0;
}

function uniq(list) { return [...new Set((list || []).filter(Boolean))]; }
function withoutVersion(files) { return uniq(files).filter((p) => p !== VERSION_JS); }

// ── 1. Late arrivals wait for the next train ────────────────────────────────

// The train is closing: its first ticket was approved (trainLocked), or a
// Deploy to Main is under way (trainReady, deploying, waiting for a human
// merge). Nothing new joins it from here.
function trainClosing(project) {
  if (!project) return false;
  return project.trainLocked === true || project.trainReady === true || IN_FLIGHT.has(project.trainStatus);
}

// The deploy itself is running: main may already be merged in and the
// version bumped, so not even the exception below lands on it.
function trainDeploying(project) {
  return !!project && (project.trainReady === true || IN_FLIGHT.has(project.trainStatus));
}

// The ticket's last send-back was the train's own tests (the automatic
// eject writes lastFailureReason.category "tests") and it had been on a
// train before, so its rebuild is the train repairing itself.
function sentBackByTrainTests(item) {
  const r = item && item.lastFailureReason;
  const wasOnTrain = Array.isArray(item && item.deployCommits) && item.deployCommits.length > 0;
  return !!(r && r.category === "tests" && wasOnTrain);
}

// A re-patch of a card that is on this train right now (still in testing or
// approved): it is part of the release already.
function alreadyOnTrain(item) {
  return !!(item && item.deployCommit && ON_TRAIN.has(item.status));
}

// "land" — apply the patch now, as before; "hold" — keep the patch on the
// card (patchReady stays set), mark it buildAfterTrain, and land it once the
// train has merged. Never on top of a running deploy's version bump.
function lateArrivalAction(item, project) {
  if (!trainClosing(project)) return "land";
  if (trainDeploying(project)) return "hold";
  if (alreadyOnTrain(item)) return "land";
  if (sentBackByTrainTests(item)) return "land";
  return "hold";
}

function heldPatchNote(project) {
  const name = (project && project.name) || "this project";
  return `Built, and held for the next release: ${name}'s train is already closing ` +
    `(${trainDeploying(project) ? "its deploy to main is under way" : "a ticket on it has been approved"}), so this patch was not landed on it. ` +
    `It stays packaged on this card and lands by itself right after that train merges, carried onto the new main; it is rebuilt only if that conflicts.`;
}

// ── 2. One deploy at a time among trains that share files ──────────────────

function deployGroupsOf(files) {
  const out = [];
  for (const g of DEPLOY_GROUPS) {
    if (withoutVersion(files).some((p) => g.prefixes.some((pre) => p.startsWith(pre)))) out.push(g.workflow);
  }
  return out;
}

// Two trains are related when the files they change against main overlap, or
// both change something that ships through the same deploy workflow.
// version.js is left out: every train's bump touches it, and the resolver
// (resolveVersionJsConflict) takes main's line, so it never makes two trains
// related on its own.
function trainsRelated(filesA, filesB) {
  const a = withoutVersion(filesA);
  const b = new Set(withoutVersion(filesB));
  const shared = a.filter((p) => b.has(p));
  const groupsB = new Set(deployGroupsOf(filesB));
  const groups = deployGroupsOf(filesA).filter((w) => groupsB.has(w));
  return { related: shared.length > 0 || groups.length > 0, shared, groups };
}

function emptyQueue() { return { entries: [] }; }
function entriesOf(queue) { return Array.isArray(queue && queue.entries) ? queue.entries.filter((e) => e && e.projectId) : []; }

// First click first: a project already in the queue keeps its place; a
// newcomer joins the end.
function enqueue(queue, entry, nowIso) {
  const entries = entriesOf(queue);
  if (entries.some((e) => e.projectId === entry.projectId)) return { ...queue, entries };
  return {
    ...queue,
    entries: entries.concat([{
      projectId: entry.projectId,
      projectName: entry.projectName || entry.projectId,
      deployBranch: entry.deployBranch || null,
      enqueuedAt: nowIso,
      progressKey: entry.progressKey || null,
      progressAt: nowIso,
      passedOverAt: null,
    }]),
  };
}

function removeFromQueue(queue, projectId) {
  return { ...queue, entries: entriesOf(queue).filter((e) => e.projectId !== projectId) };
}

// Drop entries whose deploy is over: the project no longer asks to deploy
// and is not mid-deploy. A conflicted train keeps its place (a retry resumes
// it) for a day.
function pruneQueue(queue, stateById, nowMs) {
  return {
    ...queue,
    entries: entriesOf(queue).filter((e) => {
      const s = stateById && stateById[e.projectId];
      if (!s) return false;
      if (s.trainReady === true || IN_FLIGHT.has(s.trainStatus)) return true;
      if (s.trainStatus === "conflict") return nowMs - toMillis(e.progressAt) < QUEUE_CONFLICT_KEEP_MS;
      return false;
    }),
  };
}

// What counts as progress for a deploy: its status, its hold, its PR and the
// commit at the head of its branch. Any change resets the 60-minute clock.
function deploySignature(project, head) {
  const p = project || {};
  return [p.trainStatus || "", p.trainHold || "", p.trainPrNumber || "", head || ""].join("|");
}

function refreshProgress(queue, projectId, key, nowIso) {
  return {
    ...queue,
    entries: entriesOf(queue).map((e) => {
      if (e.projectId !== projectId || e.progressKey === key) return e;
      return { ...e, progressKey: key, progressAt: nowIso, passedOverAt: null };
    }),
  };
}

function stalled(entry, state, nowMs) {
  if (state && state.trainStatus === "conflict") return true;
  return nowMs - toMillis(entry.progressAt) >= QUEUE_STALL_MS;
}

// Should this project's deploy go now? Every entry ahead of it in the queue
// that is related to it holds it, unless that entry has stalled (no progress
// for an hour, or parked on a conflict): a stalled one is passed over and
// keeps its place. A project not in the queue goes (nothing to wait for).
//   filesById: { [projectId]: string[] } — each train's files against main
//   stateById: { [projectId]: { trainStatus, trainReady } }
function queueDecision(queue, projectId, { filesById = {}, stateById = {}, nowMs = Date.now() } = {}) {
  const entries = entriesOf(queue);
  const idx = entries.findIndex((e) => e.projectId === projectId);
  if (idx < 0) return { action: "go", passedOver: [] };
  const mine = filesById[projectId] || [];
  const passedOver = [];
  for (const e of entries.slice(0, idx)) {
    const rel = trainsRelated(mine, filesById[e.projectId] || []);
    if (!rel.related) continue;
    if (stalled(e, stateById[e.projectId], nowMs)) { passedOver.push({ ...e, shared: rel.shared, groups: rel.groups }); continue; }
    return { action: "hold", behind: { ...e, shared: rel.shared, groups: rel.groups }, passedOver };
  }
  return { action: "go", passedOver };
}

function relationPhrase(rel) {
  if (rel.shared && rel.shared.length) {
    const list = rel.shared.slice(0, 5).join(", ") + (rel.shared.length > 5 ? ` and ${rel.shared.length - 5} more` : "");
    return `both trains change ${list}`;
  }
  if (rel.groups && rel.groups.length) return `both trains ship through ${rel.groups.join(", ")}`;
  return "the two trains are related";
}

function queuedNote(behind) {
  return `Queued behind ${behind.projectName || behind.projectId}'s deploy; starts by itself when that merges. ` +
    `(${relationPhrase(behind)}, so they merge one at a time: this train is synced with main, tested and given its version number once, after that one.)`;
}

function passedOverNote(entry, byName) {
  return `Passed over in the deploy queue: ${entry.projectName || entry.projectId}'s deploy made no progress for 60 minutes` +
    `${byName ? `, so ${byName} went ahead` : ""}. It keeps its place and carries on by itself when it moves again.`;
}

// ── 5. Overlap is visible while testing ────────────────────────────────────

// One entry per other live train that shares files with what this patch
// changed. `others`: [{ projectId, projectName, files, conflictPaths }] where
// conflictPaths is what `git merge-tree` of the two train tips reported
// (null when it wasn't run). version.js never counts.
function sharedWithEntries(changedPaths, others) {
  const mine = new Set(withoutVersion(changedPaths));
  const out = [];
  for (const o of others || []) {
    if (!o || !o.projectId) continue;
    const paths = withoutVersion(o.files).filter((p) => mine.has(p)).sort();
    if (!paths.length) continue;
    const conflictPaths = withoutVersion(o.conflictPaths || []).sort();
    out.push({ projectId: o.projectId, projectName: o.projectName || o.projectId, paths, conflictPaths, conflict: conflictPaths.length > 0 });
  }
  return out;
}

function sharedWithNote(entries) {
  if (!entries || !entries.length) return "";
  return entries.map((e) => e.conflict
    ? `Conflicts with ${e.projectName}'s train: ${e.conflictPaths.join(", ")}. Both trains change ${e.paths.join(", ")} and the two branches do not merge cleanly, so fix it before either is approved (one of them merges main in and resolves it), or the second deploy stops on a conflict.`
    : `Also changed on ${e.projectName}'s train: ${e.paths.join(", ")}. Whichever train merges second takes the other's change when it merges main; nothing to do unless that later conflicts.`).join(" ");
}

// `git merge-tree --write-tree --name-only <a> <b>`: the first line is the
// tree id, then one conflicted path per line up to a blank line, then
// informational messages. Exit status 1 means conflicts; this only reads the
// names. Returns [] for a clean merge.
function parseMergeTreeConflicts(output) {
  const lines = String(output || "").split("\n");
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) break;
    out.push(l.trim());
  }
  return uniq(out);
}

// ── 6. Owned paths ────────────────────────────────────────────────────────

function ownedPathsOf(project) {
  if (!project) return [];
  if (Array.isArray(project.ownedPaths) && project.ownedPaths.some((p) => typeof p === "string" && p.trim())) {
    return uniq(project.ownedPaths.map((p) => String(p).trim()));
  }
  if (DEFAULT_OWNED_PATHS[project.id]) return DEFAULT_OWNED_PATHS[project.id].slice();
  const folder = typeof project.repoFolder === "string" ? project.repoFolder.trim().replace(/\/+$/, "") : "";
  return folder ? [`${folder}/`] : [];
}

function pathUnder(p, prefix) {
  if (!prefix) return false;
  if (p === prefix) return true;
  if (prefix.endsWith("/")) return p.startsWith(prefix);
  // A file name (CLAUDE.md) matches only itself or a folder of that name;
  // a partial name (backlog-tracker/functions/kanban) matches anything that
  // starts with it (kanban.js, kanban-core.js).
  return p.startsWith(prefix);
}

// The project whose owned path is the longest prefix of `p` owns it.
function ownerOf(p, projects) {
  let best = null;
  let bestLen = -1;
  for (const pr of projects || []) {
    for (const prefix of ownedPathsOf(pr)) {
      if (pathUnder(p, prefix) && prefix.length > bestLen) { best = pr; bestLen = prefix.length; }
    }
  }
  return best;
}

// Files this patch changed that another project owns: a warning on the card
// (the other project's train will need a sync), never a refusal.
function foreignOwnedPaths(changedPaths, project, allProjects) {
  const byOwner = new Map();
  for (const p of withoutVersion(changedPaths)) {
    const owner = ownerOf(p, allProjects);
    if (!owner || !project || owner.id === project.id) continue;
    if (!byOwner.has(owner.id)) byOwner.set(owner.id, { projectId: owner.id, projectName: owner.name || owner.id, paths: [] });
    byOwner.get(owner.id).paths.push(p);
  }
  return [...byOwner.values()].map((e) => ({ ...e, paths: e.paths.sort() }));
}

function foreignPathsNote(entries) {
  if (!entries || !entries.length) return "";
  return entries.map((e) => `Changes ${e.projectName}'s files: ${e.paths.join(", ")}. ` +
    `${e.projectName}'s train will need main merged in after this ships; this is a warning, not a refusal.`).join(" ");
}

// ── 3. version.js never conflicts ─────────────────────────────────────────

// A merge of main into a train that conflicts on version.js only because both
// sides changed the APP_VERSION line resolves to main's file: the train's
// bump is recomputed from main afterwards (processDeployTrain). Anything else
// differing in the file is left for a person. Returns the resolved text, or
// null.
const APP_VERSION_LINE = /^\s*export\s+const\s+APP_VERSION\s*=.*$|^.*\bAPP_VERSION\s*=\s*["'][^"']*["'].*$/;
function resolveVersionJsConflict(oursText, theirsText) {
  if (typeof oursText !== "string" || typeof theirsText !== "string") return null;
  const strip = (t) => t.split("\n").map((l) => (APP_VERSION_LINE.test(l) ? "<APP_VERSION>" : l)).join("\n");
  return strip(oursText) === strip(theirsText) ? theirsText : null;
}

module.exports = {
  VERSION_JS,
  QUEUE_STALL_MS,
  QUEUE_CONFLICT_KEEP_MS,
  DEPLOY_GROUPS,
  DEFAULT_OWNED_PATHS,
  trainClosing,
  trainDeploying,
  sentBackByTrainTests,
  alreadyOnTrain,
  lateArrivalAction,
  heldPatchNote,
  deployGroupsOf,
  trainsRelated,
  emptyQueue,
  enqueue,
  removeFromQueue,
  pruneQueue,
  deploySignature,
  refreshProgress,
  queueDecision,
  queuedNote,
  passedOverNote,
  sharedWithEntries,
  sharedWithNote,
  parseMergeTreeConflicts,
  ownedPathsOf,
  ownerOf,
  foreignOwnedPaths,
  foreignPathsNote,
  resolveVersionJsConflict,
};
