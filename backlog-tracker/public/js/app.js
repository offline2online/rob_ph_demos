// backlog-tracker frontend — a real Firestore-backed board, not a
// self-publishing Claude Artifact. The practical difference that matters
// for the "can a web app tell you when the backlog gets items" question:
// every viewer here gets pushed live updates via onSnapshot() the instant
// any change happens, and a NEW backlog item also fires the
// notifyOnBacklogItemCreated Cloud Function (see ../functions/index.js)
// automatically — no "Notify Claude" button for anyone to remember to click.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getFirestore, collection, addDoc, updateDoc, deleteDoc, doc,
  onSnapshot, query, orderBy, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const itemsRef = collection(db, "backlogItems");

const COLUMNS = [
  { key: "backlog", label: "Backlog" },
  { key: "ready-for-testing", label: "Ready for Testing" },
  { key: "ready-to-publish", label: "Live on Feature Branch" },
  { key: "published-live", label: "Merged to Main (Live)" },
];
const COL_KEYS = COLUMNS.map((c) => c.key);

const CATEGORIES = [
  "Pricing & Offers", "Product Assets", "HQ Admin", "Retail Admin",
  "Menu Board", "Backend / Infrastructure", "Uncategorised",
];

function escapeHTML(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

let items = [];

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
  // Testing/Live-on-branch still get a plain forward move too, for the
  // non-approval columns (mirrors the Claude Artifact board's own rule:
  // only Testing->LiveBranch and LiveBranch->Merged are deliberate CTAs).
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
        ${deleteBtn}
      </div>
      ${approveBtn}${mergeBtn}
    </article>`;
}

function render() {
  let total = 0;
  COLUMNS.forEach((col) => {
    const list = items.filter((i) => i.status === col.key);
    total += list.length;
    const el = document.getElementById("col-" + col.key);
    el.innerHTML = list.length ? list.map(cardHTML).join("") : '<div class="empty-hint">No items yet</div>';
    document.getElementById("count-" + col.key).textContent = String(list.length);
  });
  document.getElementById("total-summary").textContent = `${total} item${total === 1 ? "" : "s"}`;
}

onSnapshot(query(itemsRef, orderBy("createdAt", "desc")), (snap) => {
  items = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((i) => i.status !== "archived");
  render();
}, (err) => {
  console.error("backlog-tracker: Firestore listener error", err);
});

async function addItem(title, desc, type, category) {
  await addDoc(itemsRef, {
    title, desc, type, category,
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

document.getElementById("board").addEventListener("click", (e) => {
  const moveBtn = e.target.closest(".move-btn");
  if (moveBtn) { moveItem(moveBtn.dataset.id, parseInt(moveBtn.dataset.dir, 10)); return; }
  const delBtn = e.target.closest(".delete-btn");
  if (delBtn) { removeItem(delBtn.dataset.id); return; }
});

// ── New Item modal ─────────────────────────────────────────────────────
const backdrop = document.getElementById("ni-backdrop");
const categorySelect = document.getElementById("ni-category-input");
categorySelect.innerHTML = CATEGORIES.map((c) => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join("");

function openModal() { backdrop.hidden = false; document.getElementById("ni-title-input").focus(); }
function closeModal() {
  backdrop.hidden = true;
  document.getElementById("ni-title-input").value = "";
  document.getElementById("ni-desc-input").value = "";
  document.querySelectorAll(".type-opt").forEach((b) => b.classList.remove("active"));
  document.querySelector('.type-opt[data-type="feature"]').classList.add("active");
}

document.getElementById("new-item-btn").addEventListener("click", openModal);
document.getElementById("ni-cancel").addEventListener("click", closeModal);
document.getElementById("ni-close").addEventListener("click", closeModal);
backdrop.addEventListener("click", (e) => { if (e.target === backdrop) closeModal(); });

document.querySelectorAll(".type-opt").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".type-opt").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  });
});

document.getElementById("ni-submit").addEventListener("click", async () => {
  const title = document.getElementById("ni-title-input").value.trim();
  const desc = document.getElementById("ni-desc-input").value.trim();
  const type = document.querySelector(".type-opt.active").dataset.type;
  const category = categorySelect.value;
  if (!title || !desc) return;
  await addItem(title, desc, type, category);
  closeModal();
});
