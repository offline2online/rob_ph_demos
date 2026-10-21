// Runs one suite once per profile of the viewport matrix, several profiles at a time, each in its
// own process (so one profile's crash or hang cannot take the others down), and reports them
// together. Both suites use it: `npm test` here, and backlog-tracker/test/ui/staff-kanban.test.mjs.
//
//   KB_JOBS=4        profiles in parallel (default: the CPU count, at most 4)
//   KB_SERIAL=1      one process, profiles one after another (what a worker itself does)
//
// A worker is the same script run with KB_WORKER=1 and a single KB_PROFILES id.
import { spawn } from "node:child_process";
import os from "node:os";
import fs from "node:fs";

const MARK = /^(#\s*)?(# )?(CONFIRM|KNOWN DEFECT|FIXED|FLAKY|RETRY|NOT RUN)\b/;

export async function runMatrix({ name, command, args, cwd, profiles, env = process.env }) {
  const jobs = Math.max(1, +(env.KB_JOBS || Math.min(4, os.cpus().length)));
  const queue = profiles.slice();
  const done = [];
  const t0 = Date.now();
  console.log(`\n${name}: ${profiles.length} profile(s), ${jobs} at a time\n`);
  const run = (prof) => new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, args, { cwd, env: { ...env, KB_WORKER: "1", KB_PROFILES: prof.id, KB_ENGINES: "" } });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    child.on("close", (code) => resolve({ prof, code, out, ms: Date.now() - started }));
  });
  async function worker() {
    while (queue.length) {
      const r = await run(queue.shift());
      done.push(r);
      const lines = r.out.split("\n");
      const failed = lines.filter((l) => /^not ok\b/.test(l) || /^FAIL\b/.test(l));
      const passed = lines.filter((l) => /^ok\b/.test(l) || /^  ok\b/.test(l)).length;
      const skipped = lines.filter((l) => /# SKIP/.test(l) || /^ skip\b/.test(l)).length;
      const notRun = lines.filter((l) => /NOT RUN/.test(l));
      console.log(`${r.code === 0 ? "PASS" : "FAIL"}  ${r.prof.label}  — ${passed} passed, ${failed.length} failed, ${skipped} skipped, ${(r.ms / 1000).toFixed(0)}s${notRun.length ? "  (engine not available here)" : ""}`);
      for (const l of failed) console.log(`        ${l.replace(/^not ok \d+ - /, "").slice(0, 200)}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(jobs, profiles.length) }, worker));

  // The markers every worker printed, once each.
  const seen = new Set();
  const marks = [];
  for (const r of done) for (const l of r.out.split("\n")) {
    const m = l.replace(/^#\s*\\?#?\s*/, "").replace(/^# /, "");
    if (!/^(CONFIRM|KNOWN DEFECT|FIXED|FLAKY|NOT RUN)/.test(m)) continue;
    const key = m.replace(/\[[a-z0-9-]+\]/, "");
    if (seen.has(key)) continue;
    seen.add(key); marks.push(m);
  }
  const groups = ["CONFIRM", "KNOWN DEFECT", "FIXED", "FLAKY", "NOT RUN"];
  for (const g of groups) { const list = marks.filter((m) => m.startsWith(g)); if (list.length) { console.log(`\n${g} (${list.length})`); for (const m of list) console.log(`  ${m.slice(0, 400)}`); } }

  const failed = done.filter((r) => r.code !== 0);
  for (const r of failed) {
    console.log(`\n── ${r.prof.label}: full output of the failing run ──\n${r.out.split("\n").filter((l) => !/^ok\b|^  ok\b/.test(l)).join("\n").slice(-12000)}`);
  }
  const summary = { name, profiles: done.map((r) => ({ id: r.prof.id, label: r.prof.label, ok: r.code === 0, seconds: Math.round(r.ms / 1000) })), marks };
  if (env.KB_SUMMARY_JSON) fs.writeFileSync(env.KB_SUMMARY_JSON, JSON.stringify(summary, null, 1));
  console.log(`\n${name}: ${done.length - failed.length}/${done.length} profile(s) passed in ${Math.round((Date.now() - t0) / 1000)}s`);
  return { ok: failed.length === 0, summary, outputs: done };
}
