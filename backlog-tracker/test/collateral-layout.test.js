// functions/collateral-layout.js — the branded page Aidan's sales collateral
// (JtkLrEG0aTnC5JfkdPA1) is printed from: the Markdown -> safe HTML and the
// brand skill's layout. Pure: no Firebase, no network, no browser (the page
// printed in Chromium is test/collateral-render.test.mjs).
// Run: node test/collateral-layout.test.js
"use strict";
const assert = require("assert");
const cc = require("../functions/collateral-core");
const cl = require("../functions/collateral-layout");

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

check("markdownToHtml: the title comes out, everything is escaped, only http(s)/mailto links survive", () => {
  const { title, html } = cl.markdownToHtml("# Win at the shelf\n\nLede with **bold**, *em* and [site](https://personalisationhub.com) <script>alert(1)</script> [bad](javascript:alert(1)).\n\n## Why\n\n- one\n- two\n  continued\n\n1. first\n2. second\n\n> A callout\n\n| A | B |\n|---|---|\n| 1 | <b>2</b> |\n\n---\n\n```\ncode <x>\n```");
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
  const html = cl.collateralHtml({ documentMd: "# Grocery that sells\n\nOpening line.\n\n## One\n\nText.", format: cc.FORMATS.overview, industry: "Grocery & Supermarkets", prospect: { name: "CP Group" }, brand });
  assert.ok(html.includes("<h1>Grocery that sells</h1>") && html.includes('<p class="c-lede">Opening line.</p>'));
  assert.ok(html.includes("Platform overview · Grocery &amp; Supermarkets") && html.includes("Prepared for CP Group"));
  const logo = html.match(/src="data:image\/svg\+xml;base64,([^"]+)"/);
  assert.ok(logo && Buffer.from(logo[1], "base64").toString().includes("<title>full</title>"), "the full-colour logo from the brand skill, never redrawn");
  assert.ok(html.includes(".c-eyebrow { color: #C43D82; }") && !/<\/style><script/i.test(html), "the skill's collateral CSS, unable to close the style element");
  assert.ok(html.includes("Try free on AWS Marketplace →") && html.includes("Or book a demo at personalisationhub.com") && html.includes(cl.BRAND.trialUrl.replace(/&/g, "&amp;")));
  assert.ok(html.includes("#F5F7FB") && html.includes("#1C2540") && html.includes("Kantumruy Pro") && html.includes("#0F7A9A"));
  assert.ok(!/[–—]/.test(html), "no long dash in the layout's own copy");
  assert.ok(!/<script/i.test(html.replace(/&lt;script/g, "")));
  assert.ok(cl.collateralHtml({ documentMd: "Body only.", title: "From the title", format: cc.FORMATS["one-pager"] }).includes("<h1>From the title</h1>"));
  assert.ok(cl.collateralHtml({ documentMd: "x", format: cc.FORMATS.deck }).includes("A4 landscape"));
  assert.deepStrictEqual(cl.brandAssets({ files: [{ path: "logos/ph_logo_full_color.svg", content: "not an svg" }] }), { logoSvg: "", css: "" });
  assert.ok(cl.footerTemplate().includes("pageNumber") && cl.footerTemplate().includes("personalisationhub.com"));
  assert.deepStrictEqual(cc.promptFiles(brand).files.map((f) => f.path), ["SKILL.md"], "the model reads the guidelines, not the logo files or CSS");
  assert.strictEqual(cc.brandSkillIn([{ slug: "x" }, { slug: "ph-brand", id: "b" }]).id, "b");
  assert.strictEqual(cc.brandSkillIn([{ slug: "x" }]), null);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of checks) {
    try { await fn(); console.log(`  ok  ${name}`); } catch (err) { failed += 1; console.error(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
  }
  console.log(failed ? `\n${failed} of ${checks.length} failed` : `\ncollateral-layout: ${checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
})();
