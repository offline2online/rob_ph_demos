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

// build-info.json: which commit, content tree and APP_VERSION this copy was built from.
// The deploy workflow fetches it from the LIVE site after `firebase deploy` and fails the
// run unless it matches (scripts/verify-live-deploy.js), so a green deploy means the
// console really serves this content. TREE is the same fingerprint the dedupe step uses.
{
  const ver = (fs.readFileSync(path.join(src, "js", "version.js"), "utf8").match(/APP_VERSION\s*=\s*"([^"]+)"/) || [])[1] || null;
  fs.writeFileSync(path.join(outDir, "build-info.json"), JSON.stringify({
    commit: process.env.GITHUB_SHA || null,
    tree: process.env.DEPLOY_TREE || null,
    version: ver,
    builtAt: new Date().toISOString(),
  }, null, 2) + "\n");
}

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
  stampVersions();
  process.exit(0);
}
const after = entries.reduce((n, f) => n + fs.statSync(path.join(outDir, f)).size, 0);
console.log(`Minified ${entries.length} scripts into ${path.relative(root, outDir)}: ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB.`);
stampVersions();

// ── Every script and stylesheet URL carries this build's id (?v=<id>) ─────────
// The iPad kept running a release's NEW page with OLD scripts: the menu items
// that existed before the release worked and every new one did nothing
// (Leads, Prospects, Conversion Funnel, then Dashboard and Support Inbox,
// 7-17 Nov 2026), and a fresh tab didn't help. With the build id in every URL
// a page can only ever load the scripts it was built with: a new page asks for
// new URLs that no cache holds, and an old cached page keeps a matching set.
// The ids go into the uploaded copy only; public/ is untouched. Every
// relative import must be stamped: one left plain would load that module a
// second time under a different URL (two copies of its state), so the build
// fails instead.
function stampVersions() {
  const crypto = require("crypto");
  const stampable = walk(outDir).filter((f) => /\.(js|css|html)$/.test(f)).sort();
  const h = crypto.createHash("sha256");
  for (const f of stampable) { h.update(path.relative(outDir, f)); h.update(fs.readFileSync(f)); }
  const id = h.digest("hex").slice(0, 12);
  const v = `?v=${id}`;
  // In scripts: from "./x.js", import("./x.js"), import "./x.js", and template
  // literals such as import(`./x.js${suffix}`).
  const JS_SPEC = /((?:\bfrom|\bimport)\s*\(?\s*)(["'`])(\.{1,2}\/[^"'`?#$\s]+?\.js)(?=["'`$])/g;
  let scripts = 0, specs = 0;
  for (const f of walk(outDir).filter((x) => x.endsWith(".js") && !x.split(path.sep).includes("vendor"))) {
    const before = fs.readFileSync(f, "utf8");
    let n = 0;
    const after = before.replace(JS_SPEC, (m, pre, q, spec) => { n++; return `${pre}${q}${spec}${v}`; });
    // Anything relative still unstamped is a form this regex doesn't know: stop.
    const left = after.match(/(?:\bfrom|\bimport)\s*\(?\s*["'`]\.{1,2}\/[^"'`?#$\s]+?\.js["'`]/g);
    if (left) { console.error(`build-console: unstamped import in ${path.relative(outDir, f)}: ${left.slice(0, 3).join(", ")}`); process.exit(1); }
    if (n) { fs.writeFileSync(f, after); scripts++; specs += n; }
  }
  // In pages: src/href to js/ and css/, the inline version import, and the
  // Staff Kanban preload built from "js/" + f.
  const pages = walk(outDir).filter((x) => x.endsWith(".html"));
  for (const f of pages) {
    let html = fs.readFileSync(f, "utf8");
    html = html.replace(/\b(src|href)="((?:js|css)\/[^"?#]+?\.(?:js|css))"/g, (m, attr, u) => `${attr}="${u}${v}"`);
    html = html.replace(/(from\s*["'])(\.\/js\/[^"'?#]+?\.js)(["'])/g, (m, a, u, b) => `${a}${u}${v}${b}`);
    html = html.replace(/l\.href = "js\/" \+ f;/g, `l.href = "js/" + f + "${v}";`);
    const left = html.match(/\b(?:src|href)="(?:js|css)\/[^"?#]+?\.(?:js|css)"/g);
    if (left) { console.error(`build-console: unstamped asset in ${path.relative(outDir, f)}: ${left.slice(0, 3).join(", ")}`); process.exit(1); }
    fs.writeFileSync(f, html);
  }
  // build-info.json carries the id too, so a support question can compare.
  const infoPath = path.join(outDir, "build-info.json");
  try { const info = JSON.parse(fs.readFileSync(infoPath, "utf8")); info.assetVersion = id; fs.writeFileSync(infoPath, JSON.stringify(info, null, 2) + "\n"); } catch { /* no build-info */ }
  console.log(`Stamped ?v=${id} into ${specs} imports in ${scripts} scripts and ${pages.length} pages.`);
}
