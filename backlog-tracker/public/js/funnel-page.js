// Promote › Conversion Funnel (#promote/conversion-funnel): ad impression to
// deployed opportunity as one funnel graphic. Rules are in funnel-core.js.
// Reads `funnelDaily` (GA4 + Google Ads, written by the server-side ingest,
// functions/funnel-ingest.js; its "pc-export" rows, from the Partner Central S3
// data export, feed the Revenue stage), the ingest's status (consoleConfig/funnelIngest:
// when the data was last updated, which source failed), `leads`, `prospects`
// and the ACE opportunities (/partnerCentral/v1/ace).
// No explanatory copy on the page: help is in the info tooltips.
import { collection, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { normaliseLead } from "./leads-core.js";
import { normaliseProspect } from "./prospects-core.js";
import {
  EMPTY_FILTER, normaliseWebRow, joinOpportunities, buildFunnel, filterOptions, presetRange, previousRange,
  fmtCount, fmtPct, fmtChange, fmtDay, fmtMoney, ingestStatusView, ingestFailureText, fmtUpdated, ga4AccessLinks,
} from "./funnel-core.js";

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const $ = (id) => document.getElementById(id);

const SELECTS = [
  ["industry", "Industry", "Company industry, from the Prospects (TAM) record, the lead or the ad data."],
  ["channel", "Channel / source", "Where the visit or lead came from. For opportunities this comes from the lead's source."],
  ["campaign", "Campaign", "An ad campaign. For opportunities, a campaign on the company's Prospects (TAM) record."],
  ["adGroup", "Ad group / creative", "Only applies to the ad and website stages: a company-level opportunity has no ad group, so these stages show 0 while it is set."],
  ["company", "Company", "A single Prospects (TAM) company."],
  ["country", "Region / country", "Country of the company or visitor."],
  ["content", "Content touched", "The product tour, calculator or industry page the visitor used."],
];

export function mountFunnelPage({ db, apiHeaders }) {
  let web = [], leads = [], prospects = [], opps = [], ingest = null;
  let aceError = "";
  let filter = { ...EMPTY_FILTER, ...presetRange("30d"), compare: false };
  let unsubs = [], started = false, built = false;

  function start() {
    if (started) return;
    started = true;
    const watch = (name, apply) => unsubs.push(onSnapshot(collection(db, name), (snap) => { apply(snap.docs.map((d) => ({ id: d.id, data: d.data() }))); render(); },
      (err) => console.warn("backlog-tracker: funnel", name, err)));
    watch("funnelDaily", (rows) => { web = rows.map((r) => normaliseWebRow(r.id, r.data)); });
    watch("leads", (rows) => { leads = rows.map((r) => normaliseLead(r.id, r.data)).filter((l) => !l.archived && !l.test); });
    watch("prospects", (rows) => { prospects = rows.map((r) => normaliseProspect(r.id, r.data)); });
    unsubs.push(onSnapshot(doc(db, "consoleConfig", "funnelIngest"), (snap) => { ingest = snap.exists() ? snap.data() : null; render(); },
      (err) => console.warn("backlog-tracker: funnel ingest status", err)));
    loadAce();
  }
  async function loadAce() {
    try {
      const resp = await fetch("/partnerCentral/v1/ace", { method: "GET", headers: await apiHeaders() });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
      opps = Array.isArray(body.opportunities) ? body.opportunities : [];
      aceError = "";
    } catch (err) { opps = []; aceError = `ACE opportunities didn't load: ${err && err.message ? err.message : err}`; }
    render();
  }

  function build() {
    if (built) return;
    built = true;
    const tip = (text) => `<span class="material-symbols-outlined funnel-info" tabindex="0" role="img" aria-label="${esc(text)}" title="${esc(text)}">info</span>`;
    const presets = [["7d", "7 days"], ["30d", "30 days"], ["90d", "90 days"], ["month", "This month"]]
      .map(([k, l]) => `<button type="button" class="btn-ghost funnel-preset" data-preset="${k}">${l}</button>`).join("");
    $("funnel-filters").innerHTML =
      `<div class="funnel-filter funnel-dates"><span class="funnel-filter-label">Date range ${tip("Days are your local calendar days. Compare uses the same number of days straight before.")}</span>`
      + `<div class="funnel-date-row"><input type="date" id="funnel-from" aria-label="From"><span aria-hidden="true">–</span><input type="date" id="funnel-to" aria-label="To"></div>`
      + `<div class="funnel-presets">${presets}</div>`
      + `<label class="funnel-compare"><input type="checkbox" id="funnel-compare"> Compare to previous period</label></div>`
      + SELECTS.map(([k, l, t]) => `<label class="funnel-filter" for="funnel-${k}"><span class="funnel-filter-label">${l} ${tip(t)}</span><select id="funnel-${k}"></select></label>`).join("")
      + `<div class="funnel-filter funnel-reset"><button type="button" class="btn-ghost" id="funnel-reset">Reset filters</button></div>`;
    const on = (id, ev, fn) => $(id).addEventListener(ev, fn);
    on("funnel-from", "change", () => { filter.from = $("funnel-from").value; render(); });
    on("funnel-to", "change", () => { filter.to = $("funnel-to").value; render(); });
    on("funnel-compare", "change", () => { filter.compare = $("funnel-compare").checked; render(); });
    for (const [k] of SELECTS) on(`funnel-${k}`, "change", () => { filter[k] = $(`funnel-${k}`).value; render(); });
    $("funnel-filters").querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", () => { Object.assign(filter, presetRange(b.dataset.preset)); render(); }));
    on("funnel-reset", "click", () => { filter = { ...EMPTY_FILTER, ...presetRange("30d") }; render(); });
    // GA4 access problem: copy the values the fix needs (the row is drawn in renderAccess).
    $("funnel-access").addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-copy]");
      if (b) copyValue(b, b.dataset.copy);
    });
  }

  async function copyValue(btn, value) {
    let ok = false;
    try { await navigator.clipboard.writeText(value); ok = true; } catch {
      const ta = document.createElement("textarea");
      ta.value = value; ta.setAttribute("readonly", ""); ta.style.position = "absolute"; ta.style.left = "-9999px";
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand("copy"); } catch { ok = false; }
      ta.remove();
    }
    const label = btn.querySelector(".funnel-access-label");
    const was = btn.dataset.label;
    label.textContent = ok ? "Copied" : "Copy failed";
    clearTimeout(btn._t);
    btn._t = setTimeout(() => { label.textContent = was; }, 2000);
  }

  // The fix for a GA4 access problem, one click each: copy the service account and
  // the property id, open the property's access management (or the Data API page).
  function renderAccess(ga) {
    const box = $("funnel-access");
    box.hidden = !ga;
    if (!ga) { box.innerHTML = ""; return; }
    const links = ga4AccessLinks(ga);
    const copy = (value, label, tip) => `<button type="button" class="btn-ghost funnel-access-btn" data-copy="${esc(value)}" data-label="${esc(label)}" title="${esc(tip)}">`
      + `<span class="material-symbols-outlined" aria-hidden="true">content_copy</span><span class="funnel-access-label">${esc(label)}</span></button>`;
    const open = (href, label) => `<a class="btn-ghost funnel-access-btn" href="${esc(href)}" target="_blank" rel="noopener noreferrer">`
      + `<span class="material-symbols-outlined" aria-hidden="true">open_in_new</span><span>${esc(label)}</span></a>`;
    box.innerHTML = ga.problem === "api-disabled"
      ? open(links.enableApi, "Enable the Data API")
      : (ga.serviceAccount ? copy(ga.serviceAccount, "Copy service account", ga.serviceAccount) : "")
        + (ga.propertyId ? copy(ga.propertyId, "Copy property ID", `GA4 property ${ga.propertyId}`) : "")
        + copy("Viewer", "Copy role", "Viewer")
        + open(links.propertyAccess, "Open GA4 access management");
  }

  function syncControls(data) {
    $("funnel-from").value = filter.from; $("funnel-to").value = filter.to; $("funnel-compare").checked = filter.compare;
    const opts = filterOptions(data, prospects);
    for (const [k, l] of SELECTS) {
      const sel = $(`funnel-${k}`);
      const list = opts[k].includes(filter[k]) || !filter[k] ? opts[k] : [filter[k], ...opts[k]];
      sel.innerHTML = `<option value="">All</option>` + list.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
      sel.value = filter[k]; sel.setAttribute("aria-label", l);
    }
  }

  function stageHtml(s, i, compare, pc) {
    const cur = s.money ? s.currency : "";
    const shown = (v) => (s.money ? fmtMoney(v, cur) : fmtCount(v));
    const change = s.change
      ? `<span class="funnel-delta ${s.change.count > 0 ? "up" : s.change.count < 0 ? "down" : ""}" title="Previous period: ${esc(shown(s.prev.count))}">${esc(fmtChange(s.change, cur))}${s.change.points == null ? "" : ` · ${s.change.points > 0 ? "+" : s.change.points < 0 ? "−" : ""}${Math.abs(s.change.points).toFixed(1)} pts`}</span>` : "";
    // Revenue is an amount: no % of the stage above or of the top; funding used and the export's state instead.
    const rates = s.money
      ? (pc && pc.notSetUp
        ? `<span class="funnel-rate funnel-rate-top">Not set up yet</span>`
        : `<span class="funnel-rate" title="Partner Central funding used in the period">${esc(fmtMoney(s.fundingUsed, cur))} <small>funding used</small></span>`
          + (pc && pc.exportedAt ? `<span class="funnel-rate funnel-rate-top" title="When Partner Central wrote the export">Export ${esc(fmtUpdated(pc.exportedAt))}</span>` : ""))
      : `<span class="funnel-rate" title="Of the previous stage">${s.fromPrev == null ? "" : `${fmtPct(s.fromPrev)} <small>of previous</small>`}</span>`
        + `<span class="funnel-rate funnel-rate-top" title="Of the top of the funnel">${fmtPct(s.ofTop)} <small>of top</small></span>`;
    return `<li class="funnel-stage${s.money ? " funnel-stage-money" : ""}" data-stage="${s.key}">`
      + `<div class="funnel-stage-name"><span class="material-symbols-outlined" aria-hidden="true">${s.icon}</span><span>${esc(s.label)}</span>`
      + `<span class="material-symbols-outlined funnel-info" tabindex="0" role="img" aria-label="${esc(s.info)}" title="${esc(s.info)}">info</span></div>`
      + `<div class="funnel-bar-wrap"><div class="funnel-bar ${s.money ? "funnel-bar-revenue" : `funnel-bar-${i % 9}`}" style="width:${s.width}%"><b>${esc(shown(s.count))}</b></div></div>`
      + `<div class="funnel-stage-rates">${rates}${compare ? change : ""}</div></li>`;
  }

  function render() {
    if (!built) return;
    const data = { web, ace: joinOpportunities(opps, leads, prospects, web.filter((r) => r.source === "pc-export")) };
    syncControls(data);
    const f = buildFunnel(filter, data);
    const range = filter.from && filter.to ? `${fmtDay(filter.from)} – ${fmtDay(filter.to)}` : "All time";
    const prev = f.prevRange ? ` vs ${fmtDay(f.prevRange.from)} – ${fmtDay(f.prevRange.to)}` : filter.compare && !previousRange(filter.from, filter.to) ? " (set both dates to compare)" : "";
    const iv = ingestStatusView(ingest);
    const updated = iv.known ? ` · Updated ${fmtUpdated(iv.updatedAt)}` : "";
    const deployed = f.stages.find((s) => s.key === "deployed"), revenue = f.stages.find((s) => s.key === "revenue");
    const money = f.hasExportData ? ` · <b>${esc(fmtMoney(revenue.count, revenue.currency))}</b> revenue` : "";
    $("funnel-count").innerHTML = `<b>${fmtCount(f.stages[0].count)}</b> impressions · <b>${fmtCount(deployed.count)}</b> deployed${money} · ${esc(range)}${esc(prev)}${esc(updated)}`;
    const notes = [];
    if (iv.flagged) notes.push(ingestFailureText(iv));
    if (aceError) notes.push(aceError);
    if (!f.hasWebData && !f.empty) notes.push("No Google Ads or GA4 rows match these filters, so the first five stages are 0.");
    $("funnel-status").textContent = notes.join(" ");
    $("funnel-status").hidden = notes.length === 0;
    $("funnel-status").classList.toggle("funnel-status-flag", iv.flagged);
    renderAccess(iv.flagged ? iv.ga4Access : null);
    $("funnel-empty").hidden = !f.empty;
    $("funnel-empty-text").textContent = !web.length && !opps.length ? "No funnel data yet." : "Nothing matches these filters.";
    const list = $("funnel-stages");
    list.hidden = f.empty;
    list.innerHTML = f.empty ? "" : f.stages.map((s, i) => stageHtml(s, i, !!f.prevRange, iv.pcExport)).join("");
  }

  function stop() { unsubs.forEach((u) => u()); unsubs = []; started = false; }
  return { start, stop, render: () => { build(); render(); } };
}
