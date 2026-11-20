"use strict";

// Admin sign-in on AWS (adapters/oidc-auth.js): which ID tokens are accepted,
// and what the admin role is.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createOidcAuth, isAdmin } = require("../adapters/oidc-auth");
const { createTestIdp } = require("./jwt");

function setup(opts = {}) {
  const idp = createTestIdp();
  let t = Date.now();
  const auth = createOidcAuth({ issuer: idp.issuer, audience: idp.clientId, fetchImpl: idp.fetchImpl, now: () => t, ...opts });
  return { idp, auth, advance: (ms) => (t += ms) };
}

test("oidc auth: a valid ID token in the admin group is an admin; without it, signed in but not admin", async () => {
  const { idp, auth } = setup();
  const admin = idp.sign({ "cognito:groups": ["staff", "admin"] });
  assert.deepEqual(await auth.identify(`Bearer ${admin}`), { uid: "user-1", email: "admin@example.com", admin: true });
  assert.deepEqual(await auth.verify({ authorization: `Bearer ${admin}` }), { uid: "user-1", email: "admin@example.com", admin: true });
  const viewer = idp.sign({ sub: "user-2", email: "viewer@example.com", "cognito:groups": ["staff"] });
  assert.deepEqual(await auth.identify(`Bearer ${viewer}`), { uid: "user-2", email: "viewer@example.com", admin: false });
  assert.equal((await auth.identify(`Bearer ${idp.sign({ kid: "ec-1", "cognito:groups": ["admin"] })}`)).admin, true, "ES256 keys too");
});

test("oidc auth: refuses missing, malformed, forged and mis-addressed tokens", async () => {
  const { idp, auth } = setup();
  const good = idp.sign({ "cognito:groups": ["admin"] });
  const [h, p, s] = good.split(".");
  const swap = (claims) => `${h}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url")), ...claims })).toString("base64url")}.${s}`;
  const none = `${Buffer.from(JSON.stringify({ alg: "none", kid: "rsa-1" })).toString("base64url")}.${p}.`;
  const hmac = (() => {
    const hh = Buffer.from(JSON.stringify({ alg: "HS256", kid: "rsa-1" })).toString("base64url");
    return `${hh}.${p}.${crypto.createHmac("sha256", "x").update(`${hh}.${p}`).digest("base64url")}`;
  })();
  const now = Math.floor(Date.now() / 1000);
  const cases = {
    "no header": undefined,
    "not bearer": `Basic ${good}`,
    garbage: "Bearer abc.def",
    "payload changed after signing": `Bearer ${swap({ "cognito:groups": ["admin", "x"] })}`,
    "alg none": `Bearer ${none}`,
    "HMAC with a public key": `Bearer ${hmac}`,
    "other issuer": `Bearer ${idp.sign({ iss: "https://evil.example/pool" })}`,
    "other audience": `Bearer ${idp.sign({ aud: "another-client" })}`,
    expired: `Bearer ${idp.sign({ exp: now - 120 })}`,
    "not yet valid": `Bearer ${idp.sign({ nbf: now + 600 })}`,
    "access token": `Bearer ${idp.sign({ token_use: "access" })}`,
    "unknown key": `Bearer ${idp.sign({ kid: "nope" })}`,
    "no subject": `Bearer ${idp.sign({ sub: undefined })}`,
  };
  for (const [name, header] of Object.entries(cases)) {
    assert.equal(await auth.identify(header), null, name);
  }
  assert.ok(await auth.identify(`Bearer ${idp.sign({ exp: now - 30 })}`), "within the 60 s clock skew");
  assert.ok(await auth.identify(`Bearer ${idp.sign({ aud: ["x", idp.clientId] })}`), "aud may be a list");
});

test("oidc auth: keys are cached; a new kid refetches the JWKS at most once a minute", async () => {
  const { idp, auth, advance } = setup();
  await auth.identify(`Bearer ${idp.sign()}`);
  await auth.identify(`Bearer ${idp.sign()}`);
  assert.equal(idp.fetches.filter((u) => u.endsWith("jwks.json")).length, 1, "one JWKS fetch for two tokens");
  idp.rotate();
  assert.equal(await auth.identify(`Bearer ${idp.sign({ kid: "rsa-2" })}`), null, "too soon to refetch");
  advance(61 * 1000);
  assert.ok(await auth.identify(`Bearer ${idp.sign({ kid: "rsa-2" })}`), "refetched after the gap and found the rotated key");
  assert.equal(idp.fetches.filter((u) => u.endsWith("jwks.json")).length, 2);
});

test("oidc auth: the admin claim is configurable (an IdP's groups claim, a boolean claim)", async () => {
  const { idp, auth } = setup({ adminClaim: "groups", adminValue: "screen-admins" });
  assert.equal((await auth.identify(`Bearer ${idp.sign({ groups: "staff screen-admins" })}`)).admin, true);
  assert.equal((await auth.identify(`Bearer ${idp.sign({ "cognito:groups": ["screen-admins"] })}`)).admin, false, "only the named claim counts");
  assert.equal(isAdmin(true, "admin"), true);
  assert.equal(isAdmin("admins", "admin"), false);
  assert.equal(isAdmin(["administrator"], "admin"), false);
  assert.throws(() => createOidcAuth({ issuer: "https://x" }), /audience/);
});
