// functions/market-core.js: Brand Guidelines › Markets for agents
// (mErc7MPAkrKjF9fWgqXb): the market pages found by mirror key, the page for a
// country, and what goes into Aidan's prompt; plus the real Thailand,
// Singapore and United States files and the missing-market self-check gap.
// Pure: no Firebase, no network.
// Run: node test/market-core.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const mc = require("../functions/market-core");
const ac = require("../functions/aidan-core");

const checks = [];
const check = (name, fn) => checks.push([name, fn]);
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const row = (key, md, extra = {}) => ({ id: key, mirrorKey: key, contentMd: `> Copy.\n\n${md}`, sourcePrefix: "> Copy.\n\n", ...extra });
const REAL = ["thailand", "singapore", "united-states"].map((slug) => row(`brand-market-${slug}`, read(`promote/markets/${slug}.md`)));

check("every brand-market-* mirror is a market, by name; a superseded one and other mirrors are not", () => {
  const list = mc.marketsFrom([
    row("brand-guidelines", "# G"),
    row("brand-partner-mipharmacy", "<!-- partner\nname: miPharmacy\n-->\n# m"),
    row("brand-market-zeta", "<!-- market\nname: Zetaland\ncountries: ZT, ZTA\n-->\n# Zetaland\n\nBody"),
    row("brand-market-gone", "x", { status: "superseded" }),
    ...REAL,
  ]);
  assert.deepStrictEqual(list.map((m) => m.slug), ["singapore", "thailand", "united-states", "zeta"]);
  const z = list.find((m) => m.slug === "zeta");
  assert.strictEqual(z.body, "# Zetaland\n\nBody", "the block and the copy line are removed");
  assert.deepStrictEqual(z.countries, ["zetaland", "zeta", "zt", "zta"]);
});

check("the market for a country: by name, ISO code or a common variant, case and dots ignored; none for an uncovered country", () => {
  const list = mc.marketsFrom(REAL);
  for (const [c, slug] of [["Thailand", "thailand"], ["TH", "thailand"], ["tha", "thailand"], ["Singapore", "singapore"], ["SG", "singapore"],
    ["United States", "united-states"], ["USA", "united-states"], ["U.S.A.", "united-states"], ["US", "united-states"], ["United States of America", "united-states"]]) {
    assert.strictEqual((mc.marketFor(c, list) || {}).slug, slug, c);
  }
  assert.strictEqual(mc.marketFor("Malaysia", list), null);
  assert.strictEqual(mc.marketFor("", list), null);
  assert.strictEqual(mc.marketFor("Thailand", []), null);
});

check("the prompt block is the whole page, agent-only detail included; the system line says it wins on tone, not on claims", () => {
  const th = mc.marketFor("Thailand", mc.marketsFrom(REAL));
  const block = mc.marketBlock(th);
  assert.ok(block.startsWith('<market name="Thailand">') && block.endsWith("</market>"));
  assert.ok(block.includes("## Communication style") && block.includes("## For agents") && block.includes("Khun"), "agents get the agent-only detail");
  assert.ok(!block.includes("<!-- market"), "not the block");
  assert.ok(/<market> wins/.test(mc.marketSystem(th)) && /claims the brand skill and the industry win/.test(mc.marketSystem(th)));
  assert.ok(/keeps its spelling/.test(mc.marketSystem(th)), "Personalisation Hub stays Personalisation Hub in the US");
  assert.strictEqual(mc.marketBlock(null), "");
  assert.ok(/no market page for Malaysia: follow the brand skill's default guidelines/.test(mc.marketSystem(null, "Malaysia")));
  assert.strictEqual(mc.marketSystem(null, ""), "");
  const big = { name: "Big", body: "x".repeat(mc.MARKET_TEXT_BUDGET + 500) };
  assert.ok(mc.marketBlock(big).length < mc.MARKET_TEXT_BUDGET + 100, "capped");
});

check("the real pages: every section the ticket asks for, the right spelling and currency, and declared in board-docs.json", () => {
  const manifest = JSON.parse(read("board-docs.json"));
  for (const [slug, name, spelling, currency] of [["thailand", "Thailand", "UK English", "THB"], ["singapore", "Singapore", "UK English", "SGD"], ["united-states", "United States", "US English", "USD"]]) {
    const md = read(`promote/markets/${slug}.md`);
    const { meta, body } = mc.parseMarketDoc(md);
    assert.deepStrictEqual([meta.slug, meta.name, meta.spelling], [slug, name, spelling], slug);
    assert.ok(meta.currency.includes(currency), slug);
    for (const h of ["## Communication style", "## Cultural sensitivities", "## Local conventions", "## Business etiquette", "## Regulatory notes", "## For agents"]) assert.ok(body.includes(h), `${slug}: ${h}`);
    assert.ok(manifest.mirrors.some((e) => e.key === `brand-market-${slug}` && e.path === `backlog-tracker/promote/markets/${slug}.md`), `${slug} is mirrored, so agents read it over MCP`);
  }
  assert.ok(/monarchy|royal/i.test(read("promote/markets/thailand.md")), "Thailand's royal sensitivities");
  assert.ok(/personalize, color, center/.test(read("promote/markets/united-states.md")), "US spelling");
});

check("a missing market is a self-check gap: one ticket per country, never matched to another country's ticket", () => {
  const f = ac.assessRun({ final: { status: "replied" }, missingMarket: { country: "Malaysia", format: "One-pager" } });
  assert.strictEqual(f.category, "missing-market");
  assert.ok(/^No Brand Guidelines market page for Malaysia\./.test(f.gap) && /one-pager used the default brand guidelines/.test(f.gap));
  assert.ok(/backlog-tracker\/promote\/markets\//.test(f.suggestion) && /No code change/.test(f.suggestion));
  assert.strictEqual(ac.improvementTitle(f), "Aidan missing market page: No Brand Guidelines market page for Malaysia");
  const desc = ac.improvementDesc({ category: f.category, gap: f.gap, suggestion: f.suggestion, instruction: "send me a one-pager for Mydin", ticketKey: "SUP-1", kind: "generate", at: new Date("2026-11-19T00:00:00Z") });
  assert.ok(desc.startsWith("## Outcome\nBrand Guidelines has a Markets page for the market reported below"));
  // The same country keys alike whatever the request; another country does not.
  const k1 = ac.improvementKey(f.category, f.keyText);
  const f2 = ac.assessRun({ final: { status: "replied" }, missingMarket: { country: "Malaysia", format: "Deck" } });
  assert.strictEqual(ac.improvementKey(f2.category, f2.keyText), k1);
  const vn = ac.assessRun({ final: { status: "replied" }, missingMarket: { country: "Vietnam", format: "One-pager" } });
  const kv = ac.improvementKey(vn.category, vn.keyText);
  assert.notStrictEqual(kv, k1);
  const malaysiaTicket = { id: "m1", title: ac.improvementTitle(f), aidanImprovementKey: k1, aidanImprovement: { category: "missing-market", gap: f.gap } };
  assert.strictEqual(ac.matchImprovement({ key: kv, category: "missing-market", gap: vn.gap, title: ac.improvementTitle(vn) }, [], [malaysiaTicket]), null, "Vietnam files its own");
  assert.strictEqual(ac.matchImprovement({ key: k1, category: "missing-market", gap: f2.gap, title: ac.improvementTitle(f2) }, [], [malaysiaTicket]), malaysiaTicket);
  // A failed run is the failure, not the market.
  assert.strictEqual(ac.assessRun({ final: { status: "needs-person", reason: "The branded PDF couldn't be made" }, missingMarket: { country: "Malaysia" } }).category, "failed");
});

(async () => {
  let failed = 0;
  for (const [name, fn] of checks) {
    try { await fn(); console.log(`  ok  ${name}`); } catch (err) { failed += 1; console.error(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
  }
  console.log(failed ? `\n${failed} of ${checks.length} failed` : `\nmarket-core: ${checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
})();
