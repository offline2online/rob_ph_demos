import { randomBytes } from 'node:crypto'
import { staticSession } from '../src/auth/session'
import { loadConfig } from '../src/config'
import { createContext } from '../src/context'
import { openDb } from '../src/db/db'
import { staticFlags } from '../src/flags/Flags'
import { aesGcmSecretsStore } from '../src/secrets/SecretsStore'
import { seed } from '../src/seed/seed'
import type { Role } from '@ph-dsp/types'

export const TEST_KEY = randomBytes(32).toString('base64')

export function testContext(opts: { flag?: boolean; role?: Role; seeded?: boolean } = {}) {
  const ctx = createContext({
    config: { ...loadConfig({}), dbFile: ':memory:' },
    db: openDb(':memory:'),
    flags: staticFlags(opts.flag ?? true),
    session: staticSession(opts.role ?? 'hq_admin'),
    secrets: aesGcmSecretsStore(TEST_KEY),
  })
  if (opts.seeded !== false) seed(ctx)
  return ctx
}
