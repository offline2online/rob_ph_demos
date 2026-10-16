import { describe, expect, it } from 'vitest'
import { EXTERNAL_QUIET_SHARE, HOURS_PER_WEEK, INTERNAL_QUIET_SHARE, flatProfile, hourOfWeek, shapedProfile, vacdInDay, vacdInWindow } from '../src/domain/vacdProfile'
import { buildApp } from '../src/http/app'
import { buildBidRequest } from '../src/exchange/openrtb'
import { allPositions, positionView, windowHoursFor } from '../src/domain/positions'
import { testContext } from './helpers'

const MON = Date.parse('2026-10-12T00:00:00Z')
const HOUR = 3_600_000
const sum = (a: number[]) => a.reduce((n, x) => n + x, 0)

describe('hour-of-week VAC-d profile', () => {
  it('indexes Monday 00:00 UTC as hour 0', () => {
    expect(hourOfWeek(MON)).toBe(0)
    expect(hourOfWeek(MON + 25 * HOUR)).toBe(25)
    expect(hourOfWeek(MON + 168 * HOUR)).toBe(0)
  })
  it('a window is the sum of its hours, a day the sum of 24', () => {
    const p = Array.from({ length: HOURS_PER_WEEK }, (_, i) => i)
    expect(vacdInWindow(p, MON + 2 * HOUR, MON + 5 * HOUR)).toBe(2 + 3 + 4)
    expect(vacdInDay(p, MON)).toBe(sum(p.slice(0, 24)))
    expect(vacdInWindow(p, MON + 0.5 * HOUR, MON + 1.5 * HOUR)).toBe(0.5 * 0 + 0.5 * 1)
  })
  it('a shaped profile keeps the weekly total; after hours is lower but never zero, higher outdoors', () => {
    const inside = shapedProfile(240, { open: 9, close: 17 }, INTERNAL_QUIET_SHARE)
    const outside = shapedProfile(240, { open: 9, close: 17 }, EXTERNAL_QUIET_SHARE)
    expect(sum(inside)).toBeCloseTo(sum(flatProfile(240)))
    expect(inside[3]).toBeLessThan(inside[12])
    expect(inside[3]).toBeGreaterThan(0)
    expect(outside[3] / outside[12]).toBeGreaterThan(inside[3] / inside[12])
  })
})

const slot = { label: 'Ad 1', owner: 'advertiser', partnerIds: [], advertisers: [], listMode: 'rtb', buyersListId: null, storeScope: null, quota: null, zoneId: null }

describe('bid request impression multiplier by hour of week', () => {
  it('differs by window for a display with a profile; window VAC-d is the sum of its hours', async () => {
    const ctx = await testContext({ clock: () => new Date(MON) })
    const app = buildApp(ctx)
    await ctx.displayTypes.create({
      id: 'dt_h', name: 'Hourly', touchPoint: 'Digital Signage', description: null, displayCanvasSize: { width: 1080, height: 1920 }, backgroundColor: '#000000',
      defaultPlaylistId: 'pl_portrait', playlistSettings: { maximumCampaignsPlayedInRotation: 1 }, qrControl: {}, enabledFeatures: {}, multiZone: { enabled: false, zones: [] },
    } as never)
    const put = await app.inject({ method: 'PUT', url: '/api/admin/v1/display-types/dt_h/extensions', payload: { slots: [slot], venue: { openOohVenueType: 'retail.grocery', orientation: 'portrait', loopLengthSec: 40 }, defaultVacd: 240 } })
    expect(put.statusCode).toBe(200)
    ctx.db.prepare("INSERT INTO displays (id, name, store, store_id, display_type_id) VALUES ('d_h', 'Screen', 'Sydney CBD', 'st_sydney_cbd', 'dt_h')").run()
    const p = (await allPositions(ctx)).find((x) => x.displayType.id === 'dt_h')!
    const partner = (await ctx.partners.list())[0]
    const caller = { partner, advertiser: null, unknownAdvertiser: false }
    const at = async (ms: number) => (await positionView(ctx, p, caller, new Date(ms).toISOString())).assumedViewsPerWindow
    const hours = windowHoursFor(p)
    const next = MON + hours * HOUR
    const flat = (await positionView(ctx, p, caller)).assumedViewsPerWindow
    expect(await at(MON)).toBe(flat)
    expect(await at(next)).toBe(flat)

    const profile = Array.from({ length: HOURS_PER_WEEK }, (_, i) => (i < hours ? 10 : 1))
    ctx.db.prepare("UPDATE displays SET vacd_profile = ? WHERE id = 'd_h'").run(JSON.stringify(profile))
    const day = await at(MON)
    const night = await at(next)
    expect(day).not.toBe(night)
    expect(day).toBe(Math.round(vacdInWindow(profile, MON, MON + hours * HOUR)))
    const req = await buildBidRequest(ctx, p, partner, 'r1', await positionView(ctx, p, caller, new Date(next).toISOString()))
    expect(req.imp[0].qty?.multiplier).toBe(night)
  })
})
