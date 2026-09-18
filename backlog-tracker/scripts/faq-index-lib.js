// Shared logic for building/validating/serializing faq/data/index.json,
// used by both directions of the FAQ content pipeline:
//
//   - faq-export.js (Firestore -> repo) uses buildIndexFromArticleFiles() to
//     derive the "articles" list from the per-article files it just wrote,
//     instead of keeping a second, hand-rolled sort in sync with this one.
//   - The deploy train's merge step (run-backlog-automation.js) uses the
//     same function to rebuild index.json from scratch when a merge
//     conflicts only on index.json but not on the article files underneath
//     it — see "Auto-resolving a faq/data/index.json merge conflict" there.
//
// Both also call validateIndexAgainstArticleFiles() before writing, so a
// bug in either path (a missing article, a stale index entry) fails loudly
// instead of shipping a public help centre with a broken article link.
//
// serializeIndex() writes one category/article per line inside an otherwise
// pretty-printed structure — a plain JSON.stringify(index, null, 2) would
// spread every article's fields across several lines each, which still
// merges fine but is harder to read; one-line-per-entry is both readable
// and keeps a change to one article from ever overlapping the line range of
// its neighbours, which is what makes git's own line-based 3-way merge
// resolve two different articles' edits automatically without needing the
// conflict resolver at all.
const fs = require("fs");
const path = require("path");

function buildIndexFromArticleFiles(articlesDir, categories, generatedAt) {
  const files = fs.readdirSync(articlesDir).filter((f) => f.endsWith(".json"));
  const articles = files.map((f) => {
    const { bodyMd, ...meta } = JSON.parse(fs.readFileSync(path.join(articlesDir, f), "utf8"));
    return meta;
  });
  const catOrder = new Map(
    categories.map((c) => [c.id, c.parentId ? (categories.find((p) => p.id === c.parentId) || {}).order || 0 : c.order])
  );
  articles.sort(
    (x, y) => (catOrder.get(x.categoryId) || 0) - (catOrder.get(y.categoryId) || 0) || x.order - y.order || x.id.localeCompare(y.id)
  );
  return { generatedAt, categories, articles };
}

// Throws if index.articles and the actual faq/data/articles/*.json files on
// disk disagree in either direction — an index entry with no file behind it
// (a dangling link on the public site), or a file the index doesn't list
// (an article nobody can ever reach). Called wherever index.json is about
// to be written, so a mismatch fails the export/merge instead of shipping.
function validateIndexAgainstArticleFiles(index, articlesDir) {
  const fileIds = new Set(fs.readdirSync(articlesDir).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")));
  const indexIds = new Set(index.articles.map((a) => a.id));
  const missingFiles = [...indexIds].filter((id) => !fileIds.has(id));
  const missingFromIndex = [...fileIds].filter((id) => !indexIds.has(id));
  if (missingFiles.length || missingFromIndex.length) {
    const problems = [];
    if (missingFiles.length) problems.push(`index.json lists article(s) with no file in ${articlesDir}: ${missingFiles.join(", ")}`);
    if (missingFromIndex.length) problems.push(`article file(s) in ${articlesDir} missing from index.json: ${missingFromIndex.join(", ")}`);
    throw new Error(problems.join("; "));
  }
}

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

module.exports = { buildIndexFromArticleFiles, validateIndexAgainstArticleFiles, serializeIndex };
