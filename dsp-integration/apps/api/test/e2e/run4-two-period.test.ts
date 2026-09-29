/* E2E spec v2 (board doc f34VQZCy2kkWJfBP6Iwp), Run 4 — two-period
   private auction (auction window vs delivery term). Fixture: a deal inviting
   Swisse, auctionCloses at the start of 22 Sep (day(1)), a delivery term to
   27 Sep, billingUnitHours 24. Swisse's API bid for day(1) clears and locks
   the rate; every later window in the term is booked at it, no re-auction. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runAuction } from '../../src/exchange/auction'
import { lineItems, runBilling } from '../../src/exchange/billing'
import { png } from '../media'
import { ASSUMED_VIEWS, DT, day, harness } from './harness'

afterEach(() => {
  vi.unstubAllGlobals()
})

const LOCKED = 150
async function termHarness(before?: (h: Awaited<ReturnType<typeof harness>>) => Promise<unknown>) {
  const h = await harness()
  await before?.(h)
  const list = h.ctx.buyersLists.insert({
    id: 'bl_term', name: 'E2E term deal', description: 'Run 4 fixture', invitedBuyers: [{ identifierType: 'brandEntity', value: 'Swisse' }],
    activeFrom: null, activeTo: '2026-09-27T23:59:59.000Z', auctionCloses: day(1).toISOString(),
  })
  h.admin.slot({ listMode: 'deal', buyersListId: list.id, partnerIds: [], billingUnitHours: 24 })
  /* No DSP demand: the term is decided by the API bid alone. */
  await h.bidder.control({ mode: 'no_bid' })
  const campaignId = await h.readyApiCampaign('Swisse — term')
  expect((await h.partner.bid(campaignId, day(1), LOCKED)).statusCode).toBe(201)
  const first = await runAuction(h.ctx, day(1))
  expect(first.positions[0].winner).toMatchObject({ clearingCpm: LOCKED })
  return { ...h, list, campaignId }
}
const booked = (h: Awaited<ReturnType<typeof harness>>, w: Date) => h.campaigns.handoffs.filter((b) => b.windowStart === w.toISOString())
const soldTo = (h: Awaited<ReturnType<typeof harness>>, w: Date) => h.rows(w).filter((r) => r.status === 'won' && !r.testMode)

describe('Run 4 — two-period: happy', () => {
  it('T1 — the first clear locks the CPM; each later window is booked at the locked rate with no re-auction', async () => {
    const h = await termHarness()
    expect(h.ctx.buyersLists.get(h.list.id)!.lockedWin).toMatchObject({ cpm: LOCKED, partnerId: 'p_google', advertiserId: 'swisse', campaignId: h.campaignId, channel: 'api' })
    const before = h.bidder.log.bidRequests.length
    for (const w of [day(2), day(3), day(4)]) {
      const out = await runAuction(h.ctx, w)
      expect(out.positions[0]).toMatchObject({ bidRequests: 0, bids: 0, winner: { clearingCpm: LOCKED, advertiserId: 'swisse' } })
      expect(soldTo(h, w)).toMatchObject([{ campaignId: h.campaignId, clearingCpm: LOCKED }])
      expect(booked(h, w)).toMatchObject([{ campaignId: h.campaignId, displayTypeId: DT, slot: 1 }])
    }
    expect(h.bidder.log.bidRequests.length).toBe(before)
  })

  it('T2 — each window is billed on its own realised VAC-d at the locked CPM', async () => {
    const h = await termHarness()
    await runAuction(h.ctx, day(2))
    await runAuction(h.ctx, day(3))
    const expected = 2 * 86_400
    h.playback.script(h.campaignId, day(1), { plays: 5760, playedSec: expected })
    h.playback.script(h.campaignId, day(2), { plays: 2880, playedSec: expected / 2 })
    h.playback.script(h.campaignId, day(3), { plays: 1440, playedSec: expected / 4 })
    h.setNow(new Date('2026-09-25T00:01:00.000Z'))
    const items = runBilling(h.ctx).sort((a, b) => a.windowStart.localeCompare(b.windowStart))
    expect(items.map((i) => [i.windowStart, i.cpm, i.realisedViews, i.amount])).toEqual([
      [day(1).toISOString(), LOCKED, ASSUMED_VIEWS, 120],
      [day(2).toISOString(), LOCKED, ASSUMED_VIEWS / 2, 60],
      [day(3).toISOString(), LOCKED, ASSUMED_VIEWS / 4, 30],
    ])
  })
})

describe('Run 4 — two-period: non-happy', () => {
  /* Known failure — backlog gtArpP6mPfAtecpaX1oX (E2E v2 run, 29 Sep 2026). When
     fixed this starts failing: change it.fails back to it. */
  it.fails('T3 — a higher bid in a later window of the term doesn’t displace the locked winner (and is told why)', async () => {
    const h = await termHarness((x) => x.approvedCrid('crid-t3', day(0)))
    /* A 500 CPM DSP bid and a 500 CPM API bid for day(2). */
    await h.bidder.control({ mode: 'bid', priceCpm: 500, advertiserId: '5130002', crid: 'crid-t3' })
    const rival = await h.readyApiCampaign('Swisse — T3 rival')
    const placed = await h.partner.bid(rival, day(2), 500)
    const out = await runAuction(h.ctx, day(2))
    expect(out.positions[0].winner).toMatchObject({ clearingCpm: LOCKED })
    expect(soldTo(h, day(2))).toMatchObject([{ campaignId: h.campaignId, clearingCpm: LOCKED }])
    if (placed.statusCode === 201) {
      const r = h.ctx.reservations.get(placed.json().reservationId)!
      expect(r.status, 'the higher bid was left pending on a window the locked term booked').not.toBe('pending')
      expect(r.reason).toBeTruthy()
    }
  })

  it('T4 — the locked winner’s campaign back in Awaiting approval mid-term: that window is not handed off, the default plays, nothing billed', async () => {
    const h = await termHarness()
    await runAuction(h.ctx, day(2))
    /* A new creative returns it to Awaiting approval (G2). */
    expect((await h.partner.upload(h.campaignId, 'default', png(1920, 1080, 7))).statusCode).toBe(201)
    expect((await h.partner.status(h.campaignId)).json().status).toBe('awaiting_approval')
    await runAuction(h.ctx, day(3))
    expect(booked(h, day(3))).toEqual([])
    const r = h.rows(day(3))[0]
    expect(r?.handedOffAt ?? null).toBeNull()
    h.playback.script(h.campaignId, day(3), { plays: 5760, playedSec: 172_800 })
    h.setNow(new Date('2026-09-25T00:01:00.000Z'))
    runBilling(h.ctx)
    expect(lineItems(h.ctx).find((i) => i.windowStart === day(3).toISOString())).toBeUndefined()
    /* Earlier windows of the term are unaffected. */
    expect(lineItems(h.ctx).map((i) => i.windowStart).sort()).toEqual([day(1).toISOString(), day(2).toISOString()])
  })

  it('T5 — a window with zero plays is not billed; the term continues', async () => {
    const h = await termHarness()
    await runAuction(h.ctx, day(2))
    h.playback.script(h.campaignId, day(1), { plays: 0, playedSec: 0 })
    h.setNow(new Date('2026-09-23T00:01:00.000Z'))
    const items = runBilling(h.ctx)
    expect(items.find((i) => i.windowStart === day(1).toISOString())).toMatchObject({ plays: 0, realisedViews: 0, amount: 0 })
    /* The next window of the term still books at the locked rate. */
    expect((await runAuction(h.ctx, day(3))).positions[0].winner).toMatchObject({ clearingCpm: LOCKED })
    expect(booked(h, day(3))).toHaveLength(1)
  })

  /* Known failure — backlog b4cgAc7rRMAyBKTpB2Te (E2E v2 run, 29 Sep 2026). When
     fixed this starts failing: change it.fails back to it. */
  it.fails('T6 — the locked DSP disconnected mid-term (failed re-test): the remaining windows are refused', async () => {
    const h = await termHarness()
    await runAuction(h.ctx, day(2))
    await h.bidder.auth({ accept: false })
    expect((await h.admin.connect()).json().status).toBe('error')
    const out = await runAuction(h.ctx, day(3))
    expect(out.positions[0].winner, 'a locked-term window was booked for a DSP that is not connected').toBeNull()
    expect(booked(h, day(3))).toEqual([])
  })

  /* Known failure — backlog b4cgAc7rRMAyBKTpB2Te (E2E v2 run, 29 Sep 2026). When
     fixed this starts failing: change it.fails back to it. */
  it.fails('T6 — the locked DSP disconnected mid-term (retailer disconnect): the remaining windows are refused', async () => {
    const h = await termHarness()
    await runAuction(h.ctx, day(2))
    expect((await h.admin.disconnect()).statusCode).toBe(200)
    const out = await runAuction(h.ctx, day(3))
    expect(out.positions[0].winner, 'a locked-term window was booked for a DSP that is not connected').toBeNull()
    expect(booked(h, day(3))).toEqual([])
  })

  it('T7 — changing billingUnitHours changes nothing in billing (informational in this build)', async () => {
    const h = await termHarness()
    await runAuction(h.ctx, day(2))
    h.playback.script(h.campaignId, day(1), { plays: 2880, playedSec: 86_400 })
    h.playback.script(h.campaignId, day(2), { plays: 2880, playedSec: 86_400 })
    h.setNow(new Date('2026-09-23T00:01:00.000Z'))
    const a = runBilling(h.ctx)
    h.admin.slot({ billingUnitHours: 168 })
    h.setNow(new Date('2026-09-24T00:01:00.000Z'))
    const b = runBilling(h.ctx)
    const shape = (i: (typeof a)[number]) => ({ cpm: i.cpm, span: Date.parse(i.windowEnd) - Date.parse(i.windowStart), expectedSec: i.expectedSec, realisedViews: i.realisedViews, amount: i.amount })
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
    expect(shape(b[0])).toEqual(shape(a[0]))
    expect(shape(b[0]).span).toBe(24 * 3_600_000)
  })
})
