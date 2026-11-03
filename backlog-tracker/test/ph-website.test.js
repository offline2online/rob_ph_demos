// Runs ph-website/tests/run.php (the PH Agent Endpoint snippet's offline
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
const w = spawnSync("node", [path.join(__dirname, "..", "..", "ph-website", "tests", "webmcp.test.js")], { encoding: "utf8" });
process.stdout.write(w.stdout || "");
process.stderr.write(w.stderr || "");
process.exit(r.status === 0 && w.status === 0 ? 0 : 1);
