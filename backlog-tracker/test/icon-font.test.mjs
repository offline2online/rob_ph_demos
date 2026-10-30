// The console loads Material Symbols with Google Fonts' `icon_names=` subset
// (29 Oct 2026, performance ticket hdYngmfrvvJH8OIMpnMi) instead of the full
// 3.9 MB variable font. An icon missing from that list renders as its plain
// ligature text ("check_circle") — nothing throws and no other test notices —
// so this fails when the code names an icon the list doesn't carry.
//
// Every file that can name an icon is scanned: js/ (including js/kanban/),
// index.html, whiteboard.html and functions/mcp-app-views.js. An icon name is a
// quoted string or element text that is also a Material Symbols name
// (fixtures/material-symbols-names.txt, every ligature of the outlined font).
// That over-collects ordinary words that happen to be icon names ("filter",
// "table"), which only costs a few hundred bytes each; names built by string
// concatenation can't be seen, so spell icons out in full.
//
// To add an icon: put its name in the icon_names list of BOTH links (index.html
// and whiteboard.html), keeping it sorted, then run this test.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const catalog = new Set(fs.readFileSync(path.join(here, "fixtures/material-symbols-names.txt"), "utf8").split("\n").filter(Boolean));

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "vendor") walk(p, out); } else if (/\.(js|html)$/.test(e.name)) out.push(p);
  }
  return out;
}
const files = [...walk(path.join(root, "public")), path.join(root, "functions/mcp-app-views.js")];

const used = new Map();
for (const f of files) {
  const text = fs.readFileSync(f, "utf8");
  for (const m of text.matchAll(/(?<=["'`>])([a-z][a-z0-9]*(?:_[a-z0-9]+)*)(?=["'`<])/g)) {
    if (!catalog.has(m[1])) continue;
    if (!used.has(m[1])) used.set(m[1], path.relative(root, f));
  }
}

function listOf(htmlFile) {
  const html = fs.readFileSync(path.join(root, "public", htmlFile), "utf8");
  const link = html.match(/<link[^>]+href="(https:\/\/fonts\.googleapis\.com\/css2\?family=Material\+Symbols\+Outlined[^"]*)"/);
  assert.ok(link, `${htmlFile}: no Material Symbols stylesheet link`);
  const url = new URL(link[1]);
  return { url, names: (url.searchParams.get("icon_names") || "").split(",").filter(Boolean) };
}

for (const page of ["index.html", "whiteboard.html"]) {
  const { url, names } = listOf(page);
  assert.ok(names.length > 0, `${page}: the font link has no icon_names, so it would download the full 3.9 MB font`);
  assert.deepEqual(names, [...names].sort(), `${page}: icon_names must be sorted (Google Fonts requires it)`);
  assert.equal(new Set(names).size, names.length, `${page}: icon_names has a duplicate`);
  const unknown = names.filter((n) => !catalog.has(n));
  assert.deepEqual(unknown, [], `${page}: not Material Symbols names: ${unknown.join(", ")}`);
  // Fixed axes: only FILL varies (filled icons are used); size, weight and grade are fixed.
  assert.match(url.searchParams.get("family"), /^Material Symbols Outlined:opsz,wght,FILL,GRAD@24,400,0\.\.1,0$/, `${page}: the font axes must stay fixed apart from FILL`);
  const missing = [...used].filter(([n]) => !names.includes(n)).map(([n, f]) => `${n} (${f})`);
  assert.deepEqual(missing, [], `${page}: icons used in code but missing from icon_names: ${missing.join(", ")}`);
}
assert.deepEqual(listOf("index.html").names, listOf("whiteboard.html").names, "index.html and whiteboard.html must list the same icons");

console.log(`icon font: ${used.size} icon names used across ${files.length} files, all in icon_names`);
