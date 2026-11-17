// The console workflow runs ui-touch and ui-kanban as parts side by side
// (UI_SHARD / KB_SHARD, 16 Nov 2026). The parts must together run every file
// and every profile of the viewport matrix exactly once: a part count in the
// workflow that disagrees with its "i/n" would silently drop tests.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

(async () => {
  const { shardOf, PROFILES, wantedProfiles } = await import("../../kanban-staff-board/test/lib/profiles.mjs");

  // shardOf: n parts partition the list; unset is the whole list; a bad spec throws.
  const list = Array.from({ length: 11 }, (_, k) => k);
  for (const n of [1, 2, 3, 4, 11, 12]) {
    const parts = Array.from({ length: n }, (_, i) => shardOf(list, `${i}/${n}`));
    assert.deepStrictEqual(parts.flat().sort((a, b) => a - b), list, `${n} parts cover the list once`);
  }
  assert.strictEqual(shardOf(list, ""), list);
  assert.strictEqual(shardOf(list, undefined), list);
  for (const bad of ["4/4", "1", "a/b", "-1/3", "0/0", "1/3/5"]) assert.throws(() => shardOf(list, bad), /Bad shard/, bad);
  assert.deepStrictEqual(wantedProfiles({ KB_SHARD: "0/4" }).map((p) => p.id), PROFILES.filter((_, k) => k % 4 === 0).map((p) => p.id));
  assert.deepStrictEqual(wantedProfiles({ KB_PROFILES: "quick", KB_SHARD: "" }).length, 2, "the minified run's quick profiles are not sharded");

  // The workflow: each sharded job's matrix is 0..n-1 and its env says /n.
  const wf = fs.readFileSync(path.join(__dirname, "../../.github/workflows/firestore-rules-test.yml"), "utf8");
  const { workflowJobs } = require("./ci-coverage.test.js");
  const jobs = workflowJobs(wf);
  let sharded = 0;
  for (const [name, text] of Object.entries(jobs)) {
    const env = /\b(UI_SHARD|KB_SHARD):\s*\$\{\{\s*matrix\.shard\s*\}\}\/(\d+)/.exec(text);
    const matrix = /^\s+shard:\s*\[([\d,\s]+)\]/m.exec(text);
    assert.strictEqual(!!env, !!matrix, `job ${name}: a shard matrix and its *_SHARD env go together`);
    if (!env) { assert.ok(!/_SHARD:/.test(text), `job ${name} sets a shard without a matrix`); continue; }
    sharded++;
    const n = +env[2];
    assert.deepStrictEqual(matrix[1].split(",").map((x) => +x.trim()), Array.from({ length: n }, (_, i) => i), `job ${name}: matrix.shard must be 0..${n - 1} to match /${n}`);
    assert.ok(/fail-fast:\s*false/.test(text), `job ${name}: every part reports (fail-fast: false)`);
    assert.ok(/name:\s*flaky-tests-[\w-]+-\$\{\{\s*matrix\.shard\s*\}\}/.test(text), `job ${name}: each part uploads its own flaky-tests artifact`);
    assert.ok(n <= PROFILES.length, "no empty part");
  }
  assert.strictEqual(sharded, 2, "ui-touch and ui-kanban run in parts");
  // The minified run happens in exactly one part.
  assert.ok(/if:\s*matrix\.shard == \d\s*\n\s*run: npm run test:ui:kanban:minified/.test(jobs["ui-kanban"]), "the minified build is tested by one part only");
  // Every job the run is judged by is in wake-automation's needs.
  const needs = /needs:\s*\[([^\]]+)\]/.exec(jobs["wake-automation"])[1].split(",").map((x) => x.trim()).sort();
  assert.deepStrictEqual(needs, Object.keys(jobs).filter((j) => j !== "wake-automation").sort());
  // The long touch files are spread over the parts (measured 16 Nov 2026:
  // nav-touch 413 s, whiteboard-tablet 392 s, support-touch 264 s, whiteboard 155 s).
  const touch = require("./package.json").scripts["test:ui:touch"].split(/\s+/).filter((f) => f.endsWith(".test.mjs")).map((f) => path.basename(f));
  const partOf = (f) => touch.indexOf(f) % 3;
  assert.strictEqual(new Set(["nav-touch.test.mjs", "whiteboard-tablet.test.mjs", "support-touch.test.mjs"].map(partOf)).size, 3, "the three longest touch files run in different parts");
  assert.strictEqual(partOf("whiteboard.test.mjs"), partOf("support-touch.test.mjs"));
  console.log("ui-shards: ok");
})().catch((err) => { console.error(err); process.exit(1); });
