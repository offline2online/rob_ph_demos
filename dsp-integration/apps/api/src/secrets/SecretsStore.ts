/* DSP credentials are encrypted at rest (AES-256-GCM) behind this
   interface; engineering swaps in the platform's secrets handling. Values
   are never logged and never returned in full. */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export interface SecretsStore {
  encrypt(plaintext: string): string
  decrypt(ciphertext: string): string
}

const VERSION = 'v1'

export function aesGcmSecretsStore(keyBase64: string | undefined): SecretsStore {
  const key = Buffer.from(keyBase64 ?? '', 'base64')
  if (key.length !== 32) throw new Error('PH_SECRETS_KEY must be a base64-encoded 32-byte key (see .env.example).')
  return {
    encrypt(plaintext) {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
      return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join(':')
    },
    decrypt(ciphertext) {
      const [version, iv, tag, body] = ciphertext.split(':')
      if (version !== VERSION || !iv || !tag || body === undefined) throw new Error('Unrecognised secret format')
      /* The full 16-byte tag, always: GCM would otherwise accept a truncated
         tag, which weakens the integrity check on a tampered record. */
      const authTag = Buffer.from(tag, 'base64')
      if (authTag.length !== 16) throw new Error('Unrecognised secret format')
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'), { authTagLength: 16 })
      decipher.setAuthTag(authTag)
      return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8')
    },
  }
}
