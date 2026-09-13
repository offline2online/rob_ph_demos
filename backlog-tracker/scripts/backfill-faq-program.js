// One-off (but safe-to-repeat) backfill: assigns every faqArticles doc that
// doesn't already have a programId to a "Personalisation Hub" program doc
// in the top-level `programs` collection — the same collection a project
// can optionally be grouped under (see public/js/app.js's "Programs/
// Products" section). The 108 articles seed-faq-data.js seeds are a
// verbatim Freshdesk import of the real Personalisation Hub Help Center, so
// they're all genuinely Personalisation Hub content; this is what gets
// every one of them correctly categorized without a manual pass through
// FAQ Management's article editor.
//
// Idempotent: find-or-creates the program by name (never creates a second
// "Personalisation Hub" program on a repeat run), and only ever sets
// programId on an article that doesn't already have one — a later manual
// re-categorization from FAQ Center (moving an article to a different
// product/program) is never overwritten by a later deploy re-running this.

const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

const PROGRAM_NAME = "Personalisation Hub";

async function findOrCreateProgram(name) {
  const existing = await db.collection("programs").where("name", "==", name).limit(1).get();
  if (!existing.empty) return existing.docs[0].id;
  const ref = await db.collection("programs").add({ name, createdAt: Timestamp.now() });
  return ref.id;
}

async function main() {
  const programId = await findOrCreateProgram(PROGRAM_NAME);

  const articlesSnap = await db.collection("faqArticles").get();
  let assigned = 0;
  let skipped = 0;
  for (const articleDoc of articlesSnap.docs) {
    if (articleDoc.data().programId) {
      skipped++;
      continue;
    }
    await articleDoc.ref.set({ programId, updatedAt: Timestamp.now() }, { merge: true });
    assigned++;
  }

  console.log(`FAQ program backfill: ${assigned} article(s) assigned to "${PROGRAM_NAME}" (${programId}), ${skipped} already had a program`);
}

main().catch((err) => {
  console.error("FAQ program backfill failed:", err);
  process.exit(1);
});
