import { fetchCategories, fetchPublishedArticles, escapeHTML, categoryIcon, docTypeLabel, safeId,
  subCategoriesOf, articlesIn, articlesUnder, topLevelCategories } from "./faq-data.js";
import { iconSvg } from "./icons.js";
import { bootPage, showLoadError, restoreScrollMemory } from "./page-common.js";

bootPage();

const id = safeId(new URLSearchParams(window.location.search).get("id"));
const list = document.getElementById("article-list");

try {
  const [categories, articles] = await Promise.all([fetchCategories(), fetchPublishedArticles()]);
  let category = categories.find((c) => c.id === id);
  // A folder id lands on its parent category page, scrolled to the folder.
  let focusFolder = null;
  if (category && category.parentId) { focusFolder = category.id; category = categories.find((c) => c.id === category.parentId); }

  if (!category) {
    document.getElementById("cat-name").textContent = "Category not found";
    const empty = document.getElementById("article-empty");
    empty.hidden = false; empty.textContent = "This category doesn't exist or hasn't been published.";
  } else {
    document.title = `${category.name} — Personalisation Hub Help Centre`;
    document.getElementById("crumb-cat").textContent = category.name;
    document.getElementById("cat-name").textContent = category.name;
    document.getElementById("cat-desc").textContent = category.description || "";
    document.getElementById("cat-icon").innerHTML = iconSvg(categoryIcon(category), 20);

    const row = (a, n) => `
      <a class="article-row" href="article.html?id=${encodeURIComponent(a.id)}">
        <span class="row-num">${n}</span>
        <span class="row-main">
          <h3>${escapeHTML(a.title)} <span class="doctype-badge doctype-badge-inline">${escapeHTML(docTypeLabel(a))}</span></h3>
          <p>${escapeHTML(a.summary || "")}</p>
        </span>
        <span class="row-chevron">${iconSvg("chevron_right", 20)}</span>
      </a>`;

    const all = articlesUnder(articles, categories, category.id);
    if (all.length === 0) {
      document.getElementById("article-empty").hidden = false;
    } else {
      let n = 0;
      const sections = [];
      const loose = articlesIn(articles, category.id);
      if (loose.length) sections.push(loose.map((a) => row(a, ++n)).join(""));
      for (const sub of subCategoriesOf(categories, category.id)) {
        const subArticles = articlesIn(articles, sub.id);
        if (!subArticles.length) continue;
        sections.push(`
          <section class="folder-section" id="${escapeHTML(sub.id)}">
            <h2 class="folder-heading">${iconSvg("folder", 18, "icon folder-heading-icon")} ${escapeHTML(sub.name)}</h2>
            ${sub.description ? `<p class="folder-desc">${escapeHTML(sub.description)}</p>` : ""}
            ${subArticles.map((a) => row(a, ++n)).join("")}
          </section>`);
      }
      list.innerHTML = sections.join("");
      if (focusFolder) { const el = document.getElementById(focusFolder); if (el) el.scrollIntoView({ block: "start" }); }
    }

    // Previous / next category in the set-up order.
    const top = topLevelCategories(categories);
    const i = top.findIndex((c) => c.id === category.id);
    const prev = i > 0 ? top[i - 1] : null;
    const next = i >= 0 && i < top.length - 1 ? top[i + 1] : null;
    document.getElementById("cat-nav").innerHTML =
      (prev ? `<a class="nav-prev" href="category.html?id=${encodeURIComponent(prev.id)}">${iconSvg("arrow_back", 16)} ${escapeHTML(prev.name)}</a>` : "<span></span>") +
      (next ? `<a class="nav-next" href="category.html?id=${encodeURIComponent(next.id)}">${escapeHTML(next.name)} ${iconSvg("arrow_forward", 16)}</a>` : "");
  }
  list.removeAttribute("aria-busy");
  restoreScrollMemory();
} catch (err) {
  console.error("help centre: failed to load category", err);
  document.getElementById("cat-name").textContent = "Help Centre";
  showLoadError();
}
