"use strict";

// A test identity provider: signing keys, a JWKS, and ID tokens shaped like
// Cognito's. No network: fetchImpl answers discovery and JWKS from memory.

const crypto = require("node:crypto");

function createTestIdp({ issuer = "https://idp.example.test/pool", clientId = "client-123" } = {}) {
  const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const ec = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const keys = [
    { kid: "rsa-1", alg: "RS256", privateKey: rsa.privateKey, jwk: { ...rsa.publicKey.export({ format: "jwk" }), kid: "rsa-1", alg: "RS256", use: "sig" } },
    { kid: "ec-1", alg: "ES256", privateKey: ec.privateKey, jwk: { ...ec.publicKey.export({ format: "jwk" }), kid: "ec-1", alg: "ES256", use: "sig" } },
  ];
  let published = keys.map((k) => k.jwk);
  const fetches = [];
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

  function sign({ kid = "rsa-1", header = {}, ...claims } = {}) {
    const key = keys.find((k) => k.kid === kid);
    const now = Math.floor(Date.now() / 1000);
    const body = { iss: issuer, aud: clientId, sub: "user-1", email: "admin@example.com", token_use: "id", iat: now, exp: now + 3600, ...claims };
    for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
    const h = { alg: key ? key.alg : "RS256", kid, typ: "JWT", ...header };
    const data = `${enc(h)}.${enc(body)}`;
    const sig = key
      ? crypto.sign(key.alg === "ES256" ? "sha256" : "sha256", Buffer.from(data), key.alg === "ES256" ? { key: key.privateKey, dsaEncoding: "ieee-p1363" } : key.privateKey)
      : Buffer.from("x");
    return `${data}.${sig.toString("base64url")}`;
  }

  async function fetchImpl(url) {
    fetches.push(String(url));
    const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
    if (url === `${issuer}/.well-known/openid-configuration`) return json(200, { issuer, jwks_uri: `${issuer}/.well-known/jwks.json` });
    if (url === `${issuer}/.well-known/jwks.json`) return json(200, { keys: published });
    return json(404, {});
  }

  return {
    issuer,
    clientId,
    sign,
    fetchImpl,
    fetches,
    jwks: () => ({ keys: published }),
    // Simulate the issuer rotating to a key the verifier hasn't seen yet.
    rotate() {
      const k = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
      keys.push({ kid: "rsa-2", alg: "RS256", privateKey: k.privateKey, jwk: { ...k.publicKey.export({ format: "jwk" }), kid: "rsa-2", alg: "RS256", use: "sig" } });
      published = keys.map((x) => x.jwk);
    },
  };
}

module.exports = { createTestIdp };
