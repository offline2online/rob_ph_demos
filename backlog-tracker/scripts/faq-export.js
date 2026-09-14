// Export help-centre content FROM Firestore into the repo snapshot
// (faq/data/index.json + faq/data/articles/<id>.json).
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
  const catOrder = new Map(categories.map((c) => [c.id, c.parentId ? (categories.find((p) => p.id === c.parentId) || {}).order || 0 : c.order]));

  const artsSnap = await db.collection("faqArticles").get();
  const articles = [];
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
      updatedAt: iso(a.updatedAt) || iso(a.publishedAt) || new Date().toISOString(),
      contentHash: hash(body),
    };
    articles.push(meta);
    keep.add(d.id);
    fs.writeFileSync(path.join(articlesDir, `${d.id}.json`), JSON.stringify({ ...meta, bodyMd: body }, null, 0) + "\n");
  }
  // Remove body files for articles that no longer exist in Firestore.
  for (const f of fs.readdirSync(articlesDir)) {
    const id = f.replace(/\.json$/, "");
    if (!keep.has(id)) { fs.unlinkSync(path.join(articlesDir, f)); console.log(`removed stale ${f}`); }
  }
  articles.sort((x, y) => (catOrder.get(x.categoryId) || 0) - (catOrder.get(y.categoryId) || 0) || (x.order - y.order) || x.id.localeCompare(y.id));
  categories.sort((x, y) => x.order - y.order || x.id.localeCompare(y.id));

  const index = { generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), categories, articles };
  // Only rewrite index.json when something other than generatedAt changed,
  // so a no-op export produces no git diff.
  const indexPath = path.join(DATA_DIR, "index.json");
  let previous = null;
  try { previous = JSON.parse(fs.readFileSync(indexPath, "utf8")); } catch { /* first export */ }
  const same = previous && JSON.stringify({ ...previous, generatedAt: "" }) === JSON.stringify({ ...index, generatedAt: "" });
  if (!same) fs.writeFileSync(indexPath, JSON.stringify(index) + "\n");
  console.log(`faq-export: ${categories.length} categories, ${articles.length} articles (${articles.filter((a) => a.status === "published").length} published)${same ? " — index unchanged" : ""}`);
}

main().catch((err) => { console.error("faq-export failed:", err); process.exit(1); });
