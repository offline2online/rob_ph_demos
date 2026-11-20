"use strict";

// Firestore and Storage rules for the pharmacy screen config (ticket test
// step 5: anonymous writes refused everywhere). Runs against the emulators:
//   npm run test:emulator
// It loads the real rules files — the repo-root firestore.rules (the whole
// rob-ph-demos ruleset, shared with the menu-board demo) and
// rules/storage.rules — and checks every pharmacyScreen/ path as an
// anonymous visitor, a signed-in user, and even a signed-in admin: no client
// writes at all (only the API, through the Admin SDK, writes), no client
// reads of admin records or the audit log, public reads of the published
// screen config and media only.

const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
const { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection } = require("firebase/firestore");
const { ref, uploadBytes, getBytes, deleteObject } = require("firebase/storage");

const PROJECT = "demo-pharmacy-screen";
const ROOT = path.join(__dirname, "..");

const ADMIN_DOCS = [
  "pharmacyScreen/config",
  "pharmacyScreen/config/pharmacies/p1",
  "pharmacyScreen/config/promotions/m1",
  "pharmacyScreen/config/templates/t1",
  "pharmacyScreen/config/services/s1",
  "pharmacyScreen/audit/entries/a1",
  "pharmacyScreen/published",
  "pharmacyScreen/private",
  "pharmacyScreen/private/settings/phApi", // the PH API token settings (ph-proxy/)
  "pharmacyScreen/private/auditLog/e1",
];
const SCREEN_DOC = "pharmacyScreen/published/screens/VIC-MP-001";
const ALL_DOCS = [...ADMIN_DOCS, SCREEN_DOC, "pharmacyScreen/published/screens/NEW-CODE"];

let env;

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: fs.readFileSync(path.join(ROOT, "../../../firestore.rules"), "utf8"), host: "127.0.0.1", port: 8181 },
    storage: { rules: fs.readFileSync(path.join(ROOT, "rules/storage.rules"), "utf8"), host: "127.0.0.1", port: 9199 },
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const p of [...ADMIN_DOCS, SCREEN_DOC]) await setDoc(doc(db, p), { seeded: true, name: "x" });
    const st = ctx.storage();
    await uploadBytes(ref(st, "pharmacyScreen/media/logos/p1/logo.png"), new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { contentType: "image/png" });
    await uploadBytes(ref(st, "other/private.png"), new Uint8Array([1]), { contentType: "image/png" });
  });
});

test.after(async () => {
  if (env) await env.cleanup();
});

const who = () => [
  ["anonymous", env.unauthenticatedContext()],
  ["signed-in user", env.authenticatedContext("u-viewer", { email: "viewer@example.com" })],
  ["signed-in admin", env.authenticatedContext("u-admin", { email: "admin@example.com", admin: true })],
];

test("Firestore: no client can write anywhere under pharmacyScreen/", async () => {
  for (const [, ctx] of who()) {
    const db = ctx.firestore();
    for (const p of ALL_DOCS) {
      await assertFails(setDoc(doc(db, p), { name: "hacked" }));
      await assertFails(updateDoc(doc(db, p), { name: "hacked" }));
      await assertFails(deleteDoc(doc(db, p)));
    }
  }
});

test("Firestore: admin records, audit log and settings are not client-readable", async () => {
  for (const [, ctx] of who()) {
    const db = ctx.firestore();
    for (const p of ADMIN_DOCS) await assertFails(getDoc(doc(db, p)));
    for (const c of ["pharmacyScreen/config/pharmacies", "pharmacyScreen/config/promotions", "pharmacyScreen/config/templates", "pharmacyScreen/config/services", "pharmacyScreen/audit/entries", "pharmacyScreen/private/auditLog", "pharmacyScreen"]) {
      await assertFails(getDocs(collection(db, c)));
    }
  }
});

test("Firestore: the published screen config is publicly readable", async () => {
  for (const [, ctx] of who()) {
    const db = ctx.firestore();
    await assertSucceeds(getDoc(doc(db, SCREEN_DOC)));
    await assertSucceeds(getDocs(collection(db, "pharmacyScreen/published/screens")));
  }
});

test("Storage: no client can write media; published media is public; nothing else is", async () => {
  for (const [, ctx] of who()) {
    const st = ctx.storage();
    await assertFails(uploadBytes(ref(st, "pharmacyScreen/media/logos/p1/new.png"), new Uint8Array([1]), { contentType: "image/png" }));
    await assertFails(uploadBytes(ref(st, "pharmacyScreen/media/backgrounds/t1/portrait.png"), new Uint8Array([1]), { contentType: "image/png" }));
    await assertFails(uploadBytes(ref(st, "anything/else.png"), new Uint8Array([1]), { contentType: "image/png" }));
    await assertFails(deleteObject(ref(st, "pharmacyScreen/media/logos/p1/logo.png")));
    await assertSucceeds(getBytes(ref(st, "pharmacyScreen/media/logos/p1/logo.png")));
    await assertFails(getBytes(ref(st, "other/private.png")));
  }
});
