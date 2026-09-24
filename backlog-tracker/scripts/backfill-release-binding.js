// One-off (but safe-to-repeat) backfill for faqArticles.introducedInReleaseId,
// plus an always-useful audit report (run with --report-only to just print
// counts and change nothing).
//
// Releases (the console's Releases page; Firestore `releases`) let an FAQ
// article be bound to the range of releases it documents — introduced in
// one, optionally removed in a later one — and the public help centre
// (faq/js/faq-data.js) and the MCP server's search_faq/get_faq_article then
// show only the articles that apply to the target release, by default the
// current live one. Every article written before releases existed has no
// binding at all, which those readers treat as "applies to every release",
// so nothing disappears on the day releases are adopted. But it also means
// a later release can't retire one of those articles cleanly, and nothing
// records that they describe the product as it stood when releases began.
// This stamps each of them with the release that is live right now: the
// honest "this was already true at this release" starting point.
//
//   node backfill-release-binding.js --report-only   # counts only, no writes
//   node backfill-release-binding.js                 # apply
//
// Idempotent: only ever sets introducedInReleaseId on an article that
// doesn't already have one — a binding chosen by hand in the article editor
// is never overwritten by a later re-run. It deliberately leaves updatedAt
// alone (unlike backfill-faq-program.js): the public site shows updatedAt to
// readers as the article's "last updated" date, and binding every article to
// a release doesn't change a word any reader sees.
//
// Needs a live release to bind to. "Current live release" means the same
// thing it does everywhere else — the highest `order` among releases whose
// status is "live" — and with none, there is nothing correct to write, so
// this exits 1 (report-only still runs and says so, without failing).

const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

async function findCurrentLiveRelease() {
  const snap = await db.collection("releases").get();
  const releases = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  const live = releases
    .filter((r) => r.status === "live")
    .sort((x, y) => (Number(y.order) || 0) - (Number(x.order) || 0));
  return { total: releases.length, release: live[0] || null };
}

function describeRelease(r) {
  return `"${r.name || r.id}"${r.version ? ` (${r.version})` : ""} [${r.id}, order ${r.order}]`;
}

async function main() {
  const reportOnly = process.argv.includes("--report-only");
  const { total, release } = await findCurrentLiveRelease();

  if (!release) {
    const why = total === 0
      ? "0 releases exist, nothing to backfill to."
      : `${total} release(s) exist but none is live yet, nothing to backfill to — mark one live on the console's Releases page first.`;
    if (reportOnly) {
      console.log(`FAQ release-binding audit (report only, no writes): ${why}`);
      return;
    }
    console.error(`FAQ release-binding backfill: ${why}`);
    process.exit(1);
  }

  const articlesSnap = await db.collection("faqArticles").get();

  const byRelease = new Map(); // introducedInReleaseId or "(none)" -> count
  let assigned = 0;
  let removedBound = 0;

  for (const articleDoc of articlesSnap.docs) {
    const a = articleDoc.data() || {};
    const key = a.introducedInReleaseId || "(none)";
    byRelease.set(key, (byRelease.get(key) || 0) + 1);
    if (a.removedInReleaseId) removedBound++;

    if (a.introducedInReleaseId) continue; // already bound — never overwritten here

    if (!reportOnly) {
      await articleDoc.ref.set({ introducedInReleaseId: release.id }, { merge: true });
    }
    assigned++;
  }

  console.log(`\nFAQ release-binding audit (${reportOnly ? "report only, no writes" : "backfill applied"}):`);
  console.log(`  current live release: ${describeRelease(release)}`);
  console.log("  introducedInReleaseId:");
  for (const [key, count] of byRelease) console.log(`    ${key}: ${count}`);
  console.log(`  articles with a removedInReleaseId: ${removedBound}`);
  console.log(`\n${assigned} previously-unbound article(s) ${reportOnly ? "would be" : "were"} bound to ${describeRelease(release)} as their introduction release.`);
}

main().catch((err) => {
  console.error("FAQ release-binding backfill failed:", err);
  process.exit(1);
});
