// node ph-website/tests/retail-media-walkthrough.test.mjs : the retail media walkthrough page in Chromium.
// Locked teaser, work-email gate, all five scenes in order across the four screen locations, no blank screens, no real brand names, ph_lead posted.
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import assert from "assert";
import { fileURLToPath } from "url";
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { console.log("retail-media-walkthrough: playwright not installed here; skipping"); process.exit(0); }
const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "snippets", "ph-industry-enhancements", "tour", "retail-media.html");
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; page.on("pageerror", e => errs.push(String(e)));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await page.addInitScript(() => { window.PH_TOUR = { endpoint: "/lead", nonce: "" }; window.__posts = []; });
  await page.route("**/lead", r => { r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }); });
  await page.route("http://ph.test/walk", r => r.fulfill({ status: 200, contentType: "text/html", body: fs.readFileSync(file, "utf8") }));
  await page.goto("http://ph.test/walk");
  assert.equal(await page.locator("#gate").isVisible(), true, "locked: gate shown");
  assert.equal(await page.locator(".sc").count(), 4, "four screen locations");
  const blank = async () => page.evaluate(() => [...document.querySelectorAll(".sc .big")].some(e => !e.textContent.trim()));
  assert.equal(await blank(), false, "no blank screen while locked");
  // fill the gate: a free mail address is refused, a work address unlocks
  await page.fill("input[name=name]", "Sam Taylor"); await page.fill("input[name=company]", "Rowan Group"); await page.fill("input[name=email]", "sam@gmail.com"); await page.check("input[name=consent]");
  assert.equal(await page.locator("#gsub.ok").count(), 0, "free mail keeps the button off");
  await page.fill("input[name=email]", "sam@rowan-group.example");
  const post = page.waitForRequest("**/lead");
  await page.click("#gsub");
  const body = JSON.parse((await post).postData());
  assert.equal(body.industry, "retail-media"); assert.equal(body.consent, true); assert.equal(body.flow, "Retail media walkthrough");
  assert.equal(await page.locator("#gate").isHidden(), true, "unlocked");
  const text = async () => (await page.locator("body").innerText());
  const seen = [];
  for (let i = 0; i < 5; i++) {
    await page.click(`.chip[data-i="${i}"]`);
    await page.waitForFunction(i => document.querySelector("#capt").textContent.startsWith((i + 1) + "."), i);
    const waits = [3000, 6000, 6500, 7000, 4800][i];
    await page.waitForTimeout(waits);
    assert.equal(await blank(), false, `scene ${i + 1}: no blank screen`);
    seen.push(await page.locator("#panel").innerText());
  }
  assert.match(seen[0], /Plain rotation/); assert.match(seen[1], /Loyalty targeting/); assert.match(seen[2], /Forecourt: wide landscape/);
  assert.match(seen[3], /One shopper/); assert.match(seen[4], /Direct advertiser deals/); assert.match(seen[4], /Open auction/); assert.match(seen[4], /coming soon/);
  const all = (await text()) + seen.join(" ");
  assert.doesNotMatch(all, /personalization/i, "personalisation is spelled with an s");
  assert.doesNotMatch(all, /Google|Trade Desk|Amazon|Coca|Pepsi|Shell|BP\b|Tesco|Spar/i, "no real brand names");
  assert.doesNotMatch(all, /[£$€]\s?\d/, "no pricing shown");
  // narrow layout
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= 392), true, "no horizontal scroll at 390px");
  assert.deepEqual(errs, [], "no page errors");
  console.log("retail-media-walkthrough: all passed");
} finally { await browser.close(); }
