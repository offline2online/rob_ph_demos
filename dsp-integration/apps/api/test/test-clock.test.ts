import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config'
import { createContext } from '../src/context'
import { aesGcmSecretsStore } from '../src/secrets/SecretsStore'
import { testClockFrom } from '../src/testClock'

describe('PH_TEST_CLOCK', () => {
  it('is refused under NODE_ENV=production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', PARTNER_TOKENS: '{"t":"p"}', PH_TEST_CLOCK: '2026-10-02T00:00:00Z' })).toThrow(/PH_TEST_CLOCK/)
  })

  it('fixed instant', () => {
    expect(testClockFrom('2026-10-02T03:00:00Z')().toISOString()).toBe('2026-10-02T03:00:00.000Z')
  })

  it('a file is re-read, so a runner can advance it for every process', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'clock-')), 'now')
    writeFileSync(file, '2026-10-02T03:00:00Z\n')
    const clock = testClockFrom(file)
    expect(clock().toISOString()).toBe('2026-10-02T03:00:00.000Z')
    writeFileSync(file, '2026-10-02T04:00:00Z')
    expect(clock().toISOString()).toBe('2026-10-02T04:00:00.000Z')
  })

  it('a bad value fails at start-up', () => {
    expect(() => testClockFrom('/nonexistent/clock')).toThrow()
  })

  it('the context uses it', () => {
    const ctx = createContext({ config: { ...loadConfig({ PH_DB_FILE: ':memory:' }), testClock: '2026-10-02T03:00:00Z' }, secrets: aesGcmSecretsStore(Buffer.alloc(32, 1).toString('base64')) })
    expect(ctx.clock().toISOString()).toBe('2026-10-02T03:00:00.000Z')
    ctx.db.close()
  })
})
