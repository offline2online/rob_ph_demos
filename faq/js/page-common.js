// Boot shared by every page: embed mode, version stamp, search box, icons,
// analytics.
import { initEmbedMode, initScrollMemory, restoreScrollMemory } from "./faq-data.js";
import { APP_VERSION } from "./version.js";
import { initSearchBox } from "./search-box.js";
import { iconSvg } from "./icons.js";

// A Google Analytics measurement ID or Google Tag Manager container ID set
// on the console's Settings page (kup9Zce13jyaXcIhxVkf) is exported into
// this static file by faq-export.js (backlog-tracker/scripts/faq-export.js)
// — the public site never talks to Firestore for this, same as every other
// piece of content here. Fire-and-forget: a missing/unreadable file (a repo
// that's never run an export since this shipped) just means no tag, not a
// broken page — every other page feature already tolerates that same
// failure mode for data/index.json.
//
// Every faq/*.html page's CSP is `script-src 'self' https://www.googletagmanager.com`
// (see that meta tag) — no 'unsafe-inline'. GA's and GTM's own official
// snippets are inline <script> text, which a CSP this strict silently drops
// with no console error, so instead of injecting that snippet text this
// does the exact same dataLayer/gtag setup as plain module code (already
// trusted — it's part of this 'self' script) and only ever adds one
// external, allowlisted <script src="https://www.googletagmanager.com/...">.
const ANALYTICS_ID_RE = /^[A-Za-z0-9-]{1,40}$/;
async function injectAnalyticsTag() {
  let tag = null;
  try {
    const res = await fetch("data/settings.json", { cache: "no-store" });
    if (res.ok) tag = (await res.json()).analyticsTag || null;
  } catch { /* no analytics is a fine outcome */ }
  if (!tag || !ANALYTICS_ID_RE.test(tag) || document.getElementById("ph-faq-analytics")) return;
  window.dataLayer = window.dataLayer || [];
  const loader = document.createElement("script");
  loader.id = "ph-faq-analytics";
  loader.async = true;
  if (/^GTM-/i.test(tag)) {
    window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
    loader.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(tag)}`;
  } else {
    window.gtag = window.gtag || function gtag() { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", tag);
    loader.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(tag)}`;
  }
  document.head.appendChild(loader);
}

// Fires a custom analytics event through whichever tag injectAnalyticsTag
// set up (or a no-op dataLayer if none is configured — same "missing tag is
// a fine outcome, not an error" posture as everything else here). Used by
// the article page's topic/industry picker (faqArticles.sectionPicker) to
// report which section a reader chose. GA (gtag.js) reads its events from
// calling gtag() directly; GTM reads them off a plain dataLayer.push() —
// window.gtag only exists in the GA branch above, so checking for it picks
// the right one without the caller needing to know which tag type is set.
export function trackEvent(name, params) {
  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag === "function") window.gtag("event", name, params || {});
  else window.dataLayer.push({ event: name, ...(params || {}) });
}

export function bootPage() {
  initEmbedMode();
  initScrollMemory();
  const v = document.getElementById("app-version");
  if (v) v.textContent = `v${APP_VERSION}`;
  const si = document.getElementById("search-icon");
  if (si) si.innerHTML = iconSvg("search", 20);
  initSearchBox().catch(() => { /* search is a progressive enhancement */ });
  injectAnalyticsTag();
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
