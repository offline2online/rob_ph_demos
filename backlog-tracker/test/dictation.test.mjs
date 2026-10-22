// Dictation, as a test: import the REAL public/js/app.js under a stub DOM
// (the same jsdom + inert-Firebase harness as app-boots.test.mjs) with a
// scripted SpeechRecognition standing in for the browser's, then click the
// real mic buttons and play the engine's events at them.
//
// Why (20 Oct 2026): "the microphone cuts off and stops listening after a
// certain amount of time". Every way an engine ends or stalls a session on
// its own — a session-length limit, a silent stall with no end event (iOS
// Safari), a network blip, a refusal on an ungestured restart — must be a
// stutter the user never notices, and only the user's own stop, a submit or
// closing the form may end the run and release the microphone.
//
// What it cannot do: run a real recogniser. Chrome's and Safari's real
// behaviour is modelled from their documented/observed events; the deployed
// console is where a real voice gets checked.
//
// Run with:  node test/dictation.test.mjs
//            APP_JS=/path/to/some/app.js node test/dictation.test.mjs   (e.g. main's copy)
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, "..", "public");
const appJsPath = process.env.APP_JS ? path.resolve(process.env.APP_JS) : path.join(publicDir, "js", "app.js");

const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", (err) => errors.push(err));
const dom = new JSDOM(fs.readFileSync(path.join(publicDir, "index.html"), "utf8"), {
  url: "https://backlog-tracker.test/",
  pretendToBeVisual: true,
  virtualConsole,
});
const { window } = dom;
window.addEventListener("error", (e) => errors.push(e.error || new Error(String(e.message))));
process.on("unhandledRejection", (err) => errors.push(err instanceof Error ? err : new Error(String(err))));
window.document.querySelector(".app").hidden = false;
window.document.getElementById("auth-gate").hidden = true;

const anything = new Proxy(function anything() {}, {
  get(_target, key) {
    if (key === Symbol.toPrimitive) return () => "";
    if (key === "then") return undefined;
    if (key === Symbol.iterator) return function* () {};
    if (key === "toJSON") return () => null;
    if (key === "length" || key === "size") return 0;
    return anything;
  },
  apply() { return anything; },
  construct() { return anything; },
});
const define = (obj, key, value) => Object.defineProperty(obj, key, { value, configurable: true, writable: true });
for (const key of [
  "window", "document", "navigator", "location", "history", "localStorage", "sessionStorage",
  "HTMLElement", "Element", "Node", "Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "FormData", "Blob", "File",
  "DOMParser", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "Image",
]) {
  if (window[key] !== undefined) define(globalThis, key, window[key]);
}
const noop = () => {};
define(window, "matchMedia", () => ({ matches: false, media: "", addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop }));
define(globalThis, "matchMedia", window.matchMedia);
define(window, "scrollTo", noop);
define(globalThis, "scrollTo", noop);
define(window.HTMLElement.prototype, "scrollIntoView", noop);
define(window, "visualViewport", { width: 1024, height: 768, offsetTop: 0, addEventListener: noop, removeEventListener: noop });
define(window.document, "fonts", { ready: Promise.resolve(), addEventListener: noop, load: async () => [] });
for (const name of ["IntersectionObserver", "ResizeObserver"]) {
  const Observer = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
  define(window, name, Observer);
  define(globalThis, name, Observer);
}
const Quill = class Quill { constructor() { return anything; } static register() {} static import() { return anything; } };
define(window, "Quill", Quill);
define(globalThis, "Quill", Quill);
const DOMPurify = { sanitize: (s) => String(s ?? ""), addHook: noop };
define(window, "DOMPurify", DOMPurify);
define(globalThis, "DOMPurify", DOMPurify);
const failedFetch = async () => ({ ok: false, status: 0, headers: new Map(), json: async () => ({}), text: async () => "" });
define(window, "fetch", failedFetch);
define(globalThis, "fetch", failedFetch);
for (const name of ["alert", "confirm", "prompt"]) define(window, name, noop);

// ── The scripted engine. start()/stop()/abort() follow the Web Speech
//    API's state rules (start() on a running instance throws
//    InvalidStateError; stop() finalizes then ends; abort() ends without a
//    final). Helpers play results, ends and errors at the live instance.
class FakeRecognition {
  constructor() {
    this.state = "idle";
    this.starts = 0;
    this.aborted = false;
    this.pendingInterim = "";
    FakeRecognition.instances.push(this);
  }
  start() {
    if (this.state !== "idle") {
      const err = new Error("recognition has already started");
      err.name = "InvalidStateError";
      throw err;
    }
    this.state = "running";
    this.starts++;
    this.results = [];
    if (FakeRecognition.denyNext) {
      // A real denial: the error arrives before any audio does.
      FakeRecognition.denyNext = false;
      setTimeout(() => this.fail("not-allowed"), 0);
      return;
    }
    setTimeout(() => { if (this.state === "running") { this.onstart && this.onstart(); this.onaudiostart && this.onaudiostart(); } }, 0);
  }
  stop() {
    if (this.state !== "running") return;
    this.state = "stopping";
    setTimeout(() => {
      if (this.pendingInterim) this.say(this.pendingInterim, true);
      this.state = "idle";
      this.onend && this.onend();
    }, 5);
  }
  abort() {
    if (this.state === "idle") return;
    this.state = "idle";
    this.aborted = true;
    setTimeout(() => { this.onerror && this.onerror({ error: "aborted" }); this.onend && this.onend(); }, 0);
  }
  // One result at the end of this session's list, final or interim — the
  // shape Chrome delivers (resultIndex = the first result that changed).
  say(transcript, isFinal) {
    const index = this.results.length && !this.results[this.results.length - 1].isFinal ? this.results.length - 1 : this.results.length;
    this.results[index] = Object.assign([{ transcript }], { isFinal });
    this.pendingInterim = isFinal ? "" : transcript;
    this.onresult && this.onresult({ resultIndex: index, results: this.results });
  }
  // The browser ending the session on its own (limit, silence).
  endByItself() { this.state = "idle"; this.onend && this.onend(); }
  fail(code) { this.onerror && this.onerror({ error: code }); this.state = "idle"; this.onend && this.onend(); }
}
FakeRecognition.instances = [];
const live = () => FakeRecognition.instances.filter((r) => r.state === "running");
define(window, "SpeechRecognition", FakeRecognition);

let micOpen = 0;
define(window.navigator, "mediaDevices", {
  getUserMedia: async () => {
    micOpen++;
    return { getTracks: () => [{ stop: () => { micOpen--; } }] };
  },
});
// Millisecond timings, so the stall/idle watchdogs run inside the test.
define(window, "__btDictationTuning", { stallMs: 120, idleRecycleMs: 400, typingResumeMs: 60, stopGraceMs: 150, probeReleaseMs: 5, tickMs: 10, agentMs: 5 });

const appLog = [];
for (const level of ["warn", "error", "info", "log"]) {
  const original = console[level].bind(console);
  console[level] = (...args) => appLog.push(`[${level}] ${args.map((a) => (a && a.stack) || String(a)).join(" ")}`);
  console[level].restore = () => { console[level] = original; };
}
const restoreConsole = () => { for (const level of ["warn", "error", "info", "log"]) console[level].restore && console[level].restore(); };

const src = fs.readFileSync(appJsPath, "utf8");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dictation-"));
define(globalThis, "__appBootsAnything", anything);
fs.writeFileSync(path.join(tmp, "anything.mjs"), "export const anything = globalThis.__appBootsAnything;\n");
let rewritten = src;
const sdkImports = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"(https:\/\/www\.gstatic\.com\/firebasejs\/[^"]+)"/g)];
sdkImports.forEach(([, names, url], i) => {
  const exported = names.split(",").map((s) => s.trim()).filter(Boolean).map((s) => s.split(/\s+as\s+/)[0].trim());
  const stubPath = path.join(tmp, `sdk-${i}.mjs`);
  fs.writeFileSync(stubPath, `import { anything } from "./anything.mjs";\n` + exported.map((n) => `export const ${n} = anything;\n`).join(""));
  rewritten = rewritten.split(`"${url}"`).join(JSON.stringify(pathToFileURL(stubPath).href));
});
rewritten = rewritten.replace(/from\s*"\.\/([\w-]+\.js)"/g, (_m, file) => `from ${JSON.stringify(pathToFileURL(path.join(publicDir, "js", file)).href)}`);
const modulePath = path.join(tmp, "app.mjs");
fs.writeFileSync(modulePath, rewritten);
try {
  await import(pathToFileURL(modulePath).href);
} catch (err) {
  restoreConsole();
  throw err;
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const $ = (id) => window.document.getElementById(id);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// The New Item Record button listens into the read-only live transcript; the agent fills the fields on stop.
const field = $("ni-transcript");
const mic = $("ni-mic-btn");
const listening = (btn = mic) => btn.classList.contains("listening");
const current = () => { const l = live(); assert.equal(l.length, 1, `exactly one live recognition session (found ${l.length})`); return l[0]; };
async function startMic(btn = mic) {
  btn.click();
  await sleep(30);
  assert.ok(listening(btn), `${btn.id} is listening after a click`);
}
let passed = 0;
async function check(name, fn) {
  await fn();
  passed++;
  process.stdout.write(`  ok  ${name}\n`);
}

await check("the probe stream is released before the recogniser takes the mic", async () => {
  field.value = "";
  await startMic();
  assert.equal(micOpen, 0, "getUserMedia's probe tracks were stopped");
  current();
});

await check("finals are committed and capitalised", async () => {
  current().say("hello world", true);
  assert.equal(field.value, "Hello world");
});

await check("a session the browser ends by itself restarts at once on the same instance", async () => {
  const r = current();
  r.endByItself();
  assert.ok(listening(), "still listening");
  assert.equal(current(), r, "same instance reused (what iOS Safari needs)");
  assert.equal(r.starts, 2);
  r.say("second part full stop", true);
  assert.equal(field.value, "Hello world second part.");
});

await check("words shown but never finalized survive the session ending", async () => {
  const r = current();
  r.say("this was never", false);
  assert.equal(field.value, "Hello world second part. this was never", "interim text is shown raw");
  r.endByItself();
  assert.equal(field.value, "Hello world second part. This was never", "and committed, cased, when the session ends");
  assert.ok(listening());
  current().say("finalized", true);
  assert.equal(field.value, "Hello world second part. This was never finalized");
});

await check("a session that stalls mid-phrase (no end, no error) is committed and replaced", async () => {
  const r = current();
  r.say("stuck words", false);
  await sleep(250);
  assert.ok(listening(), "still listening");
  assert.ok(r.aborted, "stalled instance released");
  const next = current();
  assert.notEqual(next, r, "a fresh instance took over");
  assert.ok(field.value.endsWith("finalized stuck words"), field.value);
  next.say("after the stall", true);
  assert.ok(field.value.endsWith("stuck words after the stall"), field.value);
});

await check("a session silent of every event is quietly replaced, not left hung", async () => {
  const r = current();
  await sleep(550);
  assert.ok(listening());
  assert.ok(r.aborted);
  current();
});

await check("network blips and a refusal on a later restart are ridden out", async () => {
  current().fail("network");
  await sleep(450);
  assert.ok(listening(), "listening after a network error");
  current().fail("not-allowed");
  await sleep(600);
  assert.ok(listening(), "listening after a not-allowed on a run whose mic had worked");
  current().say("still here", true);
  assert.ok(field.value.endsWith("still here"), field.value);
  assert.equal($("ni-mic-error").textContent, "");
});

await check("start() throwing on a restart retries with a fresh instance", async () => {
  const r = current();
  const realStart = FakeRecognition.prototype.start;
  let throwsLeft = 1;
  FakeRecognition.prototype.start = function () {
    if (throwsLeft-- > 0) { const e = new Error("busy"); e.name = "InvalidStateError"; throw e; }
    return realStart.call(this);
  };
  r.endByItself();
  await sleep(500);
  FakeRecognition.prototype.start = realStart;
  assert.ok(listening());
  current();
});

await check("typing mid-dictation is kept and dictation resumes after it", async () => {
  const before = current();
  before.say("half said", false);
  field.value = field.value.replace("half said", "typed fix");
  field.dispatchEvent(new window.Event("input"));
  assert.ok(before.aborted, "the in-flight session is dropped so its words aren't appended twice");
  before.onresult && before.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: "half said" }], { isFinal: true })] });
  assert.ok(field.value.endsWith("typed fix"), field.value);
  await sleep(120);
  current().say("then more", true);
  assert.ok(field.value.endsWith("typed fix then more"), field.value);
});

await check("the user's stop click finalizes the words in flight, then releases the mic", async () => {
  const r = current();
  r.say("last words", false);
  mic.click();
  await sleep(40);
  assert.equal(listening(), false, "stopped");
  assert.equal(live().length, 0, "no recognition left running");
  assert.ok(field.value.endsWith("then more last words"), field.value);
  r.say("late", true);
  assert.ok(!field.value.includes("late"), "nothing writes after the run ended");
  assert.equal(mic.getAttribute("aria-pressed"), "false");
});

await check("adding the ticket stops dictation and releases the microphone", async () => {
  await startMic();
  const r = current();
  r.say("about to submit", false);
  $("ni-submit").click();
  await sleep(20);
  assert.equal(listening(), false);
  assert.ok(r.aborted, "aborted — the microphone is freed immediately");
  assert.equal(live().length, 0);
  r.onresult && r.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: "ghost" }], { isFinal: true })] });
  assert.ok(!field.value.includes("ghost"));
});

await check("closing the form stops dictation and nothing writes into the emptied field", async () => {
  await startMic();
  const r = current();
  r.say("abandoned", false);
  $("ni-cancel").click();
  await sleep(20);
  assert.equal(listening(), false);
  assert.equal(live().length, 0);
  assert.equal(field.value, "");
});

await check("closing during the permission prompt cancels the start", async () => {
  mic.click();
  $("ni-cancel").click();
  await sleep(40);
  assert.equal(listening(), false);
  assert.equal(live().length, 0);
});

await check("a comment submit stops dictation; only one mic is live at a time", async () => {
  const qcMic = $("qc-mic-btn");
  await startMic();
  await startMic(qcMic);
  assert.equal(listening(), false, "starting the comment mic halted the New Item one");
  const r = current();
  const qcInput = $("qc-comment-input") || window.document.querySelector("#qc-backdrop textarea");
  r.say("a comment", true);
  assert.ok(qcInput.value.endsWith("A comment"), qcInput.value);
  qcMic.click();
  await sleep(40);
  assert.equal(listening(qcMic), false);
  assert.equal(live().length, 0);
});

await check("a real permission denial on the first start stops with a clear message", async () => {
  FakeRecognition.denyNext = true;
  mic.click();
  await sleep(40);
  assert.equal(listening(), false);
  assert.match($("ni-mic-error").textContent, /blocked/);
});

// The same module instance app.js imported (the harness rewrites its
// imports to these file URLs), so a scenario can forget an engine seen earlier.
const { resetDictationEngineState } = await import(pathToFileURL(path.join(publicDir, "js", "dictation-results.js")).href);

await check("Android: one utterance per session, never continuous mode", async () => {
  define(window.navigator, "userAgent", "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36");
  try {
    field.value = "";
    await startMic();
    const r = current();
    assert.equal(r.continuous, false, "Android sessions are one utterance each");
    r.say("add a new", false);
    r.say("add a new epic to the board", true);
    r.endByItself(); // Android ends the session after every utterance
    assert.equal(current().continuous, false);
    current().say("assign it to Jack", true);
    assert.equal(field.value, "Add a new epic to the board assign it to Jack");
    mic.click();
    await sleep(40);
    assert.equal(listening(), false);
  } finally {
    delete window.navigator.userAgent;
  }
});

// 21 Oct 2026, from an Android phone: "add add add a new add a new Epic…".
// Android Chrome in continuous mode sends every guess as a final, each the
// whole utterance so far. Here the user agent doesn't say Android ("Desktop
// site" on, or a tablet), so the run starts in continuous mode.
await check("cumulative finals are written once, and the next session stops using continuous mode", async () => {
  try {
    field.value = "";
    await startMic();
    const r = current();
    assert.equal(r.continuous, true, "not detectably Android");
    for (const t of ["add", "add", "add a new", "add a new Epic", "add a new Epic", "add a new Epic to", "add a new Epic to", "add a new Epic to the", "add a new Epic to the board"]) r.say(t, true);
    assert.equal(field.value, "Add a new Epic to the board");
    r.endByItself();
    assert.equal(current().continuous, false, "the rest of the visit records one utterance per session");
    for (const t of ["Jack", "Jack Johnson", "Jack Johnson"]) current().say(t, true);
    assert.equal(field.value, "Add a new Epic to the board Jack Johnson");
    // A new session that opens by redelivering the last phrase, then carries it further.
    current().endByItself();
    current().say("Jack Johnson", true);
    current().say("Jack Johnson please", true);
    assert.equal(field.value, "Add a new Epic to the board Jack Johnson please");
    mic.click();
    await sleep(40);
    assert.equal(listening(), false);
  } finally {
    resetDictationEngineState();
  }
});

await sleep(50);
restoreConsole();
if (errors.length) {
  for (const line of appLog) console.error(`      app.js: ${line.split("\n")[0]}`);
  console.error(`FAIL  ${errors.length} error(s) surfaced:`);
  for (const err of errors) console.error(`      ${err && (err.stack || err.message || err)}`);
  process.exit(1);
}
console.log(`\ndictation: ok — ${passed} scenarios\n`);
process.exit(0);
