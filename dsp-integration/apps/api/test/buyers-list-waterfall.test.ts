import { assignedOf } from '@ph-dsp/types'
import { describe, expect, it } from 'vitest'
import { allPositions } from '../src/domain/positions'
import { runAuction } from '../src/exchange/auction'
import { buildApp } from '../src/http/app'
import { NOW, mockDsps, testContext } from './helpers'

/* Prioritised buyers lists (Rob, 7 Oct 2026; Broadsign model): priority is a property of
   the slot's assignment, walked top-down, one list per tier. */
const W2 = new Date('2026-09-22T00:00:00.000Z')
const base = { description: '', activeFrom: null, activeTo: null, auctionCloses: null }

async function setup() {
  const mocks = mockDsps()
  const ctx = await testContext({ clock: () => NOW, dspFetch: mocks.fetchImpl })
  const app = buildApp(ctx)
  /* A invites a seat that bids nothing; B invites Nestlé's seat, which does. */
  await ctx.buyersLists.insert({ id: 'bl_a', name: 'Premium', ...base, invitedBuyers: [{ partnerId: 'p_google', seatId: '5130002' }] })
  await ctx.buyersLists.insert({ id: 'bl_b', name: 'Everyone else', ...base, invitedBuyers: [{ partnerId: 'p_google', seatId: '5130001' }] })
  const assign = async (slot: number, ids: string[]) => {
    const ext = (await ctx.displayTypes.get('menu_board'))!.phExtensions!
    await ctx.displayTypes.saveExtensions('menu_board', { ...ext, slots: ext.slots.map((s, i) => (i === slot - 1 ? { ...s, listMode: 'deal', buyersListId: ids[0], buyersListIds: ids } : s)) })
  }
  const activate = async () => {
    await runAuction(ctx, new Date('2026-09-21T00:00:00.000Z'))
    const id = (await ctx.approvalCampaigns.listCampaigns({ sources: ['dsp'] })).find((c) => c.name === 'Nestlé — crid-5130001')!.campaignId
    await app.inject({ method: 'POST', url: `/api/admin/v1/campaigns/${id}/approve`, payload: { assetVersion: 'v1' } })
    await app.inject({ method: 'PUT', url: `/api/admin/v1/campaigns/${id}/activation`, payload: { enabled: true } })
  }
  return { ctx, app, assign, activate }
}

describe('buyers-list waterfall', () => {
  it('falls through a tier with no valid bid, and stops at the first tier that has one', async () => {
    const { ctx, assign, activate } = await setup()
    await assign(2, ['bl_a', 'bl_b'])
    await activate()
    const out = await runAuction(ctx, W2)
    /* Tier 1 (Premium) asked, nobody invited bid; tier 2 asked and Nestlé won. */
    expect(out.positions[0].bidRequests).toBe(2)
    expect(out.positions[0].winner).toMatchObject({ advertiserId: 'nestle', clearingCpm: 150 })
  })

  it('does not ask a lower tier once a higher one has a winner', async () => {
    const { ctx, assign, activate } = await setup()
    await assign(2, ['bl_b', 'bl_a'])
    await activate()
    const out = await runAuction(ctx, W2)
    expect(out.positions[0].bidRequests).toBe(1)
    expect(out.positions[0].winner).toMatchObject({ advertiserId: 'nestle' })
  })

  it('persists the order per slot, and one list ranks differently on two slots', async () => {
    const { ctx, app } = await setup()
    const ext = (await ctx.displayTypes.get('menu_board'))!.phExtensions!
    await ctx.displayTypes.saveExtensions('menu_board', { ...ext, slots: [...ext.slots, { ...ext.slots.find((x) => x.owner === 'advertiser')!, label: 'Second supplier slot', buyersListId: null, buyersListIds: [] }] })
    const [p1, p2] = (await allPositions(ctx))
    expect(p2).toBeDefined()
    const put = (p: typeof p1, ids: string[]) => app.inject({
      method: 'PUT', url: '/api/admin/v1/available-inventory',
      payload: { items: [{ displayTypeId: p.displayType.id, slot: p.slot, assignedTo: { partnerIds: [], advertisers: [], whitelistOnly: false, buyersListId: ids[0], buyersListIds: ids } }] },
    })
    expect((await put(p1, ['bl_a', 'bl_b'])).statusCode).toBe(200)
    expect((await put(p2, ['bl_b', 'bl_a'])).statusCode).toBe(200)
    const after = await allPositions(ctx)
    expect(assignedOf(after.find((p) => p.positionId === p1.positionId)!.def).buyersListIds).toEqual(['bl_a', 'bl_b'])
    expect(assignedOf(after.find((p) => p.positionId === p2.positionId)!.def).buyersListIds).toEqual(['bl_b', 'bl_a'])
    expect((await put(p1, ['bl_a', 'bl_a'])).statusCode).toBe(400)
  })

  /* Ticket Y3GzIlj2goQMJaGUwTey (9 Oct 2026): deals and an explicit Open auction (DSPs, or All DSPs) share one slot. */
  it('keeps deals and an Open auction on one slot, and refuses it beside named advertisers', async () => {
    const { ctx, app } = await setup()
    const [p1] = await allPositions(ctx)
    const put = (assignedTo: object) => app.inject({ method: 'PUT', url: '/api/admin/v1/available-inventory', payload: { items: [{ displayTypeId: p1.displayType.id, slot: p1.slot, assignedTo }] } })
    const base = { advertisers: [], whitelistOnly: false, buyersListId: 'bl_a', buyersListIds: ['bl_a', 'bl_b'] }
    expect((await put({ ...base, partnerIds: ['p_google'], openAuction: true })).statusCode).toBe(200)
    let a = assignedOf((await allPositions(ctx)).find((p) => p.positionId === p1.positionId)!.def)
    expect(a).toMatchObject({ buyersListIds: ['bl_a', 'bl_b'], partnerIds: ['p_google'], openAuction: true })
    expect((await put({ ...base, partnerIds: [], openAuction: true })).statusCode).toBe(200)
    a = assignedOf((await allPositions(ctx)).find((p) => p.positionId === p1.positionId)!.def)
    expect(a).toMatchObject({ partnerIds: [], openAuction: true })
    const bad = await put({ ...base, partnerIds: [], advertisers: ['Nestlé'], openAuction: true })
    expect(bad.statusCode).toBe(400)
  })
})
