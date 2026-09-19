import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { aesGcmSecretsStore } from '../src/secrets/SecretsStore'
import { testContext } from './helpers'

describe('SecretsStore (AES-256-GCM)', () => {
  const store = aesGcmSecretsStore(randomBytes(32).toString('base64'))

  it('round-trips and never produces the plaintext', () => {
    const c = store.encrypt('Atzr|refresh-token')
    expect(c).not.toContain('Atzr')
    expect(store.decrypt(c)).toBe('Atzr|refresh-token')
    expect(store.encrypt('x')).not.toBe(store.encrypt('x'))
  })

  it('rejects tampered ciphertext and a wrong key', () => {
    const c = store.encrypt('secret')
    const parts = c.split(':')
    parts[3] = Buffer.from('tampered').toString('base64')
    expect(() => store.decrypt(parts.join(':'))).toThrow()
    expect(() => aesGcmSecretsStore(randomBytes(32).toString('base64')).decrypt(c)).toThrow()
  })

  it('requires a 32-byte key', () => {
    expect(() => aesGcmSecretsStore(undefined)).toThrow(/PH_SECRETS_KEY/)
    expect(() => aesGcmSecretsStore(randomBytes(16).toString('base64'))).toThrow()
  })

  it('partner secret credentials are encrypted at rest', async () => {
    const ctx = await testContext()
    const rows = ctx.db.prepare('SELECT creds_public, creds_secret FROM partners').all() as { creds_public: string; creds_secret: string }[]
    const raw = JSON.stringify(rows)
    expect(raw).not.toContain('Atzr|poc-placeholder')
    expect(raw).not.toContain('poc-placeholder-secret')
    expect(raw).not.toContain('private_key')
    expect(ctx.partners.secrets('p_amazon')).toEqual({ lwaClientSecret: 'poc-placeholder-secret', refreshToken: 'Atzr|poc-placeholder' })
    expect(ctx.partners.get('p_amazon')?.secretsSet).toEqual(['lwaClientSecret', 'refreshToken'])
  })
})
