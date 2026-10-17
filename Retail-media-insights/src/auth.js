'use strict';
// Stand-in identity resolver (DSP Integration section 9.5 shape). authenticate(req) returns
// {principalType: 'admin'|'advertiser', principalId, scopes} or null, and the server answers null with 401.
// Tokens are HMAC-SHA256 signed and expire; the secret comes from configuration and there is no default.
// The real identity provider is a follow-up and replaces this file's resolver, not the contract.

const crypto = require('crypto');

const PRINCIPAL_TYPES = ['admin', 'advertiser'];
const MIN_SECRET_LENGTH = 32;

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const sign = (secret, body) => crypto.createHmac('sha256', secret).update(body).digest();

function requireSecret(secret) {
  if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`auth secret must be a string of at least ${MIN_SECRET_LENGTH} characters`);
  }
}

/** Issue a token: `<base64url payload>.<base64url signature>`. */
function mintToken({ secret, principalType, principalId, scopes = ['insights:read'], ttlSeconds = 3600, now = Date.now() }) {
  requireSecret(secret);
  if (!PRINCIPAL_TYPES.includes(principalType)) throw new Error('principalType must be admin or advertiser');
  if (typeof principalId !== 'string' || !principalId) throw new Error('principalId is required');
  const body = b64(JSON.stringify({ principalType, principalId, scopes, exp: Math.floor(now / 1000) + ttlSeconds }));
  return `${body}.${b64(sign(secret, body))}`;
}

/** Verify a token; returns the principal, or null for anything missing, malformed, tampered or expired. */
function verifyToken(secret, token, now = Date.now()) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const given = Buffer.from(sig, 'base64url');
  const want = sign(secret, body);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (!p || !PRINCIPAL_TYPES.includes(p.principalType) || typeof p.principalId !== 'string' || !p.principalId) return null;
  if (!Number.isFinite(p.exp) || p.exp * 1000 <= now) return null;
  return { principalType: p.principalType, principalId: p.principalId, scopes: Array.isArray(p.scopes) ? p.scopes.filter((s) => typeof s === 'string') : [] };
}

/** An authenticate(req) reading `Authorization: Bearer <token>` only (never a query string). */
function createTokenAuthenticator({ secret, now = () => Date.now() }) {
  requireSecret(secret);
  return (req) => {
    const m = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization || '');
    return m ? verifyToken(secret, m[1], now()) : null;
  };
}

module.exports = { mintToken, verifyToken, createTokenAuthenticator, PRINCIPAL_TYPES, MIN_SECRET_LENGTH };
