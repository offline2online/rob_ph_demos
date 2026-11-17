// Code Mode sandbox — the CHILD process (see sandbox.js for the parent).
//
// One process per script. It holds a single isolated-vm isolate: a bare V8
// context with no require, no process, no fetch, no timers and no Node APIs.
// The only way out of the isolate is `tools.<name>(args)`, which sends an IPC
// message to the parent and waits for the answer; the parent decides whether
// that tool may run and as whom. This file never touches Firestore, the
// network or the filesystem, and is forked with an empty environment.
//
// argv[2] is the absolute path of isolated-vm (resolved by the parent, so
// this process needs no module search path of its own).
"use strict";

const ivm = require(process.argv[2]);

const pending = new Map();
let nextCallId = 1;

function send(msg) {
  if (process.send) process.send(msg);
}

// In-isolate bootstrap. `__call` is the one host reference; everything else
// here is plain JavaScript living inside the isolate.
const BOOTSTRAP = `
"use strict";
const __hostCall = __call;
delete globalThis.__call;
const __names = JSON.parse(__toolNames);
const tools = Object.create(null);
for (const name of __names) {
  tools[name] = async function (args) {
    const raw = await __hostCall.apply(undefined, [name, JSON.stringify(args === undefined ? {} : args)], { result: { promise: true } });
    const out = JSON.parse(raw);
    if (out.error) { const e = new Error(out.error); e.name = "ToolError"; e.tool = name; throw e; }
    return out.value;
  };
}
Object.freeze(tools);
const __noop = function () {};
globalThis.console = Object.freeze({ log: __noop, info: __noop, warn: __noop, error: __noop, debug: __noop });
globalThis.__run = async function (fn, params) {
  try {
    const value = await fn(tools, params);
    let json;
    try { json = JSON.stringify(value === undefined ? null : value); }
    catch (e) { return JSON.stringify({ ok: false, kind: "result", message: "The script's return value is not JSON-serialisable: " + String(e && e.message) }); }
    if (json === undefined) json = "null";
    return JSON.stringify({ ok: true, json });
  } catch (e) {
    const isErr = e && typeof e === "object";
    return JSON.stringify({
      ok: false, kind: isErr && e.name === "ToolError" ? "tool" : "script",
      name: isErr && typeof e.name === "string" ? e.name : "Error",
      message: isErr && typeof e.message === "string" ? e.message : String(e),
      tool: isErr && typeof e.tool === "string" ? e.tool : undefined,
      stack: isErr && typeof e.stack === "string" ? e.stack : "",
    });
  }
};
`;

// "script.js:12:5" → { line: 12, column: 5 }, from an in-isolate stack or a
// compile error's message. Only ever the user's own file name: host frames
// don't exist inside the isolate, so nothing of the server can appear here.
function locate(text, filename) {
  const esc = filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(esc + ":(\\d+)(?::(\\d+))?").exec(String(text || ""));
  if (!m) return {};
  return { line: Number(m[1]), ...(m[2] ? { column: Number(m[2]) } : {}) };
}

async function run(job) {
  const filename = job.filename || "script.js";
  const isolate = new ivm.Isolate({ memoryLimit: job.memoryMb });
  try {
    const context = await isolate.createContext();
    const jail = context.global;
    await jail.set("__toolNames", JSON.stringify(job.toolNames));
    await jail.set("__call", new ivm.Reference((name, argsJson) => new Promise((resolve) => {
      const id = nextCallId++;
      pending.set(id, resolve);
      send({ type: "call", id, name: String(name), argsJson: String(argsJson) });
    })));
    await (await isolate.compileScript(BOOTSTRAP, { filename: "sandbox-bootstrap.js" })).run(context, { timeout: 1000 });
    await jail.set("__params", JSON.stringify(job.params === undefined ? {} : job.params));

    // The user's code is the body of an async function; lineOffset -1 makes
    // its first line "line 1" in every error.
    let script;
    try {
      script = await isolate.compileScript(
        "globalThis.__fn = (async function (tools, params) {\n" + job.code + "\n});",
        { filename, lineOffset: -1 });
    } catch (e) {
      const message = String((e && e.message) || e).replace(/\s*\[[^\]]*\]\s*$/, "");
      return { ok: false, kind: "syntax", name: "SyntaxError", message, ...locate((e && e.stack) || (e && e.message), filename) };
    }
    await script.run(context, { timeout: 1000 });
    const starter = await isolate.compileScript("__run(__fn, JSON.parse(__params))", { filename: "sandbox-start.js" });
    // `timeout` here bounds synchronous execution; a loop after an await is
    // caught by the parent's wall-clock kill.
    const raw = await starter.run(context, { timeout: job.timeoutMs, promise: true });
    const out = JSON.parse(raw);
    if (out.ok) {
      const bytes = Buffer.byteLength(out.json, "utf8");
      if (bytes > job.maxResultBytes) return { ok: false, kind: "result-size", name: "ResultTooLarge", message: `The script's return value is ${bytes} bytes; the limit is ${job.maxResultBytes}. Return a smaller summary.`, bytes };
      return { ok: true, json: out.json };
    }
    return { ok: false, kind: out.kind, name: out.name, message: out.message, tool: out.tool, ...locate(out.stack, filename) };
  } catch (e) {
    const message = String((e && e.message) || e);
    if (/memory limit|disposed/i.test(message)) return { ok: false, kind: "memory", name: "MemoryLimit", message: `The script used more than ${job.memoryMb} MB of memory.` };
    if (/timed out/i.test(message)) return { ok: false, kind: "timeout", name: "Timeout", message: `The script ran for more than ${job.timeoutMs} ms.` };
    return { ok: false, kind: "sandbox", name: "SandboxError", message: "The sandbox could not run the script." };
  } finally {
    try { if (!isolate.isDisposed) isolate.dispose(); } catch (_) { /* already gone */ }
  }
}

process.on("message", (msg) => {
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "result") {
    const resolve = pending.get(msg.id);
    if (resolve) { pending.delete(msg.id); resolve(String(msg.json)); }
    return;
  }
  if (msg.type === "run") {
    run(msg.job).then(
      (outcome) => { send({ type: "done", outcome }); },
      () => { send({ type: "done", outcome: { ok: false, kind: "sandbox", name: "SandboxError", message: "The sandbox could not run the script." } }); },
    );
  }
});
process.on("disconnect", () => process.exit(0));
send({ type: "ready" });
