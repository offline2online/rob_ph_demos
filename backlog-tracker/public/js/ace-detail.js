// Promote › Leads › AWS ACE opportunities: the in-console detail dialog.
// One dialog for viewing/editing an opportunity, creating a new one and attaching documents.
//   const d = mountAceDetail({ backdrop, apiHeaders, canEdit, onSaved });  d.open(row);  d.openNew();
// Saves go through /partnerCentral/v1/ace (functions/partner-central.js), which writes to AWS ACE and
// answers with the refreshed row, so the score in the table is AWS's own.
import { ACE_STAGES, formValues, changedValues, validateForm, savedMessage, formatDateTime, partnerCentralHref, ACE_DOC_ACCEPT, checkDocument } from "./ace-core.js";
import { listAceDocs, uploadAceDoc, removeAceDoc } from "./ace-docs.js";

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const size = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const CURRENCIES = ["USD", "GBP", "EUR", "AUD", "CAD"];

export function mountAceDetail({ backdrop, apiHeaders, canEdit = () => true, onSaved = () => {}, listDocs = listAceDocs, uploadDoc = uploadAceDoc, removeDoc = removeAceDoc }) {
  let row = null, creating = false, original = null, loaded = false, busy = false, opener = null;
  const q = (sel) => backdrop.querySelector(sel);

  function markup() {
    const stageOptions = ACE_STAGES.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
    const cur = CURRENCIES.map((c) => `<option value="${c}">${c}</option>`).join("");
    backdrop.innerHTML = `
      <div class="modal-panel modal-panel-wide ace-dialog" role="dialog" aria-modal="true" aria-labelledby="ace-dlg-title">
        <div class="modal-header">
          <h2 id="ace-dlg-title">Opportunity</h2>
          <button type="button" class="modal-close" data-ace="close" aria-label="Close">&times;</button>
        </div>
        <div class="ace-dlg-facts" id="ace-dlg-facts"></div>
        <div class="ace-dlg-grid">
          <label class="field-label">Customer<input type="text" data-f="customer" maxlength="160" autocomplete="off"></label>
          <label class="field-label">Opportunity<input type="text" data-f="name" maxlength="200" autocomplete="off"></label>
          <label class="field-label">ACE stage<select data-f="stage"><option value=""></option>${stageOptions}</select></label>
          <label class="field-label">Expected delivery date<input type="date" data-f="targetCloseDate"></label>
          <label class="field-label">Monthly AWS revenue<span class="ace-dlg-money"><input type="number" data-f="monthlyAmount" min="0" step="any" inputmode="decimal" aria-label="Monthly AWS revenue amount"><select data-f="currency" aria-label="Currency">${cur}</select></span></label>
          <label class="field-label">Customer website<input type="text" data-f="website" maxlength="300" autocomplete="off" placeholder="https://"></label>
          <label class="field-label ace-dlg-wide">Next steps<textarea data-f="nextSteps" rows="3" maxlength="2000"></textarea></label>
          <label class="field-label ace-dlg-wide">Customer business problem<textarea data-f="description" rows="4" maxlength="2000"></textarea></label>
        </div>
        <section class="ace-dlg-docs" id="ace-dlg-docs" aria-labelledby="ace-dlg-docs-title">
          <h3 id="ace-dlg-docs-title">Documents</h3>
          <p class="field-hint" id="ace-dlg-docs-hint">PDF, Office, image or zip, up to 50 MB. Kept in the console; AWS ACE does not take files through its API.</p>
          <ul class="ace-dlg-doclist" id="ace-dlg-doclist"></ul>
          <button type="button" class="btn-ghost ace-dlg-attach" id="ace-dlg-attach" data-ace="attach"><span class="material-symbols-outlined" aria-hidden="true">attach_file</span>Attach a document</button>
          <input type="file" id="ace-dlg-file" accept="${ACE_DOC_ACCEPT}" hidden>
        </section>
        <p class="ace-dlg-status" id="ace-dlg-status" role="status" aria-live="polite"></p>
        <div class="form-row" style="justify-content:flex-end;">
          <div class="form-actions">
            <a class="btn-ghost" id="ace-dlg-pc" target="_blank" rel="noopener noreferrer" hidden>View in Partner Central</a>
            <button type="button" class="btn-ghost" data-ace="cancel">Close</button>
            <button type="button" class="btn-primary" id="ace-dlg-save" data-ace="submit">Save to ACE</button>
          </div>
        </div>
      </div>`;
  }

  const field = (k) => q(`[data-f="${k}"]`);
  const status = (msg, tone = "") => { const s = q("#ace-dlg-status"); s.textContent = msg || ""; s.dataset.tone = tone; };
  const read = () => Object.fromEntries([...backdrop.querySelectorAll("[data-f]")].map((e) => [e.dataset.f, e.value]));
  const write = (v) => { for (const [k, val] of Object.entries(v)) { const e = field(k); if (e) e.value = val; } };
  const editable = () => !!canEdit();
  function setBusy(v) {
    busy = v;
    const save = q("#ace-dlg-save"); save.disabled = v || !loaded || !editable();
    backdrop.querySelectorAll("[data-f]").forEach((e) => { e.disabled = v || !editable(); });
    const a = q("#ace-dlg-attach"); if (a) a.disabled = v || creating || !editable();
  }

  function facts() {
    const r = row || {};
    const bits = creating ? [] : [
      ["Review status", r.reviewStatus || "–"], ["Score", r.score != null && r.score !== "" ? r.score : "–"],
      ["Created", formatDateTime(r.createdDate) || "–"], ["Last updated", formatDateTime(r.lastModifiedDate) || "–"],
      ["AWS account manager", (r.awsSeller && r.awsSeller.name) || "Not assigned"],
    ];
    q("#ace-dlg-facts").innerHTML = bits.map(([k, v]) => `<div class="ace-dlg-fact"><span class="ace-dlg-fact-k">${esc(k)}</span><span class="ace-dlg-fact-v">${esc(v)}</span></div>`).join("");
    const pc = q("#ace-dlg-pc"), href = row && !creating ? partnerCentralHref(row) : "";
    pc.hidden = !href; if (href) pc.href = href;
  }

  async function refreshDocs() {
    const ul = q("#ace-dlg-doclist");
    if (creating) { ul.innerHTML = ""; q("#ace-dlg-docs-hint").textContent = "Create the opportunity first, then attach documents to it."; return; }
    q("#ace-dlg-docs-hint").textContent = "PDF, Office, image or zip, up to 50 MB. Kept in the console; AWS ACE does not take files through its API.";
    ul.innerHTML = '<li class="ace-dlg-doc-empty">Loading…</li>';
    const id = row.id;
    try {
      const docs = await listDocs(id);
      if (!row || row.id !== id) return;
      ul.innerHTML = docs.length ? docs.map((d) => `<li class="ace-dlg-doc"><span class="material-symbols-outlined" aria-hidden="true">description</span><a class="ace-dlg-doc-name" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer" download>${esc(d.name)}</a><span class="ace-dlg-doc-size">${d.size ? size(d.size) : ""}</span>${editable() ? `<button type="button" class="btn-ghost ace-dlg-doc-remove" data-ace="remove" data-path="${esc(d.path)}" aria-label="Remove ${esc(d.name)}"><span class="material-symbols-outlined" aria-hidden="true">delete</span></button>` : ""}</li>`).join("") : '<li class="ace-dlg-doc-empty">No documents yet.</li>';
    } catch (err) { ul.innerHTML = `<li class="ace-dlg-doc-empty">Couldn't load the documents: ${esc(err && err.message ? err.message : err)}</li>`; }
  }

  async function loadDetail() {
    const id = row.id;
    status("Loading the latest from AWS ACE…");
    try {
      const resp = await fetch(`/partnerCentral/v1/ace/${encodeURIComponent(id)}`, { method: "GET", headers: await apiHeaders() });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
      if (!row || row.id !== id) return;
      row = { ...row, ...body.opportunity };
      original = formValues(row); write(original); facts(); loaded = true; status("");
    } catch (err) { status(`Couldn't load the full details from AWS ACE: ${err && err.message ? err.message : err}. Close and try again; saving is off so nothing is overwritten.`, "bad"); }
    setBusy(false);
  }

  function show() {
    backdrop.hidden = false;
    const first = field(creating ? "customer" : "name"); if (first) first.focus({ preventScroll: true });
  }
  function close() {
    if (backdrop.hidden) return;
    backdrop.hidden = true; backdrop.innerHTML = ""; row = null; original = null;
    if (opener && opener.isConnected) opener.focus(); opener = null;
  }

  function open(r, from) {
    opener = from || document.activeElement; row = r; creating = false; loaded = false;
    markup(); original = formValues(r); write(original); facts();
    q("#ace-dlg-title").textContent = r.name || r.id;
    q("#ace-dlg-save").textContent = "Save to ACE";
    setBusy(true); show(); refreshDocs(); loadDetail();
  }
  function openNew(from) {
    opener = from || document.activeElement; row = null; creating = true; loaded = true;
    markup(); original = formValues({}); write(original); facts();
    q("#ace-dlg-title").textContent = "New opportunity";
    q("#ace-dlg-save").textContent = "Create in ACE";
    refreshDocs(); setBusy(false); show();
  }

  async function save() {
    if (busy || !editable()) return;
    const values = read();
    const errors = validateForm(values, { creating });
    if (errors.length) { status(errors.join(" "), "bad"); return; }
    const payload = creating ? changedValues(formValues({}), values) : changedValues(original, values);
    if (!creating && !Object.keys(payload).length) { status("No changes to save."); return; }
    setBusy(true); status(creating ? "Creating in AWS ACE…" : "Saving to AWS ACE…");
    try {
      const resp = await fetch(creating ? "/partnerCentral/v1/ace" : `/partnerCentral/v1/ace/${encodeURIComponent(row.id)}`, { method: creating ? "POST" : "PATCH", headers: await apiHeaders(), body: JSON.stringify(payload) });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
      const saved = body.opportunity;
      if (creating) {
        onSaved(saved, "created");
        row = saved; creating = false; original = formValues(saved); write(original); facts();
        q("#ace-dlg-title").textContent = saved.name || saved.id; q("#ace-dlg-save").textContent = "Save to ACE";
        status(savedMessage(saved, "Created in AWS ACE") + " You can now attach documents.", "ok"); refreshDocs();
      } else {
        row = { ...row, ...saved }; original = formValues(row); write(original); facts(); onSaved(row, "updated");
        status(savedMessage(row), "ok");
      }
    } catch (err) { status(`Not saved: ${err && err.message ? err.message : err}`, "bad"); }
    setBusy(false);
  }

  async function attach(file) {
    const chk = checkDocument(file);
    if (!chk.ok) { status(chk.error, "bad"); return; }
    setBusy(true); status(`Attaching ${file.name}…`);
    try { await uploadDoc(row.id, file); status(`Attached ${file.name}.`, "ok"); await refreshDocs(); }
    catch (err) { status(err && err.message ? err.message : String(err), "bad"); }
    setBusy(false);
  }

  backdrop.addEventListener("click", async (e) => {
    if (e.target === backdrop) { close(); return; }
    const b = e.target.closest("[data-ace]"); if (!b) return;
    const act = b.dataset.ace;
    if (act === "close" || act === "cancel") close();
    else if (act === "submit") save();
    else if (act === "attach") q("#ace-dlg-file").click();
    else if (act === "remove") {
      if (!b.dataset.armed) { b.dataset.armed = "1"; b.title = "Press again to remove"; status("Press the bin again to remove this document."); return; }
      setBusy(true);
      try { await removeDoc(b.dataset.path); status("Document removed.", "ok"); await refreshDocs(); } catch (err) { status(`Couldn't remove it: ${err && err.message ? err.message : err}`, "bad"); }
      setBusy(false);
    }
  });
  backdrop.addEventListener("change", (e) => { if (e.target.id === "ace-dlg-file") { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) attach(f); } });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !backdrop.hidden) close(); });

  return { open, openNew, close, get isOpen() { return !backdrop.hidden; } };
}
