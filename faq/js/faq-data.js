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

// This site is both a standalone, bookmarkable public Help Center AND
// content that gets iframed into personalisationhub.com itself (the public
// WordPress/Elementor marketing site — NOT the HQ Admin/Retail Admin
// platform app, a separate design system this site has nothing to do
// with). On that embed, only the very top of the page is WordPress's own
// Elementor-managed header; everything below it, footer included, is this
// iframe's content and still ours to render. So: suppress just our own
// .ph-header when embedded (it would otherwise duplicate WordPress's), but
// always keep our own footer — nothing else replaces it.
export function isEmbedded() {
  try { return window.self !== window.top; } catch { return true; }
}

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

// Article bodies come in one of two shapes, told apart by a leading "<":
// legacy markdown-ish text (## headings, "- " bullets, **bold**, from
// before the FAQ admin had a real editor) or real HTML from the rich-text
// (Quill) editor backlog-tracker's FAQ admin now uses. Legacy content is
// escaped-then-rendered by renderLegacyMarkdown below, same as always.
// Real HTML is sanitized with DOMPurify before ever touching innerHTML —
// Firestore's write rules on faqArticles are wide open (see root
// CLAUDE.md's documented prototype-stage posture), so this field is never
// trusted just because it "should" have come through the admin's editor;
// sanitizing here, at render time, is what actually keeps a stored-XSS
// payload from running for every visitor of this public site.
export function renderBodyMd(content) {
  const trimmed = (content || "").trim();
  if (trimmed.startsWith("<")) {
    if (!window.DOMPurify) return escapeHTML(trimmed);
    // Quill's own video embed wraps a URL in an <iframe> — DOMPurify's
    // default allowlist excludes iframe (and doesn't restrict `src` by
    // domain for tags it does allow), so an iframe here can point
    // anywhere. Accepted prototype-stage tradeoff, same posture as this
    // repo's open Firestore rules elsewhere — tighten (e.g. an allowed-host
    // check on the src) before this is exposed beyond an internal team.
    return window.DOMPurify.sanitize(trimmed, { ADD_TAGS: ["iframe"], ADD_ATTR: ["allowfullscreen", "frameborder"] });
  }
  return renderLegacyMarkdown(content);
}

function renderLegacyMarkdown(md) {
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

// Diátaxis document type (docs/CONTRIBUTING-docs.md §2) — defaults to
// "faq" for articles saved before this field existed, same default the
// admin editor uses for a brand-new article.
const DOC_TYPE_LABELS = {
  faq: "FAQ",
  "how-to": "How-to guide",
  reference: "Reference",
  explanation: "Explanation",
};
export function docTypeLabel(article) {
  return DOC_TYPE_LABELS[article && article.docType] || DOC_TYPE_LABELS.faq;
}

export function matchesQuery(article, q) {
  const needle = q.trim().toLowerCase();
  if (!needle) return false;
  const haystacks = [
    article.title, article.summary, ...(article.keywords || []),
  ].filter(Boolean).map((s) => s.toLowerCase());
  return haystacks.some((h) => h.includes(needle));
}
