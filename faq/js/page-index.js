import { fetchCategories, fetchPublishedArticles, escapeHTML, categoryIcon, topLevelCategories, articlesUnder } from "./faq-data.js";
import { iconSvg } from "./icons.js";
import { bootPage, showLoadError, restoreScrollMemory } from "./page-common.js";

bootPage();

try {
  const [categories, articles] = await Promise.all([fetchCategories(), fetchPublishedArticles()]);
  const grid = document.getElementById("cat-grid");
  const top = topLevelCategories(categories);
  if (top.length === 0) {
    document.getElementById("cat-empty").hidden = false;
  } else {
    // One tile per top-level category, in the order set in the admin —
    // which is the order a new customer works through the platform.
    grid.innerHTML = top.map((c, i) => {
      const count = articlesUnder(articles, categories, c.id).length;
      return `
        <a class="cat-card" href="category.html?id=${encodeURIComponent(c.id)}">
          <div class="cat-top"><div class="cat-icon">${iconSvg(categoryIcon(c), 22)}</div><span class="cat-step">${i + 1}</span></div>
          <h2>${escapeHTML(c.name)}</h2>
          <p>${escapeHTML(c.description || "")}</p>
          <div class="cat-count">${count} article${count === 1 ? "" : "s"}</div>
        </a>`;
    }).join("");
  }
  grid.removeAttribute("aria-busy");
  restoreScrollMemory();
} catch (err) {
  console.error("help centre: failed to load index", err);
  showLoadError();
}
