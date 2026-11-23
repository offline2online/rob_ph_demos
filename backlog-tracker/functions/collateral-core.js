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
//                      sentence naming Sydney or Australia, no internal names,
//                      no long dashes; what it changed is kept on the ticket
//   pdfPageCount       how many pages a PDF has
//
// The branded page (Markdown -> HTML, the brand skill's layout, the footer and
// the print options) is functions/collateral-layout.js; the browser that
// prints it is functions/collateral-pdf.js; the run is functions/aidan.js →
// collateralAndReply. Tests: test/collateral-core.test.js,
// test/collateral-layout.test.js, test/collateral-render.test.mjs (the page
// printed to PDF in Chromium) and test/support-mail.test.js (a whole run, stubbed).

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
// Words that make an unspaced en dash a range ("Monday–Friday", "9am–5pm",
// "Q1–Q3"): days, months, and anything with a digit in it.
const RANGE_WORD_RE = /^(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|.*\d.*)$/i;
// Every long dash still left: between two words, "to" for a range and a hyphen
// otherwise ("end–to–end" -> "end-to-end"); anywhere else, a hyphen.
function replaceRemainingDashes(line, count) {
  return line
    .replace(/(?<=([\p{L}\p{N}]+))[–—―](?=([\p{L}\p{N}]+))/gu, (m, a, b) => { count(); return RANGE_WORD_RE.test(a) && RANGE_WORD_RE.test(b) ? " to " : "-"; })
    .replace(/[–—―]/g, () => { count(); return "-"; });
}
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Split a line into its sentences, keeping the separators.
function sentencesOf(line) { return line.split(/(?<=[.!?])\s+(?=[A-Z0-9"'‘“(*_])/); }
// A list or heading marker kept when its text is dropped, so the line goes.
const MARKER_RE = /^(\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)?)(.*)$/;

// { text, changes: [{ rule, count }] }: the collateral with every sentence that
// names Sydney or Australia (for an Australian prospect, only one that gives
// Personalisation Hub a home there), or names an internal project, dropped;
// brand-renamed terms renamed; every long dash replaced (a comma, "to" in a
// range, or a hyphen between words).
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
    // Unspaced en dashes ("Monday–Friday", "end–to–end") and any other left: none survives.
    line = replaceRemainingDashes(line, () => { counts.dashes += 1; });
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
  const say = { australia: (n) => `${n} sentence${n === 1 ? "" : "s"} naming Sydney or Australia`, internal: (n) => `${n} sentence${n === 1 ? "" : "s"} naming an internal project`,
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
    "replyText says that the collateral is attached as a branded PDF. Never mention Markdown: only the PDF is sent. When the instruction asks for another file type (Word, PowerPoint …), replyText says plainly that it is attached as a PDF, and never says or implies that another type is attached.",
    f.key === "one-pager" ? "It must print on exactly one A4 page, the call to action included: keep to the word count, at most three `## ` sections and no more than one short list or table." : "",
  ].filter((l) => l !== "").join("\n");
}

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
  INTERNAL_NAMES, guardCollateral, guardLine, collateralSystem, pdfPageCount, isPdf, fileNames, promptFiles, brandSkillIn,
};
