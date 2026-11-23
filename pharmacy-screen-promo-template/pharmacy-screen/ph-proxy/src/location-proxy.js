"use strict";
// Location API proxy: GET /api/device/{UniqueDeviceID}/campaign_data
//
// Screens never hold the PH API token. They call this proxy, which:
//   1. checks the device id,
//   2. answers from a short per-device cache, or joins a call already in
//      flight for that device, when it can (never rate limited, so nobody
//      can lock a real screen out by spamming its device id),
//   3. otherwise (a cache miss, which costs an upstream call) applies the
//      rate limits, per client, per device and per instance, and calls {baseUrl}/location-api/device/{udid}/campaign_data with
//      the decrypted token in x-api-key, trying the last server that worked
//      first and then the others, one at a time,
//   4. returns only the fields the screen needs.
// Concurrent requests for the same device share one upstream call.

const DEVICE_ID = /^[A-Za-z0-9._:-]{1,128}$/;

class ProxyError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    Object.assign(this, extra);
  }
}

// Fixed-window counters per key; small and per instance (each Cloud Functions
// instance limits on its own, which bounds abuse without a shared store).
function createRateLimiter({ limit, windowMs = 60000, now = () => Date.now(), maxKeys = 20000 }) {
  const windows = new Map();
  return {
    take(key) {
      if (!limit || limit <= 0) return { ok: true };
      const t = now();
      let w = windows.get(key);
      if (!w || t - w.start >= windowMs) {
        if (windows.size >= maxKeys) {
          for (const [k, v] of windows) if (t - v.start >= windowMs) windows.delete(k);
          if (windows.size >= maxKeys) windows.clear();
        }
        w = { start: t, count: 0 };
        windows.set(key, w);
      }
      w.count += 1;
      if (w.count > limit) return { ok: false, retryAfterSec: Math.max(1, Math.ceil((w.start + windowMs - t) / 1000)) };
      return { ok: true };
    },
  };
}

const str = (v) => (typeof v === "string" ? v : v === null || v === undefined ? null : String(v));

function pickLogo(data) {
  const si = data.store_info || {};
  const sl = data.store_location || {};
  for (const v of [si.logo_url, si.logo, si.store_logo, sl.logo_url, sl.logo, sl.store_logo, data.logo_url, data.logo]) {
    const s = typeof v === "string" ? v.trim() : typeof v === "object" && v && typeof v.url === "string" ? v.url.trim() : "";
    if (/^https:\/\//i.test(s) || /^data:image\/(png|webp|svg\+xml|jpeg);/i.test(s)) return s;
  }
  return null;
}

// Only what the screen uses (README "How the screen gets its store data" §3).
function trimCampaignData(data) {
  const sl = data.store_location || {};
  const si = data.store_info || {};
  const ai = si.address_info || {};
  const hours = Array.isArray(si.opening_hours) ? si.opening_hours : [];
  return {
    store_location: {
      store_code: str(sl.store_code),
      store_name: str(sl.store_name),
      store_timezone: str(sl.store_timezone),
    },
    store_info: {
      opening_hours: hours
        .filter((h) => h && typeof h === "object")
        .map((h) => ({
          open_day: str(h.open_day),
          open_time: str(h.open_time),
          close_day: str(h.close_day),
          close_time: str(h.close_time),
          is_active: h.is_active !== false,
        })),
      address_info: {
        suburb: str(ai.suburb),
        address: str(ai.address),
        postcode: str(ai.postcode),
        state: str(ai.state),
        phone_number: str(ai.phone_number),
      },
      logo_url: pickLogo(data),
    },
  };
}

function createLocationProxy({
  settings,
  fetchImpl = globalThis.fetch,
  logger,
  now = () => Date.now(),
  cacheMs = 15000,
  timeoutMs = 8000,
  perDeviceLimit = 12,
  perClientLimit = 600,
  upstreamLimit = 1200,
  staleMs = 600000,
}) {
  const cache = new Map(); // udid -> { at, result } (result: {status, body})
  const inflight = new Map(); // udid -> Promise
  let lastGood = null; // base URL that last answered
  const deviceLimiter = createRateLimiter({ limit: perDeviceLimit, now });
  const clientLimiter = createRateLimiter({ limit: perClientLimit, now });
  const upstreamLimiter = createRateLimiter({ limit: upstreamLimit, now });

  const withMeta = (result, meta) => (result.body.ok ? { status: result.status, body: { ...result.body, meta: { ...result.body.meta, ...meta } } } : result);

  const orderServers = (baseUrls) => (lastGood && baseUrls.includes(lastGood) ? [lastGood, ...baseUrls.filter((u) => u !== lastGood)] : baseUrls.slice());

  async function callOne(baseUrl, udid, token) {
    const url = `${baseUrl}/location-api/device/${encodeURIComponent(udid)}/campaign_data`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { method: "GET", headers: { accept: "application/json", "x-api-key": token }, signal: ctl.signal, redirect: "error" });
      let json = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      return { status: res.status, json };
    } catch (e) {
      return { status: 0, error: e && e.name === "AbortError" ? "timeout" : "network" };
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchUpstream(udid) {
    const creds = await settings.credentials();
    if (!creds.token) throw new ProxyError(503, "NOT_CONFIGURED", "No PH API token has been saved in Settings");
    const servers = orderServers(creds.baseUrls);
    const failures = [];
    for (const baseUrl of servers) {
      const r = await callOne(baseUrl, udid, creds.token);
      const data = r.json && typeof r.json === "object" ? r.json.data : null;
      if (r.status === 200 && data && typeof data === "object" && data.store_location) {
        lastGood = baseUrl;
        logger.info("[ph-proxy] ok", { device: udid, server: baseUrl });
        return { status: 200, body: { ok: true, data: trimCampaignData(data), meta: { server: baseUrl, fetchedAt: new Date(now()).toISOString() } } };
      }
      if (r.status === 404 || (r.status === 200 && (!data || !data.store_location))) {
        // A definitive answer from a working server: the device is not
        // registered to a store. Not a reason to try the other servers.
        lastGood = baseUrl;
        logger.info("[ph-proxy] device not found", { device: udid, server: baseUrl, status: r.status });
        return { status: 404, body: { ok: false, error: { code: "DEVICE_NOT_FOUND", message: "This device is not registered to a store in Personalisation Hub" } } };
      }
      failures.push(r.status === 401 || r.status === 403 ? "auth" : r.status === 0 ? r.error : `http-${r.status}`);
      logger.warn("[ph-proxy] server failed, trying next", { device: udid, server: baseUrl, status: r.status || r.error });
    }
    if (failures.length && failures.every((f) => f === "auth")) {
      settings.invalidate(); // a rotated token is picked up on the next call
      throw new ProxyError(502, "UPSTREAM_AUTH_FAILED", "Personalisation Hub refused the saved API token");
    }
    throw new ProxyError(502, "UPSTREAM_UNAVAILABLE", "No Personalisation Hub server answered", { serversTried: servers.length });
  }

  return {
    // Returns { status, body, headers? }. Never throws for expected failures.
    async getCampaignData(udid, { clientKey = "unknown" } = {}) {
      if (typeof udid !== "string" || !DEVICE_ID.test(udid) || udid.includes("${")) {
        return { status: 400, body: { ok: false, error: { code: "INVALID_DEVICE_ID", message: "Invalid screen URL: missing or malformed device id" } } };
      }
      // 1. A fresh cached answer, or a call already in flight: no limits.
      const hit = cache.get(udid);
      if (hit && now() - hit.at < cacheMs) return withMeta(hit.result, { cached: true });
      let p = inflight.get(udid);
      if (p) return withMeta(await p, { cached: false });

      // 2. A cache miss costs an upstream call: rate limit it. A limit that
      //    trips still answers with the last good data for this device if
      //    there is any (meta.stale), so a screen is not refused while a
      //    recent answer exists.
      const c = clientLimiter.take(clientKey);
      const d = c.ok ? deviceLimiter.take(udid) : c;
      const u = d.ok ? upstreamLimiter.take("all") : d;
      if (!u.ok) {
        if (hit && hit.result.body.ok && now() - hit.at < staleMs) return withMeta(hit.result, { cached: true, stale: true });
        return { status: 429, headers: { "Retry-After": String(u.retryAfterSec) }, body: { ok: false, error: { code: "RATE_LIMITED", message: "Too many requests; slow down" } } };
      }
      p = fetchUpstream(udid)
        .then((result) => {
          cache.delete(udid); // re-insert so the oldest entry is evicted first
          cache.set(udid, { at: now(), result });
          if (cache.size > 5000) cache.delete(cache.keys().next().value);
          return result;
        })
        .catch((e) => {
          if (e && e.code && e.status) {
            return { status: e.status, body: { ok: false, error: { code: e.code, message: e.message } } };
          }
          logger.error("[ph-proxy] unexpected error", e);
          return { status: 500, body: { ok: false, error: { code: "INTERNAL", message: "Unexpected error" } } };
        })
        .finally(() => inflight.delete(udid));
      inflight.set(udid, p);
      return withMeta(await p, { cached: false });
    },
  };
}

module.exports = { createLocationProxy, createRateLimiter, trimCampaignData, ProxyError };
