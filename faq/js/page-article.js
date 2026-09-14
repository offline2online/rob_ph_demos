import { fetchCategories, fetchPublishedArticles, fetchArticleBody, fetchLiveArticleIfNewer, escapeHTML, categoryIcon,
  renderBody, docTypeLabel, safeId, articlesUnder, parentCategoryOf, formatDate } from "./faq-data.js";
import { iconSvg } from "./icons.js";
import { bootPage, showLoadError } from "./page-common.js";

bootPage();

const id = safeId(new URLSearchParams(window.location.search).get("id"));
const $ = (i) => document.getElementById(i);

function notFound() {
  $("article-title").textContent = "Article not found";
  $("crumb-article").textContent = "Not found";
  $("article-empty").hidden = false;
  document.title = "Article not found — Personalisation Hub Help Centre";
  $("article-content").removeAttribute("aria-busy");
}

// Build the "On this page" list from the rendered H2s and give each an id.
function buildToc(bodyEl) {
  const h2s = [...bodyEl.querySelectorAll("h2")];
  const skip = new Set(["related", "next step"]);
  const entries = h2s.map((h) => {
    const text = h.textContent.trim();
    const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section";
    h.id = h.id || slug;
    return { h, text };
  }).filter((e) => !skip.has(e.text.toLowerCase()));
  if (entries.length < 3) return;
  $("toc-list").innerHTML = entries.map((e) => `<li><a href="#${escapeHTML(e.h.id)}">${escapeHTML(e.text)}</a></li>`).join("");
  $("toc").hidden = false;
  document.querySelector(".article-layout").classList.add("has-toc");
}

function renderArticle(article, categories, articles) {
  const folder = categories.find((c) => c.id === article.categoryId);
  const category = parentCategoryOf(categories, article.categoryId);
  document.title = `${article.title} — Personalisation Hub Help Centre`;
  $("article-title").textContent = article.title;
  $("crumb-article").textContent = article.title;
  const body = $("article-body");
  body.innerHTML = renderBody(article.bodyMd);
  buildToc(body);
  const badge = $("doctype-badge");
  badge.textContent = docTypeLabel(article); badge.hidden = false;
  if (article.summary) $("article-meta").textContent = article.summary;
  if (article.updatedAt) { const u = $("article-updated"); u.textContent = `Last updated ${formatDate(article.updatedAt)}`; u.hidden = false; }

  if (category) {
    $("crumb-cat").textContent = category.name;
    $("crumb-cat-link").href = `category.html?id=${encodeURIComponent(category.id)}`;
    if (folder && folder.id !== category.id) {
      $("crumb-folder").textContent = folder.name; $("crumb-folder").hidden = false; $("crumb-folder-sep").hidden = false;
    }
    const cb = $("cat-badge"); cb.hidden = false;
    $("cat-badge-icon").innerHTML = iconSvg(categoryIcon(category), 14);
    $("cat-badge-name").textContent = category.name;

    // Previous / next follow the category's reading order (folders included).
    const seq = articlesUnder(articles, categories, category.id);
    const i = seq.findIndex((a) => a.id === article.id);
    const prev = i > 0 ? seq[i - 1] : null;
    const next = i >= 0 && i < seq.length - 1 ? seq[i + 1] : null;
    $("article-nav").innerHTML =
      (prev ? `<a class="nav-prev" href="article.html?id=${encodeURIComponent(prev.id)}"><span class="nav-label">${iconSvg("arrow_back", 16)} Previous</span><span class="nav-title">${escapeHTML(prev.title)}</span></a>` : "<span></span>") +
      (next ? `<a class="nav-next" href="article.html?id=${encodeURIComponent(next.id)}"><span class="nav-label">Next ${iconSvg("arrow_forward", 16)}</span><span class="nav-title">${escapeHTML(next.title)}</span></a>` : "");

    // "More in this section": the nearest siblings in the same folder/category.
    const siblingsSrc = folder && folder.id !== category.id ? seq.filter((a) => a.categoryId === folder.id) : seq;
    const related = siblingsSrc.filter((a) => a.id !== article.id).slice(0, 5);
    if (related.length) {
      $("related-block").hidden = false;
      $("related-list").innerHTML = related.map((a) => `
        <a class="article-row" href="article.html?id=${encodeURIComponent(a.id)}">
          <span class="row-main"><h3>${escapeHTML(a.title)} <span class="doctype-badge doctype-badge-inline">${escapeHTML(docTypeLabel(a))}</span></h3><p>${escapeHTML(a.summary || "")}</p></span>
          <span class="row-chevron">${iconSvg("chevron_right", 20)}</span>
        </a>`).join("");
    }
  }
  $("article-content").removeAttribute("aria-busy");
  if (window.location.hash) { const t = document.getElementById(window.location.hash.slice(1)); if (t) t.scrollIntoView(); }
}

try {
  if (!id) { notFound(); }
  else {
    const [categories, articles, full] = await Promise.all([fetchCategories(), fetchPublishedArticles(), fetchArticleBody(id)]);
    const meta = articles.find((a) => a.id === id);
    if (!meta || !full) { notFound(); }
    else {
      const article = { ...meta, ...full };
      renderArticle(article, categories, articles);
      // Freshness: swap in a newer published revision from Firestore if one exists.
      fetchLiveArticleIfNewer(id, article.updatedAt).then((live) => {
        if (!live) return;
        renderArticle({ ...article, ...live }, categories, articles);
      });
    }
  }
} catch (err) {
  console.error("help centre: failed to load article", err);
  $("article-title").textContent = "Help Centre";
  showLoadError();
}
