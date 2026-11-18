// functions/collateral-core.js — Aidan's branded sales collateral
// (JtkLrEG0aTnC5JfkdPA1): which collateral an instruction asks for, the
// prospect's facts (industry and country only), the guard that keeps
// Australian positioning and internal names out, the Markdown -> HTML, the
// branded page, and the PDF printer's request filter (functions/collateral-pdf.js).
// Pure: no Firebase, no network, no browser.
// Run: node test/collateral-core.test.js
"use strict";
const assert = require("assert");
const cc = require("../functions/collateral-core");
const { allowedRequest } = require("../functions/collateral-pdf");

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
  assert.ok(cc.guardLine(g.changes).startsWith("Removed from the collateral before it was sent: 3 sentences placing Personalisation Hub in Australia"));
  assert.strictEqual(cc.guardLine([]), "");
  // An Australian retailer may be named in its own country; we still aren't based there.
  const au = cc.guardCollateral("Kestrel runs 400 stores across Australia. Personalisation Hub was founded in Sydney.", { prospectCountry: "Australia" });
  assert.strictEqual(au.text, "Kestrel runs 400 stores across Australia.");
  assert.deepStrictEqual(cc.guardCollateral("Nothing to change here.", {}), { text: "Nothing to change here.", changes: [] });
});

check("collateralSystem: a page budget per format, global positioning, the banned names and the brand skill's CTA left to the layout", () => {
  const s = cc.collateralSystem({ format: cc.FORMATS["one-pager"], industry: "Pharmacy", prospect: { name: "Heron" }, internalNames: ["Retail Media Insights & Analytics Dashboards"] });
  assert.ok(s.includes("exactly one A4 page") && s.includes("Heron, a retailer in Pharmacy"));
  assert.ok(/global company: never mention Sydney, Australia/.test(s));
  assert.ok(s.includes("PH Core") && s.includes("Retail Media Insights & Analytics Dashboards") && s.includes("Backlog Tracker"));
  assert.ok(/brand_skill/.test(s) && /Do not write a call to action/.test(s) && /never invent statistics/i.test(s) && /revenue/.test(s));
  assert.ok(cc.collateralSystem({ format: cc.FORMATS.deck }).includes("its own page"));
});

check("markdownToHtml: the title comes out, everything is escaped, only http(s)/mailto links survive", () => {
  const { title, html } = cc.markdownToHtml("# Win at the shelf\n\nLede with **bold**, *em* and [site](https://personalisationhub.com) <script>alert(1)</script> [bad](javascript:alert(1)).\n\n## Why\n\n- one\n- two\n  continued\n\n1. first\n2. second\n\n> A callout\n\n| A | B |\n|---|---|\n| 1 | <b>2</b> |\n\n---\n\n```\ncode <x>\n```");
  assert.strictEqual(title, "Win at the shelf");
  assert.ok(!html.includes("<h1>"), "the title is the layout's headline, not repeated");
  assert.ok(html.includes("<strong>bold</strong>") && html.includes("<em>em</em>") && html.includes('<a href="https://personalisationhub.com">site</a>'));
  assert.ok(!/<script|javascript:|<b>/i.test(html) && html.includes("&lt;script&gt;") && html.includes("&lt;b&gt;2&lt;/b&gt;"), html);
  assert.ok(html.includes("<ul><li>one</li><li>two continued</li></ul>") && html.includes("<ol><li>first</li><li>second</li></ol>"));
  assert.ok(html.includes("<blockquote>A callout</blockquote>") && html.includes("<th>A</th>") && html.includes("<hr>") && html.includes("<pre>code &lt;x&gt;</pre>"));
});

check("collateralHtml: the brand skill's layout (light surface, the full-colour logo from the skill, its collateral CSS), the eyebrow, the CTA; no script", () => {
  const brand = { slug: "ph-brand", files: [
    { path: "SKILL.md", content: "# Brand" },
    { path: "logos/ph_logo_white.svg", content: "<svg xmlns='http://www.w3.org/2000/svg'><title>white</title></svg>" },
    { path: "logos/ph_logo_full_color.svg", content: "<svg xmlns='http://www.w3.org/2000/svg'><title>full</title></svg>" },
    { path: "templates/collateral.css", content: ".c-eyebrow { color: #C43D82; }</style><script>x</script>" },
  ] };
  const html = cc.collateralHtml({ documentMd: "# Grocery that sells\n\nOpening line.\n\n## One\n\nText.", format: cc.FORMATS.overview, industry: "Grocery & Supermarkets", prospect: { name: "CP Group" }, brand });
  assert.ok(html.includes("<h1>Grocery that sells</h1>") && html.includes('<p class="c-lede">Opening line.</p>'));
  assert.ok(html.includes("Platform overview · Grocery &amp; Supermarkets") && html.includes("Prepared for CP Group"));
  const logo = html.match(/src="data:image\/svg\+xml;base64,([^"]+)"/);
  assert.ok(logo && Buffer.from(logo[1], "base64").toString().includes("<title>full</title>"), "the full-colour logo from the brand skill, never redrawn");
  assert.ok(html.includes(".c-eyebrow { color: #C43D82; }") && !/<\/style><script/i.test(html), "the skill's collateral CSS, unable to close the style element");
  assert.ok(html.includes("Try free on AWS Marketplace →") && html.includes("Or book a demo at personalisationhub.com") && html.includes(cc.BRAND.trialUrl.replace(/&/g, "&amp;")));
  assert.ok(html.includes("#F5F7FB") && html.includes("#1C2540") && html.includes("Kantumruy Pro") && html.includes("#0F7A9A"));
  assert.ok(!/[–—]/.test(html), "no long dash in the layout's own copy");
  assert.ok(!/<script/i.test(html.replace(/&lt;script/g, "")));
  assert.ok(cc.collateralHtml({ documentMd: "Body only.", title: "From the title", format: cc.FORMATS["one-pager"] }).includes("<h1>From the title</h1>"));
  assert.ok(cc.collateralHtml({ documentMd: "x", format: cc.FORMATS.deck }).includes("A4 landscape"));
  assert.deepStrictEqual(cc.brandAssets({ files: [{ path: "logos/ph_logo_full_color.svg", content: "not an svg" }] }), { logoSvg: "", css: "" });
  assert.ok(cc.footerTemplate().includes("pageNumber") && cc.footerTemplate().includes("personalisationhub.com"));
  assert.deepStrictEqual(cc.promptFiles(brand).files.map((f) => f.path), ["SKILL.md"], "the model reads the guidelines, not the logo files or CSS");
  assert.strictEqual(cc.brandSkillIn([{ slug: "x" }, { slug: "ph-brand", id: "b" }]).id, "b");
  assert.strictEqual(cc.brandSkillIn([{ slug: "x" }]), null);
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

check("collateral-pdf allowedRequest: the printed page reaches only data: URIs and the brand font", () => {
  assert.strictEqual(allowedRequest("data:image/svg+xml;base64,AAAA"), true);
  assert.strictEqual(allowedRequest("https://fonts.googleapis.com/css2?family=Kantumruy+Pro"), true);
  assert.strictEqual(allowedRequest("https://fonts.gstatic.com/s/x.woff2"), true);
  assert.strictEqual(allowedRequest("http://fonts.gstatic.com/s/x.woff2"), false);
  assert.strictEqual(allowedRequest("https://evil.example/x.png"), false);
  assert.strictEqual(allowedRequest("https://fonts.googleapis.com.evil.example/"), false);
  assert.strictEqual(allowedRequest("http://169.254.169.254/computeMetadata/v1/"), false);
  assert.strictEqual(allowedRequest("file:///etc/passwd"), false);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of checks) {
    try { await fn(); console.log(`  ok  ${name}`); } catch (err) { failed += 1; console.error(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
  }
  console.log(failed ? `\n${failed} of ${checks.length} failed` : `\ncollateral-core: ${checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
})();
