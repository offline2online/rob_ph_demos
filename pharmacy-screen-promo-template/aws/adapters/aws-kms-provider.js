"use strict";

// AWS KMS provider for the PH API token's envelope encryption
// (ph-proxy/src/secret-store.js). It implements the four members that file
// documents; the envelope itself (AES-256-GCM over the token with a fresh
// data key) is unchanged, so the token is never sent to KMS, only the data
// key is, and the stored settings record holds only the envelope.
//
//   name       "aws-kms" (stored in the envelope)
//   keyId      the KMS key ARN (or alias ARN) that wraps the data key
//   wrapKey    KMS Encrypt of the 32-byte data key, EncryptionContext {purpose: <aad>}
//   unwrapKey  KMS Decrypt with the same EncryptionContext and KeyId
//
// The EncryptionContext binds the wrapped key to its use (the same string the
// envelope authenticates), and appears in CloudTrail for every decrypt. KMS key
// rotation needs nothing here: KMS decrypts with whichever key material
// wrapped the data key.

function awsKmsProvider({ keyId, client, commands } = {}) {
  if (!keyId) {
    const { SecretStoreError } = require("../../pharmacy-screen/ph-proxy/src/secret-store");
    throw new SecretStoreError("SECRET_STORE_NOT_CONFIGURED", "PH_TOKEN_KMS_KEY is not set");
  }
  const C = commands || require("@aws-sdk/client-kms");
  let kms = client || null;
  const getClient = () => (kms = kms || new C.KMSClient({}));
  const context = (aad) => {
    const purpose = Buffer.from(aad || "").toString("utf8");
    return purpose ? { purpose } : undefined;
  };
  return {
    name: "aws-kms",
    keyId,
    async wrapKey(dek, aad) {
      const out = await getClient().send(new C.EncryptCommand({ KeyId: keyId, Plaintext: Buffer.from(dek), EncryptionContext: context(aad) }));
      return { wrapped: Buffer.from(out.CiphertextBlob), keyVersion: out.KeyId || null };
    },
    async unwrapKey(wrapped, aad) {
      const out = await getClient().send(new C.DecryptCommand({ KeyId: keyId, CiphertextBlob: Buffer.from(wrapped), EncryptionContext: context(aad) }));
      return Buffer.from(out.Plaintext);
    },
  };
}

module.exports = { awsKmsProvider };
