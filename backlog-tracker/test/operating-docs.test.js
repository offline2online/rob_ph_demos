// Ties the operating documents (root CLAUDE.md, README.md, MCP.md,
// REQUIREMENTS.md, ROUTINE_INSTRUCTIONS.md) to the code they describe, so a
// renamed tool, a removed Cloud Function or a new project field can't leave
// them saying something the code stopped doing.
//
// Plain node, no emulator, no credentials:  node test/operating-docs.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { install } = require("./mcp-stubs");

process.env.GCLOUD_PROJECT = "backlog-tracker-e4ed2";
process.env.MCP_PUBLIC_ORIGIN = "https://backlog-tracker-e4ed2.web.app";
install();
const mcp = require("../functions/mcp-server.js");

const BT = path.join(__dirname, "..");
const ROOT = path.join(BT, "..");
const read = (p) => fs.readFileSync(p, "utf8");
const claudeMd = read(path.join(ROOT, "CLAUDE.md"));
const readmeMd = read(path.join(BT, "README.md"));
const mcpMd = read(path.join(BT, "MCP.md"));
const requirementsMd = read(path.join(BT, "REQUIREMENTS.md"));
const routineMd = read(path.join(BT, "ROUTINE_INSTRUCTIONS.md"));
const mcpSource = read(path.join(BT, "functions", "mcp-server.js"));
const indexSource = read(path.join(BT, "functions", "index.js"));

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (err) { failures.push([name, err]); console.log(`FAIL  ${name}\n      ${err && err.message}`); }
}

// Names MCP.md mentions precisely to say they do not exist.
const MISSING_ON_PURPOSE = new Set(["create_project", "promote_concept_to_project"]);

// The text of the `### …` / `## …` section of `md` that contains `index`.
function sectionAt(md, index) {
  const before = md.slice(0, index);
  const start = Math.max(before.lastIndexOf("\n## "), before.lastIndexOf("\n### "), 0);
  const rest = md.slice(index);
  const m = /\n##+ /.exec(rest);
  return md.slice(start, m ? index + m.index : md.length);
}

// The body of the `### <heading>` block whose heading starts with `heading`,
// up to the next heading.
function blockOf(md, heading) {
  const at = md.indexOf(`### ${heading}`);
  if (at < 0) return null;
  const m = /\n##+ /.exec(md.slice(at + 5));
  return md.slice(at, m ? at + 5 + m.index : md.length);
}

test("every registered MCP tool is documented in MCP.md", () => {
  const missing = mcp.__test.TOOLS.map((t) => t.name).filter((n) => !mcpMd.includes("`" + n + "`"));
  assert.deepStrictEqual(missing, [], `tools registered in mcp-server.js but not named in MCP.md: ${missing.join(", ")}`);
});

test("every snake_case name MCP.md backticks exists in mcp-server.js", () => {
  const names = new Set((mcpMd.match(/`[a-z]+(?:_[a-z]+)+`/g) || []).map((s) => s.slice(1, -1)));
  const gone = [...names].filter((n) => !MISSING_ON_PURPOSE.has(n) && !new RegExp(`["'\`]${n}["'\`]`).test(mcpSource));
  assert.deepStrictEqual(gone, [], `named in MCP.md but not in mcp-server.js (renamed or removed?): ${gone.join(", ")}`);
});

test("every functions/<name> cited in the docs is a file or an index.js export", () => {
  const files = new Set(fs.readdirSync(path.join(BT, "functions")).map((f) => f.replace(/\.js$/, "")));
  const exported = new Set([...indexSource.matchAll(/\bexports\.([A-Za-z0-9_]+)\s*=/g)].map((m) => m[1]));
  const bad = [];
  for (const [label, md] of [["CLAUDE.md", claudeMd], ["README.md", readmeMd], ["ROUTINE_INSTRUCTIONS.md", routineMd], ["MCP.md", mcpMd]]) {
    for (const m of md.matchAll(/(?<![\w./-])functions\/([A-Za-z][A-Za-z0-9_-]*)(\.js)?(?![\w/-])/g)) {
      const n = m[1];
      if (files.has(n) || exported.has(n)) continue;
      // `functions/` followed by a directory-ish word (node_modules, test) is not a citation.
      if (["node_modules"].includes(n)) continue;
      bad.push(`${label}: functions/${n}`);
    }
  }
  assert.deepStrictEqual([...new Set(bad)], [], `cited but not a file in backlog-tracker/functions/ or an exports.<name> in index.js`);
});

test("REQUIREMENTS.md documents the project, projectDocs and projects/{id}/docs/{kind} fields", () => {
  const projects = blockOf(requirementsMd, "`projects/{projectId}`");
  assert.ok(projects, "no `projects/{projectId}` block");
  const want = [...mcp.__test.PROJECT_WRITABLE_FIELDS, "repoFolder", "repoFolderNotApplicable", "deployBranch", "docsSync", "lastMergeCommit", "lastMergeAt"];
  const missingP = want.filter((f) => !new RegExp(`\\b${f}\\b`).test(projects));
  assert.deepStrictEqual(missingP, [], `projects/{projectId} block lacks: ${missingP.join(", ")}`);

  const docs = blockOf(requirementsMd, "`projectDocs/{docId}`");
  assert.ok(docs, "no `projectDocs/{docId}` block");
  const missingD = ["sourcePath", "sourceSlices", "sourcePrefix", "sourceCommit", "updatedByEmail"].filter((f) => !new RegExp(`\\b${f}\\b`).test(docs));
  assert.deepStrictEqual(missingD, [], `projectDocs/{docId} block lacks: ${missingD.join(", ")}`);

  const kind = blockOf(requirementsMd, "`projects/{projectId}/docs/{kind}`");
  assert.ok(kind, "no `projects/{projectId}/docs/{kind}` block");
  const missingK = ["contentMd", "sourcePath", "sourceCommit", "chars", "sha256", "updatedAt", "updatedByEmail"].filter((f) => !new RegExp(`\\b${f}\\b`).test(kind));
  assert.deepStrictEqual(missingK, [], `projects/{projectId}/docs/{kind} block lacks: ${missingK.join(", ")}`);
});

test("only menu-board-demo/functions needs a manual firebase deploy", () => {
  const bad = [];
  const seen = new Set();
  for (const m of claudeMd.matchAll(/firebase deploy --only functions/g)) {
    const sec = sectionAt(claudeMd, m.index);
    if (seen.has(sec)) continue;
    seen.add(sec);
    if (!sec.includes("menu-board-demo/functions") || !sec.includes("deploy-backlog-tracker.yml")) {
      bad.push(sec.trim().split("\n")[0]);
    }
  }
  assert.deepStrictEqual(bad, [], `CLAUDE.md sections mentioning the manual deploy must name menu-board-demo/functions and deploy-backlog-tracker.yml: ${bad.join(" | ")}`);
  const stale = /functions\/`? change needs its own\s+`?firebase\s+deploy/i;
  assert.ok(!stale.test(claudeMd.replace(/\s+/g, " ")), "CLAUDE.md says a functions/ change needs its own firebase deploy");
  assert.ok(!stale.test(readmeMd.replace(/\s+/g, " ")), "backlog-tracker/README.md says a functions/ change needs its own firebase deploy");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
