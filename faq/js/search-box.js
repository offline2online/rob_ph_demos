// Live search dropdown shared by every page's search box. Searches the
// index metadata (title / summary / keywords) client-side — no request per
// keystroke. Keyboard: ↑/↓ move, Enter opens (or goes to the results page
// when nothing is highlighted), Esc closes.
import { fetchPublishedArticles, fetchCategories, searchArticles, escapeHTML, parentCategoryOf } from "./faq-data.js";

export async function initSearchBox() {
  const input = document.getElementById("faq-search");
  const results = document.getElementById("faq-search-results");
  if (!input || !results) return;
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", results.id);
  input.setAttribute("aria-autocomplete", "list");
  results.setAttribute("role", "listbox");

  const [articles, categories] = await Promise.all([fetchPublishedArticles(), fetchCategories()]);
  const catName = (id) => { const c = parentCategoryOf(categories, id); return c ? c.name : ""; };
  let active = -1;

  function close() { results.hidden = true; results.innerHTML = ""; input.setAttribute("aria-expanded", "false"); active = -1; }
  function render(q) {
    if (!q.trim()) { close(); return; }
    const matches = searchArticles(articles, q);
    active = -1;
    if (matches.length === 0) {
      results.innerHTML = `<div class="sr-empty">No articles match "${escapeHTML(q)}".</div>`;
    } else {
      const top = matches.slice(0, 8);
      results.innerHTML = top.map((a) => `
        <a role="option" href="article.html?id=${encodeURIComponent(a.id)}">
          <div class="sr-title">${escapeHTML(a.title)}</div>
          <div class="sr-cat">${escapeHTML(catName(a.categoryId))}</div>
        </a>`).join("") + (matches.length > top.length
        ? `<a class="sr-more" href="search.html?q=${encodeURIComponent(q.trim())}">See all ${matches.length} results</a>` : "");
    }
    results.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }
  function highlight(delta) {
    const items = [...results.querySelectorAll("a")];
    if (!items.length) return;
    active = (active + delta + items.length) % items.length;
    items.forEach((el, i) => el.classList.toggle("sr-active", i === active));
    items[active].scrollIntoView({ block: "nearest" });
  }

  let debounce = 0;
  input.addEventListener("input", () => { clearTimeout(debounce); debounce = setTimeout(() => render(input.value), 60); });
  input.addEventListener("focus", () => { if (input.value.trim()) render(input.value); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); highlight(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); highlight(-1); }
    else if (e.key === "Enter") {
      const items = results.querySelectorAll("a");
      if (active >= 0 && items[active]) { window.location.href = items[active].getAttribute("href"); }
      else if (input.value.trim()) { window.location.href = `search.html?q=${encodeURIComponent(input.value.trim())}`; }
    }
    else if (e.key === "Escape") { close(); input.blur(); }
  });
  document.addEventListener("click", (e) => { if (!results.contains(e.target) && e.target !== input) close(); });
}
