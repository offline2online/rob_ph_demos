// Aidan's branded collateral printed to PDF in a real Chromium
// (JtkLrEG0aTnC5JfkdPA1): the page functions/collateral-layout.js builds,
// printed with the same options functions/collateral-pdf.js gives the server's
// Chromium (cl.PDF_OPTIONS), with JavaScript off and every request but data:
// URIs refused (the web font is refused too, so the wider fallback stack gives
// a conservative measure, as the brand skill's testing section asks).
//
// Checks a one-pager is one page, an overview runs to several, a deck is
// landscape with a page per section; the CTA is a real link to the trial; the
// logo from the brand skill renders; nothing is wider than the page; the
// headline is at most three lines.
// Run: node test/collateral-render.test.mjs (needs Chromium: PLAYWRIGHT_CHROMIUM
// or /opt/pw-browsers/chromium, as the other browser tests).
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const cc = require("../functions/collateral-core.js");
const cl = require("../functions/collateral-layout.js");

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="40" viewBox="0 0 200 40"><rect x="0" y="0" width="6" height="40" fill="#169BC2"/><rect x="0" y="0" width="40" height="6" fill="#EF60A7"/><rect x="34" y="0" width="6" height="40" fill="#FE9226"/><rect x="0" y="34" width="40" height="6" fill="#60D838"/><text x="50" y="28" font-size="20" fill="#7B7B7B">PersonalisationHub</text></svg>`;
const BRAND = { id: "b1", slug: "ph-brand", name: "PH Brand", files: [{ path: "SKILL.md", content: "# Brand" }, { path: "logos/ph_logo_full_color.svg", content: LOGO }] };

const para = (n, seed) => Array.from({ length: n }, (_, i) => `${seed} sentence ${i + 1} keeps shoppers in store and turns browsers into buyers.`).join(" ");
const ONE_PAGER = [
  "# Win every grocery aisle",
  "",
  "Personalise the store on your own first-party data, kept secure in your own cloud.",
  "",
  "## The challenge",
  "",
  para(3, "Grocery"),
  "",
  "## What changes in store",
  "",
  "- **Signage that knows who's walking past.** Content adapts in the moment.",
  "- **The shelf edge just got personal.** Offers that match the basket.",
  "- **Every in-store sale closes the loop.** Campaigns keep optimising on real sales.",
  "",
  "## Why it works",
  "",
  para(2, "Closed loop"),
].join("\n");
const OVERVIEW = ["# Personalisation Hub for pharmacy", "", "One platform for every store, every screen and every shelf.", ""]
  .concat(...Array.from({ length: 9 }, (_, i) => [`## Section ${i + 1}`, "", para(5, `Pharmacy ${i + 1}`), "", "- First point that matters", "- Second point that matters", "- Third point that matters", "", ...(i === 4 ? ["| Capability | What it does |", "|---|---|", "| Signage | Knows who is walking past |", "| Shelf edge | Personal at the shelf |", ""] : []), ...(i === 6 ? ["> Every in-store sale closes the loop.", ""] : [])]))
  .join("\n");
const DECK = ["# Grocery deck", "", "Intro line.", ""].concat(...Array.from({ length: 6 }, (_, i) => [`## Slide ${i + 1}`, "", "- Point one", "- Point two", ""])).join("\n");

const launch = { headless: true };
if (process.env.PLAYWRIGHT_CHROMIUM) launch.executablePath = process.env.PLAYWRIGHT_CHROMIUM;
else if (fs.existsSync("/opt/pw-browsers/chromium")) launch.executablePath = "/opt/pw-browsers/chromium";
const browser = await chromium.launch(launch).catch(() => chromium.launch({ headless: true, channel: "chrome" }));

// As collateral-pdf.js prints it: no script, nothing fetched but data: URIs.
async function open(html) {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const blocked = [];
  await page.route("**/*", (route) => { const u = route.request().url(); if (u.startsWith("data:")) return route.continue(); blocked.push(u); return route.abort("blockedbyclient"); });
  await page.setContent(html, { waitUntil: "load" });
  return { page, context, blocked };
}
async function print(md, format, extra = {}) {
  const html = cl.collateralHtml(Object.assign({ documentMd: md, format, industry: "Grocery & Supermarkets", prospect: { name: "CP Group" }, brand: BRAND }, extra));
  const { page, context, blocked } = await open(html);
  const pdf = Buffer.from(await page.pdf(cl.PDF_OPTIONS(format)));
  // Measured as printed: the print stylesheet at the page's content width.
  await page.emulateMedia({ media: "print" });
  const contentWidth = format.landscape ? Math.round(((297 - 36) / 25.4) * 96) : Math.round(((210 - 36) / 25.4) * 96);
  await page.setViewportSize({ width: contentWidth, height: 1200 });
  const m = await page.evaluate(() => {
    const h1 = document.querySelector("h1");
    const lh = parseFloat(getComputedStyle(h1).lineHeight);
    const logo = document.querySelector("img.c-logo");
    const wide = [...document.querySelectorAll("body *")].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1).map((el) => el.tagName + "." + el.className);
    return { headlineLines: Math.round(h1.getBoundingClientRect().height / lh), logo: logo ? { w: logo.naturalWidth, h: logo.getBoundingClientRect().height } : null, wide, scroll: document.documentElement.scrollWidth, width: window.innerWidth,
      pill: (document.querySelector(".c-pill") || {}).textContent || "", eyebrow: getComputedStyle(document.querySelector(".c-eyebrow")).color };
  });
  await context.close();
  return { pdf, pages: cc.pdfPageCount(pdf), m, blocked, text: pdf.toString("latin1") };
}

// The first page's size in points: A4 is 595 x 842.
const mediaBox = (text) => { const m = text.match(/\/MediaBox\s*\[\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)/); return m ? [Math.round(Number(m[1])), Math.round(Number(m[2]))] : null; };

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`); } catch (err) { failed += 1; console.error(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
}

await test("a one-pager prints on one A4 page, with the logo, the headline in at most three lines and nothing wider than the page", async () => {
  const r = await print(ONE_PAGER, cc.FORMATS["one-pager"]);
  assert.ok(cc.isPdf(r.pdf));
  assert.strictEqual(r.pages, 1, `pages: ${r.pages}`);
  assert.ok(r.m.logo && r.m.logo.w > 0 && r.m.logo.h > 20, `the brand skill's logo renders: ${JSON.stringify(r.m.logo)}`);
  assert.ok(r.m.headlineLines <= 3, `headline lines: ${r.m.headlineLines}`);
  assert.deepStrictEqual(r.m.wide, [], "nothing past the right margin");
  assert.ok(r.m.scroll <= r.m.width + 1);
  assert.strictEqual(r.m.pill, "Try free on AWS Marketplace →");
  assert.deepStrictEqual(mediaBox(r.text), [595, 842], "A4 portrait");
  assert.ok(r.text.includes("aws.amazon.com/marketplace/pp/prodview-3uiwcnbrpvj76"), "the CTA is a real link to the trial");
  assert.ok(r.blocked.every((u) => /fonts\.(googleapis|gstatic)\.com/.test(u)), `only the font was asked for: ${r.blocked.join(", ")}`);
});

await test("a platform overview runs to several pages; the footer prints on every one", async () => {
  const r = await print(OVERVIEW, cc.FORMATS.overview);
  assert.ok(r.pages >= 3 && r.pages <= 8, `pages: ${r.pages}`);
  assert.deepStrictEqual(r.m.wide, []);
});

await test("a deck is landscape with a page per section", async () => {
  const r = await print(DECK, cc.FORMATS.deck);
  assert.deepStrictEqual(mediaBox(r.text), [842, 595], "A4 landscape");
  assert.ok(r.pages >= 6, `pages: ${r.pages}`);
});

await test("the brand skill's own collateral stylesheet is applied after the defaults", async () => {
  const brand = Object.assign({}, BRAND, { files: [...BRAND.files, { path: "collateral.css", content: ".c-eyebrow { color: rgb(196, 61, 130); }" }] });
  const r = await print(ONE_PAGER, cc.FORMATS["one-pager"], { brand });
  assert.strictEqual(r.m.eyebrow, "rgb(196, 61, 130)");
});

// Ebq2oqSH3Lp1UrHWnfgJ: a one-pager that runs over is printed through the fit
// steps (cl.FIT_STEPS), the way collateral-pdf.js → renderPdf does, until it is
// one page; a plain document (cta: false) carries no sales call to action.
const overLong = (extra) => [ONE_PAGER, "", "## Proof", "", para(extra, "Proof")].join("\n");
const ONE_PAGER_FORMAT = cc.FORMATS["one-pager"];
async function fitPage() {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.route("**/*", (route) => (route.request().url().startsWith("data:") ? route.continue() : route.abort("blockedbyclient")));
  let shown = null;
  const pagesAt = async (md, st) => {
    const html = cl.collateralHtml({ documentMd: md, format: ONE_PAGER_FORMAT, industry: "Grocery & Supermarkets", prospect: { name: "CP Group" }, brand: BRAND, tight: st.tight });
    if (html !== shown) { await page.setContent(html, { waitUntil: "load" }); shown = html; }
    return cc.pdfPageCount(Buffer.from(await page.pdf(cl.PDF_OPTIONS(ONE_PAGER_FORMAT, { scale: st.scale }))));
  };
  return { pagesAt, close: () => context.close() };
}
async function fitted(md) {
  const fp = await fitPage();
  const counts = [];
  for (const st of cl.FIT_STEPS) {
    counts.push(await fp.pagesAt(md, st));
    if (counts[counts.length - 1] === 1) break;
  }
  await fp.close();
  return counts;
}
// The shortest "Proof" paragraph that runs onto a second page at fit step `st`.
// Measured, not hard-coded: the runner's fallback fonts set differently from a
// cloud session's, so a fixed length that needs scaling in one is too long in
// the other (failed on the train with 44 sentences: 2,2,2,2).
async function firstOverflow(st) {
  const fp = await fitPage();
  let lo = 0, hi = 400; // pagesAt(lo) is 1, pagesAt(hi) is more than 1
  assert.equal(await fp.pagesAt(overLong(lo), st), 1, "the base one-pager fits one page");
  assert.ok((await fp.pagesAt(overLong(hi), st)) > 1, "a very long one-pager runs over");
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((await fp.pagesAt(overLong(mid), st)) > 1) hi = mid; else lo = mid;
  }
  await fp.close();
  return hi;
}

await test("a one-pager that runs onto a second page is fitted to one: the tight page first, then scaled, never below 0.85", async () => {
  const [plain, tight, last] = [cl.FIT_STEPS[0], cl.FIT_STEPS[1], cl.FIT_STEPS[cl.FIT_STEPS.length - 1]];
  assert.deepStrictEqual(await fitted(overLong(await firstOverflow(plain))), [2, 1], "just over one page: the tight page is enough");
  const scaled = await fitted(overLong(await firstOverflow(tight)));
  assert.ok(scaled.length >= 3 && scaled[0] === 2 && scaled[scaled.length - 1] === 1, `just over the tight page: scaled down to fit: ${scaled}`);
  const tooLong = await fitted(overLong((await firstOverflow(last)) + 40));
  assert.ok(tooLong.length === cl.FIT_STEPS.length && tooLong.every((n) => n > 1), `far too long never fits by printing alone: ${tooLong}`);
  assert.ok(cl.FIT_STEPS.every((st) => st.scale >= cl.MIN_FIT_SCALE) && cl.PDF_OPTIONS(ONE_PAGER_FORMAT, { scale: 0.5 }).scale === cl.MIN_FIT_SCALE, "never below the readable floor");
});

await test("a document Aidan sends that isn't collateral is printed without the sales call to action", async () => {
  const html = cl.collateralHtml({ documentMd: "# AWS onboarding pack\n\nFor Kestrel.", format: Object.assign({}, cc.FORMATS.overview, { label: "Document" }), cta: false, brand: BRAND });
  assert.ok(!html.includes(`<section class="c-cta"`) && !html.includes("Try free on AWS Marketplace") && !html.includes(`<p class="c-eyebrow"`) && html.includes("For Kestrel."));
});

await browser.close();
console.log(failed ? `\n${failed} failed` : "\ncollateral-render: all passed");
process.exit(failed ? 1 : 0);
