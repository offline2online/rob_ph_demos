// functions/collateral-core.js — Aidan's branded sales collateral
// (JtkLrEG0aTnC5JfkdPA1): which collateral an instruction asks for, the
// prospect's facts (industry and country only), the guard that keeps
// Australian positioning, internal names and long dashes out, the page count
// and file names. The branded page is test/collateral-layout.test.js; the PDF
// printer (request filter, timeout) is test/collateral-pdf.test.js.
// Pure: no Firebase, no network, no browser.
// Run: node test/collateral-core.test.js
"use strict";
const assert = require("assert");
const cc = require("../functions/collateral-core");

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

check("collateralFormat: the instruction's own words name the collateral; anything else is an ordinary write", () => {
  const f = (s) => (cc.collateralFormat(s) || {}).key || null;
  assert.strictEqual(f("send me a one-pager for Kestrel"), "one-pager");
  assert.strictEqual(f("please send a one page summary for Heron"), "one-pager");
  assert.strictEqual(f("send the fact sheet for Heron"), "one-pager");
  assert.strictEqual(f("prepare a platform overview for CP Group for my AWS contact, retail grocery"), "overview");
  assert.strictEqual(f("prepare a platform overview for Boots in pharmacy"), "overview");
  assert.strictEqual(f("write a brochure for Kestrel"), "overview");
  assert.strictEqual(f("write a feature deep-dive on shelf edge for Tesco grocery"), "deep-dive");
  assert.strictEqual(f("build a sales deck for Kestrel"), "deck");
  assert.strictEqual(f("send the AWS onboarding pack for client Kestrel"), null, "a skill's own document is not collateral");
  assert.strictEqual(f("write the POC summary for Kestrel"), null);
  assert.strictEqual(f("summarise the backlog in a one-pager"), null, "console data is never collateral: it goes to allowed senders only");
  assert.strictEqual(f("send me an overview of the Kestrel POC"), null, "a bare 'overview' is not a platform overview");
  assert.strictEqual(f(""), null);
  for (const k of Object.keys(cc.FORMATS)) assert.ok(cc.FORMATS[k].label && cc.FORMATS[k].pages && cc.FORMATS[k].maxTokens <= 16000, k);
  assert.strictEqual(cc.FORMATS.deck.landscape, true);
});

check("prospectFor: the named company from Prospects (TAM), then Leads, reduced to name, industry and country; never revenue, stores, contacts or notes", () => {
  const prospects = [{ name: "CP Group", country: "Thailand", industry: "grocery", storeCount: 13000, revenue: "USD 60bn", insights: "secret", contacts: [{ name: "A", email: "a@cp.example" }], notes: "n" }];
  const leads = [{ company: { name: "Heron Pharmacy", industry: "Pharmacy", countries: ["United Kingdom"], storeCount: 40 }, contacts: [{ email: "x@heron.example" }] }];
  const p = cc.prospectFor({ instruction: "prepare a platform overview for CP Group for my AWS contact, retail grocery", prospects, leads });
  assert.deepStrictEqual(p, { name: "CP Group", industry: "Grocery & Supermarkets", country: "Thailand", source: "prospect" });
  assert.deepStrictEqual(cc.prospectFor({ instruction: "send me a one-pager for heron pharmacy", client: "Heron Pharmacy", prospects, leads }), { name: "Heron Pharmacy", industry: "Pharmacy", country: "United Kingdom", source: "lead" });
  assert.deepStrictEqual(cc.prospectFor({ instruction: "send me a one-pager for Kestrel", prospects, leads }), { name: "Kestrel", industry: "", country: "", source: "" }, "named but not on the console");
  assert.strictEqual(cc.prospectFor({ instruction: "send me a one-pager" }), null);
  assert.deepStrictEqual(cc.namesIn("prepare a platform overview for CP Group for my AWS contact"), ["CP Group"]);
  const block = cc.prospectBlock(p, "Grocery & Supermarkets");
  assert.ok(block.includes("Company: CP Group") && block.includes("Country: Thailand") && block.includes("Grocery & Supermarkets"));
  assert.ok(!/13000|60bn|secret|a@cp\.example/.test(block), "only the three facts reach the prompt");
});

check("industryFor: the retailer's vertical from the instruction, else the prospect's record", () => {
  assert.strictEqual(cc.industryFor("prepare a platform overview for CP Group, retail grocery", { name: "CP Group", industry: "" }), "Grocery & Supermarkets");
  assert.strictEqual(cc.industryFor("prepare a platform overview for Kestrel in pharmacy", null), "Pharmacy");
  assert.strictEqual(cc.industryFor("send me a one-pager for Heron", { name: "Heron", industry: "Pharmacy" }), "Pharmacy");
  assert.strictEqual(cc.industryFor("send me a one-pager for Bankside Foods", { name: "Bankside Foods", industry: "" }), "", "the company's own name is not an industry");
});

check("guardCollateral: no Sydney/Australia positioning, no internal names, brand renames, no long dashes; what changed is counted", () => {
  const md = [
    "# Grocery that sells more",
    "",
    "Personalisation Hub is a Sydney-based company. It helps grocers win at the shelf. Built on PH Core, the Backlog Tracker keeps it moving — always.",
    "",
    "## Made in Australia",
    "",
    "- Proudly Australian. Runs in your own cloud.",
    "- Pilots of 3–5 stores — in weeks",
    "- Autonomous Shopfront and Context360 work together.",
    "",
    "| Capability | Detail |",
    "|---|---|",
    "| Live Visitor Profile | Knows who is walking past |",
    "| Display Types & DSP Integration | internal |",
  ].join("\n");
  const g = cc.guardCollateral(md, { internalNames: ["Display Types & DSP Integration"] });
  assert.ok(!/sydney|australia|australian/i.test(g.text), g.text);
  assert.ok(!/Backlog Tracker|PH Core|Autonomous Shopfront|Context360|Live Visitor Profile|Display Types/.test(g.text), g.text);
  assert.ok(!/[–—]/.test(g.text), "no long dash left");
  assert.ok(g.text.includes("It helps grocers win at the shelf.") && g.text.includes("- Runs in your own cloud.") && g.text.includes("Pilots of 3 to 5 stores, in weeks"), g.text);
  assert.ok(g.text.includes("Shopfront signage and Smart shelves work together.") && g.text.includes("| real-time visitor profiles |"), g.text);
  assert.ok(!g.text.includes("## Made in"), "a heading that places us in Australia goes");
  const by = Object.fromEntries(g.changes.map((c) => [c.rule, c.count]));
  assert.deepStrictEqual([by.australia, by.internal > 0, by.renamed >= 3, by.dashes >= 2], [3, true, true, true]);
  assert.ok(cc.guardLine(g.changes).startsWith("Removed from the collateral before it was sent: 3 sentences naming Sydney or Australia"));
  assert.strictEqual(cc.guardLine([]), "");
  // An Australian retailer may be named in its own country; we still aren't based there.
  const au = cc.guardCollateral("Kestrel runs 400 stores across Australia. Personalisation Hub was founded in Sydney.", { prospectCountry: "Australia" });
  assert.strictEqual(au.text, "Kestrel runs 400 stores across Australia.");
  assert.deepStrictEqual(cc.guardCollateral("Nothing to change here.", {}), { text: "Nothing to change here.", changes: [] });
});

check("guardCollateral: no long dash survives, unspaced ones included: 'to' for a range between words, a hyphen otherwise", () => {
  const g = cc.guardCollateral("Open Monday–Friday with end–to–end service.");
  assert.strictEqual(g.text, "Open Monday to Friday with end-to-end service.");
  assert.deepStrictEqual(g.changes, [{ rule: "dashes", count: 3 }]);
  const cases = {
    "Open Monday–Friday with end–to–end service": "Open Monday to Friday with end-to-end service",
    "Trading hours 9am–5pm, Mon–Sat, Q1–Q3": "Trading hours 9am to 5pm, Mon to Sat, Q1 to Q3",
    "A co–op café–bar": "A co-op café-bar",
    "Faster—and simpler": "Faster, and simpler",
    "Faster―and simpler": "Faster, and simpler",
    "Pilots of 3–5 stores — in weeks": "Pilots of 3 to 5 stores, in weeks",
    "One side –spaced": "One side -spaced",
  };
  for (const [input, want] of Object.entries(cases)) {
    const out = cc.guardCollateral(input).text;
    assert.strictEqual(out, want, input);
    assert.ok(!/[–—―]/.test(out), `no en dash, em dash or horizontal bar left in: ${out}`);
  }
  // Title and list markers keep their place; a heading's dash goes too.
  const md = cc.guardCollateral("# Grocery–ready\n\n- Week–by–week reporting\n- Jan–Mar pilots").text;
  assert.strictEqual(md, "# Grocery-ready\n\n- Week-by-week reporting\n- Jan to Mar pilots");
  assert.ok(cc.guardLine([{ rule: "australia", count: 1 }]).includes("1 sentence naming Sydney or Australia"), "the label says what the code removes");
});

check("collateralSystem: a page budget per format, global positioning, the banned names and the brand skill's CTA left to the layout", () => {
  const s = cc.collateralSystem({ format: cc.FORMATS["one-pager"], industry: "Pharmacy", prospect: { name: "Heron" }, internalNames: ["Retail Media Insights & Analytics Dashboards"] });
  assert.ok(s.includes("exactly one A4 page") && s.includes("Heron, a retailer in Pharmacy"));
  assert.ok(/global company: never mention Sydney, Australia/.test(s));
  assert.ok(s.includes("PH Core") && s.includes("Retail Media Insights & Analytics Dashboards") && s.includes("Backlog Tracker"));
  assert.ok(/brand_skill/.test(s) && /Do not write a call to action/.test(s) && /never invent statistics/i.test(s) && /revenue/.test(s));
  assert.ok(cc.collateralSystem({ format: cc.FORMATS.deck }).includes("its own page"));
});

check("helpCentreBlock: published articles on the website, the industry's first, within a budget", () => {
  const arts = [
    { title: "Targeting by daypart", summary: "Schedule content", categoryName: "Campaigns" },
    { title: "Pharmacy case study", summary: "How a pharmacy chain lifted conversion", categoryName: "Case studies" },
    { title: "Hidden one", summary: "internal", hiddenFromWebsite: true },
  ];
  const b = cc.helpCentreBlock(arts, "Pharmacy");
  assert.ok(b.startsWith("<help_centre>\n- Pharmacy case study"), b);
  assert.ok(!b.includes("Hidden one"));
  assert.strictEqual(cc.helpCentreBlock([], ""), "");
  const many = Array.from({ length: 400 }, (_, i) => ({ title: `Article ${i}`, summary: "x".repeat(300) }));
  assert.ok(cc.helpCentreBlock(many).length <= cc.HELP_CENTRE_BUDGET + 40);
});

check("pdfPageCount, isPdf, fileNames", () => {
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Pages /Count 2 >>\n2 0 obj << /Type /Page >>\n3 0 obj << /Type/Page >>\n" + " ".repeat(80), "latin1");
  assert.strictEqual(cc.pdfPageCount(pdf), 2);
  assert.strictEqual(cc.isPdf(pdf), true);
  assert.strictEqual(cc.isPdf(Buffer.from("not a pdf")), false);
  assert.deepStrictEqual(cc.fileNames("cp-group-platform-overview.md", "x"), { md: "cp-group-platform-overview.md", pdf: "cp-group-platform-overview.pdf" });
  assert.deepStrictEqual(cc.fileNames("", "Grocery that sells"), { md: "grocery-that-sells.md", pdf: "grocery-that-sells.pdf" });
});

(async () => {
  let failed = 0;
  for (const [name, fn] of checks) {
    try { await fn(); console.log(`  ok  ${name}`); } catch (err) { failed += 1; console.error(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
  }
  console.log(failed ? `\n${failed} of ${checks.length} failed` : `\ncollateral-core: ${checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
})();
