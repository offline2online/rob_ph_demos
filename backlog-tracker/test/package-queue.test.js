// Run with:  node test/package-queue.test.js
const assert = require("node:assert");
const { nextQueueStep, advancePackageQueue } = require("../functions/package-queue");

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
}
const q = (...ps) => ps.map(([id, itemIds, status]) => ({ id, name: id, itemIds, status }));
const bl = (id, extra = {}) => ({ id, status: "backlog", ...extra });

(async () => {
  await test("starts only the first queued batch", () => {
    const r = nextQueueStep(q(["p1", ["a", "b"], "queued"], ["p2", ["c"], "queued"]), { a: bl("a"), b: bl("b"), c: bl("c") }, 1000);
    assert.deepStrictEqual(r.fire, ["a", "b"]);
    assert.deepStrictEqual(r.queue.map((p) => p.status), ["running", "queued"]);
  });

  await test("waits while a ticket is still building", () => {
    const queue = q(["p1", ["a", "b"], "running"]); queue[0].startedAt = 1000;
    const r = nextQueueStep(queue, { a: { id: "a", status: "ready-for-testing" }, b: bl("b", { patchReady: true }) }, 2000);
    assert.strictEqual(r.fire, null);
    assert.strictEqual(r.queue[0].status, "running");
  });

  await test("a landed batch completes and the next one starts", () => {
    const queue = q(["p1", ["a"], "running"], ["p2", ["c"], "queued"]); queue[0].startedAt = 1000;
    const r = nextQueueStep(queue, { a: { id: "a", status: "ready-for-testing" }, c: bl("c") }, 5000);
    assert.deepStrictEqual(r.queue.map((p) => p.status), ["done", "running"]);
    assert.deepStrictEqual(r.fire, ["c"]);
  });

  await test("a failing batch does not block the rest", () => {
    const queue = q(["p1", ["a"], "running"], ["p2", ["c"], "queued"], ["p3", ["d"], "queued"]); queue[0].startedAt = 1000;
    const r = nextQueueStep(queue, { a: bl("a", { buildSession: { status: "error" } }), c: bl("c"), d: bl("d") }, 5000);
    assert.deepStrictEqual(r.queue.map((p) => p.status), ["failed", "running", "queued"]);
    assert.deepStrictEqual(r.fire, ["c"]);
  });

  await test("an empty or deleted batch fails and is skipped", () => {
    const r = nextQueueStep(q(["p1", ["gone"], "queued"], ["p2", ["c"], "queued"]), { c: bl("c") }, 1000);
    assert.deepStrictEqual(r.queue.map((p) => p.status), ["failed", "running"]);
  });

  await test("a batch that never reports times out", () => {
    const queue = q(["p1", ["a"], "running"]); queue[0].startedAt = 0;
    const r = nextQueueStep(queue, { a: bl("a") }, 46 * 60 * 1000);
    assert.strictEqual(r.queue[0].status, "failed");
  });

  await test("advancePackageQueue writes the queue and the notify request together", async () => {
    const writes = [];
    const docs = { "projects/P": { packageQueue: q(["p1", ["a"], "queued"]), packageQueueRequestedByEmail: "x@y.z" }, "backlogItems/a": bl("a") };
    const db = { collection: (c) => ({ doc: (id) => ({
      get: async () => ({ exists: !!docs[`${c}/${id}`], data: () => docs[`${c}/${id}`] }),
      set: async (v) => { writes.push([`${c}/${id}`, v]); },
    }) }) };
    const FieldValue = { serverTimestamp: () => "TS" };
    await advancePackageQueue(db, FieldValue, "P", 1000);
    const proj = writes.find((w) => w[0] === "projects/P")[1];
    assert.deepStrictEqual(proj.notifyItemIds, ["a"]);
    assert.strictEqual(proj.notifyRequestedAt, "TS");
    assert.strictEqual(proj.notifyRequestedByEmail, "x@y.z");
    assert.deepStrictEqual(writes.find((w) => w[0] === "backlogItems/a")[1], { packageId: "p1" });
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
})();
