// Runs UI (Playwright) test files one after another, with one retry.
//   node ui/run-ui.mjs ui/mobile-shell.test.mjs ui/console-click.test.mjs …
//
// A file listed in CASE_LEVEL retries its own failed case (seconds), so it
// is run once here. Every other file is small (a handful of cases, seconds
// to a few minutes): when it fails, the file is run once more. A pass on that
// second run does not fail the run and is recorded as a flake (ui/flaky.mjs),
// named after the file and its first FAIL line. Stops at the first file that
// fails for good, like the `&&` chain this replaced.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recordFlaky, uiRetries } from "./flaky.mjs";

// These retry case by case themselves (retryCase / the Staff Kanban suite's withRetry).
export const CASE_LEVEL = ["console-click.test.mjs", "staff-kanban.test.mjs", "minified.test.mjs"];

function runFile(file, env = process.env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file], { env, stdio: ["ignore", "pipe", "pipe"] });
    let failLine = "";
    const tee = (stream, out) => stream.on("data", (buf) => {
      out.write(buf);
      if (!failLine) { const m = /^.*\b(FAIL|failed|Error)\b.*$/m.exec(String(buf)); if (m) failLine = m[0].trim().slice(0, 300); }
    });
    tee(child.stdout, process.stdout); tee(child.stderr, process.stderr);
    child.on("close", (code, signal) => resolve({ code: code ?? 1, failLine: failLine || (signal ? `killed by ${signal}` : `exit ${code}`) }));
  });
}

export async function runUiFiles(files, { retries = uiRetries(), log = console.log, run = runFile } = {}) {
  for (const file of files) {
    const name = path.basename(file);
    const t0 = Date.now();
    let res = await run(file);
    if (res.code !== 0 && retries > 0 && !CASE_LEVEL.includes(name)) {
      const first = res.failLine;
      log(`# RETRY ${name}: ${first}`);
      res = await run(file);
      if (res.code === 0) { recordFlaky({ suite: "console-ui", id: name, error: first }); log(`# FLAKY ${name}: failed, passed on retry 1 — ${first}`); }
    }
    log(`# ${res.code === 0 ? "ok  " : "FAIL"} ${name} (${Math.round((Date.now() - t0) / 1000)} s)`);
    if (res.code !== 0) return { ok: false, failed: name };
  }
  return { ok: true, failed: null };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2);
  if (!files.length) { console.error("usage: node ui/run-ui.mjs <test file> …"); process.exit(2); }
  const { ok } = await runUiFiles(files);
  process.exit(ok ? 0 : 1);
}
