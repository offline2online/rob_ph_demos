// WordPress publish status for FAQ Management (rescoped 3 Nov 2026).
//
// Publishing is NOT done from here. The "PH Support Centre" snippet on
// personalisationhub.com pulls the console's export (faq/data) hourly and
// writes the Help articles itself. This module only READS the public,
// read-only endpoint it exposes and works out, per article, whether the live
// page is up to date. No WordPress credential, no write. Plain ESM, no DOM:
// test/wp-publish-status.test.mjs.
//
//   GET https://personalisationhub.com/wp-json/ph-help/v1/published
//   → { lastSync, pending, failed: [articleId…], articles: [{id, url, wpId, hash, updatedAt}] }
//
// `hash` is the contentHash WordPress last synced: the first 16 hex chars of
// sha256(bodyMd), exactly as scripts/faq-export.js computes it.

export const WP_PUBLISHED_URL = "https://personalisationhub.com/wp-json/ph-help/v1/published";
export const WP_FALLBACK_ARTICLE_URL = "https://personalisationhub.com/support-centre/article.html?id=";

export const WP_STATUS_LABELS = {
  live: "Live",
  waiting: "Waiting",
  failed: "Failed",
  "not-published": "Not published",
  unavailable: "Status unavailable",
};
export const WP_STATUS_HINTS = {
  live: "The live Support Centre page matches this article.",
  waiting: "Published here but not yet on WordPress, or WordPress has an older copy. It picks it up within about 2 hours (hourly export, then hourly sync).",
  failed: "WordPress tried to sync this article and failed.",
  "not-published": "A draft, retired, or outside its release range, so it is not on WordPress.",
  unavailable: "The WordPress status endpoint could not be reached.",
};

// Same digest as faq-export.js's hash(body), computed in the browser.
export async function contentHashOf(bodyMd, subtle = globalThis.crypto && globalThis.crypto.subtle) {
  const bytes = new TextEncoder().encode(String(bodyMd || ""));
  const buf = await subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

// Normalises the endpoint's JSON; throws on anything that is not that shape,
// so a bad response reads as "unavailable" rather than as "nothing is live".
export function parsePublished(json) {
  if (!json || typeof json !== "object" || !Array.isArray(json.articles)) throw new Error("unexpected response");
  const byId = new Map();
  json.articles.forEach((a) => { if (a && a.id != null) byId.set(String(a.id), a); });
  return {
    lastSync: json.lastSync || null,
    pending: Number(json.pending) || 0,
    failed: new Set((Array.isArray(json.failed) ? json.failed : []).map(String)),
    byId,
  };
}

export async function fetchPublished(fetchFn = globalThis.fetch, url = WP_PUBLISHED_URL) {
  const res = await fetchFn(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parsePublished(await res.json());
}

// `inRange` is whether the article applies to the current release; `hash` is
// the article's current contentHash. `published` is the parsed endpoint, or
// null when it could not be read.
export function articleStatus({ article, inRange, hash, published }) {
  if (!published) return "unavailable";
  const isPublished = article && article.status === "published" && !article.retiredAt;
  if (!isPublished || !inRange) return "not-published";
  if (published.failed.has(String(article.id))) return "failed";
  const entry = published.byId.get(String(article.id));
  return entry && hash && entry.hash === hash ? "live" : "waiting";
}

export function liveUrlFor(id, published) {
  const entry = published && published.byId.get(String(id));
  return (entry && entry.url) || `${WP_FALLBACK_ARTICLE_URL}${encodeURIComponent(id)}`;
}

export function lastSyncLabel(published, now = Date.now()) {
  if (!published) return "Last WordPress sync: unavailable";
  if (!published.lastSync) return "Last WordPress sync: not yet";
  const t = typeof published.lastSync === "number" ? published.lastSync * (published.lastSync < 1e12 ? 1000 : 1) : Date.parse(published.lastSync);
  if (!Number.isFinite(t)) return `Last WordPress sync: ${published.lastSync}`;
  const mins = Math.max(0, Math.round((now - t) / 60000));
  const ago = mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : mins < 2880 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} days ago`;
  return `Last WordPress sync: ${ago}`;
}

export function wpStatusBadgeHTML(status, esc = (s) => s) {
  return `<span class="badge badge-wp badge-wp-${status}" title="${esc(WP_STATUS_HINTS[status] || "")}">${esc(WP_STATUS_LABELS[status] || status)}</span>`;
}
