// One-off (but safe-to-repeat) migration: seeds backlog-tracker's Firestore
// with the historical project + cards that used to live only in the Claude
// Artifact "Prototype Pipeline" board, so the real app has that history too
// instead of starting empty. Uses the artifact card ids as Firestore doc
// ids and Firestore's create() (insert-only, fails if the doc already
// exists) rather than set()/merge — this run seeds documents that don't
// exist yet and is a strict no-op on every later deploy, so it can never
// clobber a later edit made from the live app itself (e.g. someone restores
// one of these cards, or renames the project) by silently reapplying the
// original historical value on top of it.

const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const data = require("./artifact-export.json");

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

function toTimestamp(iso) {
  return Timestamp.fromDate(new Date(iso));
}

async function createIfMissing(ref, data) {
  try {
    await ref.create(data);
    return "created";
  } catch (err) {
    if (err.code === 6 /* ALREADY_EXISTS */) return "skipped";
    throw err;
  }
}

async function main() {
  const { project, items } = data;

  const projectResult = await createIfMissing(
    db.collection("projects").doc(project.id),
    { name: project.name, createdAt: toTimestamp(project.createdAt) }
  );
  console.log(`Project "${project.name}" (${project.id}): ${projectResult}`);

  const counts = { created: 0, skipped: 0 };
  for (const item of items) {
    const doc = {
      projectId: item.projectId,
      title: item.title,
      desc: item.desc,
      type: item.type,
      category: item.category,
      status: item.status,
      createdAt: toTimestamp(item.createdAt),
      updatedAt: toTimestamp(item.updatedAt),
    };
    if (item.archivedAt) doc.archivedAt = toTimestamp(item.archivedAt);
    if (item.notes) doc.notes = item.notes;
    if (item.voiceCaptured) doc.voiceCaptured = item.voiceCaptured;
    if (item.claudeNote) doc.claudeNote = item.claudeNote;

    const result = await createIfMissing(db.collection("backlogItems").doc(item.id), doc);
    counts[result]++;
  }
  console.log(`Backlog items: ${counts.created} created, ${counts.skipped} already present (skipped)`);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
