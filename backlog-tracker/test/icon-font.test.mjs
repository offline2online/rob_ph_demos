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

// ── FAQ category icons (3HabqHlC4WwL137CYTv1) ──────────────────────────────
// A category's icon is data (faqCategories.icon), so the scan above can't see
// it. It is drawn twice: in the console (this font, by name) and on the
// website as inline SVG from a fixed set (faq/js/icons.js, mirrored in the
// Support Centre's main.php), where any other name shows as "?". The picker
// (FAQ_CATEGORY_ICONS in app.js) may only offer names both can draw, and
// every category in the faq/data snapshot must use one.
const repo = path.join(root, "..");
const iconsJs = fs.readFileSync(path.join(repo, "faq/js/icons.js"), "utf8");
const sitePaths = new Set([...iconsJs.slice(iconsJs.indexOf("export const ICON_PATHS"), iconsJs.indexOf("export const ICON_ALIASES")).matchAll(/^\s{2}([a-z0-9_]+):\s*"/gm)].map((m) => m[1]));
const siteAliases = Object.fromEntries([...(iconsJs.match(/ICON_ALIASES\s*=\s*\{([^}]*)\}/) || [, ""])[1].matchAll(/([a-z0-9_]+):\s*"([a-z0-9_]+)"/g)].map((m) => [m[1], m[2]]));
const siteDraws = (n) => sitePaths.has(n) || sitePaths.has(siteAliases[n]);
assert.ok(sitePaths.size > 10 && sitePaths.has("help"), "faq/js/icons.js ICON_PATHS parsed");
const php = fs.readFileSync(path.join(repo, "ph-website/snippets/ph-support-centre/main.php"), "utf8");
const phpStart = php.indexOf("const ICONS");
const phpBlock = php.slice(phpStart, php.indexOf("];", phpStart));
const phpPaths = new Set([...phpBlock.matchAll(/'([a-z0-9_]+)'\s*=>/g)].map((m) => m[1]));
assert.deepEqual([...sitePaths].filter((n) => !phpPaths.has(n)), [], "faq/js/icons.js names an icon the Support Centre's main.php can't draw");
const appJs = fs.readFileSync(path.join(root, "public/js/app.js"), "utf8");
const pickerBlock = (appJs.match(/const FAQ_CATEGORY_ICONS = \[([\s\S]*?)\];/) || [])[1];
assert.ok(pickerBlock, "FAQ_CATEGORY_ICONS not found in app.js");
const picker = [...pickerBlock.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]);
const fontNames = listOf("index.html").names;
assert.deepEqual(picker.filter((n) => !siteDraws(n)), [], "the FAQ category icon picker offers icons the website draws as ?");
assert.deepEqual(picker.filter((n) => !fontNames.includes(n)), [], "the FAQ category icon picker offers icons missing from icon_names");
const faqIndex = JSON.parse(fs.readFileSync(path.join(repo, "faq/data/index.json"), "utf8"));
const catIcons = [...new Set(faqIndex.categories.map((c) => c.icon || "help"))];
assert.deepEqual(catIcons.filter((n) => !siteDraws(n)), [], "a help-centre category uses an icon the website can't draw");
assert.deepEqual(catIcons.filter((n) => !fontNames.includes(n)), [], "a help-centre category uses an icon missing from icon_names (FAQ Management shows the bare word)");

console.log(`icon font: ${used.size} icon names used across ${files.length} files, all in icon_names`);
