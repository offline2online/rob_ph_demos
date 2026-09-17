// Read-only data layer for the public FAQ / Help Center site.
//
// Content is served from a STATIC SNAPSHOT committed to this repo
// (faq/data/index.json + faq/data/articles/<id>.json) and delivered by
// GitHub Pages' CDN — one small cached request for the index on every page,
// and one for the article body being read. Nothing here depends on the
// Firebase SDK, and the site renders even if Firestore is unreachable.
//
// Firestore (project backlog-tracker-e4ed2, collections faqCategories /
// faqArticles) is still where content is EDITED, from backlog-tracker's
// FAQ Management page. Two things keep the snapshot current:
//   1. `.github/workflows/faq-content.yml` exports Firestore → faq/data on a
//      schedule and on demand (Actions → "FAQ content" → Run workflow).
//   2. The article page additionally fetches the single article document
//      straight from Firestore's REST API in the background and swaps the
//      body in when Firestore holds a newer published revision — so an edit
//      made in the console is visible on its article page within seconds,
//      without waiting for the export. If that request fails or is slow the
//      static copy simply stays.
//
// The site never writes. Editing lives entirely in the admin console.
import { firebaseConfig } from "./firebase-config.js";

const INDEX_URL = "data/index.json";
const ARTICLE_URL = (id) => `data/articles/${encodeURIComponent(id)}.json`;
const REST_BASE = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents`;
const LIVE_TIMEOUT_MS = 2500;
const SESSION_KEY = "ph-faq-index-v2";

// Article ids are Firestore document ids we generate ourselves; anything
// else is rejected before it can reach a URL or a lookup.
export const ID_RE = /^[a-zA-Z0-9_-]{1,120}$/;
export function safeId(id) { return typeof id === "string" && ID_RE.test(id) ? id : null; }

// ── Embedding ─────────────────────────────────────────────────────────────
// This site is both a standalone public Help Center and content iframed
// into personalisationhub.com's support centre. When embedded we hide our
// own header (the host page has one) and tell the parent how tall we are
// so it can size the iframe without a scrollbar.
export function isEmbedded() {
  try { return window.self !== window.top; } catch { return true; }
}
export function initEmbedMode() {
  if (!isEmbedded()) return;
  document.documentElement.classList.add("embedded");
  const header = document.querySelector(".ph-header");
  if (header) header.hidden = true;
  // Every page here (including an article's own Previous/Next/Related
  // links) is a plain full navigation, not a client-side route — the new
  // document always starts scrolled to (0,0) *inside the iframe*. But
  // because we hand our real height to the host so it can size the iframe
  // with no scrollbar of its own (see the height postMessage below), it's
  // the HOST page that actually scrolls, and its scroll position doesn't
  // reset just because our content underneath it changed. Left alone, a
  // reader who scrolled down to click "Next article" lands mid-way or at
  // the bottom of the article that loads next. Ask the host to scroll back
  // to the top of the iframe on every fresh load so it can't happen — this
  // is a one-time request per page load, never repeated from the
  // ResizeObserver below, so it never yanks a reader back to the top while
  // they're mid-scroll on the article they're already reading.
  try { window.parent.postMessage({ type: "ph-faq:scrollTop" }, "*"); } catch { /* ignore */ }
  const post = () => {
    try { window.parent.postMessage({ type: "ph-faq:height", height: document.documentElement.scrollHeight }, "*"); } catch { /* ignore */ }
  };
  post();
  if ("ResizeObserver" in window) new ResizeObserver(post).observe(document.body);
  window.addEventListener("load", post);
}

export function escapeHTML(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ── Index (categories + article metadata) ─────────────────────────────────
let indexPromise = null;
export function loadIndex() {
  if (indexPromise) return indexPromise;
  indexPromise = (async () => {
    // sessionStorage keeps navigation between pages instant; the server
    // copy is still re-validated by the browser's normal HTTP caching.
    try {
      const cached = sessionStorage.getItem(SESSION_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && parsed.savedAt && Date.now() - parsed.savedAt < 5 * 60 * 1000) return parsed.data;
      }
    } catch { /* storage unavailable — fall through */ }
    const res = await fetch(INDEX_URL, { cache: "default" });
    if (!res.ok) throw new Error(`index ${res.status}`);
    const data = await res.json();
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ savedAt: Date.now(), data })); } catch { /* ignore */ }
    return data;
  })();
  return indexPromise;
}

export async function fetchCategories() {
  const idx = await loadIndex();
  return [...idx.categories].sort((a, b) => (a.order || 0) - (b.order || 0));
}
export async function fetchPublishedArticles() {
  const idx = await loadIndex();
  return idx.articles.filter((a) => a.status === "published");
}

// ── Article bodies ────────────────────────────────────────────────────────
export async function fetchArticleBody(id) {
  const sid = safeId(id);
  if (!sid) return null;
  const res = await fetch(ARTICLE_URL(sid), { cache: "default" });
  if (!res.ok) return null;
  const a = await res.json();
  return a && a.status === "published" ? a : null;
}

// Background freshness check against Firestore. Resolves to the live
// article when it is published and newer than the static copy, else null.
export async function fetchLiveArticleIfNewer(id, staticUpdatedAt) {
  const sid = safeId(id);
  if (!sid || !navigator.onLine) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LIVE_TIMEOUT_MS);
  try {
    const res = await fetch(`${REST_BASE}/faqArticles/${encodeURIComponent(sid)}?key=${encodeURIComponent(firebaseConfig.apiKey)}`, { signal: ctrl.signal });
    if (!res.ok) return null;
    const doc = await res.json();
    const f = doc.fields || {};
    const str = (k) => (f[k] && f[k].stringValue) || "";
    const live = {
      id: sid, title: str("title"), bodyMd: str("bodyMd"), status: str("status"), docType: str("docType"),
      updatedAt: (f.updatedAt && f.updatedAt.timestampValue) || "",
    };
    if (live.status !== "published" || !live.bodyMd) return null;
    if (staticUpdatedAt && live.updatedAt && Date.parse(live.updatedAt) <= Date.parse(staticUpdatedAt)) return null;
    return live;
  } catch { return null; } finally { clearTimeout(timer); }
}

// ── Categories, sub-categories, ordering ──────────────────────────────────
export function topLevelCategories(categories) { return categories.filter((c) => !c.parentId); }
export function subCategoriesOf(categories, parentId) { return categories.filter((c) => c.parentId === parentId); }
export function articlesIn(articles, categoryId) {
  return articles.filter((a) => a.categoryId === categoryId).sort((a, b) => (a.order || 0) - (b.order || 0));
}
// Everything under a category, folders included, in reading order:
// loose articles first, then each folder's articles in folder order.
export function articlesUnder(articles, categories, categoryId) {
  const out = [...articlesIn(articles, categoryId)];
  for (const sub of subCategoriesOf(categories, categoryId)) out.push(...articlesIn(articles, sub.id));
  return out;
}
export function parentCategoryOf(categories, categoryId) {
  const c = categories.find((x) => x.id === categoryId);
  if (!c) return null;
  return c.parentId ? categories.find((x) => x.id === c.parentId) || c : c;
}

// ── Rendering ─────────────────────────────────────────────────────────────
// Bodies are HTML authored in the admin's rich-text editor. They are
// sanitised with DOMPurify at render time, every time — the snapshot is
// generated from Firestore, and Firestore is an editable store, so the
// body is data, not code, regardless of where it was loaded from.
// Only YouTube/Vimeo player iframes are permitted (the editor's video
// embed); every other iframe is removed outright.
const ALLOWED_IFRAME_HOSTS = ["www.youtube.com", "www.youtube-nocookie.com", "player.vimeo.com"];
const ALLOWED_URI = /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;
let hooksInstalled = false;
function installHooks(purify) {
  if (hooksInstalled) return;
  hooksInstalled = true;
  purify.addHook("uponSanitizeElement", (node, data) => {
    if (data.tagName !== "iframe") return;
    let host = "";
    try { host = new URL(node.getAttribute("src") || "", window.location.href).hostname; } catch { host = ""; }
    if (!ALLOWED_IFRAME_HOSTS.includes(host)) node.remove();
    else { node.setAttribute("loading", "lazy"); node.setAttribute("referrerpolicy", "strict-origin-when-cross-origin"); node.setAttribute("sandbox", "allow-scripts allow-same-origin allow-presentation"); }
  });
  purify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      const href = node.getAttribute("href") || "";
      const external = /^https?:\/\//i.test(href) && !href.startsWith(window.location.origin);
      if (external) { node.setAttribute("target", "_blank"); node.setAttribute("rel", "noopener noreferrer"); }
      else if (node.getAttribute("target") === "_blank") node.setAttribute("rel", "noopener noreferrer");
    }
  });
}

export function renderBody(content) {
  const trimmed = (content || "").trim();
  if (!trimmed) return "";
  if (!trimmed.startsWith("<")) return renderLegacyMarkdown(trimmed);
  const purify = window.DOMPurify;
  if (!purify) return `<p>${escapeHTML(trimmed)}</p>`;
  installHooks(purify);
  return purify.sanitize(trimmed, {
    ADD_TAGS: ["iframe"],
    ADD_ATTR: ["allowfullscreen", "frameborder", "target", "loading", "referrerpolicy", "sandbox"],
    ALLOWED_URI_REGEXP: ALLOWED_URI,
    FORBID_TAGS: ["style", "form", "input", "button", "object", "embed", "svg", "math"],
    FORBID_ATTR: ["style", "onerror", "onload"],
  });
}
// Kept for any article saved before the rich-text editor existed.
export const renderBodyMd = renderBody;

function renderLegacyMarkdown(md) {
  const lines = escapeHTML(md || "").split(/\r?\n/);
  let html = ""; let inList = false;
  const closeList = () => { if (inList) { html += "</ul>"; inList = false; } };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { closeList(); continue; }
    if (line.startsWith("## ")) { closeList(); html += `<h2>${line.slice(3)}</h2>`; continue; }
    if (line.startsWith("- ")) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${inlineMd(line.slice(2))}</li>`; continue; }
    closeList(); html += `<p>${inlineMd(line)}</p>`;
  }
  closeList();
  return html;
}
function inlineMd(s) { return s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>"); }

export function categoryIcon(cat) { return cat && cat.icon ? cat.icon : "help"; }

const DOC_TYPE_LABELS = { faq: "FAQ", "how-to": "How-to guide", reference: "Reference", explanation: "Explanation" };
export function docTypeLabel(article) { return DOC_TYPE_LABELS[article && article.docType] || DOC_TYPE_LABELS.faq; }

// ── Search ────────────────────────────────────────────────────────────────
// Word-based scoring over title, summary and keywords: every query term
// must match somewhere; title matches rank first, then keyword, then summary.
export function searchArticles(articles, q) {
  const terms = String(q || "").toLowerCase().split(/\s+/).map((t) => t.trim()).filter((t) => t.length > 1);
  if (!terms.length) return [];
  const scored = [];
  for (const a of articles) {
    const title = (a.title || "").toLowerCase();
    const summary = (a.summary || "").toLowerCase();
    const kws = (a.keywords || []).map((k) => String(k).toLowerCase());
    let score = 0; let all = true;
    for (const t of terms) {
      let s = 0;
      if (title.includes(t)) s += title.startsWith(t) ? 12 : 8;
      if (kws.some((k) => k.includes(t))) s += 5;
      if (summary.includes(t)) s += 2;
      if (!s) { all = false; break; }
      score += s;
    }
    if (all) scored.push({ a, score });
  }
  return scored.sort((x, y) => y.score - x.score || (x.a.order || 0) - (y.a.order || 0)).map((x) => x.a);
}
export function matchesQuery(article, q) { return searchArticles([article], q).length > 0; }

export function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
}
