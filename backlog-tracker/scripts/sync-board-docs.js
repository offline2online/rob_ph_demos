// Push this project's own docs onto the board it is, byte for byte.
//
//   node sync-board-docs.js            # write README.md / REQUIREMENTS.md
//   node sync-board-docs.js --check    # compare only; exit 1 if drifted
//
// The board keeps a second copy of each project's README and Requirements
// (projects/{id}/docs/readme and /requirements, with only a `docs` pointer on
// the project doc itself) so they can be read and edited
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
const crypto = require("crypto");

const PROJECT_ID = "oTcLAbnhUUO2S7NkbsuV"; // Backlog Tracker & FAQs
const ROOT = path.resolve(__dirname, "..");
const DOCS = [
  { kind: "readme", file: "README.md" },
  { kind: "requirements", file: "REQUIREMENTS.md" },
];
// What firestore.rules lets one projects/{id}/docs/* document hold — syncing
// past it would be refused (and a person could not then edit it by hand).
const MAX_CHARS = 800000;

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
  const project = snap.data();

  let drifted = 0;
  const updates = {};
  for (const { kind, file } of DOCS) {
    const wanted = fs.readFileSync(path.join(ROOT, file), "utf8");
    if (wanted.length > MAX_CHARS) {
      console.error(`${file} is ${wanted.length} chars — over the ${MAX_CHARS} the board accepts. Not syncing.`);
      process.exit(2);
    }
    const sub = await ref.collection("docs").doc(kind).get();
    // Before the migration has run the text is still on the project doc.
    const legacy = project[kind === "readme" ? "readmeMd" : "requirementsMd"];
    const have = sub.exists ? (sub.data().contentMd || "") : (legacy || "");
    if (sub.exists && have === wanted) { console.log(`${file} → docs/${kind}: in sync (${wanted.length} chars)`); continue; }
    drifted++;
    const at = firstDifference(have, wanted);
    console.log(`${file} → docs/${kind}: DRIFTED (board ${have.length} chars, file ${wanted.length}); first difference at ${at}`);
    console.log(`    board: ${context(have, at)}`);
    console.log(`    file:  ${context(wanted, at)}`);
    updates[kind] = wanted;
  }

  if (!drifted) { console.log("\nBoard matches the repo."); return; }
  if (check) { console.error(`\n${drifted} document(s) have drifted — the board is behind.`); process.exit(1); }

  const sourceCommit = process.env.GITHUB_SHA || null;
  const pointers = Object.assign({}, project.docs || {});
  for (const [kind, text] of Object.entries(updates)) {
    const sha256 = crypto.createHash("sha256").update(text, "utf8").digest("hex");
    const file = DOCS.find((d) => d.kind === kind).file;
    await ref.collection("docs").doc(kind).set({
      contentMd: text, updatedAt: FieldValue.serverTimestamp(), updatedByEmail: "sync-board-docs",
      sourceCommit, sourcePath: `backlog-tracker/${file}`, chars: text.length, sha256,
    });
    pointers[kind] = { chars: text.length, sha256, sourceCommit, updatedAt: new Date() };
  }
  await ref.set({ docs: pointers, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

  // Verify rather than assume — a sync that reports success without
  // checking is worse than no sync, because it stops anyone looking again.
  const bad = [];
  for (const [kind, text] of Object.entries(updates)) {
    const after = await ref.collection("docs").doc(kind).get();
    if (!after.exists || after.data().contentMd !== text) bad.push(kind);
  }
  if (bad.length) { console.error(`\nWrote ${bad.join(", ")} but read back something different.`); process.exit(1); }
  console.log(`\nSynced ${Object.keys(updates).join(", ")} and verified byte for byte.`);
}

main().catch((err) => { console.error(err.stack || err.message); process.exit(1); });
