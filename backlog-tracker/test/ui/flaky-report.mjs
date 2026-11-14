// Turns this run's recorded flakes (ui/flaky.mjs) into the flaky-tests.json
// artifact and a line in the job summary. Always exits 0: a flake passed on
// its retry, so it never fails the run; the board's ledger is what chases it.
//   node ui/flaky-report.mjs [--out flaky-tests.json] [--in flaky-tests.jsonl …]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFlaky, flakyFile } from "./flaky.mjs";

// "TC-55 desktop-1280, passed on retry; KB-C13 phone-390, passed on retry"
export const flakyLabel = (f) => `${f.id}${f.profile ? ` ${f.profile}` : ""}`;
export function summaryLine(flaky) {
  return flaky.length ? `Flaky this run: ${flaky.map((f) => `${flakyLabel(f)}, passed on retry`).join("; ")}` : "Flaky this run: none";
}
export function buildReport(flaky, env = process.env) {
  const runUrl = env.GITHUB_RUN_ID && env.GITHUB_REPOSITORY ? `${env.GITHUB_SERVER_URL || "https://github.com"}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : "";
  return { generatedAt: new Date().toISOString(), runUrl, sha: env.GITHUB_SHA || "", job: env.GITHUB_JOB || "", flaky };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const ins = [];
  let out = path.join(path.dirname(flakyFile()), "flaky-tests.json");
  for (let i = 0; i < args.length; i++) { if (args[i] === "--out") out = args[++i]; else if (args[i] === "--in") ins.push(args[++i]); }
  const flaky = (ins.length ? ins : [flakyFile()]).flatMap((f) => readFlaky(f));
  fs.writeFileSync(out, JSON.stringify(buildReport(flaky), null, 1) + "\n");
  const line = summaryLine(flaky);
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const detail = flaky.map((f) => `- \`${flakyLabel(f)}\` (${f.suite}): ${f.error || "no message"}`).join("\n");
    try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${line}\n${detail ? detail + "\n" : ""}\n`); } catch { /* the summary is a convenience */ }
  }
}
