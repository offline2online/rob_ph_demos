// Pure helpers of Support › Documentation (public/js/documentation-page.js).
import assert from "node:assert";
import { childrenOf, descendantIds, pathOf, plainText, matchesFilter, searchDocs, snippetFor } from "../public/js/documentation-core.js";

const cats = [
  { id: "a", name: "Architecture", order: 1 },
  { id: "p", name: "Product", order: 0 },
  { id: "a1", name: "Solution design", parentId: "a", order: 0 },
  { id: "a11", name: "Appendices", parentId: "a1", order: 0 },
  { id: "x", name: "Archive", order: 9 },
];
assert.deepStrictEqual(childrenOf(cats, null).map((c) => c.id), ["p", "a", "x"], "top level by order");
assert.deepStrictEqual(descendantIds(cats, "a"), ["a", "a1", "a11"], "nests to any depth");
assert.deepStrictEqual(pathOf(cats, "a11").map((c) => c.name), ["Architecture", "Solution design", "Appendices"]);
assert.deepStrictEqual(pathOf([{ id: "l", parentId: "l", name: "Loop" }], "l").map((c) => c.id), ["l"], "a loop cannot hang");
assert.strictEqual(plainText("<p>Hello&nbsp;<strong>world</strong></p><pre>x &amp; y</pre>"), "Hello world x & y");
assert.ok(matchesFilter({ needsReview: true }, "needs-review") && !matchesFilter({ status: "published" }, "draft") && matchesFilter({}, "all"));

const arts = [
  { id: "1", title: "EKS deployment", bodyMd: "<p>Terraform and helm</p>", order: 0 },
  { id: "2", title: "Cost plan", summary: "EKS cost", bodyMd: "<p>scale down</p>", order: 1 },
  { id: "3", title: "Notes", bodyMd: "<p>mentions eks once with helm</p>", order: 2 },
];
const textOf = (a) => plainText(a.bodyMd).toLowerCase();
assert.deepStrictEqual(searchDocs(arts, "eks", textOf).map((a) => a.id), ["1", "2", "3"], "title, then summary, then body");
assert.deepStrictEqual(searchDocs(arts, "eks helm", textOf).map((a) => a.id), ["1", "3"], "every word must match");
assert.deepStrictEqual(searchDocs(arts, "  ", textOf), []);
assert.ok(snippetFor("a".repeat(100) + " needle " + "b".repeat(300), "needle").startsWith("…"));
console.log("documentation-page: ok");
