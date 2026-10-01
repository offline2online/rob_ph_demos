"use strict";
// One-off migration: move every project's Requirements and README off the
// projects/{id} document into projects/{id}/docs/{requirements|readme}.
//
//   node migrate-project-docs.js            # dry run: report what would move
//   node migrate-project-docs.js --apply    # copy, verify, then clear the legacy fields
//
// Per project and per document, in this order, so a failure at any step
// leaves the text where readers can still find it (every reader falls back
// to the legacy field while the subcollection doc is absent):
//   1. write projects/{id}/docs/{kind} = {contentMd, updatedAt, updatedByEmail,
//      sourceCommit, sourcePath, chars, sha256}  (skipped if one already exists
//      with identical text — a re-run is safe);
//   2. read it back and compare byte for byte;
//   3. only then set the pointer projects/{id}.docs.{kind} and delete the
//      legacy requirementsMd / readmeMd field.
// A project whose legacy field is empty or absent is left alone.
//
// Deploy order matters less than it looks, because of that fallback, but the
// clean order is: firestore rules + functions + hosting first, then this.
// Needs Application Default Credentials (the deploy service account).
const crypto = require("crypto");

const KINDS = [
  { kind: "requirements", legacy: "requirementsMd", byField: "requirementsUpdatedByEmail", commitKey: "requirementsCommit" },
  { kind: "readme", legacy: "readmeMd", byField: "readmeUpdatedByEmail", commitKey: "readmeCommit" },
];

async function migrateProject(FieldValue, projectDoc, apply, log) {
  const p = projectDoc.data() || {};
  const ref = projectDoc.ref;
  const pointers = Object.assign({}, p.docs && typeof p.docs === "object" ? p.docs : {});
  const clear = {};
  let moved = 0;
  for (const k of KINDS) {
    const text = p[k.legacy];
    if (typeof text !== "string" || !text.length) continue;
    const subRef = ref.collection("docs").doc(k.kind);
    const existing = await subRef.get();
    const sha256 = crypto.createHash("sha256").update(text, "utf8").digest("hex");
    const sourceCommit = (p.docsSync && p.docsSync[k.commitKey]) || null;
    log(`${projectDoc.id} (${p.name || "?"}): ${k.legacy} ${text.length} chars → docs/${k.kind}${existing.exists ? " (already there)" : ""}`);
    if (!apply) { moved++; continue; }
    if (!existing.exists || (existing.data() || {}).contentMd !== text) {
      await subRef.set({
        contentMd: text,
        updatedAt: p.updatedAt || FieldValue.serverTimestamp(),
        updatedByEmail: p[k.byField] || "migration",
        sourceCommit,
        sourcePath: null,
        chars: text.length,
        sha256,
      });
    }
    const back = await subRef.get();
    if (!back.exists || (back.data() || {}).contentMd !== text) {
      throw new Error(`${projectDoc.id}: docs/${k.kind} did not read back byte for byte — legacy field kept`);
    }
    pointers[k.kind] = { chars: text.length, sha256, sourceCommit, updatedAt: (back.data() || {}).updatedAt || null };
    clear[k.legacy] = FieldValue.delete();
    if (p[k.byField] !== undefined) clear[k.byField] = FieldValue.delete();
    moved++;
  }
  if (apply && moved) await ref.set(Object.assign({ docs: pointers }, clear), { merge: true });
  return moved;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const { initializeApp, applicationDefault } = require("firebase-admin/app");
  const { getFirestore, FieldValue } = require("firebase-admin/firestore");
  initializeApp({ credential: applicationDefault() });
  const db = getFirestore();
  const snap = await db.collection("projects").get();
  let total = 0;
  for (const d of snap.docs) total += await migrateProject(FieldValue, d, apply, console.log);
  console.log(apply ? `\nMigrated ${total} document(s).` : `\nDry run: ${total} document(s) would move. Re-run with --apply.`);
}

if (require.main === module) main().catch((err) => { console.error(err.stack || err.message); process.exit(1); });
module.exports = { migrateProject, KINDS };
