// Browser test of snippets/ph-industry-enhancements/calc-webmcp.js against a stand-in for the calculator DOM that enhance.js builds
// (inputs #ph-ind-in-<id>, the .ph-ind-cout total, the .ph-ind-gate-f download form) and a stubbed navigator.modelContext.
// Skips (exit 0) when Playwright or Chromium is not available.
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import assert from "assert";
import { fileURLToPath } from "url";
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { console.log("calc-webmcp: playwright not installed here; skipping"); process.exit(0); }
const here = path.dirname(fileURLToPath(import.meta.url));
const js = fs.readFileSync(path.join(here, "..", "snippets", "ph-industry-enhancements", "calc-webmcp.js"), "utf8");
const cfg = { industry: "telco", name: "Telco Retail", title: "Telco Retail business model calculator", summary: "S.", outcome: "Estimated 3-year incremental revenue (USD), more.", download: true, gated: true,
  fields: [{ id: "stores", label: "Stores", default: 58, min: 1, max: 5000, step: 1 }, { id: "arpu", label: "ARPU", default: 49, min: 1, max: 1000, step: 1 }] };
const page = (search) => `<!doctype html><html><body><div class="ph-ind-calc"><div class="ph-ind-cin">
<input id="ph-ind-in-stores" type="number" value="58"><input id="ph-ind-in-arpu" type="number" value="49"></div>
<div class="ph-ind-cout"><p class="ph-ind-ctot-l">Total</p><p class="ph-ind-ctot-v" id="tot">0</p></div></div>
<form class="ph-ind-gate-f"><input name="name"><input name="company"><input name="email"><input type="checkbox" name="consent">
<button type="submit" disabled>Download</button><p class="ph-ind-gate-m"></p></form>
<script>
var cin=document.querySelector(".ph-ind-calc"); function upd(){document.getElementById("tot").textContent="$"+(document.getElementById("ph-ind-in-stores").value*document.getElementById("ph-ind-in-arpu").value*1000);} cin.addEventListener("input",upd); upd();
var f=document.querySelector(".ph-ind-gate-f"),b=f.querySelector("button");
function sync(){b.disabled=!(f.name.value&&f.company.value&&/@/.test(f.email.value)&&f.consent.checked);} f.addEventListener("input",sync);f.addEventListener("change",sync);
window.__posted=null; f.addEventListener("submit",function(e){e.preventDefault(); window.__posted={name:f.name.value,company:f.company.value,email:f.email.value}; var m=f.querySelector(".ph-ind-gate-m"); m.innerHTML='Thanks. <a href="https://personalisationhub.com/wp-json/ph-site/v1/telco-model/download?x=1">Download the model</a>';});
window.PH_CALCULATOR=${JSON.stringify(cfg)}; window.__tools=[]; Object.defineProperty(navigator,"modelContext",{value:{registerTool:function(t){window.__tools.push(t);}}});
</script><script>${js}</script></body></html>`;

const browser = await chromium.launch();
try {
  const tab = async (search) => { const p = await browser.newPage(); await p.route("**/*", (r) => r.fulfill({ contentType: "text/html", body: page(search) })); await p.goto("http://x.test/industries/telco/" + (search || "")); return p; };
  // Deep link fills the calculator.
  let p = await tab("?stores=120&arpu=60&evil=1");
  await p.waitForFunction(() => document.getElementById("ph-ind-in-stores").value === "120");
  assert.strictEqual(await p.inputValue("#ph-ind-in-arpu"), "60", "deep link fills every known field");
  assert.strictEqual(await p.textContent("#tot"), "$7200000", "the calculator recalculated from the link");
  // Tool registered once.
  p = await tab("");
  assert.deepStrictEqual(await p.evaluate(() => window.__tools.map((t) => t.name)), ["run_business_model_calculator"], "one WebMCP tool");
  const def = await p.evaluate(() => { const t = window.__tools[0]; return { d: t.description, s: t.inputSchema }; });
  assert.ok(/Telco Retail/.test(def.d) && /consent/.test(def.d) && def.s.properties.stores.maximum === 5000 && def.s.properties.consent.type === "boolean", "described from the page config");
  const run = (a) => p.evaluate((args) => window.__tools[0].execute(args), a);
  // Figures only: filled, estimate read, nothing downloaded, the person is told what is needed.
  let r = await run({ stores: 100, arpu: 10 });
  assert.ok(!r.isError && r.structuredContent.estimate === "$1000000" && r.structuredContent.inputs.stores === 100, "figures filled, estimate returned");
  assert.ok(/name, company, email and consent/.test(r.content[0].text), "asks the person for their details");
  assert.strictEqual(await p.evaluate(() => window.__posted), null, "no submission without details");
  // Clamped.
  r = await run({ stores: 999999 });
  assert.strictEqual(r.structuredContent.inputs.stores, 5000, "clamped to the field maximum");
  // Details without consent: refused.
  r = await run({ name: "Ann", company: "Acme", email: "ann@acme.com" });
  assert.ok(/agreement|consent/i.test(r.content[0].text) && (await p.evaluate(() => window.__posted)) === null, "no consent, no submission");
  // Details and consent: the form is submitted and the link returned.
  r = await run({ stores: 100, name: "Ann Lee", company: "Acme", email: "ann@acme.com", consent: true });
  assert.ok(!r.isError && /download\?x=1/.test(r.structuredContent.download), "download link returned");
  assert.deepStrictEqual(await p.evaluate(() => window.__posted), { name: "Ann Lee", company: "Acme", email: "ann@acme.com" }, "the page's own form was submitted");
  // Invalid email: not submitted.
  p = await tab("");
  r = await run({ name: "Ann", company: "Acme", email: "nope", consent: true });
  assert.ok(/not accepted/.test(r.content[0].text) && (await p.evaluate(() => window.__posted)) === null, "bad email is not submitted");
  // Analytics event carries no arguments or contact details.
  p = await tab(""); await run({ name: "Zed", email: "z@z.zz" });
  assert.ok(!JSON.stringify(await p.evaluate(() => window.dataLayer)).includes("z@z.zz"), "no contact details in the dataLayer");
  console.log("calc-webmcp: all passed");
} catch (e) { console.error("FAIL:", e.message); process.exitCode = 1; } finally { await browser.close(); }
