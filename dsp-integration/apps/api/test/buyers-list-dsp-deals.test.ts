/* Ticket fgBVnNItNcu7qMBUtqH7: one buyers list, one deal ID per invited DSP. */
import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/http/app'
import { testContext } from './helpers'

const URL = '/api/admin/v1/buyers-lists'
const base = { name: 'Cross-DSP', description: '', activeFrom: null, activeTo: null }
/* The fixture has one connected DSP; a second makes the list cross-DSP. */
async function twoDsps(ctx: Awaited<ReturnType<typeof testContext>>) {
  if (!(await ctx.partners.get('p_ttd'))) {
    await ctx.partners.insert({
      id: 'p_ttd', provider: 'the_trade_desk', name: 'The Trade Desk', status: 'connected', mode: 'live', lastSync: null,
      credsPublic: { supplySourceId: 'ss-e2e', ttdPartnerId: 'phub-retail', region: 'APAC' }, secrets: { apiToken: 'e2e-placeholder' },
      bidder: { bidderEndpoint: 'http://localhost/ttd', seatIds: ['ttd-seat'] },
      seats: [{ id: 'ttd-adv-1', name: 'Arnott’s', domain: 'arnotts.com' }], listsLinked: true, allowList: [], blockList: [], categoryAllowList: [], categoryBlockList: [],
    } as never)
  }
  return (await ctx.partners.list()).filter((p) => p.seats.length && p.status === 'connected')
}
const seat = (partnerId: string, seatId: string) => ({ partnerId, seatId })

describe('Buyers list deal ID per DSP', () => {
  it('mints one deal per DSP named, retires the last seat of a DSP, and keeps the ID on re-invite', async () => {
    const ctx = await testContext()
    const [a, b] = await twoDsps(ctx)
    const app = buildApp(ctx)
    const created = (await app.inject({ method: 'POST', url: URL, payload: { ...base, invitedBuyers: [seat(a.id, a.seats[0].id), seat(a.id, a.seats[1]?.id ?? a.seats[0].id), seat(b.id, b.seats[0].id)] } })).json()
    expect(created.deals.map((d: { partnerId: string }) => d.partnerId).sort()).toEqual([a.id, b.id].sort())
    const dealA = created.deals.find((d: { partnerId: string }) => d.partnerId === a.id).dealId
    const dealB = created.deals.find((d: { partnerId: string }) => d.partnerId === b.id).dealId
    expect(dealA).not.toBe(dealB)
    expect(created.dealId).toBe(created.deals[0].dealId)
    const put = (invitedBuyers: unknown[]) => app.inject({ method: 'PUT', url: `${URL}/${created.id}`, payload: { ...base, invitedBuyers } }).then((r) => r.json())

    const withoutB = await put([seat(a.id, a.seats[0].id)])
    expect(withoutB.deals.find((d: { partnerId: string }) => d.partnerId === b.id).retiredAt).not.toBeNull()
    expect(withoutB.deals.find((d: { partnerId: string }) => d.partnerId === a.id)).toMatchObject({ dealId: dealA, retiredAt: null })

    const back = await put([seat(a.id, a.seats[0].id), seat(b.id, b.seats[0].id)])
    expect(back.deals.find((d: { partnerId: string }) => d.partnerId === b.id)).toMatchObject({ dealId: dealB, retiredAt: null })
  })

  it('each DSP is asked, and held to, its own deal ID', async () => {
    const ctx = await testContext()
    const [a, b] = await twoDsps(ctx)
    const l = await ctx.buyersLists.insert({ id: 'bl_x', name: 'x', description: '', invitedBuyers: [seat(a.id, a.seats[0].id), seat(b.id, b.seats[0].id)], activeFrom: null, activeTo: null, auctionCloses: null })
    const idA = await ctx.buyersLists.dealIdFor(l.id, a.id)
    const idB = await ctx.buyersLists.dealIdFor(l.id, b.id)
    expect(idA).not.toBe(idB)
    expect(l.deals.map((d) => d.dealId).sort()).toEqual([idA, idB].sort())
    /* A DSP admitted by category, not a named seat, mints its own on first use and is stable. */
    const c = await ctx.buyersLists.dealIdFor(l.id, 'p_other')
    expect(c).not.toBe(idA)
    expect(await ctx.buyersLists.dealIdFor(l.id, 'p_other')).toBe(c)
  })

  it('the database refuses to change a per-DSP deal ID', async () => {
    const ctx = await testContext()
    const [a] = await twoDsps(ctx)
    const l = await ctx.buyersLists.insert({ id: 'bl_y', name: 'y', description: '', invitedBuyers: [seat(a.id, a.seats[0].id)], activeFrom: null, activeTo: null, auctionCloses: null })
    await expect(Promise.resolve().then(() => ctx.db.exec(`UPDATE buyers_list_deals SET deal_id = 'PH-NEW' WHERE list_id = '${l.id}'`))).rejects.toThrow(/cannot be changed/)
  })
})
