"use strict";

// The value CloudFront sends API Gateway as `x-origin-verify` (aws/infra/stack.js), read by reference: the
// functions get the Secrets Manager secret's ARN (PS_ORIGIN_VERIFY_SECRET_ARN), never the value, and fetch it
// once per container, kept for CACHE_MS. A request whose header does not match is refused with 403 before any
// other work (lambda/apigw.js → originCheck), so the API Gateway URL called directly answers nothing.
//
//   PS_ORIGIN_VERIFY_SECRET_ARN   set by the stack on both functions
//   PS_ORIGIN_VERIFY              the value itself: tests and local runs only; the stack never sets it
//
// Neither set: no check (local runs, tests). The secret cannot be read: 503, never let through.

const CACHE_MS = 5 * 60 * 1000;

function createOriginSecret({ env = process.env, client, now = () => Date.now() } = {}) {
  const arn = env.PS_ORIGIN_VERIFY_SECRET_ARN || "";
  const plain = env.PS_ORIGIN_VERIFY || "";
  let cached = null; // { value, at }
  let pending = null;
  const sm = () => {
    if (!client) {
      const { SecretsManagerClient } = require("@aws-sdk/client-secrets-manager");
      client = new SecretsManagerClient({});
    }
    return client;
  };
  return {
    configured: !!(arn || plain),
    // The current value; throws when it cannot be read.
    async get() {
      if (!arn) return plain;
      if (cached && now() - cached.at < CACHE_MS) return cached.value;
      if (!pending) {
        const { GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
        pending = sm()
          .send(new GetSecretValueCommand({ SecretId: arn }))
          .then((out) => {
            if (!out || !out.SecretString) throw new Error("the origin secret has no value");
            cached = { value: out.SecretString, at: now() };
            return cached.value;
          })
          .finally(() => {
            pending = null;
          });
      }
      return pending;
    },
  };
}

module.exports = { createOriginSecret, CACHE_MS };
