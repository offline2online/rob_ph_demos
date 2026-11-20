"use strict";

// In-memory config store: tests, the local dev server and mock runs. Same
// contract as firestore-store.js (see README.md → "Adapters"):
//
//   store.transaction(async (tx) => …)   serialised; all-or-nothing
//     tx.get(collection, id)  -> data | null
//     tx.list(collection)     -> [{ id, ...data }]
//     tx.set(collection, id, data)
//     tx.delete(collection, id)
//   store.get(collection, id), store.list(collection, { orderBy, desc, limit })
//   store.newId()
//
// Reads inside a transaction must come before its writes (Firestore's rule);
// this adapter enforces that too, so a test catches the mistake before
// Firestore does.

const crypto = require("node:crypto");

function createMemoryStore() {
  const collections = new Map();
  let queue = Promise.resolve();

  const coll = (name) => {
    if (!collections.has(name)) collections.set(name, new Map());
    return collections.get(name);
  };
  const clone = (v) => (v === undefined || v === null ? null : structuredClone(v));

  function listNow(name, { orderBy, desc = false, limit } = {}) {
    let rows = [...coll(name).entries()].map(([id, data]) => ({ id, ...clone(data) }));
    if (orderBy) {
      rows.sort((a, b) => (a[orderBy] < b[orderBy] ? -1 : a[orderBy] > b[orderBy] ? 1 : 0));
      if (desc) rows.reverse();
    }
    if (limit) rows = rows.slice(0, limit);
    return rows;
  }

  async function transaction(fn) {
    const run = queue.then(async () => {
      const writes = [];
      const tx = {
        get: async (name, id) => {
          if (writes.length) throw new Error("memory-store: read after write in a transaction");
          return clone(coll(name).get(id));
        },
        list: async (name) => {
          if (writes.length) throw new Error("memory-store: read after write in a transaction");
          return listNow(name);
        },
        set: (name, id, data) => writes.push({ name, id, data: clone(data) }),
        delete: (name, id) => writes.push({ name, id, data: null }),
      };
      const result = await fn(tx);
      for (const w of writes) {
        if (w.data === null) coll(w.name).delete(w.id);
        else coll(w.name).set(w.id, w.data);
      }
      return result;
    });
    queue = run.catch(() => {});
    return run;
  }

  return {
    kind: "memory",
    transaction,
    get: async (name, id) => clone(coll(name).get(id)),
    list: async (name, opts) => listNow(name, opts),
    newId: () => crypto.randomBytes(10).toString("hex"),
    // For tests: everything, as plain data.
    dump: () => Object.fromEntries([...collections].map(([n, m]) => [n, Object.fromEntries([...m].map(([id, d]) => [id, clone(d)]))])),
  };
}

module.exports = { createMemoryStore };
