#!/usr/bin/env node
// Takes the legacy requirementsMd / readmeMd text off projects/{id}, where the
// board's projects listener re-sends it to every open tab on every project
// write (a train status, a Routine heartbeat): 321 KB of the 359 KB the
// listener carried on 2 Nov 2026.
//
// Every reader already prefers projects/{id}/docs/{kind} (app.js
// loadProjectDocs, mcp-server.js readProjectDoc, sync-board-docs.js), so:
//   - docs/{kind} exists  -> it is what everyone reads; the legacy field is
//     dropped (and the pointer docs.{kind} set from it if missing).
//   - docs/{kind} missing -> the text is copied there, read back byte for
//     byte, and only then is the legacy field dropped.
// Unlike migrate-project-docs.js it never overwrites an existing docs/{kind}
// with the (possibly older) legacy text.
//
//   GOOGLE_APPLICATION_CREDENTIALS=sa.json node drop-legacy-project-docs.js           # dry run
//   GOOGLE_APPLICATION_CREDENTIALS=sa.json node drop-legacy-project-docs.js --apply
"use strict";
const crypto = require("crypto");
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const KINDS = [
  { kind: "requirements", legacy: "requirementsMd", byField: "requirementsUpdatedByEmail" },
  { kind: "readme", legacy: "readmeMd", byField: "readmeUpdatedByEmail" },
];
const sha = (t) => crypto.createHash("sha256").update(t, "utf8").digest("hex");

async function main() {
  const apply = process.argv.includes("--apply");
  initializeApp({ credential: applicationDefault(), projectId: "backlog-tracker-e4ed2" });
  const db = getFirestore();
  let dropped = 0, copied = 0;
  for (const pd of (await db.collection("projects").get()).docs) {
    const p = pd.data() || {};
    const pointers = Object.assign({}, p.docs && typeof p.docs === "object" ? p.docs : {});
    const upd = {};
    for (const k of KINDS) {
      if (!(k.legacy in p)) continue;
      const text = typeof p[k.legacy] === "string" ? p[k.legacy] : "";
      const subRef = pd.ref.collection("docs").doc(k.kind);
      const sub = await subRef.get();
      if (sub.exists) {
        const cur = String((sub.data() || {}).contentMd || "");
        console.log(`${pd.id} (${p.name || "?"}): ${k.legacy} ${text.length} chars; docs/${k.kind} has ${cur.length} chars${cur === text ? " (same)" : " (newer, kept)"} -> drop legacy field`);
        if (!pointers[k.kind]) pointers[k.kind] = { chars: cur.length, sha256: sha(cur), sourceCommit: (sub.data() || {}).sourceCommit || null, updatedAt: (sub.data() || {}).updatedAt || null };
      } else if (text) {
        console.log(`${pd.id} (${p.name || "?"}): ${k.legacy} ${text.length} chars; no docs/${k.kind} -> copy, verify, drop`);
        if (apply) {
          await subRef.set({ contentMd: text, updatedAt: p.updatedAt || FieldValue.serverTimestamp(), updatedByEmail: p[k.byField] || "migration", sourceCommit: null, sourcePath: null, chars: text.length, sha256: sha(text) });
          const back = await subRef.get();
          if (!back.exists || (back.data() || {}).contentMd !== text) throw new Error(`${pd.id}: docs/${k.kind} did not read back byte for byte; legacy field kept`);
          pointers[k.kind] = { chars: text.length, sha256: sha(text), sourceCommit: null, updatedAt: (back.data() || {}).updatedAt || null };
        }
        copied += 1;
      } else {
        console.log(`${pd.id} (${p.name || "?"}): empty ${k.legacy} -> drop`);
      }
      upd[k.legacy] = FieldValue.delete();
      if (p[k.byField] !== undefined) upd[k.byField] = FieldValue.delete();
      dropped += 1;
    }
    if (apply && Object.keys(upd).length) await pd.ref.set(Object.assign({ docs: pointers }, upd), { merge: true });
  }
  console.log(apply ? `Dropped ${dropped} legacy field(s); copied ${copied} into docs/ first.` : `Dry run: ${dropped} legacy field(s) would go (${copied} copied into docs/ first). Re-run with --apply.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
