// Dashboard (#dashboard): the page the console opens on. Five KPI tiles in
// three sections (Internal, External, Support), each a headline figure for
// yesterday in the viewer's local time, its breakdown in a tooltip on hover or
// focus, and a click through to the full section. The rules live in
// dashboard-core.js; this file reads the data and draws the tiles.
//
// The Agent board tile uses the tickets app.js already holds. The other four
// read their collections once when the page opens (and again on Refresh, or
// when the page is reopened after five minutes): no listeners, so a page
// nobody is looking at costs nothing. A tile the viewer's role cannot open is
// not shown; a section with no tile left is not shown either.

import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { agentBoardKpi, kanbanKpi, leadsKpi, funnelKpi, supportKpi, dashboardRelease, localDayRange, fmtCount, fmtEffort, fmtWait, fmtDayLabel } from "./dashboard-core.js";
import { normaliseTicket } from "./support-core.js";

const STALE_MS = 5 * 60 * 1000;
const SUPPORT_LIMIT = 300;
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// key: tile id; section: permission section (permissions.js); target: where a click goes.
export const TILES = [
  { key: "agent", group: "internal", section: "agent-board", title: "Agent board", icon: "smart_toy", target: "#board" },
  { key: "kanban", group: "internal", section: "staff-kanban", title: "Staff Kanban", icon: "view_kanban", target: "#staff-kanban" },
  { key: "leads", group: "external", section: "promote-leads", title: "Leads", icon: "group", target: "#promote/leads" },
  { key: "funnel", group: "external", section: "conversion-funnel", title: "Conversion funnel", icon: "filter_alt", target: "#promote/conversion-funnel" },
  { key: "support", group: "support", section: "support-inbox", title: "Support", icon: "support_agent", target: "#support" },
];
export const GROUPS = [
  { key: "internal", label: "Internal" },
  { key: "external", label: "External" },
  { key: "support", label: "Support" },
];

// ctx: { root, db, items(), projects(), releases(), canView(section), go(hash), now?() }
export function mountDashboard(ctx) {
  const root = ctx.root;
  const now = () => (ctx.now ? ctx.now() : Date.now());
  // Per source: { status: "idle" | "loading" | "ok" | "error", data, error }
  const src = { kanban: { status: "idle" }, leads: { status: "idle" }, funnel: { status: "idle" }, support: { status: "idle" } };
  let loadedAt = 0;
  let members = null;

  root.innerHTML = `
    <div class="page-header dash-header">
      <h2>Dashboard</h2>
      <span class="dash-day" id="dash-day"></span>
      <button type="button" class="btn-outline dash-refresh" id="dash-refresh"><span class="material-symbols-outlined" aria-hidden="true">refresh</span>Refresh</button>
    </div>
    <div id="dash-groups"></div>`;
  root.querySelector("#dash-refresh").addEventListener("click", () => refresh(true));
  root.addEventListener("click", (e) => {
    const tile = e.target.closest(".dash-tile[data-target]");
    if (tile && root.contains(tile)) ctx.go(tile.dataset.target);
  });

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
      const t = now();
      const days = [localDayRange(1, t).day, localDayRange(2, t).day];
      const snaps = await Promise.all(days.map((day) => getDocs(query(collection(ctx.db, "funnelDaily"), where("date", "==", day)))));
      const rows = snaps.flatMap((s) => s.docs.map((d) => ({ id: d.id, ...d.data() })));
      // The funnel's last step is the website's leads; the Leads tile may not be visible.
      const leads = src.leads.status === "ok" ? src.leads.data : await readers.leads().catch(() => []);
      return { rows, leads };
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
  const trendHtml = (tr) => {
    const name = tr.dir === "up" ? "arrow_upward" : tr.dir === "down" ? "arrow_downward" : "remove";
    return `<span class="dash-trend dash-trend-${tr.dir}">${icon(name)}${esc(tr.text)}</span>`;
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
        metric: "Tickets deployed", value: fmtCount(k.value), extra: trendHtml(k.trend),
        tip: `<p class="dash-tip-title">Tickets by project</p>${tipList(rows, "No ticket moved yesterday and none is in build, testing or blocked.")}`,
      };
    }
    if (t.key === "kanban") {
      const s = src.kanban;
      if (pending(s)) return loadingBody("Remaining effort");
      if (s.status === "error") return errorBody("Remaining effort", s.error);
      const nameOf = (e) => (s.data.names && s.data.names.get(String(e).toLowerCase())) || String(e).split("@")[0];
      const k = kanbanKpi(s.data.release, s.data.tasks, nameOf);
      if (!k.release) return { metric: "Remaining effort", value: "—", extra: `<span class="dash-sub">No release selected</span>`, tip: `<p class="dash-tip-empty">No release is selected for deployment in Staff Kanban.</p>` };
      const rows = k.people.map((p) => `<li><span class="dash-tip-row"><strong>${esc(p.name)}</strong><b>${esc(fmtEffort(p.hours))}</b></span>`
        + `<span class="dash-tip-meta">${p.tasks} task${p.tasks === 1 ? "" : "s"} outstanding</span>`
        + (p.unestimated.length ? `<span class="dash-tip-warn">No estimate: ${p.unestimated.map((u) => esc(`${u.key}${u.title ? ` ${u.title}` : ""}`)).join(", ")}</span>` : "")
        + `</li>`);
      return {
        metric: "Remaining effort", value: esc(k.effort),
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
        metric: "New leads", value: fmtCount(k.value), extra: trendHtml(k.trend),
        tip: `<p class="dash-tip-title">Companies (${k.companies.length})</p>${names(k.companies)}`
          + `<p class="dash-tip-title">Network operators (${k.operators.length})</p>${names(k.operators)}`,
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
      return {
        metric: "Unique visitors", value: fmtCount(k.value), extra: trendHtml(k.trend),
        tip: (k.hasData ? "" : `<p class="dash-tip-empty">No website data for yesterday yet.</p>`)
          + `<p class="dash-tip-title">Funnel</p><ol class="dash-tip-list">${steps.join("")}</ol>`
          + `<p class="dash-tip-title">Industries by visitors</p>${tipList(inds, "No industry page visits.")}`,
      };
    }
    // support
    const s = src.support;
    if (pending(s)) return loadingBody("Need a person");
    if (s.status === "error") return errorBody("Need a person", s.error);
    const k = supportKpi(s.data, n);
    const waitRow = (w) => `<li><span class="dash-tip-row"><strong>${esc(w.customer)}</strong><b>${esc(fmtWait(w.waitedMs))}</b></span>${w.subject ? `<span class="dash-tip-meta">${esc(w.subject)}</span>` : ""}</li>`;
    return {
      metric: "", value: "",
      trio: [
        { label: "Need a person", value: fmtCount(k.needsPerson.length) },
        { label: "AI drafts to approve", value: fmtCount(k.aiDrafts.length) },
        { label: "Resolved", value: fmtCount(k.resolved) },
      ],
      extra: trendHtml(k.trend),
      tip: `<p class="dash-tip-title">Needs a person (${k.needsPerson.length}) · waiting</p>${tipList(k.needsPerson.map(waitRow), "None waiting.")}`
        + `<p class="dash-tip-title">AI drafts to approve (${k.aiDrafts.length}) · waiting</p>${tipList(k.aiDrafts.map(waitRow), "None waiting.")}`,
    };
  }
  function loadingBody(metric) { return { metric, value: "…", extra: "", tip: `<p class="dash-tip-empty">Loading…</p>`, loading: true }; }
  function errorBody(metric, message) { return { metric, value: "—", extra: `<span class="dash-flag">${icon("error")}Couldn't load</span>`, tip: `<p class="dash-tip-empty">Couldn't load: ${esc(message)}</p>` }; }

  function tileHtml(t) {
    const b = tileBody(t);
    const tipId = `dash-tip-${t.key}`;
    const main = b.trio
      ? `<span class="dash-trio">${b.trio.map((x) => `<span class="dash-trio-cell"><span class="dash-metric">${esc(x.label)}</span><span class="dash-value">${x.value}</span></span>`).join("")}</span>`
      : `<span class="dash-metric">${esc(b.metric)}</span><span class="dash-value">${b.value}</span>`;
    // The tooltip sits beside the button, not in it, so it is not part of the button's name.
    return `<div class="dash-tile-wrap" data-tile="${t.key}">`
      + `<button type="button" class="dash-tile" data-target="${esc(t.target)}" aria-describedby="${tipId}"${b.loading ? ' aria-busy="true"' : ""}>`
      + `<span class="dash-tile-head"><span class="dash-tile-icon">${icon(t.icon)}</span><span class="dash-tile-title">${esc(t.title)}</span>${icon("open_in_new")}</span>`
      + main
      + `<span class="dash-extra">${b.extra || ""}</span>`
      + `</button>`
      + `<div class="dash-tip" role="tooltip" id="${tipId}">${b.tip}</div>`
      + `</div>`;
  }

  function render() {
    if (root.hidden) return;
    const n = now();
    const y = localDayRange(1, n);
    root.querySelector("#dash-day").textContent = `Yesterday, ${fmtDayLabel(y.from)}`;
    const html = GROUPS.map((g) => {
      const tiles = TILES.filter((t) => t.group === g.key && allowed(t));
      if (!tiles.length) return "";
      return `<section class="dash-group" data-group="${g.key}" aria-labelledby="dash-group-${g.key}">`
        + `<h3 class="dash-group-title" id="dash-group-${g.key}">${esc(g.label)}</h3>`
        + `<div class="dash-tiles">${tiles.map(tileHtml).join("")}</div></section>`;
    }).join("");
    root.querySelector("#dash-groups").innerHTML = html || `<p class="promote-empty">Your role doesn't include any of the sections this dashboard summarises.</p>`;
  }

  return { refresh, render };
}
