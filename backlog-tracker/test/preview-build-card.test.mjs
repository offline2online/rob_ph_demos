// "Rebuilding test link…" on a Ready for Testing card (lmdwsP5ElY5Oh12N9Fex).
//
// A link that opens a checked-in build is live the moment the ticket lands but
// still shows the previous bundle until the build workflow reruns. The card now
// says so, and Failed testing is held until the bundle includes the ticket.
//
// Pulls the REAL functions out of public/js/app.js and runs them in a vm
// context — no DOM, no Firebase.
//
// Run with:  node test/preview-build-card.test.mjs
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "..", "public", "js", "app.js"), "utf8");

function extract(name) {
  const start = src.indexOf(`\nfunction ${name}(`);
  assert.ok(start >= 0, `app.js defines ${name}`);
  let i = src.indexOf("{", src.indexOf(")", start)), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) break;
  }
  return src.slice(start, i + 1);
}
function constant(name) {
  const m = src.match(new RegExp(`\\nconst ${name} = [^;]+;`));
  assert.ok(m, `app.js defines ${name}`);
  return m[0];
}

const code = ["PREVIEW_REBUILD_STALE_MS", "PREVIEW_ACTIONS_URL", "PREVIEW_FAIL_HOLD_TITLE"].map(constant).join("\n") + "\n" + [
  "anyMillis", "describeAgo", "previewBuildStatus", "testLinkRowHTML", "failTestingButtonHTML", "failTestingStaleWarning",
].map(extract).join("\n");
const ctx = { escapeHTML: (s) => String(s), safeHttpUrl: (s) => s, Date, Number, Math, String };
vm.createContext(ctx);
vm.runInContext(code, ctx);

const NOW = Date.parse("2026-10-19T12:00:00Z");
const iso = (ms) => new Date(ms).toISOString();
const LINK = "https://rawcdn.githack.com/offline2online/rob_ph_demos/abc1234567890/dsp-integration/prototype/index.html";
const card = (extra) => ({ id: "t1", previewUrl: LINK, ...extra });
const rebuilding = (ageMs) => card({ previewState: "rebuilding", previewStateAt: iso(NOW - ageMs), previewBuildWorkflow: "dsp-prototype.yml" });

let passed = 0; const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`FAIL  ${name}\n      ${err && err.stack || err}`); }
}

test("rebuilding: no Test this anchor, a status line, the pencil stays, Failed testing is disabled", () => {
  const item = rebuilding(60e3);
  const row = ctx.testLinkRowHTML(item, NOW);
  assert.doesNotMatch(row, /test-link-btn/);
  assert.match(row, /role="status"/);
  assert.match(row, /progress_activity/);
  assert.match(row, /Rebuilding test link&hellip;/);
  assert.match(row, /usually 1-2 minutes/);
  assert.match(row, /test-link-edit-btn/);
  const btn = ctx.failTestingButtonHTML(item, NOW);
  assert.match(btn, /\bdisabled\b/);
  assert.match(btn, /Available once the test link includes this ticket \(usually 1-2 minutes\)/);
});

test("over 20 minutes: the link and an enabled Failed testing return, with the warning and the workflow link", () => {
  for (const item of [rebuilding(21 * 60e3), card({ previewState: "stale", previewStateAt: iso(NOW - 3600e3), previewBuildWorkflow: "dsp-prototype.yml" })]) {
    const row = ctx.testLinkRowHTML(item, NOW);
    assert.match(row, /class="test-link-btn"/);
    assert.match(row, /Still rebuilding after 20 minutes\. This link may show the previous build\./);
    assert.match(row, /href="https:\/\/github\.com\/offline2online\/rob_ph_demos\/actions\/workflows\/dsp-prototype\.yml"/);
    assert.doesNotMatch(ctx.failTestingButtonHTML(item, NOW), /\bdisabled\b/);
  }
});

test("a workflow name that isn't a plain workflow file gets no link", () => {
  const row = ctx.testLinkRowHTML(card({ previewState: "stale", previewStateAt: iso(NOW - 3600e3), previewBuildWorkflow: "x/../../y" }), NOW);
  assert.doesNotMatch(row, /actions\/workflows/);
});

test("ready: Test this plus 'Includes this ticket · built from <sha7> · updated …'", () => {
  const item = card({ previewState: "ready", previewStateAt: iso(NOW - 60e3), previewBuiltFrom: "0123456789abcdef", previewUpdatedAt: iso(NOW - 5 * 60e3) });
  const row = ctx.testLinkRowHTML(item, NOW);
  assert.match(row, /class="test-link-btn"/);
  assert.match(row, /Includes this ticket/);
  assert.match(row, /built from 0123456/);
  assert.doesNotMatch(row, /built from 01234567\b/);
  assert.match(row, /updated 5m ago/);
  assert.doesNotMatch(ctx.failTestingButtonHTML(item, NOW), /\bdisabled\b/);
});

test("ready: the 'updated' text follows the nowMs it is given, not the real clock", () => {
  for (const now of [NOW + 86400e3, NOW + 365 * 86400e3]) {
    const item = card({ previewState: "ready", previewStateAt: iso(now - 60e3), previewBuiltFrom: "0123456789abcdef", previewUpdatedAt: iso(now - 5 * 60e3) });
    assert.match(ctx.testLinkRowHTML(item, now), /updated 5m ago/);
  }
});

test("null previewState is today's markup", () => {
  const row = ctx.testLinkRowHTML(card({}), NOW);
  assert.strictEqual(row.trim(), `<div class="test-link-row"><a href="${LINK}" target="_blank" rel="noopener" class="test-link-btn">Test this &rarr;</a><button type="button" class="icon-btn test-link-edit-btn" data-id="t1" title="Change test link">&#9998;</button></div>`);
  assert.strictEqual(ctx.failTestingButtonHTML(card({}), NOW), `<button type="button" class="approve-btn fail-testing-btn" data-id="t1">Failed testing</button>`);
  assert.strictEqual(ctx.testLinkRowHTML({ id: "x" }, NOW), "");
});

test("the Failed testing dialog warns only when the link is stale", () => {
  assert.match(ctx.failTestingStaleWarning(rebuilding(21 * 60e3), NOW), /may still show the previous build/);
  assert.strictEqual(ctx.failTestingStaleWarning(rebuilding(60e3), NOW), "");
  assert.strictEqual(ctx.failTestingStaleWarning(card({ previewState: "ready", previewStateAt: iso(NOW) }), NOW), "");
  assert.strictEqual(ctx.failTestingStaleWarning(card({}), NOW), "");
});

test("a rebuilding card with no readable timestamp is shown as stale, never hidden for good", () => {
  assert.strictEqual(ctx.previewBuildStatus(card({ previewState: "rebuilding" }), NOW).state, "stale");
});

test("PREVIEW_REBUILD_STALE_MS matches the automation's", () => {
  const require = createRequire(import.meta.url);
  const auto = require("../scripts/run-backlog-automation.js");
  assert.strictEqual(vm.runInContext("PREVIEW_REBUILD_STALE_MS", ctx), auto.PREVIEW_REBUILD_STALE_MS);
});

test("cardHTML renders the row through testLinkRowHTML and the button through failTestingButtonHTML", () => {
  assert.match(src, /testLinkRowHTML\(item\)/);
  assert.match(src, /failTestingButtonHTML\(item\)/);
  assert.doesNotMatch(src, /always-uncached/);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
