#!/usr/bin/env node
// Adds to firestore.indexes.json every composite index and field override
// that already exists in the live project but that the file doesn't list, so
// `firebase deploy --only firestore:indexes --non-interactive` can run.
//
//   node scripts/merge-live-indexes.js <live.json> <firestore.indexes.json>
//
// <live.json> is the output of
// `firebase firestore:indexes --project <id> --json` ({status, result}) or a
// bare {indexes, fieldOverrides} spec. The indexes file is rewritten in place
// on the runner only; nothing is committed.
//
// Why (5 Nov 2026, run 41949163510): firebase-tools 13 asks "Would you like
// to delete these indexes?" whenever the project holds an index the file
// doesn't list, and in non-interactive mode without --force that question is
// an error ("Pass the --force flag…") thrown BEFORE any new index is created
// (lib/firestore/api.js deploy()). One index made by hand from a console link
// therefore stopped every index in the file from ever deploying. --force is
// not the answer: it deletes that hand-made index. Listing the live ones in
// the file leaves nothing to delete, so the deploy only creates.
//
// Each index merged in is printed as a GitHub warning so it can be added to
// the repo's firestore.indexes.json for real.
"use strict";

const fs = require("fs");

const indexKey = (i) => JSON.stringify([
  i.collectionGroup,
  i.queryScope || "COLLECTION",
  (i.fields || []).map((f) => [f.fieldPath, f.order || null, f.arrayConfig || null, f.vectorConfig ? JSON.stringify(f.vectorConfig) : null]),
]);
const overrideKey = (o) => JSON.stringify([o.collectionGroup, o.fieldPath]);

function mergeLive(file, live) {
  const spec = live && live.result && typeof live.result === "object" ? live.result : live;
  if (!spec || !Array.isArray(spec.indexes)) throw new Error("live listing has no indexes array");
  const out = { ...file, indexes: [...(file.indexes || [])], fieldOverrides: [...(file.fieldOverrides || [])] };
  const haveIdx = new Set(out.indexes.map(indexKey));
  const haveOvr = new Set(out.fieldOverrides.map(overrideKey));
  const addedIndexes = [];
  const addedOverrides = [];
  for (const i of spec.indexes) {
    if (haveIdx.has(indexKey(i))) continue;
    haveIdx.add(indexKey(i));
    out.indexes.push(i);
    addedIndexes.push(i);
  }
  for (const o of spec.fieldOverrides || []) {
    if (haveOvr.has(overrideKey(o))) continue;
    haveOvr.add(overrideKey(o));
    out.fieldOverrides.push(o);
    addedOverrides.push(o);
  }
  return { spec: out, addedIndexes, addedOverrides };
}

function describeIndex(i) {
  return `${i.collectionGroup} (${i.queryScope || "COLLECTION"}): ` +
    (i.fields || []).map((f) => `${f.fieldPath} ${f.order || f.arrayConfig || "vector"}`).join(", ");
}

if (require.main === module) {
  const [livePath, filePath] = process.argv.slice(2);
  if (!livePath || !filePath) {
    console.error("usage: merge-live-indexes.js <live.json> <firestore.indexes.json>");
    process.exit(2);
  }
  const { spec, addedIndexes, addedOverrides } = mergeLive(
    JSON.parse(fs.readFileSync(filePath, "utf8")),
    JSON.parse(fs.readFileSync(livePath, "utf8")),
  );
  for (const i of addedIndexes) {
    console.log(`::warning title=Live Firestore index not in firestore.indexes.json::${describeIndex(i)} — kept for this deploy; add it to backlog-tracker/firestore.indexes.json`);
  }
  for (const o of addedOverrides) {
    console.log(`::warning title=Live field override not in firestore.indexes.json::${o.collectionGroup}.${o.fieldPath} — kept for this deploy; add it to backlog-tracker/firestore.indexes.json`);
  }
  fs.writeFileSync(filePath, JSON.stringify(spec, null, 2) + "\n");
  console.log(`firestore.indexes.json: ${spec.indexes.length} indexes, ${spec.fieldOverrides.length} field overrides ` +
    `(${addedIndexes.length} index(es) and ${addedOverrides.length} override(s) merged in from the live project).`);
}

module.exports = { mergeLive, indexKey };
