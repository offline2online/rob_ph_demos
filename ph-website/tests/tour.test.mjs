// node ph-website/tests/tour.test.mjs : the telco product tour on the industry page (enhance.js + site.js), in Chromium.
// Checks: the band is mounted (Elementor mount, or built after the calculator's section), the iframe src (+ph_test forwarding), the height
// message, window.PH_TOUR, "Arrange a Demo" -> PH_SITE_DEMO, and that a successful calculator download / Talk to us submit writes
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
const n = CALC.telco.inputs.length + CALC.telco.assumptions.length;
const row = '<div class="ph-ind-cf"><span class="ph-ind-cf-l">L</span><span class="ph-ind-cf-v">V</span></div>';
const html = (withBand) => `<!doctype html><html><body><main>
<section class="ph-ind-sec" id="calcsec"><div class="ph-ind-calc"><div class="ph-ind-cin"><p class="ph-ind-label-gap">a</p><p class="ph-ind-label-gap">b</p>${row.repeat(n)}</div>
<div class="ph-ind-cout"><p class="ph-ind-ctot-l">Total</p><p class="ph-ind-ctot-v">0</p><div class="ph-ind-crow">r</div></div></div></section>
${withBand ? '<section class="ph-ind-sec ph-ind-tour" id="band"><h2>Server heading</h2><div class="ph-ind-tour-mount"></div></section>' : ""}
<section class="ph-ind-sec" id="after">next</section></main>
<script>window.PH_IND_PAGE="telco"; window.__demo=[]; window.__cal=[]; window.Calendly={initPopupWidget:function(o){window.__cal.push(o.url);}};</script>
<script>${site}</script><script>${enhance}</script></body></html>`;

const browser = await chromium.launch();
try {
  const open = async (withBand, search = "") => {
    const p = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await p.route("**/*", (r) => {
      const u = r.request().url();
      if (/\/industries\/telco\/tour\//.test(u)) return r.fulfill({ contentType: "text/html", body: "<!doctype html><title>t</title><p>tour</p>" });
      if (/wp-json\/ph-site\/v1\/(industry-lead|telco-model)$/.test(u)) return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, download: "http://x.test/blocked.xlsx" }) });
      if (/blocked\.xlsx/.test(u)) return r.fulfill({ status: 204, body: "" });
      return r.fulfill({ contentType: "text/html", body: html(withBand) });
    });
    await p.goto("http://x.test/industries/telco/" + search);
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

  // Test mode is forwarded to the tour.
  p = await open(true, "?ph_test=1");
  assert.strictEqual(await p.locator("iframe.ph-ind-tour-frame").getAttribute("src"), "/industries/telco/tour/?embed=1&ph_test=1", "ph_test forwarded");
  await p.close();

  // Talk to us success writes ph_lead and announces it.
  p = await open(true);
  await p.evaluate(() => { window.__ev = []; window.addEventListener("ph:lead", (e) => window.__ev.push(e.detail)); });
  const f = p.locator(".ph-ind-lead form");
  await f.locator("[name=company]").fill("Nimbus Mobile");
  await f.locator("[name=contact_name]").fill("Ada Lovelace");
  await f.locator("[name=email]").fill("ada@nimbus.example");
  await f.locator("[name=consent]").check();
  await f.locator("button[type=submit]").click();
  await p.waitForFunction(() => window.__ev.length === 1);
  let lead = await p.evaluate(() => JSON.parse(localStorage.getItem("ph_lead")));
  assert.ok(lead.name === "Ada Lovelace" && lead.company === "Nimbus Mobile" && lead.email === "ada@nimbus.example" && lead.source === "Talk to us" && typeof lead.ts === "number", "ph_lead from Talk to us: " + JSON.stringify(lead));
  assert.deepStrictEqual(await p.evaluate(() => window.__ev[0]), lead, "ph:lead detail equals the stored lead");
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
  lead = await p.evaluate(() => JSON.parse(localStorage.getItem("ph_lead")));
  assert.ok(lead.name === "Grace Hopper" && lead.company === "Orbit Telecom" && lead.email === "grace@orbit.example" && lead.source === "Telco business model download", "ph_lead from the calculator download: " + JSON.stringify(lead));
  // A blocked localStorage must not break the form.
  await p.close();
  p = await browser.newPage();
  await p.addInitScript(() => { Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } }); });
  await p.route("**/*", (r) => r.request().url().includes("industry-lead") ? r.fulfill({ contentType: "application/json", body: '{"ok":true}' }) : r.fulfill({ contentType: "text/html", body: html(true) }));
  await p.goto("http://x.test/industries/telco/");
  await p.evaluate(() => { window.__ev = []; window.addEventListener("ph:lead", (e) => window.__ev.push(e.detail)); });
  const f2 = p.locator(".ph-ind-lead form");
  await f2.locator("[name=company]").fill("C"); await f2.locator("[name=contact_name]").fill("N"); await f2.locator("[name=email]").fill("n@c.example"); await f2.locator("[name=consent]").check();
  await f2.locator("button[type=submit]").click();
  await p.waitForFunction(() => window.__ev.length === 1);
  assert.ok(/Thanks/.test(await p.locator(".ph-ind-lead .ph-ind-gate-m").textContent()), "the form still succeeds with storage blocked");
  // The tour page itself: full screen, native and fallback.
  const tourHtml = fs.readFileSync(path.join(dir, "tour", "telco.html"), "utf8");
  const tourPage = async (fallback, vp, body = tourHtml) => {
    const t = await browser.newPage({ viewport: vp });
    await t.route("**/*", (r) => r.request().url().startsWith("http://x.test/") ? r.fulfill({ contentType: "text/html", body }) : r.abort());
    await t.addInitScript((fb) => { localStorage.setItem("ph_lead", JSON.stringify({ name: "Sam", company: "Kestrel", email: "s@k.example" })); if (fb) { Document.prototype.__defineGetter__("fullscreenEnabled", () => false); } }, fallback);
    await t.goto("http://x.test/industries/telco/tour/?embed=1");
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
    assert.deepStrictEqual(await evs(t), ["fullscreen_enter:telco:string:number", "fullscreen_exit:telco:string:number"], "ph_tour events");
    await t.close();
  }
  // Landscape phones (height <= 520): the stage takes at least 60% of the height, one-row bar of at most 52px, chips row of at most 36px, nothing wraps.
  for (const vp of [{ width: 740, height: 360 }, { width: 844, height: 390 }, { width: 667, height: 375 }]) {
    const t = await tourPage(false, vp);
    await t.click("#fs");
    await t.waitForFunction(() => document.documentElement.classList.contains("fs"));
    const m = await t.evaluate(() => { const R = (s) => document.querySelector(s).getBoundingClientRect(), b = R("#box"), bar = R(".bar"), fl = R(".flows"), kids = [...document.querySelector(".bar").children].map((e) => e.getBoundingClientRect()); return { ratio: b.height / innerHeight, aspect: b.width / b.height, centred: Math.abs((b.left + b.right) / 2 - (R("#wrap").left + R("#wrap").right) / 2) < 2, barH: bar.height, flH: fl.height, oneRow: kids.every((k) => Math.abs(k.top + k.height / 2 - (bar.top + bar.height / 2)) < 20), inView: kids.every((k) => k.left >= 0 && k.right <= innerWidth + 1), capDone: getComputedStyle(document.querySelector(".cap b")).textOverflow, sub: getComputedStyle(document.querySelector(".chip small") || document.body).display, brand: R(".top").height }; });
    assert.ok(m.ratio >= 0.6 && Math.abs(m.aspect - 1280 / 760) < 0.02 && m.centred, "stage >= 60% of the height, aspect kept, centred at " + vp.width + "x" + vp.height + ": " + JSON.stringify(m));
    assert.ok(m.barH <= 52 && m.oneRow && m.inView && m.capDone === "ellipsis", "control bar is one row of at most 52px with every control in view: " + JSON.stringify(m));
    assert.ok(m.flH <= 36 && m.sub !== "block", "flow chips row at most 36px, sub-labels hidden: " + JSON.stringify(m));
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
    assert.deepStrictEqual(await evs(t), ["fullscreen_enter:telco:string:number", "fullscreen_exit:telco:string:number"], "same events as the bar button");
    await t.close();
  }
  // Apple touch devices (iPhone, iPad, iPadOS as Macintosh): the in-page fallback, never the native API (its system X sits top left).
  for (const [ua, touch] of [["Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", 5], ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15", 5], ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1", 5]]) {
    const ctx = await browser.newContext({ userAgent: ua, viewport: { width: 1024, height: 768 } });
    const t = await ctx.newPage();
    await t.route("**/*", (r) => r.request().url().startsWith("http://x.test/") ? r.fulfill({ contentType: "text/html", body: tourHtml }) : r.abort());
    await t.addInitScript((n) => { localStorage.setItem("ph_lead", JSON.stringify({ name: "Sam", company: "Kestrel", email: "s@k.example" })); Object.defineProperty(Navigator.prototype, "maxTouchPoints", { get: () => n }); }, touch);
    await t.goto("http://x.test/industries/telco/tour/?embed=1");
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
  assert.ok(await t.evaluate(() => getComputedStyle(document.getElementById("fs")).display !== "none"), "button stays in full screen");
  await t.close();
  assert.ok(/id="fsexit"/.test(tourHtml) && /html\.fs #card \.fsonly\{display:inline-flex\}/.test(tourHtml), "end card has Exit full screen, shown only in full screen");
  // End card: Next is the primary action and focused; no AWS or demo buttons; the last flow wraps; Replay and Exit full screen are secondary.
  const hooked = tourHtml.replace('document.getElementById("prev").onclick', "window.__t = { setFlow, showEnd, S };\n$&"); // test hook into the page's closure
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
    await ft.goto("http://x.test/industries/telco/tour/?embed=1#localisation");
    await ft.waitForSelector("#fs", { state: "visible" });
    await ft.evaluate(() => { __t.setFlow(1); __t.showEnd(); });
    assert.ok(await ft.evaluate(() => !document.getElementById("nextflow") && document.activeElement.id === "again"), "focus mode: no Next, Replay focused");
    await ft.close();
  }
  // Framed fallback: parent receives ph-tour-fullscreen on/off and the frame is pinned.
  const fp = await browser.newPage({ viewport: { width: 390, height: 700 } });
  await fp.route("**/*", (r) => { const u = r.request().url(); if (/\/industries\/telco\/tour\//.test(u)) return r.fulfill({ contentType: "text/html", body: tourHtml }); if (u.startsWith("http://x.test/")) return r.fulfill({ contentType: "text/html", body: html(true) }); return r.abort(); });
  await fp.addInitScript(() => { localStorage.setItem("ph_lead", JSON.stringify({ name: "Sam", company: "Kestrel", email: "s@k.example" })); Document.prototype.__defineGetter__("fullscreenEnabled", () => false); });
  await fp.goto("http://x.test/industries/telco/");
  const cf = fp.frames().find((x) => x !== fp.mainFrame());
  await cf.waitForSelector("#fs", { state: "visible" });
  await cf.click("#fs");
  await fp.waitForFunction(() => getComputedStyle(document.querySelector(".ph-ind-tour-frame")).position === "fixed");
  assert.ok(await cf.evaluate(() => document.documentElement.classList.contains("fs") && !document.fullscreenElement && fs.getAttribute("aria-label") === "Exit full screen"), "fallback: tour is in full-screen mode without the API");
  await fp.keyboard.press("Escape");
  await fp.waitForFunction(() => getComputedStyle(document.querySelector(".ph-ind-tour-frame")).position !== "fixed");
  assert.ok(await cf.evaluate(() => !document.documentElement.classList.contains("fs") && document.activeElement.id === "fs"), "fallback: Esc exits, frame restored, focus back on the button");
  await cf.click("#fs"); await fp.waitForFunction(() => getComputedStyle(document.querySelector(".ph-ind-tour-frame")).position === "fixed");
  await cf.click("#fs"); await fp.waitForFunction(() => getComputedStyle(document.querySelector(".ph-ind-tour-frame")).position !== "fixed");
  await fp.close();
  console.log("tour js: all passed");
} finally { await browser.close(); }
