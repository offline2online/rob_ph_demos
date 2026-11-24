// Dashboard: the console's landing page (#dashboard). The rules behind its
// KPI tiles. Pure functions only (no DOM, no Firestore), so
// test/dashboard.test.mjs drives them; dashboard-page.js owns the rendering
// and the reads.
//
// Every tile reports in the viewer's local time: "yesterday" is the local
// calendar day before today and "the last 7 days" the 7 local days ending
// yesterday. Nothing here formats or compares a UTC day.
//
// Tiles (Dashboard v2 content, cMyA3FMlUUrSjGtPkLZC) and where their numbers come from:
//   Delivery          backlogItems the console already holds (mergedAt,
//                     createdAt, countedSendBacks / testRound)
//   Flow & blockers   the same tickets (blocked, lastFailureReason, statusEnteredAt;
//                     testing rounds for the retested tickets)
//   Staff Kanban      open kanbanCards (open == true) and the current release's
//                     cards; kanbanSettings/main picks the release
//   Leads             leads (createdAt, stage, source, history, test, archivedAt)
//   Conversion funnel funnelDaily rows for 14 days (GA4, ACE) plus website leads
//   Needs a person, AI drafts to approve, Resolved & automation
//                     supportTickets of the support@ inbox (its queues)

import { remaining, currentReleaseId } from "./kanban/kanban-core.js";
import { leadName } from "./leads-core.js";
import { inInbox, DEFAULT_INBOX, QUEUES, INBOXES } from "./support-core.js";
import { retestedRows } from "./test-rounds-view.js";

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
// Change against an earlier figure: { dir: "up" | "down" | "flat", delta, text }.
// `than` names what it is compared with ("the 7 days before" for a weekly figure).
export function trend(cur, prev, than = "the day before") {
  const delta = (Number(cur) || 0) - (Number(prev) || 0);
  const dir = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  return { dir, delta, text: dir === "flat" ? `Same as ${than}` : `${delta > 0 ? "+" : "−"}${fmtCount(Math.abs(delta))} vs ${than}` };
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
// The index of the last tile on tile `i`'s row, in a grid of `cols` columns
// holding `n` tiles that flow left to right with no gaps. Worked out from the
// count, not measured, because the pinned summary panel (a full-width grid
// item) itself breaks the row it sits in, so measuring with it in place reads
// a stale row after the grid widens (an iPad rotation, a window resize).
export function rowEnd(i, cols, n) {
  const c = Math.max(1, Math.floor(Number(cols)) || 1);
  if (!(n > 0)) return -1;
  const at = Math.min(Math.max(0, Math.floor(i) || 0), n - 1);
  return Math.min((Math.floor(at / c) + 1) * c, n) - 1;
}
// A tile's status colour: "ok" (green), "warn" (amber) or "alert" (red), with
// the reason in words for the tile's accessible name. Only a tile with
// something to act on is amber or red; any tile that couldn't load is red
// (dashboard-page.js).
//   delivery   always green (a quiet day is not a fault)
//   flow       amber when a ticket is stuck; red at three or more
//   kanban     amber when an open task is overdue, unassigned, unestimated or
//              waiting on the viewer in Testing
//   leads      amber when a lead is stale or not yet contacted
//   funnel     amber when yesterday has no website data (the daily ingest has
//              not run); red when a source failed on the last ingest
//   person     amber when a ticket needs a person; red when the oldest has waited a day
//   drafts     amber when an AI draft waits for approval
//   resolved   always green
export const SUPPORT_RED_MS = 24 * 3600000;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export function tileStatus(key, k) {
  const ok = { level: "ok", reason: "Nothing needs attention" };
  if (!k) return ok;
  if (key === "flow") {
    const n = (k.stuck || []).length;
    if (!n) return ok;
    return { level: n >= 3 ? "alert" : "warn", reason: `${plural(n, "ticket")} stuck` };
  }
  if (key === "kanban") {
    const f = k.flags || {};
    const parts = [];
    if (f.overdue) parts.push(`${f.overdue} overdue`);
    if (f.unassigned) parts.push(`${f.unassigned} unassigned`);
    if (f.unestimated) parts.push(`${f.unestimated} unestimated`);
    if (f.waitingOnMe) parts.push(`${f.waitingOnMe} waiting on you in Testing`);
    return parts.length ? { level: "warn", reason: parts.join(", ") } : ok;
  }
  if (key === "leads") {
    const a = k.needsAction || {};
    const n = (a.stale || []).length + (a.notContacted || []).length;
    return n ? { level: "warn", reason: `${plural(n, "lead")} need${n === 1 ? "s" : ""} action` } : ok;
  }
  if (key === "funnel") {
    // A source failed on the last ingest (consoleConfig/funnelIngest): the figures are stale.
    if (k.dataNotUpdated) return { level: "alert", reason: "Data not updated" };
    return k.hasData ? ok : { level: "warn", reason: "No website data for yesterday yet" };
  }
  if (key === "person") {
    if (!k.count) return ok;
    const late = k.oldestMs != null && k.oldestMs >= SUPPORT_RED_MS;
    return { level: late ? "alert" : "warn", reason: `${k.count} need${k.count === 1 ? "s" : ""} a person${late ? ", one for over a day" : ""}` };
  }
  if (key === "drafts") return k.count ? { level: "warn", reason: `${plural(k.count, "draft")} to approve` } : ok;
  return ok;
}

// ── Agent board: Delivery, Flow & blockers ─────────────────────────────────
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
// Passed testing first time: never sent back (no counted send-back, one
// testing round); a card from before testing rounds were kept falls back to
// "never failed testing".
export function firstTimePass(it) {
  if (typeof it.countedSendBacks === "number" || typeof it.testRound === "number") return !(Number(it.countedSendBacks) > 0) && !(Number(it.testRound) > 1);
  return !it.lastFailureReason;
}
const pctOf = (n, d) => (d > 0 ? Math.round((n / d) * 100) : null);
const avg = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
// "2d 4h" for a lead time; "—" when there is none.
export const fmtSpan = (ms) => (ms == null ? "—" : fmtWait(ms));

// Delivery: tickets deployed yesterday (local day), with the day before and a
// 7-day line; over the tickets deployed in the last 7 days, the average lead
// time from Backlog (createdAt) to Live and the share that passed testing
// first time. Per project: deployed yesterday, last 7 days, lead time, first pass.
// `period` is the same over the selected `range` against the previous
// equivalent period (deliveryPeriod below), which the tile and panel show.
export function deliveryKpi(items, projects, now = Date.now(), range = "yesterday") {
  const y = localDayRange(1, now), p = localDayRange(2, now);
  const week = lastDays(SERIES_DAYS, now);
  const win = { from: week[0].from, to: week[week.length - 1].to };
  const names = new Map((projects || []).map((x) => [x.id, x.name || "Untitled project"]));
  const rows = new Map();
  const row = (pid) => {
    const id = pid || "general";
    if (!rows.has(id)) rows.set(id, { id, name: names.get(pid) || "General", yesterday: 0, week: 0, leads: [], passed: 0 });
    return rows.get(id);
  };
  let deployed = 0, prev = 0;
  const leads = [];
  let passed = 0, shipped = 0;
  for (const it of items || []) {
    const at = deployedMs(it);
    if (!at) continue;
    if (inRange(at, y)) { deployed++; row(it.projectId).yesterday++; }
    if (inRange(at, p)) prev++;
    if (!inRange(at, win)) continue;
    const r = row(it.projectId);
    r.week++; shipped++;
    const born = toMillis(it.createdAt);
    if (born && born <= at) { leads.push(at - born); r.leads.push(at - born); }
    if (firstTimePass(it)) { passed++; r.passed++; }
  }
  const projectsOut = [...rows.values()]
    .map((r) => ({ id: r.id, name: r.name, yesterday: r.yesterday, week: r.week, leadTimeMs: avg(r.leads), firstPassPct: pctOf(r.passed, r.week) }))
    .sort((a, b) => b.yesterday - a.yesterday || b.week - a.week || a.name.localeCompare(b.name));
  const series = dailyCounts((items || []).map(deployedMs), SERIES_DAYS, now);
  return { value: deployed, prev, trend: trend(deployed, prev), series, shipped, leadTimeMs: avg(leads), firstPassPct: pctOf(passed, shipped), projects: projectsOut, period: deliveryPeriod(items, projects, range, now) };
}

// ── Delivery: change against the previous period (7KcZdqFjytcmD9S85Fnq) ──
// The Delivery panel's range: Yesterday (against the day before) or the last
// 7 days (against the 7 days before). Yesterday is the default.
export const DELIVERY_RANGES = [
  { key: "yesterday", label: "Yesterday", days: 1, metric: "Deployed yesterday", than: "the day before" },
  { key: "week", label: "Last 7 days", days: SERIES_DAYS, metric: "Deployed in the last 7 days", than: "the 7 days before" },
];
export const deliveryRange = (key) => DELIVERY_RANGES.find((r) => r.key === key) || DELIVERY_RANGES[0];
// The `days` local days ending yesterday, and the `days` local days before them.
export function periodWindows(days, now = Date.now()) {
  const cur = { from: localDayRange(days, now).from, to: localDayRange(1, now).to };
  const prev = { from: localDayRange(days * 2, now).from, to: cur.from };
  return { cur, prev };
}
const signed = (n, unit = "") => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmtCount(Math.abs(n))}${unit}`;
// A count against the previous period, as a relative change:
// { dir: "up" | "down" | "flat", pct, short, text }. 4 against 2 is "+100%";
// from none to some is "New" (never ∞%); none to none is "0%".
export function countChange(cur, prev, than = "the day before") {
  const c = Number(cur) || 0, p = Number(prev) || 0;
  if (c === p) return { dir: "flat", pct: 0, short: "0%", text: `Same as ${than}: ${fmtCount(c)}` };
  if (!p) return { dir: "up", pct: null, short: "New", text: `New: ${fmtCount(c)}, none in ${than}` };
  const pct = Math.round(((c - p) / p) * 100);
  return { dir: c > p ? "up" : "down", pct, short: signed(pct, "%"), text: `${signed(pct, "%")} vs ${than}: ${fmtCount(c)} against ${fmtCount(p)}` };
}
// A first-time pass rate against the previous period, in percentage points:
// 60% against 48% is "+12 pp". A period with no deployments has no rate, so
// there is nothing to compare: dir "none" and "—".
export function passChange(cur, prev, than = "the day before") {
  if (cur == null || prev == null) return { dir: "none", delta: null, short: "—", text: `No first-time pass rate to compare: nothing deployed ${cur == null ? "in this period" : `in ${than}`}` };
  const delta = cur - prev;
  if (!delta) return { dir: "flat", delta: 0, short: "0 pp", text: `Same as ${than}: ${cur}%` };
  return { dir: delta > 0 ? "up" : "down", delta, short: signed(delta, " pp"), text: `${signed(delta, " percentage points")} vs ${than}: ${cur}% against ${prev}%` };
}
// Delivery over the selected range against the previous equivalent period:
// tickets deployed, first-time pass (over the tickets deployed in that
// period) and lead time, in total and per project. A project is listed when
// it deployed in either period, most deployed first.
export function deliveryPeriod(items, projects, rangeKey = "yesterday", now = Date.now()) {
  const range = deliveryRange(rangeKey);
  const { cur, prev } = periodWindows(range.days, now);
  const names = new Map((projects || []).map((x) => [x.id, x.name || "Untitled project"]));
  const blank = () => ({ count: 0, passed: 0, leads: [] });
  const total = { cur: blank(), prev: blank() };
  const rows = new Map();
  for (const it of items || []) {
    const at = deployedMs(it);
    const side = inRange(at, cur) ? "cur" : inRange(at, prev) ? "prev" : null;
    if (!side) continue;
    const id = it.projectId || "general";
    if (!rows.has(id)) rows.set(id, { id, name: names.get(it.projectId) || "General", cur: blank(), prev: blank() });
    const pass = firstTimePass(it);
    const born = toMillis(it.createdAt);
    for (const b of [total[side], rows.get(id)[side]]) {
      b.count++;
      if (pass) b.passed++;
      if (side === "cur" && born && born <= at) b.leads.push(at - born);
    }
  }
  const sum = (x) => {
    const firstPassPct = pctOf(x.cur.passed, x.cur.count), prevFirstPassPct = pctOf(x.prev.passed, x.prev.count);
    return {
      count: x.cur.count, prevCount: x.prev.count, countChange: countChange(x.cur.count, x.prev.count, range.than),
      firstPassPct, prevFirstPassPct, passChange: passChange(firstPassPct, prevFirstPassPct, range.than),
      leadTimeMs: avg(x.cur.leads),
    };
  };
  const projectsOut = [...rows.values()]
    .map((r) => ({ id: r.id, name: r.name, ...sum(r) }))
    .sort((a, b) => b.count - a.count || b.prevCount - a.prevCount || a.name.localeCompare(b.name));
  return { range: range.key, label: range.label, metric: range.metric, than: range.than, ...sum(total), projects: projectsOut };
}

export const READY_WAIT_MS = 24 * 3600000;
// A send-back writes lastFailureReason.at in the same write that moves the card to Backlog, and
// statusEnteredAt is stamped afterwards by a trigger (serverTimestamp), so it is always a little later
// (seconds; ~40 s when a review kick-back is followed by the automation's revert). A failure counts for
// the card's current spell in Backlog when it is no more than this before the move.
export const FAILED_MOVE_SLACK_MS = 5 * 60000;
const BLOCK_REASONS = {
  "waiting-on-input": "Waiting on an answer",
  "waiting-on-dependency": "Stuck behind another ticket",
  "model-unavailable": "Not built: needs Opus",
  "tools-unavailable": "Not built: a tool is missing",
};
// Flow & blockers: the tickets that are stuck now, longest wait first:
//   blocked      a blocked card (not a plain wait for another ticket to land,
//                which releases itself; one marked stuckOn does count)
//   failed       sent back with Failed testing and not rebuilding yet: a
//                Backlog card whose lastFailureReason is newer than its move
//                to Backlog, with no build running and no patch waiting to land
//   testing      in Ready for Testing for more than 24 hours, waiting on a person
// Alongside, the tickets that went back through retesting (0I93kb0fqXL4Qr4qyzwv):
// every ticket not archived with a counted send-back, and how many times
// (retestedRows in test-rounds-view.js, the same rows the list it opens shows).
// They are information, not stuck, so they leave the tile's colour alone.
export function flowKpi(items, projects, now = Date.now()) {
  const names = new Map((projects || []).map((x) => [x.id, x.name || "Untitled project"]));
  const stuck = [];
  for (const it of items || []) {
    if (!it || it.status === LIVE || it.status === "archived") continue;
    const base = { id: it.id, title: it.title || "Untitled ticket", project: names.get(it.projectId) || "General" };
    const b = it.blocked;
    if (b && typeof b === "object" && (b.reason !== "waiting-on-dependency" || b.stuckOn)) {
      const since = toMillis(b.setAt) || toMillis(it.statusEnteredAt) || toMillis(it.updatedAt);
      stuck.push({ ...base, kind: "blocked", reason: String(b.note || "").trim() || BLOCK_REASONS[b.reason] || "Blocked", waitedMs: since ? Math.max(0, now - since) : null });
      continue;
    }
    const f = it.lastFailureReason;
    const failedAt = f && toMillis(f.at);
    if ((it.status === "backlog" || !it.status) && failedAt && failedAt >= (toMillis(it.statusEnteredAt) || 0) - FAILED_MOVE_SLACK_MS && !isBuilding(it) && !it.patchReady) {
      stuck.push({ ...base, kind: "failed", reason: `Failed testing${f.text ? `: ${String(f.text).trim()}` : ""}`, waitedMs: Math.max(0, now - failedAt) });
      continue;
    }
    if (it.status === "ready-for-testing") {
      const since = toMillis(it.statusEnteredAt);
      if (since && now - since > READY_WAIT_MS) stuck.push({ ...base, kind: "testing", reason: "Waiting in Ready for Testing", waitedMs: now - since });
    }
  }
  stuck.sort((a, b) => (b.waitedMs || 0) - (a.waitedMs || 0) || a.title.localeCompare(b.title));
  const count = (k) => stuck.filter((s) => s.kind === k).length;
  const retested = retestedRows(items).map((r) => ({ id: r.id, title: r.title || "Untitled ticket", project: names.get(r.projectId) || "General", times: r.counted, round: r.round, status: r.status }));
  return { value: stuck.length, stuck, blocked: count("blocked"), failed: count("failed"), testing: count("testing"), retested, retestedCount: retested.length };
}

// ── Staff Kanban ─────────────────────────────────────────────────────────
// The columns the tile counts: To do is Backlog and Ready for Dev; Testing is
// Ready for Testing and Approved for Deployment.
export const KANBAN_COLUMNS = [
  { key: "todo", label: "To do", statuses: ["backlog", "ready-for-dev"] },
  { key: "progress", label: "In progress", statuses: ["in-progress"] },
  { key: "testing", label: "Testing", statuses: ["ready-for-testing", "approved"] },
];
// The release Staff Kanban is working towards. Which one is Staff Kanban's
// own rule, kanban-core's currentReleaseId (the one picked in its settings,
// else the earliest release not yet live by version, then order), so the tile
// and Staff Kanban's report always name the same release.
// The console's releases say "live" in `status` (the Releases page), where
// kanban-core reads `released`; Staff Kanban maps one to the other
// (kanban-page.js). The tile used to pass them straight through, so it took a
// release that was already live, with no open task, and showed nothing.
export function dashboardRelease(settings, releases) {
  const list = (releases || []).map((r) => ({ ...r, released: r.released === true || r.status === "live" }));
  const chosen = settings && typeof settings.currentRelease === "string" ? settings.currentRelease : "";
  const id = currentReleaseId({ currentRelease: chosen }, list);
  if (!id) return null;
  return list.find((r) => r.id === id) || { id, name: id };
}
// The viewer's local calendar day as YYYY-MM-DD (a task's due date is a day).
export const localIsoDay = (ms) => localDayRange(0, ms).day;
// input: { release, open, releaseTasks, projects, me, now }
//   release       dashboardRelease(), or null
//   open          every open Staff Kanban task (kanbanCards with open == true)
//   releaseTasks  every task of the release, done ones included (its progress)
//   projects      the console's projects: tasks of an archived project are left out
//   me            the viewer's email: Testing tasks assigned to them wait on them
// The scope is the release's open tasks; with no release, or none of its tasks
// open, it is all open work, so the tile is never blank. Epics are left out,
// as in the release report.
export function kanbanKpi(input, nameOf = (e) => e || "Unassigned") {
  const { release = null, open = [], releaseTasks = [], projects = [], me = "", now = Date.now() } = input || {};
  const archived = new Set((projects || []).filter((p) => p && p.archived).map((p) => p.id));
  const live = (open || []).filter((t) => t && t.type !== "epic" && t.status !== "done" && !archived.has(t.project));
  const inRelease = release ? live.filter((t) => t.release === release.id) : [];
  const scoped = inRelease.length ? inRelease : live;
  const allWork = !inRelease.length;
  const columns = KANBAN_COLUMNS.map((c) => ({ key: c.key, label: c.label, count: scoped.filter((t) => c.statuses.includes(t.status)).length }));
  // The release's progress: done (completed) of every task in it, withdrawn and epics left out.
  let progress = null;
  if (release && !allWork) {
    const all = new Map();
    for (const t of [...(releaseTasks || []), ...inRelease]) if (t && t.type !== "epic" && t.release === release.id) all.set(t.key || t.id, t);
    const counted = [...all.values()].filter((t) => !(t.status === "done" && t.resolution === "withdrawn"));
    const done = counted.filter((t) => t.status === "done").length;
    progress = { done, total: counted.length, pct: pctOf(done, counted.length) ?? 0 };
  }
  const today = localIsoDay(now);
  const mine = String(me || "").toLowerCase();
  const isOverdue = (t) => !!t.due && String(t.due).slice(0, 10) < today;
  const hasEstimate = (t) => +t.estimate > 0;
  const flags = {
    overdue: scoped.filter(isOverdue).length,
    unassigned: scoped.filter((t) => !t.assignee).length,
    unestimated: scoped.filter((t) => !hasEstimate(t)).length,
    waitingOnMe: mine ? scoped.filter((t) => t.status === "ready-for-testing" && String(t.assignee || "").toLowerCase() === mine).length : 0,
  };
  const people = new Map();
  for (const t of scoped) {
    const id = t.assignee || "";
    if (!people.has(id)) people.set(id, { id, name: id ? nameOf(id) : "Unassigned", hours: 0, tasks: 0, unestimated: [], overdue: 0 });
    const p = people.get(id);
    p.tasks++;
    p.hours += remaining(t);
    if (isOverdue(t)) p.overdue++;
    if (!hasEstimate(t)) p.unestimated.push({ key: t.key || t.id || "", title: t.title || "" });
  }
  const list = [...people.values()].sort((a, b) => b.hours - a.hours || b.tasks - a.tasks || a.name.localeCompare(b.name));
  const hours = scoped.reduce((n, t) => n + remaining(t), 0);
  return {
    value: scoped.length, columns, flags, progress, allWork,
    scopeLabel: allWork ? "All open work" : (release.name || release.version || release.id),
    release: release ? { id: release.id, name: release.name || release.version || release.id } : null,
    hours, effort: fmtEffort(hours), people: list,
  };
}

// ── Leads ────────────────────────────────────────────────────────────────
const realLead = (l) => l && !l.test && !l.archivedAt && !l.archived;
// The company pipeline, Lead through to Closed Won (Lost is left out).
export const PIPELINE = [
  { key: "lead", label: "Lead" },
  { key: "hot-lead", label: "Hot Lead" },
  { key: "demo", label: "Demo" },
  { key: "post-demo", label: "Post-demo" },
  { key: "closed-won", label: "Closed Won" },
];
const CLOSED = new Set(["closed-won", "closed-lost", "approved", "not-a-fit"]);
export const STALE_MS = 7 * 24 * 3600000;
// Where a lead came from, for the panel: the website, a network operator
// (their own pipeline), a partner (a referral or the marketplace), else Other.
export function leadSourceGroup(l) {
  if (!l) return "Other";
  if (l.leadType === "operator") return "Network operator";
  const src = String(l.source || "");
  if (/partner|referr|marketplace|\baws\b|\bace\b/i.test(src)) return "Partner";
  if (isWebsiteLead(l)) return "Website";
  return "Other";
}
const leadIndustry = (l) => String((l.company && l.company.industry) || l.sourceIndustry || (l.operator && l.operator.networkIndustry) || "").trim() || "Not given";
const leadMarket = (l) => String((l.company && Array.isArray(l.company.countries) && l.company.countries[0]) || (l.operator && l.operator.region) || "").trim() || "Not given";
// The last thing that happened on a lead: its newest history entry, stage
// change, update or creation.
export function leadLastActivity(l) {
  const hist = (Array.isArray(l.history) ? l.history : []).map((h) => toMillis(h && h.at));
  return Math.max(toMillis(l.createdAt), toMillis(l.updatedAt), toMillis(l.stageChangedAt), ...hist, 0);
}
// Contacted: anyone but the website wrote a note on it, or it moved stage.
const contacted = (l) => !!toMillis(l.stageChangedAt) || (Array.isArray(l.history) ? l.history : []).some((h) => h && h.kind !== "created" && h.by && h.by !== "website");
const firstStage = (l) => (l.leadType === "operator" ? !l.stage || l.stage === "applied" : !l.stage || l.stage === "lead");
// Groups `list` by key(l) into [{ name, count, leads: [names] }], biggest first.
function groupLeads(list, key) {
  const m = new Map();
  for (const l of list) { const k = key(l); if (!m.has(k)) m.set(k, []); m.get(k).push(leadName(l)); }
  return [...m.entries()].map(([name, leads]) => ({ name, count: leads.length, leads })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
// New leads over the last 7 local days ending yesterday (test and archived
// leads left out), against the 7 days before, with yesterday's count and a
// 7-day line; the company pipeline now, with how many reached each stage and
// the conversion from the stage before; and what needs action: open leads with
// no activity for 7 days (stale) and leads in their first stage nobody has
// contacted. The panel groups the week's leads by source, industry and market.
export function leadsKpi(leads, now = Date.now()) {
  const real = (leads || []).filter(realLead);
  const week = lastDays(SERIES_DAYS, now);
  const win = { from: week[0].from, to: week[week.length - 1].to };
  const prevWin = { from: localDayRange(SERIES_DAYS * 2, now).from, to: win.from };
  const y = localDayRange(1, now);
  const byTime = (a, b) => toMillis(a.createdAt) - toMillis(b.createdAt);
  const fresh = real.filter((l) => inRange(toMillis(l.createdAt), win)).sort(byTime);
  const prev = real.filter((l) => inRange(toMillis(l.createdAt), prevWin)).length;
  const yesterday = real.filter((l) => inRange(toMillis(l.createdAt), y)).length;
  const series = dailyCounts(real.map((l) => toMillis(l.createdAt)), SERIES_DAYS, now);
  // Pipeline: companies only (network operators have a pipeline of their own).
  const companies = real.filter((l) => l.leadType !== "operator");
  const idx = (l) => PIPELINE.findIndex((s) => s.key === (l.stage || "lead"));
  const pipeline = PIPELINE.map((s, i) => {
    const now_ = companies.filter((l) => idx(l) === i).length;
    const reached = companies.filter((l) => idx(l) >= i).length;
    return { key: s.key, label: s.label, count: now_, reached };
  });
  pipeline.forEach((s, i) => { s.conversionPct = i ? pctOf(s.reached, pipeline[i - 1].reached) : null; });
  const openLeads = real.filter((l) => !CLOSED.has(l.stage));
  const stale = openLeads.filter((l) => now - leadLastActivity(l) >= STALE_MS).map(leadName);
  const notContacted = openLeads.filter((l) => firstStage(l) && !contacted(l)).map(leadName);
  return {
    value: fresh.length, prev, trend: trend(fresh.length, prev, "the 7 days before"), yesterday, series,
    pipeline, needsAction: { stale, notContacted },
    bySource: groupLeads(fresh, leadSourceGroup), byIndustry: groupLeads(fresh, leadIndustry), byMarket: groupLeads(fresh, leadMarket),
  };
}

// ── Conversion funnel ────────────────────────────────────────────────────
const num = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
// A lead that came in from the website (a form submission), not one typed in.
export const isWebsiteLead = (l) => !!l && (/website/i.test(String(l.source || "")) || !!l.sourcePage || (Array.isArray(l.websiteActivity) && l.websiteActivity.length > 0));
// Visitors for a set of funnelDaily rows: GA4's user count when the ingest
// sends one (`users`), else its visits.
const visitorsOf = (rows) => rows.reduce((n, r) => n + (typeof r.users === "number" ? num(r.users) : num(r.visits)), 0);
const sourceIs = (src) => (r) => String(r.source || "") === src;
const tagged = (list) => list.some((r) => r.source);
const OPP_STAGES = new Set(["demo", "post-demo", "closed-won"]);
// rows: funnelDaily documents. The ingest (functions/funnel-ingest.js) tags
// each row with a `source`:
//   ga4-total     the day's unique visitors (GA4 users, one row: users are not
//                 additive across rows, so only this row is counted for them)
//   ga4-site      visits and users by country (market) and channel
//   ga4-industry  real page views of /industries/* pages (by industry and country)
//   ga4-industry-total  one row: GA4 users over every /industries/* page, de-duplicated
//                 (the "Industry page" step; capped at unique visitors)
//   ga4-industry-users  users per industry, no country (the industry list)
//   ga4-events    walkthroughs (product tour starts), calculatorUses, demoRequests,
//                 downloads, leadForms
//   ace           aceCreated: opportunities created
// Rows with no `source` (written before the ingest existed) keep the older
// reading: visitors are every row's users (else visits), industry visitors the
// rows carrying an industry.
// One day's figures.
function funnelDay(cur) {
  const isTagged = tagged(cur);
  const visitorsFor = (list) => {
    if (!isTagged) return visitorsOf(list);
    const totals = list.filter(sourceIs("ga4-total"));
    return totals.length ? visitorsOf(totals) : visitorsOf(list.filter(sourceIs("ga4-site")));
  };
  const visitors = visitorsFor(cur);
  const pick = (...srcs) => { for (const src of srcs) { const l = cur.filter(sourceIs(src)); if (l.length) return l; } return []; };
  const industryRows = isTagged ? pick("ga4-industry-users", "ga4-industry") : cur.filter((r) => String(r.industry || "").trim());
  const industryTotal = isTagged ? cur.filter(sourceIs("ga4-industry-total")) : [];
  const industryRaw = industryTotal.length ? visitorsOf(industryTotal) : visitorsOf(industryRows);
  const industryPage = isTagged && visitors > 0 ? Math.min(industryRaw, visitors) : industryRaw;
  const engagedRows = isTagged ? cur.filter(sourceIs("ga4-events")) : cur;
  const engaged = engagedRows.reduce((n, r) => n + num(r.walkthroughs) + num(r.calculatorUses) + num(r.demoRequests) + num(r.downloads), 0);
  const industries = new Map();
  for (const r of industryRows) { const k = String(r.industry || "").trim(); if (k) industries.set(k, (industries.get(k) || 0) + visitorsOf([r])); }
  // Markets: visitors by country (ga4-site), else the industry pages' countries.
  const marketRows = isTagged ? pick("ga4-site", "ga4-industry") : cur;
  const markets = new Map();
  for (const r of marketRows) { const k = String(r.country || "").trim(); if (k) markets.set(k, (markets.get(k) || 0) + visitorsOf([r])); }
  const channelRows = isTagged ? cur.filter(sourceIs("ga4-site")) : cur;
  const channels = new Map();
  for (const r of channelRows) { const k = String(r.channel || "").trim() || "Other"; channels.set(k, (channels.get(k) || 0) + visitorsOf([r])); }
  const ace = cur.filter(sourceIs("ace")).reduce((n, r) => n + num(r.aceCreated), 0);
  return { visitors, industryPage, engaged, industries, markets, channels, ace, hasAce: cur.some(sourceIs("ace")) };
}
const addMap = (into, from) => { for (const [k, v] of from) into.set(k, (into.get(k) || 0) + v); return into; };
// Ranked with the change on the week before; top mover = biggest growth.
function ranked(cur, prev) {
  return [...cur.entries()].map(([name, count]) => ({ name, count, prev: prev.get(name) || 0, change: count - (prev.get(name) || 0) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
const topMover = (list) => list.filter((x) => x.change > 0).sort((a, b) => b.change - a.change || b.count - a.count)[0] || null;
// The last 7 local days ending yesterday, against the 7 before: visitors with
// a 7-day line; visitor-to-lead %; the funnel Visitors → Industry page →
// Walkthrough or calculator → Lead → Opportunity with the drop at each step
// and the biggest flagged; industries and markets ranked with the change on
// the week before, and the top mover of each; traffic sources.
// Opportunities are ACE opportunities created when the ingest has ACE rows for
// the week, else website leads now at Demo or beyond.
export function funnelKpi(rows, leads, now = Date.now()) {
  const of = (day) => (rows || []).filter((r) => r && String(r.date || "").slice(0, 10) === day);
  const week = lastDays(SERIES_DAYS, now);
  const before = week.map((r) => localDayRange(0, r.from - 7 * 24 * 3600000 + 12 * 3600000));
  const days = week.map((r) => funnelDay(of(r.day)));
  const prevDays = before.map((r) => funnelDay(of(r.day)));
  const sum = (list, k) => list.reduce((n, d) => n + d[k], 0);
  const visitors = sum(days, "visitors"), prev = sum(prevDays, "visitors");
  const win = { from: week[0].from, to: week[week.length - 1].to };
  const webLeads = (leads || []).filter((l) => realLead(l) && isWebsiteLead(l) && inRange(toMillis(l.createdAt), win));
  const hasAce = days.some((d) => d.hasAce);
  const opps = hasAce ? sum(days, "ace") : webLeads.filter((l) => OPP_STAGES.has(l.stage)).length;
  const counts = [visitors, sum(days, "industryPage"), sum(days, "engaged"), webLeads.length, opps];
  const labels = ["Unique visitors", "Industry page", "Walkthrough or calculator", "Lead", "Opportunity"];
  const short = ["Visitors", "Industry", "Engaged", "Leads", "Opps"];
  const steps = labels.map((label, i) => {
    const count = counts[i];
    const base = i ? counts[i - 1] : null;
    return { label, short: short[i], count, dropOff: base ? Math.max(0, base - count) : null, dropOffPct: base ? Math.round(Math.max(0, base - count) / base * 100) : null };
  });
  let biggest = -1;
  steps.forEach((s, i) => { if (s.dropOffPct != null && s.dropOffPct > 0 && (biggest < 0 || s.dropOffPct > steps[biggest].dropOffPct)) biggest = i; });
  if (biggest >= 0) steps[biggest].biggest = true;
  const industries = ranked(days.reduce((m, d) => addMap(m, d.industries), new Map()), prevDays.reduce((m, d) => addMap(m, d.industries), new Map()));
  const markets = ranked(days.reduce((m, d) => addMap(m, d.markets), new Map()), prevDays.reduce((m, d) => addMap(m, d.markets), new Map()));
  const channels = [...days.reduce((m, d) => addMap(m, d.channels), new Map()).entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const y = localDayRange(1, now);
  return {
    value: visitors, prev, trend: trend(visitors, prev, "the 7 days before"), series: days.map((d) => d.visitors),
    conversionPct: visitors ? Math.round((webLeads.length / visitors) * 1000) / 10 : null,
    steps, biggestDrop: biggest >= 0 ? steps[biggest] : null, oppsFrom: hasAce ? "ace" : "leads",
    industries, markets, channels, topIndustry: topMover(industries), topMarket: topMover(markets),
    hasData: of(y.day).length > 0,
  };
}

// ── Support (three tiles) ────────────────────────────────────────────────
// tickets: normalised supportTickets (support-core's normaliseTicket). Needs a
// person is of the Support Inbox only (mail written to support@). AI drafts to
// approve and Resolved & automation cover every inbox by default, and take an
// inbox key to narrow them to one (ZCNIxvtORgZN0csAlO44): "" is every inbox.
// They use the Support Inbox's own queue tests, so the Support Inbox figures
// equal its queue counts.
export const FAQ_GAP_DAYS = 30;
const queueTest = (key) => QUEUES.find((q) => q.key === key).test;
const waitOf = (t, now) => Math.max(0, now - (t.lastInboundAt || t.lastMessageAt || t.createdAt || now));
const customerOf = (t) => t.customerName || t.customerEmail || "Unknown sender";
// Needs a person: the queue's count, the age of the oldest and every ticket
// with its customer and wait, longest first. The queue holds support queries
// only (support-core's isSupportQuery): not an Aidan request, nor mail that is
// automated, not about PH or spam-like.
export function needsPersonKpi(tickets, now = Date.now()) {
  const list = (tickets || []).filter((t) => inInbox(t, DEFAULT_INBOX) && queueTest("needs-person")(t))
    .map((t) => ({ id: t.id, customer: customerOf(t), subject: t.subject || "", waitedMs: waitOf(t, now) }))
    .sort((a, b) => b.waitedMs - a.waitedMs);
  return { count: list.length, oldestMs: list.length ? list[0].waitedMs : null, tickets: list };
}
// The inboxes a ticket is filed under (none recorded: the Support Inbox).
export const ticketInboxes = (t) => (t.inboxes && t.inboxes.length ? t.inboxes : [DEFAULT_INBOX]);
// An inbox key the filter knows, else "" (every inbox).
export const dashInboxKey = (key) => (INBOXES.some((i) => i.key === key) ? key : "");
// Per inbox, the headline figure of the tickets in it. A ticket written to two
// addresses is in both, so the figures need not add up to the all-inbox one.
const perInbox = (list, figure) => Object.fromEntries(INBOXES.map((i) => [i.key, figure(list.filter((t) => inInbox(t, i.key)))]));
// AI drafts to approve: the queue's count and each draft with its confidence
// and inboxes, most confident first (the quickest to approve). `inbox` narrows
// it to one inbox ("" = every inbox); allCount and byInbox are the counts the
// filter shows on each of its choices.
export function draftsKpi(tickets, now = Date.now(), inbox = "") {
  const key = dashInboxKey(inbox);
  const all = (tickets || []).filter(queueTest("ai-drafts"));
  const list = all.filter((t) => !key || inInbox(t, key))
    .map((t) => ({ id: t.id, customer: customerOf(t), subject: t.subject || "", inboxes: ticketInboxes(t), confidence: (t.aiDraft && t.aiDraft.confidence) || 0, waitedMs: waitOf(t, now) }))
    .sort((a, b) => b.confidence - a.confidence || b.waitedMs - a.waitedMs);
  return { inbox: key, count: list.length, high: list.filter((d) => d.confidence >= 0.8).length, drafts: list, allCount: all.length, byInbox: perInbox(all, (l) => l.length) };
}
// Resolved & automation: tickets resolved yesterday (still resolved), against
// the day before; the share of those the AI resolved with no person involved;
// and the FAQ gaps of the last 30 days: questions the Help Centre couldn't
// answer (a draft marked not answerable, or triage saying so), newest first.
// `inbox` narrows every figure and the gaps to one inbox ("" = every inbox);
// allCount and byInbox are the resolved-yesterday figure of each choice.
export function resolvedKpi(tickets, now = Date.now(), inbox = "") {
  const key = dashInboxKey(inbox);
  const every = (tickets || []).filter((t) => t.status !== "spam");
  const pool = every.filter((t) => !key || inInbox(t, key));
  const y = localDayRange(1, now), p = localDayRange(2, now);
  const on = (list, r) => list.filter((t) => t.status === "resolved" && inRange(t.resolvedAt, r));
  const done = on(pool, y);
  const ai = done.filter((t) => t.resolvedBy === "ai" && !t.humanInvolved).length;
  const since = now - FAQ_GAP_DAYS * 24 * 3600000;
  const gaps = pool.filter((t) => (t.createdAt || t.lastMessageAt) >= since
      && ((t.aiDraft && !t.aiDraft.answerable) || /help centre doesn.t answer/i.test(t.triageReason || "")))
    .map((t) => ({ id: t.id, subject: t.subject || "", customer: customerOf(t), inboxes: ticketInboxes(t), at: t.createdAt || t.lastMessageAt }))
    .sort((a, b) => b.at - a.at);
  const prev = on(pool, p).length;
  return {
    inbox: key, value: done.length, prev, trend: trend(done.length, prev), aiCount: ai, aiPct: pctOf(ai, done.length), gaps,
    allCount: on(every, y).length, byInbox: perInbox(every, (l) => on(l, y).length),
  };
}
