// A page whose code fails on this device must say so, not stay blank (7 Nov
// 2026: Leads and Prospects (TAM) on Rob's iPad highlighted in the menu and
// showed nothing, so the cause could not be seen). Each lazily loaded Promote
// page is made to fail on purpose; the page must show "<Page> couldn't open",
// the error text, and a Try again that works once the code loads.
// Run with:  cd backlog-tracker/test && node ui/page-load-error.test.mjs
import assert from "node:assert/strict";
import { startHarness, until } from "./harness.mjs";

const T = { $ts: 1_760_000_000_000 };
const seed = { user: { email: "admin@personalisationhub.com", role: "admin" }, docs: { projects: { p1: { name: "Demo", createdAt: T } }, backlogItems: {},
  prospects: { pb: { name: "Beta Pharmacy", country: "Germany", industry: "Pharmacy", hqCountry: "Germany", markets: ["Germany"], awsRegion: "eu-central-1", storeCount: 40, sizeBand: "small", vendors: [], campaigns: [], status: "targeted", leadId: "", createdAt: T, updatedAt: T } } } };
const h = await startHarness();
try {
  for (const [file, label, btn, ready] of [
    ["leads-page.js", "Leads", "promote-leads-btn", "#leads-page .lead-lane"],
    ["prospects-page.js", "Prospects (TAM)", "promote-prospects-btn", "#prospects-page .ag-row"],
  ]) {
    const o = await h.open({ seed, width: 1180, height: 820, contextOptions: { hasTouch: true, isMobile: true } });
    const { page } = o;
    let broken = true;
    await page.route("**/js/" + file, (r) => (broken
      ? r.fulfill({ status: 200, contentType: "text/javascript", body: "throw new TypeError('simulated device failure');" })
      : r.fallback()));
    await until(() => page.locator(".project-options-btn").count(), "board");
    await page.tap("#" + btn);
    await until(() => page.locator(".page-load-error").count(), `${label}: the failure is shown`, 5000);
    const text = await page.locator(".page-load-error").innerText();
    assert.match(text, new RegExp(`${label.replace(/[()]/g, "\\$&")} couldn't open`), `${label}: says which page failed`);
    assert.match(text, /simulated device failure/, `${label}: shows the browser's error text`);
    broken = false;
    await page.locator(".page-load-error button").tap();
    await until(() => page.locator(ready).count(), `${label}: Try again opens the page once its code loads`, 10000);
    assert.equal(await page.locator(".page-load-error").count(), 0, `${label}: the error is gone after a successful retry`);
    console.log(`PASS ${label}`);
    await o.close();
  }
} finally { await h.close(); }
console.log("page-load-error: ok");
