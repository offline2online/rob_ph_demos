// The screen's service worker and shell as the deploy publishes them: staged, fingerprinted into assets/ with the
// fonts and photo as their own files, sw.js stamped with every shell file's hash, and covering every file the page
// loads. The browser half (cached start, offline start, only changed files downloaded, no revalidation without the
// worker, occasion stylesheets only when an occasion plays) is pharmacy-screen/test/ui/offline-cache.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync, appendFileSync, mkdtempSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import {
  ROOT, PUBLIC_SOURCE, PUBLIC_ENTRIES, stagePublic, shellBuildId, shellFiles, stampServiceWorker, SW_FILE, SW_PLACEHOLDER, SW_FILES_PLACEHOLDER, ASSETS_DIR,
} from "../scripts/deploy.mjs";

const SRC = join(ROOT, PUBLIC_SOURCE);
const swSource = readFileSync(join(SRC, SW_FILE), "utf8");
const shellList = JSON.parse(swSource.match(/const SHELL = DEV \? (\[[\s\S]*?\]) :/)[1].replace(/'/g, '"').replace(/,\s*\]/, "]"));
const stamped = (pub) => JSON.parse(readFileSync(join(pub, SW_FILE), "utf8").match(/const FILES = (\{.*\});/)[1]);
const sha16 = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 16);
function staged(tag) {
  const pub = join(mkdtempSync(join(tmpdir(), `ps-sw-${tag}-`)), "public");
  stagePublic(ROOT, pub);
  return pub;
}

test("the unstamped service worker's shell lists the page and every file in js/ and css/", () => {
  const onDisk = ["pharmacy-screen.html", ...["css", "js"].flatMap((d) => readdirSync(join(SRC, d)).map((f) => `${d}/${f}`))];
  assert.deepEqual([...shellList].sort(), onDisk.sort());
});

test("sw.js is published and the committed copy is unstamped (network first on a local server)", () => {
  assert.ok(PUBLIC_ENTRIES.includes(SW_FILE));
  assert.ok(swSource.includes(`'${SW_PLACEHOLDER}'`));
  assert.ok(swSource.includes(`const FILES = ${SW_FILES_PLACEHOLDER};`));
});

test("staging fingerprints every script and stylesheet into assets/ and points the page at the copies", () => {
  const pub = staged("a");
  const page = readFileSync(join(pub, "pharmacy-screen.html"), "utf8");
  const refs = [...page.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 10);
  for (const r of refs) {
    assert.match(r, /^assets\/(css|js)\/[\w-]+\.[0-9a-f]{10}\.(css|js)$/, `${r} is a fingerprinted copy`);
    assert.ok(existsSync(join(pub, r)), `${r} is published`);
  }
  // Every module and stylesheet has its copy, named after its content.
  for (const d of ["css", "js"]) {
    const copies = readdirSync(join(pub, ASSETS_DIR, d));
    for (const f of readdirSync(join(SRC, d))) assert.ok(copies.some((c) => c.startsWith(f.replace(/\.(css|js)$/, "."))), `${d}/${f} has a fingerprinted copy`);
    for (const c of copies) assert.equal(c.split(".").at(-2), sha16(readFileSync(join(pub, ASSETS_DIR, d, c))).slice(0, 10), `${c} is named after its content`);
  }
  // The copies only load each other: imports, the debug panel's stylesheet and the occasion stylesheets.
  for (const c of readdirSync(join(pub, ASSETS_DIR, "js"))) {
    const src = readFileSync(join(pub, ASSETS_DIR, "js", c), "utf8");
    for (const m of src.matchAll(/(?:from\s*|import\s*\(\s*|import\s+)['"](\.\/[^'"]+)['"]/g)) {
      assert.match(m[1], /^\.\/[\w-]+\.[0-9a-f]{10}\.js$/, `${c} imports ${m[1]}`);
      assert.ok(existsSync(join(pub, ASSETS_DIR, "js", m[1].slice(2))));
    }
    for (const m of src.matchAll(/['"]((?:assets\/)?css\/[^'"]+\.css)['"]/g)) assert.match(m[1], /^assets\/css\/[\w-]+\.[0-9a-f]{10}\.css$/, `${c} loads ${m[1]}`);
  }
  // No font or photo is left inline: each is its own file the stylesheet points at.
  for (const c of readdirSync(join(pub, ASSETS_DIR, "css"))) {
    const css = readFileSync(join(pub, ASSETS_DIR, "css", c), "utf8");
    assert.doesNotMatch(css, /data:(font|image\/(jpeg|png|webp));base64/, `${c} has no base64 font or photo`);
    for (const m of css.matchAll(/url\("\.\.\/((fonts|media)\/[^"]+)"\)/g)) assert.ok(existsSync(join(pub, ASSETS_DIR, m[1])), `${m[1]} is published`);
    // A custom property's url() resolves against the page that uses it (the Christmas photo, --occ-photo).
    for (const m of css.matchAll(/--[\w-]+:url\("([^"]+)"\)/g)) assert.match(m[1], /^assets\/media\/[0-9a-f]{16}\.jpg$/), assert.ok(existsSync(join(pub, m[1])));
  }
  assert.ok(readdirSync(join(pub, ASSETS_DIR, "fonts")).every((f) => f.endsWith(".woff2")));
  assert.deepEqual(readdirSync(join(pub, ASSETS_DIR, "media")).map((f) => f.split(".").pop()), ["jpg"]);
  // What blocks the first paint is the three small stylesheets the page links, not 1.5 MB of base64.
  const blocking = refs.filter((r) => r.endsWith(".css")).reduce((n, r) => n + readFileSync(join(pub, r)).length, 0);
  assert.ok(blocking < 40 * 1024, `render-blocking CSS is ${blocking} bytes`);
  // The admin editor's preview still has the originals.
  for (const f of ["css/screen.css", "css/occasion-fonts.css", "js/render.js"]) assert.equal(readFileSync(join(pub, f), "utf8"), readFileSync(join(SRC, f), "utf8"));
});

test("sw.js is stamped with every shell file and its hash; the same files give the same build", () => {
  const a = staged("b"), b = staged("c");
  const swA = readFileSync(join(a, SW_FILE), "utf8");
  assert.ok(!swA.includes(SW_PLACEHOLDER) && !swA.includes(SW_FILES_PLACEHOLDER), "stamped");
  const build = swA.match(/const BUILD = '([0-9a-f]{16})'/);
  assert.ok(build, "BUILD is a 16-character hash");
  assert.equal(readFileSync(join(b, SW_FILE), "utf8"), swA, "byte-identical when nothing changed, so players download nothing");
  assert.equal(build[1], shellBuildId(a));
  const files = stamped(a);
  assert.deepEqual(files, shellFiles(a));
  assert.ok(files["pharmacy-screen.html"]);
  for (const [f, hash] of Object.entries(files)) assert.equal(hash, sha16(readFileSync(join(a, f))), `${f}'s hash`);
  const assets = Object.keys(files).filter((f) => f !== "pharmacy-screen.html");
  assert.ok(assets.every((f) => f.startsWith(`${ASSETS_DIR}/`)));
  assert.ok(assets.some((f) => /occasion-fonts\./.test(f)) && assets.some((f) => /\.jpg$/.test(f)), "the Seasonal fonts and photo are kept on the device too (offline)");
});

test("a one-line change to js/player.js changes the page and that one script only", () => {
  const pub = staged("d");
  const before = stamped(pub);
  appendFileSync(join(pub, "js", "player.js"), "\n// changed\n");
  copyFileSync(join(SRC, SW_FILE), join(pub, SW_FILE));
  const build = stampServiceWorker(pub);
  const after = stamped(pub);
  assert.equal(build, shellBuildId(pub));
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((f) => before[f] !== after[f]).sort();
  assert.equal(changed.length, 3, changed.join(", "));
  // The old player copy leaves the list, the new one joins it, and the page that names it changes.
  assert.deepEqual(changed.map((f) => f.replace(/\.[0-9a-f]{10}\.js$/, ".js")).sort(), ["assets/js/player.js", "assets/js/player.js", "pharmacy-screen.html"]);
  // The rest of the shell is unchanged, so the worker copies it from the old cache.
  assert.equal(Object.keys(after).length, Object.keys(before).length);
});

test("the build changes when a shell file changes, and not when anything else does", () => {
  const pub = staged("e");
  const before = shellBuildId(pub);
  appendFileSync(join(pub, "fixtures", "config.json"), "\n");
  writeFileSync(join(pub, "admin", "extra.txt"), "x");
  copyFileSync(join(SRC, SW_FILE), join(pub, SW_FILE));
  assert.equal(stampServiceWorker(pub), before, "fixtures and the admin editor are not the screen's shell");
  appendFileSync(join(pub, "css", "screen.css"), "/* changed */");
  copyFileSync(join(SRC, SW_FILE), join(pub, SW_FILE));
  const after = stampServiceWorker(pub);
  assert.notEqual(after, before);
  assert.equal(after, shellBuildId(pub));
});

test("the worker reuses an unchanged file from the old build and downloads, and checks, only the rest", () => {
  assert.match(swSource, /async function fillShell\(\)/);
  assert.match(swSource, /old\.match\(url\)/, "looks in the older build's cache first");
  assert.match(swSource, /hashOf\(hit\.clone\(\)\)\) === hash/, "keeps an old copy only when its bytes hash the same");
  assert.match(swSource, /not the published build/, "a downloaded file that does not match fails the install");
  assert.match(swSource, /crypto\.subtle\.digest\('SHA-256'/);
});

test("the page preloads the whole static import graph of js/player.js", () => {
  const page = readFileSync(join(SRC, "pharmacy-screen.html"), "utf8");
  const preloaded = [...page.matchAll(/<link rel="modulepreload" href="js\/([\w-]+\.js)">/g)].map((m) => m[1]).sort();
  const graph = new Set();
  (function walk(name) {
    for (const m of readFileSync(join(SRC, "js", name), "utf8").matchAll(/^import [^;]*? from '\.\/([\w-]+\.js)';/gm)) {
      if (!graph.has(m[1])) { graph.add(m[1]); walk(m[1]); }
    }
  })("player.js");
  assert.deepEqual(preloaded, [...graph].sort());
  assert.ok(!graph.has("debug-panel.js"), "the debug panel stays a dynamic import (debug=1 only)");
  // The Seasonal stylesheets and the debug panel's are not in the page: js/player.js and js/debug-panel.js load them.
  assert.doesNotMatch(page, /occasion-(fonts|media)\.css"|debug\.css"/);
  assert.match(readFileSync(join(SRC, "js", "player.js"), "utf8"), /'css\/occasion-fonts\.css', 'css\/occasion-media\.css'/);
});

test("Roboto (the debug panel's font) is in debug.css, not in the screen's fonts", () => {
  assert.doesNotMatch(readFileSync(join(SRC, "css", "fonts.css"), "utf8"), /font-family:"Roboto"/);
  assert.match(readFileSync(join(SRC, "css", "debug.css"), "utf8"), /font-family:"Roboto"/);
});

test("the player registers the worker for the screen page only, and not on a local server unless sw=1", () => {
  const player = readFileSync(join(SRC, "js", "player.js"), "utf8");
  assert.match(player, /register\('sw\.js', \{ scope: '\.\/pharmacy-screen\.html' \}\)/);
  assert.match(player, /local && !flag\('sw'\)/);
});
