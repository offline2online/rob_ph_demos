"use strict";

// The Firestore adapter behind the real API, against the Firestore emulator
// (npm run test:emulator sets FIRESTORE_EMULATOR_HOST). Checks the paths
// under pharmacyScreen/, transactional uniqueness and the template fallback
// on real Firestore transactions, not just the in-memory store.

const test = require("node:test");
const assert = require("node:assert/strict");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { createConfigApi } = require("../src/api");
const { createFirestoreStore } = require("../src/adapters/firestore-store");
const { createMemoryBlobs } = require("../src/adapters/blobs");
const { createStaticAuth } = require("../src/adapters/auth");

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  test("firestore-store needs the emulator (npm run test:emulator)", { skip: true }, () => {});
} else {
  const app = initializeApp({ projectId: "demo-pharmacy-screen" }, "firestore-store-test");
  const db = getFirestore(app);
  const root = `pharmacyScreenTest${Date.now()}`;
  const api = createConfigApi({
    store: createFirestoreStore(db, { root }),
    blobs: createMemoryBlobs(),
    auth: createStaticAuth({ a: { uid: "u-admin", admin: true } }),
  });
  const call = (method, path, body) =>
    api.handle({ method, path, headers: { authorization: "Bearer a", "content-type": "application/json" }, query: {}, body: body === undefined ? undefined : Buffer.from(JSON.stringify(body)) });

  test("CRUD, uniqueness, fallback and publishing on Firestore", async () => {
    const ph = await call("POST", "/api/admin/pharmacies", { storeCode: "VIC-MP-001", name: "Beaumaris", colours: { primary: "#000000", accent: "#ffffff" } });
    assert.equal(ph.status, 201);
    const stored = await db.doc(`${root}/config/pharmacies/${ph.body.id}`).get();
    assert.equal(stored.data().storeCode, "VIC-MP-001");

    const races = await Promise.all([1, 2, 3].map((n) => call("POST", "/api/admin/pharmacies", { storeCode: "VIC-MP-002", name: `R${n}`, colours: { primary: "#000000", accent: "#ffffff" } })));
    assert.deepEqual(races.map((r) => r.status).sort(), [201, 409, 409]);

    const t = (await call("POST", "/api/admin/templates/builtin-opening-hours/clone", { name: "Hours" })).body;
    const p = (await call("POST", "/api/admin/promotions", { name: "Closed", promoId: "closed", templateId: t.id })).body;
    assert.equal((await call("POST", "/api/admin/promotions", { name: "Closed 2", promoId: "closed", templateId: t.id })).status, 409);

    const pub = await db.doc(`${root}/published/screens/VIC-MP-001`).get();
    assert.equal(pub.data().promotions.closed.template.id, t.id);

    assert.equal((await call("DELETE", `/api/admin/templates/${t.id}`)).status, 200);
    assert.equal((await db.doc(`${root}/config/promotions/${p.id}`).get()).data().templateId, "builtin-opening-hours");
    assert.equal((await db.doc(`${root}/published/screens/VIC-MP-001`).get()).data().promotions.closed.template.id, "builtin-opening-hours");

    const screen = await api.handle({ method: "GET", path: "/api/screens/VIC-MP-002", headers: {}, query: {} });
    assert.equal(screen.status, 200);

    const audit = await db.collection(`${root}/audit/entries`).get();
    assert.equal(audit.size, 5, "two pharmacy creates, clone, promotion create, template delete");
    const listed = (await call("GET", "/api/admin/audit")).body;
    assert.equal(listed[0].action, "delete", "newest first");
  });
}
