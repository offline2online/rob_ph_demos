import { fetchCategories, fetchPublishedArticles, escapeHTML, searchArticles, docTypeLabel, parentCategoryOf } from "./faq-data.js";
import { iconSvg } from "./icons.js";
import { bootPage, showLoadError } from "./page-common.js";

bootPage();

const q = (new URLSearchParams(window.location.search).get("q") || "").slice(0, 200);
document.getElementById("faq-search").value = q;
const list = document.getElementById("results-list");

try {
  const [categories, articles] = await Promise.all([fetchCategories(), fetchPublishedArticles()]);
  const catName = (cid) => { const c = parentCategoryOf(categories, cid); return c ? c.name : ""; };
  const matches = searchArticles(articles, q);
  document.getElementById("results-heading").textContent =
    q ? `${matches.length} result${matches.length === 1 ? "" : "s"} for "${q}"` : "Search results";
  document.title = q ? `Search: ${q} — Personalisation Hub Help Centre` : document.title;
  if (matches.length === 0) {
    document.getElementById("results-empty").hidden = false;
  } else {
    list.innerHTML = matches.map((a) => `
      <a class="article-row" href="article.html?id=${encodeURIComponent(a.id)}">
        <span class="row-main">
          <h3>${escapeHTML(a.title)} <span class="doctype-badge doctype-badge-inline">${escapeHTML(docTypeLabel(a))}</span></h3>
          <p><span class="row-cat">${escapeHTML(catName(a.categoryId))}</span> &middot; ${escapeHTML(a.summary || "")}</p>
        </span>
        <span class="row-chevron">${iconSvg("chevron_right", 20)}</span>
      </a>`).join("");
  }
  list.removeAttribute("aria-busy");
} catch (err) {
  console.error("help centre: failed to load search", err);
  showLoadError();
}
