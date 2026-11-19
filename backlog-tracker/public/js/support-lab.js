// Support › Support Inbox › Test lab (#support/lab, #support/lab/case/<id>).
// Ask the answering engine a question (the one the Support Inbox and Aidan
// use), see what it would answer and what the Support Inbox would do with it,
// rate it and keep it as a test case; run every case again and watch accuracy
// over time. Nothing here sends email or files a ticket.
// Cases and runs are read straight from Firestore (supportEvalCases,
// supportEvalRuns); every change goes through /supportMail/v1/lab/**
// (functions/support-lab.js). Rules are in support-lab-core.js. Every control
// is a <button>, a link or a form field acting on click (iPad taps).
import { collection, getDocs, limit, onSnapshot, orderBy, query, where } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { confidenceBand, CONFIDENCE_LABEL, confidenceChange, pct, searchArticles } from "./support-core.js";
import {
  EXPECTS, RATINGS, RATED_TEXT, MAX_EXPECTED, normaliseCase, normaliseRun, sortCases, caseState, sourceText, caseTitle, accuracyText,
  runningRun, progressText, accuracyRows, failingCases, proposedExpect, caseProblem, caseBody,
} from "./support-lab-core.js";

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const icon = (name) => `<span class="material-symbols-outlined" aria-hidden="true">${name}</span>`;
const when = (ms) => (ms ? new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STATE_CLASS = { pass: "badge-feature", fail: "support-lab-badge-fail", wait: "badge-wp-waiting", none: "badge-status-draft" };
const editorLink = (id, title) => `<a href="#faq-article/${encodeURIComponent(id)}" class="support-lab-article">${esc(title)}</a>`;

export function mountSupportLab({ db, view, canEdit, apiHeaders, go, alert, confirm, requestRender }) {
  let cases = [], runs = [], loaded = { cases: false, runs: false }, loadError = "";
  let unsubCases = null, unsubRuns = null;
  let articles = null, articlesLoading = null;
  let route = { caseId: "" };
  // Ask: the question, the answer, and the rating being made of it.
  let ask = { subject: "", text: "", busy: false, error: "", result: null };
  let rate = blankForm();
  let saved = null; // { id } after Save to test set
  // The case open at #support/lab/case/<id>, as being edited.
  let edit = null, editError = "", editBusy = false;
  let driving = "", runError = "", runBusy = false;

  function blankForm() { return { id: "", subject: "", text: "", rating: "", expect: "", articleIds: [], note: "", pick: "", error: "" }; }
  async function post(path, body) {
    const resp = await fetch(`/supportMail/v1/${path}`, { method: "POST", headers: await apiHeaders(), body: JSON.stringify(body || {}) });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) { const err = new Error(resp.status === 504 ? "It is taking longer than a minute." : data.error || `HTTP ${resp.status}`); err.status = resp.status; throw err; }
    return data;
  }
  function start() {
    if (unsubCases) return;
    unsubCases = onSnapshot(collection(db, "supportEvalCases"), (snap) => {
      cases = sortCases(snap.docs.map((d) => normaliseCase(d.id, d.data())));
      loaded.cases = true; requestRender();
    }, (err) => { loaded.cases = true; loadError = (err && err.message) || String(err); requestRender(); });
    unsubRuns = onSnapshot(query(collection(db, "supportEvalRuns"), orderBy("startedAt", "desc"), limit(30)), (snap) => {
      runs = snap.docs.map((d) => normaliseRun(d.id, d.data()));
      loaded.runs = true; requestRender();
    }, (err) => { loaded.runs = true; loadError = (err && err.message) || String(err); requestRender(); });
    ensureArticles();
  }
  function ensureArticles() {
    if (!articlesLoading) {
      articlesLoading = getDocs(query(collection(db, "faqArticles"), where("status", "==", "published")))
        .then((snap) => { articles = snap.docs.map((d) => ({ id: d.id, ...d.data() })); requestRender(); })
        .catch(() => { articles = []; });
    }
    return articlesLoading;
  }
  const titleOf = (id) => { const a = (articles || []).find((x) => x.id === id); return a ? a.title || id : ""; };

  // ── Pieces shared by Ask and the case page ──
  const confidenceHtml = (c) => { const b = confidenceBand(c); return `<span class="support-conf support-conf-${b}">${CONFIDENCE_LABEL[b]} · ${pct(c)}</span>`; };
  function ratingHtml(form, prefix) {
    return `<div class="support-lab-choice" role="group" aria-label="Rate this answer">${RATINGS.map((r) => `<button type="button" class="btn-ghost support-lab-pill${form.rating === r.key ? " active" : ""}" data-lab-rate="${r.key}" data-lab-form="${prefix}" aria-pressed="${form.rating === r.key}">${icon(r.icon)} ${esc(r.label)}</button>`).join("")}</div>`;
  }
  function expectHtml(form, prefix) {
    const chosen = form.articleIds.map((id) => `<li class="support-lab-chip"><span>${esc(titleOf(id) || id)}</span><button type="button" class="btn-ghost support-lab-chip-x" data-lab-unpick="${esc(id)}" data-lab-form="${prefix}" aria-label="Remove ${esc(titleOf(id) || id)}">${icon("close")}</button></li>`).join("");
    const hits = form.pick.trim() ? (articles ? searchArticles(articles, form.pick, 6) : null) : [];
    const picker = form.expect !== "articles" ? "" : `
      ${chosen ? `<ul class="support-lab-chips" aria-label="Articles that should answer it">${chosen}</ul>` : `<p class="field-hint">Search for the article that should answer it (up to ${MAX_EXPECTED}).</p>`}
      ${form.articleIds.length < MAX_EXPECTED ? `<label class="um-search support-lab-search"><span class="material-symbols-outlined" aria-hidden="true">search</span>
        <input type="search" id="lab-${prefix}-pick" data-lab-form="${prefix}" placeholder="Search published articles" aria-label="Search for the article that should answer it" value="${esc(form.pick)}" autocomplete="off"></label>
      <ul class="support-faq-results" aria-label="Matching articles">${hits === null ? `<li class="interface-row-empty">Loading the Help Centre…</li>` : hits.filter((a) => !form.articleIds.includes(a.id)).map((a) => `<li><button type="button" class="support-faq-hit" data-lab-pick="${esc(a.id)}" data-lab-form="${prefix}">${icon("add")}<span><b>${esc(a.title)}</b><small>${esc(a.directAnswer || a.summary || "")}</small></span></button></li>`).join("") || (form.pick.trim() ? `<li class="interface-row-empty">No published article matches.</li>` : "")}</ul>` : ""}`;
    return `<span class="field-label">What should happen</span>
      <div class="support-lab-choice" role="group" aria-label="What should happen">${EXPECTS.map((e) => `<button type="button" class="btn-ghost support-lab-pill${form.expect === e.key ? " active" : ""}" data-lab-expect="${e.key}" data-lab-form="${prefix}" aria-pressed="${form.expect === e.key}">${esc(e.label)}</button>`).join("")}</div>
      ${picker}
      <label class="field-label" for="lab-${prefix}-note">Note <small>(what was missing)</small></label>
      <textarea id="lab-${prefix}-note" data-lab-form="${prefix}" rows="2" maxlength="1000">${esc(form.note)}</textarea>`;
  }

  // ── The lab ──
  function resultHtml(r) {
    const change = confidenceChange(r.confidenceSteps);
    const cited = new Set((r.articles || []).map((a) => a.id));
    const matched = (r.matched || []).length ? (r.matched || []).map((a) => `${editorLink(a.id, a.title || a.id)}${cited.has(a.id) ? ` <small>(used in the reply)</small>` : ""}`).join(", ") : "No article";
    return `<div class="support-draft support-lab-result" id="lab-result">
        <div class="support-draft-head">${icon("auto_awesome")}<b>The answer</b>${r.relevant === false ? `<span class="badge badge-status-draft">Not about PH</span>` : confidenceHtml(r.confidence)}
          ${r.relevant !== false && !r.answerable ? `<span class="badge badge-wp-waiting">The Help Centre doesn't answer this</span>` : ""}</div>
        ${change ? `<p class="support-conf-change">${icon("trending_up")}Confidence ${esc(change)}.</p>` : ""}
        <div class="support-draft-text">${r.draft ? esc(r.draft) : "No reply drafted."}</div>
        <dl class="support-lab-facts">
          <div><dt>Matched</dt><dd>${matched}</dd></div>
          <div><dt>Support Inbox</dt><dd><b id="lab-decision">${esc(r.decision.label)}</b>: ${esc(r.decision.reason)}</dd></div>
        </dl>
      </div>`;
  }
  function askHtml() {
    if (!canEdit()) return `<p class="field-hint">Asking a question needs edit access to the Support Inbox.</p>`;
    return `<div class="support-set-grid support-lab-ask">
        <label class="field-label" for="lab-subject">Subject <small>(optional)</small></label>
        <input type="text" id="lab-subject" maxlength="300" value="${esc(ask.subject)}" autocomplete="off">
        <label class="field-label" for="lab-text">Question</label>
        <textarea id="lab-text" rows="4" placeholder="Write it as a customer would">${esc(ask.text)}</textarea>
        ${ask.error ? `<p class="support-problem" role="alert">${esc(ask.error)}</p>` : ""}
        <div class="support-send"><button type="button" class="btn-primary" data-lab-act="ask"${ask.busy ? " disabled" : ""}>${ask.busy ? "Asking…" : "Ask"}</button>
          ${ask.busy ? `<span class="field-hint" role="status">The answer takes about 20 seconds. Nothing is sent.</span>` : ""}</div>
      </div>
      ${ask.result ? `${resultHtml(ask.result)}
      <div class="support-lab-rate">
        <span class="field-label">Rate this answer</span>${ratingHtml(rate, "rate")}
        ${expectHtml(rate, "rate")}
        ${rate.error ? `<p class="support-problem" role="alert">${esc(rate.error)}</p>` : ""}
        <div class="support-send"><button type="button" class="btn-primary" data-lab-act="save-ask">Save to test set</button>
          ${saved ? `<span class="support-compose-sent" role="status">${icon("check_circle")}<span>Saved to the test set.</span><button type="button" class="support-link" data-lab-case="${esc(saved.id)}">Open the case</button></span>` : ""}</div>
      </div>` : ""}`;
  }
  function setHtml() {
    const live = runningRun(runs);
    const runnable = cases.filter((c) => !c.needsReview && c.expect).length;
    const review = cases.length - runnable;
    const rows = accuracyRows(runs);
    const failing = failingCases(runs, cases, titleOf);
    const runBtn = !canEdit() ? "" : `<button type="button" class="btn-primary" data-lab-act="run"${driving || runBusy || !runnable ? " disabled" : ""}>${icon("replay")} ${live && !driving ? "Continue the run" : "Run all cases"}</button>`;
    return `<p class="um-count support-lab-count"><b>${cases.length}</b> case${cases.length === 1 ? "" : "s"}${review ? ` · ${review} need${review === 1 ? "s" : ""} review` : ""}</p>
      <div class="support-send support-lab-runbar">${runBtn}
        ${live ? `<span class="support-lab-progress" role="status" id="lab-progress">${esc(progressText(live))}</span>` : ""}</div>
      ${runError ? `<p class="support-problem" role="alert">${esc(runError)}</p>` : ""}
      <h4 class="support-lab-h4">Accuracy over time</h4>
      ${rows.length ? `<ol class="support-lab-runs" aria-label="Accuracy of each run, oldest first">${rows.map((r) => `<li class="support-lab-run">
          <span class="support-lab-run-when">${esc(when(r.at))}</span>
          <span class="support-lab-bar" role="img" aria-label="${esc(accuracyText(r.accuracy))} accurate"><span style="width:${Math.round((r.accuracy || 0) * 100)}%"></span></span>
          <b class="support-lab-run-acc">${esc(accuracyText(r.accuracy))}</b>
          <span class="support-lab-run-counts">${r.passed} passed · ${r.failed} failed</span></li>`).join("")}</ol>` : `<p class="field-hint">No run yet. Run all cases to see how accurate the answers are.</p>`}
      <h4 class="support-lab-h4">Failing cases${failing.run ? ` <small>in the run of ${esc(when(failing.run.finishedAt || failing.run.startedAt))}</small>` : ""}</h4>
      ${failing.rows.length ? `<ul class="support-lab-failing" aria-label="Failing cases">${failing.rows.map((f) => `<li>
          ${f.exists ? `<button type="button" class="support-link support-lab-fail-title" data-lab-case="${esc(f.id)}">${esc(f.title)}</button>` : `<b>${esc(f.title)}</b>`}
          <dl class="support-lab-facts"><div><dt>Expected</dt><dd>${esc(f.expected)}</dd></div><div><dt>Matched</dt><dd>${esc(f.matched)}</dd></div>${f.problem ? `<div><dt>Problem</dt><dd>${esc(f.problem)}</dd></div>` : ""}</dl></li>`).join("")}</ul>`
        : `<p class="field-hint">${failing.run ? "Every case passed in the latest run." : "None yet."}</p>`}
      <h4 class="support-lab-h4">Cases</h4>
      ${cases.length ? `<ul class="support-list support-lab-cases" aria-label="Cases">${cases.map((c) => { const s = caseState(c); return `<li class="support-li"><button type="button" class="support-row support-lab-case" data-lab-case="${esc(c.id)}">
          <span class="support-row-main"><span class="support-row-subject">${esc(caseTitle(c))}</span><span class="support-row-from">${esc(sourceText(c))}</span></span>
          <span class="support-row-side"><span class="support-row-badges"><span class="badge ${STATE_CLASS[s.tone]}">${esc(s.label)}</span>${c.rating ? `<span class="badge badge-status-draft">${esc(RATED_TEXT[c.rating])}</span>` : ""}</span></span></button></li>`; }).join("")}</ul>`
        : `<p class="field-hint">No cases yet. Ask a question and save it, or use Add to test lab on a ticket.</p>`}`;
  }
  function labHtml() {
    if (loadError) return `<p class="support-problem" role="alert">The test lab didn't load: ${esc(loadError)}</p>`;
    return `<div class="support-lab">
      <section class="support-lab-block" aria-labelledby="lab-ask-h"><h3 class="support-compose-h" id="lab-ask-h">Ask a question<button type="button" class="info-tip" data-tip="The question goes through the same answering engine as the Support Inbox and Aidan, as a customer's first email to support@: it matches the published Help Centre, drafts a reply and scores it. Below the answer is what the Support Inbox would do with it today. Nothing is sent and no ticket is filed. Rate the answer and save it to keep it in the test set." aria-label="About Ask a question">i</button></h3>
        ${askHtml()}</section>
      <section class="support-lab-block" aria-labelledby="lab-set-h"><h3 class="support-compose-h" id="lab-set-h">Test set<button type="button" class="info-tip" data-tip="Every saved case with what should happen. Run all cases asks the engine each question again and records how many it got right. A case passes when the engine picks one of the expected articles, says no article answers it when none does, or leaves alone a question that isn't about Personalisation Hub. A case copied from a ticket needs review until someone says what should happen." aria-label="About the test set">i</button></h3>
        ${loaded.cases && loaded.runs ? setHtml() : `<p class="interface-row-empty">Loading…</p>`}</section>
    </div>`;
  }

  // ── One case ──
  function caseHtml() {
    const back = `<button type="button" class="btn-ghost support-back" data-lab-act="back">${icon("arrow_back")} Test lab</button>`;
    if (!loaded.cases) return `${back}<p class="interface-row-empty">Loading…</p>`;
    const c = cases.find((x) => x.id === route.caseId);
    if (!c) return `${back}<p class="interface-row-empty">That case was deleted.</p>`;
    if (!edit || edit.id !== c.id) edit = { ...blankForm(), id: c.id, subject: c.subject, text: c.text, rating: c.rating, expect: c.expect, articleIds: c.articleIds.slice(), note: c.note };
    const s = caseState(c);
    const can = canEdit();
    const result = c.lastResult ? `<dl class="support-lab-facts"><div><dt>Last run</dt><dd><span class="badge ${STATE_CLASS[s.tone]}">${esc(s.label)}</span>${c.lastResult.problems.filter((p) => p !== "error").length ? ` ${esc(c.lastResult.problems.join("; "))}` : c.lastResult.error ? ` Couldn't be run: ${esc(c.lastResult.error)}` : ""}</dd></div>
        <div><dt>Matched</dt><dd>${c.lastResult.chosen.length ? c.lastResult.chosen.map((id) => editorLink(id, titleOf(id) || id)).join(", ") : "No article"}</dd></div></dl>` : "";
    const readOnly = `<dl class="support-lab-facts"><div><dt>Rating</dt><dd>${esc(RATED_TEXT[c.rating] || "Not rated")}</dd></div>
        <div><dt>Should happen</dt><dd>${c.expect === "articles" ? c.articleIds.map((id) => editorLink(id, titleOf(id) || id)).join(", ") : esc((EXPECTS.find((e) => e.key === c.expect) || { label: "Not decided yet" }).label)}</dd></div>
        ${c.note ? `<div><dt>Note</dt><dd>${esc(c.note)}</dd></div>` : ""}</dl>`;
    return `<div class="support-lab support-lab-case-page">
      ${back}
      <div class="support-ticket-head"><h3>${esc(caseTitle(c))}</h3>
        <div class="support-ticket-meta"><span class="badge ${STATE_CLASS[s.tone]}">${esc(s.label)}</span><span>${esc(sourceText(c))}</span>
          ${c.ticketId ? `<a class="support-link" href="#support${c.source === "aidan" ? "/aidan" : ""}/ticket/${encodeURIComponent(c.ticketId)}">Open the ticket</a>` : ""}</div></div>
      ${c.needsReview || !c.expect ? `<p class="support-lab-review" role="note">${icon("pending_actions")}<span>Needs review: say what should happen and save. Until then the case is left out of runs.</span></p>` : ""}
      ${can ? `<div class="support-set-grid">
        <label class="field-label" for="lab-case-subject">Subject</label>
        <input type="text" id="lab-case-subject" maxlength="300" value="${esc(edit.subject)}" autocomplete="off">
        <label class="field-label" for="lab-case-text">Question</label>
        <textarea id="lab-case-text" rows="5">${esc(edit.text)}</textarea></div>`
        : `<div class="support-msg support-msg-in"><div class="support-msg-head"><b>Question</b></div><div class="support-msg-body">${esc(c.text)}</div></div>`}
      ${c.finalAnswer ? `<div class="support-msg support-msg-out support-lab-sent"><div class="support-msg-head"><b>The answer that was sent</b><small>${esc(c.answeredBy === "ai" ? "by the AI" : c.answeredBy === "aidan" ? "by Aidan" : "by a person")}</small></div><div class="support-msg-body">${esc(c.finalAnswer)}</div></div>` : ""}
      ${result}
      ${can ? `<div class="support-lab-rate"><span class="field-label">Rating</span>${ratingHtml(edit, "case")}${expectHtml(edit, "case")}
        ${editError ? `<p class="support-problem" role="alert">${esc(editError)}</p>` : ""}
        <div class="support-send"><button type="button" class="btn-primary" data-lab-act="save-case"${editBusy ? " disabled" : ""}>Save</button>
          <button type="button" class="btn-ghost" data-lab-act="delete-case"${editBusy ? " disabled" : ""}>${icon("delete")} Delete</button></div></div>` : readOnly}
    </div>`;
  }

  function render() {
    view.innerHTML = route.caseId ? caseHtml() : labHtml();
  }

  // ── Actions ──
  const formOf = (prefix) => (prefix === "case" ? edit : rate);
  async function doAsk() {
    if (ask.busy) return;
    ask.error = ask.text.trim() ? "" : "Write the question first.";
    if (ask.error) return requestRender(true);
    ask.busy = true; ask.result = null; saved = null; rate = blankForm();
    requestRender(true);
    try {
      ask.result = await post("lab/ask", { subject: ask.subject.trim(), text: ask.text });
      rate = { ...blankForm(), ...proposedExpect(ask.result) };
    } catch (err) { ask.error = `No answer: ${err.message}`; }
    ask.busy = false;
    requestRender(true);
  }
  async function saveAsk() {
    rate.error = caseProblem({ text: ask.text, expect: rate.expect, articleIds: rate.articleIds });
    if (rate.error) return requestRender(true);
    const r = ask.result;
    try {
      const out = await post("lab/cases", caseBody({ ...rate, subject: ask.subject, text: ask.text }, { articleIds: (r.matched || []).map((a) => a.id), confidence: r.confidence }));
      saved = { id: out.id };
    } catch (err) { rate.error = `Not saved: ${err.message}`; }
    requestRender(true);
  }
  async function saveCase() {
    editError = caseProblem(edit);
    if (editError) return requestRender(true);
    editBusy = true; requestRender(true);
    try { await post("lab/cases", caseBody(edit)); edit = null; editError = ""; }
    catch (err) { editError = `Not saved: ${err.message}`; }
    editBusy = false;
    requestRender(true);
  }
  async function deleteCase() {
    if (!(await confirm("Delete this case from the test set? Runs already recorded keep their counts.", { title: "Delete case", okLabel: "Delete", danger: true }))) return;
    try { await post(`lab/cases/${encodeURIComponent(edit.id)}/delete`); edit = null; go("#support/lab"); }
    catch (err) { await alert(`The case wasn't deleted: ${err.message}`); }
  }
  // Run all cases: start (or continue) a run, then step through it from this
  // tab until it is done. Progress shows from the run document, for everyone.
  async function runAll() {
    if (driving || runBusy) return;
    runError = ""; runBusy = true; requestRender(true);
    let id = "";
    try { id = (await post("lab/runs")).id; }
    catch (err) { runError = `The run didn't start: ${err.message}`; }
    runBusy = false;
    if (!id) return requestRender(true);
    driving = id; requestRender(true);
    let slow = 0;
    for (;;) {
      let r;
      try { r = await post(`lab/runs/${encodeURIComponent(id)}/step`); slow = 0; }
      catch (err) {
        // The console's address cuts a call off after a minute; the step carries on and is recorded.
        if (err.status === 504 && slow++ < 5) { await sleep(3000); continue; }
        runError = `The run stopped: ${err.message}. Run all cases continues it.`; break;
      }
      if (r.status !== "running") break;
      if (!r.remaining && r.running) await sleep(4000);
    }
    driving = "";
    requestRender(true);
  }

  const inLab = (el) => el && view.contains(el) && view.querySelector(".support-lab");
  view.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || !inLab(b)) return;
    const prefix = b.dataset.labForm;
    if (b.dataset.labCase) { edit = null; editError = ""; return go(`#support/lab/case/${encodeURIComponent(b.dataset.labCase)}`); }
    if (prefix && formOf(prefix)) {
      const f = formOf(prefix);
      if (b.dataset.labRate) f.rating = f.rating === b.dataset.labRate ? "" : b.dataset.labRate;
      else if (b.dataset.labExpect) f.expect = b.dataset.labExpect;
      else if (b.dataset.labPick && f.articleIds.length < MAX_EXPECTED && !f.articleIds.includes(b.dataset.labPick)) { f.articleIds.push(b.dataset.labPick); f.pick = ""; }
      else if (b.dataset.labUnpick) f.articleIds = f.articleIds.filter((x) => x !== b.dataset.labUnpick);
      f.error = ""; if (prefix === "case") editError = "";
      return requestRender(true);
    }
    const a = b.dataset.labAct;
    if (a === "ask") return doAsk();
    if (a === "save-ask") return saveAsk();
    if (a === "run") return runAll();
    if (a === "back") { edit = null; editError = ""; return go("#support/lab"); }
    if (a === "save-case") return saveCase();
    if (a === "delete-case") return deleteCase();
  });
  view.addEventListener("input", (e) => {
    const el = e.target;
    if (!inLab(el)) return;
    if (el.id === "lab-subject") ask.subject = el.value;
    else if (el.id === "lab-text") ask.text = el.value;
    else if (el.id === "lab-case-subject" && edit) edit.subject = el.value;
    else if (el.id === "lab-case-text" && edit) edit.text = el.value;
    else if (el.dataset.labForm && formOf(el.dataset.labForm)) {
      const f = formOf(el.dataset.labForm);
      if (el.id.endsWith("-note")) f.note = el.value;
      else if (el.id.endsWith("-pick")) {
        f.pick = el.value;
        // Only the results list is redrawn, so the caret stays in the box.
        const list = el.closest("label").nextElementSibling;
        const hits = articles ? searchArticles(articles, f.pick, 6).filter((x) => !f.articleIds.includes(x.id)) : [];
        if (list) list.innerHTML = hits.map((x) => `<li><button type="button" class="support-faq-hit" data-lab-pick="${esc(x.id)}" data-lab-form="${el.dataset.labForm}">${icon("add")}<span><b>${esc(x.title)}</b><small>${esc(x.directAnswer || x.summary || "")}</small></span></button></li>`).join("") || (f.pick.trim() ? `<li class="interface-row-empty">${articles ? "No published article matches." : "Loading the Help Centre…"}</li>` : "");
      }
    }
  });

  return {
    show(r) { route = { caseId: r.caseId || "" }; start(); },
    render,
    busy: () => ask.busy || !!driving,
  };
}
