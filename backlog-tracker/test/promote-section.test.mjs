// Promote section: routes, nav ids and how a page finds its mirrored documents.
// Run with:  node test/promote-section.test.mjs
import assert from "node:assert";
import { PROMOTE_PAGES, promotePageFromHash, promoteHash, promoteNavId, mirrorBody, promoteDocsFor } from "../public/js/promote-section.js";

assert.strictEqual(promotePageFromHash("#promote"), "brand-guidelines");
assert.strictEqual(promotePageFromHash("#promote/brand-guidelines"), "brand-guidelines");
assert.strictEqual(promotePageFromHash("#promote/nope"), "brand-guidelines", "unknown sub-page falls back to the first");
assert.strictEqual(promotePageFromHash("#settings/projects"), null);
assert.strictEqual(promotePageFromHash("#promoted"), null);
assert.strictEqual(promoteHash("brand-guidelines"), "#promote/brand-guidelines");
assert.strictEqual(promoteNavId("#promote/brand-guidelines"), "promote-brand-btn");
assert.strictEqual(promoteNavId("#skills"), null);
assert.ok(PROMOTE_PAGES.every((p) => p.navId && p.docs.guidelines));

assert.strictEqual(mirrorBody({ contentMd: "> Copy\n\n# Hi", sourcePrefix: "> Copy\n\n" }), "# Hi");
assert.strictEqual(mirrorBody({ contentMd: "# Hi", sourcePrefix: "> Copy\n\n" }), "# Hi", "a body without the prefix is left alone");
assert.strictEqual(mirrorBody(null), "");

const rows = [
  { id: "a", mirrorKey: "other", contentMd: "x" },
  { id: "b", mirrorKey: "brand-guidelines", name: "G", contentMd: "P\n\nBody", sourcePrefix: "P\n\n", sourcePath: "backlog-tracker/promote/brand-guidelines.md" },
];
const d = promoteDocsFor("brand-guidelines", rows);
assert.strictEqual(d.guidelines.body, "Body");
assert.strictEqual(d.requirements, null, "a document not yet copied is null");
assert.deepStrictEqual(promoteDocsFor("brand-guidelines", []), { guidelines: null, requirements: null });
console.log("promote-section: ok");
