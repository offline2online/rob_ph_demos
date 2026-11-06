// Promote › Leads (#promote/leads): the board and the lead form.
//
// One card per company in `leads/{id}`; the lanes are leads-core.js STAGES.
// A tile drags between lanes (HTML5 drag and drop); clicking it (or Enter)
// opens the lead summary drawer, whose stage select moves it without a pointer
// drag, which is how it moves on a tablet. Tiles are coloured by industry
// (industry-palette.js). A write is live for everyone at once through onSnapshot. The
// Enrich button calls /leadEnrich/v1/enrich (functions/lead-enrich.js), which
// writes the company's findings back onto the lead and its contacts.
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import {
  STAGES, BUYING_ROLES, normaliseLead, groupByStage, leadFromForm, blankContact, stageLabel, roleLabel,
  companyLine, conversionFields, isStage,
} from "./leads-core.js";
import { summarise, matchLead, mailtoFor, partnerCentralHref, formatMonthly, formatDate } from "./ace-core.js";
import { leadIndustryEntry, industryChipText, industryStyle } from "./industry-palette.js";

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
// Addresses come from Firestore, which an agent can write: http(s) only.
const safeUrl = (u) => { try { const x = new URL(String(u)); return x.protocol === "https:" || x.protocol === "http:" ? x.href : ""; } catch { return ""; } };
const $ = (id) => document.getElementById(id);

export function mountLeadsPage({ db, auth, canEdit, apiHeaders }) {
  const page = $("leads-page");
  const board = $("leads-board");
  const backdrop = $("lead-backdrop");
  let leads = [];
  let members = [];
  let unsub = null;
  let openId = null;          // the lead in the form, null for a new one
  let draft = { contacts: [] }; // contact rows held in memory while the form is open
  let started = false;

  const me = () => String((auth.currentUser && auth.currentUser.email) || "").toLowerCase();
  const memberName = (email) => {
    const m = members.find((x) => x.email === email);
    return (m && (m.displayName || m.name)) || email;
  };

  function start() {
    if (started) return;
    started = true;
    unsub = onSnapshot(collection(db, "leads"), (snap) => {
      leads = snap.docs.map((d) => normaliseLead(d.id, d.data({ serverTimestamps: "estimate" })));
      render();
    }, () => { board.innerHTML = '<p class="promote-empty">Leads could not be loaded. Reload the page to try again.</p>'; });
    getDocs(collection(db, "memberDirectory")).then((snap) => {
      members = snap.docs.map((d) => ({ email: d.id, ...d.data() })).filter((m) => !m.disabled);
      fillAssignees(); render();
    }).catch(() => {});
    fillStages();
    loadAce();
  }
  function stop() { if (unsub) unsub(); unsub = null; started = false; }

  // ── The board ───────────────────────────────────────────────────────────
  const initials = (nameOrEmail) => {
    const base = String(nameOrEmail || "").split("@")[0];
    const parts = base.split(/[\s._-]+/).filter(Boolean);
    return ((parts[0] || "?")[0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  };
  const isWebsite = (l) => /^web/i.test(l.source);
  const sourceLabel = (l) => (isWebsite(l) ? "Website" : (l.source && l.source.toLowerCase() !== "manual" ? l.source : "Manual"));
  function cardHTML(l) {
    const line = companyLine(l);
    const entry = leadIndustryEntry(l);
    const who = l.assignee ? memberName(l.assignee) : "";
    return `<article class="lead-card" draggable="${canEdit() ? "true" : "false"}" data-lead-id="${esc(l.id)}" data-industry="${esc(entry.key)}" style="${industryStyle(entry)}" tabindex="0" role="button" aria-label="${esc(l.company.name)}, open lead summary">
      <h4 class="lead-card-name">${esc(l.company.name)}</h4>
      <div class="lead-card-chips"><span class="lead-chip" title="${esc(industryChipText(l))}">${esc(industryChipText(l))}</span>${l.test ? '<span class="lead-test-badge">Test</span>' : ""}</div>
      ${line ? `<p class="lead-card-line">${esc(line)}</p>` : ""}
      <div class="lead-card-foot">
        <span class="lead-card-who" title="${esc(who || "Unassigned")}">${who ? `<span class="lead-avatar" aria-hidden="true">${esc(initials(who))}</span><span class="visually-hidden">${esc(who)}</span>` : "Unassigned"}</span>
        <span class="lead-card-source" title="${esc(sourceLabel(l))}"><span class="material-symbols-outlined" aria-hidden="true">${isWebsite(l) ? "public" : "edit"}</span>${esc(sourceLabel(l))}</span>
      </div>
    </article>`;
  }

  function render() {
    if (page.hidden) return;
    const shown = leads;
    const lanes = groupByStage(shown);
    $("leads-empty").textContent = "No leads yet. Add one with the button above.";
    $("leads-empty").hidden = shown.length > 0;
    board.innerHTML = STAGES.map((s) => `<section class="lead-lane lead-lane-${s.key}" data-stage="${s.key}" aria-label="${esc(s.label)}">
      <header class="lead-lane-head"><h3>${esc(s.label)}</h3><span class="lead-lane-count">${lanes[s.key].length}</span></header>
      <div class="lead-lane-body">${lanes[s.key].map(cardHTML).join("")}</div>
    </section>`).join("");
    if (summaryId) renderSummary();
    if (aceRows) renderAce();
  }

  async function moveTo(id, stage) {
    const l = leads.find((x) => x.id === id);
    if (!l || !isStage(stage) || l.stage === stage || !canEdit()) return;
    l.stage = stage; render(); // optimistic; the snapshot confirms or corrects it
    try {
      await updateDoc(doc(db, "leads", id), { stage, stageChangedAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedByEmail: me() });
    } catch (err) {
      showBoardError(`Couldn't move ${l.company.name}: ${err && err.message ? err.message : err}`);
    }
  }
  function showBoardError(msg) { const e = $("leads-empty"); e.textContent = msg; e.hidden = false; }

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
  const row = (label, valueHtml) => (valueHtml ? `<div class="lead-sum-row"><dt>${esc(label)}</dt><dd>${valueHtml}</dd></div>` : "");
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
    return `<section class="lead-sum-section" id="lead-sum-tam"><h3>TAM record</h3><dl class="lead-sum-dl">${entries.map(([k, v]) => row(k, esc(v))).join("")}</dl></section>`;
  }
  function prospectHTML(l) {
    if (!l.prospectId) return "";
    return `<section class="lead-sum-section" id="lead-sum-prospect"><h3>Prospect record</h3><dl class="lead-sum-dl">${row("From", '<a href="#promote/prospects">Prospects (TAM)</a>')}</dl></section>`;
  }
  function renderSummary() {
    const l = leads.find((x) => x.id === summaryId);
    if (!l) { closeSummary(); return; }
    const entry = leadIndustryEntry(l);
    const e = l.enrichment;
    const at = e && e.at && typeof e.at.toDate === "function" ? e.at.toDate() : (e && e.at ? new Date(e.at) : null);
    const enrichedAt = at && !Number.isNaN(at.getTime()) ? at.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "";
    const stageOptions = STAGES.map((s) => `<option value="${s.key}"${s.key === l.stage ? " selected" : ""}>${esc(s.label)}</option>`).join("");
    $("lead-sum-title").textContent = l.company.name;
    const panel = $("lead-summary-panel");
    panel.style.cssText = industryStyle(entry);
    panel.dataset.industry = entry.key;
    $("lead-sum-badges").innerHTML = `<span class="lead-chip">${esc(industryChipText(l))}</span>${l.test ? '<span class="lead-test-badge">Test</span>' : ""}`;
    const keepStage = document.activeElement && document.activeElement.id === "lead-sum-stage";
    $("lead-sum-body").innerHTML = `
      <section class="lead-sum-section"><h3>Company</h3><dl class="lead-sum-dl">
        ${row("Name", esc(l.company.name))}
        ${row("Website", l.company.website ? linkOf(l.company.website) : "")}
        ${row("Industry", l.company.industry ? esc(l.company.industry) : "")}
        ${row("Countries", l.company.countries.length ? esc(l.company.countries.join(", ")) : "")}
        ${row("Stores", l.company.storeCount != null ? esc(l.company.storeCount.toLocaleString("en-GB")) : "")}
        ${row("Enrichment", e && e.summary ? esc(e.summary) : (e ? "Enriched; no summary." : "Not enriched yet."))}
        ${row("Last enriched", esc(enrichedAt))}
      </dl></section>
      ${tamHTML(l)}
      ${prospectHTML(l)}
      <section class="lead-sum-section"><h3>Lead</h3><dl class="lead-sum-dl">
        ${row("Stage", `<select id="lead-sum-stage" class="lead-sum-stage" aria-label="Stage" data-editor-only>${stageOptions}</select><span class="lead-sum-stage-ro">${esc(stageLabel(l.stage))}</span>`)}
        ${row("Assignee", esc(l.assignee ? memberName(l.assignee) : "Unassigned"))}
        ${row("Source", esc(sourceLabel(l)))}
        ${row("Source page", pageLink(l))}
        ${row("Source industry", esc(l.sourceIndustry))}
        ${row("Created", esc(fmtDate(l.createdAtMs)))}
        ${row("Updated", esc(fmtDate(l.updatedAtMs)))}
        ${row("Customer account", l.customerAccount ? esc(l.customerAccount.name || l.customerAccount.id) + (l.customerAccount.id && l.customerAccount.name ? ` (${esc(l.customerAccount.id)})` : "") : "")}
      </dl></section>
      <section class="lead-sum-section"><h3>Contacts</h3>${l.contacts.length ? l.contacts.map((c) => `<div class="lead-sum-contact">
        <p class="lead-sum-contact-name">${esc(c.name)}${c.buyingRole ? ` <span class="lead-sum-role">${esc(roleLabel(c.buyingRole))}</span>` : ""}</p>
        ${c.jobTitle ? `<p class="lead-card-line">${esc(c.jobTitle)}</p>` : ""}
        ${c.email ? `<p class="lead-card-line"><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></p>` : ""}
        ${c.linkedin ? `<p class="lead-card-line">${linkOf(c.linkedin, "LinkedIn")}</p>` : ""}
      </div>`).join("") : '<p class="field-hint">No contacts yet.</p>'}</section>`;
    $("lead-sum-delete").hidden = !canEdit();
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
    btn.disabled = true; status.textContent = "Looking the company up…";
    try { status.textContent = (await runEnrich(summaryId)).message; } catch (err) { status.textContent = `Enrichment failed: ${err && err.message ? err.message : err}`; }
    finally { btn.disabled = false; }
  });

  // ── The form ────────────────────────────────────────────────────────────
  function fillStages() {
    $("lead-stage").innerHTML = STAGES.map((s) => `<option value="${s.key}">${esc(s.label)}</option>`).join("");
  }
  function fillAssignees(selected) {
    const sel = $("lead-assignee");
    const keep = selected != null ? selected : sel.value;
    const list = members.slice().sort((a, b) => memberName(a.email).localeCompare(memberName(b.email)));
    if (keep && !list.some((m) => m.email === keep)) list.push({ email: keep });
    sel.innerHTML = `<option value="">Unassigned</option>` + list.map((m) => `<option value="${esc(m.email)}">${esc(memberName(m.email))}</option>`).join("");
    sel.value = keep || "";
  }

  function contactRowHTML(c, i) {
    const roles = `<option value="">Buying role</option>` + BUYING_ROLES.map((r) => `<option value="${r.key}"${r.key === c.buyingRole ? " selected" : ""}>${esc(r.label)}</option>`).join("");
    const e = c.enrichment;
    const note = e ? `<p class="field-hint lead-contact-enriched">Enriched${e.added && e.added.length ? `: added ${esc(e.added.join(", "))}` : ""}${e.listedAs ? ` · listed as ${esc(e.listedAs)}` : ""}</p>` : "";
    return `<fieldset class="lead-contact" data-index="${i}">
      <legend>Contact ${i + 1}</legend>
      <label class="field-label">Name<input type="text" class="lc-name" maxlength="120" value="${esc(c.name)}" autocomplete="off"></label>
      <label class="field-label">Job title<input type="text" class="lc-title" maxlength="120" value="${esc(c.jobTitle)}" autocomplete="off"></label>
      <label class="field-label">Buying role<select class="lc-role" aria-label="Buying role">${roles}</select></label>
      <label class="field-label">Email<input type="text" class="lc-email" maxlength="200" value="${esc(c.email)}" autocomplete="off"></label>
      <label class="field-label">LinkedIn<input type="text" class="lc-linkedin" maxlength="300" value="${esc(c.linkedin)}" placeholder="linkedin.com/in/…" autocomplete="off"></label>
      ${note}
      <button type="button" class="btn-ghost lc-remove" data-editor-only>Remove contact</button>
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
      linkedin: fs.querySelector(".lc-linkedin").value,
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

  function renderEnrichment(l) {
    const e = l && l.enrichment;
    const box = $("lead-enrichment");
    if (!e) { box.innerHTML = '<p class="field-hint">Not enriched yet.</p>'; return; }
    const at = e.at && typeof e.at.toDate === "function" ? e.at.toDate() : (e.at ? new Date(e.at) : null);
    const stack = Array.isArray(e.techStack) ? e.techStack : [];
    const sources = Array.isArray(e.sources) ? e.sources : [];
    const li = safeUrl(e.linkedinCompany);
    box.innerHTML = `
      ${at && !Number.isNaN(at.getTime()) ? `<p class="field-hint">Last enriched ${esc(at.toLocaleString("en-GB"))}</p>` : ""}
      ${e.summary ? `<p class="lead-enrich-summary">${esc(e.summary)}</p>` : ""}
      ${li ? `<p><a href="${esc(li)}" target="_blank" rel="noopener noreferrer">Company LinkedIn page</a></p>` : ""}
      ${stack.length ? `<p class="lead-stack-label">Tech stack</p><ul class="lead-stack">${stack.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
      ${sources.length ? `<ul class="lead-sources">${sources.map((s) => `<li data-status="${esc(s.status)}">${esc(s.message)}</li>`).join("")}</ul>` : ""}`;
  }
  function renderAccount(l) {
    const a = l && l.customerAccount;
    $("lead-account-line").textContent = a ? `Linked to customer account ${a.name || a.id}${a.id && a.name ? ` (${a.id})` : ""}.` : "Not linked to a customer account yet.";
    $("lead-account-name").value = a ? a.name : "";
    $("lead-account-id").value = a ? a.id : "";
    $("lead-convert-btn").textContent = a ? "Update linked account" : "Convert and link account";
  }

  function fill(l) {
    $("lead-name").value = l.company.name;
    $("lead-website").value = l.company.website;
    $("lead-industry").value = l.company.industry;
    $("lead-countries").value = l.company.countries.join(", ");
    $("lead-stores").value = l.company.storeCount == null ? "" : String(l.company.storeCount);
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
    $("lead-title").textContent = l ? l.company.name : "New lead";
    setError("");
    $("lead-enrich-status").textContent = "";
    $("lead-existing").hidden = !l;
    $("lead-delete").hidden = !l;
    if (l) { fill(l); renderEnrichment(l); renderAccount(l); }
    else {
      fill({ company: { name: "", website: "", industry: "", countries: [], storeCount: null }, contacts: [], stage: "lead", source: "Manual", assignee: me() });
    }
    backdrop.hidden = false;
    $("lead-name").focus();
  }
  function closeLead() { backdrop.hidden = true; openId = null; }

  function gather() {
    readContacts();
    return leadFromForm({
      name: $("lead-name").value, website: $("lead-website").value, industry: $("lead-industry").value,
      countries: $("lead-countries").value, storeCount: $("lead-stores").value,
      contacts: draft.contacts, stage: $("lead-stage").value, source: $("lead-source").value, assignee: $("lead-assignee").value,
    });
  }

  // Writes the form (and anything in `extra`); returns the lead's id.
  async function persist(extra) {
    const r = gather();
    if (r.errors.length) { setError(r.errors.join(" ")); return null; }
    setError("");
    const f = r.fields;
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

  $("lead-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!canEdit()) return;
    $("lead-save").disabled = true;
    try { if (await persist()) closeLead(); } catch (err) { setError(`Couldn't save: ${err && err.message ? err.message : err}`); }
    finally { $("lead-save").disabled = false; }
  });
  $("lead-close").addEventListener("click", closeLead);
  $("lead-cancel").addEventListener("click", closeLead);
  backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) closeLead(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !backdrop.hidden) closeLead(); });
  $("leads-add-btn").addEventListener("click", () => openLead(null));

  $("lead-delete").addEventListener("click", async () => {
    const l = leads.find((x) => x.id === openId);
    if (!l || !canEdit()) return;
    const btn = $("lead-sum-delete");
    if (!btn.dataset.armed) { // a second click confirms, in the page (no native dialog)
      btn.dataset.armed = "1"; btn.textContent = "Click again to delete";
      setTimeout(() => { delete btn.dataset.armed; btn.textContent = "Delete lead"; }, 6000);
      return;
    }
    delete btn.dataset.armed; btn.textContent = "Delete lead";
    try { await deleteDoc(doc(db, "leads", l.id)); closeLead(); } catch (err) { setError(`Couldn't delete: ${err && err.message ? err.message : err}`); }
  });

  // Calls the enrich function for a saved lead and re-reads what it wrote.
  async function runEnrich(id) {
    const resp = await fetch("/leadEnrich/v1/enrich", { method: "POST", headers: await apiHeaders(), body: JSON.stringify({ leadId: id }) });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) return { ok: false, message: body.error || `Enrichment failed (HTTP ${resp.status}).` };
    const snap = await getDoc(doc(db, "leads", id));
    let lead = null;
    if (snap.exists()) {
      lead = normaliseLead(snap.id, snap.data());
      const i = leads.findIndex((x) => x.id === lead.id);
      if (i >= 0) leads[i] = lead;
      if (summaryId === id) renderSummary();
    }
    const added = (body.companyFieldsAdded || []).length + (body.contactsEnriched || 0);
    return { ok: true, lead, message: added || body.techStack ? `Done: ${body.techStack || 0} technologies, ${added} details added.` : "Done: nothing new was found." };
  }

  $("lead-enrich-btn").addEventListener("click", async () => {
    if (!canEdit() || !openId) return;
    const status = $("lead-enrich-status");
    const btn = $("lead-enrich-btn");
    btn.disabled = true;
    status.textContent = "Saving, then looking the company up…";
    try {
      if (!(await persist())) { status.textContent = ""; return; }
      const r = await runEnrich(openId);
      if (r.lead) { fill(r.lead); renderEnrichment(r.lead); }
      status.textContent = r.message;
    } catch (err) {
      status.textContent = `Enrichment failed: ${err && err.message ? err.message : err}`;
    } finally { btn.disabled = false; }
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
  let aceRows = null;
  async function loadAce() {
    const status = $("ace-status");
    status.hidden = false; status.textContent = "Loading ACE opportunities…";
    try {
      const resp = await fetch("/partnerCentral/v1/ace", { method: "GET", headers: await apiHeaders() });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(resp.status === 403 ? (body.error || "Only editors and admins can see the ACE opportunities.") : (body.error || `HTTP ${resp.status}`));
      aceRows = Array.isArray(body.opportunities) ? body.opportunities : [];
      renderAce(body);
    } catch (err) {
      aceRows = null;
      $("ace-summary").hidden = true; $("ace-table-wrap").hidden = true;
      status.textContent = `Couldn't load the ACE opportunities: ${err && err.message ? err.message : err}`;
    }
  }
  function renderAce(meta = {}) {
    if (!aceRows) return;
    const status = $("ace-status");
    const rows = aceRows;
    $("ace-summary").hidden = rows.length === 0;
    $("ace-table-wrap").hidden = rows.length === 0;
    status.hidden = false;
    status.textContent = rows.length ? `${rows.length} ${rows.length === 1 ? "opportunity" : "opportunities"} from AWS Partner Central${meta.catalog === "Sandbox" ? " (Sandbox)" : ""}${meta.truncated ? ", first 100 shown" : ""}.` : "No ACE opportunities yet.";
    const sum = summarise(rows);
    const chips = (items) => items.map((i) => `<span class="ace-chip"><span class="ace-chip-n">${i.count}</span> ${esc(i.label)}</span>`).join("");
    $("ace-summary").innerHTML = `<div class="ace-summary-row"><strong>ACE stage</strong>${chips(sum.byStage)}</div><div class="ace-summary-row"><strong>Review status</strong>${chips(sum.byReview)}</div>`;
    $("ace-body").innerHTML = rows.map((r) => {
      const lead = matchLead(r, leads);
      const mail = mailtoFor(r);
      const pc = partnerCentralHref(r);
      const seller = r.awsSeller;
      return `<tr data-ace-id="${esc(r.id)}">
        <th scope="row">${esc(r.name || r.id)}</th>
        <td>${esc(r.customer)}</td>
        <td>${esc(r.stage)}</td>
        <td>${r.reviewStatus ? `<span class="ace-review" data-review="${esc(r.reviewStatus)}">${esc(r.reviewStatus)}</span>` : ""}</td>
        <td class="ace-num">${r.score == null ? "" : esc(r.score)}</td>
        <td class="ace-num">${esc(formatMonthly(r.expectedMonthly))}</td>
        <td>${esc(formatDate(r.targetCloseDate))}</td>
        <td>${seller ? `<span class="ace-seller">${esc(seller.name)}</span>${mail ? ` <a class="ace-mail" href="${esc(mail)}" aria-label="Email ${esc(seller.name)} about ${esc(r.name || r.id)}" title="Email ${esc(seller.name)}"><span class="material-symbols-outlined" aria-hidden="true">email</span></a>` : ""}` : '<span class="ace-none">Not assigned</span>'}</td>
        <td class="ace-links">${lead ? `<button type="button" class="btn-ghost ace-lead" data-lead-id="${esc(lead.id)}">Lead card</button>` : '<span class="ace-none" title="No lead with this company name">No lead</span>'}${pc ? ` <a class="btn-ghost ace-pc" href="${esc(pc)}" target="_blank" rel="noopener noreferrer">Partner Central <span class="material-symbols-outlined" aria-hidden="true">open_in_new</span></a>` : ""}</td>
      </tr>`;
    }).join("");
  }
  $("ace-body").addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest(".ace-lead");
    if (b) openSummary(b.dataset.leadId);
  });
  $("ace-refresh").addEventListener("click", () => loadAce());

  return { start, stop, render, stageLabel, roleLabel, open: openLead, openSummary };
}
