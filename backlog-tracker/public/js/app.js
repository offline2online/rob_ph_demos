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
  onSnapshot, query, orderBy, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const itemsRef = collection(db, "backlogItems");
const projectsRef = collection(db, "projects");
const interfacesRef = collection(db, "interfaces");

const COLUMNS = [
  { key: "backlog", label: "Backlog", headClass: "backlog" },
  { key: "ready-for-testing", label: "Ready for Testing", headClass: "testing" },
  { key: "ready-to-publish", label: "Live on Feature Branch", headClass: "publish" },
  { key: "published-live", label: "Merged to Main (Live)", headClass: "live" },
];
const COL_KEYS = COLUMNS.map((c) => c.key);

const CATEGORIES = [
  "Pricing & Offers", "Product Assets", "HQ Admin", "Retail Admin",
  "Menu Board", "Backend / Infrastructure", "Uncategorised",
];

const GENERAL_PROJECT_ID = "general";

function escapeHTML(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

let allItems = [];
let items = [];
let projects = [];
let interfaces = [];
let editingProjectId = null;

// ── Docs page state (per-project requirements + interfaces with other
// projects) — an interface is a maintained contract doc shared between
// exactly two projects, stored once in "interfaces" and shown identically
// from either side. ──────────────────────────────────────────────────────
let docsProjectId = null;
let editingInterfaceId = null; // null while adding, an id while editing

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

// ── Per-project "⋮" options menu — plain show/hide, one open at a time.
// Rebuilt on every render() along with everything else in #projects-root,
// so there's no stale-DOM-node bookkeeping to worry about; it just starts
// closed again after any state change, which is the safe default anyway.
function closeAllOptionMenus() {
  document.querySelectorAll(".project-options-menu").forEach((m) => { m.hidden = true; });
}
function toggleOptionMenu(btn) {
  const menu = btn.nextElementSibling;
  const wasHidden = menu.hidden;
  closeAllOptionMenus();
  menu.hidden = !wasHidden;
}
document.addEventListener("click", (e) => {
  if (!e.target.closest(".project-options")) closeAllOptionMenus();
});

function cardHTML(item) {
  const idx = COL_KEYS.indexOf(item.status);
  const canLeft = idx > 0;
  const isTesting = item.status === "ready-for-testing";
  const isLiveBranch = item.status === "ready-to-publish";
  const canDelete = item.status === "backlog";

  const leftBtn = canLeft
    ? `<button type="button" class="icon-btn move-btn" data-id="${item.id}" data-dir="-1" title="Move back">&larr;</button>`
    : "";
  const deleteBtn = canDelete
    ? `<button type="button" class="icon-btn delete-btn" data-id="${item.id}" title="Remove">&times;</button>`
    : "";
  const approveBtn = isTesting
    ? `<button type="button" class="approve-btn move-btn" data-id="${item.id}" data-dir="1">Confirm live on branch</button>`
    : "";
  const mergeBtn = isLiveBranch
    ? `<button type="button" class="merge-btn move-btn" data-id="${item.id}" data-dir="1">Merge to main</button>`
    : "";
  const isPublished = item.status === "published-live";
  const archiveBtn = isPublished
    ? `<button type="button" class="icon-btn archive-btn" data-id="${item.id}" title="Archive">&#128451;</button>`
    : "";
  const canRight = idx < COL_KEYS.length - 1 && !isTesting && !isLiveBranch;
  const rightBtn = canRight
    ? `<button type="button" class="icon-btn move-btn" data-id="${item.id}" data-dir="1" title="Move forward">&rarr;</button>`
    : "";

  return `
    <article class="card" data-id="${item.id}">
      <div class="card-top">
        <span class="badge badge-${item.type}">${item.type === "bug" ? "Bug" : "Feature"}</span>
        <div class="card-move">${leftBtn}${rightBtn}</div>
      </div>
      <h3 class="card-title">${escapeHTML(item.title)}</h3>
      <p class="card-desc">${escapeHTML(item.desc)}</p>
      <div class="card-footer">
        <span class="card-cat">${escapeHTML(item.category || "Uncategorised")}</span>
        <div class="card-move">${archiveBtn}${deleteBtn}</div>
      </div>
      ${approveBtn}${mergeBtn}
    </article>`;
}

function archivedCountForProject(pid) {
  return allItems.filter((i) => (i.projectId || GENERAL_PROJECT_ID) === pid && i.status === "archived").length;
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
  return html;
}

function projectSectionHTML(project) {
  const collapsed = isProjectCollapsed(project.id);
  const projectItems = items.filter((i) => (i.projectId || GENERAL_PROJECT_ID) === project.id);
  const cardsByCol = {};
  COLUMNS.forEach((col) => { cardsByCol[col.key] = projectItems.filter((i) => i.status === col.key); });
  const total = COL_KEYS.reduce((sum, k) => sum + cardsByCol[k].length, 0);

  const board = `<div class="board">` + COLUMNS.map((col) => {
    const listItems = cardsByCol[col.key];
    return `<section class="column" data-col="${col.key}">
      <div class="col-head col-head-${col.headClass}"><span>${col.label}</span><span class="col-count">${listItems.length}</span></div>
      <div class="col-list" id="${colListId(project.id, col.key)}" data-col="${col.key}" data-project-id="${escapeHTML(project.id)}">
        ${listItems.length ? listItems.map(cardHTML).join("") : '<div class="empty-hint">No items yet</div>'}
      </div>
    </section>`;
  }).join("") + `</div>`;

  const nameRow = editingProjectId === project.id
    ? `<div class="project-name-row"><input type="text" class="project-name-input" id="pname-input-${escapeHTML(project.id)}" data-project-id="${escapeHTML(project.id)}" value="${escapeHTML(project.name)}" maxlength="80"></div>`
    : `<div class="project-name-row"><h2 class="project-name">${escapeHTML(project.name)}</h2>
         <button type="button" class="project-rename-btn" data-project-id="${escapeHTML(project.id)}" title="Rename project">&#9998;</button>
       </div>`;

  return `
    <section class="project${collapsed ? " collapsed" : ""}" data-project-id="${escapeHTML(project.id)}">
      <div class="project-header">
        <button type="button" class="project-collapse-btn" data-project-id="${escapeHTML(project.id)}" title="${collapsed ? "Expand" : "Collapse"}">${collapsed ? "&#9656;" : "&#9662;"}</button>
        <div class="project-title-wrap">
          ${nameRow}
          <p class="subtitle"><b>${total}</b> item${total === 1 ? "" : "s"} in the pipeline</p>
        </div>
        <div class="project-header-actions">
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
function getRenderedProjects() {
  const known = projects.slice();
  const knownIds = new Set(known.map((p) => p.id));
  const hasOrphans = items.some((i) => !i.projectId || !knownIds.has(i.projectId));
  if (hasOrphans && !knownIds.has(GENERAL_PROJECT_ID)) {
    known.push({ id: GENERAL_PROJECT_ID, name: "General" });
  }
  return known;
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

function render() {
  migrateOrphanItems();
  const renderedProjects = getRenderedProjects();
  document.getElementById("projects-root").innerHTML = renderedProjects.map(projectSectionHTML).join("");

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
}, (err) => {
  console.error("backlog-tracker: items listener error", err);
});

onSnapshot(query(projectsRef, orderBy("createdAt", "asc")), (snap) => {
  projects = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  render();
  if (archiveProjectId) renderArchivePage();
  if (docsProjectId) renderDocsPage();
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
  await updateDoc(doc(db, "backlogItems", id), {
    status: COL_KEYS[next],
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

async function addProject(name) {
  const ref = await addDoc(projectsRef, { name: name.trim(), createdAt: serverTimestamp() });
  return ref.id;
}

async function setProjectName(id, name) {
  const trimmed = (name || "").trim();
  if (!trimmed) return false;
  await setDoc(doc(db, "projects", id), { name: trimmed }, { merge: true });
  return true;
}

async function setProjectRequirements(id, md) {
  await setDoc(doc(db, "projects", id), { requirementsMd: md, updatedAt: serverTimestamp() }, { merge: true });
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
  const moveBtn = e.target.closest(".move-btn");
  if (moveBtn) { moveItem(moveBtn.dataset.id, parseInt(moveBtn.dataset.dir, 10)); return; }
  const delBtn = e.target.closest(".delete-btn");
  if (delBtn) { removeItem(delBtn.dataset.id); return; }
  const archBtn = e.target.closest(".archive-btn");
  if (archBtn) { archiveItem(archBtn.dataset.id); return; }
  const collapseBtn = e.target.closest(".project-collapse-btn");
  if (collapseBtn) { toggleProjectCollapsed(collapseBtn.dataset.projectId); return; }
  const renameBtn = e.target.closest(".project-rename-btn");
  if (renameBtn) { startEditingProjectName(renameBtn.dataset.projectId); return; }
  const newItemBtn = e.target.closest(".new-item-btn");
  if (newItemBtn) { openForm(newItemBtn.dataset.projectId); return; }
  const archiveNavBtn = e.target.closest(".project-archive-btn");
  if (archiveNavBtn) { closeAllOptionMenus(); openArchivePage(archiveNavBtn.dataset.projectId); return; }
  const docsNavBtn = e.target.closest(".project-docs-btn");
  if (docsNavBtn) { closeAllOptionMenus(); openDocsPage(docsNavBtn.dataset.projectId); return; }
  const ifaceOpenBtn = e.target.closest(".interface-open-btn");
  if (ifaceOpenBtn) { closeAllOptionMenus(); openInterfaceModal(ifaceOpenBtn.dataset.interfaceId); return; }
  const ifaceAddBtn = e.target.closest(".interface-add-btn");
  if (ifaceAddBtn) { closeAllOptionMenus(); openInterfaceModal(null, ifaceAddBtn.dataset.projectId); return; }
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
  if (listening) { try { recognition.stop(); } catch (err) {} }
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
// Optionally defines one interface with an existing project in the same
// step — the "when adding a new project, also define its interfaces with
// other projects" path. Fully optional; skipping it just creates a plain
// project, same as before.
const npBackdrop = document.getElementById("np-backdrop");
const npIfEnable = document.getElementById("np-if-enable");
const npIfFields = document.getElementById("np-if-fields");
const npIfProject = document.getElementById("np-if-project");

function populateProjectSelect(selectEl, excludeId) {
  const opts = projects.filter((p) => p.id !== excludeId);
  selectEl.innerHTML = opts.length
    ? opts.map((p) => `<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)}</option>`).join("")
    : '<option value="">No other projects yet</option>';
}

function openProjectModal() {
  npBackdrop.hidden = false;
  document.getElementById("np-name-input").value = "";
  npIfEnable.checked = false;
  npIfFields.hidden = true;
  document.getElementById("np-if-name").value = "";
  document.getElementById("np-if-content").value = "";
  populateProjectSelect(npIfProject, null);
  document.getElementById("np-name-input").focus();
}
function closeProjectModal() { npBackdrop.hidden = true; }

npIfEnable.addEventListener("change", () => { npIfFields.hidden = !npIfEnable.checked; });

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
  const newId = await addProject(name);

  if (npIfEnable.checked) {
    const otherId = npIfProject.value;
    const ifName = document.getElementById("np-if-name").value.trim();
    const ifContent = document.getElementById("np-if-content").value.trim();
    if (otherId && ifName) {
      await addInterface(ifName, [newId, otherId], ifContent);
    }
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

document.getElementById("archive-back-btn").addEventListener("click", closeArchivePage);

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

// ── Docs page (per-project requirements + interfaces with other projects) ─
const docsPage = document.getElementById("docs-page");
const docsRequirementsInput = document.getElementById("docs-requirements-input");

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

function renderDocsPage() {
  if (!docsProjectId) return;
  const project = projects.find((p) => p.id === docsProjectId);
  document.getElementById("docs-page-project-name").textContent = project ? project.name : projectName(docsProjectId);
  if (document.activeElement !== docsRequirementsInput) {
    docsRequirementsInput.value = (project && project.requirementsMd) || "";
  }
  const rows = interfacesForProject(docsProjectId);
  document.getElementById("docs-interfaces-list").innerHTML = rows.length
    ? rows.map(interfaceRowHTML).join("")
    : '<p class="interface-row-empty">No interfaces defined with another project yet.</p>';
}

document.getElementById("docs-back-btn").addEventListener("click", closeDocsPage);
document.getElementById("docs-requirements-save").addEventListener("click", () => {
  if (!docsProjectId) return;
  setProjectRequirements(docsProjectId, docsRequirementsInput.value);
});
document.getElementById("docs-interfaces-list").addEventListener("click", (e) => {
  const editBtn = e.target.closest(".interface-edit-btn");
  if (editBtn) { openInterfaceModal(editBtn.dataset.id); return; }
  const delBtn = e.target.closest(".interface-delete-btn");
  if (delBtn) { deleteInterface(delBtn.dataset.id); return; }
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
    if (listening) { recognition && recognition.stop(); return; }
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
    startListening();
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

function startListening() {
  if (!SpeechRecognitionCtor) return;
  if (listening && recognition) { try { recognition.stop(); } catch (err) {} }
  const desc = document.getElementById("ni-desc-input");
  const micBtn = document.getElementById("ni-mic-btn");
  const hint = document.getElementById("ni-listening-hint");
  let baseline = desc.value.trim();
  if (baseline) baseline += " ";
  recognition = new SpeechRecognitionCtor();
  recognition.lang = "en-US";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onresult = (e) => {
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
    } else if (code === "audio-capture") {
      showMicError("No microphone could be accessed.");
    } else if (code === "network") {
      showMicError("Dictation needs an internet connection to convert speech to text — check your connection and try again.");
    } else if (code && code !== "no-speech" && code !== "aborted") {
      showMicError(`Dictation stopped (${code}) — you can keep typing instead.`);
    }
    stopListening();
  };
  recognition.onend = () => stopListening();
  listening = true;
  micBtn.classList.add("listening");
  hint.classList.add("on");
  try { recognition.start(); } catch (err) {
    showMicError("Dictation didn't start — you can keep typing instead.");
    stopListening();
  }
}

function stopListening() {
  listening = false;
  const micBtn = document.getElementById("ni-mic-btn");
  const hint = document.getElementById("ni-listening-hint");
  if (micBtn) micBtn.classList.remove("listening");
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
