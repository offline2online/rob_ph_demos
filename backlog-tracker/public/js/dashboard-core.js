// Dashboard: the console's landing page (#dashboard). The rules behind its
// KPI tiles. Pure functions only (no DOM, no Firestore), so
// test/dashboard.test.mjs drives them; dashboard-page.js owns the rendering
// and the reads.
//
// Every tile reports "yesterday" as the viewer's local calendar day, compared
// with the local day before it, except Support, which reports the inbox as it
// stands now and today. Nothing here formats or compares a UTC day.
//
// Tiles and where their numbers come from:
//   Agent board     backlogItems the console already holds (mergedAt, lastFire,
//                   status, blocked)
//   Staff Kanban    kanbanCards of the current release (estimate, logged,
//                   status, assignee); kanbanSettings/main picks the release
//   Leads           leads (createdAt, leadType, test, archivedAt)
//   Conversion      funnelDaily rows for the day (GA4) plus website leads
//   Support         supportTickets written to support@ (status, lastInboundAt,
//                   lastReplyAt, resolvedAt): three figures, as things stand now

import { remaining, currentReleaseId } from "./kanban/kanban-core.js";
import { leadName } from "./leads-core.js";
import { inInbox, DEFAULT_INBOX } from "./support-core.js";

export const HOURS_PER_DAY = 8;

// ── Local days ─────────────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, "0");
export function startOfLocalDay(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
// { from, to } in ms for the local day `offset` days before today (1 = yesterday);
// `to` is exclusive. Built with setDate, so a clock change is a 23 or 25 hour day.
export function localDayRange(offset, now = Date.now()) {
  const from = new Date(startOfLocalDay(now)); from.setDate(from.getDate() - offset);
  const to = new Date(from.getTime()); to.setDate(to.getDate() + 1);
  return { from: from.getTime(), to: to.getTime(), day: `${from.getFullYear()}-${pad(from.getMonth() + 1)}-${pad(from.getDate())}` };
}
export const inRange = (ms, r) => !!ms && ms >= r.from && ms < r.to;

export function toMillis(v) {
  if (!v) return 0;
  if (typeof v === "number") return v;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (v instanceof Date) return v.getTime();
  if (typeof v === "object" && typeof v.$ts === "number") return v.$ts;
  if (typeof v === "object" && typeof v.seconds === "number") return v.seconds * 1000;
  if (typeof v === "object" && typeof v._seconds === "number") return v._seconds * 1000;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : 0;
}

// ── Formatting ─────────────────────────────────────────────────────────────
export const fmtCount = (n) => new Intl.NumberFormat(undefined).format(Number(n) || 0);
// Hours with working days in brackets at 8h a day: 24 -> "24h (3d)", 20 -> "20h (2.5d)".
export function fmtEffort(hours) {
  const h = Math.round((Number(hours) || 0) * 2) / 2;
  const d = Math.round((h / HOURS_PER_DAY) * 10) / 10;
  return `${h}h (${d}d)`;
}
// Change against the day before: { dir: "up" | "down" | "flat", delta, text }.
export function trend(cur, prev) {
  const delta = (Number(cur) || 0) - (Number(prev) || 0);
  const dir = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  return { dir, delta, text: dir === "flat" ? "Same as the day before" : `${delta > 0 ? "+" : "−"}${fmtCount(Math.abs(delta))} vs the day before` };
}
// "3h", "2d 4h", "12m": how long something has waited.
export function fmtWait(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}
// The day a tile reports on, in the viewer's own words: "Mon 16 Nov".
export function fmtDayLabel(ms) {
  return new Date(ms).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

// ── 7-day series, sparkline and status (Dashboard v2, GUI9xPe3CJY3LyMws88m) ──
export const SERIES_DAYS = 7;
// The last `days` local days ending yesterday, oldest first: [{ from, to, day }].
export function lastDays(days = SERIES_DAYS, now = Date.now()) {
  const out = [];
  for (let i = days; i >= 1; i--) out.push(localDayRange(i, now));
  return out;
}
// How many of `stamps` (ms) fall on each of those days, oldest first.
export function dailyCounts(stamps, days = SERIES_DAYS, now = Date.now()) {
  const range = lastDays(days, now);
  const counts = range.map(() => 0);
  for (const ms of stamps || []) {
    const i = range.findIndex((r) => inRange(ms, r));
    if (i >= 0) counts[i]++;
  }
  return counts;
}
// SVG polyline points for a sparkline of `values` in a w x h box, with `pad`
// kept clear so the stroke is never clipped. A flat or empty series is drawn
// along the middle; fewer than two values draw nothing ("").
export function sparklinePoints(values, w = 96, h = 28, pad = 2) {
  const v = (values || []).map((x) => (Number.isFinite(+x) ? +x : 0));
  if (v.length < 2) return "";
  const min = Math.min(...v), max = Math.max(...v);
  const span = max - min;
  const step = (w - pad * 2) / (v.length - 1);
  const y = (x) => (span ? h - pad - ((x - min) / span) * (h - pad * 2) : h / 2);
  return v.map((x, i) => `${Math.round((pad + i * step) * 10) / 10},${Math.round(y(x) * 10) / 10}`).join(" ");
}
// The short form of a trend for a compact tile: "+2", "−3", "0".
export function trendShort(tr) {
  if (!tr || tr.dir === "flat") return "0";
  return `${tr.delta > 0 ? "+" : "−"}${fmtCount(Math.abs(tr.delta))}`;
}
// A tile's status colour: "ok" (green), "warn" (amber) or "alert" (red), with
// the reason in words for the tile's accessible name. Only a tile with
// something to act on is amber or red.
//   agent    amber when a ticket is blocked; red at three or more
//   kanban   amber when an outstanding task has no estimate; amber with no release
//   leads    always green (a quiet day is not a fault)
//   funnel   amber when yesterday has no website data (the daily ingest has not run)
//   support  amber when anything awaits a reply; red when the oldest has waited a day
export const SUPPORT_RED_MS = 24 * 3600000;
export function tileStatus(key, k) {
  const ok = { level: "ok", reason: "Nothing needs attention" };
  if (!k) return ok;
  if (key === "agent") {
    const blocked = (k.projects || []).reduce((n, p) => n + (p.blocked || 0), 0);
    if (!blocked) return ok;
    return { level: blocked >= 3 ? "alert" : "warn", reason: `${blocked} ticket${blocked === 1 ? "" : "s"} blocked` };
  }
  if (key === "kanban") {
    if (!k.release) return { level: "warn", reason: "No release selected" };
    return k.unestimated ? { level: "warn", reason: `${k.unestimated} task${k.unestimated === 1 ? "" : "s"} unestimated` } : ok;
  }
  if (key === "funnel") return k.hasData ? ok : { level: "warn", reason: "No website data for yesterday yet" };
  if (key === "support") {
    if (!k.open) return ok;
    const late = k.oldestMs != null && k.oldestMs >= SUPPORT_RED_MS;
    return { level: late ? "alert" : "warn", reason: `${k.open} awaiting a reply${late ? ", one for over a day" : ""}` };
  }
  return ok;
}

// ── Agent board ──────────────────────────────────────────────────────────
const LIVE = "published-live";
// When the card shipped: the train's merge, else when it entered Merged to Main.
const deployedMs = (it) => (it.status === LIVE || it.status === "archived" ? toMillis(it.mergedAt) || toMillis(it.statusEnteredAt) : toMillis(it.mergedAt));
// A build started and not reported back (the same rule as card-state.js).
export function isBuilding(it) {
  const fire = it && it.lastFire;
  if (!fire || fire.status !== "started") return false;
  const fired = toMillis(fire.at);
  const bs = it.buildSession;
  if (bs && (bs.status === "done" || bs.status === "error") && (toMillis(bs.reportedAt) || toMillis(bs.finishedAt)) >= fired) return false;
  return it.status === "backlog" || !it.status;
}
// items: backlogItems; projects: [{id, name, archived?}].
// Per project: deployed yesterday, left Backlog yesterday (a build started),
// in build now, in Ready for Testing now, blocked now.
export function agentBoardKpi(items, projects, now = Date.now()) {
  const y = localDayRange(1, now), p = localDayRange(2, now);
  const names = new Map((projects || []).map((x) => [x.id, x.name || "Untitled project"]));
  const rows = new Map();
  const row = (pid) => {
    const id = pid || "general";
    if (!rows.has(id)) rows.set(id, { id, name: names.get(pid) || "General", deployed: 0, leftBacklog: 0, building: 0, testing: 0, blocked: 0 });
    return rows.get(id);
  };
  let deployed = 0, prev = 0;
  for (const it of items || []) {
    const shipped = deployedMs(it);
    if (inRange(shipped, y)) { deployed++; row(it.projectId).deployed++; }
    if (inRange(shipped, p)) prev++;
    if (it.status === "archived") continue;
    if (it.lastFire && inRange(toMillis(it.lastFire.at), y)) row(it.projectId).leftBacklog++;
    if (isBuilding(it)) row(it.projectId).building++;
    if (it.status === "ready-for-testing") row(it.projectId).testing++;
    if (it.blocked && it.status !== LIVE) row(it.projectId).blocked++;
  }
  const projectsOut = [...rows.values()]
    .filter((r) => r.deployed || r.leftBacklog || r.building || r.testing || r.blocked)
    .sort((a, b) => b.deployed - a.deployed || a.name.localeCompare(b.name));
  const series = dailyCounts((items || []).map(deployedMs), SERIES_DAYS, now);
  return { value: deployed, prev, trend: trend(deployed, prev), projects: projectsOut, series };
}

// ── Staff Kanban ─────────────────────────────────────────────────────────
// tasks: kanbanCards of the release; nameOf(email) -> a person's name.
// Epics are left out, as in the release report.
export function kanbanKpi(release, tasks, nameOf = (e) => e || "Unassigned") {
  const outstanding = (tasks || []).filter((t) => t && t.type !== "epic" && t.status !== "done" && (!release || t.release === release.id));
  const hasEstimate = (t) => +t.estimate > 0;
  const people = new Map();
  for (const t of outstanding) {
    const id = t.assignee || "";
    if (!people.has(id)) people.set(id, { id, name: id ? nameOf(id) : "Unassigned", hours: 0, tasks: 0, unestimated: [] });
    const p = people.get(id);
    p.tasks++;
    p.hours += remaining(t);
    if (!hasEstimate(t)) p.unestimated.push({ key: t.key || t.id || "", title: t.title || "" });
  }
  const list = [...people.values()].sort((a, b) => b.hours - a.hours || b.tasks - a.tasks || a.name.localeCompare(b.name));
  const hours = outstanding.reduce((n, t) => n + remaining(t), 0);
  return {
    release: release ? { id: release.id, name: release.name || release.version || release.id } : null,
    hours, effort: fmtEffort(hours), outstanding: outstanding.length,
    unestimated: outstanding.filter((t) => !hasEstimate(t)).length,
    people: list,
  };
}
// The release Staff Kanban is working towards. Which one is Staff Kanban's
// own rule, kanban-core's currentReleaseId (the one picked in its settings,
// else the earliest release not yet live by version, then order), so the tile
// and Staff Kanban's report always name the same release. This only turns the
// id into a release to show.
export function dashboardRelease(settings, releases) {
  const list = (releases || []).slice();
  const chosen = settings && typeof settings.currentRelease === "string" ? settings.currentRelease : "";
  const id = currentReleaseId({ currentRelease: chosen }, list);
  if (!id) return null;
  return list.find((r) => r.id === id) || { id, name: id };
}

// ── Leads ────────────────────────────────────────────────────────────────
const realLead = (l) => l && !l.test && !l.archivedAt;
export function leadsKpi(leads, now = Date.now()) {
  const y = localDayRange(1, now), p = localDayRange(2, now);
  const fresh = (leads || []).filter((l) => realLead(l) && inRange(toMillis(l.createdAt), y));
  const prev = (leads || []).filter((l) => realLead(l) && inRange(toMillis(l.createdAt), p)).length;
  const byTime = (a, b) => toMillis(a.createdAt) - toMillis(b.createdAt);
  const companies = fresh.filter((l) => l.leadType !== "operator").sort(byTime).map((l) => leadName(l));
  const operators = fresh.filter((l) => l.leadType === "operator").sort(byTime).map((l) => leadName(l));
  const series = dailyCounts((leads || []).filter(realLead).map((l) => toMillis(l.createdAt)), SERIES_DAYS, now);
  return { value: fresh.length, prev, trend: trend(fresh.length, prev), companies, operators, series };
}

// ── Conversion funnel ────────────────────────────────────────────────────
const num = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
// A lead that came in from the website (a form submission), not one typed in.
export const isWebsiteLead = (l) => !!l && (/website/i.test(String(l.source || "")) || !!l.sourcePage || (Array.isArray(l.websiteActivity) && l.websiteActivity.length > 0));
// Visitors for a set of funnelDaily rows: GA4's user count when the ingest
// sends one (`users`), else its visits.
const visitorsOf = (rows) => rows.reduce((n, r) => n + (typeof r.users === "number" ? num(r.users) : num(r.visits)), 0);
// rows: funnelDaily documents ({date "YYYY-MM-DD", industry, visits, users?,
// demoRequests, downloads}); leads as for leadsKpi.
export function funnelKpi(rows, leads, now = Date.now()) {
  const y = localDayRange(1, now), p = localDayRange(2, now);
  const of = (day) => (rows || []).filter((r) => r && String(r.date || "").slice(0, 10) === day);
  const cur = of(y.day), before = of(p.day);
  const visitors = visitorsOf(cur);
  const industryRows = cur.filter((r) => String(r.industry || "").trim());
  const industryPage = visitorsOf(industryRows);
  const engaged = cur.reduce((n, r) => n + num(r.demoRequests) + num(r.downloads), 0);
  const leadCount = (leads || []).filter((l) => realLead(l) && isWebsiteLead(l) && inRange(toMillis(l.createdAt), y)).length;
  const counts = [visitors, industryPage, engaged, leadCount];
  const labels = ["Unique visitors", "Industry page", "Walkthrough or calculator", "Lead"];
  const steps = labels.map((label, i) => {
    const count = counts[i];
    const base = i ? counts[i - 1] : null;
    return { label, count, dropOff: base ? Math.max(0, base - count) : null, dropOffPct: base ? Math.round(Math.max(0, base - count) / base * 100) : null };
  });
  const byIndustry = new Map();
  for (const r of industryRows) {
    const k = String(r.industry).trim();
    byIndustry.set(k, (byIndustry.get(k) || 0) + visitorsOf([r]));
  }
  const industries = [...byIndustry.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const prev = visitorsOf(before);
  const series = lastDays(SERIES_DAYS, now).map((r) => visitorsOf(of(r.day)));
  return { value: visitors, prev, trend: trend(visitors, prev), steps, industries, hasData: cur.length > 0, series };
}

// ── Support ──────────────────────────────────────────────────────────────
// tickets: normalised supportTickets (support-core's normaliseTicket).
// Exactly three figures, all of the Support Inbox (mail written to support@;
// Hello's and Aidan's tickets are never counted), all as things stand now:
//   open        tickets that are open, so the customer's last email has no reply
//   oldestMs    how long the oldest of those has waited (null when none wait)
//   doneToday   tickets replied to or resolved since the start of today (local)
// `waiting` lists the open tickets, longest wait first, for the tooltip.
export function supportKpi(tickets, now = Date.now()) {
  const today = localDayRange(0, now);
  const list = (tickets || []).filter((t) => inInbox(t, DEFAULT_INBOX));
  const waiting = list.filter((t) => t.status === "open")
    .map((t) => ({ id: t.id, customer: t.customerName || t.customerEmail || "Unknown sender", subject: t.subject || "", waitedMs: Math.max(0, now - (t.lastInboundAt || t.lastMessageAt || t.createdAt || now)) }))
    .sort((a, b) => b.waitedMs - a.waitedMs);
  // A ticket filed before lastReplyAt was recorded has only its first reply's time.
  const doneOn = (day) => list.filter((t) => t.status !== "spam" && ((t.status === "resolved" && inRange(t.resolvedAt, day)) || inRange(t.lastReplyAt || t.firstResponseAt, day))).length;
  const doneToday = doneOn(today);
  // Yesterday by the same rule (a ticket replied to yesterday and again today
  // counts today only: its latest reply is the one recorded).
  const doneYesterday = doneOn(localDayRange(1, now));
  return { open: waiting.length, oldestMs: waiting.length ? waiting[0].waitedMs : null, doneToday, doneYesterday, doneTrend: trend(doneToday, doneYesterday), waiting };
}
