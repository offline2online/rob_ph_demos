// Promote › Leads › AWS ACE opportunities: the AG Grid (ag-theme-alpine um-grid, the same
// look as Prospects (TAM)). Pure view: leads-page.js owns loading and the lead drawer.
//   const g = mountAceGrid({ host, pop, onOpenLead, onOpen });  g.setRows(rows, leads);  g.setLoading(true);
import { loadAgGrid } from "./docs-grid.js";
import { matchLead, mailtoFor, partnerCentralHref, formatMonthly, formatDate, formatDateTime, reviewTone, isPastDate, ACE_STAGES, ACE_REVIEW_STATUSES } from "./ace-core.js";

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const PAGE = 50;

// A dropdown filter for the floating row (same idea as Prospects' SelectFilter).
class SelectFilter {
  init(params) { this.params = params; this.value = ""; this.el = document.createElement("div"); }
  getGui() { return this.el; }
  isFilterActive() { return !!this.value; }
  doesFilterPass(p) { return String((p.data || {})[this.params.colDef.field] || "").toLowerCase() === this.value.toLowerCase(); }
  getModel() { return this.value ? { value: this.value } : null; }
  setModel(m) { this.value = m && m.value ? String(m.value) : ""; }
  setValue(v) { this.value = v || ""; this.params.filterChangedCallback(); }
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
    this.sel.innerHTML = `<option value="">All</option>` + this.params.values().map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
    this.sel.value = current;
    if (this.sel.value !== current) this.sel.value = "";
  }
  getGui() { return this.sel; }
  onParentModelChanged(model) { this.fill(model && model.value ? model.value : ""); }
}

export function mountAceGrid({ host, pop, onOpenLead, onOpen = () => {} }) {
  let api = null, loading = null, rows = [], leads = [], busy = false, popAnchor = null;
  const phone = window.matchMedia ? window.matchMedia("(max-width: 640px)") : null;

  const ordered = (field, known) => {
    const seen = new Set(rows.map((r) => String(r[field] || "").trim()).filter(Boolean));
    const lower = new Map([...seen].map((v) => [v.toLowerCase(), v]));
    // Every known value is listed, whether or not a row has it yet, so the filter shows all its options.
    return [...known, ...[...seen].filter((v) => !known.some((k) => k.toLowerCase() === v.toLowerCase())).sort()];
  };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  function closePop() { pop.hidden = true; pop.innerHTML = ""; if (popAnchor) popAnchor.setAttribute("aria-expanded", "false"); popAnchor = null; }
  function openPop(anchor, html, onItem) {
    if (popAnchor === anchor && !pop.hidden) { closePop(); return; }
    closePop();
    popAnchor = anchor; anchor.setAttribute("aria-expanded", "true");
    pop.innerHTML = html; pop.hidden = false; pop._onItem = onItem;
    const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = `${Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))}px`;
    pop.style.top = `${r.bottom + h + 8 > window.innerHeight && r.top > h ? r.top - h - 4 : r.bottom + 4}px`;
    const first = pop.querySelector("button"); if (first) first.focus({ preventScroll: true });
  }
  pop.addEventListener("click", (e) => { const t = e.target.closest("[data-pop]"); if (t && pop._onItem) pop._onItem(t.dataset.pop); });
  document.addEventListener("click", (e) => { if (!pop.hidden && !pop.contains(e.target) && !(popAnchor && popAnchor.contains(e.target))) closePop(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !pop.hidden) { const a = popAnchor; closePop(); if (a) a.focus(); } });

  function rowMenu(anchor, r) {
    const item = (act, icon, label) => `<button type="button" role="menuitem" class="prospects-pop-item" data-pop="${act}"><span class="material-symbols-outlined" aria-hidden="true">${icon}</span>${esc(label)}</button>`;
    const pc = partnerCentralHref(r), mail = mailtoFor(r), lead = matchLead(r, leads);
    const html = item("open", "edit", "Open details") + (pc ? item("pc", "open_in_new", "View in Partner Central") : "") + (mail ? item("mail", "email", "Email AWS account manager") : "") + (lead ? item("lead", "person", "Open lead card") : "");
    if (!html) return;
    openPop(anchor, html, (act) => {
      closePop();
      if (act === "open") onOpen(r.id, anchor);
      else if (act === "pc") window.open(pc, "_blank", "noopener,noreferrer");
      else if (act === "mail") window.location.href = mail;
      else if (act === "lead") onOpenLead(lead.id);
      anchor.focus();
    });
  }

  function columns() {
    // The opportunity opens the in-console detail dialog (not a link out to AWS).
    const link = (p) => {
      const text = p.data.name || p.data.id;
      const b = el("button", "ace-trunc ace-link ace-open", text); b.type = "button"; b.dataset.aceOpen = p.data.id;
      b.setAttribute("aria-haspopup", "dialog");
      b.addEventListener("click", (e) => { e.stopPropagation(); onOpen(p.data.id, b); });
      return b;
    };
    const trunc = (p) => el("span", "ace-trunc", p.value == null ? "" : String(p.value));
    const stage = (p) => (p.value ? el("span", "ace-pill", p.value) : el("span"));
    const review = (p) => {
      if (!p.value) return el("span");
      const w = el("span", "um-status ace-review"); w.dataset.tone = reviewTone(p.value);
      w.appendChild(el("span", "ace-dot")); w.appendChild(el("span", "ace-trunc", p.value));
      return w;
    };
    const stamp = (p) => el("span", "ace-date", formatDateTime(p.value));
    const date = (p) => {
      const past = isPastDate(p.data.targetCloseDate);
      const s = el("span", past ? "ace-date is-past" : "ace-date", formatDate(p.data.targetCloseDate));
      if (past) s.dataset.past = "true";
      return s;
    };
    const seller = (p) => {
      const s = p.data.awsSeller;
      if (!s || !s.name) return el("span", "ace-none", "Not assigned");
      const w = el("span", "ace-seller-cell"); w.appendChild(el("span", "ace-trunc", s.name));
      const mail = mailtoFor(p.data);
      if (mail) {
        const a = el("a", "ace-mail"); a.href = mail;
        a.setAttribute("aria-label", `Email ${s.name} about ${p.data.name || p.data.id}`); a.title = `Email ${s.name}`;
        a.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">email</span>';
        w.appendChild(a);
      }
      return w;
    };
    const leadCell = (p) => {
      const l = matchLead(p.data, leads);
      if (!l) { const s = el("span", "ace-none", "No lead"); s.title = "No lead with this company name"; return s; }
      const b = el("button", "ace-lead", "Lead card"); b.type = "button"; b.dataset.leadId = l.id;
      b.addEventListener("click", (e) => { e.stopPropagation(); onOpenLead(l.id); });
      return b;
    };
    const manage = (p) => {
      const b = el("button", "ace-manage"); b.type = "button"; b.dataset.aceMenu = p.data.id;
      b.setAttribute("aria-label", `Actions for ${p.data.name || p.data.id}`); b.setAttribute("aria-haspopup", "menu"); b.setAttribute("aria-expanded", "false");
      b.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">more_horiz</span>';
      b.addEventListener("click", (e) => { e.stopPropagation(); const r = rows.find((x) => x.id === p.data.id); if (r) rowMenu(b, r); });
      return b;
    };
    const select = (field, known) => ({ filter: SelectFilter, floatingFilterComponent: SelectFloatingFilter, floatingFilterComponentParams: { values: () => ordered(field, known), suppressFilterButton: true } });
    const tip = (p) => (p.value == null ? "" : String(p.value));
    const noFilter = { filter: false, floatingFilter: false };
    return [
      { field: "customer", headerName: "Customer", minWidth: 150, flex: 1.3, cellRenderer: trunc, tooltipValueGetter: tip },
      { colId: "name", field: "name", headerName: "Opportunity", minWidth: 220, flex: 2.4, cellRenderer: link, tooltipValueGetter: (p) => p.data && (p.data.name || p.data.id), pinned: phone && phone.matches ? "left" : null },
      { colId: "aceScore", headerName: "Score", width: 90, type: "numericColumn", filter: "agNumberColumnFilter", valueGetter: (p) => (p.data && p.data.score != null && p.data.score !== "" ? Number(p.data.score) : null), valueFormatter: (p) => (p.value == null ? "" : String(p.value)) },
      { field: "stage", headerName: "ACE stage", minWidth: 160, flex: 1.2, cellRenderer: stage, ...select("stage", ACE_STAGES) },
      { field: "reviewStatus", headerName: "Review status", minWidth: 170, flex: 1.2, cellRenderer: review, ...select("reviewStatus", ACE_REVIEW_STATUSES) },
      { colId: "monthly", headerName: "Monthly AWS revenue", headerTooltip: "Expected monthly AWS revenue", minWidth: 150, flex: 1, type: "numericColumn", cellClass: "ace-num", filter: "agNumberColumnFilter",
        valueGetter: (p) => (p.data && p.data.expectedMonthly && Number.isFinite(p.data.expectedMonthly.amount) ? p.data.expectedMonthly.amount : null), valueFormatter: (p) => (p.data ? formatMonthly(p.data.expectedMonthly) : "") },
      { colId: "close", field: "targetCloseDate", headerName: "Expected delivery date", headerTooltip: "ACE target close date", minWidth: 170, flex: 1, filter: false, floatingFilter: false, cellRenderer: date, tooltipValueGetter: (p) => (p.data && isPastDate(p.data.targetCloseDate) ? "Past expected delivery date" : "") },
      { colId: "created", field: "createdDate", headerName: "Created", minWidth: 120, flex: 0.9, filter: false, floatingFilter: false, cellRenderer: stamp },
      { colId: "updated", field: "lastModifiedDate", headerName: "Last updated", minWidth: 130, flex: 0.9, filter: false, floatingFilter: false, cellRenderer: stamp },
      { colId: "seller", headerName: "AWS account manager", minWidth: 180, flex: 1.3, valueGetter: (p) => (p.data && p.data.awsSeller && p.data.awsSeller.name) || "", cellRenderer: seller },
      { colId: "lead", headerName: "Lead", width: 120, sortable: false, ...noFilter, cellRenderer: leadCell },
      { colId: "actions", headerName: "", width: 64, pinned: "right", sortable: false, ...noFilter, resizable: false, suppressMovable: true, cellRenderer: manage },
    ];
  }

  function ensure() {
    if (api) return Promise.resolve(api);
    if (loading) return loading;
    loading = loadAgGrid().then((ag) => {
      if (!ag) { host.innerHTML = '<p class="promote-empty">The grid could not load. Check your connection and reload.</p>'; return null; }
      api = ag.createGrid(host, {
        columnDefs: columns(),
        defaultColDef: { sortable: true, filter: "agTextColumnFilter", floatingFilter: true, resizable: true },
        rowData: rows, getRowId: (p) => String(p.data.id),
        suppressCellFocus: true, suppressColumnVirtualisation: true, tooltipShowDelay: 400,
        headerHeight: 40, floatingFiltersHeight: 40, rowHeight: 42,
        pagination: rows.length > PAGE, paginationPageSize: PAGE, paginationPageSizeSelector: false,
        domLayout: "autoHeight", loading: busy,
        overlayNoRowsTemplate: '<span class="um-empty">No opportunities match these filters.</span>',
      });
      if (phone && phone.addEventListener) phone.addEventListener("change", () => api && api.applyColumnState({ state: [{ colId: "name", pinned: phone.matches ? "left" : null }] }));
      return api;
    });
    return loading;
  }

  return {
    setRows(next, nextLeads) {
      rows = next || []; leads = nextLeads || [];
      return ensure().then((a) => {
        if (!a) return;
        a.setGridOption("rowData", rows);
        a.setGridOption("pagination", rows.length > PAGE);
        a.refreshCells({ force: true });
      });
    },
    setLoading(v) { busy = !!v; if (api) api.setGridOption("loading", busy); },
    closeMenu: closePop,
    get ready() { return !!api; },
  };
}
