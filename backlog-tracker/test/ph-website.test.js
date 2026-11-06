// Runs ph-website/tests/leak.php (nothing private in any agent endpoint) and ph-website/tests/run.php (the PH Agent Endpoint snippet's offline
// tests: allow-list, twins, JSON-LD, llms.txt, leak checks). Part of the
// console's test run so the train runs it; needs `php` on the runner.
const { spawnSync } = require("child_process");
const path = require("path");

const probe = spawnSync("php", ["-v"], { encoding: "utf8" });
if (probe.error || probe.status !== 0) {
  console.log("ph-website: php not installed here; skipping (CI runners have it)");
  process.exit(0);
}
const r = spawnSync("php", [path.join(__dirname, "..", "..", "ph-website", "tests", "run.php")], { encoding: "utf8" });
process.stdout.write(r.stdout || "");
process.stderr.write(r.stderr || "");
const l = spawnSync("php", [path.join(__dirname, "..", "..", "ph-website", "tests", "leak.php")], { encoding: "utf8" });
process.stdout.write(l.stdout || "");
process.stderr.write(l.stderr || "");
const mt = spawnSync("php", [path.join(__dirname, "..", "..", "ph-website", "tests", "ph-media.test.php")], { encoding: "utf8" });
process.stdout.write(mt.stdout || "");
process.stderr.write(mt.stderr || "");
const tp = spawnSync("php", [path.join(__dirname, "..", "..", "ph-website", "tests", "telco-model.test.php")], { encoding: "utf8" });
process.stdout.write(tp.stdout || "");
process.stderr.write(tp.stderr || "");
const lc = spawnSync("php", [path.join(__dirname, "..", "..", "ph-website", "tests", "legacy-copy.test.php")], { encoding: "utf8" });
process.stdout.write(lc.stdout || "");
process.stderr.write(lc.stderr || "");
const lc2 = spawnSync("php", [path.join(__dirname, "..", "..", "ph-website", "tests", "legacy-copy-v2.test.php")], { encoding: "utf8" });
process.stdout.write(lc2.stdout || "");
process.stderr.write(lc2.stderr || "");
const lc3 = spawnSync("php", [path.join(__dirname, "..", "..", "ph-website", "tests", "legacy-copy-v3.test.php")], { encoding: "utf8" });
process.stdout.write(lc3.stdout || "");
process.stderr.write(lc3.stderr || "");
const tj = spawnSync("node", [path.join(__dirname, "..", "..", "ph-website", "tests", "telco-model.test.mjs")], { encoding: "utf8" });
process.stdout.write(tj.stdout || "");
process.stderr.write(tj.stderr || "");
const pj = spawnSync("node", [path.join(__dirname, "..", "..", "ph-website", "tests", "pharmacy-model.test.mjs")], { encoding: "utf8" });
process.stdout.write(pj.stdout || "");
process.stderr.write(pj.stderr || "");
const ct = spawnSync("php", [path.join(__dirname, "..", "..", "ph-website", "tests", "calculators.test.php")], { encoding: "utf8" });
process.stdout.write(ct.stdout || "");
process.stderr.write(ct.stderr || "");
const cj = spawnSync("node", [path.join(__dirname, "..", "..", "ph-website", "tests", "calc-webmcp.test.mjs")], { encoding: "utf8" });
process.stdout.write(cj.stdout || "");
process.stderr.write(cj.stderr || "");
const w = spawnSync("node", [path.join(__dirname, "..", "..", "ph-website", "tests", "webmcp.test.js")], { encoding: "utf8" });
process.stdout.write(w.stdout || "");
process.stderr.write(w.stderr || "");
// The post-deploy check lists every check without touching the network (--dry-run) and must still parse.
const e = spawnSync("node", [path.join(__dirname, "..", "..", "ph-website", "tests", "e2e-live.mjs"), "--dry-run"], { encoding: "utf8" });
process.stdout.write((e.stdout || "").split("\n")[0] + "\n");
process.stderr.write(e.stderr || "");
const eOk = e.status === 0 && /e2e-live: \d+ checks/.test(e.stdout || "");
if (!eOk) console.error("FAIL: ph-website/tests/e2e-live.mjs --dry-run");
process.exit(r.status === 0 && l.status === 0 && mt.status === 0 && tp.status === 0 && lc.status === 0 && lc2.status === 0 && tj.status === 0 && pj.status === 0 && ct.status === 0 && cj.status === 0 && w.status === 0 && eOk ? 0 : 1);
