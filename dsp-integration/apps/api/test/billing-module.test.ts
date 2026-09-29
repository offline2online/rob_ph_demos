/* The Billing module's public seam (billing/index.ts): a cleared reservation
   plus playback totals in, one idempotent line item out; the engagement gap
   declared; the billing unit as the window length (OQ27). Behaviour is the
   same as before the extraction — the E2E runs prove that — these pin the
   seam itself. */
import { describe, expect, it } from 'vitest'
import { NotImplementedError, billReservation, billingUnitMs, computeLineItem, lineItems, termStateAt } from '../src/billing'
import { findPosition, windowMs } from '../src/domain/positions'
import type { ReservationRecord } from '../src/repos/ReservationRepo'
import { NOW, testContext } from './helpers'

const won: ReservationRecord = {
  id: 'res_seam_1', partnerId: 'p_google', advertiserId: 'nestle', campaignId: 'c_dsp_nestle', positionId: 'menu_board.s2',
  windowStart: '2026-09-14T00:00:00.000Z', type: 'bid', channel: 'api', bidCpm: 100, currency: 'AUD', status: 'won', clearingCpm: 100, reason: null,
  testMode: false, pricingType: 'localised', handedOffAt: null,
}

describe('billing seam', () => {
  it('bills a reservation once: a second call for the same reservation writes nothing', async () => {
    const ctx = await testContext({ clock: () => NOW })
    const p = findPosition(ctx, won.positionId)!
    ctx.reservations.insert(won)
    const first = billReservation(ctx, won, p, { plays: 3, playedSec: 30 })
    expect(first).toMatchObject({ reservationId: 'res_seam_1', plays: 3, cpm: 100 })
    expect(billReservation(ctx, won, p, { plays: 9, playedSec: 90 })).toBeNull()
    expect(lineItems(ctx).filter((i) => i.reservationId === 'res_seam_1')).toHaveLength(1)
  })

  it('computes the line item without writing it', async () => {
    const ctx = await testContext({ clock: () => NOW })
    const p = findPosition(ctx, won.positionId)!
    const before = lineItems(ctx).length
    const item = computeLineItem(ctx, won, p, { plays: 0, playedSec: 0 })
    expect(item.amount).toBe(0)
    expect(lineItems(ctx)).toHaveLength(before)
  })

  it('declares engagement billing and refuses it rather than billing on plays', async () => {
    const ctx = await testContext({ clock: () => NOW })
    const p = findPosition(ctx, won.positionId)!
    expect(() => computeLineItem(ctx, won, p, { plays: 1, playedSec: 1 }, 'engagement')).toThrow(NotImplementedError)
  })

  it('uses the slot’s billing unit as the window length', async () => {
    const ctx = await testContext({ clock: () => NOW })
    const p = findPosition(ctx, won.positionId)!
    expect(billingUnitMs(ctx, p)).toBe(windowMs(ctx, p))
  })

  it('answers the term questions for one window at once', () => {
    const list = { activeFrom: '2026-09-01T00:00:00.000Z', activeTo: '2026-09-30T00:00:00.000Z', auctionCloses: '2026-09-10T00:00:00.000Z', lockedWin: null } as never
    expect(termStateAt(list, '2026-09-05T00:00:00.000Z')).toEqual({ active: true, locked: false, auctionOpen: true })
    expect(termStateAt(list, '2026-09-15T00:00:00.000Z')).toEqual({ active: true, locked: false, auctionOpen: false })
    expect(termStateAt(list, '2026-10-05T00:00:00.000Z').active).toBe(false)
  })
})
