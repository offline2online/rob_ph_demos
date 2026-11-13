// Help-centre copy and description rules (m67BT2oDMCiDHXw7ooAq, 13 Nov 2026).
//
//   1. The sync's conflict rule (scripts/faq-sync-lib.js): an article whose
//      live fields still match the last sync is not "edited in the console"
//      just because a pendingRevision or retire proposal bumped updatedAt.
//   2. The fallback description (functions/faq-feed.js): a summary longer than
//      155 characters is cut at a word boundary, never mid-word.
//   3. The published snapshot in faq/data: every article's description fits
//      and ends on a full word, and the retired word, client names and US
//      spellings the 13 Nov website check removed have not come back.
//
// Run with: node test/faq-copy.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const feed = require("../functions/faq-feed");
const { articleSyncHash, categorySyncHash, editedSinceSync } = require("../scripts/faq-sync-lib");

let passed = 0; const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (e) { failures.push(name); console.log(`FAIL  ${name}\n      ${e && e.stack}`); }
}

const ts = (iso) => ({ toMillis: () => new Date(iso).getTime() });
const article = { categoryId: "c1", order: 1, title: "T", slug: "t", summary: "S", keywords: ["k"], docType: "how-to", status: "published", bodyMd: "<p>B</p>" };

// ── 1. Sync conflict rule ───────────────────────────────────────────────────
test("unchanged since sync: not a conflict", () => {
  const d = { ...article, contentHash: articleSyncHash(article), syncedAt: ts("2026-09-17T00:00:00Z"), updatedAt: ts("2026-09-17T00:00:00Z") };
  assert.strictEqual(editedSinceSync(d, articleSyncHash(d)), false);
});

test("a pending revision parked after the sync is not a conflict", () => {
  const d = { ...article, contentHash: articleSyncHash(article), syncedAt: ts("2026-09-17T00:00:00Z"), updatedAt: ts("2026-11-05T22:52:56Z"),
    pendingRevision: { bodyMd: "<p>Proposed</p>", proposedAt: "2026-11-05T22:52:56Z" }, needsReview: true };
  assert.strictEqual(editedSinceSync(d, articleSyncHash(d)), false);
});

test("a live console edit after the sync is still a conflict", () => {
  const d = { ...article, contentHash: articleSyncHash(article), syncedAt: ts("2026-09-17T00:00:00Z"), updatedAt: ts("2026-11-05T00:00:00Z"), bodyMd: "<p>Edited live</p>" };
  assert.strictEqual(editedSinceSync(d, articleSyncHash(d)), true);
});

test("a live SEO edit after the sync is a conflict", () => {
  const d = { ...article, contentHash: articleSyncHash(article), syncedAt: ts("2026-09-17T00:00:00Z"), updatedAt: ts("2026-11-05T00:00:00Z"), metaDescription: "New." };
  assert.strictEqual(editedSinceSync(d, articleSyncHash(d)), true);
});

test("never synced (no syncedAt): falls back to updatedAt vs createdAt", () => {
  const d = { ...article, contentHash: articleSyncHash(article), createdAt: ts("2026-09-01T00:00:00Z"), updatedAt: ts("2026-09-02T00:00:00Z") };
  assert.strictEqual(editedSinceSync(d, articleSyncHash(d)), true);
  assert.strictEqual(editedSinceSync({ ...d, updatedAt: ts("2026-09-01T00:00:00Z") }, articleSyncHash(d)), false);
});

test("no stored contentHash: falls back to the timestamps", () => {
  const d = { ...article, syncedAt: ts("2026-09-17T00:00:00Z"), updatedAt: ts("2026-11-05T00:00:00Z") };
  assert.strictEqual(editedSinceSync(d, articleSyncHash(d)), true);
});

test("articleSyncHash: SEO fields change the hash only when set", () => {
  assert.strictEqual(articleSyncHash({ ...article, metaDescription: "", questionVariants: [] }), articleSyncHash(article));
  assert.notStrictEqual(articleSyncHash({ ...article, metaDescription: "M" }), articleSyncHash(article));
});

test("category: a rename after the sync is a conflict, a touch is not", () => {
  const c = { name: "Displays", icon: "tv", description: "D", order: 1, parentId: null };
  const d = { ...c, contentHash: categorySyncHash(c), syncedAt: ts("2026-09-17T00:00:00Z"), updatedAt: ts("2026-11-05T00:00:00Z") };
  assert.strictEqual(editedSinceSync(d, categorySyncHash(d)), false);
  const renamed = { ...d, name: "Screens" };
  assert.strictEqual(editedSinceSync(renamed, categorySyncHash(renamed)), true);
});

// ── 2. Fallback description ─────────────────────────────────────────────────
const LONG = "Find the fix for what you are seeing: every symptom-first article in the help centre, grouped by access, set-up, messaging, displays, mobile sites and queueing.";

test("descriptionFromSummary: a summary that fits needs no description", () => {
  assert.strictEqual(feed.descriptionFromSummary("Short summary."), "");
  assert.strictEqual(feed.descriptionFromSummary("x".repeat(155)), "");
});

test("descriptionFromSummary: a long summary is cut at a word boundary with an ellipsis", () => {
  const d = feed.descriptionFromSummary(LONG);
  assert.ok(d.length <= 155, `${d.length} chars`);
  assert.ok(d.endsWith("…"));
  const words = d.slice(0, -1);
  assert.ok(LONG.startsWith(words), "is a prefix of the summary");
  assert.ok(/\s/.test(LONG[words.length]) || /[,;:]/.test(LONG[words.length]), `cut mid-word: "…${words.slice(-12)}|${LONG.slice(words.length, words.length + 6)}"`);
  assert.ok(!/queu$/.test(words));
});

test("descriptionFromSummary: no dangling dash or comma before the ellipsis", () => {
  const s = "The 3 primary use cases — connected retail experience, first-party retail media targeting and hyper-localised campaigns for every store — and why passer-by traffic leads.";
  const d = feed.descriptionFromSummary(s);
  assert.ok(d.length <= 155);
  assert.ok(!/[\s,;:—–-]…$/u.test(d), d);
});

test("articleRecord: seoDescription only when there is no metaDescription and the summary is too long", () => {
  const base = { title: "T", status: "published", bodyMd: "b", updatedAt: "2026-11-13T00:00:00Z" };
  assert.strictEqual(feed.articleRecord("a", { ...base, summary: "Short." }).seoDescription, undefined);
  assert.strictEqual(feed.articleRecord("a", { ...base, summary: LONG }).seoDescription, feed.descriptionFromSummary(LONG));
  const withMeta = feed.articleRecord("a", { ...base, summary: LONG, metaDescription: "Editor's own." });
  assert.strictEqual(withMeta.seoDescription, undefined);
  assert.strictEqual(withMeta.metaDescription, "Editor's own.");
});

// ── 3. The published snapshot ───────────────────────────────────────────────
const DATA = path.resolve(__dirname, "../../faq/data");
const index = JSON.parse(fs.readFileSync(path.join(DATA, "index.json"), "utf8"));
const published = index.articles
  .filter((a) => a.status === "published")
  .map((a) => JSON.parse(fs.readFileSync(path.join(DATA, "articles", `${a.id}.json`), "utf8")));
const decode = (s) => String(s || "")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");

test("snapshot: every published article's description fits and ends on a full word", () => {
  const bad = [];
  for (const a of published) {
    // What the Support Centre publishes: metaDescription, else the derived
    // seoDescription, else the summary as it is.
    const desc = a.metaDescription || feed.articleRecord(a.id, a).seoDescription || a.summary || "";
    if (desc.length > 155) bad.push(`${a.id}: ${desc.length} characters`);
    if (a.metaDescription && !/[\p{L}\p{N}.!?)…]$/u.test(a.metaDescription)) bad.push(`${a.id}: metaDescription ends "${a.metaDescription.slice(-15)}"`);
  }
  assert.deepStrictEqual(bad, []);
});

// The 13 Nov 2026 website check. "enroll" is allowed only as Google's own
// "Enroll device" label, quoted exactly.
const BANNED = [
  // The pattern is written so the retired word itself never appears in backlog-tracker/.
  [/fr[a]nchis/i, "retired offer name (use \"brand\")"],
  [/\bOne\s*NZ\b/i, "client name (use the fictional \"Kestrel Mobile\")"],
  [/\boptimiz/i, "US spelling (optimis-)"],
  [/\bpersonaliz/i, "US spelling (personalis-)"],
  [/\bJavascript\b/, "\"JavaScript\""],
  [/\benroll(?!ed\b)(?! device\b)/i, "US spelling (enrol)"],
];

test("snapshot: no retired word, client name or US spelling in published copy", () => {
  const hits = [];
  for (const a of published) {
    for (const field of ["title", "summary", "metaDescription", "seoTitle", "directAnswer", "bodyMd"]) {
      const text = decode(a[field]);
      for (const [re, why] of BANNED) {
        const m = text.match(re);
        if (m) hits.push(`${a.id} ${field}: "${text.slice(Math.max(0, m.index - 30), m.index + 30)}" — ${why}`);
      }
    }
  }
  assert.deepStrictEqual(hits, []);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
