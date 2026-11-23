"use strict";

// The per-client limit on the public screen read (GET /api/screens/{storeCode}), and the client address it is
// keyed on. This folder deploys as its own Cloud Functions codebase, so it cannot require ../ph-proxy/: the
// address rule is the same as ph-proxy/src/client-ip.js (which explains it in full) and test/api.test.js checks
// the two agree.
//
// Fixed one-minute windows per address, in memory, per function instance (or Lambda container): the effective
// limit is the setting times the instances running, bounded by maxInstances. A shared counter would cost a
// database write on every request, more than the read it protects. Answers the CDN serves from its cache never
// reach the function and are never counted.

const MAX_HEADER = 2048;

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
      // A refused request is not counted (the same rule as ph-proxy's limiter).
      if (w.count >= limit) return { ok: false, retryAfterSec: Math.max(1, Math.ceil((w.start + windowMs - t) / 1000)) };
      w.count += 1;
      return { ok: true };
    },
  };
}

// Not Express's req.ip (the caller-written leftmost X-Forwarded-For entry): the entry `trustedHops` from the
// right, which our own platform appended.
function clientIpFromHeaders(headers = {}, { trustedHops = 1, fallback = "unknown" } = {}) {
  const raw = headers["x-forwarded-for"] ?? headers["X-Forwarded-For"];
  const value = Array.isArray(raw) ? raw.join(",") : typeof raw === "string" ? raw : "";
  const hops = Math.max(1, Math.floor(Number(trustedHops)) || 1);
  const entries = value
    .slice(-MAX_HEADER)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!entries.length) return fallback || "unknown";
  return entries[Math.max(0, entries.length - hops)].slice(0, 64);
}

module.exports = { createRateLimiter, clientIpFromHeaders };
