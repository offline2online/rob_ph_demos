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

describe('PUT /admin/v1/display-types/{id}/extensions — slot ownership', () => {
  const put = (app: ReturnType<typeof buildApp>, id: string, payload: unknown) =>
    app.inject({ method: 'PUT', url: `/api/admin/v1/display-types/${id}/extensions`, payload: payload as object })
  const menuSlots = (second: Record<string, unknown>) => ({
    slots: [
      { label: 'Priority 1', owner: 'internal' },
      { label: 'Supplier slot', owner: 'advertiser', partnerId: null, advertiser: null, listMode: 'rtb', ...second },
      { label: 'Store choice', owner: 'retail', storeScope: 'Store staff' },
    ],
  })

  it('returns 404 with the flag off', async () => {
    const { app } = await setup({ flag: false })
    expect((await put(app, 'menu_board', menuSlots({}))).statusCode).toBe(404)
  })

  it('saves a valid assignment, keeping the existing venue', async () => {
    const { app, ctx } = await setup()
    const res = await put(app, 'menu_board', menuSlots({ partnerId: 'p_google', listMode: null, advertiser: 'Nestlé' }))
    expect(res.statusCode).toBe(200)
    expectMatchesContract('PUT', '/admin/v1/display-types/{displayTypeId}/extensions', 200, res.json())
    expect(res.json().slots[1]).toMatchObject({ partnerId: 'p_google', advertiser: 'Nestlé', listMode: null })
    expect(ctx.displayTypes.get('menu_board')?.phExtensions?.venue).toMatchObject({ orientation: 'landscape' })
  })

  it('requires one slot per rotation position', async () => {
    const { app } = await setup()
    const res = await put(app, 'menu_board', { slots: [{ label: 'Only one', owner: 'internal' }] })
    expect(res.statusCode).toBe(400)
    expectMatchesContract('PUT', '/admin/v1/display-types/{displayTypeId}/extensions', 400, res.json())
    expect(res.json().error.details[0]).toMatchObject({ field: 'slots' })
    expect((await put(app, 'landscape', { slots: [] })).statusCode).toBe(200)
  })

  it.each([
    ['an advertiser that is not a seat of the partner', { partnerId: 'p_google', listMode: null, advertiser: "L'Oréal" }, 'slots[1].advertiser'],
    ['a named advertiser with no partner', { partnerId: null, listMode: null, advertiser: 'Nestlé' }, 'slots[1].partnerId'],
    ['an unknown partner', { partnerId: 'p_nope' }, 'slots[1].partnerId'],
    ['whitelist-only with no partner', { listMode: 'whitelist_only' }, 'slots[1].partnerId'],
    ['neither RTB, whitelist nor a name', { listMode: null }, 'slots[1].listMode'],
  ])('rejects %s', async (_label, second, field) => {
    const { app } = await setup()
    const res = await put(app, 'menu_board', menuSlots(second))
    expect(res.statusCode).toBe(400)
    expect(res.json().error.details.map((d: { field: string }) => d.field)).toContain(field)
  })

  it('withdraws a blocked advertiser: naming one is rejected, but one already named stays', async () => {
    const { app, ctx } = await setup()
    expect((await put(app, 'menu_board', menuSlots({ partnerId: 'p_google', listMode: null, advertiser: 'Nestlé' }))).statusCode).toBe(200)
    ctx.company.save({ ...ctx.company.get(), advertiserBlacklist: ['Nestlé'] })
    expect((await put(app, 'menu_board', menuSlots({ partnerId: 'p_google', listMode: null, advertiser: 'Nestlé' }))).statusCode).toBe(200)
    const res = await put(app, 'menu_board', menuSlots({ partnerId: 'p_google', listMode: null, advertiser: 'Swisse' }))
    expect(res.statusCode).toBe(200)
    const again = await put(app, 'menu_board', menuSlots({ partnerId: 'p_google', listMode: null, advertiser: 'Nestlé' }))
    expect(again.statusCode).toBe(400)
    expect(again.json().error.details[0].reason).toMatch(/blacklist/)
  })

  it('rejects a Stores slot with an unknown scope and a Headquarters slot with an assignment', async () => {
    const { app } = await setup()
    const res = await put(app, 'menu_board', {
      slots: [{ label: 'P', owner: 'internal', partnerId: 'p_google' }, { label: 'S', owner: 'retail', storeScope: 'Everyone' }, { label: 'x', owner: 'internal' }],
    })
    expect(res.json().error.details.map((d: { field: string }) => d.field)).toEqual(['slots[0].owner', 'slots[1].storeScope'])
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
    const forbidden = await (await setup({ role: 'hq_user' })).app.inject({ method: 'GET', url: '/api/admin/v1/advertisers' })
    expect(forbidden.statusCode).toBe(403)
    expectMatchesContract('GET', '/admin/v1/advertisers', 403, forbidden.json())
  })

  it.each(['/partners', '/advertiser-settings', '/advertisers'])('%s returns 404 with the flag off', async (path) => {
    const res = await (await setup({ flag: false })).app.inject({ method: 'GET', url: `/api/admin/v1${path}` })
    expect(res.statusCode).toBe(404)
  })
})
