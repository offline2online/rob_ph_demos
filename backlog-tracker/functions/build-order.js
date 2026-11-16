// Build order (ticket ZE8h8cfaezOb0eTsRjSH, 14 Nov 2026). Pure: no Firebase,
// so the Ready for Dev trigger (functions/index.js), the intake trigger, the
// MCP server, run-backlog-automation.js and the tests share one rule.
//
// Before this, a Ready for Dev click fired one session per ticket, four at a
// time, in array order, all from the same base. Nothing decided order, and the
// board paid for it: "Not built: since this patch was written … changed … in
// the same places" on 104 tickets (siblings built in parallel collided), and
// dependants built before their dependency and wasted a session first. So:
//
//   1. Dependencies are data. The Dependencies section of a description is
//      read at intake: 20-character ticket ids, and the exact titles of open
//      tickets in the same project, become `dependsOnItemIds` with
//      `dependsOnSource: "intake"`. A list a build session ("build") or a
//      person ("manual") set is never overwritten, only added to.
//   2. A click builds in order. A ticket whose dependency is still in Backlog
//      (in the same click or not) is held with blocked "waiting-on-dependency"
//      and released by the automation when the dependency reaches Ready for
//      Testing (releaseDependents / sweepDependencyWaits).
//   3. Same-area tickets go a few at a time. Tickets likely to touch the same
//      files (same groom area, same file path, same named function or spec
//      section) form a lane. Up to LANE_WIDTH of a lane build at once; the
//      rest queue (`queuedAfter`), each starting when a place frees up.
//      Different lanes still build in parallel. Until 16 Nov 2026 a lane
//      built strictly one at a time: seven flaky-test tickets sent in one
//      click were a six-hour chain (each build session takes 60-90 minutes),
//      although each changed a different test case. A patch is carried onto
//      the train by a three-way merge, so two lane-mates collide only when
//      they change the same lines; that one is rebuilt automatically
//      (selfHealPlan), which takes no longer than the wait it replaced.
//   4. Deadlocks are said out loud: a ticket waiting for one that is itself
//      blocked on a person says so, and a cycle is refused (or, when a build
//      session made one, flagged for a person).
"use strict";

const { parseSections } = require("./intake");

const MAX_DEPENDENCIES = 20;
const DEPENDENCY_REASON = "waiting-on-dependency";
const BUILD_ORDER_SETTER = "build-order";
const CYCLE_SETTER = "dependency-cycle";
const DEPENDENCY_SOURCES = ["intake", "build", "manual"];
// Tickets a dependency can point at: anything not archived. Titles resolve
// against these, in the same project only.
const OPEN_STATUSES = ["backlog", "ready-for-testing", "ready-to-publish"];
// A dependency in one of these does not hold anything: it is on the train,
// approved or live, so its code is in the next build's base.
const SATISFIED_STATUSES = new Set(["ready-for-testing", "ready-to-publish", "published-live"]);
// A queued ticket whose lane-mate never settles is let go after this long.
const QUEUE_MAX_WAIT_MS = 3 * 60 * 60 * 1000;
// How many tickets of one lane build at the same time.
const LANE_WIDTH = 3;

const uniq = (xs) => [...new Set((xs || []).filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()))];

function toMillis(v) {
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (v instanceof Date) return v.getTime();
  if (typeof v === "object" && typeof v.seconds === "number") return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

// ── 1. Reading the Dependencies section ─────────────────────────────────────

// A Firestore auto-id: 20 letters and digits. A plain 20-letter English word
// ("internationalization") is not one: an id has a digit or a capital past the
// first character.
function looksLikeItemId(s) {
  return /^[A-Za-z0-9]{20}$/.test(s) && /[A-Za-z]/.test(s) && (/\d/.test(s) || /[A-Z]/.test(s.slice(1)));
}

const normText = (s) => String(s || "").toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, "\"").replace(/\s+/g, " ").trim();

function dependencySection(desc) {
  return String(parseSections(desc).dependencies || "").trim();
}

// Does `section` name this title? Quoted anywhere, or (for a title of four
// words or more) verbatim — a short title like "Roles page" only counts in
// quotes, so ordinary prose doesn't pick up a ticket by accident.
function namesTitle(section, title) {
  const t = normText(title);
  if (t.length < 4) return false;
  const s = normText(section);
  if (s.includes(`"${t}"`) || s.includes(`'${t}'`) || s.includes(`\`${t}\``)) return true;
  return t.split(" ").length >= 4 && s.includes(t);
}

// → { ids, titleIds, section }: ticket ids written in the section (any
// project — resolved against the board by the caller), and the ids of open
// tickets (`candidates`, same project, {id, title}) whose exact title it names.
// Anything else in the section stays prose.
function findDependencyReferences(desc, candidates = [], { selfId = null } = {}) {
  const section = dependencySection(desc);
  if (!section) return { ids: [], titleIds: [], section: "" };
  const ids = [];
  for (const m of section.matchAll(/(?:^|[^A-Za-z0-9])([A-Za-z0-9]{20})(?![A-Za-z0-9])/g)) {
    if (looksLikeItemId(m[1]) && m[1] !== selfId && !ids.includes(m[1])) ids.push(m[1]);
  }
  const named = (candidates || []).filter((c) => c && c.id && c.id !== selfId && namesTitle(section, c.title));
  // "Roles page" inside a longer named title "Roles page: sort by name" is the
  // longer one only.
  const titleIds = named
    .filter((c) => !named.some((o) => o !== c && normText(o.title).length > normText(c.title).length && normText(o.title).includes(normText(c.title))))
    .map((c) => c.id)
    .filter((id) => !ids.includes(id));
  return { ids, titleIds, section };
}

// Merge what intake found into what the card already has. A list a build
// session or a person set is only ever added to; a list intake set is
// replaced by what the description says now. → { ids, source }
function mergeDependsOn(existingIds, existingSource, intakeIds) {
  const existing = uniq(existingIds);
  const found = uniq(intakeIds);
  if (!existing.length) return { ids: found.slice(0, MAX_DEPENDENCIES), source: found.length ? "intake" : (existingSource || null) };
  if (existingSource === "intake") return { ids: found.slice(0, MAX_DEPENDENCIES), source: found.length ? "intake" : null };
  // "build", "manual", or a legacy list with no source (only build sessions
  // wrote one before this): never drop an entry.
  return { ids: uniq(existing.concat(found)).slice(0, MAX_DEPENDENCIES), source: existingSource || "build" };
}

// ── 2. Cycles ────────────────────────────────────────────────────────────────

// Would `startId` depending on `depIds` close a loop? `depsOf(id)` returns the
// ids a ticket waits for. → the loop as ids [start, …, start], or null.
function findCycle(startId, depIds, depsOf) {
  const seen = new Set();
  const walk = (id, path) => {
    if (id === startId) return path.concat(id);
    if (seen.has(id)) return null;
    seen.add(id);
    for (const d of (depsOf(id) || [])) {
      const p = walk(d, path.concat(id));
      if (p) return p;
    }
    return null;
  };
  for (const d of uniq(depIds)) {
    const p = walk(d, [startId]);
    if (p) return p;
  }
  return null;
}

// "A waits for B waits for A"
function cycleMessage(path, titleOf) {
  return path.map((id) => (titleOf && titleOf(id)) || id).join(" waits for ");
}

// Validate a hand-set list (MCP, the Edit item picker). → { ids } or { error }.
function validateDependsOn(selfId, ids, { exists, depsOf, titleOf }) {
  if (!Array.isArray(ids)) return { error: "dependsOnItemIds must be an array of ticket ids." };
  const list = uniq(ids);
  if (list.length > MAX_DEPENDENCIES) return { error: `At most ${MAX_DEPENDENCIES} dependencies per ticket.` };
  if (selfId && list.includes(selfId)) return { error: "A ticket can't build after itself." };
  const missing = list.filter((id) => !exists(id));
  if (missing.length) return { error: `No ticket with id ${missing.join(", ")}.` };
  if (selfId) {
    const loop = findCycle(selfId, list, depsOf);
    if (loop) return { error: `That would make a loop: ${cycleMessage(loop, titleOf)}. Remove one of them first.` };
  }
  return { ids: list };
}

// ── 3. Lanes: tickets likely to touch the same files ─────────────────────────

const PATH_RE = /(?:[\w.-]+\/)*[\w-]+(?:\.[\w-]+)*\.(?:js|mjs|cjs|ts|tsx|jsx|html|css|rules|json|ya?ml|sh|py)\b/g;
// File names too generic to stand alone: keep their parent folder.
const GENERIC_FILES = new Set(["index.js", "index.mjs", "index.ts", "index.tsx", "index.html", "package.json", "main.js", "styles.css", "style.css"]);
// camelCase names (functions, fields) shared by nearly every ticket on this
// board, so they would chain everything into one lane.
const COMMON_NAMES = new Set(["backlogItems", "projectId", "patchFiles", "patchReady", "updatedAt", "createdAt", "buildSession", "notifyRequestedAt", "notifyItemIds", "deployCommit", "previewUrl", "testSummary", "requirementsMd", "readmeMd", "dependsOnItemIds", "dependsOnSource"]);
const SECTION_RE = /→\s*["“]([^"”\n]{3,100})["”]/g;

function fileKey(p) {
  const parts = p.split("/").filter(Boolean);
  const base = parts[parts.length - 1];
  if (/\.md$/i.test(base)) return null; // docs union-merge; the section names decide
  if (GENERIC_FILES.has(base.toLowerCase()) && parts.length > 1) return `file:${parts[parts.length - 2]}/${base}`.toLowerCase();
  return `file:${base}`.toLowerCase();
}

// The keys a ticket shares a lane on: its groom areas, and the file paths,
// named functions and quoted spec sections in its Outcome and Spec reference.
function laneKeysOf(item) {
  const keys = new Set();
  for (const a of (Array.isArray(item && item.groomAreas) ? item.groomAreas : [])) {
    const k = String(a || "").trim().toLowerCase();
    if (k) keys.add(`area:${k}`);
  }
  const s = parseSections(item && item.desc);
  const text = `${s.outcome || ""}\n${s.specReference || ""}`;
  for (const p of text.match(PATH_RE) || []) {
    const k = fileKey(p);
    if (k) keys.add(k);
  }
  for (const n of text.match(/\b[a-z][a-z0-9]*[A-Z][A-Za-z0-9]+\b/g) || []) {
    if (n.length >= 8 && !COMMON_NAMES.has(n)) keys.add(`fn:${n}`);
  }
  for (const m of text.matchAll(SECTION_RE)) keys.add(`section:${normText(m[1])}`);
  return [...keys];
}

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
function laneOrder(a, b) {
  const pa = PRIORITY_RANK[a.priority] ?? 1;
  const pb = PRIORITY_RANK[b.priority] ?? 1;
  if (pa !== pb) return pa - pb;
  const ca = toMillis(a.createdAt) ?? 0;
  const cb = toMillis(b.createdAt) ?? 0;
  if (ca !== cb) return ca - cb;
  return String(a.id).localeCompare(String(b.id));
}

// Union-find over shared lane keys. → arrays of items, each a lane.
function lanesOf(items) {
  const parent = items.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const owner = new Map();
  items.forEach((item, i) => {
    for (const k of laneKeysOf(item)) {
      if (owner.has(k)) parent[find(i)] = find(owner.get(k));
      else owner.set(k, i);
    }
  });
  const out = new Map();
  items.forEach((item, i) => {
    const r = find(i);
    if (!out.has(r)) out.set(r, []);
    out.get(r).push(item);
  });
  return [...out.values()];
}

// ── 4. One click: what fires, what is held, what is queued ──────────────────

const titleOfItem = (x) => (x && x.title) || "another ticket";

// items:     the click's buildable Backlog tickets (full card data)
// depsById:  every dependency outside the click, by id (null = deleted)
// building:  Backlog tickets an earlier click is still building (full data)
// → { fire: [item], held: [{ item, waitingFor: [{id, title, inClick, building}] }],
//     queued: [{ item, after: {id, title} }], notSent: [{id, title}], summary }
function planBuildOrder(items, { depsById = {}, building = [] } = {}) {
  const clickById = new Map((items || []).map((i) => [i.id, i]));
  const buildingIds = new Set((building || []).map((b) => b.id));
  const lookup = (id) => (clickById.has(id) ? clickById.get(id) : (depsById[id] !== undefined ? depsById[id] : undefined));

  const held = [];
  const ready = [];
  for (const item of items || []) {
    const waitingFor = [];
    for (const id of uniq(item.dependsOnItemIds)) {
      if (id === item.id) continue;
      const d = lookup(id);
      if (!d) continue; // deleted (or unknown): holds nothing
      if ((d.status || "backlog") !== "backlog") continue; // on the train, approved, live or archived
      const inClick = clickById.has(id);
      const isBuilding = inClick || buildingIds.has(id) || !!d.patchReady;
      waitingFor.push({ id, title: titleOfItem(d), inClick, building: isBuilding });
    }
    if (waitingFor.length) held.push({ item, waitingFor });
    else ready.push(item);
  }

  // Lanes over what can fire now plus what is already building: a ticket
  // sharing a lane with a build already running waits for that one too.
  const fire = [];
  const queued = [];
  for (const lane of lanesOf([...(building || []), ...ready])) {
    const running = lane.filter((x) => buildingIds.has(x.id));
    const mine = lane.filter((x) => !buildingIds.has(x.id)).sort(laneOrder);
    // LANE_WIDTH at a time: a ticket past that waits for the one LANE_WIDTH
    // places ahead of it, so a place freeing up starts exactly one more.
    const order = [...running, ...mine];
    for (let k = running.length; k < order.length; k++) {
      if (k < LANE_WIDTH) fire.push(order[k]);
      else { const ahead = order[k - LANE_WIDTH]; queued.push({ item: order[k], after: { id: ahead.id, title: titleOfItem(ahead) } }); }
    }
  }
  // Keep the click's own order for what fires.
  fire.sort((a, b) => items.indexOf(a) - items.indexOf(b));

  const notSentMap = new Map();
  for (const h of held) for (const w of h.waitingFor) if (!w.building) notSentMap.set(w.id, w.title);
  const notSent = [...notSentMap].map(([id, title]) => ({ id, title }));
  return { fire, held, queued, notSent, summary: buildOrderSummary({ fire, held, queued, notSent }) };
}

// "1 started. 2 held: they need X, which was not sent. 1 queued behind Y."
function buildOrderSummary({ fire, held, queued, notSent }) {
  if (!held.length && !queued.length) return null;
  const parts = fire.length ? [`${fire.length} started`] : [];
  if (held.length) {
    const unsent = notSent.map((n) => `"${n.title}"`);
    const waitTitles = uniq(held.flatMap((h) => h.waitingFor.filter((w) => w.building).map((w) => w.title)));
    const pieces = [];
    if (unsent.length) pieces.push(`${held.length === 1 ? "it needs" : "they need"} ${unsent.join(", ")}, which ${unsent.length === 1 ? "was" : "were"} not sent`);
    if (waitTitles.length) pieces.push(`${unsent.length ? "and " : ""}${held.length === 1 && !unsent.length ? "it builds" : "they build"} after ${waitTitles.map((t) => `"${t}"`).join(", ")} reaches Ready for Testing`);
    parts.push(`${held.length} held: ${pieces.join(" ")}`);
  }
  if (queued.length) parts.push(`${queued.length} queued (same area, ${LANE_WIDTH} at a time)`);
  return `${parts.join(". ")}.`;
}

// The blocked flag a held ticket gets.
function heldBlock(waitingFor, nowIso = new Date().toISOString()) {
  return {
    reason: DEPENDENCY_REASON,
    note: `Waiting for: ${waitingFor.map((w) => w.title).join("; ")}. This ticket builds by itself once ${waitingFor.length === 1 ? "it has" : "they have"} reached Ready for Testing. Nothing to answer.`,
    setBy: BUILD_ORDER_SETTER,
    setAt: nowIso,
  };
}

// The dependencies a fired ticket builds on: already landed, so already in
// the session's base. → [{id, title, status, deployCommit}]
function landedDependencies(item, depsById = {}) {
  return uniq(item && item.dependsOnItemIds)
    .map((id) => depsById[id] ? { id, ...depsById[id] } : null)
    .filter((d) => d && SATISFIED_STATUSES.has(d.status))
    .map((d) => ({ id: d.id, title: titleOfItem(d), status: d.status, deployCommit: d.deployCommit || null }));
}

function builtOnBlock(landed) {
  if (!landed || !landed.length) return "";
  const lines = landed.map((d) => `- ${d.id}: ${d.title} (${d.status}${d.deployCommit ? `, commit ${String(d.deployCommit).slice(0, 12)}` : ""})`);
  return `\n\nAlready landed and in your base (this ticket builds on them, so read their commits — git log --grep "Backlog item: <id>" — instead of rediscovering them):\n${lines.join("\n")}`;
}

// ── 5. A queued ticket: has its lane-mate settled? ──────────────────────────

// queued: the waiting card (with queuedAfter: {itemId, title, at})
// pred:   the card it is queued after (null = deleted)
// → { release: false } or { release: true, why }
function queueReleasePlan(queued, pred, nowMs = Date.now()) {
  const q = queued && queued.queuedAfter;
  if (!q || !q.itemId) return { release: false };
  const title = (pred && pred.title) || q.title || "the ticket ahead of it";
  if (!pred) return { release: true, why: `"${title}" was deleted` };
  const st = pred.status || "backlog";
  if (st === "archived") return { release: true, why: `"${title}" was archived` };
  if (st !== "backlog") return { release: true, why: `"${title}" has landed on the train` };
  if (pred.patchReady) return { release: false };
  if (pred.blocked && pred.blocked.reason) return { release: true, why: `"${title}" is blocked (${pred.blocked.reason}), so this one goes ahead` };
  const fire = pred.lastFire || {};
  if (fire.status === "failed") return { release: true, why: `"${title}" could not be started` };
  const s = pred.buildSession || {};
  // A report from before the ticket's latest fire is the previous attempt's:
  // the ticket is being built again, so it has not finished. Without this a
  // ticket queued behind one that kept rebuilding was let go, queued again by
  // the click (which saw the rebuild in flight) and let go again, every run:
  // 139 "builds now" notes in three hours on 16 Nov 2026, and no build.
  const firedMs = fire.status === "started" ? toMillis(fire.at) : null;
  const reportedMs = toMillis(s.reportedAt) ?? toMillis(s.finishedAt);
  const stale = firedMs != null && reportedMs != null && reportedMs < firedMs;
  const current = !stale && (!s.attemptId || !pred.buildAttemptId || s.attemptId === pred.buildAttemptId);
  if (current && (s.status === "error" || s.status === "done")) return { release: true, why: `"${title}" finished without landing a patch` };
  const since = toMillis(q.at);
  if (since != null && nowMs - since > QUEUE_MAX_WAIT_MS) return { release: true, why: `"${title}" has not settled in 3 hours` };
  return { release: false };
}

// ── 6. A dependency wait: still waiting, stuck behind a person, or a loop ───

const BLOCK_LABEL = {
  "needs-decision": "it needs a decision",
  "waiting-on-input": "it is waiting on an answer",
  "model-unavailable": "it needs Claude Opus",
};

// waiter:    a Backlog card with dependsOnItemIds and a dependency flag
// depsById:  its dependencies by id (null = deleted)
// depsOf:    id -> dependsOnItemIds, for the cycle check
// → { action: "wait" } | { action: "release", note } | { action: "stuck", note, stuckOn }
//   | { action: "unstuck" } | { action: "cycle", path }
function dependencyWaitPlan(waiter, depsById, depsOf) {
  const ids = uniq(waiter && waiter.dependsOnItemIds);
  const unmet = [];
  const gone = [];
  for (const id of ids) {
    const d = depsById[id];
    if (!d) { gone.push(`${id} (deleted)`); continue; }
    if (d.status === "archived") { gone.push(`"${titleOfItem(d)}" (archived)`); continue; }
    if ((d.status || "backlog") === "backlog") unmet.push({ id, ...d });
  }
  if (!unmet.length) {
    return { action: "release", note: gone.length ? `Released: ${gone.join("; ")} will not land, so this ticket no longer waits for ${gone.length === 1 ? "it" : "them"}.` : null };
  }
  const loop = findCycle(waiter.id, unmet.map((d) => d.id), depsOf);
  if (loop) return { action: "cycle", path: loop };
  const stuck = unmet.find((d) => d.blocked && d.blocked.reason && d.blocked.reason !== DEPENDENCY_REASON);
  if (stuck) {
    const why = BLOCK_LABEL[stuck.blocked.reason] || stuck.blocked.reason;
    const note = `Waiting for ${titleOfItem(stuck)}, which is blocked: ${why}. Settle that ticket and this one builds after it.`;
    if (waiter.blocked && waiter.blocked.note === note) return { action: "wait" };
    return { action: "stuck", note, stuckOn: { itemId: stuck.id, title: titleOfItem(stuck), reason: stuck.blocked.reason } };
  }
  if (waiter.blocked && waiter.blocked.stuckOn) return { action: "unstuck" };
  return { action: "wait" };
}

function cycleBlock(path, titleOf, nowIso = new Date().toISOString()) {
  return {
    reason: "waiting-on-input",
    note: `These tickets wait for each other, so neither can build: ${cycleMessage(path, titleOf)}. Which should build first? Remove the other from its "Builds after" list (Edit item) and both build in order. Answer on the card (Answer button)`,
    setBy: CYCLE_SETTER,
    setAt: nowIso,
  };
}

module.exports = {
  MAX_DEPENDENCIES, DEPENDENCY_REASON, BUILD_ORDER_SETTER, CYCLE_SETTER, DEPENDENCY_SOURCES, OPEN_STATUSES, SATISFIED_STATUSES, QUEUE_MAX_WAIT_MS, LANE_WIDTH,
  looksLikeItemId, dependencySection, findDependencyReferences, mergeDependsOn,
  findCycle, cycleMessage, validateDependsOn,
  laneKeysOf, lanesOf, laneOrder,
  planBuildOrder, buildOrderSummary, heldBlock, landedDependencies, builtOnBlock,
  queueReleasePlan, dependencyWaitPlan, cycleBlock, toMillis,
};
