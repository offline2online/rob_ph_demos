// Export help-centre content FROM Firestore into the repo snapshot
// (faq/data/index.json + faq/data/articles/<id>.json + faq/data/releases.json).
//
//   node faq-export.js
//
// This is the Firestore → repo direction: after someone edits an article in
// the admin console, running this (the "FAQ content" GitHub Action does it
// on a schedule and on demand) regenerates the static files the public site
// serves, and the workflow commits them if anything changed. See faq-sync.js
// for the opposite direction and the conflict rules.
//
// Draft articles ARE exported (with status "draft") so that flipping one to
// published in the console shows up on the next export; the public site only
// ever renders status "published".
const path = require("path");
const fs = require("fs");
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { buildIndexFromArticleFiles, validateIndexAgainstArticleFiles, serializeIndex } = require("./faq-index-lib");
// The field allow-list is shared with the live feed (GET /help-api/data/*), so
// the two can never disagree about what a published article looks like.
const { categoryRecord, articleRecord, releaseRecord, serializeArticle, serializeReleases } = require("../functions/faq-feed");

const DATA_DIR = path.resolve(__dirname, "../../faq/data");
initializeApp({ credential: applicationDefault() });
const db = getFirestore();

async function main() {
  const catsSnap = await db.collection("faqCategories").orderBy("order", "asc").get();
  const categories = catsSnap.docs.map((d) => categoryRecord(d.id, d.data()));

  const artsSnap = await db.collection("faqArticles").get();
  const articlesDir = path.join(DATA_DIR, "articles");
  fs.mkdirSync(articlesDir, { recursive: true });
  const keep = new Set();
  for (const d of artsSnap.docs) {
    const a = d.data();
    if (a.retiredAt && a.status !== "published") continue; // retired: not part of the snapshot
    const record = articleRecord(d.id, a);
    keep.add(d.id);
    fs.writeFileSync(path.join(articlesDir, `${d.id}.json`), serializeArticle(record));
  }
  // Remove body files for articles that no longer exist in Firestore.
  for (const f of fs.readdirSync(articlesDir)) {
    const id = f.replace(/\.json$/, "");
    if (!keep.has(id)) { fs.unlinkSync(path.join(articlesDir, f)); console.log(`removed stale ${f}`); }
  }
  categories.sort((x, y) => x.order - y.order || x.id.localeCompare(y.id));

  // Derive the "articles" list straight from the per-article files just
  // written above, rather than a second hand-rolled sort kept in sync with
  // this one — this is the exact same function the deploy train's merge
  // conflict resolver uses to rebuild index.json from faq/data/articles/*.json
  // alone (see run-backlog-automation.js), so the two can never disagree on
  // what "the index" means.
  const index = buildIndexFromArticleFiles(articlesDir, categories, new Date().toISOString().replace(/\.\d{3}Z$/, "Z"));
  validateIndexAgainstArticleFiles(index, articlesDir);
  const articles = index.articles;

  // Only rewrite index.json when something other than generatedAt changed,
  // so a no-op export produces no git diff.
  const indexPath = path.join(DATA_DIR, "index.json");
  let previous = null;
  try { previous = JSON.parse(fs.readFileSync(indexPath, "utf8")); } catch { /* first export */ }
  const same = previous && JSON.stringify({ ...previous, generatedAt: "" }) === JSON.stringify({ ...index, generatedAt: "" });
  if (!same) fs.writeFileSync(indexPath, serializeIndex(index));
  console.log(`faq-export: ${categories.length} categories, ${articles.length} articles (${articles.filter((a) => a.status === "published").length} published)${same ? " — index unchanged" : ""}`);

  // Site-wide settings (kup9Zce13jyaXcIhxVkf) — currently just the
  // analytics tag appended to every customer-facing FAQ page. Edited from
  // the console's Settings page (settings/faqSite in Firestore); this is
  // the only thing that carries it into a file the public site — which
  // never talks to Firestore directly for anything but article content —
  // can actually read. Same "only rewrite if it changed" treatment as
  // index.json, so a no-op export produces no git diff here either.
  const settingsDoc = await db.collection("settings").doc("faqSite").get();
  const settings = { analyticsTag: (settingsDoc.exists && settingsDoc.data().analyticsTag) || null };
  const settingsPath = path.join(DATA_DIR, "settings.json");
  let previousSettings = null;
  try { previousSettings = JSON.parse(fs.readFileSync(settingsPath, "utf8")); } catch { /* first export */ }
  if (JSON.stringify(previousSettings) !== JSON.stringify(settings)) {
    fs.writeFileSync(settingsPath, JSON.stringify(settings) + "\n");
    console.log("faq-export: settings.json updated");
  }

  // Releases — the public site's only view of them. faq-data.js resolves a
  // reader's ?release= (or, by default, the highest-order live release)
  // against this list and hides articles bound outside it; an empty list
  // means the feature isn't in use and nothing is filtered. Order ascending,
  // which is also creation order (order is assigned once and never moves).
  // Same "only rewrite if it changed" treatment as the files above.
  const releasesSnap = await db.collection("releases").get();
  const releases = releasesSnap.docs.map((d) => releaseRecord(d.id, d.data()));
  releases.sort((x, y) => x.order - y.order || x.id.localeCompare(y.id));
  const releasesPath = path.join(DATA_DIR, "releases.json");
  let previousReleases = null;
  try { previousReleases = JSON.parse(fs.readFileSync(releasesPath, "utf8")); } catch { /* first export */ }
  if (JSON.stringify(previousReleases) !== JSON.stringify(releases)) {
    fs.writeFileSync(releasesPath, serializeReleases(releases));
    console.log(`faq-export: releases.json updated (${releases.length} releases, ${releases.filter((r) => r.status === "live").length} live)`);
  }
}

main().catch((err) => { console.error("faq-export failed:", err); process.exit(1); });
