// Help-article publisher — pushes APPROVED help articles from the console's
// Help Centre (faq/data export of Firestore faqArticles) to the native
// Support Centre on personalisationhub.com (WordPress). The console stays the
// master; WordPress is only where it is published, and the next publish
// overwrites any edit made there.
//
// Pure logic: every network call goes through the injected `wp` client,
// `wp(method, path, body) -> Promise<{status, json}>` (WordPress REST, basic
// auth with an application password — see scripts/faq-wp-publish.js). With
// `dryRun: true` nothing writes, so the whole path is testable offline.
//
// WordPress side (Angie snippet "PH Support Centre", 3 Nov 2026):
//   post type  ph_help_article  /wp/v2/help-articles
//   taxonomy   ph_help_category /wp/v2/help-categories (top level = category,
//              child = folder; term meta ph_help_id, ph_help_icon, ph_help_order)
//   post meta  ph_help_id, ph_help_doctype, ph_help_keywords[], ph_help_questions[],
//              ph_help_direct_answer, ph_help_release_from/_to, ph_help_programme,
//              ph_help_project, ph_help_section_picker(_label), ph_help_updated,
//              ph_help_hash, ph_help_version, _seopress_titles_title/_desc
"use strict";
const crypto = require("crypto");

const ALLOWED_TAGS = new Set(["p", "br", "hr", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "strong", "b", "em", "i", "u", "s",
  "code", "pre", "blockquote", "a", "img", "figure", "figcaption", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
  "div", "span", "sup", "sub", "details", "summary", "iframe"]);
const DROP_WITH_CONTENT = new Set(["script", "style", "noscript", "template", "textarea", "select", "option", "object", "embed", "svg", "math", "form", "button"]);
const ALLOWED_ATTRS = new Set(["href", "src", "alt", "title", "class", "id", "colspan", "rowspan", "target", "rel", "width", "height", "loading", "allowfullscreen"]);
const ALLOWED_IFRAME_HOSTS = ["www.youtube.com", "www.youtube-nocookie.com", "player.vimeo.com"];
const VOID = new Set(["br", "hr", "img"]);

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const hash = (s) => crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, 16);

function safeUri(v) {
  const u = String(v).replace(/[\u0000- ]/g, "");
  return /^(https?:|mailto:|tel:|#|\/|[^:]*$)/i.test(u) && !/^(javascript|data|vbscript):/i.test(u);
}
function hostOf(u) { try { return new URL(u, "https://x.invalid").hostname; } catch { return ""; } }

// Legacy bodies (saved before the rich-text editor) are a tiny markdown
// subset: `## ` headings, `- ` lists and paragraphs.
function legacyMarkdownToHtml(md) {
  let html = ""; let inList = false;
  const close = () => { if (inList) { html += "</ul>"; inList = false; } };
  for (const raw of String(md || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { close(); continue; }
    if (line.startsWith("## ")) { close(); html += `<h2>${esc(line.slice(3))}</h2>`; continue; }
    if (/^[-*] /.test(line)) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${esc(line.slice(2))}</li>`; continue; }
    close(); html += `<p>${esc(line)}</p>`;
  }
  close();
  return html;
}

// Allow-list sanitiser. Unknown tags are unwrapped (children kept), dangerous
// ones are dropped with their content, attributes outside the allow-list and
// unsafe URIs are removed, iframes survive only for the embed hosts above.
function sanitizeHtml(input) {
  let s = String(input || "").replace(/<!--[\s\S]*?-->/g, "");
  for (const t of DROP_WITH_CONTENT) s = s.replace(new RegExp(`<${t}\\b[\\s\\S]*?<\\/${t}\\s*>`, "gi"), "").replace(new RegExp(`<${t}\\b[^>]*>`, "gi"), "");
  return s.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g, (m, slash, name, rest) => {
    const tag = name.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return "";
    if (slash) return VOID.has(tag) ? "" : `</${tag}>`;
    const attrs = {};
    for (const a of rest.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
      const k = a[1].toLowerCase();
      if (!ALLOWED_ATTRS.has(k)) continue;
      const v = a[2] != null ? a[2] : a[3] != null ? a[3] : a[4] != null ? a[4] : "";
      if ((k === "href" || k === "src") && !safeUri(v)) continue;
      attrs[k] = v;
    }
    if (tag === "iframe") {
      if (!attrs.src || !ALLOWED_IFRAME_HOSTS.includes(hostOf(attrs.src))) return "";
      attrs.loading = "lazy"; attrs.referrerpolicy = "strict-origin-when-cross-origin";
    }
    if (tag === "a" && /^https?:/i.test(attrs.href || "")) { attrs.target = "_blank"; attrs.rel = "noopener noreferrer"; }
    const out = Object.entries(attrs).map(([k, v]) => (v === "" && k === "allowfullscreen") ? k : `${k}="${esc(String(v).replace(/&amp;/g, "&"))}"`).join(" ");
    return `<${tag}${out ? " " + out : ""}${VOID.has(tag) ? " /" : ""}>`;
  });
}

// Rewrites links between articles (`article.html?id=<id>` and absolute
// help-centre URLs) to the WordPress URL of the target. `urlById` maps console
// id -> WordPress permalink. Unresolved links are left as they were and
// reported so a run's report can list them.
function rewriteArticleLinks(html, urlById, unresolved = []) {
  return html.replace(/href="([^"]*?article\.html\?[^"]*?)"/gi, (m, href) => {
    const id = (href.match(/[?&]id=([^&#]+)/) || [])[1];
    const hashPart = (href.match(/#.*$/) || [""])[0];
    const target = id && urlById[decodeURIComponent(id)];
    if (!target) { unresolved.push(href); return m; }
    return `href="${esc(target)}${hashPart}"`;
  });
}

// External <img> -> WordPress media library. `uploadMedia(url) -> Promise<url>`.
async function copyImages(html, uploadMedia, mediaHost, copied = {}) {
  const urls = [...new Set([...html.matchAll(/<img\b[^>]*\bsrc="(https?:\/\/[^"]+)"/gi)].map((m) => m[1]))]
    .filter((u) => hostOf(u) !== mediaHost);
  let out = html;
  for (const u of urls) {
    if (!(u in copied)) copied[u] = await uploadMedia(u);
    if (copied[u]) out = out.split(`src="${esc(u)}"`).join(`src="${esc(copied[u])}"`).split(`src="${u}"`).join(`src="${esc(copied[u])}"`);
  }
  return out;
}

function renderBody(bodyMd) {
  const t = String(bodyMd || "").trim();
  return sanitizeHtml(t.startsWith("<") ? t : legacyMarkdownToHtml(t));
}

// Is the article part of what the live release shows?
function inRange(article, releasesById, liveOrder) {
  const from = article.introducedInReleaseId && releasesById[article.introducedInReleaseId];
  const to = article.removedInReleaseId && releasesById[article.removedInReleaseId];
  if (article.introducedInReleaseId && (!from || !(Number(from.order) <= liveOrder))) return false;
  if (article.removedInReleaseId && (!to || !(liveOrder < Number(to.order)))) return false;
  return true;
}

// Which articles to publish, which to retire. Only status "published" and in
// range reaches WordPress; drafts and pending revisions (never exported as
// live fields) cannot. Tombstoned ids (retired.json) and articles that have
// left the live range are retired.
function selectArticles({ articles, releases = [], retiredIds = [], liveReleaseId = null }) {
  const byId = Object.fromEntries(releases.map((r) => [r.id, r]));
  const live = releases.filter((r) => r.status === "live").sort((a, b) => (a.order || 0) - (b.order || 0));
  const liveRel = (liveReleaseId && byId[liveReleaseId]) || live[live.length - 1] || null;
  const liveOrder = liveRel ? Number(liveRel.order) : Infinity;
  const retired = new Set(retiredIds);
  const publish = []; const retire = [];
  for (const a of articles) {
    if (retired.has(a.id) || a.status !== "published" || !inRange(a, byId, releases.length ? liveOrder : Infinity)) retire.push(a);
    else publish.push(a);
  }
  return { publish, retire, liveRelease: liveRel };
}

function articleMeta(a, byId, scope = {}) {
  const from = a.introducedInReleaseId && byId[a.introducedInReleaseId];
  const to = a.removedInReleaseId && byId[a.removedInReleaseId];
  return {
    ph_help_id: a.id,
    ph_help_doctype: a.docType || "faq",
    ph_help_keywords: a.keywords || [],
    ph_help_questions: a.questionVariants || [],
    ph_help_direct_answer: a.directAnswer || "",
    ph_help_release_from: from ? (from.version || from.name || "") : "",
    ph_help_release_to: to ? (to.version || to.name || "") : "",
    ph_help_programme: a.programme || scope.programme || "",
    ph_help_project: a.project || scope.project || "",
    ph_help_section_picker: !!a.sectionPicker,
    ph_help_section_picker_label: a.sectionPickerLabel || "",
    ph_help_updated: a.updatedAt || "",
    _seopress_titles_title: a.seoTitle || "",
    _seopress_titles_desc: a.metaDescription || "",
  };
}

const wpErr = (r, what) => new Error(`${what}: WordPress answered ${r.status} ${(r.json && (r.json.message || r.json.code)) || ""}`.trim());

// Term for a console category/folder, created on first use. Top-level =
// category, child = folder (parentId).
async function ensureTerm(wp, cat, parentTermId, cache, dryRun) {
  if (cache[cat.id] != null) return cache[cat.id];
  const found = await wp("GET", `/wp/v2/help-categories?per_page=100&search=${encodeURIComponent(cat.name)}&context=edit`);
  const hit = found.status === 200 && (found.json || []).find((t) => t.meta && t.meta.ph_help_id === cat.id);
  const body = { name: cat.name, description: cat.description || "", parent: parentTermId || 0, meta: { ph_help_id: cat.id, ph_help_icon: cat.icon || "", ph_help_order: cat.order || 0 } };
  if (hit) { cache[cat.id] = hit.id; const m = hit.meta || {}; const same = hit.name === body.name && (hit.parent || 0) === body.parent && (hit.description || "") === body.description && m.ph_help_icon === body.meta.ph_help_icon && Number(m.ph_help_order) === Number(body.meta.ph_help_order);
    if (!dryRun && !same) await wp("POST", `/wp/v2/help-categories/${hit.id}`, body);
    return hit.id; }
  if (dryRun) return (cache[cat.id] = -1);
  const r = await wp("POST", "/wp/v2/help-categories", body);
  if (r.status >= 300) throw wpErr(r, `create category ${cat.id}`);
  return (cache[cat.id] = r.json.id);
}

async function findPost(wp, id) {
  const r = await wp("GET", `/wp/v2/help-articles?per_page=1&status=any&context=edit&meta_key=ph_help_id&meta_value=${encodeURIComponent(id)}`);
  if (r.status === 200 && Array.isArray(r.json) && r.json[0]) return r.json[0];
  const s = await wp("GET", `/wp/v2/help-articles?per_page=100&status=any&context=edit&search=${encodeURIComponent(id)}`);
  return (s.status === 200 && (s.json || []).find((p) => p.meta && p.meta.ph_help_id === id)) || null;
}

// Publishes (or dry-runs) a batch. Returns {report, records}: `records` maps
// article id -> the wpPublish record to store on the faqArticles doc.
async function publishBatch({ articles, categories, releases = [], retiredIds = [], wp, uploadMedia = async () => null, mediaHost = "", dryRun = true,
  onlyIds = null, liveReleaseId = null, scope = {}, now = new Date().toISOString(), previous = {} }) {
  const byRel = Object.fromEntries(releases.map((r) => [r.id, r]));
  const sel = selectArticles({ articles, releases, retiredIds, liveReleaseId });
  const only = onlyIds ? new Set(onlyIds) : null;
  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
  const termCache = {}; const copied = {}; const unresolved = []; const later = [];
  const report = { dryRun, at: now, created: [], updated: [], unchanged: [], retired: [], failed: [], skipped: [], unresolvedLinks: [], perCategory: {} };
  const records = {};

  // permalink lookup for article->article links: previous publishes first,
  // then WordPress for the ids we have not seen.
  const urlById = Object.fromEntries(Object.entries(previous).filter(([, v]) => v && v.url).map(([k, v]) => [k, v.url]));
  for (const a of sel.publish) if (!urlById[a.id]) { const p = await findPost(wp, a.id).catch(() => null); if (p && p.link) urlById[a.id] = p.link; }

  for (const a of sel.publish) {
    if (only && !only.has(a.id)) continue;
    try {
      const cat = catById[a.categoryId];
      if (!cat) { report.skipped.push({ id: a.id, reason: "category missing" }); continue; }
      const parent = cat.parentId && catById[cat.parentId];
      const top = parent ? await ensureTerm(wp, parent, 0, termCache, dryRun) : 0;
      const term = await ensureTerm(wp, cat, top, termCache, dryRun);
      const beforeUnresolved = unresolved.length;
      let html = renderBody(a.bodyMd);
      html = rewriteArticleLinks(html, urlById, unresolved);
      if (!dryRun) html = await copyImages(html, uploadMedia, mediaHost, copied);
      const contentHash = hash(JSON.stringify([a.title, a.summary, a.bodyMd, articleMeta(a, byRel, scope), a.slug, a.order, a.categoryId]));
      const existing = await findPost(wp, a.id);
      const version = ((existing && existing.meta && Number(existing.meta.ph_help_version)) || (previous[a.id] && previous[a.id].version) || 0);
      if (existing && existing.meta && existing.meta.ph_help_hash === contentHash && existing.status === "publish") {
        report.unchanged.push(a.id);
        records[a.id] = { wpId: existing.id, url: existing.link, version, publishedAt: (previous[a.id] && previous[a.id].publishedAt) || now, status: "in-sync", hash: contentHash };
        continue;
      }
      const body = {
        title: a.title, excerpt: a.summary || "", content: html, slug: a.slug || undefined, status: "publish", menu_order: a.order || 0,
        "help-categories": term > 0 ? [term] : [], meta: { ...articleMeta(a, byRel, scope), ph_help_hash: contentHash, ph_help_version: version + 1 },
      };
      const bucket = existing ? report.updated : report.created;
      bucket.push(a.id); report.perCategory[a.categoryId] = (report.perCategory[a.categoryId] || 0) + 1;
      if (dryRun) continue;
      const r = existing ? await wp("POST", `/wp/v2/help-articles/${existing.id}`, body) : await wp("POST", "/wp/v2/help-articles", body);
      if (r.status >= 300) throw wpErr(r, `${existing ? "update" : "create"} ${a.id}`);
      urlById[a.id] = r.json.link;
      if (unresolved.length > beforeUnresolved) later.push({ postId: r.json.id, raw: renderBody(a.bodyMd), id: a.id });
      records[a.id] = { wpId: r.json.id, url: r.json.link, version: version + 1, publishedAt: now, status: "in-sync", hash: contentHash };
    } catch (e) {
      report.failed.push({ id: a.id, error: e.message });
      records[a.id] = { ...(previous[a.id] || {}), status: "failed", error: e.message, failedAt: now };
    }
  }

  // Second pass: links to articles created later in this same run (the first
  // migration) now have a permalink — rewrite them in place.
  const stillUnresolved = [];
  for (const l of later) {
    const html = await copyImages(rewriteArticleLinks(l.raw, urlById, stillUnresolved), uploadMedia, mediaHost, copied);
    const r = await wp("POST", `/wp/v2/help-articles/${l.postId}`, { content: html });
    if (r.status >= 300) report.failed.push({ id: l.id, error: `link pass: ${r.status}` });
  }
  unresolved.length = 0; unresolved.push(...stillUnresolved);

  // retirements: unpublish (draft) and 301 to the closest article/category
  const redirects = [];
  for (const a of sel.retire) {
    if (only && !only.has(a.id)) continue;
    try {
      const p = await findPost(wp, a.id);
      if (!p || p.status === "draft") continue;
      const cat = catById[a.categoryId];
      const to = (cat && urlById[(sel.publish.find((x) => x.categoryId === a.categoryId) || {}).id]) || (p.help_category_link || "");
      redirects.push({ from: p.link, to, id: a.id });
      report.retired.push(a.id);
      if (dryRun) continue;
      const r = await wp("POST", `/wp/v2/help-articles/${p.id}`, { status: "draft", meta: { ph_help_redirect_to: to } });
      if (r.status >= 300) throw wpErr(r, `retire ${a.id}`);
      records[a.id] = { wpId: p.id, url: p.link, version: Number(p.meta && p.meta.ph_help_version) || 0, publishedAt: null, status: "retired", redirectTo: to };
    } catch (e) { report.failed.push({ id: a.id, error: e.message }); }
  }
  report.redirects = redirects;
  report.unresolvedLinks = [...new Set(unresolved)];
  report.counts = { publishable: sel.publish.length, retirable: sel.retire.length };
  return { report, records, urlById };
}

// Rolls one article back to the WordPress revision before its latest.
async function rollbackArticle({ id, wp, dryRun = true, now = new Date().toISOString() }) {
  const p = await findPost(wp, id);
  if (!p) return { ok: false, error: "article is not in WordPress" };
  const rev = await wp("GET", `/wp/v2/help-articles/${p.id}/revisions?per_page=5&context=edit`);
  const revs = rev.status === 200 && Array.isArray(rev.json) ? rev.json : [];
  const prior = revs.find((r) => r.id !== p.id && (r.content && (r.content.raw != null ? r.content.raw : r.content.rendered)) !== (p.content && (p.content.raw != null ? p.content.raw : p.content.rendered)));
  if (!prior) return { ok: false, error: "no earlier version to restore" };
  if (dryRun) return { ok: true, dryRun: true, wpId: p.id, restoreRevision: prior.id };
  const get = (f) => (f && (f.raw != null ? f.raw : f.rendered)) || "";
  const version = (Number(p.meta && p.meta.ph_help_version) || 0) + 1;
  const r = await wp("POST", `/wp/v2/help-articles/${p.id}`, { title: get(prior.title), excerpt: get(prior.excerpt), content: get(prior.content), status: "publish",
    meta: { ph_help_version: version, ph_help_hash: "rolled-back-" + prior.id } });
  if (r.status >= 300) throw wpErr(r, `rollback ${id}`);
  return { ok: true, wpId: p.id, version, restoredRevision: prior.id, record: { wpId: p.id, url: r.json.link, version, publishedAt: now, status: "in-sync", rolledBack: true } };
}

// Old URL -> new URL map for the redirect ticket: the help.personalisationhub.com
// pages and the Freshdesk solution articles that carried a numeric id.
function buildUrlMap({ articles, urlById }) {
  const rows = [];
  for (const a of articles) {
    const to = urlById[a.id]; if (!to) continue;
    rows.push({ from: `https://help.personalisationhub.com/article.html?id=${a.id}`, to });
    const fd = /^faq-art-(\d+)$/.exec(a.id);
    if (fd) rows.push({ from: `https://help.personalisationhub.com/support/solutions/articles/${fd[1]}`, to, source: "freshdesk" });
  }
  return rows;
}

module.exports = { sanitizeHtml, renderBody, legacyMarkdownToHtml, rewriteArticleLinks, copyImages, selectArticles, inRange, articleMeta,
  publishBatch, rollbackArticle, buildUrlMap, ALLOWED_TAGS, ALLOWED_IFRAME_HOSTS };
