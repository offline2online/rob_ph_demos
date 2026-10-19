// Browser harness for the console's click-through tests.
//
// Loads the REAL, unchanged backlog-tracker/public/ files (index.html,
// auth-gate.js, app.js) in Chromium and replaces only what lives off the
// box: the four Firebase SDK modules (served from firebase-stub.mjs), Quill
// (from the quill dev dependency), Google Fonts (empty CSS) and the console's
// own /mcp/* endpoints (answered here). firestore.googleapis.com is refused,
// so app.js's REST prime fails and the listeners carry the data, as they do
// when the prime loses the race in production.
//
// A run FAILS, with the URL or message in it, on: a page error, a console
// error (other than the refused REST prime), or a request to any host that is
// neither local nor routed here. No test reaches the network.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
export const publicDir = path.join(here, "..", "..", "public");
export const outDir = path.join(here, "out");
export const stubPath = path.join(here, "firebase-stub.mjs");

const SDK_BASE = "https://www.gstatic.com/firebasejs/10.13.2/";
export const SDK_MODULES = ["firebase-app.js", "firebase-auth.js", "firebase-firestore.js", "firebase-storage.js"];
const quillDist = path.dirname(fileURLToPath(import.meta.resolve("quill")));
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".ico": "image/x-icon", ".woff2": "font/woff2" };

function staticServer() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = path.normalize(path.join(publicDir, rel === "/" ? "index.html" : rel));
    if (!file.startsWith(publicDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

export async function launchChromium() {
  const launch = { headless: true };
  if (process.env.PLAYWRIGHT_CHROMIUM) launch.executablePath = process.env.PLAYWRIGHT_CHROMIUM;
  else if (fs.existsSync("/opt/pw-browsers/chromium")) launch.executablePath = "/opt/pw-browsers/chromium";
  return chromium.launch(launch).catch(() => chromium.launch({ headless: true, channel: "chrome" }));
}

export async function startHarness() {
  const server = await staticServer();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchChromium();
  const stubSource = fs.readFileSync(stubPath, "utf8");

  // seed: { docs: { collection: { id: fields } }, user: { email, role } }
  async function open({ seed = {}, width = 1280, height = 900, hash = "" } = {}) {
    const context = await browser.newContext({ viewport: { width, height } });
    const problems = [];
    const refused = [];
    const addProblem = (p) => problems.push(p);
    await context.addInitScript((s) => { window.__FB_SEED = s; }, seed);
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === origin) {
        if (url.pathname.startsWith("/mcp/")) {
          // /mcp/claims/sync is the background membership check.
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ role: (seed.user && seed.user.role) || "editor", email: (seed.user && seed.user.email) || "editor@personalisationhub.com", claimUpdated: false }) });
        }
        return route.fallback();
      }
      if (url.href.startsWith(SDK_BASE) && SDK_MODULES.includes(url.pathname.split("/").pop())) {
        return route.fulfill({ status: 200, contentType: "text/javascript", body: stubSource });
      }
      if (url.hostname === "cdnjs.cloudflare.com" && url.pathname.endsWith("/quill/1.3.7/quill.min.js")) return route.fulfill({ status: 200, contentType: "text/javascript", path: path.join(quillDist, "quill.min.js") });
      if (url.hostname === "cdnjs.cloudflare.com" && url.pathname.endsWith("/quill/1.3.7/quill.snow.min.css")) return route.fulfill({ status: 200, contentType: "text/css", path: path.join(quillDist, "quill.snow.css") });
      if (url.hostname === "fonts.googleapis.com") return route.fulfill({ status: 200, contentType: "text/css", body: "" });
      if (url.hostname === "firestore.googleapis.com") { refused.push(url.href); return route.abort("failed"); }
      addProblem(`request to unrouted host: ${url.href}`);
      return route.abort("failed");
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => addProblem(`page error: ${err && err.message}`));
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const where = (msg.location() && msg.location().url) || "";
      if (where.includes("firestore.googleapis.com")) return; // the refused REST prime
      addProblem(`console error: ${msg.text()}${where ? ` (${where})` : ""}`);
    });
    page.on("dialog", (d) => { addProblem(`native ${d.type()} dialog: ${d.message()}`); d.dismiss().catch(() => {}); });
    await page.goto(`${origin}/${hash}`, { waitUntil: "domcontentloaded" });
    return { page, context, problems, refused, origin, close: () => context.close() };
  }

  return {
    open, origin,
    async close() { await browser.close(); await new Promise((r) => server.close(r)); },
  };
}

// Poll a condition; never a fixed sleep. Resolves with the truthy value.
export async function until(fn, what, ms = 8000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 40));
  }
}
