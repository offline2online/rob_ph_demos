"use strict";
// Prints Aidan's branded collateral to PDF on the server (ticket
// JtkLrEG0aTnC5JfkdPA1): the page built by collateral-layout.js → collateralHtml,
// in headless Chromium (puppeteer-core + @sparticuz/chromium, the same pair
// kanban-capture.js uses; both are already dependencies of these functions, so
// nothing binary is added to the repository).
//
// Safe by construction: JavaScript is off, and the only requests allowed out
// are the brand font (fonts.googleapis.com / fonts.gstatic.com); the logo is a
// data: URI. Everything has to finish inside `timeoutMs` (aidan.js gives it
// COLLATERAL_RENDER_TIMEOUT_MS), so a whole write run still fits in the
// supportMail function's 540 seconds; when it can't, Chromium is killed and
// the run goes to a person.
//
// Tests: test/collateral-render.test.mjs prints the same page in Chromium with
// the same options; test/collateral-pdf.test.js covers `allowedRequest` and
// the timeout (the browser stopped before the promise rejects).

const cc = require("./collateral-core");
const cl = require("./collateral-layout");

const FONT_WAIT_MS = 5000;
// Requests the printed page may make: its own data: URIs and the brand font.
function allowedRequest(url) {
  const u = String(url || "");
  if (u.startsWith("data:") || u === "about:blank") return true;
  try {
    const { protocol, hostname } = new URL(u);
    return protocol === "https:" && (hostname === "fonts.googleapis.com" || hostname === "fonts.gstatic.com");
  } catch { return false; }
}

const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} took longer than ${Math.round(ms / 1000)} seconds`)), ms).unref())]);
const CLOSE_WAIT_MS = 5000;

// Headless Chromium, the same pair kanban-capture.js uses.
async function launchBrowser() {
  let puppeteer, chromium;
  try { puppeteer = require("puppeteer-core"); chromium = require("@sparticuz/chromium"); }
  catch (err) { const e = new Error("The PDF printer isn't installed on the server (puppeteer-core / @sparticuz/chromium)."); e.code = "no-browser"; throw e; }
  return puppeteer.launch({
    args: chromium.args, headless: true,
    executablePath: process.env.COLLATERAL_CHROMIUM || process.env.KANBAN_CAPTURE_CHROMIUM || await chromium.executablePath(),
  });
}
// Stop a browser for good: its process is killed at once (a hung print may
// never answer a polite close), then closed, waiting at most CLOSE_WAIT_MS.
function stopBrowser(browser) {
  if (!browser) return Promise.resolve();
  try { const proc = typeof browser.process === "function" ? browser.process() : null; if (proc && !proc.killed) proc.kill("SIGKILL"); } catch { /* already gone */ }
  return withTimeout(Promise.resolve().then(() => browser.close()), CLOSE_WAIT_MS, "Closing the browser").catch(() => {});
}

// html -> { pdf: Buffer, pages }. One render at a time per instance: Chromium is heavy.
// `fit` (a one-pager, Ebq2oqSH3Lp1UrHWnfgJ): { maxPages, steps: [{ html, scale }] }.
// When the first print runs over `maxPages`, each step is printed in turn in
// the same page (no second browser) until one fits; the result then carries
// `fit: { step, scale, tight, fitted }` (fitted false: none of them fitted,
// and the last step's PDF is returned so the caller can decide).
// The browser handle is held here, outside render(), so that when the print
// takes longer than `timeoutMs` the browser is stopped BEFORE the promise
// rejects: a hung print never keeps Chromium alive in the function, and the
// next render never starts a second one beside it. `launch` is for tests.
let chain = Promise.resolve();
function renderPdf(html, { format = cc.FORMATS.overview, timeoutMs = 60000, launch = launchBrowser, fit = null } = {}) {
  const run = chain.then(() => {
    const job = { browser: null, stopped: false };
    let timer = null;
    const timedOut = new Promise((_, reject) => {
      timer = setTimeout(() => {
        job.stopped = true;
        stopBrowser(job.browser).then(() => reject(new Error(`Printing the PDF took longer than ${Math.round(timeoutMs / 1000)} seconds`)));
      }, timeoutMs);
      if (timer.unref) timer.unref();
    });
    const printed = render(html, format, launch, job, fit);
    printed.catch(() => {}); // a print stopped by the timeout rejects later, unheard
    return Promise.race([printed, timedOut]).finally(() => clearTimeout(timer));
  });
  chain = run.catch(() => {});
  return run;
}
async function render(html, format, launch, job, fit = null) {
  const browser = await launch();
  job.browser = browser;
  // Launched after the timeout already fired: stopped straight away, never used.
  if (job.stopped) { await stopBrowser(browser); throw new Error("Printing the PDF was stopped by its time limit"); }
  try {
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on("request", (req) => (allowedRequest(req.url()) ? req.continue() : req.abort("blockedbyclient")));
    let shown = null;
    const print = async (content, scale) => {
      if (content !== shown) {
        await page.setContent(content, { waitUntil: "load", timeout: 30000 });
        // The brand font when it arrives in time; the fallback stack otherwise.
        await withTimeout(page.evaluateHandle("document.fonts.ready"), FONT_WAIT_MS, "The font").catch(() => {});
        shown = content;
      }
      const pdf = Buffer.from(await page.pdf(cl.PDF_OPTIONS(format, { scale })));
      if (!cc.isPdf(pdf)) throw new Error("the printer returned no PDF");
      return { pdf, pages: cc.pdfPageCount(pdf) };
    };
    let out = await print(html, 1);
    const maxPages = fit && Number(fit.maxPages) > 0 ? Number(fit.maxPages) : 0;
    if (!maxPages) return out;
    if (out.pages <= maxPages) return Object.assign(out, { fit: { step: 0, scale: 1, tight: false, fitted: true } });
    const steps = Array.isArray(fit.steps) ? fit.steps : [];
    for (let i = 0; i < steps.length; i++) {
      if (job.stopped) throw new Error("Printing the PDF was stopped by its time limit");
      out = await print(steps[i].html || html, steps[i].scale || 1);
      if (out.pages <= maxPages) return Object.assign(out, { fit: { step: i + 1, scale: steps[i].scale || 1, tight: Boolean(steps[i].tight), fitted: true } });
    }
    return Object.assign(out, { fit: { step: steps.length, scale: steps.length ? steps[steps.length - 1].scale || 1 : 1, tight: Boolean(steps.length && steps[steps.length - 1].tight), fitted: false } });
  } finally {
    if (!job.stopped) await browser.close().catch(() => {});
  }
}

module.exports = { renderPdf, allowedRequest, stopBrowser, FONT_WAIT_MS };
