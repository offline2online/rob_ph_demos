// node ph-website/tests/cta.test.mjs : the floating CTA (cta.php / cta.js / cta.css) in Chromium, on three fixtures:
// the Run Your Own RMN page (request: "Register your interest" -> #request-info, falling back to its #tour section without the form),
// an industry page with a guided tour (enhance.js + site.js, the band and its iframe: "Take the guided tour" -> the band, focusing the
// tour's gate), and a plain page (demo: "Arrange a demo" opens the header's pop-up: PH_SITE_DEMO from site.js, else Elementor Pro popup
// 2658 via a stubbed elementorProFrontend, else the booking link). Checks the label and element (<a> for scrolls, <button> for the
// pop-up), hidden while its target is in view and shown again after, a band mounted later switches a demo page to the tour, a locked
// (filtered) config is kept, hidden in the Elementor editor and preview and while a tour is full screen, never covering the cookie banner
// (it sits above it, then drops back), inside the viewport with no horizontal scroll at 390/768/1024/1440, at least 44x44 on touch,
// keyboard focus with a visible ring, reduced motion (fade, no slide), z-index below the popup and the banner, and the dataLayer event.
// Support Centre pages (/support-centre/ and everything under it): cta.php enqueues nothing there, so the page has no .ph-fcta, never
// requests cta.js or cta.css and pushes no ph_floating_cta event (the PHP decision is taken from cta.php itself when php is available);
// and cta.js given a hidden config renders nothing.
// Skips (exit 0) when Playwright or Chromium is not available.
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import assert from "assert";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { console.log("cta: playwright not installed here; skipping"); process.exit(0); }
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "..", "snippets", "ph-industry-enhancements");
const read = (f) => fs.readFileSync(path.join(dir, f), "utf8");
const css = read("cta.css"), js = read("cta.js"), site = read("site.js"), enhance = read("enhance.js"), ecss = read("enhance.css");
const { resolve, LABELS } = require(path.join(dir, "cta.js"));
let fails = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.error("FAIL: " + m); } };

const CAL = "https://calendly.com/rob-offline2online/30min?hide_gdpr_banner=1&primary_color=179bc2";
const CFG = {
  request: { variant: "request", label: LABELS.request, action: "scroll", target: "#request-info", hidden: false, locked: false, popup: 2658, href: CAL },
  tour: { variant: "tour", label: LABELS.tour, action: "scroll", target: "#ph-tour", hidden: false, locked: false, popup: 2658, href: CAL },
  demo: { variant: "demo", label: LABELS.demo, action: "demo", target: "", hidden: false, locked: false, popup: 2658, href: CAL },
};
const filler = (h) => `<section class="filler" style="height:${h}px;background:linear-gradient(#fff,#eef)"><h2>Section</h2><p>Copy</p></section>`;
const header = `<header class="elementor-location-header" style="position:sticky;top:0;z-index:99;background:#fff;height:72px"><nav><a href="/industries/">Industry</a> <a href="/support-centre/">Support</a></nav></header>`;
const pageFor = (kind, opts = {}) => {
  const cfg = opts.cfg || CFG[kind === "operator" ? "request" : kind === "tour" ? "tour" : "demo"];
  let main = "";
  if (kind === "operator") {
    main = `${filler(900)}<section id="tour" class="phf-sec"><h2>Tour</h2><form><input id="t-fn" name="name"><input id="t-em" name="email"></form></section>${filler(700)}`
      + (opts.noForm ? "" : `<section id="request-info" style="padding:40px"><h2>Register your interest</h2><form><label>Name <input id="ri-n" name="name"></label><label>Email <input id="ri-e" name="email" type="email"></label><button type="submit">Send</button></form></section>`)
      + filler(600);
  } else if (kind === "tour") {
    main = `<section class="ph-ind-sec" id="calcsec"><div class="ph-ind-calc"></div>${filler(1500)}</section>`
      + (opts.noBand ? "" : `<section class="ph-ind-sec ph-ind-tour"><h2>Interactive product tour</h2><div class="ph-ind-tour-mount"></div></section>`)
      + filler(1200);
  } else main = filler(2400);
  const banner = opts.banner ? `<div class="ph-cc" role="region" aria-label="Cookies" style="position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#fff;border-top:4px solid #1C2540;height:${opts.banner}px"><button id="cc-ok" onclick="this.parentNode.remove()">Accept</button></div>` : "";
  const ind = kind === "tour" ? `<script>window.PH_IND_PAGE="telco";</script>` : "";
  const pre = opts.pre || "";
  const sitejs = opts.noSite ? "" : `<script>${site}</script>`;
  const enh = kind === "tour" ? `<script>${enhance}</script>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:Arial}</style><style>${ecss}</style><style>${css}</style></head>
<body class="${opts.bodyClass || ""}">${header}<main>${main}</main><footer class="elementor-location-footer" style="height:200px"><a href="/privacy-policy/">Privacy</a></footer>${banner}
<script>window.__cal=[]; window.__pop=[]; window.__open=[]; window.Calendly={initPopupWidget:function(o){window.__cal.push(o.url);}}; window.open=function(u){window.__open.push(u);return null;};</script>${pre}
${ind}${sitejs}${enh}<script>window.PH_FLOATING_CTA=${JSON.stringify(cfg)};</script><script>${js}</script></body></html>`;
};
const TOUR_HTML = `<!doctype html><title>tour</title><form id="gate"><input id="g-name" name="name"><button>Start</button></form><button id="start">Start the tour</button>`;

const browser = await chromium.launch();
try {
  const open = async (kind, opts = {}) => {
    const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 800 }, hasTouch: !!opts.touch, isMobile: !!opts.touch, reducedMotion: opts.reduce ? "reduce" : "no-preference" });
    const p = await ctx.newPage();
    await p.route("**/*", (r) => {
      const u = r.request().url();
      if (/\/tour\//.test(u)) return r.fulfill({ contentType: "text/html", body: TOUR_HTML });
      return r.fulfill({ contentType: "text/html", body: pageFor(kind, opts) });
    });
    const url = { operator: "http://x.test/run-your-own-rmn/", tour: "http://x.test/industries/telco/", plain: "http://x.test/about/" }[kind];
    await p.goto(url + (opts.search || ""));
    await p.waitForLoadState("load");
    await p.waitForTimeout(50);
    return p;
  };
  const state = (p) => p.evaluate(() => {
    const w = document.getElementById("ph-fcta"), b = w && w.querySelector(".ph-fcta-b");
    if (!w) return null;
    const r = b.getBoundingClientRect(), cs = getComputedStyle(w);
    return { tag: b.tagName.toLowerCase(), text: b.textContent, href: b.getAttribute("href"), variant: w.getAttribute("data-variant"), off: w.classList.contains("ph-fcta-off"), vis: cs.visibility, z: Number(cs.zIndex), r: { l: r.left, t: r.top, w: r.width, h: r.height, right: r.right, bottom: r.bottom }, vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth };
  });
  const settle = (p) => p.waitForTimeout(350); // the 0.2s fade, then IntersectionObserver
  const events = (p) => p.evaluate(() => (window.dataLayer || []).filter((e) => e.event === "ph_floating_cta"));

  // Pure resolver (cta.js exports it under node).
  const fakeDoc = (ids, sel = {}) => ({ getElementById: (id) => (ids[id] || null), querySelector: (s) => sel[s] || null });
  ok(resolve(CFG.request, fakeDoc({ "request-info": {} })).target === "#request-info", "resolve: request with the form");
  ok(resolve(CFG.request, fakeDoc({ tour: { id: "tour", classList: { contains: (c) => c === "phf-sec" } } })).target === "#tour", "resolve: request without the form falls back to the page's tour");
  ok(resolve(CFG.tour, fakeDoc({})).variant === "demo", "resolve: no band on the page -> demo");
  const band = { id: "", closest: () => band };
  ok(resolve(CFG.demo, fakeDoc({}, { ".ph-ind-tour": band })).variant === "tour" && band.id === "ph-tour", "resolve: a band on a demo page -> tour, anchored #ph-tour");
  ok(resolve({ ...CFG.demo, locked: true, label: "Mine" }, fakeDoc({}, { ".ph-ind-tour": band })).label === "Mine", "resolve: a locked (filtered) config is kept");

  // 1. Run Your Own RMN page: request.
  let p = await open("operator");
  let s = await state(p);
  ok(s && s.tag === "a" && s.text === "Register your interest" && s.href === "#request-info" && s.variant === "request", "operator page: <a> Register your interest -> #request-info " + JSON.stringify(s));
  ok(!s.off && s.vis === "visible", "operator page: shown while the form is off screen");
  await p.click("#ph-fcta .ph-fcta-b");
  await p.waitForFunction(() => document.activeElement && document.activeElement.id === "ri-n");
  ok(true, "operator page: focuses the form's first empty field");
  await p.waitForFunction(() => document.getElementById("ph-fcta").classList.contains("ph-fcta-off"), null, { timeout: 3000 }).catch(() => {});
  await settle(p);
  s = await state(p);
  ok(s.off && s.vis === "hidden", "operator page: hidden while #request-info is in view");
  ok((await events(p)).length === 1 && JSON.stringify((await events(p))[0]) === JSON.stringify({ event: "ph_floating_cta", variant: "request" }), "dataLayer: ph_floating_cta {variant: request}, nothing else");
  await p.evaluate(() => window.scrollTo(0, 0));
  await settle(p);
  s = await state(p);
  ok(!s.off && s.vis === "visible", "operator page: shown again once the form scrolls out");
  await p.context().close();

  p = await open("operator", { noForm: true });
  s = await state(p);
  ok(s.variant === "tour" && s.href === "#tour" && s.text === "Take the guided tour", "operator page without #request-info: falls back to its tour section");
  await p.context().close();

  // 2. Industry page with a tour.
  p = await open("tour");
  s = await state(p);
  ok(s && s.tag === "a" && s.text === "Take the guided tour" && s.href === "#ph-tour" && s.variant === "tour", "tour page: <a> Take the guided tour -> #ph-tour " + JSON.stringify(s));
  await p.click("#ph-fcta .ph-fcta-b");
  await p.waitForFunction(() => { const f = document.querySelector(".ph-ind-tour-frame"); try { return f && f.contentDocument && f.contentDocument.activeElement && f.contentDocument.activeElement.id === "g-name" && document.activeElement === f; } catch (e) { return false; } }, null, { timeout: 5000 });
  ok(true, "tour page: scrolls to the band and focuses the tour's gate");
  await p.waitForFunction(() => document.getElementById("ph-fcta").classList.contains("ph-fcta-off"), null, { timeout: 3000 }).catch(() => {});
  await settle(p);
  ok((await state(p)).off, "tour page: hidden while the band is in view");
  ok((await events(p))[0].variant === "tour", "dataLayer: variant tour");
  await p.evaluate(() => window.scrollTo(0, 0));
  await settle(p);
  ok(!(await state(p)).off, "tour page: shown again once the band scrolls out");
  // Full screen (the in-page fallback a tour asks for): hidden, then back.
  await p.evaluate(() => window.postMessage({ type: "ph-tour-fullscreen", on: true }, location.origin));
  await settle(p);
  ok((await state(p)).off, "hidden while a tour is full screen");
  await p.evaluate(() => window.postMessage({ type: "ph-tour-fullscreen", on: false }, location.origin));
  await settle(p);
  ok(!(await state(p)).off, "shown again after full screen");
  await p.context().close();

  // A demo-config page whose band mounts later (enhance.js builds it after load): confirmed to the tour.
  p = await open("tour", { cfg: CFG.demo, noBand: true, pre: `<script>window.addEventListener("load",function(){var s=document.createElement("section");s.className="ph-ind-sec ph-ind-tour";s.innerHTML="<h2>Tour</h2>";document.querySelector("main").appendChild(s);},{once:true});</script>` });
  await p.waitForTimeout(100);
  s = await state(p);
  ok(s.variant === "tour" && s.text === "Take the guided tour" && s.href === "#ph-tour", "a band mounted later turns a demo page into the tour " + JSON.stringify(s));
  await p.context().close();

  // A locked (filtered) config is kept.
  p = await open("tour", { cfg: { ...CFG.demo, label: "Book a call", locked: true } });
  s = await state(p);
  ok(s.tag === "button" && s.text === "Book a call", "a filtered (locked) config is kept as it is");
  await p.context().close();

  // 3. Plain page: demo.
  p = await open("plain");
  s = await state(p);
  ok(s && s.tag === "button" && s.text === "Arrange a demo" && s.variant === "demo" && s.href === null, "plain page: <button> Arrange a demo " + JSON.stringify(s));
  await p.click("#ph-fcta .ph-fcta-b");
  ok((await p.evaluate(() => window.__cal)).length === 1, "plain page: opens the header's demo pop-up (PH_SITE_DEMO, site.js)");
  ok(JSON.stringify(await events(p)) === JSON.stringify([{ event: "ph_floating_cta", variant: "demo" }]), "dataLayer: variant demo, nothing else");
  await p.evaluate(() => window.scrollTo(0, 99999));
  await settle(p);
  ok(!(await state(p)).off, "plain page: shown everywhere (no target section)");
  await p.context().close();

  p = await open("plain", { noSite: true, pre: `<script>window.elementorProFrontend={modules:{popup:{showPopup:function(o){window.__pop.push(o.id);}}}};</script>` });
  await p.click("#ph-fcta .ph-fcta-b");
  ok(JSON.stringify(await p.evaluate(() => window.__pop)) === "[2658]", "without site.js: opens Elementor Pro popup 2658");
  await p.context().close();

  p = await open("plain", { noSite: true });
  await p.click("#ph-fcta .ph-fcta-b");
  ok(JSON.stringify(await p.evaluate(() => window.__open)) === JSON.stringify([CAL]), "no popup on the page: falls back to the header's booking link");
  await p.context().close();

  // Support Centre: cta.php decides per URL whether anything is enqueued; the page is built from that decision, with cta.js and cta.css
  // as real requests so a stray load would show.
  const phpDecides = (uri) => {
    const code = [
      'namespace { define("ABSPATH", "/"); define("PH_CTA_TEST", 1); function apply_filters($t, $v) { return $v; } }',
      'namespace AngieSnippets\\PhIndustryEnhancements_10063 {',
      'const PH_INDUSTRY_ENHANCEMENTS_ASSETS_VERSION_10063 = "t"; function page_key() { return ""; } function operator_is_page() { return false; }',
      `require ${JSON.stringify(path.join(dir, "cta.php"))}; $_SERVER["REQUEST_URI"] = $argv[1]; echo json_encode(cta_page_config()); }`,
    ].join("\n");
    try { return JSON.parse(execFileSync("php", ["-r", code, uri], { encoding: "utf8" })); } catch (e) { console.error(String(e.stderr || e.message)); return null; }
  };
  const SC = ["/support-centre/", "/support-centre/getting-started/", "/support-centre/platform-installation/aws-deployment-prerequisites/", "/support-centre?x=1"];
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    for (const uri of SC.concat(["/"])) {
      const cfg = phpDecides(uri);
      const hidden = cfg ? cfg.hidden : uri !== "/";
      if (!cfg) ok(false, "php not available to decide " + uri);
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      p = await ctx.newPage();
      const loaded = [];
      const sc = `<main class="ph-sc"><h1>Support Centre</h1>${filler(2400)}</main>`;
      const assets = hidden ? "" : `<link rel="stylesheet" href="/wp-content/snip/cta.css"><script>window.PH_FLOATING_CTA=${JSON.stringify(cfg || CFG.demo)};</script><script src="/wp-content/snip/cta.js"></script>`;
      await p.route("**/*", (r) => {
        const u = r.request().url();
        if (/cta\.js$/.test(u)) { loaded.push("cta.js"); return r.fulfill({ contentType: "text/javascript", body: js }); }
        if (/cta\.css$/.test(u)) { loaded.push("cta.css"); return r.fulfill({ contentType: "text/css", body: css }); }
        return r.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${header}${sc}<script>${site}</script>${assets}</body></html>` });
      });
      await p.goto("http://x.test" + uri);
      await p.waitForLoadState("load");
      await settle(p);
      const has = await p.evaluate(() => !!document.querySelector(".ph-fcta, #ph-fcta"));
      if (uri === "/") ok(has && loaded.includes("cta.js") && (await state(p)).text === "Arrange a demo", `home ${w}: still shows "Arrange a demo"`);
      else {
        ok(hidden, `${uri}: cta.php hides the CTA`);
        ok(!has, `${uri} ${w}: no .ph-fcta element`);
        ok(!loaded.length, `${uri} ${w}: loads no cta.js or cta.css (${loaded.join(",")})`);
        ok((await events(p)).length === 0, `${uri} ${w}: no ph_floating_cta event`);
      }
      await ctx.close();
    }
  }
  // Belt and braces: cta.js handed a hidden config renders nothing.
  p = await open("plain", { cfg: { ...CFG.demo, hidden: true } });
  ok((await state(p)) === null && (await events(p)).length === 0, "cta.js: a hidden config renders nothing and pushes no event");
  await p.context().close();

  // Elementor editor and preview: no CTA.
  for (const o of [{ bodyClass: "elementor-editor-active" }, { search: "?elementor-preview=123" }]) {
    p = await open("plain", o);
    ok((await state(p)) === null, "no CTA in the Elementor editor/preview " + JSON.stringify(o));
    await p.context().close();
  }

  // Sizes: inside the viewport, no horizontal scroll, never covering the cookie banner (above it while it is open).
  for (const [w, h] of [[390, 844], [768, 1024], [1024, 768], [1440, 900]]) {
    for (const kind of ["operator", "tour", "plain"]) {
      p = await open(kind, { viewport: { width: w, height: h }, banner: w < 768 ? 220 : 120 });
      await settle(p);
      s = await state(p);
      ok(!s.off, `${kind} ${w}: shown at the top of the page (its target is further down)`);
      const gap = w < 768 ? 16 : 24;
      ok(s.sw <= w, `${kind} ${w}: no horizontal scroll (${s.sw})`);
      ok(s.r.l >= gap - 0.5 && Math.abs(w - s.r.right - gap) < 1, `${kind} ${w}: ${gap}px from the right, inside the viewport ` + JSON.stringify(s.r));
      ok(Math.abs(h - 4 - (w < 768 ? 220 : 120) - s.r.bottom - gap) < 6 || Math.abs((h - (w < 768 ? 220 : 120)) - s.r.bottom - gap) < 6, `${kind} ${w}: sits ${gap}px above the cookie banner ` + JSON.stringify(s.r));
      const bannerTop = await p.evaluate(() => document.querySelector(".ph-cc").getBoundingClientRect().top);
      ok(s.r.bottom <= bannerTop, `${kind} ${w}: does not cover the cookie banner`);
      ok(await p.evaluate(() => { const b = document.querySelector("#ph-fcta .ph-fcta-b").getBoundingClientRect(); const e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!(e && e.closest("#ph-fcta")); }), `${kind} ${w}: on top of the page content`);
      await p.click("#cc-ok");
      await settle(p);
      s = await state(p);
      ok(Math.abs(h - s.r.bottom - gap) < 1, `${kind} ${w}: back to ${gap}px from the bottom once the banner is gone ` + JSON.stringify(s.r));
      ok(s.r.h >= 48, `${kind} ${w}: at least 48px tall`);
      await p.context().close();
    }
  }

  // Touch: at least 44x44, and a tap works.
  for (const kind of ["operator", "tour", "plain"]) {
    p = await open(kind, { viewport: { width: 390, height: 844 }, touch: true });
    s = await state(p);
    ok(s.r.w >= 44 && s.r.h >= 44, `${kind} touch: hit area at least 44x44 (${s.r.w}x${s.r.h})`);
    await p.tap("#ph-fcta .ph-fcta-b");
    ok((await events(p)).length === 1, `${kind} touch: a tap acts`);
    await p.context().close();
  }

  // Keyboard: reachable with Tab, a visible focus ring, Enter acts.
  p = await open("plain");
  let reached = false;
  for (let i = 0; i < 12 && !reached; i++) { await p.keyboard.press("Tab"); reached = await p.evaluate(() => !!(document.activeElement && document.activeElement.closest && document.activeElement.closest("#ph-fcta"))); }
  ok(reached, "keyboard: the CTA is reachable with Tab");
  const ring = await p.evaluate(() => { const cs = getComputedStyle(document.activeElement); return { s: cs.outlineStyle, w: parseFloat(cs.outlineWidth) }; });
  ok(ring.s === "solid" && ring.w >= 2, "keyboard: visible focus ring " + JSON.stringify(ring));
  await p.keyboard.press("Enter");
  ok((await p.evaluate(() => window.__cal)).length === 1, "keyboard: Enter opens the pop-up");
  await p.context().close();

  // Look: the site's primary button; stacking below the popup and the banner.
  p = await open("plain");
  const look = await p.evaluate(() => { const b = getComputedStyle(document.querySelector(".ph-fcta-b")); return { bg: b.backgroundColor, c: b.color, fw: b.fontWeight, br: b.borderTopLeftRadius, pad: b.paddingTop + " " + b.paddingRight, z: Number(getComputedStyle(document.getElementById("ph-fcta")).zIndex), pos: getComputedStyle(document.getElementById("ph-fcta")).position, sh: b.boxShadow }; });
  ok(look.bg === "rgb(22, 155, 194)" && look.c === "rgb(255, 255, 255)" && look.fw === "600" && look.br === "999px" && look.pad === "14px 22px" && look.sh !== "none", "look: PH teal, white, 600, pill, 14px 22px, shadow " + JSON.stringify(look));
  ok(look.pos === "fixed" && look.z > 99 && look.z < 9999, "z-index above page content and sticky headers, below the Elementor popup (9999) and the cookie banner (99999)");
  await p.context().close();

  // Reduced motion: a fade, no slide.
  p = await open("operator", { reduce: true });
  await p.click("#ph-fcta .ph-fcta-b");
  await settle(p);
  const rm = await p.evaluate(() => { const w = document.getElementById("ph-fcta"); return { off: w.classList.contains("ph-fcta-off"), t: getComputedStyle(w).transform, op: getComputedStyle(w).opacity }; });
  ok(rm.off && rm.t === "none" && rm.op === "0", "reduced motion: hidden by a fade only " + JSON.stringify(rm));
  await p.context().close();
  p = await open("operator");
  await p.click("#ph-fcta .ph-fcta-b");
  await settle(p);
  ok((await p.evaluate(() => getComputedStyle(document.getElementById("ph-fcta")).transform)) !== "none", "full motion: hides with a short slide");
  await p.context().close();
} finally {
  await browser.close();
}
console.log(fails ? `cta: ${fails} of ${n} checks FAILED` : `cta: all ${n} checks passed`);
process.exit(fails ? 1 : 0);
