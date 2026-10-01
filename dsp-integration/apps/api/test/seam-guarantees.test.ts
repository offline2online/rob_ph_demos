/* Guarantees PH-CORE-BOUNDARIES.md "What each seam must guarantee" makes and
   nothing else asserted (Scope & Seam Reconciliation Review, 1 Oct 2026,
   finding #23). */
import { describe, expect, it } from 'vitest'
import { isUniqueViolation } from '../src/db/db'
import { runAuction } from '../src/exchange/auction'
import { buildApp } from '../src/http/app'
import { POC_SHARE_PER_AND_GROUP } from '../src/platform/AudienceSource'
import { NOW, mockDsps, testContext } from './helpers'

const cond = (variable: string, op: string, values: string[]) => ({ source: variable.split('.')[0], variable, op, values })
const GOOGLE = { authorization: 'Bearer poc-token-google-dv360' }

describe('one campaign per display type, slot and play window', () => {
  const W = '2026-09-25T00:00:00.000Z'
  const booking = (id: string) => ({ id, campaignId: 'c_dsp_nestle', displayTypeId: 'menu_board', slot: 2, windowStart: W, windowEnd: '2026-09-26T00:00:00.000Z' })

  it('the stand-in campaign source refuses a second booking for the same slot and window', async () => {
    const ctx = await testContext({ clock: () => NOW })
    ctx.campaigns.bookSlot(booking('bk_first'))
    let error: unknown
    try { ctx.campaigns.bookSlot(booking('bk_second')) } catch (e) { error = e }
    expect(error).toBeDefined()
    expect(isUniqueViolation(error)).toBe(true)
    expect(ctx.campaigns.bookings('c_dsp_nestle').filter((b) => b.windowStart === W)).toHaveLength(1)
    /* A different slot or window is not in the way. */
    expect(() => ctx.campaigns.bookSlot({ ...booking('bk_other_slot'), slot: 3 })).not.toThrow()
    expect(() => ctx.campaigns.bookSlot({ ...booking('bk_other_day'), windowStart: '2026-09-26T00:00:00.000Z', windowEnd: '2026-09-27T00:00:00.000Z' })).not.toThrow()
  })

  it('the hand-off treats that uniqueness failure as already booked, not as an error', async () => {
    const ctx = await testContext({ clock: () => NOW, dspFetch: mockDsps().fetchImpl })
    const W1 = new Date('2026-09-21T00:00:00.000Z')
    const W2 = new Date('2026-09-22T00:00:00.000Z')
    await runAuction(ctx, W1)
    const campaignId = (await ctx.approvalCampaigns.listCampaigns({ sources: ['dsp'] })).find((c) => c.name === 'Nestlé — crid-5130001')!.campaignId
    await buildApp(ctx).inject({ method: 'PUT', url: `/api/admin/v1/campaigns/${campaignId}/activation`, payload: { enabled: true } })
    /* The campaign system already holds a booking for the window the auction is about to hand off. */
    ctx.campaigns.bookSlot({ id: 'bk_already', campaignId, displayTypeId: 'menu_board', slot: 2, windowStart: W2.toISOString(), windowEnd: '2026-09-23T00:00:00.000Z' })
    const out = await runAuction(ctx, W2)
    const r = ctx.reservations.get(out.positions[0].winner!.reservationId)!
    expect(r.handedOffAt).toBeNull()
    expect(r.reason).toBe('Not handed off: the slot is already booked for that window.')
    expect(ctx.campaigns.bookings(campaignId).filter((b) => b.windowStart === W2.toISOString())).toHaveLength(1)
  })
})

describe('files are served with nosniff and a CSP that blocks script', () => {
  it('an /assets/:file response carries both, and a missing file does not leak a body', async () => {
    const app = buildApp(await testContext({ clock: () => NOW }))
    const url = (await app.inject({ method: 'GET', url: '/api/admin/v1/campaigns/c_api_swisse/approval' })).json().creative.assetUrl
    const res = await app.inject({ method: 'GET', url })
    expect(res.statusCode).toBe(200)
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['content-security-policy']).toContain("default-src 'none'")
    const missing = await app.inject({ method: 'GET', url: '/assets/nothing-here.png' })
    expect(missing.statusCode).toBe(404)
    expect(missing.headers['x-content-type-options']).toBe('nosniff')
  })
})

describe('AudienceSource.targetedShare', () => {
  it('halves per AND group: a two-group forecast is a quarter of the untargeted one', async () => {
    const ctx = await testContext({ clock: () => NOW })
    expect(POC_SHARE_PER_AND_GROUP).toBe(0.5)
    expect(ctx.audience.targetedShare('menu_board', undefined)).toBe(1)
    expect(ctx.audience.targetedShare('menu_board', [])).toBe(1)
    expect(ctx.audience.targetedShare('menu_board', [[cond('store.fixed_segments', 'include', ['Metro'])]])).toBe(0.5)
    const two = [[cond('store.fixed_segments', 'include', ['Metro'])], [cond('store.state', 'include', ['VIC'])]]
    expect(ctx.audience.targetedShare('menu_board', two as never)).toBe(0.25)
    const forecast = (rules?: unknown) => buildApp(ctx).inject({ method: 'POST', url: '/api/v1/inventory/forecast', headers: GOOGLE, payload: { positionIds: ['menu_board.s2'], from: '2026-09-21', to: '2026-09-21', ...(rules ? { rules } : {}) } })
    const all = (await forecast()).json().assumedViews as number
    const quarter = (await forecast(two)).json().assumedViews as number
    expect(quarter).toBeCloseTo(all * 0.25, 0)
  })
})

describe('indexes the seam guarantees lean on', () => {
  it('the stand-in carries the booking uniqueness and campaign lookup indexes (migrations 0020, 0021)', async () => {
    const ctx = await testContext({ clock: () => NOW })
    const names = (ctx.db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'campaign_slot_bookings'").all() as { name: string }[]).map((r) => r.name)
    expect(names).toContain('campaign_slot_bookings_one_per_window')
    expect(names).toContain('campaign_slot_bookings_campaign')
  })
  /* Not asserted here, and PH Core's to guarantee on integration: the display-type
     list index (PH-CORE-BOUNDARIES.md "listByDisplayType") and partner-token
     revocation, neither of which the POC's stand-ins model. */
})
