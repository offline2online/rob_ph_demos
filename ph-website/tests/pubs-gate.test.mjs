// node ph-website/tests/pubs-gate.test.mjs : the gated business-model download on the Pubs & Hospitality calculator (enhance.js + calc-webmcp.js), in Chromium.
// Gate position, the five rebuilt rows, test-mode post (industry inputs + test flag), known visitor, ph:lead on download, WebMCP on the pubs page,
// telco and pharmacy gates unchanged.
// Skips (exit 0) when Playwright or Chromium is not available.
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import assert from "assert";
import { fileURLToPath } from "url";
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { console.log("pubs-gate: playwright not installed here; skipping"); process.exit(0); }
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "..", "snippets", "ph-industry-enhancements");
const enhance = fs.readFileSync(path.join(dir, "enhance.js"), "utf8");
const site = fs.readFileSync(path.join(dir, "site.js"), "utf8");
const webmcp = fs.readFileSync(path.join(dir, "calc-webmcp.js"), "utf8");
const css = fs.readFileSync(path.join(dir, "enhance.css"), "utf8");
const { CALC, MODELS } = require(path.join(dir, "enhance.js"));
assert.strictEqual(CALC.hospitality.gate, true, "CALC.hospitality (pubs) gate is true");
assert.strictEqual(CALC.pharmacy.gate, true, "CALC.pharmacy.gate is still true");
assert.strictEqual(CALC.telco.gate, true, "CALC.telco.gate is still true");
const nOf = (ind) => ind === "hospitality" ? 4 : CALC[ind].inputs.length + CALC[ind].assumptions.length; // the live pubs page still has the old four rows
const row = '<div class="ph-ind-cf"><span class="ph-ind-cf-l">L</span><span class="ph-ind-cf-v">V</span></div>';
const fieldsOf = (ind) => CALC[ind].inputs.concat(CALC[ind].assumptions).map((i) => ({ id: i.id, label: i.label, default: i.def, min: 0, max: i.max || 1e6, step: i.step }));
const html = (ind) => `<!doctype html><html><head><style>${css}</style></head><body><main>
<section class="ph-ind-sec" id="calcsec"><div class="ph-ind-calc"><div class="ph-ind-cin"><p class="ph-ind-label-gap">a</p><p class="ph-ind-label-gap">b</p>${row.repeat(nOf(ind))}</div>
<div class="ph-ind-cout"><p class="ph-ind-ctot-l">Total</p><p class="ph-ind-ctot-v">0</p><div class="ph-ind-crow">r</div><div class="ph-ind-crow">r</div><div class="ph-ind-crow">r</div></div></div></section>
<section class="ph-ind-sec ph-ind-tour" id="band"><h2>Server heading</h2><div class="ph-ind-tour-mount"></div></section>
<section class="ph-ind-sec" id="after">next</section></main>
<script>window.PH_IND_PAGE="${ind}"; window.PH_CALCULATOR=${JSON.stringify({ industry: ind, name: ind, title: ind + " calculator", summary: "S.", outcome: "Estimated 3-year incremental revenue (USD), more.", download: true, gated: true, fields: fieldsOf(ind) })};
window.__tools=[]; Object.defineProperty(navigator,"modelContext",{value:{registerTool:function(t){window.__tools.push(t);}}});</script>
<script>${site}</script><script>${enhance}</script><script>${webmcp}</script></body></html>`;

const browser = await chromium.launch();
try {
  const open = async (ind, { search = "", lead = false, posts } = {}) => {
    const p = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    if (lead) await p.addInitScript(() => localStorage.setItem("ph_lead", JSON.stringify({ name: "Ada Lovelace", company: "Nimbus", email: "ada@nimbus.example", source: "Interactive product tour", ts: 1 })));
    await p.route("**/*", (r) => {
      const u = r.request().url();
      if (/\/industries\/(telco|pharmacy|hospitality)\/tour\//.test(u)) return r.fulfill({ contentType: "text/html", body: "<!doctype html><title>t</title><p>tour</p>" });
      if (/wp-json\/ph-site\/v1\/(pharmacy|telco|pubs)-model$/.test(u)) { (posts || []).push({ url: u, body: JSON.parse(r.request().postData()) }); return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, download: "http://x.test/blocked.xlsx?" + (/pharmacy/.test(u) ? "p" : /pubs/.test(u) ? "h" : "t") }) }); }
      if (/blocked\.xlsx/.test(u)) return r.fulfill({ status: 204, body: "" });
      return r.fulfill({ contentType: "text/html", body: html(ind) });
    });
    await p.goto("http://x.test/industries/" + ind + "/" + search);
    await p.locator("form.ph-ind-gate-f").waitFor();
    return p;
  };
  const fill = async (p, o) => { for (const k of ["name", "company", "email"]) await p.fill(`form.ph-ind-gate-f [name=${k}]`, o[k]); await p.check("form.ph-ind-gate-f [name=consent]"); };

  // 1. The gate sits directly beneath the pubs calculator, before the (future) tour band; the four old rows become five.
  let p = await open("hospitality");
  assert.strictEqual(await p.locator("section.ph-ind-gate").count(), 1, "one gate");
  const pos = await p.evaluate(() => { const g = document.querySelector("section.ph-ind-gate"), c = document.querySelector(".ph-ind-calc"), t = document.getElementById("band");
    return { next: c.nextElementSibling === g, before: !!(g.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING) }; });
  assert.ok(pos.next && pos.before, "gate directly follows the calculator and precedes the tour band");
  assert.strictEqual(await p.textContent("h3.ph-ind-gate-h"), "Get the detailed business model");
  assert.ok(await p.locator("button.ph-ind-gate-b").isDisabled(), "button disabled until valid");
  const ids = await p.evaluate(() => [].map.call(document.querySelectorAll(".ph-ind-cin input"), (i) => i.id + "=" + i.value).join(","));
  assert.strictEqual(ids, "ph-ind-in-venues=50,ph-ind-in-guests=200,ph-ind-in-revenue=45,ph-ind-in-reach=60,ph-ind-in-uplift=5", "five inputs with their defaults");
  assert.ok(/Share of guests reached by personalised offers/.test(await p.textContent(".ph-ind-cin")), "reach input labelled");
  assert.strictEqual(await p.textContent(".ph-ind-ctot-l"), "Estimated 3-year incremental revenue", "3-year total label");
  assert.strictEqual(await p.textContent(".ph-ind-ctot-v"), "$14.8M", "defaults: 3 x 4,927,500 = $14.8M");

  // 2. Test-mode submit posts the pubs inputs to the pubs endpoint; the link is returned and followed (intercepted, no file saved).
  let posts = [];
  p = await open("hospitality", { search: "?ph_test=1", posts });
  await fill(p, { name: "Grace Hopper", company: "Orbit Taverns", email: "grace@orbit.example" });
  await p.locator("button.ph-ind-gate-b").click();
  await p.waitForFunction(() => /Thanks/.test(document.querySelector(".ph-ind-gate-m").textContent));
  assert.strictEqual(posts.length, 1, "one post");
  assert.ok(/pubs-model$/.test(posts[0].url), "pubs endpoint");
  const b = posts[0].body;
  assert.strictEqual(b.test, true, "test flag sent");
  assert.deepStrictEqual(Object.keys(b.inputs).sort(), ["guests", "reach", "revenue", "uplift", "venues"], "the five inputs");
  assert.ok(b.inputs.venues === 50 && b.inputs.reach === 60 && b.inputs.uplift === 5 && b.consent === true && b.name === "Grace Hopper", "default figures, consent and details");
  assert.ok(/\/industries\/hospitality\/$/.test(b.page), "page sent");
  const dl = await p.evaluate(() => window.dataLayer.filter((e) => e.event === "ph_ind_lead"));
  assert.ok(dl.length === 1 && dl[0].ph_industry === "hospitality" && dl[0].ph_estimate === 14782500, "ph_ind_lead carries the pubs estimate: " + JSON.stringify(dl));
  assert.ok(!JSON.stringify(dl).includes("grace@orbit"), "no contact details in the dataLayer");

  // 3. A download writes ph_lead and fires ph:lead, ready to unlock the pubs tour.
  const lead = await p.evaluate(() => JSON.parse(localStorage.getItem("ph_lead")));
  assert.ok(lead.email === "grace@orbit.example" && lead.source === "Pubs & Hospitality business model download", "ph_lead written with the pubs source");
  p = await open("hospitality");
  const ev = p.evaluate(() => new Promise((res) => window.addEventListener("ph:lead", (e) => res(e.detail.source))));
  await fill(p, { name: "Sam K", company: "Kestrel", email: "sam@kestrel.example" });
  await p.locator("button.ph-ind-gate-b").click();
  assert.strictEqual(await ev, "Pubs & Hospitality business model download", "ph:lead fired by the pubs download");

  // 4. A known visitor (stored ph_lead) skips the form and can download.
  posts = [];
  p = await open("hospitality", { lead: true, posts });
  assert.ok(await p.locator("form.ph-ind-gate-known").count() === 1, "known state");
  assert.ok(/Thanks, Ada\. We already have your details/.test(await p.textContent(".ph-ind-gate-k")), "greets by first name");
  await p.locator("button.ph-ind-gate-b").click();
  await p.waitForFunction(() => /Thanks/.test(document.querySelector(".ph-ind-gate-m").textContent));
  assert.ok(posts.length === 1 && posts[0].body.email === "ada@nimbus.example" && /pubs-model$/.test(posts[0].url), "known visitor posts to pubs with stored details");

  // 5. WebMCP run_business_model_calculator on the pubs page, and a deep link pre-fills it.
  p = await open("hospitality", { posts: (posts = []) });
  const run = (a) => p.evaluate((args) => window.__tools[0].execute(args), a);
  let r = await run({ venues: 80, reach: 40 });
  assert.ok(!r.isError && r.structuredContent.inputs.venues === 80 && r.structuredContent.inputs.reach === 40 && /name, company, email and consent/.test(r.content[0].text), "figures filled; asks for details");
  assert.strictEqual(posts.length, 0, "nothing submitted without the person's details");
  r = await run({ name: "Ann Lee", company: "Acme Inns", email: "ann@acme.example" });
  assert.ok(/consent/i.test(r.content[0].text) && posts.length === 0, "no consent, no submission");
  r = await run({ name: "Ann Lee", company: "Acme Inns", email: "ann@acme.example", consent: true });
  assert.ok(!r.isError && /blocked\.xlsx\?h/.test(r.structuredContent.download) && posts.length === 1 && posts[0].body.inputs.venues === 80 && posts[0].body.inputs.reach === 40, "gate submitted with the filled figures");
  p = await open("hospitality", { search: "?venues=10&uplift=7.5" });
  await p.waitForFunction(() => document.getElementById("ph-ind-in-venues").value === "10");
  assert.strictEqual(await p.inputValue("#ph-ind-in-uplift"), "7.5", "deep link pre-fills the page");

  // 5b. Pharmacy is unchanged.
  posts = [];
  p = await open("pharmacy", { search: "?ph_test=1", posts });
  await fill(p, { name: "Grace Hopper", company: "Orbit Pharmacy", email: "grace@orbit.example" });
  await p.locator("button.ph-ind-gate-b").click();
  await p.waitForFunction(() => /Thanks/.test(document.querySelector(".ph-ind-gate-m").textContent));
  assert.ok(posts.length === 1 && /pharmacy-model$/.test(posts[0].url) && "cpm" in posts[0].body.inputs, "pharmacy posts to pharmacy-model with its own inputs");
  assert.strictEqual(await p.evaluate(() => JSON.parse(localStorage.getItem("ph_lead")).source), "Pharmacy business model download", "pharmacy source label unchanged");

  // 6. Telco is unchanged: the telco endpoint, label and estimate.
  posts = [];
  p = await open("telco", { search: "?ph_test=1", posts });
  await fill(p, { name: "Grace Hopper", company: "Orbit Telecom", email: "grace@orbit.example" });
  await p.locator("button.ph-ind-gate-b").click();
  await p.waitForFunction(() => /Thanks/.test(document.querySelector(".ph-ind-gate-m").textContent));
  assert.ok(posts.length === 1 && /telco-model$/.test(posts[0].url) && posts[0].body.test === true && "walk" in posts[0].body.inputs, "telco posts to telco-model with its own inputs");
  assert.strictEqual(await p.evaluate(() => JSON.parse(localStorage.getItem("ph_lead")).source), "Telco business model download", "telco source label unchanged");
  const tdl = await p.evaluate(() => window.dataLayer.filter((e) => e.event === "ph_ind_lead")[0]);
  assert.strictEqual(tdl.ph_estimate, Math.round(MODELS.tel3(posts[0].body.inputs, CALC.telco).total), "telco estimate unchanged");
  console.log("pubs-gate: all passed");
} catch (e) { console.error("FAIL:", e.stack); process.exitCode = 1; } finally { await browser.close(); }
