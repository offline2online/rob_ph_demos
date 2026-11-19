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

  console.log(`funnel-ingest: ${count} passed`);
})().catch((err) => { console.error(err); process.exit(1); });
