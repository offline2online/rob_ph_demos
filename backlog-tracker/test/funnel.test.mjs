import assert from "node:assert";
import { STAGES, buildFunnel, previousRange, addDays, daysBetween, joinOpportunities, dayOfInstant, normaliseWebRow, channelOf, fmtPct, fmtChange, EMPTY_FILTER, filterOptions, ingestStatusView, ingestFailureText, fmtUpdated } from "../public/js/funnel-core.js";

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
// Calculator uses count in the calculator / model downloads stage.
const calc = buildFunnel({ ...EMPTY_FILTER }, { web: [normaliseWebRow("c", { date: "2026-11-01", downloads: 2, calculatorUses: 3 })], ace: [] });
assert.strictEqual(calc.stages.find((x) => x.key === "downloads").count, 5);

// The ingest's status (consoleConfig/funnelIngest): last updated, and failures flagged.
assert.deepStrictEqual(ingestStatusView(null), { known: false, updatedAt: 0, failures: [], flagged: false });
const okView = ingestStatusView({ lastRunAt: "2026-11-19T00:00:00Z", sources: { "ga4-site": { ok: true, lastSuccessAt: "2026-11-19T00:00:00Z" }, leads: { ok: true, lastSuccessAt: "2026-11-19T00:00:00Z" } } });
assert.strictEqual(okView.flagged, false);
assert.strictEqual(okView.updatedAt, Date.parse("2026-11-19T00:00:00Z"));
const bad = ingestStatusView({ lastRunAt: "2026-11-19T06:00:00Z", sources: {
  "ga4-total": { ok: false, error: "GA4 answered 401: bad credentials", lastSuccessAt: "2026-11-18T00:00:00Z" },
  "ga4-site": { ok: false, error: "GA4 answered 401: bad credentials", lastSuccessAt: "2026-11-18T00:00:00Z" },
  "google-ads": { ok: false, error: "GA4 answered 401: bad credentials", lastSuccessAt: "2026-11-18T00:00:00Z" },
  leads: { ok: true, lastSuccessAt: "2026-11-19T06:00:00Z" },
} });
assert.strictEqual(bad.flagged, true);
assert.deepStrictEqual(bad.failures.map((x) => x.name), ["GA4", "Google Ads"], "one entry per source, not per report");
assert.strictEqual(bad.updatedAt, Date.parse("2026-11-18T00:00:00Z"), "last updated is GA4's last good update, not the leads'");
assert.match(ingestFailureText(bad), /^GA4 didn't update \(GA4 answered 401: bad credentials\); last good update .+\. Google Ads didn't update/);
assert.strictEqual(fmtUpdated(0), "never");
console.log("funnel.test.mjs: ok");
