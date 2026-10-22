// The Groom Backlog package queue: runs selected packages one batch at a time.
// Pure state logic (nextQueueStep) plus the Firestore wrapper (advancePackageQueue)
// that functions/index.js wires to project and card writes.
//
// projects/{id}.packageQueue is an array of
//   { id, name, itemIds, status: "queued"|"running"|"done"|"failed", startedAt, finishedAt, note }
// A batch is started by the same projects/{id}.notifyRequestedAt/notifyItemIds
// write the Ready for Dev button makes, so it takes the ordinary build path
// (one session per card, landing on the project's train). A failed batch is
// marked and the queue moves on to the next one.

const BATCH_TIMEOUT_MS = 45 * 60 * 1000;

function itemOutcome(item) {
  if (!item) return "gone";
  if (item.status && item.status !== "backlog") return "landed";
  if (item.patchReady) return "pending";
  const session = item.buildSession || {};
  if (session.status === "error") return "failed";
  if (item.blocked) return "failed";
  if (session.status === "done") return "failed";
  return "pending";
}

function batchOutcome(pkg, itemsById, nowMs) {
  const outcomes = pkg.itemIds.map((id) => itemOutcome(itemsById[id]));
  if (outcomes.some((o) => o === "pending")) {
    if (nowMs - (pkg.startedAt ?? nowMs) > BATCH_TIMEOUT_MS) return { done: true, ok: false, note: "Timed out waiting for the batch to build" };
    return { done: false };
  }
  const bad = outcomes.filter((o) => o === "failed").length;
  const landed = outcomes.filter((o) => o === "landed").length;
  if (bad) return { done: true, ok: false, note: `${bad} of ${pkg.itemIds.length} ticket(s) did not build` };
  if (!landed) return { done: true, ok: false, note: "Nothing left in Backlog to build" };
  return { done: true, ok: true, note: null };
}

// Returns { queue, fire } — fire is the item ids to build now, or null.
function nextQueueStep(queue, itemsById, nowMs) {
  const next = (queue || []).map((p) => ({ ...p }));
  let fire = null;
  for (;;) {
    const running = next.find((p) => p.status === "running");
    if (running) {
      const out = batchOutcome(running, itemsById, nowMs);
      if (!out.done) break;
      running.status = out.ok ? "done" : "failed";
      running.finishedAt = nowMs;
      running.note = out.note;
      continue; // a failure never blocks the batches behind it
    }
    const queued = next.find((p) => p.status === "queued");
    if (!queued) break;
    const buildable = queued.itemIds.filter((id) => itemsById[id] && itemsById[id].status === "backlog" && !itemsById[id].patchReady && !itemsById[id].blocked);
    if (!buildable.length) {
      queued.status = "failed"; queued.finishedAt = nowMs; queued.note = "Nothing left in Backlog to build";
      continue;
    }
    queued.status = "running"; queued.startedAt = nowMs; queued.buildIds = buildable;
    fire = buildable;
    break;
  }
  return { queue: next, fire };
}

function sameQueue(a, b) {
  return JSON.stringify(a || []) === JSON.stringify(b || []);
}

async function advancePackageQueue(db, FieldValue, projectId, nowMs = Date.now()) {
  const projectRef = db.collection("projects").doc(projectId);
  const snap = await projectRef.get();
  const project = snap.exists ? snap.data() : null;
  if (!project || !Array.isArray(project.packageQueue) || !project.packageQueue.length) return null;
  const ids = [...new Set(project.packageQueue.flatMap((p) => (p.status === "queued" || p.status === "running" ? p.itemIds : [])))];
  const itemsById = {};
  for (const id of ids) {
    const s = await db.collection("backlogItems").doc(id).get();
    if (s.exists) itemsById[id] = { id, ...s.data() };
  }
  const { queue, fire } = nextQueueStep(project.packageQueue, itemsById, nowMs);
  if (sameQueue(queue, project.packageQueue) && !fire) return null;
  const update = { packageQueue: queue };
  if (fire) {
    update.notifyRequestedAt = FieldValue.serverTimestamp();
    update.notifyItemIds = fire;
    update.notifyRequestedByEmail = project.packageQueueRequestedByEmail || null;
    const running = queue.find((p) => p.status === "running");
    await Promise.all(fire.map((id) => db.collection("backlogItems").doc(id).set({ packageId: running.id }, { merge: true })));
  }
  await projectRef.set(update, { merge: true });
  return { queue, fire };
}

module.exports = { nextQueueStep, advancePackageQueue, itemOutcome, BATCH_TIMEOUT_MS };
