import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/http/app'
import { expectMatchesContract } from './contract'
import { testContext } from './helpers'

const BASE = '/api/admin/v1'
const AGENT = { 'x-actor-type': 'agent', 'x-actor-id': 'agent:cpm-tuner', 'x-actor-name': 'CPM tuner', 'x-change-reason': 'Weekend uplift' }
const pricing = { currency: 'NZD', floorCpm: 120, interactiveCpe: 1.25, categoryWhitelist: ['Food & Drink'], categoryBlacklist: ['Finance'] }
const slotRow = (reservePrice: number | null) => ({ displayTypeId: 'menu_board', slot: 2, assignedTo: { partnerIds: ['p_google'], advertisers: [], whitelistOnly: false }, reservePrice, reservePriceDefault: null, billingUnitHours: null, maxCampaigns: null })

async function setup() {
  const app = buildApp(await testContext())
  const log = async (qs = '') => {
    const res = await app.inject({ method: 'GET', url: `${BASE}/ssp-audit-log${qs}` })
    expect(res.statusCode).toBe(200)
    expectMatchesContract('GET', '/admin/v1/ssp-audit-log', 200, res.json())
    return res.json() as { items: { actor: { type: string; id: string; name: string }; objectType: string; objectId: string; field: string; oldValue: unknown; newValue: unknown; changeType: string; at: string; reason: string | null; changeId: string; request: string }[]; next: string | null }
  }
  return { app, log }
}

describe('SSP settings audit log', () => {
  it('starts empty, and a read changes nothing', async () => {
    const { app, log } = await setup()
    await app.inject({ method: 'GET', url: `${BASE}/exchange` })
    expect((await log()).items).toEqual([])
  })

  it('records a human change with the field, old and new value, actor and time', async () => {
    const { app, log } = await setup()
    const before = Date.now()
    const res = await app.inject({ method: 'PUT', url: `${BASE}/advertiser-settings`, payload: pricing })
    expect(res.statusCode).toBe(200)
    const { items } = await log()
    const floor = items.find((e) => e.field === 'floorCpm')!
    expect(floor).toMatchObject({ objectType: 'pricing_settings', objectId: 'company', changeType: 'updated', newValue: 120, actor: { type: 'human', id: 'u_hq_admin', name: 'HQ Admin (POC)' }, request: 'PUT /api/admin/v1/advertiser-settings', reason: null })
    expect(typeof floor.oldValue).toBe('number')
    expect(floor.oldValue).not.toBe(120)
    expect(Date.parse(floor.at)).toBeGreaterThanOrEqual(before - 1000)
    /* Only what changed is logged, and one save shares one change id. */
    expect(items.every((e) => e.oldValue !== e.newValue)).toBe(true)
    expect(new Set(items.map((e) => e.changeId)).size).toBe(1)
  })

  it('records an agent change, distinguishable from a human one, and filters by actor, field, object and time', async () => {
    const { app, log } = await setup()
    await app.inject({ method: 'PUT', url: `${BASE}/available-inventory`, payload: { items: [slotRow(10)] } })
    /* Timestamps are millisecond-precise and `from` is inclusive: keep the first write off the boundary. */
    await new Promise((r) => setTimeout(r, 5))
    const between = new Date().toISOString()
    await new Promise((r) => setTimeout(r, 5))
    const res = await app.inject({ method: 'PUT', url: `${BASE}/available-inventory`, headers: AGENT, payload: { items: [slotRow(25)] } })
    expect(res.statusCode).toBe(200)

    const all = (await log()).items
    expect(all.map((e) => e.actor.type)).toEqual(expect.arrayContaining(['human', 'agent']))
    const agentChange = (await log('?actorType=agent')).items
    expect(agentChange).toHaveLength(1)
    expect(agentChange[0]).toMatchObject({ objectType: 'display_type', objectId: 'menu_board', field: 'slots[2].reservePrice', oldValue: 10, newValue: 25, reason: 'Weekend uplift', actor: { type: 'agent', id: 'agent:cpm-tuner', name: 'CPM tuner' } })

    /* When was that specific value set, and by whom? */
    const who = await log('?objectType=display_type&objectId=menu_board&field=slots%5B2%5D.reservePrice&order=asc')
    expect(who.items.map((e) => [e.actor.type, e.newValue])).toEqual([['human', 10], ['agent', 25]])
    expect((await log(`?from=${encodeURIComponent(between)}`)).items.map((e) => e.actor.id)).toEqual(['agent:cpm-tuner'])
    const early = (await log(`?to=${encodeURIComponent(between)}&fieldPrefix=slots%5B2%5D`)).items
    expect(early.length).toBeGreaterThan(0)
    expect(early.every((e) => e.actor.type === 'human')).toBe(true)
    expect((await log('?actorId=agent:cpm-tuner')).items).toHaveLength(1)
    expect((await log('?actorType=human&field=nope')).items).toEqual([])
  })

  it('refuses an agent write that does not identify the agent, and an unknown actor type', async () => {
    const { app, log } = await setup()
    const anon = await app.inject({ method: 'PUT', url: `${BASE}/advertiser-settings`, headers: { 'x-actor-type': 'agent' }, payload: pricing })
    expect(anon.statusCode).toBe(400)
    expect(anon.json().error.details[0].field).toBe('X-Actor-Id')
    expect((await app.inject({ method: 'PUT', url: `${BASE}/advertiser-settings`, headers: { 'x-actor-type': 'robot' }, payload: pricing })).statusCode).toBe(400)
    expect((await log()).items).toEqual([])
    expect((await app.inject({ method: 'GET', url: `${BASE}/ssp-audit-log?actorType=robot` })).statusCode).toBe(400)
  })

  it('logs nothing for a rejected write or a save that changes nothing', async () => {
    const { app, log } = await setup()
    expect((await app.inject({ method: 'PUT', url: `${BASE}/advertiser-settings`, payload: { ...pricing, floorCpm: -1 } })).statusCode).toBe(400)
    await app.inject({ method: 'PUT', url: `${BASE}/advertiser-settings`, payload: pricing })
    const count = (await log()).items.length
    await app.inject({ method: 'PUT', url: `${BASE}/advertiser-settings`, payload: pricing })
    expect((await log()).items).toHaveLength(count)
  })

  it('records buyers lists being created, changed and deleted, and the exchange settings', async () => {
    const { app, log } = await setup()
    const list = { name: 'Q4 private auction', description: '', invitedBuyers: [{ partnerId: 'p_google', seatId: '5130001' }], activeFrom: null, activeTo: null }
    const id = (await app.inject({ method: 'POST', url: `${BASE}/buyers-lists`, headers: AGENT, payload: list })).json().id
    await app.inject({ method: 'PUT', url: `${BASE}/buyers-lists/${id}`, payload: { ...list, floorCpm: 400 } })
    await app.inject({ method: 'DELETE', url: `${BASE}/buyers-lists/${id}` })
    const trail = (await log(`?objectType=buyers_list&objectId=${id}&order=asc`)).items
    expect(trail[0]).toMatchObject({ changeType: 'created', actor: { type: 'agent' } })
    expect(trail.find((e) => e.field === 'floorCpm' && e.changeType === 'updated')).toMatchObject({ oldValue: null, newValue: 400, actor: { type: 'human' } })
    expect(trail[trail.length - 1]).toMatchObject({ changeType: 'deleted', newValue: null })

    await app.inject({ method: 'PUT', url: `${BASE}/exchange`, payload: { enabled: true, organisation: 'Demo Retail Group', domain: 'demoretail.example', sellerId: 'drg-4471', contactEmail: 'adops@demoretail.example', globalDealEnabled: true } })
    expect((await log('?objectType=exchange&field=globalDealEnabled')).items[0]).toMatchObject({ oldValue: false, newValue: true })
  })

  it('records a DSP’s bid floor and the per-advertiser floor multiplier', async () => {
    const { app, log } = await setup()
    const partner = (await app.inject({ method: 'GET', url: `${BASE}/partners/p_google` })).json()
    const put = await app.inject({ method: 'PUT', url: `${BASE}/partners/p_google`, headers: AGENT, payload: { credentials: {}, bidder: { ...partner.bidder, floorCpm: 333 } } })
    expect(put.statusCode).toBe(200)
    expect((await log('?objectType=dsp_partner&field=bidder.floorCpm')).items[0]).toMatchObject({ objectId: 'p_google', newValue: 333, actor: { type: 'agent' } })
    const adv = (await app.inject({ method: 'GET', url: `${BASE}/advertisers` })).json().items[0]
    expect((await app.inject({ method: 'PUT', url: `${BASE}/advertisers`, payload: { settings: { [adv.advertiserId]: { approvalRequired: adv.approvalRequired, floorMultiplier: 2.5 } } } })).statusCode).toBe(200)
    expect((await log('?objectType=advertiser_setting&field=floorMultiplier')).items[0]).toMatchObject({ objectId: adv.advertiserId, newValue: 2.5 })
  })

  it('pages with limit and cursor, and is admin only', async () => {
    const { app, log } = await setup()
    await app.inject({ method: 'PUT', url: `${BASE}/advertiser-settings`, payload: pricing })
    const first = await log('?limit=2')
    expect(first.items).toHaveLength(2)
    expect(first.next).not.toBeNull()
    const second = await log(`?limit=500&cursor=${first.next}`)
    expect(second.items.some((e) => first.items.some((f) => f.field === e.field && f.changeId === e.changeId))).toBe(false)
    expect((await app.inject({ method: 'GET', url: `${BASE}/ssp-audit-log?limit=0` })).statusCode).toBe(400)
    const marketing = buildApp(await testContext({ role: 'hq_marketing' }))
    expect((await marketing.inject({ method: 'GET', url: `${BASE}/ssp-audit-log` })).statusCode).toBe(403)
  })
})
