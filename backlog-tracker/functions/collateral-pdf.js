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
// The browser handle is held here, outside render(), so that when the print
// takes longer than `timeoutMs` the browser is stopped BEFORE the promise
// rejects: a hung print never keeps Chromium alive in the function, and the
// next render never starts a second one beside it. `launch` is for tests.
let chain = Promise.resolve();
function renderPdf(html, { format = cc.FORMATS.overview, timeoutMs = 60000, launch = launchBrowser } = {}) {
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
    const printed = render(html, format, launch, job);
    printed.catch(() => {}); // a print stopped by the timeout rejects later, unheard
    return Promise.race([printed, timedOut]).finally(() => clearTimeout(timer));
  });
  chain = run.catch(() => {});
  return run;
}
async function render(html, format, launch, job) {
  const browser = await launch();
  job.browser = browser;
  // Launched after the timeout already fired: stopped straight away, never used.
  if (job.stopped) { await stopBrowser(browser); throw new Error("Printing the PDF was stopped by its time limit"); }
  try {
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on("request", (req) => (allowedRequest(req.url()) ? req.continue() : req.abort("blockedbyclient")));
    await page.setContent(html, { waitUntil: "load", timeout: 30000 });
    // The brand font when it arrives in time; the fallback stack otherwise.
    await withTimeout(page.evaluateHandle("document.fonts.ready"), FONT_WAIT_MS, "The font").catch(() => {});
    const pdf = Buffer.from(await page.pdf(cl.PDF_OPTIONS(format)));
    if (!cc.isPdf(pdf)) throw new Error("the printer returned no PDF");
    return { pdf, pages: cc.pdfPageCount(pdf) };
  } finally {
    if (!job.stopped) await browser.close().catch(() => {});
  }
}

module.exports = { renderPdf, allowedRequest, stopBrowser, FONT_WAIT_MS };
