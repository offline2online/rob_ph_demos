"use strict";

// AWS Lambda entry for the config API (miPharmacy's environment). The AWS
// counterpart of pharmacy-screen/config-api/index.js: it only wires the AWS
// adapters into the same framework-neutral createConfigApi(); routes,
// validation, publishing and audit are unchanged.
//
// Configuration (set by the CDK stack, infra/stack.js; all non-secret):
//   PS_TABLE             DynamoDB table (config records, audit log, published screens)
//   PS_ROOT              key prefix in that table                       (default "pharmacyScreen")
//   PS_MEDIA_BUCKET      S3 bucket for logos and backgrounds
//   PS_MEDIA_BASE_URL    public origin that serves pharmacyScreen/media/* (the CloudFront site)
//   PS_ALLOWED_ORIGINS   comma-separated origins allowed to call admin endpoints from a browser
//   PS_OIDC_ISSUER, PS_OIDC_AUDIENCE, PS_OIDC_JWKS_URI, PS_ADMIN_CLAIM, PS_ADMIN_VALUE
//                        admin sign-in (adapters/oidc-auth.js)
//
// Uploads: a request body reaches Lambda base64-encoded inside a 6 MB event,
// so an image upload here is limited to MAX_UPLOAD_BYTES (4 MB), below the
// API's own 5 MB background limit; a larger file gets the API's normal 413.

const { createConfigApi } = require("../../pharmacy-screen/config-api/src/api");
const { createDynamoStore } = require("../adapters/dynamodb-store");
const { createS3Blobs } = require("../adapters/s3-blobs");
const { oidcAuthFromEnv } = require("../adapters/oidc-auth");
const { fromEvent, toResult } = require("./apigw");

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

let api = null;
function getApi(env = process.env, deps = {}) {
  if (api) return api;
  const ddb = deps.dynamodb || new (require("@aws-sdk/client-dynamodb").DynamoDBClient)({});
  const s3 = deps.s3 || new (require("@aws-sdk/client-s3").S3Client)({});
  api = createConfigApi({
    store: createDynamoStore({ client: ddb, table: env.PS_TABLE, root: env.PS_ROOT || "pharmacyScreen" }),
    blobs: createS3Blobs({ client: s3, bucket: env.PS_MEDIA_BUCKET, publicBaseUrl: env.PS_MEDIA_BASE_URL }),
    auth: deps.auth || oidcAuthFromEnv(env, { log: (level, msg) => console.warn(msg) }),
    allowedOrigins: String(env.PS_ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()),
    // Never log request bodies or headers: an Authorization header is a
    // credential. Only the route and the error.
    log: (level, msg) => (level === "error" ? console.error(msg) : console.warn(msg)),
  });
  return api;
}

async function handler(event) {
  const req = fromEvent(event);
  if (req.body && req.body.length > MAX_UPLOAD_BYTES) {
    return toResult({ status: 413, headers: { "Cache-Control": "no-store" }, body: { error: { code: "too-large", message: `Uploads are limited to ${MAX_UPLOAD_BYTES / 1048576} MB here` } } });
  }
  const out = await getApi().handle({ method: req.method, path: req.path, headers: req.headers, query: req.query, body: req.body });
  return toResult(out);
}

// For tests: build with injected clients, and forget the cached instance.
function _reset() {
  api = null;
}

module.exports = { handler, getApi, _reset, MAX_UPLOAD_BYTES };
