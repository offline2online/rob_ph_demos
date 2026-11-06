// Promote › Prospects (TAM) (#promote/prospects): the global prospects database
// as an AG Grid, built the same way as Settings › User Management › Users
// (user-management.js): `ag-theme-alpine um-grid`, floating filter row, a
// checkbox column with a bulk bar, a pinned-right "⋯" menu, pagination.
// AG Grid is loaded lazily by docs-grid.js.
//
// One row per company in `prospects/{id}` (prospects-core.js). Filtering is the
// grid's own: floating filters per column plus a quick-search box, so the count,
// CSV export and bulk actions all see the same rows. A write is live for
// everyone through onSnapshot. "Convert to lead" writes one Leads card whose id
// comes from the prospect's (leadIdForProspect), so a prospect can never become
// two leads, and links the two both ways (lead.prospectId, prospect.leadId).
// Saved filters (grid filter model + sort + search text) are per browser
// (localStorage, bt-prospect-grid-filters).
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, onSnapshot, serverTimestamp, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { loadAgGrid } from "./docs-grid.js";
import {
  STATUSES, SIZE_BANDS, normaliseProspect, toCsv, statusLabel, sizeBandLabel, leadIdForProspect, leadFieldsFromProspect,
  prospectFromInput, slugId,
} from "./prospects-core.js";
import { SEED_PROSPECTS, SEED_SOURCE } from "./prospects-seed.js";

const $ = (id) => document.getElementById(id);
const SAVED_KEY = "bt-prospect-grid-filters";
const LEGACY_KEY = "bt-prospect-filters";
const safeUrl = (u) => { try { const x = new URL(String(u)); return x.protocol === "https:" || x.protocol === "http:" ? x.href : ""; } catch { return ""; } };
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const textModel = (v) => ({ filterType: "text", type: "contains", filter: v });

// The old toolbar's saved filters (dropdown values) as a grid filter model.
export function legacySavedToModel(f) {
  const m = {};
  if (f.industry) m.industry = textModel(f.industry);
  if (f.market) m.markets = textModel(f.market);
  if (f.awsRegion) m.awsRegion = { value: f.awsRegion };
  if (f.campaign) m.campaigns = textModel(f.campaign);
  if (f.sizeBand) m.sizeBand = { value: f.sizeBand };
  if (f.status) m.status = { value: f.status };
  const min = Number(f.minStores), max = Number(f.maxStores);
  const hasMin = String(f.minStores || "").trim() !== "" && Number.isFinite(min);
  const hasMax = String(f.maxStores || "").trim() !== "" && Number.isFinite(max);
  if (hasMin && hasMax) m.storeCount = { filterType: "number", operator: "AND", conditions: [{ filterType: "number", type: "greaterThanOrEqual", filter: min }, { filterType: "number", type: "lessThanOrEqual", filter: max }] };
  else if (hasMin) m.storeCount = { filterType: "number", type: "greaterThanOrEqual", filter: min };
  else if (hasMax) m.storeCount = { filterType: "number", type: "lessThanOrEqual", filter: max };
  return m;
}
export function readSaved(raw) {
  const out = [];
  for (const s of Array.isArray(raw) ? raw : []) {
    const name = String((s && s.name) || "").trim().slice(0, 60);
    if (!name || out.some((o) => o.name.toLowerCase() === name.toLowerCase())) continue;
    const model = s.model && typeof s.model === "object" ? s.model : s.filter && typeof s.filter === "object" ? legacySavedToModel(s.filter) : {};
    const q = String((s.q != null ? s.q : s.filter && s.filter.q) || "").slice(0, 120);
    const sort = Array.isArray(s.sort) ? s.sort.filter((x) => x && typeof x.colId === "string" && (x.sort === "asc" || x.sort === "desc")).map((x) => ({ colId: x.colId, sort: x.sort })) : [];
    out.push({ name, model, q, sort });
  }
  return out.slice(0, 30);
}

// A dropdown ("set"-style) filter for the floating row, for columns with a short fixed list of values.
class SelectFilter {
  init(params) {
    this.params = params; this.value = "";
    this.el = document.createElement("div");
    this.sel = document.createElement("select");
    this.sel.className = "um-role-select";
    this.sel.setAttribute("aria-label", `Filter ${params.colDef.headerName}`);
    this.fill();
    this.sel.addEventListener("change", () => this.setValue(this.sel.value));
    this.el.appendChild(this.sel);
  }
  fill() {
    const opts = this.params.values();
    this.sel.innerHTML = `<option value="">All</option>` + opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
    this.sel.value = this.value;
  }
  setValue(v) { this.value = v || ""; this.sel.value = this.value; this.params.filterChangedCallback(); }
  getGui() { return this.el; }
  isFilterActive() { return !!this.value; }
  doesFilterPass(p) { return String((p.data || {})[this.params.colDef.field] || "").toLowerCase() === this.value.toLowerCase(); }
  getModel() { return this.value ? { value: this.value } : null; }
  setModel(m) { this.value = m && m.value ? String(m.value) : ""; this.sel.value = this.value; }
  afterGuiAttached() { this.fill(); }
}
class SelectFloatingFilter {
  init(params) {
    this.params = params;
    this.sel = document.createElement("select");
    this.sel.className = "um-role-select prospects-float-select";
    this.sel.setAttribute("aria-label", `Filter ${params.column.getColDef().headerName}`);
    this.fill("");
    this.sel.addEventListener("change", () => params.parentFilterInstance((f) => f.setValue(this.sel.value)));
  }
  fill(current) {
    const opts = this.params.values();
    this.sel.innerHTML = `<option value="">All</option>` + opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
    this.sel.value = current;
    if (this.sel.value !== current) this.sel.value = "";
  }
  getGui() { return this.sel; }
  onParentModelChanged(model) { this.fill(model && model.value ? model.value : ""); }
}

export function mountProspectsPage({ db, auth, canEdit, askName }) {
  const page = $("prospects-page");
  const host = $("prospects-grid");
  const status = $("prospects-status");
  const pop = $("prospects-pop");
  let rows = [];
  let unsub = null;
  let started = false;
  let grid = null;
  let gridLoading = null;
  let saved = [];
  let popAnchor = null;
  const me = () => String((auth.currentUser && auth.currentUser.email) || "").toLowerCase();
  const say = (t, bad) => { status.textContent = t || ""; status.classList.toggle("is-error", !!bad); };

  try {
    const raw = localStorage.getItem(SAVED_KEY) || localStorage.getItem(LEGACY_KEY) || "[]";
    saved = readSaved(JSON.parse(raw));
  } catch { saved = []; }
  const persistSaved = () => { try { localStorage.setItem(SAVED_KEY, JSON.stringify(saved)); } catch { /* private mode */ } };

  // ── Popup menu (row actions, saved filters, columns) ─────────────────────
  function closePop() { pop.hidden = true; pop.innerHTML = ""; if (popAnchor) popAnchor.setAttribute("aria-expanded", "false"); popAnchor = null; }
  function openPop(anchor, html, onItem) {
    if (popAnchor === anchor && !pop.hidden) { closePop(); return; }
    closePop();
    popAnchor = anchor; anchor.setAttribute("aria-expanded", "true");
    pop.innerHTML = html; pop.hidden = false;
    const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = `${Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))}px`;
    pop.style.top = `${r.bottom + h + 8 > window.innerHeight && r.top > h ? r.top - h - 4 : r.bottom + 4}px`;
    pop._onItem = onItem;
    const first = pop.querySelector("button, input");
    if (first) first.focus({ preventScroll: true });
  }
  pop.addEventListener("click", (e) => {
    const t = e.target.closest("[data-pop]");
    if (t && pop._onItem) pop._onItem(t.dataset.pop, t.dataset.arg, t);
  });
  document.addEventListener("click", (e) => { if (!pop.hidden && !pop.contains(e.target) && !(popAnchor && popAnchor.contains(e.target))) closePop(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !pop.hidden) { const a = popAnchor; closePop(); if (a) a.focus(); } });

  // ── Header: count, search, bulk bar ──────────────────────────────────────
  const filteredRows = () => {
    const out = [];
    if (grid) grid.api.forEachNodeAfterFilterAndSort((n) => { if (n.data) out.push(n.data); });
    return out;
  };
  const selectedRows = () => (grid ? grid.api.getSelectedRows() : []);
  function updateCount() {
    const total = rows.length;
    const shown = grid ? filteredRows().length : total;
    const word = total === 1 ? "Prospect" : "Prospects";
    $("prospects-count").innerHTML = shown === total ? `<b>${total.toLocaleString("en-GB")}</b> ${word}` : `<b>${shown.toLocaleString("en-GB")}</b> of ${total.toLocaleString("en-GB")} ${word}`;
    $("prospects-empty").hidden = total > 0;
    $("prospects-seed-btn").hidden = total > 0 || !canEdit();
    host.hidden = total === 0;
    $("prospects-tools").hidden = total === 0;
  }
  function updateBulk() {
    const sel = selectedRows();
    $("prospects-bulk").hidden = sel.length === 0 || !canEdit();
    $("prospects-bulk-count").textContent = `${sel.length} selected`;
  }
  $("prospects-q").addEventListener("input", (e) => { if (grid) grid.api.setGridOption("quickFilterText", e.target.value); });

  function download(list, stem) {
    const blob = new Blob([toCsv(list)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${stem}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    say(`Exported ${list.length.toLocaleString("en-GB")} ${list.length === 1 ? "prospect" : "prospects"}.`);
  }
  $("prospects-export").addEventListener("click", () => download(filteredRows(), "prospects"));
  $("prospects-export-selected").addEventListener("click", () => { const l = selectedRows(); if (l.length) download(l, "prospects-selected"); });

  // ── Saved filters ────────────────────────────────────────────────────────
  function currentView() {
    const sort = grid ? grid.api.getColumnState().filter((c) => c.sort).sort((a, b) => (a.sortIndex || 0) - (b.sortIndex || 0)).map((c) => ({ colId: c.colId, sort: c.sort })) : [];
    return { model: grid ? grid.api.getFilterModel() : {}, q: $("prospects-q").value.trim(), sort };
  }
  function applyView(v) {
    if (!grid) return;
    grid.api.setFilterModel(Object.keys(v.model || {}).length ? v.model : null);
    grid.api.applyColumnState({ state: (v.sort || []).map((s, i) => ({ colId: s.colId, sort: s.sort, sortIndex: i })), defaultState: { sort: null } });
    $("prospects-q").value = v.q || "";
    grid.api.setGridOption("quickFilterText", v.q || "");
  }
  function savedMenuHtml() {
    const items = saved.map((s) => `<div class="prospects-pop-row"><button type="button" role="menuitem" class="prospects-pop-item" data-pop="apply" data-arg="${esc(s.name)}">${esc(s.name)}</button><button type="button" class="prospects-pop-del" data-pop="delete" data-arg="${esc(s.name)}" aria-label="Delete the saved filter ${esc(s.name)}"><span class="material-symbols-outlined" aria-hidden="true">delete</span></button></div>`).join("");
    return `<button type="button" role="menuitem" class="prospects-pop-item" data-pop="savefilter"><span class="material-symbols-outlined" aria-hidden="true">add</span>Save current filter…</button>`
      + `<button type="button" role="menuitem" class="prospects-pop-item" data-pop="reset"><span class="material-symbols-outlined" aria-hidden="true">close</span>Clear all filters</button>`
      + (items ? `<div class="prospects-pop-sep"></div>${items}` : "");
  }
  function savedMenuAction(act, arg) {
    if (act === "reset") { applyView({ model: {}, q: "", sort: [] }); closePop(); return; }
    if (act === "apply") { const s = saved.find((x) => x.name === arg); if (s) applyView(s); closePop(); say(`Applied the filter "${arg}".`); return; }
    if (act === "delete") {
      saved = saved.filter((s) => s.name !== arg); persistSaved(); say(`Deleted the filter "${arg}".`);
      openPop(popAnchor, savedMenuHtml(), savedMenuAction); return;
    }
    if (act === "savefilter") {
      const anchor = popAnchor; closePop();
      (async () => {
        const v = currentView();
        if (!Object.keys(v.model).length && !v.q && !v.sort.length) { say("Set a filter, search or sort to save.", true); return; }
        const name = await askName("Name this filter");
        const n = String(name == null ? "" : name).trim().slice(0, 60);
        if (name == null) return;
        if (!n) { say("Name the filter before saving it.", true); return; }
        saved = readSaved([...saved.filter((s) => s.name.toLowerCase() !== n.toLowerCase()), { name: n, ...v }]); persistSaved();
        say(`Saved the filter "${n}".`);
        if (anchor) anchor.focus();
      })();
    }
  }
  $("prospects-saved-btn").addEventListener("click", (e) => openPop(e.currentTarget, savedMenuHtml(), savedMenuAction));

  // ── Columns chooser ──────────────────────────────────────────────────────
  $("prospects-columns-btn").addEventListener("click", (e) => {
    if (!grid) return;
    const cols = grid.api.getColumns().filter((c) => c.getColDef().headerName && !["select", "actions"].includes(c.getColId()));
    const html = cols.map((c) => `<label class="prospects-pop-check" role="menuitemcheckbox"><input type="checkbox" data-pop="col" data-arg="${esc(c.getColId())}"${c.isVisible() ? " checked" : ""}>${esc(c.getColDef().headerName)}</label>`).join("");
    openPop(e.currentTarget, html, (act, arg, el) => { if (act === "col") grid.api.setColumnsVisible([arg], el.checked); });
  });

  // ── Convert to lead, status ──────────────────────────────────────────────
  async function convert(id, quiet) {
    const p = rows.find((x) => x.id === id);
    if (!p || !canEdit()) return false;
    if (p.leadId) { if (!quiet) window.location.hash = "#promote/leads"; return true; }
    if (!quiet) say(`Converting ${p.name}…`);
    try {
      const leadRef = doc(db, "leads", leadIdForProspect(p.id));
      const existing = await getDoc(leadRef);
      if (!existing.exists()) {
        await setDoc(leadRef, {
          ...leadFieldsFromProspect(p, me()),
          createdAt: serverTimestamp(), updatedAt: serverTimestamp(), stageChangedAt: serverTimestamp(), createdByEmail: me(), updatedByEmail: me(),
        });
      }
      await updateDoc(doc(db, "prospects", p.id), { leadId: leadRef.id, status: "converted", updatedAt: serverTimestamp(), updatedByEmail: me() });
      if (!quiet) say(existing.exists() ? `${p.name} already had a lead; the two are now linked.` : `${p.name} is now a lead.`);
      return true;
    } catch (e) {
      say(`Couldn't convert ${p.name}: ${e && e.message ? e.message : e}`, true);
      return false;
    }
  }
  async function setStatus(ids, next) {
    if (!canEdit() || !ids.length) return;
    try {
      for (let i = 0; i < ids.length; i += 400) {
        const batch = writeBatch(db);
        ids.slice(i, i + 400).forEach((id) => batch.update(doc(db, "prospects", id), { status: next, updatedAt: serverTimestamp(), updatedByEmail: me() }));
        await batch.commit();
      }
      say(`Set ${ids.length} ${ids.length === 1 ? "prospect" : "prospects"} to ${statusLabel(next)}.`);
    } catch (e) { say(`Couldn't save the status: ${e && e.message ? e.message : e}`, true); }
  }
  $("prospects-bulk-status").innerHTML = STATUSES.map((s) => `<option value="${esc(s.key)}">${esc(s.label)}</option>`).join("");
  $("prospects-bulk-apply").addEventListener("click", () => setStatus(selectedRows().map((r) => r.id), $("prospects-bulk-status").value));
  $("prospects-bulk-convert").addEventListener("click", async () => {
    const todo = selectedRows().filter((r) => !r.leadId);
    if (!todo.length) { say("The selected prospects are already leads."); return; }
    say(`Converting ${todo.length}…`);
    let ok = 0;
    for (const r of todo) if (await convert(r.id, true)) ok += 1;
    say(`${ok} of ${todo.length} ${todo.length === 1 ? "prospect is" : "prospects are"} now ${ok === 1 ? "a lead" : "leads"}.`, ok < todo.length);
  });

  // The "⋯" menu on a row.
  function rowMenu(anchor, p) {
    const item = (act, icon, label, arg) => `<button type="button" role="menuitem" class="prospects-pop-item" data-pop="${act}"${arg ? ` data-arg="${esc(arg)}"` : ""}>${icon ? `<span class="material-symbols-outlined" aria-hidden="true">${icon}</span>` : `<span class="prospects-pop-gap" aria-hidden="true"></span>`}${esc(label)}</button>`;
    let html = "";
    if (p.leadId) html += item("view", "open_in_new", "View lead");
    else if (canEdit()) html += item("convert", "add", "Convert to lead");
    if (canEdit()) {
      html += `<div class="prospects-pop-sep"></div><div class="prospects-pop-label">Set status</div>`;
      html += STATUSES.map((s) => item("status", s.key === p.status ? "check_circle" : "", s.label, s.key)).join("");
    }
    if (safeUrl(p.website)) html += `<div class="prospects-pop-sep"></div>` + item("site", "link", "Open website");
    openPop(anchor, html, (act, arg) => {
      closePop();
      if (act === "view") window.location.hash = "#promote/leads";
      else if (act === "convert") convert(p.id);
      else if (act === "status") setStatus([p.id], arg);
      else if (act === "site") window.open(safeUrl(p.website), "_blank", "noopener,noreferrer");
      anchor.focus();
    });
  }

  // ── Starter set ──────────────────────────────────────────────────────────
  $("prospects-seed-btn").addEventListener("click", async () => {
    if (!canEdit()) return;
    say("Loading the starter set…");
    try {
      const have = new Set((await getDocs(collection(db, "prospects"))).docs.map((d) => d.id));
      const todo = SEED_PROSPECTS.map((s) => ({ id: slugId(s.name), ...prospectFromInput({ ...s, source: SEED_SOURCE }) })).filter((r) => r.errors.length === 0 && !have.has(r.id));
      for (let i = 0; i < todo.length; i += 400) {
        const batch = writeBatch(db);
        todo.slice(i, i + 400).forEach((r) => batch.set(doc(db, "prospects", r.id), {
          ...r.fields, leadId: "", createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdByEmail: me(), updatedByEmail: me(),
        }));
        await batch.commit();
      }
      say(`Loaded ${todo.length} prospects.`);
    } catch (e) { say(`Couldn't load the starter set: ${e && e.message ? e.message : e}`, true); }
  });

  // ── The grid ─────────────────────────────────────────────────────────────
  const distinct = (pick) => [...new Set(rows.map(pick).filter(Boolean))].sort((a, b) => a.localeCompare(b)).map((v) => [v, v]);
  function buildColumns() {
    const trunc = (params) => {
      const span = document.createElement("span");
      span.className = "prospect-trunc";
      span.textContent = params.valueFormatted != null ? params.valueFormatted : params.value == null ? "" : String(params.value);
      return span;
    };
    const company = (params) => {
      const span = document.createElement("span");
      span.className = "prospect-trunc";
      const href = safeUrl(params.data.website);
      if (href) {
        const a = document.createElement("a");
        a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = params.value; a.addEventListener("click", (e) => e.stopPropagation());
        span.appendChild(a);
      } else span.textContent = params.value;
      return span;
    };
    const manage = (params) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "um-manage"; b.dataset.prospectMenu = params.data.id;
      b.setAttribute("aria-label", `Actions for ${params.data.name}`);
      b.setAttribute("aria-haspopup", "menu"); b.setAttribute("aria-expanded", "false");
      b.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">more_horiz</span>';
      b.addEventListener("click", (e) => { e.stopPropagation(); const p = rows.find((x) => x.id === params.data.id); if (p) rowMenu(b, p); });
      return b;
    };
    const list = (field) => ({ field, valueGetter: (p) => ((p.data && p.data[field]) || []).join(", ") });
    const select = (values) => ({ filter: SelectFilter, filterParams: { values }, floatingFilterComponent: SelectFloatingFilter, floatingFilterComponentParams: { values, suppressFilterButton: true } });
    const tip = (p) => (p.valueFormatted != null ? p.valueFormatted : p.value);
    return [
      { colId: "select", headerName: "", width: 52, checkboxSelection: true, headerCheckboxSelection: true, headerCheckboxSelectionCurrentPageOnly: true, sortable: false, filter: false, floatingFilter: false, resizable: false, suppressMovable: true, pinned: "left", hide: !canEdit() },
      { field: "name", headerName: "Company", minWidth: 150, flex: 2, cellRenderer: company, tooltipValueGetter: tip, getQuickFilterText: (p) => `${p.data.name} ${p.data.website}` },
      { field: "industry", headerName: "Industry", minWidth: 100, flex: 1, cellRenderer: trunc, tooltipValueGetter: tip },
      { field: "subIndustry", headerName: "Sub-industry", minWidth: 130, flex: 1, hide: true, cellRenderer: trunc, tooltipValueGetter: tip },
      { field: "hqCountry", headerName: "HQ country", minWidth: 100, flex: 1, cellRenderer: trunc, tooltipValueGetter: tip },
      { ...list("markets"), headerName: "Markets", minWidth: 120, flex: 2, cellRenderer: trunc, tooltipValueGetter: tip, filterValueGetter: (p) => [p.data.hqCountry, ...(p.data.markets || [])].join(" ") },
      { field: "awsRegion", headerName: "AWS region", minWidth: 100, flex: 1, ...select(() => distinct((p) => p.awsRegion)) },
      { field: "storeCount", headerName: "Stores", width: 84, type: "numericColumn", filter: "agNumberColumnFilter", valueFormatter: (p) => (p.value == null ? "" : p.value.toLocaleString("en-GB")), getQuickFilterText: () => "" },
      { field: "sizeBand", headerName: "Size band", minWidth: 100, flex: 1, valueFormatter: (p) => sizeBandLabel(p.value), getQuickFilterText: (p) => sizeBandLabel(p.value), ...select(() => SIZE_BANDS.map((b) => [b.key, b.label])), cellRenderer: trunc },
      { ...list("vendors"), headerName: "Current vendors", minWidth: 160, flex: 1, hide: true, cellRenderer: trunc, tooltipValueGetter: tip },
      { ...list("campaigns"), headerName: "Campaigns", minWidth: 160, flex: 1, hide: true, cellRenderer: trunc, tooltipValueGetter: tip },
      { field: "status", headerName: "Status", minWidth: 110, flex: 1, valueFormatter: (p) => statusLabel(p.value), getQuickFilterText: (p) => statusLabel(p.value), ...select(() => STATUSES.map((s) => [s.key, s.label])), cellRenderer: trunc },
      { colId: "actions", headerName: "", width: 64, pinned: "right", sortable: false, filter: false, floatingFilter: false, resizable: false, suppressMovable: true, cellRenderer: manage },
    ];
  }
  function ensureGrid() {
    if (grid) return Promise.resolve(grid);
    if (gridLoading) return gridLoading;
    gridLoading = loadAgGrid().then((ag) => {
      if (!ag) { host.innerHTML = '<p class="promote-empty">The grid could not load. Check your connection and reload.</p>'; return null; }
      const api = ag.createGrid(host, {
        columnDefs: buildColumns(),
        defaultColDef: { sortable: true, filter: "agTextColumnFilter", floatingFilter: true, resizable: true, suppressHeaderMenuButton: false },
        rowData: rows,
        getRowId: (p) => p.data.id,
        rowSelection: "multiple", suppressRowClickSelection: true,
        includeHiddenColumnsInQuickFilter: true,
        suppressCellFocus: true, suppressColumnVirtualisation: true, tooltipShowDelay: 400,
        headerHeight: 40, floatingFiltersHeight: 40, rowHeight: 48,
        pagination: true, paginationPageSize: 25, paginationPageSizeSelector: [25, 50, 100, 250],
        domLayout: "autoHeight",
        overlayNoRowsTemplate: '<span class="um-empty">No prospects match these filters.</span>',
        onSelectionChanged: updateBulk,
        onModelUpdated: () => { updateCount(); updateBulk(); },
      });
      grid = { api };
      grid.api.setGridOption("quickFilterText", $("prospects-q").value);
      updateCount();
      return grid;
    });
    return gridLoading;
  }

  let regionKey = "";
  function start() {
    if (started) return;
    started = true;
    updateCount();
    unsub = onSnapshot(collection(db, "prospects"), (snap) => {
      rows = snap.docs.map((d) => normaliseProspect(d.id, d.data({ serverTimestamps: "estimate" })));
      updateCount();
      if (grid) {
        grid.api.setGridOption("rowData", rows);
        const key = distinct((p) => p.awsRegion).join("|");
        if (key !== regionKey) { regionKey = key; grid.api.refreshHeader(); }
      } else if (rows.length) ensureGrid();
    }, () => { say("Prospects could not be loaded. Reload the page to try again.", true); });
  }
  function stop() { closePop(); if (unsub) unsub(); unsub = null; started = false; }
  function render() {
    updateCount();
    if (grid) { grid.api.setColumnsVisible(["select"], canEdit()); updateBulk(); }
    else if (rows.length) ensureGrid();
  }
  return { start, stop, render, page, _rows: () => rows };
}
