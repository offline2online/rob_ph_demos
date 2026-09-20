import { describe, expect, it } from 'vitest'
import type { DisplayType } from '@ph-dsp/types'
import { buildApp } from '../src/http/app'
import { expectMatchesContract } from './contract'
import { testContext } from './helpers'

const setup = async (opts: Parameters<typeof testContext>[0] = {}) => {
  const ctx = await testContext(opts)
  return { ctx, app: buildApp(ctx) }
}
const newType = (over: Partial<DisplayType> = {}): DisplayType => ({
  id: 'dt_new', name: 'Checkout Kiosk', touchPoint: 'Kiosk', description: null, displayCanvasSize: { width: 1080, height: 1920 }, backgroundColor: '#333333',
  defaultPlaylistId: 'pl_dt_new', playlistSettings: { maximumCampaignsPlayedInRotation: -1 }, qrControl: {}, enabledFeatures: {}, multiZone: { enabled: false, zones: [] }, ...over,
})

describe('display types — POC stand-in endpoints', () => {
  it('GET /admin/v1/display-types lists existing fields plus phExtensions, per the contract', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'GET', url: '/api/admin/v1/display-types' })
    expect(res.statusCode).toBe(200)
    expectMatchesContract('GET', '/admin/v1/display-types', 200, res.json())
    expect(res.json().items.map((d: DisplayType) => d.id)).toEqual(['landscape', 'portrait', 'menu_board'])
  })

  it('POST creates the display type and its auto-created playlist', async () => {
    const { app, ctx } = await setup()
    const res = await app.inject({ method: 'POST', url: '/api/admin/v1/display-types', payload: newType() })
    expect(res.statusCode).toBe(201)
    expectMatchesContract('POST', '/admin/v1/display-types', 201, res.json())
    expect(ctx.playlists.get('pl_dt_new')).toMatchObject({ name: 'New Display Type Playlist', autoCreatedFor: 'dt_new' })
  })

  it('POST rejects web touch points (decision 1) and a missing name', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'POST', url: '/api/admin/v1/display-types', payload: newType({ touchPoint: 'Responsive Web', name: ' ' }) })
    expect(res.statusCode).toBe(400)
    expectMatchesContract('POST', '/admin/v1/display-types', 400, res.json())
    expect(res.json().error.details.map((d: { field: string }) => d.field)).toEqual(['name', 'touchPoint'])
  })

  it('PUT …/record saves existing fields, never phExtensions, and creates zone playlists on demand', async () => {
    const { app, ctx } = await setup()
    const landscape = ctx.displayTypes.get('landscape') as DisplayType
    const payload = {
      ...landscape, name: 'Landscape HD', phExtensions: { slots: [{ label: 'x', owner: 'internal' as const }] },
      multiZone: { enabled: true, zones: [{ id: 'z1', name: 'Zone 1', x: 0, y: 0, width: 50, height: 100, playlistId: 'pl_zone_landscape_1' }] },
    }
    const res = await app.inject({ method: 'PUT', url: '/api/admin/v1/display-types/landscape/record', payload })
    expect(res.statusCode).toBe(200)
    expectMatchesContract('PUT', '/admin/v1/display-types/{displayTypeId}/record', 200, res.json())
    expect(res.json().name).toBe('Landscape HD')
    expect(res.json().phExtensions).toEqual(landscape.phExtensions)
    expect(ctx.playlists.get('pl_zone_landscape_1')).toMatchObject({ name: 'Landscape HD / Zone 1', autoCreatedFor: 'landscape' })
  })

  it('GET …/record 404s for an unknown id, with the error shape', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'GET', url: '/api/admin/v1/display-types/nope/record' })
    expect(res.statusCode).toBe(404)
    expectMatchesContract('GET', '/admin/v1/display-types/{displayTypeId}/record', 404, res.json())
  })

  it('GET /admin/v1/playlists includes default and zone assignments', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'GET', url: '/api/admin/v1/playlists' })
    expectMatchesContract('GET', '/admin/v1/playlists', 200, res.json())
    const zone2 = res.json().items.find((p: { id: string }) => p.id === 'pl_zone_menu_board_2')
    expect(zone2.assignments).toEqual([{ displayTypeId: 'menu_board', displayTypeName: 'Menu Board — Long Format', zoneId: 'z2', zoneName: 'Zone 2' }])
    expect(res.json().items.find((p: { id: string }) => p.id === 'pl_seasonal').assignments).toEqual([])
  })
})

/* The slot editor sets the label and the owner only (Rob, 20 Sep): who a
   position is assigned to moved to Advertisers / Inventory, which is also
   where it is validated (advertiser-settings.test.ts). */
describe('PUT /admin/v1/display-types/{id}/extensions — slot ownership', () => {
  const put = (app: ReturnType<typeof buildApp>, id: string, payload: unknown) =>
    app.inject({ method: 'PUT', url: `/api/admin/v1/display-types/${id}/extensions`, payload: payload as object })
  const menuSlots = (second: Record<string, unknown> = {}) => ({
    slots: [
      { label: 'Priority 1', owner: 'internal' },
      { label: 'Supplier slot', owner: 'advertiser', ...second },
      { label: 'Store choice', owner: 'retail' },
    ],
  })

  it('returns 404 with the flag off', async () => {
    const { app } = await setup({ flag: false })
    expect((await put(app, 'menu_board', menuSlots())).statusCode).toBe(404)
  })

  it('saves labels and owners, keeping the existing venue', async () => {
    const { app, ctx } = await setup()
    const res = await put(app, 'menu_board', menuSlots({ label: 'Brand slot' }))
    expect(res.statusCode).toBe(200)
    expectMatchesContract('PUT', '/admin/v1/display-types/{displayTypeId}/extensions', 200, res.json())
    expect(res.json().slots.map((s: { label: string; owner: string }) => [s.owner, s.label]))
      .toEqual([['internal', 'Priority 1'], ['advertiser', 'Brand slot'], ['retail', 'Store choice']])
    expect(ctx.displayTypes.get('menu_board')?.phExtensions?.venue).toMatchObject({ orientation: 'landscape' })
  })

  it('keeps what Advertisers / Inventory set while the slot stays sellable, and drops it when it doesn’t', async () => {
    const { app, ctx } = await setup()
    await app.inject({ method: 'PUT', url: '/api/admin/v1/available-inventory', payload: { items: [{ displayTypeId: 'menu_board', slot: 2, supportedTargeting: ['localised', 'personalised'], assignedTo: { partnerIds: [], advertisers: ['Nestlé'], whitelistOnly: false } }] } })
    const kept = await put(app, 'menu_board', menuSlots({ label: 'Brand slot' }))
    expect(kept.json().slots[1]).toMatchObject({ advertisers: ['Nestlé'], partnerIds: ['p_google'], supportedTargeting: ['localised', 'personalised'] })
    /* Owner changed: it is no longer sellable inventory, so the assignment goes. */
    const dropped = await put(app, 'menu_board', { slots: [{ label: 'Priority 1', owner: 'internal' }, { label: 'Brand slot', owner: 'internal' }, { label: 'Store choice', owner: 'retail' }] })
    expect(dropped.json().slots[1]).toMatchObject({ advertisers: [], partnerIds: [], listMode: null })
    expect(ctx.displayTypes.get('menu_board')?.phExtensions?.slots[1].supportedTargeting).toBeUndefined()
  })

  it('ignores an assignment sent with the slots, and gives a Stores slot the default scope', async () => {
    const { app } = await setup()
    const res = await put(app, 'menu_board', menuSlots({ partnerIds: ['p_amazon'], advertisers: ['Swisse'] }))
    expect(res.statusCode).toBe(200)
    expect(res.json().slots[1]).toMatchObject({ partnerIds: ['p_google'], advertisers: [] })
    expect(res.json().slots[2]).toMatchObject({ storeScope: 'Store staff' })
  })

  it('requires one slot per rotation position, and a label on each', async () => {
    const { app } = await setup()
    const res = await put(app, 'menu_board', { slots: [{ label: 'Only one', owner: 'internal' }] })
    expect(res.statusCode).toBe(400)
    expectMatchesContract('PUT', '/admin/v1/display-types/{displayTypeId}/extensions', 400, res.json())
    expect(res.json().error.details[0]).toMatchObject({ field: 'slots' })
    expect((await put(app, 'landscape', { slots: [] })).statusCode).toBe(200)
    const blank = await put(app, 'menu_board', menuSlots({ label: '  ' }))
    expect(blank.json().error.details.map((d: { field: string }) => d.field)).toEqual(['slots[1].label'])
  })
})

describe('read side used by the slot picker (flag-gated)', () => {
  it('GET /admin/v1/partners never returns a secret value', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'GET', url: '/api/admin/v1/partners' })
    expect(res.statusCode).toBe(200)
    expectMatchesContract('GET', '/admin/v1/partners', 200, res.json())
    expect(res.body).not.toMatch(/placeholder|Atzr|private_key/)
    const [google, amazon] = res.json().items
    expect(google.credentials).toEqual({ partnerId: '884512', serviceAccountEmail: 'ph-retail-media@ph-demo.iam.gserviceaccount.com', privateKeyJson: { set: true } })
    expect(google).not.toHaveProperty('advertiserBlacklist')
    expect(google.seats).toEqual([{ id: '5130001', name: 'Nestlé' }, { id: '5130002', name: 'Swisse' }])
    expect(amazon.advertiserBlacklist).toEqual(['Red Bull', 'Chemist Warehouse'])
    expect(amazon.issues.map((i: { kind: string }) => i.kind)).toEqual(['connection_error', 'missing_bidder_fields'])
    expect(amazon.issues[0].message).toBe('Refresh token rejected — 3 days ago')
  })

  it('GET /admin/v1/advertiser-settings', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'GET', url: '/api/admin/v1/advertiser-settings' })
    expectMatchesContract('GET', '/admin/v1/advertiser-settings', 200, res.json())
    expect(res.json().whereTheseApply).toEqual([{ partnerId: 'p_google', name: 'Google DSP', adopting: true }, { partnerId: 'p_amazon', name: 'Amazon Ads DSP', adopting: false }])
  })

  it('GET /admin/v1/advertisers: admin only, with effective floors', async () => {
    const res = await (await setup()).app.inject({ method: 'GET', url: '/api/admin/v1/advertisers' })
    expectMatchesContract('GET', '/admin/v1/advertisers', 200, res.json())
    expect(res.json().items.map((a: { advertiserId: string; via: string[]; effectiveFloorCpm: number }) => [a.advertiserId, a.via, a.effectiveFloorCpm])).toEqual([
      ['loreal', ['Amazon Ads DSP'], 120], ['nestle', ['Google DSP'], 80], ['swisse', ['Google DSP'], 100],
    ])
    const forbidden = await (await setup({ role: 'hq_helpdesk' })).app.inject({ method: 'GET', url: '/api/admin/v1/advertisers' })
    expect(forbidden.statusCode).toBe(403)
    expectMatchesContract('GET', '/admin/v1/advertisers', 403, forbidden.json())
  })

  it.each(['/partners', '/advertiser-settings', '/advertisers'])('%s returns 404 with the flag off', async (path) => {
    const res = await (await setup({ flag: false })).app.inject({ method: 'GET', url: `/api/admin/v1${path}` })
    expect(res.statusCode).toBe(404)
  })
})
