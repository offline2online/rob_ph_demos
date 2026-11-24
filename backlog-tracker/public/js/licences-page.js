// Promote › License Manager (#promote/license-manager): every AWS Marketplace
// agreement (licence) with its buyer's company and contact, linked to Prospects
// (TAM) and Leads. Rules are in licences-core.js.
// Reads `licences` (written by the server sync, functions/marketplace-agreements.js),
// its status (consoleConfig/licenceSync), `prospects`, `prospectCompanies` (the
// email formats on a company's profile) and `leads`. Sync and the review
// queue's links go through /partnerCentral/v1/licences/… (editors and admins).
// No explanatory copy on the page: help is in the info tooltip.
import { collection, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { loadAgGrid } from "./docs-grid.js";
import { normaliseLead } from "./leads-core.js";
import { normaliseProspect } from "./prospects-core.js";
import { normaliseLicence, buildRows, reviewQueue, summary, syncStatusView, MATCH, MATCH_LABELS, ONBOARDING_LABELS } from "./licences-core.js";

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const $ = (id) => document.getElementById(id);
const PAGE = 50;
const TONE = { [MATCH.linked]: "ok", [MATCH.review]: "warn", [MATCH.awaiting]: "" };
const fmtTime = (ms) => (ms ? new Date(ms).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");

export function mountLicencesPage({ db, canEdit = () => false, apiHeaders, openLead = () => {} }) {
  let licences = [], prospects = [], companies = [], leads = [], syncDoc = null;
  let rows = [], tab = "all", busy = "", notice = "", failure = "";
  let unsubs = [], started = false, built = false, api = null, gridLoading = null, reviewDrawn = "";

  function start() {
    if (started) return;
    started = true;
    const watch = (name, apply) => unsubs.push(onSnapshot(collection(db, name), (snap) => { apply(snap.docs.map((d) => ({ id: d.id, data: d.data() }))); render(); },
      (err) => console.warn("backlog-tracker: license manager", name, err)));
    watch("licences", (list) => { licences = list.map((r) => normaliseLicence(r.id, r.data)); });
    watch("prospects", (list) => { prospects = list.map((r) => normaliseProspect(r.id, r.data)); });
    watch("prospectCompanies", (list) => { companies = list; });
    watch("leads", (list) => { leads = list.map((r) => normaliseLead(r.id, r.data)); });
    unsubs.push(onSnapshot(doc(db, "consoleConfig", "licenceSync"), (snap) => { syncDoc = snap.exists() ? snap.data() : null; render(); },
      (err) => console.warn("backlog-tracker: license manager sync status", err)));
  }

  async function post(path, body) {
    const resp = await fetch(`/partnerCentral/v1/licences/${path}`, { method: "POST", headers: await apiHeaders(), body: JSON.stringify(body || {}) });
    const out = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(out.error || `HTTP ${resp.status}`);
    return out;
  }
  async function sync() {
    if (busy) return;
    busy = "sync"; failure = ""; notice = "Syncing from AWS Marketplace…"; render();
    try {
      const out = await post("sync");
      notice = `Synced ${out.count} ${out.count === 1 ? "agreement" : "agreements"}${out.contactErrors ? `; contacts couldn't be read for ${out.contactErrors}` : ""}.`;
    } catch (err) { notice = ""; failure = `Sync failed: ${err && err.message ? err.message : err}`; }
    busy = ""; render();
  }
  async function link(agreementId, prospectId) {
    if (busy) return;
    busy = "link"; failure = ""; notice = prospectId ? "Linking…" : "Unlinking…"; render();
    try {
      await post("link", { agreementId, prospectId });
      const p = prospects.find((x) => x.id === prospectId);
      notice = prospectId ? `Linked to ${p ? `${p.name} · ${p.country}` : "the TAM company"}.` : "Link removed.";
    } catch (err) { notice = ""; failure = `Couldn't ${prospectId ? "link" : "unlink"}: ${err && err.message ? err.message : err}`; }
    busy = ""; render();
  }

  // ── The grid ──
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  function columns() {
    const trunc = (p) => el("span", "ace-trunc", p.value == null ? "" : String(p.value));
    const muted = (t) => el("span", "ace-none", t);
    const contact = (p) => {
      const r = p.data;
      if (!r.contactName && !r.contactEmail) return muted(r.kind === "licence" ? "No contact on the agreement" : "No contact");
      const w = el("span", "licences-contact");
      w.appendChild(el("span", "ace-trunc", r.contactName || r.contactEmail));
      if (r.contactEmail) {
        const a = el("a", "ace-mail"); a.href = `mailto:${r.contactEmail}`;
        a.setAttribute("aria-label", `Email ${r.contactName || r.contactEmail}`); a.title = r.contactEmail;
        a.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">email</span>';
        w.appendChild(a);
      }
      return w;
    };
    const match = (p) => {
      const w = el("span", "um-status ace-review"); w.dataset.tone = TONE[p.data.match] || "";
      w.appendChild(el("span", "ace-dot")); w.appendChild(el("span", "ace-trunc", MATCH_LABELS[p.data.match] || ""));
      return w;
    };
    const tam = (p) => {
      const r = p.data;
      if (!r.prospectId) return muted("Not linked");
      const w = el("span", "licences-tam");
      w.appendChild(el("span", "ace-trunc", r.prospectCountry ? `${r.prospectName} · ${r.prospectCountry}` : r.prospectName));
      if (r.manual && canEdit()) {
        const b = el("button", "btn-ghost licences-unlink", "Unlink"); b.type = "button"; b.dataset.editorOnly = "";
        b.setAttribute("aria-label", `Unlink ${r.company || r.agreementId} from ${r.prospectName}`);
        b.addEventListener("click", (e) => { e.stopPropagation(); link(r.agreementId, ""); });
        w.appendChild(b);
      }
      return w;
    };
    const lead = (p) => {
      if (!p.data.leadId) return muted("No lead");
      const b = el("button", "ace-lead", "Lead card"); b.type = "button"; b.dataset.leadId = p.data.leadId;
      b.addEventListener("click", (e) => { e.stopPropagation(); openLead(p.data.leadId); });
      return b;
    };
    const onboarding = (p) => {
      const v = p.data.onboarding;
      if (!v) return el("span");
      const w = el("span", "um-status ace-review"); w.dataset.tone = v === "ready" ? "ok" : "warn";
      w.appendChild(el("span", "ace-dot")); w.appendChild(el("span", "ace-trunc", ONBOARDING_LABELS[v]));
      return w;
    };
    const none = { filter: false, floatingFilter: false };
    const tip = (p) => (p.value == null ? "" : String(p.value));
    return [
      { field: "company", headerName: "Company", minWidth: 160, flex: 1.4, cellRenderer: trunc, tooltipValueGetter: tip },
      { colId: "contact", headerName: "Contact", minWidth: 180, flex: 1.4, valueGetter: (p) => (p.data ? `${p.data.contactName} ${p.data.contactEmail}`.trim() : ""), cellRenderer: contact, tooltipValueGetter: (p) => p.data && p.data.contactEmail },
      { field: "country", headerName: "Country", minWidth: 110, flex: 0.8, cellRenderer: trunc },
      { field: "awsAccountId", headerName: "AWS account ID", minWidth: 140, flex: 0.9, cellRenderer: trunc },
      { colId: "match", field: "match", headerName: "Status", minWidth: 160, flex: 1, cellRenderer: match, valueFormatter: (p) => MATCH_LABELS[p.value] || "", tooltipValueGetter: (p) => p.data && p.data.how },
      { colId: "tam", headerName: "TAM company", minWidth: 200, flex: 1.4, valueGetter: (p) => (p.data ? p.data.prospectName : ""), cellRenderer: tam, tooltipValueGetter: (p) => p.data && p.data.prospectId ? p.data.how : "" },
      { colId: "lead", headerName: "Lead", width: 120, sortable: false, ...none, cellRenderer: lead },
      { colId: "onboarding", field: "onboarding", headerName: "Onboarding", minWidth: 180, flex: 1, cellRenderer: onboarding, valueFormatter: (p) => ONBOARDING_LABELS[p.value] || "" },
      { colId: "agreement", headerName: "Agreement", minWidth: 170, flex: 1, valueGetter: (p) => (p.data ? p.data.agreementId : ""), cellRenderer: (p) => (p.data.agreementId ? trunc(p) : muted("No agreement yet")),
        tooltipValueGetter: (p) => (p.data && p.data.agreementId ? [p.data.agreementStatus, p.data.startMs ? `from ${fmtDate(p.data.startMs)}` : "", p.data.endMs ? `to ${fmtDate(p.data.endMs)}` : ""].filter(Boolean).join(" ") : "") },
    ];
  }
  function ensureGrid() {
    if (api) return Promise.resolve(api);
    if (gridLoading) return gridLoading;
    const host = $("licences-grid");
    gridLoading = loadAgGrid().then((ag) => {
      if (!ag) { host.innerHTML = '<p class="promote-empty">The grid could not load. Check your connection and reload.</p>'; return null; }
      api = ag.createGrid(host, {
        columnDefs: columns(),
        defaultColDef: { sortable: true, filter: "agTextColumnFilter", floatingFilter: true, resizable: true },
        rowData: rows, getRowId: (p) => String(p.data.id),
        suppressCellFocus: true, suppressColumnVirtualisation: true, tooltipShowDelay: 400,
        headerHeight: 40, floatingFiltersHeight: 40, rowHeight: 42,
        pagination: rows.length > PAGE, paginationPageSize: PAGE, paginationPageSizeSelector: false,
        domLayout: "autoHeight",
        overlayNoRowsTemplate: '<span class="um-empty">No licences match these filters.</span>',
      });
      return api;
    });
    return gridLoading;
  }

  // ── The review queue ──
  function reviewHtml(queue) {
    if (!queue.length) return `<p class="promote-empty licences-review-empty">Nothing to review. Every licence is linked to a TAM company.</p>`;
    const options = prospects.slice().sort((a, b) => a.name.localeCompare(b.name) || String(a.country).localeCompare(String(b.country)))
      .map((p) => `<option value="${esc(p.id)}">${esc(p.name)}${p.country ? ` · ${esc(p.country)}` : ""}</option>`).join("");
    const edit = canEdit();
    return `<ul class="licences-review-list">${queue.map((r) => {
      const who = [r.contactName, r.contactEmail].filter(Boolean).join(" · ") || "No contact on the agreement";
      const facts = [r.country, r.awsAccountId ? `AWS account ${r.awsAccountId}` : "", r.agreementId].filter(Boolean).join(" · ");
      const suggest = r.suggestions.length
        ? `<div class="licences-suggest"><span class="licences-suggest-label">Suggested</span>${r.suggestions.map((s) => edit
          ? `<button type="button" class="btn-ghost licences-suggest-btn" data-editor-only data-link="${esc(r.agreementId)}" data-prospect="${esc(s.prospect.id)}" title="${esc(s.how)}">${esc(s.prospect.name)}${s.prospect.country ? ` · ${esc(s.prospect.country)}` : ""}</button>`
          : `<span class="ace-pill" title="${esc(s.how)}">${esc(s.prospect.name)}${s.prospect.country ? ` · ${esc(s.prospect.country)}` : ""}</span>`).join("")}</div>`
        : "";
      const pick = edit
        ? `<div class="licences-pick" data-editor-only><label class="visually-hidden" for="licences-pick-${esc(r.id)}">TAM company for ${esc(r.company || r.agreementId)}</label>`
          + `<select id="licences-pick-${esc(r.id)}" data-pick="${esc(r.agreementId)}"><option value="">Choose a TAM company</option>${options}</select>`
          + `<button type="button" class="btn-primary" data-link-pick="${esc(r.agreementId)}" data-pick-id="licences-pick-${esc(r.id)}">Link</button></div>`
        : "";
      return `<li class="licences-review-item" data-agreement="${esc(r.agreementId)}">`
        + `<div class="licences-review-head"><span class="licences-review-company">${esc(r.company || "Company not given")}</span><span class="um-status ace-review" data-tone="warn"><span class="ace-dot"></span><span>${esc(r.how)}</span></span></div>`
        + `<div class="licences-review-who">${esc(who)}</div><div class="licences-review-facts">${esc(facts)}</div>`
        + (r.contactsError ? `<div class="licences-review-error">Contacts couldn't be read: ${esc(r.contactsError)}</div>` : "")
        + suggest + pick + `</li>`;
    }).join("")}</ul>`;
  }

  function build() {
    if (built) return;
    built = true;
    $("licences-sync-btn").addEventListener("click", sync);
    const tabs = [...document.querySelectorAll("[data-licences-tab]")];
    const select = (t) => { tab = t; render(); };
    tabs.forEach((b) => {
      b.addEventListener("click", () => select(b.dataset.licencesTab));
      b.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        const next = tabs[(tabs.indexOf(b) + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
        select(next.dataset.licencesTab); next.focus();
      });
    });
    $("licences-review").addEventListener("click", (e) => {
      const s = e.target.closest("[data-link]");
      if (s) { link(s.dataset.link, s.dataset.prospect); return; }
      const p = e.target.closest("[data-link-pick]");
      if (p) {
        const sel = $(p.dataset.pickId);
        if (!sel || !sel.value) { failure = "Choose a TAM company to link to."; notice = ""; render(); return; }
        link(p.dataset.linkPick, sel.value);
      }
    });
  }

  function render() {
    if (!built) return;
    rows = buildRows({ licences, prospects, leads, companies });
    const queue = reviewQueue(rows);
    const s = summary(rows);
    const sv = syncStatusView(syncDoc);
    $("licences-count").innerHTML = `<b>${s.licences}</b> ${s.licences === 1 ? "licence" : "licences"} · <b>${s.linked}</b> linked · <b>${s.review}</b> to review · <b>${s.ready}</b> ready for onboarding`
      + (s.awaiting ? ` · <b>${s.awaiting}</b> won ${s.awaiting === 1 ? "lead" : "leads"} awaiting an agreement` : "");
    $("licences-review-count").textContent = s.review ? `(${s.review})` : "";
    const problem = failure || (sv.state === "error" ? sv.text : "");
    $("licences-alert").hidden = !problem;
    $("licences-alert-text").textContent = problem;
    $("licences-status").textContent = [notice, sv.state === "error" ? "" : `${sv.text}${sv.atMs ? ` Last sync ${fmtTime(sv.atMs)}.` : ""}`].filter(Boolean).join(" ");
    const syncBtn = $("licences-sync-btn");
    syncBtn.disabled = !!busy;
    syncBtn.setAttribute("aria-busy", busy === "sync" ? "true" : "false");
    document.querySelectorAll("[data-licences-tab]").forEach((b) => {
      const on = b.dataset.licencesTab === tab;
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
    });
    const empty = rows.length === 0;
    $("licences-empty").hidden = !(empty && tab === "all");
    $("licences-grid").hidden = tab !== "all" || empty;
    $("licences-review").hidden = tab !== "review";
    if (tab === "review") {
      // Redrawn only when it changes, so a company chosen in a picker survives a data update.
      const html = reviewHtml(queue);
      if (html !== reviewDrawn) { $("licences-review").innerHTML = html; reviewDrawn = html; }
    } else reviewDrawn = "";
    if (tab === "all" && !empty) {
      ensureGrid().then((a) => {
        if (!a) return;
        a.setGridOption("rowData", rows);
        a.setGridOption("pagination", rows.length > PAGE);
        a.refreshCells({ force: true });
      });
    }
  }

  function stop() { unsubs.forEach((u) => u()); unsubs = []; started = false; }
  return { start, stop, render: () => { build(); render(); } };
}
