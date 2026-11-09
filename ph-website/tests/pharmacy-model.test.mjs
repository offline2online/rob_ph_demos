// node ph-website/tests/pharmacy-model.test.mjs : the Pharmacy page calculator (six USD inputs, 3-year output) and its markdown twin.
import fs from "fs"; import { createRequire } from "module";
const require = createRequire(import.meta.url);
const dir = new URL("../snippets/ph-industry-enhancements/", import.meta.url);
const { CALC, pharmCalc } = require(dir.pathname + "enhance.js");
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.error("FAIL: " + m); } };
const p = CALC.pharmacy;
ok(p.model === "pharm", "pharmacy uses the pharm model");
ok(p.inputs.length === 6 && p.assumptions.length === 0, "exactly six inputs, presets hidden");
const ids = p.inputs.map(i => i.id).join(",");
ok(ids === "stores,screens,visits,basket,cpm,uplift", "input order " + ids);
const cpm = p.inputs.find(i => i.id === "cpm");
ok(cpm.def === 25 && cpm.pre === "$" && /indicative/i.test(cpm.tip) && /15.40/.test(cpm.tip) && /10.30/.test(cpm.tip), "CPM default 25 USD with an indicative tooltip");
ok(/daily/i.test(p.inputs[2].label) && !/week/i.test(JSON.stringify(p)), "visits are daily, never weekly");
ok(p.inputs.find(i => i.id === "basket").label.includes("promotable products only"), "basket is promotable products only");
ok(p.nohow === true, "no explanatory copy under the calculator");
const base = { stores: 100, screens: 3, visits: 250, basket: 22, cpm: 25, uplift: 5 };
const r = pharmCalc(base);
ok(Math.abs(r.total - (r.media + r.basket + r.traffic)) < 1e-6, "total is the sum of three streams");
ok(Math.abs(r.media - 3285000) < 1e-6, "media = visits*screens*4 plays*40% fill*CPM/1000*3 years");
ok(pharmCalc({ ...base, cpm: 0 }).media === 0 && pharmCalc({ ...base, uplift: 0 }).basket === 0, "streams respond to their inputs");
ok(pharmCalc({ ...base, basket: 0 }).total === pharmCalc({ ...base, basket: 0 }).media, "no basket value, no non-media revenue");
// copy rules
const js = fs.readFileSync(new URL("enhance.js", dir), "utf8"), md = fs.readFileSync(new URL("md.php", dir), "utf8");
const ph = md.slice(md.indexOf("'pharmacy' =>"), md.indexOf("'retail-media' =>"));
ok(!/\bDSP\b|programmatic/i.test(ph), "pharmacy twin never mentions DSP or programmatic");
ok(!/\bDSP\b|programmatic/i.test(JSON.stringify(p)), "pharmacy calculator never mentions DSP or programmatic");
for (const s of ["## Contextual campaigns on digital signage", "## Seamless handover to the pharmacist and store staff", "## Responsible by design", "front-of-house products only", "aggregate or de-identified data", "local advertising rules for medicines", "never for advertising"]) ok(ph.includes(s), "twin has: " + s);
ok(!/personaliz|\bpersonalize/i.test(ph), "personalisation is spelled with an s");
// gate: the pharmacy calculator offers the same gated business model download as telco
ok(p.gate === true && CALC.telco.gate === true, "pharmacy and telco calculators are gated");
ok(/MODELS\[c\.model\]/.test(js) && !/MODELS\.tel3\(body\.inputs\)/.test(js), "buildGate takes the estimate from the page's model, not hard-coded telco");
ok(/pharmacy-model/.test(js) && /Pharmacy business model download/.test(js), "enhance.js posts pharmacy downloads to the pharmacy endpoint");
// PHP and JS parity on fixtures (pharm_calc in pharmacy-model.php, pharmCalc here)
import { execFileSync } from "child_process";
const fx = [base, { stores: 1, screens: 1, visits: 1, basket: 1, cpm: 0, uplift: 0 }, { stores: 5000, screens: 50, visits: 5000, basket: 500, cpm: 200, uplift: 50 }, { stores: 37, screens: 5, visits: 410, basket: 31.5, cpm: 18, uplift: 7.5 }];
const php = JSON.parse(execFileSync("php", ["-r", `define("PH_TELCO_MODEL_TEST",1);require ${JSON.stringify(dir.pathname + "pharmacy-model.php")};echo json_encode(array_map(function($v){$c=AngieSnippets\\PhIndustryEnhancements_10063\\pharm_calc(AngieSnippets\\PhIndustryEnhancements_10063\\pharm_clean($v));return [$c["media"],$c["basket"],$c["traffic"],$c["total"]];}, json_decode(${JSON.stringify(JSON.stringify(fx))},true)));`]).toString());
fx.forEach((v, i) => { const j = pharmCalc(v), a = [j.media, j.basket, j.traffic, j.total]; ok(a.every((x, k) => Math.abs(x - php[i][k]) <= 1e-6 * Math.max(1, Math.abs(x))), "PHP and JS agree on fixture " + i); });
console.log(bad ? bad + " failed" : "pharmacy-model: all passed"); process.exit(bad ? 1 : 0);
