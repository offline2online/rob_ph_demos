// Server-side page screenshots for Staff Kanban (kanban_capture_screenshot /
// kanban_capture_screenshots in functions/kanban.js). The board renders a page
// itself in headless Chromium, so nobody sends image bytes through MCP.
//
// Only pages on the artifact domains below can be captured, and a capture that
// looks wrong (non-200, a "doesn't exist" page, redirected away from the
// route) is reported instead of being attached.
"use strict";

// Where a project's artifact and prototypes are served from.
const DEFAULT_HOSTS = ["offline2online.github.io", "rawcdn.githack.com", "raw.githack.com"];
const allowedHosts = () => {
  const extra = String(process.env.KANBAN_CAPTURE_HOSTS || "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  return DEFAULT_HOSTS.concat(extra);
};
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

const LIMITS = {
  width: { min: 320, max: 2560, def: 1440 },
  height: { min: 200, max: 2000, def: 900 },
  waitMs: { min: 0, max: 15000, def: 1500 },
  maxPageHeight: 12000, // a full-page capture is clipped here
  batchMax: 20,         // pages in one batch call
  batchBudgetMs: 240000, // stop starting new pages after this (the function allows 300 s)
  navTimeoutMs: 25000,
};

// → { ok: true, url } or { ok: false, error }. https only, no credentials, no
// port, and the host must be on the allow-list exactly (not a suffix match).
function checkUrl(raw) {
  let u;
  try { u = new URL(String(raw || "").trim()); } catch (err) { return { ok: false, error: "That isn't a valid URL." }; }
  if (u.protocol !== "https:") return { ok: false, error: "Only https:// pages can be captured." };
  if (u.username || u.password) return { ok: false, error: "A URL with a user name or password can't be captured." };
  if (u.port) return { ok: false, error: "A URL with a port can't be captured." };
  const host = u.hostname.toLowerCase();
  if (!allowedHosts().includes(host)) return { ok: false, error: `${host} isn't an allowed domain. Captures are limited to: ${allowedHosts().join(", ")}.` };
  return { ok: true, url: u.toString() };
}

// A request the page makes while rendering: https only, never an address
// literal, localhost or an internal name (the pages are ours, but a page can
// ask for anything).
function subresourceAllowed(raw) {
  let u;
  try { u = new URL(raw); } catch (err) { return false; }
  if (u.protocol === "data:" || u.protocol === "blob:" || u.protocol === "about:") return true;
  if (u.protocol !== "https:") return false;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(":") || /^\[/.test(h)) return false;
  return true;
}

// The route the caller asked for, compared with where the page ended up: the
// same origin and path, and the same hash route (a single-page app that bounces
// an unknown route to "#/" has "redirected home").
function sameRoute(requested, finalUrl) {
  try {
    const a = new URL(requested), b = new URL(finalUrl);
    const strip = (p) => p.replace(/\/index\.html$/, "/").replace(/\/+$/, "");
    if (a.origin !== b.origin || strip(a.pathname) !== strip(b.pathname)) return false;
    const norm = (h) => h.replace(/^#!?\/?/, "").replace(/\/+$/, "");
    return norm(a.hash) === norm(b.hash);
  } catch (err) { return false; }
}

// What a "not found" page says near the top.
const MISSING_RE = /\b(404|page (?:not found|doesn['’]?t exist|does not exist)|not found|no such page|route (?:not found|doesn['’]?t exist))\b/i;
const looksMissing = (text) => MISSING_RE.test(String(text || "").trim().slice(0, 240));

// Browser rendering. Replaceable (tests stub render); the real one needs
// puppeteer-core and @sparticuz/chromium, loaded only when a capture runs.
const renderer = {
  _chain: Promise.resolve(),
  // One page at a time per instance: Chromium is heavy and the function has 1 GiB.
  render(opts) {
    const run = this._chain.then(() => this._render(opts));
    this._chain = run.catch(() => {});
    return run;
  },
  async _render({ url, width, height, fullPage, waitMs }) {
    let puppeteer, chromium;
    try { puppeteer = require("puppeteer-core"); chromium = require("@sparticuz/chromium"); }
    catch (err) { const e = new Error("The screenshot browser isn't installed on the server (puppeteer-core / @sparticuz/chromium)."); e.code = "no-browser"; throw e; }
    const browser = await puppeteer.launch({
      args: chromium.args, defaultViewport: { width, height },
      executablePath: process.env.KANBAN_CAPTURE_CHROMIUM || await chromium.executablePath(), headless: true,
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width, height });
      await page.setRequestInterception(true);
      const requested = new URL(url);
      page.on("request", (req) => {
        const to = req.url();
        // A navigation of the main frame must stay on an allowed domain, so a
        // redirect off the artifact domain is refused here.
        if (req.isNavigationRequest() && req.frame() === page.mainFrame()) {
          const c = checkUrl(to);
          if (!c.ok && !to.startsWith("data:") && !to.startsWith("about:")) return req.abort("blockedbyclient");
          return req.continue();
        }
        if (!subresourceAllowed(to)) return req.abort("blockedbyclient");
        return req.continue();
      });
      const failedRequests = [];
      page.on("requestfailed", (r) => { try { if (r.failure() && r.failure().errorText !== "net::ERR_BLOCKED_BY_CLIENT") failedRequests.push(r.url()); } catch (e) { /* ignore */ } });
      const res = await page.goto(url, { waitUntil: "networkidle2", timeout: LIMITS.navTimeoutMs });
      // A hash-route app renders after load; give it the wait, then the fonts.
      if (waitMs) await new Promise((r) => setTimeout(r, waitMs));
      await page.evaluate(() => (document.fonts && document.fonts.ready) || null);
      const info = await page.evaluate(() => {
        const iconFont = !!document.querySelector(".material-symbols-outlined, .material-icons, [class*='material-symbols']");
        let iconsLoaded = true;
        try { iconsLoaded = !iconFont || document.fonts.check('16px "Material Symbols Outlined"') || document.fonts.check('16px "Material Icons"'); } catch (e) { /* ignore */ }
        return { text: (document.body && document.body.innerText) || "", href: location.href, height: Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement.scrollHeight), iconsLoaded };
      });
      const warnings = [];
      if (!info.iconsLoaded) warnings.push("The icon font didn't load, so icons may show as plain text (fonts.googleapis.com / fonts.gstatic.com unreachable?).");
      if (failedRequests.length) warnings.push(`${failedRequests.length} request(s) failed while rendering (for example ${failedRequests[0]}); the page may be missing data.`);
      const clipH = Math.min(Math.max(info.height, height), LIMITS.maxPageHeight);
      const png = await page.screenshot(fullPage
        ? { type: "png", clip: { x: 0, y: 0, width, height: clipH } , captureBeyondViewport: true }
        : { type: "png" });
      return { status: res ? res.status() : 0, finalUrl: info.href, requestedHost: requested.hostname, text: info.text, png: Buffer.from(png), warnings };
    } finally {
      await browser.close().catch(() => {});
    }
  },
};

// Why a rendered page can't be attached, or null when it can.
function judge(url, shot) {
  if (shot.status !== 200) return `The page answered ${shot.status || "no response"}, not 200.`;
  if (!sameRoute(url, shot.finalUrl)) return `The page redirected to ${shot.finalUrl} instead of staying on the requested route.`;
  if (looksMissing(shot.text)) return "The page says it doesn't exist (a not-found page).";
  if (!shot.png || shot.png.length < 100) return "The browser returned no image.";
  return null;
}

// ── The description ───────────────────────────────────────────────────────
const escAttr = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const imageParagraph = (url, caption, name) => `<p><img src="${escAttr(url)}" alt="${escAttr(caption || name)}">${caption ? `<br><em>${escAttr(caption)}</em>` : ""}</p>`;

// Puts the picture where the "Screenshot: …" line is (every such line goes),
// replacing a picture an earlier capture put there, else after the text.
function placeScreenshot(html, imageHtml) {
  let d = String(html || "");
  // An earlier capture's paragraph (its file is named capture-…).
  d = d.replace(/<p>\s*<img[^>]*src="[^"]*capture-[^"]*"[^>]*>[\s\S]*?<\/p>/g, "\u0000CAPTURE\u0000");
  const block = /<(p|div|li)(?:\s[^>]*)?>\s*(?:<[^>]+>\s*)*Screenshot\s*:[\s\S]*?<\/\1>/gi;
  const line = /(^|\n)[ \t]*Screenshot[ \t]*:[^\n]*/gi;
  let placed = false;
  const put = () => { if (placed) return ""; placed = true; return "\u0000CAPTURE\u0000"; };
  d = d.replace(block, put).replace(line, (m, lead) => lead + put());
  // The first marker takes the picture, any other is dropped.
  let first = true;
  d = d.replace(/\u0000CAPTURE\u0000/g, () => { if (first) { first = false; return imageHtml; } return ""; });
  if (first) d = d + imageHtml;
  return d;
}

const captureName = (key) => `capture-${String(key).replace(/[^A-Za-z0-9-]/g, "")}.png`;

module.exports = { DEFAULT_HOSTS, FONT_HOSTS, LIMITS, allowedHosts, checkUrl, subresourceAllowed, sameRoute, looksMissing, renderer, judge, placeScreenshot, imageParagraph, captureName };
