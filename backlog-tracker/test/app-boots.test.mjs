// The console's own start-up, as a test: import the REAL public/js/app.js
// under a stub DOM (jsdom, loading the real public/index.html) with the
// Firebase SDK modules it imports from gstatic replaced by inert stubs, and
// fail if module evaluation stops early. Then open the hamburger drawer and
// click every item in it, asserting each page actually opens.
//
// Why (25 Sep 2026): the Concept Incubator page shipped with a
// createDictationController() call placed above SpeechRecognitionCtor's
// `const` declaration. That is a temporal-dead-zone ReferenceError at module
// evaluation, so every top-level statement after it — including the drawer's
// Releases / Skills / FAQ Management / Settings click handlers, ~2,300 lines
// further down — never ran. The board itself still rendered (its listeners
// are registered earlier), so nothing looked wrong until someone opened the
// menu: dead on desktop, tablet and phone alike, from the 08:04 deploy until
// the next one. Nothing in the pipeline executes app.js (the Routine has no
// browser, CI ran rules and MCP suites only), so a whole class of "the file
// parses but stops half-way" bugs had no guard. This is that guard.
//
// What it deliberately is not: a UI test. Firestore never delivers data here
// (onSnapshot is a stub that never calls back), so only module-evaluation
// errors and errors thrown synchronously by the drawer's own click handlers
// are caught. That is the class this exists for.
//
// Run with:  node test/app-boots.test.mjs
//            APP_JS=/path/to/some/app.js node test/app-boots.test.mjs   (e.g. main's copy)
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, "..", "public");
const appJsPath = process.env.APP_JS ? path.resolve(process.env.APP_JS) : path.join(publicDir, "js", "app.js");

// ── 1. A DOM: index.html as the browser parses it, un-gated the way
//       auth-gate.js leaves it after sign-in. Errors thrown inside event
//       handlers surface on the window (jsdom does not rethrow them to the
//       click() caller), so they are collected here and asserted at the end.
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

// One inert value that survives any use the module can make of an SDK
// object: callable, constructible, property-chainable, awaitable (not a
// thenable), iterable (empty), stringifiable ("") and JSON-safe.
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
// Browser APIs jsdom does not implement, stubbed just enough to be called.
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
// CDN globals index.html loads with <script defer>: the editor and the
// sanitiser. app.js constructs the editor at top level.
const Quill = class Quill { constructor() { return anything; } static register() {} static import() { return anything; } };
define(window, "Quill", Quill);
define(globalThis, "Quill", Quill);
const DOMPurify = { sanitize: (s) => String(s ?? ""), addHook: noop };
define(window, "DOMPurify", DOMPurify);
define(globalThis, "DOMPurify", DOMPurify);
// No network: the REST prime and anything else that fetches gets a failed
// response, which app.js already handles as "wait for the realtime listener".
const failedFetch = async () => ({ ok: false, status: 0, headers: new Map(), json: async () => ({}), text: async () => "" });
define(window, "fetch", failedFetch);
define(globalThis, "fetch", failedFetch);
for (const name of ["alert", "confirm", "prompt"]) define(window, name, noop);

// app.js logs its own warnings on the way up (the REST prime fails under the
// fetch stub above, by design). Keep them out of the test's output unless
// something fails, when they are context worth having.
const appLog = [];
for (const level of ["warn", "error", "info", "log"]) {
  const original = console[level].bind(console);
  console[level] = (...args) => appLog.push(`[${level}] ${args.map((a) => (a && a.stack) || String(a)).join(" ")}`);
  console[level].restore = () => { console[level] = original; };
}
const restoreConsole = () => { for (const level of ["warn", "error", "info", "log"]) console[level].restore && console[level].restore(); };

// ── 2. The module, with its SDK imports pointed at stubs. Every name app.js
//       imports from a gstatic URL is exported by the stub as `anything`;
//       the local modules (config, version, build-batches) are the real files.
const src = fs.readFileSync(appJsPath, "utf8");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "app-boots-"));
// The stubs share this process's `anything` through a global rather than
// each building their own, so the harness and the module see one value.
define(globalThis, "__appBootsAnything", anything);
fs.writeFileSync(path.join(tmp, "anything.mjs"), "export const anything = globalThis.__appBootsAnything;\n");
let rewritten = src;
const sdkImports = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"(https:\/\/www\.gstatic\.com\/firebasejs\/[^"]+)"/g)];
assert.ok(sdkImports.length >= 2, "app.js should import the Firebase SDK from gstatic — has its loading changed? Update this harness.");
sdkImports.forEach(([, names, url], i) => {
  const exported = names.split(",").map((s) => s.trim()).filter(Boolean).map((s) => s.split(/\s+as\s+/)[0].trim());
  const stubPath = path.join(tmp, `sdk-${i}.mjs`);
  fs.writeFileSync(stubPath, `import { anything } from "./anything.mjs";\n` + exported.map((n) => `export const ${n} = anything;\n`).join(""));
  rewritten = rewritten.split(`"${url}"`).join(JSON.stringify(pathToFileURL(stubPath).href));
});
rewritten = rewritten.replace(/from\s*"\.\/([\w-]+\.js)"/g, (_m, file) => `from ${JSON.stringify(pathToFileURL(path.join(publicDir, "js", file)).href)}`);
const modulePath = path.join(tmp, "app.mjs");
fs.writeFileSync(modulePath, rewritten);

// ── 3. Evaluate. A throw here is the bug this test exists for: module
//       evaluation stopped, and everything after the throwing line never ran.
try {
  await import(pathToFileURL(modulePath).href);
} catch (err) {
  restoreConsole();
  for (const line of appLog) console.error(`      app.js: ${line.split("\n")[0]}`);
  console.error(`FAIL  app.js stopped evaluating part-way: ${err && err.message}`);
  console.error(`      ${String(err && err.stack || "").split("\n").slice(1, 4).join("\n      ")}`);
  console.error("      Every top-level statement after that line never ran — handlers registered below it are dead.");
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(1);
}
restoreConsole();
console.log(`  ok  ${path.relative(process.cwd(), appJsPath)} evaluated to the end (${appLog.length} line(s) of its own console output captured)`);

// ── 4. The hamburger, and every section behind it.
const $ = (id) => {
  const el = window.document.getElementById(id);
  assert.ok(el, `#${id} is missing from index.html`);
  return el;
};
$("nav-open-btn").click();
assert.ok($("nav-drawer").classList.contains("open"), "the hamburger opens the drawer");
const sections = [
  ["concept-incubator-btn", "concept-incubator-page"],
  ["releases-btn", "releases-page"],
  ["skills-btn", "skills-page"],
  ["faq-articles-btn", "faq-articles-page"],
  ["faq-settings-btn", "faq-settings-page"],
];
for (const [btn, page] of sections) {
  if (!$("nav-drawer").classList.contains("open")) $("nav-open-btn").click();
  $(btn).click();
  assert.strictEqual($(page).hidden, false, `#${btn} opens #${page}`);
  assert.strictEqual($("nav-drawer").classList.contains("open"), false, `#${btn} closes the drawer`);
  assert.strictEqual($("projects-root").hidden, true, `#${btn} hides the board while #${page} is open`);
  console.log(`  ok  ${btn} → #${page}`);
}
$("nav-open-btn").click();
$("nav-ph-console-btn").click();
assert.strictEqual($("projects-root").hidden, false, "Agent console returns to the board");
for (const [, page] of sections) assert.strictEqual($(page).hidden, true, `#${page} is hidden again after returning to the board`);
console.log("  ok  Agent console returns to the board");

// Give async handlers a tick to reject, then judge.
await new Promise((resolve) => setTimeout(resolve, 100));
fs.rmSync(tmp, { recursive: true, force: true });
if (errors.length) {
  for (const line of appLog) console.error(`      app.js: ${line.split("\n")[0]}`);
  console.error(`FAIL  ${errors.length} error(s) surfaced while start-up and the drawer ran:`);
  for (const err of errors) console.error(`      ${err && (err.stack || err.message || err)}`);
  process.exit(1);
}
console.log(`\napp-boots: ok — module evaluated to the end, drawer opens ${sections.length} sections\n`);
// app.js starts intervals (health strip, stale-routine checks); don't wait on them.
process.exit(0);
