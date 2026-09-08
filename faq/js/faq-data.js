// Shared read-only Firestore access for the public FAQ / Help Center site.
// This site never writes — all editing happens from backlog-tracker's own
// "FAQ Center" admin page (backlog-tracker/public/index.html + js/app.js),
// which writes to this exact same Firestore project. Only status:"published"
// articles are ever shown here; "draft" is how an in-progress edit stays
// invisible to visitors until someone flips it live.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getFirestore, collection, getDocs, query, orderBy,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const categoriesRef = collection(db, "faqCategories");
const articlesRef = collection(db, "faqArticles");

export function escapeHTML(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export async function fetchCategories() {
  const snap = await getDocs(query(categoriesRef, orderBy("order", "asc")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Fetches ALL articles ordered by "order" (a single-field query — no
// composite index needed) and filters to status:"published" client-side.
// Deliberately not `where("status","==",...) + orderBy("order",...)`,
// which is a compound query Firestore needs a composite index for; this
// repo has no firestore.indexes.json and the deploy workflow doesn't
// deploy one, so that query would fail at runtime with
// FAILED_PRECONDITION. The article set is help-center-sized, not
// backlogItems-scale, so fetching all of them is cheap either way.
export async function fetchPublishedArticles() {
  const snap = await getDocs(query(articlesRef, orderBy("order", "asc")));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((a) => a.status === "published");
}

// Very small markdown-ish renderer for article bodies (## headings, blank
// lines as paragraph breaks, "- " bullet lists, **bold**) — keeps this
// site dependency-free rather than pulling in a full markdown library for
// a handful of formatting needs. Escaped first, so article bodies can
// never inject markup.
export function renderBodyMd(md) {
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
      html += `<li>${inlineMd(line.slice(2))}</li>`;
      continue;
    }
    closeList();
    html += `<p>${inlineMd(line)}</p>`;
  }
  closeList();
  return html;
}

function inlineMd(s) {
  return s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

export function categoryIcon(cat) {
  return cat && cat.icon ? cat.icon : "help";
}

export function matchesQuery(article, q) {
  const needle = q.trim().toLowerCase();
  if (!needle) return false;
  const haystacks = [
    article.title, article.summary, ...(article.keywords || []),
  ].filter(Boolean).map((s) => s.toLowerCase());
  return haystacks.some((h) => h.includes(needle));
}
