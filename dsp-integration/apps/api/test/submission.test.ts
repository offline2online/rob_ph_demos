import { describe, expect, it } from 'vitest'
import { readMedia } from '../src/domain/media'
import { buildApp } from '../src/http/app'
import { expectMatchesContract } from './contract'
import { testContext } from './helpers'
import { jpeg, mp4, multipart, png } from './media'

const GOOGLE = { authorization: 'Bearer poc-token-google-dv360' }
const AMAZON = { authorization: 'Bearer poc-token-amazon-dsp' }

const newApp = async (flag = true) => {
  const ctx = await testContext({ flag })
  return { ctx, app: buildApp(ctx) }
}
type App = Awaited<ReturnType<typeof newApp>>['app']

const create = (app: App, body: Record<string, unknown>, headers = GOOGLE) => app.inject({ method: 'POST', url: '/api/v1/campaigns', headers, payload: body })
const upload = (app: App, id: string, version: string, bytes: Buffer, headers = GOOGLE) => {
  const m = multipart({ version }, { name: 'creative.bin', bytes })
  return app.inject({ method: 'POST', url: `/api/v1/campaigns/${id}/assets`, headers: { ...headers, ...m.headers }, payload: m.payload })
}
const submit = (app: App, id: string, headers = GOOGLE) => app.inject({ method: 'POST', url: `/api/v1/campaigns/${id}/submit`, headers })
const status = (app: App, id: string, headers = GOOGLE) => app.inject({ method: 'GET', url: `/api/v1/campaigns/${id}/status`, headers })

const SWISSE = { advertiserId: 'swisse', name: 'Swisse — Sleep', displayTypeId: 'landscape', baseline: { pricingType: 'localised' } }

describe('media reader', () => {
  it('reads type and size from the bytes, and duration from an MP4', () => {
    expect(readMedia(png(1920, 1080))).toMatchObject({ kind: 'png', width: 1920, height: 1080, durationSec: null })
    expect(readMedia(jpeg(1080, 1920))).toMatchObject({ kind: 'jpeg', width: 1080, height: 1920 })
    expect(readMedia(mp4(5760, 1080, 12.5))).toMatchObject({ kind: 'mp4', width: 5760, height: 1080, durationSec: 12.5 })
    expect(readMedia(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull()
  })
})

describe('POST /v1/campaigns', () => {
  it('creates a Draft campaign: a baseline plus prioritised targeted versions', async () => {
    const { app, ctx } = await newApp()
    const res = await create(app, {
      ...SWISSE,
      targeted: [{ id: 'metro', priority: 10, pricingType: 'localised', rules: [[{ source: 'store', variable: 'store.fixed_segments', op: 'include', values: ['Metro'] }]] }],
    })
    expect(res.statusCode).toBe(201)
    expectMatchesContract('POST', '/v1/campaigns', 201, res.json())
    expect(res.json()).toMatchObject({ status: 'draft', mode: null, reason: null, assetVersion: 'v0' })
    /* Stored in the existing targeting structure: AND groups of OR conditions. */
    const stored = ctx.campaigns.getCampaign(res.json().campaignId)
    expect(stored).toMatchObject({ source: 'api', advertiserId: 'swisse', partnerId: 'p_google', displayTypeId: 'landscape', pricingType: 'localised' })
    expect(stored?.targeting).toEqual({ baseline: { pricingType: 'localised' }, targeted: [{ id: 'metro', priority: 10, pricingType: 'localised', rules: [[{ source: 'store', variable: 'store.fixed_segments', op: 'include', values: ['Metro'] }]] }] })
  })

  /* The fallback is optional per advertiser (decision, 22 Sep): an
     advertiser may submit only localised targeted versions, with the
     fallback for unmatched stores left to the slot rather than this campaign. */
  it('creates a fallback-free campaign from targeted versions alone, and requires at least one', async () => {
    const { app, ctx } = await newApp()
    const res = await create(app, {
      advertiserId: 'swisse', name: 'Swisse — Metro only', displayTypeId: 'landscape',
      targeted: [{ id: 'metro', priority: 10, pricingType: 'localised', rules: [[{ source: 'store', variable: 'store.fixed_segments', op: 'include', values: ['Metro'] }]] }],
    })
    expect(res.statusCode).toBe(201)
    expectMatchesContract('POST', '/v1/campaigns', 201, res.json())
    const stored = ctx.campaigns.getCampaign(res.json().campaignId)
    expect(stored).toMatchObject({ pricingType: 'localised' })
    expect(stored?.targeting).toEqual({ targeted: [{ id: 'metro', priority: 10, pricingType: 'localised', rules: [[{ source: 'store', variable: 'store.fixed_segments', op: 'include', values: ['Metro'] }]] }] })

    const empty = await create(app, { advertiserId: 'swisse', name: 'Nothing at all', displayTypeId: 'landscape' })
    expect(empty.statusCode).toBe(400)
    expect(empty.json().error.details).toEqual([{ field: 'baseline', reason: 'Required unless at least one targeted version is submitted.' }])
  })

  it('rejects an advertiser that is not one of the DSP’s seats, and malformed versions', async () => {
    const { app } = await newApp()
    const res = await create(app, { advertiserId: 'loreal', name: '', baseline: { pricingType: 'premium' }, targeted: [{ id: 'baseline', priority: 1.5, pricingType: 'localised', rules: [] }] })
    expect(res.statusCode).toBe(400)
    expectMatchesContract('POST', '/v1/campaigns', 400, res.json())
    expect(res.json().error.details.map((d: { field: string }) => d.field)).toEqual(['advertiserId', 'name', 'baseline.pricingType', 'targeted[0].id', 'targeted[0].priority'])
  })

  it('names each variable the DSP may not target (422)', async () => {
    const { app } = await newApp()
    const res = await create(app, {
      ...SWISSE,
      targeted: [{ id: 'young', priority: 10, pricingType: 'personalised', rules: [[{ source: 'visitor', variable: 'visitor.age', op: 'less_than', values: ['30'] }], [{ source: 'visitor', variable: 'visitor.skus', op: 'include', values: ['SKU-1'] }, { source: 'visitor', variable: 'visitor.age', op: 'equal', values: ['25'] }]] }],
    })
    expect(res.statusCode).toBe(422)
    expectMatchesContract('POST', '/v1/campaigns', 422, res.json())
    expect(res.json().error).toMatchObject({ code: 'variable_not_permitted', details: [{ variable: 'visitor.age', reason: 'Not enabled for Google DSP.' }, { variable: 'visitor.skus', reason: 'Not enabled for Google DSP.' }] })
  })
})

describe('POST /v1/campaigns/{id}/assets — automated checks', () => {
  it('stores a creative that passes every check and returns the results', async () => {
    const { app } = await newApp()
    const id = (await create(app, SWISSE)).json().campaignId
    const res = await upload(app, id, 'baseline', png(1920, 1080))
    expect(res.statusCode).toBe(201)
    expectMatchesContract('POST', '/v1/campaigns/{campaignId}/assets', 201, res.json())
    expect(res.json().checks.map((c: { name: string; passed: boolean }) => [c.name, c.passed])).toEqual([
      ['file_type', true], ['file_size', true], ['bitrate', true], ['aspect_ratio', true], ['dimensions', true], ['duration', true],
    ])
    expect((await status(app, id)).json().assetVersion).toBe('v1')
  })

  it('returns failures immediately, with reasons, and keeps the file out of the queue', async () => {
    const { app } = await newApp()
    const id = (await create(app, SWISSE)).json().campaignId
    const small = await upload(app, id, 'baseline', png(800, 600))
    expect(small.statusCode).toBe(422)
    expectMatchesContract('POST', '/v1/campaigns/{campaignId}/assets', 422, small.json())
    expect(small.json().error.code).toBe('checks_failed')
    expect(small.json().error.details).toEqual([
      { field: 'aspect_ratio', reason: '800×600 for 1920×1080.' },
      { field: 'dimensions', reason: '800×600 is smaller than 1920×1080.' },
    ])
    const svg = await upload(app, id, 'baseline', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))
    expect(svg.json().error.details).toEqual([{ field: 'file_type', reason: 'Not a PNG, JPEG or MP4 file.' }])
    expect((await status(app, id)).json().assetVersion).toBe('v0')
  })

  it('checks a video’s duration against the slot, and accepts a zone-sized creative', async () => {
    const { app } = await newApp()
    const id = (await create(app, { ...SWISSE, displayTypeId: 'menu_board' })).json().campaignId
    /* Menu Board: 45s loop, 3 slots → 15s per slot; zones are 1918/1920/1918 × 1080. */
    const long = await upload(app, id, 'baseline', mp4(5760, 1080, 20))
    expect(long.json().error.details).toEqual([{ field: 'duration', reason: '20s; the slot is 15s.' }])
    expect((await upload(app, id, 'baseline', mp4(5760, 1080, 15))).statusCode).toBe(201)
    expect((await upload(app, id, 'baseline', jpeg(1920, 1080))).statusCode).toBe(201)
  })

  it('checks bitrate and file size against the limits', async () => {
    const { app, ctx } = await newApp()
    ctx.config.assetLimits = { maxImageBytes: 1000, maxVideoBytes: 100_000, maxBitrateKbps: 50 }
    const id = (await create(app, SWISSE)).json().campaignId
    const big = await upload(app, id, 'baseline', png(1920, 1080, 2000))
    expect(big.json().error.details[0]).toEqual({ field: 'file_size', reason: '2 KB; the limit is 1 KB.' })
    const fast = await upload(app, id, 'baseline', mp4(1920, 1080, 1, 20_000))
    expect(fast.json().error.details).toEqual([{ field: 'bitrate', reason: '162 kbps; the limit is 50 kbps.' }])
  })

  it('rejects an unknown version and hides other partners’ campaigns', async () => {
    const { app } = await newApp()
    const id = (await create(app, SWISSE)).json().campaignId
    const res = await upload(app, id, 'metro', png(1920, 1080))
    expect(res.statusCode).toBe(400)
    expect(res.json().error.details).toEqual([{ field: 'version', reason: 'One of baseline.' }])
    expect((await upload(app, id, 'baseline', png(1920, 1080), AMAZON)).statusCode).toBe(404)
    expect((await status(app, id, AMAZON)).statusCode).toBe(404)
    expect((await status(app, 'c_zinger')).statusCode).toBe(404)
  })

  /* A fallback-free campaign has no "baseline" version to upload against
     (decision, 22 Sep) — only its targeted version ids are accepted. */
  it('accepts only the targeted version ids on a fallback-free campaign, never "baseline"', async () => {
    const { app } = await newApp()
    const id = (await create(app, {
      advertiserId: 'swisse', name: 'Swisse — Metro only', displayTypeId: 'landscape',
      targeted: [{ id: 'metro', priority: 10, pricingType: 'localised', rules: [] }],
    })).json().campaignId
    const rejected = await upload(app, id, 'baseline', png(1920, 1080))
    expect(rejected.json().error.details).toEqual([{ field: 'version', reason: 'One of metro.' }])
    expect((await upload(app, id, 'metro', png(1920, 1080))).statusCode).toBe(201)
  })
})

describe('POST /v1/campaigns/{id}/submit and GET …/status', () => {
  it('needs a baseline creative', async () => {
    const { app } = await newApp()
    const id = (await create(app, SWISSE)).json().campaignId
    const res = await submit(app, id)
    expect(res.statusCode).toBe(422)
    expectMatchesContract('POST', '/v1/campaigns/{campaignId}/submit', 422, res.json())
    expect(res.json().error.details).toEqual([{ field: 'baseline_present', reason: 'Upload a creative for the baseline campaign.' }])
  })

  /* No baseline was submitted at all: the check instead needs creative on
     at least one targeted version (decision, 22 Sep). */
  it('needs creative on at least one targeted version, when there is no baseline', async () => {
    const { app } = await newApp()
    const id = (await create(app, {
      advertiserId: 'swisse', name: 'Swisse — Metro only', displayTypeId: 'landscape',
      targeted: [{ id: 'metro', priority: 10, pricingType: 'localised', rules: [] }],
    })).json().campaignId
    const bare = await submit(app, id)
    expect(bare.statusCode).toBe(422)
    expect(bare.json().error.details).toEqual([{ field: 'baseline_present', reason: 'No baseline was submitted — upload creative for at least one targeted version.' }])
    await upload(app, id, 'metro', png(1920, 1080))
    const res = await submit(app, id)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: 'awaiting_approval' })
  })

  it('goes to Awaiting approval when the advertiser requires approval; a second submit conflicts', async () => {
    const { app, ctx } = await newApp()
    const id = (await create(app, SWISSE)).json().campaignId
    await upload(app, id, 'baseline', png(1920, 1080))
    const res = await submit(app, id)
    expect(res.statusCode).toBe(200)
    expectMatchesContract('POST', '/v1/campaigns/{campaignId}/submit', 200, res.json())
    expect(res.json()).toEqual({ campaignId: id, status: 'awaiting_approval', mode: 'manual', reason: null, assetVersion: 'v1' })
    const approval = await ctx.approvals.view(id)
    expect(approval.checks.map((c) => c.name)).toEqual(['file_type', 'file_size', 'bitrate', 'aspect_ratio', 'dimensions', 'duration', 'baseline_present', 'targeting_permitted'])
    expect(approval.audit?.map((a) => [a.action, a.by])).toEqual([['submitted', 'Google DSP']])
    const again = await submit(app, id)
    expect(again.statusCode).toBe(409)
    expectMatchesContract('POST', '/v1/campaigns/{campaignId}/submit', 409, again.json())
    const st = await status(app, id)
    expectMatchesContract('GET', '/v1/campaigns/{campaignId}/status', 200, st.json())
    expect(st.json().status).toBe('awaiting_approval')
  })

  it('is approved automatically when the advertiser doesn’t require approval', async () => {
    const { app } = await newApp()
    const id = (await create(app, { ...SWISSE, advertiserId: 'nestle' })).json().campaignId
    await upload(app, id, 'baseline', png(1920, 1080))
    expect((await submit(app, id)).json()).toMatchObject({ status: 'approved', mode: 'auto' })
  })

  it('refuses a submit whose variables were switched off since the campaign was created', async () => {
    const { app } = await newApp()
    const id = (await create(app, { ...SWISSE, targeted: [{ id: 'metro', priority: 1, pricingType: 'localised', rules: [[{ source: 'store', variable: 'store.state', op: 'include', values: ['NSW'] }]] }] })).json().campaignId
    await upload(app, id, 'baseline', png(1920, 1080))
    await app.inject({ method: 'PUT', url: '/api/admin/v1/targeting-variables', payload: { access: { 'store.state': [] } } })
    const res = await submit(app, id)
    expect(res.statusCode).toBe(422)
    expect(res.json().error.details).toEqual([{ field: 'targeting_permitted', reason: 'Not enabled for Google DSP: store.state.' }])
  })

  it('a new creative on an approved campaign returns it to Awaiting approval and stops it (Q38)', async () => {
    const { app } = await newApp()
    const id = (await create(app, SWISSE)).json().campaignId
    await upload(app, id, 'baseline', png(1920, 1080))
    await submit(app, id)
    await app.inject({ method: 'POST', url: `/api/admin/v1/campaigns/${id}/approve`, payload: { assetVersion: 'v1' } })
    await app.inject({ method: 'PUT', url: `/api/admin/v1/campaigns/${id}/activation`, payload: { enabled: true } })
    await upload(app, id, 'baseline', png(3840, 2160))
    expect((await status(app, id)).json()).toMatchObject({ status: 'awaiting_approval', assetVersion: 'v2' })
    const list = (await app.inject({ method: 'GET', url: '/api/admin/v1/campaigns' })).json().items
    expect(list.find((c: { campaignId: string }) => c.campaignId === id).activation).toEqual({ enabled: false })
  })

  it('after a rejection the advertiser must upload a new version before resubmitting', async () => {
    const { app } = await newApp()
    const id = (await create(app, SWISSE)).json().campaignId
    await upload(app, id, 'baseline', png(1920, 1080))
    await submit(app, id)
    await app.inject({ method: 'POST', url: `/api/admin/v1/campaigns/${id}/reject`, payload: { assetVersion: 'v1', reason: 'Price in the artwork.' } })
    expect((await status(app, id)).json()).toMatchObject({ status: 'rejected', reason: 'Price in the artwork.' })
    expect((await submit(app, id)).statusCode).toBe(409)
    await upload(app, id, 'baseline', png(1920, 1080))
    expect((await submit(app, id)).json()).toMatchObject({ status: 'awaiting_approval', assetVersion: 'v2' })
  })

  it('404s with the flag off, and 401s without a token', async () => {
    const { app } = await newApp(false)
    expect((await create(app, SWISSE)).statusCode).toBe(404)
    const on = (await newApp()).app
    const res = await on.inject({ method: 'POST', url: '/api/v1/campaigns', payload: SWISSE })
    expect(res.statusCode).toBe(401)
    expectMatchesContract('POST', '/v1/campaigns', 401, res.json())
  })
})

describe('the campaign brief an advertiser books with (Rob, 20 Sep)', () => {
  const BRIEF = {
    details: 'Spring range across metro stores.', landingPageUrl: 'https://swisse.com/spring',
    promotedProducts: ['Ultiboost Immune'], skus: ['SKU-1', 'SKU-2'], targetAudiences: ['Health & fitness'],
    objective: 'Increase Revenue / Sales', touchPoints: ['Digital Signage'],
  }

  it('is stored with the campaign and shown to the retailer', async () => {
    const { app, ctx } = await newApp()
    const id = (await create(app, { ...SWISSE, brief: { ...BRIEF, details: '  Spring range across metro stores.  ' } })).json().campaignId
    expect(ctx.campaigns.getCampaign(id)?.brief).toEqual(BRIEF)
    const listed = (await app.inject({ method: 'GET', url: '/api/admin/v1/campaigns' })).json().items.find((c: { campaignId: string }) => c.campaignId === id)
    expect(listed.brief).toEqual(BRIEF)
    expectMatchesContract('GET', '/admin/v1/campaigns', 200, (await app.inject({ method: 'GET', url: '/api/admin/v1/campaigns' })).json())
  })

  it('is optional, and what is sent has to be the right shape', async () => {
    const { app, ctx } = await newApp()
    const none = (await create(app, SWISSE)).json().campaignId
    expect(ctx.campaigns.getCampaign(none)?.brief).toBeUndefined()
    const bad = await create(app, { ...SWISSE, brief: { details: 42, skus: ['ok', ''], touchPoints: ['Website'], budget: 1000 } })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error.details.map((d: { field: string }) => d.field)).toEqual(['brief.budget', 'brief.details', 'brief.skus', 'brief.touchPoints'])
  })
})
