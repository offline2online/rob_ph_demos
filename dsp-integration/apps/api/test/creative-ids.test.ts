/* Creative IDs (ticket IDGsyELBJsjlAYjizSqT): campaigns are approved one at a
   time and grouped under a creative ID — the grouping a DSP bids on. */
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/http/app'
import { expectMatchesContract } from './contract'
import { NOW, testContext } from './helpers'

const G = { authorization: 'Bearer poc-token-google-dv360' }

/* Seeded: c_api_swisse is Awaiting approval, c_api_swisse_kids is a Draft
   (Swisse), c_dsp_loreal was Rejected (L'Oréal), c_dsp_nestle is Approved. */
async function setup(role?: 'hq_admin' | 'hq_marketing') {
  const ctx = await testContext({ clock: () => NOW, role })
  const app = buildApp(ctx)
  await ctx.approvals.submit('c_api_swisse_kids', [], 'Swisse')
  await ctx.approvals.unreject('c_dsp_loreal', 'v1', 'HQ Admin (POC)')
  const version = async (id: string) => (await ctx.approvals.view(id)).assetVersion
  const approve = async (ids: string[], creativeId?: string | null, versions: Record<string, string> = {}) =>
    app.inject({
      method: 'POST', url: '/api/admin/v1/approvals/approve-assign',
      payload: { items: await Promise.all(ids.map(async (id) => ({ campaignId: id, assetVersion: versions[id] ?? (await version(id)) }))), ...(creativeId !== undefined ? { creativeId } : {}) },
    })
  const view = async (id: string) => (await app.inject({ method: 'GET', url: `/api/admin/v1/campaigns/${id}/approval` })).json()
  const creativeIds = async (q = '') => {
    const res = await app.inject({ method: 'GET', url: `/api/admin/v1/creative-ids${q}` })
    expectMatchesContract('GET', '/admin/v1/creative-ids', 200, res.json())
    return res.json().items as { creativeId: string; advertiserId: string; campaigns: { campaignId: string; name: string; touchPoints: string[] }[] }[]
  }
  return { ctx, app, version, approve, view, creativeIds }
}

describe('Approve + assign to a creative ID', () => {
  it('mints one new ID across the ticked campaigns of one advertiser and approves them all', async () => {
    const { app, approve, view } = await setup()
    const res = await approve(['c_api_swisse', 'c_api_swisse_kids'])
    expect(res.statusCode).toBe(200)
    expectMatchesContract('POST', '/admin/v1/approvals/approve-assign', 200, res.json())
    const { creativeId, approvals } = res.json()
    expect(creativeId).toMatch(/^CR-[0-9A-F]{8}$/)
    expect(approvals.map((a: { status: string; creativeId: string; reviewedBy: string }) => [a.status, a.creativeId, a.reviewedBy])).toEqual([
      ['approved', creativeId, 'HQ Admin (POC)'], ['approved', creativeId, 'HQ Admin (POC)'],
    ])
    expect((await view('c_api_swisse')).creativeId).toBe(creativeId)
    /* Listed with its members, so the reviewer matches by sibling campaigns. */
    const list = (await app.inject({ method: 'GET', url: '/api/admin/v1/creative-ids?advertiserId=swisse' })).json().items
    expect(list).toHaveLength(1)
    expect(list[0].campaigns.map((c: { campaignId: string }) => c.campaignId).sort()).toEqual(['c_api_swisse', 'c_api_swisse_kids'])
    expect(list[0].campaigns[0]).toMatchObject({ name: expect.any(String), touchPoints: expect.any(Array) })
  })

  it('refuses a selection that spans advertisers, approving none of it', async () => {
    const { approve, view } = await setup()
    const res = await approve(['c_api_swisse', 'c_dsp_loreal'])
    expect(res.statusCode).toBe(400)
    expectMatchesContract('POST', '/admin/v1/approvals/approve-assign', 400, res.json())
    expect(res.json().error.message).toMatch(/one advertiser/)
    expect((await view('c_api_swisse')).status).toBe('awaiting_approval')
    expect((await view('c_dsp_loreal')).status).toBe('awaiting_approval')
  })

  it('joins an existing ID of the same advertiser, and only that advertiser', async () => {
    const { approve, view, creativeIds } = await setup()
    const first = (await approve(['c_api_swisse'])).json().creativeId as string
    const kids = await approve(['c_api_swisse_kids'], first)
    expect(kids.statusCode).toBe(200)
    expect(kids.json().creativeId).toBe(first)
    expect((await view('c_api_swisse_kids')).creativeId).toBe(first)
    expect((await creativeIds()).map((g) => g.campaigns.length)).toEqual([2])
    /* A creative ID never spans advertisers. */
    expect((await approve(['c_dsp_loreal'], first)).statusCode).toBe(400)
    expect((await view('c_dsp_loreal')).status).toBe('awaiting_approval')
    expect((await approve(['c_dsp_loreal'], 'CR-NOPE')).statusCode).toBe(404)
  })

  it('is all or nothing: a stale version or a campaign not awaiting approval approves none', async () => {
    const { approve, view } = await setup()
    const stale = await approve(['c_api_swisse', 'c_api_swisse_kids'], undefined, { c_api_swisse_kids: 'v99' })
    expect(stale.statusCode).toBe(409)
    expect((await view('c_api_swisse')).status).toBe('awaiting_approval')
    expect((await view('c_api_swisse')).creativeId ?? null).toBeNull()
    /* c_dsp_nestle is already approved. */
    expect((await approve(['c_dsp_nestle'])).statusCode).toBe(409)
    /* An HQ campaign has no creative ID. */
    expect((await approve(['c_zinger'])).statusCode).toBe(400)
    expect((await approve([])).statusCode).toBe(400)
  })

  it('is for HQ Admin only', async () => {
    const { approve, view } = await setup('hq_marketing')
    expect((await approve(['c_api_swisse'])).statusCode).toBe(403)
    expect((await view('c_api_swisse')).status).toBe('awaiting_approval')
  })

  it('tells the advertiser the creative ID on the campaign status, and nothing before then', async () => {
    const { app, approve } = await setup()
    const status = async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/campaigns/c_api_swisse/status', headers: G })
      expectMatchesContract('GET', '/v1/campaigns/{campaignId}/status', 200, res.json())
      return res.json()
    }
    expect(await status()).toMatchObject({ status: 'awaiting_approval', creativeId: null })
    const { creativeId } = (await approve(['c_api_swisse'])).json()
    expect(await status()).toMatchObject({ status: 'approved', creativeId })
  })

  it('keeps the creative ID when an approved creative is updated and resubmitted', async () => {
    const { ctx, approve, view } = await setup()
    const { creativeId } = (await approve(['c_api_swisse'])).json()
    ctx.db.prepare("INSERT INTO campaign_assets (id, campaign_id, version, role, file, mime_type, width, height, size_bytes, created_at) VALUES (?, 'c_api_swisse', 2, 'default', 'x.png', 'image/png', 1080, 1920, 1, ?)")
      .run(randomUUID(), NOW.toISOString())
    await ctx.approvals.changed('c_api_swisse', 'Swisse')
    const resubmitted = await view('c_api_swisse')
    expect(resubmitted).toMatchObject({ status: 'awaiting_approval', pendingEdit: true, creativeId })
    /* Approving into the same ID is the resubmission case: no new ID is made. */
    const again = await approve(['c_api_swisse'], creativeId)
    expect(again.json().creativeId).toBe(creativeId)
    expect(await view('c_api_swisse')).toMatchObject({ status: 'approved', creativeId, pendingEdit: false })
  })
})

/* Auto-approved advertisers (ticket XnN1Kwl39F8C8DrOkwQn): submission is the
   approval, so the advertiser groups its own approved campaigns. Seeded:
   Nestlé does not require approval (c_dsp_nestle is Approved), Swisse does. */
describe('Assign a creative ID for an auto-approved advertiser', () => {
  const assign = (app: Awaited<ReturnType<typeof setup>>['app'], campaignIds: string[], creativeId?: string | null) =>
    app.inject({ method: 'POST', url: '/api/admin/v1/approvals/assign-creative-id', payload: { campaignIds, ...(creativeId !== undefined ? { creativeId } : {}) } })

  it('mints a new ID, then a second campaign joins it from the existing-ID list', async () => {
    const { app, view, creativeIds } = await setup()
    const res = await assign(app, ['c_dsp_nestle'])
    expect(res.statusCode).toBe(200)
    expectMatchesContract('POST', '/admin/v1/approvals/assign-creative-id', 200, res.json())
    const { creativeId } = res.json()
    expect(creativeId).toMatch(/^CR-[0-9A-F]{8}$/)
    expect(await view('c_dsp_nestle')).toMatchObject({ status: 'approved', mode: 'auto', creativeId })
    expect((await creativeIds('?advertiserId=nestle'))[0]).toMatchObject({ creativeId, campaigns: [{ campaignId: 'c_dsp_nestle' }] })
    const again = await assign(app, ['c_dsp_nestle'], creativeId)
    expect(again.json().creativeId).toBe(creativeId)
  })

  it('refuses an advertiser whose campaigns the retailer approves, a campaign not yet approved, and an unknown or foreign ID', async () => {
    const { app, approve } = await setup()
    await approve(['c_api_swisse'])
    const swisse = await assign(app, ['c_api_swisse'])
    expect(swisse.statusCode).toBe(400)
    expectMatchesContract('POST', '/admin/v1/approvals/assign-creative-id', 400, swisse.json())
    expect(swisse.json().error.message).toMatch(/retailer/)
    expect((await assign(app, ['c_dsp_nestle'], 'CR-NOPE0000')).statusCode).toBe(404)
    const { creativeId } = (await approve(['c_api_swisse_kids'])).json()
    const foreign = await assign(app, ['c_dsp_nestle'], creativeId)
    expect(foreign.statusCode).toBe(400)
    expect(foreign.json().error.message).toMatch(/different advertiser/)
    expect((await assign(app, [])).statusCode).toBe(400)
  })
})

/* The private-auction (deal ID) flow — REQUIREMENTS §3 "The two approval
   flows", cases B1–B9 (ticket DLhjuhbTqJS2uAvhh0I8). */
describe('Private auction (deal ID) flow', () => {
  /* Swisse campaigns, three of them tagged with deal PMP-1 (a clone of the seeded
     c_api_swisse, assets and all) and the seeded two submitted. */
  async function dealSetup() {
    const s = await setup()
    const { ctx } = s
    const cols = (ctx.db.prepare('PRAGMA table_info(campaigns)').all() as { name: string }[]).map((c) => c.name)
    const clone = async (id: string, name: string, deal: string | null) => {
      ctx.db.prepare(`INSERT INTO campaigns (${cols.join(',')}) SELECT ${cols.map((c) => (c === 'id' ? '?' : c === 'name' ? '?' : c === 'deal_id' ? '?' : c)).join(',')} FROM campaigns WHERE id = 'c_api_swisse'`).run(id, name, deal)
      for (const a of ctx.db.prepare("SELECT * FROM campaign_assets WHERE campaign_id = 'c_api_swisse'").all() as Record<string, unknown>[]) {
        const keys = Object.keys(a)
        ctx.db.prepare(`INSERT INTO campaign_assets (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => (k === 'id' ? randomUUID() : k === 'campaign_id' ? id : a[k])) as never[])
      }
      await ctx.approvals.submit(id, [], 'Swisse')
    }
    await clone('c_deal_a', 'Deal A', 'PMP-1')
    await clone('c_deal_b', 'Deal B', 'PMP-1')
    await clone('c_deal_c', 'Deal C', 'PMP-1')
    await clone('c_deal_other', 'Other deal', 'PMP-2')
    ctx.db.prepare("UPDATE campaigns SET deal_id = 'PMP-1' WHERE id = 'c_api_swisse'").run()
    await ctx.approvals.changed('c_api_swisse', 'Swisse')
    const reject = (id: string, reason = 'Price in the artwork.') =>
      ctx.approvals.reject(id, 'v1', 'HQ Admin (POC)', reason)
    return { ...s, reject }
  }

  it('B1 carries the advertiser-set deal ID through submission onto the campaign status', async () => {
    const { app } = await dealSetup()
    const body = { advertiserId: 'swisse', name: 'Swisse — Deal', displayTypeId: 'landscape', default: { pricingType: 'localised' } }
    const res = await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: G, payload: { ...body, dealId: 'PMP-1' } })
    expect(res.statusCode).toBe(201)
    expectMatchesContract('POST', '/v1/campaigns', 201, res.json())
    expect(res.json().dealId).toBe('PMP-1')
    const status = await app.inject({ method: 'GET', url: `/api/v1/campaigns/${res.json().campaignId}/status`, headers: G })
    expectMatchesContract('GET', '/v1/campaigns/{campaignId}/status', 200, status.json())
    expect(status.json()).toMatchObject({ dealId: 'PMP-1', creativeId: null })
    /* The admin table reads it off the campaign. */
    const list = (await app.inject({ method: 'GET', url: '/api/admin/v1/campaigns' })).json().items as { campaignId: string; dealId?: string }[]
    expect(list.find((c) => c.campaignId === res.json().campaignId)?.dealId).toBe('PMP-1')
    /* A direct campaign has no deal; an empty deal ID is refused. */
    const direct = await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: G, payload: body })
    expect(direct.json().dealId).toBeNull()
    for (const dealId of ['', '   ', 5]) {
      const bad = await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: G, payload: { ...body, dealId } })
      expect(bad.statusCode).toBe(400)
      expectMatchesContract('POST', '/v1/campaigns', 400, bad.json())
    }
  })

  it('B2 approves a subset of a deal into a new creative ID, leaving the rest awaiting approval', async () => {
    const { approve, view } = await dealSetup()
    const res = await approve(['c_deal_a', 'c_deal_b'])
    expect(res.statusCode).toBe(200)
    expect(await view('c_deal_a')).toMatchObject({ status: 'approved', creativeId: res.json().creativeId, dealId: 'PMP-1' })
    expect(await view('c_deal_c')).toMatchObject({ status: 'awaiting_approval', creativeId: null, dealId: 'PMP-1' })
  })

  it('B3 a later round adds a second creative ID (new or existing) to the same deal', async () => {
    const { approve, creativeIds } = await dealSetup()
    const first = (await approve(['c_deal_a'])).json().creativeId as string
    const second = (await approve(['c_deal_b'])).json().creativeId as string
    expect(second).not.toBe(first)
    expect((await creativeIds('?advertiserId=swisse&dealId=PMP-1')).map((g) => g.creativeId).sort()).toEqual([first, second].sort())
    const joined = await approve(['c_deal_c'], first)
    expect(joined.json().creativeId).toBe(first)
  })

  it('B4 lets a selection mix deals, or deal and direct campaigns: one creative, many deals', async () => {
    const { approve, view, creativeIds } = await dealSetup()
    const mixed = await approve(['c_deal_a', 'c_deal_other', 'c_api_swisse_kids'])
    expect(mixed.statusCode).toBe(200)
    const id = mixed.json().creativeId as string
    expect(await view('c_deal_other')).toMatchObject({ status: 'approved', creativeId: id, dealIds: ['PMP-2'] })
    /* An existing ID is joinable whatever its deals. */
    expect((await approve(['c_deal_b'], id)).json().creativeId).toBe(id)
    const [g] = await creativeIds('?advertiserId=swisse')
    expect(g).toMatchObject({ creativeId: id, dealIds: ['PMP-1', 'PMP-2'], direct: true })
  })

  it('B5 lists only the same deal\'s creative IDs for a deal campaign', async () => {
    const { approve, creativeIds } = await dealSetup()
    const one = (await approve(['c_deal_a'])).json().creativeId as string
    const two = (await approve(['c_deal_other'])).json().creativeId as string
    const direct = (await approve(['c_api_swisse_kids'])).json().creativeId as string
    expect((await creativeIds('?advertiserId=swisse&dealId=PMP-1')).map((g) => g.creativeId)).toEqual([one])
    expect((await creativeIds('?advertiserId=swisse&dealId=PMP-2')).map((g) => g.creativeId)).toEqual([two])
    expect((await creativeIds('?advertiserId=swisse&dealId=')).map((g) => g.creativeId)).toEqual([direct])
    expect((await creativeIds('?advertiserId=swisse')).length).toBe(3)
    expect((await creativeIds('?advertiserId=swisse&dealId=PMP-1'))[0]).toMatchObject({ dealId: 'PMP-1', dealIds: ['PMP-1'], direct: false, campaigns: [{ campaignId: 'c_deal_a', dealId: 'PMP-1', dealIds: ['PMP-1'] }] })
  })

  it('B10 crossover: a direct campaign gets a deal after the fact, from the retailer or the advertiser, and its creative ID resolves per deal', async () => {
    const { app, approve, view, creativeIds } = await dealSetup()
    const { creativeId } = (await approve(['c_api_swisse_kids', 'c_deal_a'])).json()
    expect((await creativeIds('?advertiserId=swisse&dealId=PMP-3')).length).toBe(0)
    /* Retailer adds a deal on the campaign (the creative-ID record is untouched). */
    const put = await app.inject({ method: 'PUT', url: '/api/admin/v1/campaigns/c_api_swisse_kids/deals', payload: { dealIds: ['PMP-3', 'PMP-4', 'PMP-3'] } })
    expect(put.statusCode).toBe(200)
    expectMatchesContract('PUT', '/admin/v1/campaigns/{campaignId}/deals', 200, put.json())
    expect(put.json()).toMatchObject({ dealIds: ['PMP-3', 'PMP-4'], direct: true, creativeId })
    /* Per deal, the same creative appears under each; the direct arrangement is kept. */
    for (const d of ['PMP-1', 'PMP-3', 'PMP-4']) expect((await creativeIds(`?advertiserId=swisse&dealId=${d}`)).map((g) => g.creativeId)).toEqual([creativeId])
    expect((await creativeIds('?advertiserId=swisse&dealId=')).map((g) => g.creativeId)).toEqual([creativeId])
    /* The authored deal cannot be removed; dropping the added ones leaves it. */
    await app.inject({ method: 'PUT', url: '/api/admin/v1/campaigns/c_deal_a/deals', payload: { dealIds: ['PMP-4'] } })
    expect(await view('c_deal_a')).toMatchObject({ dealIds: ['PMP-1', 'PMP-4'] })
    await app.inject({ method: 'PUT', url: '/api/admin/v1/campaigns/c_deal_a/deals', payload: { dealIds: [] } })
    expect(await view('c_deal_a')).toMatchObject({ dealIds: ['PMP-1'] })
    /* The campaign list carries the set too. */
    const list = (await app.inject({ method: 'GET', url: '/api/admin/v1/campaigns' })).json().items as { campaignId: string; dealIds?: string[] }[]
    expect(list.find((c) => c.campaignId === 'c_api_swisse_kids')?.dealIds).toEqual(['PMP-3', 'PMP-4'])
    /* Bad input is refused. */
    for (const dealIds of ['PMP-1', [5], ['']]) expect((await app.inject({ method: 'PUT', url: '/api/admin/v1/campaigns/c_deal_a/deals', payload: { dealIds } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'PUT', url: '/api/admin/v1/campaigns/nope/deals', payload: { dealIds: [] } })).statusCode).toBe(404)
  })

  it('B11 the advertiser sets deals on its own campaign through the Partner API', async () => {
    const { app, view } = await dealSetup()
    const res = await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: G, payload: { advertiserId: 'swisse', name: 'Swisse — Direct', displayTypeId: 'landscape', default: { pricingType: 'localised' } } })
    const id = res.json().campaignId as string
    const put = await app.inject({ method: 'PUT', url: `/api/v1/campaigns/${id}/deals`, headers: G, payload: { dealIds: ['PMP-7'] } })
    expect(put.statusCode).toBe(200)
    expectMatchesContract('PUT', '/v1/campaigns/{campaignId}/deals', 200, put.json())
    expect(put.json()).toMatchObject({ dealId: 'PMP-7', dealIds: ['PMP-7'] })
    expect(await view(id)).toMatchObject({ dealIds: ['PMP-7'], direct: true })
    /* Not another partner's. */
    expect((await app.inject({ method: 'PUT', url: `/api/v1/campaigns/${id}/deals`, headers: { authorization: 'Bearer poc-token-amazon-dsp' }, payload: { dealIds: ['X'] } })).statusCode).toBe(404)
  })

  it('B6 rejects one campaign with a reason and approves the rest of the deal', async () => {
    const { approve, view, reject } = await dealSetup()
    await reject('c_deal_b')
    const res = await approve(['c_deal_a', 'c_deal_c'])
    expect(res.statusCode).toBe(200)
    expect(await view('c_deal_b')).toMatchObject({ status: 'rejected', reason: 'Price in the artwork.', creativeId: null })
    expect(await view('c_deal_a')).toMatchObject({ status: 'approved', creativeId: res.json().creativeId })
  })

  it('B7 re-attaches a rejected-then-fixed campaign to the SAME creative ID, minting none', async () => {
    const { ctx, approve, view, reject, creativeIds } = await dealSetup()
    await reject('c_deal_b')
    const { creativeId } = (await approve(['c_deal_a', 'c_deal_c'])).json()
    await ctx.approvals.unreject('c_deal_b', 'v1', 'HQ Admin (POC)')
    /* The deal has exactly one ID, which is what the picker pre-highlights. */
    expect((await creativeIds('?advertiserId=swisse&dealId=PMP-1')).map((g) => g.creativeId)).toEqual([creativeId])
    const again = await approve(['c_deal_b'], creativeId)
    expect(again.json().creativeId).toBe(creativeId)
    expect(await view('c_deal_b')).toMatchObject({ status: 'approved', creativeId })
    expect(await creativeIds('?advertiserId=swisse')).toHaveLength(1)
  })

  it('B8 offers several IDs, with none pre-highlightable, when the deal has more than one', async () => {
    const { approve, creativeIds } = await dealSetup()
    await approve(['c_deal_a'])
    await approve(['c_deal_b'])
    expect(await creativeIds('?advertiserId=swisse&dealId=PMP-1')).toHaveLength(2)
  })

  it('B9 keeps its own creative ID when an approved deal campaign is edited and resubmitted', async () => {
    const { ctx, approve, view } = await dealSetup()
    const { creativeId } = (await approve(['c_deal_a'])).json()
    ctx.db.prepare("INSERT INTO campaign_assets (id, campaign_id, version, role, file, mime_type, width, height, size_bytes, created_at) VALUES (?, 'c_deal_a', 2, 'default', 'x.png', 'image/png', 1080, 1920, 1, ?)")
      .run(randomUUID(), NOW.toISOString())
    await ctx.approvals.changed('c_deal_a', 'Swisse')
    expect(await view('c_deal_a')).toMatchObject({ status: 'awaiting_approval', pendingEdit: true, creativeId, dealId: 'PMP-1' })
    expect((await approve(['c_deal_a'], creativeId)).json().creativeId).toBe(creativeId)
  })
})

/* Direct flow A5: a rejected campaign carries the reason and, never having
   been approved, has no creative ID; HQ then approves the fixed one afresh. */
describe('Direct flow: reject then fix', () => {
  it('a rejected campaign has no creative ID and can be approved after resubmission', async () => {
    const { ctx, app, approve, view, version } = await setup()
    await ctx.approvals.reject('c_api_swisse', await version('c_api_swisse'), 'HQ Admin (POC)', 'Price in artwork')
    const rejected = await app.inject({ method: 'GET', url: '/api/v1/campaigns/c_api_swisse/status', headers: G })
    expect(rejected.json()).toMatchObject({ status: 'rejected', reason: 'Price in artwork', creativeId: null })
    await ctx.approvals.unreject('c_api_swisse', 'v1', 'HQ Admin (POC)')
    const res = await approve(['c_api_swisse'])
    expect(res.statusCode).toBe(200)
    expect((await view('c_api_swisse')).creativeId).toBe(res.json().creativeId)
  })
})
