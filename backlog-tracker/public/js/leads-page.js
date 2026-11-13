// Promote › Leads (#promote/leads): the board and the lead form.
//
// One card per company in `leads/{id}`; the lanes are leads-core.js STAGES (FRANCHISE_STAGES for franchise opportunities).
// A tile drags between lanes (HTML5 drag and drop); clicking it (or Enter)
// opens the lead summary drawer, whose stage select moves it without a pointer
// drag, which is how it moves on a tablet. Tiles are coloured by industry
// (industry-palette.js), shown as a small dot beside the industry; everything
// else is neutral with one accent (the Apple-style rules in css/apple.css). The
// page, the detail view and the form are built from the shared grouped cards
// and rows in ap-components.js. A write is live for everyone at once through onSnapshot. The
// Enrich / Refresh info button queues a run at /leadEnrich/v1/enrich
// (functions/lead-enrich.js): an agent researches the company on the web and the
// findings (logo, facts, news, financials) arrive through the same snapshot.
// A new lead is enriched by itself when it is created.
// New lead is matched to Prospects (TAM) like a website lead (prospects-core.js
// planInbound): a second person from the same company and country joins that
// company's lead, and anyone from AWS goes to the AWS tile, from which an editor
// attaches them to a customer account's AWS team (prospectCompanies awsTeam).
// Franchise opportunities (leadType "franchise", from the Franchise page's
// product tour gate) are people, not companies: the Companies / Franchise
// opportunities switch shows one pipeline at a time, each with its own lanes,
// and a franchise lead is never matched to Prospects (TAM) or researched.
import {
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import {
  BUYING_ROLES, normaliseLead, groupByStage, leadFromForm, blankContact, stageLabel, roleLabel,
  companyLine, conversionFields, isStageFor, mergeInbound, inboundLabel,
  stagesFor, defaultStageFor, leadName, leadTypeLabel, BACKGROUNDS, backgroundLabel,
} from "./leads-core.js";
import { normaliseProspect, planInbound, awsContactFrom, mergeContact, isAwsProspect, companyKey, AWS_PROSPECT_ID } from "./prospects-core.js";
import { kpis, formatMonthly } from "./ace-core.js";
import { mountAceGrid } from "./ace-grid.js";
import { mountAceDetail } from "./ace-detail.js";
import { normaliseDetail, compactSummary, mailto, companyDocId, COMPANY_COLLECTION, AWS_ROLES, withAwsPerson, detailForSave, awsTeamWithAce, awsRoleLabel } from "./prospect-detail-core.js";
import { leadIndustryEntry, industryChipText, industryStyle } from "./industry-palette.js";
import { researchGroupsHTML, enrichmentRunning, enrichmentSkipped, enrichButtonLabel, enrichmentStatus, logoHTML, wireLogoFallback } from "./enrichment-view.js";
import { group, row, stackRow, lineRow, iconLink, pill, tip } from "./ap-components.js";

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
// Addresses come from Firestore, which an agent can write: http(s) only.
const safeUrl = (u) => { try { const x = new URL(String(u)); return x.protocol === "https:" || x.protocol === "http:" ? x.href : ""; } catch { return ""; } };
const $ = (id) => document.getElementById(id);

export function mountLeadsPage({ db, auth, canEdit, apiHeaders }) {
  const page = $("leads-page");
  const board = $("leads-board");
  const backdrop = $("lead-backdrop");
  let leads = [];
  let allLeads = []; // archived included: a company's archived lead is still its lead
  let members = [];
  let unsub = null;
  let unsubAws = null;
  let openId = null;          // the lead in the form, null for a new one
  let draft = { contacts: [] }; // contact rows held in memory while the form is open
  let started = false;
  // Which pipeline the board shows: "company" or "franchise" (kept per browser).
  let view = "company";
  try { if (localStorage.getItem("bt-leads-type") === "franchise") view = "franchise"; } catch { /* storage blocked */ }
  let formType = "company"; // the type of the lead in the form
  const isFranchise = (l) => !!l && l.leadType === "franchise";
  const detailCache = new Map(); // companyDocId -> the company's shared detail (org chart, AWS team), read once

  const me = () => String((auth.currentUser && auth.currentUser.email) || "").toLowerCase();
  const memberName = (email) => {
    const m = members.find((x) => x.email === email);
    return (m && (m.displayName || m.name)) || email;
  };

  function start() {
    if (started) return;
    started = true;
    unsub = onSnapshot(collection(db, "leads"), (snap) => {
      allLeads = snap.docs.map((d) => normaliseLead(d.id, d.data({ serverTimestamps: "estimate" })));
      leads = allLeads.filter((l) => !l.archived);
      render();
      loadDetails();
    }, () => { board.innerHTML = ""; showBoardError("Leads could not be loaded. Reload the page to try again."); });
    getDocs(collection(db, "memberDirectory")).then((snap) => {
      members = snap.docs.map((d) => ({ email: d.id, ...d.data() })).filter((m) => !m.disabled);
      fillAssignees(); render();
    }).catch(() => {});
    unsubAws = onSnapshot(doc(db, "prospects", AWS_PROSPECT_ID), (s) => {
      awsRecord = s.exists() ? normaliseProspect(s.id, s.data()) : null;
      renderAws();
    }, () => {});
    fillStages();
    loadAce();
  }
  function stop() { if (unsub) unsub(); if (unsubAws) unsubAws(); unsub = null; unsubAws = null; started = false; }

  // The compact org chart and AWS team on a card come from the company's shared detail (prospectCompanies).
  function loadDetails() {
    for (const l of leads) {
      if (isFranchise(l)) continue;
      const key = companyDocId(l.company.name);
      if (!key || detailCache.has(key)) continue;
      detailCache.set(key, null);
      getDoc(doc(db, COMPANY_COLLECTION, key)).then((s) => { if (s.exists()) { detailCache.set(key, normaliseDetail(s.data())); render(); } }).catch(() => {});
    }
  }
  function compactHTML(l) {
    const d = detailCache.get(companyDocId(l.company.name));
    if (!d) return "";
    const c = compactSummary(d, l);
    if (c.empty) return "";
    const aws = c.aws.map((m) => m.name).join(", ") + (c.awsMore ? ` +${c.awsMore}` : "");
    return `<div class="lead-card-detail">
      ${c.peopleCount ? `<p class="lead-card-roles" title="Org chart: ${c.peopleCount} ${c.peopleCount === 1 ? "person" : "people"}">${c.roles.map((r) => `<span class="pd-role pd-role-${esc(r.key)}">${esc(r.label)} ${r.count}</span>`).join("")}</p>` : ""}
      ${c.gaps.length ? `<p class="lead-card-gap" title="${esc(c.gaps.join(" "))}"><span class="material-symbols-outlined" aria-hidden="true">warning</span><span>${esc(c.gaps[0])}</span></p>` : ""}
      ${c.aws.length ? `<p class="lead-card-aws" title="AWS team: ${esc(c.aws.map((m) => `${m.name} (${m.role})`).join(", "))}"><span class="material-symbols-outlined" aria-hidden="true">cloud</span><span class="visually-hidden">AWS team:</span><span>${esc(aws)}</span></p>` : ""}
    </div>`;
  }
  // The account's AWS team (the company's shared detail), for the detail view.
  function awsTeamOf(l) {
    const d = detailCache.get(companyDocId(l.company.name));
    return d ? awsTeamWithAce(d.awsTeam, d.aceOpportunity) : [];
  }

  // ── The AWS tile: people from AWS (contacts on the AWS TAM record) ──────
  // They never become customer leads. An editor attaches one to a customer
  // company (a TAM record or a lead: both share the company's detail) as part
  // of that account's AWS team.
  let awsRecord = null;
  let awsOpen = false;
  let attachAt = -1;        // the contact whose Attach form is open
  let awsCompanies = null;  // [{ key, name }] customer companies, read when a form opens
  async function loadAwsCompanies() {
    const byKey = new Map();
    const add = (name) => { const k = companyDocId(name); if (k && !AWS_KEYS.has(companyKey(name)) && !byKey.has(k)) byKey.set(k, { key: k, name }); };
    try { (await getDocs(collection(db, "prospects"))).docs.forEach((d) => { const p = normaliseProspect(d.id, d.data()); if (!isAwsProspect(p)) add(p.name); }); } catch { /* leads alone */ }
    for (const l of leads) if (!l.test) add(l.company.name);
    awsCompanies = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  const AWS_KEYS = new Set(["aws", "amazonwebservices"]);
  function renderAws() {
    const box = $("leads-aws");
    if (!box) return;
    const people = awsRecord ? awsRecord.contacts : [];
    box.hidden = !people.length;
    if (!people.length) { box.innerHTML = ""; return; }
    const keepStatus = ($("leads-aws-status") || {}).textContent || "";
    const form = (i) => `<div class="leads-aws-form" data-index="${i}">
        <label class="ap-row ap-field"><span class="ap-row-label">Customer account</span><select class="leads-aws-company" aria-label="Customer account">${awsCompanies
          ? `<option value="">Choose a company</option>${awsCompanies.map((c) => `<option value="${esc(c.key)}">${esc(c.name)}</option>`).join("")}`
          : '<option value="">Loading…</option>'}</select></label>
        <label class="ap-row ap-field"><span class="ap-row-label">AWS role</span><select class="leads-aws-role" aria-label="AWS role">${AWS_ROLES.map((r) => `<option value="${esc(r.key)}">${esc(r.label)}</option>`).join("")}</select></label>
        <div class="ap-row leads-aws-actions"><button type="button" class="btn-ghost leads-aws-cancel">Cancel</button><button type="button" class="btn-ghost ap-accent-btn leads-aws-save">Attach</button></div>
      </div>`;
    const person = (c, i) => `<li class="leads-aws-person">${stackRow(`<p class="lead-sum-contact-name">${esc(c.name)}</p>
          ${c.role ? `<p class="ap-row-sub">${esc(c.role)}</p>` : ""}
          ${c.email ? `<p class="ap-row-sub">${esc(c.email)}</p>` : ""}
          ${c.lastContact ? `<p class="ap-row-sub">Came in ${esc(c.lastContact)}</p>` : ""}`,
        `${iconLink(c.email ? `mailto:${c.email}` : "", "mail", `Email ${c.name}`)}${attachAt === i ? "" : `<button type="button" class="btn-ghost ap-accent-btn leads-aws-attach" data-index="${i}" data-editor-only>Attach to account</button>`}`)}
        ${attachAt === i ? form(i) : ""}</li>`;
    box.innerHTML = `<div class="ap-group"><button type="button" class="ap-row ap-row-btn ap-disclosure leads-aws-head" id="leads-aws-toggle" aria-expanded="${awsOpen}" aria-controls="leads-aws-list">
        <span class="material-symbols-outlined" aria-hidden="true">cloud</span><span class="leads-aws-title">AWS</span>
        <span class="ap-pill lead-lane-count" title="People from AWS">${people.length}</span>
        <span class="material-symbols-outlined leads-aws-chevron" aria-hidden="true">${awsOpen ? "expand_less" : "expand_more"}</span>
      </button>
      <ul class="leads-aws-list" id="leads-aws-list"${awsOpen ? "" : " hidden"}>${people.map(person).join("")}</ul></div>
      <p class="ap-status leads-aws-status" id="leads-aws-status" role="status" aria-live="polite">${esc(keepStatus)}</p>`;
    box.querySelectorAll("[data-editor-only]").forEach((el) => { el.hidden = !canEdit(); });
  }
  async function attachAws(i, key, role) {
    const person = awsRecord && awsRecord.contacts[i];
    const company = (awsCompanies || []).find((c) => c.key === key);
    if (!person || !company || !canEdit()) return;
    const say = (t) => { const st = $("leads-aws-status"); if (st) st.textContent = t; };
    try {
      const ref = doc(db, COMPANY_COLLECTION, key);
      const snap = await getDoc(ref);
      const d = normaliseDetail(snap.exists() ? snap.data() : {});
      const r = withAwsPerson(d.awsTeam, person, role);
      if (r.error) { say(r.error); return; }
      await setDoc(ref, { name: snap.exists() && snap.data().name ? snap.data().name : company.name, ...detailForSave({ ...d, awsTeam: r.team }), updatedAt: serverTimestamp(), updatedByEmail: me() });
      detailCache.delete(key); attachAt = -1;
      renderAws();
      say(`${person.name} ${r.added ? "attached to" : "updated on"} ${company.name}'s AWS team.`);
      loadDetails();
    } catch (err) { say(`Couldn't attach: ${err && err.message ? err.message : err}`); }
  }
  $("leads-aws").addEventListener("click", async (e) => {
    const t = e.target.closest ? e.target : null;
    if (!t) return;
    if (t.closest("#leads-aws-toggle")) { awsOpen = !awsOpen; if (!awsOpen) attachAt = -1; renderAws(); return; }
    const open = t.closest(".leads-aws-attach");
    if (open && canEdit()) {
      attachAt = Number(open.dataset.index); renderAws();
      if (!awsCompanies) { await loadAwsCompanies(); renderAws(); }
      const sel = $("leads-aws").querySelector(".leads-aws-company"); if (sel) sel.focus();
      return;
    }
    if (t.closest(".leads-aws-cancel")) { attachAt = -1; renderAws(); return; }
    const save = t.closest(".leads-aws-save");
    if (save) {
      const f = save.closest(".leads-aws-form");
      const key = f.querySelector(".leads-aws-company").value;
      if (!key) { const st = $("leads-aws-status"); if (st) st.textContent = "Choose the customer account first."; return; }
      save.disabled = true;
      await attachAws(Number(f.dataset.index), key, f.querySelector(".leads-aws-role").value);
      save.disabled = false;
    }
  });

  // ── The board ───────────────────────────────────────────────────────────
  const initials = (nameOrEmail) => {
    const base = String(nameOrEmail || "").split("@")[0];
    const parts = base.split(/[\s._-]+/).filter(Boolean);
    return ((parts[0] || "?")[0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  };
  const isWebsite = (l) => /^web/i.test(l.source);
  const sourceLabel = (l) => (isWebsite(l) ? "Website" : (l.source && l.source.toLowerCase() !== "manual" ? l.source : "Manual"));
  const chipHTML = (l) => `<span class="lead-chip" title="${esc(industryChipText(l))}"><span class="lead-ind-dot" aria-hidden="true"></span>${esc(industryChipText(l))}</span>`;
  const typeChipHTML = (l) => (isFranchise(l) ? `<span class="lead-chip lead-type-chip">${esc(leadTypeLabel(l.leadType))}</span>` : "");
  const sourceText = (l) => (l.sourceLabel ? l.sourceLabel + (l.sourceDetail ? " · " + l.sourceDetail : "") : sourceLabel(l));
  // A franchise opportunity's tile: the person, their lead type, where they plan to operate and their background.
  function franchiseCardHTML(l) {
    const line = companyLine(l);
    const who = l.assignee ? memberName(l.assignee) : "";
    const name = leadName(l);
    return `<article class="lead-card lead-card-franchise" draggable="${canEdit() ? "true" : "false"}" data-lead-id="${esc(l.id)}" data-lead-type="franchise" tabindex="0" role="button" aria-label="${esc(name)}, franchise opportunity, open lead summary">
      <div class="lead-card-top">${logoHTML(null, name, "lead-logo")}<h4 class="lead-card-name">${esc(name)}</h4></div>
      <div class="lead-card-chips">${typeChipHTML(l)}${l.inboundCount > 1 ? `<span class="lead-inbound" title="Submissions from this person">${esc(inboundLabel(l))}</span>` : ""}${l.test ? '<span class="lead-test-badge">Test</span>' : ""}</div>
      ${line ? `<p class="lead-card-line">${esc(line)}</p>` : ""}
      <div class="lead-card-foot">
        <span class="lead-card-who" title="${esc(who || "Unassigned")}">${who ? `<span class="lead-avatar" aria-hidden="true">${esc(initials(who))}</span><span class="visually-hidden">${esc(who)}</span>` : "Unassigned"}</span>
        <span class="lead-card-source" title="${esc(sourceText(l))}"><span class="material-symbols-outlined" aria-hidden="true">${isWebsite(l) ? "public" : "edit"}</span>${esc(isWebsite(l) ? "Website" : sourceLabel(l))}</span>
      </div>
    </article>`;
  }
  function cardHTML(l) {
    if (isFranchise(l)) return franchiseCardHTML(l);
    const line = companyLine(l);
    const entry = leadIndustryEntry(l);
    const who = l.assignee ? memberName(l.assignee) : "";
    return `<article class="lead-card" draggable="${canEdit() ? "true" : "false"}" data-lead-id="${esc(l.id)}" data-industry="${esc(entry.key)}" style="${industryStyle(entry)}" tabindex="0" role="button" aria-label="${esc(l.company.name)}, open lead summary">
      <div class="lead-card-top">${logoHTML(l.enrichment, l.company.name, "lead-logo")}<h4 class="lead-card-name">${esc(l.company.name)}</h4></div>
      <div class="lead-card-chips">${chipHTML(l)}${l.inboundCount ? `<span class="lead-inbound" title="Inbound contacts and submissions from this company">${esc(inboundLabel(l))}</span>` : ""}${l.test ? '<span class="lead-test-badge">Test</span>' : ""}</div>
      ${line ? `<p class="lead-card-line">${esc(line)}</p>` : ""}
      ${compactHTML(l)}
      <div class="lead-card-foot">
        <span class="lead-card-who" title="${esc(who || "Unassigned")}">${who ? `<span class="lead-avatar" aria-hidden="true">${esc(initials(who))}</span><span class="visually-hidden">${esc(who)}</span>` : "Unassigned"}</span>
        <span class="lead-card-source" title="${esc(sourceLabel(l))}"><span class="material-symbols-outlined" aria-hidden="true">${isWebsite(l) ? "public" : "edit"}</span>${esc(sourceLabel(l))}</span>
      </div>
    </article>`;
  }

  function renderTypeSwitch() {
    for (const t of ["company", "franchise"]) {
      const tab = $(`leads-type-${t}`);
      tab.setAttribute("aria-selected", String(view === t));
      tab.classList.toggle("active", view === t);
      const n = leads.filter((l) => (l.leadType === t)).length;
      $(`leads-type-${t}-count`).textContent = n ? String(n) : "";
    }
  }
  function render() {
    if (page.hidden) return;
    renderTypeSwitch();
    const shown = leads.filter((l) => l.leadType === view);
    const lanes = groupByStage(shown, view);
    $("leads-empty-text").textContent = view === "franchise" ? "No franchise opportunities yet" : "No leads yet";
    $("leads-empty-add").hidden = !canEdit();
    $("leads-empty").hidden = shown.length > 0;
    board.dataset.leadType = view;
    board.innerHTML = stagesFor(view).map((s) => `<section class="lead-lane lead-lane-${s.key}" data-stage="${s.key}" aria-label="${esc(s.label)}">
      <header class="lead-lane-head"><h3>${esc(s.label)}</h3><span class="lead-lane-count">${lanes[s.key].length}</span></header>
      <div class="lead-lane-body">${lanes[s.key].map(cardHTML).join("")}</div>
    </section>`).join("");
    wireLogoFallback(board, "lead-logo");
    if (summaryId) renderSummary();
    if (openId && !backdrop.hidden) { const open = leads.find((x) => x.id === openId); if (open) renderEnrichment(open); }
    if (aceRows) renderAce();
  }
  $("leads-type").addEventListener("click", (e) => {
    const tab = e.target.closest && e.target.closest("[data-lead-type]");
    if (!tab || tab.dataset.leadType === view) return;
    view = tab.dataset.leadType === "franchise" ? "franchise" : "company";
    try { localStorage.setItem("bt-leads-type", view); } catch { /* storage blocked */ }
    render();
  });

  async function moveTo(id, stage) {
    const l = leads.find((x) => x.id === id);
    if (!l || !isStageFor(l.leadType, stage) || l.stage === stage || !canEdit()) return;
    l.stage = stage; render(); // optimistic; the snapshot confirms or corrects it
    try {
      await updateDoc(doc(db, "leads", id), { stage, stageChangedAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedByEmail: me() });
    } catch (err) {
      showBoardError(`Couldn't move ${leadName(l)}: ${err && err.message ? err.message : err}`);
    }
  }
  function showBoardError(msg) { $("leads-empty-text").textContent = msg; $("leads-empty-add").hidden = true; $("leads-empty").hidden = false; }

  board.addEventListener("dragstart", (e) => {
    const card = e.target.closest && e.target.closest(".lead-card");
    if (!card || !canEdit()) { e.preventDefault(); return; }
    e.dataTransfer.setData("text/plain", card.dataset.leadId);
    e.dataTransfer.effectAllowed = "move";
    card.classList.add("lead-dragging");
  });
  board.addEventListener("dragend", () => {
    board.querySelectorAll(".lead-dragging").forEach((c) => c.classList.remove("lead-dragging"));
    board.querySelectorAll(".lead-drop-target").forEach((c) => c.classList.remove("lead-drop-target"));
  });
  board.addEventListener("dragover", (e) => {
    const lane = e.target.closest && e.target.closest(".lead-lane");
    if (!lane || !canEdit()) return;
    e.preventDefault();
    board.querySelectorAll(".lead-drop-target").forEach((c) => { if (c !== lane) c.classList.remove("lead-drop-target"); });
    lane.classList.add("lead-drop-target");
  });
  board.addEventListener("drop", (e) => {
    const lane = e.target.closest && e.target.closest(".lead-lane");
    if (!lane) return;
    e.preventDefault();
    lane.classList.remove("lead-drop-target");
    const id = e.dataTransfer.getData("text/plain");
    if (id) moveTo(id, lane.dataset.stage);
  });
  board.addEventListener("click", (e) => {
    const card = e.target.closest && e.target.closest(".lead-card");
    if (card) openSummary(card.dataset.leadId);
  });
  board.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest && e.target.closest(".lead-card");
    if (card && e.target === card) { e.preventDefault(); openSummary(card.dataset.leadId); }
  });

  // ── The lead summary (click-through drawer) ─────────────────────────────
  const sumBackdrop = $("lead-summary-backdrop");
  let summaryId = null;
  const fmtDate = (ms) => (ms ? new Date(ms).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "");
  const linkOf = (u, text) => { const h = safeUrl(u); return h ? `<a href="${esc(h)}" target="_blank" rel="noopener noreferrer">${esc(text || u)}</a>` : esc(text || u); };
  const pageLink = (l) => {
    if (!l.sourcePage) return "";
    const h = safeUrl(l.sourcePage) || (l.sourcePage.startsWith("/") && l.company.website ? safeUrl(new URL(l.sourcePage, l.company.website).href) : "");
    return h ? linkOf(h, l.sourcePage) : esc(l.sourcePage);
  };
  function tamHTML(l) {
    const t = l.tam;
    const entries = t ? Object.entries(t).filter(([, v]) => v != null && typeof v !== "object" && String(v) !== "") : [];
    if (!entries.length) return ""; // hidden until a TAM record is linked
    return group("TAM record", entries.map(([k, v]) => row(k, esc(v))).join(""), { id: "lead-sum-tam" });
  }
  function prospectHTML(l) {
    if (!l.prospectId) return "";
    return group("Prospect record", row("From", '<a href="#promote/prospects">Prospects (TAM)</a>'), { id: "lead-sum-prospect" });
  }
  function historyHTML(l) {
    if (!l.history.length) return "";
    return group("Notes and history", [...l.history].reverse().map((h) => stackRow(`<p class="ap-row-text">${esc(h.text)}</p><p class="ap-row-sub">${esc([h.atMs ? fmtDate(h.atMs) : "", h.by ? memberName(h.by) : ""].filter(Boolean).join(" · "))}</p>`)).join(""), { id: "lead-sum-history" });
  }
  // Contacts first, with the company's inbound count beside the title.
  function contactsHTML(l) {
    const rows = l.contacts.map((c) => stackRow(
      `<p class="lead-sum-contact-name">${esc(c.name)}${c.buyingRole ? ` ${pill(roleLabel(c.buyingRole), "lead-sum-role")}` : ""}</p>
        ${c.jobTitle ? `<p class="ap-row-sub">${esc(c.jobTitle)}</p>` : ""}
        ${c.email ? `<p class="ap-row-sub">${esc(c.email)}</p>` : ""}
        ${c.awsAccountId ? `<p class="ap-row-sub">AWS account ${esc(c.awsAccountId)}</p>` : ""}`,
      iconLink(c.email ? `mailto:${c.email}` : "", "mail", `Email ${c.name}`) + iconLink(safeUrl(c.linkedin), "open_in_new", `${c.name} on LinkedIn`, true),
      "lead-sum-contact")).join("");
    const empty = lineRow("No contacts yet") + (canEdit() ? '<button type="button" class="ap-row-btn" id="lead-sum-add-contact"><span class="material-symbols-outlined" aria-hidden="true">add</span>Add contact</button>' : "");
    const inbound = l.inboundCount ? `<span class="lead-inbound">${esc(inboundLabel(l))}</span>${tip("Inbound contacts and submissions from this company and country", "About inbound")}` : "";
    return group("Contacts", rows || empty, { id: "lead-sum-contacts", aside: inbound });
  }
  function awsHTML(l) {
    const team = awsTeamOf(l);
    const rows = team.map((m) => stackRow(
      `<p class="lead-sum-contact-name">${esc(m.name)}</p><p class="ap-row-sub">${esc(awsRoleLabel(m.role))}${m.dealRole ? ` · ${esc(m.dealRole)}` : ""}</p>`,
      iconLink(mailto(m.email, `${l.company.name} opportunity`), "mail", `Email ${m.name}`))).join("");
    return group("AWS team", rows || lineRow("No AWS team yet"), { id: "lead-sum-aws" });
  }
  // A franchise opportunity's summary: the person, their details, the pipeline, website activity and history.
  function renderFranchiseSummary(l) {
    const stageOptions = stagesFor(l.leadType).map((s) => `<option value="${s.key}"${s.key === l.stage ? " selected" : ""}>${esc(s.label)}</option>`).join("");
    const f = l.franchise || {};
    const name = leadName(l);
    $("lead-sum-title").textContent = name;
    $("lead-sum-sub").textContent = companyLine(l);
    $("lead-sum-logo").innerHTML = logoHTML(null, name);
    const panel = $("lead-summary-panel");
    panel.style.cssText = ""; panel.dataset.industry = ""; panel.dataset.leadType = "franchise";
    $("lead-sum-badges").innerHTML = `${typeChipHTML(l)}${l.test ? '<span class="lead-test-badge">Test</span>' : ""}`;
    const keepStage = document.activeElement && document.activeElement.id === "lead-sum-stage";
    $("lead-sum-body").innerHTML = `
      ${contactsHTML(l)}
      ${group("Franchise opportunity", [
        row("Where they plan to operate", esc(f.region || "")),
        row("Background", esc(backgroundLabel(f.background))),
      ].join(""), { id: "lead-sum-franchise" })}
      ${group("Lead", [
        row("Type", esc(leadTypeLabel(l.leadType))),
        row("Stage", `<select id="lead-sum-stage" class="lead-sum-stage" aria-label="Stage" data-editor-only>${stageOptions}</select><span class="lead-sum-stage-ro">${esc(stageLabel(l.stage))}</span>`),
        row("Assignee", esc(l.assignee ? memberName(l.assignee) : "Unassigned")),
        row("Source", esc(sourceText(l))),
        row("Source page", pageLink(l)),
        row("Created", esc(fmtDate(l.createdAtMs))),
        row("Updated", esc(fmtDate(l.updatedAtMs))),
      ].join(""), { id: "lead-sum-lead" })}
      ${l.websiteActivity.length ? group("Website activity", [...l.websiteActivity].reverse().map((a) => stackRow(`<p class="ap-row-text">${esc(a.label || "Website form")}${a.detail ? ` · ${esc(a.detail)}` : ""}</p><p class="ap-row-sub">${esc(a.atMs ? fmtDate(a.atMs) : "")}</p>`)).join(""), { id: "lead-sum-activity" }) : ""}
      ${historyHTML(l)}`;
    $("lead-sum-delete").hidden = !canEdit();
    $("lead-sum-enrich").hidden = true; // a person, not a company: nothing to research
    $("lead-sum-status").textContent = "";
    if (keepStage) $("lead-sum-stage").focus();
  }
  function renderSummary() {
    const l = leads.find((x) => x.id === summaryId);
    if (!l) { closeSummary(); return; }
    if (isFranchise(l)) { renderFranchiseSummary(l); return; }
    $("lead-sum-enrich").hidden = !canEdit();
    $("lead-summary-panel").dataset.leadType = "company";
    const entry = leadIndustryEntry(l);
    const e = l.enrichment;
    const stageOptions = stagesFor(l.leadType).map((s) => `<option value="${s.key}"${s.key === l.stage ? " selected" : ""}>${esc(s.label)}</option>`).join("");
    $("lead-sum-title").textContent = l.company.name;
    $("lead-sum-sub").textContent = companyLine(l);
    $("lead-sum-logo").innerHTML = logoHTML(e, l.company.name);
    wireLogoFallback($("lead-sum-logo"));
    const panel = $("lead-summary-panel");
    panel.style.cssText = industryStyle(entry);
    panel.dataset.industry = entry.key;
    $("lead-sum-badges").innerHTML = `${chipHTML(l)}${l.test ? '<span class="lead-test-badge">Test</span>' : ""}`;
    const keepStage = document.activeElement && document.activeElement.id === "lead-sum-stage";
    $("lead-sum-body").innerHTML = `
      ${contactsHTML(l)}
      ${awsHTML(l)}
      <div id="lead-sum-research">${researchGroupsHTML(e)}</div>
      ${group("Lead", [
        row("Stage", `<select id="lead-sum-stage" class="lead-sum-stage" aria-label="Stage" data-editor-only>${stageOptions}</select><span class="lead-sum-stage-ro">${esc(stageLabel(l.stage))}</span>`),
        row("Assignee", esc(l.assignee ? memberName(l.assignee) : "Unassigned")),
        row("Inbound", esc(inboundLabel(l))),
        row("Source", esc(sourceText(l))),
        row("Source page", pageLink(l)),
        row("Source industry", esc(l.sourceIndustry)),
        row("Created", esc(fmtDate(l.createdAtMs))),
        row("Updated", esc(fmtDate(l.updatedAtMs))),
        row("Customer account", l.customerAccount ? esc(l.customerAccount.name || l.customerAccount.id) + (l.customerAccount.id && l.customerAccount.name ? ` (${esc(l.customerAccount.id)})` : "") : ""),
      ].join(""), { id: "lead-sum-lead" })}
      ${group("Company", [
        row("Name", esc(l.company.name)),
        row("Website", l.company.website ? linkOf(l.company.website) : ""),
        row("Industry", l.company.industry ? esc(l.company.industry) : ""),
        row("Countries", l.company.countries.length ? esc(l.company.countries.join(", ")) : ""),
        row("AWS account ID", esc(l.company.awsAccountId || "")),
        row("Stores", l.company.storeCount != null ? esc(l.company.storeCount.toLocaleString("en-GB")) : ""),
      ].join(""), { id: "lead-sum-company" })}
      ${tamHTML(l)}
      ${prospectHTML(l)}
      ${l.websiteActivity.length ? group("Website activity", [...l.websiteActivity].reverse().map((a) => stackRow(`<p class="ap-row-text">${esc(a.label || "Website form")}${a.detail ? ` · ${esc(a.detail)}` : ""}</p><p class="ap-row-sub">${esc(a.atMs ? fmtDate(a.atMs) : "")}</p>`)).join(""), { id: "lead-sum-activity" }) : ""}
      ${historyHTML(l)}`;
    $("lead-sum-delete").hidden = !canEdit();
    setEnrichButton($("lead-sum-enrich"), e);
    const sumStatus = enrichmentStatus(e);
    if (sumStatus || enrichStatusShown.summary) { $("lead-sum-status").textContent = sumStatus; enrichStatusShown.summary = !!sumStatus; }
    wireLogoFallback($("lead-sum-body"));
    if (keepStage) $("lead-sum-stage").focus();
  }
  function openSummary(id) {
    if (!leads.some((x) => x.id === id)) return;
    summaryId = id;
    $("lead-sum-status").textContent = "";
    renderSummary();
    sumBackdrop.hidden = false;
    $("lead-sum-close").focus();
  }
  function closeSummary(restoreFocus = true) {
    const id = summaryId;
    summaryId = null; sumBackdrop.hidden = true;
    if (restoreFocus && id) { const t = board.querySelector(`.lead-card[data-lead-id="${CSS.escape(id)}"]`); if (t) t.focus(); }
  }
  $("lead-sum-close").addEventListener("click", () => closeSummary());
  sumBackdrop.addEventListener("mousedown", (e) => { if (e.target === sumBackdrop) closeSummary(); });
  sumBackdrop.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.stopPropagation(); closeSummary(); return; }
    if (e.key !== "Tab") return; // keep focus inside the drawer
    const f = [...$("lead-summary-panel").querySelectorAll("button, a[href], select, [tabindex]:not([tabindex='-1'])")].filter((x) => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  });
  $("lead-sum-body").addEventListener("click", (e) => {
    if (!e.target.closest || !e.target.closest("#lead-sum-add-contact") || !summaryId) return;
    const id = summaryId; closeSummary(false); openLead(id);
  });
  $("lead-sum-body").addEventListener("change", (e) => {
    const sel = e.target.closest && e.target.closest("#lead-sum-stage");
    if (sel && summaryId) moveTo(summaryId, sel.value);
  });
  $("lead-sum-edit").addEventListener("click", () => { const id = summaryId; closeSummary(false); openLead(id); });
  $("lead-sum-delete").addEventListener("click", async () => {
    const l = leads.find((x) => x.id === summaryId);
    if (!l || !canEdit()) return;
    const btn = $("lead-sum-delete");
    if (!btn.dataset.armed) { // a second click confirms, in the page (no native dialog)
      btn.dataset.armed = "1"; btn.textContent = "Click again to delete";
      setTimeout(() => { delete btn.dataset.armed; btn.textContent = "Delete lead"; }, 6000);
      return;
    }
    delete btn.dataset.armed; btn.textContent = "Delete lead";
    try { await deleteDoc(doc(db, "leads", l.id)); closeSummary(false); } catch (err) { $("lead-sum-status").textContent = `Couldn't delete: ${err && err.message ? err.message : err}`; }
  });
  $("lead-sum-enrich").addEventListener("click", async () => {
    if (!canEdit() || !summaryId) return;
    const btn = $("lead-sum-enrich"); const status = $("lead-sum-status");
    btn.disabled = true; status.textContent = "Starting the research…";
    try { const r = await runEnrich(summaryId); status.textContent = r.message; enrichStatusShown.summary = true; if (!r.ok) btn.disabled = false; }
    catch (err) { status.textContent = `Enrichment failed: ${err && err.message ? err.message : err}`; btn.disabled = false; }
  });

  // ── The form ────────────────────────────────────────────────────────────
  function fillStages(type = "company") {
    $("lead-stage").innerHTML = stagesFor(type).map((s) => `<option value="${s.key}">${esc(s.label)}</option>`).join("");
  }
  $("lead-background").innerHTML = `<option value="">Not given</option>` + BACKGROUNDS.map((b) => `<option value="${b.key}">${esc(b.label)}</option>`).join("");
  // The form for a company lead or a franchise opportunity (a person: no company, one contact).
  function setFormType(type) {
    formType = type === "franchise" ? "franchise" : "company";
    const fr = formType === "franchise";
    $("lead-backdrop").dataset.leadType = formType;
    $("lead-company-section").hidden = fr;
    $("lead-franchise-section").hidden = !fr;
    $("lead-add-contact-section").hidden = fr;
    fillStages(formType);
  }
  function fillAssignees(selected) {
    const sel = $("lead-assignee");
    const keep = selected != null ? selected : sel.value;
    const list = members.slice().sort((a, b) => memberName(a.email).localeCompare(memberName(b.email)));
    if (keep && !list.some((m) => m.email === keep)) list.push({ email: keep });
    sel.innerHTML = `<option value="">Unassigned</option>` + list.map((m) => `<option value="${esc(m.email)}">${esc(memberName(m.email))}</option>`).join("");
    sel.value = keep || "";
  }

  // Each contact is its own inset grouped card of label/value rows.
  function contactRowHTML(c, i) {
    const roles = `<option value="">None</option>` + BUYING_ROLES.map((r) => `<option value="${r.key}"${r.key === c.buyingRole ? " selected" : ""}>${esc(r.label)}</option>`).join("");
    const e = c.enrichment;
    const note = e ? `<div class="ap-row ap-row-line lead-contact-enriched">Enriched${e.added && e.added.length ? `: added ${esc(e.added.join(", "))}` : ""}${e.listedAs ? ` · listed as ${esc(e.listedAs)}` : ""}</div>` : "";
    // A franchise opportunity is one person: name, email and LinkedIn only.
    const fr = formType === "franchise";
    const field = (label, input, companyOnly) => `<label class="ap-row ap-field"${companyOnly && fr ? " hidden" : ""}><span class="ap-row-label">${label}</span>${input}</label>`;
    return `<fieldset class="lead-contact ap-section" data-index="${i}">
      <legend class="ap-group-title">${fr ? "Person" : `Contact ${i + 1}`}</legend>
      <div class="ap-group">
        ${field(fr ? "Full name" : "Name", `<input type="text" class="lc-name" maxlength="120" value="${esc(c.name)}" autocomplete="off">`)}
        ${field("Job title", `<input type="text" class="lc-title" maxlength="120" value="${esc(c.jobTitle)}" autocomplete="off">`, true)}
        ${field("Buying role", `<select class="lc-role" aria-label="Buying role">${roles}</select>`, true)}
        ${field("Email", `<input type="text" class="lc-email" maxlength="200" value="${esc(c.email)}" autocomplete="off">`)}
        ${field("LinkedIn", `<input type="text" class="lc-linkedin" maxlength="300" value="${esc(c.linkedin)}" placeholder="linkedin.com/in/…" autocomplete="off">`)}
        ${field("AWS account ID", `<input type="text" class="lc-aws" maxlength="14" inputmode="numeric" value="${esc(c.awsAccountId)}" placeholder="12 digits, if known" autocomplete="off">`, true)}
        ${note}
        ${fr ? "" : '<button type="button" class="ap-row-btn ap-destructive lc-remove" data-editor-only>Remove contact</button>'}
      </div>
    </fieldset>`;
  }
  function renderContacts() {
    $("lead-contacts").innerHTML = draft.contacts.map(contactRowHTML).join("");
  }
  // Rows -> draft (keeping each contact's enrichment, which has no input).
  function readContacts() {
    draft.contacts = [...$("lead-contacts").querySelectorAll(".lead-contact")].map((fs) => ({
      ...draft.contacts[Number(fs.dataset.index)],
      name: fs.querySelector(".lc-name").value, jobTitle: fs.querySelector(".lc-title").value,
      buyingRole: fs.querySelector(".lc-role").value, email: fs.querySelector(".lc-email").value,
      linkedin: fs.querySelector(".lc-linkedin").value, awsAccountId: fs.querySelector(".lc-aws").value,
    }));
  }
  $("lead-add-contact").addEventListener("click", () => { readContacts(); draft.contacts.push(blankContact()); renderContacts(); });
  $("lead-contacts").addEventListener("click", (e) => {
    const btn = e.target.closest && e.target.closest(".lc-remove");
    if (!btn) return;
    readContacts();
    draft.contacts.splice(Number(btn.closest(".lead-contact").dataset.index), 1);
    renderContacts();
  });

  function setError(msg) { const e = $("lead-error"); e.textContent = msg || ""; e.hidden = !msg; }

  // The Enrich / Refresh info button: its label follows the record, and it waits while a run is underway.
  const enrichStatusShown = { summary: false, form: false };
  function setEnrichButton(btn, e) {
    btn.lastChild.textContent = ` ${enrichButtonLabel(e)}`;
    btn.disabled = enrichmentRunning(e);
  }
  function renderEnrichment(l) {
    const e = l && l.enrichment;
    const box = $("lead-enrichment");
    box.innerHTML = researchGroupsHTML(e);
    wireLogoFallback(box);
    setEnrichButton($("lead-enrich-btn"), e);
    const st = enrichmentStatus(e);
    if (st || enrichStatusShown.form) { $("lead-enrich-status").textContent = st; enrichStatusShown.form = !!st; }
  }
  function renderAccount(l) {
    const a = l && l.customerAccount;
    $("lead-account-line").textContent = a ? `${a.name || a.id}${a.id && a.name ? ` (${a.id})` : ""}` : "Not linked yet";
    $("lead-account-name").value = a ? a.name : "";
    $("lead-account-id").value = a ? a.id : "";
    $("lead-convert-btn").textContent = a ? "Update linked account" : "Convert and link account";
  }

  function fill(l) {
    setFormType(l.leadType);
    $("lead-region").value = (l.franchise && l.franchise.region) || "";
    $("lead-background").value = (l.franchise && l.franchise.background) || "";
    $("lead-name").value = l.company.name;
    $("lead-website").value = l.company.website;
    $("lead-industry").value = l.company.industry;
    $("lead-countries").value = l.company.countries.join(", ");
    $("lead-stores").value = l.company.storeCount == null ? "" : String(l.company.storeCount);
    $("lead-aws-account").value = l.company.awsAccountId || "";
    $("lead-stage").value = l.stage;
    $("lead-source").value = l.source;
    fillAssignees(l.assignee);
    draft.contacts = l.contacts.length ? l.contacts.map((c) => ({ ...c })) : [blankContact()];
    renderContacts();
  }

  function openLead(id) {
    openId = id || null;
    const l = id ? leads.find((x) => x.id === id) : null;
    if (id && !l) return;
    const type = l ? l.leadType : view;
    $("lead-title").textContent = l ? leadName(l) : (type === "franchise" ? "New franchise opportunity" : "New lead");
    setError("");
    $("lead-enrich-status").textContent = "";
    $("lead-existing").hidden = !l || type === "franchise"; // research and customer accounts are for companies
    $("lead-delete").hidden = !l;
    if (l) { fill(l); if (type !== "franchise") { renderEnrichment(l); renderAccount(l); } }
    else {
      fill({ leadType: type, franchise: { region: "", background: "" }, company: { name: "", website: "", industry: "", countries: [], storeCount: null, awsAccountId: "" }, contacts: [], stage: defaultStageFor(type), source: "Manual", assignee: me() });
    }
    backdrop.hidden = false;
    (type === "franchise" ? $("lead-contacts").querySelector(".lc-name") : $("lead-name")).focus();
  }
  function closeLead() { backdrop.hidden = true; openId = null; }

  function gather() {
    readContacts();
    const fr = formType === "franchise";
    return leadFromForm({
      leadType: formType, region: fr ? $("lead-region").value : "", background: fr ? $("lead-background").value : "",
      name: fr ? "" : $("lead-name").value, website: $("lead-website").value, industry: $("lead-industry").value,
      countries: $("lead-countries").value, storeCount: $("lead-stores").value, awsAccountId: $("lead-aws-account").value,
      contacts: draft.contacts, stage: $("lead-stage").value, source: $("lead-source").value, assignee: $("lead-assignee").value,
    });
  }

  // Writes the form (and anything in `extra`); returns the lead's id.
  async function persist(extra) {
    const r = gather();
    if (r.errors.length) { setError(r.errors.join(" ")); return null; }
    setError("");
    const f = r.fields;
    if (!openId && !extra && f.leadType !== "franchise") { // a person is never matched to Prospects (TAM)
      const placed = await placeNew(f);
      if (placed) { if (placed.id) openId = placed.id; return placed; }
    }
    if (!openId) {
      const ref = await addDoc(collection(db, "leads"), {
        ...f, customerAccount: null, ...(extra || {}),
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(), stageChangedAt: serverTimestamp(), createdByEmail: me(), updatedByEmail: me(),
      });
      openId = ref.id;
      return ref.id;
    }
    const before = leads.find((x) => x.id === openId);
    const patch = { ...f, ...(extra || {}), updatedAt: serverTimestamp(), updatedByEmail: me() };
    if (!before || before.stage !== (patch.stage || f.stage)) patch.stageChangedAt = serverTimestamp();
    await updateDoc(doc(db, "leads", openId), patch);
    return openId;
  }

  // A new lead, matched to Prospects (TAM) the way a website lead is. Returns
  // { id, message } (id null for AWS), or null to save it as a plain lead
  // (Prospects can't be read, or the name can't hold a TAM record).
  async function placeNew(f) {
    let prospects;
    try { prospects = (await getDocs(collection(db, "prospects"))).docs.map((d) => normaliseProspect(d.id, d.data())); } catch { return null; }
    const contact = f.contacts.find((c) => c.email) || f.contacts[0] || null;
    const plan = planInbound({ prospects, leads: allLeads, company: f.company, contact });
    if (plan.kind === "none") return null;
    const stamp = { updatedAt: serverTimestamp(), updatedByEmail: me() };
    const pRef = doc(db, "prospects", plan.prospectId);
    if (plan.kind === "aws") {
      const day = new Date().toISOString().slice(0, 10);
      let contacts = plan.prospect ? plan.prospect.contacts : [];
      for (const c of f.contacts) contacts = mergeContact(contacts, awsContactFrom(c, day));
      if (plan.createProspect) await setDoc(pRef, { ...plan.createProspect, contacts, createdAt: serverTimestamp(), createdByEmail: me(), ...stamp });
      else await updateDoc(pRef, { contacts, ...stamp });
      awsOpen = true; renderAws();
      return { id: null, message: "From AWS: added to the AWS tile, not as a lead." };
    }
    const link = { leadId: plan.leadId, status: "converted" };
    if (plan.createProspect) await setDoc(pRef, { ...plan.createProspect, ...link, createdAt: serverTimestamp(), createdByEmail: me(), ...stamp });
    else if (plan.linkProspect) await updateDoc(pRef, { ...link, ...stamp });
    if (plan.lead) {
      const m = mergeInbound(plan.lead, f, f.contacts);
      await updateDoc(doc(db, "leads", plan.lead.id), { company: m.company, contacts: m.contacts, inboundCount: m.inboundCount, ...(plan.lead.prospectId ? {} : { prospectId: plan.prospectId }), ...stamp });
      return { id: plan.lead.id, message: `Added to the existing lead for ${plan.lead.company.name} (${inboundLabel({ inboundCount: m.inboundCount })}).` };
    }
    await setDoc(doc(db, "leads", plan.leadId), {
      ...f, customerAccount: null, prospectId: plan.prospectId, inboundCount: 1,
      createdAt: serverTimestamp(), stageChangedAt: serverTimestamp(), createdByEmail: me(), ...stamp,
    });
    return { id: plan.leadId, message: "" };
  }

  $("lead-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!canEdit()) return;
    $("lead-save").disabled = true;
    try {
      const saved = await persist();
      if (saved) {
        closeLead();
        if (saved.message && saved.id && leads.some((x) => x.id === saved.id)) { openSummary(saved.id); $("lead-sum-status").textContent = saved.message; }
        else if (saved.message) { const st = $("leads-aws-status"); if (st) st.textContent = saved.message; }
      }
    } catch (err) { setError(`Couldn't save: ${err && err.message ? err.message : err}`); }
    finally { $("lead-save").disabled = false; }
  });
  $("lead-close").addEventListener("click", closeLead);
  $("lead-cancel").addEventListener("click", closeLead);
  backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) closeLead(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !backdrop.hidden) closeLead(); });
  $("leads-add-btn").addEventListener("click", () => openLead(null));
  $("leads-empty-add").addEventListener("click", () => openLead(null));

  $("lead-delete").addEventListener("click", async () => {
    const l = leads.find((x) => x.id === openId);
    if (!l || !canEdit()) return;
    const btn = $("lead-delete");
    if (!btn.dataset.armed) { // a second click confirms, in the page (no native dialog)
      btn.dataset.armed = "1"; btn.textContent = "Click again to delete";
      setTimeout(() => { delete btn.dataset.armed; btn.textContent = "Delete lead"; }, 6000);
      return;
    }
    delete btn.dataset.armed; btn.textContent = "Delete lead";
    try { await deleteDoc(doc(db, "leads", l.id)); closeLead(); } catch (err) { setError(`Couldn't delete: ${err && err.message ? err.message : err}`); }
  });

  // Queues an enrichment run for a saved lead. The agent's findings arrive
  // through the leads snapshot, which re-renders the drawer and the form.
  async function runEnrich(id) {
    // A lead the check stopped ("Research anyway") is researched without the check.
    const l = leads.find((x) => x.id === id);
    const force = enrichmentSkipped(l && l.enrichment);
    const resp = await fetch("/leadEnrich/v1/enrich", { method: "POST", headers: await apiHeaders(), body: JSON.stringify({ leadId: id, ...(force ? { force: true } : {}) }) });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) return { ok: false, message: body.error || `Enrichment failed (HTTP ${resp.status}).` };
    return { ok: true, message: "Researching the company on the web… the findings appear here when it finishes (usually under two minutes)." };
  }

  $("lead-enrich-btn").addEventListener("click", async () => {
    if (!canEdit() || !openId) return;
    const status = $("lead-enrich-status");
    const btn = $("lead-enrich-btn");
    btn.disabled = true;
    status.textContent = "Saving, then starting the research…";
    try {
      if (!(await persist())) { status.textContent = ""; btn.disabled = false; return; }
      const r = await runEnrich(openId);
      status.textContent = r.message; enrichStatusShown.form = true;
      if (!r.ok) btn.disabled = false;
    } catch (err) {
      status.textContent = `Enrichment failed: ${err && err.message ? err.message : err}`;
      btn.disabled = false;
    }
  });

  $("lead-convert-btn").addEventListener("click", async () => {
    if (!canEdit() || !openId) return;
    const c = conversionFields({ name: $("lead-account-name").value, id: $("lead-account-id").value });
    if (c.error) { setError(c.error); return; }
    try {
      if (await persist({ stage: c.fields.stage, customerAccount: c.fields.customerAccount })) closeLead();
    } catch (err) { setError(`Couldn't convert: ${err && err.message ? err.message : err}`); }
  });

  // ── AWS ACE opportunities (under the board) ─────────────────────────────
  // Loading and the count/KPI/stage header live here; the grid is ace-grid.js.
  let aceRows = null;
  let aceMeta = {};
  let aceGrid = null;
  const grid = () => aceGrid || (aceGrid = mountAceGrid({ host: $("ace-grid"), pop: $("ace-pop"), onOpenLead: (id) => openSummary(id), onOpen: (id, from) => { const r = (aceRows || []).find((x) => x.id === id); if (r) aceDetail().open(r, from); } }));
  // The detail dialog: a saved or created opportunity replaces/joins its table row straight away.
  let aceDlg = null;
  const aceDetail = () => aceDlg || (aceDlg = mountAceDetail({
    backdrop: $("ace-backdrop"), apiHeaders, canEdit,
    onSaved: (opp) => {
      if (!opp || !opp.id) return;
      const i = (aceRows || []).findIndex((x) => x.id === opp.id);
      aceRows = aceRows || [];
      if (i >= 0) aceRows[i] = { ...aceRows[i], ...opp }; else aceRows.unshift(opp);
      renderAce();
    },
  }));
  const aceAlert = (msg) => {
    $("ace-alert-text").textContent = msg; $("ace-alert").hidden = !msg;
  };
  async function loadAce() {
    aceAlert("");
    $("ace-count").textContent = "Loading…";
    if (aceRows) grid().setLoading(true);
    try {
      const resp = await fetch("/partnerCentral/v1/ace", { method: "GET", headers: await apiHeaders() });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(resp.status === 403 ? (body.error || "Only editors and admins can see the ACE opportunities.") : (body.error || `HTTP ${resp.status}`));
      aceRows = Array.isArray(body.opportunities) ? body.opportunities : [];
      aceMeta = body;
      renderAce(body);
    } catch (err) {
      aceRows = null;
      for (const id of ["ace-kpis", "ace-grid", "ace-empty"]) $(id).hidden = true;
      $("ace-count").textContent = "";
      aceAlert(`Couldn't load the ACE opportunities: ${err && err.message ? err.message : err}`);
    } finally { if (aceGrid) aceGrid.setLoading(false); }
  }
  function kpiCard(icon, label, value, tone) {
    return `<div class="ace-kpi" data-kpi="${tone}"><span class="ace-kpi-icon" aria-hidden="true"><span class="material-symbols-outlined">${icon}</span></span><div class="ace-kpi-text"><div class="ace-kpi-label">${esc(label)}</div><div class="ace-kpi-value">${value}</div></div></div>`;
  }
  function renderAce(meta = aceMeta) {
    if (!aceRows) return;
    const rows = aceRows;
    const n = rows.length;
    $("ace-count").innerHTML = `${n}${meta.catalog === "Sandbox" ? ' <span class="ace-flag">Sandbox</span>' : ""}${meta.truncated ? ' <span class="ace-flag">first 100 shown</span>' : ""}`;
    $("ace-empty").hidden = n > 0;
    for (const id of ["ace-kpis", "ace-grid"]) $(id).hidden = n === 0;
    if (n) {
      const k = kpis(rows);
      const rev = k.revenue.length ? k.revenue.map((r) => esc(formatMonthly(r))).join(" · ") : "–";
      $("ace-kpis").innerHTML = kpiCard("payments", "Expected monthly AWS revenue", rev, "revenue") + kpiCard("check_circle", "Approved", k.approved, "approved") + kpiCard("report", "Needs action", k.needsAction, "action");
    }
    grid().setRows(rows, leads);
  }
  $("ace-refresh").addEventListener("click", () => loadAce());
  $("ace-new").addEventListener("click", (e) => aceDetail().openNew(e.currentTarget));
  $("ace-retry").addEventListener("click", () => loadAce());

  return { start, stop, render, stageLabel, roleLabel, open: openLead, openSummary };
}
