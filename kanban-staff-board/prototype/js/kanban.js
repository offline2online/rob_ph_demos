// Kanban — Staff Task Board prototype (concept vmhUoPiogxiJq1YmtJph).
// Front-end only: state lives in memory and, where the browser allows it, in
// this viewer's localStorage so a drag survives a reload. No backend.
(function () {
  "use strict";

  const SEED = window.KB_SEED;
  const STORE_KEY = "kb-proto-v2";
  const NAV_KEY = "kb-proto-nav-collapsed";
  const root = document.documentElement;

  const STATUSES = [
    { key: "backlog", label: "Backlog", short: "Backlog" },
    { key: "ready-for-dev", label: "Ready for Dev", short: "Ready for Dev" },
    { key: "in-progress", label: "In Progress", short: "In Progress" },
    { key: "ready-for-testing", label: "Ready for Testing", short: "Testing" },
    { key: "approved", label: "Approved / Ready for Deployment", short: "Approved" },
    { key: "done", label: "Done", short: "Done" },
  ];
  const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.key, s.label]));
  const OUTSTANDING = STATUSES.filter((s) => s.key !== "done").map((s) => s.key);

  const TYPES = [
    { key: "task", label: "Task", icon: "check_box" },
    { key: "bug", label: "Bug", icon: "bug_report" },
    { key: "epic", label: "Epic", icon: "bolt" },
  ];
  const PRIORITIES = [
    { key: "highest", label: "Highest", icon: "keyboard_double_arrow_up" },
    { key: "high", label: "High", icon: "keyboard_arrow_up" },
    { key: "medium", label: "Medium", icon: "drag_handle" },
    { key: "low", label: "Low", icon: "keyboard_arrow_down" },
    { key: "lowest", label: "Lowest", icon: "keyboard_double_arrow_down" },
  ];

  // Core fields are always on the form; optional ones follow Kanban settings.
  const CORE_FIELDS = [
    { key: "title", label: "Title", lockRequired: true },
    { key: "description", label: "Description" },
    { key: "reporter", label: "Reporter" },
    { key: "assignee", label: "Assignee" },
    { key: "status", label: "Status", lockRequired: true },
    { key: "release", label: "Release" },
    { key: "estimate", label: "Estimate" },
  ];
  const OPTIONAL_FIELDS = [
    { key: "type", label: "Type" },
    { key: "priority", label: "Priority" },
    { key: "sprint", label: "Sprint" },
    { key: "due", label: "Due date" },
    { key: "logged", label: "Time logged" },
    { key: "labels", label: "Labels" },
    { key: "comments", label: "Comments" },
    { key: "attachments", label: "Attachments" },
    { key: "epic", label: "Parent epic" },
    { key: "links", label: "Linked tickets" },
    { key: "flag", label: "Flag" },
  ];
  const FIELD_LABEL = Object.fromEntries([...CORE_FIELDS, ...OPTIONAL_FIELDS].map((f) => [f.key, f.label]));

  function defaultSettings() {
    return {
      fields: {
        title: { show: true, required: true }, description: { show: true, required: false },
        reporter: { show: true, required: true }, assignee: { show: true, required: false },
        status: { show: true, required: true }, release: { show: true, required: true },
        estimate: { show: true, required: false },
        type: { show: true, required: true }, priority: { show: true, required: false },
        sprint: { show: false, required: false }, due: { show: false, required: false },
        logged: { show: true, required: false }, labels: { show: false, required: false },
        comments: { show: true, required: false }, attachments: { show: false, required: false },
        links: { show: false, required: false },
        epic: { show: true, required: false }, flag: { show: true, required: false },
      },
      tester: "rob",
      currentRelease: SEED.currentRelease,
    };
  }

  // ── State ───────────────────────────────────────────────────────────────
  const clone = (o) => JSON.parse(JSON.stringify(o));
  let state = load() || fresh();
  function fresh() {
    return { tasks: clone(SEED.tasks), settings: defaultSettings(), me: "rob", nextKey: SEED.nextKey };
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || !Array.isArray(s.tasks)) return null;
      s.settings = Object.assign(defaultSettings(), s.settings || {});
      s.settings.fields = Object.assign(defaultSettings().fields, s.settings.fields || {});
      return s;
    } catch { return null; }
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* private window */ }
  }

  const board = { q: "", mine: false, flagged: false, assignees: new Set(), type: "", priority: "", sprint: "", release: "", label: "" };
  const collapsedCols = new Set();
  let filtersOpen = false;
  const collapsedLanes = new Set();

  // ── Helpers ─────────────────────────────────────────────────────────────
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const user = (id) => SEED.users.find((u) => u.id === id);
  const firstName = (id) => (user(id) || {}).first || "Unassigned";
  const release = (id) => SEED.releases.find((r) => r.id === id);
  const releaseName = (id) => (release(id) || {}).name || "No release";
  const sprint = (id) => SEED.sprints.find((s) => s.id === id);
  // Epics are ordinary tickets of type "epic"; any task or bug can name one as its parent.
  const epics = () => state.tasks.filter((t) => t.type === "epic").sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  const epic = (key) => (key ? state.tasks.find((t) => t.key === key && t.type === "epic") : null);
  const childrenOf = (key) => state.tasks.filter((t) => t.epic === key && t.type !== "epic");
  const typeOf = (k) => TYPES.find((t) => t.key === k) || TYPES[0];
  const prioOf = (k) => PRIORITIES.find((p) => p.key === k) || PRIORITIES[2];
  const taskByKey = (k) => state.tasks.find((t) => t.key === k);
  const tip = (text, cls = "") => `<button type="button" class="info-tip ${cls}" data-tip="${esc(text)}" aria-label="More information">i</button>`;
  const remaining = (t) => (t.status === "done" ? 0 : Math.max((+t.estimate || 0) - (+t.logged || 0), 0));
  const TODAY = new Date(SEED.TODAY + "T12:00:00");

  function fmtH(h) {
    if (h == null || h === "" || isNaN(h)) return "—";
    h = Math.round(+h * 2) / 2;
    if (h === 0) return "0h";
    const d = Math.floor(h / 8), r = +(h - d * 8).toFixed(1);
    return [d ? `${d}d` : "", r ? `${r}h` : ""].filter(Boolean).join(" ");
  }
  // "1d 4h", "6h", "30m", "1.5" (hours) → hours
  function parseDur(str) {
    const s = String(str || "").trim().toLowerCase();
    if (!s) return null;
    if (/^\d+(\.\d+)?$/.test(s)) return +s;
    let total = 0, matched = false;
    s.replace(/(\d+(?:\.\d+)?)\s*([dhm])/g, (_, n, u) => { matched = true; total += +n * (u === "d" ? 8 : u === "h" ? 1 : 1 / 60); });
    return matched ? Math.round(total * 100) / 100 : NaN;
  }
  function fmtDate(iso, opts) {
    if (!iso) return "";
    const d = new Date(iso.length <= 10 ? iso + "T12:00:00" : iso);
    return d.toLocaleDateString("en-GB", opts || { day: "numeric", month: "short" });
  }
  function daysBetween(aIso, bDate) {
    const a = new Date(aIso + "T12:00:00");
    return Math.round((a - bDate) / 86400000);
  }
  function workingDaysUntil(iso) {
    const end = new Date(iso + "T12:00:00");
    let n = 0;
    for (let d = new Date(TODAY); d < end; d.setDate(d.getDate() + 1)) { const w = d.getDay(); if (w && w !== 6) n++; }
    return n;
  }
  function avatar(id, size = "") {
    const u = user(id);
    if (!u) return `<span class="kb-avatar kb-avatar-none ${size}" title="Unassigned"><span class="material-symbols-outlined" aria-hidden="true">person</span></span>`;
    return `<span class="kb-avatar ${size}" style="background:${u.color}" title="${esc(u.first)}">${esc(u.first.charAt(0))}</span>`;
  }

  let toastTimer;
  function toast(html) {
    const el = $("#kb-toast");
    el.innerHTML = html;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3600);
  }

  // ── Status changes (the one place the testing hand-off happens) ─────────
  function setStatus(task, status, opts = {}) {
    const from = task.status;
    if (from === status) return null;
    task.status = status;
    task.activity = task.activity || [];
    let note = "";
    const tester = state.settings.tester;
    if (status === "ready-for-testing" && task.assignee !== tester) {
      task.previousAssignee = task.assignee || "";
      task.assignee = tester;
      note = `reassigned to ${firstName(tester)} for testing`;
    } else if (from === "ready-for-testing" && (status === "in-progress" || status === "ready-for-dev") && task.previousAssignee) {
      task.assignee = task.previousAssignee;
      note = `returned to ${firstName(task.previousAssignee)}`;
    }
    task.activity.push({ at: new Date().toISOString(), who: state.me, text: `${STATUS_LABEL[from]} → ${STATUS_LABEL[status]}${note ? " · " + note : ""}` });
    if (!opts.silent) toast(`<b>${esc(task.key)}</b> moved to ${esc(STATUS_LABEL[status])}${note ? ` · ${esc(note)}` : ""}`);
    return note;
  }

  // lane: the swimlane a card was dropped in ("none" = Unassigned); undefined on a plain board.
  function toggleFlag(task, quiet) {
    if (!task) return;
    task.flagged = !task.flagged;
    task.activity = task.activity || [];
    task.activity.push({ at: new Date().toISOString(), who: state.me, text: task.flagged ? "flagged this ticket" : "removed the flag" });
    save();
    if (!quiet) { toast(`<b>${esc(task.key)}</b> ${task.flagged ? "flagged" : "flag removed"}`); render(); }
  }

  function moveTask(key, status, beforeKey, lane) {
    const task = taskByKey(key);
    if (!task) return;
    const list = state.tasks.filter((t) => t.status === status && t !== task).sort((a, b) => a.rank - b.rank);
    let idx = beforeKey ? list.findIndex((t) => t.key === beforeKey) : -1;
    if (idx < 0) idx = list.length;
    const prev = list[idx - 1], next = list[idx];
    task.rank = !prev && !next ? 10 : !prev ? next.rank - 10 : !next ? prev.rank + 10 : (prev.rank + next.rank) / 2;
    const toAssignee = lane === undefined ? task.assignee : lane === "none" ? "" : lane;
    const reassigned = (toAssignee || "") !== (task.assignee || "");
    if (reassigned) {
      task.activity = task.activity || [];
      task.activity.push({ at: new Date().toISOString(), who: state.me, text: `reassigned ${firstName(task.assignee)} → ${firstName(toAssignee)}` });
      task.assignee = toAssignee;
      task.previousAssignee = "";
    }
    const fromStatus = task.status;
    const note = setStatus(task, status, { silent: reassigned });
    if (reassigned) {
      const moved = fromStatus !== status ? ` · moved to ${esc(STATUS_LABEL[status])}` : "";
      toast(`<b>${esc(task.key)}</b> assigned to ${esc(firstName(toAssignee))}${moved}${note ? `, ${esc(note)}` : ""}`);
    }
    save();
    renderKanbanBoard();
  }

  // ── Router ──────────────────────────────────────────────────────────────
  function parseHash() {
    const h = (location.hash || "#kanban").slice(1);
    const [route, qs] = h.split("?");
    return { route: route || "kanban", params: new URLSearchParams(qs || "") };
  }
  function go(route, params) {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    location.hash = route + qs;
  }
  function render() {
    const { route, params } = parseHash();
    const view = $("#view");
    closeDrawer(); closeProfile();
    if (route === "agent-board") renderAgentBoard(view);
    else if (route === "report") renderReport(view, params);
    else if (route === "settings") renderSettings(view);
    else renderKanban(view);
    $$("[data-route]").forEach((b) => {
      if (!b.matches(".nav-drawer-item, .tab, .profile-menu-item")) return;
      const on = b.dataset.route === (["agent-board", "report", "settings"].includes(route) ? route : "kanban");
      if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
      if (b.classList.contains("tab")) b.classList.toggle("active", on);
    });
    root.dataset.page = ["agent-board", "report", "settings"].includes(route) ? route : "kanban";
    document.title = ({ "agent-board": "Agent Board", report: "Release report", settings: "Kanban settings" }[route] || "Kanban") + " — PH Agent Console";
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", render);
  document.addEventListener("click", (e) => {
    const r = e.target.closest("button[data-route], a[data-route]");
    if (r) { e.preventDefault(); go(r.dataset.route, r.dataset.params ? JSON.parse(r.dataset.params) : null); return; }
    const inert = e.target.closest("[data-inert]");
    if (inert) { toast("Not part of this prototype"); }
  });

  // ── Nav shell (same behaviour as the console's js/nav-shell.js) ─────────
  const mqPersistent = matchMedia("(min-width: 1024px)");
  const mqPhone = matchMedia("(max-width: 640px)");
  function readCollapsed() { try { return localStorage.getItem(NAV_KEY) === "1"; } catch { return false; } }
  function applyCollapsed(v) {
    if (v) root.setAttribute("data-nav-collapsed", ""); else root.removeAttribute("data-nav-collapsed");
    $("#nav-collapse-btn").setAttribute("aria-label", v ? "Expand sidebar" : "Collapse sidebar");
  }
  function closeDrawer() { $("#nav-drawer").classList.remove("open"); $("#nav-drawer-backdrop").classList.remove("open"); }
  function closeProfile() { $("#profile-menu").hidden = true; $("#profile-btn").setAttribute("aria-expanded", "false"); if (!$("#nav-drawer").classList.contains("open")) $("#nav-drawer-backdrop").classList.remove("open"); }
  function toggleProfile() {
    const m = $("#profile-menu");
    if (m.hidden) { m.hidden = false; $("#profile-btn").setAttribute("aria-expanded", "true"); if (mqPhone.matches) $("#nav-drawer-backdrop").classList.add("open"); }
    else closeProfile();
  }
  function initShell() {
    applyCollapsed(readCollapsed());
    $("#nav-collapse-btn").addEventListener("click", () => {
      const next = !root.hasAttribute("data-nav-collapsed");
      try { localStorage.setItem(NAV_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      applyCollapsed(next);
    });
    $("#nav-open-btn").addEventListener("click", () => {
      if (mqPersistent.matches) { applyCollapsed(false); try { localStorage.setItem(NAV_KEY, "0"); } catch { /* ignore */ } return; }
      $("#nav-drawer").classList.add("open"); $("#nav-drawer-backdrop").classList.add("open");
    });
    $("#nav-close-btn").addEventListener("click", closeDrawer);
    $("#nav-drawer-backdrop").addEventListener("click", () => { closeDrawer(); closeProfile(); });
    $("#profile-btn").addEventListener("click", (e) => { e.stopPropagation(); toggleProfile(); });
    $('.tab[data-tab="profile"]').addEventListener("click", (e) => { e.stopPropagation(); toggleProfile(); });
    document.addEventListener("click", (e) => {
      if (!e.target.closest("#profile-menu, #profile-btn, .tab")) closeProfile();
      if (!e.target.closest(".project-options")) $$(".project-options-menu").forEach((m) => { m.hidden = true; });
    });
    const measure = () => root.style.setProperty("--sticky-topbar-h", $(".topbar").offsetHeight + "px");
    addEventListener("resize", measure); measure();
    [mqPersistent, mqPhone].forEach((mq) => mq.addEventListener("change", () => { closeDrawer(); closeProfile(); }));
    renderProfile();
  }
  function renderProfile() {
    const me = user(state.me);
    $("#profile-avatar").outerHTML = `<span id="profile-avatar">${avatar(state.me, "kb-avatar-lg")}</span>`;
    $("#profile-menu-avatar").outerHTML = `<span id="profile-menu-avatar">${avatar(state.me, "kb-avatar-lg")}</span>`;
    $("#topbar-user").textContent = me.email;
    $("#profile-switch").innerHTML = SEED.users.map((u) => `<button type="button" class="profile-menu-item kb-switch-user" data-user="${u.id}" role="menuitemradio" aria-checked="${u.id === state.me}">${avatar(u.id)}<span>${esc(u.first)}</span><span class="kb-switch-loc">${esc(u.location)}</span>${u.id === state.me ? '<span class="material-symbols-outlined kb-check" aria-hidden="true">check</span>' : ""}</button>`).join("");
    $$(".kb-switch-user").forEach((b) => b.addEventListener("click", () => {
      state.me = b.dataset.user; save(); renderProfile(); closeProfile(); render();
      toast(`Signed in as <b>${esc(firstName(state.me))}</b>`);
    }));
  }

  // ── Kanban page ─────────────────────────────────────────────────────────
  function boardTasks() {
    const q = board.q.trim().toLowerCase();
    return state.tasks.filter((t) => {
      if (board.mine && t.assignee !== state.me) return false;
      if (board.flagged && !t.flagged) return false;
      if (board.assignees.size && !board.assignees.has(t.assignee || "none")) return false;
      if (board.release && t.release !== board.release) return false;
      if (board.type && t.type !== board.type) return false;
      if (board.priority && t.priority !== board.priority) return false;
      if (board.sprint && t.sprint !== board.sprint) return false;
      if (board.label && !(t.labels || []).includes(board.label)) return false;
      if (q && !(`${t.key} ${t.title} ${t.description} ${(t.labels || []).join(" ")}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }
  const opt = (v, label, sel) => `<option value="${esc(v)}"${v === sel ? " selected" : ""}>${esc(label)}</option>`;

  function renderKanban(view) {
    const relOpts = opt("", "All releases", board.release) + SEED.releases.map((r) => opt(r.id, r.name + (r.id === state.settings.currentRelease ? " (current)" : r.released ? " (released)" : ""), board.release)).join("");
    const extraCount = [board.release, board.type, board.priority, board.sprint, board.label].filter(Boolean).length;
    const filtersActive = board.flagged || board.mine || board.assignees.size || board.type || board.priority || board.sprint || board.label || board.q;
    view.innerHTML = `
      <div class="page-header">
        <h2>Kanban</h2>
        <span class="page-header-count" id="kb-count"></span>
        <label class="kb-search kb-header-search"><span class="material-symbols-outlined" aria-hidden="true">search</span><input type="search" id="kb-q" placeholder="Search tasks" value="${esc(board.q)}" aria-label="Search tasks"></label>
        <div class="kb-header-actions">
          <button type="button" class="btn-ghost kb-icon-label" id="kb-report-btn"><span class="material-symbols-outlined" aria-hidden="true">monitoring</span>Release report</button>
          <button type="button" class="btn-primary" id="kb-new-btn">+ New task</button>
          <button type="button" class="btn-ghost kb-settings-btn" data-route="settings" title="Kanban settings" aria-label="Kanban settings"><span class="material-symbols-outlined" aria-hidden="true">settings</span></button>
        </div>
      </div>
      <div class="kb-filters" role="search">
        <div class="kb-people" role="group" aria-label="Filter by assignee">
          ${SEED.users.map((u) => `<button type="button" class="kb-person-chip${board.assignees.has(u.id) ? " on" : ""}" data-person="${u.id}" aria-pressed="${board.assignees.has(u.id)}" title="${esc(u.first)}">${avatar(u.id)}<span>${esc(u.first)}</span></button>`).join("")}
          <button type="button" class="kb-person-chip${board.assignees.has("none") ? " on" : ""}" data-person="none" aria-pressed="${board.assignees.has("none")}">${avatar("")}<span>Unassigned</span></button>
        </div>
        <button type="button" class="kb-mine${board.mine ? " on" : ""}" id="kb-mine" aria-pressed="${board.mine}"><span class="material-symbols-outlined" aria-hidden="true">person</span>My tasks</button>
        <button type="button" class="kb-mine kb-flag-filter${board.flagged ? " on" : ""}" id="kb-flagged" aria-pressed="${board.flagged}"><span class="material-symbols-outlined" aria-hidden="true">flag</span>Flagged<span class="kb-flag-count">${state.tasks.filter((t) => t.flagged && t.status !== "done").length}</span></button>
        <button type="button" class="kb-mine kb-filter-toggle${filtersOpen ? " on" : ""}" id="kb-filter-toggle" aria-expanded="${filtersOpen}"><span class="material-symbols-outlined" aria-hidden="true">tune</span>Filters${extraCount ? ` · ${extraCount}` : ""}</button>
        <div class="kb-filter-more${filtersOpen ? " open" : ""}">
        <select id="kb-release" aria-label="Release">${relOpts}</select>
        <select id="kb-type" aria-label="Type">${opt("", "All types", board.type)}${TYPES.map((t) => opt(t.key, t.label, board.type)).join("")}</select>
        <select id="kb-priority" aria-label="Priority">${opt("", "All priorities", board.priority)}${PRIORITIES.map((p) => opt(p.key, p.label, board.priority)).join("")}</select>
        <select id="kb-sprint" aria-label="Sprint">${opt("", "All sprints", board.sprint)}${SEED.sprints.map((s) => opt(s.id, s.name, board.sprint)).join("")}</select>
        <select id="kb-label" aria-label="Label">${opt("", "All labels", board.label)}${SEED.labels.map((l) => opt(l, l, board.label)).join("")}</select>
        </div>
        ${filtersActive ? '<button type="button" class="link-btn kb-clear" id="kb-clear">Clear filters</button>' : ""}
      </div>
      <div class="kb-lanes-bar" id="kb-lanes-bar" hidden>
        <span class="kb-lanes-bar-label"><span class="material-symbols-outlined" aria-hidden="true">view_agenda</span>Swimlanes by staff member</span>
        <button type="button" class="link-btn" id="kb-lanes-expand">Expand all</button>
        <button type="button" class="link-btn" id="kb-lanes-collapse">Collapse all</button>
      </div>
      <div class="kb-lanes-sticky" id="kb-lanes-sticky" hidden>
        <div class="kb-lanes-head-scroll" id="kb-lanes-head-scroll"><div class="kb-board kb-lanes-head-grid" id="kb-lanes-head"></div></div>
        <button type="button" class="kb-lane-pin" id="kb-lane-pin" hidden></button>
      </div>
      <div class="kb-board-wrap" id="kb-board-wrap"><div class="kb-board" id="kb-board"></div></div>`;
    // The swimlane column headers live outside the sideways-scrolling board so
    // they can stick to the page; this keeps them lined up with the columns.
    const wrap = $("#kb-board-wrap"), headScroll = $("#kb-lanes-head-scroll");
    wrap.addEventListener("scroll", () => { headScroll.scrollLeft = wrap.scrollLeft; }, { passive: true });
    $("#kb-lane-pin").addEventListener("click", () => {
      const id = $("#kb-lane-pin").dataset.lane;
      if (!id) return;
      if (collapsedLanes.has(id)) collapsedLanes.delete(id); else collapsedLanes.add(id);
      renderKanbanBoard();
      // keep that lane's own header just under the pinned column headers
      const lane = $(`.kb-lane[data-lane="${id}"]`);
      if (lane) window.scrollTo(0, lane.getBoundingClientRect().top + scrollY - headScroll.getBoundingClientRect().bottom);
      updateLanePin();
    });
    $("#kb-lanes-expand").addEventListener("click", () => { collapsedLanes.clear(); renderKanbanBoard(); });
    $("#kb-lanes-collapse").addEventListener("click", () => { (laneIds() || []).forEach((id) => collapsedLanes.add(id)); renderKanbanBoard(); });

    $("#kb-new-btn").addEventListener("click", () => openTask(null));
    $("#kb-report-btn").addEventListener("click", () => go("report", board.release ? { release: board.release } : null));
    $("#kb-q").addEventListener("input", (e) => { board.q = e.target.value; renderKanbanBoard(); });
    $$(".kb-person-chip").forEach((b) => b.addEventListener("click", () => {
      const id = b.dataset.person;
      if (board.assignees.has(id)) board.assignees.delete(id); else board.assignees.add(id);
      renderKanban(view);
    }));
    $("#kb-filter-toggle").addEventListener("click", () => { filtersOpen = !filtersOpen; renderKanban(view); });
    $("#kb-mine").addEventListener("click", () => { board.mine = !board.mine; renderKanban(view); });
    $("#kb-flagged").addEventListener("click", () => { board.flagged = !board.flagged; renderKanban(view); });
    [["kb-release", "release"], ["kb-type", "type"], ["kb-priority", "priority"], ["kb-sprint", "sprint"], ["kb-label", "label"]].forEach(([id, k]) =>
      $("#" + id).addEventListener("change", (e) => { board[k] = e.target.value; renderKanban(view); }));
    const clear = $("#kb-clear");
    if (clear) clear.addEventListener("click", () => { Object.assign(board, { q: "", mine: false, flagged: false, type: "", priority: "", sprint: "", label: "" }); board.assignees.clear(); renderKanban(view); });
    renderKanbanBoard();
  }

  // Swimlanes: one per staff member picked in the assignee filter (Jira's
  // swimlanes by assignee), each with its own expand / collapse header.
  function laneIds() {
    if (!board.assignees.size) return null;
    return [...SEED.users.map((u) => u.id), "none"].filter((id) => board.assignees.has(id));
  }
  const colMeta = (list, s) => {
    const rem = list.reduce((n, t) => n + remaining(t), 0);
    return `<span class="kb-col-meta">${s.key !== "done" && rem ? `<span class="kb-col-effort" title="Remaining effort">${fmtH(rem)}</span>` : ""}<span class="col-count">${list.length}</span></span>`;
  };
  function renderKanbanBoard() {
    const el = $("#kb-board");
    if (!el) return;
    const tasks = boardTasks();
    $("#kb-count").textContent = `${tasks.length} task${tasks.length === 1 ? "" : "s"}`;
    const lanes = laneIds();
    el.classList.toggle("kb-board-lanes", !!lanes);
    const sorted = (list, k) => list.filter((t) => t.status === k).sort((a, b) => a.rank - b.rank);
    if (lanes) {
      $("#kb-lanes-head").innerHTML = STATUSES.map((s) => `<div class="col-head kb-col-head kb-lanes-head kb-col-${s.key}"><span class="kb-col-title">${esc(s.label)}</span>${colMeta(sorted(tasks, s.key), s)}</div>`).join("");
      $("#kb-lanes-sticky").hidden = false;
      $("#kb-lanes-bar").hidden = false;
      $("#kb-lanes-head-scroll").scrollLeft = $("#kb-board-wrap").scrollLeft;
      el.innerHTML = lanes.map((id) => {
          const mine = tasks.filter((t) => (t.assignee || "none") === id);
          const rem = mine.reduce((n, t) => n + remaining(t), 0);
          const collapsed = collapsedLanes.has(id);
          const laneColor = (user(id) || {}).color || "var(--accent-backlog)";
          return `<div class="kb-lane${collapsed ? " kb-lane-collapsed" : ""}" data-lane="${id}" style="--lane-c:${laneColor}">
            <button type="button" class="kb-lane-head" aria-expanded="${!collapsed}">
              <span class="material-symbols-outlined kb-lane-caret" aria-hidden="true">expand_more</span>${avatar(id === "none" ? "" : id)}
              <span class="kb-lane-name">${esc(id === "none" ? "Unassigned" : firstName(id))}</span>
              <span class="col-count">${mine.length}</span>${rem ? `<span class="kb-col-effort">${fmtH(rem)} remaining</span>` : ""}
            </button>
          </div>` + STATUSES.map((s) => {
            const list = sorted(mine, s.key);
            return `<section class="column kb-col kb-lane-cell${list.length ? "" : " kb-cell-empty"}${collapsed ? " kb-cell-hidden" : ""}" data-status="${s.key}" data-lane="${id}" aria-label="${esc((id === "none" ? "Unassigned" : firstName(id)) + " · " + s.label)}">
              <div class="kb-cell-head kb-col-${s.key}"><span>${esc(s.label)}</span><span class="col-count">${list.length}</span></div>
              <div class="col-list kb-list">${list.map(cardHTML).join("")}</div>
            </section>`;
          }).join("");
        }).join("");
      $$(".kb-lane-head", el).forEach((h) => h.addEventListener("click", () => {
        const id = h.parentElement.dataset.lane;
        if (collapsedLanes.has(id)) collapsedLanes.delete(id); else collapsedLanes.add(id);
        renderKanbanBoard();
      }));
      updateLanePin();
      return;
    }
    $("#kb-lanes-sticky").hidden = true;
    $("#kb-lanes-bar").hidden = true;
    el.innerHTML = STATUSES.map((s) => {
      const list = sorted(tasks, s.key);
      return `<section class="column kb-col${collapsedCols.has(s.key) ? " column-collapsed" : ""}" data-status="${s.key}" aria-label="${esc(s.label)}">
        <div class="col-head kb-col-head kb-col-${s.key}">
          <span class="kb-col-title">${esc(s.label)}</span>
          ${colMeta(list, s)}
        </div>
        <div class="col-list kb-list">${list.map(cardHTML).join("") || '<p class="empty-hint kb-empty">No tasks</p>'}</div>
      </section>`;
    }).join("");
    $$(".kb-col-head", el).forEach((h) => h.addEventListener("click", () => {
      if (!mqPhone.matches) return;
      const k = h.parentElement.dataset.status;
      if (collapsedCols.has(k)) collapsedCols.delete(k); else collapsedCols.add(k);
      h.parentElement.classList.toggle("column-collapsed");
    }));
  }

  // Desktop: the board scrolls sideways in its own box, so a lane header can't
  // CSS-stick to the page. Instead the pin under the column headers shows the
  // header of whichever lane is being scrolled through. (On a phone the board
  // doesn't scroll sideways and .kb-lane sticks natively.)
  function updateLanePin() {
    const pin = $("#kb-lane-pin"), head = $("#kb-lanes-head-scroll");
    if (!pin || !head) return;
    const lanes = $$(".kb-lane");
    let current = null;
    if (lanes.length && !mqPhone.matches && !$("#kb-lanes-sticky").hidden) {
      const line = head.getBoundingClientRect().bottom;
      const boardBottom = $("#kb-board").getBoundingClientRect().bottom;
      lanes.forEach((l, i) => {
        const top = l.getBoundingClientRect().top;
        const end = i + 1 < lanes.length ? lanes[i + 1].getBoundingClientRect().top : boardBottom;
        if (top < line && end > line + 48) current = l;
      });
    }
    if (!current) { pin.hidden = true; pin.dataset.lane = ""; return; }
    if (pin.dataset.lane !== current.dataset.lane || pin.dataset.sig !== current.querySelector(".kb-lane-head").innerHTML) {
      pin.innerHTML = current.querySelector(".kb-lane-head").innerHTML;
      pin.dataset.sig = current.querySelector(".kb-lane-head").innerHTML;
      pin.dataset.lane = current.dataset.lane;
      pin.style.setProperty("--lane-c", current.style.getPropertyValue("--lane-c"));
      pin.classList.toggle("kb-lane-collapsed", current.classList.contains("kb-lane-collapsed"));
    }
    pin.hidden = false;
  }
  addEventListener("scroll", updateLanePin, { passive: true });
  addEventListener("resize", updateLanePin);

  function cardHTML(t) {
    const ty = typeOf(t.type), pr = prioOf(t.priority);
    const overdue = t.due && t.status !== "done" && daysBetween(t.due, TODAY) < 0;
    const dueSoon = t.due && t.status !== "done" && !overdue && daysBetween(t.due, TODAY) <= 2;
    const est = +t.estimate || 0, log = +t.logged || 0;
    const pct = est ? Math.min(100, Math.round((log / est) * 100)) : 0;
    const over = est && log > est;
    const ep = t.type === "epic" ? null : epic(t.epic);
    const kids = t.type === "epic" ? childrenOf(t.key) : null;
    const kidsDone = kids ? kids.filter((k) => k.status === "done").length : 0;
    const flagBtn = `<button type="button" class="kb-flag-btn${t.flagged ? " on" : ""}" data-flag="${esc(t.key)}" aria-pressed="${!!t.flagged}" title="${t.flagged ? "Remove flag" : "Flag"}" aria-label="${t.flagged ? "Remove flag" : "Flag"} ${esc(t.key)}"><span class="material-symbols-outlined" aria-hidden="true">flag</span></button>`;
    return `<article class="card kb-card${t.flagged ? " kb-flagged" : ""}${t.type === "epic" ? " kb-card-epic" : ""}" data-key="${esc(t.key)}" tabindex="0" aria-label="${esc(t.key + " " + t.title + (t.flagged ? ", flagged" : ""))}">
      <div class="kb-card-top">
        <span class="kb-type kb-type-${ty.key}" title="${ty.label}"><span class="material-symbols-outlined" aria-hidden="true">${ty.icon}</span></span>
        <span class="kb-key">${esc(t.key)}</span>
        <span class="kb-prio kb-prio-${pr.key}" title="${pr.label} priority"><span class="material-symbols-outlined" aria-hidden="true">${pr.icon}</span></span>
        ${state.settings.fields.flag.show || t.flagged ? flagBtn : ""}
      </div>
      <p class="card-title">${esc(t.title)}</p>
      ${ep ? `<p class="kb-parent-epic" title="Parent epic: ${esc(ep.key + " " + ep.title)}"><span class="material-symbols-outlined" aria-hidden="true">bolt</span><span>${esc(ep.title)}</span></p>` : ""}
      ${kids ? `<div class="kb-progress kb-epic-progress" title="${kidsDone} of ${kids.length} child tickets done"><span style="width:${kids.length ? (kidsDone / kids.length) * 100 : 0}%"></span></div>` : ""}
      ${t.status === "ready-for-testing" && t.previousAssignee ? `<p class="kb-handoff"><span class="material-symbols-outlined" aria-hidden="true">swap_horiz</span>From ${esc(firstName(t.previousAssignee))}</p>` : ""}
      ${est ? `<div class="kb-progress${over ? " over" : ""}" title="${fmtH(log)} logged of ${fmtH(est)}"><span style="width:${pct}%"></span></div>` : ""}
      <div class="kb-card-footer">
        <div class="kb-card-chips">
          ${kids ? `<span class="card-cat kb-est kb-epic-count">${kidsDone}/${kids.length} done</span>` : est ? `<span class="card-cat kb-est" title="Remaining of ${fmtH(est)} estimate">${t.status === "done" ? fmtH(est) : fmtH(remaining(t)) + " left"}</span>` : '<span class="card-cat kb-est kb-est-none">No estimate</span>'}
          ${t.due && t.status !== "done" ? `<span class="card-cat kb-due${overdue ? " overdue" : dueSoon ? " soon" : ""}"><span class="material-symbols-outlined" aria-hidden="true">event</span>${fmtDate(t.due)}</span>` : ""}
          ${(t.comments || []).length ? `<span class="kb-meta-ic" title="${t.comments.length} comment${t.comments.length > 1 ? "s" : ""}"><span class="material-symbols-outlined" aria-hidden="true">chat_bubble</span>${t.comments.length}</span>` : ""}
          ${(t.attachments || []).length ? `<span class="kb-meta-ic" title="${t.attachments.length} attachment${t.attachments.length > 1 ? "s" : ""}"><span class="material-symbols-outlined" aria-hidden="true">attach_file</span>${t.attachments.length}</span>` : ""}
        </div>
        ${avatar(t.assignee)}
      </div>
    </article>`;
  }

  // ── Drag and drop (pointer events: mouse drags at once, touch after a
  //    short press so the page still scrolls under a finger) ─────────────
  let drag = null, suppressClick = false;
  function initDrag() {
    document.addEventListener("pointerdown", (e) => {
      const card = e.target.closest(".kb-card");
      if (!card || e.button !== 0 || !$("#kb-board")) return;
      drag = { card, key: card.dataset.key, x: e.clientX, y: e.clientY, type: e.pointerType, active: false, id: e.pointerId };
      if (e.pointerType !== "mouse") {
        drag.timer = setTimeout(() => { if (drag && !drag.active) startDrag(drag.x, drag.y); }, 260);
      }
    });
    document.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.active) {
        const dist = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
        if (drag.type === "mouse" && dist > 5) startDrag(e.clientX, e.clientY);
        else if (drag.type !== "mouse" && dist > 8) { clearTimeout(drag.timer); drag = null; return; }
        else { drag.x = e.clientX; drag.y = e.clientY; return; }
      }
      moveDrag(e.clientX, e.clientY);
    });
    document.addEventListener("touchmove", (e) => { if (drag && drag.active) e.preventDefault(); }, { passive: false });
    document.addEventListener("pointerup", (e) => { if (drag && e.pointerId === drag.id) endDrag(true); });
    document.addEventListener("pointercancel", () => { if (drag) endDrag(false); });
    document.addEventListener("contextmenu", (e) => { if (e.target.closest(".kb-card") && drag) e.preventDefault(); });
    document.addEventListener("click", (e) => {
      const card = e.target.closest(".kb-card");
      if (!card) return;
      if (suppressClick) { suppressClick = false; e.preventDefault(); return; }
      const fb = e.target.closest("[data-flag]");
      if (fb) { toggleFlag(taskByKey(fb.dataset.flag)); return; }
      openTask(card.dataset.key);
    });
    document.addEventListener("keydown", (e) => {
      const card = e.target.closest && e.target.closest(".kb-card");
      if (card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openTask(card.dataset.key); }
    });
  }
  function startDrag(x, y) {
    const r = drag.card.getBoundingClientRect();
    drag.active = true;
    drag.dx = x - r.left; drag.dy = y - r.top;
    const ghost = drag.card.cloneNode(true);
    ghost.classList.add("kb-ghost");
    ghost.style.width = r.width + "px";
    document.body.appendChild(ghost);
    drag.ghost = ghost;
    drag.marker = document.createElement("div");
    drag.marker.className = "kb-drop-marker";
    drag.card.classList.add("kb-dragging");
    document.body.classList.add("kb-drag-active");
    if (navigator.vibrate && drag.type !== "mouse") { try { navigator.vibrate(10); } catch { /* ignore */ } }
    moveDrag(x, y);
  }
  function moveDrag(x, y) {
    drag.ghost.style.transform = `translate(${x - drag.dx}px, ${y - drag.dy}px) rotate(2deg)`;
    const under = document.elementFromPoint(x, y);
    const col = under && under.closest(".kb-col");
    $$(".kb-col.kb-drop-target").forEach((c) => c !== col && c.classList.remove("kb-drop-target"));
    if (!col) { drag.marker.remove(); drag.target = null; autoScroll(x, y); return; }
    col.classList.add("kb-drop-target");
    const list = $(".kb-list", col);
    const cards = $$(".kb-card", list).filter((c) => c !== drag.card);
    const before = cards.find((c) => { const r = c.getBoundingClientRect(); return y < r.top + r.height / 2; });
    if (before) list.insertBefore(drag.marker, before); else list.appendChild(drag.marker);
    drag.target = { status: col.dataset.status, lane: col.dataset.lane, before: before ? before.dataset.key : null };
    autoScroll(x, y);
  }
  function autoScroll(x, y) {
    const edge = 60, wrap = $(".kb-board-wrap");
    if (y < edge + 60) window.scrollBy(0, -14); else if (y > innerHeight - edge) window.scrollBy(0, 14);
    if (wrap) { const r = wrap.getBoundingClientRect(); if (x < r.left + edge) wrap.scrollLeft -= 16; else if (x > r.right - edge) wrap.scrollLeft += 16; }
  }
  function endDrag(commit) {
    const d = drag; drag = null;
    clearTimeout(d.timer);
    if (!d.active) return;
    suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
    d.ghost.remove(); d.marker.remove();
    d.card.classList.remove("kb-dragging");
    document.body.classList.remove("kb-drag-active");
    $$(".kb-col.kb-drop-target").forEach((c) => c.classList.remove("kb-drop-target"));
    if (commit && d.target) moveTask(d.key, d.target.status, d.target.before, d.target.lane);
  }

  // ── Task create / edit modal ────────────────────────────────────────────
  let draft = null, draftIsNew = false;
  const fieldOn = (k) => (state.settings.fields[k] || {}).show;
  const fieldReq = (k) => (state.settings.fields[k] || {}).required;

  function openTask(key) {
    const t = key ? taskByKey(key) : null;
    draftIsNew = !t;
    draft = t ? clone(t) : {
      key: "KAN-" + state.nextKey, type: "task", title: "", description: "", status: "backlog",
      assignee: board.mine ? state.me : "", reporter: state.me, release: state.settings.currentRelease,
      estimate: "", logged: 0, priority: "medium", sprint: "", due: "", labels: [], epic: "",
      comments: [], attachments: [], links: [], previousAssignee: "", activity: [],
    };
    $("#task-title-h").innerHTML = draftIsNew ? "New task" : `<span class="kb-modal-key">${esc(draft.key)}</span>`;
    syncModalFlag();
    renderForm();
    $("#task-backdrop").hidden = false;
    document.body.classList.add("kb-modal-open");
    setTimeout(() => { const f = $("#f-title"); if (f && draftIsNew) f.focus(); }, 30);
  }
  function syncModalFlag() {
    const b = $("#task-flag");
    b.hidden = !(fieldOn("flag") || draft.flagged);
    b.classList.toggle("on", !!draft.flagged);
    b.setAttribute("aria-pressed", String(!!draft.flagged));
    $("#task-flag-label").textContent = draft.flagged ? "Flagged" : "Flag";
    $(".kb-task-panel").classList.toggle("kb-panel-flagged", !!draft.flagged);
  }
  function closeTask() { stopRecorder(true); $("#task-backdrop").hidden = true; document.body.classList.remove("kb-modal-open"); draft = null; }

  function label(k, forId) {
    return `<label class="field-label" for="${forId || "f-" + k}">${esc(FIELD_LABEL[k])}${fieldReq(k) ? '<span class="kb-req" aria-hidden="true">*</span>' : ""}</label>`;
  }
  function fieldHTML(k) {
    const d = draft;
    switch (k) {
      case "voice": return `<div class="kb-voice" id="f-voice">
        <button type="button" class="kb-record-btn" id="f-record" aria-pressed="false"><span class="kb-record-dot"><span class="material-symbols-outlined" aria-hidden="true">mic</span></span><span class="kb-record-text"><span class="kb-record-label" id="f-record-label">Record task</span><span class="kb-record-sub" id="f-record-sub">Say what needs doing</span></span></button>
        ${tip("Talk through the task: what it is, who it's for, how urgent and how long it will take. The agent writes the title and description and fills in priority, type, assignee, release and estimate when you mention them. Check and edit before creating.")}
        <div class="kb-voice-live" id="f-voice-live" hidden></div>
        <p class="mic-error" id="f-voice-error"></p>
      </div>`;
      case "title": return `<div class="kb-field" data-field="title">${label("title")}<input type="text" id="f-title" class="kb-input kb-title-input" maxlength="200" value="${esc(d.title)}" placeholder="What needs doing?"></div>`;
      case "description": return `<div class="kb-field" data-field="description">${label("description")}<div class="desc-wrap"><textarea id="f-description" class="kb-input" rows="5" placeholder="Context, steps to reproduce, acceptance criteria">${esc(d.description)}</textarea>${draftIsNew ? "" : '<button type="button" class="mic-btn kb-desc-mic" id="f-desc-mic" title="Dictate" aria-label="Dictate into the description"><span class="material-symbols-outlined" aria-hidden="true">mic</span></button>'}</div>
        ${draftIsNew ? '<button type="button" class="kb-agent-link" id="f-agent-fill"><span class="material-symbols-outlined" aria-hidden="true">auto_awesome</span><span>Fill in the ticket from this description</span></button>' : '<p class="mic-error" id="f-desc-mic-error"></p>'}</div>`;
      case "status": return `<div class="kb-field" data-field="status">${label("status")}<select id="f-status" class="kb-input">${STATUSES.map((s) => opt(s.key, s.label, d.status)).join("")}</select><p class="kb-inline-note" id="f-status-note" hidden></p></div>`;
      case "assignee": return `<div class="kb-field" data-field="assignee">${label("assignee")}<select id="f-assignee" class="kb-input">${opt("", "Unassigned", d.assignee)}${SEED.users.map((u) => opt(u.id, u.first, d.assignee)).join("")}</select></div>`;
      case "reporter": return `<div class="kb-field" data-field="reporter">${label("reporter")}<select id="f-reporter" class="kb-input">${opt("", "—", d.reporter)}${SEED.users.map((u) => opt(u.id, u.first, d.reporter)).join("")}</select></div>`;
      case "release": return `<div class="kb-field" data-field="release">${label("release")}<select id="f-release" class="kb-input">${opt("", "No release", d.release)}${SEED.releases.map((r) => opt(r.id, r.name + (r.released ? " (released)" : ""), d.release)).join("")}</select></div>`;
      case "estimate": return `<div class="kb-field" data-field="estimate">${label("estimate")}<input type="text" id="f-estimate" class="kb-input" value="${esc(d.estimate === "" || d.estimate == null ? "" : fmtH(d.estimate))}" placeholder="e.g. 1d 4h" inputmode="text"></div>`;
      case "type": return `<div class="kb-field" data-field="type">${label("type", "f-type-task")}<div class="type-toggle kb-type-toggle" role="radiogroup">${TYPES.map((t) => `<button type="button" class="type-opt${d.type === t.key ? " active" : ""}" id="f-type-${t.key}" data-type="${t.key}" role="radio" aria-checked="${d.type === t.key}"><span class="material-symbols-outlined kb-type-${t.key}" aria-hidden="true">${t.icon}</span>${t.label}</button>`).join("")}</div></div>`;
      case "priority": return `<div class="kb-field" data-field="priority">${label("priority")}<select id="f-priority" class="kb-input">${opt("", "—", d.priority)}${PRIORITIES.map((p) => opt(p.key, p.label, d.priority)).join("")}</select></div>`;
      case "sprint": return `<div class="kb-field" data-field="sprint">${label("sprint")}<select id="f-sprint" class="kb-input">${opt("", "No sprint", d.sprint)}${SEED.sprints.map((s) => opt(s.id, `${s.name} · ${s.range}`, d.sprint)).join("")}</select></div>`;
      case "due": return `<div class="kb-field" data-field="due">${label("due")}<input type="date" id="f-due" class="kb-input" value="${esc(d.due)}"></div>`;
      case "logged": {
        const est = +d.estimate || 0, log = +d.logged || 0;
        return `<div class="kb-field" data-field="logged">${label("logged")}<input type="text" id="f-logged" class="kb-input" value="${log ? esc(fmtH(log)) : ""}" placeholder="e.g. 3h">
          <div class="kb-logbar${est && log > est ? " over" : ""}" id="f-logbar"><span style="width:${est ? Math.min(100, (log / est) * 100) : 0}%"></span></div>
          <p class="kb-inline-note" id="f-logtext">${est ? `${fmtH(log)} of ${fmtH(est)} · ${fmtH(Math.max(est - log, 0))} remaining` : "No estimate"}</p></div>`;
      }
      case "labels": return `<div class="kb-field" data-field="labels">${label("labels", "f-label-input")}<div class="kb-labels" id="f-labels">${labelsHTML()}</div>
        <input type="text" id="f-label-input" class="kb-input" list="kb-label-list" placeholder="Add a label and press Enter"><datalist id="kb-label-list">${SEED.labels.map((l) => `<option value="${esc(l)}">`).join("")}</datalist></div>`;
      case "epic": {
        const list = epics().filter((e) => e.key !== d.key);
        return `<div class="kb-field" data-field="epic"${d.type === "epic" ? " hidden" : ""}>${label("epic")}<select id="f-epic" class="kb-input">${opt("", list.length ? "No parent epic" : "No epics yet", d.epic)}${list.map((e) => opt(e.key, `${e.key} · ${e.title}`, d.epic)).join("")}</select></div>`;
      }
      case "children": {
        const kids = childrenOf(d.key);
        const done = kids.filter((k) => k.status === "done").length;
        return `<div class="kb-field" data-field="children"><label class="field-label">Child tickets <span class="kb-none">${done} of ${kids.length} done</span></label>
          ${kids.length ? `<div class="kb-logbar kb-epic-progress"><span style="width:${(done / kids.length) * 100}%"></span></div>` : ""}
          <ul class="kb-sublist kb-children">${kids.sort((a, b) => STATUSES.findIndex((x) => x.key === a.status) - STATUSES.findIndex((x) => x.key === b.status)).map((k) => `<li data-open-child="${esc(k.key)}"><span class="kb-type kb-type-${typeOf(k.type).key}"><span class="material-symbols-outlined" aria-hidden="true">${typeOf(k.type).icon}</span></span><span class="kb-link-key">${esc(k.key)}</span><span class="kb-link-title">${esc(k.title)}</span>${k.flagged ? '<span class="material-symbols-outlined kb-flag-mini" aria-label="Flagged">flag</span>' : ""}<span class="kb-status-pill kb-sp-${k.status}">${esc(STATUSES.find((x) => x.key === k.status).short)}</span>${avatar(k.assignee)}</li>`).join("") || '<li class="kb-none">No tickets in this epic yet. Pick it as the parent epic on a task or bug</li>'}</ul></div>`;
      }
      case "links": return `<div class="kb-field" data-field="links">${label("links", "f-link-key")}
        <ul class="kb-sublist" id="f-links">${linksHTML()}</ul>
        <div class="kb-add-row"><select id="f-link-type" class="kb-input" aria-label="Link type">${["blocks", "is blocked by", "relates to", "duplicates"].map((x) => opt(x, x, "relates to")).join("")}</select>
          <select id="f-link-key" class="kb-input" aria-label="Ticket">${state.tasks.filter((t) => t.key !== d.key).sort((a, b) => a.key.localeCompare(b.key)).map((t) => opt(t.key, `${t.key} · ${t.title}`, "")).join("")}</select>
          <button type="button" class="btn-ghost" id="f-link-add">Link</button></div></div>`;
      case "attachments": return `<div class="kb-field" data-field="attachments">${label("attachments", "f-file")}<ul class="kb-sublist" id="f-attachments">${attachmentsHTML()}</ul>
        <label class="btn-attach kb-attach-btn"><span class="material-symbols-outlined" aria-hidden="true">attach_file</span>Attach file<input type="file" id="f-file" multiple hidden></label></div>`;
      case "comments": return `<div class="kb-field" data-field="comments">${label("comments", "f-comment")}<ul class="kb-comments" id="f-comments">${commentsHTML()}</ul>
        <textarea id="f-comment" class="kb-input" rows="2" placeholder="Add a comment"></textarea>
        <div class="kb-add-row kb-add-row-end"><button type="button" class="btn-ghost" id="f-comment-add">Add comment</button></div></div>`;
    }
    return "";
  }
  const labelsHTML = () => (draft.labels || []).map((l) => `<span class="kb-label-chip">${esc(l)}<button type="button" data-rm-label="${esc(l)}" aria-label="Remove ${esc(l)}">&times;</button></span>`).join("") || '<span class="kb-none">No labels</span>';
  const linksHTML = () => (draft.links || []).map((l, i) => { const t = taskByKey(l.key); return `<li><span class="kb-link-type">${esc(l.type)}</span><span class="kb-link-key">${esc(l.key)}</span><span class="kb-link-title">${esc(t ? t.title : "")}</span>${t ? `<span class="kb-status-pill kb-sp-${t.status}">${esc(STATUSES.find((s) => s.key === t.status).short)}</span>` : ""}<button type="button" class="icon-btn" data-rm-link="${i}" aria-label="Remove link">&times;</button></li>`; }).join("") || '<li class="kb-none">No linked tickets</li>';
  const attachmentsHTML = () => (draft.attachments || []).map((a, i) => `<li><span class="material-symbols-outlined" aria-hidden="true">${/\.(png|jpe?g|gif|webp)$/i.test(a.name) ? "image" : /\.(mov|mp4)$/i.test(a.name) ? "movie" : "description"}</span><span class="kb-link-title">${esc(a.name)}</span><span class="kb-none">${esc(a.size)}</span><button type="button" class="icon-btn" data-rm-att="${i}" aria-label="Remove attachment">&times;</button></li>`).join("") || '<li class="kb-none">No attachments</li>';
  const commentsHTML = () => {
    const items = [...(draft.comments || []).map((c) => ({ ...c, kind: "c" })), ...(draft.activity || []).map((a) => ({ ...a, kind: "a" }))].sort((a, b) => a.at.localeCompare(b.at));
    return items.map((c) => c.kind === "c"
      ? `<li class="kb-comment">${avatar(c.author)}<div><div class="kb-comment-meta"><b>${esc(firstName(c.author))}</b> · ${fmtDate(c.at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div><div class="kb-comment-text">${esc(c.text)}</div></div></li>`
      : `<li class="kb-activity"><span class="material-symbols-outlined" aria-hidden="true">history</span><span><b>${esc(firstName(c.who))}</b> ${esc(c.text)}</span></li>`).join("") || '<li class="kb-none">No comments yet</li>';
  };

  function renderForm() {
    const form = $("#task-form");
    // A new task always starts in Backlog and has nothing to comment on yet.
    const main = draftIsNew ? ["voice", "title", "description", "attachments", "links"] : ["title", "description"].concat(draft.type === "epic" ? ["children"] : [], ["links", "attachments", "comments"]);
    const side = ["priority", "type", "epic", "assignee", "reporter", "release", "estimate", "logged", "sprint", "due", "labels"].concat(draftIsNew ? [] : ["status"]);
    const visible = (k) => k === "voice" || k === "children" || CORE_FIELDS.some((f) => f.key === k) || fieldOn(k);
    const hidden = OPTIONAL_FIELDS.map((f) => f.key).filter((k) => k !== "flag" && !fieldOn(k) && !(draftIsNew && k === "comments"));
    // On an existing ticket, hidden fields stay editable below; a new task shows only the configured form.
    form.innerHTML = `
      <div class="kb-task-grid">
        <div class="kb-task-main">${main.filter(visible).map(fieldHTML).join("")}</div>
        <div class="kb-task-side">${side.filter(visible).map(fieldHTML).join("")}</div>
      </div>
      ${!draftIsNew && hidden.length ? `<details class="kb-more"><summary>${hidden.length} more field${hidden.length > 1 ? "s" : ""}<span class="kb-more-names">${hidden.map((k) => esc(FIELD_LABEL[k])).join(", ")}</span></summary><div class="kb-more-body">${hidden.map(fieldHTML).join("")}</div></details>` : ""}
      ${draftIsNew ? "" : `<p class="kb-created">Created by ${esc(firstName(draft.reporter))} · ${fmtDate(draft.created, { day: "numeric", month: "short", year: "numeric" })}</p>`}
      <p class="tm-error" id="f-error" hidden></p>
      <div class="form-row kb-form-actions">
        ${draftIsNew ? "<span></span>" : '<button type="button" class="btn-ghost fa-actions-delete" id="f-delete"><span class="material-symbols-outlined" aria-hidden="true">delete</span></button>'}
        <div class="form-actions"><button type="button" class="btn-outline" id="f-cancel">Cancel</button><button type="submit" class="btn-primary" id="f-save">${draftIsNew ? "Create task" : "Save"}</button></div>
      </div>`;
    bindForm();
  }
  function bindForm() {
    const form = $("#task-form");
    $$(".kb-type-toggle .type-opt", form).forEach((b) => b.addEventListener("click", () => {
      draft.type = b.dataset.type;
      $$(".kb-type-toggle .type-opt", form).forEach((x) => { x.classList.toggle("active", x === b); x.setAttribute("aria-checked", String(x === b)); });
      const pe = $('[data-field="epic"]', form);
      if (pe) pe.hidden = draft.type === "epic";
    }));
    const st = $("#f-status");
    if (st) st.addEventListener("change", () => {
      const note = $("#f-status-note");
      const tester = state.settings.tester;
      const asg = $("#f-assignee");
      if (st.value === "ready-for-testing" && asg && asg.value !== tester) {
        note.hidden = false; note.textContent = `Will be reassigned to ${firstName(tester)} for testing`;
      } else note.hidden = true;
    });
    const est = $("#f-estimate"), lg = $("#f-logged");
    const syncLog = () => {
      const bar = $("#f-logbar"); if (!bar) return;
      const e = parseDur(est ? est.value : draft.estimate) || 0, l = parseDur(lg.value) || 0;
      bar.classList.toggle("over", e && l > e);
      bar.firstElementChild.style.width = (e ? Math.min(100, (l / e) * 100) : 0) + "%";
      $("#f-logtext").textContent = e ? `${fmtH(l)} of ${fmtH(e)} · ${fmtH(Math.max(e - l, 0))} remaining` : "No estimate";
    };
    if (lg) lg.addEventListener("input", syncLog);
    if (est) est.addEventListener("input", syncLog);
    const li = $("#f-label-input");
    if (li) li.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== ",") return;
      e.preventDefault();
      const v = li.value.trim().toLowerCase().replace(/\s+/g, "-");
      if (v && !draft.labels.includes(v)) draft.labels.push(v);
      li.value = ""; $("#f-labels").innerHTML = labelsHTML();
    });
    form.addEventListener("click", (e) => {
      const rl = e.target.closest("[data-rm-label]");
      if (rl) { draft.labels = draft.labels.filter((x) => x !== rl.dataset.rmLabel); $("#f-labels").innerHTML = labelsHTML(); }
      const rk = e.target.closest("[data-rm-link]");
      if (rk) { draft.links.splice(+rk.dataset.rmLink, 1); $("#f-links").innerHTML = linksHTML(); }
      const ra = e.target.closest("[data-rm-att]");
      if (ra) { draft.attachments.splice(+ra.dataset.rmAtt, 1); $("#f-attachments").innerHTML = attachmentsHTML(); }
    });
    const la = $("#f-link-add");
    if (la) la.addEventListener("click", () => {
      const key = $("#f-link-key").value, type = $("#f-link-type").value;
      if (key && !draft.links.some((l) => l.key === key && l.type === type)) draft.links.push({ type, key });
      $("#f-links").innerHTML = linksHTML();
    });
    const ff = $("#f-file");
    if (ff) ff.addEventListener("change", () => {
      Array.from(ff.files).forEach((f) => draft.attachments.push({ name: f.name, size: f.size > 1048576 ? (f.size / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(f.size / 1024)) + " KB" }));
      ff.value = ""; $("#f-attachments").innerHTML = attachmentsHTML();
    });
    const ca = $("#f-comment-add");
    if (ca) ca.addEventListener("click", () => {
      const ta = $("#f-comment"); const text = ta.value.trim();
      if (!text) return;
      draft.comments.push({ author: state.me, at: new Date().toISOString(), text });
      ta.value = ""; $("#f-comments").innerHTML = commentsHTML();
    });
    bindVoice();
    $$("[data-open-child]", form).forEach((li) => li.addEventListener("click", () => openTask(li.dataset.openChild)));
    $("#f-cancel").addEventListener("click", closeTask);
    const del = $("#f-delete");
    if (del) del.addEventListener("click", () => {
      if (!confirm(`Delete ${draft.key}? This can't be undone.`)) return;
      state.tasks = state.tasks.filter((t) => t.key !== draft.key);
      state.tasks.forEach((t) => { if (t.epic === draft.key) t.epic = ""; });
      save(); toast(`<b>${esc(draft.key)}</b> deleted`); closeTask(); render();
    });
    form.onsubmit = (e) => { e.preventDefault(); submitTask(); };
  }

  // ── Voice capture + agent fill ──────────────────────────────────────────
  // One Record button on a new task: Web Speech dictation, then the "agent"
  // turns the transcript into title, description, priority, type, assignee,
  // release, estimate, due date and labels. Front-end only, so the agent here
  // is a local stand-in; the real console would hand the transcript to Claude.
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  function stopRecorder(abort) {
    if (!rec) return;
    const r = rec; rec = null;
    r.wanted = false;
    clearInterval(r.timer);
    try { abort ? r.inst.abort() : r.inst.stop(); } catch { /* already stopped */ }
    if (!abort && r.onDone) setTimeout(() => r.onDone(r.text()), 250);
    if (r.onState) r.onState("idle");
  }
  async function startRecorder({ onLive, onDone, onState, onError }) {
    if (!SR) { onError("Voice capture isn't supported in this browser. Try Chrome, Edge or Safari, or type the description."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch (e) {
      onError(e && e.name === "NotAllowedError" ? "Microphone access is blocked. Allow it in the browser's site settings and try again."
        : e && e.name === "NotFoundError" ? "No microphone found on this device." : "The microphone couldn't be started.");
      return;
    }
    let finals = "", interim = "";
    const r = { wanted: true, onDone, onState, started: Date.now(), text: () => (finals + " " + interim).replace(/\s+/g, " ").trim() };
    const make = () => {
      const inst = new SR();
      inst.lang = "en-GB"; inst.continuous = true; inst.interimResults = true;
      inst.onresult = (e) => {
        interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) finals += " " + e.results[i][0].transcript; else interim += e.results[i][0].transcript;
        }
        onLive(r.text());
      };
      inst.onerror = (e) => {
        if (e.error === "no-speech" || e.error === "aborted") return;
        r.wanted = false;
        onError(e.error === "not-allowed" ? "Microphone access is blocked. Allow it in the browser's site settings and try again."
          : e.error === "network" ? "Voice capture needs a network connection." : e.error === "audio-capture" ? "No microphone found on this device." : "Voice capture stopped unexpectedly. Try again.");
        stopRecorder(true);
      };
      // Browsers end a session on silence; keep listening until Stop.
      inst.onend = () => { if (rec === r && r.wanted) { try { r.inst = make(); r.inst.start(); } catch { stopRecorder(false); } } };
      return inst;
    };
    r.inst = make();
    rec = r;
    try { r.inst.start(); } catch { onError("Voice capture couldn't start. Try again."); rec = null; return; }
    onState("recording");
    r.timer = setInterval(() => onState("recording"), 1000);
  }

  function bindVoice() {
    const btn = $("#f-record");
    if (btn) {
      const label = $("#f-record-label"), sub = $("#f-record-sub"), live = $("#f-voice-live"), err = $("#f-voice-error");
      const setState = (st) => {
        btn.classList.toggle("recording", st === "recording");
        btn.classList.toggle("working", st === "working");
        btn.setAttribute("aria-pressed", String(st === "recording"));
        if (st === "recording") {
          const secs = rec ? Math.floor((Date.now() - rec.started) / 1000) : 0;
          label.textContent = "Stop recording"; sub.textContent = `Listening · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
        } else if (st === "working") { label.textContent = "Writing the ticket…"; sub.textContent = "Agent"; }
        else { label.textContent = draft && draft.title ? "Record again" : "Record task"; sub.textContent = draft && draft.title ? "Replaces the details below" : "Say what needs doing"; }
      };
      btn.addEventListener("click", () => {
        if (btn.classList.contains("working")) return;
        if (rec) { stopRecorder(false); return; }
        err.classList.remove("on");
        live.hidden = false; live.textContent = "";
        live.classList.add("placeholder"); live.textContent = "Listening…";
        startRecorder({
          onLive: (t) => { live.classList.remove("placeholder"); live.textContent = t; },
          onState: setState,
          onError: (m) => { err.textContent = m; err.classList.add("on"); live.hidden = true; setState("idle"); },
          onDone: (t) => {
            if (!t) { live.hidden = true; err.textContent = "Nothing was heard. Try again, closer to the microphone."; err.classList.add("on"); setState("idle"); return; }
            runAgent(t, setState);
          },
        });
      });
    }
    const fill = $("#f-agent-fill");
    if (fill) fill.addEventListener("click", () => {
      const t = ($("#f-description") || {}).value || "";
      if (!t.trim()) { $("#f-description").focus(); return; }
      runAgent(t, () => {});
    });
    const mic = $("#f-desc-mic");
    if (mic) mic.addEventListener("click", () => {
      const ta = $("#f-description"), err = $("#f-desc-mic-error");
      if (rec) { stopRecorder(false); return; }
      err.classList.remove("on");
      const base = ta.value.trim();
      startRecorder({
        onLive: (t) => { ta.value = (base ? base + " " : "") + t; },
        onState: (st) => mic.classList.toggle("listening", st === "recording"),
        onError: (m) => { err.textContent = m; err.classList.add("on"); mic.classList.remove("listening"); },
        onDone: () => {},
      });
    });
  }

  function runAgent(transcript, setState) {
    setState("working");
    const form = $("#task-form");
    form.classList.add("kb-agent-working");
    setTimeout(() => {
      form.classList.remove("kb-agent-working");
      if (!draft) return;
      const out = agentDraft(transcript);
      const filled = [];
      const put = (id, field, v) => { const el = $("#" + id); if (el && v != null && v !== "") { el.value = v; filled.push(field); } };
      put("f-title", "title", out.title);
      put("f-description", "description", out.description);
      put("f-priority", "priority", out.priority);
      put("f-assignee", "assignee", out.assignee);
      put("f-release", "release", out.release);
      put("f-estimate", "estimate", out.estimate != null ? fmtH(out.estimate) : "");
      put("f-due", "due", out.due);
      put("f-sprint", "sprint", out.sprint);
      put("f-epic", "epic", out.epic);
      if (out.flagged && !draft.flagged) { draft.flagged = true; syncModalFlag(); filled.push("flag"); }
      if (out.type) {
        draft.type = out.type; filled.push("type");
        const pe = $('[data-field="epic"]', form); if (pe) pe.hidden = out.type === "epic";
        $$(".kb-type-toggle .type-opt", form).forEach((x) => { const on = x.dataset.type === out.type; x.classList.toggle("active", on); x.setAttribute("aria-checked", String(on)); });
      }
      if (out.labels.length && $("#f-labels")) { draft.labels = Array.from(new Set([...(draft.labels || []), ...out.labels])); $("#f-labels").innerHTML = labelsHTML(); filled.push("labels"); }
      draft.title = out.title;
      $$(".kb-agent-filled", form).forEach((x) => x.classList.remove("kb-agent-filled"));
      filled.forEach((k) => { const f = $(`[data-field="${k}"]`, form); if (f) f.classList.add("kb-agent-filled"); });
      const live = $("#f-voice-live"); if (live) live.hidden = true;
      setState("idle");
      const est = $("#f-estimate"); if (est) est.dispatchEvent(new Event("input"));
      toast(`Agent filled in ${filled.length} field${filled.length === 1 ? "" : "s"}. Check them before creating`);
    }, 900);
  }

  // Local stand-in for the agent: reads the transcript for the details people
  // usually say out loud and writes a short title and a tidy description.
  const fold = (x) => String(x).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase();
  const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, half: 0.5, couple: 2 };
  function agentDraft(raw) {
    let text = raw.replace(/\s+/g, " ").trim();
    const low = fold(text);
    const out = { labels: [] };
    // assignee: "assign it to Minh", "for Huy to do", "Linh should pick this up"
    for (const u of SEED.users) {
      const n = fold(u.first);
      if (new RegExp(`\\b(assign(ed)?( it| this)? to|give (it|this) to|for|ask) ${n}\\b|\\b${n} (should|can|could|to) (pick|take|do|look)`).test(low)) { out.assignee = u.id; break; }
    }
    if (/\b(urgent|asap|as soon as possible|critical|blocker|blocking|show ?stopper|top priority|highest priority)\b/.test(low)) out.priority = "highest";
    else if (/\b(high priority|important|quite urgent|soon as we can)\b/.test(low)) out.priority = "high";
    else if (/\b(lowest priority)\b/.test(low)) out.priority = "lowest";
    else if (/\b(low priority|nice to have|no rush|whenever|not urgent)\b/.test(low)) out.priority = "low";
    else if (/\b(medium priority|normal priority)\b/.test(low)) out.priority = "medium";
    if (/\b(bug|broken|breaks|fails?|failing|failed|error|crash(es|ing)?|doesn'?t work|isn'?t working|not working|wrong|regression|missing)\b/.test(low)) out.type = "bug";
    else if (/\b(epic|programme of work|umbrella)\b/.test(low)) out.type = "epic";
    else out.type = "task";
    const est = low.match(/\b(\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|half|couple)\s*(?:of\s*)?(?:an?\s*)?(hours?|hrs?|days?|minutes?|mins?)\b/);
    if (est && /(take|estimate|about|around|roughly|should be|needs?|maybe|probably|half)/.test(low.slice(Math.max(0, est.index - 30), est.index + est[0].length))) {
      const n = NUM[est[1]] != null ? NUM[est[1]] : +est[1];
      out.estimate = /^d/.test(est[2]) ? n * 8 : /^m/.test(est[2]) ? Math.round((n / 60) * 4) / 4 : n;
    }
    const relM = low.match(/\b4[ .]1([123])\b/);
    if (relM) out.release = "4.1" + relM[1];
    else if (/\bnext release\b/.test(low)) out.release = "4.13";
    else if (/\b(this|current) release\b/.test(low)) out.release = state.settings.currentRelease;
    if (/\bnext sprint\b/.test(low)) out.sprint = "s42"; else if (/\bthis sprint\b/.test(low)) out.sprint = "s41";
    const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const byDay = low.match(/\bby (tomorrow|end of (the )?week|monday|tuesday|wednesday|thursday|friday)\b/);
    if (byDay) {
      const d = new Date(TODAY);
      if (byDay[1] === "tomorrow") d.setDate(d.getDate() + 1);
      else { const target = byDay[1].startsWith("end") ? 5 : days.indexOf(byDay[1]); let add = (target - d.getDay() + 7) % 7; if (!add) add = 7; d.setDate(d.getDate() + add); }
      out.due = d.toISOString().slice(0, 10);
    }
    if (/\b(flag (it|this)|flagged|blocked)\b/.test(low)) out.flagged = true;
    if (out.type !== "epic") {
      const ep = epics().find((e) => { const name = fold(e.title.split(" — ")[0]); return low.includes(name) || (/\bepic\b/.test(low) && name.split(" ").filter((w) => w.length > 3).every((w) => low.includes(w))); });
      if (ep) out.epic = ep.key;
    }
    const LABELS = [["menu-boards", /menu ?boards?|local offers?|offer/], ["dsp", /\bdsp\b|partner api|exchange|display types?|playlist|advertis/], ["help-centre", /help cent(re|er)|faq|freshdesk/], ["retail-admin", /retail admin|queue|appointment|store hours/], ["hq-admin", /hq admin|product assets|stockists|pricing page/], ["visitor-profile", /visitor profile|personali[sz]ation attribute|attribute/], ["performance", /slow|performance|latency|speed/], ["accessibility", /accessib|screen reader|wcag|contrast/], ["security", /security|permission|consent|rate.?limit/], ["api", /\bapi\b|endpoint|webhook/]];
    LABELS.forEach(([l, re]) => { if (re.test(low)) out.labels.push(l); });

    // Description: the transcript, minus the routing talk, in tidy sentences.
    const ROUTING = /\b(assign(ed)? (it |this )?to \S+|give (it|this) to \S+|(it'?s |this is |make it )?(urgent|high priority|low priority|medium priority|top priority|nice to have|no rush)|((for|in) )?(the )?(next|this|current) (release|sprint)|(it )?(should|will|might) take (about |around |roughly )?\S+ (hours?|days?|minutes?)|by (tomorrow|end of (the )?week|monday|tuesday|wednesday|thursday|friday)|(maybe|about|around|roughly|probably|approximately) (\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten|half an?|a couple of) (hours?|days?|minutes?))\b[,.]?/gi;
    const sentences = text.split(/(?<=[.!?])\s+|\s+(?:and then|also|and also)\s+/i).map((x) => x.replace(ROUTING, "").replace(/\s+([,.])/g, "$1").replace(/^[\s,]*(and|so|um+|uh+|okay|ok|right)[\s,]+/i, "").trim()).filter((x) => x.replace(/[^a-z]/gi, "").length > 3);
    if (out.assignee) {
      const u = user(out.assignee), names = Array.from(new Set([u.first, fold(u.first)])).join("|");
      const re = new RegExp(`\\b((this is|it'?s) )?(for|ask) (${names})( to (do|pick up|look at|take))?\\b[,.]?|\\b(${names}) (should|can|could) (pick (it|this) up|take (it|this)|do (it|this)|look at (it|this))\\b[,.]?`, "gi");
      for (let i = 0; i < sentences.length; i++) sentences[i] = sentences[i].replace(re, "").replace(/\s+([,.])/g, "$1").trim();
      for (let i = sentences.length - 1; i >= 0; i--) if (sentences[i].replace(/[^a-z]/gi, "").length <= 3) sentences.splice(i, 1);
    }
    const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
    out.description = sentences.map((x) => cap(x).replace(/[,\s]+$/, "") + (/[.!?]$/.test(x) ? "" : ".")).join(" ");

    // Title: the first sentence with the filler taken off, at most ~70 chars.
    let t = (sentences[0] || text)
      .replace(/^(so |ok(ay)? |right |um+ |uh+ )+/i, "")
      .replace(/^(we|i)('d| would)? (need|want|like|have) to (get |have )?/i, "")
      .replace(/^(can|could) (you|we|someone) (please )?/i, "")
      .replace(/^(please |there'?s an? (bug|issue|problem) (where|with|in) |there is an? (bug|issue|problem) (where|with|in) |it'?s (a bug|an issue) (where|with) )/i, "")
      .replace(/^(add|create|make) (a )?(ticket|task) (to |for )?/i, "")
      .replace(/^the /i, "")
      .replace(/[.!?,]+$/, "").trim();
    if (t.length > 72) { t = t.slice(0, 72); t = t.slice(0, t.lastIndexOf(" ")); }
    out.title = cap(t);
    return out;
  }

  function submitTask() {
    const form = $("#task-form");
    const val = (id) => { const el = $("#" + id, form); return el ? el.value : undefined; };
    const next = clone(draft);
    const set = (k, v) => { if (v !== undefined) next[k] = v; };
    set("title", val("f-title") !== undefined ? val("f-title").trim() : undefined);
    set("description", val("f-description"));
    set("assignee", val("f-assignee"));
    set("reporter", val("f-reporter"));
    set("release", val("f-release"));
    set("priority", val("f-priority"));
    set("sprint", val("f-sprint"));
    set("due", val("f-due"));
    set("epic", val("f-epic"));
    const errors = [];
    if (val("f-estimate") !== undefined) {
      const p = parseDur(val("f-estimate"));
      if (Number.isNaN(p)) errors.push(["estimate", "Estimate: use a format like 1d 4h, 6h or 30m"]); else next.estimate = p == null ? "" : p;
    }
    if (val("f-logged") !== undefined) {
      const p = parseDur(val("f-logged"));
      if (Number.isNaN(p)) errors.push(["logged", "Time logged: use a format like 3h or 1d 2h"]); else next.logged = p || 0;
    }
    const pendingComment = val("f-comment");
    if (pendingComment && pendingComment.trim()) next.comments.push({ author: state.me, at: new Date().toISOString(), text: pendingComment.trim() });

    // Required fields that are on the form
    [...CORE_FIELDS, ...OPTIONAL_FIELDS].forEach((f) => {
      if (!fieldReq(f.key) || !$(`[data-field="${f.key}"]`, form) || $(`.kb-more [data-field="${f.key}"]`, form)) return;
      if (f.key === "epic" && next.type === "epic") return;
      if (f.key === "flag") return;
      const v = f.key === "links" ? next.links.length : next[f.key];
      const empty = Array.isArray(v) ? !v.length : v === "" || v == null || (f.key === "logged" && !v);
      if (empty && !errors.some((x) => x[0] === f.key)) errors.push([f.key, `${f.label} is required`]);
    });
    $$(".kb-field-error", form).forEach((x) => x.classList.remove("kb-field-error"));
    const err = $("#f-error");
    if (errors.length) {
      errors.forEach(([k]) => { const f = $(`[data-field="${k}"]`, form); if (f) f.classList.add("kb-field-error"); });
      err.hidden = false; err.textContent = errors.map((x) => x[1]).join(" · ");
      return;
    }
    if (next.type === "epic") next.epic = "";
    const newStatus = val("f-status") || draft.status;
    const wasEpic = (taskByKey(next.key) || {}).type === "epic";
    if (wasEpic && next.type !== "epic") {
      const kids = childrenOf(next.key);
      kids.forEach((k) => { k.epic = ""; });
      if (kids.length) setTimeout(() => toast(`${kids.length} ticket${kids.length > 1 ? "s" : ""} no longer ha${kids.length > 1 ? "ve" : "s"} a parent epic`), 3700);
    }
    const existing = taskByKey(next.key);
    if (existing) {
      const prevStatus = existing.status;
      next.status = prevStatus;
      Object.assign(existing, next);
      if (newStatus !== prevStatus) {
        const inCol = state.tasks.filter((t) => t.status === newStatus);
        existing.rank = inCol.length ? Math.max(...inCol.map((t) => t.rank)) + 10 : 10;
        setStatus(existing, newStatus);
      } else toast(`<b>${esc(existing.key)}</b> saved`);
    } else {
      next.status = "backlog";
      next.created = new Date().toISOString();
      next.activity = [];
      const inCol = state.tasks.filter((t) => t.status === newStatus);
      next.rank = inCol.length ? Math.max(...inCol.map((t) => t.rank)) + 10 : 10;
      state.tasks.push(next);
      state.nextKey++;
      if (newStatus !== "backlog") setStatus(next, newStatus, { silent: true });
      next.activity = [];
      toast(`<b>${esc(next.key)}</b> created in ${esc(STATUS_LABEL[next.status])}${next.status === "ready-for-testing" ? ` · assigned to ${esc(firstName(next.assignee))}` : ""}`);
    }
    save(); closeTask(); render();
  }
  function initModal() {
    $("#task-flag").addEventListener("click", () => { if (draft) { draft.flagged = !draft.flagged; syncModalFlag(); } });
    $("#task-close").addEventListener("click", closeTask);
    $("#task-backdrop").addEventListener("click", (e) => { if (e.target.id === "task-backdrop") closeTask(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#task-backdrop").hidden) closeTask(); });
  }

  // ── Release report ──────────────────────────────────────────────────────
  const REPORT_KEYS = ["release", "assignee", "status", "type", "priority", "sprint", "label", "epic"];
  function renderReport(view, params) {
    const f = Object.fromEntries(REPORT_KEYS.map((k) => [k, params.get(k) || ""]));
    if (!params.has("release")) f.release = state.settings.currentRelease;
    if (!f.status) f.status = "outstanding";
    const rel = release(f.release);

    const inScope = state.tasks.filter((t) => t.type !== "epic" && (!f.release || f.release === "all" || t.release === f.release));
    const filtered = inScope.filter((t) => {
      if (f.status === "outstanding" ? t.status === "done" : f.status !== "all" && t.status !== f.status) return false;
      if (f.assignee && (t.assignee || "none") !== f.assignee) return false;
      if (f.type && t.type !== f.type) return false;
      if (f.priority && t.priority !== f.priority) return false;
      if (f.sprint && t.sprint !== f.sprint) return false;
      if (f.label && !(t.labels || []).includes(f.label)) return false;
      if (f.epic && t.epic !== f.epic) return false;
      return true;
    });
    const outstanding = filtered.filter((t) => t.status !== "done");
    const totalRem = outstanding.reduce((n, t) => n + remaining(t), 0);
    const totalEst = filtered.reduce((n, t) => n + (+t.estimate || 0), 0);
    const totalLog = filtered.reduce((n, t) => n + (+t.logged || 0), 0);
    const doneInRel = inScope.filter((t) => t.status === "done").length;
    const noEstimate = outstanding.filter((t) => !(+t.estimate)).length;
    const wd = rel && !rel.released ? workingDaysUntil(rel.date) : 0;
    const capPer = wd * 6;

    // per person
    const people = [...SEED.users.map((u) => u.id), ""].map((id) => {
      const mine = filtered.filter((t) => (t.assignee || "") === id);
      const out = mine.filter((t) => t.status !== "done");
      return {
        id, tasks: mine, out,
        byStatus: Object.fromEntries(STATUSES.map((s) => [s.key, mine.filter((t) => t.status === s.key).length])),
        est: mine.reduce((n, t) => n + (+t.estimate || 0), 0),
        log: mine.reduce((n, t) => n + (+t.logged || 0), 0),
        rem: out.reduce((n, t) => n + remaining(t), 0),
      };
    }).filter((p) => p.tasks.length);
    people.sort((a, b) => b.rem - a.rem || b.out.length - a.out.length);
    const maxRem = Math.max(1, ...people.map((p) => p.rem));
    const scale = Math.max(maxRem, capPer || 0);
    const statusCols = STATUSES.filter((s) => f.status === "all" || s.key !== "done");

    const sel = (k, all, items) => `<label class="kb-rfilter"><span>${esc(all[0])}</span><select data-rf="${k}">${items}</select></label>`;
    const relItems = SEED.releases.map((r) => opt(r.id, r.name + (r.id === state.settings.currentRelease ? " (current)" : r.released ? " (released)" : ""), f.release)).join("") + opt("all", "All releases", f.release);
    const anyExtra = f.assignee || f.type || f.priority || f.sprint || f.label || f.epic || f.status !== "outstanding" || f.release !== state.settings.currentRelease;

    const capState = (p) => {
      if (!capPer || !p.id) return "";
      const r = p.rem / capPer;
      const s = r > 1 ? ["bad", "Over capacity"] : r > 0.8 ? ["pending", "Tight"] : ["ok", "On track"];
      return `<span class="kb-cap"><span class="health-dot health-dot-${s[0]}" aria-hidden="true"></span>${s[1]}</span>`;
    };

    view.innerHTML = `
      <div class="page-header">
        <h2>Release report</h2>
        <span class="page-header-count">${esc(f.release === "all" ? "All releases" : releaseName(f.release))}</span>
        <div class="kb-header-actions">
          <button type="button" class="btn-ghost kb-icon-label" id="rp-copy"><span class="material-symbols-outlined" aria-hidden="true">link</span>Copy link</button>
          <button type="button" class="btn-ghost kb-icon-label" data-route="kanban"><span class="material-symbols-outlined" aria-hidden="true">view_kanban</span>Kanban board</button>
        </div>
      </div>
      <div class="kb-filters kb-report-filters">
        ${sel("release", ["Release"], relItems)}
        ${sel("status", ["Status"], opt("outstanding", "Outstanding (not Done)", f.status) + opt("all", "All, including Done", f.status) + STATUSES.map((s) => opt(s.key, s.label, f.status)).join(""))}
        ${sel("assignee", ["Staff member"], opt("", "Everyone", f.assignee) + SEED.users.map((u) => opt(u.id, u.first, f.assignee)).join("") + opt("none", "Unassigned", f.assignee))}
        ${sel("type", ["Type"], opt("", "All types", f.type) + TYPES.filter((t) => t.key !== "epic").map((t) => opt(t.key, t.label, f.type)).join(""))}
        ${sel("priority", ["Priority"], opt("", "All priorities", f.priority) + PRIORITIES.map((p) => opt(p.key, p.label, f.priority)).join(""))}
        ${sel("sprint", ["Sprint"], opt("", "All sprints", f.sprint) + SEED.sprints.map((s) => opt(s.id, s.name, f.sprint)).join(""))}
        ${sel("label", ["Label"], opt("", "All labels", f.label) + SEED.labels.map((l) => opt(l, l, f.label)).join(""))}
        ${sel("epic", ["Epic"], opt("", "All epics", f.epic) + epics().map((e) => opt(e.key, e.title, f.epic)).join(""))}
        ${anyExtra ? '<button type="button" class="link-btn kb-clear" id="rp-reset">Reset to current release</button>' : ""}
      </div>

      <div class="kb-kpis">
        <div class="kb-kpi"><div class="kb-kpi-label">Outstanding tasks${tip("Tasks in the selected release and filters that are not in Done.")}</div><div class="kb-kpi-value">${outstanding.length}</div><div class="kb-kpi-sub">${doneInRel} done in release${outstanding.filter((t) => t.flagged).length ? ` · <span class="kb-kpi-flag"><span class="material-symbols-outlined" aria-hidden="true">flag</span>${outstanding.filter((t) => t.flagged).length} flagged</span>` : ""}</div></div>
        <div class="kb-kpi"><div class="kb-kpi-label">Remaining effort${tip("Sum of estimate minus time logged on each outstanding task, never below zero. 1d = 8h.")}</div><div class="kb-kpi-value">${fmtH(totalRem)}</div><div class="kb-kpi-sub">${noEstimate ? `${noEstimate} without estimate` : "All estimated"}</div></div>
        <div class="kb-kpi"><div class="kb-kpi-label">Time logged${tip("Time logged against the filtered tasks, as a share of their total estimate.")}</div><div class="kb-kpi-value">${fmtH(totalLog)}</div><div class="kb-kpi-sub">${totalEst ? Math.round((totalLog / totalEst) * 100) + "% of " + fmtH(totalEst) : "—"}</div></div>
        <div class="kb-kpi"><div class="kb-kpi-label">Release date${tip("Working days (Mon–Fri) from today to the release date.")}</div><div class="kb-kpi-value">${rel ? fmtDate(rel.date) : "—"}</div><div class="kb-kpi-sub">${rel ? (rel.released ? "Released" : `${wd} working days left`) : "Pick a release"}</div></div>
      </div>

      <section class="docs-block kb-report-block">
        <div class="docs-block-header"><h3>Remaining effort by staff member${tip(capPer ? `Bar length is remaining effort. Capacity assumes 6 focused hours per working day until release: ${fmtH(capPer)} each.` : "Bar length is remaining effort.")}</h3></div>
        <div class="kb-bars" id="rp-bars">
          ${people.filter((p) => p.out.length).map((p) => `<button type="button" class="kb-bar-row" data-person="${p.id || "none"}" data-tip="${esc(`${firstName(p.id)}: ${fmtH(p.rem)} remaining · ${p.out.length} task${p.out.length === 1 ? "" : "s"}${capPer && p.id ? ` · ${Math.round((p.rem / capPer) * 100)}% of capacity` : ""}`)}">
            <span class="kb-bar-name">${avatar(p.id)}${esc(firstName(p.id))}</span>
            <span class="kb-bar-track">${capPer && p.id ? `<span class="kb-bar-cap" style="left:${(capPer / scale) * 100}%"></span>` : ""}<span class="kb-bar-fill" style="width:${(p.rem / scale) * 100}%"></span></span>
            <span class="kb-bar-val">${fmtH(p.rem)}</span>
          </button>`).join("") || '<p class="empty-hint">No outstanding tasks</p>'}
        </div>
        ${capPer ? `<div class="kb-bar-legend"><span class="kb-leg-fill"></span>Remaining<span class="kb-leg-cap"></span>Capacity to ${fmtDate(rel.date)}</div>` : ""}
      </section>

      <section class="docs-block kb-report-block">
        <div class="docs-block-header"><h3>Breakdown by staff member${tip("Click a row to filter the report to that person. Ready for Testing tasks sit with the tester.")}</h3></div>
        <div class="archive-table-wrap">
          <table class="archive-table kb-table">
            <thead><tr><th>Staff member</th><th class="num">Tasks</th>${statusCols.map((s) => `<th class="num">${esc(s.short)}</th>`).join("")}<th class="num">Estimate</th><th class="num">Logged</th><th class="num">Remaining</th>${capPer ? "<th>Capacity</th>" : ""}</tr></thead>
            <tbody>
              ${people.map((p) => `<tr class="kb-click-row${f.assignee === (p.id || "none") ? " kb-row-on" : ""}" data-person="${p.id || "none"}"><td><span class="kb-person-cell">${avatar(p.id)}${esc(firstName(p.id))}</span></td><td class="num">${p.tasks.length}</td>${statusCols.map((s) => `<td class="num${p.byStatus[s.key] ? "" : " kb-zero"}">${p.byStatus[s.key] || "–"}</td>`).join("")}<td class="num">${fmtH(p.est)}</td><td class="num">${fmtH(p.log)}</td><td class="num"><b>${fmtH(p.rem)}</b></td>${capPer ? `<td>${capState(p)}</td>` : ""}</tr>`).join("") || `<tr><td colspan="${6 + statusCols.length}" class="empty-hint">No tasks match these filters</td></tr>`}
            </tbody>
            ${people.length ? `<tfoot><tr><td><b>Total</b></td><td class="num"><b>${filtered.length}</b></td>${statusCols.map((s) => `<td class="num"><b>${filtered.filter((t) => t.status === s.key).length || "–"}</b></td>`).join("")}<td class="num"><b>${fmtH(totalEst)}</b></td><td class="num"><b>${fmtH(totalLog)}</b></td><td class="num"><b>${fmtH(totalRem)}</b></td>${capPer ? "<td></td>" : ""}</tr></tfoot>` : ""}
          </table>
        </div>
      </section>

      <section class="docs-block kb-report-block">
        <div class="docs-block-header"><h3>${f.status === "outstanding" ? "Outstanding tasks" : "Tasks"} <span class="kb-h-count">${filtered.length}</span>${tip("Grouped by staff member. Click a task to open it.")}</h3></div>
        <div class="archive-table-wrap">
          <table class="archive-table kb-table">
            <thead><tr><th>Task</th><th>Status</th><th>Priority</th><th>Sprint</th><th>Due</th><th class="num">Estimate</th><th class="num">Logged</th><th class="num">Remaining</th></tr></thead>
            <tbody>
              ${people.map((p) => `<tr class="kb-group-row"><td colspan="8"><span class="kb-person-cell">${avatar(p.id)}<b>${esc(firstName(p.id))}</b><span class="kb-none">${p.tasks.length} task${p.tasks.length === 1 ? "" : "s"} · ${fmtH(p.rem)} remaining</span></span></td></tr>` +
                p.tasks.slice().sort((a, b) => STATUSES.findIndex((s) => s.key === a.status) - STATUSES.findIndex((s) => s.key === b.status) || a.rank - b.rank).map((t) => {
                  const overdue = t.due && t.status !== "done" && daysBetween(t.due, TODAY) < 0;
                  const pr = prioOf(t.priority), ty = typeOf(t.type);
                  return `<tr class="kb-click-row" data-open="${esc(t.key)}"><td><span class="kb-task-cell"><span class="kb-type kb-type-${ty.key}"><span class="material-symbols-outlined" aria-hidden="true">${ty.icon}</span></span><span class="kb-key">${esc(t.key)}</span><span class="archive-row-title">${esc(t.title)}</span>${t.flagged ? '<span class="material-symbols-outlined kb-flag-mini" title="Flagged" aria-label="Flagged">flag</span>' : ""}</span></td>
                    <td><span class="kb-status-pill kb-sp-${t.status}">${esc(STATUSES.find((s) => s.key === t.status).short)}</span></td>
                    <td><span class="kb-prio-cell kb-prio-${pr.key}"><span class="material-symbols-outlined" aria-hidden="true">${pr.icon}</span>${pr.label}</span></td>
                    <td class="archive-row-date">${esc(sprint(t.sprint) ? sprint(t.sprint).name : "—")}</td>
                    <td class="archive-row-date${overdue ? " kb-overdue" : ""}">${t.due ? fmtDate(t.due) : "—"}</td>
                    <td class="num">${fmtH(t.estimate)}</td><td class="num">${fmtH(t.logged)}</td><td class="num"><b>${t.status === "done" ? "—" : +t.estimate ? fmtH(remaining(t)) : "—"}</b></td></tr>`;
                }).join("")).join("") || '<tr><td colspan="8" class="empty-hint">No tasks match these filters</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>`;

    const update = (k, v) => {
      const next = Object.fromEntries(REPORT_KEYS.map((x) => [x, f[x]]));
      next[k] = v;
      if (next.status === "outstanding") delete next.status;
      Object.keys(next).forEach((x) => { if (!next[x] && x !== "release") delete next[x]; });
      go("report", next);
    };
    $$("[data-rf]", view).forEach((s) => s.addEventListener("change", () => update(s.dataset.rf, s.value)));
    const reset = $("#rp-reset");
    if (reset) reset.addEventListener("click", () => go("report"));
    $$("[data-person]", view).forEach((r) => r.addEventListener("click", () => update("assignee", f.assignee === r.dataset.person ? "" : r.dataset.person)));
    $$("[data-open]", view).forEach((r) => r.addEventListener("click", () => openTask(r.dataset.open)));
    $("#rp-copy").addEventListener("click", () => {
      const url = location.href;
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast("Report link copied"), () => toast("Copy the address bar to share this view"));
    });
    // bar hover tooltip
    const bt = $("#kb-bar-tip");
    $$(".kb-bar-row", view).forEach((b) => {
      b.addEventListener("pointermove", (e) => { bt.hidden = false; bt.textContent = b.dataset.tip; bt.style.left = Math.min(e.clientX + 14, innerWidth - bt.offsetWidth - 8) + "px"; bt.style.top = e.clientY + 14 + "px"; });
      b.addEventListener("pointerleave", () => { bt.hidden = true; });
    });
  }

  // ── Kanban settings ─────────────────────────────────────────────────────
  function renderSettings(view) {
    const S = state.settings;
    const row = (f, core) => {
      const c = S.fields[f.key];
      return `<div class="kb-set-row${core ? " kb-set-core" : ""}">
        <span class="kb-set-name">${esc(f.label)}${core && f.lockRequired ? '<span class="kb-set-tag">Always required</span>' : ""}</span>
        <label class="kb-set-toggle"><span class="kb-set-col">Show</span><input type="checkbox" data-show="${f.key}" ${c.show ? "checked" : ""} ${core ? "disabled" : ""} aria-label="Show ${esc(f.label)} on the form"></label>
        <label class="kb-set-toggle"><span class="kb-set-col">Required</span><input type="checkbox" data-req="${f.key}" ${c.required ? "checked" : ""} ${f.lockRequired || !c.show || ["comments", "attachments", "flag"].includes(f.key) ? "disabled" : ""} aria-label="${esc(f.label)} required"></label>
      </div>`;
    };
    view.innerHTML = `
      <div class="page-header">
        <h2>Kanban settings</h2>
        <button type="button" class="btn-ghost kb-icon-label page-header-action" data-route="kanban"><span class="material-symbols-outlined" aria-hidden="true">view_kanban</span>Kanban board</button>
      </div>
      <div class="kb-settings">
        <section class="docs-block">
          <div class="docs-block-header"><h3>Task form fields${tip("Choose which optional fields appear on the create / edit form and which must be filled in. Hidden fields stay settable over MCP and editable later on an existing ticket.")}</h3>
            <button type="button" class="btn-ghost" id="st-preview">Preview form</button></div>
          <div class="kb-set-group-label">Core</div>
          ${CORE_FIELDS.map((f) => row(f, true)).join("")}
          <div class="kb-set-group-label">Optional</div>
          ${OPTIONAL_FIELDS.map((f) => row(f, false)).join("")}
        </section>
        <section class="docs-block">
          <div class="docs-block-header"><h3>Workflow${tip("Moving a task into Ready for Testing reassigns it to this person. Moving it back to In Progress or Ready for Dev returns it to the developer.")}</h3></div>
          <label class="field-label" for="st-tester">Ready for Testing reassigns to</label>
          <select id="st-tester" class="kb-input">${SEED.users.map((u) => opt(u.id, u.first, S.tester)).join("")}</select>
          <label class="field-label" for="st-release">Current release</label>
          <select id="st-release" class="kb-input">${SEED.releases.filter((r) => !r.released).map((r) => opt(r.id, `${r.name} · ${fmtDate(r.date, { day: "numeric", month: "short", year: "numeric" })}`, S.currentRelease)).join("")}</select>
        </section>
        <section class="docs-block">
          <div class="docs-block-header"><h3>Team${tip("Everyone added under Settings → Team & agent access appears in the assignee list by first name.")}</h3></div>
          <ul class="kb-team">${SEED.users.map((u) => `<li>${avatar(u.id)}<span><b>${esc(u.first)}</b><span class="kb-none">${esc(u.full)} · ${esc(u.location)}</span></span><span class="kb-none kb-team-email">${esc(u.email)}</span></li>`).join("")}</ul>
        </section>
        <section class="docs-block">
          <div class="docs-block-header"><h3>Demo data${tip("Prototype only: puts every task back to the mock data and clears your changes.")}</h3>
            <button type="button" class="btn-ghost kb-danger-ghost" id="st-reset">Reset demo data</button></div>
        </section>
      </div>`;
    $$("[data-show]", view).forEach((c) => c.addEventListener("change", () => {
      S.fields[c.dataset.show].show = c.checked;
      if (!c.checked) S.fields[c.dataset.show].required = false;
      save(); renderSettings(view); toast(`${esc(FIELD_LABEL[c.dataset.show])} ${c.checked ? "shown on" : "hidden from"} the form`);
    }));
    $$("[data-req]", view).forEach((c) => c.addEventListener("change", () => {
      S.fields[c.dataset.req].required = c.checked; save(); toast(`${esc(FIELD_LABEL[c.dataset.req])} ${c.checked ? "required" : "optional"}`);
    }));
    $("#st-tester").addEventListener("change", (e) => { S.tester = e.target.value; save(); toast(`Ready for Testing now reassigns to <b>${esc(firstName(S.tester))}</b>`); });
    $("#st-release").addEventListener("change", (e) => { S.currentRelease = e.target.value; save(); toast(`Current release is <b>${esc(releaseName(S.currentRelease))}</b>`); });
    $("#st-preview").addEventListener("click", () => openTask(null));
    $("#st-reset").addEventListener("click", () => {
      if (!confirm("Reset all tasks to the demo data?")) return;
      const me = state.me; state = fresh(); state.me = me; save(); renderProfile(); render(); toast("Demo data reset");
    });
  }

  // ── Agent Board (static stand-in for the existing board) ────────────────
  function renderAgentBoard(view) {
    const cols = [
      { cls: "backlog", label: "Backlog", cards: [["feature", "Dictation: punctuation commands in comment boxes", "Backend / Infrastructure"], ["bug", "Docs page loses scroll position after save", "HQ Admin"]] },
      { cls: "testing", label: "Ready for Testing", cards: [["feature", "Help Centre: related articles under each answer", "Product Assets"]] },
      { cls: "publish", label: "Approved for Deployment", cards: [["bug", "Release notes skip tickets with no category", "Backend / Infrastructure"]] },
      { cls: "live", label: "Deployed (Live)", cards: [["feature", "Command-K jump to ticket, concept or release", "HQ Admin"], ["feature", "System map hover tooltips", "HQ Admin"]] },
    ];
    view.innerHTML = `
      <div class="page-header">
        <h2>Agent Board</h2>
        <span class="page-header-count">6 items</span>
        <button type="button" class="btn-ghost kb-icon-label page-header-action" data-route="kanban"><span class="material-symbols-outlined" aria-hidden="true">view_kanban</span>Staff Kanban</button>
      </div>
      <div id="projects-root">
        <section class="project">
          <div class="project-header">
            <div class="project-title-wrap"><div class="project-name-row"><h3 class="project-name">Backlog Tracker &amp; FAQs</h3><span class="project-item-count">6 items</span></div></div>
            <div class="project-header-actions"><button type="button" class="notify-claude-btn kb-ai-btn" data-inert><span class="material-symbols-outlined notify-claude-icon" aria-hidden="true">auto_awesome</span><span class="notify-claude-label">Notify Claude</span></button><button type="button" class="btn-primary new-item-btn" data-inert>+ New backlog item</button></div>
          </div>
          <div class="project-body"><div class="board">
            ${cols.map((c) => `<div class="column"><div class="col-head col-head-${c.cls}"><span>${c.label}</span><span class="col-count">${c.cards.length}</span></div><div class="col-list">${c.cards.map(([type, title, cat]) => `<div class="card" data-inert><div class="card-top"><span class="badge badge-${type}">${type === "bug" ? "Bug" : "Feature"}</span></div><p class="card-title">${esc(title)}</p><div class="card-footer"><span class="card-cat">${esc(cat)}</span></div></div>`).join("")}</div></div>`).join("")}
          </div></div>
        </section>
      </div>`;
  }

  // (i) tips: keep the bubble on screen, and tap to open on touch (as js/ui-polish.js does in the console)
  function initTips() {
    const place = (b) => { b.classList.remove("edge-left", "edge-right"); const r = b.getBoundingClientRect(); if (r.left < 150) b.classList.add("edge-left"); else if (innerWidth - r.right < 150) b.classList.add("edge-right"); };
    document.addEventListener("pointerover", (e) => { const b = e.target.closest && e.target.closest(".info-tip"); if (b) place(b); });
    document.addEventListener("click", (e) => {
      const b = e.target.closest && e.target.closest(".info-tip");
      $$(".info-tip.open").forEach((o) => { if (o !== b) o.classList.remove("open"); });
      if (b) { e.preventDefault(); e.stopPropagation(); place(b); b.classList.toggle("open"); }
    }, true);
  }

  // ── Boot ────────────────────────────────────────────────────────────────
  initShell();
  initModal();
  initDrag();
  initTips();
  render();
})();
