// The screen's service worker as the deploy publishes it: staged, stamped with a hash of the shell, and covering
// every file the page loads. The browser half (cached start, offline start, update only on change) is
// pharmacy-screen/test/ui/offline-cache.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync, appendFileSync, mkdtempSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ROOT, PUBLIC_SOURCE, PUBLIC_ENTRIES, stagePublic, shellBuildId, stampServiceWorker, SW_FILE, SW_PLACEHOLDER } from "../scripts/deploy.mjs";

const SRC = join(ROOT, PUBLIC_SOURCE);
const swSource = readFileSync(join(SRC, SW_FILE), "utf8");
const shellList = JSON.parse(swSource.match(/const SHELL = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"').replace(/,\s*\]/, "]"));

test("the service worker's shell lists the page and every file in js/ and css/", () => {
  const onDisk = ["pharmacy-screen.html", ...["css", "js"].flatMap((d) => readdirSync(join(SRC, d)).map((f) => `${d}/${f}`))];
  assert.deepEqual([...shellList].sort(), onDisk.sort());
});

test("sw.js is published and the committed copy is unstamped (network first on a local server)", () => {
  assert.ok(PUBLIC_ENTRIES.includes(SW_FILE));
  assert.ok(swSource.includes(`'${SW_PLACEHOLDER}'`));
});

test("staging stamps sw.js with a hash of the shell; the same files give the same build", () => {
  const a = mkdtempSync(join(tmpdir(), "ps-sw-a-")), b = mkdtempSync(join(tmpdir(), "ps-sw-b-"));
  stagePublic(ROOT, join(a, "public"));
  stagePublic(ROOT, join(b, "public"));
  const swA = readFileSync(join(a, "public", SW_FILE), "utf8");
  assert.ok(!swA.includes(SW_PLACEHOLDER), "stamped");
  const build = swA.match(/const BUILD = '([0-9a-f]{16})'/);
  assert.ok(build, "BUILD is a 16-character hash");
  assert.equal(readFileSync(join(b, "public", SW_FILE), "utf8"), swA, "byte-identical when nothing changed, so players download nothing");
  assert.equal(build[1], shellBuildId(join(a, "public")));
});

test("the build changes when a shell file changes, and not when anything else does", () => {
  const out = mkdtempSync(join(tmpdir(), "ps-sw-c-"));
  const pub = join(out, "public");
  stagePublic(ROOT, pub);
  const before = shellBuildId(pub);
  appendFileSync(join(pub, "fixtures", "config.json"), "\n");
  writeFileSync(join(pub, "admin", "extra.txt"), "x");
  assert.equal(shellBuildId(pub), before, "fixtures and the admin editor are not the screen's shell");
  appendFileSync(join(pub, "css", "screen.css"), "/* changed */");
  const after = shellBuildId(pub);
  assert.notEqual(after, before);
  copyFileSync(join(SRC, SW_FILE), join(pub, SW_FILE));
  assert.equal(stampServiceWorker(pub), after);
});

test("the player registers the worker for the screen page only, and not on a local server unless sw=1", () => {
  const player = readFileSync(join(SRC, "js", "player.js"), "utf8");
  assert.match(player, /register\('sw\.js', \{ scope: '\.\/pharmacy-screen\.html' \}\)/);
  assert.match(player, /local && !flag\('sw'\)/);
});
