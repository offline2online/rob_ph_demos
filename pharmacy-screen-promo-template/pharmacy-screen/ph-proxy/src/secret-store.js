"use strict";
// Secret-store adapter for the PH API token.
//
// The token is envelope-encrypted: a fresh 256-bit data key (DEK) encrypts the
// token with AES-256-GCM in this process, and a key-management service (KMS)
// wraps the DEK. Only the envelope (ciphertext, IV, tag, wrapped DEK, key
// name) is ever stored; the plaintext token and the plaintext DEK exist only
// in memory inside the proxy function.
//
// A KMS provider is any object with:
//   name                         a short id stored in the envelope ("gcp-kms")
//   keyId                        which key wraps the DEK (stored, not secret)
//   wrapKey(dek: Buffer, aad: Buffer)   -> Promise<{ wrapped: Buffer, keyVersion?: string }>
//   unwrapKey(wrapped: Buffer, aad: Buffer, keyVersion?: string) -> Promise<Buffer>
//
// Providers here: gcpKmsProvider (Cloud KMS, our Firebase test environment)
// and localKmsProvider (emulator and tests only). The AWS deployment's
// provider, over AWS KMS Encrypt/Decrypt with an EncryptionContext built from
// `aad`, is ../../../aws/adapters/aws-kms-provider.js; nothing else changes.

const crypto = require("node:crypto");

const ENVELOPE_VERSION = 1;
const ALG = "AES-256-GCM";

class SecretStoreError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function createEnvelopeSecretStore({ kms }) {
  if (!kms || typeof kms.wrapKey !== "function" || typeof kms.unwrapKey !== "function") {
    throw new SecretStoreError("SECRET_STORE_NOT_CONFIGURED", "No key-management provider configured");
  }
  return {
    provider: kms.name,
    async seal(plaintext, { aad }) {
      if (typeof plaintext !== "string" || !plaintext) throw new SecretStoreError("INVALID_SECRET", "Nothing to encrypt");
      const aadBuf = Buffer.from(String(aad || ""), "utf8");
      const dek = crypto.randomBytes(32);
      const iv = crypto.randomBytes(12);
      try {
        const cipher = crypto.createCipheriv("aes-256-gcm", dek, iv);
        cipher.setAAD(aadBuf);
        const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
        const tag = cipher.getAuthTag();
        const { wrapped, keyVersion } = await kms.wrapKey(dek, aadBuf);
        return {
          v: ENVELOPE_VERSION,
          alg: ALG,
          kms: kms.name,
          keyId: kms.keyId || null,
          keyVersion: keyVersion || null,
          wrappedKey: Buffer.from(wrapped).toString("base64"),
          iv: iv.toString("base64"),
          tag: tag.toString("base64"),
          ciphertext: ciphertext.toString("base64"),
        };
      } finally {
        dek.fill(0);
      }
    },
    async open(envelope, { aad }) {
      if (!envelope || envelope.v !== ENVELOPE_VERSION || envelope.alg !== ALG) {
        throw new SecretStoreError("SECRET_UNREADABLE", "Unknown envelope format");
      }
      if (envelope.kms !== kms.name) {
        throw new SecretStoreError("SECRET_UNREADABLE", `Envelope was sealed by ${envelope.kms}, this store uses ${kms.name}`);
      }
      const aadBuf = Buffer.from(String(aad || ""), "utf8");
      let dek;
      try {
        dek = await kms.unwrapKey(Buffer.from(envelope.wrappedKey, "base64"), aadBuf, envelope.keyVersion || undefined);
        const decipher = crypto.createDecipheriv("aes-256-gcm", dek, Buffer.from(envelope.iv, "base64"));
        decipher.setAAD(aadBuf);
        decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
        return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8");
      } catch (e) {
        if (e instanceof SecretStoreError) throw e;
        // Never include the underlying message: it is not useful to a caller
        // and some providers echo request fields.
        throw new SecretStoreError("SECRET_UNREADABLE", "The stored token could not be decrypted");
      } finally {
        if (dek) Buffer.from(dek).fill(0);
      }
    },
  };
}

// Cloud KMS. keyName is the full CryptoKey resource name; Cloud KMS picks the
// primary version to encrypt and finds the right version itself to decrypt,
// so rotating the KMS key needs no change here.
function gcpKmsProvider({ keyName, client }) {
  if (!keyName) throw new SecretStoreError("SECRET_STORE_NOT_CONFIGURED", "PH_TOKEN_KMS_KEY is not set");
  let kmsClient = client || null;
  const getClient = () => {
    if (!kmsClient) {
      const { KeyManagementServiceClient } = require("@google-cloud/kms");
      kmsClient = new KeyManagementServiceClient();
    }
    return kmsClient;
  };
  return {
    name: "gcp-kms",
    keyId: keyName,
    async wrapKey(dek, aad) {
      const [res] = await getClient().encrypt({ name: keyName, plaintext: dek, additionalAuthenticatedData: aad });
      return { wrapped: Buffer.from(res.ciphertext), keyVersion: res.name || null };
    },
    async unwrapKey(wrapped, aad) {
      const [res] = await getClient().decrypt({ name: keyName, ciphertext: wrapped, additionalAuthenticatedData: aad });
      return Buffer.from(res.plaintext);
    },
  };
}

// A KMS stand-in that wraps the DEK with a local AES key. For the Firebase
// emulator, local runs and tests ONLY: it refuses to start on Cloud
// Functions / Cloud Run (K_SERVICE is set there) and on AWS Lambda
// (AWS_LAMBDA_FUNCTION_NAME), where the real KMS must be used. There is
// deliberately no override.
function localKmsProvider({ keyBase64, env = process.env } = {}) {
  if (env.K_SERVICE || env.AWS_LAMBDA_FUNCTION_NAME) {
    throw new SecretStoreError("SECRET_STORE_NOT_CONFIGURED", "The local secret store is for emulators and tests only");
  }
  const key = Buffer.from(String(keyBase64 || ""), "base64");
  if (key.length !== 32) throw new SecretStoreError("SECRET_STORE_NOT_CONFIGURED", "PH_LOCAL_KMS_KEY must be base64 of 32 bytes");
  return {
    name: "local",
    keyId: "local",
    async wrapKey(dek, aad) {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv("aes-256-gcm", key, iv);
      c.setAAD(aad);
      const ct = Buffer.concat([c.update(dek), c.final()]);
      return { wrapped: Buffer.concat([iv, c.getAuthTag(), ct]) };
    },
    async unwrapKey(wrapped, aad) {
      const iv = wrapped.subarray(0, 12);
      const tag = wrapped.subarray(12, 28);
      const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
      d.setAAD(aad);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(wrapped.subarray(28)), d.final()]);
    },
  };
}

// Picks the provider from configuration. Returns null (not an error) when the
// store is not configured, so the settings GET and the proxy can still answer
// with a clear "not configured" error instead of the whole function failing.
function secretStoreFromEnv(env = process.env, deps = {}) {
  const kind = (env.PH_SECRET_STORE || "gcp-kms").trim();
  try {
    if (kind === "gcp-kms") return createEnvelopeSecretStore({ kms: gcpKmsProvider({ keyName: env.PH_TOKEN_KMS_KEY, client: deps.kmsClient }) });
    if (kind === "local") return createEnvelopeSecretStore({ kms: localKmsProvider({ keyBase64: env.PH_LOCAL_KMS_KEY, env }) });
  } catch (e) {
    if (e instanceof SecretStoreError) return null;
    throw e;
  }
  return null;
}

module.exports = {
  SecretStoreError,
  createEnvelopeSecretStore,
  gcpKmsProvider,
  localKmsProvider,
  secretStoreFromEnv,
};
