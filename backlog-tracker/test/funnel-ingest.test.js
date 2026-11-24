// Conversion Funnel daily ingest (functions/funnel-ingest.js): GA4 / Google Ads
// (through GA4) / leads / ACE -> funnelDaily rows, the 90-day backfill, the
// status record the pages read, and a failing credential. No network, no Firebase.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const fi = require("../functions/funnel-ingest");

let count = 0;
async function test(name, fn) { await fn(); count++; console.log(`  ok  ${name}`); }
const quiet = { info() {}, warn() {}, error() {} };

// A Firestore stand-in: collections of plain docs, where(date >= / <=), batches.
function fakeDb(seed = {}) {
  const cols = {};
  const col = (c) => (cols[c] = cols[c] || new Map());
  for (const [c, docs] of Object.entries(seed)) for (const [id, d] of Object.entries(docs)) col(c).set(id, d);
  const ref = (c, id) => ({
    id, _c: c,
    get: async () => ({ exists: col(c).has(id), data: () => col(c).get(id) }),
    set: async (p, opt) => { col(c).set(id, opt && opt.merge ? { ...(col(c).get(id) || {}), ...p } : p); },
  });
  const query = (c, filters) => ({
    where: (f, op, v) => query(c, [...filters, [f, op, v]]),
    get: async () => ({
      docs: [...col(c).entries()]
        .filter(([, d]) => filters.every(([f, op, v]) => (op === ">=" ? d[f] >= v : op === "<=" ? d[f] <= v : d[f] === v)))
        .map(([id, d]) => ({ id, ref: ref(c, id), data: () => d })),
    }),
  });
  return {
    cols, col,
    collection: (c) => ({ doc: (id) => ref(c, id), ...query(c, []) }),
    batch: () => {
      const ops = [];
      return {
        set: (r, d) => ops.push(() => col(r._c).set(r.id, d)),
        delete: (r) => ops.push(() => col(r._c).delete(r.id)),
        commit: async () => ops.forEach((o) => o()),
      };
    },
  };
}

// GA4 runReport answers, keyed by the report's first non-date dimension.
const H = (dims, mets) => ({ dimensionHeaders: dims.map((name) => ({ name })), metricHeaders: mets.map((name) => ({ name })) });
const R = (dims, mets) => ({ dimensionValues: dims.map((value) => ({ value })), metricValues: mets.map((v) => ({ value: String(v) })) });
function ga4Answers({ failWith = null, noIndustryDim = false } = {}) {
  const calls = [];
  const f = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body, auth: init.headers.Authorization });
    const dims = body.dimensions.map((d) => d.name);
    const json = (status, obj) => ({ ok: status < 300, status, text: async () => JSON.stringify(obj) });
    if (failWith) return json(failWith, { error: { message: "Request had invalid authentication credentials." } });
    const key = dims.join(",");
    // Users over every /industries/* page, de-duplicated by GA4 (fewer than the per-page sum 20 + 4 + 9).
    if (key === "date" && body.dimensionFilter) return json(200, { ...H(dims, ["totalUsers"]), rows: [R(["20261118"], [26])], rowCount: 1 });
    if (key === "date,pagePath") {
      return json(200, { ...H(dims, ["totalUsers"]), rows: [
        R(["20261118", "/industries/quick-service-restaurants/"], [19]),
        R(["20261118", "/industries/quick-service-restaurants/?utm=x"], [4]),
        R(["20261118", "/industries/telco/"], [9]),
      ], rowCount: 3 });
    }
    if (key === "date") return json(200, { ...H(dims, ["totalUsers"]), rows: [R(["20261117"], [120]), R(["20261118"], [140])], rowCount: 2 });
    if (dims[1] === "country" && dims[2] === "sessionDefaultChannelGroup") {
      return json(200, { ...H(dims, ["sessions", "totalUsers"]), rows: [
        R(["20261118", "United Kingdom", "Organic Search", "(not set)"], [90, 80]),
        R(["20261118", "Australia", "Paid Search", "Brand AU"], [70, 65]),
      ], rowCount: 2 });
    }
    if (dims[1] === "pagePath") {
      return json(200, { ...H(dims, ["screenPageViews", "totalUsers"]), rows: [
        R(["20261118", "/industries/quick-service-restaurants/", "United Kingdom"], [30, 20]),
        R(["20261118", "/industries/quick-service-restaurants/?utm=x", "United Kingdom"], [5, 4]),
        R(["20261118", "/industries/telco/", "Australia"], [12, 9]),
      ], rowCount: 3 });
    }
    if (dims[1] === "eventName") {
      if (noIndustryDim && dims.includes("customEvent:industry")) return json(400, { error: { message: "Field customEvent:industry is not a valid dimension." } });
      const ind = dims.includes("customEvent:industry");
      const row = (ev, c) => R(["20261118", ev, "United Kingdom", ...(ind ? ["telco"] : [])], [c]);
      return json(200, { ...H(dims, ["eventCount"]), rows: [row("product_tour_start", 7), row("demo_request", 2), row("file_download", 3), row("lead_created", 4), row("page_view", 999)], rowCount: 5 });
    }
    if (dims[1] === "sessionGoogleAdsCampaignName") {
      return json(200, { ...H(dims, ["advertiserAdImpressions", "advertiserAdClicks"]), rows: [R(["20261118", "Brand AU", "Retail media"], [5000, 150])], rowCount: 1 });
    }
    return json(400, { error: { message: `unexpected report ${key}` } });
  };
  f.calls = calls;
  return f;
}

// 2026-11-18 23:30 UTC is 19 Nov 10:30 in Sydney: "today" there is the 19th.
const NOW = new Date("2026-11-18T23:30:00Z");
const LEADS = {
  L1: { company: { name: "Acme", industry: "Telco", countries: ["Australia"] }, source: "Website form", createdAt: new Date("2026-11-18T02:00:00Z") },
  L2: { company: { name: "Test Co", industry: "Telco", countries: ["Australia"] }, source: "Website form", test: true, createdAt: new Date("2026-11-18T02:00:00Z") },
  L3: { company: { name: "Gone", industry: "Telco", countries: ["Australia"] }, source: "Manual", archivedAt: new Date(), createdAt: new Date("2026-11-18T02:00:00Z") },
  // 18 Nov 14:30 UTC = 19 Nov 01:30 Sydney: a Sydney-day lead, not a UTC-day one.
  L4: { company: { name: "Late", industry: "Retail", countries: ["Australia"] }, source: "Website form", createdAt: new Date("2026-11-18T14:30:00Z") },
};

function job(db, fetch, extra = {}) {
  return fi.createFunnelIngestJob({ db, fetch, ga4AccessToken: async () => "TOKEN", logger: quiet, now: () => NOW, ...extra });
}
const rowsOf = (db, source) => [...db.col("funnelDaily").values()].filter((r) => r.source === source);
const sum = (rows, f) => rows.reduce((n, r) => n + (r[f] || 0), 0);

(async () => {
  await test("pure: GA4 dates, local days, industry from the page path, channels", () => {
    assert.strictEqual(fi.gaDate("20261118"), "2026-11-18");
    assert.strictEqual(fi.dayIn(NOW.getTime(), "Australia/Sydney"), "2026-11-19");
    assert.strictEqual(fi.dayIn(NOW.getTime(), "Europe/London"), "2026-11-18");
    assert.deepStrictEqual(fi.dayWindow(NOW.getTime(), "Australia/Sydney", 90), { from: "2026-08-22", to: "2026-11-19" });
    assert.strictEqual(fi.industryOfPath("/industries/quick-service-restaurants/"), "Quick Service Restaurants");
    assert.strictEqual(fi.industryOfPath("/industries/telco"), "Telco");
    assert.strictEqual(fi.industryOfPath("/blog/telco/"), "");
    assert.strictEqual(fi.industryOfParam("none"), "");
    assert.strictEqual(fi.industryOfParam("telco"), "Telco");
    assert.strictEqual(fi.channelOfGroup("Paid Search"), "Google Ads");
    assert.strictEqual(fi.channelOfGroup("Organic Search"), "Organic");
    assert.strictEqual(fi.channelOfGroup("(not set)"), "");
    assert.strictEqual(fi.clean("(not set)"), "");
  });

  await test("pure: rows are complete, ids stable, and two GA4 rows for one page fold together", () => {
    const out = fi.ga4Rows({ industry: [
      { date: "20261118", pagePath: "/industries/telco/", country: "UK", screenPageViews: 3, totalUsers: 2 },
      { date: "20261118", pagePath: "/industries/telco/?a=1", country: "UK", screenPageViews: 1, totalUsers: 1 },
    ] });
    const rows = out["ga4-industry"];
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].row.pageViews, 4);
    assert.strictEqual(rows[0].row.industry, "Telco");
    for (const k of ["channel", "campaign", "adGroup", "creative", "industry", "country", "content", "company"]) assert.strictEqual(typeof rows[0].row[k], "string", k);
    assert.match(rows[0].id, /^2026-11-18_ga4-industry_[0-9a-f]{8}$/);
    assert.strictEqual(fi.makeRow("x", "2026-11-18", { country: "UK" }, {}).id, fi.makeRow("x", "2026-11-18", { country: "uk" }, {}).id);
  });

  await test("pure: test and archived leads are never counted; leads fall on the local day", () => {
    const rows = fi.leadRows(Object.values(LEADS), { timeZone: "Australia/Sydney", from: "2026-11-01", to: "2026-11-30" });
    assert.strictEqual(sum(rows.map((r) => r.row), "leads"), 2);
    const byDay = Object.fromEntries(rows.map((r) => [r.row.industry, r.row.date]));
    assert.deepStrictEqual(byDay, { Telco: "2026-11-18", Retail: "2026-11-19" });
    const utc = fi.leadRows([LEADS.L4], { timeZone: "UTC", from: "2026-11-01", to: "2026-11-30" });
    assert.strictEqual(utc[0].row.date, "2026-11-18");
  });

  await test("backfill: 90 days asked of GA4, rows for every source, unique users are GA4 users", async () => {
    const db = fakeDb({ leads: LEADS });
    const fetch = ga4Answers();
    const out = await job(db, fetch, { partnerCentral: { aceOpportunities: async () => ({ catalog: "AWS", opportunities: [{ id: "O1", industry: "Telco", createdDate: "2026-11-18T01:00:00Z" }] }) } }).run({ mode: "backfill" });
    assert.deepStrictEqual(out.failed, []);
    assert.strictEqual(fetch.calls.length, 7);
    for (const c of fetch.calls) {
      assert.deepStrictEqual(c.body.dateRanges, [{ startDate: "2026-08-22", endDate: "2026-11-19" }]);
      assert.strictEqual(c.auth, "Bearer TOKEN");
      assert.match(c.url, /properties\/473743482:runReport$/);
    }
    // Unique visitors = GA4 totalUsers on the one total row per day, never a sum of slices.
    const total = rowsOf(db, "ga4-total").find((r) => r.date === "2026-11-18");
    assert.strictEqual(total.users, 140);
    assert.strictEqual(sum(rowsOf(db, "ga4-site"), "visits"), 160);
    // Industry visits are real page views of /industries/* pages.
    const ind = rowsOf(db, "ga4-industry");
    assert.strictEqual(sum(ind.filter((r) => r.industry === "Quick Service Restaurants"), "pageViews"), 35);
    assert.strictEqual(sum(ind.filter((r) => r.industry === "Telco"), "pageViews"), 12);
    // The people who saw any industry page: GA4's own de-duplicated count, one row a day.
    const indTotal = rowsOf(db, "ga4-industry-total");
    assert.deepStrictEqual(indTotal.map((r) => [r.date, r.users]), [["2026-11-18", 26]]);
    const indCall = fetch.calls.find((c) => c.body.dimensions.length === 1 && c.body.dimensionFilter);
    assert.strictEqual(indCall.body.dimensionFilter.filter.stringFilter.value, "/industries/");
    // Users per industry, no country split.
    const indUsers = rowsOf(db, "ga4-industry-users");
    assert.deepStrictEqual(indUsers.map((r) => [r.industry, r.users, r.country]).sort(), [["Quick Service Restaurants", 23, ""], ["Telco", 9, ""]]);
    const ev = rowsOf(db, "ga4-events");
    assert.deepStrictEqual([sum(ev, "walkthroughs"), sum(ev, "demoRequests"), sum(ev, "downloads"), sum(ev, "leadForms"), sum(ev, "calculatorUses")], [7, 2, 3, 4, 0]);
    assert.strictEqual(ev[0].industry, "Telco");
    const ads = rowsOf(db, "google-ads");
    assert.deepStrictEqual([ads[0].impressions, ads[0].clicks, ads[0].channel, ads[0].campaign], [5000, 150, "Google Ads", "Brand AU"]);
    assert.strictEqual(sum(rowsOf(db, "leads"), "leads"), 2);
    assert.strictEqual(sum(rowsOf(db, "ace"), "aceCreated"), 1);
    const st = db.col("consoleConfig").get("funnelIngest");
    assert.strictEqual(st.ok, true);
    assert.strictEqual(st.backfilledAt, NOW.toISOString());
    assert.strictEqual(st.timeZone, "Australia/Sydney");
    assert.strictEqual(st.sources["ga4-total"].ok, true);
  });

  await test("a re-run replaces its rows instead of adding to them, and drops rows that went away", async () => {
    const db = fakeDb({ leads: LEADS, funnelDaily: { "2026-11-18_ga4-site_deadbeef": { date: "2026-11-18", source: "ga4-site", visits: 999 }, "2026-11-18_manual": { date: "2026-11-18", visits: 1 } } });
    await job(db, ga4Answers()).run({ mode: "daily" });
    await job(db, ga4Answers()).run({ mode: "daily" });
    assert.strictEqual(sum(rowsOf(db, "ga4-site"), "visits"), 160);
    assert.ok(db.col("funnelDaily").has("2026-11-18_manual"), "a row of no source is left alone");
    assert.strictEqual(sum(rowsOf(db, "leads"), "leads"), 2);
  });

  await test("a broken GA4 credential keeps the old rows and is flagged with the last good update", async () => {
    const db = fakeDb({ leads: LEADS });
    await job(db, ga4Answers()).run({ mode: "daily" });
    const before = sum(rowsOf(db, "ga4-site"), "visits");
    const later = new Date(NOW.getTime() + 7 * 3600e3);
    const out = await fi.createFunnelIngestJob({ db, fetch: ga4Answers({ failWith: 401 }), ga4AccessToken: async () => "BAD", logger: quiet, now: () => later }).run({ mode: "daily" });
    assert.deepStrictEqual(out.failed, ["ga4-total", "ga4-site", "ga4-industry", "ga4-industry-total", "ga4-industry-users", "ga4-events", "google-ads"]);
    assert.strictEqual(sum(rowsOf(db, "ga4-site"), "visits"), before);
    const st = db.col("consoleConfig").get("funnelIngest");
    assert.strictEqual(st.ok, false);
    assert.strictEqual(st.sources["ga4-site"].ok, false);
    assert.match(st.sources["ga4-site"].error, /401/);
    assert.strictEqual(st.sources["ga4-site"].lastSuccessAt, NOW.toISOString());
    assert.strictEqual(st.sources.leads.ok, true, "the other sources still update");
    assert.strictEqual(st.lastSuccessAt, NOW.toISOString(), "lastSuccessAt is the last fully good run");
  });

  await test("a token that cannot be fetched at all is a failure, not a crash", async () => {
    const db = fakeDb({ leads: LEADS });
    const out = await job(db, ga4Answers(), { ga4AccessToken: async () => { throw new Error("Could not load the default credentials"); } }).run({ mode: "daily" });
    assert.ok(out.failed.includes("ga4-total"));
    assert.match(db.col("consoleConfig").get("funnelIngest").sources["ga4-total"].error, /default credentials/);
  });

  await test("events still load without the industry custom dimension", async () => {
    const db = fakeDb({ leads: {} });
    const out = await job(db, ga4Answers({ noIndustryDim: true })).run({ mode: "daily" });
    assert.ok(!out.failed.includes("ga4-events"));
    assert.strictEqual(sum(rowsOf(db, "ga4-events"), "walkthroughs"), 7);
  });

  await test("due: first run backfills, then nothing for 6 hours, then a 3-day refresh", async () => {
    const db = fakeDb({ leads: {} });
    let t = NOW;
    const j = fi.createFunnelIngestJob({ db, fetch: ga4Answers(), ga4AccessToken: async () => "T", logger: quiet, now: () => t });
    assert.strictEqual((await j.runIfDue()).mode, "backfill");
    t = new Date(NOW.getTime() + 3600e3);
    assert.deepStrictEqual(await j.runIfDue(), { skipped: "not due" });
    t = new Date(NOW.getTime() + 6 * 3600e3 + 1);
    const out = await j.runIfDue();
    assert.strictEqual(out.mode, "daily");
    assert.deepStrictEqual(out.window, { from: "2026-11-17", to: "2026-11-19" });
  });

  await test("due: a run out of budget defers the rest to the next hourly call; the backfill is done only when every GA4 source succeeded", async () => {
    const db = fakeDb({ leads: {} });
    let t = NOW.getTime();
    // Each GA4 report takes 60 s of the job's clock.
    const slow = ga4Answers();
    const fetch = async (url, init) => { t += 60e3; return slow(url, init); };
    const j = fi.createFunnelIngestJob({ db, fetch, ga4AccessToken: async () => "T", logger: quiet, now: () => new Date(t) });
    const first = await j.runIfDue();
    assert.strictEqual(first.mode, "backfill");
    assert.ok(first.deferred.length > 0, "the 150 s budget does not cover every source");
    assert.deepStrictEqual(first.failed, []);
    let st = db.col("consoleConfig").get("funnelIngest");
    assert.deepStrictEqual(st.deferred, first.deferred);
    assert.strictEqual(st.deferredMode, "backfill");
    assert.ok(!st.backfilledAt, "not backfilled while GA4 sources are still deferred");
    // The next hourly call (well inside 6 hours) runs the deferred sources straight away.
    let guard = 0;
    while ((db.col("consoleConfig").get("funnelIngest").deferred || []).length && guard++ < 10) {
      t += 3600e3 - 0;
      const next = await j.runIfDue();
      assert.strictEqual(next.mode, "backfill");
    }
    st = db.col("consoleConfig").get("funnelIngest");
    assert.deepStrictEqual(st.deferred, []);
    assert.ok(st.backfilledAt, "backfilled once every GA4 source has succeeded");
    assert.strictEqual(rowsOf(db, "google-ads").length, 1);
    assert.strictEqual(rowsOf(db, "ga4-industry-users").length, 2);
    // A run by hand has no budget.
    const db2 = fakeDb({ leads: {} });
    const j2 = fi.createFunnelIngestJob({ db: db2, fetch, ga4AccessToken: async () => "T", logger: quiet, now: () => new Date(t) });
    assert.deepStrictEqual((await j2.run({ mode: "backfill" })).deferred, []);
    assert.ok(db2.col("consoleConfig").get("funnelIngest").backfilledAt);
  });

  await test("a backfill with a failed GA4 source is not done, and is tried again when due", async () => {
    const db = fakeDb({ leads: {} });
    const base = ga4Answers();
    const fetch = async (url, init) => (JSON.parse(init.body).dimensions.length === 2 && JSON.parse(init.body).dimensions[1].name === "pagePath"
      ? { ok: false, status: 500, text: async () => JSON.stringify({ error: { message: "backend error" } }) } : base(url, init));
    let t = NOW;
    const j = fi.createFunnelIngestJob({ db, fetch, ga4AccessToken: async () => "T", logger: quiet, now: () => t });
    const out = await j.runIfDue({ budgetMs: 0 });
    assert.deepStrictEqual(out.failed, ["ga4-industry-users"]);
    assert.ok(!db.col("consoleConfig").get("funnelIngest").backfilledAt);
    t = new Date(NOW.getTime() + 6 * 3600e3 + 1);
    assert.strictEqual((await j.runIfDue()).mode, "backfill");
  });

  await test("config overrides the property and the time zone; a bad zone falls back", async () => {
    const db = fakeDb({ leads: {}, consoleConfig: { funnelIngest: { ga4PropertyId: "123", timeZone: "Europe/London" } } });
    const fetch = ga4Answers();
    const out = await job(db, fetch).run({ mode: "daily" });
    assert.match(fetch.calls[0].url, /properties\/123:runReport/);
    assert.deepStrictEqual(out.window, { from: "2026-11-16", to: "2026-11-18" });
    const db2 = fakeDb({ leads: {}, consoleConfig: { funnelIngest: { timeZone: "Mars/Olympus" } } });
    assert.strictEqual((await job(db2, ga4Answers()).readConfig()).timeZone, "Australia/Sydney");
  });

  await test("HTTP: POST only, board key required, backfill mode", async () => {
    const db = fakeDb({ leads: {} });
    const j = job(db, ga4Answers(), { boardKey: () => "K" });
    const call = async (method, key, body) => {
      const res = { code: 0, body: null, headers: {}, status(c) { this.code = c; return this; }, set(k, v) { this.headers[k] = v; return this; }, json(b) { this.body = b; return this; } };
      await j.handle({ method, body, get: (h) => (h.toLowerCase() === "x-board-key" ? key : "") }, res);
      return res;
    };
    assert.strictEqual((await call("GET", "K")).code, 405);
    assert.strictEqual((await call("POST", "nope", {})).code, 401);
    const ok = await call("POST", "K", { mode: "backfill" });
    assert.strictEqual(ok.code, 200);
    assert.strictEqual(ok.body.mode, "backfill");
  });

  await test("wiring: an HTTP function run when due from the hourly aceToGa4 call, never a scheduler, no new secret", () => {
    const idx = fs.readFileSync(path.join(__dirname, "../functions/index.js"), "utf8");
    assert.match(idx, /exports\.funnelIngest = onRequest\(/);
    assert.match(idx, /getFunnelIngestJob\(\)\.runIfDue\(\)/);
    assert.doesNotMatch(idx, /onSchedule/);
    assert.match(idx, /analytics\.readonly/);
    const block = idx.slice(idx.indexOf("exports.funnelIngest"), idx.indexOf("exports.funnelIngest") + 300);
    assert.match(block, /secrets: \[BOARD_API_KEY\]/);
  });

  // ── The Partner Central S3 data export (functions/pc-export.js) ──
  const pcx = require("../functions/pc-export");
  const OPP_CSV = 'Opportunity ID,Customer Company Name,Stage,Created Date,Demand Center Campaign,Mystery Column\r\nO-1,"Burger Co, Ltd",Launched,2026-10-01,DC Spring,x\r\nO-2,Unknown Ltd,Qualified,2026-11-01,,y\r\n';
  const REV_CSV = 'Opportunity ID,Revenue Month,Attributed Revenue (USD),Marketplace Revenue,Funding Utilised,Currency\nO-1,2026-11,"$1,200.50",900,300,USD\nO-1,2026-11,100,0,0,USD\nO-2,2026-11,,250,,USD\n';
  function fakeS3(files, { failWith = null } = {}) {
    const calls = [];
    return {
      calls,
      list: async (cfg) => { calls.push(["list", cfg.bucket, cfg.prefix]); if (failWith) throw new Error(failWith); return Object.entries(files).map(([key, f]) => ({ key, etag: f.etag || "e1", size: f.body.length, lastModified: f.at })); },
      read: async ({ key }) => { calls.push(["read", key]); return files[key].body; },
    };
  }
  const EXPORT = { "pc/2026-11-18/opportunities.csv": { body: OPP_CSV, at: "2026-11-18T02:00:00Z" }, "pc/2026-11-18/revenue.csv": { body: REV_CSV, at: "2026-11-18T02:01:00Z" }, "pc/2026-11-11/revenue.csv": { body: "Opportunity ID,Marketplace Revenue\nO-9,999\n", at: "2026-11-11T02:00:00Z" }, "pc/readme.txt": { body: "x", at: "2026-11-19T00:00:00Z" } };

  await test("pc-export: CSV with quotes and CRLF, headers read by alias, unknown headers listed", () => {
    assert.deepStrictEqual(pcx.parseCsv('a,"b ""q"", c"\r\n1,2\r\n'), [["a", 'b "q", c'], ["1", "2"]]);
    const p = pcx.parseExportFile("o.csv", OPP_CSV);
    assert.strictEqual(p.records[0].opportunityId, "O-1");
    assert.strictEqual(p.records[0].customer, "Burger Co, Ltd");
    assert.strictEqual(p.records[0].campaign, "DC Spring");
    assert.deepStrictEqual(p.unknown, ["Mystery Column"]);
    const j = pcx.parseExportFile("o.json", JSON.stringify({ opportunities: [{ Id: "O-3", Customer: { Account: { CompanyName: "Nested Co" } }, LifeCycle: { Stage: "Launched" } }] }));
    assert.strictEqual(j.records[0].opportunityId, "O-3");
    assert.strictEqual(j.records[0].customer, "Nested Co", "a nested JSON opportunity is read too");
    assert.strictEqual(pcx.money("$1,200.50"), 1200.5);
    assert.strictEqual(pcx.money("(12)"), -12);
    assert.strictEqual(pcx.dayOf("2026-11"), "2026-11-01");
    assert.strictEqual(pcx.dayOf("11/5/2026"), "2026-11-05");
  });

  await test("pc-export: entries per opportunity and day, revenue summed, the newest run's files only", () => {
    const run = pcx.latestRun(Object.entries(EXPORT).map(([key, f]) => ({ key, etag: "e", size: f.body.length, lastModified: f.at })), "pc/");
    assert.deepStrictEqual(run.map((o) => o.key).sort(), ["pc/2026-11-18/opportunities.csv", "pc/2026-11-18/revenue.csv"], "the newest run folder; a .txt is not data");
    const loose = pcx.latestRun([{ key: "a.csv", size: 1, lastModified: "2026-11-18T02:00:00Z" }, { key: "b.csv", size: 1, lastModified: "2026-11-18T01:00:00Z" }, { key: "c.csv", size: 1, lastModified: "2026-11-10T01:00:00Z" }], "");
    assert.deepStrictEqual(loose.map((o) => o.key), ["a.csv", "b.csv"], "loose files: one run = written within 6 hours");
    const recs = [...pcx.parseExportFile("o.csv", OPP_CSV).records, ...pcx.parseExportFile("r.csv", REV_CSV).records];
    const { entries, opportunities } = pcx.exportEntries(recs);
    assert.strictEqual(opportunities.length, 2);
    const o1 = entries.find((e) => e.opportunityId === "O-1");
    assert.deepStrictEqual([o1.day, o1.attributedRevenue, o1.marketplaceRevenue, o1.fundingUsed, o1.campaign, o1.stage], ["2026-11-01", 1300.5, 900, 300, "DC Spring", "Launched"]);
  });

  await test("pc-export: joined on the ACE id, then company to prospects and leads; rows replace the last import", async () => {
    const db = fakeDb({
      leads: { L1: { company: { name: "Burger Co", industry: "QSR", countries: ["UK"] }, source: "Google Ads", sourceLabel: "Calculator", createdAt: "2026-11-01T00:00:00Z" } },
      prospects: { P1: { name: "Burger Co Ltd", industry: "QSR", country: "United Kingdom", campaigns: ["Other"] } },
      funnelDaily: { stale: { date: "2026-09-01", source: "pc-export", attributedRevenue: 5 } },
      consoleConfig: { funnelIngest: { pcExportBucket: "ph-pc-export", pcExportPrefix: "pc/" } },
    });
    const s3 = fakeS3(EXPORT);
    const partnerCentral = { aceOpportunities: async () => ({ opportunities: [{ id: "O-1", customer: "Burger Co", stage: "Launched", industry: "QSR", createdDate: "2026-10-01T00:00:00Z" }] }) };
    const out = await job(db, ga4Answers(), { pcExportS3: s3, partnerCentral }).run({ mode: "daily" });
    assert.strictEqual(out.sources["pc-export"].ok, true);
    const rows = [...db.col("funnelDaily").values()].filter((r) => r.source === "pc-export");
    assert.strictEqual(rows.length, 2, "the stale row from the last import is gone");
    const r1 = rows.find((r) => r.aceId === "O-1");
    assert.deepStrictEqual([r1.date, r1.company, r1.industry, r1.country, r1.channel, r1.campaign, r1.content, r1.attributedRevenue, r1.currency], ["2026-11-01", "Burger Co", "QSR", "United Kingdom", "Google Ads", "DC Spring", "Calculator", 1300.5, "USD"]);
    const st = db.col("consoleConfig").get("funnelIngest").sources["pc-export"];
    assert.deepStrictEqual([st.recordsRead, st.joined, st.rows, st.unknownHeaders], [5, 1, 2, ["Mystery Column"]]);
    assert.deepStrictEqual(s3.calls[0], ["list", "ph-pc-export", "pc/"]);
    // The same files again: not re-read, rows kept.
    const before = s3.calls.length;
    await job(db, ga4Answers(), { pcExportS3: s3, partnerCentral }).run({ mode: "daily" });
    assert.strictEqual(s3.calls.length, before + 1, "an unchanged export is listed, not read");
    assert.strictEqual(db.col("consoleConfig").get("funnelIngest").sources["pc-export"].unchanged, true);
    assert.strictEqual([...db.col("funnelDaily").values()].filter((r) => r.source === "pc-export").length, 2);
  });

  await test("pc-export: not set up is neutral, a failing bucket is flagged and keeps its rows", async () => {
    const db = fakeDb({ leads: {} });
    const out = await job(db, ga4Answers(), { pcExportS3: fakeS3(EXPORT) }).run({ mode: "daily" });
    assert.deepStrictEqual([out.sources["pc-export"].ok, out.sources["pc-export"].notSetUp], [true, true]);
    assert.ok(!out.failed.includes("pc-export"));
    const db2 = fakeDb({ leads: {}, prospects: {}, funnelDaily: { k: { date: "2026-11-01", source: "pc-export", attributedRevenue: 5 } }, consoleConfig: { funnelIngest: { pcExportBucket: "ph-pc-export" } } });
    const out2 = await job(db2, ga4Answers(), { pcExportS3: fakeS3(EXPORT, { failWith: "S3 answered AccessDenied: no s3:ListBucket" }) }).run({ mode: "daily" });
    assert.ok(out2.failed.includes("pc-export"));
    assert.match(out2.sources["pc-export"].error, /AccessDenied/);
    assert.ok(db2.col("funnelDaily").has("k"), "a failed import keeps the earlier rows");
    assert.strictEqual(pcx.exportConfig({ pcExportBucket: "Bad Bucket!" }), null, "an invalid bucket name is not set up");
    assert.deepStrictEqual(pcx.exportConfig({ pcExportBucket: "b-1", pcExportRegion: "eu-west-2" }), { bucket: "b-1", prefix: "", region: "eu-west-2" });
  });

  await test("pc-export: S3 is read with SigV4 (query signed), never an access key in config", async () => {
    const seen = [];
    const fetch = async (url, init) => {
      seen.push({ url, headers: init.headers });
      const body = url.includes("list-type=2")
        ? '<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>pc/a b.csv</Key><LastModified>2026-11-18T02:00:00.000Z</LastModified><ETag>&quot;abc&quot;</ETag><Size>10</Size></Contents></ListBucketResult>'
        : "Opportunity ID\nO-1\n";
      return { ok: true, status: 200, text: async () => body };
    };
    const s3 = pcx.createS3Reader({ credentials: async () => ({ accessKeyId: "AKIA", secretAccessKey: "S", sessionToken: "T" }), fetch, now: () => NOW });
    const objs = await s3.list({ bucket: "ph-pc-export", region: "us-east-1", prefix: "pc/" });
    assert.deepStrictEqual(objs[0], { key: "pc/a b.csv", lastModified: "2026-11-18T02:00:00.000Z", etag: "abc", size: 10 });
    assert.strictEqual(seen[0].url, "https://ph-pc-export.s3.amazonaws.com/?list-type=2&prefix=pc%2F");
    assert.match(seen[0].headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIA\/\d{8}\/us-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-security-token, Signature=[0-9a-f]{64}$/);
    await s3.read({ bucket: "ph-pc-export", region: "eu-west-2", key: "pc/a b.csv" });
    assert.strictEqual(seen[1].url, "https://ph-pc-export.s3.eu-west-2.amazonaws.com/pc/a%20b.csv");
    const failing = pcx.createS3Reader({ credentials: async () => ({ accessKeyId: "A", secretAccessKey: "S" }), fetch: async () => ({ ok: false, status: 403, text: async () => "<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>" }) });
    await assert.rejects(failing.list({ bucket: "b-1", region: "us-east-1", prefix: "" }), /S3 answered AccessDenied: Access Denied/);
    const idx = fs.readFileSync(path.join(__dirname, "../functions/index.js"), "utf8");
    assert.match(idx, /pcExportS3: createS3Reader\(\{ credentials: \(\) => getPartnerCentralApi\(\)\.awsCredentials\(\) \}\)/, "the keyless role credentials, no stored key");
    const role = fs.readFileSync(path.join(__dirname, "../deploy/aws/partner-central-role.yaml"), "utf8");
    assert.match(role, /Action: s3:ListBucket\n\s+Resource: !Sub "arn:aws:s3:::\$\{ExportBucketName\}"/);
    assert.match(role, /Action: s3:GetObject\n\s+Resource: !Sub "arn:aws:s3:::\$\{ExportBucketName\}\/\*"/);
    assert.doesNotMatch(role, /s3:PutObject|s3:\*/, "read only");
  });

  await test("GA4 access: a 403 is sorted into no access or API disabled; anything else is not an access problem", () => {
    const e = (status, msg) => Object.assign(new Error(`GA4 answered ${status}: ${msg}`), { status });
    assert.strictEqual(fi.ga4AccessProblem(e(403, "User does not have sufficient permissions for this property. To learn more about Property ID, see https://developers.google.com/analytics/devguides/reporting/data/v1/property-id.")), "no-access");
    assert.strictEqual(fi.ga4AccessProblem(e(403, "Google Analytics Data API has not been used in project 410903316373 before or it is disabled.")), "api-disabled");
    assert.strictEqual(fi.ga4AccessProblem(new Error("GA4 answered 403: User does not have sufficient permissions for this property.")), "no-access", "read from the message when the status is not on the error");
    assert.strictEqual(fi.ga4AccessProblem(e(401, "Request had invalid authentication credentials.")), "");
    assert.strictEqual(fi.ga4AccessProblem(e(500, "backend error")), "");
  });

  await test("GA4 access: a refused property records the account it ran as, the property and the project, and retries hourly", async () => {
    const db = fakeDb({ leads: {} });
    const refuse = async () => ({ ok: false, status: 403, text: async () => JSON.stringify({ error: { code: 403, message: "User does not have sufficient permissions for this property.", status: "PERMISSION_DENIED" } }) });
    let t = NOW;
    let asked = 0;
    const j = fi.createFunnelIngestJob({ db, fetch: refuse, ga4AccessToken: async () => "T", serviceAccountEmail: async () => { asked++; return "123-compute@developer.gserviceaccount.com"; }, gcpProject: "backlog-tracker-e4ed2", logger: quiet, now: () => t });
    const out = await j.runIfDue({ budgetMs: 0 });
    assert.strictEqual(out.mode, "backfill");
    assert.deepStrictEqual(out.failed, fi.GA4_SOURCES.map(([src]) => src));
    let st = db.col("consoleConfig").get("funnelIngest");
    assert.deepStrictEqual({ ...st.ga4Access, at: "" }, { ok: false, problem: "no-access", serviceAccount: "123-compute@developer.gserviceaccount.com", propertyId: fi.DEFAULT_PROPERTY_ID, project: "backlog-tracker-e4ed2", at: "" });
    assert.strictEqual(asked, 1, "the account is read once per run");
    assert.strictEqual(st.sources.leads.ok, true, "leads still update");
    // Refused on access: the next hourly call (50 minutes on) tries again, not 6 hours on.
    t = new Date(NOW.getTime() + 30 * 60e3);
    assert.deepStrictEqual(await j.runIfDue(), { skipped: "not due" });
    t = new Date(NOW.getTime() + fi.ACCESS_RETRY_MS + 1);
    // Access granted: the retry backfills, records the access as fine, and the 6-hour rhythm returns.
    const ok = fi.createFunnelIngestJob({ db, fetch: ga4Answers(), ga4AccessToken: async () => "T", serviceAccountEmail: async () => "123-compute@developer.gserviceaccount.com", logger: quiet, now: () => t });
    const again = await ok.runIfDue({ budgetMs: 0 });
    assert.strictEqual(again.mode, "backfill");
    assert.deepStrictEqual(again.failed, []);
    st = db.col("consoleConfig").get("funnelIngest");
    assert.strictEqual(st.ga4Access.ok, true);
    assert.strictEqual(st.ga4Access.problem, "");
    assert.ok(st.backfilledAt);
    t = new Date(t.getTime() + fi.ACCESS_RETRY_MS + 1);
    assert.deepStrictEqual(await ok.runIfDue(), { skipped: "not due" }, "back to every 6 hours once GA4 answers");
  });

  await test("GA4 access: an unknown account is recorded as empty, never guessed; a failing lookup does not stop the run", async () => {
    const db = fakeDb({ leads: {} });
    const off = async () => ({ ok: false, status: 403, text: async () => JSON.stringify({ error: { message: "Google Analytics Data API has not been used in project 1 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/analyticsdata.googleapis.com/overview?project=1" } }) });
    const out = await fi.createFunnelIngestJob({ db, fetch: off, ga4AccessToken: async () => "T", serviceAccountEmail: async () => { throw new Error("no metadata server"); }, logger: quiet, now: () => NOW }).run({ mode: "daily" });
    assert.ok(out.failed.includes("ga4-total"));
    const ga = db.col("consoleConfig").get("funnelIngest").ga4Access;
    assert.strictEqual(ga.problem, "api-disabled");
    assert.strictEqual(ga.serviceAccount, "");
    // A run that never reached GA4 (other sources only) leaves the last record alone.
    await fi.createFunnelIngestJob({ db, fetch: off, ga4AccessToken: async () => "T", logger: quiet, now: () => NOW }).run({ mode: "daily", only: ["leads"] });
    assert.strictEqual(db.col("consoleConfig").get("funnelIngest").ga4Access.problem, "api-disabled");
    const idx = fs.readFileSync(path.join(__dirname, "../functions/index.js"), "utf8");
    assert.match(idx, /serviceAccountEmail: async \(\) => \{\s+try \{ const c = await auth\.getCredentials\(\);/, "index.js reads the account from the credentials");
    assert.match(idx, /computeMetadata\/v1\/instance\/service-accounts\/default\/email/, "then from the metadata server");
  });

  console.log(`funnel-ingest: ${count} passed`);
})().catch((err) => { console.error(err); process.exit(1); });
