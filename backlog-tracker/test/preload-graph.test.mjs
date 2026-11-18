// index.html preloads every module the console needs to start (18 Nov 2026).
//
// auth-gate.js imports app.js only once sign-in is confirmed, and the browser
// learns of app.js's own imports only when it runs that import. Measured on
// the live console: 28 modules that no <link rel="modulepreload"> named were
// requested after sign-in had resolved, and the first load after a release
// waited about three seconds on them. A module named in <head> downloads
// alongside app.js instead.
//
// So the list in index.html must be the whole static import graph, and stay
// it: this fails, naming the line to add or remove, when
//   - a module the page's entry scripts import (directly or through another
//     module) has no modulepreload link, or a link names a file that is not
//     in that graph (a dead preload is a wasted download on every cold load);
//   - the Staff Kanban route's own list (the inline script) is not exactly
//     what kanban-page.js imports beyond that graph.
//   cd backlog-tracker/test && node preload-graph.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const html = fs.readFileSync(path.join(pub, "index.html"), "utf8");

// Static imports only: `import … from "./x.js"`, `import "./x.js"`, `export … from "./x.js"`.
// A dynamic import("./x.js") is a page loaded on demand and is not followed.
const STATIC = /(?:^|[\n;])\s*(?:import|export)\s+(?:[^"'()]*?\sfrom\s*)?["'](\.{1,2}\/[^"']+\.js)["']/g;
function closure(entries) {
  const seen = new Set();
  const walk = (rel) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const src = fs.readFileSync(path.join(pub, rel), "utf8");
    for (const m of src.matchAll(STATIC)) walk(path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])));
  };
  entries.forEach(walk);
  return seen;
}

// The page's entry scripts: every <script type="module" src>, the inline version import, and
// the notification bell, which app.js loads on every page as soon as someone is signed in.
const entries = [...html.matchAll(/<script type="module" src="(js\/[^"]+\.js)"/g)].map((m) => m[1]);
assert.ok(entries.includes("js/auth-gate.js"), "index.html should load js/auth-gate.js as a module");
const graph = closure([...entries, "js/app.js", "js/version.js", "js/kanban/kanban-bell.js"]);

const linked = [...html.matchAll(/<link rel="modulepreload" href="(js\/[^"]+\.js)">/g)].map((m) => m[1]);
const missing = [...graph].filter((f) => !linked.includes(f)).sort();
const dead = linked.filter((f) => !graph.has(f)).sort();
assert.deepEqual(missing, [], `index.html is missing a modulepreload link for:\n${missing.map((f) => `  <link rel="modulepreload" href="${f}">`).join("\n")}\n`);
assert.deepEqual(dead, [], "index.html preloads a module nothing imports at start-up");
assert.equal(new Set(linked).size, linked.length, "a module is preloaded twice");

// The Staff Kanban route: what kanban-page.js needs beyond the graph above.
const list = /\[([^\]]*kanban\/kanban-page\.js[^\]]*)\]\.forEach/.exec(html);
assert.ok(list, "index.html should preload the Staff Kanban modules when the address is #staff-kanban");
const named = [...list[1].matchAll(/"([^"]+)"/g)].map((m) => `js/${m[1]}`).sort();
const wanted = [...closure(["js/kanban/kanban-page.js"])].filter((f) => !graph.has(f)).sort();
assert.deepEqual(named, wanted, "the Staff Kanban preload list in index.html must be exactly what kanban-page.js imports beyond the start-up graph");

console.log(`preload graph: ${graph.size} start-up modules and ${wanted.length} Staff Kanban modules, all preloaded`);
