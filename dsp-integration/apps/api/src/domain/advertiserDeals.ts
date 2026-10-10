/* The deals an advertiser may associate a campaign with (ticket IQndewUPKJHbHRR2hAgG):
   the buyers lists whose invited buyers include a DSP seat mapped to the advertiser
   (ticket T0gLfo2zDrRXPVGcvEoL), resolved against what each DSP has synced now. The
   deal ID on a campaign is a reference to one of these lists' platform-minted deal
   IDs (ticket 5CCgGEYSkVoDTH9yNSYu), never free text. A direct advertiser maps no
   seats, so it has none: it has no deal relationship and the field does not apply. */
import type { BuyersList } from '@ph-dsp/types'
import type { Context } from '../context'
import { dealsForSeats } from './buyersLists'
import { validationFailed } from '../http/errors'

export async function invitedDeals(ctx: Pick<Context, 'company' | 'partners' | 'buyersLists'>, advertiserId: string, at: string): Promise<BuyersList[]> {
  const mapped = (await ctx.company.advertiserSeats())[advertiserId] ?? []
  if (!mapped.length) return []
  const partners = new Map((await ctx.partners.list()).map((p) => [p.id, p]))
  const live = mapped.filter((m) => { const p = partners.get(m.partnerId); return p?.status === 'connected' && p.seats.some((s) => s.id === m.seatId) })
  return dealsForSeats(await ctx.buyersLists.list(), live, at)
}

/* Refuse any deal ID not among the advertiser's invited deals. `held` are IDs the campaign already carries, which stay valid even once the deal's term has ended. */
export async function assertInvitedDeals(ctx: Pick<Context, 'company' | 'partners' | 'buyersLists'>, advertiserId: string | null | undefined, field: string, dealIds: string[], held: string[], at: string): Promise<void> {
  const wanted = dealIds.filter((d) => !held.includes(d))
  if (!wanted.length) return
  const allowed = new Set((await invitedDeals(ctx, advertiserId ?? '', at)).map((l) => l.dealId))
  const bad = wanted.filter((d) => !allowed.has(d))
  if (bad.length) throw validationFailed([{ field, reason: allowed.size
    ? `Not a deal this advertiser is an invited buyer on: ${bad.join(', ')}.`
    : 'This advertiser has no private-auction deals, so a campaign cannot carry a deal ID.' }])
}
