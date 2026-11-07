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
  console.log("tour js: all passed");
} finally { await browser.close(); }
