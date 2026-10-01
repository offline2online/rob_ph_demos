import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/http/app'
import { testContext } from './helpers'

const NOW = new Date('2026-09-20T00:00:00Z')
const slot = (label: string, owner: string) => ({ label, owner, partnerIds: [], advertisers: [], listMode: 'rtb', buyersListId: null, storeScope: null, quota: null, zoneId: null, supportedTargeting: ['localised'] })

async function setup() {
  const ctx = await testContext({ clock: () => NOW })
  const app = buildApp(ctx)
  ctx.displayTypes.create({
    id: 'dt_v', name: 'Menu Board long', touchPoint: 'Digital Signage', description: null, displayCanvasSize: { width: 1080, height: 1920 }, backgroundColor: '#000000',
    defaultPlaylistId: 'pl_portrait', playlistSettings: { maximumCampaignsPlayedInRotation: 1 }, qrControl: {}, enabledFeatures: {}, multiZone: { enabled: false, zones: [] },
  } as never)
  const put = (defaultVacd?: number | null) => app.inject({ method: 'PUT', url: '/api/admin/v1/display-types/dt_v/extensions', payload: { slots: [slot('Ad 1', 'advertiser')], venue: { openOohVenueType: 'retail.grocery', orientation: 'portrait', loopLengthSec: 40 }, ...(defaultVacd === undefined ? {} : { defaultVacd }) } })
  const ins = ctx.db.prepare("INSERT INTO displays (id, name, store, store_id, display_type_id) VALUES (?, 'Screen', 'Sydney CBD', 'st_sydney_cbd', 'dt_v')")
  ins.run('d_v_1'); ins.run('d_v_2')
  const views = () => ctx.audience.forSlot('dt_v', 1)
  return { ctx, put, views }
}

describe('default VAC-d per display type', () => {
  it('scores a slot from the type default, summed over its displays', async () => {
    const { put, views } = await setup()
    expect((await put()).statusCode).toBe(200)
    expect(views()).toMatchObject({ scored: false, assumedViewsPerWindow: 0 })
    expect((await put(300)).statusCode).toBe(200)
    expect(views()).toMatchObject({ scored: true, assumedViewsPerWindow: 600 })
  })

  it('keeps an overridden display and updates the rest when the default changes', async () => {
    const { ctx, put, views } = await setup()
    await put(300)
    ctx.db.prepare("UPDATE displays SET vacd_override = 1000 WHERE id = 'd_v_1'").run()
    expect(views().assumedViewsPerWindow).toBe(1300)
    await put(500)
    expect(views().assumedViewsPerWindow).toBe(1500)
  })

  it('keeps the saved default when a save omits it, and clears it on null', async () => {
    const { put, views } = await setup()
    await put(300)
    await put()
    expect(views().scored).toBe(true)
    await put(null)
    expect(views().scored).toBe(false)
  })

  it('rejects a bad default', async () => {
    const { put } = await setup()
    expect((await put(-5)).statusCode).toBe(400)
    expect((await put(1.5)).statusCode).toBe(400)
  })

  it('an explicit slot score still wins', async () => {
    const { ctx, put, views } = await setup()
    await put(300)
    ctx.db.prepare('INSERT INTO audience_vacd (display_type_id, slot, assumed_views_per_window, counted) VALUES (?, ?, ?, 1)').run('dt_v', 1, 77)
    expect(views()).toMatchObject({ assumedViewsPerWindow: 77, counted: true })
  })
})
