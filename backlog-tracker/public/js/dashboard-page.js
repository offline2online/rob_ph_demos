// Dashboard (#dashboard): the page the console opens on. Five KPI tiles in
// three sections (Internal, External, Support), each a headline figure for
// yesterday in the viewer's local time with a 7-day sparkline, a trend arrow
// against the day before and a status colour. The Support tile is the
// exception: three figures for the support@ inbox as it stands now and today.
// The rules live in dashboard-core.js; this file reads the data and draws the tiles.
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
// The Agent board tile uses the tickets app.js already holds. The other four
// read their collections once when the page opens (and again on Refresh, or
// when the page is reopened after five minutes): no listeners, so a page
// nobody is looking at costs nothing. A tile the viewer's role cannot open is
// not shown; a section with no tile left is not shown either.

import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { agentBoardKpi, kanbanKpi, leadsKpi, funnelKpi, supportKpi, dashboardRelease, localDayRange, lastDays, sparklinePoints, trendShort, tileStatus, rowEnd, SERIES_DAYS, fmtCount, fmtEffort, fmtWait, fmtDayLabel } from "./dashboard-core.js";
import { ingestStatusView, ingestFailureText, fmtUpdated } from "./funnel-core.js";
import { normaliseTicket } from "./support-core.js";

const STALE_MS = 5 * 60 * 1000;
const SUPPORT_LIMIT = 300;
const SUPPORT_TIP_ROWS = 10;
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// key: tile id; section: permission section (permissions.js); target: where
// the panel's "Open section" goes (the tile itself never navigates); info: the
// tile's info tooltip, which is all the explanation a tile carries.
export const TILES = [
  { key: "agent", group: "internal", section: "agent-board", title: "Agent board", icon: "smart_toy", target: "#board",
    info: "Tickets deployed yesterday (your local day), against the day before. The line shows the last 7 days. Amber when a ticket is blocked, red at three or more." },
  { key: "kanban", group: "internal", section: "staff-kanban", title: "Staff Kanban", icon: "view_kanban", target: "#staff-kanban",
    info: "Remaining effort (estimate minus time logged) on the release Staff Kanban is working towards, in hours with working days at 8 hours a day. Staff Kanban keeps no daily history of it, so there is no trend or 7-day line. Amber when an outstanding task has no estimate." },
  { key: "leads", group: "external", section: "promote-leads", title: "Leads", icon: "group", target: "#promote/leads",
    info: "New leads created yesterday, test and archived leads left out, against the day before. The line shows the last 7 days." },
  { key: "funnel", group: "external", section: "conversion-funnel", title: "Conversion funnel", icon: "filter_alt", target: "#promote/conversion-funnel",
    info: "Unique visitors to the website yesterday, against the day before. The line shows the last 7 days. Amber when yesterday's website figures have not arrived yet." },
  { key: "support", group: "support", section: "support-inbox", title: "Support", icon: "support_agent", target: "#support",
    info: "The support@ inbox as it stands now: tickets awaiting a reply, how long the oldest has waited, and tickets replied to or resolved today, against yesterday. Mail written only to other addresses is not counted. Amber when anything awaits a reply, red when the oldest has waited over a day." },
];
export const GROUPS = [
  { key: "internal", label: "Internal" },
  { key: "external", label: "External" },
  { key: "support", label: "Support" },
];

// ctx: { root, db, items(), projects(), releases(), canView(section), go(hash), now?(), attention? }
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

  root.innerHTML = `
    <div class="page-header dash-header">
      <h2>Dashboard</h2>
      <span class="dash-day" id="dash-day"></span>
      <button type="button" class="btn-outline dash-refresh" id="dash-refresh"><span class="material-symbols-outlined" aria-hidden="true">refresh</span>Refresh</button>
    </div>
    <div class="dash-groups" id="dash-groups"></div>`;
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
    const info = e.target.closest(".dash-info");
    if (info) { toggleInfo(info.closest(".dash-tile-wrap")); return; }
    closeInfos();
    if (e.target.closest(".dash-panel-close")) { unpin(true); return; }
    const open = e.target.closest(".dash-panel-open");
    if (open) { const t = TILES.find((x) => x.key === pinned); if (t) ctx.go(t.target); return; }
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
      if (!release) return { release: null, tasks: [], names: new Map() };
      const byRelease = (name) => getDocs(query(collection(ctx.db, name), where("release", "==", release.id)));
      let snap = await byRelease("kanbanCards");
      // The light cards can lag the tickets until the server's backfill runs.
      if (!snap.docs.length) snap = await byRelease("kanbanTasks");
      return { release, tasks: snap.docs.map((d) => ({ key: d.id, ...d.data() })), names: await nameMap() };
    },
    async leads() {
      const snap = await getDocs(collection(ctx.db, "leads"));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
    async funnel() {
      // The last 7 days for the sparkline; yesterday and the day before are among them.
      const days = lastDays(SERIES_DAYS, now()).map((r) => r.day);
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
    const visible = new Set(TILES.filter(allowed).map((t) => t.key));
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
  const tipList = (rows, empty) => (rows.length ? `<ul class="dash-tip-list">${rows.join("")}</ul>` : `<p class="dash-tip-empty">${esc(empty)}</p>`);
  const pending = (s) => s.status === "idle" || (s.status === "loading" && !s.data);

  function tileBody(t) {
    const n = now();
    if (t.key === "agent") {
      const k = agentBoardKpi(ctx.items(), ctx.projects(), n);
      const rows = k.projects.map((p) => `<li><strong>${esc(p.name)}</strong><span class="dash-tip-grid">`
        + `<span>Deployed</span><b>${p.deployed}</b><span>Left Backlog</span><b>${p.leftBacklog}</b>`
        + `<span>In build</span><b>${p.building}</b><span>Ready for Testing</span><b>${p.testing}</b>`
        + `<span>Blocked</span><b>${p.blocked}</b></span></li>`);
      return {
        metric: "Tickets deployed", value: fmtCount(k.value), trend: k.trend, series: k.series, status: tileStatus("agent", k),
        tip: `<p class="dash-tip-title">Tickets by project</p>${tipList(rows, "No ticket moved yesterday and none is in build, testing or blocked.")}`,
      };
    }
    if (t.key === "kanban") {
      const s = src.kanban;
      if (pending(s)) return loadingBody("Remaining effort");
      if (s.status === "error") return errorBody("Remaining effort", s.error);
      const nameOf = (e) => (s.data.names && s.data.names.get(String(e).toLowerCase())) || String(e).split("@")[0];
      const k = kanbanKpi(s.data.release, s.data.tasks, nameOf);
      if (!k.release) return { metric: "Remaining effort", value: "—", extra: `<span class="dash-sub">No release selected</span>`, status: tileStatus("kanban", k), tip: `<p class="dash-tip-empty">No release is selected for deployment in Staff Kanban.</p>` };
      const rows = k.people.map((p) => `<li><span class="dash-tip-row"><strong>${esc(p.name)}</strong><b>${esc(fmtEffort(p.hours))}</b></span>`
        + `<span class="dash-tip-meta">${p.tasks} task${p.tasks === 1 ? "" : "s"} outstanding</span>`
        + (p.unestimated.length ? `<span class="dash-tip-warn">No estimate: ${p.unestimated.map((u) => esc(`${u.key}${u.title ? ` ${u.title}` : ""}`)).join(", ")}</span>` : "")
        + `</li>`);
      return {
        metric: "Remaining effort", value: esc(k.effort), status: tileStatus("kanban", k),
        extra: `<span class="dash-sub">${esc(k.release.name)}</span>`
          + (k.unestimated ? `<span class="dash-flag">${icon("warning")}${k.unestimated} task${k.unestimated === 1 ? "" : "s"} unestimated</span>` : ""),
        tip: `<p class="dash-tip-title">Outstanding by assignee · ${esc(k.release.name)}</p>${tipList(rows, "No outstanding tasks in this release.")}`,
      };
    }
    if (t.key === "leads") {
      const s = src.leads;
      if (pending(s)) return loadingBody("New leads");
      if (s.status === "error") return errorBody("New leads", s.error);
      const k = leadsKpi(s.data, n);
      const names = (list) => (list.length ? `<ul class="dash-tip-names">${list.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p class="dash-tip-empty">None</p>`);
      return {
        metric: "New leads", value: fmtCount(k.value), trend: k.trend, series: k.series, status: tileStatus("leads", k),
        tip: `<div class="dash-tip-col"><p class="dash-tip-title">Companies (${k.companies.length})</p>${names(k.companies)}</div>`
          + `<div class="dash-tip-col"><p class="dash-tip-title">Network operators (${k.operators.length})</p>${names(k.operators)}</div>`,
      };
    }
    if (t.key === "funnel") {
      const s = src.funnel;
      if (pending(s)) return loadingBody("Unique visitors");
      if (s.status === "error") return errorBody("Unique visitors", s.error);
      const k = funnelKpi(s.data.rows, s.data.leads, n);
      const steps = k.steps.map((st) => `<li><span class="dash-tip-row"><span>${esc(st.label)}</span><b>${fmtCount(st.count)}</b></span>`
        + (st.dropOff == null ? "" : `<span class="dash-tip-meta">Drop-off ${fmtCount(st.dropOff)}${st.dropOffPct == null ? "" : ` (${st.dropOffPct}%)`}</span>`) + `</li>`);
      const inds = k.industries.map((x, i) => `<li><span class="dash-tip-row"><span>${i + 1}. ${esc(x.name)}</span><b>${fmtCount(x.count)}</b></span></li>`);
      const iv = ingestStatusView(s.data.ingest);
      return {
        // A source failed on the last ingest: "Data not updated" in place of the
        // trend, a red status, and the panel says what failed and when the data
        // was last updated. The earlier figures stay.
        metric: "Unique visitors", value: fmtCount(k.value), trend: iv.flagged ? null : k.trend, series: k.series,
        extra: iv.flagged ? `<span class="dash-flag">${icon("error")}Data not updated</span>` : "",
        status: tileStatus("funnel", { ...k, dataNotUpdated: iv.flagged }),
        tip: (iv.flagged ? `<p class="dash-tip-empty dash-tip-wide">${esc(ingestFailureText(iv))}</p>` : "")
          + (iv.known ? `<p class="dash-tip-empty dash-tip-wide">Updated ${esc(fmtUpdated(iv.updatedAt))}</p>` : "")
          + (k.hasData ? "" : `<p class="dash-tip-empty dash-tip-wide">No website data for yesterday yet.</p>`)
          + `<div class="dash-tip-col"><p class="dash-tip-title">Funnel</p><ol class="dash-tip-list">${steps.join("")}</ol></div>`
          + `<div class="dash-tip-col"><p class="dash-tip-title">Industries by visitors</p>${tipList(inds, "No industry page visits.")}</div>`,
      };
    }
    // support
    const s = src.support;
    if (pending(s)) return loadingBody("Awaiting a reply");
    if (s.status === "error") return errorBody("Awaiting a reply", s.error);
    const k = supportKpi(s.data, n);
    const waitRow = (w) => `<li><span class="dash-tip-row"><strong>${esc(w.customer)}</strong><b>${esc(fmtWait(w.waitedMs))}</b></span>${w.subject ? `<span class="dash-tip-meta">${esc(w.subject)}</span>` : ""}</li>`;
    const shown = k.waiting.slice(0, SUPPORT_TIP_ROWS);
    return {
      metric: "", value: "", status: tileStatus("support", k),
      // Exactly three figures, all of the support@ inbox (never Hello's or Aidan's).
      trio: [
        { label: "Awaiting a reply", value: fmtCount(k.open) },
        { label: "Oldest waiting", value: k.oldestMs == null ? "None" : esc(fmtWait(k.oldestMs)) },
        { label: "Replied or resolved today", value: fmtCount(k.doneToday), trend: k.doneTrend },
      ],
      tip: `<p class="dash-tip-title">Open and awaiting a reply (${k.open}) · waiting</p>${tipList(shown.map(waitRow), "None waiting.")}`
        + (k.waiting.length > shown.length ? `<p class="dash-tip-empty">And ${k.waiting.length - shown.length} more in the Support Inbox.</p>` : ""),
    };
  }
  function loadingBody(metric) { return { metric, value: "…", extra: "", tip: `<p class="dash-tip-empty">Loading…</p>`, loading: true }; }
  function errorBody(metric, message) { return { metric, value: "—", extra: `<span class="dash-flag">${icon("error")}Couldn't load</span>`, status: { level: "alert", reason: "Couldn't load" }, tip: `<p class="dash-tip-empty">Couldn't load: ${esc(message)}</p>` }; }

  // A tile's parts: the button's contents, whether it is still loading, and
  // its summary (shown in the panel when the tile is pinned).
  function tileParts(t) {
    const b = tileBody(t);
    const st = b.status || null;
    const dot = st ? `<span class="dash-status" data-level="${st.level}" title="${esc(st.reason)}"></span><span class="visually-hidden">${esc(st.reason)}.</span>` : "";
    const main = b.trio
      ? `<span class="dash-trio">${b.trio.map((x) => `<span class="dash-trio-cell"><span class="dash-metric">${esc(x.label)}</span><span class="dash-figure"><span class="dash-value">${x.value}</span>${x.trend ? trendHtml(x.trend) : ""}</span></span>`).join("")}</span>`
      : `<span class="dash-metric">${esc(b.metric)}</span><span class="dash-figure"><span class="dash-value">${b.value}</span>${b.trend ? trendHtml(b.trend) : ""}</span>`;
    const spark = b.series ? sparkHtml(b.series) : "";
    const inner = `<span class="dash-tile-head"><span class="dash-tile-icon">${icon(t.icon)}</span><span class="dash-tile-title">${esc(t.title)}</span>${dot}</span>`
      + main
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
