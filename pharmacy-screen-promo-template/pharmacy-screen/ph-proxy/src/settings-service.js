"use strict";
// PH API settings: base URL list (non-secret) and the API token (write-only).
//
// Stored document (settings store):
//   {
//     baseUrls: ["https://ph.mipharmacy.net", ...],      // tried in this order
//     token: null | {
//       envelope: { v, alg, kms, keyId, keyVersion, wrappedKey, iv, tag, ciphertext },
//       last4: "abcd", setAt: ISO, setBy: "<uid>"
//     },
//     version: <int, +1 on every write>, updatedAt: ISO, updatedBy: "<uid>"
//   }
// The plaintext token is never stored, returned, logged or audited. The only
// things about it that ever leave this module are "set", its last 4
// characters and when/by whom it was set.

const AAD = "pharmacy-screen:ph-api-token:v1";
const MAX_BASE_URLS = 5;

class SettingsError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function normaliseBaseUrl(raw) {
  if (typeof raw !== "string") throw new SettingsError(400, "INVALID_BASE_URL", "Each base URL must be text");
  const text = raw.trim().replace(/\/+$/, "");
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new SettingsError(400, "INVALID_BASE_URL", `Not a valid URL: ${text.slice(0, 200)}`);
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new SettingsError(400, "INVALID_BASE_URL", "Base URLs must use https");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new SettingsError(400, "INVALID_BASE_URL", "Base URLs must not carry credentials, a query or a fragment");
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

// The proxy sends the PH API token to every base URL, so which hosts an admin
// may save is fixed by the deployment (PH_API_ALLOWED_HOSTS), not by whoever
// is signed in: a stolen admin session cannot point the token at its own
// server. "ph.example.com" is that host; ".example.com" is any host under it.
function hostAllowed(hostname, allowed) {
  const h = String(hostname).toLowerCase();
  return allowed.some((a) => (a.startsWith(".") ? h.endsWith(a) && h.length > a.length : h === a));
}

function validateBaseUrls(list, allowedHosts) {
  if (!Array.isArray(list) || !list.length) throw new SettingsError(400, "INVALID_BASE_URL", "At least one base URL is required");
  if (list.length > MAX_BASE_URLS) throw new SettingsError(400, "INVALID_BASE_URL", `At most ${MAX_BASE_URLS} base URLs`);
  const out = [];
  for (const raw of list) {
    const u = normaliseBaseUrl(raw);
    const host = new URL(u).hostname;
    const local = host === "localhost" || host === "127.0.0.1";
    if (allowedHosts && allowedHosts.length && !local && !hostAllowed(host, allowedHosts)) {
      throw new SettingsError(400, "BASE_URL_HOST_NOT_ALLOWED", `${host} is not a Personalisation Hub server this deployment may call (PH_API_ALLOWED_HOSTS)`);
    }
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

function validateToken(token) {
  if (typeof token !== "string") throw new SettingsError(400, "INVALID_TOKEN", "The token must be text");
  const t = token.trim();
  if (t.length < 8 || t.length > 4096) throw new SettingsError(400, "INVALID_TOKEN", "The token must be 8 to 4096 characters");
  if (/[\s\u0000-\u001f\u007f]/.test(t)) throw new SettingsError(400, "INVALID_TOKEN", "The token must not contain spaces or control characters");
  return t;
}

function createSettingsService({ store, secretStore, audit, logger, defaultBaseUrls = ["https://ph.mipharmacy.net"], allowedHosts = null, now = () => new Date(), cacheMs = 15000 }) {
  // Default: the hosts of the default base URLs, and nothing else.
  const hosts = (allowedHosts && allowedHosts.length ? allowedHosts : defaultBaseUrls.map((u) => { try { return new URL(u).hostname; } catch { return ""; } }))
    .map((h) => String(h).trim().toLowerCase())
    .filter(Boolean);
  // Proxy-side cache of the decrypted credentials, keyed by the settings
  // version, so a save/replace/remove is picked up within cacheMs on every
  // instance (rotation without redeploying anything).
  let credCache = null; // { at, version, baseUrls, token }

  const publicView = (doc) => ({
    baseUrls: doc && Array.isArray(doc.baseUrls) && doc.baseUrls.length ? doc.baseUrls : defaultBaseUrls,
    baseUrlsAreDefault: !(doc && Array.isArray(doc.baseUrls) && doc.baseUrls.length),
    token: doc && doc.token
      ? { set: true, last4: doc.token.last4, setAt: doc.token.setAt || null, setBy: doc.token.setBy || null }
      : { set: false },
    secretStore: secretStore ? secretStore.provider : null,
    version: (doc && doc.version) || 0,
    updatedAt: (doc && doc.updatedAt) || null,
    updatedBy: (doc && doc.updatedBy) || null,
  });

  const record = async (action, actor, details) => {
    try {
      await audit.record({ action, actorUid: actor.uid, actorEmail: actor.email || null, at: now().toISOString(), ...details });
    } catch (e) {
      // The write already happened; losing the audit entry is logged loudly
      // rather than reported as a failed save.
      logger.error("[ph-settings] audit write failed for", action, e);
    }
  };

  return {
    async get() {
      return publicView(await store.get());
    },

    // body: { baseUrls?: string[], token?: string }. A token in the body sets
    // it (or replaces the one there); omitting it leaves the token alone.
    async save(body, actor) {
      if (!body || typeof body !== "object") throw new SettingsError(400, "INVALID_BODY", "Expected a JSON object");
      const allowed = new Set(["baseUrls", "token"]);
      for (const k of Object.keys(body)) {
        if (!allowed.has(k)) throw new SettingsError(400, "INVALID_BODY", `Unknown field: ${String(k).slice(0, 50)}`);
      }
      if (body.baseUrls === undefined && body.token === undefined) throw new SettingsError(400, "INVALID_BODY", "Nothing to save");
      const baseUrls = body.baseUrls === undefined ? undefined : validateBaseUrls(body.baseUrls, hosts.includes("*") ? null : hosts);
      let sealed = null;
      if (body.token !== undefined) {
        const token = validateToken(body.token);
        logger.addSecret(token);
        if (!secretStore) throw new SettingsError(503, "SECRET_STORE_NOT_CONFIGURED", "Token encryption is not configured on this server");
        sealed = { envelope: await secretStore.seal(token, { aad: AAD }), last4: token.slice(-4) };
      }
      const at = now().toISOString();
      let previous = null;
      const next = await store.update((cur) => {
        previous = cur;
        const doc = cur ? { ...cur } : { baseUrls: null, token: null, version: 0 };
        if (baseUrls) doc.baseUrls = baseUrls;
        if (sealed) doc.token = { envelope: sealed.envelope, last4: sealed.last4, setAt: at, setBy: actor.uid };
        doc.version = (doc.version || 0) + 1;
        doc.updatedAt = at;
        doc.updatedBy = actor.uid;
        return doc;
      });
      credCache = null;
      if (baseUrls) {
        await record("ph-api.base-urls.update", actor, { from: (previous && previous.baseUrls) || null, to: baseUrls });
      }
      if (sealed) {
        const replaced = !!(previous && previous.token);
        await record(replaced ? "ph-api.token.replace" : "ph-api.token.set", actor, {
          tokenLast4: sealed.last4,
          previousTokenLast4: replaced ? previous.token.last4 : null,
          secretStore: secretStore.provider,
        });
      }
      return publicView(next);
    },

    async removeToken(actor) {
      const at = now().toISOString();
      let previous = null;
      const next = await store.update((cur) => {
        previous = cur;
        const doc = cur ? { ...cur } : { baseUrls: null, token: null, version: 0 };
        doc.token = null;
        doc.version = (doc.version || 0) + 1;
        doc.updatedAt = at;
        doc.updatedBy = actor.uid;
        return doc;
      });
      credCache = null;
      await record("ph-api.token.remove", actor, { previousTokenLast4: previous && previous.token ? previous.token.last4 : null });
      return publicView(next);
    },

    // For the proxy only: the base URLs and the decrypted token.
    async credentials({ fresh = false } = {}) {
      const t = now().getTime();
      if (!fresh && credCache && t - credCache.at < cacheMs) return credCache;
      const doc = await store.get();
      const version = (doc && doc.version) || 0;
      const baseUrls = doc && Array.isArray(doc.baseUrls) && doc.baseUrls.length ? doc.baseUrls : defaultBaseUrls;
      let token = null;
      if (doc && doc.token) {
        if (credCache && credCache.version === version && credCache.token) {
          token = credCache.token;
        } else {
          if (!secretStore) throw new SettingsError(503, "SECRET_STORE_NOT_CONFIGURED", "Token encryption is not configured on this server");
          try {
            token = await secretStore.open(doc.token.envelope, { aad: AAD });
          } catch (e) {
            logger.error("[ph-proxy] token decrypt failed:", e.code || "error");
            throw new SettingsError(503, "TOKEN_UNREADABLE", "The saved PH API token could not be decrypted; save it again in Settings");
          }
          logger.addSecret(token);
        }
      }
      credCache = { at: t, version, baseUrls, token };
      return credCache;
    },

    invalidate() {
      credCache = null;
    },
  };
}

module.exports = { createSettingsService, SettingsError, validateBaseUrls, validateToken, TOKEN_AAD: AAD };
