// node ph-website/tests/pharmacy-gate.test.mjs : the gated business-model download on the pharmacy calculator (enhance.js + calc-webmcp.js), in Chromium.
// Gate position, test-mode post (industry inputs + test flag), known visitor, ph:lead on download, WebMCP on the pharmacy page, telco gate unchanged.
// Skips (exit 0) when Playwright or Chromium is not available.
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import assert from "assert";
import { fileURLToPath } from "url";
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { console.log("pharmacy-gate: playwright not installed here; skipping"); process.exit(0); }
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "..", "snippets", "ph-industry-enhancements");
const enhance = fs.readFileSync(path.join(dir, "enhance.js"), "utf8");
const site = fs.readFileSync(path.join(dir, "site.js"), "utf8");
const webmcp = fs.readFileSync(path.join(dir, "calc-webmcp.js"), "utf8");
const css = fs.readFileSync(path.join(dir, "enhance.css"), "utf8");
const { CALC, MODELS } = require(path.join(dir, "enhance.js"));
assert.strictEqual(CALC.pharmacy.gate, true, "CALC.pharmacy.gate is true");
assert.strictEqual(CALC.telco.gate, true, "CALC.telco.gate is still true");
const nOf = (ind) => CALC[ind].inputs.length + CALC[ind].assumptions.length;
const row = '<div class="ph-ind-cf"><span class="ph-ind-cf-l">L</span><span class="ph-ind-cf-v">V</span></div>';
const fieldsOf = (ind) => CALC[ind].inputs.map((i) => ({ id: i.id, label: i.label, default: i.def, min: 0, max: 1e6, step: i.step }));
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
      if (/\/industries\/(telco|pharmacy)\/tour\//.test(u)) return r.fulfill({ contentType: "text/html", body: "<!doctype html><title>t</title><p>tour</p>" });
      if (/wp-json\/ph-site\/v1\/(pharmacy|telco)-model$/.test(u)) { (posts || []).push({ url: u, body: JSON.parse(r.request().postData()) }); return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, download: "http://x.test/blocked.xlsx?" + (/pharmacy/.test(u) ? "p" : "t") }) }); }
      if (/blocked\.xlsx/.test(u)) return r.fulfill({ status: 204, body: "" });
      return r.fulfill({ contentType: "text/html", body: html(ind) });
    });
    await p.goto("http://x.test/industries/" + ind + "/" + search);
    await p.locator("form.ph-ind-gate-f").waitFor();
    return p;
  };
  const fill = async (p, o) => { for (const k of ["name", "company", "email"]) await p.fill(`form.ph-ind-gate-f [name=${k}]`, o[k]); await p.check("form.ph-ind-gate-f [name=consent]"); };

  // 1. The gate sits directly beneath the pharmacy calculator, before the tour band.
  let p = await open("pharmacy");
  assert.strictEqual(await p.locator("section.ph-ind-gate").count(), 1, "one gate");
  const pos = await p.evaluate(() => { const g = document.querySelector("section.ph-ind-gate"), c = document.querySelector(".ph-ind-calc"), t = document.getElementById("band");
    return { next: c.nextElementSibling === g, before: !!(g.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING) }; });
  assert.ok(pos.next && pos.before, "gate directly follows the calculator and precedes the tour band");
  assert.strictEqual(await p.textContent("h3.ph-ind-gate-h"), "Get the detailed business model");
  assert.strictEqual(await p.textContent("p.ph-ind-gate-p"), "Provide your details to download the business model.");
  assert.strictEqual(await p.textContent("button.ph-ind-gate-b"), "Download the model");
  assert.ok(await p.locator("button.ph-ind-gate-b").isDisabled(), "button disabled until valid");

  // 2. Test-mode submit posts industry data to the pharmacy endpoint; the link is returned and followed (intercepted, no file saved).
  let posts = [];
  p = await open("pharmacy", { search: "?ph_test=1", posts });
  await fill(p, { name: "Grace Hopper", company: "Orbit Pharmacy", email: "grace@orbit.example" });
  await p.locator("button.ph-ind-gate-b").click();
  await p.waitForFunction(() => /Thanks/.test(document.querySelector(".ph-ind-gate-m").textContent));
  assert.strictEqual(posts.length, 1, "one post");
  assert.ok(/pharmacy-model$/.test(posts[0].url), "pharmacy endpoint");
  const b = posts[0].body;
  assert.strictEqual(b.test, true, "test flag sent");
  assert.deepStrictEqual(Object.keys(b.inputs).sort(), ["basket", "cpm", "screens", "stores", "uplift", "visits"], "the six inputs");
  assert.ok(b.inputs.stores === 100 && b.inputs.cpm === 25 && b.consent === true && b.name === "Grace Hopper", "default figures, consent and details");
  assert.ok(await p.locator(".ph-ind-gate-m a[href*='blocked.xlsx']").count() === 1, "download link shown");
  const dl = await p.evaluate(() => window.dataLayer.filter((e) => e.event === "ph_ind_lead"));
  assert.ok(dl.length === 1 && dl[0].ph_industry === "pharmacy" && dl[0].ph_estimate === Math.round(MODELS.pharm(b.inputs).total), "ph_ind_lead carries the pharmacy estimate: " + JSON.stringify(dl));
  assert.ok(!JSON.stringify(dl).includes("grace@orbit"), "no contact details in the dataLayer");

  // 3. A download writes ph_lead and fires ph:lead, which unlocks the tour.
  const lead = await p.evaluate(() => JSON.parse(localStorage.getItem("ph_lead")));
  assert.ok(lead.email === "grace@orbit.example" && lead.source === "Pharmacy business model download", "ph_lead written with the pharmacy source");
  p = await open("pharmacy");
  const ev = p.evaluate(() => new Promise((res) => window.addEventListener("ph:lead", (e) => res(e.detail.source))));
  await fill(p, { name: "Sam K", company: "Kestrel", email: "sam@kestrel.example" });
  await p.locator("button.ph-ind-gate-b").click();
  assert.strictEqual(await ev, "Pharmacy business model download", "ph:lead fired by the pharmacy download");

  // 4. A known visitor (stored ph_lead, from the tour) skips the form and can download.
  posts = [];
  p = await open("pharmacy", { lead: true, posts });
  assert.ok(await p.locator("form.ph-ind-gate-known").count() === 1, "known state");
  assert.ok(/Thanks, Ada\. We already have your details/.test(await p.textContent(".ph-ind-gate-k")), "greets by first name");
  assert.ok(await p.locator("button.ph-ind-gate-b").isEnabled(), "download enabled without the form");
  await p.locator("button.ph-ind-gate-b").click();
  await p.waitForFunction(() => /Thanks/.test(document.querySelector(".ph-ind-gate-m").textContent));
  assert.ok(posts.length === 1 && posts[0].body.email === "ada@nimbus.example" && /pharmacy-model$/.test(posts[0].url), "known visitor posts to pharmacy with stored details");

  // 5. WebMCP run_business_model_calculator on the pharmacy page: fills figures and submits the gate with the person's own details.
  p = await open("pharmacy", { posts: (posts = []) });
  const run = (a) => p.evaluate((args) => window.__tools[0].execute(args), a);
  let r = await run({ stores: 200, cpm: 30 });
  assert.ok(!r.isError && r.structuredContent.inputs.stores === 200 && r.structuredContent.inputs.cpm === 30 && /name, company, email and consent/.test(r.content[0].text), "figures filled; asks for details");
  assert.strictEqual(posts.length, 0, "nothing submitted without the person's details");
  r = await run({ name: "Ann Lee", company: "Acme Pharmacy", email: "ann@acme.example" });
  assert.ok(/consent/i.test(r.content[0].text) && posts.length === 0, "no consent, no submission");
  r = await run({ name: "Ann Lee", company: "Acme Pharmacy", email: "ann@acme.example", consent: true });
  assert.ok(!r.isError && /blocked\.xlsx/.test(r.structuredContent.download) && posts.length === 1 && posts[0].body.inputs.stores === 200 && posts[0].body.inputs.cpm === 30, "gate submitted with the filled figures");

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
  console.log("pharmacy-gate: all passed");
} catch (e) { console.error("FAIL:", e.stack); process.exitCode = 1; } finally { await browser.close(); }
