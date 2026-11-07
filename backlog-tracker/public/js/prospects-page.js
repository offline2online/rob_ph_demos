// Promote › Prospects (TAM) (#promote/prospects): the global prospects database
// as an AG Grid, built the same way as Settings › User Management › Users
// (user-management.js): `ag-theme-alpine um-grid`, floating filter row, a
// checkbox column with a bulk bar, a pinned-right "⋯" menu, pagination.
// AG Grid is loaded lazily by docs-grid.js.
//
// One row per company PER COUNTRY in `prospects/{id}` (prospects-core.js).
// Filtering is the grid's own, in the floating filter row (each text and number
// filter has a × to clear it), so the count, the CSV and LinkedIn exports and the
// bulk actions all see the same rows. Clicking a company opens a right-hand
// drawer with every field (editors can edit there). A write is live for
// everyone through onSnapshot. "Convert to lead" writes one Leads card whose id
// comes from the prospect's (leadIdForProspect), so a prospect can never become
// two leads, and links the two both ways (lead.prospectId, prospect.leadId).
// Saved filters (grid filter model + sort) are per browser
// (localStorage, bt-prospect-grid-filters).
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, onSnapshot, serverTimestamp, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { loadAgGrid } from "./docs-grid.js";
import {
  STATUSES, SIZE_BANDS, PRIORITIES, normaliseProspect, toCsv, toLinkedInCsv, statusLabel, sizeBandLabel, priorityLabel, leadIdForProspect, leadFieldsFromProspect,
  prospectFromInput, prospectKey, prospectIdFor, slugId,
} from "./prospects-core.js";
import { SEED_PROSPECTS, SEED_SOURCE } from "./prospects-seed.js";
import { mountProspectDetail } from "./prospect-detail.js";

const $ = (id) => document.getElementById(id);
const SAVED_KEY = "bt-prospect-grid-filters";
const LEGACY_KEY = "bt-prospect-filters";
const safeUrl = (u) => { try { const x = new URL(String(u)); return x.protocol === "https:" || x.protocol === "http:" ? x.href : ""; } catch { return ""; } };
const linkedinHref = (u) => (/^https:\/\/www\.linkedin\.com\/(company|showcase)\/[A-Za-z0-9_%.-]+\/$/.test(String(u || "")) ? String(u) : "");
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const textModel = (v) => ({ filterType: "text", type: "contains", filter: v });

// The old toolbar's saved filters (dropdown values) as a grid filter model.
export function legacySavedToModel(f) {
  const m = {};
  if (f.industry) m.industry = textModel(f.industry);
  if (f.country || f.market) m.country = textModel(f.country || f.market);
  if (f.priority) m.priority = { value: f.priority };
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
    const model = Object.assign({}, s.model && typeof s.model === "object" ? s.model : s.filter && typeof s.filter === "object" ? legacySavedToModel(s.filter) : {});
    delete model.markets; // the Markets column is gone; Country filters now
    const sort = Array.isArray(s.sort) ? s.sort.filter((x) => x && typeof x.colId === "string" && (x.sort === "asc" || x.sort === "desc")).map((x) => ({ colId: x.colId, sort: x.sort })) : [];
    out.push({ name, model, sort });
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

  // ── Header: count, bulk bar ──────────────────────────────────────
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

  function download(list, stem, build = toCsv, noun = "prospect") {
    const blob = new Blob([build(list)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${stem}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    say(`Exported ${list.length.toLocaleString("en-GB")} ${list.length === 1 ? noun : noun + "s"}.`);
  }
  $("prospects-export").addEventListener("click", () => download(filteredRows(), "prospects"));
  // LinkedIn Campaign Manager's Matched Audiences company list: the selected rows, else the filtered ones.
  $("prospects-export-linkedin").addEventListener("click", () => {
    const sel = selectedRows();
    download(sel.length ? sel : filteredRows(), "prospects-linkedin", toLinkedInCsv, "company");
  });
  $("prospects-export-selected").addEventListener("click", () => { const l = selectedRows(); if (l.length) download(l, "prospects-selected"); });

  // ── Saved filters ────────────────────────────────────────────────────────
  function currentView() {
    const sort = grid ? grid.api.getColumnState().filter((c) => c.sort).sort((a, b) => (a.sortIndex || 0) - (b.sortIndex || 0)).map((c) => ({ colId: c.colId, sort: c.sort })) : [];
    return { model: grid ? grid.api.getFilterModel() : {}, sort };
  }
  function applyView(v) {
    if (!grid) return;
    grid.api.setFilterModel(Object.keys(v.model || {}).length ? v.model : null);
    grid.api.applyColumnState({ state: (v.sort || []).map((s, i) => ({ colId: s.colId, sort: s.sort, sortIndex: i })), defaultState: { sort: null } });
  }
  function savedMenuHtml() {
    const items = saved.map((s) => `<div class="prospects-pop-row"><button type="button" role="menuitem" class="prospects-pop-item" data-pop="apply" data-arg="${esc(s.name)}">${esc(s.name)}</button><button type="button" class="prospects-pop-del" data-pop="delete" data-arg="${esc(s.name)}" aria-label="Delete the saved filter ${esc(s.name)}"><span class="material-symbols-outlined" aria-hidden="true">delete</span></button></div>`).join("");
    return `<button type="button" role="menuitem" class="prospects-pop-item" data-pop="savefilter"><span class="material-symbols-outlined" aria-hidden="true">add</span>Save current filter…</button>`
      + `<button type="button" role="menuitem" class="prospects-pop-item" data-pop="reset"><span class="material-symbols-outlined" aria-hidden="true">close</span>Clear all filters</button>`
      + (items ? `<div class="prospects-pop-sep"></div>${items}` : "");
  }
  function savedMenuAction(act, arg) {
    if (act === "reset") { applyView({ model: {}, sort: [] }); closePop(); return; }
    if (act === "apply") { const s = saved.find((x) => x.name === arg); if (s) applyView(s); closePop(); say(`Applied the filter "${arg}".`); return; }
    if (act === "delete") {
      saved = saved.filter((s) => s.name !== arg); persistSaved(); say(`Deleted the filter "${arg}".`);
      openPop(popAnchor, savedMenuHtml(), savedMenuAction); return;
    }
    if (act === "savefilter") {
      const anchor = popAnchor; closePop();
      (async () => {
        const v = currentView();
        if (!Object.keys(v.model).length && !v.sort.length) { say("Set a filter or sort to save.", true); return; }
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
  const SETTABLE = STATUSES.filter((s) => s.key !== "converted"); // Converted is set only by Convert to lead
  $("prospects-bulk-status").innerHTML = SETTABLE.map((s) => `<option value="${esc(s.key)}">${esc(s.label)}</option>`).join("");
  $("prospects-bulk-apply").addEventListener("click", () => setStatus(selectedRows().map((r) => r.id), $("prospects-bulk-status").value));

  // The "⋯" menu on a row.
  function rowMenu(anchor, p) {
    const item = (act, icon, label, arg) => `<button type="button" role="menuitem" class="prospects-pop-item" data-pop="${act}"${arg ? ` data-arg="${esc(arg)}"` : ""}>${icon ? `<span class="material-symbols-outlined" aria-hidden="true">${icon}</span>` : `<span class="prospects-pop-gap" aria-hidden="true"></span>`}${esc(label)}</button>`;
    let html = item("profile", "business", "Open company profile");
    if (p.leadId) html += item("view", "open_in_new", "View lead");
    else if (canEdit()) html += item("convert", "add", "Convert to lead");
    if (canEdit()) {
      html += `<div class="prospects-pop-sep"></div><div class="prospects-pop-label">Set status</div>`;
      html += SETTABLE.map((s) => item("status", s.key === p.status ? "check_circle" : "", s.label, s.key)).join("");
    }
    html += `<div class="prospects-pop-sep"></div>` + item("open", "right_panel_open", "Open all fields");
    if (safeUrl(p.website)) html += item("site", "link", "Open website");
    openPop(anchor, html, (act, arg) => {
      closePop();
      if (act === "profile") openDetail(p.id);
      else if (act === "view") window.location.hash = "#promote/leads";
      else if (act === "convert") convert(p.id);
      else if (act === "status") setStatus([p.id], arg);
      else if (act === "open") openDrawer(p.id);
      else if (act === "site") window.open(safeUrl(p.website), "_blank", "noopener,noreferrer");
      anchor.focus();
    });
  }

  // ── Company detail view ──────────────────────────────────────────────────
  const detailUi = mountProspectDetail({
    db, root: $("prospect-detail"), canEdit, me, say,
    getRow: (id) => rows.find((x) => x.id === id) || null,
    getCompanyRows: (key) => rows.filter((x) => slugId(x.name) === key),
    onAllFields: (id) => openDrawer(id, null),
    onClose: () => { page.classList.remove("is-detail"); closePop(); },
  });
  function openDetail(id, tab) { closePop(); page.classList.add("is-detail"); detailUi.open(id, tab); window.scrollTo(0, 0); }
  window.addEventListener("hashchange", () => { if (detailUi.isOpen() && window.location.hash !== "#promote/prospects") { detailUi.close(); page.classList.remove("is-detail"); } });

  // ── Starter set ──────────────────────────────────────────────────────────
  $("prospects-seed-btn").addEventListener("click", async () => {
    if (!canEdit()) return;
    say("Loading the starter set…");
    try {
      const have = new Set((await getDocs(collection(db, "prospects"))).docs.map((d) => { const q = normaliseProspect(d.id, d.data()); return prospectKey(q.name, q.country); }));
      const todo = SEED_PROSPECTS.map((s) => ({ ...prospectFromInput({ ...s, country: s.hqCountry, source: SEED_SOURCE }) }))
        .filter((r) => r.errors.length === 0 && !have.has(prospectKey(r.fields.name, r.fields.country)))
        .map((r) => ({ ...r, id: prospectIdFor(r.fields.name, r.fields.country) }));
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

  // ── Clear (×) buttons in the floating text and number filters ────────────
  // AG Grid builds the floating filter inputs itself (and again whenever a column is shown or
  // the header refreshes), so the × is added to whatever inputs exist, and its visibility follows
  // the input's value.
  function syncClears() {
    host.querySelectorAll(".ag-floating-filter-input").forEach((wrap) => {
      const input = wrap.querySelector("input:not([type=checkbox]):not([type=radio])");
      if (!input) return;
      if (!wrap.querySelector(".prospect-clear")) {
        const b = document.createElement("button");
        b.type = "button"; b.className = "prospect-clear";
        // The floating filter cell carries no column id; its input is labelled "<heading> Filter Input".
        const heading = String(input.getAttribute("aria-label") || "").replace(/\s*Filter Input$/i, "");
        const head = grid ? grid.api.getColumns().find((c) => c.getColDef().headerName === heading) : null;
        b.dataset.clearCol = head ? head.getColId() : "";
        b.dataset.heading = heading;
        b.setAttribute("aria-label", `Clear the ${heading} filter`);
        b.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">close</span>';
        wrap.appendChild(b);
      }
      wrap.classList.toggle("has-value", input.value !== "");
    });
  }
  function watchFilters() {
    let queued = false;
    const later = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; syncClears(); }); };
    host.addEventListener("input", later);
    host.addEventListener("click", (e) => {
      const b = e.target.closest && e.target.closest(".prospect-clear");
      if (!b || !grid) return;
      e.preventDefault(); e.stopPropagation();
      const model = Object.assign({}, grid.api.getFilterModel());
      if (!b.dataset.clearCol) return;
      delete model[b.dataset.clearCol];
      grid.api.setFilterModel(Object.keys(model).length ? model : null);
      setTimeout(syncClears, 0);
      const input = b.parentElement.querySelector("input");
      if (input) input.focus({ preventScroll: true });
    });
    new MutationObserver(later).observe(host, { childList: true, subtree: true });
    later();
  }

  // ── The detail drawer ────────────────────────────────────────────────────
  const drawer = $("prospect-drawer-backdrop");
  let drawerId = null, drawerOpener = null, editing = false;
  const dash = '<span class="field-hint">—</span>';
  const drow = (label, html) => `<div class="lead-sum-row"><dt>${esc(label)}</dt><dd>${html || dash}</dd></div>`;
  const dtext = (v) => (v ? esc(v) : "");
  const FORM = [
    ["name", "Company", "text"], ["country", "Country", "text"], ["website", "Website", "text"], ["awsAccountId", "AWS account ID (12 digits, if known)", "text"], ["industry", "Industry", "text"], ["subIndustry", "Sub-industry", "text"],
    ["hqCountry", "HQ country", "text"], ["markets", "Other markets (comma separated)", "text"], ["awsRegion", "AWS region", "text"],
    ["priority", "Priority", "select"], ["status", "Status", "select"], ["storePresence", "Store presence (as written)", "text"], ["storeCount", "Store count", "text"],
    ["ownership", "Ownership", "text"], ["decisionMakers", "Decision makers", "textarea"], ["linkedinUrl", "LinkedIn company page", "text"],
    ["linkedinOrgId", "LinkedIn organisation id (digits)", "text"], ["linkedinVerified", "LinkedIn page verified", "checkbox"], ["insights", "Insights", "textarea"],
    ["contacts", "Contacts (one per line: name | role | last contact | AWS account ID)", "textarea"], ["vendors", "Current vendors (comma separated)", "text"],
    ["campaigns", "Campaigns (comma separated)", "text"], ["source", "Source", "text"], ["notes", "Notes", "textarea"],
  ];
  const contactsText = (p) => p.contacts.map((c) => [c.name, c.role, c.lastContact, c.awsAccountId || ""].join(" | ").replace(/( \| )+$/, "")).join("\n");
  const formValue = (p, k) => (k === "markets" || k === "vendors" || k === "campaigns" ? p[k].join(", ") : k === "contacts" ? contactsText(p) : k === "storeCount" ? (p.storeCount == null ? "" : String(p.storeCount)) : p[k]);
  function drawerBody(p) {
    const stat = p.status === "converted" ? (p.leadId ? `${esc(statusLabel(p.status))} · <a href="#promote/leads">View lead</a>` : esc(statusLabel(p.status))) : esc(statusLabel(p.status));
    const prio = canEdit()
      ? `<select id="prospect-priority" class="lead-sum-stage" aria-label="Priority" data-editor-only><option value="">Not set</option>${PRIORITIES.map((x) => `<option value="${esc(x.key)}"${x.key === p.priority ? " selected" : ""}>${esc(x.label)}</option>`).join("")}</select>`
      : dtext(priorityLabel(p.priority));
    const li = linkedinHref(p.linkedinUrl);
    const site = safeUrl(p.website);
    return `
      <section class="lead-sum-section"><h3>Company</h3><dl class="lead-sum-dl">
        ${drow("Country", dtext(p.country))}
        ${drow("Website", site ? `<a href="${esc(site)}" target="_blank" rel="noopener noreferrer">${esc(p.website)}</a>` : dtext(p.website))}
        ${drow("Industry", dtext(p.industry))}${drow("Sub-industry", dtext(p.subIndustry))}
        ${drow("HQ country", dtext(p.hqCountry))}${drow("Other markets", dtext(p.markets.join(", ")))}${drow("AWS region", dtext(p.awsRegion))}
        ${drow("Ownership", dtext(p.ownership))}
        ${drow("AWS account ID", dtext(p.awsAccountId))}
      </dl></section>
      <section class="lead-sum-section"><h3>Targeting</h3><dl class="lead-sum-dl">
        ${drow("Priority", prio)}${drow("Status", stat)}
        ${drow("Store presence", dtext(p.storePresence))}${drow("Stores", p.storeCount == null ? "" : esc(p.storeCount.toLocaleString("en-GB")))}${drow("Size band", esc(sizeBandLabel(p.sizeBand)))}
        ${drow("Decision makers", dtext(p.decisionMakers))}
        ${drow("Current vendors", dtext(p.vendors.join(", ")))}${drow("Campaigns", dtext(p.campaigns.join(", ")))}
      </dl></section>
      <section class="lead-sum-section" id="prospect-sum-linkedin"><h3>LinkedIn</h3><dl class="lead-sum-dl">
        ${drow("Company page", li ? `<a href="${esc(li)}" target="_blank" rel="noopener noreferrer">${esc(li)}</a>` : "")}
        ${drow("Organisation id", dtext(p.linkedinOrgId))}${drow("Verified", p.linkedinVerified ? "Yes" : "No")}
      </dl></section>
      <section class="lead-sum-section"><h3>Insights</h3>${p.insights ? `<p class="prospect-insights">${esc(p.insights)}</p>` : `<p class="field-hint">No insights yet.</p>`}</section>
      <section class="lead-sum-section" id="prospect-sum-contacts"><h3>Contacts (${p.contacts.length})</h3>${p.contacts.length
        ? `<table class="prospect-contacts-table"><thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Last contact</th><th scope="col">AWS account ID</th></tr></thead><tbody>${p.contacts.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.role)}</td><td>${esc(c.lastContact)}</td><td>${esc(c.awsAccountId)}</td></tr>`).join("")}</tbody></table>`
        : `<p class="field-hint">No contacts yet.</p>`}</section>
      <section class="lead-sum-section"><h3>Record</h3><dl class="lead-sum-dl">
        ${drow("Source", dtext(p.source))}${drow("Notes", dtext(p.notes))}
      </dl></section>`;
  }
  function drawerForm(p) {
    const field = ([k, label, kind]) => {
      const id = `pf-${k}`, v = formValue(p, k);
      if (kind === "textarea") return `<label for="${id}">${esc(label)}</label><textarea id="${id}" rows="${k === "contacts" ? 6 : 3}">${esc(v)}</textarea>`;
      if (kind === "checkbox") return `<label class="prospect-check" for="${id}"><input type="checkbox" id="${id}"${p[k] ? " checked" : ""}>${esc(label)}</label>`;
      if (kind === "select") {
        const opts = k === "priority" ? [["", "Not set"], ...PRIORITIES.map((x) => [x.key, x.label])] : p.status === "converted" ? [["converted", "Converted to lead"]] : SETTABLE.map((x) => [x.key, x.label]);
        return `<label for="${id}">${esc(label)}</label><select id="${id}"${k === "status" && p.status === "converted" ? " disabled" : ""}>${opts.map(([o, l]) => `<option value="${esc(o)}"${o === v ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
      }
      return `<label for="${id}">${esc(label)}</label><input type="text" id="${id}" value="${esc(v)}" autocomplete="off">`;
    };
    return `<form class="prospect-form" id="prospect-form" novalidate>${FORM.map(field).join("")}</form>`;
  }
  function renderDrawer() {
    const p = rows.find((x) => x.id === drawerId);
    if (!p) { closeDrawer(false); return; }
    $("prospect-drawer-title").textContent = p.name;
    $("prospect-drawer-badges").innerHTML = `<span class="lead-chip">${esc(p.country || "No country")}</span>${p.industry ? `<span class="lead-chip">${esc(p.industry)}</span>` : ""}`;
    if (!editing) $("prospect-drawer-body").innerHTML = drawerBody(p);
    $("prospect-drawer-edit").hidden = editing || !canEdit();
    $("prospect-drawer-save").hidden = !editing || !canEdit();
    $("prospect-drawer-cancel").hidden = !editing;
  }
  function openDrawer(id, opener) {
    if (!rows.some((x) => x.id === id)) return;
    drawerId = id; editing = false; drawerOpener = opener || null;
    $("prospect-drawer-status").textContent = "";
    renderDrawer();
    drawer.hidden = false;
    $("prospect-drawer-close").focus();
  }
  function closeDrawer(restoreFocus = true) {
    const opener = drawerOpener;
    drawerId = null; editing = false; drawerOpener = null; drawer.hidden = true;
    if (restoreFocus && opener && opener.isConnected) opener.focus();
  }
  $("prospect-drawer-close").addEventListener("click", () => closeDrawer());
  drawer.addEventListener("mousedown", (e) => { if (e.target === drawer) closeDrawer(); });
  drawer.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.stopPropagation(); closeDrawer(); return; }
    if (e.key !== "Tab") return; // keep focus inside the drawer
    const f = [...$("prospect-drawer").querySelectorAll("button, a[href], select, input, textarea, [tabindex]:not([tabindex='-1'])")].filter((x) => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  });
  $("prospect-drawer-body").addEventListener("change", async (e) => {
    const sel = e.target.closest && e.target.closest("#prospect-priority");
    if (!sel || !drawerId || !canEdit()) return;
    const st = $("prospect-drawer-status");
    try {
      await updateDoc(doc(db, "prospects", drawerId), { priority: sel.value, updatedAt: serverTimestamp(), updatedByEmail: me() });
      st.classList.remove("is-error"); st.textContent = sel.value ? `Priority set to ${priorityLabel(sel.value)}.` : "Priority cleared.";
    } catch (err) { st.classList.add("is-error"); st.textContent = `Couldn't save the priority: ${err && err.message ? err.message : err}`; }
  });
  $("prospect-drawer-edit").addEventListener("click", () => {
    const p = rows.find((x) => x.id === drawerId);
    if (!p || !canEdit()) return;
    editing = true; $("prospect-drawer-body").innerHTML = drawerForm(p); renderDrawer();
    $("pf-name").focus();
  });
  $("prospect-drawer-cancel").addEventListener("click", () => { editing = false; $("prospect-drawer-status").textContent = ""; renderDrawer(); $("prospect-drawer-edit").focus(); });
  function parseContactLines(text) {
    return String(text || "").split(/\r?\n/).map((l) => l.split("|").map((x) => x.trim())).filter((c) => c.some(Boolean)).map((c) => ({ name: c[0] || "", role: c[1] || "", lastContact: c[2] || "", awsAccountId: c[3] || "" }));
  }
  $("prospect-drawer-save").addEventListener("click", async () => {
    const p = rows.find((x) => x.id === drawerId);
    if (!p || !canEdit() || !editing) return;
    const st = $("prospect-drawer-status");
    const val = (k) => $(`pf-${k}`).value;
    const input = {};
    for (const [k, , kind] of FORM) {
      if (kind === "checkbox") { input[k] = $(`pf-${k}`).checked; continue; }
      if (k === "status" && p.status === "converted") continue; // Converted is set only by Convert to lead
      if (k === "storeCount") { if (val(k).trim() !== formValue(p, k)) input.storeCount = val(k); continue; } // so a changed Store presence can set it
      if (k === "contacts") { input.contacts = parseContactLines(val(k)); continue; }
      input[k] = val(k);
    }
    const r = prospectFromInput(input, p);
    if (r.errors.length) { st.classList.add("is-error"); st.textContent = r.errors.join(" "); return; }
    const key = prospectKey(r.fields.name, r.fields.country);
    const twin = rows.find((x) => x.id !== p.id && prospectKey(x.name, x.country) === key);
    if (twin) { st.classList.add("is-error"); st.textContent = `${r.fields.name} · ${r.fields.country} already exists as another record.`; return; }
    st.classList.remove("is-error"); st.textContent = "Saving…";
    try {
      await updateDoc(doc(db, "prospects", p.id), { ...r.fields, updatedAt: serverTimestamp(), updatedByEmail: me() });
      editing = false; st.textContent = "Saved."; renderDrawer(); $("prospect-drawer-edit").focus();
    } catch (err) { st.classList.add("is-error"); st.textContent = `Couldn't save: ${err && err.message ? err.message : err}`; }
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
    // The company name opens the company's detail view; its website is one click further in.
    const company = (params) => {
      const span = document.createElement("span");
      span.className = "prospect-trunc";
      const b = document.createElement("button");
      b.type = "button"; b.className = "prospect-name-btn"; b.dataset.prospectOpen = params.data.id; b.textContent = params.value;
      b.setAttribute("aria-label", `Open details for ${params.data.name} in ${params.data.country}`);
      b.addEventListener("click", (e) => { e.stopPropagation(); openDetail(params.data.id); });
      span.appendChild(b);
      return span;
    };
    const linkedin = (params) => {
      const href = linkedinHref(params.data.linkedinUrl);
      if (!href) return document.createTextNode("");
      const a = document.createElement("a");
      a.className = "prospect-li-link"; a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer";
      a.setAttribute("aria-label", `LinkedIn page for ${params.data.name}`); a.title = "Open the LinkedIn page";
      a.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">business</span>';
      a.addEventListener("click", (e) => e.stopPropagation());
      return a;
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
    const colStd = { cellRenderer: trunc, tooltipValueGetter: tip };
    return [
      { colId: "select", headerName: "", width: 52, checkboxSelection: true, headerCheckboxSelection: true, headerCheckboxSelectionCurrentPageOnly: true, sortable: false, filter: false, floatingFilter: false, resizable: false, suppressMovable: true, pinned: "left", hide: !canEdit() },
      { field: "name", headerName: "Company", minWidth: 150, flex: 2, cellRenderer: company, tooltipValueGetter: tip },
      { field: "country", headerName: "Country", minWidth: 110, flex: 1, ...colStd },
      { field: "industry", headerName: "Industry", minWidth: 100, flex: 1, ...colStd },
      { field: "priority", headerName: "Priority", minWidth: 100, flex: 1, valueFormatter: (p) => priorityLabel(p.value), ...select(() => PRIORITIES.map((x) => [x.key, x.label])), cellRenderer: trunc },
      { field: "storeCount", headerName: "Stores", width: 96, type: "numericColumn", filter: "agNumberColumnFilter", valueFormatter: (p) => (p.value == null ? "" : p.value.toLocaleString("en-GB")) },
      { colId: "linkedin", field: "linkedinUrl", headerName: "LinkedIn", width: 90, sortable: false, filter: false, floatingFilter: false, cellRenderer: linkedin },
      { field: "status", headerName: "Status", minWidth: 110, flex: 1, valueFormatter: (p) => statusLabel(p.value), ...select(() => STATUSES.map((s) => [s.key, s.label])), cellRenderer: trunc },
      { field: "subIndustry", headerName: "Sub-industry", minWidth: 130, flex: 1, hide: true, ...colStd },
      { field: "hqCountry", headerName: "HQ country", minWidth: 100, flex: 1, hide: true, ...colStd },
      { field: "awsRegion", headerName: "AWS region", minWidth: 100, flex: 1, hide: true, ...select(() => distinct((p) => p.awsRegion)) },
      { field: "sizeBand", headerName: "Size band", minWidth: 100, flex: 1, hide: true, valueFormatter: (p) => sizeBandLabel(p.value), ...select(() => SIZE_BANDS.map((b) => [b.key, b.label])), cellRenderer: trunc },
      { field: "storePresence", headerName: "Store presence", minWidth: 120, flex: 1, hide: true, ...colStd },
      { field: "ownership", headerName: "Ownership", minWidth: 120, flex: 1, hide: true, ...colStd },
      { field: "insights", headerName: "Insights", minWidth: 200, flex: 2, hide: true, ...colStd },
      { field: "decisionMakers", headerName: "Decision makers", minWidth: 160, flex: 1, hide: true, ...colStd },
      { colId: "contacts", headerName: "Contacts", width: 100, hide: true, type: "numericColumn", filter: "agNumberColumnFilter", valueGetter: (p) => ((p.data && p.data.contacts) || []).length },
      { field: "source", headerName: "Source", minWidth: 120, flex: 1, hide: true, ...colStd },
      { ...list("vendors"), headerName: "Current vendors", minWidth: 160, flex: 1, hide: true, ...colStd },
      { ...list("campaigns"), headerName: "Campaigns", minWidth: 160, flex: 1, hide: true, ...colStd },
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
        suppressCellFocus: true, suppressColumnVirtualisation: true, tooltipShowDelay: 400,
        headerHeight: 40, floatingFiltersHeight: 40, rowHeight: 48,
        pagination: true, paginationPageSize: 25, paginationPageSizeSelector: [25, 50, 100, 250],
        domLayout: "autoHeight",
        overlayNoRowsTemplate: '<span class="um-empty">No prospects match these filters.</span>',
        onSelectionChanged: updateBulk,
        onModelUpdated: () => { updateCount(); updateBulk(); },
        onFilterChanged: () => syncClears(),
        onGridReady: () => syncClears(),
      });
      grid = { api };
      watchFilters();
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
      if (drawerId) renderDrawer();
      detailUi.refresh();
      if (grid) {
        grid.api.setGridOption("rowData", rows);
        const key = distinct((p) => p.awsRegion).join("|");
        if (key !== regionKey) { regionKey = key; grid.api.refreshHeader(); }
      } else if (rows.length) ensureGrid();
    }, () => { say("Prospects could not be loaded. Reload the page to try again.", true); });
  }
  function stop() { closePop(); closeDrawer(false); detailUi.close(); page.classList.remove("is-detail"); if (unsub) unsub(); unsub = null; started = false; }
  function render() {
    updateCount();
    if (drawerId) renderDrawer();
    if (grid) { grid.api.setColumnsVisible(["select"], canEdit()); updateBulk(); }
    else if (rows.length) ensureGrid();
  }
  return { start, stop, render, page, _rows: () => rows };
}
