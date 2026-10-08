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

export async function testContext(opts: { flag?: boolean; role?: Role; seeded?: boolean; bookings?: boolean; demo?: boolean; dspFetch?: Fetch; clock?: () => Date; byWindow?: boolean } = {}) {
  const ctx = createContext({
    config: { ...loadConfig({ DSP_MOCKS_URL: 'http://mocks.test' }), dbFile: ':memory:', assetsDir: mkdtempSync(join(tmpdir(), 'ph-assets-')) },
    db: openDb(':memory:'),
    flags: staticFlags(opts.flag ?? true),
    session: staticSession(opts.role ?? 'hq_admin'),
    secrets: aesGcmSecretsStore(TEST_KEY),
    dspFetch: opts.dspFetch,
    clock: opts.clock,
  })
  /* The sample bookings and the demo estate are opt-in here: a test wants a
     clean, minimal schedule it can count. */
  if (opts.seeded !== false) await seed(ctx, { bookings: opts.bookings === true, demo: opts.demo === true })
  /* byWindow: the seeded Menu Board's open supplier slot is sold by play window (on one perpetual open deal) so a window can be bid on and auctioned: an open slot is otherwise real time. */
  if (opts.byWindow) await sellByWindow(ctx, 'menu_board', 2)
  return ctx
}

/* Sell a slot by play window, the only way left besides a reservation held
   for named advertisers (8 Oct 2026: every open or whitelist-only position is
   sold in real time). It is assigned to a perpetual open deal — no dates, no
   auctionCloses, inviting every seat of every DSP that exists now — so a
   window can be bid on, auctioned and billed the way the open auction used to
   be in these tests. Call it again after adding a DSP to invite its seats. */
export async function sellByWindow(ctx: Awaited<ReturnType<typeof testContext>>, displayTypeId: string, slot: number, listId = 'bl_test_open') {
  const invitedBuyers = (await ctx.partners.list()).flatMap((p) => p.seats.map((s) => ({ partnerId: p.id, seatId: s.id })))
  const existing = await ctx.buyersLists.get(listId)
  if (existing) await ctx.buyersLists.update(listId, { name: existing.name, description: '', dealType: existing.dealType, invitedBuyers, activeFrom: existing.activeFrom, activeTo: existing.activeTo, auctionCloses: existing.auctionCloses })
  else await ctx.buyersLists.insert({ id: listId, name: 'Open deal (test)', description: '', invitedBuyers, activeFrom: null, activeTo: null, auctionCloses: null })
  const ext = (await ctx.displayTypes.get(displayTypeId))!.phExtensions!
  await ctx.displayTypes.saveExtensions(displayTypeId, { ...ext, slots: ext.slots.map((s, i) => (i === slot - 1 ? { ...s, listMode: 'deal' as const, buyersListId: listId } : s)) })
}
