// The help centre's published content as data: ONE definition of what a
// published article, a category and a release look like in faq/data, used by
//
//   - scripts/faq-export.js (Firestore -> faq/data files, hourly), and
//   - functions/help-search.js (GET /help-api/data/*, the live feed the
//     WordPress Support Centre sync reads), and
//   - the refresh ping below (a published-content change -> POST to the
//     Support Centre so it re-reads that feed within about two minutes).
//
// Sharing the record builders is the point: the feed's field names and
// allow-list cannot drift from the files the export commits, because they
// are the same function. An article record is an allow-list of live fields;
// `pendingRevision`, `retireProposal`, `retiredAt` and every other
// editor-only field are simply never copied.
"use strict";

const crypto = require("crypto");

const hash = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
const iso = (v) => (v && typeof v.toDate === "function" ? v.toDate().toISOString().replace(/\.\d{3}Z$/, "Z") : typeof v === "string" ? v : null);

// The longest description the Support Centre (SEOPress) uses, and the
// console's limit on metaDescription.
const META_DESCRIPTION_MAX = 155;

// A summary shortened to at most `max` characters, cut at a word boundary
// and ending "…", or "" when it already fits (the Support Centre then uses
// the summary itself). Used only when an article has no metaDescription.
function descriptionFromSummary(summary, max = META_DESCRIPTION_MAX) {
  const s = String(summary || "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return "";
  const room = s.slice(0, max); // "…" takes the last character
  const lastSpace = room.lastIndexOf(" ");
  const cut = (lastSpace > 0 ? room.slice(0, lastSpace) : room.slice(0, max - 1)).replace(/[\s,;:—–-]+$/u, "");
  return cut + "…";
}

function categoryRecord(id, c) {
  return { id, name: c.name || "", icon: c.icon || "help", description: c.description || "", order: c.order || 0, parentId: c.parentId || null };
}

// One faq/data/articles/<id>.json record (meta + bodyMd). `nowIso` is the
// updatedAt of last resort for an article with no date at all.
function articleRecord(id, a, nowIso = new Date().toISOString()) {
  const body = a.bodyMd || "";
  const meta = {
    id, categoryId: a.categoryId || "", order: a.order || 0, title: a.title || "", slug: a.slug || id,
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
    // snapshot line is byte-for-byte what it was before releases existed.
    // SEO & agent fields (rri7DngI2ccd7q4uYdk6) — the WordPress Support
    // Centre publish reads these. Only written when set.
    ...(a.seoTitle ? { seoTitle: a.seoTitle } : {}),
    ...(a.metaDescription ? { metaDescription: a.metaDescription } : {}),
    // No metaDescription and a summary too long for one (m67BT2oDMCiDHXw7ooAq):
    // the Support Centre fell back to cutting the summary at 155 characters,
    // mid-word ("…queu", "…campai"). seoDescription is the first name it
    // reads (ph-website/snippets/ph-support-centre/main.php → upsert), so a
    // word-boundary cut here is what it publishes. Derived, never stored in
    // Firestore (faq-sync.js does not read it); an editor's metaDescription
    // always wins.
    ...(!a.metaDescription && descriptionFromSummary(a.summary) ? { seoDescription: descriptionFromSummary(a.summary) } : {}),
    ...(a.directAnswer ? { directAnswer: a.directAnswer } : {}),
    ...(Array.isArray(a.questionVariants) && a.questionVariants.length ? { questionVariants: a.questionVariants } : {}),
    ...(a.articleType ? { articleType: a.articleType } : {}),
    ...(a.introducedInReleaseId ? { introducedInReleaseId: a.introducedInReleaseId } : {}),
    ...(a.removedInReleaseId ? { removedInReleaseId: a.removedInReleaseId } : {}),
    updatedAt: iso(a.updatedAt) || iso(a.publishedAt) || nowIso,
    contentHash: hash(body),
  };
  return { ...meta, bodyMd: body };
}

function releaseRecord(id, r) {
  return { id, name: r.name || "", version: r.version || null, status: r.status === "live" ? "live" : "draft", order: Number(r.order) || 0 };
}

const sortReleases = (list) => list.sort((x, y) => x.order - y.order || x.id.localeCompare(y.id));
const sortCategories = (list) => list.sort((x, y) => x.order - y.order || x.id.localeCompare(y.id));

// index.json from records, in the order the public site lists them (a folder
// sorts under its parent category). `records` may carry bodyMd; it is dropped.
function buildIndex(categories, records, generatedAt) {
  const articles = records.map(({ bodyMd, ...meta }) => meta); // eslint-disable-line no-unused-vars
  const catOrder = new Map(
    categories.map((c) => [c.id, c.parentId ? (categories.find((p) => p.id === c.parentId) || {}).order || 0 : c.order])
  );
  articles.sort(
    (x, y) => (catOrder.get(x.categoryId) || 0) - (catOrder.get(y.categoryId) || 0) || x.order - y.order || x.id.localeCompare(y.id)
  );
  return { generatedAt, categories, articles };
}

// One category/article per line inside an otherwise pretty-printed structure
// (see scripts/faq-index-lib.js for why).
function serializeIndex(index) {
  const catLines = index.categories.map((c) => "    " + JSON.stringify(c)).join(",\n");
  const artLines = index.articles.map((a) => "    " + JSON.stringify(a)).join(",\n");
  return (
    "{\n" +
    `  "generatedAt": ${JSON.stringify(index.generatedAt)},\n` +
    '  "categories": [\n' +
    (catLines ? catLines + "\n" : "") +
    "  ],\n" +
    '  "articles": [\n' +
    (artLines ? artLines + "\n" : "") +
    "  ]\n" +
    "}\n"
  );
}

const serializeArticle = (record) => JSON.stringify(record, null, 0) + "\n";
const serializeReleases = (releases) => JSON.stringify(releases, null, 2) + "\n";

// ── Does a write change what the public sees? ───────────────────────────────
// Drives the refresh ping. Compares the public projection only, so editing a
// draft, a pendingRevision or a retire proposal never pings.
function publicArticleView(id, a) {
  if (!a || a.status !== "published") return null;
  const { updatedAt, ...rest } = articleRecord(id, a, ""); // eslint-disable-line no-unused-vars
  return JSON.stringify(rest);
}
function articleChangesPublished(id, before, after) {
  return publicArticleView(id, before) !== publicArticleView(id, after);
}
function categoryChangesPublished(id, before, after) {
  const view = (c) => (c ? JSON.stringify(categoryRecord(id, c)) : null);
  return view(before) !== view(after);
}

// ── Refresh ping, debounced ─────────────────────────────────────────────────
const REFRESH_URL = "https://personalisationhub.com/wp-json/ph-help/v1/refresh";
const REFRESH_TIMEOUT_MS = 4000;
const REFRESH_MIN_GAP_MS = 60 * 1000; // at most one call per 60 s
const REFRESH_COALESCE_MS = 5 * 1000; // quick edits in this window share one call

// `store.claim(nowMs, coalesceMs, gapMs)` atomically decides what this
// invocation does: null (another invocation already holds a pending ping, and
// it fires after this write, so it covers it) or the time to fire at.
// `store.done(nowMs)` records the ping. Never retried; failures are logged.
function createRefreshPinger({ store, fetchImpl = (typeof fetch === "function" ? fetch : null), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now(), logger = null, url = REFRESH_URL }) {
  async function ping() {
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), REFRESH_TIMEOUT_MS) : null;
    try {
      if (!fetchImpl) throw new Error("no fetch");
      const res = await fetchImpl(url, { method: "POST", signal: ctl ? ctl.signal : undefined });
      if (logger) logger.info("help refresh ping sent", { url, status: res.status });
      return { sent: true, status: res.status };
    } catch (e) {
      if (logger) logger.warn("help refresh ping failed", { url, error: String(e) });
      return { sent: false, error: String(e) };
    } finally { if (timer) clearTimeout(timer); }
  }
  async function request() {
    const t = now();
    const fireAt = await store.claim(t, REFRESH_COALESCE_MS, REFRESH_MIN_GAP_MS);
    if (fireAt == null) return { skipped: true };
    const wait = fireAt - t;
    if (wait > 0) await sleep(wait);
    const r = await ping();
    await store.done(now());
    return { skipped: false, ...r };
  }
  return { request, ping };
}

// Firestore-backed claim/done on one small document.
function firestoreRefreshStore(db, docPath = "settings/faqRefreshPing") {
  const ref = () => db.doc(docPath);
  return {
    async claim(nowMs, coalesceMs, gapMs) {
      return db.runTransaction(async (tx) => {
        const s = await tx.get(ref());
        const d = s.exists ? s.data() : {};
        if (Number(d.pendingUntil) > nowMs) return null;
        const fireAt = Math.max(nowMs + coalesceMs, (Number(d.lastPingAt) || 0) + gapMs);
        tx.set(ref(), { pendingUntil: fireAt }, { merge: true });
        return fireAt;
      });
    },
    async done(nowMs) { await ref().set({ lastPingAt: nowMs, pendingUntil: 0 }, { merge: true }); },
  };
}

module.exports = {
  hash, iso, categoryRecord, articleRecord, releaseRecord, sortReleases, sortCategories,
  descriptionFromSummary, META_DESCRIPTION_MAX,
  buildIndex, serializeIndex, serializeArticle, serializeReleases,
  articleChangesPublished, categoryChangesPublished,
  createRefreshPinger, firestoreRefreshStore,
  REFRESH_URL, REFRESH_TIMEOUT_MS, REFRESH_MIN_GAP_MS, REFRESH_COALESCE_MS,
};
