// The Code Mode sandbox on its own (functions/code-mode/sandbox.js +
// sandbox-worker.js): a real isolated-vm isolate in a real child process,
// with stub tools. No Firebase, no network.
//   node code-mode-sandbox.test.js
// Needs isolated-vm, which test/package.json installs.
"use strict";
const assert = require("assert");
const sandbox = require("../functions/code-mode/sandbox.js");

sandbox.setIsolatedVmPath(require.resolve("isolated-vm"));

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (err) { failures.push([name, err]); console.log(`FAIL  ${name}\n      ${err && err.message}`); }
}

const calls = [];
const TOOLS = {
  async echo(args) { calls.push(["echo", args]); return { echoed: args }; },
  async big() { return { blob: "x".repeat(200000) }; },
  async boom() { const e = new Error("No ticket with id nope."); e.stack = "Error: secret\n    at /srv/functions/mcp-server.js:1:1"; throw e; },
  async slow() { await new Promise((r) => setTimeout(r, 5000)); return {}; },
};
function run(code, extra) {
  return sandbox.runInSandbox(code, Object.assign({
    toolNames: Object.keys(TOOLS),
    callTool: (name, args) => TOOLS[name](args),
  }, extra || {}));
}

(async () => {
  await test("a script returns its value, and only its value", async () => {
    const r = await run("const a = await tools.echo({ n: 2 }); return { doubled: a.echoed.n * 2 };");
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.result, { doubled: 4 });
    assert.deepStrictEqual(r.toolCalls.map((c) => c.name), ["echo"]);
    assert.ok(typeof r.toolCalls[0].durationMs === "number" && typeof r.durationMs === "number");
  });

  await test("params reach the script; undefined becomes null", async () => {
    const r = await run("return params.who;", { params: { who: "sam" } });
    assert.strictEqual(r.result, "sam");
    assert.strictEqual((await run("const x = 1;")).result, null);
  });

  await test("raw tool output never reaches the caller unless the script returns it", async () => {
    const r = await run("const b = await tools.big({}); return { length: b.blob.length };");
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.result, { length: 200000 });
    assert.ok(!JSON.stringify(r).includes("xxxxxxxxxx"));
  });

  await test("blocked globals: require, process, fetch, timers, module, Buffer", async () => {
    const r = await run(`return {
      require: typeof require, process: typeof process, fetch: typeof fetch, module: typeof module,
      Buffer: typeof Buffer, setTimeout: typeof setTimeout, XMLHttpRequest: typeof XMLHttpRequest,
      globalProcess: typeof globalThis.process, importFn: typeof globalThis.import,
      hostCall: typeof __call, hostCallGlobal: typeof globalThis.__call,
    };`);
    assert.strictEqual(r.ok, true, JSON.stringify(r.error));
    for (const [k, v] of Object.entries(r.result)) assert.strictEqual(v, "undefined", `${k} is ${v}`);
  });

  await test("no way to Node through constructors or dynamic import", async () => {
    const a = await run("return (function(){}).constructor('return typeof process')();");
    assert.strictEqual(a.result, "undefined");
    const b = await run("const fs = await import('fs'); return Object.keys(fs).length;");
    assert.strictEqual(b.ok, false);
    const c = await run("return Object.keys(tools).sort();");
    assert.deepStrictEqual(c.result, Object.keys(TOOLS).sort());
    const d = await run("try { tools.extra = 1; } catch (e) {} return 'extra' in tools;");
    assert.strictEqual(d.result, false);
  });

  await test("environment: the child has none of the server's variables", async () => {
    process.env.CODE_MODE_TEST_SECRET = "hunter2";
    const r = await run("return typeof process === 'undefined' ? 'no process' : JSON.stringify(process.env);");
    assert.strictEqual(r.result, "no process");
    delete process.env.CODE_MODE_TEST_SECRET;
  });

  await test("timeout: a synchronous infinite loop is stopped", async () => {
    const r = await run("while (true) {}", { timeoutMs: 400 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error.kind, "timeout");
    assert.ok(r.durationMs < 3000, `took ${r.durationMs} ms`);
  });

  await test("timeout: a loop after an await is stopped too (wall clock)", async () => {
    const r = await run("await tools.echo({}); while (true) {}", { timeoutMs: 500 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error.kind, "timeout");
    assert.ok(r.durationMs < 3000, `took ${r.durationMs} ms`);
  });

  await test("timeout: waiting on a slow tool counts against the clock", async () => {
    const r = await run("await tools.slow({}); return 1;", { timeoutMs: 400 });
    assert.strictEqual(r.error.kind, "timeout");
    assert.ok(r.durationMs < 3000);
  });

  await test("timeoutMs is clamped to 30 s and defaults to 10 s", async () => {
    assert.strictEqual(sandbox.clampTimeout(undefined), 10000);
    assert.strictEqual(sandbox.clampTimeout(999999), 30000);
    assert.strictEqual(sandbox.clampTimeout("abc"), 10000);
    assert.strictEqual(sandbox.LIMITS.MEMORY_MB, 128);
  });

  await test("memory: a script that allocates without bound is stopped", async () => {
    const r = await run("const a = []; while (true) a.push(new Array(100000).fill('x'.repeat(10)));", { timeoutMs: 20000, memoryMb: 16 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error.kind, "memory", JSON.stringify(r.error));
  });

  await test("tool-call cap: the call over the limit fails with a clear error", async () => {
    const r = await run("for (let i = 0; i < 10; i++) await tools.echo({ i }); return 'done';", { maxToolCalls: 5 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error.kind, "tool");
    assert.match(r.error.message, /at most 5 tool calls/);
    assert.strictEqual(r.toolCalls.length, 5);
    const ok = await run("for (let i = 0; i < 5; i++) await tools.echo({ i }); return 'done';", { maxToolCalls: 5 });
    assert.strictEqual(ok.result, "done");
    assert.strictEqual(sandbox.LIMITS.MAX_TOOL_CALLS, 50);
  });

  await test("result-size cap: an oversized return is an error, not a truncation", async () => {
    const r = await run("return 'y'.repeat(30000);");
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error.kind, "result-size");
    assert.match(r.error.message, /limit is 20480/);
    assert.ok(!("result" in r));
    assert.strictEqual((await run("return 'y'.repeat(20000);")).ok, true);
  });

  await test("source-size cap: more than 20 KB of code is rejected before it runs", async () => {
    const r = await run("return 1; //" + "z".repeat(21000));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error.kind, "source-size");
    assert.strictEqual(r.toolCalls.length, 0);
  });

  await test("a runtime error names the failing line", async () => {
    const r = await run("const a = 1;\nconst b = 2;\nnull.x;\nreturn a + b;");
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error.kind, "script");
    assert.strictEqual(r.error.name, "TypeError");
    assert.strictEqual(r.error.line, 3);
  });

  await test("a syntax error names the failing line", async () => {
    const r = await run("const a = 1;\nconst = 2;\nreturn a;");
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error.kind, "syntax");
    assert.strictEqual(r.error.line, 2);
  });

  await test("a tool error is a catchable exception carrying the tool's own message only", async () => {
    const caught = await run("try { await tools.boom({}); } catch (e) { return { name: e.name, message: e.message, tool: e.tool, stack: String(e.stack) }; }");
    assert.strictEqual(caught.result.name, "ToolError");
    assert.strictEqual(caught.result.message, "No ticket with id nope.");
    assert.strictEqual(caught.result.tool, "boom");
    const uncaught = await run("const x = 1;\nawait tools.boom({});");
    assert.strictEqual(uncaught.error.kind, "tool");
    assert.strictEqual(uncaught.error.tool, "boom");
    for (const r of [caught, uncaught]) {
      const text = JSON.stringify(r);
      assert.ok(!text.includes("mcp-server.js") && !text.includes("/srv/") && !text.includes("secret"), text);
      assert.ok(!text.includes("sandbox-worker") && !text.includes("node_modules"), text);
    }
  });

  await test("an unknown tool and a non-object argument are refused", async () => {
    const a = await run("return typeof tools.create_backlog_item;");
    assert.strictEqual(a.result, "undefined");
    const b = await run("await tools.echo('text');");
    assert.match(b.error.message, /one object argument/);
  });

  await test("a non-serialisable return value is a clear error", async () => {
    const r = await run("const a = {}; a.self = a; return a;");
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error.kind, "result");
  });

  await test("without isolated-vm it refuses to run — never a fallback to eval or vm", async () => {
    sandbox.setIsolatedVmPath(null);
    const realResolve = require("module")._resolveFilename;
    require("module")._resolveFilename = function (request, ...rest) {
      if (request === "isolated-vm") throw new Error("Cannot find module 'isolated-vm'");
      return realResolve.call(this, request, ...rest);
    };
    try {
      const r = await run("return 1;");
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.error.kind, "unavailable");
    } finally {
      require("module")._resolveFilename = realResolve;
      sandbox.setIsolatedVmPath(require.resolve("isolated-vm"));
    }
    const fs = require("fs"), path = require("path");
    for (const f of ["sandbox.js", "sandbox-worker.js"]) {
      const src = fs.readFileSync(path.join(__dirname, "../functions/code-mode", f), "utf8").replace(/\/\/.*$/gm, "");
      assert.ok(!/require\(["']vm["']\)|\beval\(|new Function\(/.test(src), `${f} uses eval/vm`);
    }
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})();
