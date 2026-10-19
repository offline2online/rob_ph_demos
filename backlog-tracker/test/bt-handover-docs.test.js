// The Backlog Tracker & FAQs handover documents on the console: the mirrors
// declared in backlog-tracker/board-docs.json and the Start-here index they
// are led by (backlog-tracker/START-HERE.md). Runs against the real files,
// so a heading renamed in CLAUDE.md, a part grown past the board's cap, or
// a function renamed under the index fails here, before the post-merge sync
// has to report it. Added to test:train-lock.
//
// Run with:  node test/bt-handover-docs.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { mirrorSpec, mirrorText, validateManifest, BOARD_DOC_CAP } = require("../scripts/docs-sync-lib.js");

const REPO = path.join(__dirname, "..", "..");
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");
const exists = (p) => fs.existsSync(path.join(REPO, p));
const MANIFEST = "backlog-tracker/board-docs.json";
const START = "backlog-tracker/START-HERE.md";
// Headroom under the 20,000 cap for edits that skip this test (a CLAUDE.md
// change on another train, say): a cut at 18,500 can take 1,500 characters.
const CUT_LIMIT = 18500;

const m = JSON.parse(read(MANIFEST));
const start = read(START);
let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (err) { console.log(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); process.exitCode = 1; }
}
const cut = (e) => mirrorText(read(e.path), mirrorSpec(m, e));

test("the manifest has the 14 mirrors, valid under docs-manifest's own validator", () => {
  assert.strictEqual(m.mirrors.length, 14);
  assert.deepStrictEqual(validateManifest(m, exists), []);
});

test("keys and names are unique; names are 1–120 characters; only Start here is '0 — '", () => {
  const keys = m.mirrors.map((e) => e.key);
  const names = m.mirrors.map((e) => e.name);
  assert.strictEqual(new Set(keys).size, keys.length, "a key is listed twice");
  assert.strictEqual(new Set(names).size, names.length, "a name is listed twice");
  for (const n of names) assert.ok(n.length >= 1 && n.length <= 120, `name is ${n.length} characters: ${n}`);
  const zero = m.mirrors.filter((e) => e.name.startsWith("0 — "));
  assert.deepStrictEqual(zero.map((e) => e.path), [START]);
});

test("get_project_docs sorts by name: localeCompare order equals the manifest order", () => {
  const names = m.mirrors.map((e) => e.name);
  assert.deepStrictEqual([...names].sort((a, b) => a.localeCompare(b)), names);
});

test("startHere resolves to the START-HERE entry", () => {
  const e = m.mirrors.find((x) => x.key === m.startHere);
  assert.ok(e, `startHere "${m.startHere}" is not a mirror key`);
  assert.strictEqual(e.path, START);
});

test("every entry cuts with the real mirrorText, and each cut fits the board's cap with headroom", () => {
  for (const e of m.mirrors) {
    assert.ok(exists(e.path), `${e.path} does not exist (${e.key})`);
    let text;
    try { text = cut(e); } catch (err) {
      assert.fail(`${e.key} ← ${e.path}: ${err.message}. A heading in ${e.path} was renamed or removed: restore it, or change the slice marker in ${MANIFEST} to the new heading line.`);
    }
    assert.ok(text.length <= CUT_LIMIT, `${e.key} ← ${e.path} cuts to ${text.length} characters, over ${CUT_LIMIT} (the board allows ${BOARD_DOC_CAP}). Add a slice marker at a heading inside ${e.path} to ${MANIFEST} so the file is cut into one more part, and renumber the names.`);
  }
});

test("each file's parts cover it with no gap or overlap, and each prefix names its path and part", () => {
  const byPath = new Map();
  for (const e of m.mirrors) byPath.set(e.path, [...(byPath.get(e.path) || []), e]);
  for (const [p, parts] of byPath) {
    const N = parts.length;
    parts.forEach((e, i) => {
      const prefix = typeof e.prefix === "string" ? e.prefix : "";
      assert.ok(prefix.includes(`\`${p}\``), `${e.key}: prefix does not name ${p}`);
      if (N > 1) assert.ok(prefix.includes(`(part ${i + 1} of ${N})`), `${e.key}: prefix does not say "part ${i + 1} of ${N}"`);
      else assert.ok(!/part \d+ of/.test(prefix), `${e.key}: a whole-file mirror says "part n of N"`);
      const sl = (e.slices && e.slices[0]) || {};
      if (N > 1) {
        assert.strictEqual(e.slices.length, 1, `${e.key}: one slice per part`);
        if (i === 0) assert.ok(!sl.start, `${e.key}: part 1 must not have a start`);
        else assert.strictEqual(sl.start, parts[i - 1].slices[0].end, `${e.key}: start must equal the previous part's end`);
        if (i === N - 1) assert.ok(!sl.end, `${e.key}: the last part must not have an end`);
        else assert.ok(sl.end, `${e.key}: a part before the last needs an end`);
      } else assert.ok(!e.slices || e.slices.length === 0, `${e.key}: a whole-file mirror has no slices`);
    });
    if (N > 1) {
      // The parts, put back together, are the file: nothing dropped, nothing twice.
      const raw = read(p).replace(/\n+$/, "");
      const joined = parts.map((e) => cut({ ...e, prefix: "" }).replace(/\n+$/, "")).join("\n\n");
      assert.strictEqual(joined.replace(/\n+/g, "\n"), raw.replace(/\n+/g, "\n"), `${p}: its parts do not add up to the file`);
    }
  }
});

test("START-HERE.md fits with its banner", () => {
  const e = m.mirrors.find((x) => x.path === START);
  assert.ok(cut(e).length <= 16000, `START-HERE.md is ${cut(e).length} characters with its banner, over 16,000`);
});

test("START-HERE.md: every backticked repo path and workflow exists", () => {
  const ticks = [...start.matchAll(/`([^`\n]+)`/g)].map((x) => x[1]);
  const seen = new Set();
  for (const t of ticks) {
    if (seen.has(t)) continue;
    seen.add(t);
    if (/^[A-Za-z0-9_.-]+\.yml$/.test(t)) { assert.ok(exists(`.github/workflows/${t}`), `workflow ${t} does not exist`); continue; }
    if (/^[A-Za-z0-9_.][A-Za-z0-9_.-]*(\/[A-Za-z0-9_.-]+)+\/?$/.test(t) && !/^(offline2online|deploy)\//.test(t) && !/^(archive)\//.test(t)) {
      assert.ok(exists(t.replace(/\/$/, "")), `${t} is cited in START-HERE.md but does not exist`);
    }
  }
});

test("START-HERE.md names every manifest mirror exactly", () => {
  for (const e of m.mirrors) assert.ok(start.includes(e.name), `START-HERE.md does not name "${e.name}"`);
  for (const e of m.mirrors) assert.ok(start.includes(`\`${e.path}\``), `START-HERE.md does not cite ${e.path}`);
});

test("START-HERE.md: every function it cites is declared in the automation, the docs-sync lib or the Cloud Functions", () => {
  const files = ["backlog-tracker/scripts/run-backlog-automation.js", "backlog-tracker/scripts/docs-sync-lib.js"]
    .concat(fs.readdirSync(path.join(REPO, "backlog-tracker/functions")).filter((f) => f.endsWith(".js")).map((f) => `backlog-tracker/functions/${f}`));
  const src = files.map(read).join("\n");
  const names = [...new Set([...start.matchAll(/`([A-Za-z_][A-Za-z0-9_]*)\(\)`/g)].map((x) => x[1]))];
  assert.ok(names.length >= 10, `only ${names.length} functions cited`);
  for (const n of names) assert.ok(new RegExp(`\\b${n}\\b`).test(src), `${n}() is cited in START-HERE.md but is not declared in ${files.join(", ")}`);
});

test("START-HERE.md: the deploy map names every top-level folder", () => {
  const dirs = fs.readdirSync(REPO, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "node_modules").map((d) => d.name);
  const map = start.slice(start.indexOf("## Deploy map"));
  for (const d of dirs) assert.ok(map.includes(`${d}/`), `the deploy map in START-HERE.md does not name ${d}/`);
});

console.log(`\n${passed} passed`);
