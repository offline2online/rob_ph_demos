// Boot shared by every page: embed mode, version stamp, search box, icons.
import { initScrollMemory, restoreScrollMemory } from "./faq-data.js";
import { APP_VERSION } from "./version.js";
import { initSearchBox } from "./search-box.js";
import { iconSvg } from "./icons.js";

// Fires a custom analytics event into the host page's dataLayer / gtag, if
// there is one (the help centre loads no analytics tag of its own — the
// WordPress site that hosts it has its own; otherwise a harmless no-op
// dataLayer). Used by the article page's topic/industry picker
// (faqArticles.sectionPicker) to report which section a reader chose. GA
// (gtag.js) reads its events from calling gtag() directly; GTM reads them
// off a plain dataLayer.push() — checking for window.gtag picks the right
// one without the caller needing to know which tag type the host has.
export function trackEvent(name, params) {
  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag === "function") window.gtag("event", name, params || {});
  else window.dataLayer.push({ event: name, ...(params || {}) });
}

export function bootPage() {
  initScrollMemory();
  const v = document.getElementById("app-version");
  if (v) v.textContent = `v${APP_VERSION}`;
  const si = document.getElementById("search-icon");
  if (si) si.innerHTML = iconSvg("search", 20);
  initSearchBox().catch(() => { /* search is a progressive enhancement */ });
}

// Re-exported so every page script only needs one import ("./page-common.js")
// to both boot and, once its own content has rendered, restore scroll — see
// initScrollMemory/restoreScrollMemory in faq-data.js for what this covers
// and why (wIk1aL99zS8Oy6jAHvGI: refresh should keep a reader's place, both
// standalone and embedded).
export { restoreScrollMemory };

export function showLoadError() {
  const el = document.getElementById("load-error");
  if (el) el.hidden = false;
  document.querySelectorAll("[aria-busy]").forEach((n) => n.removeAttribute("aria-busy"));
}
