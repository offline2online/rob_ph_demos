import assert from "node:assert";
import { STAGES, buildFunnel, previousRange, addDays, daysBetween, joinOpportunities, dayOfInstant, normaliseWebRow, channelOf, fmtPct, fmtChange, EMPTY_FILTER, filterOptions } from "../public/js/funnel-core.js";

assert.deepStrictEqual(STAGES.map((s) => s.key), ["impressions", "clicks", "visits", "demos", "downloads", "aceCreated", "aceOpen", "aceClosed", "deployed"], "nine stages in order");
assert.strictEqual(addDays("2026-03-01", -1), "2026-02-28");
assert.strictEqual(daysBetween("2026-11-01", "2026-11-30"), 30);
assert.deepStrictEqual(previousRange("2026-11-01", "2026-11-30"), { from: "2026-10-02", to: "2026-10-31" });
assert.strictEqual(previousRange("", ""), null);
assert.strictEqual(dayOfInstant("2026-11-05"), "2026-11-05");
assert.strictEqual(dayOfInstant("nonsense"), "");

const w = (date, o) => normaliseWebRow(date, { date, impressions: 1000, clicks: 100, visits: 80, demoRequests: 10, downloads: 5, channel: "Google Ads", campaign: "Spring", industry: "QSR", country: "UK", ...o });
const web = [w("2026-11-02", {}), w("2026-11-03", { industry: "Grocery", channel: "Organic", campaign: "" }), w("2026-10-20", {})];
const prospects = [{ name: "Burger Co Ltd", industry: "QSR", country: "UK", hqCountry: "UK", campaigns: ["Spring"] }];
const leads = [{ company: { name: "Burger Co", industry: "QSR", countries: ["UK"] }, source: "Google Ads", sourceLabel: "Calculator", sourcePage: "" }];
const noon = (d) => `${d}T12:00:00`;
const opps = [
  { id: "1", customer: "Burger Co", stage: "Qualified", createdDate: noon("2026-11-02") },
  { id: "2", customer: "Burger Co", stage: "Launched", createdDate: noon("2026-11-03") },
  { id: "3", customer: "Unknown Ltd", stage: "Closed Lost", createdDate: noon("2026-11-04"), industry: "Grocery" },
];
const ace = joinOpportunities(opps, leads, prospects);
assert.strictEqual(ace[0].industry, "QSR", "industry joins from the prospect");
assert.strictEqual(ace[0].channel, "Google Ads");
assert.deepStrictEqual(ace[0].campaigns, ["Spring"]);
const data = { web, ace };
const F = { ...EMPTY_FILTER, from: "2026-11-01", to: "2026-11-30" };

let f = buildFunnel(F, data);
const by = Object.fromEntries(f.stages.map((s) => [s.key, s]));
assert.strictEqual(by.impressions.count, 2000);
assert.strictEqual(by.clicks.fromPrev, 10);
assert.strictEqual(by.clicks.ofTop, 10);
assert.strictEqual(by.aceCreated.count, 3);
assert.strictEqual(by.aceOpen.count, 1);
assert.strictEqual(by.aceClosed.count, 2);
assert.strictEqual(by.aceClosed.fromPrev, (2 / 3) * 100, "closed is measured against created");
assert.strictEqual(by.deployed.count, 1);
assert.strictEqual(by.deployed.fromPrev, 50);

f = buildFunnel({ ...F, industry: "QSR" }, data);
assert.strictEqual(f.stages[0].count, 1000, "industry narrows the web stages");
assert.strictEqual(f.stages[5].count, 2, "and the opportunities");
f = buildFunnel({ ...F, channel: "Google Ads", campaign: "Spring", country: "UK" }, data);
assert.strictEqual(f.stages[0].count, 1000);
assert.strictEqual(f.stages[5].count, 2);
f = buildFunnel({ ...F, adGroup: "x" }, data);
assert.ok(f.empty, "an ad-group filter that matches nothing is empty, not an error");
f = buildFunnel({ ...F, company: "Nobody" }, data);
assert.ok(f.empty);
assert.ok(f.stages.every((s) => s.count === 0 && s.width === 0 && s.fromPrev == null || s.fromPrev == null));

f = buildFunnel({ ...F, from: "2026-11-01", to: "2026-11-30", compare: true }, data);
assert.deepStrictEqual(f.prevRange, { from: "2026-10-02", to: "2026-10-31" });
assert.strictEqual(f.stages[0].prev.count, 1000);
assert.strictEqual(f.stages[0].change.count, 1000);
assert.strictEqual(f.stages[0].change.countPct, 100);
assert.strictEqual(f.stages[1].change.points, 0);
assert.strictEqual(buildFunnel({ ...F, compare: false }, data).stages[0].change, undefined);

assert.strictEqual(channelOf("AWS Marketplace listing"), "AWS Marketplace");
assert.strictEqual(channelOf("Website form"), "Direct");
assert.strictEqual(fmtPct(null), "–");
assert.strictEqual(fmtPct(12.34), "12%");
assert.strictEqual(fmtPct(2.5), "2.5%");
assert.strictEqual(fmtChange({ count: -5, countPct: -10 }), "−5 (−10%)");
assert.ok(filterOptions(data, prospects).industry.includes("Grocery"));
console.log("funnel.test.mjs: ok");
