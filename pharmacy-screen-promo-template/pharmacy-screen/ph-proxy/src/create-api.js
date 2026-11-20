"use strict";
// Wires the adapters together from configuration. Used by index.js (Cloud
// Functions) and by tests with in-memory adapters.

const { createSettingsService } = require("./settings-service");
const { createLocationProxy } = require("./location-proxy");
const { createHttpHandler } = require("./http");
const { createSafeLogger } = require("./safe-log");
const { createPhSessionService } = require("./ph-session");
const { createRateLimiter } = require("./location-proxy");

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : d;
};
const list = (v) => String(v || "").split(",").map((s) => s.trim()).filter(Boolean);

function createApi({ env = process.env, settingsStore, auditLog, secretStore, auth, fetchImpl, baseLogger, now, mintSession }) {
  const logger = createSafeLogger(baseLogger || console);
  const cacheMs = num(env.PH_PROXY_CACHE_SECONDS, 15) * 1000;
  const defaults = list(env.PH_API_DEFAULT_BASE_URL);
  const settings = createSettingsService({
    store: settingsStore,
    secretStore,
    audit: auditLog,
    logger,
    defaultBaseUrls: defaults.length ? defaults : ["https://ph.mipharmacy.net"],
    cacheMs,
    now: now ? () => new Date(now()) : undefined,
  });
  const proxy = createLocationProxy({
    settings,
    fetchImpl,
    logger,
    now,
    cacheMs,
    timeoutMs: num(env.PH_PROXY_TIMEOUT_MS, 8000),
    perDeviceLimit: num(env.PH_RATE_LIMIT_PER_DEVICE_PER_MIN, 12),
    perClientLimit: num(env.PH_RATE_LIMIT_PER_IP_PER_MIN, 600),
    upstreamLimit: num(env.PH_UPSTREAM_CALLS_PER_MIN, 1200),
    staleMs: num(env.PH_PROXY_STALE_SECONDS, 600) * 1000,
  });
  // PH session sign-in (src/ph-session.js): only where the entry point can
  // mint a session token (Cloud Functions; index.js) and PH_SESSION_AUTH is
  // not "off".
  const phSession =
    mintSession && String(env.PH_SESSION_AUTH || "on").toLowerCase() !== "off"
      ? createPhSessionService({
          settings,
          mint: mintSession,
          fetchImpl,
          logger,
          now,
          timeoutMs: num(env.PH_PROXY_TIMEOUT_MS, 8000),
          hqRoles: list(env.PH_SESSION_HQ_ROLES).length ? list(env.PH_SESSION_HQ_ROLES) : ["ADMIN"],
          maxSessionMs: num(env.PH_SESSION_MAX_HOURS, 8) * 3600 * 1000,
          rateLimiter: createRateLimiter({ limit: num(env.PH_SESSION_RATE_LIMIT_PER_IP_PER_MIN, 30), now }),
        })
      : null;
  const handle = createHttpHandler({ settings, proxy, auth, logger, allowedOrigins: list(env.PH_ALLOWED_ORIGINS), phSession });
  return { handle, settings, proxy, logger, phSession };
}

module.exports = { createApi };
