// e2e-run.mjs: green run, injected failure, known-gap, unconfigured step.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const script = resolve("../scripts/e2e-run.mjs");
function run(steps, mode = "full") {
  const dir = mkdtempSync(join(tmpdir(), "e2e-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { ok: "node -e 0", bad: "node -e process.exit(1)" } }));
  writeFileSync(join(dir, "cases.json"), JSON.stringify([{ id: "A1", status: "pass" }, { id: "B2", status: "known-gap" }]));
  writeFileSync(join(dir, "e2e.config.json"), JSON.stringify({ steps }));
  const r = spawnSync("node", [script, "--folder", dir, "--mode", mode], { encoding: "utf8" });
  return { code: r.status, status: JSON.parse(r.stdout.trim().split("\n").pop()), dir };
}
const green = run([{ id: "s", label: "S", cmd: "npm run ok", modes: ["full"], cases: "cases.json" }, { id: "j", label: "J", cmd: "npm run missing", modes: ["full"] }]);
assert.equal(green.code, 0);
assert.deepEqual([green.status.pass, green.status.fail, green.status.gap, green.status.skipped], [1, 0, 1, 1]);
assert.equal(readdirSync(join(green.dir, "results")).length, 1);
const red = run([{ id: "s", label: "S", cmd: "npm run bad", modes: ["full"] }]);
assert.equal(red.code, 1);
assert.equal(red.status.fail, 1);
assert.equal(run([{ id: "s", label: "S", cmd: "npm run bad", modes: ["full"] }], "quick").status.fail, 0, "mode filter");
console.log("e2e-run: ok");
