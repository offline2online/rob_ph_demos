/* Run 12 — Red Bull, a direct advertiser, end to end (ticket dmcbOIDGV3FnBQ66KYIb; Rob's flow of 22 Oct 2026).
   The AWS demo flow for demo path 3, steps 1 to 12, one test per step, in order: the tests share one harness because
   each step builds on the one before. Walkthrough for a person: docs/dsp-integration/AWS-DEMO-TEST-FLOW.md section G.

   Tested at the seams. PH Core (the advertiser's login, "Launch a New Campaign", the Campaign Brief page, playback) and the
   Live Visitor Profile project's Visitor API are stubbed at their interfaces (platform/CampaignSource.ts, platform/VisitorSource.ts,
   api/PH-CORE-BOUNDARIES.md, shared/interface-contract.md); no stand-in UI is built here. Nothing reaches the network (harness.ts). */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { runAuction } from '../../src/exchange/auction'
import { memoryVisitorSource } from '../../src/platform/VisitorSource'
import { selectVersion } from '../../src/domain/versionSelection'
import { SEED_DISPLAY_TYPES } from '../../src/seed/seed'
import { png } from '../media'
import { DT, DT_B, POS, POS_B, day, fixture, harness, type Harness } from './harness'

const DEALS = '/api/admin/v1/buyers-lists'
const INV = '/api/admin/v1/available-inventory'
const iso = (n: number) => day(n).toISOString()
const SEGMENT = 'loves_energy_drinks'
const DT_C = 'e2e_kiosk'

let h: Harness
const state: { deal?: { id: string; dealId: string }; defaultId?: string; targetedId?: string } = {}
const assign = (slots: { dt: string; ids: string[] }[]) =>
  h.app.inject({ method: 'PUT', url: INV, payload: { items: slots.map((s) => ({ displayTypeId: s.dt, slot: 1, floorCpm: null, assignedTo: { buyersListIds: s.ids } })) } })
const dealsOf = async () => (await h.app.inject({ url: `/api/admin/v1/advertisers/red-bull/deals?at=${iso(2)}` })).json().items as { dealId: string; dealType: string; touchPoints: string[]; name: string }[]

/* PH Core's side of "Launch a New Campaign": the campaign is created in the campaign system, its creative uploaded, submitted for review. */
async function launchCampaign(name: string, displayTypeId: string, targeting: unknown, pricingType: 'default' | 'personalised', brief: Record<string, unknown>, versions: string[]) {
  const c = await h.ctx.campaigns.createCampaign({ id: `c_${name.replace(/\W+/g, '_').toLowerCase()}`, name, targeting, source: 'api', advertiserId: 'red-bull', partnerId: 'direct', displayTypeId, pricingType, brief: brief as never })
  for (const role of ['default', ...versions]) {
    const bytes = png(1920, 1080, role.length)
    const file = await h.ctx.assets.put(bytes, 'png')
    await h.ctx.campaigns.addAsset({ id: `a_${c.campaignId}_${role}`, campaignId: c.campaignId, role, file, mimeType: 'image/png', width: 1920, height: 1080, durationSec: null, bitrateKbps: null, sizeBytes: bytes.length })
  }
  await h.ctx.approvals.submit(c.campaignId, [], 'Red Bull user')
  return c.campaignId
}

beforeAll(async () => {
  h = await harness()
  /* The estate before the flow: two advertiser slots (the fixture's two Digital Signage display types). */
  await fixture(h.ctx, { second: true })
})
afterAll(() => vi.unstubAllGlobals())

describe('Run 12 — Red Bull direct advertiser demo flow, end to end', () => {
  it('1 — a new Direct advertiser (Red Bull) and an invited Red Bull advertiser user', async () => {
    expect((await h.app.inject({ method: 'POST', url: '/api/admin/v1/advertisers/direct', payload: { name: 'Red Bull' } })).statusCode).toBe(201)
    const res = await h.app.inject({ method: 'POST', url: '/api/admin/v1/users', payload: { firstName: 'Wings', lastName: 'Buyer', email: 'wings@redbull.example', role: 'Advertiser', advertiserId: 'red-bull', invite: true } })
    expect(res.statusCode).toBe(201)
    /* Linked to the advertiser, marked invited: PH Core sends the invite email and the user sets a password on first login. */
    expect(res.json()).toMatchObject({ email: 'wings@redbull.example', role: 'Advertiser', advertiserId: 'red-bull', advertiserName: 'Red Bull', advertiserDirect: true, invited: true, lastLoginAt: null })
  })

  it('2 — a Direct advertiser deal for Red Bull with a 30-day flight', async () => {
    const created = await h.app.inject({ method: 'POST', url: DEALS, payload: { name: 'Red Bull — 30 days', dealType: 'direct', invitedBuyers: [{ partnerId: 'direct', seatId: 'red-bull' }], activeFrom: iso(1), activeTo: iso(30), floorCpm: 150, status: 'draft' } })
    expect(created.statusCode).toBe(201)
    const deal = created.json() as { id: string; dealId: string }
    expect(deal.dealId).toMatch(/^PH-[A-Z0-9]{10}$/)
    state.deal = deal
    /* Finalise needs a slot to reserve: until the deal is assigned (step 3) it is refused, and the refusal says so. */
    const early = await h.app.inject({ method: 'POST', url: `${DEALS}/${deal.id}/share` })
    expect(early.statusCode).toBe(400)
    expect(JSON.stringify(early.json())).toMatch(/Assign this deal to at least one slot/)
    /* 21 Sep to 20 Oct 2026 inclusive: 30 days. */
    expect((day(30).getTime() - day(1).getTime()) / 86_400_000 + 1).toBe(30)
  })

  it('3 — the deal is assigned to 2 existing advertiser slots, then finalised', async () => {
    const res = await assign([{ dt: DT, ids: [state.deal!.id] }, { dt: DT_B, ids: [state.deal!.id] }])
    expect(res.statusCode).toBe(200)
    const fin = await h.app.inject({ method: 'POST', url: `${DEALS}/${state.deal!.id}/share` })
    expect(fin.statusCode).toBe(200)
    expect(fin.json()).toMatchObject({ status: 'shared', deals: [] })
    for (const dt of [DT, DT_B]) expect((await h.ctx.displayTypes.get(dt))!.phExtensions!.slots[0]).toMatchObject({ listMode: 'deal', buyersListIds: [state.deal!.id] })
    expect((await dealsOf())[0].touchPoints).toEqual(['Digital Signage'])
  })

  it('4 — a new Display Type (Kiosk) with a new advertiser slot', async () => {
    const base = SEED_DISPLAY_TYPES[0]
    await h.ctx.playlists.create({ id: `pl_${DT_C}`, name: 'E2E Kiosk Playlist', autoCreatedFor: DT_C, items: [{ id: `pi_${DT_C}`, campaignId: 'c_notice', priority: 1, playbackDuration: 30, campaignType: ['LOCALISED', 'ON_ROTATION'], enabled: true }] })
    /* The record first, then its slots (Display Types → the slot editor). */
    const res = await h.app.inject({
      method: 'POST', url: '/api/admin/v1/display-types',
      payload: { ...base, id: DT_C, name: 'E2E Kiosk', touchPoint: 'Kiosk', displayCanvasSize: { width: 1080, height: 1920 }, defaultPlaylistId: `pl_${DT_C}`, playlistSettings: { ...base.playlistSettings, maximumCampaignsPlayedInRotation: 1 }, multiZone: { enabled: false, zones: [] } },
    })
    expect(res.statusCode).toBe(201)
    const ext = await h.app.inject({
      method: 'PUT', url: `/api/admin/v1/display-types/${DT_C}/extensions`,
      payload: { slots: [{ label: 'Advertiser slot', owner: 'advertiser', partnerIds: [], advertisers: [], listMode: null, buyersListId: null, storeScope: null, quota: null }], venue: { openOohVenueType: 'retail.grocery', orientation: 'portrait', loopLengthSec: 30 } },
    })
    expect(ext.statusCode).toBe(200)
    h.ctx.db.prepare('INSERT INTO audience_vacd (display_type_id, slot, assumed_views_per_window, counted) VALUES (?, ?, ?, ?)').run(DT_C, 1, 400, 1)
    expect((await h.ctx.displayTypes.get(DT_C))!.phExtensions!.slots[0]).toMatchObject({ owner: 'advertiser' })
  })

  it('5 — the new slot is added to the same Red Bull deal; the deal now covers 3 slots', async () => {
    /* A slot never names an advertiser: "assign the slot to Red Bull" means adding it to Red Bull's deal. */
    const res = await assign([{ dt: DT, ids: [state.deal!.id] }, { dt: DT_B, ids: [state.deal!.id] }, { dt: DT_C, ids: [state.deal!.id] }])
    expect(res.statusCode).toBe(200)
    const onDeal = (await h.ctx.displayTypes.list()).flatMap((d) => (d.phExtensions?.slots ?? []).filter((s) => s.buyersListIds?.includes(state.deal!.id)).map(() => d.id))
    expect(onDeal.sort()).toEqual([DT, DT_B, DT_C].sort())
  })

  it('6 — the advertiser logs in (PH Core) and is scoped to Red Bull', async () => {
    /* The demo runs inside the flight: it is 22 Sep, 01:00 UTC. */
    h.setNow(new Date(day(1).getTime() + 3_600_000))
    /* PH Core owns login and "Launch a New Campaign"; this build gives it the user's scope. */
    const scope = (await h.app.inject({ url: '/api/admin/v1/users/wings@redbull.example/scope' })).json()
    expect(scope).toMatchObject({ role: 'Advertiser', advertiser: { advertiserId: 'red-bull', name: 'Red Bull', direct: true }, campaigns: [] })
  })

  it('7 — the Campaign Brief deal-ID picker lists exactly one deal: Red Bull’s PH- deal ID', async () => {
    await h.app.inject({ method: 'POST', url: '/api/admin/v1/advertisers/direct', payload: { name: 'Gatorade' } })
    const items = await dealsOf()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ dealId: state.deal!.dealId, dealType: 'direct', name: 'Red Bull — 30 days' })
    expect(items[0].dealId).toMatch(/^PH-/)
    /* Another advertiser sees none of it. */
    expect((await h.app.inject({ url: `/api/admin/v1/advertisers/gatorade/deals?at=${iso(2)}` })).json().items).toEqual([])
  })

  it('8 — only the deal’s touch points are offered, and a campaign naming another is refused (400)', async () => {
    expect((await dealsOf())[0].touchPoints).toEqual(['Digital Signage', 'Kiosk'])
    const bad = await launchCampaign('Red Bull — website', DT, { default: { pricingType: 'default' } }, 'default', { touchPoints: ['Website'] }, [])
    const refused = await h.app.inject({ method: 'PUT', url: `/api/admin/v1/campaigns/${bad}/deals`, payload: { dealIds: [state.deal!.dealId] } })
    expect(refused.statusCode).toBe(400)
    expect(JSON.stringify(refused.json())).toMatch(/does not cover Website.*Digital Signage, Kiosk/)
    const ok = await launchCampaign('Red Bull — signage', DT, { default: { pricingType: 'default' } }, 'default', { touchPoints: ['Digital Signage'] }, [])
    expect((await h.app.inject({ method: 'PUT', url: `/api/admin/v1/campaigns/${ok}/deals`, payload: { dealIds: [state.deal!.dealId] } })).statusCode).toBe(200)
    await h.ctx.campaigns.deleteCampaign(bad)
    await h.ctx.campaigns.deleteCampaign(ok)
  })

  it('9 — a Default campaign and a Targeted campaign (loves_energy_drinks), each carrying the deal ID', async () => {
    const targeting = {
      default: { pricingType: 'default' },
      targeted: [{ id: 'v_energy', priority: 1, pricingType: 'personalised', rules: [[{ source: 'visitor', variable: 'visitor.visitor_segments', op: 'include', values: [SEGMENT] }]] }],
    }
    state.defaultId = await launchCampaign('Red Bull — Default', DT, { default: { pricingType: 'default' } }, 'default', { touchPoints: ['Digital Signage'] }, [])
    state.targetedId = await launchCampaign('Red Bull — Targeted', DT_B, targeting, 'personalised', { touchPoints: ['Digital Signage'] }, ['v_energy'])
    for (const id of [state.defaultId, state.targetedId]) {
      expect((await h.app.inject({ method: 'PUT', url: `/api/admin/v1/campaigns/${id}/deals`, payload: { dealIds: [state.deal!.dealId] } })).statusCode).toBe(200)
    }
    const listed = (await h.app.inject({ url: '/api/admin/v1/campaigns' })).json().items as { campaignId: string; dealIds?: string[] }[]
    for (const id of [state.defaultId, state.targetedId]) expect(listed.find((c) => c.campaignId === id)!.dealIds).toEqual([state.deal!.dealId])
  })

  it('10 — both campaigns are approved for Red Bull (Campaign Approval)', async () => {
    for (const id of [state.defaultId!, state.targetedId!]) {
      expect((await h.ctx.approvals.view(id)).status).toBe('awaiting_approval')
      const res = await h.admin.approve(id, (await h.ctx.approvals.view(id)).assetVersion ?? 'v1')
      expect(res.statusCode).toBe(200)
      expect((await h.admin.activate(id)).statusCode).toBe(200)
      expect((await h.ctx.approvals.view(id)).status).toBe('approved')
    }
  })

  it('11 — the Default campaign plays immediately: the deal’s window is booked for it, handed off, with no bid request', async () => {
    h.setNow(new Date(day(2).getTime() + 3_600_000))
    const out = await runAuction(h.ctx, day(2))
    expect(h.bidder.log.bidRequests).toHaveLength(0)
    const pos = out.positions.find((p) => p.positionId === POS)!
    expect(pos.bidRequests).toBe(0)
    expect(pos.winner).toMatchObject({ advertiserId: 'red-bull' })
    const rows = await h.rows(day(2), POS)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'reserved', partnerId: 'direct', campaignId: state.defaultId, clearingCpm: 150 })
    expect(rows[0].handedOffAt).not.toBeNull()
    expect(h.campaigns.handoffs.filter((b) => b.campaignId === state.defaultId && b.windowStart === iso(2))).toHaveLength(1)
    expect(h.campaigns.refusedBookings).toHaveLength(0)
  })

  it('12 — the segment loves_energy_drinks is pushed for a visitor and the Targeted advert plays its personalised version', async () => {
    /* The Targeted campaign took the deal’s window on its own slot (a campaign belongs to one display type). */
    const rows = await h.rows(day(2), POS_B)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'reserved', campaignId: state.targetedId })
    const booking = (await h.ctx.campaigns.bookings(state.targetedId)).find((b) => b.windowStart === iso(2))!
    expect(booking.personalisedEligible).toBe(true)
    /* Visitor Profile pushes the segment; PH Core’s player reads it and picks the version of the booked campaign. */
    const visitors = memoryVisitorSource()
    const playFor = async (visitorId: string) => selectVersion((await h.ctx.campaigns.getCampaign(booking.campaignId))!.targeting, await visitors.source.segmentsFor(visitorId))
    expect(await playFor('visitor-1')).toEqual({ versionId: 'default', tier: 'default' })
    visitors.push('visitor-1', [SEGMENT])
    expect(await playFor('visitor-1')).toEqual({ versionId: 'v_energy', tier: 'personalised' })
    /* Someone else in front of the screen still gets the default. */
    visitors.push('visitor-2', ['new_parent'])
    expect(await playFor('visitor-2')).toEqual({ versionId: 'default', tier: 'default' })
    /* The version the play shows is one the booking was handed with an approved creative. */
    expect((await h.ctx.campaigns.latestAssets(state.targetedId!, booking.assetVersion ?? undefined)).map((a) => a.role).sort()).toEqual(['default', 'v_energy'])
  })
})
