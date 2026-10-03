import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { openDb } from '../src/db/db'
import { migrateUp } from '../src/db/migrate'
import { sqlitePartnerRepo } from '../src/repos/PartnerRepo'
import { type SecretsStore, aesGcmSecretsStore } from '../src/secrets/SecretsStore'
import { testContext } from './helpers'

describe('SecretsStore (AES-256-GCM)', () => {
  const store = aesGcmSecretsStore(randomBytes(32).toString('base64'))

  /* SecretsStore is awaitable (a platform KMS answers with a promise): every call is awaited. */
  it('round-trips and never produces the plaintext', async () => {
    const c = await store.encrypt('Atzr|refresh-token')
    expect(c).not.toContain('Atzr')
    expect(await store.decrypt(c)).toBe('Atzr|refresh-token')
    expect(await store.encrypt('x')).not.toBe(await store.encrypt('x'))
  })

  it('rejects tampered ciphertext and a wrong key', async () => {
    const c = await store.encrypt('secret')
    const parts = c.split(':')
    parts[3] = Buffer.from('tampered').toString('base64')
    await expect(async () => store.decrypt(parts.join(':'))).rejects.toThrow()
    await expect(async () => aesGcmSecretsStore(randomBytes(32).toString('base64')).decrypt(c)).rejects.toThrow()
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
    expect(await ctx.partners.secrets('p_amazon')).toEqual({ lwaClientSecret: 'poc-placeholder-secret', refreshToken: 'Atzr|poc-placeholder' })
    expect((await ctx.partners.get('p_amazon'))?.secretsSet).toEqual(['lwaClientSecret', 'refreshToken'])
  })

  /* A platform secrets service answers with a promise (ticket v2iKDJQA0wmisXhp7ebV). */
  it('the partner repository works over a SecretsStore that answers with promises', async () => {
    const inner = aesGcmSecretsStore(randomBytes(32).toString('base64'))
    const slow: SecretsStore = {
      encrypt: async (p) => { await new Promise((r) => setTimeout(r, 1)); return inner.encrypt(p) },
      decrypt: async (c) => { await new Promise((r) => setTimeout(r, 1)); return inner.decrypt(c) },
    }
    const db = openDb(':memory:')
    migrateUp(db)
    const repo = sqlitePartnerRepo(db, slow)
    const base = { id: 'p1', provider: 'amazon_dsp', name: 'P1', status: 'draft' as const, lastSync: null, mode: 'test' as const, credsPublic: {}, bidder: {}, seats: [], listsLinked: true,
      allowList: [], blockList: [], categoryAllowList: [], categoryBlockList: [] }
    expect((await repo.insert({ ...base, secrets: { refreshToken: 'Atzr|x' } })).secretsSet).toEqual(['refreshToken'])
    expect(await repo.secrets('p1')).toEqual({ refreshToken: 'Atzr|x' })
    expect((await repo.update('p1', { name: 'Renamed' }))?.secretsSet).toEqual(['refreshToken'])
    expect(await repo.secrets('p1')).toEqual({ refreshToken: 'Atzr|x' })
    expect((await repo.update('p1', {}, { lwaClientSecret: 's', refreshToken: 'Atzr|y' }))?.secretsSet).toEqual(['lwaClientSecret', 'refreshToken'])
    expect(await repo.secrets('p1')).toEqual({ lwaClientSecret: 's', refreshToken: 'Atzr|y' })
    expect((await repo.update('p1', {}, {}))?.secretsSet).toEqual([])
    expect((await repo.list()).map((p) => p.name)).toEqual(['Renamed'])
    expect(await repo.update('missing', { name: 'x' })).toBeNull()
  })
})
