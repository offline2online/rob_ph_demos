// Shared Apple-style building blocks (styles in css/apple.css, "Inset grouped
// cards and rows"): a titled inset grouped card, label/value rows, stacked rows
// with trailing actions, a full-width row button, a round 44px icon button and
// an (i) tooltip. First used by Promote › Leads (leads-page.js and
// enrichment-view.js); any page can build from them instead of one-off styles.
// Every helper takes HTML for its content: the caller escapes what it passes.
export const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// (i) beside a title or label; the text shows on hover, focus or tap (ui-polish.js).
export const tip = (text, label = "More information") => (text ? `<button type="button" class="info-tip" data-tip="${esc(text)}" aria-label="${esc(label)}">i</button>` : "");

// A titled inset grouped card. `aside` is HTML shown at the right of the title (a count, a pill).
export function group(title, body, { id = "", cls = "", tipText = "", aside = "" } = {}) {
  if (!body) return "";
  return `<section class="ap-section ${cls}"${id ? ` id="${esc(id)}"` : ""}>${title ? `<h3 class="ap-group-title">${esc(title)}${tip(tipText, `About ${title}`)}${aside ? `<span class="ap-group-aside">${aside}</span>` : ""}</h3>` : ""}<div class="ap-group">${body}</div></section>`;
}

// Label left, value right. Empty values are left out.
export const row = (label, valueHtml) => (valueHtml ? `<div class="ap-row"><span class="ap-row-label">${esc(label)}</span><span class="ap-row-value">${valueHtml}</span></div>` : "");

// A row whose content stacks (a person, a news item), with optional trailing actions.
export const stackRow = (mainHtml, actionsHtml = "", cls = "") => `<div class="ap-row ap-row-stack ${cls}"><div class="ap-row-main">${mainHtml}</div>${actionsHtml ? `<div class="ap-row-actions">${actionsHtml}</div>` : ""}</div>`;

// One short line (an empty section).
export const lineRow = (text, cls = "") => `<div class="ap-row ap-row-line ${cls}">${esc(text)}</div>`;

// A round 44px icon link (mail, open in a new tab).
export function iconLink(href, icon, label, external = false) {
  if (!href) return "";
  return `<a class="ap-icon-btn" href="${esc(href)}" aria-label="${esc(label)}" title="${esc(label)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}><span class="material-symbols-outlined" aria-hidden="true">${esc(icon)}</span></a>`;
}

// A neutral pill (a role, a count).
export const pill = (text, cls = "") => (text ? `<span class="ap-pill ${cls}">${esc(text)}</span>` : "");
