// Promote section: routes, nav ids and how a page finds its mirrored documents.
// Run with:  node test/promote-section.test.mjs
import assert from "node:assert";
import { PROMOTE_PAGES, promotePageFromHash, promoteHash, promoteNavId, mirrorBody, promoteDocsFor, teamFacingMd, brandHeaderHtml, promotePartnerFromHash, partnerHash, parsePartnerDoc, partnersFrom, partnersListHtml, partnerLockupHtml, PARTNER_MIRROR_PREFIX, promoteMarketFromHash, marketHash, parseMarketDoc, marketsFrom, marketsListHtml, MARKET_MIRROR_PREFIX } from "../public/js/promote-section.js";

assert.strictEqual(promotePageFromHash("#promote"), "brand-guidelines");
assert.strictEqual(promotePageFromHash("#promote/brand-guidelines"), "brand-guidelines");
assert.strictEqual(promotePageFromHash("#promote/nope"), "brand-guidelines", "unknown sub-page falls back to the first");
assert.strictEqual(promotePageFromHash("#settings/projects"), null);
assert.strictEqual(promotePageFromHash("#promoted"), null);
assert.strictEqual(promoteHash("brand-guidelines"), "#promote/brand-guidelines");
assert.strictEqual(promoteNavId("#promote/brand-guidelines"), "promote-brand-btn");
assert.strictEqual(promoteNavId("#skills"), null);
assert.ok(PROMOTE_PAGES.every((p) => p.navId));
assert.ok(PROMOTE_PAGES.filter((p) => p.key !== "leads" && p.key !== "prospects" && p.key !== "conversion-funnel").every((p) => p.docs.guidelines));
assert.deepStrictEqual(PROMOTE_PAGES.map((p) => p.key), ["brand-guidelines", "leads", "prospects", "conversion-funnel"], "Leads sits beneath Brand Guidelines, Prospects (TAM) below Leads, Conversion Funnel below Prospects");
assert.strictEqual(promotePageFromHash("#promote/prospects"), "prospects");
assert.strictEqual(promoteHash("prospects"), "#promote/prospects");
assert.strictEqual(promoteNavId("#promote/prospects"), "promote-prospects-btn");
assert.strictEqual(promotePageFromHash("#promote/conversion-funnel"), "conversion-funnel");
assert.strictEqual(promoteNavId("#promote/conversion-funnel"), "promote-funnel-btn");
assert.strictEqual(promotePageFromHash("#promote/leads"), "leads");
assert.strictEqual(promoteHash("leads"), "#promote/leads");
assert.strictEqual(promoteNavId("#promote/leads"), "promote-leads-btn");
assert.deepStrictEqual(promoteDocsFor("leads", [{ id: "b", mirrorKey: "brand-guidelines", contentMd: "x" }]), {}, "Leads shows no mirrored documents");

assert.strictEqual(mirrorBody({ contentMd: "> Copy\n\n# Hi", sourcePrefix: "> Copy\n\n" }), "# Hi");
assert.strictEqual(mirrorBody({ contentMd: "# Hi", sourcePrefix: "> Copy\n\n" }), "# Hi", "a body without the prefix is left alone");
assert.strictEqual(mirrorBody(null), "");

const rows = [
  { id: "a", mirrorKey: "other", contentMd: "x" },
  { id: "b", mirrorKey: "brand-guidelines", name: "G", contentMd: "P\n\nBody", sourcePrefix: "P\n\n", sourcePath: "backlog-tracker/promote/brand-guidelines.md" },
];
const d = promoteDocsFor("brand-guidelines", rows);
assert.strictEqual(d.guidelines.body, "Body");
assert.strictEqual(d.requirements, null, "a document not yet copied is null");
assert.deepStrictEqual(promoteDocsFor("brand-guidelines", []), { guidelines: null, requirements: null });

// Team view strips agent-only sections; the header is the visual brand block.
const full = "# T\n\n## Look\n\nShown.\n\n<!-- agent-only:start -->\n\n## Rules\n\nHidden.\n\n<!-- agent-only:end -->\n\n## Voice\n\nAlso shown.\n";
const team = teamFacingMd(full);
assert.ok(team.includes("Shown.") && team.includes("Also shown.") && !team.includes("Hidden.") && !team.includes("Rules") && !team.includes("agent-only"));
assert.ok(!teamFacingMd("a\n<!-- agent-only:start -->\nb").includes("b"), "an unclosed marker hides the rest");
assert.strictEqual(teamFacingMd(null), "");
const hdr = brandHeaderHtml();
assert.ok(hdr.includes("Make every store visit worth more") && !hdr.includes("into revenue"));
assert.ok(hdr.includes("#169BC2") && hdr.includes("Kantumruy Pro") && (hdr.match(/class="brand-bar"/g) || []).length === 4);
// The real file: nothing for agents leaks into the team view, the old line is gone, MCP still gets everything.
import { readFileSync } from "node:fs";
const real = readFileSync(new URL("../promote/brand-guidelines.md", import.meta.url), "utf8");
const realTeam = teamFacingMd(real);
for (const h of ["## Messaging rules", "## Front doors", "## Audiences", "## Funnel stages", "## Reusable templates", "## Brand assets", "## Joint promotions with AWS", "## End goal: automated LinkedIn", "9fc093677d4c581658daa4f02bb7eb4b"]) {
  assert.ok(real.includes(h), `the full file keeps ${h} for agents`);
  assert.ok(!realTeam.includes(h), `the team view hides ${h}`);
}
for (const h of ["Logo usage", "## Colour", "The infinity loop", "## Typography", "Imagery and icons", "The two-surface system", "Founder tone of voice", "Message house"]) assert.ok(realTeam.includes(h), `the team view shows ${h}`);
assert.ok(real.includes("Make every store visit worth more") && !/into revenue/i.test(real), "umbrella line updated in the guidelines");
assert.ok(!/into revenue/i.test(readFileSync(new URL("../promote/brand-requirements.md", import.meta.url), "utf8")), "and in the requirements");

// Partners (ZvkZpVZBXCDHb34MQegP): one page per partner, found by mirror key, no code per partner.
assert.strictEqual(promotePageFromHash("#promote/brand-guidelines/partners/mipharmacy"), "brand-guidelines", "a partner page is part of Brand Guidelines");
assert.strictEqual(promoteNavId("#promote/brand-guidelines/partners/mipharmacy"), "promote-brand-btn");
assert.strictEqual(promotePartnerFromHash("#promote/brand-guidelines/partners/mipharmacy"), "mipharmacy");
assert.strictEqual(promotePartnerFromHash("#promote/brand-guidelines"), null);
assert.strictEqual(promotePartnerFromHash("#promote/brand-guidelines/partners/<x>"), null, "a slug is plain");
assert.strictEqual(partnerHash("mipharmacy"), "#promote/brand-guidelines/partners/mipharmacy");
const pd = parsePartnerDoc("<!-- partner\nname: Acme\nindustry: Grocery\nlogoLight: https://x.example/a.svg\nlogoDark:\n-->\n# Acme\n\nBody");
assert.deepStrictEqual(pd.meta, { name: "Acme", industry: "Grocery", logoLight: "https://x.example/a.svg", logoDark: "" });
assert.strictEqual(pd.body, "# Acme\n\nBody");
assert.strictEqual(parsePartnerDoc("# Plain").body, "# Plain", "a file with no block is left alone");
const prow = (key, md, extra = {}) => ({ id: key, mirrorKey: key, contentMd: "P\n\n" + md, sourcePrefix: "P\n\n", ...extra });
const plist = partnersFrom([
  prow("brand-guidelines", "# G"),
  prow(`${PARTNER_MIRROR_PREFIX}zeta`, "<!-- partner\nname: Zeta Co\n-->\nZ"),
  prow(`${PARTNER_MIRROR_PREFIX}mipharmacy`, "<!-- partner\nname: miPharmacy\nindustry: Pharmacy\n-->\n# miPharmacy"),
  prow(`${PARTNER_MIRROR_PREFIX}gone`, "x", { status: "superseded" }),
]);
assert.deepStrictEqual(plist.map((p) => p.slug), ["mipharmacy", "zeta"], "every brand-partner-* mirror is listed, by name; a superseded one is not");
assert.strictEqual(plist[0].body, "# miPharmacy");
const lhtml = partnersListHtml(plist);
assert.ok(lhtml.includes("Partners") && lhtml.includes('href="#promote/brand-guidelines/partners/zeta"') && lhtml.includes("Zeta Co"), "a second partner needs no code change");
assert.strictEqual(partnersListHtml([]), "");
const lock = partnerLockupHtml(plist[0]);
assert.strictEqual((lock.match(/<figure/g) || []).length, 4);
assert.ok(lock.includes("img/brand/ph-logo-full-color.svg") && lock.includes("img/brand/ph-logo-white.svg") && lock.includes("lockup-missing"));
const withLogo = partnerLockupHtml({ ...plist[0], logoLight: "https://cdn.example/l.svg", logoDark: "javascript:alert(1)" });
assert.ok(withLogo.includes('src="https://cdn.example/l.svg"') && !withLogo.includes("javascript:"), "only a safe logo URL is used");
// The real miPharmacy file: every section, its block parses, and it is declared in board-docs.json.
const mip = readFileSync(new URL("../promote/partners/mipharmacy.md", import.meta.url), "utf8");
const mipTeam = teamFacingMd(parsePartnerDoc(mip).body);
assert.strictEqual(parsePartnerDoc(mip).meta.name, "miPharmacy");
for (const h of ["## Who leads, by audience", "## Co-brand logo lockups", "## Colour hierarchy", "## Naming, wording and tone", "## Approved claims and outcomes", "## Co-branded templates", "personalisationhub.com/industries/pharmacy/"]) assert.ok(mipTeam.includes(h), `the miPharmacy page shows ${h}`);
assert.ok(mip.includes("## For agents") && !mipTeam.includes("## For agents"), "agent detail is kept for MCP and hidden on the page");
assert.ok(!/[\u2013\u2014]/.test(mipTeam), "no long dashes in partner copy (ph-brand)");
const manifest = JSON.parse(readFileSync(new URL("../board-docs.json", import.meta.url), "utf8"));
assert.ok(manifest.mirrors.some((e) => e.key === "brand-partner-mipharmacy" && e.path === "backlog-tracker/promote/partners/mipharmacy.md"), "the miPharmacy page is mirrored to the board, so agents read it over MCP");

// Markets (mErc7MPAkrKjF9fWgqXb): one page per market, found by mirror key, no code per market.
assert.strictEqual(promotePageFromHash("#promote/brand-guidelines/markets/thailand"), "brand-guidelines", "a market page is part of Brand Guidelines");
assert.strictEqual(promoteNavId("#promote/brand-guidelines/markets/thailand"), "promote-brand-btn");
assert.strictEqual(promoteMarketFromHash("#promote/brand-guidelines/markets/united-states"), "united-states");
assert.strictEqual(promoteMarketFromHash("#promote/brand-guidelines/partners/mipharmacy"), null);
assert.strictEqual(promotePartnerFromHash("#promote/brand-guidelines/markets/thailand"), null);
assert.strictEqual(promoteMarketFromHash("#promote/brand-guidelines/markets/%E0%A4%A"), null, "a broken escape is not a slug");
assert.strictEqual(promoteMarketFromHash("#promote/brand-guidelines/markets/<x>"), null);
assert.strictEqual(marketHash("singapore"), "#promote/brand-guidelines/markets/singapore");
assert.deepStrictEqual(parseMarketDoc("<!-- market\nname: Zetaland\nregion: Nowhere\n-->\n# Z").meta, { name: "Zetaland", region: "Nowhere" });
const mlist = marketsFrom([
  prow("brand-guidelines", "# G"),
  prow(`${PARTNER_MIRROR_PREFIX}mipharmacy`, "<!-- partner\nname: miPharmacy\n-->\nM"),
  prow(`${MARKET_MIRROR_PREFIX}zeta`, "<!-- market\nname: Zetaland\nregion: Nowhere\n-->\n# Zetaland"),
  prow(`${MARKET_MIRROR_PREFIX}thailand`, "<!-- market\nname: Thailand\nregion: Southeast Asia\n-->\n# Thailand"),
  prow(`${MARKET_MIRROR_PREFIX}old`, "x", { status: "superseded" }),
]);
assert.deepStrictEqual(mlist.map((m) => m.slug), ["thailand", "zeta"], "every brand-market-* mirror, by name; not partners, not superseded");
const mhtml = marketsListHtml(mlist);
assert.ok(mhtml.includes("Markets") && mhtml.includes('href="#promote/brand-guidelines/markets/zeta"') && mhtml.includes("Southeast Asia"), "a new market needs no code change");
assert.strictEqual(marketsListHtml([]), "");
// The real market files: every section on the page, agent detail hidden, no long dashes in what the team sees.
for (const slug of ["thailand", "singapore", "united-states"]) {
  const md = readFileSync(new URL(`../promote/markets/${slug}.md`, import.meta.url), "utf8");
  const team = teamFacingMd(parseMarketDoc(md).body);
  for (const h of ["## Communication style", "## Cultural sensitivities", "## Local conventions", "## Business etiquette", "## Regulatory notes"]) assert.ok(team.includes(h), `${slug} shows ${h}`);
  assert.ok(md.includes("## For agents") && !team.includes("## For agents"), `${slug}: agent detail is kept for MCP and hidden on the page`);
  assert.ok(!/[\u2013\u2014]/.test(team), `${slug}: no long dashes in market copy (ph-brand)`);
  assert.ok(manifest.mirrors.some((e) => e.key === `brand-market-${slug}`), `${slug} is mirrored to the board`);
}
console.log("promote-section: ok");
