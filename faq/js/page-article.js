import { fetchCategories, fetchPublishedArticles, fetchArticleBody, fetchLiveArticleIfNewer, escapeHTML, categoryIcon,
  renderBody, docTypeLabel, safeId, articlesUnder, parentCategoryOf, formatDate } from "./faq-data.js";
import { iconSvg } from "./icons.js";
import { bootPage, showLoadError, trackEvent } from "./page-common.js";
import { enhanceCopyBlocks } from "./copy-block.js";

bootPage();

const id = safeId(new URLSearchParams(window.location.search).get("id"));
const $ = (i) => document.getElementById(i);

// H2 sections neither the "On this page" TOC nor the section picker (below)
// treat as a topic of their own — cross-links relevant regardless of which
// section a reader picked, not a section to narrow away from.
const NON_TOPIC_SECTIONS = new Set(["related", "next step"]);

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
  const entries = h2s.map((h) => {
    const text = h.textContent.trim();
    const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section";
    h.id = h.id || slug;
    return { h, text };
  }).filter((e) => !NON_TOPIC_SECTIONS.has(e.text.toLowerCase()));
  if (entries.length < 3) return;
  $("toc-list").innerHTML = entries.map((e) => `<li><a href="#${escapeHTML(e.h.id)}">${escapeHTML(e.text)}</a></li>`).join("");
  $("toc").hidden = false;
  document.querySelector(".article-layout").classList.add("has-toc");
}

// Editor-controlled topic/industry picker (faqArticles.sectionPicker,
// fJ4kR2vTsWmXoP81nQeH): splits the rendered body into one block per H2 and
// lets a reader narrow to just one, right under the introduction (the
// content before the first H2, which is left untouched above the picker).
// "Related"/"Next step" are excluded from the split, same as the TOC above,
// so they stay visible regardless of which section is picked. This works on
// any article with 2+ real H2 sections — no per-article code, an editor
// just writes normal H2 sections and flips the toggle on.
function initSectionPicker(bodyEl, article) {
  if (!article.sectionPicker) return;
  const h2s = [...bodyEl.querySelectorAll("h2")].filter((h) => !NON_TOPIC_SECTIONS.has(h.textContent.trim().toLowerCase()));
  if (h2s.length < 2) return;

  h2s.forEach((h) => {
    const wrap = document.createElement("div");
    wrap.className = "faq-section";
    wrap.dataset.section = h.textContent.trim();
    h.parentNode.insertBefore(wrap, h);
    let node = h;
    while (node && !(node !== h && node.nodeType === 1 && node.tagName === "H2")) {
      const next = node.nextSibling;
      wrap.appendChild(node);
      node = next;
    }
  });

  const options = h2s.map((h) => h.textContent.trim());
  const picker = document.createElement("div");
  picker.className = "faq-section-picker";
  picker.innerHTML =
    `<label for="faq-section-select">${escapeHTML(article.sectionPickerLabel || "Choose your industry:")}</label>` +
    `<select id="faq-section-select"><option value="">Show all</option>` +
    options.map((o) => `<option value="${escapeHTML(o)}">${escapeHTML(o)}</option>`).join("") +
    `</select>`;
  bodyEl.insertBefore(picker, h2s[0].closest(".faq-section"));

  picker.querySelector("select").addEventListener("change", (e) => {
    const chosen = e.target.value;
    bodyEl.querySelectorAll(".faq-section").forEach((sec) => {
      sec.hidden = !!chosen && sec.dataset.section !== chosen;
    });
    if (chosen) trackEvent("faq_section_selected", { article_id: article.id, section: chosen });
  });
}

function renderArticle(article, categories, articles) {
  const folder = categories.find((c) => c.id === article.categoryId);
  const category = parentCategoryOf(categories, article.categoryId);
  document.title = `${article.title} — Personalisation Hub Help Centre`;
  $("article-title").textContent = article.title;
  $("crumb-article").textContent = article.title;
  const body = $("article-body");
  body.innerHTML = renderBody(article.bodyMd);
  enhanceCopyBlocks(body, { onCopy: ({ ok, label }) => trackEvent("faq_copy_block", { article_id: article.id, label, ok }) });
  buildToc(body);
  initSectionPicker(body, article);
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
