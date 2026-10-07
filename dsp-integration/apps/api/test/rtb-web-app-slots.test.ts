import Ajv2020 from 'ajv/dist/2020'
import { describe, expect, it } from 'vitest'
import type { DisplayType } from '@ph-dsp/types'
import { buildApp } from '../src/http/app'
import { OPENRTB_26_APP_REQUEST, OPENRTB_26_SITE_REQUEST } from './openrtb-schema'
import { NOW, mockDsps, testContext } from './helpers'

const PLAYER = { authorization: 'Bearer poc-token-player' }

/* Ticket HAmTUHQVj63NDiY4hLk8 (decision Rob 7 Oct 2026): website and mobile
   app slots are sold by real-time bidding only — site/app object, no dooh,
   no impression multiplier — and offer no window, reserve, deal or guaranteed
   path. Digital Signage is unchanged (realtime.test.ts). */
async function setup(touchPoint: 'Website' | 'Mobile App') {
  const mocks = mockDsps()
  const sent: { url: string; body: Record<string, any> }[] = []
  const ctx = await testContext({ clock: () => NOW, dspFetch: async (url, init) => { if (url.includes('/openrtb2/bid')) sent.push({ url, body: JSON.parse(String(init?.body)) }); return mocks.fetchImpl(url, init) } })
  const app = buildApp(ctx)
  const id = `dt_${touchPoint === 'Website' ? 'web' : 'app'}`
  const dt: DisplayType = { id, name: `Shop ${touchPoint}`, touchPoint, description: null, displayCanvasSize: { width: 300, height: 250 }, backgroundColor: '#ffffff', defaultPlaylistId: `pl_${id}`, playlistSettings: { maximumCampaignsPlayedInRotation: 2 }, qrControl: {}, enabledFeatures: {}, multiZone: { enabled: false, zones: [] } }
  expect((await app.inject({ method: 'POST', url: '/api/admin/v1/display-types', payload: dt })).statusCode).toBe(201)
  ctx.db.prepare('INSERT INTO displays (id, name, store, store_id, display_type_id) VALUES (?, ?, ?, ?, ?)').run(`d_${id}`, `${touchPoint} surface`, 'Head Office', (ctx.db.prepare('SELECT id FROM stores LIMIT 1').get() as { id: string }).id, id)
  const put = (slots: unknown[]) => app.inject({ method: 'PUT', url: `/api/admin/v1/display-types/${id}/extensions`, payload: { slots } })
  const signal = (slot: number) => app.inject({ method: 'POST', url: '/api/player/v1/impressions', headers: PLAYER, payload: { displayId: `d_${id}`, slot } })
  await mocks.app.inject({ method: 'PUT', url: '/_control/google_dv360/bidder', payload: { advertiserId: '5130002' } })
  return { ctx, app, sent, id, put, signal }
}

describe.each([['Website', 'site', OPENRTB_26_SITE_REQUEST], ['Mobile App', 'app', OPENRTB_26_APP_REQUEST]] as const)('%s slots are sold by real-time bidding only', (touchPoint, object, schema) => {
  const slots = [{ label: 'Header', owner: 'internal' }, { label: 'Sidebar', owner: 'advertiser', bidMode: 'realtime' }]

  it('lets a slot be marked available for RTB, and refuses every other way to sell it', async () => {
    const { put, ctx, id } = await setup(touchPoint)
    const ok = await put(slots)
    expect(ok.statusCode).toBe(200)
    expect(ok.json().slots.map((s: { bidMode?: string }) => s.bidMode)).toEqual([undefined, 'realtime'])
    expect((await ctx.displayTypes.get(id))?.phExtensions?.slots[1]).toMatchObject({ owner: 'advertiser', bidMode: 'realtime' })
    /* An Advertiser slot not marked for RTB would be an advance (window) slot. */
    const advance = await put([slots[0], { label: 'Sidebar', owner: 'advertiser' }])
    expect(advance.statusCode).toBe(400)
    expect(advance.json().error.details).toEqual([{ field: 'slots[1].bidMode', reason: expect.stringContaining('real-time bidding only') }])
    expect((await put([slots[0], { label: 'Sidebar', owner: 'advertiser', bidMode: 'advance' }])).statusCode).toBe(400)
    expect((await put([slots[0], { label: 'Sidebar', owner: 'retail' }])).statusCode).toBe(400)
  })

  it(`sends a bid request with a ${object} object, no dooh and no impression multiplier, and fills only the marked slot`, async () => {
    const { put, signal, sent } = await setup(touchPoint)
    await put(slots)
    const fill = await signal(2)
    expect(fill.json()).toMatchObject({ status: 'filled', creativeSource: 'at_bid' })
    expect(sent).toHaveLength(1)
    const body = sent[0].body
    expect(body).toHaveProperty(object)
    expect(body).not.toHaveProperty('dooh')
    expect(body.imp[0]).not.toHaveProperty('qty')
    expect(body.imp[0].ext.ph.mode).toBe('realtime')
    const ajv = new Ajv2020({ strict: false, allErrors: true })
    const validate = ajv.compile(schema)
    expect(validate(body), JSON.stringify(validate.errors)).toBe(true)
    /* An unmarked (Headquarters) slot never goes to auction. */
    sent.length = 0
    expect((await signal(1)).statusCode).toBe(404)
    expect(sent).toHaveLength(0)
  })

  it('offers no reserve, billing unit, campaign cap, named advertiser or deal for the slot', async () => {
    const { put, app, id } = await setup(touchPoint)
    await put(slots)
    const item = (over: Record<string, unknown>) => ({ displayTypeId: id, slot: 2, assignedTo: { partnerIds: [], advertisers: [], whitelistOnly: false, buyersListId: null }, reservePrice: null, billingUnitHours: null, maxCampaigns: null, ...over })
    const save = (over: Record<string, unknown>) => app.inject({ method: 'PUT', url: '/api/admin/v1/available-inventory', payload: { items: [item(over)] } })
    const inv = await app.inject({ method: 'GET', url: '/api/admin/v1/available-inventory' })
    expect(inv.json().items.find((r: { displayTypeId: string }) => r.displayTypeId === id)).toMatchObject({ touchPoint, unsellableReason: null })
    expect((await save({})).statusCode).toBe(200)
    for (const over of [{ reservePrice: 5 }, { billingUnitHours: 24 }, { maxCampaigns: 3 }, { assignedTo: { partnerIds: [], advertisers: ['Nestlé'], whitelistOnly: false, buyersListId: null } }]) {
      const res = await save(over)
      expect(res.statusCode, JSON.stringify(over)).toBe(400)
    }
  })
})
