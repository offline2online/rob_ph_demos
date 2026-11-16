// One status line per card and per train (ticket RC6wVNJJcPjNTR5hov9W,
// "Flow 7/9", 14 Nov 2026 board flow review).
//
// The board held most of what a person needs about a stuck ticket, but as
// separate chips, in notes, or not at all: how long a card had been in its
// column, a fire being retried, a rebuild waiting for the release, why Deploy
// to Main was missing. Agents then explained it after the fact ("Stuck on a
// stale flag, not a code problem"). This module answers it once, in one
// place, for the board (public/js/app.js), the MCP server
// (functions/mcp-server.js → get_pipeline_health, list_backlog_items) and the
// automation (train stuck clock):
//
//   cardState(item, project, now, ctx)  → {state, line, waitingOn, since, warn, ageMs, action}
//   trainState(project, items, now)     → the same shape for the project's train
//   trainStuckReason(project, items)    → why the train is stuck, or null
//   needsAttention(items, projects, now) → everything waiting on a person or
//                                          past its threshold, oldest first
//
// waitingOn is one of WAITING_ON. Every status × flag combination maps to
// exactly one line (test/card-state.test.mjs enumerates them). A field a
// newer ticket adds and an older card lacks is simply absent: every rule
// here reads defensively, so a card from before statusEnteredAt, testRound or
// buildSession still gets a line.
//
// Plain ESM with no imports, no DOM and no Firebase. functions/card-state.js
// is its generated CommonJS copy (strip `export `, keep the module.exports
// line); test/card-state.test.mjs fails if the two drift.

// How often the automation answers or retries a waiting-on-input flag by
// itself (scripts/run-backlog-automation.js → autoAnswerPlan reads these):
// the first AUTO_ANSWERS straight away, then AUTO_RETRIES more with a growing
// gap; a build that never ran gets NEVER_RAN_RETRIES.
// `retries` are the senior model's tries (Advanced, Claude Opus): after two
// automatic answers the ticket goes to it to make the call, and only when it
// could not does a question reach a person (Rob, 16 Nov 2026).
export const AUTO_ANSWER_LIMITS = { answers: 2, retries: 2, neverRan: 12 };
// "retrying": the automation will act on this flag itself. "used-up": it was
// the automation's to act on and its tries are spent. null: a person's flag
// (set by an email address) or one the automation does not answer.
export function selfAnswering(it) {
  const b = it && it.blocked;
  if (!b || b.reason !== "waiting-on-input") return null;
  if (typeof b.setBy === "string" && b.setBy.includes("@")) return null;
  if (Array.isArray(it.dependsOnItemIds) && it.dependsOnItemIds.length) return null;
  if (b.kind === "never-ran") return (Number(it.neverRanRetries) || 0) < AUTO_ANSWER_LIMITS.neverRan ? "retrying" : "used-up";
  if ((Number(it.autoAnswers) || 0) < AUTO_ANSWER_LIMITS.answers) return "retrying";
  return (Number(it.autoRetries) || 0) < AUTO_ANSWER_LIMITS.retries ? "retrying" : "used-up";
}
export function autoTriesUsed(it) {
  const b = (it && it.blocked) || {};
  return b.kind === "never-ran" ? (Number(it.neverRanRetries) || 0) : (Number(it.autoAnswers) || 0) + (Number(it.autoRetries) || 0);
}

// The one question a person is asked once the automatic tries are used up:
// a sentence and two to four choices to click, the recommended one first.
// The senior model's own question (blocked.question / blocked.options) when
// it left a usable one; otherwise the standard choice. Each option:
// { label, recommended, noBuild } — `noBuild` leaves the ticket in Backlog unbuilt.
export const PARK_OPTION = "Park it: leave it in Backlog and stop trying";
export function personQuestion(it) {
  const b = (it && it.blocked) || {};
  const clean = (s, max) => String(s || "").replace(/\s+/g, " ").trim().slice(0, max);
  const raw = Array.isArray(b.options) ? b.options : [];
  const labels = [];
  let recommended = -1;
  for (const o of raw) {
    const label = clean(o && typeof o === "object" ? o.label : o, 120);
    if (!label || labels.includes(label)) continue;
    if (o && typeof o === "object" && o.recommended && recommended < 0) recommended = labels.length;
    labels.push(label);
    if (labels.length === 4) break;
  }
  const question = clean(b.question, 240);
  if (question && labels.length >= 2) {
    const rec = recommended < 0 ? 0 : recommended;
    const ordered = [labels[rec], ...labels.filter((_, i) => i !== rec)];
    return { question, options: ordered.map((label, i) => ({ label, recommended: i === 0, noBuild: false })), fromBuild: true };
  }
  const used = autoTriesUsed(it);
  const why = clean(String(b.note || "").split("\n")[0], 200);
  return {
    question: `This ticket was built ${used} time${used === 1 ? "" : "s"}, the last on the senior model, and did not get through${why ? `: ${why}` : "."} What should happen to it?`,
    options: [
      { label: "Try again on the senior model", recommended: true, noBuild: false },
      { label: PARK_OPTION, recommended: false, noBuild: true },
    ],
    fromBuild: false,
  };
}

export const WAITING_ON = ["nobody", "tester", "approver", "decision", "automation", "another ticket", "another project"];

const HOUR = 60 * 60 * 1000;
// When a quiet age turns into a warning. One table, read by the card chip,
// the Needs attention strip and the MCP tool alike.
export const AGE_THRESHOLDS = {
  "backlog-blocked": 24 * HOUR,   // a person has been asked something
  "building": 2 * HOUR,           // a build session has been running
  "ready-for-testing": 24 * HOUR, // nobody has tested it
  "ready-to-publish": 12 * HOUR,  // approved, nobody has deployed it
};
// How long a train may sit in a stuck state before it is escalated once.
export const TRAIN_STUCK_THRESHOLDS = {
  "conflict": 2 * HOUR,
  "awaiting-human-merge": 2 * HOUR,
  "tests-red-no-culprit": 2 * HOUR,
  "revert-blocked": 2 * HOUR,
  "locked-unapproved": 12 * HOUR,
};
export const TRAIN_STUCK_LABELS = {
  "conflict": "Deploy stopped on a merge conflict",
  "awaiting-human-merge": "Train PR waits for a person to merge it on GitHub",
  "tests-red-no-culprit": "Train tests failing and no ticket is pinned as the cause",
  "revert-blocked": "A revert off the branch is blocked by a later ticket",
  "locked-unapproved": "Release locked with a ticket still not approved",
};

export function toMillis(v) {
  if (!v) return 0;
  if (typeof v === "number") return v;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (v instanceof Date) return v.getTime();
  if (typeof v === "object" && typeof v.seconds === "number") return v.seconds * 1000;
  if (typeof v === "object" && typeof v._seconds === "number") return v._seconds * 1000;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : 0;
}

// "just now", "12 min", "2 h", "3 d".
export function ageLabel(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

// When the card entered its column: statusEnteredAt, else updatedAt (cards
// from before the stamp; the backfill copies the same value), else createdAt.
export function statusEnteredMs(item) {
  return toMillis(item && item.statusEnteredAt) || toMillis(item && item.updatedAt) || toMillis(item && item.createdAt);
}

function titleOf(ctx, id, fallback) {
  if (!id) return fallback || "another ticket";
  const it = ctx && ctx.itemsById ? ctx.itemsById[id] : null;
  return (it && it.title) || fallback || "another ticket";
}

const ON_TRAIN = new Set(["ready-for-testing", "ready-to-publish"]);
export function onTrain(item) {
  return !!item && !!item.deployCommit && ON_TRAIN.has(item.status);
}

// Heartbeat of the attempt being waited for (buildSession.attemptId must
// match the card's buildAttemptId), or null.
function heartbeat(item, now) {
  const bs = item.buildSession;
  const attempt = item.buildAttemptId || (item.lastFire && item.lastFire.buildAttemptId);
  if (!bs || !attempt || bs.attemptId !== attempt) return null;
  const at = Math.min(toMillis(bs.heartbeatAt), now);
  if (!at) return null;
  const phase = typeof bs.phase === "string" && bs.phase.trim() ? bs.phase.trim().slice(0, 40) : "";
  return { at, phase };
}

// Has a build been started for this card and not reported back?
function building(item) {
  const fire = item.lastFire;
  if (!fire || fire.status !== "started") return false;
  const fired = toMillis(fire.at);
  const bs = item.buildSession;
  if (bs && (bs.status === "done" || bs.status === "error") && (toMillis(bs.reportedAt) || toMillis(bs.finishedAt)) >= fired) return false;
  return true;
}

function result(state, line, waitingOn, since, now, opts = {}) {
  const sinceMs = since || 0;
  const ageMs = sinceMs ? Math.max(0, now - sinceMs) : 0;
  const threshold = opts.threshold ? AGE_THRESHOLDS[opts.threshold] : 0;
  return {
    state, line, waitingOn,
    since: sinceMs ? new Date(sinceMs).toISOString() : null,
    ageMs,
    warn: !!(threshold && sinceMs && ageMs >= threshold),
    action: opts.action || "open",
  };
}

// The card's single status line. ctx: { itemsById, projectsById } for titles
// and siblings (optional; a missing title reads "another ticket").
export function cardState(item, project, now = Date.now(), ctx = {}) {
  const it = item || {};
  const p = project || {};
  const status = it.status || "backlog";
  const entered = statusEnteredMs(it);
  const age = (ms) => (ms ? ` · ${ageLabel(now - ms)}` : "");

  if (status === "archived") return result("archived", "Archived", "nobody", toMillis(it.archivedAt) || entered, now);

  if (status === "published-live") {
    if (it.revertReady) return result("reverting", "Reverting · revert PR being opened", "automation", entered, now);
    const c = it.deployConclusion;
    if (it.mergeCommit && (c === "pending" || (!c && it.deployRunUrl))) return result("live-deploying", "Live · deploy running", "automation", entered, now);
    if (c === "success") return result("live", "Live · deploy checked", "nobody", entered, now);
    if (c && c !== "pending") return result("live-deploy-failed", `Live · deploy ${c}`, "decision", entered, now, { action: "open" });
    return result("live", "Live", "nobody", entered, now);
  }

  if (status === "ready-to-publish") {
    if (it.mergeReady) return result("deploying", "Deploying · merge in progress", "automation", entered, now);
    const ts = p.trainStatus;
    const held = ts === "deploying" || ts === "awaiting-human-merge" || p.trainReady === true;
    if (held) {
      const heldSince = toMillis(p.trainStuckSince) || toMillis(p.trainHoldSince) || toMillis(p.deployNotifyRequestedAt) || entered;
      if (ts === "awaiting-human-merge") return result("awaiting-human-merge", `Deploying · waits for a person to merge the PR${age(heldSince)}`, "decision", heldSince, now);
      if (p.trainHold === "queued") return result("deploy-queued", `Queued behind ${queuedBehindName(p)}`, "another project", heldSince, now);
      if (p.trainHold === "tests-red") return result("deploy-tests-red", `Deploying · tests failing${age(heldSince)}`, "decision", heldSince, now);
      if (p.trainHold === "tests-running") return result("deploy-tests-running", `Deploying · tests running ${ageLabel(now - heldSince)}`, "automation", heldSince, now);
      return result("deploying", `Deploying${age(heldSince)}`, "automation", heldSince, now);
    }
    if (ts === "conflict") return result("deploy-conflict", "Deploy blocked · merge conflict", "decision", toMillis(p.trainStuckSince) || entered, now, { action: "deploy" });
    const gate = deployGate(p, ctx.projectItems || projectItemsFrom(ctx, p.id), ctx);
    if (gate && gate.kind === "testing") return result("approved-waiting", `Approved · waits for ${gate.title} to be approved`, "another ticket", entered, now, { threshold: "ready-to-publish" });
    if (gate && gate.kind === "revert") return result("approved-waiting", `Approved · waits for the revert of ${gate.title}`, "another ticket", entered, now, { threshold: "ready-to-publish" });
    if (gate && gate.kind === "tests-red") return result("approved-tests-red", `Approved · train tests failing${age(entered)}`, "decision", entered, now, { threshold: "ready-to-publish" });
    return result("approved", `Approved · ready for Deploy to Main${age(entered)}`, "approver", entered, now, { threshold: "ready-to-publish", action: "deploy" });
  }

  if (status === "ready-for-testing") {
    const round = Number(it.testRound) || 0;
    const r = round >= 2 ? ` · round ${round}` : "";
    return result("testing", `Ready to test${r}${age(entered)}`, "tester", entered, now, { threshold: "ready-for-testing", action: "test" });
  }

  // Backlog.
  if (it.revertRequested) {
    const by = Array.isArray(it.revertBlockedBy) ? it.revertBlockedBy : [];
    if (by.length) {
      const first = titleOf(ctx, revertBlockerId(by[0], ctx), revertBlockerTitle(by[0]));
      return result("revert-blocked", `Being taken off the release · blocked by ${first}${by.length > 1 ? ` +${by.length - 1}` : ""}`, "another ticket", entered, now, { threshold: "backlog-blocked" });
    }
    return result("reverting", "Being taken off the release", "automation", entered, now);
  }
  const blocked = it.blocked && it.blocked.reason ? it.blocked : null;
  if (blocked) {
    const since = toMillis(blocked.setAt) || entered;
    if (blocked.reason === "waiting-on-dependency") {
      const ids = Array.isArray(it.dependsOnItemIds) ? it.dependsOnItemIds : [];
      const pending = ids.filter((id) => { const d = ctx.itemsById && ctx.itemsById[id]; return !d || (d.status || "backlog") === "backlog"; });
      const first = pending[0] || ids[0];
      const name = first ? titleOf(ctx, first) : String(blocked.note || "other tickets").replace(/^Waiting for:\s*/i, "").split(". ")[0];
      const stuck = blocked.stuckOn && blocked.stuckOn.itemId;
      if (stuck) return result("dependency-stuck", `Waiting for ${name}, which is blocked${age(since)}`, "another ticket", since, now, { threshold: "backlog-blocked" });
      return result("waiting-dependency", `Waiting for ${name} to land`, "another ticket", since, now);
    }
    if (blocked.reason === "needs-decision") return result("needs-decision", `Needs your decision${age(since)}`, "decision", since, now, { threshold: "backlog-blocked", action: "answer" });
    if (blocked.reason === "model-unavailable") return result("model-unavailable", `Not built: needs Opus${age(since)}`, "decision", since, now, { threshold: "backlog-blocked" });
    // Required tools (Flow 8/9): the session lacked a connector the project
    // needs. A person adds it (or a project Routine) and clears the flag.
    if (blocked.reason === "tools-unavailable") {
      const missing = Array.isArray(blocked.missing) && blocked.missing.length ? blocked.missing.join(", ") : "";
      return result("tools-unavailable", `${missing ? `Not built: this session has no ${missing}` : "Not built: a tool this project needs is missing"}${age(since)}`, "decision", since, now, { threshold: "backlog-blocked" });
    }
    // A flag the pipeline raised and answers itself is not a question for a
    // person (16 Nov 2026: "Waiting for your answer" on a card whose note
    // said "Nothing to answer"). It waits on the automation, with no Answer
    // prompt, until the automatic tries are used up; then it says so plainly.
    const self = selfAnswering(it);
    if (self === "retrying") {
      const senior = (Number(it.autoAnswers) || 0) >= AUTO_ANSWER_LIMITS.answers;
      const line = blocked.kind === "never-ran" ? "Build did not start · tried again by itself" : senior ? "With the senior model to make the call · nothing to answer" : "Being rebuilt by itself · nothing to answer";
      return result("auto-retry", line, "automation", since, now);
    }
    if (self === "used-up") return result("auto-stopped", `Needs your pick: one question, options to click${age(since)}`, "decision", since, now, { threshold: "backlog-blocked", action: "answer" });
    return result("waiting-input", `Waiting for your answer${age(since)}`, "decision", since, now, { threshold: "backlog-blocked", action: "answer" });
  }
  if (it.patchReady && it.buildAfterTrain) return result("held-patch", "Built · joins the next release", "automation", entered, now);
  if (it.patchReady) return result("landing", "Built · landing on the train", "automation", toMillis(it.updatedAt) || entered, now);
  if (it.buildAfterTrain) return result("rebuild-after-train", "Rebuild waits for this release to merge", "automation", entered, now);
  if (it.queuedAfter && it.queuedAfter.itemId) return result("queued", `Queued: builds after ${titleOf(ctx, it.queuedAfter.itemId, it.queuedAfter.title)}`, "another ticket", entered, now);
  if (building(it)) {
    const fired = toMillis(it.lastFire.at);
    const hb = heartbeat(it, now);
    if (hb) return result("building", `Building · ${hb.phase || "working"} · heard from ${ageLabel(now - hb.at) === "just now" ? "just now" : `${ageLabel(now - hb.at)} ago`}`, "automation", fired || hb.at, now, { threshold: "building" });
    return result("building", `Building · starting${age(fired)}`, "automation", fired, now, { threshold: "building" });
  }
  const fire = it.lastFire;
  if (fire && fire.status === "retrying") {
    const tries = Number(fire.attempts) || 1;
    return result("fire-retrying", `Build start retrying · try ${tries + 1}`, "automation", toMillis(fire.at) || entered, now);
  }
  if (fire && fire.status === "failed" && toMillis(fire.at) >= entered) return result("fire-failed", "Build could not start · Ready for Dev to try again", "decision", toMillis(fire.at), now);
  const deps = Array.isArray(it.dependsOnItemIds) ? it.dependsOnItemIds : [];
  const unmet = deps.filter((id) => { const d = ctx.itemsById && ctx.itemsById[id]; return d && (d.status || "backlog") === "backlog"; });
  if (unmet.length) return result("after-dependency", `Builds after ${titleOf(ctx, unmet[0])}`, "another ticket", entered, now);
  if (it.buildSession && it.buildSession.status === "error" && toMillis(it.buildSession.reportedAt || it.buildSession.finishedAt) >= entered) {
    return result("build-errored", "Last build stopped · Ready for Dev to try again", "nobody", entered, now);
  }
  return result("backlog", "In Backlog · not started", "nobody", entered, now);
}

function queuedBehindName(p) {
  const m = /^Queued behind (.+?)'s deploy/.exec(String(p.trainNote || ""));
  return m ? `${m[1]}'s deploy` : "another project's deploy";
}

// revertBlockedBy entries are titles or "id: title" strings depending on the
// writer; take whichever is there.
function revertBlockerId(entry, ctx) {
  const s = String(entry || "");
  return ctx.itemsById && ctx.itemsById[s] ? s : null;
}
function revertBlockerTitle(entry) {
  const s = String(entry || "").trim();
  return s || "a later ticket";
}

function projectItemsFrom(ctx, projectId) {
  if (!ctx || !ctx.itemsById) return [];
  return Object.values(ctx.itemsById).filter((i) => i && i.projectId === projectId);
}

// Why Deploy to Main is not offered for an otherwise approvable train, or
// null. {kind: "testing"|"revert"|"tests-red"|"queued"|"conflict"|"deploying"|"empty", title, line}
export function deployGate(project, items, ctx = {}) {
  const p = project || {};
  const list = (items || []).filter((i) => i && (!p.id || !i.projectId || i.projectId === p.id));
  const reverting = list.filter((i) => (i.status || "backlog") === "backlog" && i.revertRequested);
  const train = list.filter(onTrain);
  const testing = train.filter((i) => i.status === "ready-for-testing");
  const approved = train.filter((i) => i.status === "ready-to-publish");
  if (p.trainHold === "queued") return { kind: "queued", title: queuedBehindName(p), line: `Queued behind ${queuedBehindName(p)}` };
  const red = Object.keys(p.trainTestsRed || {});
  const redGate = () => {
    const fixer = redCulprit(p, list);
    return { kind: "tests-red", title: red.join(", "), line: `Tests failing: ${red.join(" and ")} — ${fixer ? `${fixer.title} is being sent back` : "nobody is pinned as the cause yet"}` };
  };
  if (p.trainHold === "tests-red" && red.length) return redGate();
  if (p.trainStatus === "deploying" || p.trainStatus === "awaiting-human-merge") return { kind: "deploying", title: "", line: "" };
  if (reverting.length) {
    const t = reverting[0].title || "a ticket";
    return { kind: "revert", title: t, line: `Deploy to Main appears when the revert of ${t} finishes` };
  }
  if (!approved.length) return testing.length ? { kind: "empty", title: "", line: "" } : null;
  if (testing.length) {
    const t = testing[0].title || "a ticket";
    return { kind: "testing", title: t, line: `Deploy to Main appears when ${t} is approved or sent back${testing.length > 1 ? ` (and ${testing.length - 1} more)` : ""}` };
  }
  if (red.length) return redGate();
  return null;
}

// The ticket a red train names as its cause: a train card whose own test
// record failed on the commit it is on. null when none can be pinned.
function redCulprit(p, items) {
  return (items || []).find((i) => onTrain(i) && i.trainTest && i.trainTest.state === "failed" && i.trainTest.sha === i.deployCommit) || null;
}

// Why this project's train is stuck — one of TRAIN_STUCK_THRESHOLDS' keys —
// or null. The five states the 14 Nov review found had no clock and no alert.
export function trainStuckReason(project, items) {
  const p = project || {};
  const list = (items || []).filter((i) => i && (!p.id || !i.projectId || i.projectId === p.id));
  if (p.trainStatus === "conflict") return "conflict";
  if (p.trainStatus === "awaiting-human-merge") return "awaiting-human-merge";
  const red = p.trainHold === "tests-red" || Object.keys(p.trainTestsRed || {}).length > 0;
  if (red && !redCulprit(p, list)) return "tests-red-no-culprit";
  if (list.some((i) => (i.status || "backlog") === "backlog" && i.revertRequested && Array.isArray(i.revertBlockedBy) && i.revertBlockedBy.length)) return "revert-blocked";
  if (p.trainLocked) {
    const train = list.filter(onTrain);
    if (train.some((i) => i.status === "ready-to-publish") && train.some((i) => i.status === "ready-for-testing")) return "locked-unapproved";
  }
  return null;
}

// What projects/{id} should gain so trainStuckSince tracks the stuck state:
// a patch of {trainStuckSince, trainStuckReason, trainStuckEscalatedAt}, or
// null for "no change". Escalated once per spell, after the reason's
// threshold; cleared when the state ends. Pure: the automation writes it.
export function trainStuckPatch(project, items, now = Date.now()) {
  const p = project || {};
  const reason = trainStuckReason(p, items);
  const since = toMillis(p.trainStuckSince);
  if (!reason) {
    if (!since && !p.trainStuckReason && !p.trainStuckEscalatedAt) return null;
    return { trainStuckSince: null, trainStuckReason: null, trainStuckEscalatedAt: null };
  }
  if (!since || p.trainStuckReason !== reason) {
    return { trainStuckSince: new Date(now).toISOString(), trainStuckReason: reason, trainStuckEscalatedAt: null };
  }
  if (!p.trainStuckEscalatedAt && now - since >= TRAIN_STUCK_THRESHOLDS[reason]) {
    return { trainStuckEscalatedAt: new Date(now).toISOString() };
  }
  return null;
}

// The project's train in one line, the same shape as cardState.
export function trainState(project, items, now = Date.now(), ctx = {}) {
  const p = project || {};
  const list = (items || []).filter((i) => i && (!p.id || !i.projectId || i.projectId === p.id));
  const train = list.filter(onTrain);
  const reason = trainStuckReason(p, list);
  const stuckSince = toMillis(p.trainStuckSince);
  const since = (reason && p.trainStuckReason === reason && stuckSince) || 0;
  const threshold = reason ? TRAIN_STUCK_THRESHOLDS[reason] : 0;
  const out = (state, line, waitingOn, s, action = "open") => {
    const ageMs = s ? Math.max(0, now - s) : 0;
    return { state, line, waitingOn, since: s ? new Date(s).toISOString() : null, ageMs, warn: !!(threshold && s && ageMs >= threshold), action, stuckReason: reason, escalated: !!p.trainStuckEscalatedAt };
  };
  const age = (s) => (s ? ` · ${ageLabel(now - s)}` : "");
  if (reason === "conflict") return out("conflict", `Deploy blocked · merge conflict${age(since)}`, "decision", since, "deploy");
  if (reason === "awaiting-human-merge") return out("awaiting-human-merge", `Train PR waits for a person to merge it${age(since)}`, "decision", since);
  if (p.trainHold === "queued") return out("queued", `Queued behind ${queuedBehindName(p)}`, "another project", toMillis(p.updatedAt));
  if (p.trainStatus === "deploying" || p.trainReady === true) {
    if (p.trainHold === "tests-running") return out("deploying", "Deploying · tests running", "automation", 0);
    if (reason === "tests-red-no-culprit") return out("tests-red", `Deploying · tests failing, no ticket pinned${age(since)}`, "decision", since);
    if (p.trainHold === "tests-red") return out("tests-red", "Deploying · tests failing · the failing ticket is being sent back", "automation", 0);
    return out("deploying", "Deploying", "automation", 0);
  }
  if (reason === "tests-red-no-culprit") return out("tests-red", `Train tests failing · no ticket pinned${age(since)}`, "decision", since);
  if (reason === "revert-blocked") {
    const t = list.find((i) => (i.status || "backlog") === "backlog" && i.revertRequested && (i.revertBlockedBy || []).length);
    return out("revert-blocked", `Revert of ${(t && t.title) || "a ticket"} blocked by a later ticket${age(since)}`, "decision", since);
  }
  if (!train.length) return out("idle", "No release on the train", "nobody", 0);
  const gate = deployGate(p, list, ctx);
  if (reason === "locked-unapproved") return out("locked-unapproved", `Release locked · ${gate && gate.title ? `${gate.title} not approved yet` : "a ticket not approved yet"}${age(since)}`, "tester", since, "test");
  if (gate && gate.line) return out("waiting", gate.line, gate.kind === "tests-red" ? "decision" : (gate.kind === "queued" ? "another project" : "tester"), 0, gate.kind === "testing" ? "test" : "open");
  if (train.every((i) => i.status === "ready-to-publish")) return out("approved", `Approved · ${train.length} ticket${train.length === 1 ? "" : "s"} ready for Deploy to Main`, "approver", 0, "deploy");
  return out("testing", `${train.length} ticket${train.length === 1 ? "" : "s"} on the train · testing`, "tester", 0, "test");
}

const PERSON = new Set(["tester", "approver", "decision"]);

// Everything waiting on a person or stuck past its threshold, across
// projects, oldest first. Entries:
// {kind: "ticket"|"train", id, projectId, projectName, title, line, waitingOn,
//  since, ageMs, warn, action, createdByEmail}
export function needsAttention(items, projects, now = Date.now()) {
  const list = (items || []).filter(Boolean);
  const itemsById = Object.fromEntries(list.map((i) => [i.id, i]));
  const byProject = {};
  for (const i of list) (byProject[i.projectId] = byProject[i.projectId] || []).push(i);
  const projById = Object.fromEntries((projects || []).filter(Boolean).map((p) => [p.id, p]));
  const out = [];
  for (const i of list) {
    if (!i.status || i.status === "archived") continue;
    const p = projById[i.projectId] || { id: i.projectId };
    const s = cardState(i, p, now, { itemsById, projectItems: byProject[i.projectId] || [] });
    if (!(PERSON.has(s.waitingOn) || s.warn)) continue;
    if (s.state === "live" || s.state === "backlog") continue;
    out.push({ kind: "ticket", id: i.id, projectId: i.projectId || null, projectName: p.name || "", title: i.title || "", line: s.line, waitingOn: s.waitingOn, since: s.since, ageMs: s.ageMs, warn: s.warn, action: s.action, createdByEmail: i.createdByEmail || null, state: s.state });
  }
  for (const p of projects || []) {
    if (!p) continue;
    const t = trainState(p, byProject[p.id] || [], now, { itemsById });
    if (!t.stuckReason) continue;
    if (!(t.warn || t.escalated)) continue;
    out.push({ kind: "train", id: p.id, projectId: p.id, projectName: p.name || "", title: `${p.name || "Project"} train`, line: `${TRAIN_STUCK_LABELS[t.stuckReason]} · ${t.line}`, waitingOn: t.waitingOn, since: t.since, ageMs: t.ageMs, warn: true, action: t.action, createdByEmail: null, state: t.state, escalated: t.escalated });
  }
  out.sort((a, b) => (b.ageMs - a.ageMs) || String(a.id).localeCompare(String(b.id)));
  return out;
}

// "Waiting on me": the signed-in member created the card, was asked about it
// (it waits on a decision and they filed it), or can approve (tester and
// approver waits, for a member who may approve).
export function waitingOnMe(entry, viewer) {
  if (!entry || !viewer) return false;
  const email = String(viewer.email || "").toLowerCase();
  const mine = !!email && String(entry.createdByEmail || "").toLowerCase() === email;
  if (mine && PERSON.has(entry.waitingOn)) return true;
  if (viewer.canApprove && (entry.waitingOn === "tester" || entry.waitingOn === "approver")) return true;
  if (viewer.canApprove && entry.kind === "train" && PERSON.has(entry.waitingOn)) return true;
  return false;
}

// The patch a status change should carry: statusEnteredAt when status moved,
// nothing otherwise. Used by the Cloud Function that stamps every writer.
export function statusEnteredPatch(before, after, nowIso) {
  const b = before && before.status;
  const a = after && after.status;
  if (!a || a === b) return null;
  const stamped = after.statusEnteredAt;
  // A writer that stamped it itself in the same write needs nothing more.
  if (stamped && (!before || String(toMillis(stamped)) !== String(toMillis(before.statusEnteredAt)))) return null;
  return { statusEnteredAt: nowIso };
}
