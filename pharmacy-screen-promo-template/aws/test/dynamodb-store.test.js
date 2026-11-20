"use strict";

// The DynamoDB adapters' own guarantees, beyond the config API suite
// (config-api-dynamodb.test.js): serialisable transactions under contention,
// read-before-write, large records, ordered audit paging, the 100-item limit,
// and the PH API settings store's atomic update. On the fake by default; on
// DynamoDB Local via test/dynamodb-local.integration.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createDynamoStore, INLINE_LIMIT } = require("../adapters/dynamodb-store");
const { createDynamoSettingsStore, createDynamoAuditLog } = require("../adapters/dynamodb-settings");
const { createFakeDynamo } = require("./fake-dynamodb");
const { localClient } = require("./test-store");

const local = !!process.env.DYNAMODB_ENDPOINT;
let sharedLocal = null;
function env() {
  const client = local ? (sharedLocal = sharedLocal || localClient()) : createFakeDynamo();
  const table = local ? process.env.DYNAMODB_TEST_TABLE : "fake";
  const root = `s${crypto.randomBytes(6).toString("hex")}`;
  return { client, table, root, store: createDynamoStore({ client, table, root, sleep: async () => {} }) };
}

test("dynamodb store: set, get, list, delete; ids are kept apart from data", async () => {
  const { store } = env();
  await store.transaction(async (tx) => {
    tx.set("promotions", "p1", { name: "Morning", promoId: "morning" });
    tx.set("promotions", "p2", { name: "Closed", promoId: "closed" });
  });
  assert.deepEqual(await store.get("promotions", "p1"), { name: "Morning", promoId: "morning" });
  assert.equal(await store.get("promotions", "nope"), null);
  assert.deepEqual((await store.list("promotions", { orderBy: "name" })).map((r) => r.id), ["p2", "p1"]);
  await store.transaction(async (tx) => tx.delete("promotions", "p1"));
  assert.deepEqual((await store.list("promotions")).map((r) => r.id), ["p2"]);
  assert.match(store.newId(), /^[0-9a-f]{20}$/);
});

test("dynamodb store: a read after a write in one transaction is refused", async () => {
  const { store } = env();
  await assert.rejects(
    store.transaction(async (tx) => {
      tx.set("services", "a", { label: "A" });
      await tx.list("services");
    }),
    /read after write/
  );
  assert.deepEqual(await store.list("services"), [], "nothing written");
});

test("dynamodb store: concurrent list-then-create cannot both claim one unique value", async () => {
  const { store } = env();
  // Ten writers each check "is store code X free?" and create it if so: exactly one may win.
  const claim = (n) =>
    store.transaction(async (tx) => {
      const rows = await tx.list("pharmacies");
      if (rows.some((r) => r.storeCode === "VIC-1")) return "taken";
      tx.set("pharmacies", `ph${n}`, { storeCode: "VIC-1", n });
      return "created";
    });
  const results = await Promise.all(Array.from({ length: 10 }, (_, n) => claim(n)));
  assert.equal(results.filter((r) => r === "created").length, 1, results.join(","));
  assert.equal((await store.list("pharmacies")).length, 1);
});

test("dynamodb store: concurrent read-modify-write of one record loses no update", async () => {
  const { store } = env();
  await store.transaction(async (tx) => tx.set("services", "counter", { n: 0 }));
  await Promise.all(Array.from({ length: 8 }, () =>
    store.transaction(async (tx) => {
      const cur = await tx.get("services", "counter");
      tx.set("services", "counter", { n: cur.n + 1 });
    })
  ));
  assert.deepEqual(await store.get("services", "counter"), { n: 8 });
});

test("dynamodb store: a record over the inline limit is stored compressed and reads back whole", async () => {
  const { store, client } = env();
  const big = { content: "x".repeat(INLINE_LIMIT + 1000), nested: { a: [1, 2, 3] } };
  await store.transaction(async (tx) => tx.set("pharmacies", "big", big));
  assert.deepEqual(await store.get("pharmacies", "big"), big);
  if (!local) {
    const item = [...client.items.values()].find((i) => i.sk.S === "big");
    assert.ok(item.docz && !item.doc, "gzip attribute, no inline doc");
  }
  // Shrinking it back swaps the attribute again.
  await store.transaction(async (tx) => tx.set("pharmacies", "big", { content: "small" }));
  assert.deepEqual(await store.get("pharmacies", "big"), { content: "small" });
});

test("dynamodb store: the audit log pages newest first by id without reading it all", async () => {
  const { store, client } = env();
  await store.transaction(async (tx) => {
    for (let i = 0; i < 30; i++) {
      const at = new Date(Date.UTC(2026, 10, 20, 0, 0, i)).toISOString();
      tx.set("audit", `${at.replace(/[^0-9]/g, "")}-${i}`, { at, i });
    }
  });
  const rows = await store.list("audit", { orderBy: "at", desc: true, limit: 5 });
  assert.deepEqual(rows.map((r) => r.i), [29, 28, 27, 26, 25]);
  if (!local) {
    const q = client.calls.filter((c) => c.name === "QueryCommand").pop();
    assert.equal(q.input.ScanIndexForward, false);
    assert.equal(q.input.Limit, 5);
  }
});

test("dynamodb store: more than 100 items in one change is refused before anything is written", async () => {
  const { store } = env();
  await assert.rejects(
    store.transaction(async (tx) => {
      for (let i = 0; i < 100; i++) tx.set("screens", `s${i}`, { i });
    }),
    (e) => e.code === "too-many-writes"
  );
  assert.deepEqual(await store.list("screens"), []);
});

test("dynamodb store: gives up with 'contention' after maxAttempts, writing nothing", async () => {
  const fake = createFakeDynamo();
  const store = createDynamoStore({ client: fake, table: "fake", root: "c", maxAttempts: 3, sleep: async () => {} });
  const other = createDynamoStore({ client: fake, table: "fake", root: "c" });
  let runs = 0;
  await assert.rejects(
    store.transaction(async (tx) => {
      runs++;
      await tx.list("promotions");
      // Someone else writes to the collection between our read and our commit, every time.
      await other.transaction(async (t2) => t2.set("promotions", `x${runs}`, { runs }));
      tx.set("promotions", "mine", { mine: true });
    }),
    (e) => e.code === "contention"
  );
  assert.equal(runs, 3);
  assert.equal(await store.get("promotions", "mine"), null);
});

test("dynamodb settings store: atomic update under concurrency; audit entries recorded", async () => {
  const { client, table, root } = env();
  const settings = createDynamoSettingsStore({ client, table, root });
  assert.equal(await settings.get(), null);
  await Promise.all(Array.from({ length: 6 }, (_, i) =>
    settings.update(async (cur) => ({ version: ((cur && cur.version) || 0) + 1, last: i }))
  ));
  assert.equal((await settings.get()).version, 6);
  const audit = createDynamoAuditLog({ client, table, root });
  await audit.record({ action: "ph-api-token.set", at: "2026-11-20T00:00:00.000Z", last4: "abcd" });
  if (!local) {
    const entry = [...client.items.values()].find((i) => i.pk.S === `${root}#private-audit`);
    assert.match(entry.sk.S, /^2026-11-20T00:00:00\.000Z-[0-9a-f]{12}$/);
    assert.deepEqual(JSON.parse(entry.doc.S), { action: "ph-api-token.set", at: "2026-11-20T00:00:00.000Z", last4: "abcd" });
  }
});
