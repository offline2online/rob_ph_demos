"use strict";

// AWS Lambda entry for the PH API settings and the Location API proxy
// (miPharmacy's environment). The AWS counterpart of
// pharmacy-screen/ph-proxy/index.js: the same createApi() with AWS adapters —
// DynamoDB for the settings record and audit log, AWS KMS wrapping the PH API
// token's data key, OIDC (Cognito or the retailer's IdP) for the admin role.
// The token is decrypted only here, in memory.
//
// Configuration (set by the CDK stack; all non-secret):
//   PH_TABLE, PH_ROOT          DynamoDB table and key prefix (the config table, apart from the config records)
//   PH_TOKEN_KMS_KEY           KMS key ARN that wraps the token's data key
//   PH_API_DEFAULT_BASE_URL    default PH API base URL(s) until an admin saves a list
//   PH_ALLOWED_ORIGINS, PH_PROXY_*, PH_RATE_LIMIT_*, PH_UPSTREAM_CALLS_PER_MIN   as in ph-proxy/.env.example
//   PS_OIDC_ISSUER, PS_OIDC_AUDIENCE, PS_OIDC_JWKS_URI, PS_ADMIN_CLAIM, PS_ADMIN_VALUE   admin sign-in
//   PS_ORIGIN_VERIFY_SECRET_ARN  the Secrets Manager secret holding CloudFront's origin header value (read at
//                              run time, lambda/origin-secret.js): requests without it get 403; it also decides
//                              whether the viewer address can be trusted (lambda/apigw.js)

const { createApi } = require("../../pharmacy-screen/ph-proxy/src/create-api");
const { createEnvelopeSecretStore, SecretStoreError } = require("../../pharmacy-screen/ph-proxy/src/secret-store");
const { awsKmsProvider } = require("../adapters/aws-kms-provider");
const { createDynamoSettingsStore, createDynamoAuditLog } = require("../adapters/dynamodb-settings");
const { oidcAuthFromEnv } = require("../adapters/oidc-auth");
const { fromEvent, toResult, clientIp, originCheck } = require("./apigw");
const { createOriginSecret } = require("./origin-secret");

function secretStore(env, deps) {
  try {
    return createEnvelopeSecretStore({ kms: awsKmsProvider({ keyId: env.PH_TOKEN_KMS_KEY, client: deps.kms }) });
  } catch (e) {
    if (e instanceof SecretStoreError) return null; // the API answers SECRET_STORE_NOT_CONFIGURED
    throw e;
  }
}

let api = null;
let origin = null;
function getApi(env = process.env, deps = {}) {
  if (api) return api;
  origin = deps.originSecret || createOriginSecret({ env, client: deps.secretsManager });
  const ddb = deps.dynamodb || new (require("@aws-sdk/client-dynamodb").DynamoDBClient)({});
  const root = env.PH_ROOT || "pharmacyScreen";
  api = createApi({
    env,
    settingsStore: createDynamoSettingsStore({ client: ddb, table: env.PH_TABLE, root }),
    auditLog: createDynamoAuditLog({ client: ddb, table: env.PH_TABLE, root }),
    secretStore: secretStore(env, deps),
    auth: deps.auth || oidcAuthFromEnv(env, { log: (level, msg) => console.warn(msg) }),
    fetchImpl: deps.fetchImpl || globalThis.fetch,
    baseLogger: deps.logger,
    now: deps.now,
  });
  return api;
}

function parseJson(req) {
  if (!req.body) return undefined;
  const text = req.body.toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    return text; // the settings service refuses a non-object body (INVALID_BODY)
  }
}

async function handler(event) {
  const a = getApi();
  const gate = await originCheck(event, origin);
  if (!gate.ok) return gate.result;
  const req = fromEvent(event);
  const out = await a.handle({
    method: req.method,
    path: req.path,
    headers: req.headers,
    body: parseJson(req),
    ip: clientIp(event, req.allHeaders, gate.secret),
  });
  return toResult(out);
}

function _reset() {
  api = null;
  origin = null;
}

module.exports = { handler, getApi, _reset };
