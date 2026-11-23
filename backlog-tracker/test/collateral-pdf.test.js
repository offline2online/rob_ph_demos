// functions/collateral-pdf.js — prints Aidan's branded collateral
// (JtkLrEG0aTnC5JfkdPA1): the request filter, and the 60-second limit, which
// stops Chromium before it rejects so a hung print never leaves a browser
// running in the function. The browser is a stub (renderPdf's `launch`): no
// Chromium, no network.
// Run: node test/collateral-pdf.test.js
"use strict";
const assert = require("assert");
const { renderPdf, allowedRequest, stopBrowser } = require("../functions/collateral-pdf");

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

check("collateral-pdf allowedRequest: the printed page reaches only data: URIs and the brand font", () => {
  assert.strictEqual(allowedRequest("data:image/svg+xml;base64,AAAA"), true);
  assert.strictEqual(allowedRequest("https://fonts.googleapis.com/css2?family=Kantumruy+Pro"), true);
  assert.strictEqual(allowedRequest("https://fonts.gstatic.com/s/x.woff2"), true);
  assert.strictEqual(allowedRequest("http://fonts.gstatic.com/s/x.woff2"), false);
  assert.strictEqual(allowedRequest("https://evil.example/x.png"), false);
  assert.strictEqual(allowedRequest("https://fonts.googleapis.com.evil.example/"), false);
  assert.strictEqual(allowedRequest("http://169.254.169.254/computeMetadata/v1/"), false);
  assert.strictEqual(allowedRequest("file:///etc/passwd"), false);
});

// A browser whose print never finishes (or finishes as told), recording how it was stopped.
function stubBrowser({ hang = true, pdf = null } = {}) {
  const proc = { killed: false, signals: [], kill(sig) { this.signals.push(sig); this.killed = true; } };
  const b = {
    proc, closed: 0, events: [],
    process: () => proc,
    close: async () => { b.closed += 1; b.events.push("close"); },
    newPage: async () => ({
      setJavaScriptEnabled: async () => {}, setRequestInterception: async () => {}, on: () => {},
      setContent: async () => {},
      evaluateHandle: async () => {},
      pdf: () => (hang ? new Promise(() => {}) : Promise.resolve(pdf)),
    }),
  };
  proc.kill = function (sig) { this.signals.push(sig); this.killed = true; b.events.push(`kill:${sig}`); };
  return b;
}
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Page >>\n" + " ".repeat(80), "latin1");

check("renderPdf: on the time limit Chromium is killed and closed BEFORE the promise rejects", async () => {
  const b = stubBrowser();
  let stoppedAtReject = null;
  await assert.rejects(renderPdf("<p>x</p>", { timeoutMs: 50, launch: async () => b }).catch((err) => { stoppedAtReject = { killed: b.proc.killed, closed: b.closed }; throw err; }), /Printing the PDF took longer than 0 seconds/);
  assert.deepStrictEqual(stoppedAtReject, { killed: true, closed: 1 }, "already stopped when the run hears of the timeout");
  assert.deepStrictEqual(b.events, ["kill:SIGKILL", "close"]);
});

check("renderPdf: a browser that only finishes launching after the time limit is stopped at once and never used", async () => {
  const b = stubBrowser();
  let release;
  const late = new Promise((r) => { release = r; });
  await assert.rejects(renderPdf("<p>x</p>", { timeoutMs: 30, launch: () => late }), /longer than/);
  release(b);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepStrictEqual([b.proc.killed, b.closed], [true, 1]);
});

check("renderPdf: after a timed-out print the next one starts with no browser left from the first; a print in time closes its browser once", async () => {
  const first = stubBrowser();
  await assert.rejects(renderPdf("<p>a</p>", { timeoutMs: 30, launch: async () => first }));
  const second = stubBrowser({ hang: false, pdf: PDF });
  let firstRunningAtLaunch = null;
  const out = await renderPdf("<p>b</p>", { timeoutMs: 2000, launch: async () => { firstRunningAtLaunch = !first.proc.killed; return second; } });
  assert.strictEqual(firstRunningAtLaunch, false, "the first Chromium was gone before the second launched");
  assert.ok(Buffer.isBuffer(out.pdf) && out.pages === 1);
  assert.deepStrictEqual([second.proc.killed, second.closed], [false, 1], "closed normally, not killed");
});

// Ebq2oqSH3Lp1UrHWnfgJ: a one-pager is re-printed through the fit steps, in the
// same page and the same browser, until it is one page.
check("renderPdf fit: a one-pager over one page is re-printed through the steps in the same browser until it fits; none fits, the last is returned unfitted", async () => {
  const pdfOf = (pages) => Buffer.from("%PDF-1.4\n" + "1 0 obj << /Type /Page >>\n".repeat(pages) + " ".repeat(80), "latin1");
  const browserFor = (pagesByScale) => {
    const log = { launches: 0, content: [], scales: [] };
    const page = { setJavaScriptEnabled: async () => {}, setRequestInterception: async () => {}, on: () => {}, evaluateHandle: async () => {},
      setContent: async (html) => { log.content.push(html); }, pdf: async (opts) => { const sc = opts.scale || 1; log.scales.push(sc); return pdfOf(pagesByScale(log.content[log.content.length - 1], sc)); } };
    return { log, launch: async () => { log.launches += 1; return { process: () => null, close: async () => {}, newPage: async () => page }; } };
  };
  const steps = [{ html: "tight", scale: 1, tight: true }, { html: "tight", scale: 0.94, tight: true }, { html: "tight", scale: 0.88, tight: true }];
  const fmt = { key: "one-pager", label: "One-pager" };
  const a = browserFor((html, sc) => (html === "tight" && sc <= 0.94 ? 1 : 2));
  const out = await renderPdf("normal", { format: fmt, timeoutMs: 2000, launch: a.launch, fit: { maxPages: 1, steps } });
  assert.deepStrictEqual([out.pages, out.fit, a.log.launches, a.log.content, a.log.scales], [1, { step: 2, scale: 0.94, tight: true, fitted: true }, 1, ["normal", "tight"], [1, 1, 0.94]], "one browser; the page is loaded again only when it changes");
  const b = browserFor(() => 2);
  const none = await renderPdf("normal", { format: fmt, timeoutMs: 2000, launch: b.launch, fit: { maxPages: 1, steps } });
  assert.deepStrictEqual([none.pages, none.fit.fitted, none.fit.step, b.log.scales], [2, false, 3, [1, 1, 0.94, 0.88]]);
  const c = browserFor(() => 1);
  const first = await renderPdf("normal", { format: fmt, timeoutMs: 2000, launch: c.launch, fit: { maxPages: 1, steps } });
  assert.deepStrictEqual([first.pages, first.fit, c.log.scales], [1, { step: 0, scale: 1, tight: false, fitted: true }, [1]], "fits as laid out: printed once");
  const d = browserFor(() => 4);
  const plain = await renderPdf("normal", { format: { key: "overview" }, timeoutMs: 2000, launch: d.launch });
  assert.deepStrictEqual([plain.pages, plain.fit, d.log.scales], [4, undefined, [1]], "no fit asked: printed once, as many pages as it needs");
});

check("stopBrowser: no browser, or one whose close hangs, never holds the run", async () => {
  await stopBrowser(null);
  const b = stubBrowser();
  b.close = () => new Promise(() => {});
  const t0 = Date.now();
  await stopBrowser(b);
  assert.ok(b.proc.killed && Date.now() - t0 < 6000);
});

(async () => {
  // The print's time limit is an unref'd timer (it must not keep a function
  // instance alive); here it is all that is pending, so hold the loop open.
  const keepAlive = setInterval(() => {}, 1000);
  let failed = 0;
  for (const [name, fn] of checks) {
    try { await fn(); console.log(`  ok  ${name}`); } catch (err) { failed += 1; console.error(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
  }
  console.log(failed ? `\n${failed} of ${checks.length} failed` : `\ncollateral-pdf: ${checks.length} checks passed`);
  clearInterval(keepAlive);
  process.exit(failed ? 1 : 0);
})();
