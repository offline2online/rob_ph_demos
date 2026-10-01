// The one-off Requirements/README migration (scripts/migrate-project-docs.js)
// against the in-memory Firestore stub: dry run writes nothing, --apply moves
// the text, points at it, clears the legacy fields, and a re-run is a no-op.
//
// Run with:  node test/migrate-project-docs.test.js
"use strict";
const assert = require("assert");
const env = require("./mcp-stubs.js").install();
const { store, db } = env;
const { FieldValue } = require("firebase-admin/firestore");
const { migrateProject } = require("../scripts/migrate-project-docs.js");

(async () => {
  store.col("projects").set("p1", { name: "P1", requirementsMd: "# req", readmeMd: "# readme", requirementsUpdatedByEmail: "a@x.com", docsSync: { requirementsCommit: "abc" }, trainLocked: true });
  store.col("projects").set("p2", { name: "P2" });
  const lines = [];
  const fakeDoc = (id) => ({ id, data: () => store.col("projects").get(id), ref: db.collection("projects").doc(id) });

  assert.strictEqual(await migrateProject(FieldValue, fakeDoc("p1"), false, (l) => lines.push(l)), 2);
  assert.strictEqual(store.col("projects/p1/docs").size, 0, "dry run writes nothing");
  assert.strictEqual(store.col("projects").get("p1").requirementsMd, "# req");

  assert.strictEqual(await migrateProject(FieldValue, fakeDoc("p1"), true, () => {}), 2);
  const sub = store.col("projects/p1/docs").get("requirements");
  assert.strictEqual(sub.contentMd, "# req");
  assert.strictEqual(sub.updatedByEmail, "a@x.com");
  assert.strictEqual(sub.sourceCommit, "abc");
  assert.strictEqual(sub.chars, 5);
  assert.strictEqual(store.col("projects/p1/docs").get("readme").contentMd, "# readme");
  const proj = store.col("projects").get("p1");
  assert.strictEqual(proj.docs.requirements.chars, 5);
  assert.strictEqual(proj.docs.readme.chars, 8);
  assert.strictEqual(proj.trainLocked, true, "other project fields are untouched");
  assert.ok(!("requirementsMd" in proj) && !("readmeMd" in proj) && !("requirementsUpdatedByEmail" in proj), "legacy fields are cleared");

  await migrateProject(FieldValue, fakeDoc("p2"), true, () => {});
  assert.strictEqual(store.col("projects/p2/docs").size, 0, "a project with nothing to move is left alone");
  assert.strictEqual(await migrateProject(FieldValue, fakeDoc("p1"), true, () => {}), 0, "a re-run finds nothing left to move");
  env.restore();
  console.log("ok  migrate-project-docs");
})().catch((e) => { console.error(e); process.exit(1); });
