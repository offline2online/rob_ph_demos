// Publish the help-centre snapshot in the repo (faq/data/) INTO Firestore.
//
//   node faq-sync.js [--dry-run] [--force]
//
// The public site (repo-root faq/) renders faq/data/index.json +
// faq/data/articles/<id>.json. Firestore (faqCategories / faqArticles) is
// where the admin console edits content. This script is the repo → Firestore
// direction, used when content is authored or bulk-edited in git (as the
// September 2026 rewrite was). faq-export.js is the other direction.
//
// Safety rules — it is meant to be safe to run on every push:
//   • A document is only written when the file differs from what Firestore
//     holds (compared by contentHash + the metadata fields).
//   • A document that was edited in the console AFTER the last sync
//     (updatedAt > syncedAt) is never overwritten unless --force is given;
//     it is reported as a conflict instead. Resolve by exporting
//     (faq-export.js) and re-committing, or by re-authoring the file.
//   • Nothing is ever deleted. Ids listed in faq/data/retired.json are set to
//     status "draft" (hidden from the public site) if they are still
//     published — that is how the rewrite retired merged/duplicate articles.
//   • Nothing deleted in the console is ever recreated. The console writes
//     a tombstone (faqDeletedArticles/<id>, faqDeletedCategories/<id>) the
//     moment an editor deletes something; a tombstoned id is skipped here
//     even while its file is still in faq/data (faq-export.js drops the
//     file on its next run). 25 Sep 2026: without this, a stale snapshot
//     — or the Freshdesk seed — brought deleted articles straight back.
//   • Fields this script does not own (programId, projectId, needsReview,
//     views…) are left untouched on existing docs.
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");

const DATA_DIR = path.resolve(__dirname, "../../faq/data");
const DRY = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");
const PROGRAM_NAME = "Personalisation Hub";

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

const hash = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
const catHash = (c) => hash(JSON.stringify([c.name, c.icon, c.description || "", c.order, c.parentId || null]));
const toMillis = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : v ? new Date(v).getTime() : 0);

async function findOrCreateProgram(name) {
  const existing = await db.collection("programs").where("name", "==", name).limit(1).get();
  if (!existing.empty) return existing.docs[0].id;
  if (DRY) return null;
  const ref = await db.collection("programs").add({ name, createdAt: Timestamp.now() });
  return ref.id;
}

// Ids the console has deleted — see the header. Read once per run.
async function tombstoneIds(collectionName) {
  const snap = await db.collection(collectionName).get();
  return new Set(snap.docs.map((d) => d.id));
}

async function main() {
  const index = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "index.json"), "utf8"));
  const retired = fs.existsSync(path.join(DATA_DIR, "retired.json"))
    ? JSON.parse(fs.readFileSync(path.join(DATA_DIR, "retired.json"), "utf8")) : [];
  const programId = await findOrCreateProgram(PROGRAM_NAME);
  const deletedCategories = await tombstoneIds("faqDeletedCategories");
  const deletedArticles = await tombstoneIds("faqDeletedArticles");
  const stats = { created: 0, updated: 0, unchanged: 0, conflicts: 0, retired: 0, deleted: 0 };
  const now = Timestamp.now();

  // Categories (top-level and folders share the collection).
  for (const c of index.categories) {
    const ref = db.collection("faqCategories").doc(c.id);
    const snap = await ref.get();
    if (!snap.exists && deletedCategories.has(c.id)) {
      console.log(`skip category ${c.id} (${c.name}): deleted in the console — not recreated (tombstone)`);
      stats.deleted++; continue;
    }
    const fields = { name: c.name, icon: c.icon || "help", description: c.description || "", order: c.order, parentId: c.parentId || null };
    const h = catHash(c);
    if (snap.exists) {
      const d = snap.data();
      if (d.contentHash === h) { stats.unchanged++; continue; }
      // XFeVboxWduEPT2zGcj8y: a doc that has never been through this script
      // (no syncedAt — e.g. it only ever went through faq-export.js after a
      // console edit) used to skip this guard entirely, so a stale repo
      // snapshot could silently overwrite a newer console edit with no
      // conflict logged. Fall back to createdAt as the baseline: if the doc
      // has been touched at all since it was created, treat that the same
      // as an edit-after-sync rather than assuming the repo is still current.
      if (!FORCE && toMillis(d.updatedAt) > toMillis(d.syncedAt || d.createdAt) + 1000) {
        console.warn(`CONFLICT category ${c.id} (${c.name}): edited in console after last sync — skipped (use --force)`);
        stats.conflicts++; continue;
      }
      console.log(`update category ${c.id} (${c.name})`);
      if (!DRY) await ref.set({ ...fields, contentHash: h, syncedAt: now, updatedAt: now }, { merge: true });
      stats.updated++;
    } else {
      console.log(`create category ${c.id} (${c.name})`);
      if (!DRY) await ref.set({ ...fields, contentHash: h, syncedAt: now, createdAt: now, updatedAt: now });
      stats.created++;
    }
  }

  // Articles.
  for (const meta of index.articles) {
    const file = path.join(DATA_DIR, "articles", `${meta.id}.json`);
    if (!fs.existsSync(file)) { console.warn(`missing body file for ${meta.id}`); continue; }
    const a = JSON.parse(fs.readFileSync(file, "utf8"));
    const body = a.bodyMd || "";
    const h = hash(body + "|" + JSON.stringify([a.categoryId, a.order, a.title, a.slug, a.summary, a.keywords, a.docType, a.status]));
    const ref = db.collection("faqArticles").doc(a.id);
    const snap = await ref.get();
    if (!snap.exists && deletedArticles.has(a.id)) {
      console.log(`skip article ${a.id} (${a.title}): deleted in the console — not recreated (tombstone)`);
      stats.deleted++; continue;
    }
    const fields = {
      categoryId: a.categoryId, order: a.order, title: a.title, slug: a.slug, summary: a.summary || "",
      keywords: a.keywords || [], docType: a.docType || "faq", status: a.status || "draft", bodyMd: body,
    };
    if (snap.exists) {
      const d = snap.data();
      if (d.contentHash === h) { stats.unchanged++; continue; }
      // Same content, different bookkeeping (e.g. the file came from
      // faq-export.js after a console edit): just re-stamp, no conflict.
      const sameContent = Object.keys(fields).every((k) => JSON.stringify(d[k] === undefined ? (k === "keywords" ? [] : "") : d[k]) === JSON.stringify(fields[k]));
      if (sameContent) {
        if (!DRY) await ref.set({ contentHash: h, syncedAt: now }, { merge: true });
        stats.unchanged++; continue;
      }
      // XFeVboxWduEPT2zGcj8y: same baseline fix as the category branch above
      // — a doc with no syncedAt yet must not be treated as "safe to
      // overwrite", or a console edit made before its first sync gets
      // silently reverted by a stale repo snapshot.
      if (!FORCE && toMillis(d.updatedAt) > toMillis(d.syncedAt || d.createdAt) + 1000) {
        console.warn(`CONFLICT article ${a.id} (${a.title}): edited in console after last sync — skipped (use --force)`);
        stats.conflicts++; continue;
      }
      console.log(`update article ${a.id} (${a.title})`);
      const extra = fields.status === "published" && d.status !== "published" ? { publishedAt: now } : {};
      if (!DRY) await ref.set({ ...fields, ...extra, contentHash: h, syncedAt: now, updatedAt: now }, { merge: true });
      stats.updated++;
    } else {
      console.log(`create article ${a.id} (${a.title})`);
      if (!DRY) await ref.set({
        ...fields, contentHash: h, syncedAt: now, createdAt: now, updatedAt: now,
        ...(fields.status === "published" ? { publishedAt: now } : {}),
        ...(programId ? { programId } : {}), projectId: null, needsReview: false,
      });
      stats.created++;
    }
  }

  // Retired ids: hide from the public site, never delete.
  for (const id of retired) {
    const ref = db.collection("faqArticles").doc(id);
    const snap = await ref.get();
    if (!snap.exists || snap.data().status !== "published") continue;
    console.log(`retire article ${id} (${snap.data().title}) → draft`);
    if (!DRY) await ref.set({ status: "draft", retiredAt: now, updatedAt: now, syncedAt: now }, { merge: true });
    stats.retired++;
  }

  console.log(`faq-sync${DRY ? " (dry run)" : ""}: ${stats.created} created, ${stats.updated} updated, ${stats.unchanged} unchanged, ${stats.retired} retired, ${stats.deleted} left deleted (tombstoned), ${stats.conflicts} conflict(s)`);
  if (stats.conflicts && !DRY) process.exitCode = 0; // conflicts are reported, not fatal
}

main().catch((err) => { console.error("faq-sync failed:", err); process.exit(1); });
