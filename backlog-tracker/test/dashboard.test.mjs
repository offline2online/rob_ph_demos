// Dashboard (#dashboard): the KPI rules in public/js/dashboard-core.js.
// Days are the viewer's local days, so every instant here is built with the
// local Date constructor, never a UTC string.
import assert from "node:assert";
import { localDayRange, fmtEffort, trend, fmtWait, agentBoardKpi, kanbanKpi, dashboardRelease, leadsKpi, funnelKpi, supportKpi, isBuilding, isWebsiteLead } from "../public/js/dashboard-core.js";
import { normaliseTicket } from "../public/js/support-core.js";
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
assert.strictEqual(fmtWait(3 * 3600000 + 5 * 60000), "3h");
assert.strictEqual(fmtWait(50 * 3600000), "2d 2h");
assert.strictEqual(fmtWait(30000), "just now");

// ── Agent board ───────────────────────────────────────────────────────────
const projects = [{ id: "p1", name: "Backlog Tracker & FAQs" }, { id: "p2", name: "Display Types" }];
const items = [
  { id: "a", projectId: "p1", status: "published-live", mergedAt: { seconds: at(16, 14) / 1000 } },
  { id: "b", projectId: "p1", status: "published-live", mergedAt: new Date(at(16, 23, 59)).toISOString() },
  { id: "c", projectId: "p2", status: "published-live", mergedAt: at(15, 10) },
  { id: "d", projectId: "p2", status: "published-live", mergedAt: at(17, 8) },
  { id: "e", projectId: "p2", status: "ready-for-testing", lastFire: { status: "started", at: at(16, 9) } },
  { id: "f", projectId: "p1", status: "backlog", lastFire: { status: "started", at: at(17, 9) }, buildSession: { status: "running" } },
  { id: "g", projectId: "p1", status: "backlog", blocked: { reason: "waiting-on-input" } },
  { id: "h", projectId: "p1", status: "backlog", lastFire: { status: "started", at: at(16, 9) }, buildSession: { status: "done", finishedAt: at(16, 10) } },
  { id: "i", projectId: "p2", status: "archived", mergedAt: at(16, 9) },
];
const ab = agentBoardKpi(items, projects, NOW);
assert.strictEqual(ab.value, 3, "deployed yesterday: two live and one already archived");
assert.strictEqual(ab.prev, 1);
assert.strictEqual(ab.trend.dir, "up");
const p1 = ab.projects.find((p) => p.id === "p1");
const p2 = ab.projects.find((p) => p.id === "p2");
assert.deepStrictEqual({ ...p1, id: undefined }, { id: undefined, name: "Backlog Tracker & FAQs", deployed: 2, leftBacklog: 1, building: 1, testing: 0, blocked: 1 });
assert.deepStrictEqual({ ...p2, id: undefined }, { id: undefined, name: "Display Types", deployed: 1, leftBacklog: 1, building: 0, testing: 1, blocked: 0 });
assert.strictEqual(ab.projects[0].id, "p1", "the project that shipped most comes first");
assert.ok(isBuilding(items[5]) && !isBuilding(items[7]), "a reported build is no longer in build");
assert.deepStrictEqual(agentBoardKpi([], projects, NOW).projects, [], "a quiet day lists no project");

// ── Staff Kanban ──────────────────────────────────────────────────────────
const releases = [{ id: "r2", name: "1.6", order: 2 }, { id: "r1", name: "1.5", order: 1, released: true }, { id: "r3", name: "1.7", order: 3 }];
assert.strictEqual(dashboardRelease({ currentRelease: "r3" }, releases).id, "r3", "the release picked in Kanban settings");
assert.strictEqual(dashboardRelease({}, releases).id, "r2", "else the earliest release not yet live");
assert.strictEqual(dashboardRelease(null, [{ id: "x", released: true }]), null);
{
  // Order and version disagree: the tile follows Staff Kanban's own rule (version first).
  const mixed = [{ id: "a", name: "2.0.0", version: "2.0.0", order: 1 }, { id: "b", name: "1.9.0", version: "1.9.0", order: 2 }];
  assert.strictEqual(dashboardRelease({}, mixed).id, "b", "the earliest open release by version, not by order");
  assert.strictEqual(dashboardRelease({}, mixed).id, currentReleaseId({}, mixed), "the same release Staff Kanban treats as current");
  assert.strictEqual(dashboardRelease({ currentRelease: "a" }, mixed).name, "2.0.0", "a release picked in settings still wins");
  assert.deepStrictEqual(dashboardRelease({ currentRelease: "gone" }, mixed), { id: "gone", name: "gone" }, "a picked release not in the list still shows its id");
}
const tasks = [
  { key: "PH-1", release: "r2", status: "todo", assignee: "ana@ph.example", estimate: 16, logged: 4 },
  { key: "PH-2", release: "r2", status: "in-progress", assignee: "ana@ph.example", estimate: 8 },
  { key: "PH-3", release: "r2", status: "todo", assignee: "ben@ph.example", title: "Write the help text" },
  { key: "PH-4", release: "r2", status: "todo", assignee: "", estimate: 4 },
  { key: "PH-5", release: "r2", status: "done", assignee: "ben@ph.example", estimate: 40 },
  { key: "PH-6", release: "r2", type: "epic", status: "todo", estimate: 100 },
  { key: "PH-7", release: "r9", status: "todo", estimate: 100 },
];
const names = { "ana@ph.example": "Ana", "ben@ph.example": "Ben" };
const kb = kanbanKpi({ id: "r2", name: "1.6" }, tasks, (e) => names[e]);
assert.strictEqual(kb.hours, 24, "remaining = estimate − logged on outstanding tasks; done and epics left out");
assert.strictEqual(kb.effort, "24h (3d)");
assert.strictEqual(kb.outstanding, 4);
assert.strictEqual(kb.unestimated, 1, "PH-3 has no estimate");
assert.deepStrictEqual(kb.people.map((p) => [p.name, p.hours, p.tasks]), [["Ana", 20, 2], ["Unassigned", 4, 1], ["Ben", 0, 1]]);
assert.deepStrictEqual(kb.people.find((p) => p.name === "Ben").unestimated, [{ key: "PH-3", title: "Write the help text" }]);

// ── Leads ─────────────────────────────────────────────────────────────────
const leads = [
  { id: "1", company: { name: "Burger Co" }, createdAt: at(16, 9), source: "Website form" },
  { id: "2", leadType: "operator", contacts: [{ name: "Sam Jones" }], createdAt: at(16, 18), sourcePage: "/run-your-own-rmn/" },
  { id: "3", company: { name: "Grocer Ltd" }, createdAt: at(16, 11), source: "Manual" },
  { id: "4", company: { name: "Test Co" }, createdAt: at(16, 11), test: true },
  { id: "5", company: { name: "Gone Ltd" }, createdAt: at(16, 11), archivedAt: at(16, 12) },
  { id: "6", company: { name: "Old Co" }, createdAt: at(15, 11) },
];
const lk = leadsKpi(leads, NOW);
assert.strictEqual(lk.value, 3, "test and archived leads are not counted");
assert.strictEqual(lk.prev, 1);
assert.deepStrictEqual(lk.companies, ["Burger Co", "Grocer Ltd"]);
assert.deepStrictEqual(lk.operators, ["Sam Jones"]);
assert.ok(isWebsiteLead(leads[0]) && isWebsiteLead(leads[1]) && !isWebsiteLead(leads[2]));

// ── Conversion funnel ─────────────────────────────────────────────────────
const rows = [
  { date: "2026-11-16", visits: 400, industry: "", demoRequests: 0, downloads: 0 },
  { date: "2026-11-16", visits: 120, industry: "Grocery", demoRequests: 3, downloads: 2 },
  { date: "2026-11-16", visits: 80, industry: "QSR", demoRequests: 1, downloads: 4 },
  { date: "2026-11-16", visits: 90, industry: "Grocery", demoRequests: 0, downloads: 0 },
  { date: "2026-11-15", visits: 500, industry: "" },
];
const fk = funnelKpi(rows, leads, NOW);
assert.strictEqual(fk.value, 690);
assert.strictEqual(fk.prev, 500);
assert.deepStrictEqual(fk.steps.map((s) => [s.label, s.count, s.dropOff, s.dropOffPct]), [
  ["Unique visitors", 690, null, null],
  ["Industry page", 290, 400, 58],
  ["Walkthrough or calculator", 10, 280, 97],
  ["Lead", 2, 8, 80],
]);
assert.deepStrictEqual(fk.industries, [{ name: "Grocery", count: 210 }, { name: "QSR", count: 80 }], "industries ranked by visitors, peak first");
assert.strictEqual(funnelKpi([{ date: "2026-11-16", visits: 10, users: 7 }], [], NOW).value, 7, "GA4's user count wins when the ingest sends one");
assert.strictEqual(funnelKpi([], [], NOW).hasData, false);

// ── Support ───────────────────────────────────────────────────────────────
const t = (id, o) => normaliseTicket(id, { subject: `Ticket ${id}`, customerName: `Customer ${id}`, createdAt: at(15, 8), lastMessageAt: at(16, 9), ...o });
const tickets = [
  t("1", { status: "open", needsHuman: true, lastMessageAt: at(17, 7, 30) }),
  t("2", { status: "open", needsHuman: true, lastMessageAt: at(16, 9, 30) }),
  t("3", { status: "open", aiDraft: { text: "Hello", confidence: 0.9 } }),
  t("4", { status: "resolved", resolvedAt: at(16, 15) }),
  t("5", { status: "resolved", resolvedAt: at(16, 16) }),
  t("6", { status: "resolved", resolvedAt: at(15, 16) }),
  t("7", { status: "open" }),
  // Hello and Aidan are separate inboxes: the Dashboard counts the Support Inbox only.
  t("8", { status: "open", needsHuman: true, inboxes: ["hello"], lastMessageAt: at(14, 9) }),
  t("9", { status: "resolved", resolvedAt: at(16, 12), inboxes: ["aidan"] }),
];
const sk = supportKpi(tickets, NOW);
assert.deepStrictEqual(sk.needsPerson.map((w) => w.id), ["2", "1"], "longest-waiting first");
assert.strictEqual(fmtWait(sk.needsPerson[1].waitedMs), "2h");
assert.strictEqual(sk.needsPerson[0].customer, "Customer 2");
assert.deepStrictEqual(sk.aiDrafts.map((w) => w.id), ["3"]);
assert.strictEqual(sk.resolved, 2);
assert.strictEqual(sk.prevResolved, 1);
assert.strictEqual(sk.trend.dir, "up");

console.log("dashboard.test.mjs: ok");
