// Promote › Leads and Prospects (TAM): how a record's company enrichment reads
// on the page. The enrichment map is written by functions/lead-enrich.js (an
// agent's web research plus the company's own home page):
//   { at, by, summary, logoUrl, logos{light, dark}, storeCount, storeCountBreakdown,
//     storeCountSource{title, url, date}, hq, employees, revenue, techStack[], vendors[],
//     linkedinCompany, retailMedia, personalisation, inStoreDigital, loyalty,
//     primaryCloud, estate, strategy, fit, talkingPoints[],
//     people[{name, title, linkedin, note}],
//     news[{title, url, date, source}],
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
  if (enrichmentSkipped(e)) return "Research anyway";
  return e && e.at ? "Refresh info" : "Enrich";
}
// The last run stopped at the check before research (spam, or no physical sites found).
export function enrichmentSkipped(e) { return Boolean(e && e.request && e.request.status === "skipped"); }

// One line for the status under the button.
export function enrichmentStatus(e) {
  if (enrichmentRunning(e)) return "Researching the company on the web… the findings appear here when it finishes (usually under two minutes).";
  const r = e && e.request;
  if (r && r.status === "skipped") return r.message || "Not researched: this didn't pass the check for a real company with physical sites.";
  if (r && r.status === "error") return `The last research run didn't finish: ${r.message || "no source answered"} Press the button to try again.`;
  return "";
}

const fmtDay = (s) => {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(String(s || ""));
  if (!m) return String(s || "");
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +(m[3] || 1)));
  return d.toLocaleDateString("en-GB", m[3] ? { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" } : { month: "short", year: "numeric", timeZone: "UTC" });
};
const link = (u, text) => { const h = safeUrl(u); return h ? `<a href="${esc(h)}" target="_blank" rel="noopener noreferrer">${esc(text || u)}</a>` : esc(text || ""); };

// What the research says about retail media and personalisation, in reading order.
const INSIGHTS = [
  ["Why they fit", (e) => e.fit], ["Retail media", (e) => e.retailMedia], ["Personalisation", (e) => e.personalisation],
  ["In-store screens and signage", (e) => e.inStoreDigital], ["Loyalty", (e) => e.loyalty],
  ["Estate", (e) => e.estate], ["Strategy and pressures", (e) => e.strategy],
];
// The number of sites, first on every view: the count, what it is made of and where it came from.
const sitesOf = (e) => {
  const n = e && Number(e.storeCount);
  if (!n || !Number.isFinite(n)) return null;
  const src = e.storeCountSource && safeUrl(e.storeCountSource.url) ? e.storeCountSource : null;
  return { count: Math.round(n).toLocaleString("en-GB"), breakdown: e.storeCountBreakdown || "", src };
};
const sitesHTML = (s) => `<span class="enrich-sites-count">${esc(s.count)}</span>${s.breakdown ? `<p class="enrich-insight">${esc(s.breakdown)}</p>` : ""}${s.src ? `<span class="enrich-meta">${link(s.src.url, s.src.title || "Source")}${s.src.date ? ` · ${esc(fmtDay(s.src.date))}` : ""}</span>` : ""}`;
// The full logos for the branded walkthrough demo: one on a light tile, one on a dark tile.
const logoTiles = (e) => {
  const l = e && e.logos && typeof e.logos === "object" ? e.logos : {};
  const light = safeUrl(l.light), dark = safeUrl(l.dark);
  if (!light && !dark) return "";
  const tile = (u, cls, label) => (u ? `<a class="enrich-logo-tile ${cls}" href="${esc(u)}" target="_blank" rel="noopener noreferrer" title="${esc(label)}"><img src="${esc(u)}" alt="${esc(label)}" loading="lazy" referrerpolicy="no-referrer"></a>` : `<span class="enrich-logo-tile ${cls} enrich-logo-tile-none">${esc(label)}: not found</span>`);
  return `<div class="enrich-logo-tiles">${tile(light, "enrich-logo-tile-light", "Logo for light backgrounds")}${tile(dark, "enrich-logo-tile-dark", "Logo for dark backgrounds")}</div>`;
};
const pointsOf = (e) => (Array.isArray(e && e.talkingPoints) ? e.talkingPoints.filter(Boolean) : []);
const personMeta = (p) => [p.title, p.note].filter(Boolean).join(" · ");
const insightsOf = (e) => (e ? INSIGHTS.map(([label, get]) => [label, get(e)]).filter(([, v]) => v) : []);
const peopleOf = (e) => (Array.isArray(e && e.people) ? e.people.filter((p) => p && p.name) : []);
const linkedinOf = (u) => { const h = safeUrl(u); try { return h && /(^|\.)linkedin\.com$/i.test(new URL(h).hostname) ? h : ""; } catch { return ""; } };

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
    ["Head office", e.hq], ["Employees", e.employees], ["Revenue", e.revenue], ["Primary cloud", e.primaryCloud],
    ...(Array.isArray(e.facts) ? e.facts.map((f) => [f.label, f.value]) : []),
  ].filter(([, v]) => v);
  const stack = [...new Set([...(Array.isArray(e.techStack) ? e.techStack : []), ...(Array.isArray(e.vendors) ? e.vendors : [])])];
  const news = Array.isArray(e.news) ? e.news.filter((n) => n && n.title) : [];
  const fin = e.financials && (e.financials.summary || (e.financials.sources || []).length) ? e.financials : null;
  const sources = Array.isArray(e.sources) ? e.sources : [];
  const li = safeUrl(e.linkedinCompany);
  const failed = sources.filter((s) => s.status === "error");
  const sites = sitesOf(e);
  const research = [
    sites ? stackRow(`<span class="ap-row-label">Sites</span>${sitesHTML(sites)}`, "", "enrich-sites") : "",
    e.summary ? stackRow(`<p class="enrich-summary">${esc(e.summary)}</p>`) : "",
    ...facts.map(([k, v]) => row(k, esc(v))),
    li ? row("LinkedIn", link(li, "Company page")) : "",
    logoTiles(e) ? stackRow(`<span class="ap-row-label">Logos for the walkthrough demo</span>${logoTiles(e)}`) : "",
    stack.length ? stackRow(`<span class="ap-row-label">Tech stack and vendors</span><ul class="lead-stack">${stack.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`) : "",
    ...failed.map((s) => `<div class="ap-row ap-row-line lead-source-error">${esc(s.message)}</div>`),
    at ? `<div class="ap-row enrich-updated"><span class="ap-row-label">Updated</span><span class="ap-row-value">${esc(at.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }))}${tip(sources.map((s) => s.message).filter(Boolean).join(" · "), "Sources checked")}</span></div>` : "",
  ].join("");
  const newsRows = news.map((n) => stackRow(`${link(n.url, n.title)}<span class="enrich-meta">${esc([n.source, fmtDay(n.date)].filter(Boolean).join(" · "))}</span>`, "", "enrich-news-row")).join("");
  const finRows = fin ? [
    fin.summary ? stackRow(`<p class="enrich-fin">${esc(fin.summary)}</p>`) : "",
    ...(fin.sources || []).map((s) => stackRow(`${link(s.url, s.title || s.url)}<span class="enrich-meta">${esc(fmtDay(s.date))}</span>`, "", "enrich-news-row")),
  ].join("") : "";
  const insightRows = insightsOf(e).map(([k, v]) => stackRow(`<span class="ap-row-label">${esc(k)}</span><p class="enrich-insight">${esc(v)}</p>`)).join("");
  const peopleRows = peopleOf(e).map((p) => { const li2 = linkedinOf(p.linkedin); return stackRow(`${li2 ? link(li2, p.name) : esc(p.name)}<span class="enrich-meta">${esc(personMeta(p))}</span>`, "", "enrich-news-row"); }).join("");
  const pointRows = pointsOf(e).map((t) => stackRow(`<p class="enrich-insight">${esc(t)}</p>`)).join("");
  return group("Company research", research || lineRow("Nothing found yet"))
    + group("Talking points", pointRows, { tipText: "Openers for a first meeting or email, each tied to something the research found. Check the source before you quote one." })
    + group("Retail media and personalisation", insightRows)
    + group("Key people", peopleRows, { tipText: "Found in public sources by the research. Add the ones you are talking to as contacts." })
    + group("Recent news", newsRows)
    + group(fin && fin.period ? `Recent financials · ${fin.period}` : "Recent financials", finRows);
}

// The findings: company facts, recent news and recent financials, each with its sources and dates.
export function enrichmentHTML(e) {
  if (!e || !e.at) return "";
  const at = enrichedAt(e);
  const facts = [
    ["Head office", e.hq], ["Employees", e.employees], ["Revenue", e.revenue], ["Primary cloud", e.primaryCloud],
    ...(Array.isArray(e.facts) ? e.facts.map((f) => [f.label, f.value]) : []),
  ].filter(([, v]) => v);
  const stack = [...new Set([...(Array.isArray(e.techStack) ? e.techStack : []), ...(Array.isArray(e.vendors) ? e.vendors : [])])];
  const news = Array.isArray(e.news) ? e.news.filter((n) => n && n.title) : [];
  const fin = e.financials && (e.financials.summary || (e.financials.sources || []).length) ? e.financials : null;
  const sources = Array.isArray(e.sources) ? e.sources : [];
  const li = safeUrl(e.linkedinCompany);
  const sites = sitesOf(e);
  return `<div class="enrich-view">
    ${sites ? `<div class="enrich-sites"><p class="enrich-label">Sites</p>${sitesHTML(sites)}</div>` : ""}
    ${e.summary ? `<p class="enrich-summary">${esc(e.summary)}</p>` : ""}
    ${facts.length ? `<dl class="enrich-facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>` : ""}
    ${li ? `<p class="enrich-line">${link(li, "Company LinkedIn page")}</p>` : ""}
    ${logoTiles(e) ? `<p class="enrich-label">Logos for the walkthrough demo</p>${logoTiles(e)}` : ""}
    ${stack.length ? `<p class="enrich-label">Tech stack and vendors</p><ul class="lead-stack">${stack.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
    ${pointsOf(e).length ? `<p class="enrich-label">Talking points</p><ul class="enrich-news">${pointsOf(e).map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
    ${insightsOf(e).map(([k, v]) => `<p class="enrich-label">${esc(k)}</p><p class="enrich-insight">${esc(v)}</p>`).join("")}
    ${peopleOf(e).length ? `<p class="enrich-label">Key people</p><ul class="enrich-news">${peopleOf(e).map((p) => `<li>${linkedinOf(p.linkedin) ? link(linkedinOf(p.linkedin), p.name) : esc(p.name)}<span class="enrich-meta">${esc(personMeta(p))}</span></li>`).join("")}</ul>` : ""}
    ${news.length ? `<p class="enrich-label">Recent news</p><ul class="enrich-news">${news.map((n) => `<li>${link(n.url, n.title)}<span class="enrich-meta">${esc([n.source, fmtDay(n.date)].filter(Boolean).join(" · "))}</span></li>`).join("")}</ul>` : ""}
    ${fin ? `<p class="enrich-label">Recent financials${fin.period ? ` · ${esc(fin.period)}` : ""}</p>${fin.summary ? `<p class="enrich-fin">${esc(fin.summary)}</p>` : ""}${(fin.sources || []).length ? `<ul class="enrich-news">${fin.sources.map((s) => `<li>${link(s.url, s.title || s.url)}<span class="enrich-meta">${esc(fmtDay(s.date))}</span></li>`).join("")}</ul>` : ""}` : ""}
    ${at ? `<p class="field-hint enrich-updated">Updated ${esc(at.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }))}</p>` : ""}
    ${sources.length ? `<ul class="lead-sources">${sources.map((s) => `<li data-status="${esc(s.status)}">${esc(s.message)}</li>`).join("")}</ul>` : ""}
  </div>`;
}
