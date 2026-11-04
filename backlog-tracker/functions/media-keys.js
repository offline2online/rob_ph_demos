"use strict";
// ── Media Studio provider keys (Settings → Integrations & MCP) ────────────
// Admins paste the API keys Media Studio (media-studio/ in the repo) uses —
// Gemini (Nano Banana Pro + Veo 3.1), LTX 2.5 and an optional WordPress
// application password — into the console. They are:
//
//   • encrypted before they are stored: AES-256-GCM, a fresh 96-bit IV per
//     write, the provider id bound in as additional authenticated data (a
//     ciphertext cannot be moved to another slot), under MEDIA_KEYS_ENC_KEY,
//     a 32-byte key held only in Secret Manager and only by this function;
//   • stored in mediaProviderKeys/{provider}, which firestore.rules closes
//     to every client in both directions;
//   • write-only from the browser: the console sees "set, ends …a1b2, by,
//     when" and never the value;
//   • decrypted only for GET /v1/runtime, which answers the board automation
//     credential (X-Board-Key = BOARD_API_KEY, the GitHub secret the
//     media-studio.yml workflow already has) and logs every read.
//
// Routes (Hosting rewrite /mediaKeys/** → this function):
//   GET    /v1/status                  admin  what is set (never values)
//   POST   /v1/keys/{provider}         admin  {value, siteUrl?}  store
//   DELETE /v1/keys/{provider}         admin  remove
//   POST   /v1/keys/{provider}/test    admin  check the stored key with the provider
//   GET    /v1/runtime                 board key  decrypted keys, env-var names
//
// Pure module: index.js injects Firestore, ID-token verification, the
// console-user lookup and the two secrets, so test/media-keys.test.js runs
// it with no Firebase, no network and no credentials.

const crypto = require("crypto");

const PROVIDERS = {
  gemini: { label: "Google Gemini — Nano Banana Pro and Veo 3.1", env: "GEMINI_API_KEY", min: 20, max: 200 },
  ltx: { label: "LTX 2.5 (Lightricks)", env: "LTX_API_KEY", min: 16, max: 400 },
  wordpress: { label: "WordPress media library (application password)", env: "WP_AUTH", min: 8, max: 300 },
};
const COLLECTION = "mediaProviderKeys";
const AUDIT = "mediaKeyAudit";
const ROLE_RANK = { viewer: 1, editor: 2, admin: 3 };

// ── Encryption ────────────────────────────────────────────────────────────
function keyBytes(secret) {
  const raw = String(secret || "").trim();
  if (!raw || raw === "unset") return null;
  const buf = Buffer.from(raw, "base64");
  return buf.length === 32 ? buf : null;
}
// Short fingerprint of the encryption key, stored beside each ciphertext, so
// a rotated or replaced key reads as "re-enter this key", not as garbage.
const keyId = (key) => crypto.createHash("sha256").update(key).digest("hex").slice(0, 12);

function encrypt(key, provider, plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`mediaKeys:${provider}`));
  const ct = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  return { v: 1, alg: "AES-256-GCM", keyId: keyId(key), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ct: ct.toString("base64") };
}

function decrypt(key, provider, box) {
  if (!box || box.v !== 1) throw new Error("unknown ciphertext format");
  if (box.keyId !== keyId(key)) {
    const err = new Error("encrypted under a different MEDIA_KEYS_ENC_KEY — re-enter this key in Settings");
    err.code = "key-mismatch";
    throw err;
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(box.iv, "base64"));
  decipher.setAAD(Buffer.from(`mediaKeys:${provider}`));
  decipher.setAuthTag(Buffer.from(box.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(box.ct, "base64")), decipher.final()]).toString("utf8");
}

const hintOf = (value) => `…${String(value).slice(-4)}`;

function timingSafeEqualStr(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function normaliseSiteUrl(s) {
  const v = String(s || "").trim().replace(/\/+$/, "");
  if (!v) return "";
  let u;
  try { u = new URL(v); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash) return null;
  return u.origin + u.pathname.replace(/\/+$/, "");
}

// WordPress Basic auth wants "user:password" base64-encoded; application
// passwords are shown with spaces, which WordPress ignores but we strip.
function wpBasic(value) {
  const v = String(value || "").trim();
  if (!v.includes(":")) return v;
  const i = v.indexOf(":");
  return Buffer.from(`${v.slice(0, i)}:${v.slice(i + 1).replace(/\s+/g, "")}`).toString("base64");
}

function validateValue(provider, value) {
  const spec = PROVIDERS[provider];
  const v = String(value || "").trim();
  if (v.length < spec.min || v.length > spec.max) return `that doesn't look like a ${spec.label} key (${spec.min}–${spec.max} characters)`;
  if (/\s/.test(v) && provider !== "wordpress") return "keys don't contain spaces — check what was pasted";
  if (provider === "wordpress" && !/^[^:\s]+:.+$/.test(v)) return "expected <wordpress-username>:<application password>";
  return null;
}

// ── HTTP handler ──────────────────────────────────────────────────────────
function createMediaKeysApi({ db, verifyIdToken, resolveConsoleUser, encKey, boardKey, fetch: fetchImpl = globalThis.fetch, logger = console, now = () => new Date() }) {
  const misses = new Map(); // ip -> {n, first}: brute-force brake on the runtime route

  const send = (res, status, body) => res.status(status).set("Cache-Control", "no-store").json(body);
  const ipOf = (req) => String(req.get("x-forwarded-for") || req.ip || "").split(",")[0].trim();

  async function requireAdmin(req) {
    const idToken = String(req.get("x-firebase-id-token") || "");
    if (!idToken) return { ok: false, status: 401, error: "sign in first" };
    let decoded;
    try { decoded = await verifyIdToken(idToken); } catch { return { ok: false, status: 401, error: "invalid sign-in" }; }
    const user = await resolveConsoleUser(decoded.email);
    if (!user) return { ok: false, status: 403, error: "not on the console user list" };
    if ((ROLE_RANK[user.role] || 0) < ROLE_RANK.admin) return { ok: false, status: 403, error: "only an admin can manage Media Studio keys" };
    return { ok: true, user };
  }

  async function audit(entry) {
    try { await db.collection(AUDIT).add({ ...entry, at: now() }); } catch (err) { logger.warn("mediaKeyAudit write failed", { error: String(err) }); }
  }

  async function readAll() {
    const out = {};
    for (const id of Object.keys(PROVIDERS)) {
      const snap = await db.collection(COLLECTION).doc(id).get();
      out[id] = snap.exists ? snap.data() || {} : null;
    }
    return out;
  }

  const iso = (v) => (v && typeof v.toDate === "function" ? v.toDate().toISOString() : v instanceof Date ? v.toISOString() : v || null);

  async function status() {
    const key = keyBytes(encKey());
    const docs = await readAll();
    return {
      encryptionReady: Boolean(key),
      providers: Object.entries(PROVIDERS).map(([id, spec]) => {
        const d = docs[id];
        return {
          id, label: spec.label, env: spec.env,
          set: Boolean(d && d.box),
          hint: d && d.box ? d.hint : null,
          siteUrl: id === "wordpress" ? (d && d.siteUrl) || null : undefined,
          updatedBy: (d && d.updatedBy) || null,
          updatedAt: iso(d && d.updatedAt),
          lastTest: d && d.lastTest ? { ok: d.lastTest.ok, message: d.lastTest.message, at: iso(d.lastTest.at) } : null,
          lastUsedAt: iso(d && d.lastUsedAt),
          readable: Boolean(key && d && d.box && d.box.keyId === keyId(key)),
        };
      }),
    };
  }

  // What a stored key says when we show it to its provider. Each check is a
  // read that costs nothing: no image or video is ever generated by a test.
  async function testKey(provider, value, doc) {
    try {
      if (provider === "gemini") {
        const r = await fetchImpl("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": value } });
        if (!r.ok) return { ok: false, message: `Google rejected the key (HTTP ${r.status})` };
        const names = ((await r.json()).models || []).map((m) => String(m.name).replace("models/", ""));
        const want = ["gemini-3-pro-image-preview", "veo-3.1-generate-preview"];
        const missing = want.filter((m) => !names.includes(m));
        return missing.length ? { ok: true, message: `Key works; not listed for it: ${missing.join(", ")}` } : { ok: true, message: "Key works; Nano Banana Pro and Veo 3.1 are available" };
      }
      if (provider === "ltx") {
        // LTX has no free read endpoint, so send an empty job: a bad key is
        // refused as 401/403 before the body is looked at; a good one fails
        // validation (400/422) and is never charged.
        const r = await fetchImpl("https://api.ltx.io/v2/text-to-video", { method: "POST", headers: { Authorization: `Bearer ${value}`, "Content-Type": "application/json" }, body: "{}" });
        if (r.status === 401 || r.status === 403) return { ok: false, message: `LTX rejected the key (HTTP ${r.status})` };
        if (r.status === 400 || r.status === 422) return { ok: true, message: "Key accepted by LTX" };
        return { ok: false, message: `Unexpected answer from LTX (HTTP ${r.status})` };
      }
      if (provider === "wordpress") {
        if (!doc.siteUrl) return { ok: false, message: "No site URL saved" };
        const r = await fetchImpl(`${doc.siteUrl}/wp-json/wp/v2/users/me?context=edit`, { headers: { Authorization: `Basic ${wpBasic(value)}` } });
        if (!r.ok) return { ok: false, message: `WordPress refused it (HTTP ${r.status})` };
        const me = await r.json();
        const canUpload = !me.capabilities || me.capabilities.upload_files !== false;
        return { ok: canUpload, message: canUpload ? `Signed in as ${me.slug || me.name || "user"}` : `${me.slug || "That user"} can't upload files` };
      }
    } catch (err) {
      return { ok: false, message: `Couldn't reach the provider: ${String(err.message || err).slice(0, 120)}` };
    }
    return { ok: false, message: "unknown provider" };
  }

  async function handle(req, res) {
    const path = String((req.path || req.url || "/").split("?")[0]).replace(/^\/mediaKeys(?=\/|$)/, "").replace(/\/+$/, "") || "/";

    // ── Runtime: the automation credential reads decrypted keys ──
    if (path === "/v1/runtime") {
      if (req.method !== "GET") return send(res, 405, { error: "GET only" });
      const configured = String(boardKey() || "");
      if (!configured || configured === "unset") return send(res, 503, { error: "BOARD_API_KEY is not configured" });
      const ip = ipOf(req);
      const m = misses.get(ip);
      const windowOpen = m && Date.now() - m.first < 600000;
      if (windowOpen && m.n >= 10) return send(res, 429, { error: "too many failed attempts — try again later" });
      if (!timingSafeEqualStr(req.get("x-board-key") || "", configured)) {
        misses.set(ip, windowOpen ? { n: m.n + 1, first: m.first } : { n: 1, first: Date.now() });
        return send(res, 401, { error: "missing or invalid X-Board-Key" });
      }
      const key = keyBytes(encKey());
      if (!key) return send(res, 503, { error: "MEDIA_KEYS_ENC_KEY is not configured" });
      const docs = await readAll();
      const env = {};
      const problems = [];
      for (const [id, spec] of Object.entries(PROVIDERS)) {
        const d = docs[id];
        if (!d || !d.box) continue;
        try {
          env[spec.env] = decrypt(key, id, d.box);
          if (id === "wordpress" && d.siteUrl) env.WP_SITE_URL = d.siteUrl;
          await db.collection(COLLECTION).doc(id).set({ lastUsedAt: now() }, { merge: true });
        } catch (err) {
          problems.push(`${id}: ${err.code === "key-mismatch" ? err.message : "could not be decrypted"}`);
          logger.error("media key decrypt failed", { provider: id, error: String(err.message || err) });
        }
      }
      await audit({ action: "runtime-read", providers: Object.keys(env), ip, userAgent: String(req.get("user-agent") || "").slice(0, 200) });
      return send(res, 200, { env, problems });
    }

    // ── Admin routes ──
    const who = await requireAdmin(req);
    if (!who.ok) return send(res, who.status, { error: who.error });

    if (path === "/v1/status" && req.method === "GET") return send(res, 200, await status());

    const m = /^\/v1\/keys\/([a-z]+)(\/test)?$/.exec(path);
    if (!m || !PROVIDERS[m[1]]) return send(res, 404, { error: "not found" });
    const provider = m[1];
    const ref = db.collection(COLLECTION).doc(provider);

    if (m[2]) {
      if (req.method !== "POST") return send(res, 405, { error: "POST only" });
      const key = keyBytes(encKey());
      const snap = await ref.get();
      const d = snap.exists ? snap.data() || {} : null;
      if (!d || !d.box) return send(res, 404, { error: "no key saved for that provider" });
      if (!key) return send(res, 503, { error: "MEDIA_KEYS_ENC_KEY is not configured" });
      let value;
      try { value = decrypt(key, provider, d.box); } catch (err) { return send(res, 409, { error: err.code === "key-mismatch" ? err.message : "the stored key could not be decrypted — re-enter it" }); }
      const result = await testKey(provider, value, d);
      await ref.set({ lastTest: { ...result, at: now(), by: who.user.email } }, { merge: true });
      await audit({ action: "test", provider, by: who.user.email, ok: result.ok });
      return send(res, 200, result);
    }

    if (req.method === "POST") {
      const key = keyBytes(encKey());
      if (!key) return send(res, 503, { error: "Encryption isn't set up yet (MEDIA_KEYS_ENC_KEY). It is created by the next console deploy." });
      const body = req.body || {};
      const value = String(body.value || "").trim();
      const problem = validateValue(provider, value);
      if (problem) return send(res, 400, { error: problem });
      const update = { provider, box: encrypt(key, provider, value), hint: hintOf(value), updatedBy: who.user.email, updatedAt: now(), lastTest: null };
      if (provider === "wordpress") {
        const siteUrl = normaliseSiteUrl(body.siteUrl);
        if (!siteUrl) return send(res, 400, { error: "a WordPress site URL starting https:// is required" });
        update.siteUrl = siteUrl;
      }
      await ref.set(update);
      await audit({ action: "set", provider, by: who.user.email, hint: update.hint });
      return send(res, 200, { ok: true, provider, hint: update.hint });
    }

    if (req.method === "DELETE") {
      await ref.delete();
      await audit({ action: "delete", provider, by: who.user.email });
      return send(res, 200, { ok: true, provider });
    }

    return send(res, 405, { error: "method not allowed" });
  }

  return { handle, status };
}

module.exports = { createMediaKeysApi, encrypt, decrypt, keyBytes, keyId, PROVIDERS, COLLECTION, AUDIT, normaliseSiteUrl, wpBasic, validateValue };
