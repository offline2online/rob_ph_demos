// Promote › Prospects (TAM) (#promote/prospects): the global prospects database
// as an AG Grid (loaded lazily by docs-grid.js, like the Roles grid).
//
// One row per company in `prospects/{id}` (prospects-core.js). The toolbar's
// filters are applied as the grid's external filter, so the grid's own sort,
// quick search and CSV export all see the same rows. A write is live for
// everyone through onSnapshot. "Convert to lead" writes one Leads card whose id
// comes from the prospect's (leadIdForProspect), so a prospect can never become
// two leads, and links the two both ways (lead.prospectId, prospect.leadId).
// Saved filters are per browser (localStorage, bt-prospect-filters).
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, onSnapshot, serverTimestamp, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { loadAgGrid } from "./docs-grid.js";
import {
  STATUSES, SIZE_BANDS, normaliseProspect, matchesFilter, filterOptions, EMPTY_FILTER, FILTER_KEYS, isFilterEmpty,
  sanitiseSavedFilters, withSavedFilter, toCsv, statusLabel, sizeBandLabel, leadIdForProspect, leadFieldsFromProspect,
  prospectFromInput, slugId,
} from "./prospects-core.js";
import { SEED_PROSPECTS, SEED_SOURCE } from "./prospects-seed.js";

const $ = (id) => document.getElementById(id);
const SAVED_KEY = "bt-prospect-filters";
const safeUrl = (u) => { try { const x = new URL(String(u)); return x.protocol === "https:" || x.protocol === "http:" ? x.href : ""; } catch { return ""; } };

export function mountProspectsPage({ db, auth, canEdit, askName }) {
  const page = $("prospects-page");
  const host = $("prospects-grid");
  const status = $("prospects-status");
  let rows = [];
  let unsub = null;
  let started = false;
  let grid = null;
  let gridLoading = null;
  let filter = { ...EMPTY_FILTER };
  let saved = [];
  const me = () => String((auth.currentUser && auth.currentUser.email) || "").toLowerCase();
  const say = (t, bad) => { status.textContent = t || ""; status.classList.toggle("is-error", !!bad); };

  try { saved = sanitiseSavedFilters(JSON.parse(localStorage.getItem(SAVED_KEY) || "[]")); } catch { saved = []; }
  const persistSaved = () => { try { localStorage.setItem(SAVED_KEY, JSON.stringify(saved)); } catch { /* private mode */ } };

  // ── Filters ──────────────────────────────────────────────────────────────
  const selects = { industry: "prospects-f-industry", market: "prospects-f-market", awsRegion: "prospects-f-region", campaign: "prospects-f-campaign", sizeBand: "prospects-f-size", status: "prospects-f-status" };
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  function fillSelect(el, options, current) {
    const opts = options.map(([v, l]) => `<option value="${esc(v)}"${v === current ? " selected" : ""}>${esc(l)}</option>`).join("");
    el.innerHTML = `<option value="">${esc(el.dataset.all || "All")}</option>${opts}`;
    if (current && !options.some(([v]) => v === current)) el.value = "";
  }
  function fillFilters() {
    const o = filterOptions(rows);
    const pairs = (a) => a.map((v) => [v, v]);
    fillSelect($(selects.industry), pairs(o.industry), filter.industry);
    fillSelect($(selects.market), pairs(o.market), filter.market);
    fillSelect($(selects.awsRegion), pairs(o.awsRegion), filter.awsRegion);
    fillSelect($(selects.campaign), pairs(o.campaign), filter.campaign);
    fillSelect($(selects.sizeBand), SIZE_BANDS.map((b) => [b.key, b.label]), filter.sizeBand);
    fillSelect($(selects.status), STATUSES.map((s) => [s.key, s.label]), filter.status);
    $("prospects-q").value = filter.q;
    $("prospects-min").value = filter.minStores;
    $("prospects-max").value = filter.maxStores;
    const sel = $("prospects-saved");
    sel.innerHTML = `<option value="">Saved filters</option>` + saved.map((s) => `<option value="${esc(s.name)}">${esc(s.name)}</option>`).join("");
    $("prospects-saved-delete").hidden = true;
  }
  const visibleRows = () => rows.filter((p) => matchesFilter(p, filter));
  function applyFilter() {
    if (grid) grid.api.onFilterChanged();
    const n = visibleRows().length;
    $("prospects-count").textContent = isFilterEmpty(filter) ? `${rows.length.toLocaleString("en-GB")} prospects` : `${n.toLocaleString("en-GB")} of ${rows.length.toLocaleString("en-GB")} prospects`;
    $("prospects-empty").hidden = rows.length > 0;
    $("prospects-seed-btn").hidden = rows.length > 0 || !canEdit();
    host.hidden = rows.length === 0;
  }
  function readToolbar() {
    filter = {
      q: $("prospects-q").value, minStores: $("prospects-min").value, maxStores: $("prospects-max").value,
      industry: $(selects.industry).value, market: $(selects.market).value, awsRegion: $(selects.awsRegion).value,
      campaign: $(selects.campaign).value, sizeBand: $(selects.sizeBand).value, status: $(selects.status).value,
    };
    applyFilter();
  }
  for (const id of [...Object.values(selects), "prospects-min", "prospects-max"]) $(id).addEventListener("input", readToolbar);
  $("prospects-q").addEventListener("input", readToolbar);
  $("prospects-clear").addEventListener("click", () => { filter = { ...EMPTY_FILTER }; fillFilters(); applyFilter(); });
  $("prospects-saved").addEventListener("change", () => {
    const s = saved.find((x) => x.name === $("prospects-saved").value);
    $("prospects-saved-delete").hidden = !s;
    if (!s) return;
    filter = { ...EMPTY_FILTER, ...s.filter };
    const keep = $("prospects-saved").value;
    fillFilters(); $("prospects-saved").value = keep; $("prospects-saved-delete").hidden = false;
    applyFilter();
  });
  $("prospects-save-filter").addEventListener("click", async () => {
    const name = await askName("Name this filter");
    if (name == null) return;
    const r = withSavedFilter(saved, name, filter);
    if (r.error) { say(r.error, true); return; }
    saved = r.list; persistSaved(); const keep = String(name).trim();
    fillFilters(); $("prospects-saved").value = keep; $("prospects-saved-delete").hidden = false;
    say(`Saved the filter "${keep}".`);
  });
  $("prospects-saved-delete").addEventListener("click", () => {
    const name = $("prospects-saved").value;
    saved = saved.filter((s) => s.name !== name); persistSaved(); fillFilters(); say(`Deleted the filter "${name}".`);
  });
  $("prospects-export").addEventListener("click", () => {
    const list = visibleRows();
    const blob = new Blob([toCsv(list)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `prospects-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    say(`Exported ${list.length.toLocaleString("en-GB")} prospects.`);
  });

  // ── Convert to lead ──────────────────────────────────────────────────────
  async function convert(id) {
    const p = rows.find((x) => x.id === id);
    if (!p || !canEdit()) return;
    if (p.leadId) { window.location.hash = "#promote/leads"; return; }
    say(`Converting ${p.name}…`);
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
      say(existing.exists() ? `${p.name} already had a lead; the two are now linked.` : `${p.name} is now a lead.`);
    } catch (e) {
      say(`Couldn't convert ${p.name}: ${e && e.message ? e.message : e}`, true);
    }
  }
  async function setStatus(id, next) {
    try { await updateDoc(doc(db, "prospects", id), { status: next, updatedAt: serverTimestamp(), updatedByEmail: me() }); }
    catch (e) { say(`Couldn't save the status: ${e && e.message ? e.message : e}`, true); }
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
  const joined = (p) => (p.value || []).join(", ");
  function buildColumns() {
    const link = (params) => {
      const span = document.createElement("span");
      const href = safeUrl(params.data.website);
      if (href) {
        const a = document.createElement("a");
        a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = params.value; a.addEventListener("click", (e) => e.stopPropagation());
        span.appendChild(a);
      } else span.textContent = params.value;
      return span;
    };
    const action = (params) => {
      const b = document.createElement("button");
      b.type = "button";
      if (params.data.leadId) { b.className = "btn-ghost prospect-act prospect-view-lead"; b.textContent = "View lead"; }
      else { b.className = "btn-ghost prospect-act prospect-convert"; b.dataset.editorOnly = ""; b.textContent = "Convert to lead"; }
      b.dataset.prospectId = params.data.id;
      b.addEventListener("click", (e) => { e.stopPropagation(); convert(params.data.id); });
      return b;
    };
    return [
      { field: "name", headerName: "Company", minWidth: 190, flex: 2, cellRenderer: link, pinned: "left" },
      { field: "industry", headerName: "Industry", minWidth: 140, flex: 1 },
      { field: "subIndustry", headerName: "Sub-industry", minWidth: 140, flex: 1 },
      { field: "hqCountry", headerName: "HQ country", minWidth: 130, flex: 1 },
      { field: "markets", headerName: "Markets", minWidth: 180, flex: 2, valueFormatter: joined, filterValueGetter: (p) => (p.data.markets || []).join(" "), tooltipValueGetter: (p) => (p.data.markets || []).join(", ") },
      { field: "awsRegion", headerName: "AWS region", minWidth: 130, flex: 1 },
      { field: "storeCount", headerName: "Stores", width: 110, type: "numericColumn", filter: "agNumberColumnFilter", valueFormatter: (p) => (p.value == null ? "" : p.value.toLocaleString("en-GB")) },
      { field: "sizeBand", headerName: "Size band", minWidth: 150, flex: 1, valueFormatter: (p) => sizeBandLabel(p.value) },
      { field: "vendors", headerName: "Current vendors", minWidth: 160, flex: 1, valueFormatter: joined },
      { field: "campaigns", headerName: "Campaigns", minWidth: 160, flex: 1, valueFormatter: joined },
      {
        field: "status", headerName: "Status", minWidth: 150, flex: 1, valueFormatter: (p) => statusLabel(p.value),
        editable: () => canEdit() && !!grid, cellEditor: "agSelectCellEditor", cellEditorParams: { values: STATUSES.map((s) => s.key) },
        refData: Object.fromEntries(STATUSES.map((s) => [s.key, s.label])),
      },
      { colId: "actions", headerName: "", width: 160, pinned: "right", sortable: false, filter: false, resizable: false, cellRenderer: action },
    ];
  }
  function ensureGrid() {
    if (grid) return Promise.resolve(grid);
    if (gridLoading) return gridLoading;
    gridLoading = loadAgGrid().then((ag) => {
      if (!ag) { host.innerHTML = '<p class="promote-empty">The grid could not load. Check your connection and reload.</p>'; return null; }
      const api = ag.createGrid(host, {
        columnDefs: buildColumns(),
        defaultColDef: { sortable: true, filter: "agTextColumnFilter", resizable: true, tooltipShowDelay: 400 },
        rowData: rows,
        getRowId: (p) => p.data.id,
        isExternalFilterPresent: () => !isFilterEmpty(filter),
        doesExternalFilterPass: (node) => matchesFilter(node.data, filter),
        onCellValueChanged: (e) => { if (e.colDef.field === "status" && e.newValue !== e.oldValue) setStatus(e.data.id, e.newValue); },
        suppressCellFocus: true, suppressColumnVirtualisation: true, tooltipShowDelay: 400,
        headerHeight: 40, rowHeight: 48,
        pagination: true, paginationPageSize: 50, paginationPageSizeSelector: [25, 50, 100, 250],
        domLayout: "autoHeight",
        overlayNoRowsTemplate: '<span class="um-empty">No prospects match these filters.</span>',
      });
      grid = { api };
      applyFilter();
      return grid;
    });
    return gridLoading;
  }

  function start() {
    if (started) return;
    started = true;
    fillFilters();
    unsub = onSnapshot(collection(db, "prospects"), (snap) => {
      rows = snap.docs.map((d) => normaliseProspect(d.id, d.data({ serverTimestamps: "estimate" })));
      fillFilters(); applyFilter();
      if (grid) grid.api.setGridOption("rowData", rows);
      else if (rows.length) ensureGrid();
    }, () => { say("Prospects could not be loaded. Reload the page to try again.", true); });
  }
  function stop() { if (unsub) unsub(); unsub = null; started = false; }
  function render() { applyFilter(); if (rows.length) ensureGrid(); }
  return { start, stop, render, page, _rows: () => rows, _filters: FILTER_KEYS };
}
