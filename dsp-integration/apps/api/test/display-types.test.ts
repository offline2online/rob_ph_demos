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
    expect(await ctx.playlists.get('pl_dt_new')).toMatchObject({ name: 'Checkout Kiosk Playlist', autoCreatedFor: 'dt_new' })
    /* Ticket, 28 Sep 2026: a new display type's own playlist starts with
       every setting at its default — nothing overridden. (A playlist added
       to an existing display type, or a zone's, still starts with
       Auto-Rotation/Auto-Play explicitly off — the PUT …/record test.) */
    expect((await ctx.playlists.get('pl_dt_new'))?.playlistSettings).toEqual({})
  })

  it('POST rejects unknown touch points and a missing name', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'POST', url: '/api/admin/v1/display-types', payload: newType({ touchPoint: 'Responsive Web', name: ' ' }) })
    expect(res.statusCode).toBe(400)
    expectMatchesContract('POST', '/admin/v1/display-types', 400, res.json())
    expect(res.json().error.details.map((d: { field: string }) => d.field)).toEqual(['name', 'touchPoint'])
  })

  /* Ticket, 28 Sep 2026: Website and Mobile App added alongside Digital
     Signage and Kiosk. */
  it.each(['Website', 'Mobile App'])('POST accepts the %s touch point', async (touchPoint) => {
    const { app } = await setup()
    const res = await app.inject({ method: 'POST', url: '/api/admin/v1/display-types', payload: newType({ id: `dt_${touchPoint}`, touchPoint }) })
    expect(res.statusCode).toBe(201)
    expectMatchesContract('POST', '/admin/v1/display-types', 201, res.json())
    expect(res.json().touchPoint).toBe(touchPoint)
  })

  it('PUT …/record saves existing fields, never phExtensions, and creates zone playlists on demand', async () => {
    const { app, ctx } = await setup()
    const landscape = (await ctx.displayTypes.get('landscape')) as DisplayType
    const payload = {
      ...landscape, name: 'Landscape HD', phExtensions: { slots: [{ label: 'x', owner: 'internal' as const }] },
      multiZone: { enabled: true, zones: [{ id: 'z1', name: 'Zone 1', x: 0, y: 0, width: 50, height: 100, playlistId: 'pl_zone_landscape_1' }] },
    }
    const res = await app.inject({ method: 'PUT', url: '/api/admin/v1/display-types/landscape/record', payload })
    expect(res.statusCode).toBe(200)
    expectMatchesContract('PUT', '/admin/v1/display-types/{displayTypeId}/record', 200, res.json())
    expect(res.json().name).toBe('Landscape HD')
    expect(res.json().phExtensions).toEqual(landscape.phExtensions)
    expect(await ctx.playlists.get('pl_zone_landscape_1')).toMatchObject({ name: 'Landscape HD / Zone 1', autoCreatedFor: 'landscape' })
    expect((await ctx.playlists.get('pl_zone_landscape_1'))?.playlistSettings).toEqual({ campaignAutoRotation: 'Auto-Rotate Off', campaignAutoPlay: 'Auto-Play Off' })
  })

  it('switching a display type to multi-zone keeps its old default playlist, unassigned, and gives the layout its own playlist', async () => {
    const { app, ctx } = await setup()
    const landscape = (await ctx.displayTypes.get('landscape')) as DisplayType
    const oldId = landscape.defaultPlaylistId as string
    const zone = { id: 'z1', name: 'Zone 1', x: 0, y: 0, width: 100, height: 100, playlistId: 'pl_zone_landscape_1' }
    const res = await app.inject({ method: 'PUT', url: '/api/admin/v1/display-types/landscape/record', payload: { ...landscape, multiZone: { enabled: true, zones: [zone] } } })
    expect(res.statusCode).toBe(200)
    expect(res.json().defaultPlaylistId).toBe('pl_landscape_layout')
    expect(await ctx.playlists.get(oldId)).not.toBeNull()
    const list = (await app.inject({ method: 'GET', url: '/api/admin/v1/playlists' })).json().items
    expect(list.find((p: { id: string }) => p.id === oldId).assignments).toEqual([])
    expect(list.find((p: { id: string }) => p.id === 'pl_zone_landscape_1').assignments).toHaveLength(1)
    expect((await app.inject({ method: 'GET', url: `/api/admin/v1/playlists/${oldId}/delete-check` })).json().canDelete).toBe(true)
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
  /* Menu Board (seed) is multi-zone: its three slots are Zone 1's own
     (28 Sep 2026), so each carries that zone's id. */
  const menuSlots = (second: Record<string, unknown> = {}) => ({
    slots: [
      { label: 'Priority 1', owner: 'internal', zoneId: 'z1' },
      { label: 'Supplier slot', owner: 'advertiser', zoneId: 'z1', ...second },
      { label: 'Store choice', owner: 'internal', zoneId: 'z1' },
    ],
  })

  it('refuses a Stores-owned slot server-side, naming the slot (release 1)', async () => {
    const { app } = await setup()
    const res = await put(app, 'menu_board', { slots: [{ label: 'Priority 1', owner: 'internal', zoneId: 'z1' }, { label: 'Supplier slot', owner: 'advertiser', zoneId: 'z1' }, { label: 'Store choice', owner: 'retail', zoneId: 'z1' }] })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.details).toEqual([{ field: 'slots[2].owner', reason: expect.stringContaining('Slot 3') }])
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
      .toEqual([['internal', 'Priority 1'], ['advertiser', 'Brand slot'], ['internal', 'Store choice']])
    expect((await ctx.displayTypes.get('menu_board'))?.phExtensions?.venue).toMatchObject({ orientation: 'landscape' })
  })

  it('keeps what Advertisers / Inventory set while the slot stays sellable, and drops it when it doesn’t', async () => {
    const { app, ctx } = await setup()
    await app.inject({ method: 'PUT', url: '/api/admin/v1/available-inventory', payload: { items: [{ displayTypeId: 'menu_board', slot: 2, supportedTargeting: ['localised', 'personalised'], assignedTo: { partnerIds: [], advertisers: ['Nestlé'], whitelistOnly: false } }] } })
    const kept = await put(app, 'menu_board', menuSlots({ label: 'Brand slot' }))
    expect(kept.json().slots[1]).toMatchObject({ advertisers: ['Nestlé'], partnerIds: ['p_google'], supportedTargeting: ['localised', 'personalised'] })
    /* Owner changed: it is no longer sellable inventory, so the assignment goes. */
    const dropped = await put(app, 'menu_board', { slots: [{ label: 'Priority 1', owner: 'internal', zoneId: 'z1' }, { label: 'Brand slot', owner: 'internal', zoneId: 'z1' }, { label: 'Store choice', owner: 'internal', zoneId: 'z1' }] })
    expect(dropped.json().slots[1]).toMatchObject({ advertisers: [], partnerIds: [], listMode: null })
    expect((await ctx.displayTypes.get('menu_board'))?.phExtensions?.slots[1].supportedTargeting).toBeUndefined()
  })

  it('ignores an assignment sent with the slots, and gives a Stores slot the default scope', async () => {
    const { app } = await setup()
    const res = await put(app, 'menu_board', menuSlots({ partnerIds: ['p_amazon'], advertisers: ['Swisse'] }))
    expect(res.statusCode).toBe(200)
    expect(res.json().slots[1]).toMatchObject({ partnerIds: ['p_google'], advertisers: [] })
    expect(res.json().slots[2]).toMatchObject({ storeScope: null })
  })

  /* Rob, 24 Sep 2026: with DSP integration switched off, existing advertiser
     slots stay as they are, but no new one can be set up. */
  it('with DSP integration switched off, keeps existing advertiser slots but refuses a new one', async () => {
    const { app, ctx } = await setup()
    await ctx.exchange.save({ ...(await ctx.exchange.get()), enabled: false })
    /* Slot 2 already was Advertiser: saving it unchanged (or relabelled) is fine. */
    const kept = await put(app, 'menu_board', menuSlots({ label: 'Brand slot' }))
    expect(kept.statusCode).toBe(200)
    expect(kept.json().slots[1]).toMatchObject({ owner: 'advertiser', partnerIds: ['p_google'] })
    /* Slot 1 becoming Advertiser is a new one: refused, and nothing saved. */
    const added = await put(app, 'menu_board', { slots: [{ label: 'Priority 1', owner: 'advertiser', zoneId: 'z1' }, { label: 'Brand slot', owner: 'advertiser', zoneId: 'z1' }, { label: 'Store choice', owner: 'internal', zoneId: 'z1' }] })
    expect(added.statusCode).toBe(400)
    expectMatchesContract('PUT', '/admin/v1/display-types/{displayTypeId}/extensions', 400, added.json())
    expect(added.json().error.details).toEqual([{ field: 'slots[0].owner', reason: expect.stringContaining('Switch on DSP integration') }])
    expect((await ctx.displayTypes.get('menu_board'))?.phExtensions?.slots[0].owner).toBe('internal')
    /* Switched back on, it can be. */
    await ctx.exchange.save({ ...(await ctx.exchange.get()), enabled: true })
    expect((await put(app, 'menu_board', { slots: [{ label: 'Priority 1', owner: 'advertiser', zoneId: 'z1' }, { label: 'Brand slot', owner: 'advertiser', zoneId: 'z1' }, { label: 'Store choice', owner: 'internal', zoneId: 'z1' }] })).statusCode).toBe(200)
  })

  it('requires one slot per rotation position, and a label on each', async () => {
    const { app } = await setup()
    const res = await put(app, 'menu_board', { slots: [{ label: 'Only one', owner: 'internal', zoneId: 'z1' }] })
    expect(res.statusCode).toBe(400)
    expectMatchesContract('PUT', '/admin/v1/display-types/{displayTypeId}/extensions', 400, res.json())
    expect(res.json().error.details[0]).toMatchObject({ field: 'slots', reason: expect.stringContaining('Expected 3 slots across 3 zones') })
    expect((await put(app, 'landscape', { slots: [] })).statusCode).toBe(200)
    const blank = await put(app, 'menu_board', menuSlots({ label: '  ' }))
    expect(blank.json().error.details.map((d: { field: string }) => d.field)).toEqual(['slots[1].label'])
  })

  /* Ticket, 28 Sep 2026 ("the three zones are still being seen as a single
     inventory slot"): each zone runs its own playlist, so each has its own
     Maximum Campaigns Played In Rotation (on the zone) and its own slots —
     the display type's slot list is one segment per zone, in zone order. A
     slot can't be filed under a zone other than the one its position
     belongs to, and a single-zone display type takes no zone at all. */
  it('sizes a multi-zone display type’s slots per zone, in zone order, from each zone’s own cap', async () => {
    const { app, ctx } = await setup()
    const dt = (await ctx.displayTypes.get('menu_board')) as DisplayType
    const zones = (dt.multiZone as { zones: { id: string; maximumCampaignsPlayedInRotation: number | null }[] }).zones
    /* Zone 2 gets a rotation of two: the display type now carries 3 + 2 slots. */
    const withZone2 = { ...dt, multiZone: { enabled: true, zones: zones.map((z) => (z.id === 'z2' ? { ...z, maximumCampaignsPlayedInRotation: 2 } : z)) } }
    expect((await app.inject({ method: 'PUT', url: '/api/admin/v1/display-types/menu_board/record', payload: withZone2 })).statusCode).toBe(200)

    const short = await put(app, 'menu_board', menuSlots())
    expect(short.statusCode).toBe(400)
    expect(short.json().error.details[0]).toMatchObject({ field: 'slots', reason: expect.stringContaining('Expected 5 slots across 3 zones') })

    const wrongZone = await put(app, 'menu_board', { slots: [...menuSlots().slots, { label: 'Slot 1', owner: 'internal', zoneId: 'z3' }, { label: 'Slot 2', owner: 'advertiser', zoneId: 'z2' }] })
    expect(wrongZone.statusCode).toBe(400)
    expectMatchesContract('PUT', '/admin/v1/display-types/{displayTypeId}/extensions', 400, wrongZone.json())
    expect(wrongZone.json().error.details).toEqual([{ field: 'slots[3].zoneId', reason: expect.stringContaining("Slot 4 is Zone 2's") }])

    const ok = await put(app, 'menu_board', { slots: [...menuSlots().slots, { label: 'Slot 1', owner: 'internal', zoneId: 'z2' }, { label: 'Slot 2', owner: 'advertiser', zoneId: 'z2' }] })
    expect(ok.statusCode).toBe(200)
    expectMatchesContract('PUT', '/admin/v1/display-types/{displayTypeId}/extensions', 200, ok.json())
    expect(ok.json().slots.map((s: { zoneId: string | null }) => s.zoneId)).toEqual(['z1', 'z1', 'z1', 'z2', 'z2'])

    /* A single-zone display type's slots belong to no zone. */
    const landscape = (await ctx.displayTypes.get('landscape')) as DisplayType
    await app.inject({ method: 'PUT', url: '/api/admin/v1/display-types/landscape/record', payload: { ...landscape, playlistSettings: { ...landscape.playlistSettings, maximumCampaignsPlayedInRotation: 1 } } })
    const stray = await put(app, 'landscape', { slots: [{ label: 'Only', owner: 'internal', zoneId: 'z1' }] })
    expect(stray.json().error.details).toEqual([{ field: 'slots[0].zoneId', reason: 'Unknown zone.' }])
    expect((await put(app, 'landscape', { slots: [{ label: 'Only', owner: 'internal' }] })).statusCode).toBe(200)
  })

  /* A multi-zone display type saved before zones had caps of their own
     (one shared slot list, some slots tagged to a zone) reads in the new
     shape without a migration script: tagged slots go to their zone,
     untagged ones to the first, and each zone's cap becomes what it got. */
  it('reads a pre-28-Sep multi-zone record as one segment per zone, each zone capped by what it received', async () => {
    const { ctx } = await setup()
    const dt = (await ctx.displayTypes.get('menu_board')) as DisplayType
    const legacyZones = (dt.multiZone as { zones: Record<string, unknown>[] }).zones.map(({ maximumCampaignsPlayedInRotation: _cap, ...z }) => z)
    await ctx.displayTypes.saveRecord('menu_board', { ...dt, multiZone: { enabled: true, zones: legacyZones } })
    await ctx.displayTypes.saveExtensions('menu_board', { ...dt.phExtensions!, slots: dt.phExtensions!.slots.map((s, i) => ({ ...s, zoneId: i === 1 ? 'z3' : null })) })
    const read = (await ctx.displayTypes.get('menu_board')) as DisplayType
    expect((read.multiZone as { zones: { id: string; maximumCampaignsPlayedInRotation: number | null }[] }).zones.map((z) => [z.id, z.maximumCampaignsPlayedInRotation])).toEqual([['z1', 2], ['z2', null], ['z3', 1]])
    expect(read.phExtensions?.slots.map((s) => [s.label, s.zoneId])).toEqual([['Priority 1', 'z1'], ['Store choice', 'z1'], ['Supplier slot', 'z3']])
  })
})

/* Ticket, 28 Sep 2026: Website and Mobile App are HQ-only — no advertising,
   so the slot editor and the API both refuse anything but a Headquarters
   slot for them. */
describe('PUT /admin/v1/display-types/{id}/extensions — Website/Mobile App are HQ-only', () => {
  const put = (app: ReturnType<typeof buildApp>, id: string, payload: unknown) =>
    app.inject({ method: 'PUT', url: `/api/admin/v1/display-types/${id}/extensions`, payload: payload as object })

  it.each(['Website', 'Mobile App'])('refuses an Advertiser or Stores slot for %s, accepts Headquarters', async (touchPoint) => {
    const { app, ctx } = await setup()
    const created = await app.inject({
      method: 'POST', url: '/api/admin/v1/display-types',
      payload: newType({ id: `dt_${touchPoint}`, touchPoint, playlistSettings: { maximumCampaignsPlayedInRotation: 1 } }),
    })
    expect(created.statusCode).toBe(201)

    const advertiser = await put(app, `dt_${touchPoint}`, { slots: [{ label: 'Slot 1', owner: 'advertiser' }] })
    expect(advertiser.statusCode).toBe(400)
    expectMatchesContract('PUT', '/admin/v1/display-types/{displayTypeId}/extensions', 400, advertiser.json())
    expect(advertiser.json().error.details).toEqual([{ field: 'slots[0].owner', reason: expect.stringContaining('isn’t available for this touch point') }])

    const retail = await put(app, `dt_${touchPoint}`, { slots: [{ label: 'Slot 1', owner: 'retail' }] })
    expect(retail.statusCode).toBe(400)
    expect(retail.json().error.details).toEqual([{ field: 'slots[0].owner', reason: expect.stringContaining('isn’t available for this touch point') }])

    const internal = await put(app, `dt_${touchPoint}`, { slots: [{ label: 'Slot 1', owner: 'internal' }] })
    expect(internal.statusCode).toBe(200)
    expect((await ctx.displayTypes.get(`dt_${touchPoint}`))?.phExtensions?.slots).toMatchObject([{ owner: 'internal' }])
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
