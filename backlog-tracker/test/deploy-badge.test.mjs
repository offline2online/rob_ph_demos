// The Merged to Main (Live) card's deploy badge follows every deploy the merge
// started (deployRuns), not just the console's own. Pulls the REAL
// deployBadgeHTML out of public/js/app.js (header-phase.test.mjs's vm
// technique) — no DOM, no Firebase.
//
// Run with:  node test/deploy-badge.test.mjs
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "..", "public", "js", "app.js"), "utf8");
const start = src.indexOf("\nfunction deployBadgeHTML(");
assert.ok(start >= 0, "app.js defines deployBadgeHTML");
let i = src.indexOf("{", src.indexOf(")", start)), depth = 0;
for (; i < src.length; i++) { if (src[i] === "{") depth++; else if (src[i] === "}" && --depth === 0) break; }
const ctx = { escapeHTML: (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"), safeHttpUrl: (s) => s };
vm.createContext(ctx);
vm.runInContext(src.slice(start, i + 1), ctx);
const badge = (item) => ctx.deployBadgeHTML({ status: "published-live", mergeCommit: "abcdef1234", ...item });

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`  ok  ${name}`); };
const run = (workflow, conclusion, runUrl = null) => ({ workflow, dispatchedAt: "2026-10-19T05:00:00Z", runUrl, conclusion });

test("pending shows amber 'Deploying… (1 of 2 done)' after the short sha", () => {
  const h = badge({ deployConclusion: "pending", deployRuns: [run("dsp-api-deploy.yml", "success"), run("dsp-prototype.yml", "pending")] });
  assert.match(h, /deploy-badge-pending/);
  assert.match(h, /abcdef1<\/span>/);
  assert.match(h, /Deploying&hellip; \(1 of 2 done\)/);
  assert.match(h, /title="dsp-api-deploy\.yml succeeded\ndsp-prototype\.yml running"/);
});

test("all succeeded is green 'Live'", () => {
  const h = badge({ deployConclusion: "success", deployRuns: [run("dsp-api-deploy.yml", "success")] });
  assert.match(h, /deploy-badge-success/);
  assert.match(h, /<span>Live<\/span>/);
});

test("a failed run is red and links to that run", () => {
  const h = badge({ deployConclusion: "failure", deployRuns: [run("dsp-prototype.yml", "success"), run("dsp-api-deploy.yml", "cancelled", "https://github.com/o/r/actions/runs/9")] });
  assert.match(h, /deploy-badge-failure/);
  assert.match(h, /href="https:\/\/github\.com\/o\/r\/actions\/runs\/9"[^>]*>Deploy failed: dsp-api-deploy\.yml &#8599;<\/a>/);
});

test("a workflow that was never dispatched links to its Actions page", () => {
  const h = badge({ deployConclusion: "failure", deployRuns: [run("dsp-api-deploy.yml", "not-dispatched")] });
  assert.match(h, /href="https:\/\/github\.com\/offline2online\/rob_ph_demos\/actions\/workflows\/dsp-api-deploy\.yml"/);
  assert.match(h, /never dispatched/);
});

test("an empty list is neutral 'Merged · no deploy tracked'", () => {
  const h = badge({ deployConclusion: "not-applicable", deployRuns: [] });
  assert.match(h, /deploy-badge-none/);
  assert.match(h, /Merged &middot; no deploy tracked/);
});

test("a card without deployRuns renders exactly as before", () => {
  assert.strictEqual(
    badge({ deployConclusion: "success", deployRunUrl: "https://x/runs/1" }),
    '<div class="deploy-badge deploy-badge-success"><span class="deploy-badge-commit" title="Merge commit">abcdef1</span><a href="https://x/runs/1" target="_blank" rel="noopener">Deploy succeeded</a></div>',
  );
  assert.match(badge({ deployConclusion: "pending", deployRunUrl: "https://x/runs/1" }), /Deploy running&hellip;/);
  assert.match(badge({}), /Deploy status unknown/);
  assert.strictEqual(ctx.deployBadgeHTML({ status: "ready-for-testing", deployRuns: [] }), "");
});

test("the first paint carries deployRuns", () => {
  assert.match(src, /BACKLOG_ITEM_RENDER_FIELDS = \[[\s\S]*?"deployRuns"/);
});

console.log(`\n${passed} passed, 0 failed`);
