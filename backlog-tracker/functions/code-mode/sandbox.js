// Code Mode sandbox — the PARENT side.
//
// runInSandbox() forks sandbox-worker.js (one process per script, empty
// environment, no stdio), hands it the script, answers its tool calls through
// the `callTool` the caller supplies, and enforces the limits the isolate
// cannot enforce on itself:
//
//   wall clock   the child is SIGKILLed at the deadline — this also stops an
//                infinite loop that starts after an `await`, which
//                isolated-vm's own timeout does not interrupt
//   memory       isolated-vm's per-isolate heap limit (child side)
//   tool calls   counted here; the call over the cap is refused
//   result size  measured in the child before anything is sent back
//
// Why a child process and not an in-process isolate: isolated-vm crashes the
// host on Node 20+ unless Node is started with --no-node-snapshot, a flag the
// Cloud Functions runtime gives us no way to set for the function's own
// process. A forked child can have it. The process boundary is also a second
// wall around the isolate, and makes the kill-on-deadline unconditional.
//
// Never falls back to eval or Node's vm: if isolated-vm is not installed the
// call fails with kind "unavailable".
"use strict";

const { fork } = require("child_process");
const path = require("path");

const LIMITS = Object.freeze({
  DEFAULT_TIMEOUT_MS: 10000,
  MAX_TIMEOUT_MS: 30000,
  MIN_TIMEOUT_MS: 100,
  MEMORY_MB: 128,
  MAX_TOOL_CALLS: 50,
  MAX_RESULT_BYTES: 20 * 1024,
  MAX_SOURCE_BYTES: 20 * 1024,
  // Scripts running at once in one server instance. Each can hold a
  // MEMORY_MB heap plus a Node process, and the function has 1 GiB.
  MAX_CONCURRENT: 3,
});

const WORKER = path.join(__dirname, "sandbox-worker.js");
let ivmPath = null;
let running = 0;

// Tests install isolated-vm beside themselves, not under functions/.
function setIsolatedVmPath(p) { ivmPath = p; }
function resolveIsolatedVm() {
  if (ivmPath) return ivmPath;
  try { ivmPath = require.resolve("isolated-vm"); } catch (_) { ivmPath = null; }
  return ivmPath;
}

function clampTimeout(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return LIMITS.DEFAULT_TIMEOUT_MS;
  return Math.min(LIMITS.MAX_TIMEOUT_MS, Math.max(LIMITS.MIN_TIMEOUT_MS, Math.floor(n)));
}

// opts: { toolNames, callTool(name, args) -> Promise<value> (throws an Error
// whose message is safe to show the script), params, timeoutMs, memoryMb,
// maxToolCalls, maxResultBytes, filename }
// Resolves { ok: true, result, toolCalls, durationMs } or
// { ok: false, error: { kind, name, message, line?, column?, tool? }, toolCalls, durationMs }.
// Never rejects.
function runInSandbox(code, opts) {
  const o = opts || {};
  const started = Date.now();
  const toolCalls = [];
  const finish = (outcome) => Object.assign(outcome, { toolCalls, durationMs: Date.now() - started });
  const fail = (kind, name, message, extra) => finish({ ok: false, error: Object.assign({ kind, name, message }, extra || {}) });

  const source = String(code == null ? "" : code);
  if (!source.trim()) return Promise.resolve(fail("source", "EmptyScript", "code is empty."));
  const sourceBytes = Buffer.byteLength(source, "utf8");
  const maxSource = o.maxSourceBytes === undefined ? LIMITS.MAX_SOURCE_BYTES : o.maxSourceBytes;
  if (maxSource && sourceBytes > maxSource) {
    return Promise.resolve(fail("source-size", "ScriptTooLarge", `The script is ${sourceBytes} bytes; the limit is ${maxSource}.`));
  }
  const ivm = resolveIsolatedVm();
  if (!ivm) return Promise.resolve(fail("unavailable", "SandboxUnavailable", "The script sandbox is not installed on this server, so scripts cannot run."));
  if (running >= LIMITS.MAX_CONCURRENT) {
    return Promise.resolve(fail("busy", "SandboxBusy", "Too many scripts are running right now. Try again in a few seconds."));
  }

  const timeoutMs = clampTimeout(o.timeoutMs);
  const maxToolCalls = o.maxToolCalls || LIMITS.MAX_TOOL_CALLS;
  const toolNames = Array.isArray(o.toolNames) ? o.toolNames.slice() : [];
  const allowed = new Set(toolNames);

  running += 1;
  return new Promise((resolve) => {
    let settled = false;
    let child = null;
    let timer = null;
    const settle = (outcome) => {
      if (settled) return;
      settled = true;
      running -= 1;
      if (timer) clearTimeout(timer);
      if (child) { try { child.kill("SIGKILL"); } catch (_) { /* gone */ } }
      resolve(outcome);
    };

    try {
      child = fork(WORKER, [ivm], {
        // Nothing of the server's environment (secrets, credentials, project
        // ids) exists in the child.
        env: {},
        execArgv: ["--no-node-snapshot"],
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        serialization: "json",
      });
    } catch (_) {
      settle(fail("sandbox", "SandboxError", "The sandbox could not be started."));
      return;
    }

    timer = setTimeout(() => {
      settle(fail("timeout", "Timeout", `The script ran for more than ${timeoutMs} ms and was stopped.`));
    }, timeoutMs);

    child.on("error", () => settle(fail("sandbox", "SandboxError", "The sandbox could not be started.")));
    child.on("exit", () => {
      // A clean finish settles before the kill; getting here unsettled means
      // the child died on its own — almost always the isolate running out of
      // memory hard enough to take the process with it.
      settle(fail("memory", "SandboxCrashed", `The sandbox stopped unexpectedly — most often a script using more than ${o.memoryMb || LIMITS.MEMORY_MB} MB of memory.`));
    });

    const answer = (id, payload) => {
      if (settled) return;
      try { child.send({ type: "result", id, json: JSON.stringify(payload) }); } catch (_) { /* child gone */ }
    };

    child.on("message", (msg) => {
      if (!msg || typeof msg !== "object" || settled) return;
      if (msg.type === "ready") {
        child.send({
          type: "run",
          job: {
            code: source, params: o.params === undefined ? {} : o.params, toolNames,
            timeoutMs, memoryMb: o.memoryMb || LIMITS.MEMORY_MB,
            maxResultBytes: o.maxResultBytes || LIMITS.MAX_RESULT_BYTES,
            filename: o.filename || "script.js",
          },
        });
        return;
      }
      if (msg.type === "call") {
        const name = String(msg.name || "");
        if (!allowed.has(name)) { answer(msg.id, { error: `${name} is not available to scripts.` }); return; }
        if (toolCalls.length >= maxToolCalls) {
          answer(msg.id, { error: `Tool-call limit reached: a script may make at most ${maxToolCalls} tool calls.` });
          return;
        }
        let args;
        try { args = JSON.parse(msg.argsJson); } catch (_) { args = null; }
        if (!args || typeof args !== "object" || Array.isArray(args)) { answer(msg.id, { error: `${name} takes one object argument.` }); return; }
        const entry = { name, durationMs: 0 };
        toolCalls.push(entry);
        const t0 = Date.now();
        Promise.resolve()
          .then(() => o.callTool(name, args))
          .then(
            (value) => { entry.durationMs = Date.now() - t0; answer(msg.id, { value: value === undefined ? null : value }); },
            (err) => { entry.durationMs = Date.now() - t0; entry.error = true; answer(msg.id, { error: String((err && err.message) || "tool failed") }); },
          );
        return;
      }
      if (msg.type === "done") {
        const out = msg.outcome || {};
        if (out.ok) {
          let result;
          try { result = JSON.parse(out.json); } catch (_) { settle(fail("sandbox", "SandboxError", "The sandbox returned an unreadable result.")); return; }
          settle(finish({ ok: true, result }));
        } else {
          const extra = {};
          if (typeof out.line === "number") extra.line = out.line;
          if (typeof out.column === "number") extra.column = out.column;
          if (typeof out.tool === "string") extra.tool = out.tool;
          settle(fail(out.kind || "script", out.name || "Error", String(out.message || "The script failed."), extra));
        }
      }
    });
  });
}

module.exports = { runInSandbox, setIsolatedVmPath, resolveIsolatedVm, clampTimeout, LIMITS };
