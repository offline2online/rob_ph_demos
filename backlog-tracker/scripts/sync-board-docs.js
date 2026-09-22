// Push this project's own docs onto the board it is, byte for byte.
//
//   node sync-board-docs.js            # write README.md / REQUIREMENTS.md
//   node sync-board-docs.js --check    # compare only; exit 1 if drifted
//
// The board keeps a second copy of each project's README and Requirements
// (projects/{id}.readmeMd / requirementsMd) so they can be read and edited
// from the Docs page. The repo file is the source of truth and the root
// CLAUDE.md asks for the copy to follow it in the same session the file
// changes — "not at the end of the week, not when someone notices".
//
// dsp-integration has had scripts/sync-board-docs.mjs for exactly this
// since 21 Sep 2026; backlog-tracker, whose README is ~80 KB, had nothing,
// which left retyping it through a model as the only route — the one thing
// CLAUDE.md explicitly says not to do. This runs from the
// deploy-backlog-tracker.yml workflow on every push that touches these
// files, so the copy follows the file without anyone remembering.
//
// Writes, then reads back and fails if what landed isn't what was sent.
const fs = require("fs");
const path = require("path");
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const PROJECT_ID = "oTcLAbnhUUO2S7NkbsuV"; // Backlog Tracker & FAQs
const ROOT = path.resolve(__dirname, "..");
const DOCS = [
  { field: "readmeMd", file: "README.md" },
  { field: "requirementsMd", file: "REQUIREMENTS.md" },
];
// What firestore.rules lets the board's own editor save — syncing past it
// would put the document beyond what a person could then edit by hand.
const MAX_CHARS = 200000;

const firstDifference = (a, b) => {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
};

const context = (s, at) => JSON.stringify(s.slice(Math.max(0, at - 60), at + 60));

async function main() {
  const check = process.argv.includes("--check");
  initializeApp({ credential: applicationDefault() });
  const db = getFirestore();
  const ref = db.collection("projects").doc(PROJECT_ID);

  const snap = await ref.get();
  if (!snap.exists) { console.error(`No project ${PROJECT_ID} on the board.`); process.exit(2); }
  const current = snap.data();

  let drifted = 0;
  const updates = {};
  for (const { field, file } of DOCS) {
    const wanted = fs.readFileSync(path.join(ROOT, file), "utf8");
    if (wanted.length > MAX_CHARS) {
      console.error(`${file} is ${wanted.length} chars — over the ${MAX_CHARS} the board accepts. Not syncing.`);
      process.exit(2);
    }
    const have = current[field] || "";
    if (have === wanted) { console.log(`${file} → ${field}: in sync (${wanted.length} chars)`); continue; }
    drifted++;
    const at = firstDifference(have, wanted);
    console.log(`${file} → ${field}: DRIFTED (board ${have.length} chars, file ${wanted.length}); first difference at ${at}`);
    console.log(`    board: ${context(have, at)}`);
    console.log(`    file:  ${context(wanted, at)}`);
    updates[field] = wanted;
  }

  if (!drifted) { console.log("\nBoard matches the repo."); return; }
  if (check) { console.error(`\n${drifted} document(s) have drifted — the board is behind.`); process.exit(1); }

  await ref.set(Object.assign({}, updates, { updatedAt: FieldValue.serverTimestamp() }), { merge: true });

  // Verify rather than assume — a sync that reports success without
  // checking is worse than no sync, because it stops anyone looking again.
  const after = (await ref.get()).data();
  const bad = Object.keys(updates).filter((f) => (after[f] || "") !== updates[f]);
  if (bad.length) { console.error(`\nWrote ${bad.join(", ")} but read back something different.`); process.exit(1); }
  console.log(`\nSynced ${Object.keys(updates).join(", ")} and verified byte for byte.`);
}

main().catch((err) => { console.error(err.stack || err.message); process.exit(1); });
