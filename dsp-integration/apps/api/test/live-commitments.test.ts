/* Q47 (decision, Rob, 29 Sep 2026): deleting a display type, or changing a
   playlist assigned to it, is refused with has_dependents while any of its
   positions is reserved or sold for a current or future window. */
import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/http/app'
import { expectMatchesContract } from './contract'
import { NOW, testContext } from './helpers'

const book = (ctx: Awaited<ReturnType<typeof testContext>>, windowStart: string, extra: Record<string, unknown> = {}) =>
  ctx.reservations.insert({
    id: `r_${windowStart}`, partnerId: 'p_google', advertiserId: 'nestle', campaignId: 'c_dsp_nestle', positionId: 'portrait.s1', windowStart,
    type: 'reserve', channel: 'api', bidCpm: null, currency: 'AUD', status: 'reserved', clearingCpm: 120, reason: null, testMode: false, pricingType: 'localised', handedOffAt: null,
    ...extra,
  })

async function setup() {
  const ctx = await testContext({ clock: () => NOW })
  ctx.db.prepare("DELETE FROM displays WHERE display_type_id = 'portrait'").run()
  const dt = ctx.displayTypes.get('portrait')!
  ctx.displayTypes.saveExtensions('portrait', { slots: [{ label: 'Ad', owner: 'advertiser', partnerIds: [], advertisers: [], listMode: 'rtb', buyersListId: null, storeScope: null, quota: null, zoneId: null }] } as never)
  return { ctx, app: buildApp(ctx), dt }
}

describe('Q47 hard blocks while inventory is reserved or sold', () => {
  it('refuses deleting a display type with a future reservation, and allows it once the window has played', async () => {
    const { ctx, app } = await setup()
    book(ctx, '2026-09-22T00:00:00.000Z')
    const del = await app.inject({ method: 'DELETE', url: '/api/admin/v1/display-types/portrait' })
    expect(del.statusCode).toBe(409)
    expect(del.json().error.code).toBe('has_dependents')
    expect(del.json().error.details[0].reason).toBe('portrait.s1 · window 2026-09-22 · reserved')
    /* The dialog's own check says so first, and disables Delete. */
    const check = await app.inject({ method: 'GET', url: '/api/admin/v1/display-types/portrait/delete-check' })
    expectMatchesContract('GET', '/admin/v1/display-types/{displayTypeId}/delete-check', 200, check.json())
    expect(check.json()).toEqual({ canDelete: false, dependents: [{ kind: 'reservation', name: 'portrait.s1', detail: 'window 2026-09-22 · reserved' }] })

    ctx.db.prepare("UPDATE reservations SET window_start = '2026-09-10T00:00:00.000Z'").run()
    expect((await app.inject({ method: 'DELETE', url: '/api/admin/v1/display-types/portrait' })).statusCode).toBe(204)
  })

  it('counts the current, still-playing window, and ignores Test mode bookings', async () => {
    const { ctx, app } = await setup()
    book(ctx, '2026-09-20T00:00:00.000Z', { status: 'won' })
    expect((await app.inject({ method: 'DELETE', url: '/api/admin/v1/display-types/portrait' })).json().error.details[0].reason).toContain('sold')
    ctx.db.prepare('UPDATE reservations SET test_mode = 1').run()
    expect((await app.inject({ method: 'DELETE', url: '/api/admin/v1/display-types/portrait' })).statusCode).toBe(204)
  })

  it('refuses changing the assigned playlist, or that playlist\'s settings, until nothing live depends on it', async () => {
    const { ctx, app, dt } = await setup()
    ctx.playlists.create({ id: 'pl_other', name: 'Other', playlistSettings: {} } as never)
    book(ctx, '2026-09-22T00:00:00.000Z')
    const reassign = () => app.inject({ method: 'PUT', url: '/api/admin/v1/display-types/portrait/record', payload: { ...ctx.displayTypes.get('portrait'), phExtensions: undefined, defaultPlaylistId: 'pl_other' } })
    const r = await reassign()
    expect(r.statusCode).toBe(409)
    expect(r.json().error.code).toBe('has_dependents')
    expectMatchesContract('PUT', '/admin/v1/display-types/{displayTypeId}/record', 409, r.json())
    const settings = await app.inject({ method: 'PUT', url: `/api/admin/v1/playlists/${dt.defaultPlaylistId}/settings`, payload: {} })
    expect(settings.statusCode).toBe(409)
    expect(settings.json().error.code).toBe('has_dependents')
    expectMatchesContract('PUT', '/admin/v1/playlists/{playlistId}/settings', 409, settings.json())
    /* An unrelated edit that leaves the playlist alone still saves. */
    const rename = await app.inject({ method: 'PUT', url: '/api/admin/v1/display-types/portrait/record', payload: { ...ctx.displayTypes.get('portrait'), phExtensions: undefined, name: 'Portrait 2' } })
    expect(rename.statusCode).toBe(200)

    ctx.db.prepare('DELETE FROM reservations').run()
    expect((await reassign()).statusCode).toBe(200)
  })
})
