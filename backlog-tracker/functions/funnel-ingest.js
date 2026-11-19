"use strict";
// ── Conversion Funnel daily ingest → funnelDaily ──────────────────────────
// Fills the `funnelDaily` collection that Promote › Conversion Funnel
// (public/js/funnel-page.js) and the Dashboard's Conversion funnel tile
// (public/js/dashboard-core.js funnelKpi) read. Until this existed nothing
// wrote the collection, so both showed 0.
//
// Sources, each written per calendar day with an industry and a country
// (market) dimension wherever the source has one:
//   ga4-total     one row per day: GA4 `totalUsers` for the whole site, the
//                 unique visitors figure (users are not additive across rows,
//                 so this is the only row that carries the day's total)
//   ga4-site      day × country × channel × campaign: `visits` (GA4 sessions)
//                 and `users` (GA4 users for that slice)
//   ga4-industry  day × industry × country: real page views of /industries/<slug>/
//                 pages (`pageViews`, GA4 screenPageViews) and the users who
//                 viewed them (`users`); the industry is read from the page path
//   ga4-events    day × country × industry (the event's own `industry`
//                 parameter): `walkthroughs` (product_tour_start),
//                 `calculatorUses`, `demoRequests` (demo_request), `downloads`
//                 (file_download) and `leadForms` (lead_created)
//   google-ads    day × campaign × ad group: `impressions` and `clicks`, read
//                 through GA4's linked Google Ads account (advertiser metrics)
//   leads         day × industry × country × channel: `leads`, from the
//                 console's own `leads` collection; test and archived leads are
//                 never counted
//   ace           day × industry: `aceCreated`, ACE opportunities created
//                 (only while the Partner Central connection answers)
//
// Days: GA4 reports dates in the property's time zone; the console's own
// records (leads, ACE) are bucketed in the same zone (`timeZone`, default
// Australia/Sydney, the team's local zone). Never UTC.
//
// Each run replaces a source's rows for the days it covers, so a re-run never
// double counts. A source that fails keeps its earlier rows and is recorded as
// failed in consoleConfig/funnelIngest (`sources.<name>.ok == false` with the
// error and when it last succeeded), which both pages read to show when the
// data was last updated and flag the failure instead of silently showing 0.
//
// Credentials: none in the repo. GA4 (and Google Ads through GA4's link) is
// read with the Cloud Function's own service account (Application Default
// Credentials, scope analytics.readonly); that account needs Viewer on the GA4
// property. consoleConfig/funnelIngest may override `ga4PropertyId` and
// `timeZone` (server-written; firestore.rules lets clients read it only).
//
// Runs: POST /funnelIngest with X-Board-Key ({mode: "daily" | "backfill",
// days?}), and once a run is due from the hourly aceToGa4 call (index.js), so
// no new schedule or workflow is needed: the first due run backfills 90 days,
// later ones refresh the last 3 days (GA4 keeps settling for ~48 hours).

const crypto = require("crypto");

// The board key check (the same as lead-ingest.js keyMatches, kept here so this
// module needs no Firebase SDK and test/funnel-ingest.test.js can load it bare).
const keyMatches = (given, want) => {
  const a = crypto.createHash("sha256").update(String(given || "")).digest();
  const b = crypto.createHash("sha256").update(String(want || "")).digest();
  return Boolean(want) && want !== "unset" && crypto.timingSafeEqual(a, b);
};

const DEFAULT_PROPERTY_ID = "473743482"; // personalisationhub.com (docs/ga4-industry-attribution.md)
const DEFAULT_TIME_ZONE = "Australia/Sydney";
const CONFIG_DOC = ["consoleConfig", "funnelIngest"];
const COLLECTION = "funnelDaily";
const BACKFILL_DAYS = 90;
const DAILY_DAYS = 3;
const DUE_AFTER_MS = 6 * 3600e3;
const SOURCES = ["ga4-total", "ga4-site", "ga4-industry", "ga4-events", "google-ads", "leads", "ace"];
const SOURCE_LABELS = { "ga4-total": "GA4", "ga4-site": "GA4", "ga4-industry": "GA4", "ga4-events": "GA4", "google-ads": "Google Ads", leads: "Leads", ace: "ACE" };

// GA4 event name → funnelDaily field. Several names may feed one field.
const EVENT_FIELDS = {
  product_tour_start: "walkthroughs",
  calculator_use: "calculatorUses",
  ph_ind_calculator: "calculatorUses",
  benefits_calculator: "calculatorUses",
  demo_request: "demoRequests",
  file_download: "downloads",
  lead_created: "leadForms",
};
const EVENT_METRICS = ["walkthroughs", "calculatorUses", "demoRequests", "downloads", "leadForms"];

// ── Pure helpers ──────────────────────────────────────────────────────────
const s = (v) => String(v == null ? "" : v).trim();
const n = (v) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : 0; };

/** GA4's "(not set)" and friends → "". */
function clean(v) {
  const t = s(v);
  return /^\((not set|other|none|direct)\)$/i.test(t) || /^none$/i.test(t) ? "" : t;
}

/** GA4 "20261118" → "2026-11-18". */
function gaDate(v) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(s(v));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : (/^\d{4}-\d{2}-\d{2}$/.test(s(v)) ? s(v) : "");
}

/** An instant → its calendar day ("YYYY-MM-DD") in `timeZone`. */
function dayIn(ms, timeZone) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms));
  const get = (t) => (parts.find((p) => p.type === t) || {}).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Calendar-day arithmetic on "YYYY-MM-DD" (no time zone involved). */
function addDays(day, k) {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + k));
  return t.toISOString().slice(0, 10);
}

/** The days a run covers, oldest first, ending today in `timeZone`. */
function dayWindow(nowMs, timeZone, days) {
  const today = dayIn(nowMs, timeZone);
  return { from: addDays(today, -(days - 1)), to: today };
}

/** "/industries/quick-service-restaurants/" → "Quick Service Restaurants"; "" off an industry page. */
function industryOfPath(path) {
  const m = /^\/industries\/([a-z0-9-]+)\/?/i.exec(s(path).split("?")[0]);
  if (!m) return "";
  return m[1].split("-").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

/** A GA4 `industry` parameter value (a slug, or "none") → a display name. */
function industryOfParam(v) {
  const t = clean(v);
  return t ? industryOfPath(`/industries/${t.toLowerCase().replace(/[^a-z0-9]+/g, "-")}/`) : "";
}

/** GA4's session default channel group → the funnel page's channels. */
function channelOfGroup(group) {
  const g = clean(group).toLowerCase();
  if (!g) return "";
  if (/^paid|cross-network|display/.test(g)) return "Google Ads";
  if (/^organic/.test(g)) return "Organic";
  if (g === "direct") return "Direct";
  if (/referral|affiliates/.test(g)) return "Referral";
  return clean(group);
}

/** Leads' free-text source → a channel (same rules as public/js/funnel-core.js channelOf). */
function channelOfLeadSource(source) {
  const t = s(source).toLowerCase();
  if (!t) return "";
  if (/marketplace|aws/.test(t)) return "AWS Marketplace";
  if (/google|paid|ad(s|words)?\b/.test(t)) return "Google Ads";
  if (/organic|seo|search/.test(t)) return "Organic";
  if (/referr|partner/.test(t)) return "Referral";
  if (/direct|manual|website|form/.test(t)) return "Direct";
  return "";
}

/** A short, stable id fragment for a row's dimensions (FNV-1a, hex). */
function dimHash(parts) {
  let h = 0x811c9dc5;
  for (const ch of parts.join("\u0001")) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

const DIMS = ["channel", "campaign", "adGroup", "creative", "industry", "country", "content", "company"];
/** A complete funnelDaily row (every dimension present, "" when unknown) plus its document id. */
function makeRow(source, date, dims, metrics) {
  const row = { date, source };
  for (const k of DIMS) row[k] = s(dims[k]);
  for (const [k, v] of Object.entries(metrics)) row[k] = n(v);
  const id = `${date}_${source}_${dimHash(DIMS.map((k) => row[k].toLowerCase()))}`;
  return { id, row };
}

/** Adds metric values into a keyed map of rows (several GA4 rows can fold into one). */
function accumulate(map, source, date, dims, metrics) {
  const { id, row } = makeRow(source, date, dims, metrics);
  const have = map.get(id);
  if (!have) { map.set(id, row); return; }
  for (const [k, v] of Object.entries(metrics)) have[k] = n(have[k]) + n(v);
}

// GA4 Data API runReport rows → { dimensionName: value, metricName: number }.
function reportRows(report) {
  const dims = (report.dimensionHeaders || []).map((h) => h.name);
  const mets = (report.metricHeaders || []).map((h) => h.name);
  return (report.rows || []).map((r) => {
    const o = {};
    dims.forEach((d, i) => { o[d] = ((r.dimensionValues || [])[i] || {}).value; });
    mets.forEach((m, i) => { o[m] = Number(((r.metricValues || [])[i] || {}).value) || 0; });
    return o;
  });
}

/** GA4 reports → funnelDaily rows, by source. Pure. */
function ga4Rows({ total = [], site = [], industry = [], events = [], ads = [] }) {
  const out = { "ga4-total": new Map(), "ga4-site": new Map(), "ga4-industry": new Map(), "ga4-events": new Map(), "google-ads": new Map() };
  for (const r of total) { const d = gaDate(r.date); if (d) accumulate(out["ga4-total"], "ga4-total", d, {}, { users: r.totalUsers }); }
  for (const r of site) {
    const d = gaDate(r.date); if (!d) continue;
    accumulate(out["ga4-site"], "ga4-site", d, { country: clean(r.country), channel: channelOfGroup(r.sessionDefaultChannelGroup), campaign: clean(r.sessionCampaignName) },
      { visits: r.sessions, users: r.totalUsers });
  }
  for (const r of industry) {
    const d = gaDate(r.date); const ind = industryOfPath(r.pagePath);
    if (!d || !ind) continue;
    accumulate(out["ga4-industry"], "ga4-industry", d, { industry: ind, country: clean(r.country), content: "Industry page" }, { pageViews: r.screenPageViews, users: r.totalUsers });
  }
  for (const r of events) {
    const d = gaDate(r.date); const field = EVENT_FIELDS[s(r.eventName)];
    if (!d || !field) continue;
    accumulate(out["ga4-events"], "ga4-events", d, { country: clean(r.country), industry: industryOfParam(r["customEvent:industry"]) }, { [field]: r.eventCount });
  }
  for (const r of ads) {
    const d = gaDate(r.date); if (!d) continue;
    accumulate(out["google-ads"], "google-ads", d, { channel: "Google Ads", campaign: clean(r.sessionGoogleAdsCampaignName), adGroup: clean(r.sessionGoogleAdsAdGroupName) },
      { impressions: r.advertiserAdImpressions, clicks: r.advertiserAdClicks });
  }
  // Every event row carries all five event metrics so a reader can sum any of them.
  for (const row of out["ga4-events"].values()) for (const k of EVENT_METRICS) row[k] = n(row[k]);
  return Object.fromEntries(Object.entries(out).map(([k, m]) => [k, [...m.entries()].map(([id, row]) => ({ id, row }))]));
}

const toMs = (v) => {
  if (!v) return 0;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.toDate === "function") return v.toDate().getTime();
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  if (typeof v === "object" && typeof v._seconds === "number") return v._seconds * 1000;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : 0;
};

/** Is this a real lead (never a test lead, never an archived one)? */
const realLead = (l) => !!l && l.test !== true && !l.archivedAt;

/** Console leads → `leads` rows per day in `timeZone`, inside [from, to]. Pure. */
function leadRows(leads, { timeZone, from, to }) {
  const map = new Map();
  for (const l of leads || []) {
    if (!realLead(l)) continue;
    const d = dayIn(toMs(l.createdAt), timeZone);
    if (!d || d < from || d > to) continue;
    const c = l.company || {};
    accumulate(map, "leads", d, {
      industry: s(c.industry || l.sourceIndustry),
      country: s((Array.isArray(c.countries) && c.countries[0]) || l.country || ""),
      channel: channelOfLeadSource(l.source),
      content: s(l.sourceLabel || l.sourcePage),
    }, { leads: 1 });
  }
  return [...map.entries()].map(([id, row]) => ({ id, row }));
}

/** ACE opportunities → `aceCreated` rows per day in `timeZone`, inside [from, to]. Pure. */
function aceRows(opps, { timeZone, from, to }) {
  const map = new Map();
  for (const o of opps || []) {
    const d = dayIn(toMs(o.createdDate), timeZone);
    if (!d || d < from || d > to) continue;
    accumulate(map, "ace", d, { industry: s(o.industry) }, { aceCreated: 1 });
  }
  return [...map.entries()].map(([id, row]) => ({ id, row }));
}

// ── GA4 Data API ──────────────────────────────────────────────────────────
const GA4_REPORTS = {
  total: { dimensions: ["date"], metrics: ["totalUsers"] },
  site: { dimensions: ["date", "country", "sessionDefaultChannelGroup", "sessionCampaignName"], metrics: ["sessions", "totalUsers"] },
  industry: {
    dimensions: ["date", "pagePath", "country"], metrics: ["screenPageViews", "totalUsers"],
    dimensionFilter: { filter: { fieldName: "pagePath", stringFilter: { matchType: "BEGINS_WITH", value: "/industries/" } } },
  },
  events: {
    dimensions: ["date", "eventName", "country", "customEvent:industry"], metrics: ["eventCount"],
    dimensionFilter: { filter: { fieldName: "eventName", inListFilter: { values: Object.keys(EVENT_FIELDS) } } },
  },
  ads: { dimensions: ["date", "sessionGoogleAdsCampaignName", "sessionGoogleAdsAdGroupName"], metrics: ["advertiserAdImpressions", "advertiserAdClicks"] },
};

function createGa4Client({ propertyId, accessToken, fetch: fetchImpl = globalThis.fetch }) {
  async function runReport(spec, { from, to }) {
    const rows = [];
    let offset = 0;
    let headers = null;
    for (let page = 0; page < 20; page++) {
      const body = {
        dateRanges: [{ startDate: from, endDate: to }],
        dimensions: spec.dimensions.map((name) => ({ name })),
        metrics: spec.metrics.map((name) => ({ name })),
        limit: 100000, offset, keepEmptyRows: false,
        ...(spec.dimensionFilter ? { dimensionFilter: spec.dimensionFilter } : {}),
      };
      const token = await accessToken();
      const res = await fetchImpl(`https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const text = await res.text();
      let json = {};
      try { json = JSON.parse(text || "{}"); } catch { json = {}; }
      if (!res.ok) {
        const msg = (json.error && json.error.message) || text || `HTTP ${res.status}`;
        const err = new Error(`GA4 answered ${res.status}: ${String(msg).slice(0, 240)}`);
        err.status = res.status;
        throw err;
      }
      headers = headers || { dimensionHeaders: json.dimensionHeaders, metricHeaders: json.metricHeaders };
      rows.push(...(json.rows || []));
      offset += (json.rows || []).length;
      if (!json.rows || !json.rows.length || offset >= Number(json.rowCount || 0)) break;
    }
    return reportRows({ ...(headers || {}), rows });
  }
  return { runReport };
}

// ── The job ───────────────────────────────────────────────────────────────
function createFunnelIngestJob({
  db, ga4AccessToken, partnerCentral = null, boardKey = () => "",
  fetch: fetchImpl = globalThis.fetch, logger = console, now = () => new Date(), serverTimestamp = () => now(),
}) {
  const configRef = () => db.collection(CONFIG_DOC[0]).doc(CONFIG_DOC[1]);

  async function readConfig() {
    const snap = await configRef().get();
    const d = (snap && snap.exists ? snap.data() : null) || {};
    return {
      raw: d,
      propertyId: s(d.ga4PropertyId) || DEFAULT_PROPERTY_ID,
      timeZone: (() => { const tz = s(d.timeZone) || DEFAULT_TIME_ZONE; try { new Intl.DateTimeFormat("en", { timeZone: tz }); return tz; } catch { return DEFAULT_TIME_ZONE; } })(),
    };
  }

  // Replace one source's rows for [from, to] with `rows`.
  async function replaceRows(source, { from, to }, rows) {
    const existing = await db.collection(COLLECTION).where("date", ">=", from).where("date", "<=", to).get();
    const keep = new Set(rows.map((r) => r.id));
    const ops = [];
    for (const d of existing.docs) if (d.data().source === source && !keep.has(d.id)) ops.push((b) => b.delete(d.ref));
    const at = serverTimestamp();
    for (const { id, row } of rows) ops.push((b) => b.set(db.collection(COLLECTION).doc(id), { ...row, ingestedAt: at }));
    for (let i = 0; i < ops.length; i += 450) {
      const batch = db.batch();
      ops.slice(i, i + 450).forEach((op) => op(batch));
      await batch.commit();
    }
    return { written: rows.length, removed: ops.length - rows.length };
  }

  async function run({ mode = "daily", days } = {}) {
    const startedAt = now();
    const cfg = await readConfig();
    const span = Math.max(1, Math.min(BACKFILL_DAYS, Number(days) || (mode === "backfill" ? BACKFILL_DAYS : DAILY_DAYS)));
    const window = dayWindow(startedAt.getTime(), cfg.timeZone, span);
    const prevSources = (cfg.raw && cfg.raw.sources) || {};
    const sources = {};
    const record = (name, ok, extra) => {
      const prev = prevSources[name] || {};
      sources[name] = ok
        ? { ok: true, at: startedAt.toISOString(), lastSuccessAt: startedAt.toISOString(), error: "", ...extra }
        : { ok: false, at: startedAt.toISOString(), lastSuccessAt: prev.lastSuccessAt || null, error: String(extra.error || "failed").slice(0, 300) };
    };

    // GA4 (four reports) and Google Ads (through GA4's link) — each report on its own.
    let token = null;
    const ga4 = createGa4Client({ propertyId: cfg.propertyId, fetch: fetchImpl, accessToken: async () => { if (!token) token = await ga4AccessToken(); return token; } });
    const ga4Sources = [["ga4-total", "total"], ["ga4-site", "site"], ["ga4-industry", "industry"], ["ga4-events", "events"], ["google-ads", "ads"]];
    for (const [source, key] of ga4Sources) {
      try {
        let report;
        try { report = await ga4.runReport(GA4_REPORTS[key], window); }
        catch (err) {
          // The `industry` event parameter is a registered custom dimension; without it, read events with no industry.
          if (key !== "events" || err.status !== 400 || !/customEvent:industry/.test(err.message)) throw err;
          report = await ga4.runReport({ ...GA4_REPORTS.events, dimensions: GA4_REPORTS.events.dimensions.filter((d) => d !== "customEvent:industry") }, window);
        }
        const rows = ga4Rows({ [key]: report })[source];
        const res = await replaceRows(source, window, rows);
        record(source, true, { rows: res.written });
      } catch (err) {
        record(source, false, { error: (err && err.message) || err });
        logger.error("funnelIngest: source failed", { source, error: String((err && err.message) || err).slice(0, 300) });
      }
    }

    // Console leads (test and archived leads never counted).
    try {
      const leads = (await db.collection("leads").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
      const res = await replaceRows("leads", window, leadRows(leads, { timeZone: cfg.timeZone, ...window }));
      record("leads", true, { rows: res.written });
    } catch (err) { record("leads", false, { error: (err && err.message) || err }); }

    // ACE opportunities, where the Partner Central connection answers.
    if (partnerCentral && typeof partnerCentral.aceOpportunities === "function") {
      try {
        const ace = await partnerCentral.aceOpportunities({ by: "funnelIngest" });
        const res = await replaceRows("ace", window, aceRows(ace.opportunities, { timeZone: cfg.timeZone, ...window }));
        record("ace", true, { rows: res.written, catalog: s(ace.catalog) });
      } catch (err) { record("ace", false, { error: (err && err.message) || err }); }
    }

    const failed = Object.entries(sources).filter(([, v]) => !v.ok).map(([k]) => k);
    const status = {
      lastRunAt: startedAt.toISOString(),
      lastMode: mode,
      lastWindow: window,
      timeZone: cfg.timeZone,
      ok: failed.length === 0,
      failed,
      sources: { ...prevSources, ...sources },
      ...(failed.length === 0 ? { lastSuccessAt: startedAt.toISOString() } : {}),
      ...(mode === "backfill" && !failed.some((f) => f.startsWith("ga4")) ? { backfilledAt: startedAt.toISOString() } : {}),
    };
    await configRef().set(status, { merge: true });
    logger.info("funnelIngest run", { mode, window, failed });
    return { mode, window, failed, sources };
  }

  // Due: never backfilled → a 90-day backfill; else a daily refresh when the
  // last attempt is 6 hours old or more.
  async function runIfDue() {
    const cfg = await readConfig();
    const d = cfg.raw || {};
    if (!d.backfilledAt) {
      const last = Date.parse(d.lastRunAt || "");
      if (Number.isFinite(last) && now().getTime() - last < DUE_AFTER_MS) return { skipped: "not due" };
      return run({ mode: "backfill" });
    }
    const last = Date.parse(d.lastRunAt || "");
    if (Number.isFinite(last) && now().getTime() - last < DUE_AFTER_MS) return { skipped: "not due" };
    return run({ mode: "daily" });
  }

  // POST /  header X-Board-Key  body {mode?: "daily" | "backfill" | "due", days?}
  async function handle(req, res) {
    const send = (code, body) => res.status(code).set("Cache-Control", "no-store").json(body);
    if (req.method !== "POST") { res.set("Allow", "POST"); return send(405, { error: "POST only" }); }
    if (!keyMatches(req.get("x-board-key"), boardKey())) return send(401, { error: "invalid key" });
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const mode = ["daily", "backfill", "due"].includes(body.mode) ? body.mode : "daily";
    try {
      const out = mode === "due" ? await runIfDue() : await run({ mode, days: body.days });
      return send(200, { ok: true, ...out });
    } catch (err) {
      logger.error("funnelIngest failed", { error: String((err && err.message) || err) });
      return send(500, { error: String((err && err.message) || err).slice(0, 300) });
    }
  }

  return { run, runIfDue, handle, readConfig };
}

module.exports = {
  createFunnelIngestJob, createGa4Client, ga4Rows, leadRows, aceRows, reportRows, makeRow,
  industryOfPath, industryOfParam, channelOfGroup, channelOfLeadSource, gaDate, dayIn, addDays, dayWindow, clean,
  GA4_REPORTS, EVENT_FIELDS, EVENT_METRICS, SOURCES, SOURCE_LABELS, DEFAULT_PROPERTY_ID, DEFAULT_TIME_ZONE, BACKFILL_DAYS, DAILY_DAYS, DUE_AFTER_MS,
};
