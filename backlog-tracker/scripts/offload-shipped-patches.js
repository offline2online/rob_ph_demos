#!/usr/bin/env node
// Moves patchFiles off shipped tickets (archived / published-live) into
// backlogItems/{id}/pipeline/patch, the same move functions/patch-offload.js
// has made for every new patch since 5 Oct 2026. Nothing is deleted: the files
// end up in the sub-document, exactly where run-backlog-automation.js's
// patchFilesFor() already looks.
//
// Why (2 Nov 2026): ~1,000 tickets that shipped before the offload still
// carried their patches — 92 MB of the 101 MB in backlogItems. Every reader
// of whole ticket documents paid for it: the console's Archived pages (and,
// through the IndexedDB cache, every load after them), the MCP server's
// list_projects and per-project tools, and the Cloud Function triggers that
// read a project's tickets. See SECURITY-PERFORMANCE.md, "2 Nov 2026".
//
// The write is inert for every backlogItems trigger (they all act on a status,
// flag or description transition; onBacklogItemPatchFilesOffload sees no
// patchFiles left and returns).
//
//   GOOGLE_APPLICATION_CREDENTIALS=sa.json node offload-shipped-patches.js          # dry run
//   GOOGLE_APPLICATION_CREDENTIALS=sa.json node offload-shipped-patches.js --apply
"use strict";
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { offloadPatchFiles } = require("../functions/patch-offload.js");

const apply = process.argv.includes("--apply");
const SHIPPED = ["archived", "published-live"];

async function main() {
  initializeApp({ credential: applicationDefault(), projectId: "backlog-tracker-e4ed2" });
  const db = getFirestore();
  let candidates = 0, moved = 0, bytes = 0;
  for (const status of SHIPPED) {
    // Ids only: the projection keeps this listing small.
    const ids = (await db.collection("backlogItems").where("status", "==", status).select("status").get()).docs.map((d) => d.id);
    for (const id of ids) {
      const snap = await db.collection("backlogItems").doc(id).get();
      const files = snap.get("patchFiles");
      if (!Array.isArray(files) || !files.length) continue;
      candidates += 1;
      bytes += Buffer.byteLength(JSON.stringify(files));
      if (!apply) continue;
      if (await offloadPatchFiles(db, FieldValue, id)) moved += 1;
    }
    console.log(`${status}: ${ids.length} tickets checked`);
  }
  console.log(`${candidates} shipped ticket(s) still carry patchFiles (${Math.round(bytes / 1024 / 1024)} MB).`);
  console.log(apply ? `Moved ${moved} to pipeline/patch.` : "Dry run: nothing written. Re-run with --apply to move them.");
}
main().catch((e) => { console.error(e); process.exit(1); });
