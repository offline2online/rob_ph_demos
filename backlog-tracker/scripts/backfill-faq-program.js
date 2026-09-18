// One-off (but safe-to-repeat) backfill for faqArticles.programId, plus an
// always-useful audit report (run with --report-only to just print counts
// and change nothing).
//
// This used to blanket-assign every unscoped article to "Personalisation
// Hub" on the assumption that anything without a programId was Freshdesk-
// imported Personalisation Hub content. That assumption stopped holding the
// moment any article about a DIFFERENT product/program (e.g. the console
// itself — the "PH Agent Console" program) went unscoped: it would have
// been silently mis-assigned to Personalisation Hub right along with
// everything else, hiding exactly the kind of gap that made FAQ impact
// review (ROUTINE_INSTRUCTIONS.md -> "FAQ impact review (Deploy flow, step
// 3b)") inert for the console's own project — see backlog item
// GiceSVMWdEiETinAVLVM. So this script no longer assumes; it only
// auto-assigns Personalisation Hub to an unscoped article when nothing
// about its title/category suggests it's about a different product, and
// reports (never silently assigns) anything that looks like it might
// document the console/board/help-centre tooling itself, for a person to
// route to the right program by hand in FAQ Management.
//
// Idempotent: find-or-creates the "Personalisation Hub" program by name
// (never creates a second one on a repeat run), and only ever sets
// programId on an article that doesn't already have one — a later manual
// re-categorization from FAQ Management (moving an article to a different
// product/program) is never overwritten by a later deploy re-running this.

const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

const PROGRAM_NAME = "Personalisation Hub";

// Keyword signal that an unscoped article is plausibly about the board/help
// -centre tooling itself (the "PH Agent Console" program) rather than the
// Personalisation Hub product it defaults to — title and category name are
// the only cheap signals available without reading the full body.
const CONSOLE_SIGNAL_RE = /\b(backlog|mcp|agent console|help ?centre|help ?center|faq management|notify claude|prototype (backlog|pipeline))\b/i;

async function findOrCreateProgram(name) {
  const existing = await db.collection("programs").where("name", "==", name).limit(1).get();
  if (!existing.empty) return existing.docs[0].id;
  const ref = await db.collection("programs").add({ name, createdAt: Timestamp.now() });
  return ref.id;
}

async function main() {
  const reportOnly = process.argv.includes("--report-only");
  const programId = reportOnly ? null : await findOrCreateProgram(PROGRAM_NAME);

  const articlesSnap = await db.collection("faqArticles").get();
  const categoriesSnap = await db.collection("faqCategories").get();
  const categoryNameById = new Map(categoriesSnap.docs.map((d) => [d.id, (d.data() || {}).name || ""]));

  const byProgram = new Map(); // programId or "(none)" -> count
  let assigned = 0;
  let flaggedForReview = 0;

  for (const articleDoc of articlesSnap.docs) {
    const a = articleDoc.data() || {};
    const key = a.programId || "(none)";
    byProgram.set(key, (byProgram.get(key) || 0) + 1);

    if (a.programId) continue; // already scoped — never overwritten here

    const categoryName = categoryNameById.get(a.categoryId) || "";
    const looksLikeConsoleContent = CONSOLE_SIGNAL_RE.test(`${a.title || ""} ${categoryName}`);

    if (looksLikeConsoleContent) {
      flaggedForReview++;
      console.log(`FLAGGED for manual review (looks console-related, not auto-assigned): ${articleDoc.id} — "${a.title || ""}" (category: ${categoryName || "none"})`);
      continue;
    }

    if (!reportOnly) {
      await articleDoc.ref.set({ programId, updatedAt: Timestamp.now() }, { merge: true });
    }
    assigned++;
  }

  console.log(`\nFAQ program audit (${reportOnly ? "report only, no writes" : "backfill applied"}):`);
  for (const [key, count] of byProgram) console.log(`  ${key}: ${count}`);
  console.log(`\n${assigned} previously-unscoped article(s) ${reportOnly ? "would be" : "were"} assigned to "${PROGRAM_NAME}"${programId ? ` (${programId})` : ""}.`);
  console.log(`${flaggedForReview} previously-unscoped article(s) flagged as possibly console-related and left unassigned for a person to route in FAQ Management.`);
}

main().catch((err) => {
  console.error("FAQ program backfill failed:", err);
  process.exit(1);
});
