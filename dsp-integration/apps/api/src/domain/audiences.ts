/* Advertiser audiences (ticket OanRebXyEryAXBQrBsVe, 19 Oct 2026): Visitor Segments values the
   retailer shares with one advertiser only, such as "Blackmores · new to brand". The retailer's
   own systems decide who is in each audience and publish it as a visitor segment; PH keeps only
   which advertiser may target which value. A value is private once any advertiser holds it, and
   only the advertisers that hold it may target it. Targeting a private value is still a
   Personalisation Variable: it works on deals and reserve bookings, never the open auction. */
import type { Context } from '../context'
import { HttpError, validationFailed } from '../http/errors'
import type { Condition } from './targetingValidation'

export const SEGMENT_VARIABLE = 'visitor.visitor_segments'

/* Each private value and the advertisers that hold it. */
export async function audienceOwners(ctx: Pick<Context, 'company'>): Promise<Map<string, Set<string>>> {
  const owners = new Map<string, Set<string>>()
  for (const [advertiserId, values] of Object.entries(await ctx.company.advertiserAudiences())) {
    for (const v of values) (owners.get(v) ?? owners.set(v, new Set()).get(v)!).add(advertiserId)
  }
  return owners
}

export const privateValuesOf = async (ctx: Pick<Context, 'company'>): Promise<string[]> => [...(await audienceOwners(ctx)).keys()].sort((a, b) => a.localeCompare(b))

/* The Visitor Segments values a set of conditions matches. */
export const segmentValuesOf = (conditions: Iterable<Pick<Condition, 'variable' | 'values'>>): string[] =>
  [...new Set([...conditions].filter((c) => c.variable === SEGMENT_VARIABLE).flatMap((c) => c.values ?? []).map((v) => v.trim()))]

/* A campaign's targeted versions: AND groups of OR conditions. */
export const segmentValuesInTargeting = (targeting: unknown): string[] => {
  const targeted = (targeting as { targeted?: { rules?: unknown }[] } | null | undefined)?.targeted
  if (!Array.isArray(targeted)) return []
  return segmentValuesOf(targeted.flatMap((t) => (Array.isArray(t?.rules) ? (t.rules as unknown[][]).flatMap((g) => (Array.isArray(g) ? (g as Condition[]) : [])) : [])))
}

/* The first private value among `values` this advertiser may not target, as a sentence naming it. Through a DSP, the seat the request comes
   from must also be one mapped to the advertiser: another seat never sees the audience. */
export async function audienceRefusal(ctx: Pick<Context, 'company'>, advertiserId: string | null | undefined, values: string[], via?: { partnerId: string; seatId?: string | null }): Promise<string | null> {
  if (!values.length) return null
  const owners = await audienceOwners(ctx)
  const mapped = via ? (await ctx.company.advertiserSeats())[advertiserId ?? ''] ?? [] : []
  for (const v of values) {
    const held = owners.get(v)
    if (!held) continue
    if (!advertiserId || !held.has(advertiserId)) return `${v} is an audience shared with another advertiser only.`
    if (via && !mapped.some((m) => m.partnerId === via.partnerId && (!via.seatId || m.seatId === via.seatId))) return `${v} is an audience shared only with seats mapped to its advertiser; this seat is not one of them.`
  }
  return null
}

export const audienceError = (reason: string) => new HttpError(422, 'targeting_not_supported', reason)

/* PUT /admin/v1/advertisers/{id}/audiences: a list of values, each in the Visitor Segments vocabulary (or already private to another advertiser).
   Free text on the variable lets the retailer type a value the vocabulary does not list yet. */
export async function validateAudiences(ctx: Pick<Context, 'company'>, raw: unknown): Promise<string[]> {
  if (!Array.isArray(raw) || raw.length > 100) throw validationFailed([{ field: 'audiences', reason: 'A list of up to 100 Visitor Segments values.' }])
  const vocab = (await ctx.company.variableValues())[SEGMENT_VARIABLE]
  const known = new Set([...(vocab?.values ?? [])])
  const out: string[] = []
  const errors: { field: string; reason: string }[] = []
  raw.forEach((v, i) => {
    const s = typeof v === 'string' ? v.trim() : ''
    if (!s || s.length > 200) return void errors.push({ field: `audiences[${i}]`, reason: 'A value of 1 to 200 characters.' })
    if (!known.has(s) && !vocab?.freeText) return void errors.push({ field: `audiences[${i}]`, reason: `${s} is not defined for Visitor Segments in Shared Targeting Variables.` })
    if (!out.includes(s)) out.push(s)
  })
  if (errors.length) throw validationFailed(errors)
  return out
}

/* The audiences shared with the advertiser(s) a DSP seat is mapped to. */
export async function audiencesForSeat(ctx: Pick<Context, 'company'>, partnerId: string, seatId: string): Promise<string[]> {
  const audiences = await ctx.company.advertiserAudiences()
  const out = new Set<string>()
  for (const [advertiserId, seats] of Object.entries(await ctx.company.advertiserSeats())) {
    if (seats.some((m) => m.partnerId === partnerId && m.seatId === seatId)) for (const v of audiences[advertiserId] ?? []) out.add(v)
  }
  return [...out].sort((a, b) => a.localeCompare(b))
}

/* A deal that targets a private audience may be offered only to the advertiser that holds it: every invited buyer must be a seat mapped
   to an advertiser holding each such value, and buyers invited by IAB category (seats not known in advance) are refused. */
export async function dealAudienceErrors(ctx: Pick<Context, 'company'>, deal: { targeting: Condition[]; invitedBuyers: { partnerId: string; seatId: string }[]; invitedCategories: string[] }, errors: { field: string; reason: string }[]): Promise<void> {
  const owners = await audienceOwners(ctx)
  const used = segmentValuesOf(deal.targeting).filter((v) => owners.has(v))
  if (!used.length) return
  if (deal.invitedCategories.length) errors.push({ field: 'invitedCategories', reason: `${used.join(', ')} is an audience shared with one advertiser only, so the deal can only invite named buyers.` })
  const mapped = Object.entries(await ctx.company.advertiserSeats())
  deal.invitedBuyers.forEach((b, i) => {
    for (const v of used) {
      const holds = mapped.some(([advertiserId, seats]) => owners.get(v)!.has(advertiserId) && seats.some((m) => m.partnerId === b.partnerId && m.seatId === b.seatId))
      if (!holds) return void errors.push({ field: `invitedBuyers[${i}]`, reason: `${v} is an audience shared with another advertiser only; this seat is not mapped to an advertiser that holds it.` })
    }
  })
}
