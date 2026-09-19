import { randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { staticSession } from '../src/auth/session'
import { loadConfig } from '../src/config'
import { createContext } from '../src/context'
import { openDb } from '../src/db/db'
import { staticFlags } from '../src/flags/Flags'
import { aesGcmSecretsStore } from '../src/secrets/SecretsStore'
import { seed } from '../src/seed/seed'
import type { Role } from '@ph-dsp/types'
import { buildMocks } from '../../dsp-mocks/src/app'
import type { Fetch } from '../src/dsp/DspClient'

/* Route the DSP clients' HTTP calls into an in-process mock DSP service. */
export function mockDsps() {
  const mocks = buildMocks()
  const fetchImpl: Fetch = async (url, init) => {
    const u = new URL(url)
    const res = await mocks.app.inject({
      method: (init?.method ?? 'GET') as 'GET', url: u.pathname + u.search,
      headers: { host: u.host, ...(init?.headers as Record<string, string> | undefined) }, payload: init?.body as string | undefined,
    })
    return new Response(new Uint8Array(res.rawPayload), { status: res.statusCode, headers: { 'content-type': String(res.headers['content-type'] ?? 'application/json') } })
  }
  return { ...mocks, fetchImpl }
}

/* Sunday 20 Sep 2026, mid-morning UTC: the next window that can be sold starts 21 Sep. */
export const NOW = new Date('2026-09-20T10:00:00.000Z')

export const TEST_KEY = randomBytes(32).toString('base64')

export async function testContext(opts: { flag?: boolean; role?: Role; seeded?: boolean; dspFetch?: Fetch; clock?: () => Date } = {}) {
  const ctx = createContext({
    config: { ...loadConfig({ DSP_MOCKS_URL: 'http://mocks.test' }), dbFile: ':memory:', assetsDir: mkdtempSync(join(tmpdir(), 'ph-assets-')) },
    db: openDb(':memory:'),
    flags: staticFlags(opts.flag ?? true),
    session: staticSession(opts.role ?? 'hq_admin'),
    secrets: aesGcmSecretsStore(TEST_KEY),
    dspFetch: opts.dspFetch,
    clock: opts.clock,
  })
  if (opts.seeded !== false) await seed(ctx)
  return ctx
}
