// Promote section: routes, nav ids and how a page finds its mirrored documents.
// Run with:  node test/promote-section.test.mjs
import assert from "node:assert";
import { PROMOTE_PAGES, promotePageFromHash, promoteHash, promoteNavId, mirrorBody, promoteDocsFor, teamFacingMd, brandHeaderHtml } from "../public/js/promote-section.js";

assert.strictEqual(promotePageFromHash("#promote"), "brand-guidelines");
assert.strictEqual(promotePageFromHash("#promote/brand-guidelines"), "brand-guidelines");
assert.strictEqual(promotePageFromHash("#promote/nope"), "brand-guidelines", "unknown sub-page falls back to the first");
assert.strictEqual(promotePageFromHash("#settings/projects"), null);
assert.strictEqual(promotePageFromHash("#promoted"), null);
assert.strictEqual(promoteHash("brand-guidelines"), "#promote/brand-guidelines");
assert.strictEqual(promoteNavId("#promote/brand-guidelines"), "promote-brand-btn");
assert.strictEqual(promoteNavId("#skills"), null);
assert.ok(PROMOTE_PAGES.every((p) => p.navId));
assert.ok(PROMOTE_PAGES.filter((p) => p.key !== "leads" && p.key !== "prospects" && p.key !== "conversion-funnel").every((p) => p.docs.guidelines));
assert.deepStrictEqual(PROMOTE_PAGES.map((p) => p.key), ["brand-guidelines", "leads", "prospects", "conversion-funnel"], "Leads sits beneath Brand Guidelines, Prospects (TAM) below Leads, Conversion Funnel below Prospects");
assert.strictEqual(promotePageFromHash("#promote/prospects"), "prospects");
assert.strictEqual(promoteHash("prospects"), "#promote/prospects");
assert.strictEqual(promoteNavId("#promote/prospects"), "promote-prospects-btn");
assert.strictEqual(promotePageFromHash("#promote/conversion-funnel"), "conversion-funnel");
assert.strictEqual(promoteNavId("#promote/conversion-funnel"), "promote-funnel-btn");
assert.strictEqual(promotePageFromHash("#promote/leads"), "leads");
assert.strictEqual(promoteHash("leads"), "#promote/leads");
assert.strictEqual(promoteNavId("#promote/leads"), "promote-leads-btn");
assert.deepStrictEqual(promoteDocsFor("leads", [{ id: "b", mirrorKey: "brand-guidelines", contentMd: "x" }]), {}, "Leads shows no mirrored documents");

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

// Team view strips agent-only sections; the header is the visual brand block.
const full = "# T\n\n## Look\n\nShown.\n\n<!-- agent-only:start -->\n\n## Rules\n\nHidden.\n\n<!-- agent-only:end -->\n\n## Voice\n\nAlso shown.\n";
const team = teamFacingMd(full);
assert.ok(team.includes("Shown.") && team.includes("Also shown.") && !team.includes("Hidden.") && !team.includes("Rules") && !team.includes("agent-only"));
assert.ok(!teamFacingMd("a\n<!-- agent-only:start -->\nb").includes("b"), "an unclosed marker hides the rest");
assert.strictEqual(teamFacingMd(null), "");
const hdr = brandHeaderHtml();
assert.ok(hdr.includes("Make every store visit worth more") && !hdr.includes("into revenue"));
assert.ok(hdr.includes("#169BC2") && hdr.includes("Kantumruy Pro") && (hdr.match(/class="brand-bar"/g) || []).length === 4);
// The real file: nothing for agents leaks into the team view, the old line is gone, MCP still gets everything.
import { readFileSync } from "node:fs";
const real = readFileSync(new URL("../promote/brand-guidelines.md", import.meta.url), "utf8");
const realTeam = teamFacingMd(real);
for (const h of ["## Messaging rules", "## Front doors", "## Audiences", "## Funnel stages", "## Reusable templates", "## Brand assets", "## Joint promotions with AWS", "## End goal: automated LinkedIn", "9fc093677d4c581658daa4f02bb7eb4b"]) {
  assert.ok(real.includes(h), `the full file keeps ${h} for agents`);
  assert.ok(!realTeam.includes(h), `the team view hides ${h}`);
}
for (const h of ["Logo usage", "## Colour", "The infinity loop", "## Typography", "Imagery and icons", "The two-surface system", "Founder tone of voice", "Message house"]) assert.ok(realTeam.includes(h), `the team view shows ${h}`);
assert.ok(real.includes("Make every store visit worth more") && !/into revenue/i.test(real), "umbrella line updated in the guidelines");
assert.ok(!/into revenue/i.test(readFileSync(new URL("../promote/brand-requirements.md", import.meta.url), "utf8")), "and in the requirements");
console.log("promote-section: ok");
