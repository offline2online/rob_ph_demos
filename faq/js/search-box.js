// Live search dropdown shared by every FAQ page's header search box.
// Fetches the published-article set once per page load (small dataset —
// a help center's worth of articles, not backlogItems-scale) and filters
// client-side as the visitor types.
import { fetchPublishedArticles, fetchCategories, matchesQuery, escapeHTML } from "./faq-data.js";

export async function initSearchBox() {
  const input = document.getElementById("faq-search");
  const results = document.getElementById("faq-search-results");
  if (!input || !results) return;

  const [articles, categories] = await Promise.all([fetchPublishedArticles(), fetchCategories()]);
  const catName = (id) => (categories.find((c) => c.id === id) || {}).name || "";

  function render(q) {
    const matches = articles.filter((a) => matchesQuery(a, q));
    if (!q.trim()) { results.hidden = true; results.innerHTML = ""; return; }
    if (matches.length === 0) {
      results.innerHTML = `<div class="sr-empty">No articles match "${escapeHTML(q)}".</div>`;
    } else {
      const top = matches.slice(0, 8);
      results.innerHTML = top.map((a) => `
        <a href="article.html?id=${encodeURIComponent(a.id)}">
          <div class="sr-title">${escapeHTML(a.title)}</div>
          <div class="sr-cat">${escapeHTML(catName(a.categoryId))}</div>
        </a>
      `).join("") + (matches.length > top.length
        ? `<a class="sr-more" href="search.html?q=${encodeURIComponent(q)}">See all ${matches.length} results</a>`
        : "");
    }
    results.hidden = false;
  }

  input.addEventListener("input", () => render(input.value));
  input.addEventListener("focus", () => { if (input.value.trim()) render(input.value); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && input.value.trim()) {
      window.location.href = `search.html?q=${encodeURIComponent(input.value.trim())}`;
    }
    if (e.key === "Escape") { results.hidden = true; input.blur(); }
  });
  document.addEventListener("click", (e) => {
    if (!results.contains(e.target) && e.target !== input) results.hidden = true;
  });
}
