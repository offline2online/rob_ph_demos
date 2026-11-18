"use strict";
// Aidan's branded sales collateral (ticket JtkLrEG0aTnC5JfkdPA1), pure.
//
// "@Aidan, prepare a platform overview for CP Group for my AWS contact, retail
// grocery" is a write run (aidan-core.js → kindOf) whose instruction names a
// piece of collateral. This module decides that, and everything about the
// collateral that is not a model call or a browser:
//
//   collateralFormat   which collateral, from the instruction's own words:
//                      one-pager, platform overview, feature deep-dive or deck
//                      (null: not collateral, an ordinary write)
//   industryFor        the retailer's vertical, from the instruction, else the
//                      prospect's record (the nine on personalisationhub.com)
//   prospectFor        the named company in Prospects (TAM) or Leads, reduced to
//                      { name, industry, country }: never revenue, store counts,
//                      contacts, notes or anything about end customers
//   collateralSystem   the lines added to the document prompt
//   guardCollateral    deterministic clean-up of what the model wrote: no
//                      Sydney/Australia positioning, no internal names, no long
//                      dashes; what it changed is kept on the ticket
//   markdownToHtml     the document as safe HTML (everything escaped; links
//                      only http(s) and mailto)
//   collateralHtml     the branded page the PDF is printed from, laid out by
//                      the brand skill (ph-brand): its light-surface tokens,
//                      its logo file, and any `collateral*.css` file the skill
//                      carries, applied after the defaults
//   footerTemplate     the footer printed on every page
//   pdfPageCount       how many pages a PDF has
//
// The browser that prints the PDF is functions/collateral-pdf.js; the run is
// functions/aidan.js → collateralAndReply. Tests: test/collateral-core.test.js,
// test/collateral-render.test.mjs (the page printed to PDF in Chromium) and
// test/support-mail.test.js (a whole run, stubbed).

const pc = require("./prospects-core");

const BRAND_SLUG = "ph-brand";
const clip = (s, n) => { const t = String(s == null ? "" : s); return t.length > n ? t.slice(0, n) : t; };
const lower = (s) => String(s == null ? "" : s).trim().toLowerCase();

// ── Which collateral ──────────────────────────────────────────────────────
// key -> how it is laid out and how long it is. `words` and `pages` go into
// the prompt; `landscape` and `pageBreaks` into the layout.
const FORMATS = Object.freeze({
  "one-pager": { key: "one-pager", label: "One-pager", pages: "exactly one A4 page", words: "250 to 400 words", maxTokens: 6000 },
  overview: { key: "overview", label: "Platform overview", pages: "three to five A4 pages", words: "1,200 to 2,000 words", maxTokens: 14000 },
  "deep-dive": { key: "deep-dive", label: "Feature deep-dive", pages: "three to six A4 pages", words: "1,500 to 2,500 words", maxTokens: 16000 },
  deck: { key: "deck", label: "Deck", pages: "six to ten landscape pages, one `## ` section per page", words: "60 to 120 words per page", maxTokens: 10000, landscape: true, pageBreaks: true },
});
// First match wins: a "deep dive deck" is a deep-dive's content laid out as a deck.
const FORMAT_RULES = [
  ["deck", /\b(?:(?:sales|pitch|slide|intro|introduction)\s+)?deck\b|\bslides\b|\bslide\s+pack\b/i],
  ["deep-dive", /\bdeep[\s-]?dive\b|\bfeature\s+(?:guide|overview|brief)\b/i],
  ["one-pager", /\bone[\s-]?pager\b|\bone[\s-]page(?:\s+(?:summary|overview|brief))?\b|\bsingle[\s-]page\b|\b(?:fact|sell|sales|data)[\s-]?sheet\b|\bflyer\b|\bleave[\s-]?behind\b/i],
  ["overview", /\b(?:platform|product|solution|company|capabilit(?:y|ies)|industry|sector|vertical)\s+overview\b|\boverview\s+of\s+(?:the\s+)?(?:platform|personalisation\s+hub|ph)\b|\bbrochure\b|\b(?:sales|marketing)\s+collateral\b|\bcollateral\b|\bwhite\s?paper\b/i],
];
// A write about the console's own data is never collateral: its reply goes to
// the allowed senders only, and collateral is written for people outside.
const CONSOLE_RE = /\b(?:(?:ph\s+)?agent\s+console|the\s+console|backlog|tickets?|concepts?|incubator|pipeline|readme)\b/i;
function collateralFormat(instruction) {
  const s = String(instruction || "");
  if (!s.trim() || CONSOLE_RE.test(s)) return null;
  const hit = FORMAT_RULES.find(([, re]) => re.test(s));
  return hit ? FORMATS[hit[0]] : null;
}

// ── Who it is for ─────────────────────────────────────────────────────────
// Company names after "for": "for CP Group for my AWS contact" -> "CP Group".
const NAME_WORD = "[A-Z0-9][\\w&.'’-]*";
const FOR_NAME_RE = new RegExp(`\\bfor\\s+(${NAME_WORD}(?:\\s+(?:${NAME_WORD}|&|and|of|de|du|la))*)`, "g");
const NOT_NAMES = new Set(["my", "our", "the", "a", "an", "me", "us", "aws", "amazon", "him", "her", "them", "their", "rob"]);
function namesIn(instruction) {
  const out = [];
  for (const m of String(instruction || "").matchAll(FOR_NAME_RE)) {
    const name = m[1].replace(/\s+(?:&|and|of|de|du|la)$/i, "").replace(/[.'’]+$/, "").trim();
    if (name && !NOT_NAMES.has(lower(name)) && !out.includes(name)) out.push(name);
  }
  return out;
}
// The company the collateral is for, read from the console's own records
// (Prospects (TAM), then Leads), as { name, industry, country, source }.
// Only those three facts are ever taken: never revenue, store counts,
// contacts, notes, insights or anything about the retailer's customers.
function prospectFor({ instruction = "", client = "", prospects = [], leads = [] } = {}) {
  const wanted = [clip(String(client || "").trim(), 200), ...namesIn(instruction)].filter(Boolean);
  for (const name of wanted) {
    const key = pc.companyKey(name);
    if (!key) continue;
    const p = (prospects || []).find((x) => x && pc.companyKey(x.name) === key);
    if (p) return { name: clip(p.name, 120), industry: pc.normaliseIndustry(p.industry), country: clip(p.country || p.hqCountry || "", 60), source: "prospect" };
    const l = (leads || []).find((x) => x && x.company && pc.companyKey(x.company.name) === key);
    if (l) return { name: clip(l.company.name, 120), industry: pc.normaliseIndustry(l.company.industry), country: clip((l.company.countries || [])[0] || "", 60), source: "lead" };
  }
  return wanted.length ? { name: clip(wanted[0], 120), industry: "", country: "", source: "" } : null;
}
// The retailer's vertical: named in the instruction ("retail grocery", "in
// pharmacy"), else the prospect's record. One of the nine industries, or "".
function industryFor(instruction, prospect) {
  let s = String(instruction || "");
  if (prospect && prospect.name) s = s.split(prospect.name).join(" ");
  return pc.normaliseIndustry(s) || (prospect && prospect.industry) || "";
}
// The facts block the model sees about the prospect.
function prospectBlock(prospect, industry) {
  if (!prospect && !industry) return "";
  const rows = [
    prospect && prospect.name ? `Company: ${prospect.name}` : "",
    industry ? `Industry (the retailer's vertical): ${industry}` : "",
    prospect && prospect.country ? `Country: ${prospect.country}` : "",
  ].filter(Boolean);
  return `<prospect>\n${rows.join("\n")}\n</prospect>`;
}

// ── The Help Centre as source material ────────────────────────────────────
// One line per published article that is on the website (features, use
// cases, case studies), the industry's own first, within a budget.
const HELP_CENTRE_BUDGET = 30000;
function helpCentreBlock(articles, industry = "") {
  const words = lower(industry).split(/[^a-z]+/).filter((w) => w.length > 3);
  const rows = (articles || []).filter((a) => a && a.title && !a.hiddenFromWebsite).map((a) => {
    const text = `${a.title} ${a.summary || ""} ${a.directAnswer || ""} ${(a.keywords || []).join(" ")} ${a.categoryName || ""}`.toLowerCase();
    const score = words.filter((w) => text.includes(w.replace(/s$/, ""))).length + (/case stud|customer stor|use case/.test(text) ? 1 : 0);
    return { score, line: `- ${clip(a.title, 160)}${a.categoryName ? ` (${clip(a.categoryName, 60)})` : ""}: ${clip(String(a.summary || a.directAnswer || "").replace(/\s+/g, " "), 320)}` };
  }).sort((a, b) => b.score - a.score);
  let used = 0;
  const lines = [];
  for (const r of rows) {
    if (used + r.line.length + 1 > HELP_CENTRE_BUDGET) break;
    used += r.line.length + 1;
    lines.push(r.line);
  }
  return lines.length ? `<help_centre>\n${lines.join("\n")}\n</help_centre>` : "";
}

// ── What must never be in it ──────────────────────────────────────────────
// Internal names (the brand skill's §7 list, the console's own names) and what
// to say instead; null means the sentence is dropped.
const BRAND_RENAMES = Object.freeze([
  [/\bPH\s+Core\b/g, "Personalisation Hub"],
  [/\bAutonomous\s+Shopfront\b/gi, "Shopfront signage"],
  [/\bContext\s?360\b/gi, "Smart shelves"],
  [/\bLive\s+Visitor\s+Profiles?\b/g, "real-time visitor profiles"],
  [/\bmenu\s+board\s+project\b/gi, "menu boards"],
]);
const INTERNAL_NAMES = Object.freeze([
  "PH Agent Console", "Agent Console", "Backlog Tracker", "Prototype Backlog", "Staff Kanban", "Concept Incubator",
  "deployment train", "Release group", "Notify Claude", "Experience Templates", "Products and Pricing Prototype",
]);
// Personalisation Hub is presented as a global company: no home city or country.
const AUSTRALIA_RE = /\b(?:sydney|australia|australian|aussie|new\s+south\s+wales|nsw)\b/i;
// When the prospect itself is Australian, its own country may be named; only a
// sentence that places Personalisation Hub there is dropped.
const HOME_RE = /\b(?:based|headquarter\w*|founded|home[\s-]?grown|origin\w*|offices?|HQ|homegrown)\b/i;
const LONG_DASH_RE = /\s*[—―]\s*|\s+[–]\s+/g;
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Split a line into its sentences, keeping the separators.
function sentencesOf(line) { return line.split(/(?<=[.!?])\s+(?=[A-Z0-9"'‘“(*_])/); }
// A list or heading marker kept when its text is dropped, so the line goes.
const MARKER_RE = /^(\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)?)(.*)$/;

// { text, changes: [{ rule, count }] }: the collateral with every sentence that
// gives Personalisation Hub a home city or country, or names an internal
// project, dropped; brand-renamed terms renamed; long dashes replaced.
// `internalNames` adds the console's project names to the built-in list.
function guardCollateral(text, { internalNames = [], prospectCountry = "" } = {}) {
  const counts = { australia: 0, internal: 0, renamed: 0, dashes: 0 };
  const australian = AUSTRALIA_RE.test(String(prospectCountry || ""));
  const names = [...INTERNAL_NAMES, ...(internalNames || [])].map((n) => String(n || "").trim()).filter((n) => n.length >= 6);
  const nameRes = [...new Set(names.map(lower))].map((n) => new RegExp(`(?:^|[^\\w])${escapeRe(n).replace(/\s+/g, "\\s+")}(?![\\w])`, "i"));
  const dropSentence = (s) => {
    if (AUSTRALIA_RE.test(s) && (!australian || HOME_RE.test(s))) { counts.australia += 1; return true; }
    if (nameRes.some((re) => re.test(s))) { counts.internal += 1; return true; }
    return false;
  };
  let inCode = false;
  const out = [];
  for (const raw of String(text || "").replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*```/.test(raw)) { inCode = !inCode; out.push(raw); continue; }
    let line = raw;
    for (const [re, to] of BRAND_RENAMES) line = line.replace(re, () => { counts.renamed += 1; return to; });
    // A range ("3–5 stores") reads "3 to 5"; any other long dash becomes a comma.
    line = line.replace(/(\d)\s*[–—]\s*(\d)/g, (m, a, b) => { counts.dashes += 1; return `${a} to ${b}`; });
    line = line.replace(LONG_DASH_RE, () => { counts.dashes += 1; return ", "; });
    line = line.replace(/[—―]/g, () => { counts.dashes += 1; return ", "; });
    if (inCode) { out.push(line); continue; }
    if (/^\s*\|/.test(line)) { // a table row: one cell is not a sentence, so the row goes
      if (dropSentence(line)) continue;
      out.push(line);
      continue;
    }
    const [, marker, body] = line.match(MARKER_RE);
    if (!body.trim()) { out.push(line); continue; }
    const kept = sentencesOf(body).filter((s) => !dropSentence(s));
    if (!kept.length) continue;
    out.push(`${marker}${kept.join(" ")}`);
  }
  const textOut = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const changes = Object.entries(counts).filter(([, n]) => n).map(([rule, count]) => ({ rule, count }));
  return { text: textOut, changes };
}
// One line for the ticket about what the guard changed, or "".
function guardLine(changes) {
  const say = { australia: (n) => `${n} sentence${n === 1 ? "" : "s"} placing Personalisation Hub in Australia`, internal: (n) => `${n} sentence${n === 1 ? "" : "s"} naming an internal project`,
    renamed: (n) => `${n} internal name${n === 1 ? "" : "s"} renamed`, dashes: (n) => `${n} long dash${n === 1 ? "" : "es"}` };
  const parts = (changes || []).filter((c) => say[c.rule]).map((c) => say[c.rule](c.count));
  return parts.length ? `Removed from the collateral before it was sent: ${parts.join(", ")}.` : "";
}

// ── The prompt ────────────────────────────────────────────────────────────
function collateralSystem({ format, industry = "", prospect = null, internalNames = [] }) {
  const f = format || FORMATS.overview;
  const banned = [...INTERNAL_NAMES, "PH Core", "Autonomous Shopfront", "Context360", "Live Visitor Profile", ...(internalNames || [])].filter(Boolean);
  return [
    "",
    `This is external sales collateral: a ${f.label.toLowerCase()} of ${f.pages} (${f.words}), written for ${prospect && prospect.name ? `${prospect.name}, a retailer` : "a retailer"}${industry ? ` in ${industry}` : ""}, and for anyone they share it with.`,
    "Voice, tone, messaging, product names and the call to action come from <brand_skill> (the brand guidelines). Structure and depth come from <skill> when one is given; otherwise from the brand skill.",
    "Personalisation Hub is a global company: never mention Sydney, Australia or any city or country as its home, base, office or origin.",
    `Never use an internal name: ${[...new Set(banned)].join(", ")}. Name the capability instead, as the brand guidelines say.`,
    "Name the industry as the retailer's own vertical (grocery, pharmacy, convenience …), never a generic 'retail'. Lead with that vertical's pain points and the features that answer them.",
    "Facts come only from the brand skill, its reference material, <help_centre>, <prospect>, the email and its attachments. Never invent statistics, customer names, case studies, prices or commitments; leave out what isn't there. Never mention revenue, sales figures or anyone's customers.",
    "Write documentMd as Markdown that the branded layout understands: one `# ` title (sentence case, at most six words), an opening paragraph of one or two sentences, then `## ` sections with short paragraphs, `-` bullet lists and, where it helps, one table. A `> ` line is a highlighted callout. No HTML, no images, no code, no long dashes (em or en dashes).",
    f.pageBreaks ? "Each `## ` section is its own page: one idea per page, a short headline and at most five bullets." : "",
    "Do not write a call to action, contact details or a sign-off: the layout adds the call to action (the free trial on AWS Marketplace, then booking a demo at personalisationhub.com).",
    "replyText says that the collateral is attached as a branded PDF with its Markdown source for editing.",
  ].filter((l) => l !== "").join("\n");
}

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

// Pages in a PDF: its page objects (/Type /Page, not /Pages).
function pdfPageCount(buf) {
  const s = Buffer.isBuffer(buf) ? buf.toString("latin1") : String(buf || "");
  return (s.match(/\/Type\s*\/Page(?![a-zA-Z])/g) || []).length;
}
const isPdf = (buf) => Buffer.isBuffer(buf) && buf.length > 64 && buf.subarray(0, 5).toString("latin1") === "%PDF-";
// The two files: <base>.pdf and <base>.md.
function fileNames(fileName, title) {
  const md = String(fileName || "").toLowerCase().endsWith(".md") ? fileName : `${String(title || "collateral").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "collateral"}.md`;
  return { md, pdf: md.replace(/\.md$/, ".pdf") };
}
// The brand skill's files the model reads: its guidelines, not the logo SVGs.
const promptFiles = (skill) => Object.assign({}, skill, { files: (skill && Array.isArray(skill.files) ? skill.files : []).filter((f) => f && !/\.(svg|png|jpe?g|gif|webp|css)$/i.test(String(f.path || ""))) });
// The brand skill in the library: by its slug.
const brandSkillIn = (skills) => (skills || []).find((s) => lower(s.slug) === BRAND_SLUG) || null;

module.exports = {
  BRAND_SLUG, FORMATS, collateralFormat, namesIn, prospectFor, industryFor, prospectBlock, helpCentreBlock, HELP_CENTRE_BUDGET,
  INTERNAL_NAMES, guardCollateral, guardLine, collateralSystem, markdownToHtml, BRAND, brandAssets, collateralHtml, footerTemplate, PDF_OPTIONS,
  pdfPageCount, isPdf, fileNames, promptFiles, brandSkillIn,
};
