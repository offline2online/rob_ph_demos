// Support › Support Inbox (#support) and Settings › Support inbox.
// Three inboxes, one tab each (Support Inbox, Hello, Aidan): the address an
// email was written to decides which it is filed under (support-core.js).
// Only the Support Inbox has queues, triage and suggested replies. Hello and
// Aidan are plain inboxes: an email list and the thread, with Reply (and, in
// Aidan, what Aidan did with each thread).
// The email icon in the header writes a new email from the mailbox (#support/compose).
// Tickets are read straight from Firestore (supportTickets + messages); every
// change goes through the supportMail function (/supportMail/v1/**), which
// sends the email, keeps Gmail in step and records who did what. Rules are in
// support-core.js. Every control is a <button> acting on click (iPad taps).
// Every list has a checkbox on each row and one above it (select all shown):
// the selection bar then offers that inbox's actions for all of them at once,
// sent to /supportMail/v1/tickets/bulk in batches, with one message at the end.
import { collection, doc, getDocs, limit, onSnapshot, orderBy, query, where } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import {
  QUEUES, STATUS_LABEL, CATEGORY_LABEL, DEFAULT_QUEUE, queueCounts, normaliseTicket, filterTickets, supportHash, toMs,
  fmtWhen, searchArticles, articleSnippet, articleUrl, draftSource, composeProblem,
  confidenceBand, CONFIDENCE_LABEL, confidenceChange, pct, INBOXES, DEFAULT_INBOX, inboxOf, inInbox,
  aidanView, aidanThreadState, aidanCollateral, aidanParts, spamConfirmText, isPlainInbox, isUnread, plainInboxRows, plainInboxCounts,
  MARKED_UNREAD, isMarkedUnread, bulkActions, bulkAction, BULK_MOVES, bulkSpamConfirmText, bulkResultText, keepSelected,
} from "./support-core.js";

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const icon = (name) => `<span class="material-symbols-outlined" aria-hidden="true">${name}</span>`;
const LIST_LIMIT = 500;
const SYNC_EVERY_MS = 3 * 60 * 1000;
// Threads per bulk call: each call must finish inside the console address's one-minute limit.
const BULK_CHUNK = 25;
// The confidence beside a suggested reply: a word and a number, coloured by band.
const confidenceHtml = (c, { short } = {}) => { const b = confidenceBand(c); return `<span class="support-conf support-conf-${b}" title="How sure the AI is that this reply is correct and complete">${short ? `AI draft · ${pct(c)}` : `${CONFIDENCE_LABEL[b]} · ${pct(c)}`}</span>`; };
const confidenceChangeHtml = (steps) => { const t = confidenceChange(steps); return t ? `<p class="support-conf-change">${icon("trending_up")}Confidence ${esc(t)}.</p>` : ""; };
const fullDate = (ms) => (ms ? new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
// Aidan, the agent mailbox (aidan@): its state on a ticket, and the reply it sent to everyone on the email.
const AIDAN_TONE = { done: "badge-feature", working: "badge-status-draft", attention: "badge-wp-waiting", none: "badge-status-draft" };
// The state badge, then what was asked for: Answer, Write or Store.
const aidanBadge = (t) => { const v = aidanView(t.aidan); return v ? `<span class="badge ${AIDAN_TONE[v.tone]} support-aidan-badge">${esc(v.badge)}</span>${v.kind ? `<span class="badge badge-status-draft support-aidan-kind" title="What Aidan was asked to do">${esc(v.kind)}</span>` : ""}` : ""; };
// The Aidan tab: every thread carries a state, "no action" included, then what was asked for.
const aidanStateBadge = (t) => { const v = aidanThreadState(t.aidan, { spam: t.status === "spam" }); return `<span class="badge ${AIDAN_TONE[v.tone]} support-aidan-badge">${esc(v.badge)}</span>${v.kind ? `<span class="badge badge-status-draft support-aidan-kind" title="What Aidan was asked to do">${esc(v.kind)}</span>` : ""}`; };
// Which threads this browser has opened, and when (the unread state of Hello and Aidan). Per browser, best effort.
const OPENED_KEY = "bt-support-opened";
function readOpened() { try { const v = JSON.parse(localStorage.getItem(OPENED_KEY) || "{}"); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; } }
function writeOpened(map) { try { localStorage.setItem(OPENED_KEY, JSON.stringify(Object.fromEntries(Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 600)))); } catch { /* private window: unread falls back to "not yet answered" */ } }
// The Help Centre articles a reply was written from, as links (an article hidden from the website has no page to link to).
const sourcesHtml = (articles) => `<div class="support-draft-sources">From: ${articles.map((a) => (a.url === "" ? `<span title="Hidden from the website">${esc(a.title)} (not on the website)</span>` : `<a href="${esc(a.url || articleUrl(a.id))}" target="_blank" rel="noopener">${esc(a.title)}</a>`)).join(", ")}</div>`;
// An answer Aidan took from the Help Centre: the confidence and the matched articles (on the ticket only, never in his email).
const aidanSourcesHtml = (v) => (v && v.helpCentre ? `<div class="support-aidan-sources">${confidenceHtml(v.helpCentre.confidence)}${sourcesHtml(v.helpCentre.articles)}</div>${confidenceChangeHtml(v.helpCentre.confidenceSteps)}` : "");
// Which part of the email was the instruction and which the content (OrkZBBjz9RM5DY54azIG):
// shown when Aidan was asked about the thread ("answer John's question below"). Text only, no controls.
function aidanPartsHtml(aidan) {
  const p = aidanParts(aidan);
  if (!p) return "";
  return `<dl class="support-aidan-parts" aria-label="What Aidan read">
      <div class="support-aidan-part"><dt>${icon("input")}Instruction</dt><dd>${esc(p.instruction)}<small>From the sender's new text. Only this is acted on.</small></dd></div>
      <div class="support-aidan-part"><dt>${icon("notes")}Content</dt><dd>${esc(p.content.line)}${p.content.preview ? `<q class="support-aidan-quote">${esc(p.content.preview)}</q>` : ""}</dd></div>
      ${p.ignored.length ? `<div class="support-aidan-part support-aidan-ignored"><dt>${icon("block")}Ignored</dt><dd>Aidan: ignored instruction in quoted text. It changed nothing: not the kind of reply, the skill or who it went to.<ul>${p.ignored.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></dd></div>` : ""}
    </dl>`;
}
// Branded collateral (JtkLrEG0aTnC5JfkdPA1): what was written, the PDF and its
// Markdown source, whether it was kept for the skill, and what was taken out. Text only.
function aidanCollateralHtml(aidan) {
  const c = aidanCollateral(aidan);
  if (!c) return "";
  return `<dl class="support-aidan-collateral" aria-label="Collateral Aidan wrote">
      <div class="support-aidan-coll-row"><dt>${icon("picture_as_pdf")}Collateral</dt><dd>${esc(c.about)}${c.unsent ? "<small>Not sent: the PDF couldn't be made. The Markdown is on the thread as an internal note.</small>" : ""}</dd></div>
      ${c.files.length ? `<div class="support-aidan-coll-row"><dt>${icon("attach_file")}Files</dt><dd><ul class="support-aidan-files">${c.files.map((f) => `<li><b>${esc(f.name)}</b> <small>${esc(f.detail)}</small></li>`).join("")}</ul>${c.unsent ? "" : "<small>Attached to Aidan's reply (open in Gmail).</small>"}</dd></div>` : ""}
      ${c.kept ? `<div class="support-aidan-coll-row"><dt>${icon("bookmark")}Kept</dt><dd>As a reference example for the skill, so later collateral stays consistent.</dd></div>` : ""}
      ${c.removed.length ? `<div class="support-aidan-coll-row"><dt>${icon("rule")}Removed</dt><dd>Before it was sent: ${esc(c.removed.join(", "))}.</dd></div>` : ""}
    </dl>`;
}
const aidanLine = (t) => { const v = aidanView(t.aidan); return v ? `<p class="support-summary support-aidan-line">${icon("smart_toy")}${esc(v.line)}</p>${aidanSourcesHtml(v)}${aidanPartsHtml(t.aidan)}${aidanCollateralHtml(t.aidan)}` : ""; };
function aidanMessageHtml(m, at) {
  const files = (m.attachments || []).length ? `<div class="support-msg-files">${icon("attach_file")}${m.attachments.map((a) => esc(a.name)).join(", ")} <small>(open in Gmail)</small></div>` : "";
  return `<li class="support-msg support-msg-out support-msg-aidan"><div class="support-msg-head"><b>Aidan</b><span class="badge badge-feature">Sent by Aidan${m.kind === "answer" ? " · Answer" : ""}${m.skillName ? ` · ${esc(m.skillName)}` : ""}</span><small>${esc(fullDate(at))}</small></div>
    <div class="support-msg-addr">To ${esc((m.to || []).join(", "))}${(m.cc || []).length ? ` · Cc ${esc(m.cc.join(", "))}` : ""}</div>
    <div class="support-msg-body">${esc(m.text)}</div>${files}</li>`;
}

async function api(apiHeaders, path, { method = "POST", body } = {}) {
  const resp = await fetch(`/supportMail/v1/${path}`, { method, headers: await apiHeaders(), ...(method === "GET" ? {} : { body: JSON.stringify(body || {}) }) });
  const data = await resp.json().catch(() => ({}));
  // The console's address cuts a call off after a minute; the server carries on (a first sync of a full mailbox can take longer).
  if (resp.status === 504) throw new Error("It is taking longer than a minute and is carrying on in the background. Look again shortly.");
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
  return data;
}

// ── The page ──────────────────────────────────────────────────────────────
export function mountSupportPage({ db, canEdit, apiHeaders, go, alert, confirm, openSettings, openKanbanTicket }) {
  const $ = (id) => document.getElementById(id);
  const view = $("support-view");
  let tickets = [], loaded = false, listError = "";
  let route = { view: "inbox", inbox: DEFAULT_INBOX, queue: DEFAULT_QUEUE, ticketId: "" };
  // The inbox on show: Support Inbox, Hello or Aidan, each with its own tab,
  // queues, counts and tickets. An open ticket shows under the tab it was
  // opened from, or under its own first inbox when it isn't in that one
  // (a link made elsewhere, such as the Staff Kanban ticket's).
  const inboxKey = () => {
    const key = inboxOf(route.inbox).key;
    const t = route.view === "ticket" ? tickets.find((x) => x.id === route.ticketId) : null;
    return t && !inInbox(t, key) ? t.inboxes[0] : key;
  };
  // The Support Inbox tab keeps its first name ("inbox"); the others are named after their inbox.
  const tabOf = (key) => (key === DEFAULT_INBOX ? "inbox" : key);
  let search = "";
  let status = null, statusError = "";
  let messages = [], messagesFor = "", unsubMessages = null, unsubTickets = null;
  let members = null, articles = null;
  let composer = { ticketId: "", text: "", usedDraft: false, faq: "" };
  let busy = false, syncTimer = null, visible = false, stale = false;
  const opened = readOpened();
  // The rows ticked on the list on show, and the message left by the last
  // action on them. Both go when the tab or queue changes (show()); a redraw
  // from new data keeps the ticks of every thread still in the list.
  let selected = new Set(), bulkResult = "", listKey = "";

  function start() {
    if (unsubTickets) return;
    unsubTickets = onSnapshot(query(collection(db, "supportTickets"), orderBy("lastMessageAt", "desc"), limit(LIST_LIMIT)), (snap) => {
      tickets = snap.docs.map((d) => normaliseTicket(d.id, d.data()));
      loaded = true; listError = "";
      render();
    }, (err) => { loaded = true; listError = (err && err.message) || String(err); render(); });
    loadStatus();
  }
  async function loadStatus() {
    try { status = await api(apiHeaders, "status", { method: "GET" }); statusError = ""; }
    catch (err) { statusError = err.message; }
    render();
  }
  function watchMessages(ticketId) {
    if (messagesFor === ticketId && unsubMessages) return;
    if (unsubMessages) unsubMessages();
    messages = []; messagesFor = ticketId;
    unsubMessages = onSnapshot(collection(db, "supportTickets", ticketId, "messages"), (snap) => {
      messages = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => toMs(a.at) - toMs(b.at));
      if (route.view === "ticket" && route.ticketId === ticketId) renderThread();
    }, (err) => console.warn("backlog-tracker: support messages", err));
  }
  let membersLoading = null;
  function ensureMembers() {
    if (!membersLoading) membersLoading = loadMembers();
    return membersLoading;
  }
  async function loadMembers() {
    if (members) return members;
    try { members = (await getDocs(collection(db, "memberDirectory"))).docs.map((d) => d.data() || {}).filter((m) => m.email && !m.disabled).map((m) => ({ email: String(m.email).toLowerCase(), name: m.displayName || m.email })); }
    catch { members = []; }
    return members;
  }
  async function ensureArticles() {
    if (articles) return articles;
    const snap = await getDocs(query(collection(db, "faqArticles"), where("status", "==", "published")));
    articles = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return articles;
  }

  // Read new mail: quietly on a timer while the page is open, loudly from the button.
  async function sync({ quiet } = {}) {
    if (!canEdit() || !status || !status.connected) return;
    const btn = $("support-sync-btn");
    if (!quiet) { btn.disabled = true; btn.textContent = "Syncing…"; }
    try { await api(apiHeaders, "sync"); }
    catch (err) { if (!quiet) await alert(`New mail couldn't be read: ${err.message}`); }
    if (!quiet) { btn.disabled = false; btn.textContent = "Sync now"; }
    loadStatus();
  }

  // ── Rendering ──
  function headerLine() {
    const el = $("support-count");
    if (statusError) { el.textContent = `The mailbox status didn't load: ${statusError}`; return; }
    if (!status) { el.textContent = ""; return; }
    if (!status.connected) { el.textContent = "No mailbox is connected."; return; }
    const plain = isPlainInbox(inboxKey());
    const c = plain ? plainInboxCounts(tickets, inboxKey(), opened) : queueCounts(tickets, inboxKey());
    const problem = status.connectionError || (!status.lastSyncOk && status.lastSyncError ? `Last sync failed: ${status.lastSyncError}` : "");
    el.innerHTML = (plain ? `<b>${c.unread}</b> unread` : `<b>${c["needs-person"]}</b> need a person · <b>${c["ai-drafts"]}</b> AI drafts to approve`) + ` · ${esc(status.connectedEmail)}`
      + (status.lastSyncAt ? ` · synced ${esc(fmtWhen(Date.parse(status.lastSyncAt)))}` : " · not synced yet")
      + (problem ? ` · <span class="support-problem">${esc(problem)}</span>` : "");
  }
  // Someone typing in the page (a reply, a search, the assign list open). On the
  // iPad, rebuilding the field under them closes the keyboard and drops the
  // caret, so a redraw that nobody asked for waits until they leave the field.
  // A ticked checkbox is not typing: the list redraws under it and keeps the tick.
  const typing = () => { const a = document.activeElement; return !!a && view.contains(a) && /^(TEXTAREA|INPUT|SELECT)$/.test(a.tagName) && a.type !== "checkbox"; };
  // The checkbox that has the focus, found again after a redraw (keyboard users keep their place).
  const focusedPick = () => { const a = document.activeElement; return !a || !view.contains(a) ? "" : a.id === "support-pick-all" ? "#support-pick-all" : a.dataset.supportPick ? `[data-support-pick="${CSS.escape(a.dataset.supportPick)}"]` : ""; };
  const refocus = (sel) => { const el = sel && view.querySelector(sel); if (el && el !== document.activeElement) el.focus({ preventScroll: true }); };
  // `force`: the person just did something (opened a page, pressed a button), so draw now.
  function render(force) {
    if (!visible) return;
    headerLine();
    if (!force && typing()) { stale = true; return; }
    stale = false;
    const focused = focusedPick();
    draw();
    refocus(focused);
  }
  function draw() {
    document.querySelectorAll("[data-support-tab]").forEach((b) => {
      const on = b.dataset.supportTab === tabOf(inboxKey());
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", String(on));
    });
    $("support-sync-btn").hidden = !(status && status.connected);
    $("support-compose-btn").hidden = !(status && status.connected);
    if (status && !status.connected && !tickets.length) {
      view.innerHTML = `<div class="support-empty">${icon("mark_email_unread")}<p>Connect the support mailbox to start receiving tickets.</p>
        <button type="button" class="btn-primary" data-support-act="open-settings">Open Settings</button></div>`;
      return;
    }
    if (listError) { view.innerHTML = `<p class="support-problem" role="alert">Tickets didn't load: ${esc(listError)}</p>`; return; }
    if (!loaded) { view.innerHTML = `<p class="interface-row-empty">Loading…</p>`; return; }
    if (route.view === "compose") renderCompose();
    else if (route.view === "ticket") (isPlainInbox(inboxKey()) ? renderPlainTicket : renderTicket)();
    else if (isPlainInbox(route.inbox)) renderPlainInbox();
    else renderInbox();
  }

  function badges(t) {
    const out = [];
    if (t.highValue) out.push(`<span class="badge support-badge-hv" title="${esc(t.account ? `${t.account.name} · ${t.account.reason}` : "High-value sender")}">High value</span>`);
    if (t.automated) out.push(`<span class="badge badge-status-draft" title="Sent by a machine (${esc(t.automated)}), so it is never answered automatically">Automated</span>`);
    if (t.unrelated) out.push(`<span class="badge badge-status-draft" title="Not about Personalisation Hub, so no reply was drafted">Not about PH</span>`);
    if (t.spamLikely && t.status !== "spam") out.push(`<span class="badge badge-wp-waiting">Looks like spam</span>`);
    if (t.category && t.category !== "automated" && t.category !== "unrelated") out.push(`<span class="badge badge-status-draft">${esc(CATEGORY_LABEL[t.category] || t.category)}</span>`);
    if (t.aiDraft && t.status === "open") out.push(confidenceHtml(t.aiDraft.confidence, { short: true }));
    if (t.resolvedBy === "ai" && !t.humanInvolved && t.status === "resolved") out.push(`<span class="badge badge-feature">Answered by AI</span>`);
    if (t.triagePending) out.push(`<span class="badge badge-status-draft">Sorting…</span>`);
    if (t.aidan) out.push(aidanBadge(t));
    return out.join("");
  }

  function renderInbox() {
    const counts = queueCounts(tickets, route.inbox);
    const rail = QUEUES.map((q) => `<button type="button" class="support-queue${q.key === route.queue ? " active" : ""}" data-support-queue="${q.key}" ${q.key === route.queue ? 'aria-current="true"' : ""}>
      ${icon(q.icon)}<span class="support-queue-label">${esc(q.label)}</span><span class="support-queue-count">${counts[q.key]}</span></button>`).join("");
    view.innerHTML = `<div class="support-inbox"><nav class="support-queues" aria-label="${esc(inboxOf(route.inbox).label)} queues">${rail}</nav>
      <div class="support-list-wrap">
        <label class="um-search support-search"><span class="material-symbols-outlined" aria-hidden="true">search</span>
          <input type="search" id="support-search" placeholder="Search tickets" aria-label="Search tickets" value="${esc(search)}"></label>
        ${bulkBarHtml()}
        <ul class="support-list" id="support-list" aria-label="Tickets"></ul>
        ${tickets.length >= LIST_LIMIT ? `<p class="field-hint">Showing the ${LIST_LIMIT} most recently active tickets.</p>` : ""}
      </div></div>`;
    renderList();
    if (canEdit() && !members) ensureMembers().then(() => { if (route.view === "inbox" && !typing()) renderBulk(); });
  }
  // ── Selecting several threads ──
  // The list on show: `withSearch` false is every thread in it, whatever the search box hides.
  const listRows = (withSearch = true) => (isPlainInbox(route.inbox)
    ? plainInboxRows(tickets, route.inbox, withSearch ? search : "", route.queue)
    : filterTickets(tickets, route.queue, withSearch ? search : "", route.inbox));
  // The row's own checkbox: a labelled control beside the row's button, so the row still opens the thread.
  const pickHtml = (t) => (canEdit() ? `<label class="support-pick"><input type="checkbox" class="no-switch" data-support-pick="${esc(t.id)}" aria-label="Select ${esc(t.subject)}"${selected.has(t.id) ? " checked" : ""}></label>` : "");
  const bulkBarHtml = () => (canEdit() ? `<div class="support-bulk" id="support-bulk" role="group" aria-label="Selection"></div>` : "");
  function renderBulk() {
    const bar = $("support-bulk");
    if (!bar) return;
    const shown = listRows();
    const n = selected.size;
    const picked = shown.filter((t) => selected.has(t.id)).length;
    const control = (a) => {
      if (a.pick === "member") return `<select class="support-bulk-pick" data-support-bulk-pick="${a.key}" aria-label="Assign the selected tickets to"><option value="">Assign to…</option><option value="__none">No one</option>${(members || []).map((m) => `<option value="${esc(m.email)}">${esc(m.name)}</option>`).join("")}</select>`;
      if (a.pick === "move") return `<select class="support-bulk-pick" data-support-bulk-pick="${a.key}" aria-label="Move the selected tickets to"><option value="">Move to…</option>${BULK_MOVES.map((m) => `<option value="${m.key}">${esc(m.label)}</option>`).join("")}</select>`;
      return `<button type="button" class="btn-ghost" data-support-bulk="${a.key}">${icon(a.icon)} ${esc(a.label)}</button>`;
    };
    const focused = focusedPick();
    bar.innerHTML = `<label class="support-pick support-pick-all"><input type="checkbox" class="no-switch" id="support-pick-all" aria-label="Select all ${shown.length} shown"${shown.length && picked === shown.length ? " checked" : ""}${shown.length ? "" : " disabled"}><span>Select all</span></label>
      ${n ? `<span class="support-bulk-count" id="support-bulk-count">${n} selected</span>
      <span class="support-bulk-actions">${bulkActions(route.inbox, route.queue).map(control).join("")}
        <button type="button" class="btn-ghost" data-support-bulk="clear">Clear</button></span>` : ""}
      ${bulkResult ? `<p class="support-bulk-result" id="support-bulk-result" role="status">${icon("check_circle")}<span>${esc(bulkResult)}</span></p>` : ""}`;
    bar.classList.toggle("has-selection", n > 0);
    const all = $("support-pick-all");
    if (all) all.indeterminate = picked > 0 && picked < shown.length;
    refocus(focused);
  }
  // One action on every selected thread: asked once, sent in batches, one message at the end.
  async function runBulk(key, choice = "") {
    const def = bulkAction(route.inbox, route.queue, key);
    const rows = listRows(false).filter((t) => selected.has(t.id));
    if (!def || !rows.length || busy) return;
    const plain = isPlainInbox(route.inbox);
    if (def.local) {
      for (const t of rows) opened[t.id] = def.local === "unread" ? MARKED_UNREAD : Math.max(Date.now(), t.lastInboundAt || 0);
      writeOpened(opened);
      selected = new Set();
      bulkResult = bulkResultText(key, { done: rows.length }, { plain });
      return render(true);
    }
    let send = { action: def.action, ...(def.status ? { status: def.status } : {}), ...(def.action === "archive" ? { archived: def.archived } : {}) }, detail = "";
    if (def.pick === "member") {
      const assignee = choice === "__none" ? "" : choice;
      const m = (members || []).find((x) => x.email === assignee);
      send.assignee = assignee;
      detail = assignee ? `to ${m ? m.name : assignee}` : "to no one";
    } else if (def.pick === "move") {
      const m = BULK_MOVES.find((x) => x.key === choice);
      if (!m) return;
      send = { action: m.action, ...(m.status ? { status: m.status } : {}) };
      detail = `to ${m.label}`;
    }
    if (def.danger && !(await confirm(bulkSpamConfirmText(rows, { plain }), { title: "Mark as spam", okLabel: "Mark as spam", danger: true }))) return renderBulk();
    if (def.confirm && !(await confirm(`Raise ${rows.length === 1 ? "a Staff Kanban ticket for the selected support ticket" : `${rows.length} Staff Kanban tickets, one for each selected support ticket`}? A ticket that already has one keeps it.`, { title: "Raise on Staff Kanban", okLabel: "Raise" }))) return renderBulk();
    await act(async () => {
      const total = { done: 0, failed: 0, skipped: 0, error: "" };
      const ids = rows.map((t) => t.id);
      for (let i = 0; i < ids.length; i += BULK_CHUNK) {
        const part = ids.slice(i, i + BULK_CHUNK);
        try {
          const r = await api(apiHeaders, "tickets/bulk", { body: { ids: part, ...send } });
          const failed = Number(r.failed) || 0, skipped = Number(r.skipped) || 0;
          total.done += typeof r.done === "number" ? r.done : part.length - failed - skipped;
          total.failed += failed;
          total.skipped += skipped;
          if (!total.error && Array.isArray(r.errors) && r.errors[0]) total.error = String(r.errors[0].error || "");
        } catch (err) { total.failed += part.length; if (!total.error) total.error = err.message; }
      }
      selected = new Set();
      bulkResult = bulkResultText(key, total, { plain, detail });
    }, "The selection wasn't changed");
  }
  function renderList() {
    const box = $("support-list");
    if (!box) return;
    // A thread that left this list (resolved, marked as spam, moved by someone else) is no longer selected.
    selected = keepSelected(selected, listRows(false));
    renderBulk();
    if (isPlainInbox(route.inbox)) {
      const mail = listRows();
      box.innerHTML = mail.length ? mail.map(plainRowHtml).join("")
        : `<li class="support-empty-row">${search ? "Nothing matches that search." : route.queue === "spam" ? "Nothing in spam." : route.queue === "archived" ? "Nothing archived." : "No emails yet."}</li>`;
      return;
    }
    const rows = listRows();
    box.innerHTML = rows.length ? rows.map((t) => { const unread = t.status !== "spam" && isMarkedUnread(opened[t.id]); return `<li class="support-li">${pickHtml(t)}<button type="button" class="support-row${unread ? " is-unread" : ""}" data-support-ticket="${esc(t.id)}">
        <span class="support-row-main"><span class="support-row-subject">${esc(t.subject)}</span>
          <span class="support-row-from">${esc(t.customerName || t.customerEmail)}${t.account && t.account.name ? ` · ${esc(t.account.name)}` : ""}</span>
          <span class="support-row-snippet">${esc(t.summary || t.snippet)}</span></span>
        <span class="support-row-side"><span class="support-row-when" title="${esc(fullDate(t.lastMessageAt))}">${esc(fmtWhen(t.lastMessageAt))}</span>
          <span class="support-row-key">${esc(t.key)}</span><span class="support-row-badges">${unread ? `<span class="badge support-unread">Unread</span>` : ""}${badges(t)}</span></span></button></li>`; }).join("")
      : `<li class="support-empty-row">${search ? "Nothing matches that search." : "Nothing in this queue."}</li>`;
  }

  // ── Hello and Aidan: a plain inbox (an email list, no queues or triage) ──
  function renderPlainInbox() {
    const box = inboxOf(route.inbox);
    const spam = route.queue === "spam", archived = route.queue === "archived";
    const counts = plainInboxCounts(tickets, box.key, opened);
    view.innerHTML = `<div class="support-plain">
        ${spam || archived ? `<button type="button" class="btn-ghost support-back" data-support-act="back">${icon("arrow_back")} ${esc(box.label)}</button><h3 class="support-plain-h">${spam ? "Spam" : "Archived"}</h3>` : ""}
        <label class="um-search support-search"><span class="material-symbols-outlined" aria-hidden="true">search</span>
          <input type="search" id="support-search" placeholder="Search emails" aria-label="Search emails" value="${esc(search)}"></label>
        ${bulkBarHtml()}
        <ul class="support-list" id="support-list" aria-label="${esc(spam ? `${box.label} spam` : archived ? `${box.label} archived emails` : `${box.label} emails`)}"></ul>
        ${tickets.length >= LIST_LIMIT ? `<p class="field-hint">Showing the ${LIST_LIMIT} most recently active emails.</p>` : ""}
        ${!spam && !archived && (counts.spam || counts.archived) ? `<div class="support-plain-foot">${counts.archived ? `<button type="button" class="btn-ghost" data-support-queue="archived">${icon("archive")} Archived (${counts.archived})</button>` : ""}${counts.spam ? `<button type="button" class="btn-ghost" data-support-queue="spam">${icon("report")} Spam (${counts.spam})</button>` : ""}</div>` : ""}
      </div>`;
    renderList();
  }
  function plainRowHtml(t) {
    const box = inboxOf(route.inbox);
    const unread = isUnread(t, opened[t.id]);
    const state = box.agent ? aidanThreadState(t.aidan, { spam: t.status === "spam" }) : null;
    return `<li class="support-li">${pickHtml(t)}<button type="button" class="support-row support-mail-row${unread ? " is-unread" : ""}" data-support-ticket="${esc(t.id)}">
        <span class="support-row-main"><span class="support-row-from">${esc(t.customerName || t.customerEmail || "Unknown sender")}</span>
          <span class="support-row-subject">${esc(t.subject)}</span>
          ${state ? `<span class="support-row-snippet">${esc(state.line)}</span>` : ""}</span>
        <span class="support-row-side"><span class="support-row-when" title="${esc(fullDate(t.lastMessageAt))}">${esc(fmtWhen(t.lastMessageAt))}</span>
          <span class="support-row-badges">${unread ? `<span class="badge support-unread">Unread</span>` : ""}${state ? aidanStateBadge(t) : ""}</span></span></button></li>`;
  }
  function renderPlainTicket() {
    const t = tickets.find((x) => x.id === route.ticketId);
    const box = inboxOf(inboxKey());
    if (!t) { view.innerHTML = `<p class="interface-row-empty">That email isn't in the ${LIST_LIMIT} most recent.</p><button type="button" class="btn-ghost" data-support-act="back">${icon("arrow_back")} ${esc(box.label)}</button>`; return; }
    watchMessages(t.id);
    if (composer.ticketId !== t.id) composer = { ticketId: t.id, text: "", usedDraft: false, faq: "" };
    // Opening the thread reads it (in this browser).
    const seen = Math.max(Date.now(), t.lastInboundAt || 0);
    if ((opened[t.id] || 0) < (t.lastInboundAt || 1)) { opened[t.id] = seen; writeOpened(opened); headerLine(); }
    const edit = canEdit();
    const spam = t.status === "spam";
    const state = box.agent ? aidanThreadState(t.aidan, { spam: t.status === "spam" }) : null;
    view.innerHTML = `<div class="support-ticket support-plain-ticket">
      <button type="button" class="btn-ghost support-back" data-support-act="back">${icon("arrow_back")} ${esc(box.label)}</button>
      <div class="support-ticket-head">
        <h3>${esc(t.subject)}</h3>
        <div class="support-ticket-meta">${spam ? `<span class="badge support-status-spam">Spam</span>` : t.archived ? `<span class="badge badge-status-draft">Archived</span>` : ""}${state ? aidanStateBadge(t) : ""}
          ${t.inboxes.length > 1 ? `<span class="badge badge-status-draft" title="This email was written to more than one address, so it is in each of these inboxes">In ${esc(t.inboxes.map((k) => inboxOf(k).label).join(", "))}</span>` : ""}
          <span>${esc(t.customerName ? `${t.customerName} <${t.customerEmail}>` : t.customerEmail)}</span></div>
        ${state ? `<p class="support-summary support-aidan-line">${icon("smart_toy")}${esc(state.line)}</p>${aidanSourcesHtml(state)}${aidanPartsHtml(t.aidan)}${aidanCollateralHtml(t.aidan)}` : ""}
      </div>
      ${edit ? `<div class="support-actions" role="group" aria-label="Email actions">${spam
        ? `<button type="button" class="btn-ghost" data-support-status="open">${icon("inbox")} Not spam</button>`
        : `<button type="button" class="btn-ghost" data-support-status="spam">${icon("report")} Mark as spam</button>`}</div>` : ""}
      <ol class="support-thread" id="support-thread" aria-label="Conversation"></ol>
      ${!edit || spam ? "" : `<div class="support-composer">
        <label class="field-label" for="support-reply">Reply to ${esc(t.customerEmail)}</label>
        <textarea id="support-reply" rows="7" placeholder="Write a reply">${esc(composer.text)}</textarea>
        <div class="support-send"><button type="button" class="btn-primary" data-support-act="send">Reply</button>
          <button type="button" class="btn-ghost" data-support-act="note">Save as internal note</button></div></div>`}</div>`;
    renderThread();
  }

  function messageHtml(m) {
    const at = toMs(m.at);
    // A plain inbox shows the emails and notes only: no ticket history, no draft or confidence tags.
    const plain = isPlainInbox(inboxKey());
    if (plain && m.direction === "event") return "";
    if (m.direction === "event") return `<li class="support-event">${icon("history")}<span>${esc(m.text)} <small>${esc(m.by === "ai" ? "AI" : m.by || "")} · ${esc(fullDate(at))}</small></span></li>`;
    if (m.direction === "note") return `<li class="support-msg support-msg-note"><div class="support-msg-head"><b>Internal note</b> · ${esc(m.by || "")}<small>${esc(fullDate(at))}</small></div><div class="support-msg-body">${esc(m.text)}</div></li>`;
    if (m.direction === "out" && m.source === "aidan") return aidanMessageHtml(m, at);
    const out = m.direction === "out";
    const who = out ? (m.auto ? "AI reply" : m.sentBy === "gmail" ? "Sent from Gmail" : `${m.sentBy || "Support"}`) : (m.fromName || m.from);
    const tag = plain ? "" : out && m.auto ? `<span class="badge badge-feature">Sent automatically${m.confidence ? ` · ${Math.round(m.confidence * 100)}%` : ""}</span>` : out && m.source === "ai-draft" ? `<span class="badge badge-status-draft">AI draft, approved</span>` : out && m.source === "ai-draft-edited" ? `<span class="badge badge-status-draft">AI draft, edited</span>` : "";
    const files = (m.attachments || []).length ? `<div class="support-msg-files">${icon("attach_file")}${m.attachments.map((a) => esc(a.name)).join(", ")} <small>(open in Gmail)</small></div>` : "";
    return `<li class="support-msg ${out ? "support-msg-out" : "support-msg-in"}"><div class="support-msg-head"><b>${esc(who)}</b>${out ? "" : ` <span class="support-msg-addr">${esc(m.from || "")}</span>`}${tag}<small>${esc(fullDate(at))}</small></div>
      <div class="support-msg-body">${esc(m.text)}</div>${files}</li>`;
  }
  function renderThread() {
    const el = $("support-thread");
    if (!el) return;
    el.innerHTML = messages.length ? messages.map(messageHtml).join("") : `<li class="interface-row-empty">Loading the conversation…</li>`;
  }

  function renderTicket() {
    const t = tickets.find((x) => x.id === route.ticketId);
    if (!t) { view.innerHTML = `<p class="interface-row-empty">That ticket isn't in the ${LIST_LIMIT} most recent.</p><button type="button" class="btn-ghost" data-support-act="back">${icon("arrow_back")} ${esc(inboxOf(inboxKey()).label)}</button>`; return; }
    watchMessages(t.id);
    if (composer.ticketId !== t.id) composer = { ticketId: t.id, text: "", usedDraft: false, faq: "" };
    // A ticket marked unread from the list is read once it is opened.
    if (isMarkedUnread(opened[t.id])) { opened[t.id] = Date.now(); writeOpened(opened); }
    const edit = canEdit();
    const draft = t.aiDraft;
    const actions = !edit ? "" : `<div class="support-actions" role="group" aria-label="Ticket actions">
        ${t.status === "spam" ? `<button type="button" class="btn-ghost" data-support-status="open">${icon("inbox")} Not spam</button>` : `
        ${t.status === "resolved" ? `<button type="button" class="btn-ghost" data-support-status="open">${icon("undo")} Reopen</button>` : `<button type="button" class="btn-ghost" data-support-status="resolved">${icon("task_alt")} Resolve</button>`}
        <button type="button" class="btn-ghost" data-support-status="spam">${icon("report")} Mark as spam</button>
        ${t.kanbanKey ? "" : `<button type="button" class="btn-ghost" data-support-act="escalate">${icon("view_kanban")} Raise on Staff Kanban</button>`}
        <label class="support-assign">Assigned to <select id="support-assign" aria-label="Assigned to"><option value="">No one</option>${(members || []).map((m) => `<option value="${esc(m.email)}"${m.email === t.assignee ? " selected" : ""}>${esc(m.name)}</option>`).join("")}${t.assignee && !(members || []).some((m) => m.email === t.assignee) ? `<option value="${esc(t.assignee)}" selected>${esc(t.assignee)}</option>` : ""}</select></label>`}
      </div>`;
    const draftCard = draft && edit && t.status !== "spam" ? `<div class="support-draft">
        <div class="support-draft-head">${icon("auto_awesome")}<b>Suggested reply</b>${confidenceHtml(draft.confidence)}
          ${draft.answerable ? "" : `<span class="badge badge-wp-waiting">Holding reply: the Help Centre doesn't answer this</span>`}</div>
        ${confidenceChangeHtml(draft.confidenceSteps)}
        <div class="support-draft-text">${esc(draft.text)}</div>
        ${draft.articles.length ? sourcesHtml(draft.articles) : ""}
        <div class="support-draft-actions"><button type="button" class="btn-ghost" data-support-act="use-draft">Use this reply</button><button type="button" class="btn-ghost" data-support-act="redraft">Write another</button></div></div>`
      : edit && t.status !== "spam" && !t.automated ? `<div class="support-draft support-draft-none">${icon("auto_awesome")}<span>${esc(t.triagePending ? "A reply is being drafted…" : t.triageReason || "No suggested reply.")}</span><button type="button" class="btn-ghost" data-support-act="redraft">Draft a reply</button></div>` : "";
    const composerHtml = !edit || t.status === "spam" ? "" : `<div class="support-composer">
        ${draftCard}
        <label class="field-label" for="support-reply">Reply to ${esc(t.customerEmail)}</label>
        <textarea id="support-reply" rows="7" placeholder="Write a reply, use the suggested one, or insert a Help Centre article">${esc(composer.text)}</textarea>
        <div class="support-faq"><label class="um-search"><span class="material-symbols-outlined" aria-hidden="true">help_center</span>
          <input type="search" id="support-faq-search" placeholder="Insert from the Help Centre" aria-label="Search the Help Centre to insert an article" value="${esc(composer.faq)}"></label>
          <ul class="support-faq-results" id="support-faq-results" aria-label="Help Centre articles"></ul></div>
        <div class="support-send"><button type="button" class="btn-primary" data-support-act="send">Send</button>
          <button type="button" class="btn-ghost" data-support-act="send-resolve">Send and resolve</button>
          <button type="button" class="btn-ghost" data-support-act="note">Save as internal note</button></div></div>`;
    view.innerHTML = `<div class="support-ticket">
      <button type="button" class="btn-ghost support-back" data-support-act="back">${icon("arrow_back")} ${esc(inboxOf(inboxKey()).label)}</button>
      <div class="support-ticket-head">
        <h3><span class="support-row-key">${esc(t.key)}</span> ${esc(t.subject)}</h3>
        <div class="support-ticket-meta"><span class="badge support-status-${t.status}">${esc(STATUS_LABEL[t.status])}</span>${badges(t)}
          ${t.inboxes.length > 1 ? `<span class="badge badge-status-draft" title="This email was written to more than one address, so it is in each of these inboxes">In ${esc(t.inboxes.map((k) => inboxOf(k).label).join(", "))}</span>` : ""}
          <span>${esc(t.customerName ? `${t.customerName} <${t.customerEmail}>` : t.customerEmail)}</span>
          ${t.account ? `<span class="support-account">${icon("apartment")}${esc(t.account.name)} · ${esc(t.account.reason)}</span>` : ""}
          ${t.kanbanKey ? `<button type="button" class="support-link" data-support-act="open-kanban">${icon("view_kanban")}${esc(t.kanbanKey)}</button>` : ""}</div>
        ${t.summary ? `<p class="support-summary">${icon("auto_awesome")}${esc(t.summary)}</p>` : ""}
        ${aidanLine(t)}
        ${t.escalationError ? `<p class="support-problem">The Staff Kanban ticket couldn't be raised: ${esc(t.escalationError)}</p>` : ""}
      </div>
      ${actions}
      <ol class="support-thread" id="support-thread" aria-label="Conversation"></ol>
      ${composerHtml}</div>`;
    renderThread();
    renderFaqResults();
    if (edit && !members) ensureMembers().then(() => { if (route.view === "ticket" && route.ticketId === t.id) render(); });
  }
  function renderFaqResults() {
    const box = $("support-faq-results");
    if (!box) return;
    const q = composer.faq.trim();
    if (!q) { box.innerHTML = ""; return; }
    if (!articles) { box.innerHTML = `<li class="interface-row-empty">Searching…</li>`; ensureArticles().then(renderFaqResults).catch((err) => { box.innerHTML = `<li class="support-problem">The Help Centre didn't load: ${esc(err.message)}</li>`; }); return; }
    const hits = searchArticles(articles, q);
    box.innerHTML = hits.length ? hits.map((a) => `<li><button type="button" class="support-faq-hit" data-support-article="${esc(a.id)}">${icon("add")}<span><b>${esc(a.title)}</b><small>${esc(a.directAnswer || a.summary || "")}</small></span></button></li>`).join("")
      : `<li class="interface-row-empty">No published article matches.</li>`;
  }

  // ── Actions ──
  const current = () => tickets.find((x) => x.id === route.ticketId);
  async function act(fn, failure) {
    if (busy) return;
    busy = true;
    view.querySelectorAll("button").forEach((b) => { b.disabled = true; });
    try { await fn(); } catch (err) { await alert(`${failure}: ${err.message}`); }
    busy = false;
    render(true);
  }
  async function sendReply(resolve) {
    const t = current();
    const text = composer.text.trim();
    if (!t) return;
    if (!text) { await alert("Write the reply first."); return; }
    await act(async () => {
      await api(apiHeaders, `tickets/${encodeURIComponent(t.id)}/reply`, { body: { text, resolve, draft: draftSource(text, t.aiDraft, composer.usedDraft) } });
      composer = { ticketId: t.id, text: "", usedDraft: false, faq: "" };
    }, "The reply wasn't sent");
  }

  // ── A new email from the support mailbox (the email icon in the header) ──
  let composeForm = { to: "", subject: "", text: "" }, composeError = "", composeSent = null, composing = false;
  function renderCompose() {
    const back = `<button type="button" class="btn-ghost support-back" data-support-act="back">${icon("arrow_back")} ${esc(inboxOf(DEFAULT_INBOX).label)}</button>`;
    if (!canEdit()) { view.innerHTML = `${back}<p class="interface-row-empty">Writing an email needs edit access to the Support Inbox.</p>`; return; }
    if (!status || !status.connected) { view.innerHTML = `${back}<p class="interface-row-empty">${status ? "Connect the support mailbox before writing an email." : "Loading…"}</p>`; return; }
    const sent = composeSent ? `<p class="support-compose-sent" role="status">${icon("check_circle")}<span>Sent to ${esc(composeSent.to)} from ${esc(status.connectedEmail)}.</span>
        ${composeSent.ticketId ? `<button type="button" class="support-link" data-support-act="open-sent">${esc(composeSent.key || "Open it")}</button>` : ""}</p>` : "";
    view.innerHTML = `<div class="support-compose">
      ${back}
      <h3 class="support-compose-h">New email<button type="button" class="info-tip" data-tip="Sent from ${esc(status.connectedEmail)} with the signature from Settings. It is filed in the Support Inbox under Waiting on customer, and the answer arrives on the same ticket." aria-label="About a new email">i</button></h3>
      ${sent}
      <div class="support-set-grid">
        <label class="field-label" for="support-compose-to">To</label>
        <input type="email" id="support-compose-to" value="${esc(composeForm.to)}" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="email">
        <label class="field-label" for="support-compose-subject">Subject</label>
        <input type="text" id="support-compose-subject" maxlength="300" value="${esc(composeForm.subject)}" autocomplete="off">
        <label class="field-label" for="support-compose-text">Message</label>
        <textarea id="support-compose-text" rows="10">${esc(composeForm.text)}</textarea>
        ${composeError ? `<p class="support-problem" role="alert" id="support-compose-error">${esc(composeError)}</p>` : ""}
        <div class="form-row" style="justify-content:flex-start;"><button type="button" class="btn-primary" data-support-act="compose-send"${composing ? " disabled" : ""}>${composing ? "Sending…" : "Send"}</button></div>
      </div>
    </div>`;
  }
  async function sendCompose() {
    if (composing) return;
    composeSent = null;
    composeError = composeProblem(composeForm);
    if (composeError) return renderCompose();
    composing = true;
    renderCompose();
    try {
      const r = await api(apiHeaders, "compose", { body: { to: composeForm.to.trim(), subject: composeForm.subject.trim(), text: composeForm.text } });
      composeSent = { to: r.to, ticketId: r.ticketId || "", key: r.key || "" };
      composeForm = { to: "", subject: "", text: "" };
    } catch (err) { composeError = `The email wasn't sent: ${err.message}`; }
    composing = false;
    if (route.view === "compose") renderCompose();
  }
  const COMPOSE_FIELDS = { "support-compose-to": "to", "support-compose-subject": "subject", "support-compose-text": "text" };

  view.addEventListener("input", (e) => {
    if (COMPOSE_FIELDS[e.target.id]) {
      composeForm[COMPOSE_FIELDS[e.target.id]] = e.target.value;
      // The last refusal no longer describes what is in the form (removed in place: a redraw would drop the caret).
      if (composeError) { composeError = ""; const el = $("support-compose-error"); if (el) el.remove(); }
    }
    else if (e.target.id === "support-search") {
      search = e.target.value;
      renderList();
    } else if (e.target.id === "support-reply") composer.text = e.target.value;
    else if (e.target.id === "support-faq-search") { composer.faq = e.target.value; renderFaqResults(); }
  });
  view.addEventListener("focusout", () => setTimeout(() => { if (stale && !typing()) render(); }, 0));
  view.addEventListener("change", (e) => {
    const el = e.target;
    if (el.dataset.supportPick) {
      if (el.checked) selected.add(el.dataset.supportPick); else selected.delete(el.dataset.supportPick);
      bulkResult = "";
      return renderBulk();
    }
    if (el.id === "support-pick-all") {
      const shown = listRows();
      for (const t of shown) { if (el.checked) selected.add(t.id); else selected.delete(t.id); }
      view.querySelectorAll("[data-support-pick]").forEach((c) => { c.checked = selected.has(c.dataset.supportPick); });
      bulkResult = "";
      return renderBulk();
    }
    if (el.dataset.supportBulkPick) { if (el.value) runBulk(el.dataset.supportBulkPick, el.value); return; }
    if (el.id !== "support-assign") return;
    const t = current();
    if (t) act(() => api(apiHeaders, `tickets/${encodeURIComponent(t.id)}/assign`, { body: { assignee: e.target.value } }), "The ticket wasn't assigned");
  });
  view.addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b || !view.contains(b)) return;
    if (b.dataset.supportQueue) return go(supportHash({ inbox: route.inbox, queue: b.dataset.supportQueue }));
    if (b.dataset.supportBulk === "clear") { selected = new Set(); bulkResult = ""; return render(true); }
    if (b.dataset.supportBulk) return runBulk(b.dataset.supportBulk);
    if (b.dataset.supportTicket) return go(supportHash({ view: "ticket", inbox: route.inbox, ticketId: b.dataset.supportTicket }));
    const t = current();
    if (b.dataset.supportArticle) {
      const a = (articles || []).find((x) => x.id === b.dataset.supportArticle);
      if (!a) return;
      composer.text = `${composer.text.trimEnd()}${composer.text.trim() ? "\n\n" : ""}${articleSnippet(a)}`;
      composer.faq = "";
      return renderTicket();
    }
    if (b.dataset.supportStatus && t) {
      const to = b.dataset.supportStatus;
      const plain = isPlainInbox(inboxKey());
      if (to === "spam" && !(await confirm(spamConfirmText(t, { plain }), { title: "Mark as spam", okLabel: "Mark as spam", danger: true }))) return;
      return act(async () => { await api(apiHeaders, `tickets/${encodeURIComponent(t.id)}/status`, { body: { status: to } }); if (to === "spam") go(supportHash({ inbox: inboxKey(), queue: route.queue })); }, plain ? "The email wasn't changed" : "The ticket wasn't changed");
    }
    const a = b.dataset.supportAct;
    if (a === "open-settings") return openSettings();
    if (a === "back") return go(supportHash({ inbox: inboxKey() }));
    if (a === "compose-send") return sendCompose();
    if (a === "open-sent" && composeSent && composeSent.ticketId) return go(supportHash({ view: "ticket", ticketId: composeSent.ticketId }));
    if (!t) return;
    if (a === "open-kanban") return openKanbanTicket(t.kanbanKey);
    if (a === "use-draft" && t.aiDraft) { composer.text = t.aiDraft.text; composer.usedDraft = true; renderTicket(); return $("support-reply").focus(); }
    if (a === "redraft") return act(() => api(apiHeaders, `tickets/${encodeURIComponent(t.id)}/draft`), "A reply couldn't be drafted");
    if (a === "escalate") return act(() => api(apiHeaders, `tickets/${encodeURIComponent(t.id)}/escalate`), "The Staff Kanban ticket wasn't raised");
    if (a === "send") return sendReply(false);
    if (a === "send-resolve") return sendReply(true);
    if (a === "note") {
      const text = composer.text.trim();
      if (!text) return alert("Write the note first.");
      return act(async () => { await api(apiHeaders, `tickets/${encodeURIComponent(t.id)}/note`, { body: { text } }); composer.text = ""; }, "The note wasn't saved");
    }
  });
  document.querySelectorAll("[data-support-tab]").forEach((b) => b.addEventListener("click", () => {
    const tab = b.dataset.supportTab;
    const inbox = INBOXES.find((i) => tabOf(i.key) === tab);
    if (inbox) go(supportHash({ inbox: inbox.key }));
  }));
  $("support-compose-btn").addEventListener("click", () => { composeError = ""; composeSent = null; go(supportHash({ view: "compose" })); });
  $("support-sync-btn").addEventListener("click", () => sync());

  return {
    show(r) {
      visible = true;
      // Another tab, queue or page: nothing stays selected, and the last result goes.
      const key = `${r.view}|${r.inbox}|${r.queue}`;
      if (key !== listKey) { selected = new Set(); bulkResult = ""; listKey = key; }
      route = r;
      start();
      render(true);
      if (!syncTimer) {
        syncTimer = setInterval(() => { if (!document.hidden) sync({ quiet: true }); }, SYNC_EVERY_MS);
        // Opening the page reads new mail once the connection status is known.
        setTimeout(() => sync({ quiet: true }), 1500);
      }
    },
    hide() { visible = false; if (syncTimer) { clearInterval(syncTimer); syncTimer = null; } },
    refreshStatus: loadStatus,
  };
}

// ── Settings › Support inbox ──────────────────────────────────────────────
const CALLBACK_ERRORS = {
  expired: "That sign-in took too long or was already used. Start again.",
  "no-refresh-token": "Google didn't give a lasting sign-in. Remove this app at myaccount.google.com/permissions for the mailbox, then connect again.",
  scope: "Google didn't grant access to the mailbox. Connect again and tick the Gmail permission.",
  profile: "The mailbox's address couldn't be read from Google.",
  exchange: "Google refused the sign-in. Check the OAuth client ID, secret and redirect address.",
  access_denied: "The Google sign-in was cancelled.",
};
// Aidan's block in Settings › Support inbox. The allowed senders are kept on
// the server and never shown in full: an admin sees them masked and replaces
// the whole list by pasting it; everyone else sees how many there are.
function aidanSettingsHtml(aidan, admin) {
  const a = aidan || { enabled: false, switchedOn: true, senderCount: 0, sendersMasked: [] };
  const dis = admin ? "" : " disabled";
  const name = a.fromName || "Aidan";
  const state = a.senderCount
    ? `<div class="media-key-state${a.enabled ? " media-key-test-ok" : ""}">${icon(a.enabled ? "check_circle" : "block")} ${a.senderCount} allowed sender${a.senderCount === 1 ? "" : "s"}${(a.sendersMasked || []).length ? `: ${esc(a.sendersMasked.join(", "))}` : ""}${a.enabled ? "" : " · switched off"}</div>`
    : `<div class="media-key-state">${icon("block")} No allowed senders: Aidan acts on nothing</div>`;
  return `<div class="docs-block" id="support-aidan-settings"><div class="docs-block-header"><h3>Aidan
      <span class="info-tip" tabindex="0" role="note" aria-label="About Aidan" data-tip="Aidan answers email written to aidan@ when an allowed sender tags @Aidan with an instruction. A request to write something is written with the matching skill and sent to everyone on the email as an attachment. A request for sales collateral, such as a one-pager, a platform overview or a deck, is written with the brand skill and sent as a branded PDF with its Markdown source. A request to keep something stores the email and its attachments as reference material for a skill. Anything else, such as a question or a request to confirm, is answered in the reply itself, with no attachment. A question about the platform is answered from the Help Centre, the way the Support Inbox drafts a reply, and the ticket shows the articles and the confidence. Anyone else, and an email with no tag, gets nothing. Every reply is written in Aidan's voice, with at most one light aside after the answer and none on a complaint, a fault or anything commercial; an attached document or collateral always follows the brand voice. The allowed addresses are kept on the server and never shown in full; paste the whole list to replace it, or leave the box empty to keep it."><span class="material-symbols-outlined" aria-hidden="true">info</span></span></h3></div>
      ${state}
      <div class="support-set-grid">
        <label class="support-check"><input type="checkbox" id="support-aidan-on"${a.switchedOn !== false ? " checked" : ""}${dis}> Aidan acts on tagged requests</label>
        ${admin ? `<label class="field-label" for="support-aidan-senders">Allowed senders</label>
        <textarea id="support-aidan-senders" rows="2" autocomplete="off" spellcheck="false" placeholder="${a.senderCount ? "Saved. Paste the full list to replace it" : "One or more addresses, separated by commas"}"></textarea>` : ""}
        <label class="support-check"><input type="checkbox" id="support-aidan-sigline-on"${a.signatureLineOn ? " checked" : ""}${dis}> Add a signature line under "${esc(name)}, Personalisation Hub"</label>
        <label class="field-label" for="support-aidan-sigline">Signature line</label>
        <input type="text" id="support-aidan-sigline" maxlength="80" autocomplete="off" placeholder="PH's digital assistant" value="${esc(a.signatureLine || "")}"${dis}>
      </div>
      ${admin ? `<div class="form-row" style="justify-content:flex-start;"><button type="button" class="btn-primary" data-ss-act="save-aidan" disabled>Save Aidan</button><span class="field-hint" id="support-aidan-status" role="status"></span></div>` : ""}
    </div>`;
}
// The controls each Save button on Settings › Support inbox sends. A button is
// enabled only while one of its controls differs from what was drawn, i.e.
// from the saved value (the write-only boxes are drawn empty).
const SAVE_CONTROLS = {
  "save-client": ["support-client-id", "support-client-secret"],
  "save-settings": ["support-auto", "support-threshold", "support-from", "support-signature", "support-assignee", "support-vip"],
  "save-aidan": ["support-aidan-on", "support-aidan-senders", "support-aidan-sigline-on", "support-aidan-sigline"],
};
export function mountSupportSettings({ host, apiHeaders, isAdmin, alert, confirm, db }) {
  let status = null, members = [];
  // What each Save button's controls held when the page was last drawn.
  let savedState = {};
  const controlsState = (ids) => JSON.stringify(ids.map((id) => {
    const el = host.querySelector(`#${id}`);
    return !el ? null : el.type === "checkbox" ? el.checked : el.value;
  }));
  function syncSaveButtons() {
    for (const [act, ids] of Object.entries(SAVE_CONTROLS)) {
      const b = host.querySelector(`[data-ss-act="${act}"]`);
      if (!b) continue;
      const ready = act !== "save-client" || !!(status && status.encryptionReady);
      b.disabled = !ready || controlsState(ids) === savedState[act];
    }
  }
  // `returned` is the query Google's sign-in came back with ("connected=1" or "error=…").
  // The Settings page can be drawn more than once while it opens, so the answer is kept until the next action.
  let lastReturn = "";
  async function load(returned = "") {
    if (returned) lastReturn = returned;
    const params = new URLSearchParams(lastReturn);
    try {
      status = await api(apiHeaders, "status", { method: "GET" });
      if (!members.length) { try { members = (await getDocs(collection(db, "memberDirectory"))).docs.map((d) => d.data() || {}).filter((m) => m.email && !m.disabled); } catch { members = []; } }
      render(params.get("error") ? CALLBACK_ERRORS[params.get("error")] || `Google answered: ${params.get("error")}` : "", params.get("connected") === "1");
    } catch (err) { host.innerHTML = `<p class="interface-row-empty">The support inbox settings didn't load: ${esc(err.message)}</p>`; }
  }
  function render(error, justConnected) {
    const s = status, set = s.settings, admin = isAdmin();
    const dis = admin ? "" : " disabled";
    const state = s.connected
      ? `<div class="media-key-state media-key-test-ok">${icon("check_circle")} Connected to <b>${esc(s.connectedEmail)}</b>${s.connectedBy ? ` by ${esc(s.connectedBy)}` : ""}${s.lastSyncAt ? ` · last synced ${esc(fullDate(Date.parse(s.lastSyncAt)))}` : " · not synced yet"}</div>`
      : `<div class="media-key-state">${icon("link_off")} Not connected</div>`;
    const problems = [error, s.connectionError, !s.lastSyncOk && s.lastSyncError ? `Last sync failed: ${s.lastSyncError}` : "",
      s.encryptionReady ? "" : "Encryption isn't set up yet: the next console deploy creates its key. Until then the mailbox can't be connected.",
      s.aiReady ? "" : "No drafting model is configured (ANTHROPIC_API_KEY), so tickets arrive without a suggested reply."].filter(Boolean)
      .map((p) => `<p class="support-problem" role="alert">${esc(p)}</p>`).join("");
    host.innerHTML = `
      <div class="docs-block"><div class="docs-block-header"><h3>Support mailbox
        <span class="info-tip" tabindex="0" role="note" aria-label="About the support mailbox" data-tip="Sign in once as the support mailbox (a Google Workspace Gmail account). The console then reads its mail every few minutes, files each thread as a ticket and sends replies from it. Google's sign-in is kept encrypted and can't be read back here. Disconnecting stops both, and leaves the tickets."><span class="material-symbols-outlined" aria-hidden="true">info</span></span></h3></div>
        ${state}${justConnected ? `<p class="media-key-state media-key-test-ok">${icon("check_circle")} Mailbox connected. The first sync reads the last ${set.importDays} days.</p>` : ""}${problems}
        ${admin ? `<div class="support-set-grid">
          <span class="field-label">1. Google OAuth client <span class="info-tip" tabindex="0" role="note" aria-label="About the Google OAuth client" data-tip="Made once in Google Cloud Console › APIs & Services: enable the Gmail API, then Credentials › Create OAuth client ID › Web application, and add the redirect address shown here. Paste its client ID and secret. The secret is encrypted before it is stored."><span class="material-symbols-outlined" aria-hidden="true">info</span></span></span>
          <div class="mcp-connect-box"><span class="field-label" style="margin-top:0;">Authorised redirect address</span><code id="support-redirect">${esc(s.redirectUri)}</code></div>
          <div class="media-key-form">
            <input type="text" id="support-client-id" placeholder="${s.clientSet ? "Client ID saved — paste to replace" : "Client ID (…apps.googleusercontent.com)"}" aria-label="Google OAuth client ID" autocomplete="off" spellcheck="false">
            <input type="password" id="support-client-secret" placeholder="Client secret" aria-label="Google OAuth client secret" autocomplete="new-password" spellcheck="false">
            <button type="button" class="btn-ghost" data-ss-act="save-client" disabled>Save client</button></div>
          ${s.clientSet ? `<div class="media-key-state is-set"><span class="media-key-dot" aria-hidden="true"></span>Client saved: <code>${esc(s.clientId)}</code></div>` : ""}
          <span class="field-label">2. Mailbox</span>
          <div class="form-row" style="justify-content:flex-start;gap:8px;margin-top:0;">
            <button type="button" class="btn-primary" data-ss-act="connect"${s.clientSet ? "" : " disabled"}>${s.connected ? "Connect a different mailbox" : "Connect Gmail"}</button>
            ${s.connected ? `<button type="button" class="btn-ghost" data-ss-act="sync">Sync now</button><button type="button" class="btn-ghost" data-ss-act="disconnect">Disconnect</button>` : ""}</div></div>` : `<p class="field-hint">Only an admin can connect or change the mailbox.</p>`}
      </div>
      <div class="docs-block"><div class="docs-block-header"><h3>Answering
        <span class="info-tip" tabindex="0" role="note" aria-label="About automatic answers" data-tip="Every customer email is drafted a reply from the published Help Centre articles. Switched off, each draft waits for a person to approve it. Switched on, a draft is sent by itself only when the articles fully answer the question and the model's confidence reaches the level set here. Machine-sent mail and high-value senders are never answered automatically, and a thread is answered automatically once at most."><span class="material-symbols-outlined" aria-hidden="true">info</span></span></h3></div>
        <div class="support-set-grid">
          <label class="support-check"><input type="checkbox" id="support-auto"${set.autoReply ? " checked" : ""}${dis}> Send confident answers without a person</label>
          <label class="field-label" for="support-threshold">Confidence needed to send (%)</label>
          <input type="number" id="support-threshold" min="50" max="99" step="1" value="${Math.round(set.autoReplyThreshold * 100)}"${dis}>
          <label class="field-label" for="support-from">Sender name</label>
          <input type="text" id="support-from" maxlength="80" value="${esc(set.fromName)}"${dis}>
          <label class="field-label" for="support-signature">Signature</label>
          <textarea id="support-signature" rows="3" maxlength="600"${dis}>${esc(set.signature)}</textarea>
        </div></div>
      <div class="docs-block"><div class="docs-block-header"><h3>High-value senders
        <span class="info-tip" tabindex="0" role="note" aria-label="About high-value senders" data-tip="A sender whose company is in Prospects (TAM) or Leads, or whose domain is listed here, is high value. Their ticket is never answered automatically: it goes to Needs a person and a flagged, highest-priority Staff Kanban ticket is raised for the person chosen here."><span class="material-symbols-outlined" aria-hidden="true">info</span></span></h3></div>
        <div class="support-set-grid">
          <label class="field-label" for="support-assignee">Raise the Staff Kanban ticket for</label>
          <select id="support-assignee"${dis}><option value="">Whoever connected the mailbox</option>${members.map((m) => `<option value="${esc(String(m.email).toLowerCase())}"${String(m.email).toLowerCase() === set.escalationAssignee ? " selected" : ""}>${esc(m.displayName || m.email)}</option>`).join("")}</select>
          <label class="field-label" for="support-vip">Extra high-value domains</label>
          <textarea id="support-vip" rows="3" placeholder="bigretailer.com, another.co.uk"${dis}>${esc(set.vipDomains.join(", "))}</textarea>
        </div>
        ${admin ? `<div class="form-row" style="justify-content:flex-start;"><button type="button" class="btn-primary" data-ss-act="save-settings" disabled>Save settings</button><span class="field-hint" id="support-settings-status" role="status"></span></div>` : ""}
      </div>
      ${aidanSettingsHtml(s.aidan, admin)}`;
    savedState = Object.fromEntries(Object.entries(SAVE_CONTROLS).map(([act, ids]) => [act, controlsState(ids)]));
    syncSaveButtons();
  }
  host.addEventListener("input", syncSaveButtons);
  host.addEventListener("change", syncSaveButtons);
  host.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-ss-act]");
    if (!b) return;
    const a = b.dataset.ssAct;
    const val = (id) => host.querySelector(`#${id}`).value;
    lastReturn = "";
    b.disabled = true;
    try {
      if (a === "save-client") {
        await api(apiHeaders, "oauth/client", { body: { clientId: val("support-client-id").trim(), clientSecret: val("support-client-secret").trim() } });
        await load();
      } else if (a === "connect") {
        const { url } = await api(apiHeaders, "oauth/start");
        window.location.assign(url);
      } else if (a === "sync") {
        const r = await api(apiHeaders, "sync");
        await load();
        await alert(`Read ${r.newMessages} new message${r.newMessages === 1 ? "" : "s"} (${r.newTickets} new ticket${r.newTickets === 1 ? "" : "s"}).`);
      } else if (a === "disconnect") {
        if (await confirm("Disconnect the support mailbox? New mail stops arriving and replies can't be sent until it is connected again. Tickets already here are kept.", { title: "Disconnect mailbox", okLabel: "Disconnect", danger: true })) { await api(apiHeaders, "disconnect"); await load(); }
      } else if (a === "save-settings") {
        await api(apiHeaders, "settings", { body: {
          autoReply: host.querySelector("#support-auto").checked, autoReplyThreshold: Number(val("support-threshold")) / 100,
          fromName: val("support-from"), signature: val("support-signature"), escalationAssignee: val("support-assignee"), vipDomains: val("support-vip"),
        } });
        await load();
        host.querySelector("#support-settings-status").textContent = "Saved.";
      } else if (a === "save-aidan") {
        await api(apiHeaders, "aidan", { body: { enabled: host.querySelector("#support-aidan-on").checked, allowedSenders: val("support-aidan-senders"),
          signatureLineOn: host.querySelector("#support-aidan-sigline-on").checked, signatureLine: val("support-aidan-sigline") } });
        await load();
        host.querySelector("#support-aidan-status").textContent = "Saved.";
      }
    } catch (err) { await alert(err.message); }
    // A save redraws the page with its buttons disabled again; a failed one
    // leaves the edits in place, so its button goes back to enabled.
    if (b.isConnected) b.disabled = false;
    syncSaveButtons();
  });
  return { load };
}
