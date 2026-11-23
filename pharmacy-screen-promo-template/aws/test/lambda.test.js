"use strict";

// The two Lambda entries end to end through API Gateway events, with the AWS
// services faked in memory: DynamoDB (test/fake-dynamodb.js), S3, KMS (a fake
// that checks the EncryptionContext like the real one) and the identity
// provider (test/jwt.js). Covers the token's protection on AWS (never stored
// or returned in plain text, KMS sees only the data key), the Location API
// proxy adding x-api-key with failover, and the client address the rate limit
// uses.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createFakeDynamo } = require("./fake-dynamodb");
const { createTestIdp } = require("./jwt");
const { createOidcAuth } = require("../adapters/oidc-auth");
const { createS3Blobs } = require("../adapters/s3-blobs");
const { awsKmsProvider } = require("../adapters/aws-kms-provider");
const { fromEvent, toResult, clientIp, addressOnly } = require("../lambda/apigw");
const { createOriginSecret, CACHE_MS } = require("../lambda/origin-secret");
const SM = require("@aws-sdk/client-secrets-manager");
const configLambda = require("../lambda/config-api");
const phLambda = require("../lambda/ph-proxy");
const S3 = require("@aws-sdk/client-s3");
const KMS = require("@aws-sdk/client-kms");

const ORIGIN_SECRET = "s3cr3t-origin-value";
const TOKEN = "ph-live-token-abcdefgh1234";

function fakeS3() {
  const objects = new Map();
  return {
    objects,
    async send(cmd) {
      const i = cmd.input;
      if (cmd instanceof S3.PutObjectCommand) objects.set(`${i.Bucket}/${i.Key}`, { body: Buffer.from(i.Body), type: i.ContentType, cache: i.CacheControl });
      else if (cmd instanceof S3.DeleteObjectCommand) objects.delete(`${i.Bucket}/${i.Key}`);
      else throw new Error(`fake s3: ${cmd.constructor.name}`);
      return {};
    },
  };
}

function fakeKms(keyArn) {
  const master = crypto.randomBytes(32);
  const seen = [];
  return {
    seen,
    async send(cmd) {
      const i = cmd.input;
      seen.push({ op: cmd.constructor.name, plaintextLength: i.Plaintext ? i.Plaintext.length : undefined, context: i.EncryptionContext });
      const aad = Buffer.from(JSON.stringify(i.EncryptionContext || {}));
      if (cmd instanceof KMS.EncryptCommand) {
        const iv = crypto.randomBytes(12);
        const c = crypto.createCipheriv("aes-256-gcm", master, iv).setAAD(aad);
        const ct = Buffer.concat([c.update(i.Plaintext), c.final()]);
        return { CiphertextBlob: Buffer.concat([iv, c.getAuthTag(), ct]), KeyId: keyArn };
      }
      if (cmd instanceof KMS.DecryptCommand) {
        const b = Buffer.from(i.CiphertextBlob);
        const d = crypto.createDecipheriv("aes-256-gcm", master, b.subarray(0, 12)).setAAD(aad);
        d.setAuthTag(b.subarray(12, 28));
        try {
          return { Plaintext: Buffer.concat([d.update(b.subarray(28)), d.final()]), KeyId: keyArn };
        } catch {
          throw Object.assign(new Error("InvalidCiphertextException"), { name: "InvalidCiphertextException" });
        }
      }
      throw new Error(`fake kms: ${cmd.constructor.name}`);
    },
  };
}

// Through CloudFront by default (it adds x-origin-verify); direct: true is a call straight to API Gateway.
function event(method, path, { headers = {}, body, base64 = false, query, sourceIp = "198.51.100.9", direct = false } = {}) {
  return {
    version: "2.0",
    rawPath: path,
    headers: direct ? headers : { "x-origin-verify": ORIGIN_SECRET, ...headers },
    queryStringParameters: query,
    body: body === undefined ? undefined : base64 ? Buffer.from(body).toString("base64") : typeof body === "string" ? body : JSON.stringify(body),
    isBase64Encoded: base64,
    requestContext: { http: { method, path, sourceIp } },
  };
}

function setupPh() {
  const idp = createTestIdp();
  const ddb = createFakeDynamo();
  const kmsArn = "arn:aws:kms:ap-southeast-2:111122223333:key/abc";
  const kms = fakeKms(kmsArn);
  const upstream = [];
  const fetchImpl = async (url, init = {}) => {
    upstream.push({ url: String(url), key: init.headers && (init.headers["x-api-key"] || init.headers["X-Api-Key"]) });
    if (String(url).startsWith("https://down.example")) throw Object.assign(new Error("connect ECONNREFUSED"), { name: "TypeError" });
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: { store_location: { store_code: "VIC-MP-001", store_name: "Beaumaris", store_timezone: "Australia/Melbourne" }, store_info: { opening_hours: [], address_info: { suburb: "Beaumaris" } } } }),
      text: async () => "",
    };
  };
  const env = {
    PH_TABLE: "fake",
    PH_ROOT: "pharmacyScreen",
    PH_TOKEN_KMS_KEY: kmsArn,
    PH_API_DEFAULT_BASE_URL: "https://ph.example",
    PH_API_ALLOWED_HOSTS: "ph.example,down.example",
    PS_ORIGIN_VERIFY: ORIGIN_SECRET,
  };
  phLambda._reset();
  const logs = [];
  phLambda.getApi(env, {
    dynamodb: ddb,
    kms,
    auth: createOidcAuth({ issuer: idp.issuer, audience: idp.clientId, fetchImpl: idp.fetchImpl }),
    fetchImpl,
    logger: { info: (...a) => logs.push(a.join(" ")), warn: (...a) => logs.push(a.join(" ")), error: (...a) => logs.push(a.join(" ")), log: (...a) => logs.push(a.join(" ")) },
  });
  const admin = `Bearer ${idp.sign({ "cognito:groups": ["admin"] })}`;
  const viewer = `Bearer ${idp.sign({ sub: "u2", "cognito:groups": [] })}`;
  return { idp, ddb, kms, upstream, admin, viewer, logs };
}

test("ph-proxy on Lambda: the PH API token is saved write-only, KMS-envelope-encrypted, and only its last 4 are shown", async () => {
  const prev = process.env.PS_ORIGIN_VERIFY;
  process.env.PS_ORIGIN_VERIFY = ORIGIN_SECRET;
  const ctx = setupPh();
  try {
    assert.equal((await phLambda.handler(event("PUT", "/api/settings/ph-api", { body: { token: TOKEN } }))).statusCode, 401, "signed out");
    assert.equal((await phLambda.handler(event("PUT", "/api/settings/ph-api", { headers: { authorization: ctx.viewer }, body: { token: TOKEN } }))).statusCode, 403, "not an admin");

    const put = await phLambda.handler(event("PUT", "/api/settings/ph-api", { headers: { authorization: ctx.admin, "content-type": "application/json" }, body: { token: TOKEN, baseUrls: ["https://down.example", "https://ph.example"] } }));
    assert.equal(put.statusCode, 200, put.body);
    const settings = JSON.parse(put.body).settings;
    assert.equal(settings.token.last4, "1234");
    assert.ok(!put.body.includes(TOKEN), "the response never holds the token");

    const raw = JSON.stringify([...ctx.ddb.items.values()]);
    assert.ok(!raw.includes(TOKEN) && !raw.includes(Buffer.from(TOKEN).toString("base64")), "the table never holds the token");
    const stored = JSON.parse([...ctx.ddb.items.values()].find((i) => i.sk.S === "settings#phApi").doc.S);
    assert.equal(stored.token.envelope.kms, "aws-kms");
    assert.equal(stored.token.envelope.keyId, "arn:aws:kms:ap-southeast-2:111122223333:key/abc");
    assert.ok(ctx.kms.seen.every((s) => s.plaintextLength === undefined || s.plaintextLength === 32), "KMS only ever sees the 32-byte data key");
    assert.ok(ctx.kms.seen.every((s) => s.context && /ph-api-token/.test(s.context.purpose)), "every KMS call carries the encryption context");
    const auditItem = [...ctx.ddb.items.values()].find((i) => i.pk.S === "pharmacyScreen#private-audit");
    assert.ok(auditItem && !auditItem.doc.S.includes(TOKEN), "audit-logged, without the token");

    const get = await phLambda.handler(event("GET", "/api/settings/ph-api", { headers: { authorization: ctx.admin } }));
    assert.equal(JSON.parse(get.body).settings.token.set, true);
    assert.ok(!get.body.includes(TOKEN));

    // A screen: the proxy decrypts in memory, adds x-api-key, fails over past the server that is down.
    const screen = await phLambda.handler(event("GET", "/api/device/DEV-001/campaign_data", { headers: { "x-origin-verify": ORIGIN_SECRET, "cloudfront-viewer-address": "203.0.113.5:4433" } }));
    assert.equal(screen.statusCode, 200, screen.body);
    assert.equal(JSON.parse(screen.body).data.store_location.store_code, "VIC-MP-001");
    assert.ok(!screen.body.includes(TOKEN));
    assert.deepEqual(ctx.upstream.map((u) => new URL(u.url).host), ["down.example", "ph.example"]);
    assert.ok(ctx.upstream.every((u) => u.key === TOKEN), "x-api-key added server-side");
    assert.ok(!ctx.logs.join("\n").includes(TOKEN), "never logged");

    const del = await phLambda.handler(event("DELETE", "/api/settings/ph-api/token", { headers: { authorization: ctx.admin } }));
    assert.equal(JSON.parse(del.body).settings.token.set, false);
    assert.equal((await phLambda.handler(event("GET", "/api/device/BAD%20ID/campaign_data"))).statusCode, 400, "bad device id");
  } finally {
    process.env.PS_ORIGIN_VERIFY = prev;
    phLambda._reset();
  }
});

test("ph-proxy on Lambda: the viewer address is trusted only with CloudFront's origin header", () => {
  const ev = (headers) => event("GET", "/api/device/X/campaign_data", { headers, sourceIp: "198.51.100.9", direct: true });
  const h = (e) => fromEvent(e).allHeaders;
  const via = ev({ "x-origin-verify": ORIGIN_SECRET, "cloudfront-viewer-address": "203.0.113.5:4433" });
  assert.equal(clientIp(via, h(via), ORIGIN_SECRET), "203.0.113.5");
  const forged = ev({ "x-origin-verify": "guess", "cloudfront-viewer-address": "203.0.113.5:4433" });
  assert.equal(clientIp(forged, h(forged), ORIGIN_SECRET), "198.51.100.9", "a forged viewer address is ignored");
  const direct = ev({ "cloudfront-viewer-address": "203.0.113.5:4433" });
  assert.equal(clientIp(direct, h(direct), ORIGIN_SECRET), "198.51.100.9");
  assert.equal(clientIp(via, h(via), ""), "198.51.100.9", "no secret configured: never trusted");
  assert.equal(addressOnly("2001:db8::1:51234"), "2001:db8::1");
  assert.equal(addressOnly("[2001:db8::1]:443"), "2001:db8::1");
  assert.equal(addressOnly("203.0.113.5"), "203.0.113.5");
  assert.ok(!("x-origin-verify" in fromEvent(via).headers), "the secret is not passed on to the API layer");
});

test("config API on Lambda: admin CRUD with an OIDC token, uploads to S3, public screen read", async () => {
  const idp = createTestIdp();
  const ddb = createFakeDynamo();
  const s3 = fakeS3();
  configLambda._reset();
  configLambda.getApi(
    { PS_TABLE: "fake", PS_ROOT: "pharmacyScreen", PS_MEDIA_BUCKET: "media-bucket", PS_MEDIA_BASE_URL: "https://screens.example.com", PS_ALLOWED_ORIGINS: "https://screens.example.com", PS_ORIGIN_VERIFY: ORIGIN_SECRET },
    { dynamodb: ddb, s3, auth: createOidcAuth({ issuer: idp.issuer, audience: idp.clientId, fetchImpl: idp.fetchImpl }) }
  );
  try {
    const admin = { authorization: `Bearer ${idp.sign({ "cognito:groups": ["admin"] })}` };
    assert.equal((await configLambda.handler(event("GET", "/api/health"))).statusCode, 200);
    assert.equal((await configLambda.handler(event("GET", "/api/admin/me"))).statusCode, 401);
    assert.equal((await configLambda.handler(event("GET", "/api/admin/me", { headers: { authorization: `Bearer ${idp.sign()}` } }))).statusCode, 403);
    const me = await configLambda.handler(event("GET", "/api/admin/me", { headers: admin }));
    assert.equal(me.statusCode, 200);
    assert.equal(JSON.parse(me.body).uid, "user-1");

    const promo = await configLambda.handler(event("POST", "/api/admin/promotions", { headers: { ...admin, "content-type": "application/json" }, body: { name: "Morning", promoId: "morning", templateId: "builtin-promotion-scenes" } }));
    assert.equal(promo.statusCode, 201, promo.body);
    const ph = await configLambda.handler(event("POST", "/api/admin/pharmacies", { headers: { ...admin, "content-type": "application/json" }, body: { storeCode: "VIC-MP-001", name: "Beaumaris Pharmacy", colours: { primary: "#0a7d5a", accent: "#f2a900" } } }));
    assert.equal(ph.statusCode, 201, ph.body);
    const id = JSON.parse(ph.body).id;

    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("png-bytes")]);
    const up = await configLambda.handler(event("PUT", `/api/admin/pharmacies/${id}/logo`, { headers: { ...admin, "content-type": "image/png" }, body: png, base64: true }));
    assert.equal(up.statusCode, 200, up.body);
    const logo = JSON.parse(up.body).logo;
    assert.match(logo.url, /^https:\/\/screens\.example\.com\/pharmacyScreen\/media\/logos\//);
    const obj = s3.objects.get(`media-bucket/${logo.path}`);
    assert.ok(obj && obj.body.equals(png), "the bytes reached S3 intact (base64 event body decoded)");
    assert.equal(obj.cache, "public, max-age=31536000, immutable");

    const screen = await configLambda.handler(event("GET", "/api/screens/VIC-MP-001", { query: { promo: "morning" } }));
    assert.equal(screen.statusCode, 200, screen.body);
    const cfg = JSON.parse(screen.body);
    assert.equal(cfg.logo, logo.url);
    assert.deepEqual(Object.keys(cfg.promotions), ["morning"]);
    assert.match(screen.headers["Cache-Control"] || screen.headers["cache-control"], /max-age=5\b/);

    const big = await configLambda.handler(event("PUT", `/api/admin/pharmacies/${id}/logo`, { headers: { ...admin, "content-type": "image/png" }, body: Buffer.alloc(configLambda.MAX_UPLOAD_BYTES + 1), base64: true }));
    assert.equal(big.statusCode, 413);
    assert.equal(JSON.parse(big.body).error.code, "too-large");
  } finally {
    configLambda._reset();
  }
});

test("adapters: S3 urls encode each path segment; delete is a plain DeleteObject; KMS provider needs a key", async () => {
  const s3 = fakeS3();
  const blobs = createS3Blobs({ client: s3, bucket: "b", publicBaseUrl: "https://x.example/" });
  const r = await blobs.put("pharmacyScreen/media/logos/a b/c#d.png", Buffer.from("x"), "image/png");
  assert.equal(r.url, "https://x.example/pharmacyScreen/media/logos/a%20b/c%23d.png");
  await blobs.delete("pharmacyScreen/media/logos/a b/c#d.png");
  await blobs.delete("never-there");
  assert.equal(s3.objects.size, 0);
  assert.throws(() => awsKmsProvider({}), /PH_TOKEN_KMS_KEY/);
  assert.deepEqual(toResult({ status: 204, headers: { A: 1 }, body: null }), { statusCode: 204, headers: { A: "1" }, body: "", isBase64Encoded: false });
});

test("both functions refuse a request that did not come through CloudFront (403), before any other work", async () => {
  const ctx = setupPh();
  configLambda._reset();
  configLambda.getApi({ PS_TABLE: "fake", PS_MEDIA_BUCKET: "b", PS_MEDIA_BASE_URL: "https://screens.example.com", PS_ORIGIN_VERIFY: ORIGIN_SECRET }, { dynamodb: createFakeDynamo(), s3: fakeS3(), auth: { identify: async () => null } });
  try {
    for (const [fn, path] of [[phLambda, "/api/device/DEV-001/campaign_data"], [configLambda, "/api/screens/VIC-MP-001"], [configLambda, "/api/health"], [phLambda, "/api/settings/ph-api"]]) {
      const direct = await fn.handler(event("GET", path, { direct: true }));
      assert.equal(direct.statusCode, 403, `${path} straight to API Gateway`);
      assert.equal(JSON.parse(direct.body).error.code, "forbidden");
      assert.equal(direct.headers["Cache-Control"], "no-store");
      assert.equal((await fn.handler(event("GET", path, { direct: true, headers: { "x-origin-verify": "guess" } }))).statusCode, 403, `${path} with a guessed header`);
    }
    assert.equal(ctx.upstream.length, 0, "nothing reached PH");
    assert.equal((await configLambda.handler(event("GET", "/api/health"))).statusCode, 200, "through CloudFront");
  } finally {
    phLambda._reset();
    configLambda._reset();
  }
});

test("the origin secret is read by reference (its ARN), once per container for 5 minutes; unreadable means 503, never let through", async () => {
  let t = 0;
  const calls = [];
  let fail = false;
  const client = { async send(cmd) { assert.ok(cmd instanceof SM.GetSecretValueCommand); calls.push(cmd.input.SecretId); if (fail) throw Object.assign(new Error("denied"), { name: "AccessDeniedException" }); return { SecretString: ORIGIN_SECRET }; } };
  const arn = "arn:aws:secretsmanager:ap-southeast-2:111122223333:secret:OriginVerify-abc";
  const s = createOriginSecret({ env: { PS_ORIGIN_VERIFY_SECRET_ARN: arn }, client, now: () => t });
  assert.equal(s.configured, true);
  assert.deepEqual(await Promise.all([s.get(), s.get(), s.get()]), [ORIGIN_SECRET, ORIGIN_SECRET, ORIGIN_SECRET]);
  assert.deepEqual(calls, [arn], "one read for concurrent requests");
  t += CACHE_MS - 1;
  await s.get();
  assert.equal(calls.length, 1);
  t += 2;
  await s.get();
  assert.equal(calls.length, 2, "read again after 5 minutes");
  assert.equal(createOriginSecret({ env: {} }).configured, false, "nothing configured (local runs): no check");

  configLambda._reset();
  fail = true;
  const errors = [];
  const prevErr = console.error;
  console.error = (m) => errors.push(String(m));
  try {
    configLambda.getApi({ PS_TABLE: "fake", PS_MEDIA_BUCKET: "b", PS_MEDIA_BASE_URL: "https://screens.example.com", PS_ORIGIN_VERIFY_SECRET_ARN: arn }, { dynamodb: createFakeDynamo(), s3: fakeS3(), auth: { identify: async () => null }, secretsManager: client });
    const r = await configLambda.handler(event("GET", "/api/health"));
    assert.equal(r.statusCode, 503);
    assert.ok(errors.some((e) => /origin secret could not be read: AccessDeniedException/.test(e)));
    assert.ok(!errors.join("").includes(ORIGIN_SECRET));
    fail = false;
    assert.equal((await configLambda.handler(event("GET", "/api/health"))).statusCode, 200, "recovers once the secret can be read");
  } finally {
    console.error = prevErr;
    configLambda._reset();
  }
});

test("config API on Lambda: the screen read's per-client limit counts the CloudFront viewer address", async () => {
  configLambda._reset();
  configLambda.getApi({ PS_TABLE: "fake", PS_MEDIA_BUCKET: "b", PS_MEDIA_BASE_URL: "https://screens.example.com", PS_ORIGIN_VERIFY: ORIGIN_SECRET, PS_RATE_LIMIT_SCREENS_PER_IP_PER_MIN: "3" }, { dynamodb: createFakeDynamo(), s3: fakeS3(), auth: { identify: async () => null } });
  try {
    const get = (viewer) => configLambda.handler(event("GET", "/api/screens/GUESS", { headers: { "cloudfront-viewer-address": viewer } }));
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await get(`203.0.113.5:${4000 + i}`)).statusCode);
    assert.deepEqual(codes, [404, 404, 404, 429], "one viewer, whatever its port");
    assert.equal((await get("198.51.100.20:4000")).statusCode, 404, "another viewer through the same edge");
  } finally {
    configLambda._reset();
  }
});
