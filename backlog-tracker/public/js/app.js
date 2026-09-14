// backlog-tracker frontend — a real Firestore-backed board, not a
// self-publishing Claude Artifact. Every open tab gets realtime updates
// via onSnapshot(), and a NEW backlog item fires the
// notifyOnBacklogItemCreated Cloud Function automatically (see
// ../functions/index.js) — no "Notify Claude" button to click.
//
// Multi-project: projects live in their own "projects" collection;
// backlogItems each carry a projectId. Items saved before multi-project
// shipped have no projectId — they're grouped under a synthesized
// "General" project (see migrateOrphanItems/ensureGeneralProjectDoc)
// rather than silently disappearing.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getFirestore, initializeFirestore, collection, addDoc, updateDoc, deleteDoc, setDoc, doc,
  onSnapshot, query, orderBy, serverTimestamp, writeBatch, arrayUnion,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import {
  getStorage, ref as storageRef, uploadBytes, getDownloadURL, deleteObject,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-storage.js";
import { firebaseConfig } from "./firebase-config.js";
import { APP_VERSION } from "./version.js";

const app = initializeApp(firebaseConfig);
// Long-polling, not the SDK's default streaming transport.
//
// Measured on a cold load of the live board (13 September 2026): the
// first Listen request errors after 219ms, the SDK opens a second one at
// 1.7s, and that one hangs for 45 seconds delivering nothing before it
// gives up — so the board sat on "0 items" for about a minute on every
// single load, on two different browsers, while the data itself was 200ms
// away. Long enough that it reads as broken rather than slow.
//
// experimentalAutoDetectLongPolling has been the default since v9.22 and
// does not save us here: it catches a stream that fails outright, not one
// that connects and then silently delivers nothing, which is this failure.
// Forcing the transport skips the attempt altogether — the same cold load,
// same network, first snapshot in 2.9s instead of ~60s.
//
// The cost is that updates arrive on a hanging GET rather than a live
// stream, which is a little less immediate; for a board whose realtime
// need is "a card moved column", that is a trade worth making many times
// over. initializeFirestore must be called before anything touches the
// instance, which is why it is here rather than beside the listeners.
const db = initializeFirestore(app, { experimentalForceLongPolling: true });
// Backs the Edit item modal's Attachments block (screenshots/screen
// recordings — see uploadItemAttachment) — needs storage.rules deployed
// (part of the deploy workflow's --only list) and Firebase Storage enabled
// for backlog-tracker-e4ed2, same one-time manual step Cloud Functions
// needed; see README.md "Attachments (screenshots & screen recordings)".
const storage = getStorage(app);
const itemsRef = collection(db, "backlogItems");
const projectsRef = collection(db, "projects");
const interfacesRef = collection(db, "interfaces");
const programsRef = collection(db, "programs");
const projectDocsRef = collection(db, "projectDocs");

const COLUMNS = [
  { key: "backlog", label: "Backlog", headClass: "backlog" },
  { key: "ready-for-testing", label: "Ready for Testing", headClass: "testing" },
  { key: "ready-to-publish", label: "Approved for Deployment", headClass: "publish" },
  { key: "published-live", label: "Deployed / Main Branch (Live)", headClass: "live" },
];
const COL_KEYS = COLUMNS.map((c) => c.key);

const CATEGORIES = [
  "Pricing & Offers", "Product Assets", "HQ Admin", "Retail Admin",
  "Menu Board", "Backend / Infrastructure", "Uncategorised",
];

const GENERAL_PROJECT_ID = "general";

// Curated Material Symbols names for FAQ category icons — a starting set
// covering common Help Center topics, not an exhaustive icon-library pick.
// A category's current icon is always included in its own dropdown (see
// faqCategoryIconOptionsHTML) even if it falls outside this list, so
// nothing silently changes on save just because someone typed a valid but
// uncurated icon name before this picker existed.
const FAQ_CATEGORY_ICONS = [
  "help", "rocket_launch", "storefront", "payments", "local_offer",
  "inventory_2", "storage", "settings", "tune", "group",
  "security", "campaign", "dashboard", "description", "build",
  "support_agent", "info", "warning", "category", "list_alt",
  "devices", "cloud", "lock", "notifications",
];

function escapeHTML(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ── Generic in-app dialog — the one thing every window.confirm/window.prompt/
// window.alert call in this app now goes through. A native dialog blocks
// every script running on the page for as long as it's open — including
// whatever's driving the board programmatically — which is exactly what
// froze the tab mid-deploy on 12 September (the project's own "Approved for
// Deployment" confirm dialog), and it can't be styled, validated, or
// dismissed except through its own OK/Cancel. This one small modal (see
// #dialog-backdrop in index.html) plus four thin wrappers below cover every
// shape the old native calls did: an OK-only message, an OK/Cancel
// question, a single labeled text field, and (for the FAQ image-insert
// dialog) more than one field at once. Only one can be open at a time,
// which matches how the native versions behaved too (they were modal).
let dialogResolve = null;
const dialogBackdrop = document.getElementById("dialog-backdrop");
const dialogTitleEl = document.getElementById("dialog-title");
const dialogMessageEl = document.getElementById("dialog-message");
const dialogFieldsEl = document.getElementById("dialog-fields");
const dialogCancelBtn = document.getElementById("dialog-cancel");
const dialogOkBtn = document.getElementById("dialog-ok");

function closeDialogWith(result) {
  dialogBackdrop.hidden = true;
  dialogFieldsEl.innerHTML = "";
  const resolve = dialogResolve;
  dialogResolve = null;
  if (resolve) resolve(result);
}

// Low-level opener all four wrappers below funnel through.
// fields: [{ id, label, value, multiline, rows, placeholder, type }]
// Resolves with `true` (OK, no fields), `null` (cancelled/closed), or an
// object keyed by each field's `id` (OK, with fields).
function openDialog({ title, message, fields, okLabel, cancelLabel, danger, showCancel }) {
  return new Promise((resolve) => {
    dialogResolve = resolve;
    dialogTitleEl.textContent = title || "";
    dialogMessageEl.textContent = message || "";
    dialogMessageEl.hidden = !message;
    dialogFieldsEl.innerHTML = (fields || []).map((f, i) => `
      <div>
        ${f.label ? `<label class="dialog-field-label" for="dialog-field-${i}">${escapeHTML(f.label)}</label>` : ""}
        ${f.multiline
          ? `<textarea id="dialog-field-${i}" class="dialog-field-input" rows="${f.rows || 4}" placeholder="${escapeHTML(f.placeholder || "")}"></textarea>`
          : `<input id="dialog-field-${i}" class="dialog-field-input" type="${f.type || "text"}" placeholder="${escapeHTML(f.placeholder || "")}">`}
      </div>`).join("");
    (fields || []).forEach((f, i) => {
      const el = document.getElementById(`dialog-field-${i}`);
      el.value = f.value || "";
      el.dataset.fieldId = f.id;
    });
    dialogCancelBtn.hidden = showCancel === false;
    dialogOkBtn.textContent = okLabel || "OK";
    dialogCancelBtn.textContent = cancelLabel || "Cancel";
    dialogOkBtn.classList.toggle("btn-danger", !!danger);
    dialogOkBtn.classList.toggle("btn-primary", !danger);
    dialogBackdrop.hidden = false;
    const firstField = dialogFieldsEl.querySelector("input, textarea");
    (firstField || dialogOkBtn).focus();
  });
}

function submitDialog() {
  if (!dialogResolve) return;
  const fieldEls = Array.from(dialogFieldsEl.querySelectorAll(".dialog-field-input"));
  if (!fieldEls.length) { closeDialogWith(true); return; }
  const result = {};
  fieldEls.forEach((el) => { result[el.dataset.fieldId] = el.value; });
  closeDialogWith(result);
}
dialogOkBtn.addEventListener("click", submitDialog);
dialogCancelBtn.addEventListener("click", () => closeDialogWith(null));
dialogBackdrop.addEventListener("click", (e) => { if (e.target === dialogBackdrop) closeDialogWith(null); });
document.getElementById("dialog-close").addEventListener("click", () => closeDialogWith(null));
document.addEventListener("keydown", (e) => {
  if (dialogBackdrop.hidden) return;
  if (e.key === "Escape") { closeDialogWith(null); return; }
  if (e.key === "Enter" && document.activeElement && document.activeElement.tagName !== "TEXTAREA") {
    e.preventDefault();
    submitDialog();
  }
});

// window.alert replacement — OK only, no cancel, nothing to type.
function showAlert(message, opts = {}) {
  return openDialog({ title: opts.title || "", message, showCancel: false, okLabel: opts.okLabel || "OK" });
}
// window.confirm replacement — resolves true (OK) or false (cancelled/closed).
function showConfirmDialog(message, opts = {}) {
  return openDialog({
    title: opts.title || "", message, showCancel: true,
    okLabel: opts.okLabel || "OK", cancelLabel: opts.cancelLabel || "Cancel", danger: opts.danger,
  }).then((v) => v === true);
}
// window.prompt replacement — resolves the typed string, or null if
// cancelled/closed, matching window.prompt's own return contract.
function showPromptDialog(message, defaultValue = "", opts = {}) {
  return openDialog({
    title: opts.title || "", message: opts.label ? "" : message,
    fields: [{ id: "value", label: opts.label || "", value: defaultValue, multiline: opts.multiline, rows: opts.rows, placeholder: opts.placeholder }],
    okLabel: opts.okLabel, cancelLabel: opts.cancelLabel,
  }).then((v) => (v ? v.value : null));
}
// For more than one field at once (the FAQ image-insert dialog's URL + alt
// text) — resolves an object keyed by each field's `id`, or null if
// cancelled/closed.
function showFieldDialog({ title, message, fields, okLabel, cancelLabel }) {
  return openDialog({ title, message, fields, okLabel, cancelLabel, showCancel: true });
}

let allItems = [];
let items = [];
let projects = [];
let projectsLoaded = false;
let interfaces = [];
let programs = [];
let projectDocs = [];
let editingProjectId = null;

// ── Backlog selection state (per project) — lets "Notify Claude" be
// pointed at just a hand-picked subset of a project's Backlog column
// instead of always sweeping everything in it. Purely a viewer-local,
// in-memory selection (not persisted anywhere) — it only matters for the
// next click of that project's own Notify Claude button, and clears once
// that click is sent. Keyed by projectId (using GENERAL_PROJECT_ID for
// items with no projectId, same fallback used everywhere else).
const selectedNotifyIds = {};
function getSelectedSet(pid) {
  if (!selectedNotifyIds[pid]) selectedNotifyIds[pid] = new Set();
  return selectedNotifyIds[pid];
}

// ── Same idea, separate namespace, for the Ready for Testing column's own
// selection — which items a "Approved for Deployment" click should act on. Kept
// distinct from selectedNotifyIds/getSelectedSet above rather than reusing
// it: the two columns' selections are unrelated (a card can't be in both at
// once anyway, but conflating the storage would make that an assumption
// instead of a guarantee) and each clears independently once its own CTA
// fires. ─────────────────────────────────────────────────────────────────
const selectedDeployToFeatureIds = {};
function getDeploySelectedSet(pid) {
  if (!selectedDeployToFeatureIds[pid]) selectedDeployToFeatureIds[pid] = new Set();
  return selectedDeployToFeatureIds[pid];
}

// ── Optimistic "just clicked Notify Claude" state (per project) — the real
// spinning state lives in projects/{id}.notifyRoutine, but that's written by
// notifyOnProjectReadyForReview (see ../functions/index.js) reacting to
// notifyRequestedAt, which can lag the actual click by a second or more.
// Without this, the button looks like a dead click for that whole gap.
// Purely client-local; cleared the instant the real notifyRoutine doc takes
// over (see notifyClaudeButtonHTML), or after NOTIFY_OPTIMISTIC_STALE_MS if
// it never does (e.g. the Cloud Function's Routine secrets aren't set) —
// same "never wedge the button spinning forever" guarantee the real
// in-progress state already has.
const notifyOptimisticClicks = {};
const NOTIFY_OPTIMISTIC_STALE_MS = 45 * 1000;

// Same optimistic-click bridge as above, for the "Deploy to Main" button —
// the real spinning state lives in projects/{id}.deployRoutine, written by
// notifyOnProjectReadyToDeploy reacting to deployNotifyRequestedAt.
const deployOptimisticClicks = {};
const DEPLOY_OPTIMISTIC_STALE_MS = 45 * 1000;

// ── Docs page state (per-project requirements + interfaces with other
// projects) — an interface is a maintained contract doc shared between
// exactly two projects, stored once in "interfaces" and shown identically
// from either side. ──────────────────────────────────────────────────────
let docsProjectId = null;
let editingInterfaceId = null; // null while adding, an id while editing
let editingDocId = null; // null while adding, an id while editing (Additional documents)

// ── Archive page state ─────────────────────────────────────────────────
let archiveProjectId = null;
let archiveSort = { field: "date", dir: "desc" };
let archiveFilters = { type: "", category: "", search: "" };

function colListId(pid, colKey) { return `col-${pid}-${colKey}`; }

// ── PER-PROJECT COLLAPSE STATE (a real browser, not a reload-on-publish
// Artifact, so this is plain localStorage — a per-viewer display
// preference, not something to write back to Firestore for everyone). ──
const COLLAPSE_KEY = "bt-collapsed-projects";
function loadCollapsedMap() {
  try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "{}"); } catch (err) { return {}; }
}
function isProjectCollapsed(pid) { return !!loadCollapsedMap()[pid]; }
function toggleProjectCollapsed(pid) {
  const m = loadCollapsedMap();
  m[pid] = !m[pid];
  try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(m)); } catch (err) {}
  render();
}

// Per-column collapse (eQOIaEcF4xMSVmZt1rnA) — mobile-only, see
// projectSectionHTML's own comment. Deliberately in-memory only, not
// localStorage: this is a "get it out of my way while I scroll" toggle for
// the session at hand, not a durable per-viewer preference worth persisting
// (same reasoning FAQ Management's own faFolderState already uses).
const collapsedColumns = new Set();
function columnCollapseKey(pid, colKey) { return pid + ":" + colKey; }
function isColumnCollapsed(pid, colKey) { return collapsedColumns.has(columnCollapseKey(pid, colKey)); }
function toggleColumnCollapsed(pid, colKey) {
  const key = columnCollapseKey(pid, colKey);
  if (collapsedColumns.has(key)) collapsedColumns.delete(key); else collapsedColumns.add(key);
  render();
}

// ── Per-project "⋮" options menu — plain show/hide, one open at a time.
// Rebuilt on every render() along with everything else in #projects-root,
// so there's no stale-DOM-node bookkeeping to worry about; it just starts
// closed again after any state change, which is the safe default anyway.
function closeAllOptionMenus() {
  document.querySelectorAll(".project-options-menu, .faq-article-options-menu").forEach((m) => { m.hidden = true; });
}
function toggleOptionMenu(btn) {
  const menu = btn.nextElementSibling;
  const wasHidden = menu.hidden;
  closeAllOptionMenus();
  menu.hidden = !wasHidden;
}
document.addEventListener("click", (e) => {
  if (!e.target.closest(".project-options, .faq-article-options")) closeAllOptionMenus();
});

// ── Left nav drawer (hamburger) — the header's own "FAQ Center" links moved
// in here, leaving only "+ New project" in the topbar. "Archived projects"
// lives inside the Settings page now, not as its own drawer entry (see
// "fa-open-archived-projects-btn" below), so the two FAQ admin pages never
// list anything beyond their own subject and the drawer always shows the
// same fixed three destinations. Kept in the DOM at all times (never
// [hidden]) so the CSS transform transition on .nav-drawer actually
// animates open/closed. ──────────────────────────────────────────────────
const navDrawer = document.getElementById("nav-drawer");
const navDrawerBackdrop = document.getElementById("nav-drawer-backdrop");
function openNavDrawer() { navDrawer.classList.add("open"); navDrawerBackdrop.classList.add("open"); }
function closeNavDrawer() { navDrawer.classList.remove("open"); navDrawerBackdrop.classList.remove("open"); }
document.getElementById("nav-open-btn").addEventListener("click", openNavDrawer);
document.getElementById("nav-close-btn").addEventListener("click", closeNavDrawer);
navDrawerBackdrop.addEventListener("click", closeNavDrawer);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && navDrawer.classList.contains("open")) closeNavDrawer();
});

// "PH Console" — the nav drawer's own way back to the board, replacing the
// "← Back to board" button every sub-page used to carry individually. The
// drawer stays visible on every sub-page (it's part of the fixed topbar,
// not projects-root), so a single "you are here" home link in the drawer
// covers all of them; each close*Page() below is safe to call even when
// that particular page isn't the one currently open (it just re-hides an
// already-hidden section and re-shows projects-root, a no-op either way).
//
// closeAllSubPages() is also called at the top of every openXPage()
// below, for the same reason: the nav drawer's "Settings"/"FAQ
// Management" items are reachable from any sub-page, so without this,
// opening one while another was already open left both showing at once
// instead of replacing it — most visibly when jumping straight from
// "Settings" to "FAQ Management" (or back), which rendered both blocks
// stacked on screen simultaneously.
function closeAllSubPages() {
  closeArchivePage();
  closeArchivedProjectsPage();
  closeDocsPage();
  closeFaqSettingsPage();
  closeFaqArticlesPage();
  closeFaqArticleEditorPage();
}
function returnToBoard() {
  closeAllSubPages();
}
document.getElementById("nav-ph-console-btn").addEventListener("click", () => { closeNavDrawer(); returnToBoard(); });
// The logo/title in the top-left corner (a text placeholder until a real
// logo image ships) is clickable from anywhere in the app, same
// destination as the drawer's own "Agent console" home link above.
document.getElementById("topbar-logo-btn").addEventListener("click", () => { closeNavDrawer(); returnToBoard(); });

function cardHTML(item) {
  const idx = COL_KEYS.indexOf(item.status);
  // Moving back is a designed, documented flow from ready-to-publish
  // (send back for more work — see moveItem()'s own testPassed-reset
  // comment) but NOT from ready-for-testing straight to Backlog: a Ready
  // for Testing card always has a real, already-open PR behind it
  // (patchBranch) that this move does nothing to close, reconnect, or
  // even leave a visible trace of — patchReady stays false, so
  // backlog-automation.yml never looks at the item again, and nothing on
  // the resulting Backlog card hints it already has a PR. Re-investigating
  // it from Backlog then either silently duplicates that PR's work or, if
  // findExistingPrForItem finds the still-open original, gets skipped with
  // no path forward either — the exact "tickets taken from Backlog go back
  // to Backlog" report this was fixed for (2026-09-13). Excluding
  // "ready-for-testing" from canLeft removes the only code path capable of
  // producing that transition at all (no automation step ever moves a card
  // backward on its own — see run-backlog-automation.js).
  const canLeft = idx > 0 && item.status !== "ready-for-testing";
  const isTesting = item.status === "ready-for-testing";
  const isLiveBranch = item.status === "ready-to-publish";
  const isBacklog = item.status === "backlog";
  const pid = item.projectId || GENERAL_PROJECT_ID;
  // A Backlog card the Routine has already packaged a fix for (patchFiles +
  // patchReady written, see ROUTINE_INSTRUCTIONS.md) but that
  // backlog-automation.yml hasn't picked up yet (it polls patchReady every
  // ~2 minutes) sits in this column for a short window with real,
  // in-flight work behind it. Editing, moving, or deleting it in that
  // window would silently orphan whatever the Routine just wrote — so it
  // locks: no checkbox, no edit/comment/move/delete, just a passive hint,
  // the same "show a status line instead of a live control" treatment
  // already used for a Live-on-Feature-Branch card's own merge-pending-hint
  // below. It naturally unlocks itself the moment the automation flips
  // status to ready-for-testing, since isBacklog goes false then too.
  const isInDevelopment = isBacklog && !!item.patchReady;
  // A Backlog card the project's own "Notify Claude" button has already
  // sent off (its id is in that project's notifyRoutine.sentItemIds while
  // notifyRoutine.status is still "in-progress") but that the Routine
  // hasn't packaged a fix for yet (isInDevelopment above, which needs
  // patchReady, is still false) — the reported bug: a ticket "selected to
  // go to development" stayed fully editable/movable/deletable for the
  // entire time Claude was actually investigating it, which is exactly the
  // window a person is most likely to accidentally step on it. Same stale
  // check as notifyClaudeButtonHTML's own isStale, so this unlocks on its
  // own if a fired session never reports back, rather than staying locked
  // forever on a crashed run.
  const routineForCard = projects.find((p) => p.id === pid);
  const cardRoutine = routineForCard && routineForCard.notifyRoutine;
  const cardRoutineFiredMs = cardRoutine ? tsMillis(cardRoutine.firedAt) : 0;
  const cardRoutineStale = cardRoutine?.status === "in-progress" && cardRoutineFiredMs && (Date.now() - cardRoutineFiredMs) > NOTIFY_ROUTINE_STALE_MS;
  const isSentToClaude = isBacklog && !isInDevelopment
    && cardRoutine?.status === "in-progress" && !cardRoutineStale
    && (cardRoutine.sentItemIds || []).includes(item.id);
  // Mirrors isInDevelopment above but for the opposite end of the pipeline:
  // once the Routine has confirmed a ready-to-publish item's PR is green
  // and mergeable and written mergeReady (see ROUTINE_INSTRUCTIONS.md's
  // "Notify Claude — Deploy" flow), backlog-automation.yml will merge it on
  // its own next poll — editing or moving it in that window is exactly as
  // unsafe as touching an isInDevelopment card, so it gets the same lock
  // treatment. It naturally unlocks the instant status moves off
  // ready-to-publish, since isLiveBranch goes false then too.
  const isDeploying = isLiveBranch && !!item.mergeReady;
  const isLocked = isInDevelopment || isDeploying || isSentToClaude;
  // A card flagged noDeploymentRequired has no PR for Deploy to Main to
  // merge — the automation's own no-diff path creates exactly this shape
  // (see run-backlog-automation.js) — so it gets the one-click completion
  // (approveBtn below) at either stage, rather than a hint pointing at a
  // button that can never finish it. Without this, such a card sitting in
  // Approved for Deployment had no path forward except being moved back a
  // column first.
  const noDeployPending = !!item.noDeploymentRequired && (isTesting || isLiveBranch);
  const canDelete = isBacklog && !isInDevelopment && !isSentToClaude;

  // Backlog cards select for "Ready for Dev"; Ready for Testing cards
  // (except noDeploymentRequired ones, which skip the feature-branch step
  // entirely) select for "Approved for Deployment" — two different pools, two
  // different checkbox classes/selection sets (see getSelectedSet vs.
  // getDeploySelectedSet). No other column gets a checkbox — nothing else
  // in the pipeline acts on a hand-picked subset.
  const selectCb = (isBacklog && !isInDevelopment && !isSentToClaude)
    ? `<input type="checkbox" class="card-select-cb" data-id="${item.id}" data-project-id="${escapeHTML(pid)}" title="Select for Ready for Dev" ${getSelectedSet(pid).has(item.id) ? "checked" : ""}>`
    : (isTesting && !item.noDeploymentRequired
        ? `<input type="checkbox" class="card-deploy-select-cb" data-id="${item.id}" data-project-id="${escapeHTML(pid)}" title="Select for Approved for Deployment" ${getDeploySelectedSet(pid).has(item.id) ? "checked" : ""}>`
        : "");

  // isLocked (isInDevelopment/isSentToClaude) can never coincide with
  // canLeft anyway (both require isBacklog, where canLeft is already
  // false), but isDeploying can: a ready-to-publish card the Routine has
  // confirmed mergeable and handed to backlog-automation.yml is genuinely
  // mid-merge, and moving it back to Ready for Testing in that window (its
  // own dir===-1 case in moveItem() resets testPassed) races the
  // automation's own status write — whichever lands last wins, which looks
  // exactly like a card "reverting on its own" even though a person's
  // click caused it.
  const leftBtn = (canLeft && !isLocked)
    ? `<button type="button" class="icon-btn move-btn" data-id="${item.id}" data-dir="-1" title="Move back">&larr;</button>`
    : "";
  const deleteBtn = canDelete
    ? `<button type="button" class="icon-btn delete-btn" data-id="${item.id}" title="Remove">&times;</button>`
    : "";
  // A card flagged noDeploymentRequired (see the Edit item modal) has no
  // code to push — e.g. a Firestore-only data/config change — so there's
  // nothing for the "Approved for Deployment" step (column or CTA) to
  // gate. Once tested it goes straight to published-live via
  // confirmTestedNoDeploy(),
  // its own separate one-click path — it never enters the testPassed pool
  // at all.
  //
  // A normal item's "confirm tested" click does NOT advance the column by
  // itself (a single click used to move it straight to Approved for
  // Deployment, which is exactly the behavior this replaced — one click
  // testing one item shouldn't silently put that item on the feature
  // branch with no chance to also confirm the others in the same batch).
  // It only flags
  // testPassed and stays in Ready for Testing; advancing is the separate,
  // explicit "Approved for Deployment" project action below, which can act on
  // several passed items at once. Clicking again un-marks it (toggle), in
  // case it was flagged by mistake before "Approved for Deployment" is clicked.
  const approveBtn = (isTesting || noDeployPending)
    ? (item.noDeploymentRequired
        ? `<button type="button" class="approve-btn confirm-no-deploy-btn" data-id="${item.id}">Confirm tested — mark Merged to Main</button>`
        : (item.testPassed
            ? `<button type="button" class="approve-btn test-passed-btn test-passed-btn-active" data-id="${item.id}" title="Click to un-mark">&#10003; Passed testing</button>`
            : `<button type="button" class="approve-btn test-passed-btn" data-id="${item.id}">Confirm tested</button>`))
    : "";
  // Deliberately not a button: there used to be a "Merge to main" button
  // here that just wrote status: "published-live" directly, with zero
  // connection to whether the PR was actually merged on GitHub — a card
  // could say "Merged to Main" while its PR sat open. The only honest way
  // to reach published-live now is the project's own "Notify Claude —
  // Deploy" action (see deployNotifyButtonHTML), which only advances a
  // card once backlog-automation.yml has actually merged its PR.
  const mergeBtn = isLiveBranch && !noDeployPending
    ? (isDeploying
        ? `<span class="in-development-hint" title="Claude has confirmed this PR is green and mergeable and told backlog-automation.yml to merge it — it's locked until that merge actually lands and this card moves to Merged to Main (Live)">Deploying — locked</span>`
        : `<span class="merge-pending-hint" title="Only this project's own Deploy to Main button actually merges this to main">Waiting for Deploy to Main</span>`)
    : "";
  const isPublished = item.status === "published-live";
  const archiveBtn = isPublished
    ? `<button type="button" class="icon-btn archive-btn" data-id="${item.id}" title="Archive">&#128451;</button>`
    : "";
  const canRight = idx < COL_KEYS.length - 1 && !isTesting && !isLiveBranch && !isInDevelopment && !isSentToClaude;
  const rightBtn = canRight
    ? `<button type="button" class="icon-btn move-btn" data-id="${item.id}" data-dir="1" title="Move forward">&rarr;</button>`
    : "";
  // Passive, not a button — same "show a status line instead of a live
  // control" treatment as mergeBtn above, for the short window between the
  // Routine setting patchReady and backlog-automation.yml actually picking
  // it up (see isInDevelopment above).
  const inDevelopmentHint = isInDevelopment
    ? `<span class="in-development-hint" title="Claude has already packaged a fix for this — it's locked until backlog-automation.yml opens the PR and moves it to Ready for Testing">In development — locked</span>`
    : (isSentToClaude
        ? `<span class="in-development-hint" title="This item was sent to Claude via Ready for Dev and is still being investigated — it's locked until a fix is packaged (or the Notify Claude session finishes)">Sent to Claude — locked</span>`
        : "");
  const noDeployBadge = item.noDeploymentRequired
    ? `<span class="no-deploy-badge" title="Live data/config change only — no code to push or deploy">No deployment required</span>`
    : "";
  // The backlog-tracker APP_VERSION stamped the moment this card first
  // reached Ready for Testing (see moveItem/processApplyPatch) — the same
  // number shown in the app's own footer, so it's clear which build to
  // check before testing. Carries through Approved for Deployment and
  // Deployed/Main Branch (Live) unchanged; see the Archive table for the
  // same value once archived.
  const testVersionBadge = item.testVersion
    ? `<span class="test-version-badge" title="backlog-tracker's own version when this was marked Ready for Testing — check the live footer shows at least this version">Test version: v${escapeHTML(item.testVersion)}</span>`
    : "";
  // The pull request this card's work actually landed in, recorded by
  // run-backlog-automation.js when it opens the PR and again when it
  // merges. Before this, a card's PR number existed only as free text
  // inside a notes entry, so finding it meant reading the notes or
  // searching GitHub by hand — and a card in Approved for Deployment gave
  // no sign of whether its PR was even open. Built by concatenation
  // rather than a template literal purely so this block stays easy to
  // transplant between checkouts.
  const prBadge = item.prUrl
    ? '<a class="pr-badge' + (item.mergedAt ? ' pr-badge-merged' : '') + '" href="' + escapeHTML(item.prUrl) +
      '" target="_blank" rel="noopener" title="' +
      (item.mergedAt ? 'Merged to main by the backlog automation' : 'Open on GitHub — not merged yet') +
      '">PR #' + escapeHTML(String(item.prNumber || '?')) + (item.mergedAt ? ' &middot; merged' : ' &middot; open') + '</a>'
    : "";
  // Per-card deploy provenance, written by run-backlog-automation.js's
  // processMergePr at merge time (mergeCommit, deployRunUrl) and updated by
  // its own reconciliation pass once the dispatched deploy run actually
  // finishes (deployConclusion: "pending" -> "success"/"failure"/etc). Only
  // meaningful once a card is actually Merged to Main (Live) — before that
  // there's nothing to report yet. Pairs with the board's overall health
  // strip: that shows the pipeline in aggregate, this shows it per ticket,
  // closing the gap where confirming 13 cards were genuinely live meant
  // fetching the deployed app.js and hashing it by hand.
  const deployBadge = (item.status === "published-live" && (item.deployRunUrl || item.mergeCommit))
    ? '<div class="deploy-badge deploy-badge-' + escapeHTML(item.deployConclusion || "unknown") + '">' +
      (item.mergeCommit ? '<span class="deploy-badge-commit" title="Merge commit">' + escapeHTML(String(item.mergeCommit).slice(0, 7)) + '</span>' : "") +
      (item.deployRunUrl
        ? '<a href="' + escapeHTML(item.deployRunUrl) + '" target="_blank" rel="noopener">' +
          (item.deployConclusion === "success" ? "Deploy succeeded"
            : item.deployConclusion === "pending" || !item.deployConclusion ? "Deploy running&hellip;"
            : "Deploy " + escapeHTML(item.deployConclusion)) + '</a>'
        : '<span>Deploy status unknown</span>') +
      '</div>'
    : "";
  const commentCount = (item.notes || []).length;
  const editBtn = isLocked
    ? ""
    : `<button type="button" class="icon-btn edit-item-btn" data-id="${item.id}" title="Edit / comments">&#9998;${commentCount ? ` <span class="options-menu-count">${commentCount}</span>` : ""}</button>`;
  // Only relevant once a ticket is actually up on a feature branch — a
  // rawcdn.githack.com link (or a PR URL when the page can't be
  // rawcdn.githack'd directly) to click through and confirm before hitting
  // "Confirm live on branch". rawcdn.githack.com, not raw.githack.com —
  // the latter proxies through jsDelivr's CDN cache (up to ~7 days), so a
  // link set right after one push can keep showing that first commit even
  // after later pushes update the file, with no visible error.
  // rawcdn.githack.com is githack's own always-uncached host, meant
  // specifically for testing an in-progress branch like this one. Set/
  // changed via the generic showPromptDialog() (a single-field in-app
  // dialog) rather than a bespoke modal — this is a one-off paste, not a
  // form worth its own dedicated markup.
  const testLinkHTML = isTesting
    ? (item.previewUrl
        ? `<div class="test-link-row">
            <a href="${escapeHTML(item.previewUrl)}" target="_blank" rel="noopener" class="test-link-btn">Test this &rarr;</a>
            <button type="button" class="icon-btn test-link-edit-btn" data-id="${item.id}" title="Change test link">&#9998;</button>
          </div>`
        : `<button type="button" class="btn-ghost test-link-set-btn" data-id="${item.id}">Set test link</button>`)
    : "";

  // Once a ticket reaches Ready for Testing, the raw typed/dictated
  // description that started it is no longer the most useful thing to
  // read first — testSummary (set by whoever actually implemented and
  // opened a PR for it, e.g. the Notify Claude Routine) is a clear,
  // standalone description of what changed plus concrete steps to test it.
  // The original request is still one click away, not deleted.
  const hasTestSummary = isTesting && (item.testSummary || "").trim();
  const descHTML = hasTestSummary
    ? `<div class="card-desc-wrap">
        <p class="card-desc">${escapeHTML(item.testSummary)}</p>
        <button type="button" class="card-desc-toggle-btn" data-id="${item.id}">Show original request</button>
        <p class="card-desc card-desc-original" hidden>${escapeHTML(item.desc)}</p>
      </div>`
    : `<p class="card-desc">${escapeHTML(item.desc)}</p>`;

  // A screenshot or screen recording attached via uploadItemAttachment.
  // Always rendered now, even at zero — it used to only appear once a card
  // already had an attachment, which meant nothing on the card itself
  // hinted that attaching was even possible (DrIEsKsdi3WrwXbUdMH6 and its
  // duplicates: "it's not possible to attach anything to a ticket" was a
  // findability problem, not a real bug). Clicking it opens the same
  // quick-comment modal the comment icon does, which now has its own
  // Attach screenshot / Record screen controls.
  const attachmentCount = (item.attachments || []).length;
  const attachmentBadge =
    `<button type="button" class="icon-btn attachment-btn" data-id="${item.id}"${isLocked ? ' data-readonly="1"' : ""} title="${
      attachmentCount ? `${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}` : "Attach a screenshot or screen recording"
    }">&#128206;${attachmentCount ? ` <span class="options-menu-count">${attachmentCount}</span>` : ""}</button>`;
  // Bottom-right of the tile, alongside archive/delete — not the plain
  // left-aligned icon-row spot it used to share with the category badge,
  // which read as just another muted utility icon. A filled, rounded pill
  // (see .quick-comment-btn) with its own comment count reads as its own
  // distinct, clickable affordance instead.
  //
  // Present on a locked card too, where it used to be removed along with
  // every other control. A locked card is precisely the one whose thread
  // you want — it's mid-automation, and Claude's notes on it are the only
  // account of what's happening — and reading can't race anything. It
  // opens read-only there; the modal hides its composer (see
  // openQuickCommentModal).
  const quickCommentBtn =
    `<button type="button" class="icon-btn quick-comment-btn" data-id="${item.id}"${isLocked ? ' data-readonly="1"' : ""} title="${
      isLocked
        ? `${commentCount || "No"} comment${commentCount === 1 ? "" : "s"} — read only while this ticket is locked`
        : `Comments${commentCount ? ` — ${commentCount} so far` : ""}`
    }">&#128172;${commentCount ? ` <span class="options-menu-count">${commentCount}</span>` : ""}</button>`;

  return `
    <article class="card${isLocked ? " card-in-development" : ""}" data-id="${item.id}">
      <div class="card-top">
        <div class="card-top-left">
          ${selectCb}
          <span class="badge badge-${item.type}">${item.type === "bug" ? "Bug" : "Feature"}</span>
        </div>
        <div class="card-move">${editBtn}${leftBtn}${rightBtn}</div>
      </div>
      <h3 class="card-title">${escapeHTML(item.title)}</h3>
      ${descHTML}
      ${noDeployBadge}${testVersionBadge}${prBadge}${deployBadge}
      <div class="card-footer">
        <div class="card-footer-left">
          <span class="card-cat">${escapeHTML(item.category || "Uncategorised")}</span>
          ${attachmentBadge}
        </div>
        <div class="card-move">${quickCommentBtn}${archiveBtn}${deleteBtn}</div>
      </div>
      ${testLinkHTML}
      ${approveBtn}${mergeBtn}${inDevelopmentHint}
    </article>`;
}

function archivedCountForProject(pid) {
  return allItems.filter((i) => (i.projectId || GENERAL_PROJECT_ID) === pid && i.status === "archived").length;
}

function backlogCountForProject(pid) {
  return items.filter((i) => (i.projectId || GENERAL_PROJECT_ID) === pid && i.status === "backlog").length;
}

function deployReadyCountForProject(pid) {
  // noDeploymentRequired cards are excluded: Deploy to Main merges PRs,
  // and these have none, so counting them promised a deploy that would
  // find nothing to merge.
  return items.filter((i) => (i.projectId || GENERAL_PROJECT_ID) === pid && i.status === "ready-to-publish" && !i.noDeploymentRequired).length;
}

// Ready for Testing items an individual "Confirm tested" click has already
// flagged — the pool "Approved for Deployment" draws from. A noDeploymentRequired
// item never enters this pool (see cardHTML): it has its own separate,
// immediate confirmTestedNoDeploy() path straight to published-live, since
// there's no feature branch step for it to go through at all.
function testPassedCountForProject(pid) {
  return items.filter((i) =>
    (i.projectId || GENERAL_PROJECT_ID) === pid && i.status === "ready-for-testing" &&
    i.testPassed && !i.noDeploymentRequired
  ).length;
}

function interfacesForProject(pid) {
  return interfaces.filter((f) => Array.isArray(f.projectIds) && f.projectIds.includes(pid));
}

// The "⋮" options menu is the one place Archived/Requirements/Interfaces
// live now — on mobile especially, a row of 3-4 ghost buttons next to the
// primary Add button was the actual "CTAs don't work on mobile" complaint,
// so everything but the primary action moves in here.
function optionsMenuHTML(project) {
  const pid = project.id;
  const archivedCount = archivedCountForProject(pid);
  const hasReq = !!(project.requirementsMd && project.requirementsMd.trim());
  const ifaces = interfacesForProject(pid);

  let html = `
    <button type="button" class="options-menu-item project-archive-btn" data-project-id="${escapeHTML(pid)}">
      Archived tickets <span class="options-menu-count">${archivedCount}</span>
    </button>
    <button type="button" class="options-menu-item project-docs-btn${hasReq ? "" : " options-menu-item-empty"}" data-project-id="${escapeHTML(pid)}">
      ${hasReq ? "Project Settings" : "Project Settings — not set yet"}
    </button>`;

  if (ifaces.length) {
    html += ifaces.map((f) => {
      const otherId = f.projectIds.find((id) => id !== pid);
      return `<button type="button" class="options-menu-item interface-open-btn" data-interface-id="${escapeHTML(f.id)}">
        ${escapeHTML(f.name)}
        <span class="options-menu-sub">interface with ${escapeHTML(projectName(otherId))}</span>
      </button>`;
    }).join("");
  } else {
    html += `<button type="button" class="options-menu-item options-menu-item-empty interface-add-btn" data-project-id="${escapeHTML(pid)}">
      No interface contract yet
    </button>`;
  }

  html += `<button type="button" class="options-menu-item options-menu-item-danger project-archive-project-btn" data-project-id="${escapeHTML(pid)}">
    Archive project
  </button>`;
  return html;
}

// Moved out of the "⋮" options menu into its own header CTA, before
// + New backlog item — buried in the menu, people weren't finding it once
// they'd actually added several items and wanted to send them off.
//
// Hidden entirely (not just dimmed) when Backlog is empty — there's
// nothing for it to do until an item exists, so a dimmed-but-clickable
// button was just a dead click waiting to happen. When there IS something
// to notify about, it uses the platform's AI-gradient treatment (see the
// ph-designer skill's "AI action button" recipe — the same teal→violet
// gradient as "Launch a New Campaign") to read as the prominent, AI-driven
// action it actually is, rather than a plain ghost button.
// A fired session is asked (functions/index.js's selfReportHint) to flip
// notifyRoutine.status to "done"/"error" itself when it finishes. A run
// older than this is treated as done on the client's own initiative
// regardless — comfortably above every observed run length so far (the
// longest seen in practice was ~14 minutes) — so a session running an
// older Routine prompt without that instruction, or one that crashes
// mid-run, can never wedge the button in a permanent spinning state.
const NOTIFY_ROUTINE_STALE_MS = 20 * 60 * 1000;

function notifyClaudeButtonHTML(project) {
  const pid = project.id;
  const routine = project.notifyRoutine;
  const firedMs = routine ? tsMillis(routine.firedAt) : 0;
  const isStale = routine?.status === "in-progress" && firedMs && (Date.now() - firedMs) > NOTIFY_ROUTINE_STALE_MS;
  const inProgress = routine?.status === "in-progress" && !isStale;

  // The real notifyRoutine doc always wins the moment it arrives; this only
  // covers the gap between the click and that Cloud Function write landing.
  const clickedAt = notifyOptimisticClicks[pid];
  const optimisticPending = !inProgress && clickedAt && (Date.now() - clickedAt) < NOTIFY_OPTIMISTIC_STALE_MS;
  if (clickedAt && !optimisticPending) delete notifyOptimisticClicks[pid];

  if (!inProgress && !optimisticPending) {
    const backlogCount = backlogCountForProject(pid);
    if (!backlogCount) return "";
    // A non-empty selection (see the Backlog column's own checkboxes)
    // narrows this click to just those items instead of the whole column —
    // reflected here so it's clear before clicking what's about to be sent.
    const selectedCount = items.filter((i) =>
      (i.projectId || GENERAL_PROJECT_ID) === pid && i.status === "backlog" && getSelectedSet(pid).has(i.id)
    ).length;
    const label = selectedCount ? `Ready for Dev — ${selectedCount} selected` : "Ready for Dev";
    return `<button type="button" class="notify-claude-btn project-notify-btn" data-project-id="${escapeHTML(pid)}">
      <span class="material-symbols-outlined notify-claude-icon">auto_awesome</span>
      <span class="notify-claude-label">${label}</span>
      <span class="notify-claude-count-pill">${selectedCount || backlogCount}</span>
    </button>`;
  }

  if (optimisticPending) {
    // Pressed, but notifyRoutine hasn't landed yet — no item count, no
    // session to link to. Same spinner treatment as the real "Working…"
    // state below so pressing the button visibly does something at once.
    return `<button type="button" class="notify-claude-btn notify-claude-btn-working" disabled title="Sending to Claude&hellip;">
      <span class="notify-claude-spinner"></span>
      <span class="notify-claude-label">Working&hellip;</span>
    </button>`;
  }

  // In progress: the main button reflects the batch already sent (fixed
  // count, disabled, spinning); anything added to Backlog since that click
  // surfaces as its own small, still-clickable CTA rather than being folded
  // into a count that would otherwise conflate "already being worked" with
  // "brand new."
  const sentIds = new Set(routine.sentItemIds || []);
  const newCount = items.filter((i) =>
    (i.projectId || GENERAL_PROJECT_ID) === pid && i.status === "backlog" && !sentIds.has(i.id)
  ).length;

  // "Confirmation from Claude" = the Routine fire actually resolved with a
  // session — before that, there's nothing to link to yet, so the button
  // stays a disabled "Working…". Once a session exists, the button itself
  // becomes the "View session" link (copy flips to "Deving…") instead of a
  // separate link sitting next to a disabled button.
  const itemCountLabel = routine.itemCount || sentIds.size;
  const confirmed = !!routine.sessionUrl;
  const mainBtnInner = `
    <span class="notify-claude-spinner"></span>
    <span class="notify-claude-label">${confirmed ? "Deving&hellip;" : "Working&hellip;"}</span>
    <span class="notify-claude-count-pill">${itemCountLabel}</span>`;
  const mainBtn = confirmed
    ? `<a href="${escapeHTML(routine.sessionUrl)}" target="_blank" rel="noopener" class="notify-claude-btn notify-claude-btn-working notify-claude-btn-clickable" title="View the Claude Code session working through the ${itemCountLabel} item(s) sent">${mainBtnInner}</a>`
    : `<button type="button" class="notify-claude-btn notify-claude-btn-working" disabled title="A Claude Code session is working through the ${itemCountLabel} item(s) sent">${mainBtnInner}</button>`;

  const newBtn = newCount
    ? `<button type="button" class="notify-claude-btn project-notify-btn" data-project-id="${escapeHTML(pid)}">
        <span class="material-symbols-outlined notify-claude-icon">auto_awesome</span>
        <span class="notify-claude-label">Ready for Dev — ${newCount} new</span>
      </button>`
    : "";

  return mainBtn + newBtn;
}

// Same as NOTIFY_ROUTINE_STALE_MS above, but for the "Deploy to Main"
// button's own project.deployRoutine.
const DEPLOY_ROUTINE_STALE_MS = 20 * 60 * 1000;

// Same "Notify Claude" gradient action, but for the opposite end of the
// pipeline: items already tested and confirmed "Approved for Deployment"
// (ready-to-publish) that are just waiting for someone to actually merge
// their PRs to main. Same hidden-when-nothing-to-do rule as the Backlog
// button above — there's nothing for this to do until a card reaches that
// column. Mirrors notifyClaudeButtonHTML's spinner/session-link treatment
// via project.deployRoutine (written by notifyOnProjectReadyToDeploy) —
// before this, clicking "Deploy to Main" gave no ongoing feedback at all
// (a one-time alert dialog, then the button looked exactly like it hadn't been
// clicked), so an in-flight deploy was indistinguishable from an unclicked
// one. See cardHTML's own isDeploying for the matching per-item card lock.
function deployNotifyButtonHTML(project) {
  const pid = project.id;
  const routine = project.deployRoutine;
  const firedMs = routine ? tsMillis(routine.firedAt) : 0;
  const isStale = routine?.status === "in-progress" && firedMs && (Date.now() - firedMs) > DEPLOY_ROUTINE_STALE_MS;
  const inProgress = routine?.status === "in-progress" && !isStale;

  // Same click-to-doc-write bridge as notifyClaudeButtonHTML's
  // notifyOptimisticClicks — covers the gap before deployRoutine lands.
  const clickedAt = deployOptimisticClicks[pid];
  const optimisticPending = !inProgress && clickedAt && (Date.now() - clickedAt) < DEPLOY_OPTIMISTIC_STALE_MS;
  if (clickedAt && !optimisticPending) delete deployOptimisticClicks[pid];

  if (!inProgress && !optimisticPending) {
    const deployCount = deployReadyCountForProject(pid);
    if (!deployCount) return "";
    return `<button type="button" class="notify-claude-btn deploy-notify-btn" data-project-id="${escapeHTML(pid)}">
      <span class="material-symbols-outlined notify-claude-icon">rocket_launch</span>
      <span class="notify-claude-label">Deploy to Main</span>
      <span class="notify-claude-count-pill">${deployCount}</span>
    </button>`;
  }

  if (optimisticPending) {
    return `<button type="button" class="notify-claude-btn notify-claude-btn-working" disabled title="Sending to Claude&hellip;">
      <span class="notify-claude-spinner"></span>
      <span class="notify-claude-label">Working&hellip;</span>
    </button>`;
  }

  const itemCountLabel = routine.itemCount || deployReadyCountForProject(pid);
  const confirmed = !!routine.sessionUrl;
  const mainBtnInner = `
    <span class="notify-claude-spinner"></span>
    <span class="notify-claude-label">${confirmed ? "Deploying&hellip;" : "Working&hellip;"}</span>
    <span class="notify-claude-count-pill">${itemCountLabel}</span>`;
  return confirmed
    ? `<a href="${escapeHTML(routine.sessionUrl)}" target="_blank" rel="noopener" class="notify-claude-btn notify-claude-btn-working notify-claude-btn-clickable" title="View the Claude Code session merging the ${itemCountLabel} item(s) sent">${mainBtnInner}</a>`
    : `<button type="button" class="notify-claude-btn notify-claude-btn-working" disabled title="A Claude Code session is merging the ${itemCountLabel} item(s) sent">${mainBtnInner}</button>`;
}

// The middle stage, between "Ready for Dev" and "Deploy to Main": moves
// individually-confirmed-tested items from Ready for Testing onto their
// feature branch (ready-to-publish) in one batch click, instead of each
// "Confirm tested" click advancing its own card immediately — see cardHTML's
// own comment on why that one-at-a-time behavior was wrong. Purely a client
// Firestore batch write (deployToFeature() below), no Routine/Cloud
// Function involved — the feature branch/PR already exists from the
// Backlog stage, this just advances the board's own status once a human
// has actually looked at (a batch of) it.
function deployToFeatureButtonHTML(project) {
  const pid = project.id;
  const passedCount = testPassedCountForProject(pid);
  if (!passedCount) return "";
  // Same "selection narrows the count" pattern as the Backlog/Ready for Dev
  // button above.
  const selectedCount = items.filter((i) =>
    (i.projectId || GENERAL_PROJECT_ID) === pid && i.status === "ready-for-testing" &&
    i.testPassed && getDeploySelectedSet(pid).has(i.id)
  ).length;
  const label = selectedCount ? `Approved for Deployment — ${selectedCount} selected` : "Approved for Deployment";
  return `<button type="button" class="notify-claude-btn deploy-to-feature-btn" data-project-id="${escapeHTML(pid)}">
    <span class="material-symbols-outlined notify-claude-icon">merge_type</span>
    <span class="notify-claude-label">${label}</span>
    <span class="notify-claude-count-pill">${selectedCount || passedCount}</span>
  </button>`;
}

// ── Deployment grouping ─────────────────────────────────────────────────────
// Cards that will ship in one deployment are drawn bracketed together, in
// place in the column they're already in. That's the whole feature: a UI
// grouping of existing cards, with no separate page, no menu entry, nothing
// to manage and nothing extra stored.
//
// A group's identity is the thing that already makes two cards one
// deployment — the patch branch they were packaged on, or the PR that branch
// became. Both are written by the existing pipeline (see ROUTINE_INSTRUCTIONS
// .md and run-backlog-automation.js), so the grouping is derived on every
// render and appears the moment a second card joins: there is no grouping
// state to create, edit, or keep in sync, and nothing to undo if a card moves.
//
// Returns null for a card that shares no deployment with anything:
//   - an ordinary Backlog card, which has no branch yet (so the grouping
//     starts exactly where Rob asked — at the greyed-out "In development —
//     locked" stage, which is what having a branch plus patchReady means),
//   - a noDeploymentRequired card, which has no deployment to share at all.
function deploymentGroupKey(item) {
  if (item.noDeploymentRequired) return null;
  const branch = (item.patchBranch || "").trim();
  // Prefer the branch over the PR number: they always agree once the PR
  // exists, but the branch is set first, so keying on it means a group
  // doesn't momentarily split and re-form as the PR number lands on each
  // card in turn.
  if (branch && (item.patchReady || item.prNumber || item.status !== "backlog")) {
    return "branch:" + branch;
  }
  if (item.prNumber) return "pr:" + item.prNumber;
  return null;
}

// One column's worth of cards, with same-deployment cards wrapped together.
// Card order inside the column is untouched: a group is drawn at the
// position of its first member, and its members keep the order they had.
// A key with only one card in this column is not a group — a bracket round
// a single card would say "ships together" about nothing.
function columnCardsHTML(listItems) {
  const counts = new Map();
  listItems.forEach((i) => {
    const key = deploymentGroupKey(i);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  });
  const drawn = new Set();
  return listItems.map((item) => {
    const key = deploymentGroupKey(item);
    if (!key || counts.get(key) < 2) return cardHTML(item);
    if (drawn.has(key)) return "";
    drawn.add(key);
    const members = listItems.filter((i) => deploymentGroupKey(i) === key);
    // Once there's a PR, its number is the one useful handle on the group —
    // it's what's on each card's own PR badge and what gets merged. Before
    // that the only name available is the branch, which in a 260px column
    // truncates to nothing readable, so the label just says what it means.
    const withPr = members.find((i) => i.prNumber);
    const label = withPr
      ? `Ships together &middot; PR #${escapeHTML(String(withPr.prNumber))}`
      : `Ships together`;
    return `<div class="card-group" data-group-key="${escapeHTML(key)}" title="Packaged into the same deployment: ${escapeHTML(key.replace(/^branch:/, "").replace(/^pr:/, "PR #"))}">
      <div class="card-group-head" title="These ${members.length} items are packaged into the same deployment, so they move through the board and go live together">
        <span class="material-symbols-outlined card-group-icon">link</span>
        <span class="card-group-label">${label}</span>
        <span class="card-group-count">${members.length}</span>
      </div>
      ${members.map(cardHTML).join("")}
    </div>`;
  }).join("");
}

function projectSectionHTML(project) {
  const collapsed = isProjectCollapsed(project.id);
  const projectItems = items.filter((i) => (i.projectId || GENERAL_PROJECT_ID) === project.id);
  const cardsByCol = {};
  COLUMNS.forEach((col) => { cardsByCol[col.key] = projectItems.filter((i) => i.status === col.key); });
  const total = COL_KEYS.reduce((sum, k) => sum + cardsByCol[k].length, 0);

  const board = `<div class="board">` + COLUMNS.map((col) => {
    const listItems = cardsByCol[col.key];
    // "Select all" makes sense in two columns now: Backlog (what "Ready for
    // Dev" acts on) and Ready for Testing (what "Approved for Deployment" acts
    // on, restricted to the noDeploymentRequired-excluded, checkbox-eligible
    // subset — see cardHTML's own selectCb).
    let selectAllHTML = "";
    if (col.key === "backlog" && listItems.length) {
      const sel = getSelectedSet(project.id);
      const allSelected = listItems.every((i) => sel.has(i.id));
      selectAllHTML = `<label class="col-select-all" title="Select all">
        <input type="checkbox" class="col-select-all-cb" data-project-id="${escapeHTML(project.id)}" ${allSelected ? "checked" : ""}>
      </label>`;
    } else if (col.key === "ready-for-testing") {
      const selectable = listItems.filter((i) => !i.noDeploymentRequired);
      if (selectable.length) {
        const sel = getDeploySelectedSet(project.id);
        const allSelected = selectable.every((i) => sel.has(i.id));
        selectAllHTML = `<label class="col-select-all" title="Select all">
          <input type="checkbox" class="col-deploy-select-all-cb" data-project-id="${escapeHTML(project.id)}" ${allSelected ? "checked" : ""}>
        </label>`;
      }
    }
    // Mobile-only tap-to-collapse (eQOIaEcF4xMSVmZt1rnA): on a phone the
    // board already stacks all 4 columns vertically (see the 640px media
    // query), which means scrolling past a long Backlog just to reach
    // Approved for Deployment below it. Collapsing is purely a per-viewer,
    // in-memory convenience — same "not persisted" precedent as this app's
    // own faFolderState — and the class only does anything inside that same
    // 640px media query, so desktop is completely unaffected.
    const colCollapsed = isColumnCollapsed(project.id, col.key);
    return `<section class="column${colCollapsed ? " column-collapsed" : ""}" data-col="${col.key}">
      <div class="col-head col-head-${col.headClass}" data-project-id="${escapeHTML(project.id)}" data-col="${col.key}"><span>${selectAllHTML}${col.label}</span><span class="col-count">${listItems.length}</span></div>
      <div class="col-list" id="${colListId(project.id, col.key)}" data-col="${col.key}" data-project-id="${escapeHTML(project.id)}">
        ${listItems.length ? columnCardsHTML(listItems) : '<div class="empty-hint">No items yet</div>'}
      </div>
    </section>`;
  }).join("") + `</div>`;

  const nameRow = editingProjectId === project.id
    ? `<div class="project-name-row"><input type="text" class="project-name-input" id="pname-input-${escapeHTML(project.id)}" data-project-id="${escapeHTML(project.id)}" value="${escapeHTML(project.name)}" maxlength="80"></div>`
    : `<div class="project-name-row"><h2 class="project-name">${escapeHTML(project.name)} <span class="project-item-count">(${total})</span></h2>
         <button type="button" class="project-rename-btn" data-project-id="${escapeHTML(project.id)}" title="Rename project">&#9998;</button>
       </div>`;

  return `
    <section class="project${collapsed ? " collapsed" : ""}" data-project-id="${escapeHTML(project.id)}">
      <div class="project-header">
        <button type="button" class="project-collapse-btn" data-project-id="${escapeHTML(project.id)}" title="${collapsed ? "Expand" : "Collapse"}">${collapsed ? "&#9656;" : "&#9662;"}</button>
        <div class="project-title-wrap">
          ${nameRow}
        </div>
        <div class="project-header-actions">
          ${notifyClaudeButtonHTML(project)}
          ${deployToFeatureButtonHTML(project)}
          ${deployNotifyButtonHTML(project)}
          <button class="btn-primary new-item-btn" data-project-id="${escapeHTML(project.id)}" type="button">+ New backlog item</button>
          <div class="project-options">
            <button type="button" class="icon-btn project-options-btn" data-project-id="${escapeHTML(project.id)}" aria-haspopup="true" aria-label="More options for this project">&#8942;</button>
            <div class="project-options-menu" data-project-id="${escapeHTML(project.id)}" hidden>${optionsMenuHTML(project)}</div>
          </div>
        </div>
      </div>
      <div class="project-body">${board}</div>
    </section>`;
}

// Items saved before multi-project shipped have no projectId — rather
// than requiring a database migration before this deploys, any item
// without a projectId (or pointing at a project that no longer exists)
// is grouped under a synthesized "General" project, rendered immediately
// on the client even before its Firestore doc exists.
// Most-recently-active project first — "active" meaning any of its items
// was created/touched/archived most recently, not just when the project
// itself was created. Falls back to the project's own createdAt when it
// has no items yet (a freshly created empty project).
function tsMillis(ts) { return ts && ts.toMillis ? ts.toMillis() : 0; }
function projectLastActivityMs(project) {
  const projectItems = allItems.filter((i) => (i.projectId || GENERAL_PROJECT_ID) === project.id);
  const latest = projectItems.reduce((max, i) => {
    return Math.max(max, tsMillis(i.updatedAt), tsMillis(i.createdAt), tsMillis(i.archivedAt));
  }, 0);
  return latest || tsMillis(project.createdAt);
}

function getRenderedProjects() {
  // knownIds is built from the unfiltered list — a real "General" doc that
  // now happens to be archived still counts as "known" here, so it's never
  // re-synthesized; it's simply filtered out of `known` below, same as any
  // other archived project. Restoring it (Archived projects page) is the
  // only way to bring it, and any orphan items still pointing at it, back.
  const knownIds = new Set(projects.map((p) => p.id));
  const known = projects.filter((p) => !p.archived);
  // Only treat an item as a genuine orphan once the projects listener has
  // actually delivered its first snapshot — otherwise, if the items
  // listener happens to resolve first, every item transiently looks
  // orphaned (knownIds is still empty) and ensureGeneralProjectDoc() below
  // would permanently create a real "General" project doc for no reason.
  const hasOrphans = projectsLoaded && items.some((i) => !i.projectId || !knownIds.has(i.projectId));
  if (hasOrphans && !knownIds.has(GENERAL_PROJECT_ID)) {
    known.push({ id: GENERAL_PROJECT_ID, name: "General" });
  }
  return known.sort((a, b) => projectLastActivityMs(b) - projectLastActivityMs(a));
}

let ensuredGeneralDoc = false;
function ensureGeneralProjectDoc(renderedProjects) {
  const stillSynthetic = renderedProjects.some((p) => p.id === GENERAL_PROJECT_ID) &&
    !projects.some((p) => p.id === GENERAL_PROJECT_ID);
  if (stillSynthetic && !ensuredGeneralDoc) {
    ensuredGeneralDoc = true;
    setDoc(doc(db, "projects", GENERAL_PROJECT_ID), { name: "General", createdAt: serverTimestamp() }, { merge: true })
      .catch(() => { ensuredGeneralDoc = false; });
  }
}

const migratedIds = new Set();
function migrateOrphanItems() {
  items.forEach((item) => {
    if (!item.projectId && !migratedIds.has(item.id)) {
      migratedIds.add(item.id);
      updateDoc(doc(db, "backlogItems", item.id), { projectId: GENERAL_PROJECT_ID })
        .catch(() => migratedIds.delete(item.id));
    }
  });
}

// Program/Product grouping — purely a display grouping above Projects, not
// a new pipeline of its own (programs have no columns/status). Only kicks
// in once at least one program actually exists: a board that never adopts
// this feature renders exactly as it always has, flat, with zero visual
// change. Once a program exists, projects render under a heading per
// program (alphabetical by name) followed by an "Ungrouped" section — only
// shown if it actually has members — for projects with no programId or one
// pointing at a program that's since been deleted.
function programName(id) {
  const p = programs.find((p) => p.id === id);
  return p ? p.name : "";
}

function groupProjectsByProgram(renderedProjects) {
  const knownProgramIds = new Set(programs.map((p) => p.id));
  const byProgramId = new Map();
  renderedProjects.forEach((project) => {
    const pid = project.programId && knownProgramIds.has(project.programId) ? project.programId : null;
    if (!byProgramId.has(pid)) byProgramId.set(pid, []);
    byProgramId.get(pid).push(project);
  });
  const groups = [...byProgramId.entries()].map(([pid, groupProjects]) => ({
    id: pid,
    name: pid ? programName(pid) : "Ungrouped",
    projects: groupProjects,
  }));
  // renderedProjects arrives already ordered most-recently-active project
  // first (see getRenderedProjects), so a group's own first member is its
  // most recently active project — sort the groups (programs/boards) the
  // same way instead of alphabetically-with-Ungrouped-always-last, so
  // whichever board was actually touched most recently surfaces at the top
  // of the page (otRMV4CDkzIIFoYWeynY) rather than only its projects being
  // ordered correctly within a fixed group position.
  groups.sort((a, b) => projectLastActivityMs(b.projects[0]) - projectLastActivityMs(a.projects[0]));
  return groups;
}

function programGroupHTML(group) {
  return `
    <section class="program-group" data-program-id="${escapeHTML(group.id || "")}">
      <h2 class="program-heading">${escapeHTML(group.name)}</h2>
      ${group.projects.map(projectSectionHTML).join("")}
    </section>`;
}

// render() itself just schedules the real work on the next animation
// frame and coalesces any further calls until that frame runs. On a cold
// load, four independent onSnapshot listeners below (items, projects,
// interfaces, programs) each call render() the moment their own first
// snapshot arrives — without this, that meant up to four full innerHTML
// rebuilds of the entire board (every project, every column, every card)
// in quick succession before things settled, which is real, wasted work
// on every page load, worse on a slower/lower-power device.
// Coalescing to one rebuild per frame also smooths out the several other
// call sites that fire render() synchronously off rapid UI interaction
// (collapsing a project, selecting cards, etc.) — a one-frame (~16ms)
// delay there is imperceptible.
let renderScheduled = false;
function render() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    renderNow();
  });
}

function renderNow() {
  migrateOrphanItems();
  const renderedProjects = getRenderedProjects();

  // Every render replaces #projects-root's entire innerHTML, which throws
  // away and recreates every .col-list element — including whichever one
  // you were scrolled down in. That snapped a column back to its top on
  // every single re-render, not just the "Confirm tested" case it was
  // first reported against (clicking it writes testPassed to Firestore,
  // the onSnapshot listener fires, render() runs, and the column you were
  // scrolling through jumps back to the first card). colListId() gives
  // each column a stable id across renders even though the element itself
  // isn't the same node, so capture scrollTop by that id before the
  // rebuild and restore it after — cheap (only columns actually scrolled
  // away from top do anything here) and fixes every render path at once
  // rather than special-casing the one button that happened to surface it.
  const scrollPositions = {};
  document.querySelectorAll(".col-list").forEach((el) => {
    if (el.scrollTop) scrollPositions[el.id] = el.scrollTop;
  });

  document.getElementById("projects-root").innerHTML = programs.length
    ? groupProjectsByProgram(renderedProjects).map(programGroupHTML).join("")
    : renderedProjects.map(projectSectionHTML).join("");

  Object.entries(scrollPositions).forEach(([id, top]) => {
    const el = document.getElementById(id);
    if (el) el.scrollTop = top;
  });

  const total = items.filter((i) => COL_KEYS.includes(i.status)).length;
  document.getElementById("total-summary").textContent =
    `${total} item${total === 1 ? "" : "s"} across ${renderedProjects.length} project${renderedProjects.length === 1 ? "" : "s"}`;

  if (editingProjectId) {
    const input = document.getElementById(`pname-input-${editingProjectId}`);
    if (input) { input.focus(); input.select(); }
  }

  ensureGeneralProjectDoc(renderedProjects);
  syncMobileActionBar();
}

// ── The current project's actions, held on screen on a phone ─────────────
// On a narrow screen the board stacks into one tall column, so a project's
// own actions — Ready for Dev, Approved for Deployment, Deploy to Main —
// scroll off the top long before you reach the cards they apply to.
// Confirming a card tested and then approving it meant scrolling back up,
// which is the practical reason the board couldn't be driven from a phone.
//
// This is a `position: fixed` bar, and that is the whole design, not an
// implementation detail. The obvious approach — make .project-header
// `position: sticky` and collapse it to one row once it pins — was built
// first and is unusable on a real phone: collapsing the header removes
// ~180px of content from ABOVE the viewport, Chrome's scroll anchoring
// compensates by scrolling up to keep the content under your thumb still,
// that scroll un-pins the header, it grows back, and it pins again. Rob
// reported it as "jumps up and down when trying to scroll"; measured here,
// the page bounced 120 → 0 → 120 indefinitely and never got past the first
// project. A fixed element is outside the flow, so it cannot change the
// document's height or position at all, and the loop cannot exist.
//
// The bar shows only the actions themselves — the ⋮ menu stays in the real
// header, because duplicating it would put two menus with the same
// data-project-id in the document and the open/close handling keys off
// exactly that. The buttons here are the same markup the header renders,
// so the existing delegated click handlers act on them unchanged.
const mobileActionBar = document.getElementById("mobile-action-bar");
let mobileBarProjectId = null;
let mobileBarQueued = false;

// Which project is under the top of the screen right now: the last one
// whose section has started, ignoring any whose own header is still
// visible (no point repeating buttons that are already on screen).
function projectAtTopOfScreen() {
  let current = null;
  document.querySelectorAll(".project").forEach((section) => {
    const header = section.querySelector(".project-header");
    if (!header) return;
    const box = section.getBoundingClientRect();
    const headerBox = header.getBoundingClientRect();
    if (box.top <= 0 && box.bottom > 80 && headerBox.bottom <= 0) current = section;
  });
  return current;
}

function syncMobileActionBar() {
  if (!mobileActionBar) return;
  // The bar is display:none above 640px in CSS, but skip the work entirely
  // on a desktop window rather than maintaining markup nobody can see.
  if (window.innerWidth > 640) {
    if (!mobileActionBar.hidden) { mobileActionBar.hidden = true; mobileBarProjectId = null; }
    return;
  }
  const section = projectAtTopOfScreen();
  if (!section) {
    if (!mobileActionBar.hidden) { mobileActionBar.hidden = true; mobileBarProjectId = null; }
    return;
  }
  const pid = section.dataset.projectId;
  const actions = section.querySelector(".project-header-actions");
  // Rebuild only when the project changes or its buttons did — this runs on
  // every scroll frame, and re-parsing identical HTML would throw away the
  // pressed state of a button mid-tap.
  const signature = pid + "|" + (actions ? actions.innerHTML.length : 0) +
    "|" + (actions ? actions.textContent.trim() : "");
  if (signature !== mobileBarProjectId) {
    mobileBarProjectId = signature;
    const name = section.querySelector(".project-name");
    const buttons = actions
      ? [...actions.children].filter((el) => !el.classList.contains("project-options"))
          .map((el) => el.outerHTML).join("")
      : "";
    mobileActionBar.innerHTML =
      `<span class="mobile-action-bar-name">${escapeHTML(name ? name.childNodes[0].textContent.trim() : "")}</span>` +
      `<div class="mobile-action-bar-actions">${buttons}</div>`;
  }
  if (mobileActionBar.hidden) mobileActionBar.hidden = false;
}

// The board's click handling is delegated from #projects-root, and this bar
// deliberately sits outside it (a fixed element inside would be wiped by
// renderNow's innerHTML rebuild). So a tap in the bar reaches no handler at
// all. Rather than duplicate that dispatch here — two copies that drift the
// moment either side changes — forward the tap to the real control in the
// project's own header and let the existing handler run untouched.
const MOBILE_BAR_ACTIONS = ["project-notify-btn", "deploy-to-feature-btn", "deploy-notify-btn", "new-item-btn"];
mobileActionBar && mobileActionBar.addEventListener("click", (e) => {
  const btn = e.target.closest("button, a");
  if (!btn) return;
  const action = MOBILE_BAR_ACTIONS.find((c) => btn.classList.contains(c));
  const pid = btn.dataset.projectId;
  if (!action || !pid) return;
  const real = document.querySelector(
    `.project[data-project-id="${CSS.escape(pid)}"] .project-header-actions .${action}`);
  if (!real) return;
  e.preventDefault();
  real.click();
});

function queueMobileBarSync() {
  if (mobileBarQueued) return;
  mobileBarQueued = true;
  requestAnimationFrame(() => { mobileBarQueued = false; syncMobileActionBar(); });
}
window.addEventListener("scroll", queueMobileBarSync, { passive: true });
window.addEventListener("resize", queueMobileBarSync);

// ── First paint without waiting on the realtime channel ──────────────────
// onSnapshot is the source of truth and nothing below changes that. The
// problem it solves is that the realtime channel does not always arrive
// promptly: measured on the live board (13 September 2026, reproduced in
// two different browsers on two different profiles), the Listen requests
// connect and then deliver nothing for about a minute, while the board sits
// on "0 items". Forcing the long-polling transport (see initializeFirestore
// above) removed one 45-second stall and simply exposed others — the
// transport was never the real problem.
//
// What IS reliable on the same network, measured in the same page while the
// board was still empty: plain REST. projects came back in 600ms,
// backlogItems in 1.7s, an ordered query over all 110 documents in 3.2s. So
// the data was always seconds away; only the channel carrying it was slow.
//
// Hence: fire one REST read per collection at startup, render whatever it
// returns, and let onSnapshot quietly replace it whenever it connects. The
// board is usable in about a second instead of a minute, and nothing about
// the realtime behaviour afterwards changes.
//
// The one thing this must never do is overwrite fresher data with its own
// stale answer, so each collection is claimed by its listener the first time
// a real snapshot lands, and a REST response for an already-claimed
// collection is dropped on the floor.
const REST_BASE = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents`;
const liveCollections = new Set();

// REST returns Firestore's wire format; the app expects what the SDK hands
// back. Timestamps in particular are read through tsMillis()/toDate()
// elsewhere in this file, so they have to arrive as objects with those
// methods rather than as ISO strings.
function restValue(v) {
  if (!v || typeof v !== "object") return null;
  if ("stringValue" in v) return v.stringValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) {
    const ms = Date.parse(v.timestampValue);
    return { toMillis: () => ms, toDate: () => new Date(ms), seconds: Math.floor(ms / 1000) };
  }
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(restValue);
  if ("mapValue" in v) return restFields(v.mapValue.fields || {});
  return null;
}

function restFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = restValue(v);
  return out;
}

// The fields the board actually draws for a card. Everything else on a
// backlogItems document is pipeline machinery — patchFiles above all, which
// carries entire file contents (180KB at a time) that nothing here renders.
//
// This matters because the REST list endpoint pages by payload size, not by
// document count: priming backlogItems unmasked took 7 round trips and about
// 12 seconds, almost all of it spent transferring patch blobs straight to the
// floor. With the mask it is one small page.
//
// It is an inclusion list, so a field added later and not listed here is
// simply absent until the listener delivers — a self-healing gap of a second
// or two, not a permanent one, but add new rendered fields here too.
//
// Only backlogItems is masked. faqArticles carries the other big payload
// (bodyMd, up to 20KB an article) and is deliberately left whole: the editor
// populates itself from bodyMd when an article is opened, so priming without
// it would let someone open an article before the listener arrives, see an
// empty body, and save that emptiness over the real one.
const BACKLOG_ITEM_RENDER_FIELDS = [
  "projectId", "title", "desc", "type", "category", "status",
  "createdAt", "updatedAt", "archivedAt",
  "patchReady", "mergeReady", "noDeploymentRequired", "testPassed",
  "testVersion", "testSummary", "previewUrl",
  "prUrl", "prNumber", "mergedAt",
  // Provenance for a card that's actually landed — which commit it merged
  // as, and whether the deploy that was supposed to ship it actually
  // succeeded (see run-backlog-automation.js's processMergePr). Drawn as
  // deployBadge on a Merged to Main (Live) card, same "on the REST-primed
  // first paint, not a second later" reasoning as prUrl/prNumber above.
  "mergeCommit", "deployRunUrl", "deployConclusion",
  // Not drawn on a card itself, but read by deploymentGroupKey() — without
  // it the same-deployment brackets wouldn't be there on the REST-primed
  // first paint and would pop in a second later when the listener landed.
  // It's a short branch name, unlike the patch* fields below it.
  "patchBranch",
  "notes", "attachments",
];

async function primeFromRest(collectionName, apply, sort, fields) {
  try {
    let documents = [];
    let pageToken = null;
    let guard = 0;
    do {
      const mask = (fields || []).map((f) => `&mask.fieldPaths=${encodeURIComponent(f)}`).join("");
      const url = `${REST_BASE}/${collectionName}?pageSize=300` + mask +
        (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = await res.json();
      documents = documents.concat(json.documents || []);
      pageToken = json.nextPageToken;
      guard += 1;
    } while (pageToken && guard < 10);

    // The listener won the race — its data is newer by definition.
    if (liveCollections.has(collectionName)) return;

    const rows = documents.map((d) => ({ id: d.name.split("/").pop(), ...restFields(d.fields) }));
    if (sort) rows.sort(sort);
    apply(rows);
  } catch (err) {
    // Best-effort by design: if this fails the board simply waits for
    // onSnapshot exactly as it did before, so a warning is the right level.
    console.warn(`backlog-tracker: couldn't prime ${collectionName} over REST`, err);
  }
}

const byMillis = (field, dir) => (a, b) => {
  const av = a[field] && a[field].toMillis ? a[field].toMillis() : 0;
  const bv = b[field] && b[field].toMillis ? b[field].toMillis() : 0;
  return dir === "desc" ? bv - av : av - bv;
};
const byNumber = (field) => (a, b) => (Number(a[field]) || 0) - (Number(b[field]) || 0);

// Kick these off immediately — before the listeners below have had a chance
// to connect — so the board has something on screen within a second or two
// even when the realtime channel is slow to deliver. Each is a no-op if its
// listener gets there first.
primeFromRest("projects", (rows) => { projects = rows; render(); }, byMillis("createdAt", "asc"));
primeFromRest("backlogItems", (rows) => {
  allItems = rows;
  items = allItems.filter((i) => i.status !== "archived");
  render();
}, byMillis("createdAt", "desc"), BACKLOG_ITEM_RENDER_FIELDS);
primeFromRest("programs", (rows) => { programs = rows; render(); });
primeFromRest("interfaces", (rows) => { interfaces = rows; render(); });
primeFromRest("projectDocs", (rows) => { projectDocs = rows; });
primeFromRest("faqCategories", (rows) => {
  faqCategories = rows;
  if (faqSettingsPage && !faqSettingsPage.hidden) renderFaqSettingsPage();
  if (faqArticlesPage && !faqArticlesPage.hidden) renderFaqArticlesPage();
}, byNumber("order"));
primeFromRest("faqArticles", (rows) => {
  faqArticles = rows;
  if (faqSettingsPage && !faqSettingsPage.hidden) renderFaqSettingsPage();
  if (faqArticlesPage && !faqArticlesPage.hidden) renderFaqArticlesPage();
}, byNumber("order"));

onSnapshot(query(itemsRef, orderBy("createdAt", "desc")), (snap) => {
  liveCollections.add("backlogItems");
  allItems = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  items = allItems.filter((i) => i.status !== "archived");
  render();
  if (archiveProjectId) renderArchivePage();
  if (archivedProjectsPage && !archivedProjectsPage.hidden) renderArchivedProjectsPage();
  if (editingItemId) { renderEiNotes(); renderEiAttachments(); }
  if (quickCommentItemId) renderQcNotes();
}, (err) => {
  console.error("backlog-tracker: items listener error", err);
});

onSnapshot(query(projectsRef, orderBy("createdAt", "asc")), (snap) => {
  liveCollections.add("projects");
  projects = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  projectsLoaded = true;
  render();
  if (archiveProjectId) renderArchivePage();
  if (docsProjectId) renderDocsPage();
  if (archivedProjectsPage && !archivedProjectsPage.hidden) renderArchivedProjectsPage();
}, (err) => {
  console.error("backlog-tracker: projects listener error", err);
});

onSnapshot(interfacesRef, (snap) => {
  liveCollections.add("interfaces");
  interfaces = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  render();
  if (docsProjectId) renderDocsPage();
}, (err) => {
  console.error("backlog-tracker: interfaces listener error", err);
});

onSnapshot(programsRef, (snap) => {
  liveCollections.add("programs");
  programs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  render();
  if (docsProjectId) renderDocsPage();
}, (err) => {
  console.error("backlog-tracker: programs listener error", err);
});

onSnapshot(projectDocsRef, (snap) => {
  liveCollections.add("projectDocs");
  projectDocs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (docsProjectId) renderDocsPage();
}, (err) => {
  console.error("backlog-tracker: projectDocs listener error", err);
});

async function addItem(projectId, title, desc, type, category) {
  await addDoc(itemsRef, {
    projectId, title, desc, type, category,
    status: "backlog",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

async function moveItem(id, dir) {
  const item = items.find((i) => i.id === id);
  if (!item) return;
  const next = COL_KEYS.indexOf(item.status) + dir;
  if (next < 0 || next >= COL_KEYS.length) return;
  const fields = { status: COL_KEYS[next], updatedAt: serverTimestamp() };
  // Landing on Ready for Testing happens two ways: the left-arrow "move
  // back" from Approved for Deployment (sending it back for more work), or
  // — rarer, a manual override rather than the usual automated path — the
  // right-arrow moving a Backlog card straight there. Either way, clear a
  // stale testPassed from any previous round: otherwise it would already
  // look "passed" again with nobody having actually re-confirmed the new
  // round of work, and the next "Approved for Deployment" click could
  // sweep it back onto the feature branch unreviewed.
  if (COL_KEYS[next] === "ready-for-testing") {
    fields.testPassed = false;
    // Stamp the version fresh only on a genuine new entry from Backlog
    // (dir === 1) — this is the same one-time-stamp-then-carry-through
    // rule processApplyPatch() follows for the normal automated path (see
    // its own comment). A send-back from Approved for Deployment (dir ===
    // -1) leaves testVersion untouched — it's still the same round of
    // testing the ticket was already stamped for.
    if (dir === 1) {
      fields.testVersion = APP_VERSION;
    }
  }
  await updateDoc(doc(db, "backlogItems", id), fields);
}

// Per-card toggle in Ready for Testing — flags (or un-flags) testPassed
// without moving the card. Deliberately does NOT advance status itself
// (that used to be exactly what this button did, one card at a time, which
// was the actual complaint this replaced — see cardHTML's own comment).
// Advancing is the separate, explicit, batchable "Approved for Deployment"
// project action (deployToFeature() below).
async function toggleTestPassed(id) {
  const item = items.find((i) => i.id === id);
  if (!item || item.status !== "ready-for-testing" || item.noDeploymentRequired) return;
  await updateDoc(doc(db, "backlogItems", id), {
    testPassed: !item.testPassed,
    updatedAt: serverTimestamp(),
  });
}

// The one other legitimate way to reach published-live besides
// run-backlog-automation.js actually merging a PR (see moveItem's own
// COL_KEYS-driven path and "No manual way to reach published-live exists"
// in REQUIREMENTS.md): a card flagged noDeploymentRequired has no PR to
// merge in the first place — its fix was a live data/config change only —
// so a human confirming it's tested is the real, complete signal, with
// nothing left for Notify Claude — Deploy to gate.
async function confirmTestedNoDeploy(id) {
  const item = items.find((i) => i.id === id);
  if (!item || !item.noDeploymentRequired) return;
  await updateDoc(doc(db, "backlogItems", id), {
    status: "published-live",
    updatedAt: serverTimestamp(),
  });
}

async function removeItem(id) {
  await deleteDoc(doc(db, "backlogItems", id));
}

async function archiveItem(id) {
  await updateDoc(doc(db, "backlogItems", id), {
    status: "archived",
    archivedAt: serverTimestamp(),
  });
}

async function restoreItem(id) {
  await updateDoc(doc(db, "backlogItems", id), {
    status: "published-live",
    updatedAt: serverTimestamp(),
  });
}

async function updateItemDetails(id, { title, desc, type, category, noDeploymentRequired }) {
  await updateDoc(doc(db, "backlogItems", id), {
    title: title.trim(), desc: desc.trim(), type, category,
    noDeploymentRequired: !!noDeploymentRequired,
    updatedAt: serverTimestamp(),
  });
}

// `at` is a plain client Date, not serverTimestamp() — Firestore rejects a
// serverTimestamp() sentinel inside an array (arrayUnion here), the same
// reason the Routine's own note-appending curl calls always send a literal
// ISO8601 string instead of asking Firestore to fill it in server-side.
async function addItemComment(id, text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return;
  await updateDoc(doc(db, "backlogItems", id), {
    notes: arrayUnion({ author: "viewer", text: trimmed, at: new Date() }),
    updatedAt: serverTimestamp(),
  });
}

async function setItemPreviewUrl(id, url) {
  const trimmed = (url || "").trim();
  await updateDoc(doc(db, "backlogItems", id), { previewUrl: trimmed || null, updatedAt: serverTimestamp() });
}

// Attachments (screenshots & screen recordings) — see the Edit item
// modal's own Attachments block below. Stored in Firebase Storage under
// attachments/{itemId}/{fileName}, with only the resulting metadata (not
// the file itself) written onto the backlogItems doc, same "small,
// bounded value on the doc, real payload elsewhere" split Firestore
// already forces for anything past a few hundred KB. storage.rules caps
// size/content-type at the Storage layer, matching firestore.rules'
// existing open-but-validated posture — see that file's own comments.
const MAX_SCREENSHOT_BYTES = 15 * 1024 * 1024;
const MAX_RECORDING_BYTES = 100 * 1024 * 1024;

function sanitizeAttachmentFileName(name) {
  return String(name || "attachment").replace(/[^a-zA-Z0-9.\-_]/g, "_").slice(-120);
}

// Firebase Storage's own SDK error message for almost any real problem is
// the same unhelpful "Firebase Storage: An unknown error occurred"
// (storage/unknown) — that's what a project where Storage was never
// enabled produces (see JEdnBmPbNODJri5vBxpX: there's no bucket at all, so
// every uploadBytes call fails before it starts), and it gives no hint the
// real fix is a one-time Console step, not a bug in this code. Map the
// codes that actually tell a person something actionable
// (FdqvQlOD4I3G6SHfzcn1) instead of surfacing the SDK's own message as-is.
function describeAttachmentUploadError(err) {
  const code = err && err.code;
  if (code === "storage/unknown" || code === "storage/retry-limit-exceeded") {
    return "Storage isn't enabled for this project yet (Firebase Console → Build → Storage → Get started) — ask whoever owns Firebase deploy access to turn it on.";
  }
  if (code === "storage/unauthorized") {
    return "Upload rejected by Storage's security rules — storage.rules likely hasn't been deployed to this project yet.";
  }
  if (code === "storage/quota-exceeded") {
    return "This project's Storage quota has been used up.";
  }
  if (code === "storage/canceled") {
    return "Upload was canceled.";
  }
  if (code === "storage/invalid-argument" || code === "storage/invalid-format" || code === "storage/invalid-checksum") {
    return "This file couldn't be uploaded — check it's a valid image or video and try again.";
  }
  return (err && err.message) || String(err);
}

// `uploadedAt` is a plain client Date, not serverTimestamp(), for the same
// reason addItemComment's `at` is — see that function's own comment.
async function uploadItemAttachment(id, file, type) {
  const path = `attachments/${id}/${Date.now()}-${sanitizeAttachmentFileName(file.name)}`;
  const fileRef = storageRef(storage, path);
  try {
    await uploadBytes(fileRef, file, { contentType: file.type || undefined });
  } catch (err) {
    throw new Error(describeAttachmentUploadError(err));
  }
  const url = await getDownloadURL(fileRef);
  await updateDoc(doc(db, "backlogItems", id), {
    attachments: arrayUnion({
      type, url, path, name: file.name || sanitizeAttachmentFileName(file.name), size: file.size || 0, uploadedAt: new Date(),
    }),
    updatedAt: serverTimestamp(),
  });
}

// Filters the array down rather than arrayRemove(), which needs an
// exact-match object (including the `uploadedAt` Date, which doesn't
// round-trip identically) — same reasoning as any other "remove one entry
// from a stored array of objects" write in this app.
async function removeItemAttachment(id, attachment) {
  const item = allItems.find((i) => i.id === id);
  if (!item) return;
  const remaining = (item.attachments || []).filter((a) => a.path !== attachment.path);
  await updateDoc(doc(db, "backlogItems", id), { attachments: remaining, updatedAt: serverTimestamp() });
  try {
    await deleteObject(storageRef(storage, attachment.path));
  } catch (err) {
    // The Firestore write above is what the UI reflects; a failure here
    // just leaves an orphaned file in Storage (harmless, not user-visible)
    // rather than something worth surfacing as an error.
    console.warn("backlog-tracker: couldn't delete attachment from Storage", err);
  }
}

async function addProject(name, programId) {
  const data = { name: name.trim(), createdAt: serverTimestamp() };
  if (programId) data.programId = programId;
  const ref = await addDoc(projectsRef, data);
  return ref.id;
}

// Manual, batched counterpart to the automatic per-item notify: writes a
// fresh timestamp the notifyOnProjectReadyForReview Cloud Function watches
// for (see ../functions/index.js), which then sends everything currently
// in this project's Backlog column in one message — for "I've added
// several items, now go look" instead of one notification per card.
// No confirmation dialog here anymore — the Notify Claude button itself
// now shows a persistent working/spinner state (see notifyClaudeButtonHTML)
// once projects/{id}.notifyRoutine reflects the click, which is a better
// signal than a one-time dismissable dialog ever was.
async function requestNotify(pid) {
  const count = backlogCountForProject(pid);
  if (count === 0) {
    await showAlert("Nothing in Backlog for this project yet — add an item first.");
    return;
  }
  // A non-empty selection (this project's own Backlog checkboxes) narrows
  // the fire to just those items — notifyItemIds — instead of everything
  // currently in Backlog. Cross-check against the live backlog list rather
  // than trusting the selection set as-is, in case a selected card moved
  // or was deleted since it was checked. An empty selection means "send
  // everything", the original default behavior — notifyItemIds is cleared
  // (not just left unset) so a stale array from an earlier partial send
  // can never silently narrow a later full sweep.
  const backlogIds = new Set(
    items.filter((i) => (i.projectId || GENERAL_PROJECT_ID) === pid && i.status === "backlog").map((i) => i.id)
  );
  const selected = [...getSelectedSet(pid)].filter((id) => backlogIds.has(id));

  // Show the spinning state immediately, without waiting on the
  // notifyOnProjectReadyForReview round-trip — see notifyOptimisticClicks.
  notifyOptimisticClicks[pid] = Date.now();
  render();

  await setDoc(doc(db, "projects", pid), {
    notifyRequestedAt: serverTimestamp(),
    notifyItemIds: selected.length ? selected : null,
  }, { merge: true });

  getSelectedSet(pid).clear();
}

// The middle stage: batch-advances every testPassed (and, if any are
// checked, selected) Ready for Testing item straight to ready-to-publish
// (Approved for Deployment) in one Firestore batch write. Unlike
// requestNotify/requestDeployNotify above and below, this never touches the
// Routine — the feature branch and PR already exist from the Backlog stage
// (see run-backlog-automation.js's processApplyPatch), so there's no GitHub
// action to take here, only the board's own status to advance once a human
// has actually confirmed testing on the items they're choosing to release.
//
// This has no async, watchable in-progress state the way Ready for Dev/
// Deploy to Main do (no Routine session to spin on) — the whole thing
// completes in one round trip. This used to also fire an immediate in-app
// alert dialog AND a Slack post via notifyOnItemsDeployedToFeature
// (../functions/index.js, watching deployToFeatureRequestedAt) as feedback
// that the click did something — removed by request (SqPFGfMvuiQ5hRdsUb2W):
// both were reported as unwanted noise on every Ready for Testing →
// Approved for Deployment move. The board's own column counts already show
// the result immediately, so deployToFeatureRequestedAt/
// deployToFeatureItemTitles are deliberately not written here anymore —
// notifyOnItemsDeployedToFeature is now dead code (harmless, just never
// triggered) until a future cleanup removes it from functions/index.js too.
async function deployToFeature(pid) {
  const passedItems = items.filter((i) =>
    (i.projectId || GENERAL_PROJECT_ID) === pid && i.status === "ready-for-testing" && i.testPassed && !i.noDeploymentRequired
  );
  if (passedItems.length === 0) {
    await showAlert("Nothing has passed testing for this project yet — confirm an item's testing first.");
    return;
  }
  // Same "a non-empty selection narrows the action" pattern as
  // requestNotify — an empty selection means "every passed item", not
  // "nothing".
  const passedIds = new Set(passedItems.map((i) => i.id));
  const selected = [...getDeploySelectedSet(pid)].filter((id) => passedIds.has(id));
  const idsToMove = selected.length ? selected : [...passedIds];
  const itemsToMove = passedItems.filter((i) => idsToMove.includes(i.id));

  const batch = writeBatch(db);
  idsToMove.forEach((id) => {
    batch.update(doc(db, "backlogItems", id), {
      status: "ready-to-publish",
      testPassed: false,
      updatedAt: serverTimestamp(),
    });
  });
  await batch.commit();

  getDeploySelectedSet(pid).clear();
}

// Same idea as requestNotify() above, but for the "Approved for Deployment"
// (ready-to-publish) column — a deploy request, not an investigate-and-fix
// request. Writes deployNotifyRequestedAt, watched by
// notifyOnProjectReadyToDeploy (see ../functions/index.js), which fires the
// same Routine but with fire text that explicitly says these items are
// already tested and just need their PRs merged to main.
//
// No confirmation dialog here anymore, same reasoning as requestNotify:
// the Deploy to Main button itself now shows a persistent working/spinner
// state (see deployNotifyButtonHTML) once projects/{id}.deployRoutine
// reflects the click — a better, ongoing signal than a one-time dismissable
// dialog that told you nothing about whether the deploy was still running.
async function requestDeployNotify(pid) {
  const count = deployReadyCountForProject(pid);
  if (count === 0) {
    await showAlert("Nothing in Approved for Deployment for this project yet — confirm an item's testing first.");
    return;
  }

  // Show the spinning state immediately, without waiting on the
  // notifyOnProjectReadyToDeploy round-trip — see deployOptimisticClicks.
  deployOptimisticClicks[pid] = Date.now();
  render();

  await setDoc(doc(db, "projects", pid), { deployNotifyRequestedAt: serverTimestamp() }, { merge: true });
}

async function setProjectName(id, name) {
  const trimmed = (name || "").trim();
  if (!trimmed) return false;
  await setDoc(doc(db, "projects", id), { name: trimmed }, { merge: true });
  return true;
}

// Archiving a whole project (as opposed to one Merged-to-Main ticket) is
// for a project that's no longer active at all — most concretely, getting
// the stray synthesized "General" project off the board. A project with
// items still moving through the pipeline gets a confirm prompt first
// (see the click handler below); archived projects just drop out of
// getRenderedProjects() rather than being deleted, same "keep the data,
// hide it from the main board" pattern the per-ticket archive already uses.
async function archiveProject(id) {
  await setDoc(doc(db, "projects", id), { archived: true, archivedAt: serverTimestamp() }, { merge: true });
}

async function restoreProject(id) {
  await setDoc(doc(db, "projects", id), { archived: false, archivedAt: null }, { merge: true });
}

function activeItemCountForProject(pid) {
  return allItems.filter((i) => (i.projectId || GENERAL_PROJECT_ID) === pid && i.status !== "archived").length;
}

async function setProjectRequirements(id, md) {
  await setDoc(doc(db, "projects", id), { requirementsMd: md, updatedAt: serverTimestamp() }, { merge: true });
}

// The project's own primary tracking document — shown first on the Docs
// page, above Requirements, same live-doc pattern.
async function setProjectReadme(id, md) {
  await setDoc(doc(db, "projects", id), { readmeMd: md, updatedAt: serverTimestamp() }, { merge: true });
}

// ── Additional documents — a generic, named-document library per project
// (an API spec, an architecture decision record, anything that isn't
// Requirements or the README) so a project's full documentation lives on
// this one page instead of scattered across the repo. Unlike an interface,
// a project doc belongs to exactly one project — no second projectId. ────
function docsForProject(pid) {
  return projectDocs.filter((d) => d.projectId === pid);
}

async function addProjectDoc(projectId, name, contentMd) {
  await addDoc(projectDocsRef, {
    projectId, name: name.trim(), contentMd: contentMd || "",
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
}

async function updateProjectDoc(id, name, contentMd) {
  await setDoc(doc(db, "projectDocs", id), {
    name: name.trim(), contentMd: contentMd || "", updatedAt: serverTimestamp(),
  }, { merge: true });
}

async function deleteProjectDoc(id) {
  await deleteDoc(doc(db, "projectDocs", id));
}

// Per-project addendum to the Notify Claude Routine's own fixed prompt —
// prepended to the fire request's `text` by notifyOnProjectReadyForReview
// (see functions/index.js) so one project can hand the Routine extra
// context (a branch convention, which part of the repo it owns, anything
// the generic workflow wouldn't know) without editing the Routine itself.
async function setProjectRoutinePrompt(id, md) {
  await setDoc(doc(db, "projects", id), { routinePromptMd: md, updatedAt: serverTimestamp() }, { merge: true });
}

async function setProjectFaqAutoFlag(id, enabled) {
  await setDoc(doc(db, "projects", id), { faqAutoFlagOnLive: enabled, updatedAt: serverTimestamp() }, { merge: true });
}

// ── Programs/Products — a purely organizational grouping above Projects,
// with no columns/status of its own. A project's programId is optional and
// only affects how it's grouped on the board (see groupProjectsByProgram).
async function createProgram(name) {
  const trimmed = (name || "").trim();
  if (!trimmed) return null;
  const ref = await addDoc(programsRef, { name: trimmed, createdAt: serverTimestamp() });
  return ref.id;
}

async function setProjectProgram(id, programId) {
  await setDoc(doc(db, "projects", id), { programId: programId || null }, { merge: true });
}

// Shared by the New Project modal and the Docs page — both offer the same
// "pick an existing program, or create one inline" affordance via a
// trailing "+ New program…" option (handled by the caller's change
// listener, same pattern as populateProjectSelect above).
function populateProgramSelect(selectEl, selectedId) {
  const opts = programs.slice().sort((a, b) => a.name.localeCompare(b.name));
  selectEl.innerHTML = '<option value="">No program</option>' +
    opts.map((p) => `<option value="${escapeHTML(p.id)}"${p.id === selectedId ? " selected" : ""}>${escapeHTML(p.name)}</option>`).join("") +
    '<option value="__new__">+ New program…</option>';
}

// An interface is a maintained contract document shared between exactly
// two projects — the backlog-tracker-native equivalent of a shared
// markdown file, so it survives independently of either project's repo
// folder and is editable from either side.
async function addInterface(name, projectIds, contentMd) {
  await addDoc(interfacesRef, {
    name: name.trim(), projectIds, contentMd: contentMd || "",
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
}

async function updateInterface(id, name, contentMd) {
  await setDoc(doc(db, "interfaces", id), {
    name: name.trim(), contentMd: contentMd || "", updatedAt: serverTimestamp(),
  }, { merge: true });
}

async function deleteInterface(id) {
  await deleteDoc(doc(db, "interfaces", id));
}

function startEditingProjectName(pid) {
  editingProjectId = pid;
  render();
}

async function commitProjectNameEdit(pid, value) {
  if (editingProjectId !== pid) return;
  editingProjectId = null;
  const changed = await setProjectName(pid, value);
  if (!changed) render();
}

// ── Delegated events on #projects-root — its innerHTML is fully
// regenerated on every render(), so listeners live on the never-replaced
// parent instead of individual cards/buttons. ──────────────────────────
const projectsRoot = document.getElementById("projects-root");
projectsRoot.addEventListener("click", async (e) => {
  const selectCb = e.target.closest(".card-select-cb");
  if (selectCb) {
    const sel = getSelectedSet(selectCb.dataset.projectId);
    if (selectCb.checked) sel.add(selectCb.dataset.id); else sel.delete(selectCb.dataset.id);
    render();
    return;
  }
  const selectAllCb = e.target.closest(".col-select-all-cb");
  if (selectAllCb) {
    const pid = selectAllCb.dataset.projectId;
    const sel = getSelectedSet(pid);
    const backlogIds = items
      .filter((i) => (i.projectId || GENERAL_PROJECT_ID) === pid && i.status === "backlog")
      .map((i) => i.id);
    if (selectAllCb.checked) backlogIds.forEach((id) => sel.add(id));
    else backlogIds.forEach((id) => sel.delete(id));
    render();
    return;
  }
  const deploySelectCb = e.target.closest(".card-deploy-select-cb");
  if (deploySelectCb) {
    const sel = getDeploySelectedSet(deploySelectCb.dataset.projectId);
    if (deploySelectCb.checked) sel.add(deploySelectCb.dataset.id); else sel.delete(deploySelectCb.dataset.id);
    render();
    return;
  }
  const deploySelectAllCb = e.target.closest(".col-deploy-select-all-cb");
  if (deploySelectAllCb) {
    const pid = deploySelectAllCb.dataset.projectId;
    const sel = getDeploySelectedSet(pid);
    const testingIds = items
      .filter((i) => (i.projectId || GENERAL_PROJECT_ID) === pid && i.status === "ready-for-testing" && !i.noDeploymentRequired)
      .map((i) => i.id);
    if (deploySelectAllCb.checked) testingIds.forEach((id) => sel.add(id));
    else testingIds.forEach((id) => sel.delete(id));
    render();
    return;
  }
  // Column-header tap-to-collapse — mobile only (see projectSectionHTML/
  // isColumnCollapsed's own comments); on a wider viewport where columns
  // sit side by side this is a no-op click, same as tapping any other
  // static heading.
  const colHead = e.target.closest(".col-head");
  if (colHead && !e.target.closest("label, input") && window.matchMedia("(max-width: 640px)").matches) {
    toggleColumnCollapsed(colHead.dataset.projectId, colHead.dataset.col);
    return;
  }
  const moveBtn = e.target.closest(".move-btn");
  if (moveBtn) { moveItem(moveBtn.dataset.id, parseInt(moveBtn.dataset.dir, 10)); return; }
  const testPassedBtn = e.target.closest(".test-passed-btn");
  if (testPassedBtn) { toggleTestPassed(testPassedBtn.dataset.id); return; }
  const confirmNoDeployBtn = e.target.closest(".confirm-no-deploy-btn");
  if (confirmNoDeployBtn) { confirmTestedNoDeploy(confirmNoDeployBtn.dataset.id); return; }
  const delBtn = e.target.closest(".delete-btn");
  if (delBtn) { removeItem(delBtn.dataset.id); return; }
  const archBtn = e.target.closest(".archive-btn");
  if (archBtn) { archiveItem(archBtn.dataset.id); return; }
  const editItemBtn = e.target.closest(".edit-item-btn");
  if (editItemBtn) { openEditItemModal(editItemBtn.dataset.id); return; }
  const quickCommentBtn = e.target.closest(".quick-comment-btn");
  if (quickCommentBtn) { openQuickCommentModal(quickCommentBtn.dataset.id, quickCommentBtn.dataset.readonly === "1"); return; }
  const attachmentBtn = e.target.closest(".attachment-btn");
  if (attachmentBtn) { openQuickCommentModal(attachmentBtn.dataset.id, attachmentBtn.dataset.readonly === "1"); return; }
  const descToggleBtn = e.target.closest(".card-desc-toggle-btn");
  if (descToggleBtn) {
    const wrap = descToggleBtn.closest(".card-desc-wrap");
    const original = wrap.querySelector(".card-desc-original");
    const wasHidden = original.hidden;
    original.hidden = !wasHidden;
    descToggleBtn.textContent = wasHidden ? "Hide original request" : "Show original request";
    return;
  }
  const testLinkBtn = e.target.closest(".test-link-set-btn, .test-link-edit-btn");
  if (testLinkBtn) {
    const id = testLinkBtn.dataset.id;
    const current = items.find((i) => i.id === id)?.previewUrl || "";
    // Prefill an editable rawcdn.githack.com template (not raw.githack.com
    // — that host is CDN-cached and can silently keep showing a stale
    // commit) when there's nothing set yet, so the field isn't just blank.
    const defaultValue = current || "https://rawcdn.githack.com/offline2online/rob_ph_demos/<branch>/<path>";
    const url = await showPromptDialog("Preview/test URL for this ticket (e.g. a rawcdn.githack.com link, or the PR URL):", defaultValue, { title: "Set test link" });
    if (url !== null) setItemPreviewUrl(id, url);
    return;
  }
  const collapseBtn = e.target.closest(".project-collapse-btn");
  if (collapseBtn) { toggleProjectCollapsed(collapseBtn.dataset.projectId); return; }
  const renameBtn = e.target.closest(".project-rename-btn");
  if (renameBtn) { startEditingProjectName(renameBtn.dataset.projectId); return; }
  const newItemBtn = e.target.closest(".new-item-btn");
  if (newItemBtn) { openForm(newItemBtn.dataset.projectId); return; }
  const notifyBtn = e.target.closest(".project-notify-btn");
  if (notifyBtn) { closeAllOptionMenus(); requestNotify(notifyBtn.dataset.projectId); return; }
  const deployToFeatureBtn = e.target.closest(".deploy-to-feature-btn");
  if (deployToFeatureBtn) { closeAllOptionMenus(); deployToFeature(deployToFeatureBtn.dataset.projectId); return; }
  const deployNotifyBtn = e.target.closest(".deploy-notify-btn");
  if (deployNotifyBtn) { closeAllOptionMenus(); requestDeployNotify(deployNotifyBtn.dataset.projectId); return; }
  const archiveNavBtn = e.target.closest(".project-archive-btn");
  if (archiveNavBtn) { closeAllOptionMenus(); openArchivePage(archiveNavBtn.dataset.projectId); return; }
  const docsNavBtn = e.target.closest(".project-docs-btn");
  if (docsNavBtn) { closeAllOptionMenus(); openDocsPage(docsNavBtn.dataset.projectId); return; }
  const ifaceOpenBtn = e.target.closest(".interface-open-btn");
  if (ifaceOpenBtn) { closeAllOptionMenus(); openInterfaceModal(ifaceOpenBtn.dataset.interfaceId); return; }
  const ifaceAddBtn = e.target.closest(".interface-add-btn");
  if (ifaceAddBtn) { closeAllOptionMenus(); openInterfaceModal(null, ifaceAddBtn.dataset.projectId); return; }
  const archiveProjectBtn = e.target.closest(".project-archive-project-btn");
  if (archiveProjectBtn) {
    closeAllOptionMenus();
    const pid = archiveProjectBtn.dataset.projectId;
    const activeCount = activeItemCountForProject(pid);
    const warning = activeCount
      ? `"${projectName(pid)}" still has ${activeCount} active item${activeCount === 1 ? "" : "s"} (not yet Merged to Main). Archive it anyway? You can restore it later from Archived projects.`
      : `Archive "${projectName(pid)}"? You can restore it later from Archived projects.`;
    if (await showConfirmDialog(warning, { title: "Archive project", okLabel: "Archive" })) archiveProject(pid);
    return;
  }
  const optionsBtn = e.target.closest(".project-options-btn");
  if (optionsBtn) { toggleOptionMenu(optionsBtn); return; }
  // Clicking anywhere on a card's own body (not one of its buttons/inputs/
  // links, all already handled above) opens it for editing — the same
  // action as its small pencil icon. Reported as a real bug
  // (Vz3OY3vWkOYs3M8BFhiK): the pencil icon was the *only* way in, and
  // people expected the ticket itself to be clickable. Skipped on a locked
  // card (card-in-development, applied whenever cardHTML's isLocked is
  // true) since editBtn isn't rendered there either — there's nothing to
  // open into.
  const cardEl = e.target.closest(".card");
  if (cardEl && !cardEl.classList.contains("card-in-development") && !e.target.closest("a, button, input, label")) {
    openEditItemModal(cardEl.dataset.id);
    return;
  }
  // Any other click inside the board closes an open options menu — the
  // options-btn case above already returned, so reaching here means the
  // click landed elsewhere (a column, empty space).
  closeAllOptionMenus();
});
projectsRoot.addEventListener("keydown", (e) => {
  if (!e.target.classList.contains("project-name-input")) return;
  if (e.key === "Enter") { e.target.blur(); }
  else if (e.key === "Escape") { editingProjectId = null; render(); }
});
projectsRoot.addEventListener("focusout", (e) => {
  if (!e.target.classList.contains("project-name-input")) return;
  commitProjectNameEdit(e.target.dataset.projectId, e.target.value);
});

// ── Edit item modal — title/desc/type/category plus comments. Comments
// were schema-only until now (`notes`, written only by the Routine via
// direct Firestore writes) — this is the first UI to actually read/write
// them from the board itself. ───────────────────────────────────────────
let editingItemId = null;
const eiBackdrop = document.getElementById("ei-backdrop");
const eiTitleInput = document.getElementById("ei-title-input");
const eiDescInput = document.getElementById("ei-desc-input");
const eiCategorySelect = document.getElementById("ei-category-select");
const eiNoDeployCheckbox = document.getElementById("ei-no-deploy-checkbox");
const eiNotesList = document.getElementById("ei-notes-list");
const eiCommentInput = document.getElementById("ei-comment-input");
const eiAttachmentsList = document.getElementById("ei-attachments-list");
const eiAttachScreenshotInput = document.getElementById("ei-attach-screenshot-input");
const eiRecordScreenBtn = document.getElementById("ei-record-screen-btn");
const eiAttachHint = document.getElementById("ei-attach-hint");

eiCategorySelect.innerHTML = CATEGORIES.map((c) => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join("");

function setEiTypeToggle(type) {
  document.querySelectorAll("#ei-backdrop .type-opt").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.type === type);
  });
}

function formatNoteAt(at) {
  const d = at && at.toDate ? at.toDate() : (at instanceof Date ? at : null);
  return d ? d.toLocaleString() : "";
}

function eiNoteRowHTML(note) {
  const who = note.author === "claude" ? "Claude" : "Comment";
  return `<div class="ei-note-row">
    <div class="ei-note-meta"><b>${escapeHTML(who)}</b><span>${escapeHTML(formatNoteAt(note.at))}</span></div>
    <p class="ei-note-text">${escapeHTML(note.text)}</p>
  </div>`;
}

function renderEiNotes() {
  if (!editingItemId) return;
  const item = allItems.find((i) => i.id === editingItemId);
  const notes = (item && item.notes) || [];
  eiNotesList.innerHTML = notes.length
    ? notes.slice().reverse().map(eiNoteRowHTML).join("")
    : '<p class="interface-row-empty">No comments yet.</p>';
}

// Attachments (screenshots & screen recordings) — see uploadItemAttachment/
// removeItemAttachment above. Image attachments render as a clickable
// thumbnail (opens the full-size file in a new tab); a video attachment
// gets an inline <video> with native controls instead, since a still
// thumbnail wouldn't convey much for a screen recording.
function eiAttachmentItemHTML(att, idx) {
  const label = escapeHTML(att.name || (att.type === "video" ? "Screen recording" : "Screenshot"));
  const preview = att.type === "video"
    ? `<video src="${escapeHTML(att.url)}" class="ei-attachment-thumb" controls muted></video>`
    : `<a href="${escapeHTML(att.url)}" target="_blank" rel="noopener"><img src="${escapeHTML(att.url)}" alt="${label}" class="ei-attachment-thumb"></a>`;
  return `<div class="ei-attachment-item">
    ${preview}
    <div class="ei-attachment-meta">
      <span class="ei-attachment-name" title="${label}">${label}</span>
      <a href="${escapeHTML(att.url)}" target="_blank" rel="noopener" class="ei-attachment-open-link">Open</a>
    </div>
    <button type="button" class="icon-btn ei-attachment-remove-btn" data-idx="${idx}" title="Remove attachment">&times;</button>
  </div>`;
}

function renderEiAttachments() {
  if (!editingItemId) return;
  const item = allItems.find((i) => i.id === editingItemId);
  const attachments = (item && item.attachments) || [];
  eiAttachmentsList.innerHTML = attachments.length
    ? attachments.map((a, idx) => eiAttachmentItemHTML(a, idx)).join("")
    : '<p class="interface-row-empty">No attachments yet.</p>';
}

function setEiAttachHint(text) {
  if (!eiAttachHint) return;
  eiAttachHint.textContent = text || "";
  eiAttachHint.hidden = !text;
}

const updateEiTitleCount = wireCharCount(eiTitleInput, document.getElementById("ei-title-count"));
const updateEiDescCount = wireCharCount(eiDescInput, document.getElementById("ei-desc-count"));

function openEditItemModal(id) {
  editingItemId = id;
  const item = allItems.find((i) => i.id === id);
  if (!item) return;
  eiTitleInput.value = item.title || "";
  eiDescInput.value = item.desc || "";
  updateEiTitleCount();
  updateEiDescCount();
  setEiTypeToggle(item.type === "bug" ? "bug" : "feature");
  eiCategorySelect.value = item.category || CATEGORIES[0];
  eiNoDeployCheckbox.checked = !!item.noDeploymentRequired;
  eiCommentInput.value = "";
  renderEiNotes();
  renderEiAttachments();
  setEiAttachHint("");
  eiBackdrop.hidden = false;
  eiTitleInput.focus();
}
function closeEditItemModal() {
  // Closing mid-recording doesn't lose the recording — createAttachmentController
  // captures the target item id in its own closure at start time, so the
  // upload still lands on the right item even after editingItemId below
  // goes back to null.
  eiAttachments.stopRecording();
  eiBackdrop.hidden = true;
  editingItemId = null;
}

document.getElementById("ei-close").addEventListener("click", closeEditItemModal);
document.getElementById("ei-cancel").addEventListener("click", closeEditItemModal);
eiBackdrop.addEventListener("click", (e) => { if (e.target === eiBackdrop) closeEditItemModal(); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !eiBackdrop.hidden) closeEditItemModal();
});
document.querySelectorAll("#ei-backdrop .type-opt").forEach((btn) => {
  btn.addEventListener("click", () => setEiTypeToggle(btn.dataset.type));
});
document.getElementById("ei-save").addEventListener("click", async () => {
  if (!editingItemId) return;
  if (!eiTitleInput.value.trim()) { await showAlert("Title can't be empty."); return; }
  const type = document.querySelector("#ei-backdrop .type-opt.active")?.dataset.type || "feature";
  const title = eiTitleInput.value.trim();
  const desc = eiDescInput.value.trim();
  try {
    await updateItemDetails(editingItemId, {
      title, desc, type, category: eiCategorySelect.value,
      noDeploymentRequired: eiNoDeployCheckbox.checked,
    });
  } catch (err) {
    await showAlert(describeSaveError(err, [
      { label: "Title", value: title, max: 200 },
      { label: "Description", value: desc, max: 2000 },
    ]));
    return;
  }
  closeEditItemModal();
});
document.getElementById("ei-comment-submit").addEventListener("click", () => {
  if (!editingItemId) return;
  const text = eiCommentInput.value;
  if (!text.trim()) return;
  addItemComment(editingItemId, text);
  eiCommentInput.value = "";
});

// ── Attachments — a picked screenshot uploads immediately on selection
// (no separate "Attach" click to remember), same one-step feel as the
// comment box's own submit-on-click. See uploadItemAttachment above for
// the Storage write itself. ────────────────────────────────────────────
eiAttachmentsList.addEventListener("click", async (e) => {
  const btn = e.target.closest(".ei-attachment-remove-btn");
  if (!btn || !editingItemId) return;
  const item = allItems.find((i) => i.id === editingItemId);
  const att = item && (item.attachments || [])[Number(btn.dataset.idx)];
  if (!att) return;
  if (!(await showConfirmDialog(`Remove "${att.name || "this attachment"}"?`, { title: "Remove attachment", okLabel: "Remove", danger: true }))) return;
  removeItemAttachment(editingItemId, att);
});

// Screenshot-picker + screen-recording (getDisplayMedia + MediaRecorder, no
// third-party library) wiring, factored into one controller so it can be
// instantiated independently for both the Edit item modal and the
// quick-comment modal (see the qc instance below) — same "one factory, N
// independent instances" pattern createDictationController already uses
// for its three mic buttons, added here so attaching works from wherever a
// person actually taps (DrIEsKsdi3WrwXbUdMH6 and its duplicates: the old
// single Edit-modal-only Attachments block was too easy to miss entirely).
// `getItemId` is read fresh on every action (not captured once at
// construction) so each instance always targets whichever item its own
// modal currently has open; a recording in progress captures its own
// target id in `targetItemId` at start time so it still uploads to the
// right item even if the modal is closed (or reopened on a different item)
// before the user hits Stop.
function createAttachmentController({ getItemId, screenshotInput, recordBtn, hintEl }) {
  let recorder = null;

  function setHint(msg) {
    if (!hintEl) return;
    hintEl.hidden = !msg;
    hintEl.textContent = msg || "";
  }
  function setRecordButtonState(recording) {
    recordBtn.classList.toggle("recording", recording);
    recordBtn.textContent = recording ? "⏹ Stop recording" : "⏺ Record screen";
  }

  screenshotInput.addEventListener("change", async () => {
    const file = screenshotInput.files[0];
    screenshotInput.value = "";
    const id = getItemId();
    if (!file || !id) return;
    if (!file.type.startsWith("image/")) { await showAlert("Please choose an image file."); return; }
    if (file.size > MAX_SCREENSHOT_BYTES) { await showAlert("That screenshot is too large (max 15MB)."); return; }
    setHint("Uploading screenshot…");
    try {
      await uploadItemAttachment(id, file, "image");
      setHint("");
    } catch (err) {
      setHint("");
      await showAlert("Couldn't upload that screenshot: " + (err && err.message ? err.message : err));
    }
  });

  async function startRecording() {
    const id = getItemId();
    if (!id) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      await showAlert("Screen recording isn't supported in this browser.");
      return;
    }
    const targetItemId = id;
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    } catch (err) {
      // The user cancelled the browser's own share-picker — not an error.
      return;
    }
    const chunks = [];
    const mimeType = (window.MediaRecorder && MediaRecorder.isTypeSupported("video/webm;codecs=vp9"))
      ? "video/webm;codecs=vp9" : "video/webm";
    const rec = new MediaRecorder(stream, { mimeType });
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      setRecordButtonState(false);
      const blob = new Blob(chunks, { type: mimeType });
      if (blob.size > MAX_RECORDING_BYTES) {
        setHint("");
        await showAlert("That recording is too large (max 100MB) — try a shorter one.");
        return;
      }
      const file = new File([blob], `screen-recording-${Date.now()}.webm`, { type: mimeType });
      setHint("Uploading screen recording…");
      try {
        await uploadItemAttachment(targetItemId, file, "video");
      } catch (err) {
        await showAlert("Couldn't upload that screen recording: " + (err && err.message ? err.message : err));
      } finally {
        setHint("");
      }
    };
    // The user can also end the capture from the browser's own "Stop
    // sharing" bar instead of this button — react the same way either path.
    stream.getVideoTracks()[0].addEventListener("ended", () => {
      if (rec.state !== "inactive") rec.stop();
    });
    recorder = rec;
    rec.start();
    setRecordButtonState(true);
    setHint("Recording your screen — click Stop recording when done.");
  }

  function stopRecording() {
    if (recorder && recorder.state !== "inactive") recorder.stop();
    recorder = null;
  }

  recordBtn.addEventListener("click", () => {
    if (recorder && recorder.state === "recording") stopRecording();
    else startRecording();
  });

  return { stopRecording };
}

const eiAttachments = createAttachmentController({
  getItemId: () => editingItemId,
  screenshotInput: eiAttachScreenshotInput,
  recordBtn: eiRecordScreenBtn,
  hintEl: eiAttachHint,
});
const qcAttachments = createAttachmentController({
  getItemId: () => quickCommentItemId,
  screenshotInput: document.getElementById("qc-attach-screenshot-input"),
  recordBtn: document.getElementById("qc-record-screen-btn"),
  hintEl: document.getElementById("qc-attach-hint"),
});

// ── Quick comment modal — comment-only, reached from the card's own small
// icon (bottom row, next to the category badge) instead of the pencil icon
// that opens the full Edit item modal above. Same addItemComment() write,
// just without pulling in title/desc/type/category editing at all.
let quickCommentItemId = null;
const qcBackdrop = document.getElementById("qc-backdrop");
const qcCommentInput = document.getElementById("qc-comment-input");
const qcNotesList = document.getElementById("qc-notes-list");
const qcTitle = document.getElementById("qc-title");
const qcComposer = document.getElementById("qc-composer");
const qcReadonlyHint = document.getElementById("qc-readonly-hint");
const qcSubmitBtn = document.getElementById("qc-submit");
const qcAttachmentsActions = document.getElementById("qc-attachments-actions");

// The card's comment icon carries a count, and tapping it used to open an
// empty box — so the number told you a conversation existed and the click
// then hid it. Everything already said on the ticket, Claude's notes
// included (where the reasoning for a change is recorded), was only
// reachable through the full Edit modal, which locked cards don't offer at
// all. Now the icon opens the thread it's counting.
function renderQcNotes() {
  if (!quickCommentItemId) return;
  const item = allItems.find((i) => i.id === quickCommentItemId);
  const notes = (item && item.notes) || [];
  // Newest first, same order as the Edit item modal's own list.
  qcNotesList.innerHTML = notes.length
    ? notes.slice().reverse().map(eiNoteRowHTML).join("")
    : '<p class="interface-row-empty">No comments yet.</p>';
  // The count in the title is read from the same array the card's badge
  // counts, so the two can't disagree.
  qcTitle.textContent = notes.length ? `Comments (${notes.length})` : "Comments";
}

function openQuickCommentModal(id, readOnly) {
  quickCommentItemId = id;
  qcCommentInput.value = "";
  renderQcNotes();
  qcComposer.hidden = !!readOnly;
  qcSubmitBtn.hidden = !!readOnly;
  qcReadonlyHint.hidden = !readOnly;
  // Attaching writes to the same locked-while-in-progress document the
  // composer does, so it's gated the same way.
  qcAttachmentsActions.hidden = !!readOnly;
  document.getElementById("qc-attach-hint").hidden = true;
  // The mic button lives inside #qc-composer, so hiding the composer takes
  // it with it — don't touch its own `hidden`, which is owned by the
  // dictation controller's "is speech recognition available" check and
  // would stay stuck off for every later card if this reached in.
  qcBackdrop.hidden = false;
  if (!readOnly) qcCommentInput.focus();
}
function closeQuickCommentModal() {
  qcAttachments.stopRecording();
  qcBackdrop.hidden = true;
  quickCommentItemId = null;
}
document.getElementById("qc-close").addEventListener("click", closeQuickCommentModal);
document.getElementById("qc-cancel").addEventListener("click", closeQuickCommentModal);
qcBackdrop.addEventListener("click", (e) => { if (e.target === qcBackdrop) closeQuickCommentModal(); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !qcBackdrop.hidden) closeQuickCommentModal();
});
qcSubmitBtn.addEventListener("click", () => {
  if (!quickCommentItemId) return;
  const text = qcCommentInput.value;
  if (!text.trim()) return;
  addItemComment(quickCommentItemId, text);
  // Stays open, unlike before: this is a thread now, and the comment you
  // just wrote appears in it when the write comes back through the
  // listener. Closing on submit hid your own comment the instant you made
  // it, which is exactly the behaviour this card is about.
  qcCommentInput.value = "";
  qcCommentInput.dispatchEvent(new Event("input"));
  qcCommentInput.focus();
});

// ── New Item modal ─────────────────────────────────────────────────────
// Title and category aren't asked for here — just a single description
// (typed or dictated). A short title is generated from it and the area
// is best-guessed the same way suggestCategory() already worked in the
// background before; both are placeholders Claude corrects with the real
// answer during its backlog sweep, not something worth interrupting quick
// capture to get right up front.
const niBackdrop = document.getElementById("ni-backdrop");

let activeNewItemProjectId = null;

// Live "X / max" readout for a bounded field, driven off the element's own
// maxLength (works for both <input maxlength> and <textarea maxlength>) —
// see firestore.rules for the actual caps this mirrors (desc 2000, title
// 200, project/interface/doc name 80-120, interface/doc contentMd 20000).
// Returns an update() the caller can invoke after setting .value
// programmatically (opening Edit item, opening a Docs modal, ...), since
// that doesn't fire an "input" event on its own.
function wireCharCount(el, counterEl) {
  if (!el || !counterEl) return () => {};
  const max = el.maxLength;
  function update() {
    const len = el.value.length;
    counterEl.textContent = max > 0 ? `${len} / ${max}` : "";
    counterEl.classList.toggle("char-count-warn", max > 0 && len >= max * 0.9 && len < max);
    counterEl.classList.toggle("char-count-limit", max > 0 && len >= max);
  }
  el.addEventListener("input", update);
  update();
  return update;
}

// firestore.rules rejects a write over one of its bounded-string caps with
// a bare 403 permission-denied — nothing in that error names the field or
// the limit. maxlength (plus the dictation clamp below) stops most of this
// at the source, but this is the last-resort net for whatever still gets
// through: look at exactly the fields the write just tried to save and, if
// one is actually over its own known cap, say so in plain language instead
// of surfacing "permission-denied" to someone who typed a long ticket.
function describeSaveError(err, checkedFields) {
  const over = (checkedFields || []).find((f) => typeof f.value === "string" && f.value.length > f.max);
  if (over) {
    return `${over.label} is ${over.value.length} characters — the limit is ${over.max}. Trim it down and try again.`;
  }
  const msg = (err && err.message) || String(err);
  return /permission[- ]denied/i.test(msg)
    ? "Couldn't save — the server rejected this write (permission-denied). If a field looks unusually long, that's the most likely reason; otherwise this may need a developer to look at firestore.rules."
    : `Couldn't save: ${msg}`;
}

// ── Duplicate-ticket check, New Item form only ───────────────────────────
// Three cards asking for the same thing ("make ticket attachments easier
// to find") were each independently investigated, built, PR'd, merged and
// deployed as three separate PRs in one night — nothing between a card
// being typed and it landing in Backlog ever compared what two cards were
// actually asking for. This is the creation-time half of that fix (see
// ROUTINE_INSTRUCTIONS.md for the packaging-time half, which re-checks
// right before a batch of Backlog items is sent off to be built). Plain
// keyword-overlap, not embeddings/AI — same spirit as suggestCategory()
// just above: a cheap, local, good-enough signal, not a final answer.
const SIMILARITY_STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "are", "was", "were",
  "has", "have", "when", "then", "than", "into", "onto", "not", "but", "you",
  "your", "can", "will", "would", "could", "should", "also", "just", "its",
  "it's", "a", "an", "of", "to", "in", "on", "is", "it", "as", "be", "or",
  "if", "so", "we", "i", "please", "make", "add",
]);
function significantWords(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !SIMILARITY_STOPWORDS.has(w));
}
// Overlap coefficient (shared / smaller set), not Jaccard — a short new
// description that's entirely contained in a longer existing ticket should
// still read as a strong match, and Jaccard would dilute that with all the
// longer ticket's unrelated words.
function descSimilarity(a, b) {
  const wa = new Set(significantWords(a));
  const wb = new Set(significantWords(b));
  if (!wa.size || !wb.size) return 0;
  let shared = 0;
  wa.forEach((w) => { if (wb.has(w)) shared++; });
  return shared / Math.min(wa.size, wb.size);
}
const DUPLICATE_SIMILARITY_THRESHOLD = 0.6;
// "Open" here means still actively in play for this project — a ticket
// already live or archived isn't a duplicate risk, it's just prior art.
const OPEN_STATUSES_FOR_DUPLICATE_CHECK = ["backlog", "ready-for-testing", "ready-to-publish"];
function findLikelyDuplicate(projectId, desc) {
  let best = null, bestScore = 0;
  items
    .filter((i) => (i.projectId || GENERAL_PROJECT_ID) === projectId && OPEN_STATUSES_FOR_DUPLICATE_CHECK.includes(i.status))
    .forEach((i) => {
      const score = descSimilarity(desc, i.desc || "");
      if (score > bestScore) { bestScore = score; best = i; }
    });
  return bestScore >= DUPLICATE_SIMILARITY_THRESHOLD ? { item: best, score: bestScore } : null;
}

const TITLE_MAX = 70;
function generateTitle(desc) {
  const text = (desc || "").trim().replace(/\s+/g, " ");
  if (text.length <= TITLE_MAX) return text;
  const cut = text.slice(0, TITLE_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut) + "…";
}

const updateNiDescCount = wireCharCount(document.getElementById("ni-desc-input"), document.getElementById("ni-desc-count"));

function openForm(projectId) {
  activeNewItemProjectId = projectId;
  niBackdrop.hidden = false;
  document.getElementById("ni-desc-input").focus();
}
function closeForm() {
  niBackdrop.hidden = true;
  activeNewItemProjectId = null;
  niDictation.stop();
  const descEl = document.getElementById("ni-desc-input");
  descEl.value = "";
  descEl.style.height = "";
  updateNiDescCount();
  document.querySelectorAll(".type-opt").forEach((b) => b.classList.remove("active"));
  document.querySelector('.type-opt[data-type="feature"]').classList.add("active");
  niDictation.clearError();
}

document.getElementById("ni-cancel").addEventListener("click", closeForm);
document.getElementById("ni-close").addEventListener("click", closeForm);
niBackdrop.addEventListener("click", (e) => { if (e.target === niBackdrop) closeForm(); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !niBackdrop.hidden) closeForm();
});

document.querySelectorAll(".type-opt").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".type-opt").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  });
});

document.getElementById("ni-submit").addEventListener("click", async () => {
  const desc = document.getElementById("ni-desc-input").value.trim();
  const type = document.querySelector(".type-opt.active").dataset.type;
  const category = suggestCategory(desc);
  const title = generateTitle(desc);
  if (!desc || !activeNewItemProjectId) return;

  const dup = findLikelyDuplicate(activeNewItemProjectId, desc);
  if (dup) {
    const addAsComment = await showConfirmDialog(
      `This looks a lot like an existing open ticket: "${dup.item.title}". Add this as a comment on that ticket instead of creating a separate one?`,
      { okLabel: "Add as comment", cancelLabel: "Create separate ticket anyway" }
    );
    if (addAsComment) {
      await addItemComment(dup.item.id, desc);
      closeForm();
      return;
    }
    // "Create separate ticket anyway" falls through to the normal add below —
    // the check is a nudge, not a block, since two cards can legitimately
    // share a lot of wording and still be genuinely different work.
  }

  try {
    await addItem(activeNewItemProjectId, title, desc, type, category);
  } catch (err) {
    await showAlert(describeSaveError(err, [{ label: "Description", value: desc, max: 2000 }]));
    return;
  }
  closeForm();
});

// ── New Project modal ───────────────────────────────────────────────────
// Defining an interface with another project used to be an option in this
// same modal (a checkbox that expanded a whole extra sub-form) — removed
// as an unnecessary step here: a project's interfaces are just as easily
// added later, one at a time, from its own Docs page, and Claude can wire
// one up on its own once both projects actually exist. This modal now only
// ever creates a plain project.
const npBackdrop = document.getElementById("np-backdrop");
const npProgramSelect = document.getElementById("np-program-select");

// Shared by the New Project modal and the Docs page: handles the trailing
// "+ New program…" option by prompting for a name, creating it, then
// re-populating the select with the new program selected — or reverting to
// "No program" if the prompt is cancelled/left blank.
function wireProgramSelect(selectEl) {
  selectEl.addEventListener("change", async () => {
    if (selectEl.value !== "__new__") return;
    const name = ((await showPromptDialog("New program/product name:")) || "").trim();
    if (!name) { populateProgramSelect(selectEl, ""); return; }
    const newId = await createProgram(name);
    populateProgramSelect(selectEl, newId || "");
  });
}
wireProgramSelect(npProgramSelect);

function populateProjectSelect(selectEl, excludeId) {
  const opts = projects.filter((p) => p.id !== excludeId);
  selectEl.innerHTML = opts.length
    ? opts.map((p) => `<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)}</option>`).join("")
    : '<option value="">No other projects yet</option>';
}

const updateNpNameCount = wireCharCount(document.getElementById("np-name-input"), document.getElementById("np-name-count"));

function openProjectModal() {
  npBackdrop.hidden = false;
  document.getElementById("np-name-input").value = "";
  updateNpNameCount();
  populateProgramSelect(npProgramSelect, "");
  document.getElementById("np-name-input").focus();
}
function closeProjectModal() { npBackdrop.hidden = true; }

document.getElementById("new-project-btn").addEventListener("click", openProjectModal);
document.getElementById("np-cancel").addEventListener("click", closeProjectModal);
document.getElementById("np-close").addEventListener("click", closeProjectModal);
npBackdrop.addEventListener("click", (e) => { if (e.target === npBackdrop) closeProjectModal(); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !npBackdrop.hidden) closeProjectModal();
});
document.getElementById("np-submit").addEventListener("click", async () => {
  const nameEl = document.getElementById("np-name-input");
  const name = nameEl.value.trim();
  if (!name) { nameEl.focus(); return; }
  const programId = npProgramSelect.value !== "__new__" ? npProgramSelect.value : "";
  try {
    await addProject(name, programId);
  } catch (err) {
    await showAlert(describeSaveError(err, [{ label: "Name", value: name, max: 80 }]));
    return;
  }
  closeProjectModal();
});

// ── Archive page ────────────────────────────────────────────────────────
const archivePage = document.getElementById("archive-page");
const archiveFilterType = document.getElementById("archive-filter-type");
const archiveFilterCategory = document.getElementById("archive-filter-category");
const archiveFilterSearch = document.getElementById("archive-filter-search");
archiveFilterCategory.innerHTML =
  '<option value="">All areas</option>' +
  CATEGORIES.map((c) => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join("");

function projectName(pid) {
  const p = projects.find((p) => p.id === pid);
  if (p) return p.name;
  return pid === GENERAL_PROJECT_ID ? "General" : pid;
}

function openArchivePage(pid) {
  closeAllSubPages();
  archiveProjectId = pid;
  archiveFilters = { type: "", category: "", search: "" };
  archiveFilterType.value = "";
  archiveFilterCategory.value = "";
  archiveFilterSearch.value = "";
  document.getElementById("projects-root").hidden = true;
  archivePage.hidden = false;
  renderArchivePage();
}

function closeArchivePage() {
  archiveProjectId = null;
  archivePage.hidden = true;
  document.getElementById("projects-root").hidden = false;
}

function archiveRowHTML(item) {
  const date = item.archivedAt && item.archivedAt.toDate ? item.archivedAt.toDate() : null;
  const dateStr = date ? date.toLocaleDateString() : "—";
  return `
    <tr data-id="${item.id}">
      <td><span class="badge badge-${item.type}">${item.type === "bug" ? "Bug" : "Feature"}</span></td>
      <td><span class="card-cat">${escapeHTML(item.category || "Uncategorised")}</span></td>
      <td>
        <p class="archive-row-title">${escapeHTML(item.title)}</p>
        <p class="archive-row-desc">${escapeHTML(item.desc)}</p>
      </td>
      <td class="archive-row-version">${item.testVersion ? `v${escapeHTML(item.testVersion)}` : "—"}</td>
      <td class="archive-row-date">${dateStr}</td>
      <td><button type="button" class="restore-btn" data-id="${item.id}">Restore</button></td>
    </tr>`;
}

function renderArchivePage() {
  if (!archiveProjectId) return;
  document.getElementById("archive-page-project-name").textContent = projectName(archiveProjectId);

  let rows = allItems.filter(
    (i) => (i.projectId || GENERAL_PROJECT_ID) === archiveProjectId && i.status === "archived"
  );
  if (archiveFilters.type) rows = rows.filter((i) => i.type === archiveFilters.type);
  if (archiveFilters.category) rows = rows.filter((i) => i.category === archiveFilters.category);
  if (archiveFilters.search) {
    const q = archiveFilters.search.toLowerCase();
    rows = rows.filter(
      (i) => (i.title || "").toLowerCase().includes(q) || (i.desc || "").toLowerCase().includes(q)
    );
  }

  const dir = archiveSort.dir === "asc" ? 1 : -1;
  rows.sort((a, b) => {
    let av, bv;
    if (archiveSort.field === "date") {
      av = a.archivedAt && a.archivedAt.toMillis ? a.archivedAt.toMillis() : 0;
      bv = b.archivedAt && b.archivedAt.toMillis ? b.archivedAt.toMillis() : 0;
    } else if (archiveSort.field === "title") {
      av = (a.title || "").toLowerCase(); bv = (b.title || "").toLowerCase();
    } else if (archiveSort.field === "category") {
      av = (a.category || ""); bv = (b.category || "");
    } else {
      av = (a.type || ""); bv = (b.type || "");
    }
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });

  document.getElementById("archive-page-count").textContent =
    `${rows.length} ticket${rows.length === 1 ? "" : "s"}`;
  document.getElementById("archive-table-body").innerHTML = rows.map(archiveRowHTML).join("");
  document.getElementById("archive-table-empty").hidden = rows.length !== 0;

  document.querySelectorAll(".archive-table th[data-sort]").forEach((th) => {
    th.toggleAttribute("data-sort-active", th.dataset.sort === archiveSort.field);
  });
}


document.querySelectorAll(".archive-table th[data-sort]").forEach((th) => {
  th.addEventListener("click", () => {
    const field = th.dataset.sort;
    if (archiveSort.field === field) {
      archiveSort.dir = archiveSort.dir === "asc" ? "desc" : "asc";
    } else {
      archiveSort = { field, dir: "asc" };
    }
    renderArchivePage();
  });
});

archiveFilterType.addEventListener("change", () => {
  archiveFilters.type = archiveFilterType.value;
  renderArchivePage();
});
archiveFilterCategory.addEventListener("change", () => {
  archiveFilters.category = archiveFilterCategory.value;
  renderArchivePage();
});
archiveFilterSearch.addEventListener("input", () => {
  archiveFilters.search = archiveFilterSearch.value;
  renderArchivePage();
});

document.getElementById("archive-table-body").addEventListener("click", (e) => {
  const btn = e.target.closest(".restore-btn");
  if (btn) restoreItem(btn.dataset.id);
});

// ── Archived projects page (top-level — a whole project, not one ticket) ──
const archivedProjectsPage = document.getElementById("archived-projects-page");

function openArchivedProjectsPage() {
  closeAllSubPages();
  document.getElementById("projects-root").hidden = true;
  archivedProjectsPage.hidden = false;
  renderArchivedProjectsPage();
}
function closeArchivedProjectsPage() {
  archivedProjectsPage.hidden = true;
  document.getElementById("projects-root").hidden = false;
}

function archivedProjectRowHTML(p) {
  const activeCount = activeItemCountForProject(p.id);
  const date = p.archivedAt && p.archivedAt.toDate ? p.archivedAt.toDate() : null;
  const dateStr = date ? date.toLocaleDateString() : "—";
  return `
    <tr data-project-id="${escapeHTML(p.id)}">
      <td>${escapeHTML(p.name)}</td>
      <td>${activeCount} active item${activeCount === 1 ? "" : "s"}</td>
      <td>${dateStr}</td>
      <td><button type="button" class="restore-btn restore-project-btn" data-project-id="${escapeHTML(p.id)}">Restore</button></td>
    </tr>`;
}

function renderArchivedProjectsPage() {
  const rows = projects.filter((p) => p.archived);
  document.getElementById("archived-projects-count").textContent =
    `${rows.length} project${rows.length === 1 ? "" : "s"}`;
  document.getElementById("archived-projects-table-body").innerHTML = rows.map(archivedProjectRowHTML).join("");
  document.getElementById("archived-projects-empty").hidden = rows.length !== 0;
}

// Reached from the Settings page now, not the nav drawer — see the
// "Archived projects" docs-block in faq-settings-page.
document.getElementById("fa-open-archived-projects-btn").addEventListener("click", () => { closeFaqSettingsPage(); openArchivedProjectsPage(); });
document.getElementById("archived-projects-table-body").addEventListener("click", (e) => {
  const btn = e.target.closest(".restore-project-btn");
  if (btn) restoreProject(btn.dataset.projectId);
});

// ── Docs page (per-project requirements + interfaces with other projects) ─
const docsPage = document.getElementById("docs-page");
const docsReadmeInput = document.getElementById("docs-readme-input");
const docsRequirementsInput = document.getElementById("docs-requirements-input");
const docsRoutinePromptInput = document.getElementById("docs-routine-prompt-input");
const docsFaqAutoFlagInput = document.getElementById("docs-faq-auto-flag");
const docsProgramSelect = document.getElementById("docs-program-select");
// Not wireProgramSelect() — unlike the New Project modal (where the choice
// isn't persisted until "Create project"), a program picked here needs to
// be saved onto the existing project doc immediately, including one
// created inline via "+ New program…".
docsProgramSelect.addEventListener("change", async () => {
  if (!docsProjectId) return;
  if (docsProgramSelect.value === "__new__") {
    const name = ((await showPromptDialog("New program/product name:")) || "").trim();
    if (!name) { populateProgramSelect(docsProgramSelect, ""); return; }
    const newId = await createProgram(name);
    populateProgramSelect(docsProgramSelect, newId || "");
    if (newId) await setProjectProgram(docsProjectId, newId);
    return;
  }
  setProjectProgram(docsProjectId, docsProgramSelect.value);
});

function openDocsPage(pid) {
  closeAllSubPages();
  docsProjectId = pid;
  document.getElementById("projects-root").hidden = true;
  docsPage.hidden = false;
  renderDocsPage();
}

function closeDocsPage() {
  docsProjectId = null;
  docsPage.hidden = true;
  document.getElementById("projects-root").hidden = false;
}

function interfaceRowHTML(f) {
  const otherId = f.projectIds.find((id) => id !== docsProjectId);
  const contentPreview = f.contentMd
    ? `<div class="interface-row-content">${escapeHTML(f.contentMd)}</div>`
    : `<p class="interface-row-empty" style="margin:8px 0 0;">No contract written yet.</p>`;
  return `
    <div class="interface-row" data-id="${f.id}">
      <div class="interface-row-top">
        <div>
          <div class="interface-row-title">${escapeHTML(f.name)}</div>
          <div class="interface-row-with">with <b>${escapeHTML(projectName(otherId))}</b></div>
        </div>
        <div class="interface-row-actions">
          <button type="button" class="icon-btn interface-edit-btn" data-id="${f.id}" title="Edit">&#9998;</button>
          <button type="button" class="icon-btn interface-delete-btn" data-id="${f.id}" title="Remove">&times;</button>
        </div>
      </div>
      ${contentPreview}
    </div>`;
}

function projectDocRowHTML(d) {
  const contentPreview = d.contentMd
    ? `<div class="interface-row-content">${escapeHTML(d.contentMd)}</div>`
    : `<p class="interface-row-empty" style="margin:8px 0 0;">No content written yet.</p>`;
  return `
    <div class="interface-row" data-id="${d.id}">
      <div class="interface-row-top">
        <div>
          <div class="interface-row-title">${escapeHTML(d.name)}</div>
        </div>
        <div class="interface-row-actions">
          <button type="button" class="icon-btn doc-edit-btn" data-id="${d.id}" title="Edit">&#9998;</button>
          <button type="button" class="icon-btn doc-delete-btn" data-id="${d.id}" title="Remove">&times;</button>
        </div>
      </div>
      ${contentPreview}
    </div>`;
}

function renderDocsPage() {
  if (!docsProjectId) return;
  const project = projects.find((p) => p.id === docsProjectId);
  document.getElementById("docs-page-project-name").textContent = project ? project.name : projectName(docsProjectId);
  if (document.activeElement !== docsProgramSelect) {
    populateProgramSelect(docsProgramSelect, project ? project.programId || "" : "");
  }
  if (document.activeElement !== docsReadmeInput) {
    docsReadmeInput.value = (project && project.readmeMd) || "";
  }
  if (document.activeElement !== docsRequirementsInput) {
    docsRequirementsInput.value = (project && project.requirementsMd) || "";
  }
  if (document.activeElement !== docsRoutinePromptInput) {
    docsRoutinePromptInput.value = (project && project.routinePromptMd) || "";
  }
  docsFaqAutoFlagInput.checked = !!(project && project.faqAutoFlagOnLive);
  const rows = interfacesForProject(docsProjectId);
  document.getElementById("docs-interfaces-list").innerHTML = rows.length
    ? rows.map(interfaceRowHTML).join("")
    : '<p class="interface-row-empty">No interfaces defined with another project yet.</p>';
  const docRows = docsForProject(docsProjectId);
  document.getElementById("docs-extra-docs-list").innerHTML = docRows.length
    ? docRows.map(projectDocRowHTML).join("")
    : '<p class="interface-row-empty">No additional documents yet.</p>';
}

document.getElementById("docs-readme-save").addEventListener("click", () => {
  if (!docsProjectId) return;
  setProjectReadme(docsProjectId, docsReadmeInput.value);
});
document.getElementById("docs-requirements-save").addEventListener("click", () => {
  if (!docsProjectId) return;
  setProjectRequirements(docsProjectId, docsRequirementsInput.value);
});
document.getElementById("docs-routine-prompt-save").addEventListener("click", () => {
  if (!docsProjectId) return;
  setProjectRoutinePrompt(docsProjectId, docsRoutinePromptInput.value);
});
docsFaqAutoFlagInput.addEventListener("change", () => {
  if (!docsProjectId) return;
  setProjectFaqAutoFlag(docsProjectId, docsFaqAutoFlagInput.checked);
});
document.getElementById("docs-interfaces-list").addEventListener("click", (e) => {
  const editBtn = e.target.closest(".interface-edit-btn");
  if (editBtn) { openInterfaceModal(editBtn.dataset.id); return; }
  const delBtn = e.target.closest(".interface-delete-btn");
  if (delBtn) { deleteInterface(delBtn.dataset.id); return; }
});
document.getElementById("docs-extra-docs-list").addEventListener("click", (e) => {
  const editBtn = e.target.closest(".doc-edit-btn");
  if (editBtn) { openDocModal(editBtn.dataset.id); return; }
  const delBtn = e.target.closest(".doc-delete-btn");
  if (delBtn) { deleteProjectDoc(delBtn.dataset.id); return; }
});

// ── Additional document modal — shared "add" and "edit" flow, anchored to
// whichever project's Docs page it was opened from (a project doc, unlike
// an interface, only ever belongs to one project). ─────────────────────
const docBackdrop = document.getElementById("doc-backdrop");
const docNameInput = document.getElementById("doc-name-input");
const docContentInput = document.getElementById("doc-content-input");
const updateDocContentCount = wireCharCount(docContentInput, document.getElementById("doc-content-count"));

function openDocModal(docId) {
  editingDocId = docId || null;
  docBackdrop.hidden = false;
  if (editingDocId) {
    const d = projectDocs.find((x) => x.id === editingDocId);
    document.getElementById("doc-title").textContent = "Edit document";
    docNameInput.value = d ? d.name : "";
    docContentInput.value = d ? d.contentMd || "" : "";
  } else {
    document.getElementById("doc-title").textContent = "New document";
    docNameInput.value = "";
    docContentInput.value = "";
  }
  updateDocContentCount();
  docNameInput.focus();
}
function closeDocModal() { docBackdrop.hidden = true; editingDocId = null; }

document.getElementById("docs-add-doc-btn").addEventListener("click", () => openDocModal(null));
document.getElementById("doc-cancel").addEventListener("click", closeDocModal);
document.getElementById("doc-close").addEventListener("click", closeDocModal);
docBackdrop.addEventListener("click", (e) => { if (e.target === docBackdrop) closeDocModal(); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !docBackdrop.hidden) closeDocModal();
});
document.getElementById("doc-submit").addEventListener("click", async () => {
  const name = docNameInput.value.trim();
  if (!name) { docNameInput.focus(); return; }
  const content = docContentInput.value;
  try {
    if (editingDocId) {
      await updateProjectDoc(editingDocId, name, content);
    } else {
      if (!docsProjectId) return;
      await addProjectDoc(docsProjectId, name, content);
    }
  } catch (err) {
    await showAlert(describeSaveError(err, [
      { label: "Name", value: name, max: 120 },
      { label: "Content", value: content, max: 20000 },
    ]));
    return;
  }
  closeDocModal();
});

// ── Interface modal — shared "add" (from Docs page) and "edit" flow ──────
const ifBackdrop = document.getElementById("if-backdrop");
const ifOtherProject = document.getElementById("if-other-project");
const ifNameInput = document.getElementById("if-name-input");
const ifContentInput = document.getElementById("if-content-input");
const updateIfContentCount = wireCharCount(ifContentInput, document.getElementById("if-content-count"));

// `anchorProjectId` is only used in "new" mode (no interfaceId) — it's
// whichever project the modal was launched from (the Docs page's own
// project, or a project's "⋮" menu directly), independent of whether the
// Docs page itself happens to be open. Kept as its own variable rather
// than reusing docsProjectId so launching this from the options menu never
// has to first open (or silently mutate the state of) the Docs page.
let ifAnchorProjectId = null;

function openInterfaceModal(interfaceId, anchorProjectId) {
  editingInterfaceId = interfaceId || null;
  ifAnchorProjectId = anchorProjectId || null;
  ifBackdrop.hidden = false;
  if (editingInterfaceId) {
    const f = interfaces.find((x) => x.id === editingInterfaceId);
    document.getElementById("if-title").textContent = "Edit interface";
    document.querySelector("label[for='if-other-project']").hidden = true;
    ifOtherProject.hidden = true;
    ifNameInput.value = f ? f.name : "";
    ifContentInput.value = f ? f.contentMd || "" : "";
  } else {
    document.getElementById("if-title").textContent = "New interface";
    document.querySelector("label[for='if-other-project']").hidden = false;
    ifOtherProject.hidden = false;
    populateProjectSelect(ifOtherProject, ifAnchorProjectId);
    ifNameInput.value = "";
    ifContentInput.value = "";
  }
  updateIfContentCount();
  ifNameInput.focus();
}
function closeInterfaceModal() { ifBackdrop.hidden = true; editingInterfaceId = null; ifAnchorProjectId = null; }

document.getElementById("docs-add-interface-btn").addEventListener("click", () => openInterfaceModal(null, docsProjectId));
document.getElementById("if-cancel").addEventListener("click", closeInterfaceModal);
document.getElementById("if-close").addEventListener("click", closeInterfaceModal);
ifBackdrop.addEventListener("click", (e) => { if (e.target === ifBackdrop) closeInterfaceModal(); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !ifBackdrop.hidden) closeInterfaceModal();
});
document.getElementById("if-submit").addEventListener("click", async () => {
  const name = ifNameInput.value.trim();
  if (!name) { ifNameInput.focus(); return; }
  const content = ifContentInput.value;
  try {
    if (editingInterfaceId) {
      await updateInterface(editingInterfaceId, name, content);
    } else {
      const otherId = ifOtherProject.value;
      if (!otherId || !ifAnchorProjectId) return;
      await addInterface(name, [ifAnchorProjectId, otherId], content);
    }
  } catch (err) {
    await showAlert(describeSaveError(err, [
      { label: "Name", value: name, max: 120 },
      { label: "Contract content", value: content, max: 20000 },
    ]));
    return;
  }
  closeInterfaceModal();
});

// ── VOICE DICTATION — New Item description, and (per a viewer request on
// the comment-modal-restyle ticket, "support the ability to record ... as
// we do with all the other fields") every comment box too: quick comment
// and the Edit item modal's own comment field. ──────────────────────────
// Same approach as the Claude Artifact Prototype Pipeline board: the Web
// Speech API runs entirely in the browser, feature-detected and hidden
// where unsupported. suggestType()/suggestCategory() (used only for the
// New Item field) are plain keyword heuristics — a starting point, not a
// final answer, same as manually picking the toggle/dropdown.
const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;

function autoGrow(el) {
  el.style.height = "auto";
  const max = Math.max(120, Math.round(window.innerHeight * 0.55));
  const next = Math.min(el.scrollHeight, max);
  el.style.height = next + "px";
  el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
}

function suggestType(text) {
  const t = (text || "").toLowerCase();
  const bugWords = ["bug", "broken", "doesn't work", "does not work", "crash", "error", "fail", "wrong", "glitch", "stuck", "not working", "issue"];
  return bugWords.some((w) => t.includes(w)) ? "bug" : "feature";
}

function suggestCategory(text) {
  const t = (text || "").toLowerCase();
  const rules = [
    { cat: "Pricing & Offers", words: ["price", "pricing", "rrp", "offer", "discount", "local override"] },
    { cat: "Product Assets", words: ["magic edit", "crop", "brush", "background removal", "remove background", "enhance", "asset", "video", "image", "photo"] },
    { cat: "Menu Board", words: ["menu board", "customer-facing", "tile", "hero", "featured highlight"] },
    { cat: "Retail Admin", words: ["retail admin", "store", "stock"] },
    { cat: "HQ Admin", words: ["hq admin", "grid", "table", "column", "settings", "scheduling", "targeting"] },
    { cat: "Backend / Infrastructure", words: ["cloud function", "backend", "firebase", "deploy", "server"] },
  ];
  for (const r of rules) { if (r.words.some((w) => t.includes(w))) return r.cat; }
  return "Uncategorised";
}

function setTypeToggle(type) {
  document.querySelectorAll(".type-opt").forEach((b) => b.classList.remove("active"));
  const btn = document.querySelector(`.type-opt[data-type="${type === "bug" ? "bug" : "feature"}"]`);
  if (btn) btn.classList.add("active");
}

// One instance of this per dictated field (New Item description, quick
// comment, Edit item comment) — each gets its own independent
// recognition/listening/stopRequested/silentRestartStreak state via this
// closure, instead of one shared set of module-level variables that only
// one field at a time could use. Behavior/comments below are otherwise
// unchanged from the original New-Item-only implementation.
// Plain inline SVG rather than the 🎤/⏹ emoji this used to show — emoji
// glyphs render as a different size/color/style per OS and font, which is
// what made the mic button look inconsistent with everything else in the
// app (and with the flat, monochrome stop-square most other AI products'
// own voice input uses, including Claude's — RydDfOtFBQocQMsGSdsb). A
// filled rounded square inside the button's own circular background (see
// .mic-btn.listening's red fill) reads the same way theirs does: an
// unambiguous "recording — tap to stop".
const MIC_ICON_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true" focusable="false"><path d="M12 15a3.5 3.5 0 0 0 3.5-3.5v-5a3.5 3.5 0 0 0-7 0v5A3.5 3.5 0 0 0 12 15z"/><path d="M18.5 11.5a1 1 0 0 0-2 0 4.5 4.5 0 0 1-9 0 1 1 0 0 0-2 0 6.5 6.5 0 0 0 5.5 6.42V20H9a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2h-2v-2.08a6.5 6.5 0 0 0 5.5-6.42z"/></svg>';
const STOP_ICON_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true" focusable="false"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>';

function createDictationController({ textareaEl, micBtn, hintEl, errorEl, onStop, charCountUpdate }) {
  let recognition = null;
  let listening = false;
  // Chrome/Android's SpeechRecognition ends itself after a few seconds of
  // silence even with continuous:true (surfaces as a "no-speech" error,
  // then "end") — that's the "mic cuts out after ~10s" behaviour.
  // stopRequested distinguishes that automatic, unwanted end from one the
  // user actually asked for (clicking the mic again, closing the form, or
  // submitting), so onend below knows whether to silently restart or
  // really stop.
  let stopRequested = false;
  // Counts consecutive auto-restarts (see onend below) that produced not
  // one onresult callback — i.e. the mic looks like it's listening but
  // nothing is ever actually being heard, as opposed to a normal pause
  // between sentences (which still restarts, but onresult fires again once
  // speech resumes and clears this back to 0). Without this, a genuinely
  // broken capture would restart silently forever with zero feedback,
  // which is worse than the old ~10s cutoff — at least that was visible.
  // After a few silent restarts in a row this gives up for real and says so.
  let silentRestartStreak = 0;

  function showError(msg) {
    if (!errorEl) return;
    if (!msg) { errorEl.textContent = ""; errorEl.classList.remove("on"); return; }
    errorEl.textContent = msg;
    errorEl.classList.add("on");
  }

  function startListening(isRestart) {
    if (!SpeechRecognitionCtor) return;
    if (listening && recognition) { try { recognition.stop(); } catch (err) {} }
    stopRequested = false;
    if (!isRestart) silentRestartStreak = 0;
    let baseline = textareaEl.value.trim();
    if (baseline) baseline += " ";
    recognition = new SpeechRecognitionCtor();
    recognition.lang = "en-US";
    // continuous:true is a known bad actor on Android Chrome — reported
    // live: speech gets tripled/repeated 10x over, then it dies anyway
    // around 10s. Android's continuous-mode implementation is documented
    // to redeliver or duplicate prior results across its own internal
    // keep-alive restarts, which then compounds with this file's own
    // baseline-carrying restart logic (baseline already has the old text,
    // and if the native results array ALSO still contains it, it doubles
    // up every cycle). continuous:false makes each session a single short
    // utterance with a clean, fresh results array every time — onend below
    // already restarts immediately after every session end regardless, so
    // dictation still reads as continuous to the user; it's just genuinely
    // fresh state underneath instead of relying on Android's own
    // long-running continuous handling.
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (e) => {
      // Any result at all — even an interim one — proves audio is
      // actually reaching the recognizer, so clear the "hearing nothing"
      // streak.
      silentRestartStreak = 0;
      let finalText = "", interimText = "";
      for (let i = 0; i < e.results.length; i++) {
        const chunk = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += chunk + " "; else interimText += chunk;
      }
      let next = (baseline + finalText + interimText).replace(/\s+/g, " ").replace(/^\s+/, "");
      // Native maxlength on the textarea stops typing/pasting past a
      // field's own bound (see firestore.rules), but assigning .value
      // straight from script — exactly what this line does — bypasses
      // maxlength entirely. Without this, dictating a long description ran
      // straight past 2000 characters with nothing visible until the
      // eventual Firestore write failed with a bare 403 permission-denied.
      // Only clamps when the field actually declares a maxlength, so this
      // never truncates an unbounded field.
      if (textareaEl.maxLength > 0 && next.length > textareaEl.maxLength) {
        next = next.slice(0, textareaEl.maxLength);
        showError(`Reached the ${textareaEl.maxLength}-character limit for this field.`);
      }
      textareaEl.value = next;
      autoGrow(textareaEl);
      if (charCountUpdate) charCountUpdate();
    };
    recognition.onerror = (e) => {
      const code = e && e.error;
      if (code === "not-allowed" || code === "service-not-allowed") {
        showError("Microphone access is blocked for this page — check your browser's site permissions and try again.");
        stopRequested = true;
      } else if (code === "audio-capture") {
        showError("No microphone could be accessed.");
        stopRequested = true;
      } else if (code === "network") {
        showError("Dictation needs an internet connection to convert speech to text — check your connection and try again.");
        stopRequested = true;
      } else if (code === "no-speech" || code === "aborted") {
        // Expected/transient, not a real failure: "no-speech" is exactly
        // the browser's own silence timeout (the "cuts out after ~10s"
        // report), and "aborted" fires when we stop it ourselves. Leave
        // stopRequested as-is so onend below restarts through a silence
        // and only really stops when the user (or closeForm/submit)
        // actually asked it to.
      } else if (code) {
        showError(`Dictation stopped (${code}) — you can keep typing instead.`);
        stopRequested = true;
      }
    };
    recognition.onend = () => {
      // Detach this now-finished instance's own handlers before doing
      // anything else. Both branches below end up calling something that
      // may call .stop() on this same (already-ended) instance again — the
      // restart branch's startListening() re-enters its own guard against
      // "already listening", and the stop branch's stopListening() calls
      // recognition.stop() unconditionally — and without this, that second
      // .stop() re-fires this exact onend closure while it's still on the
      // stack, which re-reads `recognition`/`stopRequested` mid-flight and
      // recurses (verified: an unguarded version of this spun into
      // thousands of recognition instances off a single simulated restart
      // in testing). Nulling the handlers first makes any such re-entrant
      // call inert.
      const finished = recognition;
      if (finished) { finished.onend = null; finished.onerror = null; finished.onresult = null; }
      if (stopRequested) { stopListening(); return; }
      silentRestartStreak++;
      if (silentRestartStreak >= 4) {
        // Several restarts in a row with not one word heard — this isn't a
        // normal pause between sentences (onresult would have cleared the
        // streak), it's the mic not actually being captured. Say so
        // instead of silently spinning forever.
        showError("Not picking up any speech from the microphone — check the mic is working and permitted, or just type instead.");
        stopListening();
        return;
      }
      // The browser ended this recognition session on its own (silence
      // timeout is the common case) but nobody asked to stop — restart
      // immediately so dictation feels continuous. textareaEl.value
      // already holds everything transcribed so far, and startListening()
      // re-reads it as the new baseline, so nothing is lost across the
      // restart.
      try { startListening(true); } catch (err) { stopListening(); }
    };
    listening = true;
    micBtn.classList.add("listening");
    micBtn.innerHTML = STOP_ICON_SVG; // unambiguous "tap to stop", not just a color change
    micBtn.title = "Stop dictation";
    micBtn.setAttribute("aria-label", "Stop dictation");
    if (hintEl) hintEl.classList.add("on");
    try { recognition.start(); } catch (err) {
      showError("Dictation didn't start — you can keep typing instead.");
      stopListening();
    }
  }

  function stopListening() {
    listening = false;
    stopRequested = false;
    micBtn.classList.remove("listening");
    micBtn.innerHTML = MIC_ICON_SVG;
    micBtn.title = "Dictate";
    micBtn.setAttribute("aria-label", "Dictate");
    if (hintEl) hintEl.classList.remove("on");
    if (recognition) { try { recognition.stop(); } catch (err) {} }
    if (onStop && textareaEl.value.trim()) onStop(textareaEl.value);
  }

  // Chrome won't reliably prompt for microphone permission from inside
  // SpeechRecognition alone — asking via getUserMedia first forces a real
  // permission prompt (or a real, specific error) before handing off.
  function requestMicAndListen() {
    showError("");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { startListening(); return; }
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      stream.getTracks().forEach((t) => t.stop());
      // Reported live on Android Chrome: the mic visibly starts
      // "listening" (button goes red/pulsing) but never transcribes a
      // word — consistent with SpeechRecognition silently failing to
      // (re-)open the microphone when it's asked to grab it again
      // immediately after this probe stream's tracks are stopped, before
      // the OS has actually released the hardware. A short delay here
      // gives that teardown time to finish before recognition.start()
      // tries to claim the mic itself.
      setTimeout(() => startListening(false), 250);
    }).catch((err) => {
      const name = err && err.name;
      let msg = "Microphone access didn't start — you can still type instead.";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        msg = "Microphone access is blocked for this page — check your browser's site permissions, then try again.";
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        msg = "No microphone was found on this device.";
      } else if (name === "SecurityError") {
        msg = "Microphone access needs a secure (https) page — it isn't available here.";
      }
      showError(msg);
    });
  }

  // A handle the field's own owner (e.g. the New Item form's closeForm())
  // can use to force dictation off and clear any error line without
  // reaching into this closure's private state directly.
  function stop() {
    if (listening) { stopRequested = true; try { recognition.stop(); } catch (err) {} }
  }

  if (!SpeechRecognitionCtor) {
    micBtn.hidden = true;
    showError("Dictation isn't supported in this browser — Chrome or Edge support it, or you can just type instead.");
    return { stop, clearError: () => showError("") };
  }
  micBtn.hidden = false;
  micBtn.innerHTML = MIC_ICON_SVG;
  micBtn.addEventListener("click", () => {
    if (listening) { stop(); return; }
    requestMicAndListen();
  });
  return { stop, clearError: () => showError("") };
}

const niDictation = createDictationController({
  textareaEl: document.getElementById("ni-desc-input"),
  micBtn: document.getElementById("ni-mic-btn"),
  hintEl: document.getElementById("ni-listening-hint"),
  errorEl: document.getElementById("ni-mic-error"),
  onStop: (text) => setTypeToggle(suggestType(text)),
  charCountUpdate: updateNiDescCount,
});
createDictationController({
  textareaEl: qcCommentInput,
  micBtn: document.getElementById("qc-mic-btn"),
  hintEl: document.getElementById("qc-listening-hint"),
  errorEl: document.getElementById("qc-mic-error"),
});
createDictationController({
  textareaEl: eiCommentInput,
  micBtn: document.getElementById("ei-mic-btn"),
  hintEl: document.getElementById("ei-listening-hint"),
  errorEl: document.getElementById("ei-mic-error"),
});
document.getElementById("ni-desc-input").addEventListener("input", (e) => {
  autoGrow(e.target);
});

// ── FAQ / Help Center admin ────────────────────────────────────────────
// Global, not per-project — the consumer-facing Help Center (repo root
// `faq/`, published via GitHub Pages) reads faqCategories/faqArticles
// straight from this same Firestore project, so saving here is what keeps
// that public page current. `projectId` on an article is optional and
// exists so a project's own feature work can eventually flag the FAQs
// that need updating when it ships (see backlog-tracker/README.md) — that
// automation isn't built yet, so "Needs review" here is a manual flag for
// now, same spirit as the rest of this app's prototype-stage features.
const faqCategoriesRef = collection(db, "faqCategories");
const faqArticlesRef = collection(db, "faqArticles");
const FAQ_PUBLIC_BASE_URL = "https://offline2online.github.io/rob_ph_demos/faq/";

let faqCategories = [];
let faqArticles = [];
let editingFaqArticleId = null; // null while adding, an id while editing
let faqSlugManuallyEdited = false;

function faqCategoryName(id) {
  const c = faqCategories.find((c) => c.id === id);
  return c ? c.name : "Uncategorised";
}

// The current icon is always included even if it falls outside
// FAQ_CATEGORY_ICONS — see that constant's own comment for why.
function faqCategoryIconOptionsHTML(selectedIcon) {
  const icons = (selectedIcon && !FAQ_CATEGORY_ICONS.includes(selectedIcon))
    ? [selectedIcon, ...FAQ_CATEGORY_ICONS]
    : FAQ_CATEGORY_ICONS;
  return icons.map((icon) =>
    `<option value="${escapeHTML(icon)}"${icon === selectedIcon ? " selected" : ""}>${escapeHTML(icon)}</option>`
  ).join("");
}

function slugify(s) {
  return String(s || "").trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Mirrors faq/js/faq-data.js's renderBodyMd exactly (kept as two small
// copies rather than a shared import, same isolation-by-design choice
// this repo already makes between backlog-tracker and menu-board-demo —
// the admin's "View live" preview and the public render must produce the
// same output, so if one changes, change the other too). Article bodies
// come in one of two shapes, told apart by a leading "<": legacy
// markdown-ish text (from before this editor existed) or real HTML from
// the rich-text (Quill) editor below. Real HTML is sanitized with
// DOMPurify before ever touching innerHTML — Firestore's write rules on
// faqArticles are wide open, so this field is never trusted just because
// it "should" have come through this editor.
// Mirrors faq/js/faq-data.js's own ALLOWED_IFRAME_HOSTS/installIframeAllowlist
// exactly — see that file's comment for why: without this, an iframe pasted
// straight into Firestore (faqArticles' write rules are wide open) could
// point at any host, since DOMPurify's default allowlist excludes iframe
// entirely and doesn't restrict `src` by domain for tags it does allow.
// Quill's built-in video format only ever normalizes a pasted link to a
// youtube.com/vimeo.com embed URL, so those are the only hosts this admin
// preview legitimately needs to render either.
const ALLOWED_IFRAME_HOSTS = ["www.youtube.com", "www.youtube-nocookie.com", "player.vimeo.com"];
let iframeAllowlistInstalled = false;
function installIframeAllowlist(purify) {
  if (iframeAllowlistInstalled) return;
  iframeAllowlistInstalled = true;
  purify.addHook("uponSanitizeElement", (node, data) => {
    if (data.tagName !== "iframe") return;
    let host = "";
    try { host = new URL(node.getAttribute("src") || "", window.location.href).hostname; } catch { host = ""; }
    if (!ALLOWED_IFRAME_HOSTS.includes(host)) node.remove();
  });
}

function renderFaqBodyMd(content) {
  const trimmed = (content || "").trim();
  if (trimmed.startsWith("<")) {
    if (!window.DOMPurify) return escapeHTML(trimmed);
    installIframeAllowlist(window.DOMPurify);
    return window.DOMPurify.sanitize(trimmed, { ADD_TAGS: ["iframe"], ADD_ATTR: ["allowfullscreen", "frameborder"] });
  }
  return renderLegacyFaqMarkdown(content);
}

function renderLegacyFaqMarkdown(md) {
  const lines = escapeHTML(md || "").split(/\r?\n/);
  let html = "";
  let inList = false;
  const closeList = () => { if (inList) { html += "</ul>"; inList = false; } };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { closeList(); continue; }
    if (line.startsWith("## ")) { closeList(); html += `<h3>${line.slice(3)}</h3>`; continue; }
    if (line.startsWith("- ")) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${line.slice(2).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")}</li>`;
      continue;
    }
    closeList();
    html += `<p>${line.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")}</p>`;
  }
  closeList();
  return html;
}

async function addFaqCategory(name, icon) {
  const order = faqCategories.length ? Math.max(...faqCategories.map((c) => c.order || 0)) + 1 : 0;
  await addDoc(faqCategoriesRef, {
    name: name.trim(), icon: (icon || "help").trim(), description: "", order,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
}

async function saveFaqCategory(id, name, icon, description) {
  await setDoc(doc(db, "faqCategories", id), {
    name: name.trim(), icon: (icon || "help").trim(), description: (description || "").trim(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

async function deleteFaqCategoryIfEmpty(id) {
  if (faqArticles.some((a) => a.categoryId === id)) {
    await showAlert("This category still has articles in it — move or delete those first.");
    return;
  }
  await deleteDoc(doc(db, "faqCategories", id));
}

async function moveFaqCategory(id, dir) {
  const idx = faqCategories.findIndex((c) => c.id === id);
  const swapIdx = idx + dir;
  if (idx < 0 || swapIdx < 0 || swapIdx >= faqCategories.length) return;
  const a = faqCategories[idx], b = faqCategories[swapIdx];
  await Promise.all([
    setDoc(doc(db, "faqCategories", a.id), { order: b.order || 0 }, { merge: true }),
    setDoc(doc(db, "faqCategories", b.id), { order: a.order || 0 }, { merge: true }),
  ]);
}

async function saveFaqArticle(id, data) {
  if (id) {
    await setDoc(doc(db, "faqArticles", id), { ...data, updatedAt: serverTimestamp() }, { merge: true });
  } else {
    const order = faqArticles.length ? Math.max(...faqArticles.map((a) => a.order || 0)) + 1 : 0;
    await addDoc(faqArticlesRef, { ...data, order, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  }
}

async function deleteFaqArticle(id) {
  await deleteDoc(doc(db, "faqArticles", id));
}

async function toggleFaqArticleStatus(id) {
  const a = faqArticles.find((a) => a.id === id);
  if (!a) return;
  const next = a.status === "published" ? "draft" : "published";
  await setDoc(doc(db, "faqArticles", id), {
    status: next, updatedAt: serverTimestamp(),
    ...(next === "published" ? { publishedAt: serverTimestamp() } : {}),
  }, { merge: true });
}

async function toggleFaqArticleReview(id) {
  const a = faqArticles.find((a) => a.id === id);
  if (!a) return;
  await setDoc(doc(db, "faqArticles", id), { needsReview: !a.needsReview, updatedAt: serverTimestamp() }, { merge: true });
}

onSnapshot(query(faqCategoriesRef, orderBy("order", "asc")), (snap) => {
  liveCollections.add("faqCategories");
  faqCategories = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (!faqSettingsPage.hidden) renderFaqSettingsPage();
  if (!faqArticlesPage.hidden) renderFaqArticlesPage();
}, (err) => {
  console.error("backlog-tracker: faqCategories listener error", err);
});

onSnapshot(query(faqArticlesRef, orderBy("order", "asc")), (snap) => {
  liveCollections.add("faqArticles");
  faqArticles = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  // Settings also shows each category's article count, so both pages
  // depend on this collection, not just the one named "articles."
  if (!faqSettingsPage.hidden) renderFaqSettingsPage();
  if (!faqArticlesPage.hidden) renderFaqArticlesPage();
}, (err) => {
  console.error("backlog-tracker: faqArticles listener error", err);
});

// Split into "Settings" (categories) and "FAQ Management" (articles) — two
// separate hamburger-menu destinations, each its own page — rather than
// one combined "FAQ Center" page.
const faqSettingsPage = document.getElementById("faq-settings-page");
const faqArticlesPage = document.getElementById("faq-articles-page");
const faCategorySelect = document.getElementById("fa-category-select");
const faProjectSelect = document.getElementById("fa-project-select");
// Reuses the same programs collection/helpers a project's own "Program/
// Product" grouping already uses (populateProgramSelect, createProgram,
// wireProgramSelect — see "Programs/Products" above) rather than inventing
// a second, parallel product/program taxonomy just for articles.
const faProgramSelect = document.getElementById("fa-program-select");
wireProgramSelect(faProgramSelect);
const faNewCategoryIconSelect = document.getElementById("fa-new-category-icon");
faNewCategoryIconSelect.innerHTML = faqCategoryIconOptionsHTML("help");

function openFaqSettingsPage() {
  closeAllSubPages();
  document.getElementById("projects-root").hidden = true;
  faqSettingsPage.hidden = false;
  renderFaqSettingsPage();
}
function closeFaqSettingsPage() {
  faqSettingsPage.hidden = true;
  document.getElementById("projects-root").hidden = false;
}

function openFaqArticlesPage() {
  closeAllSubPages();
  document.getElementById("projects-root").hidden = true;
  faqArticlesPage.hidden = false;
  renderFaqArticlesPage();
}
function closeFaqArticlesPage() {
  faqArticlesPage.hidden = true;
  document.getElementById("projects-root").hidden = false;
}

function renderFaqSettingsPage() {
  const catListEl = document.getElementById("faq-category-list");
  if (faqCategories.length === 0) {
    catListEl.innerHTML = '<p class="empty-hint">No categories yet — add one below.</p>';
  } else {
    catListEl.innerHTML = faqCategories.map((c, idx) => {
      const count = faqArticles.filter((a) => a.categoryId === c.id).length;
      return `
        <div class="faq-cat-row" data-id="${escapeHTML(c.id)}">
          <span class="material-symbols-outlined">${escapeHTML(c.icon || "help")}</span>
          <input type="text" class="faq-cat-name-input" value="${escapeHTML(c.name)}" aria-label="Category name">
          <div class="fa-icon-picker">
            <span class="material-symbols-outlined fa-icon-preview">${escapeHTML(c.icon || "help")}</span>
            <select class="faq-cat-icon-select" aria-label="Category icon">${faqCategoryIconOptionsHTML(c.icon || "help")}</select>
          </div>
          <input type="text" class="faq-cat-desc-input" value="${escapeHTML(c.description || "")}" placeholder="Short description" aria-label="Category description">
          <span class="faq-cat-count">${count} article${count === 1 ? "" : "s"}</span>
          <div class="faq-cat-actions">
            <button type="button" class="icon-btn faq-cat-up" ${idx === 0 ? "disabled" : ""} title="Move up">&uarr;</button>
            <button type="button" class="icon-btn faq-cat-down" ${idx === faqCategories.length - 1 ? "disabled" : ""} title="Move down">&darr;</button>
            <button type="button" class="icon-btn faq-cat-save" title="Save changes">&#10003;</button>
            <button type="button" class="icon-btn faq-cat-delete" title="Delete category">&#128465;</button>
          </div>
        </div>`;
    }).join("");
  }
}


// ── Categories and folders: the tree, and what it means ──────────────────
// A faqCategories document with no parentId is a top-level category. One
// WITH a parentId is a sub-category — a "folder" in help-centre language —
// living inside that category. Articles carry categoryId pointing at
// either level, so a sub-category is optional: an article filed straight
// into a category still shows there, which is how all 110 existing
// articles keep working without a migration.
//
// The tree itself is Product/Program -> Category -> Sub-category. Programs
// come from the articles (faqArticles.programId), so a category appears
// under whichever programs its articles belong to.
function faqOrderOf(d) { return Number.isFinite(Number(d && d.order)) ? Number(d.order) : 0; }
function byFaqOrder(a, b) { return faqOrderOf(a) - faqOrderOf(b) || String(a.name || a.title || "").localeCompare(String(b.name || b.title || "")); }

function faqTopCategories() { return faqCategories.filter((c) => !c.parentId).slice().sort(byFaqOrder); }
function faqSubCategories(parentId) { return faqCategories.filter((c) => c.parentId === parentId).slice().sort(byFaqOrder); }
function faqArticlesIn(categoryId) { return faqArticles.filter((a) => a.categoryId === categoryId).slice().sort(byFaqOrder); }
// A category's own articles plus everything in its sub-categories — what
// the counts in the tree show, so a collapsed category still tells you how
// much is under it.
function faqArticlesUnder(categoryId) {
  const subIds = faqSubCategories(categoryId).map((c) => c.id);
  return faqArticles.filter((a) => a.categoryId === categoryId || subIds.includes(a.categoryId));
}

// Which program a set of articles belongs to; "" is the catch-all for
// articles with no product/program assigned yet.
function faqProgramKeys() {
  const keys = new Set(faqArticles.map((a) => a.programId || ""));
  if (keys.size === 0) keys.add("");
  return [...keys].sort((a, b) => {
    if (!a) return 1;           // unassigned always last — it is a gap, not a product
    if (!b) return -1;
    return String(programName(a) || "").localeCompare(String(programName(b) || ""));
  });
}
function faqProgramLabel(key) {
  return key ? (programName(key) || "Unknown product/program") : "No product/program assigned";
}

// Selection + which branches are open. Both are view state, never written to
// Firestore: two people looking at the same board should be able to be in
// different folders.
let faqTreeSelection = null;          // { programKey, categoryId }
const faqTreeOpen = new Set();        // "prog:<key>" / "cat:<id>"

function faqTreeKeyOpen(key) { return faqTreeOpen.has(key); }
function toggleFaqTreeOpen(key) {
  if (faqTreeOpen.has(key)) faqTreeOpen.delete(key); else faqTreeOpen.add(key);
  renderFaqTree();
}

function faqCategoriesForProgram(programKey) {
  return faqTopCategories().filter((c) =>
    faqArticlesUnder(c.id).some((a) => (a.programId || "") === programKey));
}

function faqTreeRowHTML({ depth, icon, name, count, selected, open, dragKind, dragId, nodeAttrs, addLabel }) {
  const caret = open === undefined ? ""
    : `<span class="material-symbols-outlined faq-tree-caret">${open ? "expand_less" : "expand_more"}</span>`;
  const add = addLabel
    ? `<button type="button" class="faq-tree-add" data-add-sub="${escapeHTML(dragId)}" title="${escapeHTML(addLabel)}">+</button>`
    : "";
  return `<button type="button" class="faq-tree-row${selected ? " selected" : ""}" data-depth="${depth}"` +
    (dragKind ? ` draggable="true" data-drag-kind="${dragKind}" data-drag-id="${escapeHTML(dragId)}"` : "") +
    ` ${nodeAttrs}>` +
    `<span class="material-symbols-outlined faq-tree-icon">${escapeHTML(icon)}</span>` +
    `<span class="faq-tree-name">${escapeHTML(name)}</span>` +
    `<span class="faq-tree-count">${count}</span>${add}${caret}</button>`;
}

function renderFaqTree() {
  const root = document.getElementById("faq-tree");
  if (!root) return;
  const parts = [];
  for (const programKey of faqProgramKeys()) {
    const openKey = `prog:${programKey}`;
    const cats = faqCategoriesForProgram(programKey);
    const total = faqArticles.filter((a) => (a.programId || "") === programKey).length;
    const isOpen = faqTreeKeyOpen(openKey);
    parts.push('<div class="faq-tree-group">');
    parts.push(faqTreeRowHTML({
      depth: 0, icon: "inventory_2", name: faqProgramLabel(programKey),
      count: `${total} article${total === 1 ? "" : "s"}`, selected: false, open: isOpen,
      nodeAttrs: `data-node="program" data-program="${escapeHTML(programKey)}"`,
    }));
    if (isOpen) {
      for (const cat of cats) {
        const catOpenKey = `cat:${programKey}:${cat.id}`;
        const catOpen = faqTreeKeyOpen(catOpenKey);
        const subs = faqSubCategories(cat.id);
        const n = faqArticlesUnder(cat.id).filter((a) => (a.programId || "") === programKey).length;
        parts.push(faqTreeRowHTML({
          depth: 1, icon: "folder_copy", name: cat.name || "(untitled)",
          count: `${n}`, open: subs.length ? catOpen : undefined,
          selected: !!faqTreeSelection && faqTreeSelection.categoryId === cat.id && faqTreeSelection.programKey === programKey,
          dragKind: "category", dragId: cat.id,
          addLabel: "Add a sub-category here",
          nodeAttrs: `data-node="category" data-program="${escapeHTML(programKey)}" data-category="${escapeHTML(cat.id)}"`,
        }));
        if (catOpen) {
          for (const sub of subs) {
            const sn = faqArticlesIn(sub.id).filter((a) => (a.programId || "") === programKey).length;
            parts.push(faqTreeRowHTML({
              depth: 2, icon: "folder", name: sub.name || "(untitled)", count: `${sn}`,
              selected: !!faqTreeSelection && faqTreeSelection.categoryId === sub.id && faqTreeSelection.programKey === programKey,
              dragKind: "subcategory", dragId: sub.id,
              nodeAttrs: `data-node="category" data-program="${escapeHTML(programKey)}" data-category="${escapeHTML(sub.id)}"`,
            }));
          }
        }
      }
      if (cats.length === 0) {
        parts.push('<p class="empty-hint" style="margin:2px 0 6px 22px;">No articles in this product/program yet.</p>');
      }
    }
    parts.push("</div>");
  }
  root.innerHTML = parts.join("") || '<p class="empty-hint">No articles yet.</p>';
}

// ── The right-hand pane ──────────────────────────────────────────────────
function faqSelectedArticles() {
  if (!faqTreeSelection) return [];
  const { programKey, categoryId } = faqTreeSelection;
  return faqArticlesIn(categoryId).filter((a) => (a.programId || "") === programKey);
}

function renderFaqArticleList() {
  const listEl = document.getElementById("faq-article-list");
  const emptyEl = document.getElementById("faq-article-empty");
  const heading = document.getElementById("faq-articles-heading");
  if (!listEl) return;

  let list = faqSelectedArticles();
  const searchEl = document.getElementById("fa-tree-search");
  const q = (searchEl ? searchEl.value : "").trim().toLowerCase();
  if (q) {
    // Searching looks across everything, not just the open folder — when you
    // are hunting for an article you generally do not know which folder it
    // is in, which is the whole reason for searching.
    list = faqArticles.filter((a) =>
      (a.title || "").toLowerCase().includes(q) || (a.summary || "").toLowerCase().includes(q)).sort(byFaqOrder);
  }

  if (heading) {
    const cat = faqTreeSelection && faqCategories.find((c) => c.id === faqTreeSelection.categoryId);
    heading.textContent = q ? `Search results (${list.length})`
      : cat ? `${cat.name} (${list.length})` : "Articles";
  }
  if (list.length === 0) {
    listEl.innerHTML = "";
    emptyEl.hidden = false;
    emptyEl.textContent = q ? "No articles match that search."
      : faqTreeSelection ? "Nothing in this folder yet."
      : "Pick a category or folder on the left.";
    return;
  }
  emptyEl.hidden = true;
  // Only re-orderable when showing a real folder: dragging inside a search
  // result would be re-ordering a list that isn't a real sequence.
  listEl.innerHTML = list.map((a) => faqArticleRowHTML(a, !q)).join("");
}

// ── Re-ordering ──────────────────────────────────────────────────────────
// Always renumbers the FULL set of siblings 0..n-1, not just the rows on
// screen. The tree filters categories by program, so the visible rows can be
// a subset; renumbering only those would quietly reshuffle the ones hidden
// behind another program. Renumbering everything is both simpler and the
// only version that is actually correct.
async function applyFaqReorder(collectionName, siblings, draggedId, targetId, placeAfter) {
  const ids = siblings.map((d) => d.id);
  const from = ids.indexOf(draggedId);
  if (from < 0) return;
  ids.splice(from, 1);
  let to = ids.indexOf(targetId);
  if (to < 0) return;
  if (placeAfter) to += 1;
  ids.splice(to, 0, draggedId);

  const batch = writeBatch(db);
  ids.forEach((id, index) => {
    batch.update(doc(db, collectionName, id), { order: index, updatedAt: serverTimestamp() });
  });
  await batch.commit();
}

function faqSiblingsFor(kind, id) {
  if (kind === "category") return faqTopCategories();
  if (kind === "subcategory") {
    const sub = faqCategories.find((c) => c.id === id);
    return sub ? faqSubCategories(sub.parentId) : [];
  }
  const article = faqArticles.find((a) => a.id === id);
  return article ? faqArticlesIn(article.categoryId) : [];
}

// One delegated set of drag handlers for both panes — the rows are rebuilt
// on every render, so per-row listeners would have to be re-attached each
// time and would leak the ones belonging to rows that no longer exist.
let faqDrag = null;
function faqDraggableFrom(el) {
  const row = el && el.closest ? el.closest('[data-drag-kind], .faq-article-row[data-order-id]') : null;
  if (!row) return null;
  if (row.dataset.dragKind) return { kind: row.dataset.dragKind, id: row.dataset.dragId, row };
  return { kind: "article", id: row.dataset.orderId, row };
}
function clearFaqDropMarkers() {
  document.querySelectorAll(".faq-drop-before, .faq-drop-after")
    .forEach((el) => el.classList.remove("faq-drop-before", "faq-drop-after"));
}

document.addEventListener("dragstart", (e) => {
  const target = faqDraggableFrom(e.target);
  if (!target) return;
  faqDrag = target;
  target.row.classList.add("dragging");
  if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", target.id); }
});

document.addEventListener("dragover", (e) => {
  if (!faqDrag) return;
  const over = faqDraggableFrom(e.target);
  clearFaqDropMarkers();
  // Only ever drop onto a sibling of the same kind: this re-orders, it does
  // not re-file. Moving an article into a different folder is the editor's
  // Category field, which is explicit about what it changes.
  if (!over || over.kind !== faqDrag.kind || over.id === faqDrag.id) return;
  if (!faqSiblingsFor(faqDrag.kind, faqDrag.id).some((d) => d.id === over.id)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  const box = over.row.getBoundingClientRect();
  over.row.classList.add(e.clientY > box.top + box.height / 2 ? "faq-drop-after" : "faq-drop-before");
});

document.addEventListener("drop", async (e) => {
  if (!faqDrag) return;
  const over = faqDraggableFrom(e.target);
  const placeAfter = over && over.row.classList.contains("faq-drop-after");
  clearFaqDropMarkers();
  const dragged = faqDrag;
  faqDrag = null;
  dragged.row.classList.remove("dragging");
  if (!over || over.kind !== dragged.kind || over.id === dragged.id) return;
  const siblings = faqSiblingsFor(dragged.kind, dragged.id);
  if (!siblings.some((d) => d.id === over.id)) return;
  e.preventDefault();
  const collectionName = dragged.kind === "article" ? "faqArticles" : "faqCategories";
  try {
    await applyFaqReorder(collectionName, siblings, dragged.id, over.id, placeAfter);
  } catch (err) {
    await showAlert("Couldn't save that new order: " + (err && err.message ? err.message : err),
      { title: "Re-order failed" });
  }
});

document.addEventListener("dragend", () => {
  if (faqDrag) faqDrag.row.classList.remove("dragging");
  faqDrag = null;
  clearFaqDropMarkers();
});

// ── Tree interactions ────────────────────────────────────────────────────
document.addEventListener("click", async (e) => {
  const addBtn = e.target.closest("[data-add-sub]");
  if (addBtn) {
    e.stopPropagation();
    const parentId = addBtn.dataset.addSub;
    const name = ((await showPromptDialog("Name this sub-category", "", {
      title: "New sub-category", okLabel: "Create",
    })) || "").trim();
    if (!name) return;
    const siblings = faqSubCategories(parentId);
    await addDoc(faqCategoriesRef, {
      name, parentId, icon: "folder", description: "",
      order: siblings.length, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    faqTreeOpen.add(`cat:${faqTreeSelection ? faqTreeSelection.programKey : ""}:${parentId}`);
    return;
  }
  const row = e.target.closest(".faq-tree-row");
  if (!row) return;
  if (row.dataset.node === "program") {
    toggleFaqTreeOpen(`prog:${row.dataset.program}`);
    return;
  }
  if (row.dataset.node === "category") {
    const programKey = row.dataset.program;
    const categoryId = row.dataset.category;
    const already = faqTreeSelection && faqTreeSelection.categoryId === categoryId
      && faqTreeSelection.programKey === programKey;
    faqTreeSelection = { programKey, categoryId };
    // Selecting a category also opens it, so its folders appear; clicking an
    // already-selected one toggles, which is how a tree is expected to work.
    if (faqSubCategories(categoryId).length) {
      const key = `cat:${programKey}:${categoryId}`;
      if (already) { if (faqTreeOpen.has(key)) faqTreeOpen.delete(key); else faqTreeOpen.add(key); }
      else faqTreeOpen.add(key);
    }
    renderFaqTree();
    renderFaqArticleList();
  }
});

function renderFaqArticlesPage() {
  // The editor's Category select offers both levels, sub-categories indented
  // under their parent, so filing an article is one choice rather than two.
  const catOptionsHTML = faqTopCategories().map((c) => {
    const subs = faqSubCategories(c.id)
      .map((s) => `<option value="${escapeHTML(s.id)}">\u00a0\u00a0\u00a0\u2014 ${escapeHTML(s.name)}</option>`).join("");
    return `<option value="${escapeHTML(c.id)}">${escapeHTML(c.name)}</option>` + subs;
  }).join("");
  faCategorySelect.innerHTML = catOptionsHTML || '<option value="">Add a category first</option>';

  const prevProjVal = faProjectSelect.value;
  faProjectSelect.innerHTML = '<option value="">None — general article</option>' +
    projects.map((p) => `<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)}</option>`).join("");
  faProjectSelect.value = prevProjVal;

  // Land somewhere useful on first open rather than on an empty pane.
  if (!faqTreeSelection) {
    const firstProgram = faqProgramKeys()[0];
    const firstCat = firstProgram !== undefined ? faqCategoriesForProgram(firstProgram)[0] : null;
    if (firstProgram !== undefined) faqTreeOpen.add(`prog:${firstProgram}`);
    if (firstCat) faqTreeSelection = { programKey: firstProgram, categoryId: firstCat.id };
  }

  renderFaqTree();
  renderFaqArticleList();

  const publishedCount = faqArticles.filter((a) => a.status === "published").length;
  const draftCount = faqArticles.filter((a) => a.status === "draft").length;
  document.getElementById("faq-admin-count").textContent = `${publishedCount} published, ${draftCount} draft`;
}

// One row shape for the articles pane. `orderable` is false while a
// search is showing results from across every folder — dragging there
// would be re-ordering something that isn't a real sequence.
// Clicking the title itself opens the editor page (see
// wireFaqArticleRowInteractions below) — there's no separate "Edit" button
// in the primary row. Everything else that used to sit as its own button in
// the row now lives in one "⋮" options menu, same show/hide-one-at-a-time
// pattern as the per-project options menu (toggleOptionMenu/
// closeAllOptionMenus, extended below to also close an open
// .faq-article-options-menu).
function faqArticleRowHTML(a, orderable) {
  const liveUrl = `${FAQ_PUBLIC_BASE_URL}article.html?id=${encodeURIComponent(a.id)}`;
  const drag = orderable ? ` draggable="true" data-order-id="${escapeHTML(a.id)}"` : "";
  return `
      <div class="faq-article-row" data-id="${escapeHTML(a.id)}"${drag}>
        <div class="faq-article-row-main">
          <span class="badge badge-status-${a.status}">${a.status === "published" ? "Published" : "Draft"}</span>
          ${a.needsReview ? '<span class="badge badge-needs-review">Needs review</span>' : ""}
          <h4 class="faq-article-title" role="button" tabindex="0" title="Edit article">${escapeHTML(a.title)}</h4>
          <p class="faq-article-row-meta">${escapeHTML(faqCategoryName(a.categoryId))}${a.programId && programName(a.programId) ? " &middot; " + escapeHTML(programName(a.programId)) : ""}${a.projectId ? " &middot; " + escapeHTML(projectName(a.projectId)) : ""}</p>
        </div>
        <div class="faq-article-row-actions">
          <div class="faq-article-options">
            <button type="button" class="icon-btn faq-article-options-btn" aria-haspopup="true" aria-label="More options for this article">&#8942;</button>
            <div class="faq-article-options-menu" hidden>
              <button type="button" class="options-menu-item faq-article-edit">Edit article</button>
              <button type="button" class="options-menu-item faq-article-toggle-status">${a.status === "published" ? "Unpublish article" : "Publish article"}</button>
              <button type="button" class="options-menu-item faq-article-toggle-review">${a.needsReview ? "Clear flag" : "Flag"}</button>
              ${a.status === "published" ? `<a class="options-menu-item" href="${liveUrl}" target="_blank" rel="noopener">View live &#8599;</a>` : ""}
            </div>
          </div>
          <button type="button" class="icon-btn faq-article-delete" title="Delete">&#128465;</button>
        </div>
      </div>`;
}

// ── FAQ Management "Folders" view ────────────────────────────────────────
// Drills down Product/Program -> Category -> Articles instead of showing
// one flat, filtered list — see the backlog item this implements ("click
// Personalisation Hub, see its categories, click a category, see its
// articles"). Expand/collapse state is plain in-memory (not persisted) —
// there's no expectation this survives a reload, same as the List view's
// own filters don't either.
// Row actions for the articles pane. The tree pane has its own delegated
// handler (see renderFaqTree above); this one only deals with articles.
function wireFaqArticleRowInteractions(containerId) {
  const container = document.getElementById(containerId);
  container.addEventListener("click", async (e) => {
    const row = e.target.closest(".faq-article-row");
    if (!row) return;
    const id = row.dataset.id;
    const optionsBtn = e.target.closest(".faq-article-options-btn");
    if (optionsBtn) { toggleOptionMenu(optionsBtn); return; }
    if (e.target.closest(".faq-article-title") || e.target.closest(".faq-article-edit")) {
      closeAllOptionMenus();
      openFaqArticleEditorPage(id);
      return;
    }
    if (e.target.closest(".faq-article-toggle-status")) { closeAllOptionMenus(); toggleFaqArticleStatus(id); return; }
    if (e.target.closest(".faq-article-toggle-review")) { closeAllOptionMenus(); toggleFaqArticleReview(id); return; }
    if (e.target.closest(".faq-article-delete")) {
      if (await showConfirmDialog("Delete this article? This can't be undone.", { title: "Delete article", okLabel: "Delete", danger: true })) deleteFaqArticle(id);
    }
  });
  container.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const title = e.target.closest(".faq-article-title");
    if (!title) return;
    e.preventDefault();
    const row = title.closest(".faq-article-row");
    if (row) { closeAllOptionMenus(); openFaqArticleEditorPage(row.dataset.id); }
  });
}

document.getElementById("faq-settings-btn").addEventListener("click", () => { closeNavDrawer(); openFaqSettingsPage(); });
document.getElementById("faq-articles-btn").addEventListener("click", () => { closeNavDrawer(); openFaqArticlesPage(); });

document.getElementById("fa-new-category-submit").addEventListener("click", async () => {
  const nameEl = document.getElementById("fa-new-category-name");
  if (!nameEl.value.trim()) { nameEl.focus(); return; }
  await addFaqCategory(nameEl.value, faNewCategoryIconSelect.value);
  nameEl.value = "";
  faNewCategoryIconSelect.value = "help";
  document.getElementById("fa-new-category-icon-preview").textContent = "help";
});
faNewCategoryIconSelect.addEventListener("change", () => {
  document.getElementById("fa-new-category-icon-preview").textContent = faNewCategoryIconSelect.value;
});

document.getElementById("faq-category-list").addEventListener("click", (e) => {
  const row = e.target.closest(".faq-cat-row");
  if (!row) return;
  const id = row.dataset.id;
  if (e.target.closest(".faq-cat-up")) { moveFaqCategory(id, -1); return; }
  if (e.target.closest(".faq-cat-down")) { moveFaqCategory(id, 1); return; }
  if (e.target.closest(".faq-cat-save")) {
    saveFaqCategory(
      id,
      row.querySelector(".faq-cat-name-input").value,
      row.querySelector(".faq-cat-icon-select").value,
      row.querySelector(".faq-cat-desc-input").value,
    );
    return;
  }
  if (e.target.closest(".faq-cat-delete")) { deleteFaqCategoryIfEmpty(id); return; }
});
document.getElementById("faq-category-list").addEventListener("change", (e) => {
  const select = e.target.closest(".faq-cat-icon-select");
  if (!select) return;
  select.closest(".fa-icon-picker").querySelector(".fa-icon-preview").textContent = select.value;
});

document.getElementById("fa-tree-search").addEventListener("input", renderFaqArticleList);

// ── FAQ article editor page ──────────────────────────────────────────────
// A dedicated full-page editor, not a modal: the primary focus (title,
// summary, body) takes the full page, and everything else about an article
// (slug, category, doc type, linked project, keywords, status, needs
// review) lives in a slide-out panel from the right, hidden until the
// "Advanced settings" button is clicked. Replaces the old #fa-backdrop
// modal, which gave equal visual weight to a dozen fields most edits never
// touch.
const faqArticleEditorPage = document.getElementById("faq-article-editor-page");
const faAdvancedPanel = document.getElementById("fa-advanced-panel");
const faAdvancedBackdrop = document.getElementById("fa-advanced-backdrop");
const faTitleInput = document.getElementById("fa-title-input");
const faSlugInput = document.getElementById("fa-slug-input");
const faDocTypeSelect = document.getElementById("fa-doctype-select");
const faSummaryInput = document.getElementById("fa-summary-input");
const faKeywordsInput = document.getElementById("fa-keywords-input");
const faBodyViewer = document.getElementById("fa-body-viewer");
const faNeedsReview = document.getElementById("fa-needs-review");
let faStatus = "draft";

// ── Rich formatting the docs standard requires ───────────────────────
// docs/CONTRIBUTING-docs.md §5.4 mandates three things Quill 1.3.7's stock
// toolbar has no answer for: tables ("for comparing three or more things
// across two or more attributes"), code font for literal input/filenames/
// values, and the three callout levels (Note / Important / Warning). Until
// these existed, an article needing any of them either lost the formatting
// on save or was written as flat prose, which is exactly what the standard
// exists to prevent. Registered as real Quill blots (not raw HTML pasted
// into the body) so the content survives a later edit: an unregistered
// <table> or <div class="callout"> in the body is silently normalised away
// the first time Quill re-parses the DOM.
const FAQ_CALLOUT_LEVELS = ["note", "important", "warning"];

// A table's stored value is a plain array of rows (first row = header) so
// it round-trips through a Delta as JSON; the DOM shape it renders to is
// the same <div class="faq-table"><table>…</table></div> the public site's
// CSS styles, and the same shape DOMPurify passes through untouched.
function faqTableRowsToHtml(rows) {
  const safe = (s) => escapeHTML(String(s == null ? "" : s));
  const [head, ...body] = rows.length ? rows : [[""]];
  const headHtml = "<thead><tr>" + head.map((c) => "<th>" + safe(c) + "</th>").join("") + "</tr></thead>";
  const bodyHtml = body.length
    ? "<tbody>" + body.map((r) => "<tr>" + r.map((c) => "<td>" + safe(c) + "</td>").join("") + "</tr>").join("") + "</tbody>"
    : "";
  return "<table>" + headHtml + bodyHtml + "</table>";
}

function faqTableRowsFromNode(node) {
  return [...node.querySelectorAll("tr")].map((tr) =>
    [...tr.children].map((cell) => cell.textContent.trim())
  );
}

// Authoring format for the table dialog: one row per line, cells separated
// by "|", first line the header row. Chosen over an inline grid editor
// because it is editable, pasteable and diff-able as plain text, and it is
// the same shape a writer already uses in the markdown tables of
// docs/CONTRIBUTING-docs.md itself.
function faqTableRowsFromText(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^\|?\s*:?-{2,}/.test(line.replace(/\|/g, "")))
    .map((line) => line.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()));
}

function faqTableRowsToText(rows) {
  return rows.map((r) => r.join(" | ")).join("\n");
}

function registerFaqEditorFormats() {
  const Block = Quill.import("blots/block");
  const BlockEmbed = Quill.import("blots/block/embed");

  class FaqCalloutBlot extends Block {
    static create(value) {
      const level = FAQ_CALLOUT_LEVELS.includes(value) ? value : "note";
      const node = super.create();
      node.setAttribute("class", "callout callout-" + level);
      return node;
    }
    // Read back off the class rather than a data-* attribute: DOMPurify
    // keeps class by default but strips unknown data attributes, so an
    // article that has been through the sanitiser on its way to the
    // public site and back into this editor still knows its own level.
    static formats(node) {
      const match = /callout-(note|important|warning)/.exec(node.getAttribute("class") || "");
      return match ? match[1] : "note";
    }
  }
  FaqCalloutBlot.blotName = "callout";
  FaqCalloutBlot.tagName = "DIV";
  FaqCalloutBlot.className = "callout";

  class FaqTableBlot extends BlockEmbed {
    static create(value) {
      const node = super.create();
      node.setAttribute("class", "faq-table");
      // Atomic as far as Quill is concerned — cell text is edited through
      // the table dialog, not by typing into the DOM, which is what keeps
      // the <table> structurally intact through arbitrary editing around
      // it (Quill has no table model of its own in 1.x).
      node.setAttribute("contenteditable", "false");
      node.innerHTML = faqTableRowsToHtml(Array.isArray(value) ? value : faqTableRowsFromText(value));
      return node;
    }
    static value(node) {
      return faqTableRowsFromNode(node);
    }
  }
  FaqTableBlot.blotName = "faqtable";
  FaqTableBlot.tagName = "DIV";
  FaqTableBlot.className = "faq-table";

  Quill.register(FaqCalloutBlot, true);
  Quill.register(FaqTableBlot, true);

  const icons = Quill.import("ui/icons");
  icons.faqtable = '<svg viewBox="0 0 18 18"><rect class="ql-stroke" height="12" width="14" x="2" y="3"></rect><line class="ql-stroke" x1="2" x2="16" y1="7" y2="7"></line><line class="ql-stroke" x1="7" x2="7" y1="7" y2="15"></line></svg>';
}

// Insert or edit the table under the cursor. One dialog for both, so the
// author edits a table the same way they created it.
async function openFaqTableDialog() {
  const range = faQuill.getSelection(true);
  const [blot] = range ? faQuill.scroll.descendant(Quill.import("blots/block/embed"), range.index) : [null];
  const existing = blot && blot.statics.blotName === "faqtable" ? blot : null;
  const current = existing
    ? faqTableRowsToText(existing.statics.value(existing.domNode))
    : "Parameter | Value | Notes\nExample | value | what it does";
  const text = await showPromptDialog(
    "Table rows — one row per line, cells separated by \"|\". The first line is the header row.",
    current,
    { title: "Edit table", multiline: true, rows: 8 }
  );
  if (text === null) return;
  const rows = faqTableRowsFromText(text);
  if (!rows.length) return;
  if (existing) {
    const index = faQuill.getIndex(existing);
    faQuill.deleteText(index, 1, "user");
    faQuill.insertEmbed(index, "faqtable", rows, "user");
    faQuill.setSelection(index + 1, 0);
  } else {
    faQuill.insertEmbed(range.index, "faqtable", rows, "user");
    faQuill.setSelection(range.index + 1, 0);
  }
}

registerFaqEditorFormats();

// Rich-text body editor (Quill, loaded via CDN — see index.html <head>).
// One instance bound to #fa-body-editor for the life of the page, same as
// every other modal's inputs; openFaqArticleEditorPage() below resets its
// content on each open rather than recreating it. Toolbar covers headings
// (H1-H4 — docs/CONTRIBUTING-docs.md §3 stops at H4), bold/italic/
// underline/strike, alignment, ordered/bullet lists, blockquote, inline
// code and code blocks, the three callout levels, link, image (a URL
// prompt rather than letting Quill embed a base64 data URI, to stay well
// under Firestore's 1MiB document limit), video, tables, and a "clear
// formatting" button.
const faQuill = new Quill("#fa-body-editor", {
  theme: "snow",
  modules: {
    toolbar: {
      container: [
        [{ header: [1, 2, 3, 4, false] }],
        ["bold", "italic", "underline", "strike"],
        [{ align: [] }],
        [{ list: "ordered" }, { list: "bullet" }],
        ["blockquote", "code", "code-block"],
        [{ callout: FAQ_CALLOUT_LEVELS }],
        ["link", "image", "video", "faqtable"],
        ["clean"],
      ],
      handlers: {
        faqtable() {
          openFaqTableDialog();
        },
        // Quill's default image button embeds the file as a base64 data
        // URI — fine for a couple of small images, but a real photo or
        // two pushes an article well past Firestore's 1MiB document
        // limit. A plain URL prompt keeps images external (e.g. hosted
        // wherever this repo's other assets already live) at zero storage
        // cost here.
        //
        // Also prompts for alt text — docs/CONTRIBUTING-docs.md §6/§5.6
        // makes alt text mandatory on every informative image ("describes
        // the information, not the picture"), so this is captured at the
        // point of authoring rather than left to a later audit that would
        // likely never happen. An empty answer is stored as alt="" (a
        // deliberate "decorative image" per the same rule), not skipped.
        async image() {
          const result = await showFieldDialog({
            title: "Insert image",
            fields: [
              { id: "url", label: "Image URL", type: "url" },
              { id: "alt", label: "Alt text (describes the image's content for screen readers — leave blank only if it's purely decorative)" },
            ],
            okLabel: "Insert",
          });
          if (!result || !result.url) return;
          const { url, alt } = result;
          const range = faQuill.getSelection(true);
          faQuill.insertEmbed(range.index, "image", url, "user");
          faQuill.setSelection(range.index + 1);
          const img = faQuill.root.querySelector(`img[src="${CSS.escape(url)}"]:not([alt])`);
          if (img) img.setAttribute("alt", alt || "");
        },
      },
    },
  },
});

// A table is an atomic embed, so clicking one opens the same dialog that
// created it rather than dropping a caret into a cell Quill can't model.
faQuill.root.addEventListener("click", (event) => {
  const embed = event.target.closest(".faq-table");
  if (!embed) return;
  const blot = Quill.find(embed);
  if (!blot) return;
  faQuill.setSelection(faQuill.getIndex(blot), 1, "user");
  openFaqTableDialog();
});

// "Edit" shows the live Quill toolbar/editor; "View live" renders exactly
// what the public FAQ site would (same renderFaqBodyMd()/CSS classes),
// since Quill's own editing chrome doesn't look like the real article
// page. Replaces the old always-visible side-by-side textarea + preview.
function setFaBodyMode(mode) {
  const isView = mode === "view";
  document.getElementById("fa-body-mode-edit").classList.toggle("active", !isView);
  document.getElementById("fa-body-mode-view").classList.toggle("active", isView);
  document.getElementById("fa-body-editor-wrap").hidden = isView;
  faBodyViewer.hidden = !isView;
  if (isView) faBodyViewer.innerHTML = renderFaqBodyMd(faQuill.root.innerHTML);
}
document.getElementById("fa-body-mode-edit").addEventListener("click", () => setFaBodyMode("edit"));
document.getElementById("fa-body-mode-view").addEventListener("click", () => setFaBodyMode("view"));

function setFaStatusToggle(status) {
  faStatus = status;
  document.querySelectorAll("#faq-article-editor-page .type-opt").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.status === status);
  });
}

// The slide-out panel holding everything besides title/summary/body — see
// the comment above faqArticleEditorPage. Closed by default every time the
// editor opens (openFaqArticleEditorPage below), regardless of whether it
// was left open on a previous article.
function setFaAdvancedPanelOpen(open) {
  faAdvancedPanel.classList.toggle("open", open);
  faAdvancedPanel.setAttribute("aria-hidden", open ? "false" : "true");
  faAdvancedBackdrop.hidden = !open;
  document.getElementById("fa-advanced-toggle").setAttribute("aria-expanded", open ? "true" : "false");
}
document.getElementById("fa-advanced-toggle").addEventListener("click", () => setFaAdvancedPanelOpen(!faAdvancedPanel.classList.contains("open")));
document.getElementById("fa-advanced-close").addEventListener("click", () => setFaAdvancedPanelOpen(false));
// Click-outside-to-close, from the document rather than from the backdrop.
// The backdrop is pointer-events: none now (see styles.css): while the panel
// was open it covered the whole page including the editor's own Save button,
// so the first click on a plainly visible Save did nothing except dismiss the
// panel, and the article only saved on a second click. Same "the button did
// nothing" shape as the modal-scroll bug and the silent deployToFeature click
// before it. The dimming stays; only the click-swallowing goes.
document.addEventListener("click", (e) => {
  if (!faAdvancedPanel.classList.contains("open")) return;
  if (e.target.closest("#fa-advanced-panel, #fa-advanced-toggle")) return;
  setFaAdvancedPanelOpen(false);
});

function openFaqArticleEditorPage(articleId) {
  closeAllSubPages();
  editingFaqArticleId = articleId || null;
  faqSlugManuallyEdited = !!articleId;
  const article = articleId ? faqArticles.find((a) => a.id === articleId) : null;

  document.getElementById("fa-title").textContent = article ? "Edit article" : "New article";
  faTitleInput.value = article ? article.title : "";
  faSlugInput.value = article ? article.slug || "" : "";
  faSummaryInput.value = article ? article.summary || "" : "";
  faKeywordsInput.value = article ? (article.keywords || []).join(", ") : "";
  // Legacy (pre-editor) articles hold markdown-ish plain text, not HTML —
  // run those through the existing renderer once on load so they open
  // as properly formatted rich text; saving then upgrades that article to
  // real HTML in place. A brand-new article, or one already saved from
  // this editor, loads as-is (sanitized either way — see renderFaqBodyMd).
  faQuill.root.innerHTML = article ? renderFaqBodyMd(article.bodyMd || "") : "";
  faDocTypeSelect.value = article && article.docType ? article.docType : "faq";
  faNeedsReview.checked = article ? !!article.needsReview : false;
  setFaStatusToggle(article ? article.status : "draft");
  setFaBodyMode("edit");
  setFaAdvancedPanelOpen(false);

  if (faCategorySelect.options.length && faCategorySelect.options[0].value !== "") {
    faCategorySelect.value = article ? article.categoryId : faCategorySelect.options[0].value;
  }
  faProjectSelect.value = article && article.projectId ? article.projectId : "";
  populateProgramSelect(faProgramSelect, article && article.programId ? article.programId : "");

  const liveHint = document.getElementById("fa-live-link-hint");
  if (article && article.status === "published") {
    liveHint.hidden = false;
    liveHint.innerHTML = `Live at <a href="${FAQ_PUBLIC_BASE_URL}article.html?id=${encodeURIComponent(article.id)}" target="_blank" rel="noopener">${FAQ_PUBLIC_BASE_URL}article.html?id=${encodeURIComponent(article.id)}</a>`;
  } else {
    liveHint.hidden = true;
  }

  document.getElementById("projects-root").hidden = true;
  faqArticleEditorPage.hidden = false;
  faTitleInput.focus();
}
// Just hides the page — used by closeAllSubPages() (e.g. navigating away
// via the hamburger menu while mid-edit). Cancelling or saving instead call
// backToFaqArticleList() below, which actually returns to the list.
function closeFaqArticleEditorPage() {
  faqArticleEditorPage.hidden = true;
  document.getElementById("projects-root").hidden = false;
  setFaAdvancedPanelOpen(false);
}
function backToFaqArticleList() { openFaqArticlesPage(); }

document.getElementById("fa-new-article-btn").addEventListener("click", async () => {
  if (faqCategories.length === 0) { await showAlert("Add a category first."); return; }
  openFaqArticleEditorPage(null);
});
document.getElementById("fa-cancel").addEventListener("click", backToFaqArticleList);
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || faqArticleEditorPage.hidden) return;
  // Escape closes the slide-out panel first, same as it would any other
  // overlay — a second Escape (panel already closed) leaves the editor.
  if (faAdvancedPanel.classList.contains("open")) setFaAdvancedPanelOpen(false);
  else backToFaqArticleList();
});

document.querySelectorAll("#faq-article-editor-page .type-opt").forEach((btn) => {
  btn.addEventListener("click", () => setFaStatusToggle(btn.dataset.status));
});

faTitleInput.addEventListener("input", () => {
  if (!faqSlugManuallyEdited) faSlugInput.value = slugify(faTitleInput.value);
});
faSlugInput.addEventListener("input", () => { faqSlugManuallyEdited = true; });

document.getElementById("fa-submit").addEventListener("click", async () => {
  const title = faTitleInput.value.trim();
  const categoryId = faCategorySelect.value;
  if (!title) { faTitleInput.focus(); return; }
  if (!categoryId) { await showAlert("Add a category first."); return; }

  const data = {
    categoryId,
    projectId: faProjectSelect.value || null,
    programId: (faProgramSelect.value && faProgramSelect.value !== "__new__") ? faProgramSelect.value : null,
    title,
    slug: faSlugInput.value.trim() || slugify(title),
    summary: faSummaryInput.value.trim(),
    docType: faDocTypeSelect.value || "faq",
    bodyMd: faQuill.root.innerHTML,
    keywords: faKeywordsInput.value.split(",").map((k) => k.trim()).filter(Boolean),
    status: faStatus,
    needsReview: faNeedsReview.checked,
  };
  await saveFaqArticle(editingFaqArticleId, data);
  backToFaqArticleList();
});

wireFaqArticleRowInteractions("faq-article-list");
