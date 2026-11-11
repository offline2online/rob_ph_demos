// Promote › Leads and Prospects (TAM): how a record's company enrichment reads
// on the page. The enrichment map is written by functions/lead-enrich.js (an
// agent's web research plus the company's own home page):
//   { at, by, summary, logoUrl, hq, employees, revenue, techStack[], vendors[],
//     linkedinCompany, news[{title, url, date, source}],
//     financials{summary, period, sources[{title, url, date}]}, facts[{label, value}],
//     sources[{source, status, message}], request{id, status, at, startedAt, finishedAt, message} }
// Used by leads-page.js (the lead drawer and form) and prospect-detail.js (the
// TAM record). Everything here is escaped and every address is http(s) only:
// an agent writes these fields.
import { group, row, stackRow, lineRow, tip } from "./ap-components.js";

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
export const safeUrl = (u) => { try { const x = new URL(String(u)); return x.protocol === "https:" || x.protocol === "http:" ? x.href : ""; } catch { return ""; } };

function toDate(v) {
  if (!v) return null;
  const d = typeof v.toDate === "function" ? v.toDate() : new Date(typeof v.seconds === "number" ? v.seconds * 1000 : v);
  return Number.isNaN(d.getTime()) ? null : d;
}
export function enrichedAt(e) { return toDate(e && e.at); }

// "running" while a run is queued or underway (a run older than 10 minutes counts as stale).
export function enrichmentRunning(e, nowMs = Date.now()) {
  const r = e && e.request;
  if (!r || (r.status !== "queued" && r.status !== "running")) return false;
  const since = toDate(r.startedAt) || toDate(r.at);
  return !since || nowMs - since.getTime() < 10 * 60 * 1000;
}

// What the button says: Enrich before the first run, Refresh after it.
export function enrichButtonLabel(e) {
  if (enrichmentRunning(e)) return "Researching…";
  return e && e.at ? "Refresh info" : "Enrich";
}

// One line for the status under the button.
export function enrichmentStatus(e) {
  if (enrichmentRunning(e)) return "Researching the company on the web… the findings appear here when it finishes (usually under two minutes).";
  const r = e && e.request;
  if (r && r.status === "error") return `The last run found nothing new: ${r.message || "no source answered"}`;
  return "";
}

const fmtDay = (s) => {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(String(s || ""));
  if (!m) return String(s || "");
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +(m[3] || 1)));
  return d.toLocaleDateString("en-GB", m[3] ? { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" } : { month: "short", year: "numeric", timeZone: "UTC" });
};
const link = (u, text) => { const h = safeUrl(u); return h ? `<a href="${esc(h)}" target="_blank" rel="noopener noreferrer">${esc(text || u)}</a>` : esc(text || ""); };

export function initialsOf(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return ((parts[0] || "")[0] || "").toUpperCase() + ((parts[1] || "")[0] || "").toUpperCase();
}
// The company's logo, or its initials when there is none (or the image fails: see wireLogoFallback).
export function logoHTML(e, name, cls = "enrich-logo") {
  const u = safeUrl(e && e.logoUrl);
  return u
    ? `<img class="${cls}" src="${esc(u)}" alt="${esc(name)} logo" loading="lazy" referrerpolicy="no-referrer" data-initials="${esc(initialsOf(name))}">`
    : `<span class="${cls} ${cls}-fallback" aria-hidden="true">${esc(initialsOf(name))}</span>`;
}
// A logo that fails to load becomes the initials.
export function wireLogoFallback(root, cls = "enrich-logo") {
  root.querySelectorAll(`img.${cls}`).forEach((im) => {
    if (im.dataset.wired) return;
    im.dataset.wired = "1";
    im.addEventListener("error", () => {
      const s = document.createElement("span");
      s.className = `${cls} ${cls}-fallback`; s.setAttribute("aria-hidden", "true"); s.textContent = im.dataset.initials || "";
      im.replaceWith(s);
    });
  });
}

// The same findings as three inset grouped cards (ap-components.js), for the
// Leads detail view and lead form: Company research (summary, facts, LinkedIn,
// tech stack, when it was updated, with the sources in its (i)), Recent news
// and Recent financials. Nothing known is left out; an empty group is not drawn.
export function researchGroupsHTML(e) {
  if (!e || !e.at) return group("Company research", lineRow("Not enriched yet", "enrich-none"));
  const at = enrichedAt(e);
  const facts = [
    ["Head office", e.hq], ["Employees", e.employees], ["Revenue", e.revenue],
    ...(Array.isArray(e.facts) ? e.facts.map((f) => [f.label, f.value]) : []),
  ].filter(([, v]) => v);
  const stack = [...new Set([...(Array.isArray(e.techStack) ? e.techStack : []), ...(Array.isArray(e.vendors) ? e.vendors : [])])];
  const news = Array.isArray(e.news) ? e.news.filter((n) => n && n.title) : [];
  const fin = e.financials && (e.financials.summary || (e.financials.sources || []).length) ? e.financials : null;
  const sources = Array.isArray(e.sources) ? e.sources : [];
  const li = safeUrl(e.linkedinCompany);
  const failed = sources.filter((s) => s.status === "error");
  const research = [
    e.summary ? stackRow(`<p class="enrich-summary">${esc(e.summary)}</p>`) : "",
    ...facts.map(([k, v]) => row(k, esc(v))),
    li ? row("LinkedIn", link(li, "Company page")) : "",
    stack.length ? stackRow(`<span class="ap-row-label">Tech stack and vendors</span><ul class="lead-stack">${stack.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`) : "",
    ...failed.map((s) => `<div class="ap-row ap-row-line lead-source-error">${esc(s.message)}</div>`),
    at ? `<div class="ap-row enrich-updated"><span class="ap-row-label">Updated</span><span class="ap-row-value">${esc(at.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }))}${tip(sources.map((s) => s.message).filter(Boolean).join(" · "), "Sources checked")}</span></div>` : "",
  ].join("");
  const newsRows = news.map((n) => stackRow(`${link(n.url, n.title)}<span class="enrich-meta">${esc([n.source, fmtDay(n.date)].filter(Boolean).join(" · "))}</span>`, "", "enrich-news-row")).join("");
  const finRows = fin ? [
    fin.summary ? stackRow(`<p class="enrich-fin">${esc(fin.summary)}</p>`) : "",
    ...(fin.sources || []).map((s) => stackRow(`${link(s.url, s.title || s.url)}<span class="enrich-meta">${esc(fmtDay(s.date))}</span>`, "", "enrich-news-row")),
  ].join("") : "";
  return group("Company research", research || lineRow("Nothing found yet"))
    + group("Recent news", newsRows)
    + group(fin && fin.period ? `Recent financials · ${fin.period}` : "Recent financials", finRows);
}

// The findings: company facts, recent news and recent financials, each with its sources and dates.
export function enrichmentHTML(e) {
  if (!e || !e.at) return "";
  const at = enrichedAt(e);
  const facts = [
    ["Head office", e.hq], ["Employees", e.employees], ["Revenue", e.revenue],
    ...(Array.isArray(e.facts) ? e.facts.map((f) => [f.label, f.value]) : []),
  ].filter(([, v]) => v);
  const stack = [...new Set([...(Array.isArray(e.techStack) ? e.techStack : []), ...(Array.isArray(e.vendors) ? e.vendors : [])])];
  const news = Array.isArray(e.news) ? e.news.filter((n) => n && n.title) : [];
  const fin = e.financials && (e.financials.summary || (e.financials.sources || []).length) ? e.financials : null;
  const sources = Array.isArray(e.sources) ? e.sources : [];
  const li = safeUrl(e.linkedinCompany);
  return `<div class="enrich-view">
    ${e.summary ? `<p class="enrich-summary">${esc(e.summary)}</p>` : ""}
    ${facts.length ? `<dl class="enrich-facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>` : ""}
    ${li ? `<p class="enrich-line">${link(li, "Company LinkedIn page")}</p>` : ""}
    ${stack.length ? `<p class="enrich-label">Tech stack and vendors</p><ul class="lead-stack">${stack.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
    ${news.length ? `<p class="enrich-label">Recent news</p><ul class="enrich-news">${news.map((n) => `<li>${link(n.url, n.title)}<span class="enrich-meta">${esc([n.source, fmtDay(n.date)].filter(Boolean).join(" · "))}</span></li>`).join("")}</ul>` : ""}
    ${fin ? `<p class="enrich-label">Recent financials${fin.period ? ` · ${esc(fin.period)}` : ""}</p>${fin.summary ? `<p class="enrich-fin">${esc(fin.summary)}</p>` : ""}${(fin.sources || []).length ? `<ul class="enrich-news">${fin.sources.map((s) => `<li>${link(s.url, s.title || s.url)}<span class="enrich-meta">${esc(fmtDay(s.date))}</span></li>`).join("")}</ul>` : ""}` : ""}
    ${at ? `<p class="field-hint enrich-updated">Updated ${esc(at.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }))}</p>` : ""}
    ${sources.length ? `<ul class="lead-sources">${sources.map((s) => `<li data-status="${esc(s.status)}">${esc(s.message)}</li>`).join("")}</ul>` : ""}
  </div>`;
}
