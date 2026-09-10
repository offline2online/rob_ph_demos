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
  getFirestore, collection, addDoc, updateDoc, deleteDoc, setDoc, doc,
  onSnapshot, query, orderBy, serverTimestamp, writeBatch, arrayUnion,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const itemsRef = collection(db, "backlogItems");
const projectsRef = collection(db, "projects");
const interfacesRef = collection(db, "interfaces");
const deploymentsRef = collection(db, "deployments");
const programsRef = collection(db, "programs");
const projectDocsRef = collection(db, "projectDocs");

const COLUMNS = [
  { key: "backlog", label: "Backlog", headClass: "backlog" },
  { key: "ready-for-testing", label: "Ready for Testing", headClass: "testing" },
  { key: "ready-to-publish", label: "Feature Branch (Live)", headClass: "publish" },
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

let allItems = [];
let items = [];
let projects = [];
let projectsLoaded = false;
let interfaces = [];
let deployments = [];
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
// selection — which items a "Deploy to Feature" click should act on. Kept
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

// ── Deployments page state ─────────────────────────────────────────────
// A deployment groups several backlogItems meant to ship to main together
// — usually all fixed in one Notify Claude Routine fire, but can also be
// hand-picked from the board. Members carry a deploymentId pointing at a
// "deployments" doc; its "Notify Claude to merge" action only unlocks
// once every member has individually reached ready-to-publish (Live on
// Feature Branch), and just requests the same Notify Claude — Deploy flow
// scoped to that project — run-backlog-automation.js is what actually
// merges each PR and flips status, never this button directly.
let deploymentsProjectId = null;
let editingDeploymentId = null; // null while creating, an id while editing membership

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

// ── Left nav drawer (hamburger) — the header's own "Archived projects" and
// "FAQ Center" links moved in here, leaving only "+ New project" in the
// topbar. Kept in the DOM at all times (never [hidden]) so the CSS
// transform transition on .nav-drawer actually animates open/closed. ────
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
function returnToBoard() {
  closeArchivePage();
  closeArchivedProjectsPage();
  closeDeploymentsPage();
  closeDocsPage();
  closeFaqSettingsPage();
  closeFaqArticlesPage();
}
document.getElementById("nav-ph-console-btn").addEventListener("click", () => { closeNavDrawer(); returnToBoard(); });
// The logo/title in the top-left corner (a text placeholder until a real
// logo image ships) is clickable from anywhere in the app, same
// destination as the drawer's own "Agent console" home link above.
document.getElementById("topbar-logo-btn").addEventListener("click", () => { closeNavDrawer(); returnToBoard(); });

function cardHTML(item) {
  const idx = COL_KEYS.indexOf(item.status);
  const canLeft = idx > 0;
  const isTesting = item.status === "ready-for-testing";
  const isLiveBranch = item.status === "ready-to-publish";
  const isBacklog = item.status === "backlog";
  const canDelete = isBacklog;

  // Backlog cards select for "Ready for Dev"; Ready for Testing cards
  // (except noDeploymentRequired ones, which skip the feature-branch step
  // entirely) select for "Deploy to Feature" — two different pools, two
  // different checkbox classes/selection sets (see getSelectedSet vs.
  // getDeploySelectedSet). No other column gets a checkbox — nothing else
  // in the pipeline acts on a hand-picked subset.
  const pid = item.projectId || GENERAL_PROJECT_ID;
  const selectCb = isBacklog
    ? `<input type="checkbox" class="card-select-cb" data-id="${item.id}" data-project-id="${escapeHTML(pid)}" title="Select for Ready for Dev" ${getSelectedSet(pid).has(item.id) ? "checked" : ""}>`
    : (isTesting && !item.noDeploymentRequired
        ? `<input type="checkbox" class="card-deploy-select-cb" data-id="${item.id}" data-project-id="${escapeHTML(pid)}" title="Select for Deploy to Feature" ${getDeploySelectedSet(pid).has(item.id) ? "checked" : ""}>`
        : "");

  const leftBtn = canLeft
    ? `<button type="button" class="icon-btn move-btn" data-id="${item.id}" data-dir="-1" title="Move back">&larr;</button>`
    : "";
  const deleteBtn = canDelete
    ? `<button type="button" class="icon-btn delete-btn" data-id="${item.id}" title="Remove">&times;</button>`
    : "";
  // A card flagged noDeploymentRequired (see the Edit item modal) has no
  // code to push — e.g. a Firestore-only data/config change — so there's
  // nothing for "Feature Branch (Live)"/Deploy to Feature to gate. Once
  // tested it goes straight to published-live via confirmTestedNoDeploy(),
  // its own separate one-click path — it never enters the testPassed pool
  // at all.
  //
  // A normal item's "confirm tested" click does NOT advance the column by
  // itself (a single click used to move it straight to Feature Branch
  // (Live), which is exactly the behavior this replaced — one click testing
  // one item shouldn't silently put that item on the feature branch with no
  // chance to also confirm the others in the same batch). It only flags
  // testPassed and stays in Ready for Testing; advancing is the separate,
  // explicit "Deploy to Feature" project action below, which can act on
  // several passed items at once. Clicking again un-marks it (toggle), in
  // case it was flagged by mistake before "Deploy to Feature" is clicked.
  const approveBtn = isTesting
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
  const mergeBtn = isLiveBranch
    ? `<span class="merge-pending-hint" title="Only this project's own Deploy to Main button actually merges this to main">Waiting for Deploy to Main</span>`
    : "";
  const isPublished = item.status === "published-live";
  const archiveBtn = isPublished
    ? `<button type="button" class="icon-btn archive-btn" data-id="${item.id}" title="Archive">&#128451;</button>`
    : "";
  const canRight = idx < COL_KEYS.length - 1 && !isTesting && !isLiveBranch;
  const rightBtn = canRight
    ? `<button type="button" class="icon-btn move-btn" data-id="${item.id}" data-dir="1" title="Move forward">&rarr;</button>`
    : "";
  // Ties this card back to whichever other tickets are meant to ship
  // alongside it — see the Deployments page for the full group + progress.
  const deploymentBadge = item.deploymentId
    ? `<span class="deployment-badge" title="Ships together with the rest of this deployment">&#128640; ${escapeHTML(deploymentLabel(item.deploymentId))}</span>`
    : "";
  const noDeployBadge = item.noDeploymentRequired
    ? `<span class="no-deploy-badge" title="Live data/config change only — no code to push or deploy">No deployment required</span>`
    : "";
  const commentCount = (item.notes || []).length;
  const editBtn = `<button type="button" class="icon-btn edit-item-btn" data-id="${item.id}" title="Edit / comments">&#9998;${commentCount ? ` <span class="options-menu-count">${commentCount}</span>` : ""}</button>`;
  // Only relevant once a ticket is actually up on a feature branch — a
  // rawcdn.githack.com link (or a PR URL when the page can't be
  // rawcdn.githack'd directly) to click through and confirm before hitting
  // "Confirm live on branch". rawcdn.githack.com, not raw.githack.com —
  // the latter proxies through jsDelivr's CDN cache (up to ~7 days), so a
  // link set right after one push can keep showing that first commit even
  // after later pushes update the file, with no visible error.
  // rawcdn.githack.com is githack's own always-uncached host, meant
  // specifically for testing an in-progress branch like this one. Set/
  // changed via a plain prompt() rather than a full modal — this is a
  // one-off paste, not a form worth its own dialog.
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

  return `
    <article class="card" data-id="${item.id}">
      <div class="card-top">
        <div class="card-top-left">
          ${selectCb}
          <span class="badge badge-${item.type}">${item.type === "bug" ? "Bug" : "Feature"}</span>
        </div>
        <div class="card-move">${editBtn}${leftBtn}${rightBtn}</div>
      </div>
      <h3 class="card-title">${escapeHTML(item.title)}</h3>
      ${descHTML}
      ${deploymentBadge}${noDeployBadge}
      <div class="card-footer">
        <div class="card-footer-left">
          <span class="card-cat">${escapeHTML(item.category || "Uncategorised")}</span>
          <button type="button" class="icon-btn quick-comment-btn" data-id="${item.id}" title="Add a quick comment">&#128172;</button>
        </div>
        <div class="card-move">${archiveBtn}${deleteBtn}</div>
      </div>
      ${testLinkHTML}
      ${approveBtn}${mergeBtn}
    </article>`;
}

function archivedCountForProject(pid) {
  return allItems.filter((i) => (i.projectId || GENERAL_PROJECT_ID) === pid && i.status === "archived").length;
}

function backlogCountForProject(pid) {
  return items.filter((i) => (i.projectId || GENERAL_PROJECT_ID) === pid && i.status === "backlog").length;
}

function deployReadyCountForProject(pid) {
  return items.filter((i) => (i.projectId || GENERAL_PROJECT_ID) === pid && i.status === "ready-to-publish").length;
}

// Ready for Testing items an individual "Confirm tested" click has already
// flagged — the pool "Deploy to Feature" draws from. A noDeploymentRequired
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
  const deploymentCount = deploymentsForProject(pid).length;

  let html = `
    <button type="button" class="options-menu-item project-deployments-btn" data-project-id="${escapeHTML(pid)}">
      Deployments <span class="options-menu-count">${deploymentCount}</span>
    </button>
    <button type="button" class="options-menu-item project-archive-btn" data-project-id="${escapeHTML(pid)}">
      Archived tickets <span class="options-menu-count">${archivedCount}</span>
    </button>
    <button type="button" class="options-menu-item project-docs-btn${hasReq ? "" : " options-menu-item-empty"}" data-project-id="${escapeHTML(pid)}">
      ${hasReq ? "Requirements (MD file)" : "Requirements (MD file) — not set yet"}
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

// Same "Notify Claude" gradient action, but for the opposite end of the
// pipeline: items already tested and confirmed "Live on Feature Branch"
// (ready-to-publish) that are just waiting for someone to actually merge
// their PRs to main. Same hidden-when-nothing-to-do rule as the Backlog
// button above — there's nothing for this to do until a card reaches that
// column.
function deployNotifyButtonHTML(project) {
  const pid = project.id;
  const deployCount = deployReadyCountForProject(pid);
  if (!deployCount) return "";
  return `<button type="button" class="notify-claude-btn deploy-notify-btn" data-project-id="${escapeHTML(pid)}">
    <span class="material-symbols-outlined notify-claude-icon">rocket_launch</span>
    <span class="notify-claude-label">Deploy to Main</span>
    <span class="notify-claude-count-pill">${deployCount}</span>
  </button>`;
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
  const label = selectedCount ? `Deploy to Feature — ${selectedCount} selected` : "Deploy to Feature";
  return `<button type="button" class="notify-claude-btn deploy-to-feature-btn" data-project-id="${escapeHTML(pid)}">
    <span class="material-symbols-outlined notify-claude-icon">merge_type</span>
    <span class="notify-claude-label">${label}</span>
    <span class="notify-claude-count-pill">${selectedCount || passedCount}</span>
  </button>`;
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
    // Dev" acts on) and Ready for Testing (what "Deploy to Feature" acts
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
    return `<section class="column" data-col="${col.key}">
      <div class="col-head col-head-${col.headClass}"><span>${selectAllHTML}${col.label}</span><span class="col-count">${listItems.length}</span></div>
      <div class="col-list" id="${colListId(project.id, col.key)}" data-col="${col.key}" data-project-id="${escapeHTML(project.id)}">
        ${listItems.length ? listItems.map(cardHTML).join("") : '<div class="empty-hint">No items yet</div>'}
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
  const groups = programs
    .filter((p) => byProgramId.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ id: p.id, name: p.name, projects: byProgramId.get(p.id) }));
  const ungrouped = byProgramId.get(null) || [];
  if (ungrouped.length) groups.push({ id: null, name: "Ungrouped", projects: ungrouped });
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
// load, five independent onSnapshot listeners below (items, projects,
// interfaces, deployments, programs) each call render() the moment their
// own first snapshot arrives — without this, that meant up to five full
// innerHTML rebuilds of the entire board (every project, every column,
// every card) in quick succession before things settled, which is real,
// wasted work on every page load, worse on a slower/lower-power device.
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
  document.getElementById("projects-root").innerHTML = programs.length
    ? groupProjectsByProgram(renderedProjects).map(programGroupHTML).join("")
    : renderedProjects.map(projectSectionHTML).join("");

  const total = items.filter((i) => COL_KEYS.includes(i.status)).length;
  document.getElementById("total-summary").textContent =
    `${total} item${total === 1 ? "" : "s"} across ${renderedProjects.length} project${renderedProjects.length === 1 ? "" : "s"}`;

  if (editingProjectId) {
    const input = document.getElementById(`pname-input-${editingProjectId}`);
    if (input) { input.focus(); input.select(); }
  }

  ensureGeneralProjectDoc(renderedProjects);
}

onSnapshot(query(itemsRef, orderBy("createdAt", "desc")), (snap) => {
  allItems = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  items = allItems.filter((i) => i.status !== "archived");
  render();
  if (archiveProjectId) renderArchivePage();
  if (archivedProjectsPage && !archivedProjectsPage.hidden) renderArchivedProjectsPage();
  if (deploymentsProjectId) renderDeploymentsPage();
  if (editingItemId) renderEiNotes();
}, (err) => {
  console.error("backlog-tracker: items listener error", err);
});

onSnapshot(query(projectsRef, orderBy("createdAt", "asc")), (snap) => {
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
  interfaces = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  render();
  if (docsProjectId) renderDocsPage();
}, (err) => {
  console.error("backlog-tracker: interfaces listener error", err);
});

onSnapshot(deploymentsRef, (snap) => {
  deployments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  render();
  if (deploymentsProjectId) renderDeploymentsPage();
}, (err) => {
  console.error("backlog-tracker: deployments listener error", err);
});

onSnapshot(programsRef, (snap) => {
  programs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  render();
  if (docsProjectId) renderDocsPage();
}, (err) => {
  console.error("backlog-tracker: programs listener error", err);
});

onSnapshot(projectDocsRef, (snap) => {
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
  // The only way this can land a card back in Ready for Testing is the
  // left-arrow "move back" from Feature Branch (Live) — sending it back for
  // more work. Clear a stale testPassed from its previous round: otherwise
  // it would already look "passed" again with nobody having actually
  // re-confirmed the new round of work, and the next "Deploy to Feature"
  // click could sweep it back onto the feature branch unreviewed.
  if (COL_KEYS[next] === "ready-for-testing") {
    fields.testPassed = false;
  }
  await updateDoc(doc(db, "backlogItems", id), fields);
}

// Per-card toggle in Ready for Testing — flags (or un-flags) testPassed
// without moving the card. Deliberately does NOT advance status itself
// (that used to be exactly what this button did, one card at a time, which
// was the actual complaint this replaced — see cardHTML's own comment).
// Advancing is the separate, explicit, batchable "Deploy to Feature"
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
// No confirmation alert() here anymore — the Notify Claude button itself
// now shows a persistent working/spinner state (see notifyClaudeButtonHTML)
// once projects/{id}.notifyRoutine reflects the click, which is a better
// signal than a one-time dismissable dialog ever was.
async function requestNotify(pid) {
  const count = backlogCountForProject(pid);
  if (count === 0) {
    alert("Nothing in Backlog for this project yet — add an item first.");
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
// (Feature Branch (Live)) in one Firestore batch write. Unlike
// requestNotify/requestDeployNotify above and below, this never touches the
// Routine — the feature branch and PR already exist from the Backlog stage
// (see run-backlog-automation.js's processApplyPatch), so there's no GitHub
// action to take here, only the board's own status to advance once a human
// has actually confirmed testing on the items they're choosing to release.
async function deployToFeature(pid) {
  const passedIds = new Set(
    items
      .filter((i) => (i.projectId || GENERAL_PROJECT_ID) === pid && i.status === "ready-for-testing" && i.testPassed && !i.noDeploymentRequired)
      .map((i) => i.id)
  );
  if (passedIds.size === 0) {
    alert("Nothing has passed testing for this project yet — confirm an item's testing first.");
    return;
  }
  // Same "a non-empty selection narrows the action" pattern as
  // requestNotify — an empty selection means "every passed item", not
  // "nothing".
  const selected = [...getDeploySelectedSet(pid)].filter((id) => passedIds.has(id));
  const idsToMove = selected.length ? selected : [...passedIds];

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

// Same idea as requestNotify() above, but for the "Live on Feature Branch"
// (ready-to-publish) column — a deploy request, not an investigate-and-fix
// request. Writes deployNotifyRequestedAt, watched by
// notifyOnProjectReadyToDeploy (see ../functions/index.js), which fires the
// same Routine but with fire text that explicitly says these items are
// already tested and just need their PRs merged to main.
async function requestDeployNotify(pid) {
  const count = deployReadyCountForProject(pid);
  if (count === 0) {
    alert("Nothing in Feature Branch (Live) for this project yet — confirm an item's testing first.");
    return;
  }
  await setDoc(doc(db, "projects", pid), { deployNotifyRequestedAt: serverTimestamp() }, { merge: true });
  alert(`Deploy requested for ${count} item${count === 1 ? "" : "s"} in Feature Branch (Live). A Claude Code session starts merging them to main (see backlog-tracker/README.md for the Cloud Functions this depends on if this isn't happening).`);
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

// ── Deployments — grouping several backlogItems to ship to main together ──
function deploymentsForProject(pid) {
  return deployments.filter((d) => d.projectId === pid);
}
function itemsForDeployment(deploymentId) {
  return allItems.filter((i) => i.deploymentId === deploymentId && i.status !== "archived");
}
function deploymentLabel(deploymentId) {
  const d = deployments.find((d) => d.id === deploymentId);
  return d ? d.label : "";
}
// Grouping candidates: anything actually in flight, not already spoken for
// by another deployment, and not yet done — a project's whole point is
// "ship these together," so a card already merged/archived, or already in
// a different group, doesn't belong in the picker for a new one.
function groupableItemsForProject(pid) {
  return items.filter((i) =>
    (i.projectId || GENERAL_PROJECT_ID) === pid &&
    i.status !== "published-live" &&
    !i.deploymentId
  );
}

async function createDeployment(projectId, label, itemIds) {
  const trimmed = (label || "").trim();
  if (!trimmed || itemIds.length === 0) return;
  const ref = await addDoc(deploymentsRef, {
    projectId, label: trimmed, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  const batch = writeBatch(db);
  itemIds.forEach((id) => batch.update(doc(db, "backlogItems", id), { deploymentId: ref.id }));
  await batch.commit();
}

async function renameDeployment(id, label) {
  const trimmed = (label || "").trim();
  if (!trimmed) return;
  await setDoc(doc(db, "deployments", id), { label: trimmed, updatedAt: serverTimestamp() }, { merge: true });
}

// Add/remove membership in one call so the edit modal's Save button is a
// single round trip regardless of how many checkboxes changed.
async function setDeploymentMembership(deploymentId, addIds, removeIds) {
  const batch = writeBatch(db);
  addIds.forEach((id) => batch.update(doc(db, "backlogItems", id), { deploymentId }));
  removeIds.forEach((id) => batch.update(doc(db, "backlogItems", id), { deploymentId: null }));
  await batch.commit();
}

// Deleting a group is just ungrouping — its tickets aren't touched beyond
// clearing the link back to it, never deleted or moved.
async function deleteDeployment(id) {
  const memberIds = itemsForDeployment(id).map((i) => i.id);
  const batch = writeBatch(db);
  memberIds.forEach((itemId) => batch.update(doc(db, "backlogItems", itemId), { deploymentId: null }));
  batch.delete(doc(db, "deployments", id));
  await batch.commit();
}

// Once every member has individually been confirmed "Live on Feature
// Branch" (ready-to-publish — the same "someone actually tested it" gate
// a single card's own "Confirm live on branch" button already enforces),
// this used to flip them all straight to published-live in one Firestore
// write — board bookkeeping only, since it never touched the underlying
// GitHub PRs. That let a whole deployment group show "Merged to Main"
// while every one of its PRs sat open and unmerged. It now does the same
// thing a single card's removed "Merge to main" button used to do wrong:
// request the project's real Notify Claude — Deploy flow instead, which
// only advances a card once backlog-automation.yml has actually merged
// its PR. `isMerged` below is derived from real member status, not a
// separate stored flag, so the deployment card's own "Merged" badge only
// ever reflects reality.
async function requestDeploymentMerge(id) {
  const members = itemsForDeployment(id);
  if (members.length === 0 || !members.every((i) => i.status === "ready-to-publish")) return;
  await requestDeployNotify(members[0].projectId || GENERAL_PROJECT_ID);
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
projectsRoot.addEventListener("click", (e) => {
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
  if (quickCommentBtn) { openQuickCommentModal(quickCommentBtn.dataset.id); return; }
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
    const url = prompt("Preview/test URL for this ticket (e.g. a rawcdn.githack.com link, or the PR URL):", defaultValue);
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
  const deploymentsNavBtn = e.target.closest(".project-deployments-btn");
  if (deploymentsNavBtn) { closeAllOptionMenus(); openDeploymentsPage(deploymentsNavBtn.dataset.projectId); return; }
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
    if (confirm(warning)) archiveProject(pid);
    return;
  }
  const optionsBtn = e.target.closest(".project-options-btn");
  if (optionsBtn) { toggleOptionMenu(optionsBtn); return; }
  // Any other click inside the board closes an open options menu — the
  // options-btn case above already returned, so reaching here means the
  // click landed elsewhere (a card, a column, empty space).
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

function openEditItemModal(id) {
  editingItemId = id;
  const item = allItems.find((i) => i.id === id);
  if (!item) return;
  eiTitleInput.value = item.title || "";
  eiDescInput.value = item.desc || "";
  setEiTypeToggle(item.type === "bug" ? "bug" : "feature");
  eiCategorySelect.value = item.category || CATEGORIES[0];
  eiNoDeployCheckbox.checked = !!item.noDeploymentRequired;
  eiCommentInput.value = "";
  renderEiNotes();
  eiBackdrop.hidden = false;
  eiTitleInput.focus();
}
function closeEditItemModal() {
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
document.getElementById("ei-save").addEventListener("click", () => {
  if (!editingItemId) return;
  if (!eiTitleInput.value.trim()) { alert("Title can't be empty."); return; }
  const type = document.querySelector("#ei-backdrop .type-opt.active")?.dataset.type || "feature";
  updateItemDetails(editingItemId, {
    title: eiTitleInput.value, desc: eiDescInput.value, type, category: eiCategorySelect.value,
    noDeploymentRequired: eiNoDeployCheckbox.checked,
  });
  closeEditItemModal();
});
document.getElementById("ei-comment-submit").addEventListener("click", () => {
  if (!editingItemId) return;
  const text = eiCommentInput.value;
  if (!text.trim()) return;
  addItemComment(editingItemId, text);
  eiCommentInput.value = "";
});

// ── Quick comment modal — comment-only, reached from the card's own small
// icon (bottom row, next to the category badge) instead of the pencil icon
// that opens the full Edit item modal above. Same addItemComment() write,
// just without pulling in title/desc/type/category editing at all.
let quickCommentItemId = null;
const qcBackdrop = document.getElementById("qc-backdrop");
const qcCommentInput = document.getElementById("qc-comment-input");

function openQuickCommentModal(id) {
  quickCommentItemId = id;
  qcCommentInput.value = "";
  qcBackdrop.hidden = false;
  qcCommentInput.focus();
}
function closeQuickCommentModal() {
  qcBackdrop.hidden = true;
  quickCommentItemId = null;
}
document.getElementById("qc-close").addEventListener("click", closeQuickCommentModal);
document.getElementById("qc-cancel").addEventListener("click", closeQuickCommentModal);
qcBackdrop.addEventListener("click", (e) => { if (e.target === qcBackdrop) closeQuickCommentModal(); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !qcBackdrop.hidden) closeQuickCommentModal();
});
document.getElementById("qc-submit").addEventListener("click", () => {
  if (!quickCommentItemId) return;
  const text = qcCommentInput.value;
  if (!text.trim()) return;
  addItemComment(quickCommentItemId, text);
  closeQuickCommentModal();
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

const TITLE_MAX = 70;
function generateTitle(desc) {
  const text = (desc || "").trim().replace(/\s+/g, " ");
  if (text.length <= TITLE_MAX) return text;
  const cut = text.slice(0, TITLE_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut) + "…";
}

function openForm(projectId) {
  activeNewItemProjectId = projectId;
  niBackdrop.hidden = false;
  document.getElementById("ni-desc-input").focus();
}
function closeForm() {
  niBackdrop.hidden = true;
  activeNewItemProjectId = null;
  if (listening) { stopRequested = true; try { recognition.stop(); } catch (err) {} }
  const descEl = document.getElementById("ni-desc-input");
  descEl.value = "";
  descEl.style.height = "";
  document.querySelectorAll(".type-opt").forEach((b) => b.classList.remove("active"));
  document.querySelector('.type-opt[data-type="feature"]').classList.add("active");
  showMicError("");
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
  await addItem(activeNewItemProjectId, title, desc, type, category);
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
    const name = (prompt("New program/product name:") || "").trim();
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

function openProjectModal() {
  npBackdrop.hidden = false;
  document.getElementById("np-name-input").value = "";
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
  await addProject(name, programId);
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

document.getElementById("archived-projects-btn").addEventListener("click", () => { closeNavDrawer(); openArchivedProjectsPage(); });
document.getElementById("archived-projects-table-body").addEventListener("click", (e) => {
  const btn = e.target.closest(".restore-project-btn");
  if (btn) restoreProject(btn.dataset.projectId);
});

// ── Deployments page (per-project — grouping tickets meant to ship together,
// with a progress checklist and a "Notify Claude to merge" action that only
// unlocks once every member is individually confirmed Live on Feature
// Branch) ──────────────────────────────────────────────────────────────
const deploymentsPage = document.getElementById("deployments-page");

function openDeploymentsPage(pid) {
  deploymentsProjectId = pid;
  document.getElementById("projects-root").hidden = true;
  deploymentsPage.hidden = false;
  renderDeploymentsPage();
}
function closeDeploymentsPage() {
  deploymentsProjectId = null;
  deploymentsPage.hidden = true;
  document.getElementById("projects-root").hidden = false;
}

function columnLabel(statusKey) {
  const col = COLUMNS.find((c) => c.key === statusKey);
  return col ? col.label : statusKey;
}

function deploymentMemberRowHTML(item) {
  return `<li class="deployment-member">
    <span class="deployment-member-title">${escapeHTML(item.title)}</span>
    <span class="deployment-member-status">${escapeHTML(columnLabel(item.status))}</span>
  </li>`;
}

function deploymentRowHTML(dep) {
  const members = itemsForDeployment(dep.id);
  const confirmedCount = members.filter((i) => i.status === "ready-to-publish" || i.status === "published-live").length;
  const allReady = members.length > 0 && members.every((i) => i.status === "ready-to-publish");
  // Derived from the members' own real status, not a separate stored
  // flag — this badge only ever reflects an actual completed merge (see
  // requestDeploymentMerge's own comment for why that matters here).
  const isMerged = members.length > 0 && members.every((i) => i.status === "published-live");

  const actionHTML = isMerged
    ? `<span class="deployment-merged-badge">&#10003; Merged</span>`
    : `<button type="button" class="btn-primary deployment-merge-btn" data-id="${dep.id}" ${allReady ? "" : "disabled"}>Notify Claude to merge</button>`;

  return `
    <div class="deployment-card" data-id="${dep.id}">
      <div class="deployment-card-header">
        <h3>${escapeHTML(dep.label)}</h3>
        <div class="deployment-card-actions">
          <button type="button" class="icon-btn deployment-edit-btn" data-id="${dep.id}" title="Edit">&#9998;</button>
          <button type="button" class="icon-btn deployment-delete-btn" data-id="${dep.id}" title="Ungroup">&times;</button>
        </div>
      </div>
      <p class="deployment-progress">${confirmedCount}/${members.length} confirmed Feature Branch (Live)</p>
      <ul class="deployment-member-list">${members.map(deploymentMemberRowHTML).join("") || '<li class="deployment-member-empty">No tickets in this group.</li>'}</ul>
      ${actionHTML}
    </div>`;
}

function renderDeploymentsPage() {
  if (!deploymentsProjectId) return;
  document.getElementById("deployments-page-project-name").textContent = projectName(deploymentsProjectId);
  const rows = deploymentsForProject(deploymentsProjectId);
  document.getElementById("deployments-list").innerHTML = rows.length
    ? rows.map(deploymentRowHTML).join("")
    : '<p class="interface-row-empty">No deployments grouped yet — use "+ New deployment" to link tickets that should ship together.</p>';
}

document.getElementById("deployments-add-btn").addEventListener("click", () => openDeploymentModal(null));
document.getElementById("deployments-list").addEventListener("click", (e) => {
  const mergeBtn = e.target.closest(".deployment-merge-btn");
  if (mergeBtn && !mergeBtn.disabled) { requestDeploymentMerge(mergeBtn.dataset.id); return; }
  const editBtn = e.target.closest(".deployment-edit-btn");
  if (editBtn) { openDeploymentModal(editBtn.dataset.id); return; }
  const delBtn = e.target.closest(".deployment-delete-btn");
  if (delBtn) {
    if (confirm("Ungroup this deployment? Its tickets stay exactly as they are, just no longer linked together.")) {
      deleteDeployment(delBtn.dataset.id);
    }
  }
});

// ── Deployment create/edit modal — shared by "+ New deployment" and each
// group's own edit icon; Save renames (if needed) and reconciles
// membership in one round trip regardless of what changed. ─────────────
const dpBackdrop = document.getElementById("dp-backdrop");
const dpLabelInput = document.getElementById("dp-label-input");
const dpItemsList = document.getElementById("dp-items-list");

function openDeploymentModal(deploymentId) {
  editingDeploymentId = deploymentId;
  const dep = deploymentId ? deployments.find((d) => d.id === deploymentId) : null;
  document.getElementById("dp-title").textContent = dep ? "Edit deployment" : "New deployment";
  dpLabelInput.value = dep ? dep.label : `Deploy #${deploymentsForProject(deploymentsProjectId).length + 1}`;

  const currentMembers = dep ? itemsForDeployment(dep.id) : [];
  const currentMemberIds = currentMembers.map((i) => i.id);
  // Eligible = groupable tickets in this project, plus whatever's already
  // in this group (so editing a group never silently drops a member just
  // because some other field changed underneath it).
  const eligible = groupableItemsForProject(deploymentsProjectId)
    .concat(currentMembers)
    .filter((item, idx, arr) => arr.findIndex((i) => i.id === item.id) === idx);

  dpItemsList.innerHTML = eligible.length
    ? eligible.map((item) => `
        <label class="dp-item-row">
          <input type="checkbox" class="dp-item-checkbox" value="${escapeHTML(item.id)}" ${currentMemberIds.includes(item.id) ? "checked" : ""}>
          <span>${escapeHTML(item.title)} <span class="options-menu-sub">(${escapeHTML(columnLabel(item.status))})</span></span>
        </label>`).join("")
    : '<p class="interface-row-empty">No eligible tickets — everything in this project is either already Merged to Main or already in another deployment.</p>';

  dpBackdrop.hidden = false;
  dpLabelInput.focus();
}
function closeDeploymentModal() {
  dpBackdrop.hidden = true;
  editingDeploymentId = null;
}

document.getElementById("dp-close").addEventListener("click", closeDeploymentModal);
document.getElementById("dp-cancel").addEventListener("click", closeDeploymentModal);
document.getElementById("dp-submit").addEventListener("click", async () => {
  const label = dpLabelInput.value;
  const checked = Array.from(dpItemsList.querySelectorAll(".dp-item-checkbox:checked")).map((c) => c.value);
  if (!label.trim() || checked.length === 0) {
    alert("Give the deployment a name and select at least one ticket.");
    return;
  }
  if (editingDeploymentId) {
    const currentMemberIds = itemsForDeployment(editingDeploymentId).map((i) => i.id);
    const addIds = checked.filter((id) => !currentMemberIds.includes(id));
    const removeIds = currentMemberIds.filter((id) => !checked.includes(id));
    await renameDeployment(editingDeploymentId, label);
    if (addIds.length || removeIds.length) await setDeploymentMembership(editingDeploymentId, addIds, removeIds);
  } else {
    await createDeployment(deploymentsProjectId, label, checked);
  }
  closeDeploymentModal();
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
    const name = (prompt("New program/product name:") || "").trim();
    if (!name) { populateProgramSelect(docsProgramSelect, ""); return; }
    const newId = await createProgram(name);
    populateProgramSelect(docsProgramSelect, newId || "");
    if (newId) await setProjectProgram(docsProjectId, newId);
    return;
  }
  setProjectProgram(docsProjectId, docsProgramSelect.value);
});

function openDocsPage(pid) {
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
  if (editingDocId) {
    await updateProjectDoc(editingDocId, name, docContentInput.value);
  } else {
    if (!docsProjectId) return;
    await addProjectDoc(docsProjectId, name, docContentInput.value);
  }
  closeDocModal();
});

// ── Interface modal — shared "add" (from Docs page) and "edit" flow ──────
const ifBackdrop = document.getElementById("if-backdrop");
const ifOtherProject = document.getElementById("if-other-project");
const ifNameInput = document.getElementById("if-name-input");
const ifContentInput = document.getElementById("if-content-input");

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
  if (editingInterfaceId) {
    await updateInterface(editingInterfaceId, name, ifContentInput.value);
  } else {
    const otherId = ifOtherProject.value;
    if (!otherId || !ifAnchorProjectId) return;
    await addInterface(name, [ifAnchorProjectId, otherId], ifContentInput.value);
  }
  closeInterfaceModal();
});

// ── VOICE DICTATION (New Item description) ──────────────────────────────
// Same approach as the Claude Artifact Prototype Pipeline board: the Web
// Speech API runs entirely in the browser, feature-detected and hidden
// where unsupported. suggestType()/suggestCategory() are plain keyword
// heuristics — a starting point, not a final answer, same as manually
// picking the toggle/dropdown.
const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let listening = false;
// Chrome/Android's SpeechRecognition ends itself after a few seconds of
// silence even with continuous:true (surfaces as a "no-speech" error, then
// "end") — that's the "mic cuts out after ~10s" behaviour. stopRequested
// distinguishes that automatic, unwanted end from one the user actually
// asked for (clicking the mic again, closing the form, or submitting), so
// onend below knows whether to silently restart or really stop.
let stopRequested = false;
// Counts consecutive auto-restarts (see onend below) that produced not one
// onresult callback — i.e. the mic looks like it's listening but nothing is
// ever actually being heard, as opposed to a normal pause between sentences
// (which still restarts, but onresult fires again once speech resumes and
// clears this back to 0). Without this, a genuinely broken capture would
// now restart silently forever with zero feedback, which is worse than the
// old ~10s cutoff — at least that was visible. After a few silent restarts
// in a row this gives up for real and says so.
let silentRestartStreak = 0;

function showMicError(msg) {
  const el = document.getElementById("ni-mic-error");
  if (!msg) { el.textContent = ""; el.classList.remove("on"); return; }
  el.textContent = msg;
  el.classList.add("on");
}

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

function wireMicButton() {
  const micBtn = document.getElementById("ni-mic-btn");
  if (!SpeechRecognitionCtor) {
    micBtn.hidden = true;
    showMicError("Dictation isn't supported in this browser — Chrome or Edge support it, or you can just type instead.");
    return;
  }
  micBtn.hidden = false;
  micBtn.addEventListener("click", () => {
    if (listening) { stopRequested = true; recognition && recognition.stop(); return; }
    requestMicAndListen();
  });
}

// Chrome won't reliably prompt for microphone permission from inside
// SpeechRecognition alone — asking via getUserMedia first forces a real
// permission prompt (or a real, specific error) before handing off.
function requestMicAndListen() {
  showMicError("");
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { startListening(); return; }
  navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
    stream.getTracks().forEach((t) => t.stop());
    // Reported live on Android Chrome: the mic visibly starts "listening"
    // (button goes red/pulsing) but never transcribes a word — consistent
    // with SpeechRecognition silently failing to (re-)open the microphone
    // when it's asked to grab it again immediately after this probe
    // stream's tracks are stopped, before the OS has actually released the
    // hardware. A short delay here gives that teardown time to finish
    // before recognition.start() tries to claim the mic itself.
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
    showMicError(msg);
  });
}

function startListening(isRestart) {
  if (!SpeechRecognitionCtor) return;
  if (listening && recognition) { try { recognition.stop(); } catch (err) {} }
  stopRequested = false;
  if (!isRestart) silentRestartStreak = 0;
  const desc = document.getElementById("ni-desc-input");
  const micBtn = document.getElementById("ni-mic-btn");
  const hint = document.getElementById("ni-listening-hint");
  let baseline = desc.value.trim();
  if (baseline) baseline += " ";
  recognition = new SpeechRecognitionCtor();
  recognition.lang = "en-US";
  // continuous:true is a known bad actor on Android Chrome — reported live:
  // speech gets tripled/repeated 10x over, then it dies anyway around 10s.
  // Android's continuous-mode implementation is documented to redeliver or
  // duplicate prior results across its own internal keep-alive restarts,
  // which then compounds with this file's own baseline-carrying restart
  // logic (baseline already has the old text, and if the native results
  // array ALSO still contains it, it doubles up every cycle). continuous:
  // false makes each session a single short utterance with a clean, fresh
  // results array every time — onend below already restarts immediately
  // after every session end regardless, so dictation still reads as
  // continuous to the user; it's just genuinely fresh state underneath
  // instead of relying on Android's own long-running continuous handling.
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.onresult = (e) => {
    // Any result at all — even an interim one — proves audio is actually
    // reaching the recognizer, so clear the "hearing nothing" streak.
    silentRestartStreak = 0;
    let finalText = "", interimText = "";
    for (let i = 0; i < e.results.length; i++) {
      const chunk = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += chunk + " "; else interimText += chunk;
    }
    desc.value = (baseline + finalText + interimText).replace(/\s+/g, " ").replace(/^\s+/, "");
    autoGrow(desc);
  };
  recognition.onerror = (e) => {
    const code = e && e.error;
    if (code === "not-allowed" || code === "service-not-allowed") {
      showMicError("Microphone access is blocked for this page — check your browser's site permissions and try again.");
      stopRequested = true;
    } else if (code === "audio-capture") {
      showMicError("No microphone could be accessed.");
      stopRequested = true;
    } else if (code === "network") {
      showMicError("Dictation needs an internet connection to convert speech to text — check your connection and try again.");
      stopRequested = true;
    } else if (code === "no-speech" || code === "aborted") {
      // Expected/transient, not a real failure: "no-speech" is exactly the
      // browser's own silence timeout (the "cuts out after ~10s" report),
      // and "aborted" fires when we stop it ourselves. Leave stopRequested
      // as-is so onend below restarts through a silence and only really
      // stops when the user (or closeForm/submit) actually asked it to.
    } else if (code) {
      showMicError(`Dictation stopped (${code}) — you can keep typing instead.`);
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
    // recurses (verified: an unguarded version of this spun into thousands
    // of recognition instances off a single simulated restart in testing).
    // Nulling the handlers first makes any such re-entrant call inert.
    const finished = recognition;
    if (finished) { finished.onend = null; finished.onerror = null; finished.onresult = null; }
    if (stopRequested) { stopListening(); return; }
    silentRestartStreak++;
    if (silentRestartStreak >= 4) {
      // Several restarts in a row with not one word heard — this isn't a
      // normal pause between sentences (onresult would have cleared the
      // streak), it's the mic not actually being captured. Say so instead
      // of silently spinning forever.
      showMicError("Not picking up any speech from the microphone — check the mic is working and permitted, or just type instead.");
      stopListening();
      return;
    }
    // The browser ended this recognition session on its own (silence
    // timeout is the common case) but nobody asked to stop — restart
    // immediately so dictation feels continuous. desc.value already holds
    // everything transcribed so far, and startListening() re-reads it as
    // the new baseline, so nothing is lost across the restart.
    try { startListening(true); } catch (err) { stopListening(); }
  };
  listening = true;
  micBtn.classList.add("listening");
  micBtn.innerHTML = "&#9209;"; // ⏹ — unambiguous "tap to stop", not just a color change
  micBtn.title = "Stop dictation";
  micBtn.setAttribute("aria-label", "Stop dictation");
  hint.classList.add("on");
  try { recognition.start(); } catch (err) {
    showMicError("Dictation didn't start — you can keep typing instead.");
    stopListening();
  }
}

function stopListening() {
  listening = false;
  stopRequested = false;
  const micBtn = document.getElementById("ni-mic-btn");
  const hint = document.getElementById("ni-listening-hint");
  if (micBtn) {
    micBtn.classList.remove("listening");
    micBtn.innerHTML = "&#127908;"; // 🎤
    micBtn.title = "Dictate";
    micBtn.setAttribute("aria-label", "Dictate");
  }
  if (hint) hint.classList.remove("on");
  if (recognition) { try { recognition.stop(); } catch (err) {} }
  const descEl = document.getElementById("ni-desc-input");
  if (descEl && descEl.value.trim()) {
    setTypeToggle(suggestType(descEl.value));
  }
}

wireMicButton();
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
function renderFaqBodyMd(content) {
  const trimmed = (content || "").trim();
  if (trimmed.startsWith("<")) {
    if (!window.DOMPurify) return escapeHTML(trimmed);
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
    alert("This category still has articles in it — move or delete those first.");
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
  faqCategories = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (!faqSettingsPage.hidden) renderFaqSettingsPage();
  if (!faqArticlesPage.hidden) renderFaqArticlesPage();
}, (err) => {
  console.error("backlog-tracker: faqCategories listener error", err);
});

onSnapshot(query(faqArticlesRef, orderBy("order", "asc")), (snap) => {
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
const faFilterCategory = document.getElementById("fa-filter-category");
const faFilterStatus = document.getElementById("fa-filter-status");
const faFilterNeedsReview = document.getElementById("fa-filter-needs-review");
const faFilterSearch = document.getElementById("fa-filter-search");
const faNewCategoryIconSelect = document.getElementById("fa-new-category-icon");
faNewCategoryIconSelect.innerHTML = faqCategoryIconOptionsHTML("help");

function openFaqSettingsPage() {
  document.getElementById("projects-root").hidden = true;
  faqSettingsPage.hidden = false;
  renderFaqSettingsPage();
}
function closeFaqSettingsPage() {
  faqSettingsPage.hidden = true;
  document.getElementById("projects-root").hidden = false;
}

function openFaqArticlesPage() {
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

function renderFaqArticlesPage() {
  const catOptionsHTML = faqCategories
    .map((c) => `<option value="${escapeHTML(c.id)}">${escapeHTML(c.name)}</option>`).join("");
  faCategorySelect.innerHTML = catOptionsHTML || '<option value="">Add a category first</option>';

  const prevFilterCat = faFilterCategory.value;
  faFilterCategory.innerHTML = '<option value="">All categories</option>' + catOptionsHTML;
  faFilterCategory.value = prevFilterCat;

  const prevProjVal = faProjectSelect.value;
  faProjectSelect.innerHTML = '<option value="">None — general article</option>' +
    projects.map((p) => `<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)}</option>`).join("");
  faProjectSelect.value = prevProjVal;

  renderFaqArticleList();

  const publishedCount = faqArticles.filter((a) => a.status === "published").length;
  const draftCount = faqArticles.filter((a) => a.status === "draft").length;
  document.getElementById("faq-admin-count").textContent = `${publishedCount} published, ${draftCount} draft`;
}

function renderFaqArticleList() {
  let list = faqArticles.slice();
  if (faFilterCategory.value) list = list.filter((a) => a.categoryId === faFilterCategory.value);
  if (faFilterStatus.value) list = list.filter((a) => a.status === faFilterStatus.value);
  if (faFilterNeedsReview.value === "yes") list = list.filter((a) => a.needsReview);
  const q = faFilterSearch.value.trim().toLowerCase();
  if (q) {
    list = list.filter((a) =>
      (a.title || "").toLowerCase().includes(q) || (a.summary || "").toLowerCase().includes(q));
  }

  const listEl = document.getElementById("faq-article-list");
  const emptyEl = document.getElementById("faq-article-empty");
  if (list.length === 0) {
    listEl.innerHTML = "";
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;
  listEl.innerHTML = list.map((a) => {
    const liveUrl = `${FAQ_PUBLIC_BASE_URL}article.html?id=${encodeURIComponent(a.id)}`;
    // Clicking the title itself opens the edit modal (see the delegated
    // click handler below) — there's no separate "Edit" button in the
    // primary row anymore. Everything else that used to sit as its own
    // button in the row now lives in one "⋮" options menu, same
    // show/hide-one-at-a-time pattern as the per-project options menu
    // (toggleOptionMenu/closeAllOptionMenus, extended below to also close
    // an open .faq-article-options-menu).
    return `
      <div class="faq-article-row" data-id="${escapeHTML(a.id)}">
        <div class="faq-article-row-main">
          <span class="badge badge-status-${a.status}">${a.status === "published" ? "Published" : "Draft"}</span>
          ${a.needsReview ? '<span class="badge badge-needs-review">Needs review</span>' : ""}
          <h4 class="faq-article-title" role="button" tabindex="0" title="Edit article">${escapeHTML(a.title)}</h4>
          <p class="faq-article-row-meta">${escapeHTML(faqCategoryName(a.categoryId))}${a.projectId ? " &middot; " + escapeHTML(projectName(a.projectId)) : ""}</p>
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
  }).join("");
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

[faFilterCategory, faFilterStatus, faFilterNeedsReview].forEach((el) => {
  el.addEventListener("change", renderFaqArticleList);
});
faFilterSearch.addEventListener("input", renderFaqArticleList);

// ── FAQ article editor modal ────────────────────────────────────────────
const faBackdrop = document.getElementById("fa-backdrop");
const faTitleInput = document.getElementById("fa-title-input");
const faSlugInput = document.getElementById("fa-slug-input");
const faDocTypeSelect = document.getElementById("fa-doctype-select");
const faSummaryInput = document.getElementById("fa-summary-input");
const faKeywordsInput = document.getElementById("fa-keywords-input");
const faBodyViewer = document.getElementById("fa-body-viewer");
const faNeedsReview = document.getElementById("fa-needs-review");
let faStatus = "draft";

// Rich-text body editor (Quill, loaded via CDN — see index.html <head>).
// One instance bound to #fa-body-editor for the life of the page, same as
// every other modal's inputs; openFaqArticleModal() below resets its
// content on each open rather than recreating it. Toolbar covers exactly
// what the ticket asked for: headers, bold/italic/underline/strike,
// alignment, ordered/bullet lists, link, image (a URL prompt rather than
// letting Quill embed a base64 data URI, to stay well under Firestore's
// 1MiB document limit), video, and a "clear formatting" button.
const faQuill = new Quill("#fa-body-editor", {
  theme: "snow",
  modules: {
    toolbar: {
      container: [
        [{ header: [1, 2, 3, false] }],
        ["bold", "italic", "underline", "strike"],
        [{ align: [] }],
        [{ list: "ordered" }, { list: "bullet" }],
        ["link", "image", "video"],
        ["clean"],
      ],
      handlers: {
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
        image() {
          const url = prompt("Image URL:");
          if (!url) return;
          const alt = prompt("Alt text (describes the image's content for screen readers — leave blank only if it's purely decorative):", "") || "";
          const range = faQuill.getSelection(true);
          faQuill.insertEmbed(range.index, "image", url, "user");
          faQuill.setSelection(range.index + 1);
          const img = faQuill.root.querySelector(`img[src="${CSS.escape(url)}"]:not([alt])`);
          if (img) img.setAttribute("alt", alt);
        },
      },
    },
  },
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
  document.querySelectorAll("#fa-backdrop .type-opt").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.status === status);
  });
}

function openFaqArticleModal(articleId) {
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

  if (faCategorySelect.options.length && faCategorySelect.options[0].value !== "") {
    faCategorySelect.value = article ? article.categoryId : faCategorySelect.options[0].value;
  }
  faProjectSelect.value = article && article.projectId ? article.projectId : "";

  const liveHint = document.getElementById("fa-live-link-hint");
  if (article && article.status === "published") {
    liveHint.hidden = false;
    liveHint.innerHTML = `Live at <a href="${FAQ_PUBLIC_BASE_URL}article.html?id=${encodeURIComponent(article.id)}" target="_blank" rel="noopener">${FAQ_PUBLIC_BASE_URL}article.html?id=${encodeURIComponent(article.id)}</a>`;
  } else {
    liveHint.hidden = true;
  }

  faBackdrop.hidden = false;
  faTitleInput.focus();
}
function closeFaqArticleModal() { faBackdrop.hidden = true; }

document.getElementById("fa-new-article-btn").addEventListener("click", () => {
  if (faqCategories.length === 0) { alert("Add a category first."); return; }
  openFaqArticleModal(null);
});
document.getElementById("fa-cancel").addEventListener("click", closeFaqArticleModal);
document.getElementById("fa-close").addEventListener("click", closeFaqArticleModal);
faBackdrop.addEventListener("click", (e) => { if (e.target === faBackdrop) closeFaqArticleModal(); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !faBackdrop.hidden) closeFaqArticleModal();
});

document.querySelectorAll("#fa-backdrop .type-opt").forEach((btn) => {
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
  if (!categoryId) { alert("Add a category first."); return; }

  const data = {
    categoryId,
    projectId: faProjectSelect.value || null,
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
  closeFaqArticleModal();
});

document.getElementById("faq-article-list").addEventListener("click", (e) => {
  const row = e.target.closest(".faq-article-row");
  if (!row) return;
  const id = row.dataset.id;
  const optionsBtn = e.target.closest(".faq-article-options-btn");
  if (optionsBtn) { toggleOptionMenu(optionsBtn); return; }
  if (e.target.closest(".faq-article-title") || e.target.closest(".faq-article-edit")) {
    closeAllOptionMenus();
    openFaqArticleModal(id);
    return;
  }
  if (e.target.closest(".faq-article-toggle-status")) { closeAllOptionMenus(); toggleFaqArticleStatus(id); return; }
  if (e.target.closest(".faq-article-toggle-review")) { closeAllOptionMenus(); toggleFaqArticleReview(id); return; }
  if (e.target.closest(".faq-article-delete")) {
    if (confirm("Delete this article? This can't be undone.")) deleteFaqArticle(id);
  }
});
document.getElementById("faq-article-list").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const title = e.target.closest(".faq-article-title");
  if (!title) return;
  e.preventDefault();
  const row = title.closest(".faq-article-row");
  if (row) { closeAllOptionMenus(); openFaqArticleModal(row.dataset.id); }
});
