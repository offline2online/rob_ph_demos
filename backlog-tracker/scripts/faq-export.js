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
const crypto = require("crypto");
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { buildIndexFromArticleFiles, validateIndexAgainstArticleFiles, serializeIndex } = require("./faq-index-lib");

const DATA_DIR = path.resolve(__dirname, "../../faq/data");
initializeApp({ credential: applicationDefault() });
const db = getFirestore();

const hash = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
const iso = (v) => (v && typeof v.toDate === "function" ? v.toDate().toISOString().replace(/\.\d{3}Z$/, "Z") : typeof v === "string" ? v : null);

async function main() {
  const catsSnap = await db.collection("faqCategories").orderBy("order", "asc").get();
  const categories = catsSnap.docs.map((d) => {
    const c = d.data();
    return { id: d.id, name: c.name || "", icon: c.icon || "help", description: c.description || "", order: c.order || 0, parentId: c.parentId || null };
  });

  const artsSnap = await db.collection("faqArticles").get();
  const articlesDir = path.join(DATA_DIR, "articles");
  fs.mkdirSync(articlesDir, { recursive: true });
  const keep = new Set();
  for (const d of artsSnap.docs) {
    const a = d.data();
    if (a.retiredAt && a.status !== "published") continue; // retired: not part of the snapshot
    const body = a.bodyMd || "";
    const meta = {
      id: d.id, categoryId: a.categoryId || "", order: a.order || 0, title: a.title || "", slug: a.slug || d.id,
      summary: a.summary || "", keywords: Array.isArray(a.keywords) ? a.keywords : [], docType: a.docType || "faq",
      status: a.status === "published" ? "published" : "draft",
      // Editor-controlled topic/industry picker (fJ4kR2vTsWmXoP81nQeH) — splits
      // the rendered body into one block per <h2> and lets a reader narrow to
      // just one, right under the introduction. Off (the default) leaves every
      // article rendering exactly as before.
      sectionPicker: !!a.sectionPicker,
      sectionPickerLabel: a.sectionPickerLabel || "",
      // Release binding (console article editor → "Introduced in release" /
      // "Removed in release"). Only written when set, so an unbound article's
      // snapshot line — every article, until the backfill runs — is
      // byte-for-byte what it was before releases existed. faq-data.js reads
      // these against releases.json below.
      ...(a.introducedInReleaseId ? { introducedInReleaseId: a.introducedInReleaseId } : {}),
      ...(a.removedInReleaseId ? { removedInReleaseId: a.removedInReleaseId } : {}),
      updatedAt: iso(a.updatedAt) || iso(a.publishedAt) || new Date().toISOString(),
      contentHash: hash(body),
    };
    keep.add(d.id);
    fs.writeFileSync(path.join(articlesDir, `${d.id}.json`), JSON.stringify({ ...meta, bodyMd: body }, null, 0) + "\n");
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
  const releases = releasesSnap.docs.map((d) => {
    const r = d.data();
    return { id: d.id, name: r.name || "", version: r.version || null, status: r.status === "live" ? "live" : "draft", order: Number(r.order) || 0 };
  });
  releases.sort((x, y) => x.order - y.order || x.id.localeCompare(y.id));
  const releasesPath = path.join(DATA_DIR, "releases.json");
  let previousReleases = null;
  try { previousReleases = JSON.parse(fs.readFileSync(releasesPath, "utf8")); } catch { /* first export */ }
  if (JSON.stringify(previousReleases) !== JSON.stringify(releases)) {
    fs.writeFileSync(releasesPath, JSON.stringify(releases, null, 2) + "\n");
    console.log(`faq-export: releases.json updated (${releases.length} releases, ${releases.filter((r) => r.status === "live").length} live)`);
  }
}

main().catch((err) => { console.error("faq-export failed:", err); process.exit(1); });
