// Promote › Conversion Funnel: the rules behind the page (funnel-page.js).
// Pure functions, no DOM and no Firestore, so test/funnel.test.mjs drives them.
//
// Stages 1-5 (the marketing half) are daily rows in `funnelDaily`, written only
// by the server-side ingest (functions/funnel-ingest.js) from GA4 and the Google
// Ads account linked to it; the console reads them. Stages 6-9 come from what the console
// already holds: AWS ACE opportunities, joined to Leads and Prospects (TAM) on
// company name. A row of `funnelDaily`:
//   date "YYYY-MM-DD" (a calendar day in the reporting property's time zone),
//   channel, campaign, adGroup, creative, industry, country, content, company,
//   impressions, clicks, visits, demoRequests, downloads  (numbers)
//   source ("ga4-total" | "ga4-site" | "ga4-industry" | "ga4-industry-total" |
//   "ga4-industry-users" | "ga4-events" |
//   "google-ads" | "leads" | "ace" | "pc-export", functions/funnel-ingest.js), and per source
//   users, pageViews, walkthroughs, calculatorUses, leadForms, leads, aceCreated;
//   a "pc-export" row (the Partner Central S3 data export, functions/pc-export.js)
//   is one ACE opportunity's revenue on a day: aceId, stage, currency,
//   attributedRevenue, marketplaceRevenue, fundingUsed. It feeds the Revenue
//   stage only, never the counts above it.
// Dates are calendar days and the page works in the viewer's local days; nothing
// here formats or compares a UTC instant.

export const STAGES = [
  { key: "impressions", label: "Ad impressions", source: "Google Ads", icon: "ads_click", info: "Times a Personalisation Hub ad was shown (Google Ads, through the account linked to GA4)." },
  { key: "clicks", label: "Click-throughs", source: "Google Ads", icon: "touch_app", info: "Clicks on those ads (Google Ads)." },
  { key: "visits", label: "Site visits", source: "GA4", icon: "language", info: "Sessions on personalisationhub.com (GA4, imported daily)." },
  { key: "demos", label: "Demo requests", source: "GA4", icon: "event_available", info: "Demo request form submissions (GA4)." },
  { key: "downloads", label: "Calculator / model downloads", source: "GA4", icon: "download", info: "Benefits calculator uses and file downloads, such as the business model (GA4)." },
  { key: "aceCreated", label: "ACE opportunities created", source: "Console", icon: "add_business", info: "AWS ACE opportunities created in the period (console, from Partner Central)." },
  { key: "aceOpen", label: "ACE opportunities open", source: "Console", icon: "pending_actions", info: "Of those created, the ones still open (not Launched and not Closed Lost)." },
  { key: "aceClosed", label: "ACE opportunities closed", source: "Console", icon: "task_alt", info: "Won (Launched) or lost (Closed Lost). Measured against the opportunities created, since an opportunity leaves 'open' when it closes.", from: "aceCreated" },
  { key: "deployed", label: "Deployed", source: "Console", icon: "rocket_launch", info: "Closed-won opportunities that have launched." },
  { key: "revenue", label: "Revenue", source: "Partner Central", icon: "payments", money: true, info: "Revenue from the Partner Central data export: AWS Revenue Measurement attributed revenue where an opportunity has it, otherwise its AWS Marketplace revenue. An amount, so it has no % of the stage above." },
];
export const STAGE_KEYS = STAGES.map((s) => s.key);

export const CHANNELS = ["Google Ads", "Organic", "Direct", "Referral", "AWS Marketplace"];

export const EMPTY_FILTER = { from: "", to: "", industry: "", channel: "", campaign: "", adGroup: "", company: "", country: "", content: "", compare: false };

// Stage -> the row field(s) summed for it.
// The Revenue stage's amount for one export row: attributed revenue where there is any, else Marketplace revenue.
export const revenueOf = (r) => (num(r.attributedRevenue) > 0 ? num(r.attributedRevenue) : num(r.marketplaceRevenue));
const WEB_METRICS = { impressions: ["impressions"], clicks: ["clicks"], visits: ["visits"], demos: ["demoRequests"], downloads: ["downloads", "calculatorUses"] };
const eq = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
const num = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
const normName = (s) => String(s || "").toLowerCase().replace(/\b(ltd|limited|plc|inc|llc|gmbh|corp|corporation|co|the)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();

// ── Local calendar days ────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, "0");
export function localDay(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
// An ISO instant (or Date) -> the viewer's local calendar day, or "".
export function dayOfInstant(v) {
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? "" : localDay(d);
}
function parseDay(s) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "")); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
export function addDays(day, n) { const d = parseDay(day); if (!d) return ""; d.setDate(d.getDate() + n); return localDay(d); }
export function daysBetween(from, to) { const a = parseDay(from), b = parseDay(to); return a && b ? Math.round((b - a) / 86400000) + 1 : 0; }

// The same number of days straight before the range.
export function previousRange(from, to) {
  const n = daysBetween(from, to);
  if (n < 1) return null;
  return { from: addDays(from, -n), to: addDays(from, -1) };
}
// Quick ranges, ending today (local).
export function presetRange(key, today = new Date()) {
  const to = localDay(today);
  const days = { "7d": 7, "30d": 30, "90d": 90 }[key];
  if (days) return { from: addDays(to, -(days - 1)), to };
  if (key === "month") return { from: localDay(new Date(today.getFullYear(), today.getMonth(), 1)), to };
  return { from: "", to: "" };
}
const inRange = (day, from, to) => !!day && (!from || day >= from) && (!to || day <= to);

// ── The joined company records ─────────────────────────────────────────────
// Leads' source text -> one of the channels, or "".
export function channelOf(source) {
  const s = String(source || "").toLowerCase();
  if (!s) return "";
  if (/marketplace|aws/.test(s)) return "AWS Marketplace";
  if (/google|paid|ad(s|words)?\b/.test(s)) return "Google Ads";
  if (/organic|seo|search/.test(s)) return "Organic";
  if (/referr|partner/.test(s)) return "Referral";
  if (/direct|manual|website|form/.test(s)) return "Direct";
  return "";
}

// One record per ACE opportunity, carrying what the filters need from the
// prospect (industry, country, campaigns) and lead (channel, content) it joins.
// A Demand Center campaign named on the opportunity's Partner Central export row
// (exportRows, from funnelDaily "pc-export") is added to its campaigns, so a
// campaign filter traces campaign → lead → ACE opportunity.
export function joinOpportunities(opps, leads, prospects, exportRows = []) {
  const exportCampaigns = new Map();
  for (const r of exportRows || []) if (r.aceId && r.campaign) exportCampaigns.set(r.aceId, [...(exportCampaigns.get(r.aceId) || []), r.campaign]);
  const byName = new Map();
  for (const p of prospects || []) { const k = normName(p.name); if (k && !byName.has(k)) byName.set(k, p); }
  const leadByName = new Map();
  for (const l of leads || []) { const k = normName(l.company && l.company.name); if (k && !leadByName.has(k)) leadByName.set(k, l); }
  return (opps || []).map((o) => {
    const k = normName(o.customer);
    const p = byName.get(k) || null;
    const l = leadByName.get(k) || null;
    const stage = String(o.stage || "");
    return {
      id: String(o.id || ""),
      company: String(o.customer || ""),
      day: dayOfInstant(o.createdDate),
      industry: String(o.industry || (p && p.industry) || (l && l.company && l.company.industry) || ""),
      country: String((p && (p.country || p.hqCountry)) || (l && l.company && l.company.countries[0]) || ""),
      channel: channelOf(l && l.source),
      campaigns: [...new Set([...(p ? p.campaigns : []), ...(exportCampaigns.get(String(o.id || "")) || [])])],
      content: String((l && (l.sourceLabel || l.sourcePage)) || ""),
      lost: eq(stage, "Closed Lost"),
      won: eq(stage, "Launched"),
    };
  });
}

// ── Filtering ──────────────────────────────────────────────────────────────
const webMatches = (r, f) => (!f.industry || eq(r.industry, f.industry)) && (!f.channel || eq(r.channel, f.channel))
  && (!f.campaign || eq(r.campaign, f.campaign)) && (!f.adGroup || eq(r.adGroup, f.adGroup) || eq(r.creative, f.adGroup))
  && (!f.company || eq(r.company, f.company)) && (!f.country || eq(r.country, f.country)) && (!f.content || eq(r.content, f.content));

const aceMatches = (o, f) => (!f.industry || eq(o.industry, f.industry)) && (!f.channel || eq(o.channel, f.channel))
  && (!f.campaign || o.campaigns.some((c) => eq(c, f.campaign)))
  && (!f.company || eq(o.company, f.company)) && (!f.country || eq(o.country, f.country)) && (!f.content || eq(o.content, f.content));

// A filter that only exists in the ad data (an ad group or creative) cannot be
// applied to a company-level record, so it empties those stages rather than
// pretending every opportunity matched.
const aceCannotMatch = (f) => !!f.adGroup;

// Counts for one range. Stages with no source data stay 0; `hasData` says which half had anything.
export function stageCounts(f, range, data) {
  const out = Object.fromEntries(STAGE_KEYS.map((k) => [k, 0]));
  let webRows = 0, fundingUsed = 0, currency = "";
  for (const r of data.web || []) {
    if (!inRange(r.date, range.from, range.to) || !webMatches(r, f)) continue;
    if (r.source === "pc-export") {
      // Company-level, like the ACE stages: an ad group filter empties it.
      if (aceCannotMatch(f)) continue;
      out.revenue += revenueOf(r); fundingUsed += num(r.fundingUsed); currency = currency || r.currency;
      continue;
    }
    webRows++;
    for (const [stage, fields] of Object.entries(WEB_METRICS)) for (const field of fields) out[stage] += num(r[field]);
  }
  if (!aceCannotMatch(f)) {
    for (const o of data.ace || []) {
      if (!inRange(o.day, range.from, range.to) || !aceMatches(o, f)) continue;
      out.aceCreated++;
      if (!o.won && !o.lost) out.aceOpen++;
      if (o.won || o.lost) out.aceClosed++;
      if (o.won) out.deployed++;
    }
  }
  out.revenue = Math.round(out.revenue * 100) / 100;
  return { counts: out, webRows, fundingUsed: Math.round(fundingUsed * 100) / 100, currency: currency || "USD" };
}

const pct = (n, d) => (d > 0 ? (n / d) * 100 : null);

// The funnel as the page draws it: per stage the count, the % of the previous
// stage (or the stage named by `from`), the % of the top, and, when compare is
// on, the previous period's count and the change.
export function buildFunnel(f, data) {
  const range = { from: f.from, to: f.to };
  const cur = stageCounts(f, range, data);
  const prevRange = f.compare ? previousRange(f.from, f.to) : null;
  const prev = prevRange ? stageCounts(f, prevRange, data) : null;
  const top = cur.counts[STAGES[0].key];
  const prevTop = prev ? prev.counts[STAGES[0].key] : 0;
  const stages = STAGES.map((s, i) => {
    const count = cur.counts[s.key];
    // An amount (Revenue) has no % of a count above it, nor of the top.
    const base = s.money ? null : s.from ? cur.counts[s.from] : i > 0 ? cur.counts[STAGES[i - 1].key] : null;
    const row = { key: s.key, label: s.label, icon: s.icon, source: s.source, info: s.info, money: !!s.money, count, fromPrev: base == null ? null : pct(count, base), ofTop: s.money ? null : i === 0 ? 100 : pct(count, top), width: 0 };
    if (s.money) { row.currency = cur.currency; row.fundingUsed = cur.fundingUsed; }
    if (prev) {
      const pCount = prev.counts[s.key];
      const pBase = s.money ? null : s.from ? prev.counts[s.from] : i > 0 ? prev.counts[STAGES[i - 1].key] : null;
      row.prev = { count: pCount, fromPrev: pBase == null ? null : pct(pCount, pBase), ofTop: s.money ? null : i === 0 ? 100 : pct(pCount, prevTop) };
      row.change = { count: count - pCount, countPct: pct(count - pCount, pCount), points: row.fromPrev == null || row.prev.fromPrev == null ? null : row.fromPrev - row.prev.fromPrev };
    }
    return row;
  });
  // Bar width: log-ish scale would hide drop-off, so it is each stage's share of
  // the top, floored so a tiny stage is still a visible bar.
  // Revenue is an amount, not a count, so it is not on the counts' scale: its
  // bar is as wide as the Deployed bar it follows (or the narrowest bar).
  const counted = stages.filter((s) => !s.money);
  const max = Math.max(...counted.map((s) => s.count), 0);
  for (const s of counted) s.width = max > 0 ? Math.max(6, Math.round((s.count / max) * 100)) : 0;
  for (const s of stages) if (s.money) s.width = s.count > 0 ? Math.max(6, (counted[counted.length - 1] || {}).width || 0) : 0;
  const empty = stages.every((s) => s.count === 0);
  return { stages, empty, prevRange, hasWebData: cur.webRows > 0, hasAceData: (data.ace || []).length > 0, hasExportData: (data.web || []).some((r) => r.source === "pc-export") };
}

// ── Filter options (from what exists, so a choice always has data behind it) ──
export function filterOptions(data, prospects) {
  const set = (xs) => [...new Set(xs.map((x) => String(x || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const web = data.web || [], ace = data.ace || [];
  return {
    industry: set([...web.map((r) => r.industry), ...ace.map((o) => o.industry), ...(prospects || []).map((p) => p.industry)]),
    channel: CHANNELS,
    campaign: set([...web.map((r) => r.campaign), ...(prospects || []).flatMap((p) => p.campaigns)]),
    adGroup: set(web.flatMap((r) => [r.adGroup, r.creative])),
    company: set([...(prospects || []).map((p) => p.name), ...ace.map((o) => o.company), ...web.map((r) => r.company)]),
    country: set([...web.map((r) => r.country), ...ace.map((o) => o.country), ...(prospects || []).map((p) => p.country)]),
    content: set([...web.map((r) => r.content), ...ace.map((o) => o.content)]),
  };
}

// A funnelDaily document -> a clean row.
export function normaliseWebRow(id, d) {
  const x = d || {};
  const s = (v) => String(v == null ? "" : v).trim();
  return {
    id, date: dayOfInstant(s(x.date)), channel: s(x.channel), campaign: s(x.campaign), adGroup: s(x.adGroup), creative: s(x.creative),
    industry: s(x.industry), country: s(x.country), content: s(x.content), company: s(x.company),
    impressions: num(x.impressions), clicks: num(x.clicks), visits: num(x.visits), demoRequests: num(x.demoRequests), downloads: num(x.downloads),
    calculatorUses: num(x.calculatorUses),
    source: s(x.source), aceId: s(x.aceId), currency: s(x.currency).toUpperCase().slice(0, 3),
    attributedRevenue: num(x.attributedRevenue), marketplaceRevenue: num(x.marketplaceRevenue), fundingUsed: num(x.fundingUsed),
  };
}

// ── Ingest status (consoleConfig/funnelIngest, written by functions/funnel-ingest.js) ──
// What the pages show about the data behind the funnel: when it was last
// updated and which sources failed on the last run, so a broken credential
// reads as a flagged failure rather than a silent 0.
const SOURCE_NAMES = { "ga4-total": "GA4", "ga4-site": "GA4", "ga4-industry": "GA4", "ga4-industry-total": "GA4", "ga4-industry-users": "GA4", "ga4-events": "GA4", "google-ads": "Google Ads", leads: "Leads", ace: "ACE", "pc-export": "Partner Central export" };
const isoMs = (v) => {
  if (!v) return 0;
  if (typeof v.toMillis === "function") return v.toMillis();
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : 0;
};
// Why GA4 refused, from its error text ("no-access", "api-disabled", or ""), the same
// rule as functions/funnel-ingest.js ga4AccessProblem: for a status written before
// the ingest recorded `ga4Access` itself.
export function ga4AccessProblemOf(error) {
  const msg = String(error || "");
  if (!/\b403\b/.test(msg)) return "";
  if (/has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured|API has not been enabled/i.test(msg)) return "api-disabled";
  if (/sufficient permissions|permission|PERMISSION_DENIED/i.test(msg)) return "no-access";
  return "";
}
const GA4_READ_SOURCES = ["ga4-total", "ga4-site", "ga4-industry", "ga4-industry-total", "ga4-industry-users", "ga4-events", "google-ads"];
export function ingestStatusView(status) {
  const st = status && typeof status === "object" ? status : null;
  if (!st || !st.lastRunAt) return { known: false, updatedAt: 0, failures: [], flagged: false };
  const sources = st.sources && typeof st.sources === "object" ? st.sources : {};
  // Last updated: the newest success of any GA4 source (the site's own data), else of anything.
  const okAt = (keys) => Math.max(0, ...keys.map((k) => isoMs(sources[k] && sources[k].lastSuccessAt)));
  const ga4Keys = Object.keys(sources).filter((k) => k.startsWith("ga4"));
  const updatedAt = okAt(ga4Keys) || okAt(Object.keys(sources)) || isoMs(st.lastSuccessAt);
  const byName = new Map();
  for (const [key, v] of Object.entries(sources)) {
    if (!v || v.ok !== false) continue;
    const name = SOURCE_NAMES[key] || key;
    if (!byName.has(name)) byName.set(name, { name, error: String(v.error || ""), lastSuccessAt: isoMs(v.lastSuccessAt) });
  }
  const failures = [...byName.values()];
  // The Partner Central export: "not set up yet" (no bucket configured) is a
  // neutral state, not a failure; once set up, when its newest export was read.
  const pc = sources["pc-export"] || null;
  const pcExport = !pc ? null : { notSetUp: pc.notSetUp === true, ok: pc.ok !== false, exportedAt: isoMs(pc.exportedAt), lastSuccessAt: isoMs(pc.lastSuccessAt) };
  // GA4 refused on access (Google Ads is read through GA4, so it fails with it): who
  // needs which access. The ingest records it (`ga4Access`); an older status is read
  // from the sources' errors, without the account.
  const ga = st.ga4Access && typeof st.ga4Access === "object" ? st.ga4Access : null;
  const fromErrors = GA4_READ_SOURCES.map((k) => sources[k]).filter((v) => v && v.ok === false).map((v) => ga4AccessProblemOf(v.error)).find(Boolean) || "";
  const problem = ga ? (ga.ok === false ? String(ga.problem || "") || fromErrors : "") : fromErrors;
  const ga4Access = !problem ? null : {
    problem,
    serviceAccount: String((ga && ga.serviceAccount) || ""),
    propertyId: String((ga && ga.propertyId) || ""),
    project: String((ga && ga.project) || ""),
    lastSuccessAt: okAt(GA4_READ_SOURCES),
  };
  return { known: true, updatedAt, failures, flagged: failures.length > 0, pcExport, ga4Access };
}
// Where to fix a GA4 access problem: the property's access management, or the
// Data API's page in the Google Cloud console.
export function ga4AccessLinks(access) {
  const a = access || {};
  const prop = /^\d+$/.test(a.propertyId || "") ? a.propertyId : "";
  const proj = /^[a-z][a-z0-9-]{4,29}$/.test(a.project || "") ? a.project : "";
  return {
    propertyAccess: prop ? `https://analytics.google.com/analytics/web/#/p${prop}/admin/suiteusermanagement/property` : "https://analytics.google.com/analytics/web/",
    enableApi: `https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com${proj ? `?project=${proj}` : ""}`,
  };
}
// "19 Nov 2026, 06:10" in the viewer's own locale and time zone; "never" for 0.
export function fmtUpdated(ms) {
  return ms ? new Date(ms).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "never";
}
// One plain sentence naming the failed sources, for the page's status line and the Dashboard tooltip.
export function ingestFailureText(view) {
  if (!view || !view.flagged) return "";
  const ga = view.ga4Access;
  // An access problem replaces the GA4 and Google Ads lines with what to do about it.
  const access = !ga ? "" : ga.problem === "api-disabled"
    ? `GA4 didn't update: the Google Analytics Data API is turned off${ga.project ? ` for Google Cloud project ${ga.project}` : ""}. Enable it and the data follows within the hour; last good update ${fmtUpdated(ga.lastSuccessAt)}.`
    : `GA4 didn't update: ${ga.serviceAccount ? `the service account ${ga.serviceAccount}` : "the console's service account"} has no access to GA4 property ${ga.propertyId || "(not recorded)"}. Add it as a Viewer in the property's access management and the data follows within the hour; last good update ${fmtUpdated(ga.lastSuccessAt)}.`;
  const rest = (ga ? view.failures.filter((f) => f.name !== "GA4" && f.name !== "Google Ads") : view.failures);
  return [access, ...rest.map((f) => `${f.name} didn't update${f.error ? ` (${f.error})` : ""}; last good update ${fmtUpdated(f.lastSuccessAt)}.`)].filter(Boolean).join(" ");
}

// ── Formatting ─────────────────────────────────────────────────────────────
export const fmtCount = (n) => new Intl.NumberFormat("en-GB").format(n);
// An amount in its currency, whole units ("US$12,400" style per the viewer's locale; en-GB gives "US$12,400").
export function fmtMoney(n, currency = "USD") {
  const cur = /^[A-Z]{3}$/.test(String(currency || "")) ? currency : "USD";
  try { return new Intl.NumberFormat("en-GB", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(n || 0); }
  catch { return `${cur} ${fmtCount(Math.round(n || 0))}`; }
}
export function fmtPct(p) { return p == null ? "–" : `${p >= 10 ? Math.round(p) : Number(p.toFixed(1))}%`; }
export function fmtChange(c, currency) {
  if (!c) return "";
  const sign = c.count > 0 ? "+" : c.count < 0 ? "−" : "";
  const pc = c.countPct == null ? "" : ` (${c.countPct > 0 ? "+" : c.countPct < 0 ? "−" : ""}${Math.abs(c.countPct).toFixed(0)}%)`;
  return `${sign}${currency ? fmtMoney(Math.abs(c.count), currency) : fmtCount(Math.abs(c.count))}${pc}`;
}
// A day as the viewer reads it, in their own locale and time zone.
export function fmtDay(day) { const d = parseDay(day); return d ? d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : ""; }
