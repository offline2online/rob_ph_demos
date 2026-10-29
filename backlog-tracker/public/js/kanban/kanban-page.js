// Staff Kanban: the console page (KB-NAV … KB-SET in
// kanban-staff-board/REQUIREMENTS.md). Ported from the signed-off prototype
// (kanban-staff-board/prototype/js/kanban.js) with its local mock state
// replaced by kanban-store.js, its people by the console's members and its
// releases by the console's own `releases` collection. app.js loads this
// module the first time someone opens #staff-kanban and calls
// mountStaffKanban() once; show() is then called on every route change.
import { createStore } from "./kanban-store.js";
import { KBEditor } from "./kanban-editor.js";
import { colourFor, photoSrcFor, setAvatarMember, getAvatarMember } from "../avatar.js";
import { createResultReader, useContinuousMode, isAndroidDevice } from "../dictation-results.js";
import {
  STATUSES, STATUS_LABEL, RESOLUTIONS, TYPES, PRIORITIES, LINK_TYPES, CORE_FIELDS, OPTIONAL_FIELDS, FIELD_LABEL,
  res, statusLabel, statusShort, typeOf, prioOf, remaining, fmtH, parseDur, fmtDate, daysBetween, workingDaysUntil,
  statusChange, currentReleaseId, DEFAULT_TESTER, rankBetween, fold, searchTickets, hasInlineImages, PICK_LIMIT, filterTasks, agentDraft, keyNumber, isoDay,
  canonicalEmail, isAliasEmail,
} from "./kanban-core.js";

export function mountStaffKanban(ctx) {
  "use strict";
  // ctx: { root, db, storage, auth, me, role(), releases(), confirm(message, opts), go(sub, params) }
  const me = ctx.me;
  const root = document.documentElement;
  const pageEl = ctx.root;
  const canWrite = () => ctx.role() !== "viewer";
  const isAdmin = () => ctx.role() === "admin";
  const mqPhone = matchMedia("(max-width: 640px)");
  const store = createStore({
    db: ctx.db, storage: ctx.storage, me,
    backfill: backfillCards,
    onChange: (what) => onData(what),
    onError: (err) => { console.warn("staff kanban:", err); if (err && err.code === "permission-denied") toast("You don't have access to that. An admin can change your role in Settings → Team & agent access."); },
  });

  // The board reads kanbanCards, which a Cloud Function-side endpoint fills
  // from kanbanTasks (and moves inline screenshots to Storage) when it finds
  // them behind. Idempotent, and nobody has to run it (functions/kanban.js).
  async function backfillCards() {
    const user = ctx.auth.currentUser;
    if (!user) return;
    // A long run answers { done: false } after a slice of the tickets: ask again.
    let after = "";
    for (let i = 0; i < 60; i++) {
      const r = await fetch("/mcp/kanban/backfill", { method: "POST", headers: { "X-Firebase-ID-Token": await user.getIdToken(), "Content-Type": "application/json" }, body: JSON.stringify({ after }) });
      if (!r.ok) throw new Error(`card backfill answered ${r.status}`);
      const out = await r.json().catch(() => ({}));
      if (out.done !== false) return;
      after = out.after || "";
    }
  }

  // ── State ───────────────────────────────────────────────────────────────
  const clone = (o) => JSON.parse(JSON.stringify(o));
  // The board's tickets as an array, rebuilt only when the store has changed.
  let taskList = [], taskListRev = -1;
  const state = {
    get tasks() {
      if (taskListRev !== store.state.rev) { taskList = [...store.state.tasks.values()]; taskListRev = store.state.rev; }
      return taskList;
    },
    get settings() { return effectiveSettings(); },
    me,
  };
  function effectiveSettings() {
    const s = store.state.settings;
    return { ...s, currentRelease: currentReleaseId(s, releases()) };
  }

  const board = { q: "", mine: false, flagged: false, assignees: new Set(), type: "", priority: "", sprint: "", release: "", label: "" };
  const collapsedCols = new Set();
  let filtersOpen = false;
  const collapsedLanes = new Set();

  // ── Helpers ─────────────────────────────────────────────────────────────
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // Everyone on the console, by first name (KB-PPL-1): memberDirectory, plus
  // anyone a ticket names who isn't in it (a removed member keeps their name
  // on old tickets as their address). An alias address (PERSON_ALIASES) is
  // never a person of its own: it shows, and is picked, as its owner.
  function people() {
    const named = store.state.settings.firstNames || {};
    const list = store.state.members.filter((m) => !isAliasEmail(m.email)).map((m) => {
      const name = String(m.displayName || "").trim() || String(m.email).split("@")[0];
      return { id: m.email, first: String(named[m.email] || "").trim() || name.split(/\s+/)[0], full: name, email: m.email, color: colourFor(m.email) };
    });
    const self = canonicalEmail(me);
    if (!list.some((u) => u.id === self)) {
      const name = (ctx.auth.currentUser && ctx.auth.currentUser.displayName) || self.split("@")[0];
      list.push({ id: self, first: String(named[self] || "").trim() || name.split(/\s+/)[0], full: name, email: self, color: colourFor(self) });
    }
    return list.sort((a, b) => (a.id === self ? -1 : b.id === self ? 1 : a.first.localeCompare(b.first)));
  }
  const user = (id) => (id ? people().find((u) => u.id === canonicalEmail(id)) || (id.includes("@") ? { id, first: id.split("@")[0], full: id, email: id, color: colourFor(id) } : null) : null);
  const firstName = (id) => (user(id) || {}).first || "Unassigned";
  // Console releases, in release order; a release's date is a Kanban setting.
  function releases() {
    const dates = store.state.settings.releaseDates || {};
    return (ctx.releases() || []).slice().sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0)).map((r) => ({
      id: r.id, name: r.name || r.version || r.id, version: r.version || "", released: r.status === "live", date: dates[r.id] || "",
    }));
  }
  const release = (id) => releases().find((r) => r.id === id);
  const releaseName = (id) => (release(id) || {}).name || "No release";
  function sprints() {
    return store.state.sprints.map((s) => ({ ...s, range: [s.start && fmtDate(s.start), s.end && fmtDate(s.end)].filter(Boolean).join(" – ") }));
  }
  const sprint = (id) => sprints().find((s) => s.id === id);
  function allLabels() {
    const set = new Set(store.state.settings.labels || []);
    for (const t of state.tasks) for (const l of t.labels || []) set.add(l);
    return [...set].sort();
  }
  // Epics are ordinary tickets of type "epic"; any task or bug can name one as its parent.
  const byKey = (a, b) => (keyNumber(a.key) || 0) - (keyNumber(b.key) || 0);
  const epics = () => state.tasks.filter((t) => t.type === "epic").sort(byKey);
  const epic = (key) => { const t = key ? store.state.tasks.get(key) : null; return t && t.type === "epic" ? t : null; };
  const childrenOf = (key) => knownTasks().filter((t) => t.epic === key && t.type !== "epic");
  const taskByKey = (k) => store.get(k);
  // Every ticket the page knows of, the board's and those fetched on demand.
  // A board card has no description text; a search hit brings it, so the picker can match and quote it.
  const knownTasks = () => {
    const out = new Map();
    for (const t of store.state.extra.values()) out.set(t.key, t);
    for (const t of store.state.tasks.values()) { const x = store.state.texts.get(t.key); out.set(t.key, x && !t.descriptionText ? { ...t, descriptionText: x } : t); }
    return [...out.values()];
  };
  const tip = (text, cls = "") => `<button type="button" class="info-tip ${cls}" data-tip="${esc(text)}" aria-label="More information">i</button>`;
  const statusPill = (t) => `<span class="kb-status-pill kb-sp-${t.status}${res(t) === "withdrawn" ? " kb-sp-withdrawn" : ""}">${esc(statusShort(t))}</span>`;
  const today = () => new Date();
  // A person's avatar: their console photo (Profile → Upload photo), else
  // their initial on their colour.
  const photoOf = (id) => (id ? photoSrcFor(id, id === me && ctx.auth.currentUser ? ctx.auth.currentUser.photoURL : "") : "");
  function avatar(id, size = "") {
    const u = user(id);
    if (!u) return `<span class="kb-avatar kb-avatar-none ${size}" title="Unassigned"><span class="material-symbols-outlined" aria-hidden="true">person</span></span>`;
    const ph = photoOf(u.id);
    if (ph) return `<span class="kb-avatar kb-avatar-img ${size}" role="img" aria-label="${esc(u.first)}" title="${esc(u.first)}" style="background-image:url('${esc(ph)}')"></span>`;
    return `<span class="kb-avatar ${size}" style="background:${u.color}" title="${esc(u.first)}">${esc(u.first.charAt(0).toUpperCase())}</span>`;
  }

  let toastTimer;
  function toast(html) {
    const el = $("#kb-toast");
    if (!el) return;
    el.innerHTML = html;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3600);
  }
  const fail = (err) => {
    console.warn("staff kanban: save failed", err);
    toast(err && err.code === "permission-denied" ? "That change wasn't saved: you don't have permission." : "That change wasn't saved. Check your connection and try again.");
    renderCurrent();
  };

  // ── Status changes (the one place the testing hand-off happens) ─────────
  // Returns { patch, note, activity } for the store, or null when nothing changes.
  function setStatus(task, status, opts = {}) {
    const ch = statusChange(task, status, { resolution: opts.resolution, tester: state.settings.tester, firstName });
    if (!ch) return null;
    if (!opts.silent) toast(`<b>${esc(task.key)}</b> ${status === "done" ? (ch.resolution === "withdrawn" ? "withdrawn" : "completed") : "moved to " + esc(STATUS_LABEL[status])}${ch.note ? ` · ${esc(ch.note)}` : ""}`);
    return ch;
  }

  function toggleFlag(task, quiet) {
    if (!task || !canWrite()) return;
    const flagged = !task.flagged;
    store.updateTask(task.key, { flagged }, [flagged ? "flagged this ticket" : "removed the flag"]).catch(fail);
    if (!quiet) { toast(`<b>${esc(task.key)}</b> ${flagged ? "flagged" : "flag removed"}`); renderCurrent(); }
  }

  // lane: the swimlane a card was dropped in ("none" = Unassigned); undefined on a plain board.
  function moveTask(key, status, beforeKey, lane, resolution) {
    const task = taskByKey(key);
    if (!task || !canWrite()) return;
    const list = state.tasks.filter((t) => t.status === status && t !== task).sort((a, b) => a.rank - b.rank);
    let idx = beforeKey ? list.findIndex((t) => t.key === beforeKey) : -1;
    if (idx < 0) idx = list.length;
    const prev = list[idx - 1], next = list[idx];
    const patch = { rank: rankBetween(prev ? prev.rank : null, next ? next.rank : null) };
    const activity = [];
    const toAssignee = lane === undefined ? task.assignee : lane === "none" ? "" : lane;
    const reassigned = (toAssignee || "") !== (task.assignee || "");
    let base = task;
    if (reassigned) {
      activity.push(`reassigned ${firstName(task.assignee)} → ${firstName(toAssignee)}`);
      patch.assignee = toAssignee; patch.previousAssignee = "";
      base = { ...task, assignee: toAssignee, previousAssignee: "" };
    }
    const ch = setStatus(base, status, { silent: reassigned, resolution });
    if (ch) { Object.assign(patch, ch.patch); activity.push(ch.activity); }
    if (reassigned) {
      const moved = task.status !== status ? ` · moved to ${esc(statusLabel(status, resolution))}` : "";
      toast(`<b>${esc(task.key)}</b> assigned to ${esc(firstName(toAssignee))}${moved}${ch && ch.note ? `, ${esc(ch.note)}` : ""}`);
    }
    store.updateTask(key, patch, activity).catch(fail);
    renderKanbanBoard();
  }

  // ── Router ──────────────────────────────────────────────────────────────
  // Sub-routes of #staff-kanban: "" (the board), "report", "settings".
  let current = { route: "kanban", params: new URLSearchParams() };
  function go(route, params) { ctx.go(route === "kanban" ? "" : route, params || null); }
  function show(sub, params) {
    current = { route: sub || "kanban", params: params || new URLSearchParams() };
    root.dataset.page = "staff-kanban";
    render();
  }
  function hide() {
    if (root.dataset.page === "staff-kanban") delete root.dataset.page;
    if (!$("#task-backdrop").hidden) closeTask();
  }
  function render() {
    const view = $("#kb-view");
    if (current.route === "report") renderReport(view, current.params);
    else if (current.route === "settings") renderSettings(view);
    else renderKanban(view);
    document.title = ({ report: "Release report", settings: "Kanban settings" }[current.route] || "Staff Kanban") + " — PH Agent Console";
    window.scrollTo(0, 0);
  }
  // A redraw that keeps the reader where they are (data arriving, a save).
  function renderCurrent() {
    if (pageEl.hidden) return;
    if (current.route === "kanban" && $("#kb-board")) { renderKanbanBoard(); refreshFilterCounts(); return; }
    keepPosition(() => render());
  }
  let dataTimer = 0, dataFrame = 0;
  const pendingData = new Set();
  function onData(what) {
    // Members the console hasn't loaded yet join its avatar cache, so photos
    // show here and everywhere else they appear.
    if (what === "members") {
      // Others' names and photos follow the directory; the signed-in person's
      // own row stays the console's (it carries more than the directory).
      for (const m of store.state.members) if (m.email !== me || !getAvatarMember(m.email)) setAvatarMember(m.email, m);
      syncDirectoryIfBehind();
    }
    if (what === "notifications") { drawBell(); return; }
    if (pageEl.hidden) return;
    // Coalesce bursts (the first load delivers six listeners at once) into one
    // render per animation frame. A hidden tab doesn't run frames: a timer covers it.
    pendingData.add(what);
    if (dataFrame) return;
    const run = () => { cancelAnimationFrame(dataFrame); clearTimeout(dataTimer); dataFrame = 0; flushData(); };
    dataFrame = requestAnimationFrame(run);
    dataTimer = setTimeout(run, 100);
  }
  function flushData() {
    if (pageEl.hidden) { pendingData.clear(); return; }
    const onlyTasks = [...pendingData].every((w) => w === "tasks");
    const hadTasks = pendingData.has("tasks");
    pendingData.clear();
    if (current.route === "kanban") {
      const b = $("#kb-board");
      // People and settings change the filter bar itself; tickets only the columns.
      if (b && onlyTasks) { renderKanbanBoard(); refreshFilterCounts(); }
      else if (b) {
        const typing = document.activeElement && document.activeElement.id === "kb-q";
        keepPosition(() => renderKanban($("#kb-view")));
        if (typing) { const q = $("#kb-q"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
      } else render();
    }
    else if (current.route === "report" || (current.route === "settings" && !pageEl.contains(document.activeElement))) keepPosition(() => render());
    if (draft && !draftIsNew && hadTasks) refreshOpenTask();
  }
  pageEl.addEventListener("click", (e) => {
    const r = e.target.closest("button[data-route], a[data-route]");
    if (r) { e.preventDefault(); go(r.dataset.route, r.dataset.params ? JSON.parse(r.dataset.params) : null); }
  });

  // The member directory is kept by a Cloud Function as people are added; the
  // first time the board opens it may not have caught up with everyone added
  // before it existed. Asking once fills it (functions/kanban.js).
  let directoryAsked = false;
  function syncDirectoryIfBehind() {
    if (directoryAsked || store.state.members.some((m) => m.email === me)) return;
    directoryAsked = true;
    const user = ctx.auth.currentUser;
    if (!user) return;
    user.getIdToken().then((t) => fetch("/mcp/kanban/directory-sync", { method: "POST", headers: { "X-Firebase-ID-Token": t } })).catch(() => {});
  }

  // ── Mentions bell ───────────────────────────────────────────────────────
  // KB-MOD-3: a mention notifies the person; the bell beside + New task
  // lists theirs, newest first, and opening one marks it read.
  let bellOpen = false;
  function drawBell() {
    const btn = $("#kb-bell"), panel = $("#kb-bell-panel");
    if (!btn) return;
    const list = store.state.notifications;
    const unread = list.filter((n) => !n.read).length;
    btn.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">notifications</span>${unread ? `<span class="kb-bell-count">${unread}</span>` : ""}`;
    btn.setAttribute("aria-label", unread ? `${unread} unread mention${unread === 1 ? "" : "s"}` : "Mentions");
    panel.hidden = !bellOpen;
    if (!bellOpen) return;
    panel.style.transform = "";
    panel.innerHTML = `<div class="kb-bell-head"><b>Mentions</b>${unread ? '<button type="button" class="link-btn" id="kb-bell-read">Mark all read</button>' : ""}</div>` + (list.slice(0, 30).map((n) => `<button type="button" class="kb-bell-item${n.read ? "" : " unread"}" data-note="${esc(n.id)}" data-key="${esc(n.taskKey)}">${avatar(n.from)}<span><b>${esc(firstName(n.from))}</b> mentioned you ${n.kind === "comment" ? "in a comment on" : "on"} <b>${esc(n.taskKey)}</b> ${esc(n.taskTitle || "")}<span class="kb-none">${esc(fmtDate(n.at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}</span></span></button>`).join("") || '<p class="kb-none kb-bell-empty">No mentions yet</p>');
    // Keep the panel inside the window (on a phone the bell sits near the right edge, so its right-aligned panel ran off the left).
    const pr = panel.getBoundingClientRect(), pad = 8;
    const shift = pr.left < pad ? pad - pr.left : pr.right > innerWidth - pad ? innerWidth - pad - pr.right : 0;
    if (shift) panel.style.transform = `translateX(${Math.round(shift)}px)`;
  }
  document.addEventListener("click", (e) => {
    if (pageEl.hidden) return;
    const b = e.target.closest("#kb-bell");
    if (b) { bellOpen = !bellOpen; drawBell(); return; }
    const item = e.target.closest(".kb-bell-item");
    if (item) {
      bellOpen = false; drawBell();
      store.markRead([item.dataset.note]).catch(() => {});
      openTaskByKey(item.dataset.key);
      return;
    }
    if (e.target.closest("#kb-bell-read")) { store.markRead(store.state.notifications.filter((n) => !n.read).map((n) => n.id)).catch(() => {}); return; }
    if (bellOpen && !e.target.closest("#kb-bell-panel")) { bellOpen = false; drawBell(); }
  });

  // ── Kanban page ─────────────────────────────────────────────────────────
  function boardTasks() {
    // A card has no description text: words in descriptions match through the
    // server's search hits (asked for as the box is typed in).
    const texts = store.state.texts;
    const list = board.q && texts.size ? state.tasks.map((t) => (!t.descriptionText && texts.has(t.key) ? { ...t, descriptionText: texts.get(t.key) } : t)) : state.tasks;
    return filterTasks(list, { ...board, me });
  }
  let boardSearchTimer = 0;
  function searchDescriptions(q) {
    clearTimeout(boardSearchTimer);
    if (!q.trim()) return;
    boardSearchTimer = setTimeout(() => {
      store.searchServer(q.trim()).then(() => { if (board.q === q) renderKanbanBoard(); }).catch(() => {});
    }, 150);
  }
  // Counts in the pinned bar that change with the data, without redrawing it.
  function refreshFilterCounts() {
    const fc = $(".kb-flag-count");
    if (fc) fc.textContent = state.tasks.filter((t) => t.flagged && t.status !== "done").length;
  }
  const opt = (v, label, sel) => `<option value="${esc(v)}"${v === sel ? " selected" : ""}>${esc(label)}</option>`;

  function renderKanban(view) {
    const relOpts = opt("", "All releases", board.release) + releases().map((r) => opt(r.id, r.name + (r.id === state.settings.currentRelease ? " (current)" : r.released ? " (released)" : ""), board.release)).join("");
    store.watchRelease(board.release);
    headSig = ""; // (the view is drawn afresh below)
    // Primary filters: staff, My tasks, Release. Secondary (in Filters): flagged, type, priority, sprint, label.
    const moreCount = [board.flagged, board.type, board.priority, board.sprint, board.label].filter(Boolean).length;
    const filtersActive = moreCount || board.mine || board.assignees.size || board.release || board.q;
    view.innerHTML = `
      <div class="page-header">
        <h2>Staff Kanban</h2>
        ${tip("Staff Kanban is for staff tasks only: work a human staff member does. Work for agents (product, docs, prototype and tooling changes, including for this project) goes in the project backlog on the Agent Board. Agents can still create and assign tasks for staff here.")}
        <span class="page-header-count" id="kb-count"></span>
        <label class="kb-search kb-header-search"><span class="material-symbols-outlined" aria-hidden="true">search</span><input type="search" id="kb-q" placeholder="Search tasks" value="${esc(board.q)}" aria-label="Search tasks"></label>
        <div class="kb-header-actions">
          <button type="button" class="btn-ghost kb-icon-label" id="kb-report-btn"><span class="material-symbols-outlined" aria-hidden="true">monitoring</span>Release report</button>
          ${canWrite() ? '<button type="button" class="btn-primary" id="kb-new-btn">+ New task</button>' : ""}
          <span class="kb-bell-wrap"><button type="button" class="btn-ghost kb-settings-btn kb-bell" id="kb-bell" aria-haspopup="true" aria-label="Mentions"></button><div class="kb-bell-panel" id="kb-bell-panel" hidden></div></span>
          <button type="button" class="btn-ghost kb-settings-btn" data-route="settings" title="Kanban settings" aria-label="Kanban settings"><span class="material-symbols-outlined" aria-hidden="true">settings</span></button>
        </div>
      </div>
      <div class="kb-sticky" id="kb-sticky">
        <div class="kb-filters" role="search">
          <div class="kb-people" role="group" aria-label="Filter by assignee">
            ${people().map((u) => `<button type="button" class="kb-person-chip${board.assignees.has(u.id) ? " on" : ""}" data-person="${u.id}" aria-pressed="${board.assignees.has(u.id)}" title="${esc(u.first)}">${avatar(u.id)}<span>${esc(u.first)}</span></button>`).join("")}
            <button type="button" class="kb-person-chip${board.assignees.has("none") ? " on" : ""}" data-person="none" aria-pressed="${board.assignees.has("none")}" title="Unassigned">${avatar("")}<span>Unassigned</span></button>
          </div>
          <button type="button" class="kb-mine${board.mine ? " on" : ""}" id="kb-mine" aria-pressed="${board.mine}"><span class="material-symbols-outlined" aria-hidden="true">person</span>My tasks</button>
          <select id="kb-release" class="kb-release-select" aria-label="Release">${relOpts}</select>
          <button type="button" class="kb-mine kb-filter-toggle${filtersOpen || moreCount ? " on" : ""}" id="kb-filter-toggle" aria-expanded="${filtersOpen}" aria-controls="kb-filter-panel"><span class="material-symbols-outlined" aria-hidden="true">tune</span>Filters${moreCount ? `<span class="kb-filter-count">${moreCount}</span>` : ""}</button>
          ${filtersActive ? '<button type="button" class="link-btn kb-clear" id="kb-clear">Clear filters</button>' : ""}
        </div>
        <div class="kb-filter-anchor">
          <div class="kb-filter-panel" id="kb-filter-panel" role="dialog" aria-label="More filters"${filtersOpen ? "" : " hidden"}>
            <button type="button" class="kb-mine kb-flag-filter${board.flagged ? " on" : ""}" id="kb-flagged" aria-pressed="${board.flagged}"><span class="material-symbols-outlined" aria-hidden="true">flag</span>Flagged only<span class="kb-flag-count">${state.tasks.filter((t) => t.flagged && t.status !== "done").length}</span></button>
            <label class="kb-rfilter"><span>Type</span><select id="kb-type">${opt("", "All types", board.type)}${TYPES.map((t) => opt(t.key, t.label, board.type)).join("")}</select></label>
            <label class="kb-rfilter"><span>Priority</span><select id="kb-priority">${opt("", "All priorities", board.priority)}${PRIORITIES.map((p) => opt(p.key, p.label, board.priority)).join("")}</select></label>
            <label class="kb-rfilter"><span>Sprint</span><select id="kb-sprint">${opt("", "All sprints", board.sprint)}${sprints().map((s) => opt(s.id, s.name, board.sprint)).join("")}</select></label>
            <label class="kb-rfilter"><span>Label</span><select id="kb-label">${opt("", "All labels", board.label)}${allLabels().map((l) => opt(l, l, board.label)).join("")}</select></label>
            <div class="kb-filter-panel-foot">${moreCount ? '<button type="button" class="link-btn" id="kb-clear-more">Clear these</button>' : "<span></span>"}<button type="button" class="btn-primary" id="kb-filter-done">Done</button></div>
          </div>
        </div>
        <div class="kb-lanes-sticky" id="kb-lanes-sticky" hidden>
          <div class="kb-lanes-head-scroll" id="kb-lanes-head-scroll"><div class="kb-board kb-lanes-head-grid" id="kb-lanes-head"></div></div>
          <button type="button" class="kb-lane-pin" id="kb-lane-pin" hidden></button>
        </div>
        <div class="kb-pager" id="kb-pager" role="tablist" aria-label="Columns"></div>
      </div>
      <div class="kb-lanes-bar" id="kb-lanes-bar" hidden>
        <span class="kb-lanes-bar-label"><span class="material-symbols-outlined" aria-hidden="true">view_agenda</span>Swimlanes by staff member</span>
        <button type="button" class="link-btn" id="kb-lanes-expand">Expand all</button>
        <button type="button" class="link-btn" id="kb-lanes-collapse">Collapse all</button>
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

    const nb = $("#kb-new-btn");
    if (nb) nb.addEventListener("click", () => openTask(null));
    drawBell();
    $("#kb-report-btn").addEventListener("click", () => go("report", board.release ? { release: board.release } : null));
    let qTimer = 0;
    $("#kb-q").addEventListener("input", (e) => {
      board.q = e.target.value;
      clearTimeout(qTimer);
      qTimer = setTimeout(() => { renderKanbanBoard(); searchDescriptions(board.q); }, 150);
    });
    // A filter change redraws the board in place: the page keeps its scroll
    // position (and, on a phone, the column you were on).
    const redraw = () => keepPosition(() => renderKanban(view));
    // Height of the pinned bar, so a phone's swimlane names can pin just under it.
    const stickyEl = $("#kb-sticky");
    const setStickyH = () => root.style.setProperty("--kb-sticky-h", stickyEl.offsetHeight + "px");
    if (window.ResizeObserver) new ResizeObserver(setStickyH).observe(stickyEl);
    setStickyH();
    $$(".kb-person-chip").forEach((b) => b.addEventListener("click", () => {
      const id = b.dataset.person;
      if (board.assignees.has(id)) board.assignees.delete(id); else board.assignees.add(id);
      redraw();
    }));
    $("#kb-filter-toggle").addEventListener("click", (e) => { e.stopPropagation(); filtersOpen = !filtersOpen; $("#kb-filter-panel").hidden = !filtersOpen; $("#kb-filter-toggle").setAttribute("aria-expanded", String(filtersOpen)); });
    $("#kb-filter-done").addEventListener("click", () => { filtersOpen = false; $("#kb-filter-panel").hidden = true; $("#kb-filter-toggle").setAttribute("aria-expanded", "false"); });
    $("#kb-mine").addEventListener("click", () => { board.mine = !board.mine; redraw(); });
    $("#kb-flagged").addEventListener("click", () => { board.flagged = !board.flagged; redraw(); });
    [["kb-release", "release"], ["kb-type", "type"], ["kb-priority", "priority"], ["kb-sprint", "sprint"], ["kb-label", "label"]].forEach(([id, k]) =>
      $("#" + id).addEventListener("change", (e) => { board[k] = e.target.value; redraw(); }));
    const clearMore = $("#kb-clear-more");
    if (clearMore) clearMore.addEventListener("click", () => { Object.assign(board, { flagged: false, type: "", priority: "", sprint: "", label: "" }); redraw(); });
    const clear = $("#kb-clear");
    if (clear) clear.addEventListener("click", () => { Object.assign(board, { q: "", mine: false, flagged: false, release: "", type: "", priority: "", sprint: "", label: "" }); board.assignees.clear(); redraw(); });
    // Phone: swipe the board left / right between columns.
    wrap.addEventListener("scroll", () => { if (mqPhone.matches && !$("#kb-board").classList.contains("kb-board-lanes")) syncPagerFromScroll(); }, { passive: true });
    let sw = null;
    wrap.addEventListener("touchstart", (e) => { if (e.touches.length === 1) sw = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }, { passive: true });
    wrap.addEventListener("touchend", (e) => {
      if (!sw || drag || !mqPhone.matches || !$("#kb-board").classList.contains("kb-board-lanes")) { sw = null; return; }
      const t = e.changedTouches[0], dx = t.clientX - sw.x, dy = t.clientY - sw.y;
      sw = null;
      if (Math.abs(dx) > 60 && Math.abs(dy) < 50) goToColumn(phoneCol + (dx < 0 ? 1 : -1));
    }, { passive: true });
    renderKanbanBoard();
  }

  function keepPosition(fn) {
    const y = scrollY, wrap = $("#kb-board-wrap"), x = wrap ? wrap.scrollLeft : 0;
    fn();
    const w = $("#kb-board-wrap");
    if (w) { w.style.scrollBehavior = "auto"; w.scrollLeft = x; w.style.scrollBehavior = ""; }
    scrollTo(0, y);
    requestAnimationFrame(() => scrollTo(0, y));
  }

  // Phone: one column at a time. The pinned pager names the column you're on;
  // tap a name, or swipe the board, to move between them.
  let phoneCol = 0;
  function drawPager(tasks) {
    const pager = $("#kb-pager");
    if (!pager) return;
    pager.innerHTML = STATUSES.map((s, i) => {
      const n = tasks.filter((t) => t.status === s.key).length;
      return `<button type="button" class="kb-pager-tab kb-col-${s.key}${i === phoneCol ? " on" : ""}" role="tab" aria-selected="${i === phoneCol}" data-col="${i}">${esc(s.key === "done" ? "Completed / Withdrawn" : s.label)}<span class="kb-pager-count">${n}</span></button>`;
    }).join("");
    $$(".kb-pager-tab", pager).forEach((b) => b.addEventListener("click", () => goToColumn(+b.dataset.col)));
    scrollPagerToActive();
  }
  function scrollPagerToActive() {
    const on = $(".kb-pager-tab.on");
    if (on) on.parentElement.scrollTo({ left: on.offsetLeft - 16, behavior: "smooth" });
  }
  function setPagerActive(i) {
    phoneCol = Math.max(0, Math.min(STATUSES.length - 1, i));
    $$(".kb-pager-tab").forEach((b) => { const on = +b.dataset.col === phoneCol; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); });
    scrollPagerToActive();
  }
  function goToColumn(i) {
    setPagerActive(i);
    const el = $("#kb-board");
    if (!el) return;
    if (el.classList.contains("kb-board-lanes")) { el.dataset.col = STATUSES[phoneCol].key; return; }
    const col = $(`.kb-col[data-status="${STATUSES[phoneCol].key}"]`, el), wrap = $("#kb-board-wrap");
    if (col && wrap) wrap.scrollTo({ left: col.offsetLeft - parseFloat(getComputedStyle(wrap).paddingLeft), behavior: "smooth" });
    const top = wrap.getBoundingClientRect().top + scrollY - $("#kb-sticky").offsetHeight;
    if (scrollY > top) scrollTo({ top, behavior: "smooth" });
  }
  let pagerTimer;
  function syncPagerFromScroll() {
    clearTimeout(pagerTimer);
    pagerTimer = setTimeout(() => {
      const wrap = $("#kb-board-wrap"), cols = $$("#kb-board > .kb-col");
      if (!wrap || !cols.length) return;
      const mid = wrap.scrollLeft + wrap.clientWidth / 2;
      const i = cols.findIndex((c) => c.offsetLeft + c.offsetWidth >= mid);
      if (i >= 0 && i !== phoneCol) setPagerActive(i);
    }, 60);
  }

  // Swimlanes: one per staff member picked in the assignee filter (Jira's
  // swimlanes by assignee), each with its own expand / collapse header.
  function laneIds() {
    if (!board.assignees.size) return null;
    return [...people().map((u) => u.id), "none"].filter((id) => board.assignees.has(id));
  }
  const boardIsFiltered = () => !!(board.q || board.mine || board.flagged || board.assignees.size || board.release || board.type || board.priority || board.sprint || board.label);
  const colMeta = (list, s) => {
    if (s.key === "done") {
      const total = store.state.doneTotal;
      const all = !boardIsFiltered() && total != null && total > list.length ? `<span class="col-count kb-done-total" title="All completed and withdrawn tickets, including those not loaded">${total} in all</span>` : "";
      return `<span class="kb-col-meta">${RESOLUTIONS.map((r) => `<span class="col-count kb-res-count kb-res-count-${r.key}" title="${r.label}"><span class="material-symbols-outlined" aria-hidden="true">${r.icon}</span>${list.filter((t) => res(t) === r.key).length}</span>`).join("")}${all}</span>`;
    }
    const rem = list.reduce((n, t) => n + remaining(t), 0);
    return `<span class="kb-col-meta">${s.key !== "done" && rem ? `<span class="kb-col-effort" title="Remaining effort">${fmtH(rem)}</span>` : ""}<span class="col-count">${list.length}</span></span>`;
  };
  // Paging (KB §13): each column draws its first cards and a "Show more" row
  // for the rest. The counts in the headers are of the whole filtered list.
  const PAGE_STEP = 50, FIRST_PAGE = { backlog: 25 };
  const pageExtra = new Map();     // paging key -> cards revealed beyond the first page
  const pageSize = (status, key) => (FIRST_PAGE[status] || PAGE_STEP) + (pageExtra.get(key) || 0);
  const moreHTML = (key, shown, total) => (total > shown
    ? `<button type="button" class="btn-ghost kb-more" data-more="${esc(key)}">Show ${Math.min(PAGE_STEP, total - shown)} more<span class="kb-more-left">${total - shown} not shown</span></button>` : "");
  const emptyOf = (s, r) => (r ? `<p class="empty-hint kb-empty">Drop here to ${r.key === "completed" ? "complete" : "withdraw"}</p>` : '<p class="empty-hint kb-empty">No tasks</p>');
  // The cards of one column (or swimlane cell). The last column has two drop
  // zones, Completed and Withdrawn, each with its own count.
  function listsHTML(list, s, emptyHint, pageKey) {
    if (s.key !== "done") {
      const n = pageSize(s.key, `${pageKey}:${s.key}`);
      return `<div class="col-list kb-list">${list.slice(0, n).map(cardHTML).join("") || emptyHint}</div>${moreHTML(`${pageKey}:${s.key}`, n, list.length)}`;
    }
    return `<div class="kb-res-split">${RESOLUTIONS.map((r) => {
      const items = list.filter((t) => res(t) === r.key), k = `${pageKey}:done:${r.key}`, n = pageSize("done", k);
      return `<div class="kb-res-group kb-res-${r.key}"><div class="kb-res-head"><span class="material-symbols-outlined" aria-hidden="true">${r.icon}</span>${r.label}<span class="col-count">${items.length}</span></div>
        <div class="col-list kb-list" data-resolution="${r.key}">${items.slice(0, n).map(cardHTML).join("") || emptyOf(s, r)}</div>${moreHTML(k, n, items.length)}</div>`;
    }).join("")}</div>`;
  }
  // The plain board is drawn once as columns; after that only what changed in a
  // column is touched: a card whose markup is the same stays the same node.
  const cardSig = new WeakMap();
  function setMeta(head, html) {
    if (head.dataset.metaSig === html) return;
    head.dataset.metaSig = html;
    const old = head.querySelector(".kb-col-meta");
    if (old) old.outerHTML = html; else head.insertAdjacentHTML("beforeend", html);
  }
  function reconcileList(listEl, items, hint) {
    const have = new Map();
    for (const c of [...listEl.children]) {
      if (c.dataset.key && !have.has(c.dataset.key)) have.set(c.dataset.key, c);
      else if (items.length || !c.classList.contains("kb-empty")) c.remove();
    }
    const want = new Set(items.map((t) => t.key));
    for (const [k, c] of have) if (!want.has(k)) { c.remove(); have.delete(k); }
    const tpl = document.createElement("template");
    let prev = null;
    for (const t of items) {
      const html = cardHTML(t);
      let node = have.get(t.key);
      if (node && cardSig.get(node) !== html) {
        tpl.innerHTML = html;
        const fresh = tpl.content.firstElementChild;
        cardSig.set(fresh, html);
        node.replaceWith(fresh);
        node = fresh;
      } else if (!node) {
        tpl.innerHTML = html;
        node = tpl.content.firstElementChild;
        cardSig.set(node, html);
      }
      const at = prev ? prev.nextSibling : listEl.firstChild;
      if (node !== at) listEl.insertBefore(node, at);
      prev = node;
    }
    if (!items.length && !listEl.querySelector(".kb-empty")) listEl.insertAdjacentHTML("beforeend", hint);
  }
  function setMore(host, key, shown, total) {
    let row = host.nextElementSibling;
    if (!row || !row.classList.contains("kb-more-row")) { row = document.createElement("div"); row.className = "kb-more-row"; host.after(row); }
    const html = moreHTML(key, shown, total);
    if (row.dataset.sig !== html) { row.dataset.sig = html; row.innerHTML = html; }
  }
  function renderPlainBoard(el, tasks) {
    if (el.dataset.mode !== "plain") {
      el.dataset.mode = "plain";
      el.innerHTML = STATUSES.map((s) => `<section class="column kb-col" data-status="${s.key}" aria-label="${esc(s.label)}">
        <div class="col-head kb-col-head kb-col-${s.key}"><span class="kb-col-title">${esc(s.label)}</span></div>
        ${s.key === "done"
    ? `<div class="kb-res-split">${RESOLUTIONS.map((r) => `<div class="kb-res-group kb-res-${r.key}"><div class="kb-res-head"><span class="material-symbols-outlined" aria-hidden="true">${r.icon}</span>${r.label}<span class="col-count"></span></div><div class="col-list kb-list" data-resolution="${r.key}"></div></div>`).join("")}</div>`
    : '<div class="col-list kb-list"></div>'}
      </section>`).join("");
    }
    const byStatus = new Map(STATUSES.map((s) => [s.key, []]));
    for (const t of tasks) { const l = byStatus.get(t.status); if (l) l.push(t); }
    for (const s of STATUSES) {
      const list = byStatus.get(s.key).sort((a, b) => a.rank - b.rank);
      const col = $(`.kb-col[data-status="${s.key}"]`, el);
      col.classList.toggle("column-collapsed", collapsedCols.has(s.key));
      setMeta($(".kb-col-head", col), colMeta(list, s));
      if (s.key !== "done") {
        const n = pageSize(s.key, `plain:${s.key}`), host = $(".kb-list", col);
        reconcileList(host, list.slice(0, n), emptyOf(s));
        setMore(host, `plain:${s.key}`, n, list.length);
      } else {
        for (const r of RESOLUTIONS) {
          const items = list.filter((t) => res(t) === r.key), k = `plain:done:${r.key}`, n = pageSize("done", k);
          const host = $(`.kb-list[data-resolution="${r.key}"]`, col);
          const count = $(".kb-res-head .col-count", host.parentElement);
          if (count.textContent !== String(items.length)) count.textContent = items.length;
          reconcileList(host, items.slice(0, n), emptyOf(s, r));
          setMore(host, k, n, items.length);
        }
      }
    }
  }
  let headSig = "";
  function renderKanbanBoard() {
    const el = $("#kb-board");
    if (!el) return;
    const tasks = boardTasks();
    const countText = `${tasks.length} task${tasks.length === 1 ? "" : "s"}`;
    if ($("#kb-count").textContent !== countText) $("#kb-count").textContent = countText;
    const lanes = laneIds();
    el.classList.toggle("kb-board-lanes", !!lanes);
    el.dataset.col = STATUSES[phoneCol].key;
    drawPager(tasks);
    const sorted = (list, k) => list.filter((t) => t.status === k).sort((a, b) => a.rank - b.rank);
    if (lanes) {
      el.dataset.mode = "lanes";
      $("#kb-lanes-head").innerHTML = STATUSES.map((s) => `<div class="col-head kb-col-head kb-lanes-head kb-col-${s.key}"><span class="kb-col-title">${esc(s.label)}</span>${colMeta(sorted(tasks, s.key), s)}</div>`).join("");
      headSig = "";
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
              ${listsHTML(list, s, "", `lane:${id}`)}
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
    // Plain board: the page scrolls as a whole and the same pinned header
    // row as the swimlanes stays at the top (each column's own head is for phones).
    if (el.dataset.mode === "lanes") { el.innerHTML = ""; headSig = ""; }
    const headHTML = STATUSES.map((s) => `<div class="col-head kb-col-head kb-lanes-head kb-col-${s.key}"><span class="kb-col-title">${esc(s.label)}</span>${colMeta(sorted(tasks, s.key), s)}</div>`).join("");
    if (headHTML !== headSig) { headSig = headHTML; $("#kb-lanes-head").innerHTML = headHTML; }
    $("#kb-lanes-sticky").hidden = false;
    $("#kb-lanes-head-scroll").scrollLeft = $("#kb-board-wrap").scrollLeft;
    $("#kb-lanes-bar").hidden = true;
    updateLanePin();
    const fresh = el.dataset.mode !== "plain";
    renderPlainBoard(el, tasks);
    // Phone: open on the column the pager says you're on.
    if (fresh && mqPhone.matches) requestAnimationFrame(() => {
      const col = $(`.kb-col[data-status="${STATUSES[phoneCol].key}"]`, el), wrap = $("#kb-board-wrap");
      if (col && wrap) { wrap.style.scrollBehavior = "auto"; wrap.scrollLeft = col.offsetLeft - parseFloat(getComputedStyle(wrap).paddingLeft); wrap.style.scrollBehavior = ""; }
    });
  }
  // "Show 50 more" at the foot of a column.
  pageEl.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-more]");
    if (!b) return;
    pageExtra.set(b.dataset.more, (pageExtra.get(b.dataset.more) || 0) + PAGE_STEP);
    renderKanbanBoard();
  });

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
    const overdue = t.due && t.status !== "done" && daysBetween(t.due, today()) < 0;
    const dueSoon = t.due && t.status !== "done" && !overdue && daysBetween(t.due, today()) <= 2;
    const est = +t.estimate || 0, log = +t.logged || 0;
    const pct = est ? Math.min(100, Math.round((log / est) * 100)) : 0;
    const over = est && log > est;
    const ep = t.type === "epic" ? null : epic(t.epic);
    const kids = t.type === "epic" ? childrenOf(t.key) : null;
    const kidsLive = kids ? kids.filter((k) => res(k) !== "withdrawn") : null;
    const kidsDone = kids ? kids.filter((k) => res(k) === "completed").length : 0;
    const flagBtn = `<button type="button" class="kb-flag-btn${t.flagged ? " on" : ""}" data-flag="${esc(t.key)}" aria-pressed="${!!t.flagged}" title="${t.flagged ? "Remove flag" : "Flag"}" aria-label="${t.flagged ? "Remove flag" : "Flag"} ${esc(t.key)}"><span class="material-symbols-outlined" aria-hidden="true">flag</span></button>`;
    return `<article class="card kb-card${res(t) === "withdrawn" ? " kb-card-withdrawn" : ""}${t.flagged ? " kb-flagged" : ""}${t.type === "epic" ? " kb-card-epic" : ""}" data-key="${esc(t.key)}" tabindex="0" aria-label="${esc(t.key + " " + t.title + (t.flagged ? ", flagged" : ""))}">
      <div class="kb-card-top">
        <span class="kb-type kb-type-${ty.key}" title="${ty.label}"><span class="material-symbols-outlined" aria-hidden="true">${ty.icon}</span></span>
        <span class="kb-key">${esc(t.key)}</span>
        <span class="kb-prio kb-prio-${pr.key}" title="${pr.label} priority"><span class="material-symbols-outlined" aria-hidden="true">${pr.icon}</span></span>
        ${state.settings.fields.flag.show || t.flagged ? flagBtn : ""}
      </div>
      <p class="card-title">${esc(t.title)}</p>
      ${ep ? `<p class="kb-parent-epic" title="Parent epic: ${esc(ep.key + " " + ep.title)}"><span class="material-symbols-outlined" aria-hidden="true">bolt</span><span>${esc(ep.title)}</span></p>` : ""}
      ${kids ? `<div class="kb-progress kb-epic-progress" title="${kidsDone} of ${kidsLive.length} child tickets completed"><span style="width:${kidsLive.length ? (kidsDone / kidsLive.length) * 100 : 0}%"></span></div>` : ""}
      ${t.status === "ready-for-testing" && t.previousAssignee ? `<p class="kb-handoff"><span class="material-symbols-outlined" aria-hidden="true">swap_horiz</span>From ${esc(firstName(t.previousAssignee))}</p>` : ""}
      ${est ? `<div class="kb-progress${over ? " over" : ""}" title="${fmtH(log)} logged of ${fmtH(est)}"><span style="width:${pct}%"></span></div>` : ""}
      <div class="kb-card-footer">
        <div class="kb-card-chips">
          ${kids ? `<span class="card-cat kb-est kb-epic-count">${kidsDone}/${kidsLive.length} done</span>` : res(t) === "withdrawn" ? '<span class="card-cat kb-est kb-withdrawn-chip">Withdrawn</span>' : est ? `<span class="card-cat kb-est" title="Remaining of ${fmtH(est)} estimate">${t.status === "done" ? fmtH(est) : fmtH(remaining(t)) + " left"}</span>` : '<span class="card-cat kb-est kb-est-none">No estimate</span>'}
          ${t.due && t.status !== "done" ? `<span class="card-cat kb-due${overdue ? " overdue" : dueSoon ? " soon" : ""}"><span class="material-symbols-outlined" aria-hidden="true">event</span>${fmtDate(t.due)}</span>` : ""}
          ${(t.comments || []).length ? `<span class="kb-meta-ic" title="${t.comments.length} comment${t.comments.length > 1 ? "s" : ""}"><span class="material-symbols-outlined" aria-hidden="true">chat_bubble</span>${t.comments.length}</span>` : ""}
          ${t.attachmentCount ? `<span class="kb-meta-ic" title="${t.attachmentCount} attachment${t.attachmentCount > 1 ? "s" : ""}"><span class="material-symbols-outlined" aria-hidden="true">attach_file</span>${t.attachmentCount}</span>` : ""}
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
      if (!card || e.button !== 0 || !$("#kb-board") || pageEl.hidden || !canWrite() || e.target.closest("[data-flag]")) return;
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
    // The layout moves under a held finger (the page or the board scrolls): work out the drop place again.
    document.addEventListener("scroll", () => { if (drag && drag.active) moveDrag(drag.lastX, drag.lastY, true); }, { capture: true, passive: true });
    document.addEventListener("touchmove", (e) => { if (drag && drag.active) e.preventDefault(); }, { passive: false });
    document.addEventListener("pointerup", (e) => { if (drag && e.pointerId === drag.id) endDrag(true); });
    document.addEventListener("pointercancel", () => { if (drag) endDrag(false); });
    document.addEventListener("contextmenu", (e) => { if (e.target.closest(".kb-card") && drag) e.preventDefault(); });
    document.addEventListener("click", (e) => {
      const card = e.target.closest(".kb-card");
      if (!card || !pageEl.contains(card)) return;
      if (suppressClick) { suppressClick = false; e.preventDefault(); return; }
      const fb = e.target.closest("[data-flag]");
      if (fb) { toggleFlag(taskByKey(fb.dataset.flag)); return; }
      openTask(card.dataset.key);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && drag && drag.active) { e.preventDefault(); endDrag(false); return; }
      const card = e.target.closest && e.target.closest(".kb-card");
      if (card && pageEl.contains(card) && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openTask(card.dataset.key); }
    });
  }
  function startDrag(x, y) {
    const r = drag.card.getBoundingClientRect();
    drag.active = true;
    drag.sx = x; drag.sy = y; drag.lastX = x; drag.lastY = y; drag.moved = false;
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
    showCloseZones();
    if (navigator.vibrate && drag.type !== "mouse") { try { navigator.vibrate(10); } catch { /* ignore */ } }
    moveDrag(x, y);
  }
  // While a card is being dragged, the Completed / Withdrawn column's cards
  // are hidden and two drop targets take its place. On a tablet or desktop
  // they sit over that column and nowhere else (Completed three quarters,
  // Withdrawn one quarter, clipped to what is on screen; while the column is
  // scrolled out of view they are a slim strip at the right edge, and the
  // board scrolls sideways under a finger held there). On a phone they are a
  // slim bar above the tab bar that grows only when the card nears it, so the
  // board stays reachable.
  function showCloseZones() {
    if (!$("#kb-board")) return;
    const ov = document.createElement("div");
    ov.className = "kb-close-zones";
    ov.innerHTML = RESOLUTIONS.map((r) => {
      const n = state.tasks.filter((t) => res(t) === r.key).length;
      return `<div class="kb-close-zone kb-close-${r.key}" data-resolution="${r.key}"><span class="material-symbols-outlined" aria-hidden="true">${r.icon}</span><span class="kb-close-label">${r.label}</span><span class="kb-close-count">${n}</span></div>`;
    }).join("");
    if (mqPhone.matches) ov.classList.add("kb-close-slim");
    document.body.appendChild(ov);
    drag.zones = ov;
    drag.zoneStart = zoneAt(drag.sx, drag.sy);
    layoutCloseZones();
    if (mqPhone.matches) drag.barTop = ov.getBoundingClientRect().top;
  }
  function layoutCloseZones() {
    const ov = drag && drag.zones;
    if (!ov || mqPhone.matches) return;
    const ref = $("#kb-lanes-head .kb-col-done") || $('.kb-col[data-status="done"]');
    if (!ref) return;
    const head = $("#kb-sticky"), wrap = $("#kb-board-wrap");
    const r = ref.getBoundingClientRect();
    const wr = wrap ? wrap.getBoundingClientRect() : { left: 0, right: innerWidth };
    const top = Math.max(head && !head.hidden ? head.getBoundingClientRect().bottom : 0, 0) + 8;
    const strip = 56;
    let left = Math.max(r.left, wr.left, 0), right = Math.min(r.right, wr.right, innerWidth);
    ov.classList.toggle("kb-close-strip", right - left < strip);
    if (right - left < strip) { right = Math.min(wr.right, innerWidth); left = right - strip; }
    Object.assign(ov.style, { left: left + "px", width: right - left + "px", top: top + "px", bottom: "16px" });
  }
  const zoneAt = (x, y) => { const el = document.elementFromPoint(x, y); const z = el && el.closest(".kb-close-zone"); return z ? z.dataset.resolution : null; };
  function moveDrag(x, y, noScroll) {
    drag.lastX = x; drag.lastY = y;
    drag.ghost.style.transform = `translate(${x - drag.dx}px, ${y - drag.dy}px) rotate(2deg)`;
    // Letting go without moving drops nothing: a finger held on a card low on the screen must not close it
    // because a target has appeared under it.
    if (!drag.moved) {
      if (Math.hypot(x - drag.sx, y - drag.sy) <= 6) { drag.target = null; return; }
      drag.moved = true;
    }
    if (drag.zones) {
      layoutCloseZones();
      if (mqPhone.matches) {
        // The bar grows when the card nears it and stays grown while the finger is on it.
        const grown = drag.zones.classList.contains("kb-close-grown");
        if (!drag.barTop) drag.barTop = drag.zones.getBoundingClientRect().top;
        const near = y >= (grown ? drag.zones.getBoundingClientRect().top - 8 : drag.barTop - 36);
        drag.zones.classList.toggle("kb-close-grown", near);
      }
    }
    const under = document.elementFromPoint(x, y);
    const zoneEl = under && under.closest(".kb-close-zone");
    const zoneKey = zoneEl ? zoneEl.dataset.resolution : null;
    // A drop on a target counts only once the finger has been somewhere else since the drag began.
    // (On a phone the bar changes shape under the finger, so there it means having been off the bar altogether.)
    if (!zoneEl || (!mqPhone.matches && zoneKey !== drag.zoneStart)) drag.armed = true;
    const zone = zoneEl && drag.armed ? zoneEl : null;
    if (drag.zones) $$(".kb-close-zone", drag.zones).forEach((z) => z.classList.toggle("on", z === zone));
    if (zone) {
      $$(".kb-col.kb-drop-target").forEach((c) => c.classList.remove("kb-drop-target"));
      drag.marker.remove();
      drag.target = { status: "done", resolution: zone.dataset.resolution, before: null };
      if (!noScroll) autoScroll(x, y, true);
      return;
    }
    const col = !zoneEl && under && under.closest(".kb-col");
    $$(".kb-col.kb-drop-target").forEach((c) => c !== col && c.classList.remove("kb-drop-target"));
    if (!col) { drag.marker.remove(); drag.target = null; if (!noScroll) autoScroll(x, y, !!zoneEl); return; }
    col.classList.add("kb-drop-target");
    const lists = $$(".kb-list", col);
    // In the split last column, pick the zone under the pointer (or the nearest one).
    const dist = (l) => { const r = (l.closest(".kb-res-group") || l).getBoundingClientRect(); return y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0; };
    const list = lists.reduce((best, l) => (dist(l) < dist(best) ? l : best), lists[0]);
    $$(".kb-res-group.kb-res-target").forEach((g) => g.classList.remove("kb-res-target"));
    if (list.dataset.resolution) list.closest(".kb-res-group").classList.add("kb-res-target");
    const cards = $$(".kb-card", list).filter((c) => c !== drag.card);
    const before = cards.find((c) => { const r = c.getBoundingClientRect(); return y < r.top + r.height / 2; });
    if (before) list.insertBefore(drag.marker, before); else list.appendChild(drag.marker);
    drag.target = { status: col.dataset.status, lane: col.dataset.lane, resolution: list.dataset.resolution, before: before ? before.dataset.key : null };
    if (!noScroll) autoScroll(x, y, false);
  }
  // Near the top or bottom edge the page scrolls, near the left or right edge of the board the board does
  // (also over a closing target: the board is what brings the Completed column into view). The page does
  // not scroll while the finger is on a target. On a phone the bottom edge is the top of the slim bar's
  // reach, so the bar and the scrolling never compete for the same strip of screen.
  function autoScroll(x, y, overZone) {
    const edge = 60, wrap = $(".kb-board-wrap"), phone = mqPhone.matches;
    if (!overZone) {
      const bottom = phone && drag.barTop ? drag.barTop - 36 : innerHeight - edge;
      if (y < edge + 60) window.scrollBy(0, -14);
      else if (y > bottom - (phone ? 50 : 0) && y <= bottom + (phone ? 0 : edge)) window.scrollBy(0, 14);
    }
    if (wrap) { const r = wrap.getBoundingClientRect(); if (x < r.left + edge) wrap.scrollLeft -= 16; else if (x > r.right - edge) wrap.scrollLeft += 16; }
  }
  function endDrag(commit) {
    const d = drag; drag = null;
    clearTimeout(d.timer);
    if (!d.active) return;
    suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
    d.ghost.remove(); d.marker.remove();
    if (d.zones) d.zones.remove();
    d.card.classList.remove("kb-dragging");
    document.body.classList.remove("kb-drag-active");
    $$(".kb-col.kb-drop-target").forEach((c) => c.classList.remove("kb-drop-target"));
    $$(".kb-res-group.kb-res-target").forEach((g) => g.classList.remove("kb-res-target"));
    if (commit && d.moved && d.target) moveTask(d.key, d.target.status, d.target.before, d.target.lane, d.target.resolution);
  }

  // ── Task create / edit modal ────────────────────────────────────────────
  let draft = null, draftIsNew = false;
  const fieldOn = (k) => (state.settings.fields[k] || {}).show;
  const fieldReq = (k) => (state.settings.fields[k] || {}).required;

  // returnTo: the epic to reopen when a child ticket opened from it closes.
  let returnTo = null;
  // The open ticket's comments and activity arrive from their own listeners.
  let threadUnsubs = [];
  function unwatchThread() { threadUnsubs.splice(0).forEach((u) => u()); }
  function watchThread(key) {
    unwatchThread();
    const redraw = () => { const el = $("#f-comments"); if (el) el.innerHTML = commentsHTML(); };
    threadUnsubs.push(store.watchComments(key, (list) => { if (draft && draft.key === key) { draft.comments = list; redraw(); } }));
    threadUnsubs.push(store.watchActivity(key, (list) => { if (draft && draft.key === key) { draft.activity = list; redraw(); } }));
  }
  // Opening a ticket the board isn't holding (a mention, a link, a child in
  // another release) fetches it first.
  // The board holds cards, so a ticket's modal reads the full ticket first.
  async function openTaskByKey(key, preset) {
    try { if (!(await store.fetchTask(key))) { toast(`<b>${esc(key)}</b> no longer exists`); return; } }
    catch (e) { fail(e); return; }
    openTask(key, { ...preset, loaded: true });
  }
  function openTask(key, preset) {
    // Always read the ticket fresh: what the board holds is the card.
    if (key && !(preset && preset.loaded)) { openTaskByKey(key, preset); return; }
    const t = key ? store.getFull(key) : null;
    if (key && !t) { openTaskByKey(key, preset); return; }
    if (!t && !canWrite()) return;
    draftIsNew = !t;
    returnTo = preset && preset.returnTo ? preset.returnTo : null;
    draft = t ? { ...clone(t), comments: [], activity: [] } : Object.assign({
      key: "", type: "task", title: "", description: "", status: "backlog",
      assignee: board.mine ? state.me : "", reporter: state.me, release: state.settings.currentRelease,
      estimate: "", logged: 0, priority: "medium", sprint: "", due: "", labels: [], epic: "",
      comments: [], attachments: [], links: [], previousAssignee: "", activity: [], flagged: false,
    }, preset ? preset.fields : {});
    if (t) {
      watchThread(t.key);
      // An epic's children may sit outside what the board holds.
      if (t.type === "epic") store.fetchChildren(t.key).then(() => { if (draft && draft.key === t.key) refreshChildren(); }).catch(() => {});
      for (const l of t.links || []) if (!taskByKey(l.key)) store.fetchTask(l.key).then(() => { const el = $("#f-links"); if (el && draft && draft.key === t.key) el.innerHTML = linksHTML(); }).catch(() => {});
    } else unwatchThread();
    $("#task-title-h").innerHTML = draftIsNew ? "New task" : `<span class="kb-modal-key">${esc(draft.key)}</span>`;
    syncModalFlag();
    renderForm();
    setSideCollapsed(sideCollapsed);
    syncCreateCta();
    $("#task-backdrop").hidden = false;
    document.body.classList.add("kb-modal-open");
    setTimeout(() => { const f = $("#f-title"); if (f && draftIsNew) f.focus(); }, 30);
  }
  // A new ticket's heading and primary button follow its type.
  const CREATE_CTA = { task: "Create task", bug: "Raise bug", epic: "Create epic" };
  const NEW_TITLE = { task: "New task", bug: "New bug", epic: "New epic" };
  function syncCreateCta() {
    if (!draftIsNew || !draft) return;
    const b = $("#f-save");
    if (b) b.textContent = CREATE_CTA[draft.type] || CREATE_CTA.task;
    $("#task-title-h").textContent = NEW_TITLE[draft.type] || NEW_TITLE.task;
  }
  // The details column (priority, type, people, release, estimate…) can be
  // pushed off to the right so the description gets the full width.
  const SIDE_KEY = "kb-proto-side-collapsed";
  let sideCollapsed = (() => { try { return localStorage.getItem(SIDE_KEY) === "1"; } catch { return false; } })();
  function setSideCollapsed(v) {
    sideCollapsed = v;
    try { localStorage.setItem(SIDE_KEY, v ? "1" : "0"); } catch { /* ignore */ }
    const g = $(".kb-task-grid");
    if (g) g.classList.toggle("kb-side-collapsed", v);
    const b = $("#task-side-toggle");
    b.setAttribute("aria-expanded", String(!v));
    b.title = v ? "Show details" : "Hide details";
    b.firstElementChild.textContent = v ? "right_panel_open" : "right_panel_close";
    const tab = $("#kb-side-tab");
    if (tab) tab.setAttribute("aria-expanded", String(!v));
  }
  function syncModalFlag() {
    const b = $("#task-flag");
    b.hidden = !(fieldOn("flag") || draft.flagged);
    b.classList.toggle("on", !!draft.flagged);
    b.setAttribute("aria-pressed", String(!!draft.flagged));
    $("#task-flag-label").textContent = draft.flagged ? "Flagged" : "Flag";
    $(".kb-task-panel").classList.toggle("kb-panel-flagged", !!draft.flagged);
  }
  function closeTask() {
    stopRecorder(true); unwatchThread(); $("#task-backdrop").hidden = true; document.body.classList.remove("kb-modal-open"); draft = null;
    const back = returnTo; returnTo = null;
    if (back && taskByKey(back)) openTask(back);
  }

  // The people list, plus whoever the ticket already names if they've left.
  function peopleWith(id) {
    const list = people();
    if (id && !list.some((u) => u.id === id)) { const u = user(id); if (u) list.push(u); }
    return list;
  }
  function refreshOpenTask() {
    if (!draft || draftIsNew) return;
    if (!taskByKey(draft.key)) { toast(`<b>${esc(draft.key)}</b> was deleted`); returnTo = null; closeTask(); return; }
    refreshChildren();
    const el = $("#f-links");
    if (el) el.innerHTML = linksHTML();
  }

  const micBtn = (id, aria) => `<button type="button" class="mic-btn kb-mic" id="${id}" title="Dictate" aria-label="${aria}" aria-pressed="false"><span class="material-symbols-outlined" aria-hidden="true">mic</span></button>`;
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
      case "description": return `<div class="kb-field" data-field="description">${label("description")}<div class="desc-wrap kb-ed-wrap"><div class="kb-editor" id="f-description"></div>${draftIsNew ? "" : micBtn("f-desc-mic", "Dictate into the description")}</div>
        ${draftIsNew ? '<button type="button" class="kb-agent-link" id="f-agent-fill"><span class="material-symbols-outlined" aria-hidden="true">auto_awesome</span><span>Fill in the ticket from this description</span></button>' : '<p class="mic-error" id="f-desc-mic-error"></p>'}</div>`;
      case "status": return `<div class="kb-field" data-field="status">${label("status")}<select id="f-status" class="kb-input">${STATUSES.filter((s) => s.key !== "done").map((s) => opt(s.key, s.label, d.status)).join("")}${RESOLUTIONS.map((r) => opt("done:" + r.key, r.label, d.status === "done" ? "done:" + res(d) : "")).join("")}</select><p class="kb-inline-note" id="f-status-note" hidden></p></div>`;
      case "assignee": return `<div class="kb-field" data-field="assignee">${label("assignee")}<select id="f-assignee" class="kb-input">${opt("", "Unassigned", d.assignee)}${peopleWith(d.assignee).map((u) => opt(u.id, u.first, d.assignee)).join("")}</select></div>`;
      case "reporter": return `<div class="kb-field" data-field="reporter">${label("reporter")}<select id="f-reporter" class="kb-input">${opt("", "—", d.reporter)}${peopleWith(d.reporter).map((u) => opt(u.id, u.first, d.reporter)).join("")}</select></div>`;
      case "release": return `<div class="kb-field" data-field="release">${label("release")}<select id="f-release" class="kb-input">${opt("", "No release", d.release)}${releases().map((r) => opt(r.id, r.name + (r.released ? " (released)" : ""), d.release)).join("")}</select></div>`;
      case "estimate": return `<div class="kb-field" data-field="estimate">${label("estimate")}<input type="text" id="f-estimate" class="kb-input" value="${esc(d.estimate === "" || d.estimate == null ? "" : fmtH(d.estimate))}" placeholder="e.g. 1d 4h" inputmode="text"></div>`;
      case "type": return `<div class="kb-field" data-field="type">${label("type", "f-type-task")}<div class="type-toggle kb-type-toggle" role="radiogroup">${TYPES.map((t) => `<button type="button" class="type-opt${d.type === t.key ? " active" : ""}" id="f-type-${t.key}" data-type="${t.key}" role="radio" aria-checked="${d.type === t.key}"><span class="material-symbols-outlined kb-type-${t.key}" aria-hidden="true">${t.icon}</span>${t.label}</button>`).join("")}</div></div>`;
      case "priority": return `<div class="kb-field" data-field="priority">${label("priority")}<select id="f-priority" class="kb-input">${opt("", "—", d.priority)}${PRIORITIES.map((p) => opt(p.key, p.label, d.priority)).join("")}</select></div>`;
      case "sprint": return `<div class="kb-field" data-field="sprint">${label("sprint")}<select id="f-sprint" class="kb-input">${opt("", "No sprint", d.sprint)}${sprints().map((s) => opt(s.id, s.range ? `${s.name} · ${s.range}` : s.name, d.sprint)).join("")}</select></div>`;
      case "due": return `<div class="kb-field" data-field="due">${label("due")}<input type="date" id="f-due" class="kb-input" value="${esc(d.due)}"></div>`;
      case "logged": {
        const est = +d.estimate || 0, log = +d.logged || 0;
        return `<div class="kb-field" data-field="logged">${label("logged")}<input type="text" id="f-logged" class="kb-input" value="${log ? esc(fmtH(log)) : ""}" placeholder="e.g. 3h">
          <div class="kb-logbar${est && log > est ? " over" : ""}" id="f-logbar"><span style="width:${est ? Math.min(100, (log / est) * 100) : 0}%"></span></div>
          <p class="kb-inline-note" id="f-logtext">${est ? `${fmtH(log)} of ${fmtH(est)} · ${fmtH(Math.max(est - log, 0))} remaining` : "No estimate"}</p></div>`;
      }
      case "labels": return `<div class="kb-field" data-field="labels">${label("labels", "f-label-input")}<div class="kb-labels" id="f-labels">${labelsHTML()}</div>
        <input type="text" id="f-label-input" class="kb-input" list="kb-label-list" placeholder="Add a label and press Enter"><datalist id="kb-label-list">${allLabels().map((l) => `<option value="${esc(l)}">`).join("")}</datalist></div>`;
      case "epic": {
        const list = epics().filter((e) => e.key !== d.key);
        return `<div class="kb-field" data-field="epic"${d.type === "epic" ? " hidden" : ""}>${label("epic")}<select id="f-epic" class="kb-input">${opt("", list.length ? "No parent epic" : "No epics yet", d.epic)}${list.map((e) => opt(e.key, `${e.key} · ${e.title}`, d.epic)).join("")}</select></div>`;
      }
      case "children": {
        const kids = childrenOf(d.key);
        const done = kids.filter((k) => res(k) === "completed").length;
        const live = kids.filter((k) => res(k) !== "withdrawn").length;
        return `<div class="kb-field" data-field="children"${d.type === "epic" ? "" : " hidden"}><label class="field-label">Child tickets <span class="kb-none">${done} of ${live} done${kids.length > live ? ` · ${kids.length - live} withdrawn` : ""}</span></label>
          ${live ? `<div class="kb-logbar kb-epic-progress"><span style="width:${(done / live) * 100}%"></span></div>` : ""}
          <ul class="kb-sublist kb-children">${kids.sort((a, b) => STATUSES.findIndex((x) => x.key === a.status) - STATUSES.findIndex((x) => x.key === b.status)).map((k) => `<li data-open-child="${esc(k.key)}"><span class="kb-type kb-type-${typeOf(k.type).key}"><span class="material-symbols-outlined" aria-hidden="true">${typeOf(k.type).icon}</span></span><span class="kb-link-key">${esc(k.key)}</span><span class="kb-link-title">${esc(k.title)}</span>${k.flagged ? '<span class="material-symbols-outlined kb-flag-mini" aria-label="Flagged">flag</span>' : ""}${statusPill(k)}${avatar(k.assignee)}<button type="button" class="icon-btn" data-unlink-child="${esc(k.key)}" title="Remove from epic" aria-label="Remove ${esc(k.key)} from this epic">&times;</button></li>`).join("") || '<li class="kb-none">No tickets in this epic yet</li>'}</ul>
          <div class="kb-child-actions">
            <button type="button" class="btn-ghost kb-icon-label" data-add-child="task"><span class="material-symbols-outlined kb-type-task" aria-hidden="true">check_box</span>Add task</button>
            <button type="button" class="btn-ghost kb-icon-label" data-add-child="bug"><span class="material-symbols-outlined kb-type-bug" aria-hidden="true">bug_report</span>Add bug</button>
            <span class="kb-child-link">${pickerHTML("f-child-link", "Add an existing ticket: search by number, title or description")}</span>
          </div></div>`;
      }
      case "links": return `<div class="kb-field" data-field="links">${label("links", "f-link-key")}
        <ul class="kb-sublist" id="f-links">${linksHTML()}</ul>
        <div class="kb-add-row"><select id="f-link-type" class="kb-input" aria-label="Link type">${LINK_TYPES.map((x) => opt(x, x, "relates to")).join("")}</select>
          ${pickerHTML("f-link-key", "Search tickets by number, title or description")}</div></div>`;
      case "attachments": return `<div class="kb-field" data-field="attachments">${label("attachments", "f-file")}<ul class="kb-sublist" id="f-attachments">${attachmentsHTML()}</ul>
        <label class="btn-attach kb-attach-btn"><span class="material-symbols-outlined" aria-hidden="true">attach_file</span>Attach file<input type="file" id="f-file" multiple hidden></label></div>`;
      case "comments": return `<div class="kb-field" data-field="comments">${label("comments", "f-comment")}<ul class="kb-comments" id="f-comments">${commentsHTML()}</ul>
        <div class="desc-wrap kb-ed-wrap"><div class="kb-editor kb-editor-compact" id="f-comment"></div>${micBtn("f-comment-mic", "Dictate a comment")}</div>
        <p class="mic-error" id="f-comment-mic-error"></p>
        <div class="kb-add-row kb-add-row-end"><button type="button" class="btn-ghost" id="f-comment-add">Add comment</button></div></div>`;
    }
    return "";
  }
  const labelsHTML = () => (draft.labels || []).map((l) => `<span class="kb-label-chip">${esc(l)}<button type="button" data-rm-label="${esc(l)}" aria-label="Remove ${esc(l)}">&times;</button></span>`).join("") || '<span class="kb-none">No labels</span>';
  const linksHTML = () => (draft.links || []).map((l, i) => { const t = taskByKey(l.key); return `<li><span class="kb-link-type">${esc(l.type)}</span><span class="kb-link-key">${esc(l.key)}</span><span class="kb-link-title">${esc(t ? t.title : "")}</span>${t ? statusPill(t) : ""}<button type="button" class="icon-btn" data-rm-link="${i}" aria-label="Remove link">&times;</button></li>`; }).join("") || '<li class="kb-none">No linked tickets</li>';
  const fmtSize = (n) => (typeof n === "number" ? (n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB") : String(n || ""));
  const attachmentsHTML = () => (draft.attachments || []).map((a, i) => `<li><span class="material-symbols-outlined" aria-hidden="true">${/\.(png|jpe?g|gif|webp)$/i.test(a.name) ? "image" : /\.(mov|mp4|webm)$/i.test(a.name) ? "movie" : "description"}</span>${a.url ? `<a class="kb-link-title" href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.name)}</a>` : `<span class="kb-link-title">${esc(a.name)}</span>`}<span class="kb-none">${esc(a.uploading ? "Uploading…" : fmtSize(a.size))}</span>${canWrite() ? `<button type="button" class="icon-btn" data-rm-att="${i}" aria-label="Remove attachment">&times;</button>` : ""}</li>`).join("") || '<li class="kb-none">No attachments</li>';
  const commentsHTML = () => {
    const items = [...(draft.comments || []).map((c) => ({ ...c, kind: "c" })), ...(draft.activity || []).map((a) => ({ ...a, kind: "a" }))].sort((a, b) => String(a.at || "9").localeCompare(String(b.at || "9")));
    return items.map((c) => c.kind === "c"
      ? `<li class="kb-comment">${avatar(c.author)}<div><div class="kb-comment-meta"><b>${esc(firstName(c.author))}</b> · ${fmtDate(c.at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div><div class="kb-comment-text${c.html ? " kb-rich" : ""}">${c.html ? KBEditor.sanitize(c.html) : esc(c.text)}</div></div></li>`
      : `<li class="kb-activity"><span class="material-symbols-outlined" aria-hidden="true">history</span><span><b>${esc(firstName(c.who))}</b> ${esc(c.text)}</span></li>`).join("") || '<li class="kb-none">No comments yet</li>';
  };

  function renderForm() {
    const form = $("#task-form");
    // A new task always starts in Backlog and has nothing to comment on yet.
    const main = draftIsNew ? ["voice", "title", "description", "children", "attachments", "links"] : ["title", "description", "children", "links", "attachments", "comments"];
    const side = ["priority", "type", "epic", "assignee", "reporter", "release", "estimate", "logged", "sprint", "due", "labels"].concat(draftIsNew ? [] : ["status"]);
    const visible = (k) => k === "voice" || k === "children" || CORE_FIELDS.some((f) => f.key === k) || fieldOn(k);
    const hidden = OPTIONAL_FIELDS.map((f) => f.key).filter((k) => k !== "flag" && !fieldOn(k) && !(draftIsNew && k === "comments"));
    // On an existing ticket, hidden fields stay editable below; a new task shows only the configured form.
    form.innerHTML = `
      <div class="kb-task-grid${sideCollapsed ? " kb-side-collapsed" : ""}">
        <div class="kb-task-main">${main.filter(visible).map(fieldHTML).join("")}</div>
        <div class="kb-task-side" id="kb-task-side">${side.filter(visible).map(fieldHTML).join("")}</div>
        <button type="button" class="kb-side-tab" id="kb-side-tab" aria-controls="kb-task-side" aria-expanded="false" title="Show details"><span class="material-symbols-outlined" aria-hidden="true">left_panel_open</span><span>Details</span></button>
      </div>
      ${!draftIsNew && hidden.length ? `<details class="kb-more"><summary>${hidden.length} more field${hidden.length > 1 ? "s" : ""}<span class="kb-more-names">${hidden.map((k) => esc(FIELD_LABEL[k])).join(", ")}</span></summary><div class="kb-more-body">${hidden.map(fieldHTML).join("")}</div></details>` : ""}
      ${draftIsNew ? "" : `<p class="kb-created">Created by ${esc(firstName(draft.reporter))} · ${fmtDate(draft.created, { day: "numeric", month: "short", year: "numeric" })}</p>`}
      <p class="tm-error" id="f-error" hidden></p>
      <div class="form-row kb-form-actions">
        ${draftIsNew || !canWrite() ? "<span></span>" : '<button type="button" class="btn-ghost fa-actions-delete" id="f-delete" aria-label="Delete ticket" title="Delete ticket"><span class="material-symbols-outlined" aria-hidden="true">delete</span></button>'}
        <div class="form-actions"><button type="button" class="btn-outline" id="f-cancel">${canWrite() ? "Cancel" : "Close"}</button>${canWrite() ? `<button type="submit" class="btn-primary" id="f-save">${draftIsNew ? CREATE_CTA[draft.type] || CREATE_CTA.task : "Save"}</button>` : ""}</div>
      </div>`;
    bindForm();
  }
  function bindForm() {
    const form = $("#task-form");
    $$(".kb-type-toggle .type-opt", form).forEach((b) => b.addEventListener("click", () => {
      draft.type = b.dataset.type;
      syncCreateCta();
      $$(".kb-type-toggle .type-opt", form).forEach((x) => { x.classList.toggle("active", x === b); x.setAttribute("aria-checked", String(x === b)); });
      const pe = $('[data-field="epic"]', form);
      if (pe) pe.hidden = draft.type === "epic";
      const ch = $('[data-field="children"]', form);
      if (ch) ch.hidden = draft.type !== "epic";
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
    // The form element outlives every open, so bind this delegated handler once: a handler per open ran N times on the Nth open.
    if (!form._rmBound) form.addEventListener("click", (e) => {
      const rl = e.target.closest("[data-rm-label]");
      if (rl) { draft.labels = draft.labels.filter((x) => x !== rl.dataset.rmLabel); $("#f-labels").innerHTML = labelsHTML(); }
      const rk = e.target.closest("[data-rm-link]");
      if (rk) { draft.links.splice(+rk.dataset.rmLink, 1); $("#f-links").innerHTML = linksHTML(); }
      const ra = e.target.closest("[data-rm-att]");
      if (ra) { draft.attachments.splice(+ra.dataset.rmAtt, 1); $("#f-attachments").innerHTML = attachmentsHTML(); }
    });
    form._rmBound = true;
    bindPicker("f-link-key", {
      candidates: () => knownTasks().filter((t) => t.key !== draft.key && !draft.links.some((l) => l.key === t.key)),
      onPick: (t) => {
        const type = $("#f-link-type").value;
        draft.links.push({ type, key: t.key });
        $("#f-links").innerHTML = linksHTML();
        toast(`Linked: ${esc(type)} <b>${esc(t.key)}</b>`);
      },
    });
    // Attachments upload to Storage straight away and are saved with the ticket.
    const ff = $("#f-file");
    if (ff) ff.addEventListener("change", () => {
      const files = Array.from(ff.files);
      ff.value = "";
      for (const f of files) {
        if (f.size > 100 * 1024 * 1024) { toast(`<b>${esc(f.name)}</b> is over 100 MB`); continue; }
        const a = { name: f.name, size: f.size, contentType: f.type || "", uploading: true };
        draft.attachments.push(a);
        const d = draft;
        store.upload(d.key || "new", f, f.name).then((r) => { Object.assign(a, r); delete a.uploading; })
          .catch(() => { d.attachments = d.attachments.filter((x) => x !== a); toast(`<b>${esc(f.name)}</b> couldn't be uploaded`); })
          .finally(() => { const el = $("#f-attachments"); if (el && draft === d) el.innerHTML = attachmentsHTML(); });
      }
      $("#f-attachments").innerHTML = attachmentsHTML();
    });
    const ca = $("#f-comment-add");
    if (ca) ca.addEventListener("click", () => { addCommentFromEditor(); });
    bindEditors();
    bindVoice();
    bindChildren(form);
    $("#f-cancel").addEventListener("click", closeTask);
    const del = $("#f-delete");
    if (del) del.addEventListener("click", async () => {
      const key = draft.key;
      if (!(await ctx.confirm(`Delete ${key}? This can't be undone.${draft.type === "epic" ? " Its tickets stay, without a parent epic." : ""}`, { title: "Delete ticket", okLabel: "Delete" }))) return;
      returnTo = null;
      closeTask();
      try { await store.deleteTask(key); toast(`<b>${esc(key)}</b> deleted`); } catch (e) { fail(e); }
    });
    // Viewers see everything and change nothing.
    if (!canWrite()) {
      $$("input, select, textarea, .type-opt, .kb-mic, .kb-record-btn, .kb-agent-link, #f-comment-add, .kb-child-actions, .kb-attach-btn, [data-rm-label], [data-rm-link], [data-unlink-child]", form).forEach((el) => { el.disabled = true; if (el.matches(".kb-child-actions, .kb-attach-btn, .kb-mic, .kb-record-btn, .kb-agent-link, #f-comment-add, [data-rm-label], [data-rm-link], [data-unlink-child]")) el.hidden = true; });
      const cw = $('[data-field="comments"] .kb-ed-wrap', form); if (cw) cw.hidden = true;
    }
    form.onsubmit = (e) => { e.preventDefault(); if (canWrite()) submitTask(); };
  }

  // ── Voice capture + agent fill ──────────────────────────────────────────
  // One Record button on a new task: Web Speech dictation, then the "agent"
  // turns the transcript into title, description, priority, type, assignee,
  // release, estimate, due date and labels. Front-end only, so the agent here
  // is a local stand-in; the real console would hand the transcript to Claude.
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  // A start still waiting on the microphone; stopRecorder() cancels it, and
  // a second start while it waits is ignored (one recording at a time).
  let recStarting = null;
  function stopRecorder(abort) {
    recStarting = null;
    if (!rec) return;
    const r = rec; rec = null;
    r.wanted = false;
    clearInterval(r.timer);
    try { abort ? r.inst.abort() : r.inst.stop(); } catch { /* already stopped */ }
    if (!abort && r.onDone) setTimeout(() => r.onDone(r.text()), 250);
    if (r.onState) r.onState("idle");
  }
  // Android Chrome in continuous mode reports every in-progress guess as a
  // final, each the whole utterance so far — "add add a new add a new Epic…"
  // (21 Oct 2026). So Android records one utterance per session, restarted
  // when it ends, and dictation-results.js folds any cumulative finals that
  // still arrive (the same reader as the console's other mics in app.js).
  async function startRecorder({ onLive, onDone, onState, onError }) {
    if (!SR) { onError("Voice capture isn't supported in this browser. Try Chrome, Edge or Safari, or type the description."); return; }
    if (recStarting || rec) return;
    const starting = recStarting = {};
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch (e) {
      if (recStarting !== starting) return;
      recStarting = null;
      onError(e && e.name === "NotAllowedError" ? "Microphone access is blocked. Allow it in the browser's site settings and try again."
        : e && e.name === "NotFoundError" ? "No microphone found on this device." : "The microphone couldn't be started.");
      return;
    }
    // Android needs a moment to release the probe's hold on the mic, or the
    // recogniser shows as listening but never transcribes a word.
    if (isAndroidDevice()) await new Promise((ok) => setTimeout(ok, 250));
    if (recStarting !== starting) return; // stopped or closed while waiting
    recStarting = null;
    // Committed segments, one per final (a cumulative final replaces the
    // segment before it), plus this session's words not yet finalized.
    const segs = [];
    let interim = "";
    const reader = createResultReader();
    const commit = (f) => { if (f.replaces && segs.length) segs[segs.length - 1] = f.text; else segs.push(f.text); };
    const r = { wanted: true, onDone, onState, started: Date.now(), text: () => [...segs, interim].join(" ").replace(/\s+/g, " ").trim() };
    const make = () => {
      const inst = new SR();
      inst.lang = "en-GB"; inst.continuous = useContinuousMode(); inst.interimResults = true;
      reader.reset();
      inst.onresult = (e) => {
        if (r.inst !== inst) return; // a replaced session's late events
        const out = reader.read(e);
        out.finals.forEach(commit);
        interim = out.interim;
        onLive(r.text());
      };
      inst.onerror = (e) => {
        if (e.error === "no-speech" || e.error === "aborted") return;
        r.wanted = false;
        onError(e.error === "not-allowed" ? "Microphone access is blocked. Allow it in the browser's site settings and try again."
          : e.error === "network" ? "Voice capture needs a network connection." : e.error === "audio-capture" ? "No microphone found on this device." : "Voice capture stopped unexpectedly. Try again.");
        stopRecorder(true);
      };
      // Browsers end a session on silence (Android after every utterance);
      // keep what was shown and keep listening until Stop, restarting the
      // same instance at once (the shortest gap between utterances), or a
      // new one if it won't start again.
      inst.onend = () => {
        if (r.inst !== inst) return;
        const settled = reader.settle(interim);
        interim = "";
        if (settled) commit(settled);
        if (rec !== r || !r.wanted) return;
        reader.reset();
        inst.continuous = useContinuousMode();
        try { inst.start(); } catch {
          try { r.inst = make(); r.inst.start(); } catch { stopRecorder(false); }
        }
      };
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
        if (btn.classList.contains("working") || recStarting) return;
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
      const t = descQ ? KBEditor.getText(descQ) : "";
      if (!t.trim()) { if (descQ) descQ.focus(); return; }
      runAgent(t, () => {});
    });
    bindMic("f-desc-mic", "f-description", "f-desc-mic-error");
    bindMic("f-comment-mic", "f-comment", "f-comment-mic-error");
  }

  // A round mic inside a text box: dictates into that box, and shows a stop
  // icon while it is listening. One recording at a time across the modal.
  let activeMic = null;
  // Rich editors for the description and the comment box (js/editor.js).
  let descQ = null, commentQ = null, descInitial = "";
  const staff = () => people().map((u) => ({ id: u.id, first: u.first, full: u.full, color: u.color, photo: photoOf(u.id) }));
  // Screenshots and recordings go to Storage under the ticket's key.
  const uploadFor = () => { const d = draft; return (blob, name) => store.upload(d && d.key ? d.key : "new", blob, name).then((r) => r.url); };
  async function bindEditors() {
    descQ = commentQ = null;
    const d = $("#f-description"), c = $("#f-comment");
    // Quill downloads the first time a modal opens (js/quill-loader.js).
    try { await KBEditor.ready(); } catch (e) { toast("The editor couldn't load. Check your connection and reopen the ticket."); return; }
    // The modal may have been closed or re-rendered while Quill loaded.
    if ((d && !d.isConnected) || (c && !c.isConnected)) return;
    if (d) {
      descQ = KBEditor.create(d, { users: staff(), upload: uploadFor(), placeholder: "Context, steps to reproduce, acceptance criteria. Type @ to mention someone; paste a screenshot straight in.", onNotice: toast, onMention: (u) => toast(`<b>${esc(u.first)}</b> will be notified when you save`) });
      KBEditor.setHtml(descQ, draft.description || "");
      descInitial = KBEditor.getHtml(descQ);
    }
    if (c) {
      commentQ = KBEditor.create(c, { compact: true, users: staff(), upload: uploadFor(), placeholder: "Add a comment, @mention someone, or tap the mic and talk", onNotice: toast, onMention: (u) => toast(`<b>${esc(u.first)}</b> will be notified when you add the comment`) });
    }
    // Viewers see everything and change nothing.
    if (!canWrite()) [descQ, commentQ].forEach((q) => { if (q) q.enable(false); });
  }
  // A comment is saved as soon as it's added (it doesn't wait for Save).
  function addCommentFromEditor() {
    if (!commentQ || !draft || draftIsNew) return false;
    const html = KBEditor.getHtml(commentQ);
    if (!html) return false;
    const mentioned = KBEditor.mentionsIn(html).filter((id) => id !== state.me);
    const who = mentioned.map(firstName);
    const pending = { author: state.me, at: new Date().toISOString(), html, text: KBEditor.toText(html) };
    draft.comments = [...(draft.comments || []), pending];
    const el = $("#f-comments"); if (el) el.innerHTML = commentsHTML();
    commentQ.setContents([]);
    store.addComment(draft.key, { html, text: pending.text }, mentioned, draft.title).catch(fail);
    toast(who.length ? `Comment added · ${esc(who.join(", "))} notified` : "Comment added");
    return true;
  }
  // A text box the mic dictates into: a Quill editor or a plain field.
  function dictationTarget(id) {
    const q = id === "f-description" ? descQ : id === "f-comment" ? commentQ : null;
    if (q) {
      let start = 0;
      return {
        begin() { start = Math.max(0, q.getLength() - 1); if (start && !/\s$/.test(q.getText(start - 1, 1))) { q.insertText(start, " ", "user"); start++; } },
        live(t) { const said = start ? t : t.charAt(0).toUpperCase() + t.slice(1); q.deleteText(start, q.getLength() - 1 - start, "user"); q.insertText(start, said, "user"); },
      };
    }
    const ta = $("#" + id);
    let base = "";
    return {
      begin() { base = ta.value.trim(); },
      live(t) { const said = base ? t : t.charAt(0).toUpperCase() + t.slice(1); ta.value = (base ? base + " " : "") + said; ta.dispatchEvent(new Event("input")); },
    };
  }
  function bindMic(btnId, taId, errId) {
    const mic = $("#" + btnId);
    if (!mic) return;
    const show = (on) => {
      mic.classList.toggle("listening", on);
      mic.setAttribute("aria-pressed", String(on));
      mic.title = on ? "Stop recording" : "Dictate";
      mic.firstElementChild.textContent = on ? "stop" : "mic";
    };
    mic.addEventListener("click", () => {
      if (recStarting) return; // still waiting on the microphone
      const target = dictationTarget(taId), err = $("#" + errId);
      if (rec) {
        const wasMe = activeMic === mic;
        stopRecorder(false);
        if (wasMe) return;
      }
      if (err) err.classList.remove("on");
      target.begin();
      activeMic = mic;
      startRecorder({
        onLive: (t) => target.live(t),
        onState: (st) => { show(st === "recording"); if (st !== "recording" && activeMic === mic) activeMic = null; },
        onError: (m) => { if (err) { err.textContent = m; err.classList.add("on"); } show(false); },
        onDone: () => {},
      });
    });
  }

  // KB-MOD-2: the transcript goes to Claude through the console's
  // /mcp/kanban/agent-fill endpoint (functions/kanban.js); when that isn't
  // configured or doesn't answer, the local stand-in fills the ticket instead.
  function agentContext() {
    return {
      users: people().map((u) => ({ id: u.id, first: u.first, full: u.full })),
      epics: epics().map((e) => ({ key: e.key, title: e.title })),
      releases: releases().map((r) => ({ id: r.id, name: r.name, version: r.version, released: r.released })),
      currentRelease: state.settings.currentRelease,
      sprints: sprints().map((s) => ({ id: s.id, name: s.name, start: s.start || "", end: s.end || "" })),
      labels: allLabels(),
      today: isoDay(today()),
      // Who is talking, so "for me" / "I need to" lands on them.
      me: canonicalEmail(me),
    };
  }
  async function claudeDraft(transcript, c) {
    const user = ctx.auth.currentUser;
    if (!user) return null;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20000);
    try {
      const res = await fetch("/mcp/kanban/agent-fill", {
        method: "POST", signal: ctl.signal,
        headers: { "Content-Type": "application/json", "X-Firebase-ID-Token": await user.getIdToken() },
        body: JSON.stringify({ transcript, context: c }),
      });
      if (!res.ok) return null;
      const out = await res.json();
      return out && out.draft ? out.draft : null;
    } catch { return null; } finally { clearTimeout(timer); }
  }
  async function runAgent(transcript, setState) {
    setState("working");
    const form = $("#task-form");
    form.classList.add("kb-agent-working");
    const c = agentContext();
    const fromClaude = await claudeDraft(transcript, c);
    {
      form.classList.remove("kb-agent-working");
      if (!draft) return;
      const out = Object.assign({ labels: [] }, fromClaude || agentDraft(transcript, { ...c, today: today() }));
      if (!Array.isArray(out.labels)) out.labels = [];
      if (out.description && !KBEditor.looksLikeHtml(out.description)) out.description = String(out.description);
      const filled = [];
      const put = (id, field, v) => { const el = $("#" + id); if (el && v != null && v !== "") { el.value = v; filled.push(field); } };
      put("f-title", "title", out.title);
      if (descQ && out.description) { KBEditor.setHtml(descQ, out.description); filled.push("description"); }
      put("f-priority", "priority", out.priority);
      put("f-assignee", "assignee", out.assignee);
      put("f-release", "release", out.release);
      put("f-estimate", "estimate", out.estimate != null ? fmtH(out.estimate) : "");
      put("f-due", "due", out.due);
      put("f-sprint", "sprint", out.sprint);
      put("f-epic", "epic", out.epic);
      if (out.flagged && !draft.flagged) { draft.flagged = true; syncModalFlag(); filled.push("flag"); }
      if (out.type) {
        draft.type = out.type; filled.push("type"); syncCreateCta();
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
    }
  }

  // Child tickets from inside an epic. Adding one saves the epic first (a new
  // epic needs its key to exist), opens the child with the epic as its
  // parent, and comes back to the epic when the child is created or cancelled.
  // Searchable ticket picker: type a number (12, PH-12) or any words from a
  // ticket's title or description. Shows the best 50 matches, so it stays
  // quick however many tickets there are; arrow keys + Enter, or click.
  // KB-TASK-6: ranks what the page holds at once, then asks the server
  // (one indexed query on searchTokens) and re-ranks with what comes back.
  const textCache = new Map();
  const descText = (t) => {
    const k = t.key + ":" + (t.descriptionText || "").length;
    if (!textCache.has(k)) textCache.set(k, fold(t.descriptionText || ""));
    return textCache.get(k);
  };
  function pickerHTML(id, placeholder) {
    return `<div class="kb-picker" id="${id}"><span class="material-symbols-outlined" aria-hidden="true">search</span><input type="search" class="kb-picker-input" placeholder="${esc(placeholder)}" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="${id}-list" aria-label="${esc(placeholder)}"><div class="kb-picker-list" id="${id}-list" role="listbox" hidden></div></div>`;
  }
  function snippet(t, query) {
    const text = String(t.descriptionText || "").replace(/\s+/g, " ");
    const w = fold(query).trim().split(/\s+/)[0];
    const i = fold(text).indexOf(w);
    if (i < 0) return "";
    const from = Math.max(0, i - 30), part = text.slice(from, i + w.length + 50);
    const j = i - from;
    return (from ? "…" : "") + esc(part.slice(0, j)) + "<mark>" + esc(part.slice(j, j + w.length)) + "</mark>" + esc(part.slice(j + w.length)) + "…";
  }
  function bindPicker(id, { candidates, onPick, note }) {
    const root = $("#" + id);
    if (!root) return;
    const input = $(".kb-picker-input", root), box = $(".kb-picker-list", root);
    let results = [], active = 0, serverTimer = 0, asked = "";
    const draw = () => {
      const all = searchTickets(candidates(), input.value, descText);
      clearTimeout(serverTimer);
      const q = input.value.trim();
      if (q && q !== asked) serverTimer = setTimeout(() => {
        asked = q;
        store.searchServer(q).then(() => { if (!box.hidden && input.value.trim() === q) draw(); }).catch(() => {});
      }, 250);
      results = all.slice(0, PICK_LIMIT);
      active = Math.min(active, Math.max(0, results.length - 1));
      box.innerHTML = results.map(({ t, where }, i) => `<div class="kb-pick${i === active ? " on" : ""}" role="option" aria-selected="${i === active}" data-i="${i}">
          <span class="kb-type kb-type-${typeOf(t.type).key}"><span class="material-symbols-outlined" aria-hidden="true">${typeOf(t.type).icon}</span></span>
          <span class="kb-link-key">${esc(t.key)}</span><span class="kb-pick-main"><span class="kb-pick-title">${esc(t.title)}</span>${where === "desc" ? `<span class="kb-pick-snip">${snippet(t, input.value)}</span>` : ""}</span>
          ${note && note(t) ? `<span class="kb-pick-note">${esc(note(t))}</span>` : ""}${statusPill(t)}</div>`).join("")
        + (results.length ? `<div class="kb-pick-foot">${all.length > PICK_LIMIT ? `Showing ${PICK_LIMIT} of ${all.length} matches. Keep typing to narrow down` : `${all.length} match${all.length === 1 ? "" : "es"}`}</div>` : '<div class="kb-pick-foot">No tickets match. Try a number, or other words from the title or description</div>');
      box.hidden = false;
      input.setAttribute("aria-expanded", "true");
      const on = $(".kb-pick.on", box);
      if (on) on.scrollIntoView({ block: "nearest" });
    };
    const close = () => { box.hidden = true; input.setAttribute("aria-expanded", "false"); };
    const choose = (i) => { const r = results[i]; if (!r) return; input.value = ""; close(); onPick(r.t); };
    input.addEventListener("focus", () => { active = 0; draw(); });
    input.addEventListener("input", () => { active = 0; draw(); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (box.hidden) draw(); active = (active + (e.key === "ArrowDown" ? 1 : -1) + results.length) % Math.max(1, results.length); draw(); }
      else if (e.key === "Enter") { e.preventDefault(); choose(active); }
      else if (e.key === "Escape") { if (!box.hidden) { e.stopPropagation(); close(); } }
    });
    box.addEventListener("mousedown", (e) => { const it = e.target.closest("[data-i]"); if (it) { e.preventDefault(); choose(+it.dataset.i); } });
    input.addEventListener("blur", () => setTimeout(close, 120));
  }

  function bindChildren(form) {
    const field = $('[data-field="children"]', form);
    if (!field) return;
    field.addEventListener("click", (e) => {
      const un = e.target.closest("[data-unlink-child]");
      if (un) {
        e.stopPropagation();
        const t = taskByKey(un.dataset.unlinkChild);
        if (t && canWrite()) {
          const epicKey = draft.key;
          store.updateTask(t.key, { epic: "" }, [`removed from epic ${epicKey}`]).catch(fail);
          refreshChildren(); toast(`<b>${esc(t.key)}</b> removed from ${esc(epicKey)}`); renderCurrent();
        }
        return;
      }
      const add = e.target.closest("[data-add-child]");
      if (add) {
        const type = add.dataset.addChild;
        withEpicSaved((epicKey) => {
          const ep = taskByKey(epicKey);
          openTask(null, { returnTo: epicKey, fields: { type, epic: epicKey, release: ep.release || state.settings.currentRelease, sprint: ep.sprint || "", labels: (ep.labels || []).slice() } });
        });
        return;
      }
      const li = e.target.closest("[data-open-child]");
      if (li) openTask(li.dataset.openChild, { returnTo: draft.key });
    });
    bindPicker("f-child-link", {
      candidates: () => knownTasks().filter((t) => t.type !== "epic" && t.epic !== draft.key),
      note: (t) => (t.epic ? `in ${t.epic}` : ""),
      onPick: (picked) => {
      const key = picked.key;
      withEpicSaved((epicKey) => {
        const t = taskByKey(key);
        if (!t) return;
        store.updateTask(key, { epic: epicKey }, [`added to epic ${epicKey}`]).catch(fail);
        renderCurrent();
        if (draft && draft.key === epicKey) refreshChildren();
        toast(`<b>${esc(key)}</b> added to ${esc(epicKey)}`);
      });
      },
    });
  }
  function refreshChildren() {
    const old = $('#task-form [data-field="children"]');
    if (!old || !draft) return;
    const tmp = document.createElement("div");
    tmp.innerHTML = fieldHTML("children");
    old.replaceWith(tmp.firstElementChild);
    bindChildren($("#task-form"));
  }
  // A brand-new epic is created first; an existing one keeps its unsaved
  // edits by saving them before the child opens.
  function withEpicSaved(then) {
    const key = draft.key;
    if (!draftIsNew && !formDirty()) { then(key); return; }
    submitTask({ then: (savedKey) => { openTask(savedKey, { loaded: true }); then(savedKey); } });
  }
  function formDirty() {
    const t = taskByKey(draft.key);
    if (!t) return true;
    const v = (id) => { const el = $("#" + id); return el ? el.value : undefined; };
    return (v("f-title") !== undefined && v("f-title").trim() !== t.title) || (descQ && KBEditor.getHtml(descQ) !== descInitial) || draft.flagged !== t.flagged || draft.type !== t.type;
  }

  let saving = false;
  async function submitTask(opts = {}) {
    if (saving || !draft) return;
    const form = $("#task-form");
    const val = (id) => { const el = $("#" + id, form); return el ? el.value : undefined; };
    const next = clone(draft);
    const set = (k, v) => { if (v !== undefined) next[k] = v; };
    set("title", val("f-title") !== undefined ? val("f-title").trim() : undefined);
    let notify = [];
    if (descQ) {
      next.description = KBEditor.getHtml(descQ);
      if (hasInlineImages(next.description)) {
        try { next.description = await store.externaliseImages(next.key || "new", next.description); }
        catch (e) { toast("A screenshot couldn't be uploaded, so the ticket wasn't saved. Try again."); return; }
      }
      const before = KBEditor.mentionsIn(draftIsNew ? "" : (store.getFull(next.key) || {}).description);
      notify = KBEditor.mentionsIn(next.description).filter((id) => id !== state.me && !before.includes(id));
    }
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
    if ((draft.attachments || []).some((a) => a.uploading)) errors.push(["attachments", "Wait for the attachments to finish uploading"]);

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
      if (sideCollapsed && errors.some(([k]) => $(`#kb-task-side [data-field="${k}"]`))) setSideCollapsed(false);
      err.hidden = false; err.textContent = errors.map((x) => x[1]).join(" · ");
      return;
    }
    if (next.type === "epic") next.epic = "";
    const [newStatus, newRes] = (val("f-status") || draft.status).split(":");
    const existing = draftIsNew ? null : store.getFull(next.key);
    const endOf = (status) => { const inCol = state.tasks.filter((t) => t.status === status); return inCol.length ? Math.max(...inCol.map((t) => t.rank)) + 10 : 10; };
    saving = true;
    const saveBtn = $("#f-save"); if (saveBtn) saveBtn.disabled = true;
    try {
      if (existing) {
        const patch = {}, activity = [];
        for (const k of ["type", "title", "description", "assignee", "reporter", "release", "sprint", "estimate", "logged", "priority", "due", "labels", "epic", "links", "flagged", "attachments"]) {
          const a = existing[k], b = next[k];
          if (JSON.stringify(a == null ? "" : a) !== JSON.stringify(b == null ? "" : b)) patch[k] = b;
        }
        if ("flagged" in patch) activity.push(patch.flagged ? "flagged this ticket" : "removed the flag");
        if ("assignee" in patch && !(newStatus !== existing.status)) activity.push(`reassigned ${firstName(existing.assignee)} → ${firstName(patch.assignee)}`);
        let ch = null;
        if (newStatus !== existing.status || (newStatus === "done" && newRes !== res(existing))) {
          ch = setStatus({ ...existing, ...patch }, newStatus, { resolution: newRes });
          if (ch) { patch.rank = endOf(newStatus); Object.assign(patch, ch.patch); activity.push(ch.activity); }
        }
        // An epic that stops being one lets go of its children (KB-TASK-7).
        const others = [];
        if (existing.type === "epic" && next.type !== "epic") {
          const kids = await store.fetchChildren(existing.key).catch(() => childrenOf(existing.key));
          for (const k of kids) others.push({ key: k.key, patch: { epic: "" }, activity: [`removed from epic ${existing.key} (no longer an epic)`] });
          if (kids.length) setTimeout(() => toast(`${kids.length} ticket${kids.length > 1 ? "s" : ""} no longer ha${kids.length > 1 ? "ve" : "s"} a parent epic`), 3700);
        }
        if (commentQ && KBEditor.getHtml(commentQ)) addCommentFromEditor();
        if (Object.keys(patch).length || others.length) await store.updateTask(existing.key, patch, activity, others);
        if (!ch) toast(`<b>${esc(existing.key)}</b> saved`);
      } else {
        const fields = { ...next, status: "backlog", resolution: null, rank: endOf("backlog") };
        delete fields.key; delete fields.comments; delete fields.activity;
        const key = await store.createTask(fields);
        next.key = key;
        await store.fetchTask(key).catch(() => {});
        toast(`<b>${esc(key)}</b> created in Backlog`);
      }
      if (notify.length) {
        store.notify(notify, next.key, next.title, "description").catch(() => {});
        setTimeout(() => toast(`${esc(notify.map(firstName).join(", "))} notified about <b>${esc(next.key)}</b>`), 1800);
      }
    } catch (e) {
      saving = false;
      if (saveBtn) saveBtn.disabled = false;
      const err2 = $("#f-error");
      if (err2) { err2.hidden = false; err2.textContent = e && e.code === "permission-denied" ? "You don't have permission to save this ticket." : "This ticket wasn't saved. Check your connection and try again."; }
      console.warn("staff kanban: save failed", e);
      return;
    }
    saving = false;
    if (opts.then) { const back = returnTo; returnTo = null; closeTask(); returnTo = back; renderCurrent(); opts.then(next.key); return; }
    if (returnTo && !existing) toast(`<b>${esc(next.key)}</b> created in Backlog · added to ${esc(returnTo)}`);
    closeTask(); renderCurrent();
  }
  function initModal() {
    $("#task-side-toggle").addEventListener("click", () => setSideCollapsed(!sideCollapsed));
    $("#task-form").addEventListener("click", (e) => { if (e.target.closest("#kb-side-tab")) setSideCollapsed(false); });
    $("#task-flag").addEventListener("click", () => { if (draft && canWrite()) { draft.flagged = !draft.flagged; syncModalFlag(); } });
    $("#task-close").addEventListener("click", closeTask);
    $("#task-backdrop").addEventListener("click", (e) => { if (e.target.id === "task-backdrop") closeTask(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#task-backdrop").hidden) closeTask(); });
  }

  // ── Release report ──────────────────────────────────────────────────────
  // Report columns: every status, with the last one split into Completed and Withdrawn.
  const REPORT_COLS = STATUSES.filter((s) => s.key !== "done").map((s) => ({ key: s.key, short: s.short, match: (t) => t.status === s.key }))
    .concat(RESOLUTIONS.map((r) => ({ key: "done:" + r.key, short: r.label, match: (t) => res(t) === r.key })));
  const REPORT_KEYS = ["release", "assignee", "status", "type", "priority", "sprint", "label", "epic"];
  function renderReport(view, params) {
    const f = Object.fromEntries(REPORT_KEYS.map((k) => [k, params.get(k) || ""]));
    if (!params.has("release")) f.release = state.settings.currentRelease;
    if (!f.status) f.status = "outstanding";
    const rel = release(f.release);
    store.watchRelease(f.release === "all" ? "" : f.release);
    const staffList = people();

    const inScope = state.tasks.filter((t) => t.type !== "epic" && (!f.release || f.release === "all" || t.release === f.release));
    const filtered = inScope.filter((t) => {
      if (f.status === "outstanding" ? t.status === "done" : f.status.startsWith("done:") ? "done:" + res(t) !== f.status : f.status !== "all" && t.status !== f.status) return false;
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
    const doneInRel = inScope.filter((t) => res(t) === "completed").length;
    const withdrawnInRel = inScope.filter((t) => res(t) === "withdrawn").length;
    const noEstimate = outstanding.filter((t) => !(+t.estimate)).length;
    const wd = rel && !rel.released && rel.date ? workingDaysUntil(rel.date, today()) : 0;
    const capPer = wd * 6;

    // per person
    const ids = staffList.map((u) => u.id);
    for (const t of inScope) if (t.assignee && !ids.includes(t.assignee)) ids.push(t.assignee);
    const rows = [...ids, ""].map((id) => {
      const mine = filtered.filter((t) => (t.assignee || "") === id);
      const out = mine.filter((t) => t.status !== "done");
      return {
        id, tasks: mine, out,
        byStatus: Object.fromEntries(REPORT_COLS.map((s) => [s.key, mine.filter(s.match).length])),
        est: mine.reduce((n, t) => n + (+t.estimate || 0), 0),
        log: mine.reduce((n, t) => n + (+t.logged || 0), 0),
        rem: out.reduce((n, t) => n + remaining(t), 0),
      };
    }).filter((p) => p.tasks.length);
    rows.sort((a, b) => b.rem - a.rem || b.out.length - a.out.length);
    const maxRem = Math.max(1, ...rows.map((p) => p.rem));
    const scale = Math.max(maxRem, capPer || 0);
    // Completed / Withdrawn columns only when the status filter includes them.
    const statusCols = REPORT_COLS.filter((s) => !s.key.startsWith("done:") || f.status === "all" || f.status === s.key);

    const sel = (k, all, items) => `<label class="kb-rfilter"><span>${esc(all[0])}</span><select data-rf="${k}">${items}</select></label>`;
    const relItems = releases().map((r) => opt(r.id, r.name + (r.id === state.settings.currentRelease ? " (current)" : r.released ? " (released)" : ""), f.release)).join("") + opt("all", "All releases", f.release);
    const anyExtra = f.assignee || f.type || f.priority || f.sprint || f.label || f.epic || f.status !== "outstanding" || f.release !== state.settings.currentRelease;

    const capState = (p) => {
      if (!capPer || !p.id) return "";
      const r = p.rem / capPer;
      const s = r > 1 ? ["bad", "Over capacity"] : r > 0.8 ? ["pending", "Tight"] : ["ok", "On track"];
      return `<span class="kb-cap"><span class="health-dot health-dot-${s[0]}" aria-hidden="true"></span>${s[1]}</span>`;
    };

    view.innerHTML = `
      <div class="page-header">
        <button type="button" class="btn-ghost kb-back" data-route="kanban" aria-label="Back to Staff Kanban" title="Back to Staff Kanban"><span class="material-symbols-outlined" aria-hidden="true">arrow_back</span></button>
        <h2>Release report</h2>
        <span class="page-header-count">${esc(f.release === "all" ? "All releases" : releaseName(f.release))}</span>
      </div>
      <div class="kb-filters kb-report-filters">
        ${sel("release", ["Release"], relItems)}
        ${sel("status", ["Status"], opt("outstanding", "Outstanding (not completed)", f.status) + opt("all", "All, including completed / withdrawn", f.status) + STATUSES.filter((s) => s.key !== "done").map((s) => opt(s.key, s.label, f.status)).join("") + RESOLUTIONS.map((r) => opt("done:" + r.key, r.label, f.status)).join(""))}
        ${sel("assignee", ["Staff member"], opt("", "Everyone", f.assignee) + staffList.map((u) => opt(u.id, u.first, f.assignee)).join("") + opt("none", "Unassigned", f.assignee))}
        ${sel("type", ["Type"], opt("", "All types", f.type) + TYPES.filter((t) => t.key !== "epic").map((t) => opt(t.key, t.label, f.type)).join(""))}
        ${sel("priority", ["Priority"], opt("", "All priorities", f.priority) + PRIORITIES.map((p) => opt(p.key, p.label, f.priority)).join(""))}
        ${sel("sprint", ["Sprint"], opt("", "All sprints", f.sprint) + sprints().map((s) => opt(s.id, s.name, f.sprint)).join(""))}
        ${sel("label", ["Label"], opt("", "All labels", f.label) + allLabels().map((l) => opt(l, l, f.label)).join(""))}
        ${sel("epic", ["Epic"], opt("", "All epics", f.epic) + epics().map((e) => opt(e.key, e.title, f.epic)).join(""))}
        ${anyExtra ? '<button type="button" class="link-btn kb-clear" id="rp-reset">Reset to current release</button>' : ""}
      </div>

      <div class="kb-kpis">
        <div class="kb-kpi"><div class="kb-kpi-label">Outstanding tasks${tip("Tasks in the selected release and filters that are not in Completed / Withdrawn.")}</div><div class="kb-kpi-value">${outstanding.length}</div><div class="kb-kpi-sub">${doneInRel} completed${withdrawnInRel ? ` · ${withdrawnInRel} withdrawn` : ""}${outstanding.filter((t) => t.flagged).length ? ` · <span class="kb-kpi-flag"><span class="material-symbols-outlined" aria-hidden="true">flag</span>${outstanding.filter((t) => t.flagged).length} flagged</span>` : ""}</div></div>
        <div class="kb-kpi"><div class="kb-kpi-label">Remaining effort${tip("Sum of estimate minus time logged on each outstanding task, never below zero. 1d = 8h.")}</div><div class="kb-kpi-value">${fmtH(totalRem)}</div><div class="kb-kpi-sub">${noEstimate ? `${noEstimate} without estimate` : "All estimated"}</div></div>
        <div class="kb-kpi"><div class="kb-kpi-label">Time logged${tip("Time logged against the filtered tasks, as a share of their total estimate.")}</div><div class="kb-kpi-value">${fmtH(totalLog)}</div><div class="kb-kpi-sub">${totalEst ? Math.round((totalLog / totalEst) * 100) + "% of " + fmtH(totalEst) : "—"}</div></div>
        <div class="kb-kpi"><div class="kb-kpi-label">Release date${tip("Working days (Mon–Fri) from today to the release date.")}</div><div class="kb-kpi-value">${rel && rel.date ? fmtDate(rel.date) : "—"}</div><div class="kb-kpi-sub">${rel ? (rel.released ? "Released" : rel.date ? `${wd} working days left` : "No date set (Kanban settings)") : "Pick a release"}</div></div>
      </div>

      <section class="docs-block kb-report-block">
        <div class="docs-block-header"><h3>Remaining effort by staff member${tip(capPer ? `Bar length is remaining effort. Capacity assumes 6 focused hours per working day until release: ${fmtH(capPer)} each.` : "Bar length is remaining effort.")}</h3></div>
        <div class="kb-bars" id="rp-bars">
          ${rows.filter((p) => p.out.length).map((p) => `<button type="button" class="kb-bar-row" data-person="${p.id || "none"}" data-tip="${esc(`${firstName(p.id)}: ${fmtH(p.rem)} remaining · ${p.out.length} task${p.out.length === 1 ? "" : "s"}${capPer && p.id ? ` · ${Math.round((p.rem / capPer) * 100)}% of capacity` : ""}`)}">
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
              ${rows.map((p) => `<tr class="kb-click-row${f.assignee === (p.id || "none") ? " kb-row-on" : ""}" data-person="${p.id || "none"}"><td><span class="kb-person-cell">${avatar(p.id)}${esc(firstName(p.id))}</span></td><td class="num">${p.tasks.length}</td>${statusCols.map((s) => `<td class="num${p.byStatus[s.key] ? "" : " kb-zero"}">${p.byStatus[s.key] || "–"}</td>`).join("")}<td class="num">${fmtH(p.est)}</td><td class="num">${fmtH(p.log)}</td><td class="num"><b>${fmtH(p.rem)}</b></td>${capPer ? `<td>${capState(p)}</td>` : ""}</tr>`).join("") || `<tr><td colspan="${6 + statusCols.length}" class="empty-hint">No tasks match these filters</td></tr>`}
            </tbody>
            ${rows.length ? `<tfoot><tr><td><b>Total</b></td><td class="num"><b>${filtered.length}</b></td>${statusCols.map((s) => `<td class="num"><b>${filtered.filter(s.match).length || "–"}</b></td>`).join("")}<td class="num"><b>${fmtH(totalEst)}</b></td><td class="num"><b>${fmtH(totalLog)}</b></td><td class="num"><b>${fmtH(totalRem)}</b></td>${capPer ? "<td></td>" : ""}</tr></tfoot>` : ""}
          </table>
        </div>
      </section>

      <section class="docs-block kb-report-block">
        <div class="docs-block-header"><h3>${f.status === "outstanding" ? "Outstanding tasks" : "Tasks"} <span class="kb-h-count">${filtered.length}</span>${tip("Grouped by staff member. Click a task to open it.")}</h3></div>
        <div class="archive-table-wrap">
          <table class="archive-table kb-table">
            <thead><tr><th>Task</th><th>Status</th><th>Priority</th><th>Sprint</th><th>Due</th><th class="num">Estimate</th><th class="num">Logged</th><th class="num">Remaining</th></tr></thead>
            <tbody>
              ${rows.map((p) => `<tr class="kb-group-row"><td colspan="8"><span class="kb-person-cell">${avatar(p.id)}<b>${esc(firstName(p.id))}</b><span class="kb-none">${p.tasks.length} task${p.tasks.length === 1 ? "" : "s"} · ${fmtH(p.rem)} remaining</span></span></td></tr>` +
                p.tasks.slice().sort((a, b) => STATUSES.findIndex((s) => s.key === a.status) - STATUSES.findIndex((s) => s.key === b.status) || a.rank - b.rank).map((t) => {
                  const overdue = t.due && t.status !== "done" && daysBetween(t.due, today()) < 0;
                  const pr = prioOf(t.priority), ty = typeOf(t.type);
                  return `<tr class="kb-click-row" data-open="${esc(t.key)}"><td><span class="kb-task-cell"><span class="kb-type kb-type-${ty.key}"><span class="material-symbols-outlined" aria-hidden="true">${ty.icon}</span></span><span class="kb-key">${esc(t.key)}</span><span class="archive-row-title">${esc(t.title)}</span>${t.flagged ? '<span class="material-symbols-outlined kb-flag-mini" title="Flagged" aria-label="Flagged">flag</span>' : ""}</span></td>
                    <td>${statusPill(t)}</td>
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
    // bar hover tooltip
    const bt = $("#kb-bar-tip");
    $$(".kb-bar-row", view).forEach((b) => {
      b.addEventListener("pointermove", (e) => { bt.hidden = false; bt.textContent = b.dataset.tip; bt.style.left = Math.min(e.clientX + 14, innerWidth - bt.offsetWidth - 8) + "px"; bt.style.top = e.clientY + 14 + "px"; });
      b.addEventListener("pointerleave", () => { bt.hidden = true; });
    });
  }

  // ── Kanban settings (KB-SET-1, KB-SET-2) ────────────────────────────────
  // Everyone can see them; only an admin can change them (firestore.rules
  // kanbanSettings / kanbanSprints).
  function renderSettings(view) {
    const S = state.settings;
    const stored = store.state.settings; // what the server has, not the fallback it uses
    const admin = isAdmin();
    const dis = admin ? "" : " disabled";
    const row = (f, core) => {
      const c = S.fields[f.key];
      return `<div class="kb-set-row${core ? " kb-set-core" : ""}">
        <span class="kb-set-name">${esc(f.label)}${core && f.lockRequired ? '<span class="kb-set-tag">Always required</span>' : ""}</span>
        <label class="kb-set-toggle"><span class="kb-set-col">Show</span><input type="checkbox" data-show="${f.key}" ${c.show ? "checked" : ""} ${core || !admin ? "disabled" : ""} aria-label="Show ${esc(f.label)} on the form"></label>
        <label class="kb-set-toggle"><span class="kb-set-col">Required</span><input type="checkbox" data-req="${f.key}" ${c.required ? "checked" : ""} ${f.lockRequired || !c.show || !admin || ["comments", "attachments", "flag", "release"].includes(f.key) ? "disabled" : ""} aria-label="${esc(f.label)} required"></label>
      </div>`;
    };
    const rels = releases();
    view.innerHTML = `
      <div class="page-header">
        <button type="button" class="btn-ghost kb-back" data-route="kanban" aria-label="Back to Staff Kanban" title="Back to Staff Kanban"><span class="material-symbols-outlined" aria-hidden="true">arrow_back</span></button>
        <h2>Kanban settings</h2>
      </div>
      <div class="kb-settings">
        ${admin ? "" : '<p class="kb-readonly-note"><span class="material-symbols-outlined" aria-hidden="true">lock</span>Only an admin can change these settings.</p>'}
        <section class="docs-block">
          <div class="docs-block-header"><h3>Task form fields${tip("Choose which optional fields appear on the create / edit form and which must be filled in. Hidden fields stay settable over MCP and editable later on an existing ticket.")}</h3>
            ${canWrite() ? '<button type="button" class="btn-ghost" id="st-preview">Preview form</button>' : ""}</div>
          <div class="kb-set-group-label">Core</div>
          ${CORE_FIELDS.map((f) => row(f, true)).join("")}
          <div class="kb-set-group-label">Optional</div>
          ${OPTIONAL_FIELDS.map((f) => row(f, false)).join("")}
        </section>
        <section class="docs-block">
          <div class="docs-block-header"><h3>Workflow${tip("Moving a task into Ready for Testing reassigns it to this person. Moving it back to In Progress or Ready for Dev returns it to the developer.")}</h3></div>
          <label class="field-label" for="st-tester">Ready for Testing reassigns to</label>
          <select id="st-tester" class="kb-input"${dis}>${opt("", `Not set (${firstName(S.tester)} is used)`, stored.testerIsDefault ? "" : "-")}${peopleWith(stored.testerIsDefault ? "" : stored.tester).map((u) => opt(u.id, u.first, stored.testerIsDefault ? "" : stored.tester)).join("")}</select>
          <label class="field-label" for="st-release">Current release</label>
          <select id="st-release" class="kb-input"${dis}>${opt("", S.currentRelease ? `Not set (${releaseName(S.currentRelease)} is used)` : rels.length ? "Not set" : "No releases yet (add one on the Releases page)", stored.currentRelease)}${rels.filter((r) => !r.released || r.id === stored.currentRelease).map((r) => opt(r.id, r.date ? `${r.name} · ${fmtDate(r.date, { day: "numeric", month: "short", year: "numeric" })}` : r.name, stored.currentRelease)).join("")}</select>
        </section>
        <section class="docs-block">
          <div class="docs-block-header"><h3>Release dates${tip("The release report counts working days to these dates and sizes each person's capacity from them. Releases themselves are managed on the console's Releases page.")}</h3></div>
          <div class="kb-set-dates">${rels.map((r) => `<label class="kb-set-row"><span class="kb-set-name">${esc(r.name)}${r.released ? '<span class="kb-set-tag">Released</span>' : ""}</span><input type="date" class="kb-input" data-rel-date="${esc(r.id)}" value="${esc(r.date)}"${dis} aria-label="${esc(r.name)} release date"></label>`).join("") || '<p class="kb-none">No releases yet</p>'}</div>
        </section>
        <section class="docs-block">
          <div class="docs-block-header"><h3>Sprints${tip("Sprint is a field and a filter (no sprint planning board). Add the sprints people can pick.")}</h3></div>
          <ul class="kb-sublist">${sprints().map((sp) => `<li><span class="kb-link-title">${esc(sp.name)}</span><span class="kb-none">${esc(sp.range)}</span></li>`).join("") || '<li class="kb-none">No sprints yet</li>'}</ul>
          ${admin ? `<div class="kb-add-row kb-sprint-add"><input type="text" class="kb-input" id="st-sprint-name" placeholder="Sprint name" maxlength="80" aria-label="Sprint name"><input type="date" class="kb-input" id="st-sprint-start" aria-label="Start date"><input type="date" class="kb-input" id="st-sprint-end" aria-label="End date"><button type="button" class="btn-ghost" id="st-sprint-add">Add sprint</button></div>` : ""}
        </section>
        <section class="docs-block">
          <div class="docs-block-header"><h3>Team${tip("Everyone added under Settings → Team & agent access appears in the assignee list by first name. Each person sets their own photo from the profile menu (Upload photo); an admin can set anyone's under Settings → Team & agent access.")}</h3></div>
          <ul class="kb-team">${people().map((u) => `<li>${avatar(u.id)}<span><b>${esc(u.first)}</b><span class="kb-none">${esc(u.full)}</span></span><span class="kb-none kb-team-email">${esc(u.email)}</span>${admin ? `<label class="kb-team-name"><span class="kb-none">Shown as</span><input type="text" class="kb-input" data-first-for="${esc(u.id)}" value="${esc(u.first)}" maxlength="40" aria-label="${esc(u.full)} is shown as"></label>` : ""}</li>`).join("")}</ul>
        </section>
      </div>`;
    const saveS = (patch, msg) => store.saveSettings(patch).then(() => toast(msg)).catch(fail);
    $$("[data-show]", view).forEach((c) => c.addEventListener("change", () => {
      const fields = clone(S.fields);
      fields[c.dataset.show].show = c.checked;
      if (!c.checked) fields[c.dataset.show].required = false;
      saveS({ fields }, `${esc(FIELD_LABEL[c.dataset.show])} ${c.checked ? "shown on" : "hidden from"} the form`);
    }));
    $$("[data-req]", view).forEach((c) => c.addEventListener("change", () => {
      const fields = clone(S.fields);
      fields[c.dataset.req].required = c.checked;
      saveS({ fields }, `${esc(FIELD_LABEL[c.dataset.req])} ${c.checked ? "required" : "optional"}`);
    }));
    $("#st-tester").addEventListener("change", (e) => saveS({ tester: e.target.value }, `Ready for Testing now reassigns to <b>${esc(firstName(e.target.value || DEFAULT_TESTER))}</b>`));
    $("#st-release").addEventListener("change", (e) => saveS({ currentRelease: e.target.value }, `Current release is <b>${esc(releaseName(e.target.value || currentReleaseId({}, releases())))}</b>`));
    $$("[data-rel-date]", view).forEach((inp) => inp.addEventListener("change", () => {
      saveS({ releaseDates: { ...(store.state.settings.releaseDates || {}), [inp.dataset.relDate]: inp.value } }, `${esc(releaseName(inp.dataset.relDate))} date saved`);
    }));
    $$("[data-first-for]", view).forEach((inp) => inp.addEventListener("change", () => {
      const v = inp.value.trim();
      const firstNames = { ...(store.state.settings.firstNames || {}) };
      if (v) firstNames[inp.dataset.firstFor] = v; else delete firstNames[inp.dataset.firstFor];
      saveS({ firstNames }, v ? `Shown as <b>${esc(v)}</b>` : "Name reset");
    }));
    const add = $("#st-sprint-add");
    if (add) add.addEventListener("click", () => {
      const name = $("#st-sprint-name").value.trim();
      if (!name) { $("#st-sprint-name").focus(); return; }
      store.addSprint({ name, start: $("#st-sprint-start").value, end: $("#st-sprint-end").value }).then(() => toast(`<b>${esc(name)}</b> added`)).catch(fail);
    });
    const pv = $("#st-preview");
    if (pv) pv.addEventListener("click", () => openTask(null));
  }

  // (i) tips render in one floating bubble on <body>, placed above the icon
  // (or below if there's no room) and kept inside the window, so a scrolling
  // modal or the screen edge never cuts them off. Only on this page: the rest
  // of the console keeps its own CSS tooltips.
  function initTips() {
    const bubble = document.createElement("div");
    bubble.className = "kb-tip-bubble";
    bubble.setAttribute("role", "tooltip");
    bubble.hidden = true;
    document.body.appendChild(bubble);
    let current = null, shownAt = 0;
    const mine = (b) => b && (pageEl.contains(b) || $("#task-backdrop").contains(b));
    const show = (b) => {
      if (current !== b) shownAt = Date.now();
      current = b;
      bubble.textContent = b.dataset.tip;
      bubble.hidden = false;
      const r = b.getBoundingClientRect(), w = bubble.offsetWidth, h = bubble.offsetHeight, m = 8;
      let left = r.left + r.width / 2 - w / 2;
      left = Math.max(m, Math.min(left, innerWidth - w - m));
      let top = r.top - h - 8;
      if (top < m) top = r.bottom + 8;
      top = Math.max(m, Math.min(top, innerHeight - h - m));
      bubble.style.left = left + "px"; bubble.style.top = top + "px";
    };
    const hide = () => { bubble.hidden = true; current = null; };
    const tipOf = (e) => { const b = e.target.closest && e.target.closest(".info-tip"); return mine(b) ? b : null; };
    document.addEventListener("pointerover", (e) => { const b = tipOf(e); if (b) show(b); else if (current && !e.target.closest(".kb-tip-bubble")) hide(); });
    document.addEventListener("focusin", (e) => { const b = tipOf(e); if (b) show(b); });
    document.addEventListener("focusout", (e) => { if (tipOf(e)) hide(); });
    document.addEventListener("click", (e) => {
      const b = tipOf(e);
      if (b) { e.preventDefault(); e.stopPropagation(); if (current === b && !bubble.hidden && Date.now() - shownAt > 400) hide(); else show(b); }
      else if (current) hide();
    }, true);
    addEventListener("scroll", hide, true);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
  }

  // Filters panel: a click anywhere else closes it.
  document.addEventListener("click", (e) => {
    if (pageEl.hidden || !filtersOpen || e.target.closest("#kb-filter-panel, #kb-filter-toggle")) return;
    filtersOpen = false;
    const fp = $("#kb-filter-panel"); if (fp) fp.hidden = true;
    const ft = $("#kb-filter-toggle"); if (ft) ft.setAttribute("aria-expanded", "false");
  });
  // Pinned headers sit under the console's topbar while it's on screen.
  const measure = () => { const tb = $(".topbar"); if (tb) root.style.setProperty("--sticky-topbar-h", tb.offsetHeight + "px"); };
  addEventListener("resize", measure); measure();

  // ── Boot ────────────────────────────────────────────────────────────────
  initModal();
  initDrag();
  initTips();
  store.start();
  return {
    show, hide,
    refresh: () => renderCurrent(),
    // Opens a ticket by key from elsewhere in the console (Command-K).
    openTask: (key) => openTaskByKey(key),
    store,
  };
}
