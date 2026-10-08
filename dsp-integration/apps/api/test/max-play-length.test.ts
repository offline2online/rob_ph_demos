/* Max play length (ticket "Max play length as an inherited slot setting",
   7 Oct 2026): a fixed per-play duration resolved slot → display type →
   company default. Plays per window are floor(window / it) — never the loop
   length and never a creative's own length — and a creative longer than it
   is rejected at upload, not truncated. */
import { DEFAULT_MAX_PLAY_LENGTH_SEC, maxPlayLengthSecOf } from '@ph-dsp/types'
import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/http/app'
import { expectMatchesContract } from './contract'
import { mp4, multipart } from './media'
import { NOW, testContext } from './helpers'

const GOOGLE = { authorization: 'Bearer poc-token-google-dv360' }
const KEEP = { partnerIds: ['p_google'], advertisers: [], whitelistOnly: false }
const SETTINGS = { currency: 'NZD', floorCpm: 120, interactiveCpe: 1.25, auctionOpensHours: 72, playWindowHours: 24, auctionCutoffTime: '20:30', categoryWhitelist: ['Food & Drink'], categoryBlacklist: ['Finance'] }

describe('maxPlayLengthSecOf', () => {
  it('lets the slot win over the display type, which wins over the company default', () => {
    expect(maxPlayLengthSecOf({}, {})).toBe(DEFAULT_MAX_PLAY_LENGTH_SEC)
    expect(maxPlayLengthSecOf({}, {}, 20)).toBe(20)
    expect(maxPlayLengthSecOf({ phExtensions: { maxPlayLengthSec: 10 } }, {}, 20)).toBe(10)
    expect(maxPlayLengthSecOf({ phExtensions: { maxPlayLengthSec: 10 } }, { maxPlayLengthSec: 6 }, 20)).toBe(6)
  })
})

describe('max play length through the API', () => {
  const row = (extra: Record<string, unknown>) => ({ displayTypeId: 'menu_board', slot: 2, assignedTo: KEEP, ...extra })
  const at = (json: { items: { slot: number }[] }) => json.items.find((i) => i.slot === 2)

  it('resolves company → display type → slot, bounds it, and keeps it when omitted', async () => {
    const ctx = await testContext()
    const app = buildApp(ctx)
    const put = (items: unknown[]) => app.inject({ method: 'PUT', url: '/api/admin/v1/available-inventory', payload: { items } })

    expect(at((await app.inject({ method: 'GET', url: '/api/admin/v1/available-inventory' })).json())).toMatchObject({ maxPlayLengthSec: 15, maxPlayLengthSecOverride: null, displayTypeMaxPlayLengthSec: null, companyMaxPlayLengthSec: 15 })

    /* Company default, from Advertiser settings. */
    const company = await app.inject({ method: 'PUT', url: '/api/admin/v1/advertiser-settings', payload: { ...SETTINGS, maxPlayLengthSec: 30 } })
    expect(company.statusCode).toBe(200)
    expectMatchesContract('PUT', '/admin/v1/advertiser-settings', 200, company.json())
    expect(company.json().maxPlayLengthSec).toBe(30)
    expect(at((await app.inject({ method: 'GET', url: '/api/admin/v1/available-inventory' })).json())).toMatchObject({ maxPlayLengthSec: 30, companyMaxPlayLengthSec: 30 })
    /* Omitted on save keeps it. */
    expect((await app.inject({ method: 'PUT', url: '/api/admin/v1/advertiser-settings', payload: SETTINGS })).json().maxPlayLengthSec).toBe(30)

    /* Display type default beats the company's. */
    const dt = await put([row({ maxPlayLengthSecDefault: 10 })])
    expect(dt.statusCode).toBe(200)
    expectMatchesContract('PUT', '/admin/v1/available-inventory', 200, dt.json())
    expect(at(dt.json())).toMatchObject({ maxPlayLengthSec: 10, maxPlayLengthSecOverride: null, displayTypeMaxPlayLengthSec: 10, companyMaxPlayLengthSec: 30 })
    expect((await ctx.displayTypes.get('menu_board'))!.phExtensions!.maxPlayLengthSec).toBe(10)

    /* Slot override beats both. */
    expect(at((await put([row({ maxPlayLengthSec: 6 })])).json())).toMatchObject({ maxPlayLengthSec: 6, maxPlayLengthSecOverride: 6, displayTypeMaxPlayLengthSec: 10 })
    /* Null inherits again. */
    expect(at((await put([row({ maxPlayLengthSec: null, maxPlayLengthSecDefault: null })])).json())).toMatchObject({ maxPlayLengthSec: 30, maxPlayLengthSecOverride: null, displayTypeMaxPlayLengthSec: null })

    for (const bad of [0, 601, 1.5, 'x']) {
      const res = await put([row({ maxPlayLengthSec: bad })])
      expect(res.statusCode).toBe(400)
      expect(res.json().error.details).toEqual([{ field: 'items[0].maxPlayLengthSec', reason: 'Whole seconds from 1 to 600, or null to inherit.' }])
    }
    const badCompany = await app.inject({ method: 'PUT', url: '/api/admin/v1/advertiser-settings', payload: { ...SETTINGS, maxPlayLengthSec: 0 } })
    expect(badCompany.statusCode).toBe(400)
    expect(badCompany.json().error.details).toEqual([{ field: 'maxPlayLengthSec', reason: 'Max play length is a whole number of seconds from 1 to 600.' }])
  })

  it('derives plays per window from max play length × slots, and sends it in the bid request', async () => {
    const ctx = await testContext({ clock: () => NOW })
    const app = buildApp(ctx)
    const get = async () => (await app.inject({ method: 'GET', url: '/api/v1/inventory', headers: GOOGLE })).json().items[0]
    /* Menu Board: 3 slots, 24-hour window. 24 h / (15 s default x 3 slots) = 1920. */
    expect(await get()).toMatchObject({ playsPerWindow: 1920, slotCount: 3, screen: { loopLengthSec: 45, maxPlayLengthSec: 15 } })
    const ext = (await ctx.displayTypes.get('menu_board'))!.phExtensions!
    await ctx.displayTypes.saveExtensions('menu_board', { ...ext, maxPlayLengthSec: 20 })
    expect(await get()).toMatchObject({ playsPerWindow: 1440, screen: { loopLengthSec: 45, maxPlayLengthSec: 20 } })
    const ext2 = (await ctx.displayTypes.get('menu_board'))!.phExtensions!
    await ctx.displayTypes.saveExtensions('menu_board', { ...ext2, slots: ext2.slots.map((s, i) => (i === 1 ? { ...s, maxPlayLengthSec: 30 } : s)) })
    expect(await get()).toMatchObject({ playsPerWindow: 960, screen: { maxPlayLengthSec: 30 } })
  })

  it('rejects a creative longer than the slot’s max play length, whatever the loop, and never lets its length change plays', async () => {
    const ctx = await testContext({ clock: () => NOW })
    const app = buildApp(ctx)
    const created = await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: GOOGLE, payload: { advertiserId: 'swisse', name: 'Swisse', displayTypeId: 'menu_board', default: { pricingType: 'localised' } } })
    const id = created.json().campaignId as string
    const upload = (secs: number) => { const m = multipart({ version: 'default' }, { name: 'a.mp4', bytes: mp4(5760, 1080, secs) }); return app.inject({ method: 'POST', url: `/api/v1/campaigns/${id}/assets`, headers: { ...GOOGLE, ...m.headers }, payload: m.payload }) }
    expect((await upload(16)).statusCode).toBe(422)
    expect((await upload(15)).statusCode).toBe(201)
    /* Raise the display type's max play length: the same 16 s creative now conforms. */
    const ext = (await ctx.displayTypes.get('menu_board'))!.phExtensions!
    await ctx.displayTypes.saveExtensions('menu_board', { ...ext, maxPlayLengthSec: 20 })
    expect((await upload(16)).statusCode).toBe(201)
    expect((await upload(21)).statusCode).toBe(422)
    /* A short creative changes nothing about the slot's plays. */
    expect((await app.inject({ method: 'GET', url: '/api/v1/inventory', headers: GOOGLE })).json().items[0].playsPerWindow).toBe(1440)
  })
})
