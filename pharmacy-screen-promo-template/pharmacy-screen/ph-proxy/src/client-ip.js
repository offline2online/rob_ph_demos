"use strict";
// The client address the per-client rate limit is keyed on.
//
// Never use Express's req.ip here: the Functions Framework turns on Express
// "trust proxy", so req.ip is the LEFTMOST X-Forwarded-For entry, which the
// caller writes. A caller sending a fresh X-Forwarded-For on every request
// would get a fresh rate-limit bucket every time.
//
// Each proxy in front of the function APPENDS the address it received the
// request from, so only entries added by our own platform can be trusted, and
// they are at the right-hand end. `trustedHops` is how many entries, counted
// from the right, our own platform adds: 1 (the default) takes the rightmost
// entry, the address Google's front end saw. If the function is reached
// through another proxy that appends its own entry (check one real request:
// the rightmost entry would then be the same proxy address for every caller),
// raise it to 2 so the entry one to the left, the address that proxy saw, is
// used. Entries further left are the caller's own and are ignored.

const MAX_HEADER = 2048;

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
  // Fewer entries than trusted hops: take the leftmost one we have, which our
  // platform still added (a request that came in directly, not via the extra proxy).
  return entries[Math.max(0, entries.length - hops)].slice(0, 64);
}

module.exports = { clientIpFromHeaders };
