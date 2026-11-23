"use strict";
// The branded page Aidan's sales collateral is printed from (ticket
// JtkLrEG0aTnC5JfkdPA1), pure. Split out of collateral-core.js, which decides
// what the collateral is and cleans what the model wrote; this module only
// lays it out:
//
//   markdownToHtml     the document as safe HTML (everything escaped; links
//                      only http(s) and mailto), and its first `# ` title
//   collateralHtml     the branded page the PDF is printed from, laid out by
//                      the brand skill (ph-brand): its light-surface tokens,
//                      its logo file, and any `collateral*.css` file the skill
//                      carries, applied after the defaults
//   brandAssets        the brand skill's logo and collateral stylesheet
//   footerTemplate     the footer printed on every page
//   PDF_OPTIONS        the print options (A4, landscape for a deck, the footer)
//
// The browser that prints it is functions/collateral-pdf.js; the run is
// functions/aidan.js → collateralAndReply. Tests: test/collateral-layout.test.js
// and test/collateral-render.test.mjs (the page printed to PDF in Chromium).

const { FORMATS } = require("./collateral-core");

const clip = (s, n) => { const t = String(s == null ? "" : s); return t.length > n ? t.slice(0, n) : t; };

// ── Markdown -> HTML ──────────────────────────────────────────────────────
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
function inline(text) {
  let s = esc(text);
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (m, c) => { codes.push(`<code>${c}</code>`); return `\u0000${codes.length - 1}\u0000`; });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
    const u = url.replace(/&amp;/g, "&");
    return /^(https?:\/\/|mailto:)/i.test(u) ? `<a href="${esc(u)}">${label}</a>` : label;
  });
  s = s.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (m, a, b) => `<strong>${a || b}</strong>`);
  s = s.replace(/(^|[^\w*])\*([^*\s][^*]*?)\*(?!\w)|(^|[^\w_])_([^_\s][^_]*?)_(?!\w)/g, (m, p1, a, p2, b) => `${p1 || p2 || ""}<em>${a || b}</em>`);
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => codes[Number(i)]);
}
const tableCells = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
// The document's body as HTML, and its first `# ` title (taken out of the body).
function markdownToHtml(md) {
  const lines = String(md || "").replace(/\r\n?/g, "\n").split("\n");
  const html = [];
  let title = "";
  let para = [];
  let list = null; // { type, items }
  const flushPara = () => { if (para.length) { html.push(`<p>${inline(para.join(" "))}</p>`); para = []; } };
  const flushList = () => { if (list) { html.push(`<${list.type}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.type}>`); list = null; } };
  const flush = () => { flushPara(); flushList(); };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) { // code is not collateral: shown as plain text
      flush();
      const code = [];
      for (i += 1; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
      html.push(`<pre>${esc(code.join("\n"))}</pre>`);
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    const h = line.match(/^(#{1,4})\s+(.*?)\s*#*\s*$/);
    if (h) {
      flush();
      if (h[1].length === 1 && !title) { title = h[2]; continue; }
      const level = Math.min(4, Math.max(2, h[1].length));
      html.push(`<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); html.push("<hr>"); continue; }
    if (/^\s*>/.test(line)) {
      flush();
      const quote = [line.replace(/^\s*>\s?/, "")];
      while (i + 1 < lines.length && /^\s*>/.test(lines[i + 1])) quote.push(lines[++i].replace(/^\s*>\s?/, ""));
      html.push(`<blockquote>${inline(quote.join(" ").trim())}</blockquote>`);
      continue;
    }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flush();
      const head = tableCells(line);
      i += 1;
      const rows = [];
      while (i + 1 < lines.length && /^\s*\|/.test(lines[i + 1])) rows.push(tableCells(lines[++i]));
      html.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${head.map((_, k) => `<td>${inline(r[k] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    const li = line.match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/);
    if (li) {
      flushPara();
      const type = li[1] ? "ul" : "ol";
      if (list && list.type !== type) flushList();
      if (!list) list = { type, items: [] };
      list.items.push(li[3]);
      continue;
    }
    if (list && /^\s{2,}\S/.test(line)) { list.items[list.items.length - 1] += ` ${line.trim()}`; continue; }
    flushList();
    para.push(line.trim());
  }
  flush();
  return { title, html: html.join("\n") };
}

// ── The branded page ──────────────────────────────────────────────────────
// The brand skill's light surface (ph-brand §1 to §5): paper, ink, muted, line;
// one accent per view (teal, with the deeper shade for text); the orange CTA;
// Kantumruy Pro; the thin four-colour bar once; the full-colour logo top-left.
const BRAND = Object.freeze({
  paper: "#F5F7FB", surface: "#FFFFFF", ink: "#1C2540", muted: "#5A6479", line: "#DCE1EB",
  teal: "#169BC2", tealText: "#0F7A9A", pink: "#EF60A7", orange: "#FE9226", green: "#60D838",
  font: "\"Kantumruy Pro\", system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif",
  fontCss: "https://fonts.googleapis.com/css2?family=Kantumruy+Pro:wght@400;500;600;700&display=swap",
  trialUrl: "https://aws.amazon.com/marketplace/pp/prodview-3uiwcnbrpvj76?trk=176b570f-20dd-4b84-aa7e-cae53990fe91&sc_channel=el&source=personalisationhub",
  site: "personalisationhub.com",
});
// The brand skill's own files the layout uses: the light-surface logo and any
// collateral stylesheet (`collateral.css`, `templates/collateral.css`, …).
function brandAssets(skill) {
  const files = (skill && Array.isArray(skill.files) ? skill.files : []).filter((f) => f && typeof f.path === "string");
  const logo = files.find((f) => /ph_logo_full_colou?r\.svg$/i.test(f.path)) || files.find((f) => /logo.*\.svg$/i.test(f.path) && !/white|mono/i.test(f.path));
  const css = files.filter((f) => /(^|\/)collateral[^/]*\.css$/i.test(f.path)).map((f) => String(f.content || "")).join("\n");
  const svg = logo && /^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(String(logo.content || "")) ? String(logo.content) : "";
  return { logoSvg: svg, css: clip(css, 40000) };
}
function baseCss(format) {
  const b = BRAND;
  const landscape = Boolean(format && format.landscape);
  return `
@page { size: A4${landscape ? " landscape" : ""}; margin: 16mm 18mm 20mm 18mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: ${b.surface}; }
body { font-family: ${b.font}; color: ${b.ink}; font-size: 10.5pt; line-height: 1.55; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.c-bar { display: flex; height: 4px; margin: 0 0 24px; border-radius: 2px; overflow: hidden; }
.c-bar span { flex: 1; }
.c-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin: 0 0 32px; }
.c-logo { height: 28px; width: auto; display: block; }
.c-for { font-size: 9pt; color: ${b.muted}; text-align: right; }
.c-eyebrow { margin: 0 0 8px; font-size: 8.5pt; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: ${b.tealText}; }
h1 { margin: 0 0 12px; font-size: ${landscape ? "34pt" : "28pt"}; line-height: 1.12; font-weight: 700; letter-spacing: -0.03em; }
.c-lede { margin: 0 0 24px; font-size: 13pt; line-height: 1.5; color: ${b.muted}; max-width: 150mm; }
h2 { margin: 24px 0 8px; font-size: 16pt; line-height: 1.25; font-weight: 700; letter-spacing: -0.02em; break-after: avoid; }
h3 { margin: 16px 0 4px; font-size: 12pt; line-height: 1.3; font-weight: 600; break-after: avoid; }
h4 { margin: 12px 0 4px; font-size: 10.5pt; font-weight: 600; color: ${b.tealText}; break-after: avoid; }
p { margin: 0 0 8px; }
ul, ol { margin: 0 0 12px; padding: 0; list-style: none; }
li { position: relative; margin: 0 0 4px; padding-left: 16px; break-inside: avoid; }
ul > li::before { content: ""; position: absolute; left: 0; top: 0.62em; width: 6px; height: 6px; border-radius: 50%; background: ${b.teal}; }
ol { counter-reset: c-n; }
ol > li { counter-increment: c-n; padding-left: 24px; }
ol > li::before { content: counter(c-n); position: absolute; left: 0; top: 0; width: 16px; font-weight: 600; color: ${b.tealText}; }
strong { font-weight: 600; }
a { color: ${b.tealText}; text-decoration: none; }
blockquote { margin: 12px 0 16px; padding: 12px 16px; border-left: 4px solid ${b.teal}; border-radius: 0 12px 12px 0; background: ${b.paper}; font-size: 11.5pt; break-inside: avoid; }
table { width: 100%; margin: 8px 0 16px; border-collapse: collapse; font-size: 9.5pt; break-inside: avoid; }
th, td { padding: 8px; border-bottom: 1px solid ${b.line}; text-align: left; vertical-align: top; }
th { font-weight: 600; color: ${b.muted}; }
hr { border: 0; border-top: 1px solid ${b.line}; margin: 16px 0; }
pre { white-space: pre-wrap; font: inherit; color: ${b.muted}; }
code { font: inherit; }
.c-body { overflow-wrap: anywhere; }
${format && format.pageBreaks ? ".c-body h2 { break-before: page; margin-top: 0; font-size: 24pt; letter-spacing: -0.03em; } .c-body h2:first-child { break-before: auto; }" : ""}
.c-cta { display: flex; align-items: center; gap: 24px; margin: 32px 0 0; padding: 16px 24px; border: 1px solid ${b.line}; border-radius: 16px; background: ${b.paper}; break-inside: avoid; }
.c-cta-text { flex: 1; min-width: 0; }
.c-cta-eyebrow { margin: 0 0 4px; font-size: 8.5pt; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: ${b.tealText}; }
.c-cta-title { margin: 0 0 4px; font-size: 14pt; font-weight: 700; letter-spacing: -0.02em; }
.c-cta-line { margin: 0; color: ${b.muted}; }
.c-pill { display: inline-block; padding: 8px 16px; border-radius: 999px; background: ${b.orange}; color: ${b.ink}; font-weight: 600; white-space: nowrap; }
.c-demo { margin: 8px 0 0; font-size: 9pt; color: ${b.muted}; }
`;
}
// The whole page the PDF is printed from. Nothing here runs script: the
// printer turns JavaScript off and fetches nothing but the brand font.
function collateralHtml({ documentMd, title = "", format = FORMATS.overview, industry = "", prospect = null, brand = null }) {
  const { title: mdTitle, html } = markdownToHtml(documentMd);
  const b = BRAND;
  const assets = brandAssets(brand);
  const headline = mdTitle || title || format.label;
  // The opening paragraph is the lede, in muted.
  const body = html.replace(/^<p>([\s\S]*?)<\/p>/, (m, p) => `<p class="c-lede">${p}</p>`);
  const eyebrow = [format.label, industry].filter(Boolean).join(" · ");
  const logo = assets.logoSvg ? `<img class="c-logo" alt="Personalisation Hub" src="data:image/svg+xml;base64,${Buffer.from(assets.logoSvg, "utf8").toString("base64")}">` : `<span class="c-logo-text">Personalisation Hub</span>`;
  return `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8">
<title>${esc(headline)}</title>
<link rel="stylesheet" href="${b.fontCss}">
<style>${baseCss(format)}${assets.css ? `\n/* from the brand skill */\n${assets.css.replace(/</g, "")}` : ""}</style>
</head><body>
<div class="c-bar" aria-hidden="true"><span style="background:${b.teal}"></span><span style="background:${b.pink}"></span><span style="background:${b.orange}"></span><span style="background:${b.green}"></span></div>
<header class="c-head">${logo}${prospect && prospect.name ? `<div class="c-for">Prepared for ${esc(prospect.name)}</div>` : ""}</header>
<p class="c-eyebrow">${esc(eyebrow)}</p>
<h1>${inline(headline)}</h1>
<main class="c-body">
${body}
</main>
<section class="c-cta">
  <div class="c-cta-text"><p class="c-cta-eyebrow">Try it yourself</p><p class="c-cta-title">Try it free for 30 days.</p><p class="c-cta-line">Runs in your own cloud. Minimal setup.</p></div>
  <div><a class="c-pill" href="${esc(b.trialUrl)}">Try free on AWS Marketplace →</a><p class="c-demo">Or book a demo at ${b.site}</p></div>
</section>
</body></html>`;
}
// Printed at the foot of every page: an accent dot, the site, the page number.
function footerTemplate() {
  const b = BRAND;
  return `<div style="width:100%;margin:0 18mm;display:flex;align-items:center;gap:8px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:8px;color:${b.muted};">
<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${b.teal};"></span><span>${b.site}</span><span style="margin-left:auto;"><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;
}
const PDF_OPTIONS = (format) => ({ format: "A4", landscape: Boolean(format && format.landscape), printBackground: true, displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate: footerTemplate(), preferCSSPageSize: true });

module.exports = { esc, inline, markdownToHtml, BRAND, brandAssets, baseCss, collateralHtml, footerTemplate, PDF_OPTIONS };
