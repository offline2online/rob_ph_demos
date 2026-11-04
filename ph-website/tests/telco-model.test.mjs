// node ph-website/tests/telco-model.test.mjs : the page's JS formulas equal the PHP formulas (and the reference workbook).
import fs from "fs"; import vm from "vm"; import { execSync } from "child_process";
const src = fs.readFileSync(new URL("../snippets/ph-industry-enhancements/enhance.js", import.meta.url), "utf8");
const fn = src.slice(src.indexOf("function telcoCalc"), src.indexOf("var MODELS"));
const telcoCalc = vm.runInNewContext("(" + fn.trim().replace(/\}\s*$/, "}") + ")");
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.error("FAIL: " + m); } };
const cases = [{ stores: 58, footfall: 95, conv: 15, arpu: 49, walk: 1, uplift: 15, churn: 2 }, { stores: 120, footfall: 70, conv: 12, arpu: 60, walk: 2, uplift: 20, churn: 1.5 }];
for (const v of cases) {
  const php = JSON.parse(execSync(`php -r 'define("PH_TELCO_MODEL_TEST",1);require "${new URL("../snippets/ph-industry-enhancements/telco-model.php", import.meta.url).pathname}";echo json_encode(\\AngieSnippets\\PhIndustryEnhancements_10063\\telco_calc(json_decode($argv[1],true)));' '${JSON.stringify(v)}'`).toString());
  const js = telcoCalc(v);
  ok(Math.abs(js.total - php.total) < 0.01, "total " + js.total + " vs " + php.total);
  ok(Math.abs(js.runRate - php.runRate) < 0.01 && Math.abs(js.base - php.base) < 0.001, "run rate/base");
  js.years.forEach((y, i) => ok(Math.abs(y.total - php.years[i].total) < 0.01, "year " + (i + 1)));
}
ok(Math.abs(telcoCalc(cases[0]).total - 72307145.4010927) < 0.01, "reference workbook total");
// page defaults equal the spec defaults
const spec = JSON.parse(execSync(`php -r 'define("PH_TELCO_MODEL_TEST",1);require "${new URL("../snippets/ph-industry-enhancements/telco-model.php", import.meta.url).pathname}";echo json_encode(\\AngieSnippets\\PhIndustryEnhancements_10063\\telco_spec());'`).toString());
const calc = JSON.parse(src.match(/var CALC = (\{.*\});\n/)[1]).telco;
for (const f of spec.fields) { const p = calc.inputs.concat(calc.assumptions).find(x => x.id === f.id); ok(p && p.def === f.def && p.min <= f.min && (!p.max || p.max <= f.max), "page field " + f.id + " matches spec"); }
console.log(bad ? bad + " failed" : "telco-model js: all passed"); process.exit(bad ? 1 : 0);
