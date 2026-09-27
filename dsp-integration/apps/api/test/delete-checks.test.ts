import { describe, expect, it } from 'vitest'
import { soldOrReservedPositions } from '../src/domain/deleteChecks'
import { NOW, testContext } from './helpers'

describe('soldOrReservedPositions (Q47 default: never blocks, only logged)', () => {
  it('counts the distinct advertiser positions with a live won/reserved booking', async () => {
    const ctx = await testContext({ clock: () => NOW, bookings: true })
    /* The seeded bookings put every advertiser (both of Google DSP's seats)
       on the Menu Board's one advertiser position (menu_board.s2), across
       several play windows each — one position, however many windows. */
    expect(soldOrReservedPositions(ctx, 'menu_board')).toBe(1)
  })

  it('is 0 for a display type with no advertiser slots at all', async () => {
    const ctx = await testContext({ clock: () => NOW, bookings: true })
    expect(soldOrReservedPositions(ctx, 'landscape')).toBe(0)
    expect(soldOrReservedPositions(ctx, 'portrait')).toBe(0)
  })

  it('is 0 once nothing is actually booked', async () => {
    /* Base seed data always wins one window on menu_board.s2 (seedCampaigns,
       independent of the opt-in `bookings` sample data) — clear it to see
       the true "nothing booked" case. */
    const ctx = await testContext({ clock: () => NOW, bookings: false })
    ctx.db.prepare("DELETE FROM reservations WHERE position_id = 'menu_board.s2'").run()
    expect(soldOrReservedPositions(ctx, 'menu_board')).toBe(0)
  })

  it('is 0 for an unknown display type id, rather than throwing', async () => {
    const ctx = await testContext({ clock: () => NOW })
    expect(soldOrReservedPositions(ctx, 'nope')).toBe(0)
  })
})
