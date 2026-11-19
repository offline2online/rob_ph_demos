// Support › Documentation (#documentation): the team's internal product and
// technical documentation, members only. It replaced the Confluence space on
// 19 Nov 2026 (see backlog-tracker/README.md → "Documentation").
//
// Data lives in Firestore docCategories / docArticles and is loaded by app.js
// (the same lazy listeners the Help Centre uses), because the article editor
// in app.js reads it too: a document opens in the Help Centre's own editor,
// with the same formatting and properties, website-only fields hidden.
//
// This module draws the page: a tree of sections (nested to any depth via
// parentId), the documents of the selected section, search across every
// document's title, summary, keywords and text, and a status filter. Every
// control is a <button> acting on click (iPad taps, see touch-click.js).
// It deliberately uses none of the attributes the Help Centre's document-wide
// handlers listen for (data-drag-kind, data-add-sub, data-order-id), so the
// two pages never act on each other's rows.
import { doc, writeBatch, serverTimestamp, addDoc, setDoc, deleteDoc, collection } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { orderOf, byOrder, DOC_TYPE_LABEL, DOC_SECTION_ICONS, childrenOf, descendantIds, pathOf, plainText, matchesFilter, searchDocs, snippetFor } from "./documentation-core.js";

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const icon = (name, cls = "") => `<span class="material-symbols-outlined${cls ? " " + cls : ""}" aria-hidden="true">${name}</span>`;
export function mountDocumentationPage({ db, getCategories, getArticles, canEdit, openDoc, newDoc, alert, confirm, prompt, fields }) {
  const $ = (id) => document.getElementById(id);
  const page = $("documentation-page");
  let selected = null;               // category id
  const open = new Set();            // expanded category ids
  let filter = "all";
  let query = "";
  const textCache = new Map();       // article id -> { body, text }
  let dragging = null;               // { kind: "cat"|"doc", id }

  const textOf = (a) => {
    const hit = textCache.get(a.id);
    if (hit && hit.body === a.bodyMd) return hit.text;
    const text = plainText(a.bodyMd).toLowerCase();
    textCache.set(a.id, { body: a.bodyMd, text });
    return text;
  };
  const cats = () => getCategories() || [];
  const arts = () => getArticles() || [];
  const docsIn = (id) => arts().filter((a) => a.categoryId === id).sort(byOrder);
  const countUnder = (id) => { const ids = new Set(descendantIds(cats(), id)); return arts().filter((a) => ids.has(a.categoryId)).length; };

  function treeRow(c, depth) {
    const kids = childrenOf(cats(), c.id);
    const isOpen = open.has(c.id);
    const caret = kids.length ? icon(isOpen ? "expand_less" : "expand_more", "faq-tree-caret") : "";
    const add = canEdit() ? `<button type="button" class="faq-tree-add" data-doc-add-sub="${esc(c.id)}" title="Add a folder inside ${esc(c.name)}" aria-label="Add a folder inside ${esc(c.name)}">+</button>` : "";
    const drag = canEdit() ? ` draggable="true" data-doc-drag="cat" data-doc-id="${esc(c.id)}"` : "";
    let html = `<div class="doc-tree-node"><button type="button" class="faq-tree-row doc-tree-row${selected === c.id ? " selected" : ""}" style="padding-left:${8 + depth * 18}px" data-doc-cat="${esc(c.id)}"${drag}>` +
      icon(c.icon || (depth ? "folder" : "menu_book"), "faq-tree-icon") +
      `<span class="faq-tree-name">${esc(c.name || "(untitled)")}</span><span class="faq-tree-count">${countUnder(c.id)}</span>${caret}</button>${add}</div>`;
    if (isOpen) for (const k of kids) html += treeRow(k, depth + 1);
    return html;
  }

  function renderTree() {
    const root = $("doc-tree");
    if (!root) return;
    const tops = childrenOf(cats(), null);
    root.innerHTML = tops.map((c) => treeRow(c, 0)).join("") || '<p class="empty-hint">No sections yet.</p>';
  }

  function rowHTML(a, { showPath, q } = {}) {
    const path = showPath ? pathOf(cats(), a.categoryId).map((c) => c.name).join(" › ") : "";
    const updated = a.source && a.source.lastUpdated ? a.source.lastUpdated : "";
    const meta = [path, a.docType ? DOC_TYPE_LABEL[a.docType] : "", updated ? `Last updated ${updated}` : ""].filter(Boolean).join(" · ");
    const snippet = q ? `<p class="doc-row-snippet">${esc(snippetFor(plainText(a.bodyMd), q))}</p>` : (a.summary ? `<p class="doc-row-snippet">${esc(a.summary)}</p>` : "");
    const drag = !showPath && canEdit() ? ` draggable="true" data-doc-drag="doc" data-doc-id="${esc(a.id)}"` : "";
    return `<div class="faq-article-row doc-row"${drag}>
        <div class="faq-article-row-main">
          ${a.status === "draft" ? '<span class="badge badge-status-draft">Draft</span>' : ""}
          ${a.needsReview ? '<span class="badge badge-needs-review">Needs review</span>' : ""}
          <button type="button" class="doc-row-title" data-doc-open="${esc(a.id)}">${icon("description")}<span>${esc(a.title)}</span></button>
          ${meta ? `<p class="faq-article-row-meta">${esc(meta)}</p>` : ""}
          ${snippet}
        </div>
        <div class="faq-article-row-actions">
          <button type="button" class="icon-btn" data-doc-edit="${esc(a.id)}" title="Edit document" aria-label="Edit ${esc(a.title)}" data-editor-only>${icon("edit")}</button>
        </div>
      </div>`;
  }

  function renderList() {
    const listEl = $("doc-list"), emptyEl = $("doc-empty"), heading = $("doc-heading");
    if (!listEl) return;
    const crossFolder = !!query.trim() || filter !== "all";
    let list;
    if (query.trim()) list = searchDocs(arts(), query, textOf).filter((a) => matchesFilter(a, filter));
    else if (filter !== "all") list = arts().filter((a) => matchesFilter(a, filter)).sort(byOrder);
    else list = selected ? docsIn(selected) : [];
    const cat = !crossFolder && selected ? cats().find((c) => c.id === selected) : null;
    heading.textContent = query.trim() ? `Search results (${list.length})`
      : filter !== "all" ? `${$("doc-status-filter").selectedOptions[0].textContent} (${list.length})`
      : cat ? `${cat.name} (${list.length})` : "Documents";
    $("doc-heading-icon").hidden = !cat;
    if (cat) $("doc-heading-icon").textContent = cat.icon || "folder";
    $("doc-cat-edit-btn").hidden = !cat || !canEdit();
    $("doc-cat-delete-btn").hidden = !cat || !canEdit();
    $("doc-heading-desc").hidden = !(cat && cat.description);
    if (cat && cat.description) $("doc-heading-desc").textContent = cat.description;
    const crumbs = cat ? pathOf(cats(), cat.id) : [];
    $("doc-breadcrumb").hidden = crumbs.length < 2;
    $("doc-breadcrumb").textContent = crumbs.map((c) => c.name).join(" › ");
    // Folders inside the selected section, so a section that holds only
    // folders isn't an empty page.
    const subs = cat ? childrenOf(cats(), cat.id) : [];
    const subsHTML = subs.length
      ? `<div class="doc-subfolders">${subs.map((s) => `<button type="button" class="doc-subfolder" data-doc-cat="${esc(s.id)}">${icon(s.icon || "folder")}<span>${esc(s.name)}</span><span class="faq-tree-count">${countUnder(s.id)}</span></button>`).join("")}</div>`
      : "";
    if (!list.length && !subs.length) {
      listEl.innerHTML = "";
      emptyEl.hidden = false;
      emptyEl.textContent = query.trim() ? "No documents match that search." : filter !== "all" ? "No documents match this filter." : selected ? "Nothing in this section yet." : "Pick a section on the left.";
      return;
    }
    emptyEl.hidden = true;
    listEl.innerHTML = subsHTML + list.map((a) => rowHTML(a, { showPath: crossFolder, q: query.trim() })).join("");
  }

  function renderCount() {
    const el = $("doc-count");
    if (!el) return;
    const all = arts();
    const review = all.filter((a) => a.needsReview).length;
    el.textContent = `${all.length} document${all.length === 1 ? "" : "s"}${review ? `, ${review} need review` : ""}`;
  }

  function render() {
    if (!page || page.hidden) return;
    if (!selected) {
      const first = childrenOf(cats(), null)[0];
      if (first) { selected = first.id; open.add(first.id); }
    }
    renderTree();
    renderList();
    renderCount();
  }

  function select(id) {
    selected = id;
    for (const c of pathOf(cats(), id)) open.add(c.id);
    query = "";
    const s = $("doc-search"); if (s) s.value = "";
    render();
  }

  const nextOrder = (siblings) => (siblings.length ? Math.max(...siblings.map(orderOf)) + 1 : 0);

  async function addCategory(parentId) {
    if (!canEdit()) return;
    const name = ((await prompt(parentId ? "Name this folder" : "Name this section", "", { title: parentId ? "New folder" : "New section", okLabel: "Create" })) || "").trim();
    if (!name) return;
    const siblings = childrenOf(cats(), parentId || null);
    const ref = await addDoc(collection(db, "docCategories"), {
      name, icon: parentId ? "folder" : "menu_book", description: "", parentId: parentId || null,
      order: nextOrder(siblings), createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    if (parentId) open.add(parentId);
    selected = ref.id;
  }

  async function editCategory(id) {
    const c = cats().find((x) => x.id === id);
    if (!c || !canEdit()) return;
    const icons = DOC_SECTION_ICONS.includes(c.icon) ? DOC_SECTION_ICONS : [c.icon || "folder", ...DOC_SECTION_ICONS];
    const result = await fields({
      title: "Edit section",
      fields: [
        { id: "name", label: "Name", value: c.name || "" },
        { id: "icon", label: "Icon", type: "select", options: icons, value: c.icon || "folder" },
        { id: "description", label: "Short description", value: c.description || "" },
      ],
      okLabel: "Save",
    });
    if (!result) return;
    const name = String(result.name || "").trim();
    if (!name) return;
    await setDoc(doc(db, "docCategories", id), { name: name.slice(0, 120), icon: String(result.icon || c.icon || "folder"), description: String(result.description || "").trim().slice(0, 500), updatedAt: serverTimestamp() }, { merge: true });
  }

  async function deleteCategory(id) {
    const c = cats().find((x) => x.id === id);
    if (!c || !canEdit()) return;
    if (childrenOf(cats(), id).length || docsIn(id).length) { await alert("This section still has folders or documents in it — move or delete those first."); return; }
    if (!(await confirm(`Delete "${c.name}"? This can't be undone.`, { title: "Delete section", okLabel: "Delete", danger: true }))) return;
    await deleteDoc(doc(db, "docCategories", id));
    if (selected === id) selected = c.parentId || null;
    render();
  }

  async function reorder(kind, draggedId, targetId, after) {
    const list = kind === "cat"
      ? childrenOf(cats(), (cats().find((c) => c.id === draggedId) || {}).parentId || null)
      : docsIn((arts().find((a) => a.id === draggedId) || {}).categoryId);
    const ids = list.map((d) => d.id);
    if (!ids.includes(targetId)) return;
    ids.splice(ids.indexOf(draggedId), 1);
    let to = ids.indexOf(targetId);
    if (after) to += 1;
    ids.splice(to, 0, draggedId);
    const batch = writeBatch(db);
    const col = kind === "cat" ? "docCategories" : "docArticles";
    ids.forEach((id, i) => batch.update(doc(db, col, id), { order: i, updatedAt: serverTimestamp() }));
    await batch.commit();
  }

  // ── Wiring ────────────────────────────────────────────────────────────
  page.addEventListener("click", async (e) => {
    const add = e.target.closest("[data-doc-add-sub]");
    if (add) { e.stopPropagation(); await addCategory(add.dataset.docAddSub); return; }
    const catBtn = e.target.closest("[data-doc-cat]");
    if (catBtn) {
      const id = catBtn.dataset.docCat;
      if (selected === id && catBtn.classList.contains("doc-tree-row") && childrenOf(cats(), id).length) {
        if (open.has(id)) open.delete(id); else open.add(id);
        render();
        return;
      }
      select(id);
      return;
    }
    const openBtn = e.target.closest("[data-doc-open]");
    if (openBtn) { openDoc(openBtn.dataset.docOpen, { mode: "view" }); return; }
    const editBtn = e.target.closest("[data-doc-edit]");
    if (editBtn) { openDoc(editBtn.dataset.docEdit, { mode: "edit" }); return; }
  });
  $("doc-new-category-btn").addEventListener("click", () => addCategory(null));
  $("doc-cat-edit-btn").addEventListener("click", () => selected && editCategory(selected));
  $("doc-cat-delete-btn").addEventListener("click", () => selected && deleteCategory(selected));
  $("doc-new-article-btn").addEventListener("click", async () => {
    if (!cats().length) { await alert("Add a section first."); return; }
    newDoc(selected || childrenOf(cats(), null)[0].id);
  });
  $("doc-status-filter").addEventListener("change", (e) => { filter = e.target.value; renderList(); });
  $("doc-search").addEventListener("input", (e) => { query = e.target.value; renderList(); });

  page.addEventListener("dragstart", (e) => {
    const el = e.target.closest && e.target.closest("[data-doc-drag]");
    if (!el) return;
    dragging = { kind: el.dataset.docDrag, id: el.dataset.docId, el };
    el.classList.add("dragging");
    if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", dragging.id); }
  });
  const clearMarks = () => page.querySelectorAll(".faq-drop-before, .faq-drop-after").forEach((el) => el.classList.remove("faq-drop-before", "faq-drop-after"));
  page.addEventListener("dragover", (e) => {
    if (!dragging) return;
    const over = e.target.closest && e.target.closest("[data-doc-drag]");
    clearMarks();
    if (!over || over.dataset.docDrag !== dragging.kind || over.dataset.docId === dragging.id) return;
    e.preventDefault();
    const box = over.getBoundingClientRect();
    over.classList.add(e.clientY > box.top + box.height / 2 ? "faq-drop-after" : "faq-drop-before");
  });
  page.addEventListener("drop", async (e) => {
    if (!dragging) return;
    const over = e.target.closest && e.target.closest("[data-doc-drag]");
    const after = !!(over && over.classList.contains("faq-drop-after"));
    clearMarks();
    const d = dragging; dragging = null; d.el.classList.remove("dragging");
    if (!over || over.dataset.docDrag !== d.kind || over.dataset.docId === d.id) return;
    e.preventDefault();
    try { await reorder(d.kind, d.id, over.dataset.docId, after); }
    catch (err) { await alert("Couldn't save that new order: " + (err && err.message ? err.message : err)); }
  });
  page.addEventListener("dragend", () => { if (dragging) dragging.el.classList.remove("dragging"); dragging = null; clearMarks(); });

  return {
    render,
    // Open the page at a section (the editor's Cancel returns here).
    show({ categoryId } = {}) { if (categoryId) select(categoryId); else render(); },
    selected: () => selected,
  };
}
