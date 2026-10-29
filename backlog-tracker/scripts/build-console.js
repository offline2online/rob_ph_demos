#!/usr/bin/env node
// Builds the console's Hosting folder from public/: a copy with every first-party
// script minified. firebase.json runs it as the console target's "predeploy"
// hook (firebase-tools runs that before uploading hosting), so the deploy
// workflow needs no extra step. The sources in public/ stay unminified and
// readable; only the copy that is uploaded changes.
//
//   node scripts/build-console.js [--out console-dist] [--require-minify]
//
// Minifying is esbuild per file, no bundling: the ES module graph, the gstatic
// Firebase URLs and the dynamic imports stay exactly as written (the Kanban
// modules are still preloaded by name from index.html), only whitespace, local
// names and syntax are shortened. If esbuild can't be fetched the copy is left
// unminified with a warning, so a registry outage can't block a deploy; pass
// --require-minify (the minified UI test does) to fail instead.
// Vendored files that are already minified (js/vendor) are copied as they are.
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ESBUILD = "esbuild@0.25.10";
const root = path.join(__dirname, "..");
const arg = (name) => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const outDir = path.resolve(root, arg("--out") || "console-dist");
const requireMinify = process.argv.includes("--require-minify");
const src = path.join(root, "public");

function walk(dir, files = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, files); else files.push(p);
  }
  return files;
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.cpSync(src, outDir, { recursive: true });

const entries = walk(src)
  .filter((f) => f.endsWith(".js") && !f.split(path.sep).includes("vendor"))
  .map((f) => path.relative(src, f));

const before = entries.reduce((n, f) => n + fs.statSync(path.join(src, f)).size, 0);
const r = spawnSync("npx", ["--yes", ESBUILD, ...entries.map((f) => path.join("public", f)),
  "--minify", "--target=es2022", "--format=esm", "--legal-comments=none", "--log-level=warning",
  "--outbase=public", `--outdir=${outDir}`], { cwd: root, stdio: ["ignore", "inherit", "inherit"], encoding: "utf8" });

if (r.status !== 0) {
  const msg = `esbuild did not run (exit ${r.status}); ${entries.length} scripts left unminified in ${path.relative(root, outDir)}.`;
  if (requireMinify) { console.error(msg); process.exit(1); }
  console.log(`::warning title=Console scripts not minified::${msg}`);
  process.exit(0);
}
const after = entries.reduce((n, f) => n + fs.statSync(path.join(outDir, f)).size, 0);
console.log(`Minified ${entries.length} scripts into ${path.relative(root, outDir)}: ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB.`);
