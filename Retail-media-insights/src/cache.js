'use strict';
// A bounded response cache for the HTTP server. Keys name everything a response depends on, so a hit is exactly what the
// handler would have returned; the store is immutable after load, so an entry stays valid until the store is replaced
// (server.replaceStore clears the cache). Values are the serialised JSON, so a hit also skips JSON.stringify.
//
// Bounds: at most `maxEntries` entries and `maxBytes` bytes of serialised responses, least recently used out first. A single
// response bigger than the byte limit is never cached.

const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;

// Query parameters parseFilters consumes: they are part of the key through the (scoped) filters, not as raw parameters.
const FILTER_PARAMS = new Set(['dateFrom', 'dateTo', 'storeIds', 'displayTypeIds', 'advertiserIds']);
const isFilterParam = (name) => FILTER_PARAMS.has(name) || (name.endsWith('[]') && FILTER_PARAMS.has(name.slice(0, -2)));

class ResponseCache {
  constructor({ maxEntries = DEFAULT_MAX_ENTRIES, maxBytes = DEFAULT_MAX_BYTES } = {}) {
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
    this.entries = new Map(); // key -> {json, bytes}; Map order is recency, oldest first
    this.bytes = 0;
    this.hits = 0;
    this.misses = 0;
  }

  get size() { return this.entries.size; }

  /**
   * The key of one request, after authentication and server-side scoping:
   *  - the route;
   *  - the principal: an advertiser is its own key space (principalType and principalId), and every admin shares one;
   *  - the scoped filters (an advertiser's pinned advertiserIds and display types, never the client's), with each list sorted
   *    because every handler reads them as sets;
   *  - the remaining query parameters, sorted.
   */
  keyFor({ route, principal, filters, params }) {
    const who = principal && principal.principalType === 'advertiser' ? ['advertiser', principal.principalId] : ['admin'];
    const sorted = (list) => (list ? [...list].sort() : null);
    const f = filters && [filters.dateFrom, filters.dateTo, sorted(filters.storeIds), sorted(filters.displayTypeIds), sorted(filters.advertiserIds)];
    const rest = [...params.entries()].filter(([k]) => !isFilterParam(k)).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
    return JSON.stringify([route.path, who, f, rest]);
  }

  get(key) {
    const e = this.entries.get(key);
    if (!e) { this.misses += 1; return undefined; }
    this.hits += 1;
    this.entries.delete(key); this.entries.set(key, e); // now the most recently used
    return e.json;
  }

  set(key, json) {
    const bytes = Buffer.byteLength(json);
    if (bytes > this.maxBytes) return false;
    const old = this.entries.get(key);
    if (old) { this.bytes -= old.bytes; this.entries.delete(key); }
    this.entries.set(key, { json, bytes });
    this.bytes += bytes;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const [oldest, e] = this.entries.entries().next().value;
      this.entries.delete(oldest); this.bytes -= e.bytes;
    }
    return true;
  }

  clear() { this.entries.clear(); this.bytes = 0; }
}

module.exports = { ResponseCache, DEFAULT_MAX_ENTRIES, DEFAULT_MAX_BYTES };
