"use strict";
// Storage adapters for the PH API settings document and the audit log.
//
// Settings store:  get() -> doc | null;  update(fn) -> new doc, where fn(current)
//                  returns the next doc. update is atomic (a transaction on
//                  Firestore) so two admins saving at once cannot interleave.
// Audit log:       record(entry) -> void. Entries never contain the token.
//
// Firestore implementations are for our Firebase test environment; an AWS
// deployment provides the same two objects over DynamoDB (or its own store).

function memorySettingsStore(initial = null) {
  let doc = initial ? JSON.parse(JSON.stringify(initial)) : null;
  return {
    async get() {
      return doc ? JSON.parse(JSON.stringify(doc)) : null;
    },
    async update(fn) {
      const next = await fn(doc ? JSON.parse(JSON.stringify(doc)) : null);
      doc = JSON.parse(JSON.stringify(next));
      return JSON.parse(JSON.stringify(doc));
    },
    // Test helper: what is physically stored.
    raw() {
      return doc;
    },
  };
}

function memoryAuditLog() {
  const entries = [];
  return {
    async record(entry) {
      entries.push(JSON.parse(JSON.stringify(entry)));
    },
    entries,
  };
}

function firestoreSettingsStore({ db, docPath }) {
  const ref = db.doc(docPath);
  return {
    async get() {
      const snap = await ref.get();
      return snap.exists ? snap.data() : null;
    },
    async update(fn) {
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const next = await fn(snap.exists ? snap.data() : null);
        tx.set(ref, next);
        return next;
      });
    },
  };
}

function firestoreAuditLog({ db, collectionPath }) {
  const col = db.collection(collectionPath);
  return {
    async record(entry) {
      await col.add(entry);
    },
  };
}

module.exports = { memorySettingsStore, memoryAuditLog, firestoreSettingsStore, firestoreAuditLog };
