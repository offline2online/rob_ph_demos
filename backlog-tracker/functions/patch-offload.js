"use strict";
// Moves a ticket's patchFiles off backlogItems/{id} into
// backlogItems/{id}/pipeline/patch, which nothing in the browser listens to.
//
// Why (Firebase cost review, 5 Oct 2026): Firestore's bill was almost all
// internet egress — ~99 GB a month, ~80 KB per document read. patchFiles is
// the full content of every file a ticket changes (up to ~180 KB), and the
// board's live backlogItems listener cannot mask fields, so every open tab
// downloaded it for every card in flight on load and again on every small
// write to that card (a note, a test-link re-point, a Routine heartbeat).
//
// The Routine session keeps writing patchFiles + patchReady on the item
// exactly as ROUTINE_INSTRUCTIONS.md says; this runs on that write and moves
// the blob within seconds. run-backlog-automation.js reads it from either
// place (patchFilesFor), and drops both once the ticket ships.
//
// A transaction, so the move is atomic (a reader sees the field or the
// sub-document, never neither) and always moves the CURRENT value: if the
// Routine re-patched between the event firing and this running, the newer
// files are what get moved.

const PATCH_COLLECTION = "pipeline";
const PATCH_DOC = "patch";

function hasPatchFiles(data) {
  return !!data && Array.isArray(data.patchFiles) && data.patchFiles.length > 0;
}

// Returns true when it moved something.
async function offloadPatchFiles(db, FieldValue, itemId) {
  const itemRef = db.collection("backlogItems").doc(itemId);
  const patchRef = itemRef.collection(PATCH_COLLECTION).doc(PATCH_DOC);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(itemRef);
    const current = snap.exists ? snap.data() : null;
    if (!hasPatchFiles(current)) return false;
    tx.set(patchRef, {
      patchFiles: current.patchFiles,
      patchBaseSha: current.patchBaseSha || null,
      movedAt: FieldValue.serverTimestamp(),
    });
    tx.update(itemRef, { patchFiles: FieldValue.delete() });
    return true;
  });
}

module.exports = { offloadPatchFiles, hasPatchFiles, PATCH_COLLECTION, PATCH_DOC };
