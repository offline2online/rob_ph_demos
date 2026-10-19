#!/usr/bin/env node
// docsImpact: "this kind of change must update that document". Rules live in
// a board-docs.json beside the rest of a project's handover declarations:
//
//   "docsImpact": [{"when": ["<glob>"], "require": ["<repo path>"], "why": "<optional, max 200>"}]
//
// A rule fires when a changed path matches a `when` glob and is met when at
// least one `require` file changed in the same commit. Paths and globs are
// repo-root-relative; `*` matches inside one path segment, `**` any number of
// segments (including none). Pure: no network, no dependency.
//
// Used by processApplyPatch (run-backlog-automation.js) to refuse a patch
// that changes an API or schema without its spec unless the build says why,
// and as a CLI so a build session can check before handing back:
//   node backlog-tracker/scripts/docs-impact.js [--base <sha>]
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const MANIFEST_NAME = "board-docs.json";
const WHY_MAX = 200;
const REASON_MAX = 500;
const PATHS_SHOWN = 5;

function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") { i++; re += "(?:.*/)?"; } else re += ".*";
      } else re += "[^/]*";
    } else re += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

const isManifest = (p) => path.posix.basename(p) === MANIFEST_NAME && !p.split("/").includes("node_modules");

function gitFiles(root) {
  return execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n").filter(Boolean);
}

// -> { rules: [{when, require, why, manifest}], problems: [string] }
function loadDocsImpactRules(root) {
  const rules = []; const problems = [];
  let files;
  try { files = gitFiles(root); } catch (err) { return { rules, problems: [`could not list tracked files (${String(err && err.message || err).slice(0, 160)})`] }; }
  for (const p of files.filter(isManifest)) {
    let m;
    try { m = JSON.parse(fs.readFileSync(path.join(root, p), "utf8")); } catch (err) { problems.push(`${p}: does not parse (${String(err.message).slice(0, 120)})`); continue; }
    if (!m || m.docsImpact === undefined) continue;
    if (!Array.isArray(m.docsImpact)) { problems.push(`${p}: docsImpact must be an array`); continue; }
    m.docsImpact.forEach((r, i) => {
      if (!r || typeof r !== "object") { problems.push(`${p}: docsImpact[${i}] must be an object`); return; }
      rules.push({
        when: Array.isArray(r.when) ? r.when : [], require: Array.isArray(r.require) ? r.require : [],
        why: typeof r.why === "string" ? r.why : undefined, manifest: p, index: i,
      });
    });
  }
  return { rules, problems };
}

// Problems for a rule list. exists(path) -> bool; trackedPaths: every tracked file.
function validateDocsImpact(rules, { exists, trackedPaths } = {}) {
  const errs = [];
  (rules || []).forEach((r, i) => {
    const at = `${r.manifest || "docsImpact"}[${r.index === undefined ? i : r.index}]`;
    const bad = (p) => typeof p !== "string" || !p.trim() || p.startsWith("/") || p.split("/").includes("..");
    if (!Array.isArray(r.when) || !r.when.length) errs.push(`${at}: when must be a non-empty array`);
    else r.when.forEach((g) => {
      if (bad(g)) errs.push(`${at}: when "${g}" must be repo-root-relative with no ".." or leading "/"`);
      else if (trackedPaths && !trackedPaths.some((t) => globToRegExp(g).test(t))) errs.push(`${at}: when "${g}" matches no tracked file`);
    });
    if (!Array.isArray(r.require) || !r.require.length) errs.push(`${at}: require must be a non-empty array`);
    else r.require.forEach((p) => {
      if (bad(p)) errs.push(`${at}: require "${p}" must be repo-root-relative with no ".." or leading "/"`);
      else if (exists && !exists(p)) errs.push(`${at}: require ${p} does not exist`);
    });
    if (r.why !== undefined && (typeof r.why !== "string" || r.why.length > WHY_MAX)) errs.push(`${at}: why must be a string of ${WHY_MAX} characters or fewer`);
  });
  return errs;
}

// The unmet rules for a set of changed paths: [{rule, matched}].
function docsImpactCheck(changedPaths, rules) {
  const changed = new Set(changedPaths || []);
  const unmet = [];
  for (const rule of rules || []) {
    const res = (rule.when || []).map(globToRegExp);
    const matched = (changedPaths || []).filter((p) => res.some((re) => re.test(p)));
    if (!matched.length) continue;
    if ((rule.require || []).some((r) => changed.has(r))) continue;
    unmet.push({ rule, matched });
  }
  return unmet;
}

function pathList(paths) {
  return paths.length <= PATHS_SHOWN ? paths.join(", ") : `${paths.slice(0, PATHS_SHOWN).join(", ")} +${paths.length - PATHS_SHOWN} more`;
}

function refusalNote({ rule, matched }) {
  return `Not built: this patch changes ${pathList(matched)} but not ${rule.require.join(" or ")} ` +
    `(${rule.why ? `${rule.why}; ` : ""}rule in ${rule.manifest || MANIFEST_NAME}). Update it in the same patch. ` +
    `If what the spec says genuinely doesn't change, hand back patchDocsImpact with one sentence saying why.`;
}

function waiverNote({ rule, matched }, reason) {
  return `Spec not updated: changes ${pathList(matched)} without ${rule.require.join(" or ")}. The build says: ${String(reason).trim().slice(0, REASON_MAX)}.`;
}

function changedSince(base, root) {
  const run = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
  const set = new Set(base ? run(["diff", "--name-only", base]) : [...run(["diff", "--name-only", "HEAD"]), ...run(["diff", "--cached", "--name-only"])]);
  if (!base) run(["ls-files", "--others", "--exclude-standard"]).forEach((p) => set.add(p));
  return [...set];
}

function main(argv) {
  const i = argv.indexOf("--base");
  const base = i >= 0 ? argv[i + 1] : null;
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const { rules, problems } = loadDocsImpactRules(root);
  problems.forEach((p) => console.error(`warning: ${p}`));
  const unmet = docsImpactCheck(changedSince(base, root), rules);
  if (!unmet.length) { console.log("docsImpact: no unmet rules"); return 0; }
  unmet.forEach((u) => console.log(refusalNote(u)));
  return 1;
}

module.exports = { globToRegExp, loadDocsImpactRules, validateDocsImpact, docsImpactCheck, refusalNote, waiverNote, pathList, WHY_MAX, REASON_MAX };
if (require.main === module) process.exit(main(process.argv.slice(2)));
