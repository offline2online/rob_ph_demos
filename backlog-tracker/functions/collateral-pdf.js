"use strict";
// Prints Aidan's branded collateral to PDF on the server (ticket
// JtkLrEG0aTnC5JfkdPA1): the page built by collateral-core.js → collateralHtml,
// in headless Chromium (puppeteer-core + @sparticuz/chromium, the same pair
// kanban-capture.js uses; both are already dependencies of these functions, so
// nothing binary is added to the repository).
//
// Safe by construction: JavaScript is off, and the only requests allowed out
// are the brand font (fonts.googleapis.com / fonts.gstatic.com); the logo is a
// data: URI. Everything has to finish inside `timeoutMs` (aidan.js gives it
// COLLATERAL_RENDER_TIMEOUT_MS), so a whole write run still fits in the
// supportMail function's 540 seconds; when it can't, the run goes to a person.
//
// Tests: test/collateral-render.test.mjs prints the same page in Chromium with
// the same options; test/collateral-core.test.js covers `allowedRequest`.

const cc = require("./collateral-core");

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

// html -> { pdf: Buffer, pages }. One render at a time per instance: Chromium is heavy.
let chain = Promise.resolve();
function renderPdf(html, { format = cc.FORMATS.overview, timeoutMs = 60000 } = {}) {
  const run = chain.then(() => withTimeout(render(html, format), timeoutMs, "Printing the PDF"));
  chain = run.catch(() => {});
  return run;
}
async function render(html, format) {
  let puppeteer, chromium;
  try { puppeteer = require("puppeteer-core"); chromium = require("@sparticuz/chromium"); }
  catch (err) { const e = new Error("The PDF printer isn't installed on the server (puppeteer-core / @sparticuz/chromium)."); e.code = "no-browser"; throw e; }
  const browser = await puppeteer.launch({
    args: chromium.args, headless: true,
    executablePath: process.env.COLLATERAL_CHROMIUM || process.env.KANBAN_CAPTURE_CHROMIUM || await chromium.executablePath(),
  });
  try {
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on("request", (req) => (allowedRequest(req.url()) ? req.continue() : req.abort("blockedbyclient")));
    await page.setContent(html, { waitUntil: "load", timeout: 30000 });
    // The brand font when it arrives in time; the fallback stack otherwise.
    await withTimeout(page.evaluateHandle("document.fonts.ready"), FONT_WAIT_MS, "The font").catch(() => {});
    const pdf = Buffer.from(await page.pdf(cc.PDF_OPTIONS(format)));
    if (!cc.isPdf(pdf)) throw new Error("the printer returned no PDF");
    return { pdf, pages: cc.pdfPageCount(pdf) };
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { renderPdf, allowedRequest, FONT_WAIT_MS };
