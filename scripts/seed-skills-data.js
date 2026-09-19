// One-off (but safe-to-repeat) seed for the Skills feature: inserts a
// single skills doc for "Personalisation Hub Front & Design" (the
// ph-designer skill every UI change in this repo is required to read
// first — see the root CLAUDE.md's "Every UI change goes through the
// ph-designer skill" section) so there's a central, MCP-readable place to
// manage it instead of it only living as files in Claude's own skills
// directory.
//
// Insert-only, like seed-faq-data.js: this checks for an existing doc with
// the same slug before adding a new one, so re-running it after a later
// hand-edit in the console never creates a duplicate or clobbers anything.
//
// The six files below are read from ./seed-skills-files/ at run time —
// verbatim copies of the real ph-designer skill's files, not transcribed —
// so what lands in Firestore is byte-for-byte what a person reading the
// skill locally would see. Keep those copies in sync if ph-designer itself
// changes; this script does not read from Claude's own skills directory
// (a path that only exists inside a Claude Code sandbox, not on whatever
// machine actually runs this script).

const fs = require("fs");
const path = require("path");
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

const SKILL_SLUG = "ph-designer";
const SKILL_NAME = "Personalisation Hub Front & Design";
const SKILL_SUMMARY = "The measured Personalisation Hub design system (tokens, components, HQ/Retail Admin surfaces, prototyping rules) every UI change in this repo must be built against.";
const SKILL_VERSION = "1.0.0";

const FILES_DIR = path.join(__dirname, "seed-skills-files");
const FILE_PATHS = [
  "SKILL.md",
  "references/tokens.md",
  "references/components.md",
  "references/hq-admin.md",
  "references/retail-admin.md",
  "references/prototyping.md",
];

function loadFiles() {
  return FILE_PATHS.map((relPath) => ({
    path: relPath,
    content: fs.readFileSync(path.join(FILES_DIR, relPath), "utf8"),
  }));
}

async function main() {
  const existing = await db.collection("skills").where("slug", "==", SKILL_SLUG).limit(1).get();
  if (!existing.empty) {
    console.log(`Skill "${SKILL_SLUG}" already exists (id ${existing.docs[0].id}) — nothing to do.`);
    return;
  }

  const files = loadFiles();
  const totalChars = files.reduce((sum, f) => sum + f.content.length, 0);
  const now = Timestamp.now();

  const ref = await db.collection("skills").add({
    name: SKILL_NAME,
    slug: SKILL_SLUG,
    summary: SKILL_SUMMARY,
    version: SKILL_VERSION,
    files,
    createdVia: "console",
    createdByEmail: null,
    updatedByEmail: null,
    createdAt: now,
    updatedAt: now,
  });

  console.log(`Created skill "${SKILL_NAME}" (id ${ref.id}, slug ${SKILL_SLUG}) — ${files.length} files, ${totalChars} characters total.`);
}

main().catch((err) => {
  console.error("Skills seed failed:", err);
  process.exit(1);
});
