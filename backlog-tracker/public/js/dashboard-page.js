// Dashboard (#dashboard): the page the console opens on. Eight KPI tiles in
// three sections (cMyA3FMlUUrSjGtPkLZC): Internal (Delivery, Flow & blockers,
// Staff Kanban), External (Leads, Conversion funnel) and Support (Needs a
// person, AI drafts to approve, Resolved & automation). Each is a headline
// figure in the viewer's local time, with a sparkline where it has a daily
// history, a trend arrow and a status colour. The rules live in
// dashboard-core.js; this file reads the data and draws the tiles.
//
// Every count is a drill-down (uAp6fukjDyNxKusotmcQ): a count on a tile or in
// its panel opens the list behind it (dashboard-core.js drillRows /
// kanbanDrillHash) instead of toggling the panel; the click is taken before the
// tile's own. Staff Kanban and the Needs a person queue open filtered; the other
// counts open the Dashboard's list view (#dashboard?list=…), whose rows open
// each ticket. Clicking anywhere else on a tile still only pins its panel.
//
// Dashboard v2 (GUI9xPe3CJY3LyMws88m): a tile never navigates. Clicking or
// tapping it pins its summary panel open, inline and full width directly
// under the tile's row, until it is closed or another tile is chosen; the
// panel's "Open section" goes to the section. The tiles of every section flow
// through one grid, four across on a wide desktop, three on a laptop, two on
// an iPad in portrait and one on a phone (styles.css, .dash-groups), so a row
// is always full while tiles remain; each section's heading sits above its
// first tile. Needs attention sits below the tiles.
//
// Delivery and Flow & blockers use the tickets app.js already holds. The
// other sources (Staff Kanban, leads, funnelDaily, the Support Inbox) are read
// once when the page opens (and again on Refresh, or when the page is reopened
// after five minutes): no listeners, so a page nobody is looking at costs
// nothing. A tile the viewer's role cannot open is not shown; a section with
// no tile left is not shown either.

import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { deliveryKpi, DELIVERY_RANGES, deliveryRange, flowKpi, kanbanKpi, leadsKpi, funnelKpi, needsPersonKpi, draftsKpi, resolvedKpi, dashboardRelease, localDayRange, lastDays, sparklinePoints, trendShort, tileStatus, rowEnd, SERIES_DAYS, fmtCount, fmtEffort, fmtWait, fmtSpan, fmtDayLabel, drillHash, parseDrill, drillRows, kanbanDrillHash } from "./dashboard-core.js";
import { ingestStatusView, ingestFailureText, fmtUpdated } from "./funnel-core.js";
import { normaliseTicket, confidenceBand, pct as confPct, INBOXES, inboxOf, supportHash } from "./support-core.js";

const STALE_MS = 5 * 60 * 1000;
const SUPPORT_LIMIT = 300;
const SUPPORT_TIP_ROWS = 10;
// The list the Flow & blockers panel's retested tickets open (app.js, Testing loops page).
export const RETESTED_LIST = "#testing-loops?view=retested";
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// key: tile id; src: the source it reads ("items" are the tickets app.js
// already holds); section: permission section (permissions.js); target: where
// the panel's "Open section" goes (the tile itself never navigates); info: the
// tile's info tooltip, which is all the explanation a tile carries.
export const TILES = [
  { key: "delivery", group: "internal", src: "items", section: "agent-board", title: "Delivery", icon: "rocket_launch", target: "#board",
    info: "Tickets deployed in the range chosen in its summary panel, Yesterday (your local day) or the last 7 days, against the previous period of the same length; the line shows the last 7 days. First-time pass is the share of those tickets that passed testing without being sent back, its change in percentage points; lead time is the average from Backlog to Live." },
  { key: "flow", group: "internal", src: "items", section: "agent-board", title: "Flow & blockers", icon: "pending_actions", target: "#board",
    info: "Tickets stuck now: blocked, sent back with Failed testing and not rebuilding yet, or waiting in Ready for Testing for more than 24 hours. Amber when one is stuck, red at three or more. Retested counts the tickets not archived that were sent back from testing at least once; the panel shows how many times each and opens their list." },
  { key: "kanban", group: "internal", src: "kanban", section: "staff-kanban", title: "Staff Kanban", icon: "view_kanban", target: "#staff-kanban",
    info: "Open tasks in the current release (the one picked in Kanban settings, else the earliest release not yet live), by column, with the release's progress. With no release, or none of its tasks open, it counts all open work. Amber when a task is overdue, unassigned, unestimated or waiting on you in Testing." },
  { key: "leads", group: "external", src: "leads", section: "promote-leads", title: "Leads", icon: "group", target: "#promote/leads",
    info: "New leads in the last 7 days, test and archived leads left out, against the 7 days before, with yesterday's count. The pipeline shows companies at each stage now and the share that got there from the stage before. Amber when a lead has had no activity for 7 days or has not been contacted." },
  { key: "funnel", group: "external", src: "funnel", section: "conversion-funnel", title: "Conversion funnel", icon: "filter_alt", target: "#promote/conversion-funnel",
    info: "Unique website visitors over the last 7 days, against the 7 days before, and the share who became a lead. The mini funnel marks the biggest drop-off in amber. Top movers are the industry and market whose interest grew most on the week before. Amber when yesterday's website figures have not arrived yet." },
  { key: "person", group: "support", src: "support", section: "support-inbox", title: "Needs a person", icon: "support_agent", target: "#support",
    info: "Support Inbox tickets in the Needs a person queue now, and how long the oldest has waited. Only questions about the platform or Personalisation Hub sent to support@ count: mail to other addresses, requests to Aidan and mail not about Personalisation Hub are not counted. Amber when one waits, red when the oldest has waited over a day." },
  { key: "drafts", group: "support", src: "support", section: "support-inbox", title: "AI drafts to approve", icon: "auto_awesome", target: "#support?queue=ai-drafts",
    info: "Replies the AI has drafted that wait for a person to approve them, in every inbox (Support Inbox, Hello and Aidan), and how many are high confidence (80% or more). The filter in the summary narrows the tile to one inbox; the choice is kept until the page is reloaded." },
  { key: "resolved", group: "support", src: "support", section: "support-inbox", title: "Resolved & automation", icon: "task_alt", target: "#support?queue=resolved",
    info: "Tickets resolved yesterday (your local day) in every inbox (Support Inbox, Hello and Aidan), against the day before, and the share the AI resolved with no person involved. The panel lists FAQ gaps: questions from the last 30 days the Help Centre couldn't answer. The filter in the summary narrows the tile to one inbox; the choice is kept until the page is reloaded." },
];
export const GROUPS = [
  { key: "internal", label: "Internal" },
  { key: "external", label: "External" },
  { key: "support", label: "Support" },
];

// ctx: { root, db, items(), projects(), releases(), canView(section), go(hash), me?(), now?(), attention?, openItem?(id), hash?() }
// openItem(id): opens an Agent board ticket (a list row); hash(): the address now.
// me(): the viewer's email, so Staff Kanban can flag Testing tasks waiting on them.
// attention: the Needs attention strip (app.js draws and wires it). It is kept
// as the same element, placed below the tile sections, in normal flow, so it
// never covers or holds back the tiles.
export function mountDashboard(ctx) {
  const root = ctx.root;
  const attention = ctx.attention || null;
  const now = () => (ctx.now ? ctx.now() : Date.now());
  // Per source: { status: "idle" | "loading" | "ok" | "error", data, error }
  const src = { kanban: { status: "idle" }, leads: { status: "idle" }, funnel: { status: "idle" }, support: { status: "idle" } };
  let loadedAt = 0;
  let members = null;
  // Per tile key: the parts render() last wrote ({ inner, busy, tip }). Compared
  // with the new ones, not with the DOM's serialisation, which can differ.
  let lastParts = new Map();
  // The tile whose summary panel is pinned open (null when none). Kept across
  // redraws, so a board update never closes it.
  let pinned = null;
  let lastPanel = { key: null, body: null };
  // The Delivery range (Yesterday or Last 7 days), remembered per viewer.
  let deliveryRangeKey = "yesterday";
  try { deliveryRangeKey = deliveryRange(localStorage.getItem("bt-dash-delivery-range")).key; } catch { /* storage blocked */ }
  // The inbox filter of each Support tile that has one (ZCNIxvtORgZN0csAlO44):
  // "" is every inbox. Kept while the page is open (closing the panel keeps
  // it), never saved, so a reload starts on All inboxes again.
  const inboxFilter = { drafts: "", resolved: "" };

  root.innerHTML = `
    <div class="page-header dash-header">
      <h2>Dashboard</h2>
      <span class="dash-day" id="dash-day"></span>
      <button type="button" class="btn-outline dash-refresh" id="dash-refresh"><span class="material-symbols-outlined" aria-hidden="true">refresh</span>Refresh</button>
    </div>
    <div class="dash-groups" id="dash-groups"></div>
    <section class="dash-list" id="dash-list" aria-labelledby="dash-list-title" hidden></section>`;
  if (attention) root.querySelector("#dash-groups").after(attention);
  // One summary panel, moved to sit under the pinned tile's row (placePanel).
  const panel = document.createElement("div");
  panel.className = "dash-panel";
  panel.id = "dash-panel";
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-labelledby", "dash-panel-title");
  panel.hidden = true;
  panel.innerHTML = `<div class="dash-panel-head"><span class="dash-tile-icon dash-panel-icon"></span><h3 class="dash-panel-title" id="dash-panel-title"></h3>`
    + `<button type="button" class="dash-panel-open">Open section<span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span></button>`
    + `<button type="button" class="dash-panel-close" aria-label="Close summary"><span class="material-symbols-outlined" aria-hidden="true">close</span></button></div>`
    + `<div class="dash-panel-body"></div>`;
  root.querySelector("#dash-refresh").addEventListener("click", () => refresh(true));
  root.addEventListener("click", (e) => {
    if (!root.contains(e.target)) return;
    // A count: open its list. Taken before the tile's own click, so a count
    // inside a tile never toggles or closes the panel.
    // (The panel's "Open list" buttons, .dash-tip-open[data-go], go the same way.)
    const goEl = e.target.closest("[data-go]");
    if (goEl && root.contains(goEl)) {
      if (goEl.tagName === "A" && (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1)) return; // a new tab
      e.preventDefault(); e.stopPropagation(); closeInfos(); ctx.go(goEl.dataset.go); return;
    }
    const itemEl = e.target.closest("[data-open-item]");
    if (itemEl) { e.preventDefault(); if (ctx.openItem) ctx.openItem(itemEl.dataset.openItem); return; }
    const info = e.target.closest(".dash-info");
    if (info) { toggleInfo(info.closest(".dash-tile-wrap")); return; }
    closeInfos();
    if (e.target.closest(".dash-panel-close")) { unpin(true); return; }
    const rangeBtn = e.target.closest("[data-delivery-range]");
    if (rangeBtn) { setDeliveryRange(rangeBtn.dataset.deliveryRange); return; }
    const pick = e.target.closest("[data-dash-inbox]");
    if (pick && pinned in inboxFilter) {
      const key = pick.dataset.dashInbox;
      inboxFilter[pinned] = key;
      render();
      // The panel's body was rewritten: keep focus on the choice just made.
      panel.querySelector(`[data-dash-inbox="${key}"]`)?.focus();
      return;
    }
    const open = e.target.closest(".dash-panel-open");
    if (open) { const t = TILES.find((x) => x.key === pinned); if (t) ctx.go(targetOf(t)); return; }
    const tile = e.target.closest(".dash-tile");
    if (tile) { const key = tile.closest(".dash-tile-wrap").dataset.tile; if (pinned === key) unpin(false); else pin(key); }
  });
  root.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (root.querySelector(".dash-tile-wrap.info-open")) { closeInfos(); return; }
    if (pinned && (panel.contains(e.target) || e.target.closest?.(".dash-tile"))) { e.preventDefault(); unpin(true); }
  });
  // Re-place the panel when the row breaks change (a resize or a rotation).
  let placeQueued = false;
  const queuePlace = () => { if (placeQueued) return; placeQueued = true; requestAnimationFrame(() => { placeQueued = false; placePanel(); }); };
  window.addEventListener("resize", queuePlace);

  // Switch the Delivery range: the tile and its panel follow, and the focus
  // stays on the chosen option, which the redraw replaces.
  function setDeliveryRange(key) {
    const next = deliveryRange(key).key;
    if (next === deliveryRangeKey) return;
    deliveryRangeKey = next;
    try { localStorage.setItem("bt-dash-delivery-range", next); } catch { /* storage blocked */ }
    render();
    const btn = panel.querySelector(`[data-delivery-range="${next}"]`);
    if (btn) btn.focus();
  }

  // Open section: a filtered Support tile opens that inbox's tab (Hello and
  // Aidan have no queues); All inboxes and Support Inbox open the queue.
  const targetOf = (t) => {
    const key = inboxFilter[t.key];
    return key && key !== "support" ? supportHash({ inbox: key }) : t.target;
  };
  const allowed = (t) => { try { return !!ctx.canView(t.section); } catch { return false; } };

  async function nameMap() {
    if (members) return members;
    try {
      const snap = await getDocs(collection(ctx.db, "memberDirectory"));
      members = new Map(snap.docs.map((d) => {
        const m = d.data() || {};
        const email = String(m.email || d.id).toLowerCase();
        const name = String(m.displayName || "").trim() || [m.firstName, m.lastName].filter(Boolean).join(" ").trim() || email.split("@")[0];
        return [email, name];
      }));
    } catch { members = new Map(); }
    return members;
  }

  async function load(key, fn) {
    src[key] = { status: "loading", data: src[key].data };
    render();
    try { src[key] = { status: "ok", data: await fn() }; }
    catch (err) { src[key] = { status: "error", error: String((err && err.message) || err) }; }
    render();
  }
  const readers = {
    async kanban() {
      const settings = await getDoc(doc(ctx.db, "kanbanSettings", "main")).then((s) => (s.exists() ? s.data() : null)).catch(() => null);
      const release = dashboardRelease(settings, ctx.releases());
      const read = (q) => getDocs(q).then((snap) => snap.docs.map((d) => ({ key: d.id, ...d.data() })));
      // Every open task (Staff Kanban's own "open" query), and the release's
      // tasks, done ones included, for its progress. The light cards can lag
      // the tickets until the server's backfill runs: then read the tickets.
      const both = (name) => Promise.all([
        read(query(collection(ctx.db, name), where("open", "==", true))),
        release ? read(query(collection(ctx.db, name), where("release", "==", release.id))) : Promise.resolve([]),
      ]);
      let [open, releaseTasks] = await both("kanbanCards");
      if (!open.length && !releaseTasks.length) [open, releaseTasks] = await both("kanbanTasks");
      return { release, open, releaseTasks, names: await nameMap() };
    },
    async leads() {
      const snap = await getDocs(collection(ctx.db, "leads"));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
    async funnel() {
      // The last 14 days: this week and the week before, for the change.
      const days = lastDays(SERIES_DAYS * 2, now()).map((r) => r.day);
      const snaps = await Promise.all(days.map((day) => getDocs(query(collection(ctx.db, "funnelDaily"), where("date", "==", day)))));
      const rows = snaps.flatMap((s) => s.docs.map((d) => ({ id: d.id, ...d.data() })));
      // When the ingest last updated the data, and which source failed (funnel-ingest.js).
      const ingest = await getDoc(doc(ctx.db, "consoleConfig", "funnelIngest")).then((s) => (s.exists() ? s.data() : null)).catch(() => null);
      // The funnel's last step is the website's leads; the Leads tile may not be visible.
      const leads = src.leads.status === "ok" ? src.leads.data : await readers.leads().catch(() => []);
      return { rows, leads, ingest };
    },
    async support() {
      const snap = await getDocs(query(collection(ctx.db, "supportTickets"), orderBy("lastMessageAt", "desc"), limit(SUPPORT_LIMIT)));
      return snap.docs.map((d) => normaliseTicket(d.id, d.data()));
    },
  };

  // Read every visible tile's source; `force` reads again even if fresh.
  function refresh(force = false) {
    if (!force && loadedAt && now() - loadedAt < STALE_MS) { render(); return; }
    loadedAt = now();
    const visible = new Set(TILES.filter(allowed).map((t) => t.src));
    const jobs = [];
    if (visible.has("leads") || visible.has("funnel")) jobs.push(load("leads", readers.leads));
    if (visible.has("kanban")) jobs.push(load("kanban", readers.kanban));
    if (visible.has("support")) jobs.push(load("support", readers.support));
    if (visible.has("funnel")) jobs.push(Promise.all(jobs.slice(0, 1)).then(() => load("funnel", readers.funnel)));
    render();
    return Promise.all(jobs);
  }

  // ── Rendering ──────────────────────────────────────────────────────────
  const icon = (name) => `<span class="material-symbols-outlined" aria-hidden="true">${name}</span>`;
  // Compact trend: an arrow and the change, the full sentence for screen readers and on hover.
  const trendHtml = (tr) => {
    const name = tr.dir === "up" ? "arrow_upward" : tr.dir === "down" ? "arrow_downward" : "remove";
    return `<span class="dash-trend dash-trend-${tr.dir}" title="${esc(tr.text)}">${icon(name)}<span aria-hidden="true">${esc(trendShort(tr))}</span><span class="visually-hidden">${esc(tr.text)}</span></span>`;
  };
  // The last 7 days ending yesterday, as a line; the last point is yesterday.
  const sparkHtml = (series) => {
    const pts = sparklinePoints(series, 96, 28);
    if (!pts) return "";
    return `<svg class="dash-spark" viewBox="0 0 96 28" preserveAspectRatio="none" aria-hidden="true" focusable="false">`
      + `<polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
  };
  const seriesText = (series) => {
    if (!series || series.length < 2) return "";
    const days = lastDays(SERIES_DAYS, now()).map((r) => fmtDayLabel(r.from));
    return `Last ${series.length} days: ${series.map((v, i) => `${days[i] || ""} ${fmtCount(v)}`).join(", ")}`;
  };
  // A change against the previous period (countChange / passChange in
  // dashboard-core.js): an arrow and "+50%", "New" or "+12 pp", green when it
  // went up, red when down; the full sentence for screen readers and on hover.
  const changeHtml = (ch) => {
    const name = ch.dir === "up" ? "arrow_upward" : ch.dir === "down" ? "arrow_downward" : "remove";
    const cls = ch.dir === "none" ? "flat" : ch.dir;
    return `<span class="dash-trend dash-trend-${cls} dash-change" data-dir="${ch.dir}" title="${esc(ch.text)}">${ch.dir === "none" ? "" : icon(name)}<span aria-hidden="true">${esc(ch.short)}</span><span class="visually-hidden">${esc(ch.text)}</span></span>`;
  };
  const tipList = (rows, empty) => (rows.length ? `<ul class="dash-tip-list">${rows.join("")}</ul>` : `<p class="dash-tip-empty">${esc(empty)}</p>`);
  const pending = (s) => s.status === "idle" || (s.status === "loading" && !s.data);

  // A count that opens its list. In a tile it is a span (the tile is a button,
  // which can't hold a link; data-touch-tap makes the iPad tap it, not the tile);
  // in the panel it is a link, so a keyboard reaches it too.
  const goSpan = (hash, html, label) => `<span class="dash-go" data-go="${esc(hash)}" data-touch-tap title="${esc(label || "Open the list")}">${html}</span>`;
  const goLink = (hash, html, label) => `<a class="dash-go" href="${esc(hash)}" data-go="${esc(hash)}"${label ? ` title="${esc(label)}"` : ""}>${html}</a>`;
  function tileBody(t) {
    const n = now();
    const count = (x, one, many = `${one}s`) => `${fmtCount(x)} ${x === 1 ? one : many}`;
    const pct = (p) => (p == null ? "—" : `${p}%`);
    if (t.key === "delivery") {
      const k = deliveryKpi(ctx.items(), ctx.projects(), n, deliveryRangeKey);
      const per = k.period;
      // Each count opens its tickets (uAp6fukjDyNxKusotmcQ), for the range shown.
      const dlist = per.range === "week" ? "delivery-week" : "delivery-yesterday";
      const when = per.range === "week" ? "in the last 7 days" : "yesterday";
      const switcher = `<div class="seg dash-range" role="group" aria-label="Delivery range">${DELIVERY_RANGES.map((r) => {
        const on = r.key === per.range;
        return `<button type="button" data-delivery-range="${r.key}" aria-pressed="${on}"${on ? ' class="active"' : ""}>${esc(r.label)}</button>`;
      }).join("")}</div>`;
      const rows = per.projects.map((p) => `<li data-project="${esc(p.id)}"><strong>${esc(p.name)}</strong><span class="dash-tip-grid dash-delivery-grid">`
        + `<span>Tickets</span><b>${goLink(drillHash(dlist, { project: p.id }), fmtCount(p.count), `${p.name}: deployed ${when}`)}</b>${changeHtml(p.countChange)}`
        + `<span>First-time pass</span><b>${pct(p.firstPassPct)}</b>${changeHtml(p.passChange)}`
        + `<span>Lead time</span><b>${esc(fmtSpan(p.leadTimeMs))}</b><span></span></span></li>`);
      return {
        metric: per.metric, value: fmtCount(per.count), go: drillHash(dlist), change: per.countChange, series: k.series, status: tileStatus("delivery", k),
        extra: `<span class="dash-sub">First-time pass <b>${pct(per.firstPassPct)}</b> ${changeHtml(per.passChange)}</span><span class="dash-sub">Lead time <b>${esc(fmtSpan(per.leadTimeMs))}</b></span>`,
        tip: `<div class="dash-tip-wide">${switcher}</div><p class="dash-tip-title">By project · ${goLink(drillHash(dlist), count(per.count, "ticket"))} deployed ${when}, against ${esc(per.than)}</p>${tipList(rows, `Nothing deployed ${when} or in ${per.than}.`)}`,
      };
    }
    if (t.key === "flow") {
      const k = flowKpi(ctx.items(), ctx.projects(), n);
      const parts = [[k.blocked, "blocked", "blocked"], [k.failed, "failed testing", "failed"], [k.testing, "waiting to test", "testing"]].filter(([x]) => x).map(([x, l, kind]) => `<span class="dash-sub">${goSpan(drillHash("flow-stuck", { kind }), `${x} ${l}`)}</span>`).join("");
      const rows = k.stuck.map((s) => `<li><span class="dash-tip-row"><strong>${itemLink(s.id, s.title)}</strong><b>${esc(s.waitedMs == null ? "—" : fmtWait(s.waitedMs))}</b></span>`
        + `<span class="dash-tip-meta">${esc(s.project)} · ${esc(s.reason)}</span></li>`);
      // Retested tickets (0I93kb0fqXL4Qr4qyzwv): beside the stuck count, and
      // listed in the panel with how many times each went back; "Open list"
      // opens the same tickets as the Testing loops page's Retested view.
      const retestRows = k.retested.map((r) => `<li><span class="dash-tip-row"><strong>${itemLink(r.id, r.title)}</strong><b>Retested ${r.times === 1 ? "once" : `${fmtCount(r.times)} times`}</b></span>`
        + `<span class="dash-tip-meta">${esc(r.project)} · Round ${fmtCount(r.round)}</span></li>`);
      const retestSub = `<span class="dash-sub">${goSpan(RETESTED_LIST, `${icon("replay")}<b>${fmtCount(k.retestedCount)}</b> retested`, "Tickets that went back through retesting")}</span>`;
      return {
        metric: "Tickets stuck", value: fmtCount(k.value), go: drillHash("flow-stuck"), status: tileStatus("flow", k), extra: (parts || `<span class="dash-sub">Nothing stuck</span>`) + retestSub,
        tip: `<p class="dash-tip-title">${goLink(drillHash("flow-stuck"), `Stuck now (${k.value})`)}, longest wait first</p>${tipList(rows, "Nothing is blocked, failed or waiting over a day to be tested.")}`
          + `<div class="dash-tip-head"><p class="dash-tip-title">${goLink(RETESTED_LIST, `Went back through retesting (${fmtCount(k.retestedCount)})`)}, most retested first</p>`
          + `<button type="button" class="dash-tip-open" data-go="${RETESTED_LIST}">Open list${icon("arrow_forward")}</button></div>`
          + tipList(retestRows, "No ticket has been sent back from testing."),
      };
    }
    if (t.key === "kanban") {
      const s = src.kanban;
      if (pending(s)) return loadingBody("Open tasks");
      if (s.status === "error") return errorBody("Open tasks", s.error);
      const nameOf = (e) => (s.data.names && s.data.names.get(String(e).toLowerCase())) || String(e).split("@")[0];
      const k = kanbanKpi({ release: s.data.release, open: s.data.open, releaseTasks: s.data.releaseTasks, projects: ctx.projects(), me: ctx.me ? ctx.me() : "", now: n }, nameOf);
      const f = k.flags;
      // The board filtered to the tile's own scope: its release, else all open work.
      const kb = (o) => kanbanDrillHash({ ...o, release: k.allWork || !k.release ? "" : k.release.id });
      const flags = [[f.overdue, "overdue", "overdue"], [f.unassigned, "unassigned", "unassigned"], [f.unestimated, "unestimated", "unestimated"], [f.waitingOnMe, "waiting on you", "waiting"]]
        .filter(([x]) => x).map(([x, l, show]) => `<span class="dash-flag">${goSpan(kb({ show }), `${icon("warning")}${x} ${l}`)}</span>`).join("");
      const rows = k.people.map((p) => `<li><span class="dash-tip-row"><strong>${esc(p.name)}</strong><b>${esc(fmtEffort(p.hours))}</b></span>`
        + `<span class="dash-tip-meta">${goLink(kb({ show: "open", assignee: p.id || "none" }), count(p.tasks, "task"), `${p.name}: open tasks`)} open${p.overdue ? ` · ${goLink(kb({ show: "overdue", assignee: p.id || "none" }), `${p.overdue} overdue`, `${p.name}: overdue tasks`)}` : ""}</span>`
        + (p.unestimated.length ? `<span class="dash-tip-warn">No estimate: ${p.unestimated.map((u) => (u.key ? goLink(`#staff-kanban/ticket/${encodeURIComponent(u.key)}`, esc(`${u.key}${u.title ? ` ${u.title}` : ""}`)) : esc(u.title))).join(", ")}</span>` : "")
        + `</li>`);
      return {
        metric: "Open tasks", value: fmtCount(k.value), go: kb({ show: "open" }), status: tileStatus("kanban", k),
        mini: `<span class="dash-cols">${k.columns.map((c) => goSpan(kb({ show: "open", column: c.key }), `<b>${fmtCount(c.count)}</b><span>${esc(c.label)}</span>`, `${c.label}: open tasks`).replace('class="dash-go"', 'class="dash-go dash-col"')).join("")}</span>`,
        extra: `<span class="dash-sub">${esc(k.scopeLabel)}${k.progress ? ` · <b>${k.progress.pct}%</b> done` : ""}</span>${flags}`,
        tip: `<p class="dash-tip-title">Workload by person · ${esc(k.scopeLabel)}${k.progress ? ` · ${k.progress.done} of ${k.progress.total} done (${k.progress.pct}%)` : ""} · ${esc(k.effort)} left</p>${tipList(rows, "No open tasks.")}`,
      };
    }
    if (t.key === "leads") {
      const s = src.leads;
      if (pending(s)) return loadingBody("New leads, 7 days");
      if (s.status === "error") return errorBody("New leads, 7 days", s.error);
      const k = leadsKpi(s.data, n);
      const a = k.needsAction;
      const names = (list) => (list.length ? `<ul class="dash-tip-names">${list.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p class="dash-tip-empty">None</p>`);
      const group = (title, by, list) => `<div class="dash-tip-col"><p class="dash-tip-title">${esc(title)}</p>${tipList(list.map((g) => `<li><span class="dash-tip-row"><strong>${esc(g.name)}</strong><b>${goLink(drillHash("leads-new", { by, group: g.name }), g.count, `New leads: ${g.name}`)}</b></span><span class="dash-tip-meta">${esc(g.leads.join(", "))}</span></li>`), "No new leads.")}</div>`;
      const flags = [[a.stale.length, "stale", "leads-stale"], [a.notContacted.length, "not contacted", "leads-not-contacted"]].filter(([x]) => x).map(([x, l, list]) => `<span class="dash-flag">${goSpan(drillHash(list), `${icon("warning")}${x} ${l}`)}</span>`).join("");
      return {
        metric: "New leads, 7 days", value: fmtCount(k.value), go: drillHash("leads-new"), trend: k.trend, series: k.series, status: tileStatus("leads", k),
        mini: pipelineHtml(k.pipeline),
        extra: `<span class="dash-sub">${goSpan(drillHash("leads-yesterday"), `Yesterday <b>${fmtCount(k.yesterday)}</b>`)}</span>${flags}`,
        tip: group("By source", "source", k.bySource) + group("By industry", "industry", k.byIndustry) + group("By market", "market", k.byMarket)
          + `<div class="dash-tip-col"><p class="dash-tip-title">Pipeline</p><ol class="dash-tip-list">${k.pipeline.map((p) => `<li><span class="dash-tip-row"><span>${esc(p.label)}</span><b>${goLink(drillHash("leads-stage", { stage: p.key }), fmtCount(p.count), `Companies at ${p.label}`)}</b></span>${p.conversionPct == null ? "" : `<span class="dash-tip-meta">${p.conversionPct}% reached it from ${esc(k.pipeline[k.pipeline.indexOf(p) - 1].label)}</span>`}</li>`).join("")}</ol></div>`
          + `<div class="dash-tip-col"><p class="dash-tip-title">${goLink(drillHash("leads-stale"), `Stale: no activity for 7 days (${a.stale.length})`)}</p>${names(a.stale)}`
          + `<p class="dash-tip-title">${goLink(drillHash("leads-not-contacted"), `Not contacted (${a.notContacted.length})`)}</p>${names(a.notContacted)}</div>`,
      };
    }
    if (t.key === "funnel") {
      const s = src.funnel;
      if (pending(s)) return loadingBody("Visitors, 7 days");
      if (s.status === "error") return errorBody("Visitors, 7 days", s.error);
      const k = funnelKpi(s.data.rows, s.data.leads, n);
      // Leads and (when they are leads) Opportunities are lists of leads; the visitor steps are GA4 totals.
      const stepGo = (i) => (i === 3 ? drillHash("funnel-leads") : i === 4 && k.oppsFrom === "leads" ? drillHash("funnel-opps") : "");
      const steps = k.steps.map((st, i) => `<li${st.biggest ? ' class="dash-drop-max"' : ""}><span class="dash-tip-row"><span>${esc(st.label)}</span><b>${stepGo(i) ? goLink(stepGo(i), fmtCount(st.count), st.label) : fmtCount(st.count)}</b></span>`
        + (st.dropOff == null ? "" : `<span class="dash-tip-meta">Drop-off ${fmtCount(st.dropOff)}${st.dropOffPct == null ? "" : ` (${st.dropOffPct}%)`}${st.biggest ? " · biggest" : ""}</span>`) + `</li>`);
      const change = (x) => (x.change ? ` <span class="dash-tip-change">${x.change > 0 ? "+" : "−"}${fmtCount(Math.abs(x.change))}</span>` : "");
      const rankRows = (list) => list.map((x, i) => `<li><span class="dash-tip-row"><span>${i + 1}. ${esc(x.name)}</span><b>${fmtCount(x.count)}${change(x)}</b></span></li>`);
      const movers = [k.topIndustry && `Industry: <b>${esc(k.topIndustry.name)}</b> +${fmtCount(k.topIndustry.change)}`, k.topMarket && `Market: <b>${esc(k.topMarket.name)}</b> +${fmtCount(k.topMarket.change)}`].filter(Boolean);
      const iv = ingestStatusView(s.data.ingest);
      return {
        // A source failed on the last ingest: "Data not updated" in place of the
        // trend, a red status, and the panel says what failed and when the data
        // was last updated. The earlier figures stay.
        metric: "Visitors, 7 days", value: fmtCount(k.value), trend: iv.flagged ? null : k.trend, series: k.series,
        status: tileStatus("funnel", { ...k, dataNotUpdated: iv.flagged }),
        mini: miniFunnelHtml(k.steps, stepGo),
        extra: (iv.flagged ? `<span class="dash-flag">${icon("error")}Data not updated</span>` : "")
          + `<span class="dash-sub">Visitor to lead <b>${k.conversionPct == null ? "—" : `${k.conversionPct}%`}</b></span>`
          + (movers.length ? `<span class="dash-sub">${icon("trending_up")}${movers.join(" · ")}</span>` : ""),
        tip: (iv.flagged ? `<p class="dash-tip-empty dash-tip-wide">${esc(ingestFailureText(iv))}</p>` : "")
          + (iv.known ? `<p class="dash-tip-empty dash-tip-wide">Updated ${esc(fmtUpdated(iv.updatedAt))}</p>` : "")
          + (k.hasData ? "" : `<p class="dash-tip-empty dash-tip-wide">No website data for yesterday yet.</p>`)
          + `<div class="dash-tip-col"><p class="dash-tip-title">Funnel, last 7 days</p><ol class="dash-tip-list">${steps.join("")}</ol>`
          + `<p class="dash-tip-meta">${k.oppsFrom === "ace" ? "Opportunities: ACE opportunities created." : "Opportunities: website leads now at Demo or beyond."}</p></div>`
          + `<div class="dash-tip-col"><p class="dash-tip-title">Industries by visitors, change on the week before</p>${tipList(rankRows(k.industries), "No industry page visits.")}</div>`
          + `<div class="dash-tip-col"><p class="dash-tip-title">Markets by visitors, change on the week before</p>${tipList(rankRows(k.markets), "No market data.")}</div>`
          + `<div class="dash-tip-col"><p class="dash-tip-title">Traffic sources</p>${tipList(k.channels.map((c) => `<li><span class="dash-tip-row"><span>${esc(c.name)}</span><b>${fmtCount(c.count)}</b></span></li>`), "No traffic source data.")}</div>`,
      };
    }
    // The three Support tiles share one read of the support mailbox (every
    // inbox); Needs a person counts the Support Inbox only.
    const s = src.support;
    const metric = t.key === "person" ? "Waiting" : t.key === "drafts" ? "Pending approval" : "Resolved yesterday";
    if (pending(s)) return loadingBody(metric);
    if (s.status === "error") return errorBody(metric, s.error);
    if (t.key === "person") {
      const k = needsPersonKpi(s.data, n);
      const shown = k.tickets.slice(0, SUPPORT_TIP_ROWS);
      const queue = supportHash({ queue: "needs-person" });
      return {
        metric, value: fmtCount(k.count), go: queue, status: tileStatus("person", k),
        extra: `<span class="dash-sub">Oldest <b>${k.oldestMs == null ? "None" : esc(fmtWait(k.oldestMs))}</b></span>`,
        tip: `<p class="dash-tip-title">${goLink(queue, `Waiting for a person (${k.count})`)}, longest first</p>${tipList(shown.map(waitRow), "Nobody is waiting.")}`
          + (k.tickets.length > shown.length ? `<p class="dash-tip-empty">${goLink(queue, `And ${k.tickets.length - shown.length} more in the Support Inbox.`)}</p>` : ""),
      };
    }
    if (t.key === "drafts") {
      const k = draftsKpi(s.data, n, inboxFilter.drafts);
      const shown = k.drafts.slice(0, SUPPORT_TIP_ROWS);
      // With All inboxes, each row names its inbox ("Hello · <subject>").
      // Each count opens its list, for the inbox the filter shows (uAp6fukjDyNxKusotmcQ).
      const dl = (list) => drillHash(list, { inbox: k.inbox });
      const row = (d) => `<li><span class="dash-tip-row"><strong>${supportLink(d.id, d.customer)}</strong><b class="dash-conf" data-band="${confidenceBand(d.confidence)}">${esc(confPct(d.confidence))}</b></span>`
        + `<span class="dash-tip-meta">${esc([k.inbox ? "" : inboxNames(d.inboxes), d.subject, `waiting ${fmtWait(d.waitedMs)}`].filter(Boolean).join(" · "))}</span></li>`;
      return {
        metric, value: fmtCount(k.count), go: dl("drafts"), status: tileStatus("drafts", k),
        extra: `<span class="dash-sub">${goSpan(dl("drafts-high"), `High confidence <b>${fmtCount(k.high)}</b>`)}</span>${onlyHtml(k.inbox)}`,
        tip: inboxFilterHtml(k)
          + `<p class="dash-tip-title">${goLink(dl("drafts"), `Drafts to approve${k.inbox ? ` in ${esc(inboxOf(k.inbox).label)}` : ""} (${k.count})`)}, most confident first</p>${tipList(shown.map(row), k.inbox ? `No drafts waiting in ${inboxOf(k.inbox).label}.` : "No drafts waiting.")}`
          + (k.drafts.length > shown.length ? `<p class="dash-tip-empty">${goLink(dl("drafts"), `And ${k.drafts.length - shown.length} more${k.inbox ? ` in ${esc(inboxOf(k.inbox).label)}` : ""}.`)}</p>` : ""),
      };
    }
    const k = resolvedKpi(s.data, n, inboxFilter.resolved);
    const where = k.inbox ? ` in ${esc(inboxOf(k.inbox).label)}` : "";
    const rl = (list) => drillHash(list, { inbox: k.inbox });
    const gaps = k.gaps.slice(0, SUPPORT_TIP_ROWS).map((g) => `<li><span class="dash-tip-row"><strong>${supportLink(g.id, g.subject || "(no subject)")}</strong><b>${esc(fmtDayLabel(g.at))}</b></span>`
      + `<span class="dash-tip-meta">${esc([k.inbox ? "" : inboxNames(g.inboxes), g.customer].filter(Boolean).join(" · "))}</span></li>`);
    return {
      metric, value: fmtCount(k.value), go: rl("resolved-yesterday"), trend: k.trend, status: tileStatus("resolved", k),
      extra: `<span class="dash-sub">${goSpan(rl("resolved-ai"), `By AI alone <b>${k.aiPct == null ? "—" : `${k.aiPct}%`}</b>`, "Resolved yesterday by the AI alone")}</span>${onlyHtml(k.inbox)}`,
      tip: inboxFilterHtml(k)
        + `<p class="dash-tip-wide dash-tip-empty">${goLink(rl("resolved-yesterday"), `${fmtCount(k.value)} resolved yesterday`)}${where}, ${goLink(rl("resolved-ai"), `${fmtCount(k.aiCount)} by the AI`)} with no person involved.</p>`
        + `<p class="dash-tip-title">${goLink(rl("faq-gaps"), `FAQ gaps: questions the Help Centre couldn't answer${where}, last 30 days (${k.gaps.length})`)}</p>${tipList(gaps, k.inbox ? `No gaps in ${inboxOf(k.inbox).label} in the last 30 days.` : "No gaps in the last 30 days.")}`
        + (k.gaps.length > gaps.length ? `<p class="dash-tip-empty">${goLink(rl("faq-gaps"), `And ${k.gaps.length - gaps.length} more.`)}</p>` : ""),
    };
  }
  const inboxNames = (keys) => (keys || []).map((key) => inboxOf(key).label).join(", ");
  // A filtered tile says which inbox it shows.
  const onlyHtml = (key) => (key ? `<span class="dash-sub dash-inbox-only">${esc(inboxOf(key).label)} only</span>` : "");
  // The inbox filter at the top of a Support tile's summary: All inboxes and
  // each inbox, with the tile's figure for each. A ticket written to two
  // addresses is in both, so the inboxes' figures need not add up to All.
  function inboxFilterHtml(k) {
    const choices = [{ key: "", label: "All inboxes", n: k.allCount }, ...INBOXES.map((i) => ({ key: i.key, label: i.label, n: k.byInbox[i.key] || 0 }))];
    return `<div class="seg dash-inbox-filter" role="group" aria-label="Filter by inbox">${choices.map((c) => {
      const on = c.key === k.inbox;
      return `<button type="button" class="dash-inbox-choice${on ? " active dash-inbox-on" : ""}" data-dash-inbox="${c.key}" aria-pressed="${on}">${esc(c.label)} <span class="dash-inbox-count">${fmtCount(c.n)}</span></button>`;
    }).join("")}</div>`;
  }
  // A row's own ticket: an Agent board ticket opens its modal; a Support ticket its page.
  const itemLink = (id, text) => `<button type="button" class="link-btn dash-item" data-open-item="${esc(id)}">${esc(text)}</button>`;
  const supportLink = (id, text) => goLink(supportHash({ view: "ticket", ticketId: id }), esc(text));
  const waitRow = (w) => `<li><span class="dash-tip-row"><strong>${supportLink(w.id, w.customer)}</strong><b>${esc(fmtWait(w.waitedMs))}</b></span>${w.subject ? `<span class="dash-tip-meta">${esc(w.subject)}</span>` : ""}</li>`;
  // Lead → Closed Won: companies at each stage now, the conversion from the stage before under it.
  function pipelineHtml(pipeline) {
    return `<span class="dash-pipe" aria-label="Pipeline">${pipeline.map((p) => `<span class="dash-go dash-pipe-step" data-go="${esc(drillHash("leads-stage", { stage: p.key }))}" data-touch-tap title="${esc(`Companies at ${p.label}`)}"><span class="dash-pipe-label">${esc(p.label)}</span><b>${fmtCount(p.count)}</b>`
      + `<span class="dash-pipe-conv">${p.conversionPct == null ? "" : `${p.conversionPct}%`}</span></span>`).join("")}</span>`;
  }
  // Visitors → Industry → Engaged → Leads → Opps, the biggest drop-off in amber.
  function miniFunnelHtml(steps, stepGo = () => "") {
    return `<span class="dash-mini-funnel">${steps.map((st, i) => `<span class="dash-mini-step${st.biggest ? " dash-drop-max" : ""}${stepGo(i) ? ` dash-go" data-go="${esc(stepGo(i))}" data-touch-tap title="${esc(st.label)}` : ""}"><span class="dash-pipe-label">${esc(st.short)}</span><b>${fmtCount(st.count)}</b>`
      + `<span class="dash-pipe-conv">${st.dropOffPct == null ? "" : `−${st.dropOffPct}%`}</span></span>`).join("")}</span>`;
  }
  function loadingBody(metric) { return { metric, value: "…", extra: "", tip: `<p class="dash-tip-empty">Loading…</p>`, loading: true }; }
  function errorBody(metric, message) { return { metric, value: "—", extra: `<span class="dash-flag">${icon("error")}Couldn't load</span>`, status: { level: "alert", reason: "Couldn't load" }, tip: `<p class="dash-tip-empty">Couldn't load: ${esc(message)}</p>` }; }

  // A tile's parts: the button's contents, whether it is still loading, and
  // its summary (shown in the panel when the tile is pinned).
  function tileParts(t) {
    const b = tileBody(t);
    const st = b.status || null;
    const dot = st ? `<span class="dash-status" data-level="${st.level}" title="${esc(st.reason)}"></span><span class="visually-hidden">${esc(st.reason)}.</span>` : "";
    const value = b.go ? goSpan(b.go, b.value, `${t.title}: open the list`) : b.value;
    const main = `<span class="dash-metric">${esc(b.metric)}</span><span class="dash-figure"><span class="dash-value">${value}</span>${b.trend ? trendHtml(b.trend) : b.change ? changeHtml(b.change) : ""}</span>`;
    const spark = b.series ? sparkHtml(b.series) : "";
    const inner = `<span class="dash-tile-head"><span class="dash-tile-icon">${icon(t.icon)}</span><span class="dash-tile-title">${esc(t.title)}</span>${dot}</span>`
      + main
      + (b.mini ? `<span class="dash-mini">${b.mini}</span>` : "")
      + (spark ? `<span class="dash-spark-wrap">${spark}<span class="visually-hidden">${esc(seriesText(b.series))}</span></span>` : "")
      + (b.extra ? `<span class="dash-extra">${b.extra}</span>` : "");
    return { inner, busy: !!b.loading, tip: b.tip };
  }
  // heading: the section's heading when this is its first tile. Every tile has
  // the label slot (empty after the first) so the tiles of a row line up.
  function tileHtml(t, parts = tileParts(t), heading = null) {
    const infoId = `dash-info-${t.key}`;
    const on = pinned === t.key;
    const label = heading
      ? `<div class="dash-group-label"><h3 class="dash-group-title" id="dash-group-${heading.key}">${esc(heading.label)}</h3></div>`
      : `<div class="dash-group-label" aria-hidden="true"></div>`;
    // The info button and its tooltip sit beside the tile button, not in it.
    return `<div class="dash-tile-wrap${on ? " pinned" : ""}" data-tile="${t.key}">`
      + label
      + `<div class="dash-tile-box">`
      + `<button type="button" class="dash-tile" aria-expanded="${on}" aria-controls="dash-panel"${parts.busy ? ' aria-busy="true"' : ""}>`
      + parts.inner
      + `</button>`
      + `<button type="button" class="dash-info" aria-label="About ${esc(t.title)}" aria-describedby="${infoId}">${icon("info")}</button>`
      + `<span class="dash-info-tip" role="tooltip" id="${infoId}">${esc(t.info)}</span>`
      + `</div></div>`;
  }

  // ── The summary panel ──────────────────────────────────────────────────
  function pin(key) {
    pinned = key;
    for (const w of root.querySelectorAll(".dash-tile-wrap")) {
      const on = w.dataset.tile === key;
      w.classList.toggle("pinned", on);
      w.querySelector(".dash-tile").setAttribute("aria-expanded", String(on));
    }
    lastPanel = { key: null, body: null };
    render();
  }
  function unpin(refocus) {
    const key = pinned;
    pinned = null;
    for (const w of root.querySelectorAll(".dash-tile-wrap")) {
      w.classList.remove("pinned");
      w.querySelector(".dash-tile").setAttribute("aria-expanded", "false");
    }
    panel.hidden = true;
    lastPanel = { key: null, body: null };
    if (refocus && key) root.querySelector(`.dash-tile-wrap[data-tile="${key}"] .dash-tile`)?.focus();
  }
  function toggleInfo(wrap) {
    const open = !wrap.classList.contains("info-open");
    closeInfos();
    wrap.classList.toggle("info-open", open);
  }
  function closeInfos() { for (const w of root.querySelectorAll(".dash-tile-wrap.info-open")) w.classList.remove("info-open"); }
  // Fill the panel for the pinned tile; only what changed is written, so a
  // redraw keeps the panel open, scrolled where it was, and focus inside it.
  function fillPanel(parts) {
    const t = TILES.find((x) => x.key === pinned);
    if (!t) return;
    if (lastPanel.key !== t.key) {
      panel.querySelector(".dash-panel-icon").innerHTML = icon(t.icon);
      panel.querySelector(".dash-panel-title").textContent = t.title;
      panel.dataset.tile = t.key;
    }
    if (lastPanel.key !== t.key || lastPanel.body !== parts.tip) panel.querySelector(".dash-panel-body").innerHTML = parts.tip;
    lastPanel = { key: t.key, body: parts.tip };
  }
  // The grid's column count as laid out now (4, 3, 2 or 1; styles.css
  // .dash-groups --cols): its resolved tracks, else the --cols it was given.
  function gridCols(host) {
    const cs = getComputedStyle(host);
    const tracks = cs.gridTemplateColumns.trim().split(/\s+/).filter((x) => /^[\d.]+px$/.test(x)).length;
    return tracks || parseInt(cs.getPropertyValue("--cols"), 10) || 1;
  }

  // Put the panel directly under the pinned tile's row, full width: after the
  // last tile on that row of the grid, whichever section it belongs to (the
  // panel spans every column, so the tiles after it start the next row).
  // Only the panel moves, never a tile, so a focused tile keeps its focus.
  function placePanel() {
    const host = root.querySelector("#dash-groups");
    const wrap = pinned && host.querySelector(`.dash-tile-wrap[data-tile="${pinned}"]`);
    if (!wrap || root.hidden) { panel.hidden = true; return; }
    // The row comes from the tile's place in the flow and the grid's column
    // count, never from measuring: the panel is a full-width grid item, so it
    // breaks the row it follows, and a row measured with it in place stays
    // short after the grid widens (rowEnd in dashboard-core.js).
    const tiles = [...host.querySelectorAll(".dash-tile-wrap")];
    const after = tiles[rowEnd(tiles.indexOf(wrap), gridCols(host), tiles.length)] || wrap;
    panel.hidden = false;
    if (after.nextElementSibling !== panel) {
      const focused = panel.contains(document.activeElement) ? document.activeElement : null;
      after.after(panel);
      if (focused) focused.focus();
    }
  }

  // render() runs on every backlogItems snapshot (app.js renderNow), so it
  // updates the tiles already on the page in place: replacing them would drop
  // the keyboard focus on a tile and close its panel every time the
  // automation writes a card. The page is rebuilt only when the set of
  // visible tiles changes (a role change), and a part is written only when
  // its content changed, so focus and an open panel are never disturbed.
  function render() {
    if (root.hidden) return;
    const n = now();
    const y = localDayRange(1, n);
    const dayText = `Yesterday, ${fmtDayLabel(y.from)}`;
    const dayEl = root.querySelector("#dash-day");
    if (dayEl.textContent !== dayText) dayEl.textContent = dayText;
    // #dashboard?list=…: a count's list in place of the tiles (renderList).
    const drill = parseDrill(ctx.hash ? ctx.hash() : window.location.hash);
    root.classList.toggle("dash-listing", !!drill);
    root.querySelector("#dash-list").hidden = !drill;
    if (drill) { renderList(drill); return; }
    lastList = "";
    const groups = GROUPS.map((g) => ({ g, tiles: TILES.filter((t) => t.group === g.key && allowed(t)) })).filter((x) => x.tiles.length);
    const host = root.querySelector("#dash-groups");
    if (pinned && !groups.some((x) => x.tiles.some((t) => t.key === pinned))) { pinned = null; panel.hidden = true; }
    const layout = groups.map((x) => `${x.g.key}:${x.tiles.map((t) => t.key).join(",")}`).join("|") || "none";
    if (host.dataset.layout === layout) {
      for (const { tiles } of groups) for (const t of tiles) {
        const parts = tileParts(t);
        patchTile(host, t, parts);
        if (t.key === pinned) fillPanel(parts);
      }
      placePanel();
      return;
    }
    const written = new Map();
    const html = groups.map(({ g, tiles }) => `<section class="dash-group" data-group="${g.key}" aria-labelledby="dash-group-${g.key}">`
      + `<div class="dash-tiles">${tiles.map((t, i) => { const parts = tileParts(t); written.set(t.key, parts); return tileHtml(t, parts, i === 0 ? g : null); }).join("")}</div></section>`).join("");
    host.innerHTML = html || `<p class="promote-empty">Your role doesn't include any of the sections this dashboard summarises.</p>`;
    host.appendChild(panel);
    host.dataset.layout = layout;
    lastParts = written;
    lastPanel = { key: null, body: null };
    if (pinned) fillPanel(written.get(pinned));
    placePanel();
  }
  // ── A count's list (#dashboard?list=<key>&…) ────────────────────────────
  // The rows are dashboard-core.js drillRows(): the same rules the tile counts
  // with, read from the same sources, so the list has the count's number.
  // Agent board tickets open their modal; Support tickets their page.
  let lastList = "";
  const LIST_TILE = (list) => (list.startsWith("delivery") ? "delivery" : list === "flow-stuck" ? "flow" : list.startsWith("leads") ? "leads"
    : list.startsWith("funnel") ? "funnel" : list.startsWith("drafts") ? "drafts" : "resolved");
  function renderList(drill) {
    const el = root.querySelector("#dash-list");
    const tile = TILES.find((t) => t.key === LIST_TILE(drill.list));
    const back = `<a class="dash-go dash-list-back" href="#dashboard" data-go="#dashboard">${icon("arrow_back")}Dashboard</a>`;
    let html;
    const s = tile.src === "items" ? { status: "ok" } : src[tile.src === "funnel" ? "leads" : tile.src];
    if (!allowed(tile)) html = `${back}<p class="promote-empty">Your role doesn't include this list.</p>`;
    else if (pending(s) || (s.status === "loading" && !s.data)) html = `${back}<p class="dash-tip-empty">Loading…</p>`;
    else if (s.status === "error") html = `${back}<p class="dash-tip-empty">Couldn't load: ${esc(s.error)}</p>`;
    else {
      const out = drillRows(drill.list, drill.params, { items: ctx.items(), projects: ctx.projects(), leads: src.leads.data || [], support: src.support.data || [] }, now());
      const noun = (n, kind) => (kind === "lead" ? (n === 1 ? "lead" : "leads") : (n === 1 ? "ticket" : "tickets"));
      const kind = drill.list.startsWith("leads") || drill.list.startsWith("funnel") ? "lead" : "ticket";
      const row = (r) => `<li><span class="dash-tip-row"><strong>${r.kind === "ticket" ? itemLink(r.id, r.title) : r.kind === "support" ? supportLink(r.id, r.title) : esc(r.title)}</strong></span>`
        + (r.meta ? `<span class="dash-tip-meta">${esc(r.meta)}</span>` : "") + `</li>`;
      html = `${back}<div class="dash-list-head"><span class="dash-tile-icon">${icon(tile.icon)}</span><h3 class="dash-list-title" id="dash-list-title">${esc(out.title)}</h3></div>`
        + `<p class="dash-list-count"><b>${fmtCount(out.rows.length)}</b> ${noun(out.rows.length, kind)}</p>`
        + (out.rows.length ? `<ul class="dash-tip-list dash-list-rows">${out.rows.map(row).join("")}</ul>` : `<p class="dash-tip-empty">Nothing in this list now.</p>`);
    }
    if (html !== lastList) { el.innerHTML = html; lastList = html; }
  }
  function patchTile(host, t, parts) {
    const wrap = host.querySelector(`.dash-tile-wrap[data-tile="${t.key}"]`);
    if (!wrap) return;
    const prev = lastParts.get(t.key) || {};
    const btn = wrap.querySelector(".dash-tile");
    if (prev.inner !== parts.inner) btn.innerHTML = parts.inner;
    if (prev.busy !== parts.busy) { if (parts.busy) btn.setAttribute("aria-busy", "true"); else btn.removeAttribute("aria-busy"); }
    lastParts.set(t.key, parts);
  }

  return { refresh, render };
}
