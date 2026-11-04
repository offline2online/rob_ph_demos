// Promote › Leads (#promote/leads): the board and the lead form.
//
// One card per company in `leads/{id}`; the lanes are leads-core.js STAGES.
// A card drags between lanes (HTML5 drag and drop), and has a "Move to"
// select that does the same without a pointer drag, which is how it moves on
// a tablet. A write is live for everyone at once through onSnapshot. The
// Enrich button calls /leadEnrich/v1/enrich (functions/lead-enrich.js), which
// writes the company's findings back onto the lead and its contacts.
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import {
  STAGES, BUYING_ROLES, normaliseLead, groupByStage, leadFromForm, blankContact, stageLabel, roleLabel,
  companyLine, conversionFields, isStage,
} from "./leads-core.js";

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
  let showTest = false;       // the Test filter: test leads only appear there

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
  }
  function stop() { if (unsub) unsub(); unsub = null; started = false; }

  // ── The board ───────────────────────────────────────────────────────────
  function cardHTML(l) {
    const dm = l.contacts.find((c) => c.buyingRole === "decision-maker");
    const line = companyLine(l);
    const options = STAGES.map((s) => `<option value="${s.key}"${s.key === l.stage ? " selected" : ""}>${esc(s.label)}</option>`).join("");
    return `<article class="lead-card" draggable="${canEdit() ? "true" : "false"}" data-lead-id="${esc(l.id)}" tabindex="0">
      <h4 class="lead-card-name">${esc(l.company.name)}</h4>
      ${line ? `<p class="lead-card-line">${esc(line)}</p>` : ""}
      ${l.company.industry ? `<p class="lead-card-line">${esc(l.company.industry)}</p>` : ""}
      <p class="lead-card-line">${l.contacts.length} contact${l.contacts.length === 1 ? "" : "s"}${dm ? ` · ${esc(dm.name)} (decision maker)` : ""}</p>
      ${l.customerAccount ? `<p class="lead-card-line lead-card-account"><span class="material-symbols-outlined" aria-hidden="true">link</span>${esc(l.customerAccount.name || l.customerAccount.id)}</p>` : ""}
      <div class="lead-card-foot">
        <span class="lead-card-who">${l.assignee ? esc(memberName(l.assignee)) : "Unassigned"}</span>
        ${l.source ? `<span class="lead-card-source">${esc(l.source)}${l.sourcePage ? ` · ${esc(l.sourcePage)}` : ""}</span>` : ""}
      </div>
      <label class="lead-move" data-editor-only><span class="lead-move-label">Move to</span>
        <select class="lead-move-select" aria-label="Move ${esc(l.company.name)} to stage">${options}</select></label>
    </article>`;
  }

  function render() {
    if (page.hidden) return;
    const testCount = leads.filter((l) => l.test).length;
    const shown = leads.filter((l) => l.test === showTest);
    $("leads-test-count").textContent = String(testCount);
    $("leads-filter-real").setAttribute("aria-pressed", String(!showTest));
    $("leads-filter-test").setAttribute("aria-pressed", String(showTest));
    $("leads-test-delete").hidden = !showTest || testCount === 0;
    const lanes = groupByStage(shown);
    $("leads-empty").textContent = showTest ? "No test leads." : "No leads yet. Add one with the button above.";
    $("leads-empty").hidden = shown.length > 0;
    board.innerHTML = STAGES.map((s) => `<section class="lead-lane lead-lane-${s.key}" data-stage="${s.key}" aria-label="${esc(s.label)}">
      <header class="lead-lane-head"><h3>${esc(s.label)}</h3><span class="lead-lane-count">${lanes[s.key].length}</span></header>
      <div class="lead-lane-body">${lanes[s.key].map(cardHTML).join("")}</div>
    </section>`).join("");
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

  $("leads-filter-real").addEventListener("click", () => { showTest = false; render(); });
  $("leads-filter-test").addEventListener("click", () => { showTest = true; render(); });
  // One click removes every test lead and nothing else.
  $("leads-test-delete").addEventListener("click", async () => {
    const tests = leads.filter((l) => l.test);
    if (!tests.length || !canEdit()) return;
    const btn = $("leads-test-delete");
    if (!btn.dataset.armed) { // a second click confirms, in the page (no native dialog)
      btn.dataset.armed = "1"; btn.textContent = `Click again to delete ${tests.length} test lead${tests.length === 1 ? "" : "s"}`;
      setTimeout(() => { delete btn.dataset.armed; btn.textContent = "Delete all test leads"; }, 6000);
      return;
    }
    delete btn.dataset.armed; btn.textContent = "Delete all test leads";
    try { await Promise.all(tests.map((l) => deleteDoc(doc(db, "leads", l.id)))); }
    catch (err) { showBoardError(`Couldn't delete test leads: ${err && err.message ? err.message : err}`); }
  });

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
  board.addEventListener("change", (e) => {
    const sel = e.target.closest && e.target.closest(".lead-move-select");
    if (!sel) return;
    moveTo(sel.closest(".lead-card").dataset.leadId, sel.value);
  });
  board.addEventListener("click", (e) => {
    if (e.target.closest(".lead-move")) return;
    const card = e.target.closest && e.target.closest(".lead-card");
    if (card) openLead(card.dataset.leadId);
  });
  board.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.target.closest(".lead-move")) return;
    const card = e.target.closest && e.target.closest(".lead-card");
    if (card) openLead(card.dataset.leadId);
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
    if (!window.confirm(`Delete the lead for ${l.company.name}? This cannot be undone.`)) return;
    try { await deleteDoc(doc(db, "leads", l.id)); closeLead(); } catch (err) { setError(`Couldn't delete: ${err && err.message ? err.message : err}`); }
  });

  $("lead-enrich-btn").addEventListener("click", async () => {
    if (!canEdit() || !openId) return;
    const status = $("lead-enrich-status");
    const btn = $("lead-enrich-btn");
    btn.disabled = true;
    status.textContent = "Saving, then looking the company up…";
    try {
      if (!(await persist())) { status.textContent = ""; return; }
      const resp = await fetch("/leadEnrich/v1/enrich", { method: "POST", headers: await apiHeaders(), body: JSON.stringify({ leadId: openId }) });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) { status.textContent = body.error || `Enrichment failed (HTTP ${resp.status}).`; return; }
      // Re-read what the function wrote, so the form shows it straight away.
      const snap = await getDoc(doc(db, "leads", openId));
      if (snap.exists()) {
        const l = normaliseLead(snap.id, snap.data());
        const i = leads.findIndex((x) => x.id === l.id);
        if (i >= 0) leads[i] = l;
        fill(l); renderEnrichment(l);
      }
      const added = (body.companyFieldsAdded || []).length + (body.contactsEnriched || 0);
      status.textContent = added || body.techStack ? `Done: ${body.techStack || 0} technologies, ${added} details added.` : "Done: nothing new was found.";
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

  return { start, stop, render, stageLabel, roleLabel, open: openLead };
}
