/* normalisePatchPaths(): a Routine session that worked inside a project's
   folder hands over paths relative to it. On 22 Sep 2026 seven tickets
   (PR #185) were written to the repo root that way — new files under
   apps/, packages/, docs/, and the root README.md overwritten — while the
   real dsp-integration/ files never changed. The fixture below is that
   repo's shape at the time. */
const assert = require("node:assert");

const { normalisePatchPaths, projectFolderOf, patchFilesLookFolderRelative } = require("../scripts/run-backlog-automation.js");

// The tree of main on 22 Sep, as a set of existing paths (files and dirs).
const TREE = new Set([
  "README.md", "CLAUDE.md", ".github", ".github/workflows", ".github/workflows/dsp-board.yml",
  "docs", "docs/CONTRIBUTING-docs.md", "backlog-tracker", "backlog-tracker/public", "backlog-tracker/public/js", "backlog-tracker/public/js/version.js",
  "dsp-integration", "dsp-integration/README.md", "dsp-integration/package.json",
  "dsp-integration/apps", "dsp-integration/apps/admin", "dsp-integration/apps/admin/src", "dsp-integration/apps/admin/src/features", "dsp-integration/apps/admin/src/features/campaign-status",
  "dsp-integration/apps/admin/src/features/campaign-status/CampaignStatusPage.tsx",
  "dsp-integration/apps/api", "dsp-integration/apps/api/src", "dsp-integration/apps/api/src/domain", "dsp-integration/apps/api/src/domain/assetChecks.ts",
  "dsp-integration/docs", "dsp-integration/docs/dsp-integration", "dsp-integration/docs/dsp-integration/REQUIREMENTS.md",
  "menu-board-demo", "menu-board-demo/hq-admin.html",
]);
const exists = (p) => TREE.has(p);

const paths = (files) => files.map((f) => f.path);

// The real case: every path relative to dsp-integration/.
{
  const { files, moved } = normalisePatchPaths([
    { path: "apps/admin/src/features/campaign-status/CampaignStatusPage.tsx", content: "x" },
    { path: "apps/api/src/domain/campaignRetention.ts", content: "new file, its directory exists only under the folder" },
    { path: "docs/dsp-integration/REQUIREMENTS.md", content: "docs/ exists at the root too, but not this file" },
    { path: "README.md", content: "exists in both places — moved on the strength of the rest" },
    { path: "packages/campaign-approval/migrations/0101.up.sql", content: "brand-new directory, moved on the strength of the rest" },
    { path: "menu-board-demo/hq-admin.html", content: "a real root entry with nothing under the folder: stays" },
    { path: "CLAUDE.md", content: "likewise" },
  ], "dsp-integration", exists);
  assert.deepStrictEqual(paths(files), [
    "dsp-integration/apps/admin/src/features/campaign-status/CampaignStatusPage.tsx",
    "dsp-integration/apps/api/src/domain/campaignRetention.ts",
    "dsp-integration/docs/dsp-integration/REQUIREMENTS.md",
    "dsp-integration/README.md",
    "dsp-integration/packages/campaign-approval/migrations/0101.up.sql",
    "menu-board-demo/hq-admin.html",
    "CLAUDE.md",
  ]);
  assert.strictEqual(moved.length, 5);
  assert.deepStrictEqual(moved[3], { from: "README.md", to: "dsp-integration/README.md" });
}

// A brand-new directory alone is NOT evidence: a new top-level thing may be exactly what the ticket means.
{
  const { files, moved } = normalisePatchPaths([{ path: "packages/new-thing/index.ts", content: "x" }], "dsp-integration", exists);
  assert.deepStrictEqual(paths(files), ["packages/new-thing/index.ts"]);
  assert.deepStrictEqual(moved, []);
}

// Root README.md alone is ambiguous and stays at the root.
{
  const { files, moved } = normalisePatchPaths([{ path: "README.md", content: "x" }], "dsp-integration", exists);
  assert.deepStrictEqual(paths(files), ["README.md"]);
  assert.deepStrictEqual(moved, []);
}

// Correct paths are untouched, including the folder's own and other projects'.
{
  const input = [
    { path: "dsp-integration/apps/api/src/domain/assetChecks.ts", content: "x" },
    { path: "menu-board-demo/hq-admin.html", content: "x" },
    { path: "backlog-tracker/public/js/version.js", content: "x" },
    { path: ".github/workflows/dsp-board.yml", content: "x" },
    { path: "dsp-integration/apps/api/src/domain/brandNew.ts", content: "x" },
  ];
  const { files, moved } = normalisePatchPaths(input, "dsp-integration", exists);
  assert.deepStrictEqual(paths(files), paths(input));
  assert.deepStrictEqual(moved, []);
  assert.notStrictEqual(files[0], input[0], "the input is not mutated");
}

// Deletions (content: null) move with the rest.
{
  const { files } = normalisePatchPaths([
    { path: "apps/api/src/domain/assetChecks.ts", content: null },
    { path: "apps/api/src/domain/assetChecks2.ts", content: "x" },
  ], "dsp-integration", exists);
  assert.deepStrictEqual(paths(files), ["dsp-integration/apps/api/src/domain/assetChecks.ts", "dsp-integration/apps/api/src/domain/assetChecks2.ts"]);
  assert.strictEqual(files[0].content, null);
}

// No folder, no change; garbage entries pass through for applyPatchFiles to refuse.
{
  const input = [{ path: "apps/x.ts", content: "x" }, null, { path: "../etc/passwd", content: "x" }];
  const { files, moved } = normalisePatchPaths(input, null, exists);
  assert.deepStrictEqual(files.map((f) => (f ? f.path : f)), ["apps/x.ts", null, "../etc/passwd"]);
  assert.deepStrictEqual(moved, []);
  const withFolder = normalisePatchPaths(input, "dsp-integration", exists);
  assert.deepStrictEqual(withFolder.files.map((f) => (f ? f.path : f)), ["dsp-integration/apps/x.ts", null, "../etc/passwd"]);
}

// projectFolderOf: the deploy branch's slug when that folder exists, an explicit repoFolder first, nothing otherwise.
const isDir = (p) => ["dsp-integration", "menu-board-demo", "backlog-tracker"].includes(p);
assert.strictEqual(projectFolderOf({ deployBranch: "deploy/dsp-integration" }, isDir), "dsp-integration");
assert.strictEqual(projectFolderOf({ deployBranch: "deploy/backlog-tracker-faqs" }, isDir), null);
assert.strictEqual(projectFolderOf({ deployBranch: "deploy/backlog-tracker-faqs", repoFolder: "backlog-tracker/" }, isDir), "backlog-tracker");
assert.strictEqual(projectFolderOf({ deployBranch: "deploy/x", repoFolder: "../secrets" }, isDir), null);
assert.strictEqual(projectFolderOf({}, isDir), null);
assert.strictEqual(projectFolderOf(null, isDir), null);

// patchFilesLookFolderRelative: the signal used when projectFolderOf()
// found no folder to normalise against at all (see "Refuse rather than
// guess" in processApplyPatch) — the PR #185 shape this is meant to catch.
{
  // The actual PR #185 patch: nothing in it exists at the root of TREE.
  assert.strictEqual(patchFilesLookFolderRelative([
    { path: "apps/admin/src/features/campaign-status/CampaignStatusPage.tsx", content: "x" },
    { path: "packages/campaign-approval/migrations/0101.up.sql", content: "x" },
  ], exists), true);

  // Touches a real root entry (backlog-tracker/) alongside the suspicious
  // ones — trusted as genuinely root-relative.
  assert.strictEqual(patchFilesLookFolderRelative([
    { path: "apps/admin/src/App.tsx", content: "x" },
    { path: "backlog-tracker/public/js/version.js", content: "x" },
  ], exists), false);

  // A project with no single folder (this project's own tickets): every
  // path already starts at a real root entry.
  assert.strictEqual(patchFilesLookFolderRelative([
    { path: "backlog-tracker/public/js/app.js", content: "x" },
    { path: "faq/data/index.json", content: "x" },
  ], exists), false);

  // A workflow-file-only patch is always root-relative, whether or not its
  // own top segment (.github) exists as a plain directory to `exists()`.
  assert.strictEqual(patchFilesLookFolderRelative([
    { path: ".github/workflows/dsp-board.yml", content: "x" },
  ], () => false), false);

  // Nothing to judge — never refuse an empty or garbage-only patch here;
  // applyPatchFiles's own checks handle those.
  assert.strictEqual(patchFilesLookFolderRelative([], exists), false);
  assert.strictEqual(patchFilesLookFolderRelative([{ path: "../etc/passwd", content: "x" }], exists), false);
}

console.log("patch-paths: all assertions passed");
