"use strict";

// Firestore config store (our test environment, Firebase project
// rob-ph-demos). Everything lives under one top-level collection, the
// pharmacyScreen/ namespace, so it shares the database with the menu-board
// demo without touching its collections:
//
//   pharmacyScreen/config/pharmacies/{id}      admin only (rules: no client access)
//   pharmacyScreen/config/promotions/{id}      admin only
//   pharmacyScreen/config/templates/{id}       admin only (custom templates)
//   pharmacyScreen/config/services/{id}        admin only (service library)
//   pharmacyScreen/audit/entries/{id}          admin only (audit log)
//   pharmacyScreen/published/screens/{code}    public read (rules), the screen config
//
// Same contract as memory-store.js. An AWS deployment swaps this file for a
// DynamoDB (or other) adapter with the same five methods; the API does not
// change.

const crypto = require("node:crypto");

const PATHS = {
  pharmacies: ["config", "pharmacies"],
  promotions: ["config", "promotions"],
  templates: ["config", "templates"],
  services: ["config", "services"],
  audit: ["audit", "entries"],
  screens: ["published", "screens"],
};

function createFirestoreStore(db, { root = "pharmacyScreen" } = {}) {
  const ref = (name) => {
    const p = PATHS[name];
    if (!p) throw new Error(`firestore-store: unknown collection ${name}`);
    return db.collection(root).doc(p[0]).collection(p[1]);
  };
  const row = (snap) => ({ id: snap.id, ...snap.data() });

  async function transaction(fn) {
    return db.runTransaction(async (t) => {
      const writes = [];
      const tx = {
        get: async (name, id) => {
          if (writes.length) throw new Error("firestore-store: read after write in a transaction");
          const snap = await t.get(ref(name).doc(id));
          return snap.exists ? snap.data() : null;
        },
        list: async (name) => {
          if (writes.length) throw new Error("firestore-store: read after write in a transaction");
          const snap = await t.get(ref(name));
          return snap.docs.map(row);
        },
        set: (name, id, data) => writes.push({ name, id, data }),
        delete: (name, id) => writes.push({ name, id, data: null }),
      };
      const result = await fn(tx);
      for (const w of writes) {
        if (w.data === null) t.delete(ref(w.name).doc(w.id));
        else t.set(ref(w.name).doc(w.id), w.data);
      }
      return result;
    });
  }

  return {
    kind: "firestore",
    transaction,
    get: async (name, id) => {
      const snap = await ref(name).doc(id).get();
      return snap.exists ? snap.data() : null;
    },
    list: async (name, { orderBy, desc = false, limit } = {}) => {
      let q = ref(name);
      if (orderBy) q = q.orderBy(orderBy, desc ? "desc" : "asc");
      if (limit) q = q.limit(limit);
      const snap = await q.get();
      return snap.docs.map(row);
    },
    newId: () => crypto.randomBytes(10).toString("hex"),
  };
}

module.exports = { createFirestoreStore, PATHS };
