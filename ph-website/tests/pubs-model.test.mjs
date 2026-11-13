// node ph-website/tests/pubs-model.test.mjs : the Pubs & Hospitality page calculator (five USD inputs, 3-year output) and its markdown twin.
import fs from "fs"; import { createRequire } from "module"; import { execFileSync } from "child_process";
const require = createRequire(import.meta.url);
const dir = new URL("../snippets/ph-industry-enhancements/", import.meta.url);
const { CALC, pubsCalc, MODELS } = require(dir.pathname + "enhance.js");
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.error("FAIL: " + m); } };
const p = CALC.hospitality;
ok(p.model === "pubs", "the hospitality page uses the pubs model");
ok(p.gate === true && p.relabel === true, "gated download; rows rebuilt to the five fields");
const ids = p.inputs.concat(p.assumptions).map(i => i.id).join(",");
ok(ids === "venues,guests,revenue,reach,uplift", "field order " + ids);
const f = Object.fromEntries(p.inputs.concat(p.assumptions).map(i => [i.id, i]));
ok(f.venues.def === 50 && f.guests.def === 200 && f.revenue.def === 45 && f.revenue.pre === "$", "venues 50, guests 200, $45 per head");
ok(f.reach.def === 60 && f.reach.max === 100 && /Share of guests reached by personalised offers/.test(f.reach.label), "new reach input, default 60%");
ok(f.uplift.def === 5 && f.uplift.max === 50 && /Uplift in revenue per head from personalised offers/.test(f.uplift.label), "uplift default 5%, not 10%");
const base = { venues: 50, guests: 200, revenue: 45, reach: 60, uplift: 5 };
const r = pubsCalc(base);
ok(Math.abs(r.annual - 4927500) < 1e-6, "defaults give 4,927,500 a year: " + r.annual);
ok(Math.abs(r.total - 3 * r.annual) < 1e-6 && Math.abs(r.runRate * 36 - r.total) < 1e-6, "3-year total and month-36 run rate");
ok(pubsCalc({ ...base, reach: 0 }).total === 0 && pubsCalc({ ...base, uplift: 0 }).total === 0, "no reach or no uplift, no revenue");
ok(Math.abs(pubsCalc({ ...base, reach: 100 }).annual / r.annual - 100 / 60) < 1e-9, "revenue scales with reach");
const m = MODELS.pubs(base);
ok(m.total === r.total && /Revenue per head/.test(m.rows[0][0]) && m.rows[0][1] === "$45.00 → $47.25", "hero row leads with average revenue per head: " + m.rows[0][1]);
ok(!/drink/i.test(JSON.stringify(p) + JSON.stringify(m.rows)), "led by revenue per head, not drinks");
// copy rules
const js = fs.readFileSync(new URL("enhance.js", dir), "utf8"), md = fs.readFileSync(new URL("md.php", dir), "utf8");
const tw = md.slice(md.indexOf("'hospitality' =>"), md.indexOf("'telco' =>"));
ok(/share of guests reached by personalised offers \(default 60%/.test(tw) && /uplift in revenue per head from personalised offers \(default 5%\)/.test(tw), "twin describes the new model");
ok(/36-month business model workbook \(\.xlsx\)/.test(tw) && /full name, company and work email/.test(tw), "twin describes the gated workbook");
ok(!/default 10%/.test(tw), "twin no longer says 10%");
ok(!/personaliz|\bpersonalize/i.test(tw + JSON.stringify(p)), "personalisation is spelled with an s");
ok(/pubs-model/.test(js) && /Pubs & Hospitality business model download/.test(js), "enhance.js posts pubs downloads to the pubs endpoint");
ok(CALC.pharmacy.gate === true && CALC.telco.gate === true && CALC.pharmacy.model === "pharm" && CALC.telco.model === "tel3" && CALC.convenience.model === "conv" && !CALC.convenience.gate, "telco, pharmacy and fuel & convenience unchanged");
// PHP and JS parity on fixtures (pubs_calc in pubs-model.php, pubsCalc here)
const fx = [base, { venues: 1, guests: 1, revenue: 1, reach: 0, uplift: 0 }, { venues: 5000, guests: 5000, revenue: 500, reach: 100, uplift: 50 }, { venues: 37, guests: 410, revenue: 31.5, reach: 45, uplift: 7.5 }];
const php = JSON.parse(execFileSync("php", ["-r", `define("PH_TELCO_MODEL_TEST",1);require ${JSON.stringify(dir.pathname + "pubs-model.php")};echo json_encode(array_map(function($v){$c=AngieSnippets\\PhIndustryEnhancements_10063\\pubs_calc(AngieSnippets\\PhIndustryEnhancements_10063\\pubs_clean($v));return [$c["annual"],$c["total"],$c["runRate"]];}, json_decode(${JSON.stringify(JSON.stringify(fx))},true)));`]).toString());
fx.forEach((v, i) => { const j = pubsCalc(v), a = [j.annual, j.total, j.runRate]; ok(a.every((x, k) => Math.abs(x - php[i][k]) <= 1e-6 * Math.max(1, Math.abs(x))), "PHP and JS agree on fixture " + i); });
console.log(bad ? bad + " failed" : "pubs-model: all passed"); process.exit(bad ? 1 : 0);
