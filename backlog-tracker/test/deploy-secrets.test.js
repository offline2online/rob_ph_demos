// Every secret the backlog-tracker Cloud Functions declare with defineSecret()
// must be created by deploy-backlog-tracker.yml before `firebase deploy`
// runs. A declared secret that doesn't exist in Secret Manager makes the CLI
// ask for its value, which in CI is a failed deploy: LEAD_INGEST_KEY did
// exactly that (PR #520, run 41949163510, 5 Nov 2026). Also covers
// scripts/merge-live-indexes.js, the index step's fix from the same run.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { mergeLive } = require("../scripts/merge-live-indexes");

const root = path.join(__dirname, "..");
const fnDir = path.join(root, "functions");
const declared = new Set();
for (const f of fs.readdirSync(fnDir)) {
  if (!f.endsWith(".js")) continue;
  const src = fs.readFileSync(path.join(fnDir, f), "utf8");
  for (const m of src.matchAll(/defineSecret\(\s*["'`]([A-Z0-9_]+)["'`]\s*\)/g)) declared.add(m[1]);
}
assert.ok(declared.size > 0, "found no defineSecret() calls — has the pattern changed?");

const wf = fs.readFileSync(path.join(root, "..", ".github", "workflows", "deploy-backlog-tracker.yml"), "utf8");
const missing = [...declared].filter((name) =>
  !new RegExp(`\\bsync ${name}\\b`).test(wf) &&
  !new RegExp(`sync-function-secret\\.sh ${name}\\b`).test(wf));
assert.deepEqual(missing, [], `declared with defineSecret() but never created by deploy-backlog-tracker.yml: ${missing.join(", ")}`);
console.log(`  ok  all ${declared.size} declared function secrets are created by the deploy (${[...declared].sort().join(", ")})`);

// merge-live-indexes: a live index the file lacks is added once; one it has is not.
const file = { indexes: [{ collectionGroup: "a", queryScope: "COLLECTION", fields: [{ fieldPath: "x", order: "ASCENDING" }] }] };
const live = { status: "success", result: {
  indexes: [
    { collectionGroup: "a", queryScope: "COLLECTION", fields: [{ fieldPath: "x", order: "ASCENDING" }] },
    { collectionGroup: "b", queryScope: "COLLECTION", fields: [{ fieldPath: "y", order: "DESCENDING" }, { fieldPath: "z", arrayConfig: "CONTAINS" }] },
  ],
  fieldOverrides: [{ collectionGroup: "c", fieldPath: "t", ttl: true, indexes: [] }],
} };
const out = mergeLive(file, live);
assert.equal(out.spec.indexes.length, 2);
assert.deepEqual(out.addedIndexes.map((i) => i.collectionGroup), ["b"]);
assert.deepEqual(out.addedOverrides.map((o) => o.fieldPath), ["t"]);
assert.equal(mergeLive(out.spec, live).addedIndexes.length, 0, "merging twice adds nothing");
assert.equal(file.indexes.length, 1, "the input is not mutated");
assert.throws(() => mergeLive(file, { status: "error" }));
console.log("  ok  merge-live-indexes keeps every live index and field override, once");
