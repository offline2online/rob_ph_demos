/* The deals an advertiser may associate a campaign with (ticket IQndewUPKJHbHRR2hAgG):
   the buyers lists whose invited buyers include a DSP seat mapped to the advertiser
   (ticket T0gLfo2zDrRXPVGcvEoL), resolved against what each DSP has synced now. The
   deal ID on a campaign is a reference to one of these lists' platform-minted deal
   IDs (ticket 5CCgGEYSkVoDTH9yNSYu), never free text. A direct advertiser maps no
   seats; its deals are the live Direct advertiser deals it is the buyer of (ticket
   knqu0B2PGTF9PG1EUWYD, 22 Oct 2026), carrying the internal PH deal ID. */
import { DIRECT_PARTNER_ID, assignedOf, type BuyersList } from '@ph-dsp/types'
import type { Context } from '../context'
import { dealsForSeats } from './buyersLists'
import { isActiveAt } from '../billing/term'
import { validationFailed } from '../http/errors'

/* A direct advertiser's own deals: Direct advertiser deals it is the named buyer of, finalised (live) and with a delivery term covering `at`. Nobody else's. */
async function directDeals(ctx: Pick<Context, 'company' | 'buyersLists'>, advertiserId: string, at: string): Promise<BuyersList[] | null> {
  if (!(await ctx.company.directAdvertisers()).some((d) => d.advertiserId === advertiserId)) return null
  return (await ctx.buyersLists.list()).filter((l) => l.dealType === 'direct' && l.status === 'shared' && isActiveAt(l, at) && l.invitedBuyers.some((b) => b.partnerId === DIRECT_PARTNER_ID && b.seatId === advertiserId))
}

export async function invitedDeals(ctx: Pick<Context, 'company' | 'partners' | 'buyersLists'>, advertiserId: string, at: string): Promise<BuyersList[]> {
  const direct = await directDeals(ctx, advertiserId, at)
  if (direct) return direct
  const mapped = (await ctx.company.advertiserSeats())[advertiserId] ?? []
  if (!mapped.length) return []
  const partners = new Map((await ctx.partners.list()).map((p) => [p.id, p]))
  const live = mapped.filter((m) => { const p = partners.get(m.partnerId); return p?.status === 'connected' && p.seats.some((s) => s.id === m.seatId) })
  return dealsForSeats(await ctx.buyersLists.list(), live, at)
}

/* Per list, the deal ID(s) this advertiser's mapped DSPs accept (ticket fgBVnNItNcu7qMBUtqH7): a list has one deal ID per DSP, and an advertiser holds seats on one or more of them, so only those are its to use. */
export async function invitedDealIds(ctx: Pick<Context, 'company' | 'partners' | 'buyersLists'>, advertiserId: string, at: string): Promise<{ list: BuyersList; deals: { partnerId: string; dealId: string }[] }[]> {
  const direct = await directDeals(ctx, advertiserId, at)
  if (direct) return direct.map((list) => ({ list, deals: [{ partnerId: DIRECT_PARTNER_ID, dealId: list.dealId }] }))
  const partnerIds = new Set(((await ctx.company.advertiserSeats())[advertiserId] ?? []).map((m) => m.partnerId))
  return (await invitedDeals(ctx, advertiserId, at)).map((list) => ({ list, deals: list.deals.filter((d) => partnerIds.has(d.partnerId) && !d.retiredAt).map(({ partnerId, dealId }) => ({ partnerId, dealId })) }))
}

/* Refuse any deal ID not among the advertiser's invited deals. `held` are IDs the campaign already carries, which stay valid even once the deal's term has ended. */
export async function assertInvitedDeals(ctx: Pick<Context, 'company' | 'partners' | 'buyersLists'>, advertiserId: string | null | undefined, field: string, dealIds: string[], held: string[], at: string): Promise<void> {
  const wanted = dealIds.filter((d) => !held.includes(d))
  if (!wanted.length) return
  const allowed = new Set((await invitedDealIds(ctx, advertiserId ?? '', at)).flatMap((e) => e.deals.map((d) => d.dealId)))
  const bad = wanted.filter((d) => !allowed.has(d))
  if (bad.length) throw validationFailed([{ field, reason: allowed.size
    ? `Not a deal this advertiser is an invited buyer on: ${bad.join(', ')}.`
    : 'This advertiser has no private-auction deals, so a campaign cannot carry a deal ID.' }])
}

/* A deal's touch points (Rob, 22 Oct 2026, ticket dmcbOIDGV3FnBQ66KYIb): the touch points of the display types
   of the slots the deal is assigned to. PH Core's Campaign Brief offers only these for a campaign on the deal. */
export async function dealTouchPoints(ctx: Pick<Context, 'displayTypes'>): Promise<Map<string, string[]>> {
  const byList = new Map<string, Set<string>>()
  for (const dt of await ctx.displayTypes.list()) {
    for (const s of dt.phExtensions?.slots ?? []) {
      for (const id of assignedOf(s).buyersListIds) (byList.get(id) ?? byList.set(id, new Set()).get(id)!).add(dt.touchPoint)
    }
  }
  return new Map([...byList].map(([id, set]) => [id, [...set].sort()]))
}

/* Refuse a campaign whose brief names a touch point the deal does not cover (400). A brief with none names nothing to refuse. */
export async function assertDealTouchPoints(ctx: Pick<Context, 'company' | 'partners' | 'buyersLists' | 'displayTypes'>, advertiserId: string | null | undefined, dealIds: string[], touchPoints: string[] | undefined, at: string): Promise<void> {
  if (!dealIds.length || !touchPoints?.length) return
  const byList = await dealTouchPoints(ctx)
  const entries = (await invitedDealIds(ctx, advertiserId ?? '', at)).filter((e) => e.deals.some((d) => dealIds.includes(d.dealId)))
  for (const e of entries) {
    const offered = byList.get(e.list.id) ?? []
    /* A deal on no slot yet has no touch points to compare with (a private auction can be authored against before it is assigned): nothing to refuse. */
    if (!offered.length) continue
    const bad = touchPoints.filter((t) => !offered.includes(t))
    if (bad.length) throw validationFailed([{ field: 'brief.touchPoints', reason: `${e.list.name} (${e.deals[0].dealId}) does not cover ${bad.join(', ')}; its touch points are ${offered.join(', ')}.` }])
  }
}
