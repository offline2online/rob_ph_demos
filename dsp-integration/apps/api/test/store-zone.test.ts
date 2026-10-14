import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/http/app'
import { testContext } from './helpers'

const slot = { label: 'Ad 1', owner: 'advertiser', partnerIds: [], advertisers: [], listMode: 'rtb', buyersListId: null, storeScope: null, quota: null, zoneId: null }

async function setup() {
  const ctx = await testContext({ clock: () => new Date('2026-10-14T00:00:00Z') })
  const app = buildApp(ctx)
  await ctx.displayTypes.create({
    id: 'dt_z', name: 'Menu Board', touchPoint: 'Digital Signage', description: null, displayCanvasSize: { width: 1080, height: 1920 }, backgroundColor: '#000000',
    defaultPlaylistId: 'pl_portrait', playlistSettings: { maximumCampaignsPlayedInRotation: 1 }, qrControl: {}, enabledFeatures: {}, multiZone: { enabled: false, zones: [] },
  } as never)
  const put = (storeZone?: unknown) => app.inject({ method: 'PUT', url: '/api/admin/v1/display-types/dt_z/extensions', payload: { slots: [slot], ...(storeZone === undefined ? {} : { storeZone }) } })
  const saved = async () => (await ctx.displayTypes.get('dt_z'))!.phExtensions?.storeZone
  return { put, saved }
}

describe('store zone on a display type', () => {
  it('is not defined by default, saves, survives an omitting save, and clears on null', async () => {
    const { put, saved } = await setup()
    expect((await put()).statusCode).toBe(200)
    expect(await saved()).toBeUndefined()
    expect((await put('checkout')).statusCode).toBe(200)
    expect(await saved()).toBe('checkout')
    await put()
    expect(await saved()).toBe('checkout')
    await put(null)
    expect(await saved()).toBeUndefined()
  })

  it('rejects a zone outside the five IAB zones', async () => {
    const { put } = await setup()
    expect((await put('basement')).statusCode).toBe(400)
  })
})
