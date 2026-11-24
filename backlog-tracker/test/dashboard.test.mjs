// Dashboard (#dashboard): the KPI rules in public/js/dashboard-core.js.
// Days are the viewer's local days, so every instant here is built with the
// local Date constructor, never a UTC string.
import assert from "node:assert";
import { localDayRange, fmtEffort, trend, deliveryPeriod, periodWindows, countChange, passChange, deliveryRange, fmtWait, deliveryKpi, flowKpi, firstTimePass, kanbanKpi, dashboardRelease, leadsKpi, leadSourceGroup, funnelKpi, needsPersonKpi, draftsKpi, resolvedKpi, isBuilding, isWebsiteLead, lastDays, dailyCounts, sparklinePoints, trendShort, tileStatus, rowEnd } from "../public/js/dashboard-core.js";
import { normaliseTicket, queueCounts } from "../public/js/support-core.js";
import { currentReleaseId } from "../public/js/kanban/kanban-core.js";

const at = (d, h = 12, m = 0) => new Date(2026, 10, d, h, m).getTime(); // November 2026, local
const NOW = at(17, 9, 30);

// ── Local days ────────────────────────────────────────────────────────────
const y = localDayRange(1, NOW);
assert.strictEqual(y.day, "2026-11-16", "yesterday is the local day before today");
assert.strictEqual(y.from, new Date(2026, 10, 16).getTime());
assert.strictEqual(y.to, new Date(2026, 10, 17).getTime(), "the range ends at local midnight");
assert.strictEqual(localDayRange(2, NOW).day, "2026-11-15");
assert.strictEqual(localDayRange(1, at(1, 0, 5)).day, "2026-10-31", "a month boundary");

// ── Formatting ────────────────────────────────────────────────────────────
assert.strictEqual(fmtEffort(24), "24h (3d)", "hours with days in brackets, 8h a day");
assert.strictEqual(fmtEffort(20), "20h (2.5d)");
assert.strictEqual(fmtEffort(0), "0h (0d)");
assert.strictEqual(fmtEffort(7.3), "7.5h (0.9d)", "hours round to the half hour");
assert.deepStrictEqual(trend(5, 3), { dir: "up", delta: 2, text: "+2 vs the day before" });
assert.strictEqual(trend(1, 4).dir, "down");
assert.strictEqual(trend(1, 4).text, "−3 vs the day before");
assert.strictEqual(trend(0, 0).text, "Same as the day before");
assert.strictEqual(trend(9, 4, "the 7 days before").text, "+5 vs the 7 days before", "a weekly figure names what it is compared with");
assert.strictEqual(fmtWait(3 * 3600000 + 5 * 60000), "3h");
assert.strictEqual(fmtWait(50 * 3600000), "2d 2h");
assert.strictEqual(fmtWait(30000), "just now");

// ── Delivery ──────────────────────────────────────────────────────────────
const projects = [{ id: "p1", name: "Backlog Tracker & FAQs" }, { id: "p2", name: "Display Types" }, { id: "p3", name: "Old project", archived: true }];
const items = [
  // Shipped yesterday: a in 2 days, passed first time; b in 4 days, sent back once.
  { id: "a", projectId: "p1", status: "published-live", createdAt: at(14, 14), mergedAt: { seconds: at(16, 14) / 1000 }, testRound: 1, countedSendBacks: 0 },
  { id: "b", projectId: "p1", status: "published-live", createdAt: at(12, 23, 59), mergedAt: new Date(at(16, 23, 59)).toISOString(), testRound: 2, countedSendBacks: 1 },
  // The day before: 1 day; an older card with no rounds kept and no failure passes.
  { id: "c", projectId: "p2", status: "published-live", createdAt: at(14, 10), mergedAt: at(15, 10) },
  // Today: not yesterday, and not in the 7 days ending yesterday.
  { id: "d", projectId: "p2", status: "published-live", createdAt: at(10, 8), mergedAt: at(17, 8) },
  // Archived after shipping yesterday (merged by the statusEnteredAt fallback); failed once.
  { id: "i", projectId: "p2", status: "archived", createdAt: at(13, 9), statusEnteredAt: at(16, 9), lastFailureReason: { text: "Broken" } },
  // Shipped 8 days ago: outside the week.
  { id: "j", projectId: "p1", status: "published-live", createdAt: at(1, 9), mergedAt: at(9, 9) },
  { id: "e", projectId: "p2", status: "ready-for-testing", statusEnteredAt: at(16, 9), lastFire: { status: "started", at: at(16, 9) } },
];
const dk = deliveryKpi(items, projects, NOW);
assert.strictEqual(dk.value, 3, "deployed yesterday: two live and one already archived");
assert.strictEqual(dk.prev, 1);
assert.strictEqual(dk.trend.dir, "up");
assert.deepStrictEqual(dk.series, [0, 0, 0, 0, 0, 1, 3], "deployed per day, the last point is yesterday");
assert.strictEqual(dk.shipped, 4, "a, b, c and i shipped in the last 7 days");
assert.strictEqual(dk.leadTimeMs, ((at(16, 14) - at(14, 14)) + (at(16, 23, 59) - at(12, 23, 59)) + (at(15, 10) - at(14, 10)) + (at(16, 9) - at(13, 9))) / 4, "average Backlog to Live");
assert.strictEqual(dk.firstPassPct, 50, "a and c passed first time; b was sent back, i failed testing");
assert.ok(firstTimePass({ testRound: 1 }) && !firstTimePass({ testRound: 2 }) && !firstTimePass({ countedSendBacks: 1, testRound: 1 }) && firstTimePass({}) && !firstTimePass({ lastFailureReason: { text: "x" } }));
const dp1 = dk.projects.find((p) => p.id === "p1");
assert.deepStrictEqual([dp1.name, dp1.yesterday, dp1.week, dp1.firstPassPct], ["Backlog Tracker & FAQs", 2, 2, 50]);
assert.strictEqual(dp1.leadTimeMs, 3 * 24 * 3600000, "p1: 2 days and 4 days");
assert.deepStrictEqual(dk.projects.map((p) => p.id), ["p1", "p2"], "the project that shipped most yesterday comes first");
assert.deepStrictEqual(deliveryKpi([], projects, NOW).projects, [], "a quiet week lists no project");
assert.strictEqual(deliveryKpi([], projects, NOW).leadTimeMs, null);
assert.ok(isBuilding({ status: "backlog", lastFire: { status: "started", at: at(17, 9) }, buildSession: { status: "running" } }));
assert.ok(!isBuilding({ status: "backlog", lastFire: { status: "started", at: at(16, 9) }, buildSession: { status: "done", finishedAt: at(16, 10) } }), "a reported build is no longer in build");

// ── Flow & blockers ───────────────────────────────────────────────────────
{
  const flow = [
    { id: "f1", title: "Needs a logo", projectId: "p1", status: "backlog", blocked: { reason: "waiting-on-input", note: "Needs a logo file", setAt: at(15, 9, 30) } },
    // A plain wait for another ticket releases itself: not stuck. Marked stuckOn, it is.
    { id: "f2", title: "After the grid", projectId: "p1", status: "backlog", blocked: { reason: "waiting-on-dependency" } },
    { id: "f3", title: "Loop", projectId: "p2", status: "backlog", blocked: { reason: "waiting-on-dependency", stuckOn: { itemId: "x" }, setAt: at(17, 8, 30) } },
    // Sent back with Failed testing, not rebuilding: stuck since the failure.
    { id: "f4", title: "Bad colours", projectId: "p2", status: "backlog", statusEnteredAt: at(16, 9, 30), lastFailureReason: { text: "Wrong blue", at: at(16, 9, 30) } },
    // Failed, but rebuilding now / a patch waiting to land / failed long ago and moved since: not stuck.
    { id: "f5", title: "Rebuilding", projectId: "p2", status: "backlog", statusEnteredAt: at(16, 9), lastFailureReason: { at: at(16, 9) }, lastFire: { status: "started", at: at(16, 10) } },
    { id: "f6", title: "Patched", projectId: "p2", status: "backlog", statusEnteredAt: at(16, 9), lastFailureReason: { at: at(16, 9) }, patchReady: true },
    { id: "f7", title: "Old failure", projectId: "p2", status: "backlog", statusEnteredAt: at(16, 9), lastFailureReason: { at: at(10, 9) } },
    // Production order: the failure is written with the move, statusEnteredAt is stamped by a trigger
    // afterwards (seconds later, ~40 s after a review kick-back's revert). Still stuck since the failure.
    { id: "f12", title: "Sent back", projectId: "p1", status: "backlog", statusEnteredAt: new Date(at(16, 11) + 2500), lastFailureReason: { text: "Wrong copy", at: at(16, 11) } },
    { id: "f13", title: "Kicked back", projectId: "p1", status: "backlog", statusEnteredAt: new Date(at(16, 11, 30) + 41000), lastFailureReason: { at: at(16, 11, 30) } },
    // Failed, then moved to Backlog again well after (a later spell): not this failure.
    { id: "f14", title: "Moved later", projectId: "p1", status: "backlog", statusEnteredAt: at(16, 12), lastFailureReason: { at: at(16, 11) } },
    // Ready for Testing over 24 hours waits on a person; under 24 hours, approved, or live does not.
    { id: "f8", title: "Waiting test", projectId: "p1", status: "ready-for-testing", statusEnteredAt: at(14, 9, 30) },
    { id: "f9", title: "Fresh test", projectId: "p1", status: "ready-for-testing", statusEnteredAt: at(16, 12) },
    { id: "f10", title: "Approved", projectId: "p1", status: "ready-to-publish", statusEnteredAt: at(10, 9) },
    { id: "f11", title: "Shipped", projectId: "p1", status: "published-live", blocked: { reason: "waiting-on-input" } },
  ];
  const fk = flowKpi(flow, projects, NOW);
  assert.deepStrictEqual(fk.stuck.map((s) => s.id), ["f8", "f1", "f4", "f12", "f13", "f3"], "stuck tickets, longest wait first");
  assert.deepStrictEqual([fk.value, fk.blocked, fk.failed, fk.testing], [6, 2, 3, 1]);
  assert.strictEqual(fk.stuck.find((s) => s.id === "f12").waitedMs, NOW - at(16, 11), "waits since the failure, not the stamp");
  const f1 = fk.stuck.find((s) => s.id === "f1");
  assert.deepStrictEqual([f1.project, f1.reason, f1.waitedMs], ["Backlog Tracker & FAQs", "Needs a logo file", 2 * 24 * 3600000]);
  assert.strictEqual(fk.stuck.find((s) => s.id === "f4").reason, "Failed testing: Wrong blue");
  assert.strictEqual(fk.stuck.find((s) => s.id === "f3").reason, "Stuck behind another ticket");
  assert.strictEqual(tileStatus("flow", fk).level, "alert", "red at three or more stuck");
  assert.strictEqual(tileStatus("flow", flowKpi(flow.slice(0, 1), projects, NOW)).level, "warn");
  assert.strictEqual(tileStatus("flow", flowKpi([], projects, NOW)).level, "ok");
  assert.deepStrictEqual([fk.retestedCount, fk.retested], [0, []], "nothing sent back: nothing retested");
}
// Retested tickets (0I93kb0fqXL4Qr4qyzwv): beside the stuck count, every
// ticket not archived that went back through retesting, and how many times.
{
  const sb = (day, line, extra = {}) => ({ at: new Date(at(day)).toISOString(), by: "person", who: "tester@example.com", line, counted: true, ...extra });
  const loops = [
    { id: "r1", title: "Twice", projectId: "p1", status: "ready-for-testing", testRound: 3, sendBackCount: 2, countedSendBacks: 2, sendBacks: [sb(10, "a"), sb(12, "b")] },
    { id: "r2", title: "Once", projectId: "p2", status: "published-live", testRound: 2, sendBackCount: 1, countedSendBacks: 1, sendBacks: [sb(11, "c")] },
    { id: "r3", title: "Flaky only", projectId: "p1", status: "ready-for-testing", testRound: 1, sendBackCount: 1, countedSendBacks: 0, sendBacks: [sb(11, "d", { by: "tests", counted: false })] },
    { id: "r4", title: "Archived", projectId: "p1", status: "archived", testRound: 2, sendBackCount: 1, countedSendBacks: 1, sendBacks: [sb(9, "e")] },
    { id: "r5", title: "Never sent back", projectId: "p1", status: "ready-for-testing", testRound: 1, sendBackCount: 0, countedSendBacks: 0, sendBacks: [] },
  ];
  const rk = flowKpi(loops, projects, NOW);
  assert.strictEqual(rk.retestedCount, 2, "counted send-backs only; archived left out");
  assert.deepStrictEqual(rk.retested.map((r) => [r.id, r.times, r.round]), [["r1", 2, 3], ["r2", 1, 2]], "most retested first, times = counted send-backs");
  assert.strictEqual(rk.retested[0].project, "Backlog Tracker & FAQs");
  assert.strictEqual(rk.value, 0, "a retested ticket is not stuck by itself");
  assert.strictEqual(tileStatus("flow", rk).level, "ok", "retested tickets leave the tile's colour alone");
}

// ── Staff Kanban ──────────────────────────────────────────────────────────
// The console's releases say status "live"; Staff Kanban reads `released`.
// The tile once took the live "September 2026" release (no open task) and was blank.
const releases = [{ id: "r1", name: "September 2026", version: "4.2", status: "live" }, { id: "r2", name: "DSP Integration", version: "5.0", status: "draft" }, { id: "r3", name: "1.7", version: "5.1" }];
assert.strictEqual(dashboardRelease({}, releases).id, "r2", "a live release (status \"live\") is never the current one");
assert.strictEqual(dashboardRelease({ currentRelease: "r3" }, releases).id, "r3", "the release picked in Kanban settings");
assert.strictEqual(dashboardRelease({}, [{ id: "x", released: true }]), null);
assert.strictEqual(dashboardRelease({}, [{ id: "x", status: "live" }]), null);
{
  // Order and version disagree: the tile follows Staff Kanban's own rule (version first).
  const mixed = [{ id: "a", name: "2.0.0", version: "2.0.0", order: 1 }, { id: "b", name: "1.9.0", version: "1.9.0", order: 2 }];
  assert.strictEqual(dashboardRelease({}, mixed).id, "b", "the earliest open release by version, not by order");
  assert.strictEqual(dashboardRelease({}, mixed).id, currentReleaseId({}, mixed), "the same release Staff Kanban treats as current");
  assert.deepStrictEqual(dashboardRelease({ currentRelease: "gone" }, mixed), { id: "gone", name: "gone" }, "a picked release not in the list still shows its id");
}
const tasks = [
  { key: "PH-1", release: "r2", project: "p1", status: "backlog", assignee: "ana@ph.example", estimate: 16, logged: 4, due: "2026-11-16" },
  { key: "PH-2", release: "r2", project: "p1", status: "in-progress", assignee: "ana@ph.example", estimate: 8, due: "2026-11-17" },
  { key: "PH-3", release: "r2", project: "p2", status: "ready-for-dev", assignee: "ben@ph.example", title: "Write the help text" },
  { key: "PH-4", release: "r2", status: "ready-for-testing", assignee: "", estimate: 4 },
  { key: "PH-8", release: "r2", status: "ready-for-testing", assignee: "Me@PH.example", estimate: 2 },
  { key: "PH-9", release: "r2", status: "approved", assignee: "ben@ph.example", estimate: 1, logged: 1 },
  { key: "PH-6", release: "r2", type: "epic", status: "backlog", estimate: 100 },
  { key: "PH-7", release: "r9", status: "backlog", estimate: 100, assignee: "ana@ph.example" },
  { key: "PH-10", release: "r2", project: "p3", status: "backlog", estimate: 50, assignee: "ana@ph.example" },
];
const releaseTasks = [...tasks.filter((x) => x.release === "r2"),
  { key: "PH-5", release: "r2", status: "done", resolution: "completed", estimate: 40 },
  { key: "PH-11", release: "r2", status: "done", resolution: "withdrawn" }];
const names = { "ana@ph.example": "Ana", "ben@ph.example": "Ben", "me@ph.example": "Me" };
const kb = kanbanKpi({ release: dashboardRelease({}, releases), open: tasks, releaseTasks, projects, me: "me@ph.example", now: NOW }, (e) => names[String(e).toLowerCase()]);
assert.strictEqual(kb.value, 6, "the release's open tasks; epics, other releases and archived projects left out");
assert.deepStrictEqual(kb.columns.map((c) => [c.label, c.count]), [["To do", 2], ["In progress", 1], ["Testing", 3]], "Backlog + Ready for Dev, In Progress, Testing + Approved");
assert.strictEqual(kb.scopeLabel, "DSP Integration");
assert.ok(!kb.allWork);
assert.deepStrictEqual(kb.progress, { done: 1, total: 8, pct: 13 }, "done of every task in the release (PH-5 of 8); withdrawn tasks and epics left out");
assert.deepStrictEqual(kb.flags, { overdue: 1, unassigned: 1, unestimated: 1, waitingOnMe: 1 }, "PH-1 overdue (due yesterday), PH-4 unassigned, PH-3 unestimated, PH-8 waiting on the viewer in Testing");
assert.strictEqual(kb.hours, 12 + 8 + 0 + 4 + 2 + 0, "remaining = estimate − logged");
assert.strictEqual(kb.effort, "26h (3.3d)");
assert.deepStrictEqual(kb.people.map((p) => [p.name, p.hours, p.tasks]), [["Ana", 20, 2], ["Unassigned", 4, 1], ["Me", 2, 1], ["Ben", 0, 2]]);
assert.deepStrictEqual(kb.people.find((p) => p.name === "Ben").unestimated, [{ key: "PH-3", title: "Write the help text" }]);
assert.deepStrictEqual(tileStatus("kanban", kb), { level: "warn", reason: "1 overdue, 1 unassigned, 1 unestimated, 1 waiting on you in Testing" });
{
  // No release selected, or none of its tasks open: all open work, never blank.
  const none = kanbanKpi({ release: null, open: tasks, projects, now: NOW });
  assert.deepStrictEqual([none.value, none.scopeLabel, none.allWork, none.progress], [7, "All open work", true, null], "every open task across active projects");
  const empty = kanbanKpi({ release: { id: "r3", name: "1.7" }, open: tasks, releaseTasks: [], projects, now: NOW });
  assert.deepStrictEqual([empty.value, empty.scopeLabel], [7, "All open work"], "a release with nothing open falls back to all open work");
  assert.strictEqual(tileStatus("kanban", kanbanKpi({ release: null, open: [{ key: "x", status: "backlog", assignee: "a", estimate: 1 }], now: NOW })).level, "ok");
}

// ── Leads ─────────────────────────────────────────────────────────────────
const leads = [
  { id: "1", company: { name: "Burger Co", industry: "QSR", countries: ["Australia"] }, stage: "lead", createdAt: at(16, 9), source: "Website form" },
  { id: "2", leadType: "operator", contacts: [{ name: "Sam Jones" }], operator: { region: "Thailand", networkIndustry: "Malls" }, stage: "applied", createdAt: at(16, 18), sourcePage: "/run-your-own-rmn/" },
  { id: "3", company: { name: "Grocer Ltd", industry: "Grocery", countries: ["United Kingdom"] }, stage: "demo", createdAt: at(12, 11), source: "Partner referral", stageChangedAt: at(13, 9) },
  { id: "4", company: { name: "Test Co" }, createdAt: at(16, 11), test: true },
  { id: "5", company: { name: "Gone Ltd" }, createdAt: at(16, 11), archivedAt: at(16, 12) },
  { id: "6", company: { name: "Old Co" }, stage: "hot-lead", createdAt: at(5, 11), history: [{ kind: "note", by: "ana@ph.example", at: new Date(at(6, 9)).toISOString() }] },
  { id: "7", company: { name: "Won Co" }, stage: "closed-won", createdAt: at(1, 11) },
  { id: "8", company: { name: "Lost Co" }, stage: "closed-lost", createdAt: at(2, 11) },
  { id: "9", company: { name: "Called Co", industry: "QSR", countries: ["Australia"] }, stage: "lead", createdAt: at(15, 11), source: "Manual", history: [{ kind: "note", by: "ben@ph.example", at: new Date(at(15, 12)).toISOString() }] },
];
const lk = leadsKpi(leads, NOW);
assert.strictEqual(lk.value, 4, "new in the last 7 days (1, 2, 3, 9); test and archived leads are not counted");
assert.strictEqual(lk.prev, 1, "Old Co, in the 7 days before");
assert.strictEqual(lk.yesterday, 2);
assert.strictEqual(lk.trend.text, "+3 vs the 7 days before");
assert.deepStrictEqual(lk.series, [0, 0, 1, 0, 0, 1, 2]);
assert.deepStrictEqual(lk.pipeline.map((p) => [p.label, p.count, p.reached, p.conversionPct]), [
  ["Lead", 2, 5, null], ["Hot Lead", 1, 3, 60], ["Demo", 1, 2, 67], ["Post-demo", 0, 1, 50], ["Closed Won", 1, 1, 100],
], "companies at each stage now, how many reached it, and the conversion from the stage before (Lost and operators left out)");
assert.deepStrictEqual(lk.needsAction.stale, ["Old Co"], "open with no activity for 7 days");
assert.deepStrictEqual(lk.needsAction.notContacted, ["Burger Co", "Sam Jones"], "first stage and nobody but the website has touched it");
assert.deepStrictEqual(lk.bySource.map((g) => [g.name, g.count, g.leads]), [["Network operator", 1, ["Sam Jones"]], ["Other", 1, ["Called Co"]], ["Partner", 1, ["Grocer Ltd"]], ["Website", 1, ["Burger Co"]]]);
assert.deepStrictEqual(lk.byIndustry.map((g) => [g.name, g.count]), [["QSR", 2], ["Grocery", 1], ["Malls", 1]]);
assert.deepStrictEqual(lk.byMarket.map((g) => [g.name, g.count]), [["Australia", 2], ["Thailand", 1], ["United Kingdom", 1]]);
assert.strictEqual(leadSourceGroup({ source: "AWS Marketplace" }), "Partner");
assert.ok(isWebsiteLead(leads[0]) && isWebsiteLead(leads[1]) && !isWebsiteLead(leads[2]));
assert.strictEqual(tileStatus("leads", lk).level, "warn", "amber while a lead needs action");
assert.strictEqual(tileStatus("leads", leadsKpi([], NOW)).level, "ok", "a quiet week is not a fault");

// ── Conversion funnel ─────────────────────────────────────────────────────
const rows = [
  { date: "2026-11-16", visits: 400, industry: "", demoRequests: 0, downloads: 0 },
  { date: "2026-11-16", visits: 120, industry: "Grocery", demoRequests: 3, downloads: 2 },
  { date: "2026-11-16", visits: 80, industry: "QSR", demoRequests: 1, downloads: 4 },
  { date: "2026-11-16", visits: 90, industry: "Grocery", demoRequests: 0, downloads: 0 },
  // The same weekday a week before: the 7 days before.
  { date: "2026-11-09", visits: 500, industry: "" },
];
const fk = funnelKpi(rows, leads, NOW);
assert.strictEqual(fk.value, 690);
assert.strictEqual(fk.prev, 500);
assert.deepStrictEqual(fk.steps.map((s) => [s.label, s.count, s.dropOff, s.dropOffPct]), [
  ["Unique visitors", 690, null, null],
  ["Industry page", 290, 400, 58],
  ["Walkthrough or calculator", 10, 280, 97],
  ["Lead", 2, 8, 80],
  ["Opportunity", 0, 2, 100],
], "the 7 days' funnel; with no ACE rows, opportunities are the week's website leads now at Demo or beyond");
assert.strictEqual(fk.biggestDrop.label, "Opportunity", "the biggest drop-off is flagged");
assert.strictEqual(fk.steps.filter((x) => x.biggest).length, 1);
assert.strictEqual(fk.conversionPct, 0.3, "visitor to lead: 2 of 690");
assert.strictEqual(fk.trend.text, "+190 vs the 7 days before");
assert.deepStrictEqual(fk.industries.map((x) => [x.name, x.count]), [["Grocery", 210], ["QSR", 80]], "industries ranked by visitors, peak first");
assert.strictEqual(funnelKpi([{ date: "2026-11-16", visits: 10, users: 7 }], [], NOW).value, 7, "GA4's user count wins when the ingest sends one");
assert.strictEqual(funnelKpi([], [], NOW).hasData, false);
// Rows from the ingest (functions/funnel-ingest.js) carry a source: unique visitors are the
// day's GA4 total (users are not additive across slices), industry page visitors come from
// real /industries/* page views, and walkthrough or calculator from the GA4 key events.
const ing = [
  { date: "2026-11-16", source: "ga4-total", users: 300 },
  { date: "2026-11-16", source: "ga4-site", country: "UK", visits: 250, users: 200 },
  { date: "2026-11-16", source: "ga4-site", country: "AU", visits: 150, users: 130 },
  { date: "2026-11-16", source: "ga4-industry", industry: "Telco", country: "UK", pageViews: 90, users: 60 },
  { date: "2026-11-16", source: "ga4-industry", industry: "Grocery", country: "UK", pageViews: 140, users: 70 },
  { date: "2026-11-16", source: "ga4-events", industry: "Telco", walkthroughs: 9, calculatorUses: 2, demoRequests: 1, downloads: 3, leadForms: 4 },
  { date: "2026-11-16", source: "google-ads", impressions: 5000, clicks: 150 },
  { date: "2026-11-16", source: "leads", industry: "Telco", leads: 3 },
  { date: "2026-11-09", source: "ga4-total", users: 250 },
  { date: "2026-11-09", source: "ga4-site", country: "UK", users: 190, channel: "Organic" },
  { date: "2026-11-09", source: "ga4-industry-users", industry: "Telco", users: 10 },
  { date: "2026-11-14", source: "ace", industry: "Telco", aceCreated: 1 },
];
const ik = funnelKpi(ing, leads, NOW);
assert.strictEqual(ik.value, 300, "unique visitors are GA4's total users for the day");
assert.strictEqual(ik.prev, 250);
assert.deepStrictEqual(ik.steps.map((s) => s.count), [300, 130, 15, 2, 1], "opportunities are ACE opportunities created when the ingest has them");
assert.strictEqual(ik.oppsFrom, "ace");
assert.deepStrictEqual(ik.markets.map((x) => [x.name, x.count, x.change]), [["UK", 200, 10], ["AU", 130, 130]], "markets by visitors with the change on the week before");
assert.deepStrictEqual([ik.topMarket.name, ik.topIndustry.name], ["AU", "Grocery"], "top movers: the biggest growth on the week before");
assert.deepStrictEqual(ik.industries.map((x) => [x.name, x.count]), [["Grocery", 70], ["Telco", 60]]);
assert.strictEqual(funnelKpi(ing.filter((r) => r.source !== "ga4-total"), [], NOW).value, 330, "no total row: the site slices' users");
// Review of T6f4GeJZGg0OgntUpzPq: one visitor who viewed two industries is one Industry page
// visitor. The step is GA4's de-duplicated ga4-industry-total, never a sum of per-industry users,
// and never more than unique visitors; the list reads ga4-industry-users.
const two = [
  { date: "2026-11-16", source: "ga4-total", users: 1 },
  { date: "2026-11-16", source: "ga4-industry", industry: "Retail", country: "UK", pageViews: 1, users: 1 },
  { date: "2026-11-16", source: "ga4-industry", industry: "Banking", country: "UK", pageViews: 1, users: 1 },
];
const twoOld = funnelKpi(two, [], NOW);
assert.strictEqual(twoOld.steps[1].count, 1, "older rows without ga4-industry-total: capped at unique visitors");
const twoNew = funnelKpi([...two,
  { date: "2026-11-16", source: "ga4-industry-total", users: 1 },
  { date: "2026-11-16", source: "ga4-industry-users", industry: "Retail", users: 1 },
  { date: "2026-11-16", source: "ga4-industry-users", industry: "Banking", users: 1 },
], [], NOW);
assert.deepStrictEqual(twoNew.steps.slice(0, 2).map((s) => [s.count, s.dropOff]), [[1, null], [1, 0]]);
assert.deepStrictEqual(twoNew.industries.map((x) => [x.name, x.count]), [["Banking", 1], ["Retail", 1]]);
const ik2 = funnelKpi([...ing, { date: "2026-11-16", source: "ga4-industry-total", users: 110 },
  { date: "2026-11-16", source: "ga4-industry-users", industry: "Telco", users: 60 }, { date: "2026-11-16", source: "ga4-industry-users", industry: "Grocery", users: 65 }], leads, NOW);
assert.strictEqual(ik2.steps[1].count, 110, "the Industry page step is GA4's de-duplicated users, not 60 + 70");
assert.deepStrictEqual(ik2.industries.map((x) => [x.name, x.count]), [["Grocery", 65], ["Telco", 60]], "the industry list reads ga4-industry-users");
assert.deepStrictEqual(tileStatus("funnel", { hasData: true, dataNotUpdated: true }), { level: "alert", reason: "Data not updated" }, "a failed ingest turns the tile red");
assert.strictEqual(tileStatus("funnel", { hasData: true }).level, "ok");

// ── Support: Needs a person, AI drafts to approve, Resolved & automation ──
// All three of the Support Inbox (support@) only, on its own queues.
const t = (id, o) => normaliseTicket(id, { subject: `Ticket ${id}`, customerName: `Customer ${id}`, createdAt: at(15, 8), lastMessageAt: at(16, 9), ...o });
const tickets = [
  // Needs a person: the wait runs from the customer's last email, not from a later note or event.
  t("1", { status: "open", needsHuman: true, lastInboundAt: at(17, 7, 30), lastMessageAt: at(17, 7, 30) }),
  t("2", { status: "open", needsHuman: true, lastInboundAt: at(16, 9, 30), lastMessageAt: at(17, 8) }),
  // AI drafts to approve.
  t("3", { status: "open", aiDraft: { text: "Hello", confidence: 0.62, answerable: true }, lastInboundAt: at(16, 20) }),
  t("15", { status: "open", aiDraft: { text: "Hi", confidence: 0.91, answerable: true }, lastInboundAt: at(17, 9) }),
  // Automated & not about PH: neither queue.
  t("7", { status: "open", automated: "noreply", lastMessageAt: at(17, 6) }),
  // Resolved yesterday: by the AI alone, by the AI after a person stepped in, by a person.
  t("4", { status: "resolved", resolvedAt: at(16, 8), resolvedBy: "ai" }),
  t("5", { status: "resolved", resolvedAt: at(16, 16), resolvedBy: "ai", humanInvolved: true }),
  t("6", { status: "resolved", resolvedAt: at(16, 17), resolvedBy: "ana@ph.example" }),
  t("10", { status: "resolved", resolvedAt: at(15, 17), resolvedBy: "ai" }),
  t("11", { status: "resolved", resolvedAt: at(17, 8), resolvedBy: "ai" }),
  // FAQ gaps in the last 30 days: a draft the Help Centre couldn't answer, or triage saying so.
  t("12", { status: "open", needsHuman: true, triageReason: "The help centre doesn't answer this.", createdAt: at(14, 9), lastInboundAt: at(14, 9) }),
  t("13", { status: "pending", aiDraft: { text: "Maybe", confidence: 0.3, answerable: false }, createdAt: at(16, 9) }),
  t("16", { status: "pending", triageReason: "The help centre doesn't answer this.", createdAt: at(1, 9) - 20 * 24 * 3600000 }),
  t("17", { status: "spam", triageReason: "The help centre doesn't answer this.", createdAt: at(16, 9) }),
  // Hello and Aidan are separate inboxes: never counted.
  t("8", { status: "open", needsHuman: true, inboxes: ["hello"], lastInboundAt: at(14, 9) }),
  t("9", { status: "resolved", resolvedAt: at(16, 9), resolvedBy: "ai", inboxes: ["aidan"] }),
  t("18", { status: "open", aiDraft: { text: "x", confidence: 0.99 }, inboxes: ["hello"] }),
  // Written to support@ and hello@ together: it is in the Support Inbox, so it counts.
  t("14", { status: "open", needsHuman: true, inboxes: ["support", "hello"], lastInboundAt: at(17, 9) }),
];
const np = needsPersonKpi(tickets, NOW);
assert.strictEqual(np.count, 4, "the Needs a person queue of the Support Inbox");
assert.strictEqual(np.count, queueCounts(tickets, "support")["needs-person"], "equals the queue count on the Support Inbox tab");
assert.deepStrictEqual(np.tickets.map((x) => x.id), ["12", "2", "1", "14"], "longest wait first");
assert.strictEqual(np.oldestMs, NOW - at(14, 9));
assert.strictEqual(np.tickets[1].customer, "Customer 2");
assert.strictEqual(tileStatus("person", np).level, "alert", "red when the oldest has waited a day");
assert.strictEqual(tileStatus("person", needsPersonKpi([tickets[0]], NOW)).level, "warn");
assert.deepStrictEqual(needsPersonKpi([], NOW), { count: 0, oldestMs: null, tickets: [] });
// Needs a person is support queries only (j7fSAp4aZO4HGd7iCR3G): an Aidan request whose
// reply came back to support@, and support@ mail that is not about PH, are not counted.
{
  const mixed = [
    t("q", { status: "open", needsHuman: true, inboxes: ["support"], lastInboundAt: at(17, 7) }),
    t("ai", { status: "open", needsHuman: true, inboxes: ["support", "aidan"], aidan: { status: "needs-person", reason: "No skill matches." }, lastInboundAt: at(16, 7) }),
    t("un", { status: "open", needsHuman: true, highValue: true, unrelated: true, inboxes: ["support"], lastInboundAt: at(16, 7) }),
    t("au", { status: "open", needsHuman: true, automated: "noreply", lastInboundAt: at(16, 7) }),
    t("sp", { status: "open", needsHuman: true, spamLikely: true, lastInboundAt: at(16, 7) }),
  ];
  const k = needsPersonKpi(mixed, NOW);
  assert.deepStrictEqual(k.tickets.map((x) => x.id), ["q"], "only the platform query to support@");
  assert.strictEqual(k.count, queueCounts(mixed, "support")["needs-person"], "still equals the Support Inbox tab's queue");
}
const dr = draftsKpi(tickets, NOW, "support");
assert.strictEqual(dr.count, queueCounts(tickets, "support")["ai-drafts"], "equals the AI drafts to approve queue count");
assert.deepStrictEqual(dr.drafts.map((d) => [d.id, d.confidence]), [["15", 0.91], ["3", 0.62]], "each draft with its confidence, most confident first");
assert.strictEqual(dr.high, 1);
assert.strictEqual(tileStatus("drafts", dr).level, "warn");
const rs = resolvedKpi(tickets, NOW, "support");
assert.deepStrictEqual([rs.value, rs.prev, rs.aiCount, rs.aiPct], [3, 1, 1, 33], "resolved yesterday: 4, 5 and 6; only 4 by the AI with no person");
assert.strictEqual(rs.trend.dir, "up");
assert.deepStrictEqual(rs.gaps.map((g) => g.id), ["13", "12"], "the Help Centre couldn't answer, last 30 days, newest first; spam and Hello left out");
assert.strictEqual(resolvedKpi([], NOW).aiPct, null, "nothing resolved: no share");
assert.strictEqual(tileStatus("resolved", rs).level, "ok");
// Inbox filter (ZCNIxvtORgZN0csAlO44): AI drafts to approve and Resolved & automation
// cover every inbox by default; an inbox key narrows them to that inbox.
{
  const all = draftsKpi(tickets, NOW);
  assert.strictEqual(all.inbox, "", "every inbox by default");
  assert.deepStrictEqual(all.drafts.map((d) => d.id), ["18", "15", "3"], "Hello's draft is listed with the Support Inbox's, most confident first");
  assert.deepStrictEqual(all.drafts[0].inboxes, ["hello"], "each draft names its inbox");
  assert.deepStrictEqual(all.drafts[1].inboxes, ["support"], "no inbox recorded: the Support Inbox");
  assert.strictEqual(all.allCount, 3);
  assert.deepStrictEqual(all.byInbox, { support: 2, hello: 1, aidan: 0 }, "the count on each filter choice");
  assert.deepStrictEqual(draftsKpi(tickets, NOW, "hello").drafts.map((d) => d.id), ["18"], "Hello only");
  const aidan = draftsKpi(tickets, NOW, "aidan");
  assert.deepStrictEqual([aidan.count, aidan.allCount, aidan.inbox], [0, 3, "aidan"], "Aidan has none; All still counts every inbox");
  assert.strictEqual(draftsKpi(tickets, NOW, "nowhere").inbox, "", "an unknown inbox is every inbox");
  const ra = resolvedKpi(tickets, NOW);
  assert.deepStrictEqual([ra.value, ra.prev, ra.aiCount, ra.aiPct], [4, 1, 2, 50], "every inbox: 4, 5, 6 and Aidan's 9; 4 and 9 by the AI alone");
  assert.deepStrictEqual([ra.allCount, ra.byInbox], [4, { support: 3, hello: 0, aidan: 1 }]);
  const rAidan = resolvedKpi(tickets, NOW, "aidan");
  assert.deepStrictEqual([rAidan.value, rAidan.prev, rAidan.aiPct, rAidan.gaps.length], [1, 0, 100, 0], "Aidan's figures only");
  assert.deepStrictEqual(resolvedKpi(tickets, NOW, "hello").gaps.map((g) => g.id), ["18"], "the FAQ gaps follow the filter: Hello's unanswerable draft");
  assert.deepStrictEqual(ra.gaps.map((g) => [g.id, g.inboxes]), [["13", ["support"]], ["18", ["hello"]], ["12", ["support"]]], "every inbox's gaps, each naming its inbox");
  // A ticket written to two addresses is in both inboxes' counts.
  const two = [t("x", { status: "open", aiDraft: { text: "x", confidence: 0.5 }, inboxes: ["support", "hello"] })];
  assert.deepStrictEqual([draftsKpi(two, NOW).allCount, draftsKpi(two, NOW).byInbox], [1, { support: 1, hello: 1, aidan: 0 }]);
}

// ── Dashboard v2 (GUI9xPe3CJY3LyMws88m): 7-day series, sparkline, trend, status ──
{
  const days = lastDays(7, NOW);
  assert.strictEqual(days.length, 7);
  assert.strictEqual(days[0].day, "2026-11-10", "the series starts 7 local days back");
  assert.strictEqual(days[6].day, "2026-11-16", "and ends yesterday, never today");
  assert.deepStrictEqual(dailyCounts([at(10, 1), at(16, 23, 59), at(16, 0, 1), at(17, 8), at(9, 12)], 7, NOW), [1, 0, 0, 0, 0, 0, 2], "counts per local day; today and older days are left out");
  assert.deepStrictEqual(deliveryKpi(items, projects, NOW).series, [0, 0, 0, 0, 0, 1, 3], "deployed per day, the last point is the headline");
  assert.strictEqual(sparklinePoints([1]), "", "one point draws nothing");
  const pts = sparklinePoints([0, 5, 10], 96, 28, 2).split(" ").map((p) => p.split(",").map(Number));
  assert.deepStrictEqual(pts, [[2, 26], [48, 14], [94, 2]], "the lowest value at the bottom, the highest at the top, inside the padding");
  assert.ok(sparklinePoints([3, 3, 3]).split(" ").every((p) => p.endsWith(",14")), "a flat series runs along the middle");
  assert.strictEqual(trendShort(trend(5, 3)), "+2");
  assert.strictEqual(trendShort(trend(1, 4)), "−3");
  assert.strictEqual(trendShort(trend(2, 2)), "0");
  // rowEnd: the last tile on a tile's row, from the count, never measured.
  assert.deepStrictEqual([0, 1, 2, 3, 4].map((i) => rowEnd(i, 3, 5)), [2, 2, 2, 4, 4], "three across: Agent, Kanban, Leads / Funnel, Support");
  assert.deepStrictEqual([0, 3, 4].map((i) => rowEnd(i, 4, 5)), [3, 3, 4], "four across, Support alone on row 2");
  assert.deepStrictEqual([0, 1, 2, 4].map((i) => rowEnd(i, 2, 5)), [1, 1, 3, 4], "two across on an iPad in portrait");
  assert.deepStrictEqual([0, 4].map((i) => rowEnd(i, 1, 5)), [0, 4], "one across on a phone");
  assert.strictEqual(rowEnd(1, 0, 5), 1, "an unreadable column count is one across");
  assert.strictEqual(rowEnd(0, 3, 0), -1, "no tiles, no row");
  // Three across with eight tiles (Internal 3, External 2, Support 3): full rows of three, two on the last.
  assert.deepStrictEqual([0, 3, 5, 6, 7].map((i) => rowEnd(i, 3, 8)), [2, 5, 5, 7, 7]);
  assert.deepStrictEqual([0, 4, 7].map((i) => rowEnd(i, 4, 8)), [3, 7, 7], "four across: two full rows");
  assert.strictEqual(tileStatus("delivery", deliveryKpi([], projects, NOW)).level, "ok", "a quiet day is not a fault");
  assert.strictEqual(tileStatus("funnel", { hasData: false }).level, "warn");
  const fs = funnelKpi([{ date: "2026-11-10", visits: 5 }, { date: "2026-11-15", visits: 7 }, { date: "2026-11-16", visits: 9, users: 8 }], [], NOW).series;
  assert.deepStrictEqual(fs, [5, 0, 0, 0, 0, 7, 8], "funnel visitors per day for the sparkline");
}

// ── Delivery: change against the previous period (7KcZdqFjytcmD9S85Fnq) ──
{
  const w1 = periodWindows(1, NOW), w7 = periodWindows(7, NOW);
  assert.deepStrictEqual([w1.cur.from, w1.cur.to, w1.prev.from], [new Date(2026, 10, 16).getTime(), new Date(2026, 10, 17).getTime(), new Date(2026, 10, 15).getTime()], "yesterday against the day before");
  assert.deepStrictEqual([w7.cur.from, w7.prev.from, w7.prev.to], [new Date(2026, 10, 10).getTime(), new Date(2026, 10, 3).getTime(), new Date(2026, 10, 10).getTime()], "the last 7 days against the 7 before");
  assert.strictEqual(deliveryRange("nonsense").key, "yesterday", "Yesterday is the default range");
  assert.deepStrictEqual(countChange(3, 2), { dir: "up", pct: 50, short: "+50%", text: "+50% vs the day before: 3 against 2" });
  assert.strictEqual(countChange(1, 4, "the 7 days before").short, "−75%");
  assert.strictEqual(countChange(1, 4).dir, "down");
  assert.deepStrictEqual([countChange(2, 0).dir, countChange(2, 0).short], ["up", "New"], "from none: New, never ∞%");
  assert.deepStrictEqual([countChange(0, 0).dir, countChange(0, 0).short], ["flat", "0%"]);
  assert.deepStrictEqual([passChange(60, 48).dir, passChange(60, 48).short], ["up", "+12 pp"], "pass rate changes in percentage points");
  assert.strictEqual(passChange(0, 50).short, "−50 pp", "a 0% rate is a rate");
  assert.deepStrictEqual([passChange(null, 50).dir, passChange(null, 50).short], ["none", "—"], "no deployments: nothing to compare");
  assert.strictEqual(passChange(50, null).dir, "none");

  const py = deliveryPeriod(items, projects, "yesterday", NOW);
  assert.deepStrictEqual([py.count, py.prevCount, py.countChange.short], [3, 1, "+200%"], "a, b and i yesterday; c the day before");
  assert.deepStrictEqual([py.firstPassPct, py.prevFirstPassPct, py.passChange.short], [33, 100, "−67 pp"], "first-time pass over each period's own tickets");
  assert.strictEqual(py.leadTimeMs, 3 * 24 * 3600000, "lead time over yesterday's tickets: 2, 4 and 3 days");
  assert.deepStrictEqual(py.projects.map((p) => [p.id, p.count, p.prevCount, p.countChange.short, p.firstPassPct, p.passChange.short]),
    [["p1", 2, 0, "New", 50, "—"], ["p2", 1, 1, "0%", 0, "−100 pp"]], "per project, most deployed first");
  assert.strictEqual(deliveryKpi(items, projects, NOW).period.range, "yesterday", "deliveryKpi carries the period, Yesterday by default");

  const pw = deliveryKpi(items, projects, NOW, "week").period;
  assert.deepStrictEqual([pw.metric, pw.count, pw.prevCount, pw.countChange.short], ["Deployed in the last 7 days", 4, 1, "+300%"], "a, b, c and i against j; today's d in neither");
  assert.deepStrictEqual([pw.firstPassPct, pw.prevFirstPassPct, pw.passChange.short, pw.passChange.dir], [50, 100, "−50 pp", "down"]);
  assert.deepStrictEqual(pw.projects.map((p) => [p.id, p.count, p.prevCount, p.countChange.short]), [["p1", 2, 1, "+100%"], ["p2", 2, 0, "New"]]);
  const quiet = deliveryPeriod([], projects, "week", NOW);
  assert.deepStrictEqual([quiet.count, quiet.countChange.dir, quiet.passChange.short, quiet.projects.length], [0, "flat", "—", 0], "a quiet fortnight");
}
console.log("dashboard.test.mjs: ok");
