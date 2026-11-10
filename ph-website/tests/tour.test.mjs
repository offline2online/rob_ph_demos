// node ph-website/tests/tour.test.mjs : the telco, pharmacy, retail media and fuel & convenience product tour on the industry pages (enhance.js + site.js), in Chromium.
// Checks: the band is mounted (Elementor mount, or built after the calculator's section), the iframe src (+ph_test forwarding), the height
// message, window.PH_TOUR, "Arrange a Demo" -> PH_SITE_DEMO, and that a successful calculator download writes
// localStorage ph_lead and dispatches window "ph:lead". Skips (exit 0) when Playwright or Chromium is not available.
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import assert from "assert";
import { fileURLToPath } from "url";
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { console.log("tour: playwright not installed here; skipping"); process.exit(0); }
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "..", "snippets", "ph-industry-enhancements");
const enhance = fs.readFileSync(path.join(dir, "enhance.js"), "utf8");
const site = fs.readFileSync(path.join(dir, "site.js"), "utf8");
const { CALC } = require(path.join(dir, "enhance.js"));
const nOf = (ind) => CALC[ind].inputs.length + CALC[ind].assumptions.length;
const row = '<div class="ph-ind-cf"><span class="ph-ind-cf-l">L</span><span class="ph-ind-cf-v">V</span></div>';
const css = fs.readFileSync(path.join(dir, "enhance.css"), "utf8");
const html = (withBand, ind = "telco") => `<!doctype html><html><head><style>${css}</style></head><body><main>
<section class="ph-ind-sec" id="calcsec"><div class="ph-ind-calc"><div class="ph-ind-cin"><p class="ph-ind-label-gap">a</p><p class="ph-ind-label-gap">b</p>${row.repeat(nOf(ind))}</div>
<div class="ph-ind-cout"><p class="ph-ind-ctot-l">Total</p><p class="ph-ind-ctot-v">0</p><div class="ph-ind-crow">r</div></div></div></section>
${withBand ? '<section class="ph-ind-sec ph-ind-tour" id="band"><h2>Server heading</h2><div class="ph-ind-tour-mount"></div></section>' : ""}
<section class="ph-ind-sec" id="after">next</section></main>
<script>window.PH_IND_PAGE="${ind}"; window.__demo=[]; window.__cal=[]; window.Calendly={initPopupWidget:function(o){window.__cal.push(o.url);}};</script>
<script>${site}</script><script>${enhance}</script></body></html>`;

const browser = await chromium.launch();
try {
  const open = async (withBand, search = "", ind = "telco") => {
    const p = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await p.route("**/*", (r) => {
      const u = r.request().url();
      if (/\/industries\/(telco|pharmacy|convenience)\/tour\//.test(u)) return r.fulfill({ contentType: "text/html", body: "<!doctype html><title>t</title><p>tour</p>" });
      if (/wp-json\/ph-site\/v1\/(industry-lead|telco-model)$/.test(u)) return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, download: "http://x.test/blocked.xlsx" }) });
      if (/blocked\.xlsx/.test(u)) return r.fulfill({ status: 204, body: "" });
      return r.fulfill({ contentType: "text/html", body: html(withBand, ind) });
    });
    await p.goto("http://x.test/industries/" + ind + "/" + search);
    return p;
  };
  // Elementor band present: the iframe goes into its mount, after the calculator section.
  let p = await open(true);
  assert.strictEqual(await p.locator("#band .ph-ind-tour-mount iframe").count(), 1, "iframe mounted in the Elementor band");
  assert.strictEqual(await p.locator(".ph-ind-tour").count(), 1, "no second band built");
  assert.strictEqual(await p.textContent("#band h2"), "Server heading", "the server-rendered heading is untouched");
  const fr = p.locator("iframe.ph-ind-tour-frame");
  assert.strictEqual(await fr.getAttribute("src"), "/industries/telco/tour/?embed=1", "iframe src");
  assert.strictEqual(await fr.getAttribute("title"), "Interactive product tour");
  assert.strictEqual(await fr.getAttribute("loading"), "lazy");
  assert.ok(/width:\s*100%/.test(await fr.getAttribute("style")) && /border:\s*0/.test(await fr.getAttribute("style")), "full width, no border");
  assert.ok(await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".ph-ind-tour-frame")).minHeight) >= 0), "min-height style readable");
  // Config for the tour.
  const cfg = await p.evaluate(() => ({ e: window.PH_TOUR.endpoint, n: window.PH_TOUR.nonce, t: typeof window.PH_TOUR.arrangeDemo }));
  assert.deepStrictEqual(cfg, { e: "/wp-json/ph-site/v1/tour-lead", n: "", t: "function" }, "window.PH_TOUR");
  // Arrange a Demo -> the header Calendly popup + ph_ind_cta.
  await p.evaluate(() => window.PH_TOUR.arrangeDemo());
  assert.strictEqual(await p.evaluate(() => window.__cal.length), 1, "Calendly popup opened");
  const cta = await p.evaluate(() => window.dataLayer.filter((e) => e.event === "ph_ind_cta"));
  assert.ok(cta.length === 1 && cta[0].ph_cta === "demo" && cta[0].ph_industry === "telco" && cta[0].ph_section === 1, "ph_ind_cta pushed with the band's section index: " + JSON.stringify(cta));
  // Height message: only from the iframe, same origin.
  await p.evaluate(() => { const f = document.querySelector(".ph-ind-tour-frame"); f.style.height = "100px"; });
  await p.evaluate(() => window.postMessage({ type: "ph-tour-height", h: 1234 }, "*"));
  await p.waitForTimeout(100);
  assert.strictEqual(await fr.evaluate((f) => f.style.height), "100px", "a message that is not from the iframe is ignored");
  await p.frameLocator("iframe.ph-ind-tour-frame").locator("p").waitFor();
  const child = p.frames().find((x) => x !== p.mainFrame());
  await child.evaluate(() => { parent.postMessage({ type: "ph-tour-height", h: 1234 }, location.origin); });
  await p.waitForFunction(() => document.querySelector(".ph-ind-tour-frame").style.height === "1234px");
  await child.evaluate(() => { parent.postMessage({ type: "ph-tour-height", h: 1e9 }, location.origin); });
  await p.waitForTimeout(100);
  assert.strictEqual(await fr.evaluate((f) => f.style.height), "1234px", "an absurd height is ignored");
  // Full screen: the frame may go full screen; the fallback message pins it over the viewport and restores everything.
  assert.ok((await fr.getAttribute("allow")).includes("fullscreen") && (await fr.getAttribute("allowfullscreen")) !== null, "iframe allows fullscreen");
  await p.evaluate(() => { document.querySelector(".ph-ind-tour-frame").style.height = "700px"; window.scrollTo(0, 0); });
  await child.evaluate(() => { parent.postMessage({ type: "ph-tour-fullscreen", on: true }, location.origin); });
  await p.waitForFunction(() => getComputedStyle(document.querySelector(".ph-ind-tour-frame")).position === "fixed");
  const pin = await p.evaluate(() => { const f = document.querySelector(".ph-ind-tour-frame"), r = f.getBoundingClientRect(), z = +getComputedStyle(f).zIndex; return { r: [r.left, r.top, r.width, r.height], z, ho: document.documentElement.style.overflow, bo: document.body.style.overflow, hdr: z > 100000 }; });
  assert.deepStrictEqual(pin.r, [0, 0, 1200, 900], "pinned to the whole viewport");
  assert.ok(pin.hdr && pin.ho === "hidden" && pin.bo === "hidden", "above the site header and the page does not scroll: " + JSON.stringify(pin));
  await child.evaluate(() => { parent.postMessage({ type: "ph-tour-height", h: 321 }, location.origin); });
  await p.waitForTimeout(100);
  assert.ok(await fr.evaluate((f) => f.style.position === "fixed" && f.style.height !== "321px"), "height messages are ignored while pinned");
  await p.evaluate(() => window.postMessage({ type: "ph-tour-fullscreen", on: false }, "*"));
  assert.strictEqual(await fr.evaluate((f) => f.style.position), "fixed", "a fullscreen message that is not from the iframe is ignored");
  await child.evaluate(() => { parent.postMessage({ type: "ph-tour-fullscreen", on: false }, location.origin); });
  await p.waitForFunction(() => document.querySelector(".ph-ind-tour-frame").style.position !== "fixed");
  assert.ok(await p.evaluate(() => { const f = document.querySelector(".ph-ind-tour-frame"); return f.style.height === "700px" && f.style.zIndex === "" && document.documentElement.style.overflow === "" && document.body.style.overflow === ""; }), "exit restores the frame and the page scroll");
  await p.close();

  // No Elementor band yet: built in JS right after the calculator's section.
  p = await open(false);
  assert.strictEqual(await p.locator("#calcsec + .ph-ind-tour .ph-ind-tour-mount iframe").count(), 1, "band built after the calculator section");
  assert.strictEqual(await p.locator(".ph-ind-tour .ph-ind-tour-eyebrow").textContent(), "Interactive product tour");
  assert.ok(/end to end/.test(await p.locator(".ph-ind-tour h2").textContent()), "H2");
  assert.strictEqual(await p.locator(".ph-ind-tour + #after").count(), 1, "the band sits between the calculator and the next section");
  await p.close();

  // Pharmacy page: same mount, its own iframe src and fallback copy, after the pharmacy calculator section.
  p = await open(true, "", "pharmacy");
  assert.strictEqual(await p.locator("#band .ph-ind-tour-mount iframe").count(), 1, "pharmacy: iframe mounted in the Elementor band");
  assert.strictEqual(await p.locator("iframe.ph-ind-tour-frame").getAttribute("src"), "/industries/pharmacy/tour/?embed=1", "pharmacy: iframe src");
  assert.strictEqual(await p.evaluate(() => window.PH_TOUR.endpoint), "/wp-json/ph-site/v1/tour-lead", "pharmacy: same lead endpoint");
  await p.close();
  p = await open(false, "", "pharmacy");
  assert.strictEqual(await p.locator("#calcsec + .ph-ind-tour .ph-ind-tour-mount iframe").count(), 1, "pharmacy: band built after the calculator section");
  assert.strictEqual(await p.locator(".ph-ind-tour h2").textContent(), "See Personalisation Hub run a pharmacy campaign, end to end", "pharmacy: fallback heading");
  assert.strictEqual(await p.locator(".ph-ind-tour .ph-ind-tour-p").textContent(), "Pick a demo and watch a campaign go from brief to every pharmacy screen, and on to the pharmacist.", "pharmacy: fallback paragraph");
  assert.strictEqual(await p.locator(".ph-ind-tour .ph-ind-tour-eyebrow").textContent(), "Interactive product tour");
  assert.strictEqual(await p.locator(".ph-ind-tour + #after").count(), 1, "pharmacy: the band sits between the calculator and the next section");
  await p.close();
  p = await open(true, "?ph_test=1", "pharmacy");
  assert.strictEqual(await p.locator("iframe.ph-ind-tour-frame").getAttribute("src"), "/industries/pharmacy/tour/?embed=1&ph_test=1", "pharmacy: ph_test forwarded");
  await p.close();
  // Fuel & convenience: same mount, its own iframe src and copy; the band gets the #ph-tour anchor other tours link to.
  p = await open(true, "?ph_test=1", "convenience");
  assert.strictEqual(await p.locator("iframe.ph-ind-tour-frame").getAttribute("src"), "/industries/convenience/tour/?embed=1&ph_test=1", "convenience: iframe src and ph_test");
  assert.strictEqual(await p.locator("#band").getAttribute("id"), "band");
  await p.close();
  p = await open(false, "", "convenience");
  assert.strictEqual(await p.locator("#calcsec + .ph-ind-tour .ph-ind-tour-mount iframe").count(), 1, "convenience: band built after the calculator section");
  assert.strictEqual(await p.locator(".ph-ind-tour").getAttribute("id"), "ph-tour", "convenience: the band has the ph-tour anchor");
  assert.strictEqual(await p.locator(".ph-ind-tour h2").textContent(), "See Personalisation Hub run a fuel and convenience campaign, end to end", "convenience: fallback heading");
  await p.close();
  p = await open(false, "", "telco");
  assert.strictEqual(await p.locator(".ph-ind-tour h2").textContent(), "See Personalisation Hub run a telco campaign, end to end", "telco fallback heading unchanged");
  await p.close();

  // Test mode is forwarded to the tour.
  p = await open(true, "?ph_test=1");
  assert.strictEqual(await p.locator("iframe.ph-ind-tour-frame").getAttribute("src"), "/industries/telco/tour/?embed=1&ph_test=1", "ph_test forwarded");
  await p.close();

  // The telco page has no standalone "Talk to us" form any more: leads come only from the calculator download or the tour.
  p = await open(true);
  assert.strictEqual(await p.locator(".ph-ind-lead").count(), 0, "no Talk to us form on the telco page");
  assert.strictEqual(await p.locator("form.ph-ind-gate-f").count(), 1, "only the calculator download form remains");
  await p.close();

  // Tour first, then calculator: the tour (same origin iframe) stores ph_lead; the download form needs no re-entry.
  p = await open(true);
  const gf = p.locator("form.ph-ind-gate-f").first();
  assert.ok(await gf.locator("[name=name]").isVisible(), "a fresh visitor sees the download details form");
  await p.frameLocator("iframe.ph-ind-tour-frame").locator("p").waitFor();
  const tourFrame = p.frames().find((x) => x !== p.mainFrame());
  await tourFrame.evaluate(() => localStorage.setItem("ph_lead", JSON.stringify({ name: "Ada Lovelace", company: "Nimbus Mobile", email: "ada@nimbus.example", source: "Interactive product tour", ts: Date.now() })));
  await p.waitForFunction(() => document.querySelector("form.ph-ind-gate-f").classList.contains("ph-ind-gate-known"));
  assert.ok(!(await gf.locator("[name=name]").isVisible()) && !(await gf.locator("[name=consent]").isVisible()), "details and consent are not asked again");
  assert.ok(await gf.locator("button[type=submit]").isEnabled(), "download button is ready");
  let posted = null;
  await p.route("**/wp-json/ph-site/v1/telco-model", (r) => { posted = JSON.parse(r.request().postData()); return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, download: "http://x.test/blocked.xlsx" }) }); });
  await gf.locator("button[type=submit]").click();
  await p.waitForFunction(() => /Thanks/.test(document.querySelector(".ph-ind-gate-m").textContent));
  assert.ok(posted && posted.name === "Ada Lovelace" && posted.company === "Nimbus Mobile" && posted.email === "ada@nimbus.example" && posted.consent === true, "stored details sent: " + JSON.stringify(posted));
  await p.close();

  // A returning visitor (ph_lead already stored) sees the known state straight away; a test-mode page flags the lead as a test.
  p = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await p.addInitScript(() => { localStorage.setItem("ph_lead", JSON.stringify({ name: "Ada Lovelace", company: "Nimbus Mobile", email: "ada@nimbus.example", ts: 1 })); });
  await p.route("**/*", (r) => /wp-json\/ph-site\/v1\/telco-model$/.test(r.request().url()) ? (posted = JSON.parse(r.request().postData()), r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, download: "http://x.test/blocked.xlsx" }) })) : /blocked\.xlsx/.test(r.request().url()) ? r.fulfill({ status: 204, body: "" }) : /tour\//.test(r.request().url()) ? r.fulfill({ contentType: "text/html", body: "<p>tour</p>" }) : r.fulfill({ contentType: "text/html", body: html(true) }));
  await p.goto("http://x.test/industries/telco/?ph_test=1");
  assert.ok(await p.locator("form.ph-ind-gate-known").count() === 1 && await p.locator("button.ph-ind-gate-b").isEnabled(), "returning visitor skips the form");
  await p.locator("button.ph-ind-gate-b").click();
  await p.waitForFunction(() => /Thanks/.test(document.querySelector(".ph-ind-gate-m").textContent));
  assert.strictEqual(posted.test, true, "test mode flagged");
  await p.close();

  // Calculator download success does the same.
  p = await open(true);
  await p.evaluate(() => { window.__ev = []; window.addEventListener("ph:lead", (e) => window.__ev.push(e.detail)); });
  const g = p.locator("form.ph-ind-gate-f").first();
  await g.locator("[name=name]").fill("Grace Hopper");
  await g.locator("[name=company]").fill("Orbit Telecom");
  await g.locator("[name=email]").fill("grace@orbit.example");
  await g.locator("[name=consent]").check();
  await g.locator("button[type=submit]").click();
  await p.waitForFunction(() => window.__ev.length === 1);
  const lead = await p.evaluate(() => JSON.parse(localStorage.getItem("ph_lead")));
  assert.ok(lead.name === "Grace Hopper" && lead.company === "Orbit Telecom" && lead.email === "grace@orbit.example" && lead.source === "Telco business model download", "ph_lead from the calculator download: " + JSON.stringify(lead));
  // A blocked localStorage must not break the form.
  await p.close();
  p = await browser.newPage();
  await p.addInitScript(() => { Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } }); });
  await p.route("**/*", (r) => r.request().url().includes("telco-model") ? r.fulfill({ contentType: "application/json", body: '{"ok":true,"download":"http://x.test/blocked.xlsx"}' }) : /blocked\.xlsx/.test(r.request().url()) ? r.fulfill({ status: 204, body: "" }) : r.fulfill({ contentType: "text/html", body: html(true) }));
  await p.goto("http://x.test/industries/telco/");
  const f2 = p.locator("form.ph-ind-gate-f").first();
  await f2.locator("[name=name]").fill("N"); await f2.locator("[name=company]").fill("C"); await f2.locator("[name=email]").fill("n@c.example"); await f2.locator("[name=consent]").check();
  await f2.locator("button[type=submit]").click();
  await p.waitForFunction(() => /Thanks/.test(document.querySelector(".ph-ind-gate-m").textContent));
  assert.ok(true, "the form still succeeds with storage blocked");
  for (const ind of ["telco", "pharmacy"]) { // the same assertions on both industries
  // The tour page itself: full screen, native and fallback.
  const tourHtml = fs.readFileSync(path.join(dir, "tour", "tour.html"), "utf8");
  const tourPage = async (fallback, vp, body = tourHtml) => {
    const t = await browser.newPage({ viewport: vp });
    await t.route("**/*", (r) => r.request().url().startsWith("http://x.test/") ? r.fulfill({ contentType: "text/html", body }) : r.abort());
    await t.addInitScript((fb) => { localStorage.setItem("ph_lead", JSON.stringify({ name: "Sam", company: "Kestrel", email: "s@k.example" })); if (fb) { Document.prototype.__defineGetter__("fullscreenEnabled", () => false); } }, fallback);
    await t.goto(`http://x.test/industries/${ind}/tour/?embed=1`);
    await t.waitForSelector("#fs", { state: "visible" });
    return t;
  };
  const evs = (t) => t.evaluate(() => window.dataLayer.filter((e) => e.event === "ph_tour" && /^fullscreen/.test(e.action)).map((e) => e.action + ":" + e.industry + ":" + typeof e.flow + ":" + typeof e.step));
  for (const vp of [{ width: 1280, height: 800 }, { width: 360, height: 640 }, { width: 640, height: 360 }]) {
    const t = await tourPage(false, vp);
    assert.strictEqual(await t.getAttribute("#fs", "aria-label"), "Full screen");
    assert.strictEqual(await t.getAttribute("#fs", "aria-pressed"), "false");
    const capInline = await t.evaluate(() => { const g = (q) => parseFloat(getComputedStyle(document.querySelector(q)).fontSize), R = (q) => document.querySelector(q).getBoundingClientRect(), bar = getComputedStyle(document.querySelector(".bar")); return { b: g(".cap b"), s: g(".cap span"), col: bar.columnGap, row: bar.rowGap, sg: R("#capS").top - R("#capT").bottom }; });
    assert.ok(capInline.b === 14.5 && capInline.s === 12 && capInline.col === "24px" && capInline.row === "12px" && capInline.sg >= 2 && capInline.sg <= 5, "caption 14.5px/12px with 24px spacing at " + vp.width + "x" + vp.height + ": " + JSON.stringify(capInline));
    await t.click("#fs");
    await t.waitForFunction(() => document.documentElement.classList.contains("fs"));
    const st = await t.evaluate(() => { const b = box.getBoundingClientRect(), r = document.querySelector(".bar").getBoundingClientRect(); return { native: !!document.fullscreenElement, label: fs.getAttribute("aria-label"), pressed: fs.getAttribute("aria-pressed"), icon: fs.textContent, focus: document.activeElement.id, ratio: b.width / b.height, barIn: r.bottom <= innerHeight + 1 && r.top >= 0, boxIn: b.right <= innerWidth + 1 && b.bottom <= innerHeight, noHScroll: document.documentElement.scrollWidth <= innerWidth, bg: getComputedStyle(document.documentElement).backgroundColor }; });
    assert.ok(st.native && st.label === "Exit full screen" && st.pressed === "true" && st.icon === "fullscreen_exit" && st.focus === "fsclose", "entered, focus on the close button: " + JSON.stringify(st));
    assert.ok(Math.abs(st.ratio - 1280 / 760) < 0.02 && st.barIn && st.boxIn && st.noHScroll && st.bg === "rgb(15, 20, 36)", "stage letterboxed, controls reachable, dark backdrop at " + vp.width + "x" + vp.height + ": " + JSON.stringify(st));
    await t.click("#play"); // controls keep working
    await t.keyboard.press("Escape");
    await t.waitForFunction(() => !document.documentElement.classList.contains("fs"));
    assert.ok(await t.evaluate(() => fs.getAttribute("aria-label") === "Full screen" && fs.getAttribute("aria-pressed") === "false" && document.activeElement.id === "fs"), "Esc exits and focus returns to the button");
    assert.deepStrictEqual(await evs(t), [`fullscreen_enter:${ind}:string:number`, `fullscreen_exit:${ind}:string:number`], "ph_tour events");
    await t.close();
  }
  // Landscape phones (height <= 520): the stage takes at least 60% of the height, one-row bar of at most 52px, chips row of at most 36px, nothing wraps.
  for (const vp of [{ width: 740, height: 360 }, { width: 844, height: 390 }, { width: 667, height: 375 }]) {
    const t = await tourPage(false, vp);
    await t.click("#fs");
    await t.waitForFunction(() => document.documentElement.classList.contains("fs"));
    const m = await t.evaluate(() => { const R = (s) => document.querySelector(s).getBoundingClientRect(), b = R("#box"), bar = R(".bar"), fl = R(".flows"), kids = [...document.querySelector(".bar").children].filter((e) => e.getClientRects().length).map((e) => e.getBoundingClientRect()); return { ratio: b.height / innerHeight, aspect: b.width / b.height, centred: Math.abs((b.left + b.right) / 2 - (R("#wrap").left + R("#wrap").right) / 2) < 2, barH: bar.height, flH: fl.height, oneRow: kids.every((k) => Math.abs(k.top + k.height / 2 - (bar.top + bar.height / 2)) < 20), inView: kids.every((k) => k.left >= 0 && k.right <= innerWidth + 1), capDone: getComputedStyle(document.querySelector(".cap b")).textOverflow, sub: getComputedStyle(document.querySelector(".chip small") || document.body).display, brand: R(".top").height }; });
    assert.ok(m.ratio >= 0.6 && Math.abs(m.aspect - 1280 / 760) < 0.02 && m.centred, "stage >= 60% of the height, aspect kept, centred at " + vp.width + "x" + vp.height + ": " + JSON.stringify(m));
    assert.ok(m.barH <= 52 && m.oneRow && m.inView && m.capDone === "ellipsis", "control bar is one row of at most 52px with every control in view: " + JSON.stringify(m));
    assert.ok(m.flH <= 36 && m.sub !== "block", "flow chips row at most 36px, sub-labels hidden: " + JSON.stringify(m));
    const lc = await t.evaluate(() => { const R = (s) => document.querySelector(s).getBoundingClientRect(), c = R(".cap"), bar = R(".bar"); return { capW: c.width, align: getComputedStyle(document.querySelector(".cap")).textAlign, capR: Math.abs(c.right - bar.right), oneRow: bar.height <= 52, ratio: R("#box").height / innerHeight }; });
    assert.ok(lc.capW >= 240 && lc.align === "right" && lc.capR <= 2 && lc.oneRow && lc.ratio >= 0.6, "landscape caption box >= 240px, right-aligned, bar one row, stage >= 60% at " + vp.width + "x" + vp.height + ": " + JSON.stringify(lc));
    await t.click("#next"); await t.click("#play");
    await t.close();
  }
  // Close button (top right, full screen only): hidden inline, in the corner, clear of the chips, brand field and heading, and it exits.
  for (const vp of [{ width: 1280, height: 800 }, { width: 740, height: 360 }, { width: 360, height: 740 }]) {
    const t = await tourPage(false, vp);
    assert.ok(await t.evaluate(() => getComputedStyle(document.getElementById("fsclose")).display === "none"), "close button hidden outside full screen");
    await t.click("#fs");
    await t.waitForFunction(() => document.documentElement.classList.contains("fs"));
    const c = await t.evaluate(() => {
      const b = document.getElementById("fsclose"), r = b.getBoundingClientRect(), hit = (e) => { let q = e.getBoundingClientRect(); const fl = e.closest(".flows"); if (fl) { const f = fl.getBoundingClientRect(); q = { left: Math.max(q.left, f.left), right: Math.min(q.right, f.right), top: q.top, bottom: q.bottom }; } return !(q.right <= r.left || q.left >= r.right || q.bottom <= r.top || q.top >= r.bottom); };
      const others = [...document.querySelectorAll(".chip, .prefs .field, .top h2, #prev, #next, #play, .bar .ctl, #fs")].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== "hidden");
      return { top: r.top, right: innerWidth - r.right, w: r.width, h: r.height, label: b.getAttribute("aria-label"), icon: b.textContent, focus: document.activeElement.id, overlaps: others.filter(hit).map((e) => e.id || e.className), onTop: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === b || b.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)) };
    });
    assert.ok(c.top >= 0 && c.top <= 16 && c.right >= 0 && c.right <= 16 && c.w === 40 && c.h === 40 && c.label === "Exit full screen" && c.icon === "close" && c.focus === "fsclose" && c.onTop, `close button top right at ${vp.width}x${vp.height}: ${JSON.stringify(c)}`);
    assert.deepStrictEqual(c.overlaps, [], `close button overlaps nothing at ${vp.width}x${vp.height}`);
    await t.keyboard.press("Tab"); await t.keyboard.press("Shift+Tab");
    assert.strictEqual(await t.evaluate(() => document.getElementById("wrap").contains(document.activeElement)), true, "tabbing stays inside the tour");
    await t.click("#fsclose");
    await t.waitForFunction(() => !document.documentElement.classList.contains("fs"));
    assert.ok(await t.evaluate(() => !document.fullscreenElement && document.activeElement.id === "fs"), "the close button exits; focus returns to the bar button");
    assert.deepStrictEqual(await evs(t), [`fullscreen_enter:${ind}:string:number`, `fullscreen_exit:${ind}:string:number`], "same events as the bar button");
    await t.close();
  }
  // Apple touch devices (iPhone, iPad, iPadOS as Macintosh): the in-page fallback, never the native API (its system X sits top left).
  for (const [ua, touch] of [["Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", 5], ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15", 5], ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1", 5]]) {
    const ctx = await browser.newContext({ userAgent: ua, viewport: { width: 1024, height: 768 } });
    const t = await ctx.newPage();
    await t.route("**/*", (r) => r.request().url().startsWith("http://x.test/") ? r.fulfill({ contentType: "text/html", body: tourHtml }) : r.abort());
    await t.addInitScript((n) => { localStorage.setItem("ph_lead", JSON.stringify({ name: "Sam", company: "Kestrel", email: "s@k.example" })); Object.defineProperty(Navigator.prototype, "maxTouchPoints", { get: () => n }); }, touch);
    await t.goto(`http://x.test/industries/${ind}/tour/?embed=1`);
    await t.waitForSelector("#fs", { state: "visible" });
    await t.click("#fs");
    await t.waitForFunction(() => document.documentElement.classList.contains("fs"));
    assert.ok(await t.evaluate(() => !document.fullscreenElement && document.activeElement.id === "fsclose"), "Apple touch UA uses the fallback, not native full screen: " + ua.slice(0, 40));
    await t.click("#fsclose");
    await t.waitForFunction(() => !document.documentElement.classList.contains("fs"));
    await ctx.close();
  }
  // Start card link: enters full screen and starts the tour. The end card carries an Exit full screen action in full-screen mode.
  const t = await tourPage(false, { width: 1280, height: 800 });
  await t.click("#fsstart");
  await t.waitForFunction(() => document.documentElement.classList.contains("fs"));
  await t.waitForFunction(() => window.dataLayer.some((e) => e.action === "step"));
  assert.ok(await t.evaluate(() => getComputedStyle(document.getElementById("fs")).display === "none"), "the bar toggle is hidden in full screen (the top-right x and Esc exit)");
  await t.close();
  assert.ok(/id="fsexit"/.test(tourHtml) && /html\.fs #card \.fsonly\{display:inline-flex\}/.test(tourHtml), "end card has Exit full screen, shown only in full screen");
  // End card: Next is the primary action and focused; no AWS or demo buttons; the last flow wraps; Replay and Exit full screen are secondary.
  const hooked = tourHtml.replace('document.getElementById("prev").onclick', "window.__t = { setFlow, showEnd, startCard, S };\n$&"); // test hook into the page's closure
  assert.ok(hooked !== tourHtml, "test hook applied");
  assert.ok(!/id="aws"|id="demo"|Try Free with AWS<\/a>|Arrange a Demo<\/button>/.test(tourHtml), "end card source has no AWS or demo buttons");
  for (const [vp, fsMode] of [[{ width: 1280, height: 800 }, false], [{ width: 360, height: 640 }, false], [{ width: 1280, height: 800 }, true]]) {
    const et = await tourPage(false, vp, hooked);
    if (fsMode) { await et.click("#fs"); await et.waitForFunction(() => document.documentElement.classList.contains("fs")); }
    for (const [flow, label] of [[0, "Next: Seamless localisation & scheduling"], [1, "Next: Seamless personalisation"], [2, "Next: Automated campaign creative"]]) {
      await et.evaluate((k) => { __t.setFlow(k); __t.showEnd(); }, flow);
      const r = await et.evaluate(() => { const g = (i) => document.getElementById(i), n = g("nextflow"), a = g("again"), c = document.getElementById("card"); return { text: n.textContent.trim(), focus: document.activeElement.id, nBg: getComputedStyle(n).backgroundColor, aBg: getComputedStyle(a).backgroundColor, nH: n.getBoundingClientRect().height, aH: a.getBoundingClientRect().height, aws: !!c.querySelector("#aws,#demo"), btns: [...c.querySelectorAll("button,a")].map((x) => x.id), noH: document.documentElement.scrollWidth <= innerWidth, exitVis: getComputedStyle(g("fsexit")).display !== "none" }; });
      assert.ok(r.text === label && r.focus === "nextflow" && !r.aws && r.nBg !== r.aBg && r.aBg === "rgba(0, 0, 0, 0)" && r.aH < r.nH && r.noH && r.exitVis === fsMode, `end card flow ${flow + 1} at ${vp.width}${fsMode ? " fs" : ""}: ${JSON.stringify(r)}`);
    }
    await et.evaluate(() => { __t.setFlow(2); __t.showEnd(); });
    await et.click("#nextflow");
    assert.ok(await et.evaluate(() => __t.S.flow === 0 && __t.S.step >= 0), "last flow's Next starts flow 1");
    const ne = await et.evaluate(() => window.dataLayer.filter((e) => e.event === "ph_tour" && (e.action === "next" || e.action === "cta")).map((e) => e.action + ":" + e.flow + ":" + e.next_flow + ":" + e.step));
    assert.deepStrictEqual(ne, ["next:Seamless personalisation:Automated campaign creative:" + ne[0].split(":").pop()], "next event carries flow and next flow: " + JSON.stringify(ne));
    await et.evaluate(() => { __t.setFlow(1); __t.showEnd(); });
    await et.click("#again");
    assert.ok(await et.evaluate(() => window.dataLayer.some((e) => e.action === "replay")), "replay event");
    if (fsMode) { await et.evaluate(() => { __t.setFlow(1); __t.showEnd(); }); await et.click("#fsexit"); await et.waitForFunction(() => !document.documentElement.classList.contains("fs")); }
    await et.close();
  }
  // End card layout: Next spans the card, Replay bottom left, Exit full screen bottom right, spaced, nothing overflowing.
  for (const vp of [{ width: 1280, height: 800 }, { width: 740, height: 360 }, { width: 360, height: 740 }]) for (const fsMode of [false, true]) {
    const lt = await tourPage(false, vp, hooked);
    if (fsMode) { await lt.click("#fs"); await lt.waitForFunction(() => document.documentElement.classList.contains("fs")); }
    await lt.evaluate(() => { __t.setFlow(0); __t.showEnd(); });
    await lt.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => 0))));
    await lt.waitForTimeout(100);
    const g = await lt.evaluate(() => { const $ = (i) => document.getElementById(i), r = (e) => e.getBoundingClientRect(), c = r(document.querySelector("#card .in2")), cs = getComputedStyle(document.querySelector("#card .in2")), k = c.width / document.querySelector("#card .in2").offsetWidth, L = c.left + k * parseFloat(cs.paddingLeft), R = c.right - k * parseFloat(cs.paddingRight), n = r($("nextflow")), a = r($("again")), x = $("fsexit"), xr = r(x), vis = getComputedStyle(x).display !== "none", sec = r(document.querySelector("#card .sec")), st = r(document.querySelector("#card .stage, .stagebox") || document.body);
      return { nW: n.width / (R - L), aL: a.left - L, xR: vis ? R - xr.right : 0, vis, gap: (sec.top - n.bottom) / k, aBelow: a.top >= n.bottom, inCard: c.left >= 0 && c.right <= innerWidth + 0.5 && c.top >= -0.5 && c.bottom <= innerHeight + 0.5, ov: document.querySelector("#card .in2").scrollWidth <= document.querySelector("#card .in2").offsetWidth, fits: c.top >= r(document.getElementById("card")).top - 0.5 && c.bottom <= r(document.getElementById("card")).bottom + 0.5 && c.left >= r(document.getElementById("card")).left - 0.5 && c.right <= r(document.getElementById("card")).right + 0.5, cardTop: c.top, cardBottom: c.bottom, vh: innerHeight }; });
    const w = `${vp.width}x${vp.height}${fsMode ? " fs" : ""}: ${JSON.stringify(g)}`;
    assert.ok(g.nW >= 0.95, "Next spans the card " + w);
    assert.ok(Math.abs(g.aL) <= 2, "Replay flush left " + w);
    if (g.vis) assert.ok(Math.abs(g.xR) <= 2, "Exit full screen flush right " + w);
    assert.ok(g.vis === fsMode, "Exit shown only in full screen " + w);
    assert.ok(g.gap >= 20 && g.aBelow, "gap Next to secondary row >= 20px " + w);
    assert.ok(g.fits, "card fits its stage " + w);
    assert.ok(g.ov, "nothing overflows the card " + w);
    await lt.close();
  }
  { // single-flow focus mode: no Next, Replay is the only action and has focus
    const ft = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await ft.route("**/*", (r) => r.request().url().startsWith("http://x.test/") ? r.fulfill({ contentType: "text/html", body: hooked }) : r.abort());
    await ft.addInitScript(() => localStorage.setItem("ph_lead", JSON.stringify({ name: "Sam", company: "Kestrel", email: "s@k.example" })));
    await ft.goto(`http://x.test/industries/${ind}/tour/?embed=1#localisation`);
    await ft.waitForSelector("#fs", { state: "visible" });
    await ft.evaluate(() => { __t.setFlow(1); __t.showEnd(); });
    assert.ok(await ft.evaluate(() => !document.getElementById("nextflow") && document.activeElement.id === "again"), "focus mode: no Next, Replay focused");
    await ft.close();
  }
  // CTAs: larger teal buttons with a white label and icon (Start the tour, Next), inline and in full screen, at three viewports.
  for (const vp of [{ width: 1280, height: 800 }, { width: 740, height: 360 }, { width: 360, height: 740 }]) {
    for (const fsMode of [false, true]) {
      const ct = await tourPage(false, vp, hooked);
      if (fsMode) { await ct.click("#fs"); await ct.waitForFunction(() => document.documentElement.classList.contains("fs")); }
      for (const [id, show] of [["start", () => __t.startCard()], ["nextflow", () => { __t.setFlow(0); __t.showEnd(); }]]) {
        await ct.evaluate(show);
        const m = await ct.evaluate((i) => { const b = document.getElementById(i), cs = getComputedStyle(b), ic = b.querySelector(".ms"), r = b.getBoundingClientRect(), c = document.querySelector("#card .in2").getBoundingClientRect(), st = document.querySelector("#card").getBoundingClientRect(); return { color: cs.color, icon: ic ? getComputedStyle(ic).color : "rgb(255, 255, 255)", iconSize: ic ? getComputedStyle(ic).fontSize : "24px", bg: cs.backgroundColor, fs: parseFloat(cs.fontSize), fw: +cs.fontWeight, h: b.offsetHeight, over: b.scrollWidth > b.clientWidth + 1, fit: c.top >= st.top - 1 && c.bottom <= st.bottom + 1 && c.left >= st.left - 1 && c.right <= st.right + 1, noH: document.documentElement.scrollWidth <= innerWidth }; }, id);
        const min = vp.height <= 520 ? 48 : 56;
        assert.ok(m.color === "rgb(255, 255, 255)" && m.icon === "rgb(255, 255, 255)" && m.iconSize === (id === "start" ? "20px" : "24px") && m.bg === "rgb(22, 155, 194)" && m.fs >= (id === "start" ? 15 : 18.66) && m.fw >= 700 && m.h >= min && !m.over && m.fit && m.noH, `#${id} CTA at ${vp.width}x${vp.height}${fsMode ? " fs" : ""}: ${JSON.stringify(m)}`);
      }
      // start card: "Watch full screen" is a full-size secondary button beside Start (50/50); hidden in full screen
      for (let f = 0; f < 3; f++) {
        await ct.evaluate((n) => { __t.setFlow(n); __t.startCard(); }, f);
        const g = await ct.evaluate(() => { const a = document.getElementById("start"), b = document.getElementById("fsstart"), ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(), row = a.parentElement.getBoundingClientRect(), cs = getComputedStyle(b); return { sA: a.scrollWidth > a.clientWidth + 1, sB: b.scrollWidth > b.clientWidth + 1, hidden: cs.display === "none", wA: ra.width, wB: rb.width, hA: ra.height, hB: rb.height, sameRow: Math.abs(ra.top - rb.top) <= 1, full: ra.width >= row.width - 2, bg: cs.backgroundColor, border: cs.borderTopWidth, bgA: getComputedStyle(a).backgroundColor }; });
        assert.ok(!g.sA && !g.sB && g.bgA === "rgb(22, 155, 194)", `start card labels fit, Start filled ${vp.width}x${vp.height} flow ${f}: ${JSON.stringify(g)}`);
        if (fsMode) assert.ok(g.hidden && g.full, `fs: Start full width, full-screen button hidden ${vp.width}x${vp.height} flow ${f}: ${JSON.stringify(g)}`);
        else if (vp.width >= 740) assert.ok(!g.hidden && Math.abs(g.wA - g.wB) <= 1 && Math.abs(g.hA - g.hB) <= 1 && g.sameRow && g.bg === "rgb(255, 255, 255)" && g.border === "2px", `split buttons ${vp.width}x${vp.height} flow ${f}: ${JSON.stringify(g)}`);
      }
      await ct.close();
    }
  }
  // Framed fallback: parent receives ph-tour-fullscreen on/off and the frame is pinned.
  const fp = await browser.newPage({ viewport: { width: 390, height: 700 } });
  await fp.route("**/*", (r) => { const u = r.request().url(); if (new RegExp("/industries/" + ind + "/tour/").test(u)) return r.fulfill({ contentType: "text/html", body: tourHtml }); if (u.startsWith("http://x.test/")) return r.fulfill({ contentType: "text/html", body: html(true, ind) }); return r.abort(); });
  await fp.addInitScript(() => { localStorage.setItem("ph_lead", JSON.stringify({ name: "Sam", company: "Kestrel", email: "s@k.example" })); Document.prototype.__defineGetter__("fullscreenEnabled", () => false); });
  await fp.goto(`http://x.test/industries/${ind}/`);
  const cf = fp.frames().find((x) => x !== fp.mainFrame());
  await cf.waitForSelector("#fs", { state: "visible" });
  await cf.click("#fs");
  await fp.waitForFunction(() => getComputedStyle(document.querySelector(".ph-ind-tour-frame")).position === "fixed");
  assert.ok(await cf.evaluate(() => document.documentElement.classList.contains("fs") && !document.fullscreenElement && fs.getAttribute("aria-label") === "Exit full screen"), "fallback: tour is in full-screen mode without the API");
  await fp.keyboard.press("Escape");
  await fp.waitForFunction(() => getComputedStyle(document.querySelector(".ph-ind-tour-frame")).position !== "fixed");
  assert.ok(await cf.evaluate(() => !document.documentElement.classList.contains("fs") && document.activeElement.id === "fs"), "fallback: Esc exits, frame restored, focus back on the button");
  await cf.click("#fs"); await fp.waitForFunction(() => getComputedStyle(document.querySelector(".ph-ind-tour-frame")).position === "fixed");
  await cf.click("#fsclose"); await fp.waitForFunction(() => getComputedStyle(document.querySelector(".ph-ind-tour-frame")).position !== "fixed");
  await fp.close();
  // Adding a 2nd/3rd rule must not jump back to the top (Campaign Insights) and back; steps open already on the rules. Desktop and full screen.
  for (const full of [false, true]) {
    const t = await tourPage(false, { width: 1280, height: 800 });
    if (full) { await t.click("#fs"); await t.waitForFunction(() => document.documentElement.classList.contains("fs")); }
    const topOf = () => t.evaluate(() => { const m = /translate3d\(0px,\s*(-?[\d.]+)px/.exec(document.getElementById("sci").style.transform || ""); return m ? -parseFloat(m[1]) : 0; });
    const inView = (sel) => t.evaluate((sel) => { const e = document.querySelector(sel), sc = document.getElementById("sc"); if (!e) return false; const r = e.getBoundingClientRect(), s = sc.getBoundingClientRect(); return r.height > 0 && r.bottom > s.top + 1 && r.top < s.bottom - 1; }, sel);
    for (const [k, first, steps] of [[1, "Target by store segment", ["Suppress when stock runs out", "Respond to who's in store"]], [2, "Target the reason for visit", ["Add first-party and loyalty data"]]]) {
      const where = `${ind} ${full ? "full screen" : "inline"} flow ${k + 1}`;
      await t.click(`.chip[data-k="${k}"]`); await t.waitForTimeout(150);
      if ((await t.getAttribute("#play", "aria-label")) === "Pause") await t.click("#play");
      const titles = await t.evaluate(() => [...document.querySelectorAll("#dots .dot")].map((d) => d.getAttribute("aria-label") || d.title || ""));
      const idx = async (name) => { for (let i = 0; i < 12; i++) { await t.locator("#dots .dot").nth(i).evaluate((e) => e.click()); await t.waitForFunction((i) => document.getElementById("capT").textContent.startsWith(`${i + 1}.`), i); if ((await t.textContent("#capT")).includes(name)) return i; } throw new Error("step not found: " + name); };
      // Opened directly: the first painted frame already shows the rules and the add button.
      for (const name of steps) {
        const at = await idx(name);
        await t.locator("#dots .dot").nth(0).evaluate((e) => e.click()); await t.waitForFunction(() => document.getElementById("capT").textContent.startsWith("1."));
        await t.evaluate(() => { window.__frames = []; const f = () => { const sc = document.getElementById("sc"); if (sc && document.getElementById("addand")) { const e = (id) => { const r = document.getElementById(id)?.getBoundingClientRect(), s = sc.getBoundingClientRect(); return !!r && r.bottom > s.top && r.top < s.bottom; }; window.__frames.push({ rg0: (() => { const g = document.querySelectorAll("#rules .rgroup"); return g.length ? e(g[g.length - 1].id) : false; })(), add: e("addand"), ins: e("insw") }); } window.__raf = requestAnimationFrame(f); }; f(); });
        await t.locator("#dots .dot").nth(at).evaluate((e) => { window.__frames.length = 0; e.click(); });
        await t.waitForTimeout(80);
        const fr = await t.evaluate(() => { cancelAnimationFrame(window.__raf); return window.__frames; });
        assert.ok(fr.length && fr.every((x) => x.rg0 && x.add && !x.ins), `${where} "${name}": the rules and #addand in view and no insights block, on every painted frame: ${JSON.stringify(fr.slice(0, 3))}`);
      }
      // Played through: sample the scroll every 50 ms from the first rule step; it never returns to 0 and Campaign Insights never shows.
      await idx(first);
      if ((await t.getAttribute("#play", "aria-label")) !== "Pause") await t.click("#play");
      await t.waitForFunction(() => document.getElementById("addand") && document.querySelectorAll("#rules .rgroup").length >= 1, null, { timeout: 60000 }).catch(() => {});
      const last = steps[steps.length - 1], seen = [];
      const t0 = Date.now(); let started = false;
      while (Date.now() - t0 < 120000) {
        const cap = await t.textContent("#capT");
        if (steps.some((n) => cap.includes(n))) started = true;
        if (started) {
          const sm = { cap, top: await topOf(), ins: await inView("#insw .insin, #insw > *") };
          seen.push(sm);
          if (cap.includes(last) && (await t.locator("#save").count()) && (await t.getAttribute("#save", "class") || "").includes("dis")) break;
        }
        await t.waitForTimeout(50);
      }
      assert.ok(seen.length > 20, `${where}: sampled the rule steps (${seen.length})`);
      const bad = seen.filter((x) => x.top === 0 || x.ins);
      assert.deepStrictEqual(bad.slice(0, 3), [], `${where}: scroll never returns to 0 and the insights block never shows during the rule steps`);
      if ((await t.getAttribute("#play", "aria-label")) === "Pause") await t.click("#play");
    }
    await t.close();
  }
  // Step caption on the controls row (controls left, caption right-aligned to the stage's right edge), full screen and inline, every step of all three flows.
  const capMetrics = () => { const r = (e) => e.getBoundingClientRect(), b = document.querySelector(".bar"), c = document.querySelector(".cap"), t = document.getElementById("capT"), d = document.getElementById("capS"), st = r(document.getElementById("box")), br = r(b), cr = r(c), ctl = r(document.getElementById("prev")), play = r(document.getElementById("play")), dots = r(document.getElementById("dots")), fsb = document.getElementById("fs"), fr = r(fsb);
    const lh = parseFloat(getComputedStyle(d).lineHeight), dh = d.getBoundingClientRect().height, vis = getComputedStyle(d).display !== "none";
    return { lines: vis ? Math.round(dh / lh) : 0, clipV: [b, c, t, d].some((e) => e.scrollHeight > e.clientHeight + 1), clip: [b, c, t, d].some((e) => e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1), align: getComputedStyle(c).textAlign, capR: Math.abs(cr.right - st.right), barL: Math.abs(br.left - st.left), barR: Math.abs(br.right - st.right), ctlL: Math.abs(ctl.left - st.left), capAboveCtl: cr.bottom <= ctl.top + 1, sameRow: cr.top < play.bottom && cr.bottom > play.top, centred: Math.abs((play.top + play.bottom) / 2 - (cr.top + cr.bottom) / 2) <= 2, oneRow: br.height < 120, stageH: st.height, vh: innerHeight, dotsGap: cr.left - dots.right, dotW: r(document.querySelector("#dots .dot")).width, dotGap: parseFloat(getComputedStyle(document.getElementById("dots")).columnGap), fsHidden: getComputedStyle(fsb).display === "none", fsBeforeCap: fr.right <= cr.left + 1 && fr.left >= dots.right - 1, hdrOneLine: t.getBoundingClientRect().height < parseFloat(getComputedStyle(t).fontSize) * 1.8, over: document.documentElement.scrollWidth > innerWidth + 1 || (document.documentElement.classList.contains("fs") && b.getBoundingClientRect().bottom > innerHeight + 1) }; };
  const eachCaption = async (t, fn) => { const out = [];
    for (let f = 0; f < 3; f++) {
      await t.click(`.chip[data-k="${f}"]`); await t.waitForTimeout(150);
      if ((await t.getAttribute("#play", "aria-label")) === "Pause") await t.click("#play");
      const n = await t.locator("#dots .dot").count();
      for (let i = 0; i < n; i++) { await t.locator("#dots .dot").nth(i).evaluate((e) => e.click()); await t.waitForFunction((i) => document.getElementById("capT").textContent.startsWith(`${i + 1}.`), i); out.push(await fn(f, i)); }
    }
    return out; };
  for (const vp of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
    for (const full of [true, false]) {
      const t = await tourPage(false, vp);
      if (full) { await t.click("#fs"); await t.waitForFunction(() => document.documentElement.classList.contains("fs")); }
      const ms = await eachCaption(t, async () => { await t.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); return t.evaluate(capMetrics); });
      assert.strictEqual(ms.length, 23, "23 captions across the three flows");
      const maxLines = full && vp.width >= 1440 ? 2 : 3;
      ms.forEach((m, k) => {
        const w = `${vp.width}x${vp.height} ${full ? "full screen" : "inline"} caption ${k}: ${JSON.stringify(m)}`;
        assert.ok(m.sameRow && m.centred && !m.capAboveCtl && m.oneRow, "caption on the controls row, controls centred on it: " + w);
        assert.ok(m.lines <= maxLines && !m.clip, `${maxLines} lines at most, nothing clipped: ` + w);
        assert.ok(m.align === "right" && m.capR <= 2, "caption right edge on the stage's right edge: " + w);
        assert.ok(m.ctlL <= 2, "controls start at the stage's left edge: " + w);
        assert.ok(m.hdrOneLine && !m.over, "heading on one line, nothing overflowing: " + w);
        assert.ok(m.dotsGap >= 24, "at least 24px between the dots and the caption: " + w);
        if (full) assert.ok(m.fsHidden && m.dotW === 10 && m.dotGap === 4 && m.barL <= 2 && m.barR <= 2, "full screen: bar toggle hidden, compact dots, bar on the stage edges: " + w);
        else assert.ok(!m.fsHidden && m.fsBeforeCap && m.dotW === 26, "inline: full-screen button after the dots and before the caption, dots unchanged: " + w);
      });
      await t.close();
    }
  }
  { const t = await tourPage(false, { width: 360, height: 740 });
    await t.click("#fs"); await t.waitForFunction(() => document.documentElement.classList.contains("fs"));
    const ms = await eachCaption(t, async () => { await t.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); return t.evaluate(capMetrics); });
    ms.forEach((m, k) => assert.ok(m.capAboveCtl && !m.clip && !m.over && m.align === "right", `360x740 caption ${k}: ${JSON.stringify(m)}`));
    await t.click("#fsclose"); await t.waitForFunction(() => !document.documentElement.classList.contains("fs")); await t.close(); }
  { const t = await tourPage(false, { width: 740, height: 360 });
    await t.click("#fs"); await t.waitForFunction(() => document.documentElement.classList.contains("fs"));
    const ms = await eachCaption(t, async () => { await t.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); return t.evaluate(capMetrics); });
    ms.forEach((m, k) => assert.ok(m.oneRow && !m.clipV && !m.over && m.stageH >= m.vh * 0.6 && m.align === "right" && m.capR <= m.barR + 2, `740x360 caption ${k}: ${JSON.stringify(m)}`));
    await t.keyboard.press("Escape"); await t.waitForFunction(() => !document.documentElement.classList.contains("fs")); await t.close(); }
  }
  // One shared source: S.ind follows the path; the pharmacy tour is Harbourside Pharmacy with the sun care campaign and none of telco's words.
  { const sourceTour = fs.readFileSync(path.join(dir, "tour", "tour.html"), "utf8");
    const fast = sourceTour.replace("const k = reduce ? .35 : 1;", "const k = .02;"); // test-only: play every step quickly
    assert.ok(fast !== sourceTour, "speed hook applied");
    assert.ok(!fs.existsSync(path.join(dir, "tour", "telco.html")), "one tour source: tour/tour.html only");
    const hookedInd = sourceTour.replace('document.getElementById("prev").onclick', "window.__t = { setFlow, showEnd, S, D, L, P3 };\n$&");
    const lead = () => localStorage.setItem("ph_lead", JSON.stringify({ name: "Sam", company: "", email: "s@k.example", source: "Telco business model download" }));
    const walk = async (ind, body, company = "") => {
      const t = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
      const errs = []; t.on("pageerror", (e) => errs.push(e.message));
      await t.route("**/*", (r) => r.request().url().startsWith("http://x.test/") ? r.fulfill({ contentType: "text/html", body }) : r.abort());
      await t.addInitScript((c) => localStorage.setItem("ph_lead", JSON.stringify({ name: "Sam", company: c, email: "s@k.example", source: "Telco business model download" })), company); // a lead from the telco calculator download unlocks the pharmacy tour (same ph_lead key)
      await t.goto(`http://x.test/industries/${ind}/tour/?embed=1`);
      await t.waitForSelector("#fs", { state: "visible" });
      assert.strictEqual(await t.locator("#gate").isHidden(), true, `${ind}: a ph_lead from telco unlocks the tour (no gate)`);
      const seen = new Set();
      for (let f = 0; f < 3; f++) {
        await t.click(`.chip[data-k="${f}"]`);
        await t.click("#play");
        const t0 = Date.now();
        for (;;) {
          const s = await t.evaluate(() => [document.getElementById("stage").innerText, document.getElementById("capT").textContent, document.getElementById("capS").textContent, document.getElementById("card").innerText, [...document.querySelectorAll("#stage svg text")].map((x) => x.textContent).join(" ")].join("\n"));
          seen.add(s);
          if (await t.evaluate(() => !document.getElementById("card").hidden && /complete/i.test(document.getElementById("card").innerText))) break;
          assert.ok(Date.now() - t0 < 150000, `${ind}: flow ${f + 1} finished`);
          await t.waitForTimeout(120);
        }
      }
      return { t, text: [...seen].join("\n"), errs };
    };
    // Path decides the industry.
    for (const [ind, want] of [["telco", "telco"], ["pharmacy", "pharmacy"]]) {
      const u = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await u.route("**/*", (r) => r.request().url().startsWith("http://x.test/") ? r.fulfill({ contentType: "text/html", body: hookedInd }) : r.abort());
      await u.addInitScript(lead);
      await u.goto(`http://x.test/industries/${ind}/tour?embed=1`);
      await u.waitForSelector("#fs", { state: "visible" });
      assert.strictEqual(await u.evaluate(() => window.__t.S.ind), want, `S.ind is ${want} on /industries/${ind}/tour`);
      assert.strictEqual(await u.evaluate(() => document.getElementById("co").value), want === "telco" ? "Nimbus Mobile" : "Harbourside Pharmacy", `${ind}: brand`);
      if (want === "pharmacy") assert.ok(/Pharmacy/.test(await u.title()), "pharmacy document title: " + await u.title());
      await u.close();
    }
    const other = await browser.newPage();
    await other.route("**/*", (r) => r.request().url().startsWith("http://x.test/") ? r.fulfill({ contentType: "text/html", body: hookedInd }) : r.abort());
    await other.addInitScript(lead);
    await other.goto("http://x.test/anything/else/?embed=1");
    await other.waitForSelector("#fs", { state: "visible" });
    assert.strictEqual(await other.evaluate(() => window.__t.S.ind), "telco", "any other path is telco");
    await other.close();
    // The pharmacy walk-through: content and words.
    const ph = await walk("pharmacy", fast);
    assert.deepStrictEqual(ph.errs, [], "no page errors");
    for (const need of ["Harbourside Pharmacy", "Sun Care | 2 for $30 SPF 50+", "SUN-SMART SUMMER", "2 FOR $30", "Gold Members | Extra 20% off sun care", "Coastal", "Sunscreen out of stock", "After-sun out of stock", "Skin & sun advice", "Summer sun care", "Sun care bay display", "Visitor Details", "Loyalty Gold"]) assert.ok(ph.text.includes(need), "pharmacy tour shows: " + need);
    const banned = ph.text.match(/iphone|trade-?in|handset|\bplans?\b|phone wall|nimbus|prescription collection|prescriptions?\b|vaccin|\bflu\b|\bage\b|\b68\b|scripts ready/gi);
    assert.ok(!banned || banned.every((w) => /prescription collection/i.test(w)), "no telco or medical words in the pharmacy tour: " + JSON.stringify(banned));
    const vd = ph.text.slice(ph.text.indexOf("Visitor Details"));
    assert.ok(!/prescription|vaccin|\bage\b|medical|diagnos/i.test(vd), "Visitor Details shows visit context only");
    await ph.t.close();
    // Telco unchanged.
    const tl = await walk("telco", fast);
    assert.deepStrictEqual(tl.errs, [], "telco: no page errors");
    for (const need of ["Nimbus Mobile", "iPhone Trade-in | Up to $800 off", "Gold Members | Extra $200 iPhone trade-in"]) assert.ok(tl.text.includes(need), "telco tour shows: " + need);
    assert.ok(!/Harbourside|sun care|SPF/i.test(tl.text), "no pharmacy content in the telco tour");
    await tl.t.close();
    // Flow 2 follows the visitor's company: search text, results, store codes and Website (no demo brand anywhere).
    for (const [ind, co, slug, ini, demo] of [["pharmacy", "Bayside Test Pharmacy", "baysidetestpharmacy.com", "BT", /Harbourside/i], ["telco", "Acme Test Mobile", "acmetestmobile.com", "AT", /Nimbus/i]]) {
      const w = await walk(ind, fast, co);
      assert.deepStrictEqual(w.errs, [], `${ind}: no page errors`);
      assert.ok(!demo.test(w.text), `${ind}: no demo brand once a company is set`);
      assert.ok(w.text.includes(slug), `${ind}: Website uses ${slug}`);
      assert.ok(new RegExp(`${ini}-011`).test(w.text) && !/\b(HP|NM)-\d{3}/.test(w.text), `${ind}: store codes use ${ini}`);
      await w.t.close();
      const f2 = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
      await f2.route("**/*", (r) => r.request().url().startsWith("http://x.test/") ? r.fulfill({ contentType: "text/html", body: fast.replace('document.getElementById("prev").onclick', "window.__t = { L, B, S, addStoresHTML, refreshAdd };\n$&") }) : r.abort());
      await f2.addInitScript((c) => localStorage.setItem("ph_lead", JSON.stringify({ name: "Sam", company: c, email: "s@k.example" })), co);
      await f2.goto(`http://x.test/industries/${ind}/tour/?embed=1`);
      await f2.waitForSelector("#fs", { state: "visible" });
      const r = await f2.evaluate(() => { const d = document.createElement("div"); d.innerHTML = window.__t.addStoresHTML({ q: window.__t.B(), results: true }); return { s: d.querySelector("#srch").textContent, rows: [...d.querySelectorAll(".rr b")].map((x) => x.textContent) }; });
      assert.strictEqual(r.s, co, `${ind}: search box is the company`);
      assert.ok(r.rows.length && r.rows.every((x) => x.startsWith(co)), `${ind}: every result starts with the company`);
      await f2.close();
    }
    // Prototype mode (no company): the default brand, prefix and Website stay consistent.
    { const w = await walk("pharmacy", fast); assert.ok(w.text.includes("HP-011") && w.text.includes("harboursidepharmacy.com/bayview"), "pharmacy default codes and website"); await w.t.close(); }
    // The lead body carries the industry from the path.
    for (const [ind, want] of [["telco", "telco"], ["pharmacy", "pharmacy"]]) {
      const g = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      let body = null;
      await g.route("**/*", (r) => { const u = r.request().url(); if (/tour-lead$/.test(u)) { body = JSON.parse(r.request().postData()); return r.fulfill({ contentType: "application/json", body: '{"ok":true}' }); } return u.startsWith("http://x.test/") ? r.fulfill({ contentType: "text/html", body: sourceTour }) : r.abort(); });
      await g.addInitScript(() => { window.PH_TOUR = { endpoint: "/wp-json/ph-site/v1/tour-lead", nonce: "" }; });
      await g.goto(`http://x.test/industries/${ind}/tour/?embed=1&ph_test=1`);
      await g.waitForSelector(".g-flow");
      await g.locator(".g-flow").first().click();
      await g.fill("input[name=name]", "Ada Lovelace"); await g.fill("input[name=company]", "Orbit Co"); await g.fill("input[name=email]", "ada@orbit.example"); await g.check("input[name=consent]");
      await g.click("#gsub");
      await g.waitForFunction(() => document.getElementById("gate").hidden);
      assert.ok(body && body.industry === want && body.page === `/industries/${ind}/tour/` && body.test === true, `${ind} lead body: ` + JSON.stringify(body));
      const ev = await g.evaluate(() => window.dataLayer.filter((e) => e.event === "ph_lead_captured" || (e.event === "ph_tour" && e.action === "unlock")).map((e) => e.event + ":" + e.industry));
      assert.deepStrictEqual(ev, [`ph_lead_captured:${want}`, `ph_tour:${want}`], `${ind} dataLayer industry: ` + JSON.stringify(ev));
      assert.ok(await g.evaluate(() => JSON.parse(localStorage.getItem("ph_lead")).email === "ada@orbit.example"), "ph_lead stored for both tours");
      await g.close();
    }
  }

  // Retail media: same shared tour, its own three flows (retailer setup 8 steps, advertiser creates by talking 10, shopper journey and outcome 5), screenshots and voiceover from the same-origin asset route.
  { const sourceTour = fs.readFileSync(path.join(dir, "tour", "tour.html"), "utf8");
    const fast = sourceTour.replace("const k = reduce ? .35 : 1;", "const k = .02;");
    const vscript = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(here, "..", "tools", "retail-media-tour", "voiceover-script.json"), "utf8")).steps.map((s) => [s.id, s.lines.map((l) => l.text)]));
    // Screenshots: the real files when TOUR_ASSETS_DIR holds a checkout of tag tour-assets-retail-media-v1; otherwise a small valid JPEG (the tests check that every image loads, not what it shows).
    const assetsDir = process.env.TOUR_ASSETS_DIR || "";
    const probe = await browser.newPage(); const tinyJpg = await probe.screenshot({ type: "jpeg", clip: { x: 0, y: 0, width: 8, height: 8 } }); await probe.close();
    const serveAsset = (r) => { const m = r.request().url().match(/\/assets\/v1\/(img|vo)\/([\w.-]+)$/); const f = m && assetsDir && path.join(assetsDir, m[1], m[2]); if (m && m[1] === "img") return r.fulfill({ contentType: "image/jpeg", body: f && fs.existsSync(f) ? fs.readFileSync(f) : tinyJpg }); return r.fulfill({ status: 404, body: "" }); };
    // Band on the Retail Media industry page: the Elementor mount, or built right after the calculator when it is absent.
    const rmPage = (withBand) => `<!doctype html><html><head><style>${css}</style></head><body><main><section class="ph-ind-sec" id="calcsec"><div class="ph-ind-calc"><div class="ph-ind-cin"><p class="ph-ind-label-gap">a</p><p class="ph-ind-label-gap">b</p>${row.repeat(nOf("retail-media"))}</div><div class="ph-ind-cout"><p class="ph-ind-ctot-l">Total</p><p class="ph-ind-ctot-v">0</p><div class="ph-ind-crow">r</div></div></div></section>${withBand ? '<section class="ph-ind-sec ph-ind-tour" id="band"><h2>Server heading</h2><div class="ph-ind-tour-mount"></div></section>' : ""}<section class="ph-ind-sec" id="s2">two</section></main>
<script>window.PH_IND_PAGE="retail-media"; window.Calendly={initPopupWidget:function(){}};</script><script>${site}</script><script>${enhance}</script></body></html>`;
    for (const withBand of [true, false]) {
      const p = await browser.newPage({ viewport: { width: 1200, height: 900 } });
      await p.route("**/*", (r) => /\/industries\/retail-media\/tour\//.test(r.request().url()) ? r.fulfill({ contentType: "text/html", body: "<!doctype html><title>t</title><p>tour</p>" }) : r.fulfill({ contentType: "text/html", body: rmPage(withBand) }));
      await p.goto("http://x.test/industries/retail-media/?ph_test=1");
      assert.strictEqual(await p.locator(".ph-ind-tour-mount iframe").count(), 1, `retail-media (band ${withBand}): iframe mounted`);
      assert.strictEqual(await p.locator("iframe.ph-ind-tour-frame").getAttribute("src"), "/industries/retail-media/tour/?embed=1&ph_test=1", "retail-media: iframe src with ph_test");
      if (!withBand) {
        assert.strictEqual(await p.locator("#calcsec + .ph-ind-tour + #s2").count(), 1, "built band is right after the calculator");
        assert.strictEqual(await p.locator(".ph-ind-tour-eyebrow").textContent(), "Interactive product tour", "retail-media fallback eyebrow");
        assert.strictEqual(await p.locator(".ph-ind-tour h2").textContent(), "See a convenience retailer run its own retail media network, end to end", "retail-media fallback heading");
        assert.strictEqual(await p.locator(".ph-ind-tour-p").textContent(), "Pick a demo: a retailer selling its screens, a brand creating a campaign by talking, and one shopper from forecourt to checkout.", "retail-media fallback intro");
      }
      await p.close();
    }
    // Gate: retail media copy, branded, work email only.
    { const g = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      let body = null;
      await g.route("**/*", (r) => { const u = r.request().url(); if (/tour-lead$/.test(u)) { body = JSON.parse(r.request().postData()); return r.fulfill({ contentType: "application/json", body: '{"ok":true}' }); } if (/\/assets\/v1\//.test(u)) return serveAsset(r); return u.startsWith("http://x.test/") ? r.fulfill({ contentType: "text/html", body: sourceTour }) : r.abort(); });
      await g.addInitScript(() => { window.PH_TOUR = { endpoint: "/wp-json/ph-site/v1/tour-lead", nonce: "" }; });
      await g.goto("http://x.test/industries/retail-media/tour/?embed=1&ph_test=1");
      await g.waitForSelector(".g-flow");
      assert.deepStrictEqual(await g.locator(".g-flow b").allTextContents(), ["Retailer setup", "Advertiser creates by talking", "Shopper journey & outcome"], "retail media gate demos");
      assert.ok(/convenience retailer sell its screens to a brand/i.test(await g.locator(".g-panel h3").textContent()), "gate headline is retail media copy");
      const gtext = await g.evaluate(() => document.body.innerText);
      assert.ok(!/telco|pharmac|prescription/i.test(gtext), "no other industry's words on the gate");
      await g.locator(".g-flow").nth(1).click();
      await g.fill("input[name=name]", "Ada Lovelace"); await g.fill("input[name=company]", "Orbit Co"); await g.fill("input[name=email]", "ada@gmail.com"); await g.check("input[name=consent]");
      await g.locator("input[name=email]").blur();
      assert.strictEqual(await g.textContent("#gerr"), "Please use your work email.", "free mail refused");
      assert.strictEqual(await g.locator("#gsub.ok").count(), 0, "free mail keeps the button off");
      await g.fill("input[name=email]", "ada@orbit.example"); await g.click("#gsub");
      await g.waitForFunction(() => document.getElementById("gate").hidden);
      assert.ok(await g.evaluate(() => !!document.getElementById("vohint") && document.getElementById("vo").classList.contains("pulse")), "the gate's autostart shows the \"Enable sound\" hint");
      assert.ok(body && body.industry === "retail-media" && body.flow === "Advertiser creates by talking" && body.page === "/industries/retail-media/tour/" && body.test === true, "retail-media lead body: " + JSON.stringify(body));
      assert.strictEqual(await g.evaluate(() => JSON.parse(localStorage.getItem("ph_lead")).company), "Orbit Co", "the lead is stored for the next visit");
      await g.close(); }
    // Walk every step of the three flows with a stored lead: the visitor's company is the retailer.
    const hooked = fast.replace('document.getElementById("prev").onclick', "window.__t = { S, D };\n$&");
    const t = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    const errs = []; t.on("pageerror", (e) => errs.push(e.message));
    const reqs = []; t.on("request", (q) => reqs.push(q.url()));
    await t.route("**/*", (r) => { const u = r.request().url(); if (/\/assets\/v1\//.test(u)) return serveAsset(r); return u.startsWith("http://x.test/") ? r.fulfill({ contentType: "text/html", body: hooked }) : r.abort(); });
    await t.addInitScript(() => { localStorage.setItem("ph_lead", JSON.stringify({ name: "Sam", company: "Bayside Test Stores", email: "s@k.example", source: "Telco business model download" })); window.__plays = 0; window.__steps = [[], [], []]; setInterval(() => { const i = [...document.querySelectorAll("#dots .dot")].findIndex((d) => d.getAttribute("aria-current") === "true"), f = window.__t && window.__t.S.flow; if (i >= 0 && window.__steps[f] && !window.__steps[f].includes(i)) window.__steps[f].push(i); }, 5); const op = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { window.__plays++; return op.call(this); }; });
    // No white or jittery screens (10 Nov 2026): sampled on every animation frame through all three flows. On a screen change #screen is never empty,
    // a .rm-shot img is never incomplete, and an img is never below full opacity unless a .rm-hold above it is at full opacity; and nothing held loses opacity.
    await t.addInitScript(() => {
      window.__frameFails = []; window.__frames = 0; window.__heldSeen = 0;
      const last = new WeakMap(); let had = false;
      const op = (e) => parseFloat(getComputedStyle(e).opacity);
      const tick = () => {
        const sc = document.getElementById("screen");
        if (sc) {
          window.__frames++;
          const hold = document.querySelector(".rm-hold"), holdOp = hold ? op(hold) : 0;
          if (hold) window.__heldSeen++;
          const kids = sc.children.length, imgs = [...sc.querySelectorAll(".rm-shot img")];
          if (!kids && had && !hold) window.__frameFails.push("empty #screen");
          if (!kids && !hold) had = false;
          if (kids) {
            for (const im of imgs) {
              if (!im.parentNode.classList.contains("swap")) continue; // the first screen of a flow fades in on purpose
              if (!im.complete || !im.naturalWidth) window.__frameFails.push("incomplete img");
              else if (had && op(im) < 1 && holdOp < 1) window.__frameFails.push("img at opacity " + op(im) + " with no opaque hold");
            }
            if (imgs.length) had = true;
          }
          if (hold) for (const e of hold.querySelectorAll("*")) { const b = last.get(e); if (b !== undefined && op(e) < b - 0.001) window.__frameFails.push("held element lost opacity " + b + " -> " + op(e)); }
          for (const e of sc.querySelectorAll("*")) last.set(e, op(e));
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await t.goto("http://x.test/industries/retail-media/tour/?embed=1");
    await t.waitForSelector("#fs", { state: "visible" });
    assert.strictEqual(await t.evaluate(() => window.__t.S.ind), "retail-media", "S.ind follows the path");
    assert.ok(/Retail Media/.test(await t.title()), "document title: " + await t.title());
    assert.deepStrictEqual(await t.locator(".chip").evaluateAll((c) => c.map((x) => x.childNodes[1].textContent)), ["Retailer setup", "Advertiser creates by talking", "Shopper journey & outcome"], "three flows");
    assert.strictEqual(await t.getAttribute("#vo", "aria-pressed"), "false", "voiceover is off by default");
    assert.strictEqual(await t.evaluate(() => localStorage.getItem("ph_tour_voiceover")), null, "nothing saved until the visitor chooses");
    const seen = new Set(), blanks = [], broken = [], navs = [], badCaps = [], overlays = new Set(), stepsSeen = [new Set(), new Set(), new Set()];
    const stepOf = () => t.evaluate(() => [...document.querySelectorAll("#dots .dot")].findIndex((d) => d.getAttribute("aria-current") === "true"));
    for (let f = 0; f < 3; f++) {
      await t.click(`.chip[data-k="${f}"]`); await t.click("#play"); const t0 = Date.now();
      for (;;) {
        const a = await stepOf();
        const s = await t.evaluate(() => [document.getElementById("stage").innerText, document.getElementById("capT").textContent, document.getElementById("capS").textContent, document.getElementById("card").innerText, [...document.querySelectorAll("#stage svg text")].map((x) => x.textContent).join(" "), [...document.querySelectorAll("#stage [data-tip],#stage [aria-label],#stage .tip")].map((x) => x.getAttribute("data-tip") || x.getAttribute("aria-label") || x.textContent).join(" ")].join("\n"));
        const capS = await t.textContent("#capS"), b = await stepOf();
        seen.add(s); if (a >= 0) stepsSeen[f].add(a);
        if (a >= 0 && a === b && capS.trim() && !(vscript[`f${f + 1}-${String(a + 1).padStart(2, "0")}`] || []).includes(capS)) badCaps.push(`f${f + 1}-${a + 1}: ${capS}`);
        // screens never blank: a screenshot that loaded, or an HTML screen with content
        const st = await t.evaluate(() => { const imgs = [...document.querySelectorAll("#stage img")]; return { imgs: imgs.length, bad: imgs.filter((i) => !i.complete || !i.naturalWidth).length, text: document.getElementById("stage").innerText.trim().length, svg: document.querySelectorAll("#stage svg").length, nav: [...document.querySelectorAll("#stage .side .nav:not(.bottom) > div")].map((x) => x.textContent.trim().replace(/^[a-z_]+(?=[A-Z])/, "")), bottom: document.querySelectorAll("#stage .side .nav.bottom > div").length, ov: [...document.querySelectorAll("#stage .rm-ov")].map((x) => x.textContent) }; });
        if (st.bad) { await t.waitForTimeout(400); const again = await t.evaluate(() => [...document.querySelectorAll("#stage img")].filter((i) => !i.complete || !i.naturalWidth).length); if (again) broken.push(`flow ${f + 1} step ${a + 1}`); }
        if (!st.imgs && st.text < 20 && !st.svg) blanks.push(`flow ${f + 1} step ${a + 1}`);
        if (f === 1 && st.nav.length) navs.push({ nav: st.nav, bottom: st.bottom });
        st.ov.forEach((x) => overlays.add(x));
        if (await t.evaluate(() => !document.getElementById("card").hidden && /complete/i.test(document.getElementById("card").innerText))) break;
        assert.ok(Date.now() - t0 < 120000, `retail media flow ${f + 1} finished`);
        await t.waitForTimeout(100);
      }
    }
    { const ff = await t.evaluate(() => ({ fails: [...new Set(window.__frameFails)], frames: window.__frames, held: window.__heldSeen }));
      assert.ok(ff.frames > 50, "the frame sampler ran: " + ff.frames);
      assert.ok(ff.held > 0, "screen changes were held and crossfaded (frames with a .rm-hold: " + ff.held + ")");
      assert.deepStrictEqual(ff.fails, [], "no white, empty or half-faded frame on any screen change: " + JSON.stringify(ff.fails.slice(0, 5))); }
    assert.deepStrictEqual(errs, [], "no page errors");
    assert.deepStrictEqual(blanks, [], "no screen is ever blank");
    assert.deepStrictEqual(broken, [], "no broken image");
    assert.deepStrictEqual(badCaps, [], "every caption is a line of the script");
    const stepsRec = await t.evaluate(() => window.__steps.map((x) => x.length));
    assert.deepStrictEqual(stepsRec, [8, 10, 5], "all steps of the three flows played (8, 10 and 5): " + JSON.stringify(stepsRec));
    assert.ok(navs.length > 0 && navs.every((n) => JSON.stringify(n.nav) === JSON.stringify(["Campaigns", "Insights / Analytics"]) && n.bottom === 0), "the advertiser's left nav shows only Campaigns and Insights / Analytics: " + JSON.stringify(navs[0]));
    assert.strictEqual(await t.evaluate(() => window.__plays), 0, "no audio is played while the voiceover is off");
    const thirdParty = reqs.filter((u) => !u.startsWith("http://x.test/") && !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u)); // the tour's shared fonts are unchanged
    assert.deepStrictEqual(thirdParty, [], "no third-party request for screenshots or audio");
    assert.ok(reqs.some((u) => /\/industries\/retail-media\/tour\/assets\/v1\/img\/[\w.-]+\.jpg$/.test(u)), "screenshots load from the same-origin asset route");
    assert.ok(!reqs.some((u) => /\/assets\/v1\/vo\//.test(u)), "no voiceover is fetched while it is off");
    const text = [...seen].join("\n");
    for (const need of ["Frostline Cold Drinks", "Bayside Test Stores", "Forecourt", "Shop front", "Emma"]) assert.ok(text.includes(need), "retail media content shown: " + need);
    assert.ok(!/Larkspur/.test(text), "the visitor's company replaces Larkspur Convenience in every HTML screen");
    assert.ok([...overlays].some((x) => /Bayside/.test(x)), "the visitor's company is redrawn over the screenshots (logo and header badge): " + JSON.stringify([...overlays].slice(0, 3)));
    // Rules of the brief: no other industry's words, no real brands, no US spelling, no internal project names.
    const banned = text.match(/telco|pharmac|prescription|\bSIM\b|handset|Roadside|Google|Trade Desk|Amazon|Shell\b|BP\b|Coca|Pepsi|Red Bull|Monster|Walmart|Tesco|7-Eleven|Circle K|Nimbus|Harbourside|personalization|Display Types & DSP|DSP Integration|Visitor Profile|Elementor|Angie|rob_ph|ph-mcp|backlog/gi);
    assert.ok(!banned, "no other industry, real brand, US spelling or internal name: " + JSON.stringify(banned));
    // Voiceover toggle: saved, restored after a reload; still nothing plays until the visitor starts the tour.
    await t.click("#vo");
    assert.strictEqual(await t.evaluate(() => localStorage.getItem("ph_tour_voiceover")), "on", "the choice is saved");
    await t.reload(); await t.waitForSelector("#fs", { state: "visible" });
    assert.strictEqual(await t.getAttribute("#vo", "aria-pressed"), "true", "the choice is restored after a reload");
    assert.strictEqual(await t.evaluate(() => window.__plays), 0, "nothing plays before the visitor starts");
    await t.click("#vo");
    assert.strictEqual(await t.evaluate(() => localStorage.getItem("ph_tour_voiceover")), "off", "off is saved");
    await t.close();
    // 390px wide: the stage scales and the page does not scroll sideways, on a screenshot step and on the shopper scene.
    { const m = await browser.newPage({ viewport: { width: 390, height: 800 }, reducedMotion: "reduce" });
      await m.route("**/*", (r) => { const u = r.request().url(); if (/\/assets\/v1\//.test(u)) return serveAsset(r); return u.startsWith("http://x.test/") ? r.fulfill({ contentType: "text/html", body: fast }) : r.abort(); });
      await m.addInitScript(() => localStorage.setItem("ph_lead", JSON.stringify({ name: "Sam", company: "Bayside Test Stores", email: "s@k.example" })));
      await m.goto("http://x.test/industries/retail-media/tour/?embed=1"); await m.waitForSelector("#fs", { state: "visible" });
      for (const f of [0, 2]) {
        await m.click(`.chip[data-k="${f}"]`); await m.click("#play"); await m.waitForTimeout(1500);
        const g = await m.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
        assert.ok(g.sw <= g.cw, `flow ${f + 1}: no sideways scroll at 390px: ${g.sw} > ${g.cw}`);
      }
      await m.close(); }
    // Steady caption bar (10 Nov 2026): whichever of the 77 voiceover lines is showing, the controls (#dots) and the fine print never move, at any frame width.
    { const lines = Object.values(vscript).flat(); assert.strictEqual(lines.length, 77, "77 voiceover lines");
      const c = await browser.newPage({ viewport: { width: 1400, height: 900 }, reducedMotion: "reduce" });
      await c.route("**/*", (r) => { const u = r.request().url(); if (/\/assets\/v1\//.test(u)) return serveAsset(r); return u.startsWith("http://x.test/") ? r.fulfill({ contentType: "text/html", body: fast }) : r.abort(); });
      await c.addInitScript(() => localStorage.setItem("ph_lead", JSON.stringify({ name: "Sam", company: "Bayside Test Stores", email: "s@k.example" })));
      await c.goto("http://x.test/industries/retail-media/tour/?embed=1"); await c.waitForSelector("#fs", { state: "visible" });
      for (const w of [420, 768, 900, 1040, 1160, 1400]) {
        await c.setViewportSize({ width: w, height: 900 }); await c.waitForTimeout(400); // let the stage rescale before measuring
        const tops = await c.evaluate((lines) => { const cap = document.getElementById("capS"), seen = { dots: new Set(), fine: new Set(), play: new Set() }; for (const l of lines) { cap.textContent = l; seen.dots.add(Math.round(document.getElementById("dots").getBoundingClientRect().top * 10)); seen.fine.add(Math.round(document.querySelector(".fine").getBoundingClientRect().top * 10)); seen.play.add(Math.round(document.getElementById("play").getBoundingClientRect().top * 10)); } return { dots: seen.dots.size, fine: seen.fine.size, play: seen.play.size }; }, lines);
        assert.deepStrictEqual(tops, { dots: 1, fine: 1, play: 1 }, `caption lines never move the controls or the fine print at ${w}px: ` + JSON.stringify(tops));
      }
      await c.close(); }
    // "Enable sound" hint (11 Nov 2026): a flow started with the voiceover off shows a bubble above the speaker for 3 s while the button pulses,
    // then starts; clicking the bubble or the speaker turns sound on and starts at once; Prev/Next or a flow switch cancels it; never a double start.
    { const hk = fast.replace("async function go(i) {", "async function go(i) { (window.__go = window.__go || []).push(i);").replace('document.getElementById("prev").onclick', "window.__t = { S, setFlow, showEnd, startCard };\n$&");
      assert.ok(hk.includes("window.__go") && hk.includes("window.__t = { S, setFlow"), "hint test hooks applied");
      const open = async (sound) => {
        const h = await browser.newPage({ viewport: { width: 1160, height: 900 }, reducedMotion: "reduce" });
        h.__errs = []; h.on("pageerror", (e) => h.__errs.push(e.message));
        await h.route("**/*", (r) => { const u = r.request().url(); if (/\/assets\/v1\//.test(u)) return serveAsset(r); return u.startsWith("http://x.test/") ? r.fulfill({ contentType: "text/html", body: hk }) : r.abort(); });
        await h.addInitScript((on) => { localStorage.setItem("ph_lead", JSON.stringify({ name: "Sam", company: "Bayside Test Stores", email: "s@k.example" })); if (on) localStorage.setItem("ph_tour_voiceover", "on"); }, sound);
        await h.goto("http://x.test/industries/retail-media/tour/?embed=1"); await h.waitForSelector("#start", { state: "visible" });
        return h;
      };
      const st = (h) => h.evaluate(() => { const t = document.getElementById("vohint"), v = document.getElementById("vo"); return { hint: !!t, text: t ? t.textContent.trim() : "", pulse: v.classList.contains("pulse"), step: window.__t.S.step, flow: window.__t.S.flow, go: (window.__go || []).slice(), pressed: v.getAttribute("aria-pressed"), saved: localStorage.getItem("ph_tour_voiceover"), fs: document.documentElement.classList.contains("fs") }; });
      const zeros = (x) => x.go.filter((i) => i === 0).length;
      // Start the tour: the hint shows with the pulse, above the speaker and inside the frame, and the flow waits; step 1 starts at 3 s.
      { const h = await open(false); const t0 = Date.now();
        await h.click("#start");
        let s = await st(h);
        assert.ok(s.hint && s.text === "volume_upEnable sound" && s.pulse && s.step === -1 && !s.go.length, "Start the tour with sound off shows the hint and waits: " + JSON.stringify(s));
        const g = await h.evaluate(() => { const r = (e) => e.getBoundingClientRect(), t = r(document.getElementById("vohint")), v = r(document.getElementById("vo")), cs = getComputedStyle(document.getElementById("vohint")); return { t: { l: t.left, r: t.right, top: t.top, b: t.bottom }, v: { l: v.left, r: v.right, top: v.top }, w: innerWidth, h: innerHeight, bg: cs.backgroundColor, color: cs.color, role: document.getElementById("vohint").getAttribute("role"), anim: getComputedStyle(document.getElementById("vo")).animationName }; });
        assert.ok(g.t.b <= g.v.top && g.t.l >= 0 && g.t.top >= 0 && g.t.r <= g.w && g.t.r >= (g.v.l + g.v.r) / 2 && g.bg === "rgb(20, 32, 43)" && g.color === "rgb(255, 255, 255)" && g.role === "status" && g.anim === "vopulse", "the hint sits above the speaker, inside the frame, dark with white text, and the button pulses: " + JSON.stringify(g));
        await h.waitForTimeout(1500); s = await st(h);
        assert.ok(s.hint && s.step === -1 && !s.go.length, "still waiting at 1.5 s: " + JSON.stringify(s));
        await h.waitForFunction(() => (window.__go || []).length > 0, null, { timeout: 6000 });
        const ms = Date.now() - t0; s = await st(h);
        assert.ok(ms >= 2700 && !s.hint && !s.pulse && s.go[0] === 0 && s.pressed === "false" && s.saved === null, `step 1 starts at 3 s with sound still off (${ms} ms): ` + JSON.stringify(s));
        await h.waitForTimeout(1500); s = await st(h);
        assert.strictEqual(zeros(s), 1, "the flow starts once: " + JSON.stringify(s.go));
        assert.deepStrictEqual(h.__errs, [], "no page errors (hint, timeout)");
        await h.close(); }
      // Clicking the hint, or the speaker, turns sound on, saves it and starts at once, with no second start.
      for (const target of ["#vohint", "#vo"]) {
        const h = await open(false);
        await h.click("#start"); await h.waitForSelector("#vohint");
        await h.click(target);
        let s = await st(h);
        assert.ok(!s.hint && !s.pulse && s.go[0] === 0 && s.pressed === "true" && s.saved === "on", `clicking ${target} turns sound on, saves it and starts at once: ` + JSON.stringify(s));
        await h.waitForTimeout(3500); s = await st(h);
        assert.strictEqual(zeros(s), 1, `clicking ${target}: no second start: ` + JSON.stringify(s.go));
        assert.deepStrictEqual(h.__errs, [], `no page errors (${target})`);
        await h.close();
      }
      // Sound already on: no hint, the flow starts at once.
      { const h = await open(true);
        await h.click("#start"); const s = await st(h);
        assert.ok(!s.hint && !s.pulse && s.go[0] === 0 && s.pressed === "true", "sound on: no hint, starts at once: " + JSON.stringify(s));
        await h.close(); }
      // Next during the hint cancels it, with no double start; so does switching flow.
      { const h = await open(false);
        await h.click("#start"); await h.waitForSelector("#vohint");
        await h.click("#next");
        let s = await st(h);
        assert.ok(!s.hint && !s.pulse && s.go.length === 1, "Next during the hint cancels it and moves on: " + JSON.stringify(s));
        await h.waitForTimeout(3500); s = await st(h);
        assert.strictEqual(zeros(s), 1, "Next during the hint: no second start when the 3 s run out: " + JSON.stringify(s.go));
        await h.close(); }
      { const h = await open(false);
        await h.click("#start"); await h.waitForSelector("#vohint");
        await h.click('.chip[data-k="1"]');
        let s = await st(h);
        assert.ok(!s.hint && !s.pulse && s.flow === 1 && s.step === -1, "a flow switch during the hint cancels it: " + JSON.stringify(s));
        await h.waitForTimeout(3500); s = await st(h);
        assert.ok(!s.go.length && s.step === -1 && await h.locator("#start").isVisible(), "after a flow switch the old hint never starts anything: " + JSON.stringify(s));
        await h.close(); }
      // Watch full screen shows the hint (in full screen); Play before any step shows it, and Play again during it starts at once.
      { const h = await open(false);
        await h.click("#fsstart"); await h.waitForSelector("#vohint"); await h.waitForFunction(() => document.documentElement.classList.contains("fs"));
        let s = await st(h);
        assert.ok(s.hint && s.pulse && s.fs && !s.go.length, "Watch full screen shows the hint in full screen: " + JSON.stringify(s));
        const g = await h.evaluate(() => { const t = document.getElementById("vohint").getBoundingClientRect(); return t.top >= 0 && t.left >= 0 && t.right <= innerWidth && getComputedStyle(document.getElementById("vohint")).visibility !== "hidden"; });
        assert.ok(g, "the hint is inside the screen in full screen");
        await h.waitForFunction(() => (window.__go || []).length > 0, null, { timeout: 6000 });
        await h.close(); }
      { const h = await open(false);
        await h.click('.chip[data-k="2"]'); await h.click("#play");
        let s = await st(h);
        assert.ok(s.hint && s.flow === 2 && !s.go.length, "Play before any step shows the hint: " + JSON.stringify(s));
        await h.click("#play"); s = await st(h);
        assert.ok(!s.hint && s.go.length === 1 && s.go[0] === 0 && s.pressed === "false", "Play again during the hint starts at once, sound still off: " + JSON.stringify(s));
        await h.waitForTimeout(3500); s = await st(h);
        assert.strictEqual(zeros(s), 1, "Play during the hint: no second start: " + JSON.stringify(s.go));
        await h.close(); }
      // The end card's Next flow shows the hint before the next flow starts.
      { const h = await open(false);
        await h.evaluate(() => { window.__t.setFlow(0); window.__t.showEnd(); });
        await h.click("#nextflow");
        const s = await st(h);
        assert.ok(s.hint && s.pulse && s.flow === 1 && !s.go.length, "the end card's Next flow shows the hint: " + JSON.stringify(s));
        await h.close(); }
      // Telco, pharmacy and convenience have no voiceover: no hint, Start starts at once.
      for (const ind of ["telco", "pharmacy", "convenience"]) {
        const h = await browser.newPage({ viewport: { width: 1160, height: 900 }, reducedMotion: "reduce" });
        await h.route("**/*", (r) => r.request().url().startsWith("http://x.test/") ? r.fulfill({ contentType: "text/html", body: hk }) : r.abort());
        await h.addInitScript(() => localStorage.setItem("ph_lead", JSON.stringify({ name: "Sam", company: "Kestrel", email: "s@k.example" })));
        await h.goto(`http://x.test/industries/${ind}/tour/?embed=1`); await h.waitForSelector("#start", { state: "visible" });
        await h.click("#start");
        const s = await h.evaluate(() => ({ hint: document.querySelectorAll("#vohint,.vohint").length, go: (window.__go || []).slice(), vo: !document.getElementById("vogrp").hidden }));
        assert.ok(!s.hint && s.go[0] === 0 && !s.vo, `${ind}: no hint and no speaker; Start starts at once: ` + JSON.stringify(s));
        await h.close();
      }
    }
    // The voiceover timing tests (tools/retail-media-tour/votest.js) need the audio: they run when TOUR_ASSETS_DIR is set.
    if (assetsDir && fs.existsSync(path.join(assetsDir, "vo", "manifest.json"))) {
      const { spawnSync } = await import("child_process");
      for (const mode of [["off"], ["reload"], ["nav"]].concat(process.env.TOUR_VO_FULL ? [["full", "0"], ["full", "1"], ["full", "2"]] : [])) {
        const r = spawnSync("node", [path.join(here, "..", "tools", "retail-media-tour", "votest.js"), ...mode], { env: { ...process.env, MOTION: mode[0] === "full" ? "normal" : process.env.MOTION, PORT: String(8800 + Math.floor(Math.random() * 100)) }, encoding: "utf8", timeout: 20 * 60 * 1000 });
        assert.strictEqual(r.status, 0, `votest.js ${mode.join(" ")}:\n${r.stdout}${r.stderr}`);
      }
    } else console.log("tour: voiceover timing tests skipped (set TOUR_ASSETS_DIR to a checkout of tag tour-assets-retail-media-v1)");
  }
  // Fuel & convenience: the three standard flows on recreated HQ Admin screens (as pharmacy), convenience content, a four-location shopper scene, end card CTA to retail media.
  { const src = fs.readFileSync(path.join(dir, "tour", "tour.html"), "utf8");
    const fast = src.replace("const k = reduce ? .35 : 1;", "const k = .03;"); assert.ok(fast !== src, "speed hook applied (convenience)");
    const open2 = async (html, lead) => {
      const t = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
      const errs = []; t.on("pageerror", (e) => errs.push(e.message));
      await t.route("**/*", (r) => r.request().url().startsWith("http://x.test/") ? r.fulfill({ contentType: "text/html", body: html }) : r.abort());
      if (lead) await t.addInitScript(() => localStorage.setItem("ph_lead", JSON.stringify({ name: "Sam", company: "", email: "s@k.example", source: "Telco business model download" })));
      await t.goto("http://x.test/industries/convenience/tour/?embed=1");
      return { t, errs };
    };
    { const { t, errs } = await open2(fast, true);
      await t.waitForSelector("#fs", { state: "visible" });
      assert.ok(/Fuel & Convenience/.test(await t.title()), "document title names Fuel & Convenience: " + await t.title());
      assert.strictEqual(await t.locator("#flows .chip").count(), 3, "the three standard flows");
      assert.strictEqual(await t.locator("#co").inputValue(), "Larkspur Convenience", "fictional brand");
      const texts = new Set(); const counts = []; const caps = [];
      let blankTiles = 0, locsSeen = 0;
      for (let f = 0; f < 3; f++) {
        await t.click(`.chip[data-k="${f}"]`);
        counts.push(await t.locator("#dots .dot").count());
        await t.click("#play");
        const t0 = Date.now();
        for (;;) {
          const s = await t.evaluate(() => ({ cap: document.getElementById("capT").textContent, txt: [document.getElementById("stage").innerText, document.getElementById("capS").textContent, document.getElementById("card").innerText, [...document.querySelectorAll("#stage svg text")].map((x) => x.textContent).join(" ")].join("\n"),
            tiles: [...document.querySelectorAll("#stage .cv-tile .cv-scr")].map((x) => x.innerText.trim().length), locs: document.querySelectorAll("#stage .cv-loc").length, shell: !!document.querySelector("#stage .side"),
            done: !document.getElementById("card").hidden && /complete/i.test(document.getElementById("card").innerText) }));
          caps.push(s.cap); texts.add(s.txt);
          if (s.locs) { locsSeen = Math.max(locsSeen, s.locs); if (s.tiles.some((n) => !n)) blankTiles++; }
          if (s.done) break;
          assert.ok(Date.now() - t0 < 150000, `convenience flow ${f + 1} finished`);
          await t.waitForTimeout(60);
        }
      }
      const all = [...texts].join("\n");
      assert.deepStrictEqual(counts, [8, 9, 6], "step counts per flow");
      assert.strictEqual(locsSeen, 4, "the shopper scene shows four screen locations");
      assert.strictEqual(blankTiles, 0, "screens always show content");
      for (const need of ["Campaigns", "Stores / Branches", "Targeting", "Retail Admin", "Coffee + Pastry", "Coffee and pastry deal", "Forecourt screens", "Shop front", "Cooler door screens", "POS screens", "Motorway sites", "City convenience", "Regional highway", "Truck stops", "Pastry out of stock", "Weekday mornings", "Every weekday", "Audience / Segments", "Loyalty Gold", "Purchase History", "Coffee", "Pump 4", "Driveway screens", "Coolers", "Welcome back, Sam", "Visitor Details", "illustrative"]) assert.ok(all.includes(need), "convenience walkthrough shows: " + need);
      const bad = all.match(/telco|pharmac|prescription|iPhone|Harbourside|Nimbus|Shell|BP |Caltex|7-Eleven|Coca|Red Bull|personalization|sun care|Frostline/i);
      assert.ok(!bad, "no other industry content, real brands or US spelling: " + (bad || [])[0]);
      assert.strictEqual(await t.locator("#cta").count(), 0, "no retail media link on the end card");
      assert.ok(!/retail media walkthrough|retail-media/i.test(await t.content().then((c) => c.replace(/<script[\s\S]*?<\/script>/g, ""))), "no retail media link or wording on the page");
      assert.strictEqual(await t.locator("#nextflow").count(), 1, "end card loops with Next like pharmacy");
      assert.ok(await t.evaluate(() => window.dataLayer.some((e) => e.event === "ph_tour" && e.action === "complete" && e.industry === "convenience")), "complete event carries industry convenience");
      assert.deepStrictEqual(errs, [], "no page errors: " + JSON.stringify(errs));
      await t.close(); }
    // Locked: the teaser plays the shopper journey and the gate offers the three flows; the lead carries the convenience flow name.
    { const { t, errs } = await open2(src, false);
      await t.waitForSelector(".g-flow");
      assert.strictEqual(await t.locator(".g-flow").count(), 3, "gate offers the three flows");
      assert.ok(/Scene|Sam/.test(await t.locator("#stage").innerText()), "teaser shows the shopper journey");
      assert.deepStrictEqual(errs, [], "no page errors in the teaser"); await t.close(); }
  }
  console.log("tour js: all passed");
} finally { await browser.close(); }
