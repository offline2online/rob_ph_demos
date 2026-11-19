// Promote › Conversion Funnel: the rules behind the page (funnel-page.js).
// Pure functions, no DOM and no Firestore, so test/funnel.test.mjs drives them.
//
// Stages 1-5 (the marketing half) are daily rows in `funnelDaily`, written only
// by the server-side ingest from Google Ads and the GA4 BigQuery export
// (ph-analytics); the console reads them. Stages 6-9 come from what the console
// already holds: AWS ACE opportunities, joined to Leads and Prospects (TAM) on
// company name. A row of `funnelDaily`:
//   date "YYYY-MM-DD" (a calendar day in the reporting property's time zone),
//   channel, campaign, adGroup, creative, industry, country, content, company,
//   impressions, clicks, visits, demoRequests, downloads  (numbers)
// Dates are calendar days and the page works in the viewer's local days; nothing
// here formats or compares a UTC instant.

export const STAGES = [
  { key: "impressions", label: "Ad impressions", source: "Google Ads", icon: "ads_click", info: "Times a Personalisation Hub ad was shown (Google Ads)." },
  { key: "clicks", label: "Click-throughs", source: "Google Ads", icon: "touch_app", info: "Clicks on those ads (Google Ads)." },
  { key: "visits", label: "Site visits", source: "GA4", icon: "language", info: "Sessions on personalisationhub.com (GA4, daily BigQuery export in ph-analytics)." },
  { key: "demos", label: "Demo requests", source: "GA4", icon: "event_available", info: "Demo request form submissions (GA4)." },
  { key: "downloads", label: "Calculator / model downloads", source: "GA4", icon: "download", info: "Calculator or business model downloads (GA4)." },
  { key: "aceCreated", label: "ACE opportunities created", source: "Console", icon: "add_business", info: "AWS ACE opportunities created in the period (console, from Partner Central)." },
  { key: "aceOpen", label: "ACE opportunities open", source: "Console", icon: "pending_actions", info: "Of those created, the ones still open (not Launched and not Closed Lost)." },
  { key: "aceClosed", label: "ACE opportunities closed", source: "Console", icon: "task_alt", info: "Won (Launched) or lost (Closed Lost). Measured against the opportunities created, since an opportunity leaves 'open' when it closes.", from: "aceCreated" },
  { key: "deployed", label: "Deployed", source: "Console", icon: "rocket_launch", info: "Closed-won opportunities that have launched." },
];
export const STAGE_KEYS = STAGES.map((s) => s.key);

export const CHANNELS = ["Google Ads", "Organic", "Direct", "Referral", "AWS Marketplace"];

export const EMPTY_FILTER = { from: "", to: "", industry: "", channel: "", campaign: "", adGroup: "", company: "", country: "", content: "", compare: false };

const WEB_METRICS = { impressions: "impressions", clicks: "clicks", visits: "visits", demos: "demoRequests", downloads: "downloads" };
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
export function joinOpportunities(opps, leads, prospects) {
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
      campaigns: p ? p.campaigns : [],
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
  let webRows = 0;
  for (const r of data.web || []) {
    if (!inRange(r.date, range.from, range.to) || !webMatches(r, f)) continue;
    webRows++;
    for (const [stage, field] of Object.entries(WEB_METRICS)) out[stage] += num(r[field]);
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
  return { counts: out, webRows };
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
    const base = s.from ? cur.counts[s.from] : i > 0 ? cur.counts[STAGES[i - 1].key] : null;
    const row = { key: s.key, label: s.label, icon: s.icon, source: s.source, info: s.info, count, fromPrev: base == null ? null : pct(count, base), ofTop: i === 0 ? 100 : pct(count, top), width: 0 };
    if (prev) {
      const pCount = prev.counts[s.key];
      const pBase = s.from ? prev.counts[s.from] : i > 0 ? prev.counts[STAGES[i - 1].key] : null;
      row.prev = { count: pCount, fromPrev: pBase == null ? null : pct(pCount, pBase), ofTop: i === 0 ? 100 : pct(pCount, prevTop) };
      row.change = { count: count - pCount, countPct: pct(count - pCount, pCount), points: row.fromPrev == null || row.prev.fromPrev == null ? null : row.fromPrev - row.prev.fromPrev };
    }
    return row;
  });
  // Bar width: log-ish scale would hide drop-off, so it is each stage's share of
  // the top, floored so a tiny stage is still a visible bar.
  const max = Math.max(...stages.map((s) => s.count), 0);
  for (const s of stages) s.width = max > 0 ? Math.max(6, Math.round((s.count / max) * 100)) : 0;
  const empty = stages.every((s) => s.count === 0);
  return { stages, empty, prevRange, hasWebData: cur.webRows > 0, hasAceData: (data.ace || []).length > 0 };
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
  };
}

// ── Formatting ─────────────────────────────────────────────────────────────
export const fmtCount = (n) => new Intl.NumberFormat("en-GB").format(n);
export function fmtPct(p) { return p == null ? "–" : `${p >= 10 ? Math.round(p) : Number(p.toFixed(1))}%`; }
export function fmtChange(c) {
  if (!c) return "";
  const sign = c.count > 0 ? "+" : c.count < 0 ? "−" : "";
  const pc = c.countPct == null ? "" : ` (${c.countPct > 0 ? "+" : c.countPct < 0 ? "−" : ""}${Math.abs(c.countPct).toFixed(0)}%)`;
  return `${sign}${fmtCount(Math.abs(c.count))}${pc}`;
}
// A day as the viewer reads it, in their own locale and time zone.
export function fmtDay(day) { const d = parseDay(day); return d ? d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : ""; }
