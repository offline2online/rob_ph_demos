// Promote › Prospects (TAM) › Contacts tab (#promote/prospects?tab=contacts):
// every contact at the TAM companies, one per person, in prospectContacts/{id}.
// The rules are in prospect-contacts-core.js. Mounted by prospects-page.js,
// which owns the tabs and hands over the TAM records (getProspects) and the
// company detail view (openCompany).
//
// Ways in:
//   - the TAM spreadsheet's contacts, which sit on the company records
//     (prospects/{id}.contacts[]), are copied in by themselves when an editor
//     opens Prospects (TAM): only the ones not copied yet (importSpreadsheet);
//   - Add contact: a form with name, role, company (a TAM company or
//     Unmatched), LinkedIn URL, email and notes;
//   - Add from URL: a pasted LinkedIn profile URL opens the same form with the
//     link saved and the name guessed from it, to confirm company and role;
//   - the Chrome extension (backlog-tracker/chrome-extension/): one click on a
//     LinkedIn profile calls window.__phAddProspectContact with what it read,
//     and addFromExtension saves it, matched to a TAM company where it can.
// A LinkedIn profile is one contact: adding it again updates the same record.
//
// Every control is a <button>, a link or a form control acting on click (the iPad rule).
import {
  collection, doc, getDoc, setDoc, updateDoc, onSnapshot, serverTimestamp, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { loadAgGrid } from "./docs-grid.js";
import {
  CONTACTS_COLLECTION, UNMATCHED, SOURCES, normaliseContact, contactFromInput, findExisting, seedContacts,
  inputFromExtension, filterContacts, contactsForCompany, companyOptions, normaliseLinkedInProfileUrl,
  contactIdForLinkedIn, nameFromLinkedInUrl, matchProspect, fmtAdded, isUnmatched,
} from "./prospect-contacts-core.js";
import { slugId } from "./prospects-core.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const errText = (e) => (e && e.message ? e.message : String(e));

export function mountProspectContacts({ db, canEdit, me, say, getProspects, openCompany, onChange }) {
  const panel = $("prospects-contacts");
  const host = $("pct-grid");
  let contacts = [];        // every document, removed ones included
  let unsub = null;
  let loaded = false;
  let waiters = [];
  let grid = null, gridLoading = null;
  let visible = false;
  let importing = false;
  const prospectById = (id) => getProspects().find((p) => p.id === id) || null;
  const live = () => contacts.filter((c) => !c.removed);
  const whenLoaded = () => (loaded ? Promise.resolve() : new Promise((r) => waiters.push(r)));

  // ── Data ───────────────────────────────────────────────────────────────
  function start() {
    if (unsub) return;
    unsub = onSnapshot(collection(db, CONTACTS_COLLECTION), (snap) => {
      contacts = snap.docs.map((d) => normaliseContact(d.id, d.data({ serverTimestamps: "estimate" })));
      if (!loaded) { loaded = true; waiters.forEach((r) => r()); waiters = []; }
      paint();
      importSpreadsheet();
      if (onChange) onChange();
    }, () => { say("Contacts could not be loaded. Reload the page to try again.", true); });
  }
  function stop() { if (unsub) unsub(); unsub = null; loaded = false; contacts = []; closeDrawer(false); }

  // The spreadsheet's contacts (on the company records) that aren't in Contacts yet. Editors only;
  // ids are stable, so two tabs doing this at once write the same documents.
  async function importSpreadsheet() {
    if (!loaded || importing || !canEdit()) return;
    const prospects = getProspects();
    if (!prospects.length) return;
    const todo = seedContacts(prospects, new Set(contacts.map((c) => c.id)));
    if (!todo.length) return;
    importing = true;
    try {
      for (let i = 0; i < todo.length; i += 400) {
        const batch = writeBatch(db);
        todo.slice(i, i + 400).forEach((r) => batch.set(doc(db, CONTACTS_COLLECTION, r.id), {
          ...r.fields, removed: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdByEmail: me(), updatedByEmail: me(),
        }));
        await batch.commit();
      }
      say(`Imported ${todo.length} ${todo.length === 1 ? "contact" : "contacts"} from the TAM spreadsheet.`);
    } catch (e) { say(`Couldn't import the spreadsheet's contacts: ${errText(e)}`, true); }
    importing = false;
  }

  // ── The list ───────────────────────────────────────────────────────────
  const filters = () => ({ q: $("pct-q").value, company: $("pct-company").value });
  function paintCompanyFilter() {
    const sel = $("pct-company"), cur = sel.value;
    const opts = companyOptions(contacts);
    const html = `<option value="">All companies</option><option value="${UNMATCHED}">Unmatched</option>${opts.map(([k, n]) => `<option value="${esc(k)}">${esc(n)}</option>`).join("")}`;
    if (sel.dataset.html !== html) { sel.innerHTML = html; sel.dataset.html = html; sel.value = [...sel.options].some((o) => o.value === cur) ? cur : ""; }
  }
  function paint() {
    if (!panel) return;
    paintCompanyFilter();
    const all = live(), rows = filterContacts(contacts, filters());
    const word = all.length === 1 ? "Contact" : "Contacts";
    $("pct-count").innerHTML = rows.length === all.length ? `<b>${all.length.toLocaleString("en-GB")}</b> ${word}` : `<b>${rows.length.toLocaleString("en-GB")}</b> of ${all.length.toLocaleString("en-GB")} ${word}`;
    $("pct-empty").hidden = !loaded || all.length > 0;
    host.hidden = loaded && all.length === 0;
    $("pct-add").hidden = !canEdit();
    $("pct-url-form").hidden = !canEdit();
    if (grid) grid.api.setGridOption("rowData", rows);
    else if (visible && all.length) ensureGrid();
  }
  function columns() {
    const name = (p) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "prospect-name-btn"; b.dataset.contactOpen = p.data.id; b.textContent = p.value;
      b.setAttribute("aria-label", `Open ${p.data.name}`);
      b.addEventListener("click", (e) => { e.stopPropagation(); openForm({ id: p.data.id }, b); });
      const s = document.createElement("span"); s.className = "prospect-trunc"; s.appendChild(b);
      return s;
    };
    const company = (p) => {
      const s = document.createElement("span"); s.className = "prospect-trunc";
      if (isUnmatched(p.data)) {
        s.innerHTML = `<span class="pc-unmatched">Unmatched</span>${p.data.companyName ? ` <span class="pc-raw">${esc(p.data.companyName)}</span>` : ""}`;
        return s;
      }
      const b = document.createElement("button");
      b.type = "button"; b.className = "prospect-name-btn"; b.dataset.contactCompany = p.data.prospectId; b.textContent = p.data.companyName;
      b.setAttribute("aria-label", `Open ${p.data.companyName}`);
      b.addEventListener("click", (e) => { e.stopPropagation(); if (prospectById(p.data.prospectId)) openCompany(p.data.prospectId); else say(`${p.data.companyName} is no longer in the TAM list.`, true); });
      s.appendChild(b);
      return s;
    };
    const linkedin = (p) => {
      if (!p.data.linkedinUrl) return document.createTextNode("");
      const a = document.createElement("a");
      a.className = "prospect-li-link"; a.href = p.data.linkedinUrl; a.target = "_blank"; a.rel = "noopener noreferrer";
      a.setAttribute("aria-label", `LinkedIn profile of ${p.data.name}`); a.title = "Open the LinkedIn profile";
      a.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">person</span>';
      a.addEventListener("click", (e) => e.stopPropagation());
      return a;
    };
    const trunc = (p) => { const s = document.createElement("span"); s.className = "prospect-trunc"; s.textContent = p.valueFormatted != null ? p.valueFormatted : p.value == null ? "" : String(p.value); return s; };
    return [
      { field: "name", headerName: "Name", minWidth: 150, flex: 2, cellRenderer: name, tooltipField: "name" },
      { field: "role", headerName: "Role", minWidth: 160, flex: 2, cellRenderer: trunc, tooltipField: "role" },
      { colId: "company", headerName: "Company", minWidth: 150, flex: 2, valueGetter: (p) => (isUnmatched(p.data) ? `~${p.data.companyName}` : p.data.companyName), cellRenderer: company, tooltipValueGetter: (p) => p.data.companyName || "Unmatched" },
      { colId: "linkedin", field: "linkedinUrl", headerName: "LinkedIn", width: 96, sortable: false, cellRenderer: linkedin },
      { field: "createdAt", headerName: "Added", width: 130, sort: "desc", valueFormatter: (p) => fmtAdded(p.value), cellRenderer: trunc },
    ];
  }
  function ensureGrid() {
    if (grid) return Promise.resolve(grid);
    if (gridLoading) return gridLoading;
    gridLoading = loadAgGrid().then((ag) => {
      if (!ag) { host.innerHTML = '<p class="promote-empty">The list could not load. Check your connection and reload.</p>'; return null; }
      const api = ag.createGrid(host, {
        columnDefs: columns(),
        defaultColDef: { sortable: true, resizable: true, suppressHeaderMenuButton: true, filter: false },
        rowData: filterContacts(contacts, filters()),
        getRowId: (p) => p.data.id,
        suppressCellFocus: true, suppressColumnVirtualisation: true, tooltipShowDelay: 400,
        headerHeight: 44, rowHeight: 48, domLayout: "autoHeight",
        pagination: true, paginationPageSize: 50, paginationPageSizeSelector: [25, 50, 100, 250],
        overlayNoRowsTemplate: '<span class="um-empty">No contacts match.</span>',
      });
      grid = { api };
      return grid;
    });
    return gridLoading;
  }
  $("pct-q").addEventListener("input", paint);
  $("pct-company").addEventListener("change", paint);

  // ── The contact form (drawer) ──────────────────────────────────────────
  const drawer = $("pct-drawer-backdrop");
  let editId = "", opener = null, pendingSource = "";
  const st = () => $("pct-drawer-status");
  const setStatus = (t, bad) => { st().textContent = t || ""; st().classList.toggle("is-error", !!bad); };
  function companySelect(selected) {
    const list = getProspects().slice().sort((a, b) => a.name.localeCompare(b.name) || String(a.country).localeCompare(String(b.country)));
    $("pctf-company").innerHTML = `<option value="">Unmatched (not a TAM company yet)</option>${list.map((p) => `<option value="${esc(p.id)}"${p.id === selected ? " selected" : ""}>${esc(p.name)}${p.country ? ` · ${esc(p.country)}` : ""}</option>`).join("")}`;
  }
  // opts: { id } to open a contact, or { linkedinUrl, name, role, companyName, prospectId, source } to start a new one.
  function openForm(opts = {}, from) {
    const c = opts.id ? contacts.find((x) => x.id === opts.id) : null;
    const x = c || { name: opts.name || "", role: opts.role || "", companyName: opts.companyName || "", prospectId: opts.prospectId || "", linkedinUrl: opts.linkedinUrl || "", email: "", notes: "" };
    if (!c && !x.prospectId && x.companyName) { const m = matchProspect(x.companyName, getProspects()); if (m) x.prospectId = m.id; }
    editId = c ? c.id : ""; opener = from || null; pendingSource = c ? "" : (opts.source || SOURCES.manual);
    const can = canEdit();
    $("pct-drawer-title").textContent = c ? c.name : "Add contact";
    $("pctf-name").value = x.name; $("pctf-role").value = x.role; $("pctf-linkedin").value = x.linkedinUrl;
    $("pctf-email").value = x.email; $("pctf-notes").value = x.notes;
    companySelect(x.prospectId);
    $("pctf-company-hint").textContent = x.companyName && !x.prospectId ? `Company as written: ${x.companyName}. Pick its TAM company, or leave it Unmatched.` : "";
    $("pct-form").querySelectorAll("input, select, textarea").forEach((el) => { el.disabled = !can; });
    $("pct-save").hidden = !can;
    // A new contact (often prefilled from a URL or a company) can be saved as it opens; an existing one once it changes
    // (modal-polish.js's rule, which data-no-dirty opts out of).
    const sv = $("pct-save");
    if (c) sv.removeAttribute("data-no-dirty");
    else { sv.setAttribute("data-no-dirty", ""); sv.disabled = false; sv.removeAttribute("aria-disabled"); if (sv.title === "No changes to save") sv.removeAttribute("title"); }
    $("pct-remove").hidden = !can || !c;
    const rm = $("pct-remove"); delete rm.dataset.armed; rm.lastChild.textContent = "Remove";
    $("pct-meta").textContent = c ? [c.source && `Source: ${c.source}`, c.createdAt && `Added ${fmtAdded(c.createdAt)}`, c.lastContact && `Last contact: ${c.lastContact}`].filter(Boolean).join(" · ") : "";
    setStatus(opts.message || "", false);
    drawer.hidden = false;
    (can ? (x.name ? $("pctf-role") : $("pctf-name")) : $("pct-drawer-close")).focus();
  }
  function closeDrawer(restore = true) {
    const o = opener; drawer.hidden = true; editId = ""; opener = null;
    if (restore && o && o.isConnected) o.focus();
  }
  $("pct-drawer-close").addEventListener("click", () => closeDrawer());
  $("pct-cancel").addEventListener("click", () => closeDrawer());
  drawer.addEventListener("click", (e) => { if (e.target === drawer) closeDrawer(); }); // a tap on the backdrop closes it (click, the iPad rule)
  drawer.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.stopPropagation(); closeDrawer(); return; }
    if (e.key !== "Tab") return;
    const f = [...$("pct-drawer").querySelectorAll("button, a[href], select, input, textarea")].filter((x) => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  });
  $("pct-form").addEventListener("submit", (e) => { e.preventDefault(); save(); });
  $("pct-save").addEventListener("click", () => save());

  // Writes a contact: `id` an existing document to update, else a new one (the LinkedIn id when there is a profile).
  async function write(id, fields, isNew) {
    const ref = id ? doc(db, CONTACTS_COLLECTION, id) : doc(collection(db, CONTACTS_COLLECTION));
    if (isNew) await setDoc(ref, { ...fields, removed: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdByEmail: me(), updatedByEmail: me() });
    else await updateDoc(ref, { ...fields, removed: false, updatedAt: serverTimestamp(), updatedByEmail: me() });
    return ref.id;
  }
  async function save() {
    if (!canEdit()) return;
    const prospect = prospectById($("pctf-company").value);
    const cur = editId ? contacts.find((x) => x.id === editId) : null;
    const r = contactFromInput({
      name: $("pctf-name").value, role: $("pctf-role").value, linkedinUrl: $("pctf-linkedin").value, email: $("pctf-email").value, notes: $("pctf-notes").value,
      companyName: prospect ? "" : (cur ? cur.companyName : ""), source: cur ? cur.source : pendingSource,
    }, prospect);
    if (r.errors.length) { setStatus(r.errors.join(" "), true); return; }
    const others = live().filter((x) => x.id !== editId);
    const twin = findExisting(others, { linkedinUrl: r.fields.linkedinUrl, name: r.fields.name, companyKey: r.fields.companyKey });
    if (cur && twin) { setStatus(`${twin.name} is already a contact${twin.linkedinUrl === r.fields.linkedinUrl && r.fields.linkedinUrl ? " with this LinkedIn profile" : " at this company"}.`, true); return; }
    setStatus("Saving…");
    try {
      let id, outcome;
      if (cur) { id = await write(cur.id, r.fields, false); outcome = "Saved"; }
      else if (twin) { id = await write(twin.id, r.fields, false); outcome = "Already a contact: updated"; }
      else {
        const liId = r.fields.linkedinUrl ? contactIdForLinkedIn(r.fields.linkedinUrl) : "";
        const exists = liId ? contacts.some((x) => x.id === liId) || (await getDoc(doc(db, CONTACTS_COLLECTION, liId))).exists() : false;
        id = await write(liId, r.fields, !exists); outcome = exists ? "Already a contact: updated" : "Added";
      }
      say(`${outcome} ${r.fields.name}${prospect ? ` at ${prospect.name}` : " (Unmatched)"}.`);
      closeDrawer();
      highlight(id);
    } catch (e) { setStatus(`Couldn't save: ${errText(e)}`, true); }
  }
  $("pct-remove").addEventListener("click", async () => {
    const b = $("pct-remove");
    if (!editId || !canEdit()) return;
    if (!b.dataset.armed) { b.dataset.armed = "1"; b.lastChild.textContent = "Click again to remove"; return; }
    const c = contacts.find((x) => x.id === editId);
    try {
      // Kept as a removed record, so the spreadsheet import doesn't bring it back.
      await updateDoc(doc(db, CONTACTS_COLLECTION, editId), { removed: true, updatedAt: serverTimestamp(), updatedByEmail: me() });
      say(`Removed ${c ? c.name : "the contact"}.`);
      closeDrawer();
    } catch (e) { setStatus(`Couldn't remove: ${errText(e)}`, true); }
  });

  // ── Add contact / Add from URL ─────────────────────────────────────────
  $("pct-add").addEventListener("click", (e) => openForm({ source: SOURCES.manual }, e.currentTarget));
  $("pct-url-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!canEdit()) return;
    const input = $("pct-url"), url = normaliseLinkedInProfileUrl(input.value);
    if (!url) { say("Paste a LinkedIn profile URL, like https://www.linkedin.com/in/their-name/.", true); input.focus(); return; }
    const have = findExisting(live(), { linkedinUrl: url });
    input.value = "";
    if (have) { openForm({ id: have.id, message: `${have.name} is already a contact. Update them here.` }, $("pct-url-btn")); return; }
    openForm({ linkedinUrl: url, name: nameFromLinkedInUrl(url), source: SOURCES.url, message: "Check the name, then pick the company and add the role." }, $("pct-url-btn"));
  });

  // ── The Chrome extension ───────────────────────────────────────────────
  // payload: { name, headline, company, url } read from a LinkedIn profile. Resolves to
  // { ok, outcome: "added" | "updated", name, company } or { ok: false, error }.
  async function addFromExtension(payload) {
    await whenLoaded();
    if (!canEdit()) return { ok: false, error: "Your role can view Prospects (TAM) but not add contacts." };
    const input = inputFromExtension(payload);
    const url = normaliseLinkedInProfileUrl(input.linkedinUrl);
    if (!url) return { ok: false, error: "That page isn't a LinkedIn profile." };
    if (!input.name) return { ok: false, error: "Couldn't read the name from the profile." };
    const prospects = getProspects();
    const byUrl = findExisting(contacts, { linkedinUrl: url }); // a removed contact comes back rather than being made twice
    const matched = matchProspect(input.companyName, prospects);
    const existing = byUrl || findExisting(live(), { name: input.name, companyKey: matched ? slugId(matched.name) : "" });
    // An existing contact keeps the company someone linked by hand; the profile's name and headline refresh.
    const keep = existing && existing.prospectId ? prospectById(existing.prospectId) : null;
    const prospect = keep || matched;
    const r = contactFromInput({ ...input, linkedinUrl: url, email: existing ? existing.email : "", notes: existing ? existing.notes : "", source: existing ? existing.source : SOURCES.extension, role: input.role || (existing ? existing.role : "") }, prospect);
    if (r.errors.length) return { ok: false, error: r.errors.join(" ") };
    try {
      let id, outcome;
      if (existing) { id = await write(existing.id, r.fields, false); outcome = "updated"; }
      else {
        const liId = contactIdForLinkedIn(url);
        const exists = (await getDoc(doc(db, CONTACTS_COLLECTION, liId))).exists();
        id = await write(liId, r.fields, !exists); outcome = exists ? "updated" : "added";
      }
      const company = prospect ? prospect.name : "Unmatched";
      say(`${outcome === "added" ? "Added" : "Updated"} ${r.fields.name} (${company}) from LinkedIn.`);
      highlight(id);
      return { ok: true, outcome, id, name: r.fields.name, company };
    } catch (e) { return { ok: false, error: `Couldn't save: ${errText(e)}` }; }
  }

  function highlight(id) {
    if (!grid || !id) return;
    setTimeout(() => {
      const n = grid && grid.api.getRowNode(id);
      if (n) { grid.api.ensureNodeVisible(n); grid.api.flashCells({ rowNodes: [n] }); }
    }, 300);
  }

  return {
    start, stop, openForm, addFromExtension, whenLoaded,
    show() { visible = true; panel.hidden = false; paint(); if (live().length) ensureGrid(); },
    hide() { visible = false; },
    refresh() { paint(); importSpreadsheet(); },
    forCompany: (ck) => contactsForCompany(contacts, ck),
    _contacts: () => contacts,
  };
}
