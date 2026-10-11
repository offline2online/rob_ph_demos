/* Advertisers (admin only, spec §3): every advertiser across all DSPs, from
   the seats pulled on connect. Package 3 needs the read side for the slot
   picker; saving arrives with the screen (package 10). */
import { advertiserSlug, type Advertiser } from '@ph-dsp/types'
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import type { Guards } from '../../http/app'
import { conflict, notFound, validationFailed } from '../../http/errors'
import { effectiveFloorCpm } from '../../domain/pricing'
import { allPositions, findPosition, nextWindow, windowMs } from '../../domain/positions'
import { TAKEN } from '../../repos/ReservationRepo'
import { invitedDealIds } from '../../domain/advertiserDeals'

export async function listAdvertisers(ctx: Context): Promise<Advertiser[]> {
  const company = await ctx.company.get()
  /* Each advertiser's campaigns by approval status (Rob, 20 Sep). */
  const byAdvertiser = new Map<string, Advertiser['campaigns']>()
  for (const c of await ctx.campaigns.listCampaigns()) {
    if (c.source === 'hq' || !c.advertiserId) continue
    const counts = byAdvertiser.get(c.advertiserId) ?? { draft: 0, awaiting_approval: 0, approved: 0, rejected: 0 }
    counts[await ctx.approvals.statusOf(c.campaignId)]++
    byAdvertiser.set(c.advertiserId, counts)
  }
  /* Live bookings from the current window on: an advertiser with none has
     nothing to show on the booking schedule (Rob, 20 Sep). "Current" is
     per position: each slot's window is its own billing unit (OQ27). */
  const bookings = new Map<string, number>()
  const fromOf = new Map<string, number>()
  const currentFrom = async (positionId: string) => {
    let from = fromOf.get(positionId)
    if (from === undefined) {
      const len = await windowMs(ctx, await findPosition(ctx, positionId))
      fromOf.set(positionId, (from = (await nextWindow(ctx, len)).getTime() - len))
    }
    return from
  }
  /* Read from the earliest current window any position can have, not from
     1970 (review, 3 Oct 2026): every past sale was loaded and dropped — the
     whole history on every visit to Advertisers. Each row is still checked
     against its own position's current window below. */
  const lens = new Set([await windowMs(ctx), ...(await Promise.all((await allPositions(ctx)).map((p) => windowMs(ctx, p))))])
  let earliest = Infinity
  for (const len of lens) earliest = Math.min(earliest, (await nextWindow(ctx, len)).getTime() - len)
  for (const r of await ctx.reservations.byStatus([...TAKEN], new Date(earliest).toISOString())) {
    if (r.testMode || r.clearingCpm === null || !r.advertiserId) continue
    if (Date.parse(r.windowStart) < (await currentFrom(r.positionId))) continue
    bookings.set(r.advertiserId, (bookings.get(r.advertiserId) ?? 0) + 1)
  }
  const byId = new Map<string, { name: string; via: string[] }>()
  for (const p of await ctx.partners.list()) {
    for (const s of p.seats) {
      const id = advertiserSlug(s.name)
      const a = byId.get(id) ?? { name: s.name, via: [] }
      if (!a.via.includes(p.name)) a.via.push(p.name)
      byId.set(id, a)
    }
  }
  /* Direct advertisers (no DSP): listed with the rest, with nothing in Via.
     A DSP seat of the same name wins, so one advertiser is never listed twice. */
  const direct = new Set<string>()
  for (const d of await ctx.company.directAdvertisers()) {
    if (byId.has(d.advertiserId)) continue
    byId.set(d.advertiserId, { name: d.name, via: [] })
    direct.add(d.advertiserId)
  }
  /* Mapped DSP seats (ticket T0gLfo2zDrRXPVGcvEoL), checked against what each DSP has synced now. */
  const mapped = await ctx.company.advertiserSeats()
  const partners = new Map((await ctx.partners.list()).map((p) => [p.id, p]))
  const out: Advertiser[] = []
  for (const [advertiserId, a] of [...byId.entries()].sort((x, y) => x[1].name.localeCompare(y[1].name))) {
    const s = await ctx.company.advertiserSetting(advertiserId)
    out.push({
      advertiserId, name: a.name, via: a.via, direct: direct.has(advertiserId), ...s, effectiveFloorCpm: effectiveFloorCpm(company, s.floorMultiplier),
      bookings: bookings.get(advertiserId) ?? 0,
      dspSeats: direct.has(advertiserId) ? [] : (mapped[advertiserId] ?? []).map((m) => {
        const p = partners.get(m.partnerId)
        const seat = p?.status === 'connected' ? p.seats.find((x) => x.id === m.seatId) : undefined
        return { ...m, partnerName: p?.name ?? m.partnerId, seatName: seat?.name ?? null, synced: !!seat }
      }),
      campaigns: byAdvertiser.get(advertiserId) ?? { draft: 0, awaiting_approval: 0, approved: 0, rejected: 0 },
    })
  }
  return out
}

export const advertiserRoutes = (ctx: Context, guards: Guards): FastifyPluginAsync => async (app) => {
  app.get('/advertisers', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'sections')
    const { currency, floorCpm } = await ctx.company.get()
    return { currency, floorCpm, items: await listAdvertisers(ctx) }
  })

  /* Add an advertiser with a direct relationship with the retailer (no DSP). */
  app.post<{ Body: { name?: unknown } }>('/advertisers/direct', async (req, reply) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().replace(/\s+/g, ' ') : ''
    if (!name || name.length > 80) throw validationFailed([{ field: 'name', reason: 'A name of 1 to 80 characters is required.' }])
    const advertiserId = advertiserSlug(name)
    if (!advertiserId) throw validationFailed([{ field: 'name', reason: 'The name needs at least one letter or digit.' }])
    if ((await listAdvertisers(ctx)).some((a) => a.advertiserId === advertiserId)) throw conflict(`${name} is already an advertiser.`)
    await ctx.company.addDirectAdvertiser(advertiserId, name)
    return reply.status(201).send({ advertiserId, name })
  })

  /* Remove a direct advertiser. Refused while it has campaigns or bookings, or is held on a slot. */
  app.delete<{ Params: { advertiserId: string } }>('/advertisers/direct/:advertiserId', async (req, reply) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    const a = (await listAdvertisers(ctx)).find((x) => x.advertiserId === req.params.advertiserId)
    if (!a || !a.direct) throw notFound('Not a direct advertiser.')
    if (a.bookings > 0 || Object.values(a.campaigns).some((n) => n > 0)) throw conflict(`${a.name} has campaigns or bookings, so it can't be removed.`)
    /* A slot that still holds the advertiser would be left pointing at nobody, so name each one
       and refuse until it is removed from them (Rob, 10 Oct 2026). */
    const held: string[] = []
    for (const t of await ctx.displayTypes.list()) {
      for (const [i, s] of (t.phExtensions?.slots ?? []).entries()) {
        if (s.owner === 'advertiser' && (s.advertisers ?? []).includes(a.name)) held.push(`${t.name} – slot ${i + 1}${s.label ? ` (${s.label})` : ''}`)
      }
    }
    if (held.length) throw conflict(`${a.name} is assigned to ${held.length === 1 ? 'a slot' : `${held.length} slots`} on Available Inventory: ${held.join('; ')}. Remove it from ${held.length === 1 ? 'that slot' : 'those slots'} before deleting it.`)
    await ctx.company.removeDirectAdvertiser(a.advertiserId)
    return reply.status(204).send()
  })

  /* Map an advertiser to the DSP seats it bids under (ticket T0gLfo2zDrRXPVGcvEoL). Chosen from
     synced seats, never typed; replaces the advertiser's whole mapping. A direct advertiser has none. */
  app.put<{ Params: { advertiserId: string }; Body: { seats?: unknown } }>('/advertisers/:advertiserId/seats', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    const a = (await listAdvertisers(ctx)).find((x) => x.advertiserId === req.params.advertiserId)
    if (!a) throw notFound('Not an advertiser.')
    if (a.direct) throw validationFailed([{ field: 'seats', reason: 'A direct advertiser has no DSP seats.' }])
    const raw = req.body?.seats
    if (!Array.isArray(raw)) throw validationFailed([{ field: 'seats', reason: 'A list of { partnerId, seatId }.' }])
    const partners = new Map((await ctx.partners.list()).filter((p) => p.status === 'connected').map((p) => [p.id, p]))
    const errors: { field: string; reason: string }[] = []
    const seats: { partnerId: string; seatId: string }[] = []
    raw.forEach((r: unknown, i) => {
      const { partnerId: pid, seatId: sid } = (r ?? {}) as { partnerId?: unknown; seatId?: unknown }
      const partnerId = typeof pid === 'string' ? pid.trim() : ''
      const seatId = typeof sid === 'string' ? sid.trim() : ''
      const partner = partners.get(partnerId)
      if (!partner) errors.push({ field: `seats[${i}].partnerId`, reason: 'Pick a connected DSP.' })
      else if (!partner.seats.some((x) => x.id === seatId)) errors.push({ field: `seats[${i}].seatId`, reason: `Not a seat synced from ${partner.name}.` })
      else if (!seats.some((x) => x.partnerId === partnerId && x.seatId === seatId)) seats.push({ partnerId, seatId })
    })
    if (errors.length) throw validationFailed(errors)
    await ctx.company.saveAdvertiserSeats(a.advertiserId, seats)
    return (await listAdvertisers(ctx)).find((x) => x.advertiserId === a.advertiserId)
  })

  /* The deals this advertiser is an invited buyer on whose delivery term covers `at` (default now):
     what the campaign authoring deal-ID picker lists. */
  app.get<{ Params: { advertiserId: string }; Querystring: { at?: string } }>('/advertisers/:advertiserId/deals', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'sections')
    const a = (await listAdvertisers(ctx)).find((x) => x.advertiserId === req.params.advertiserId)
    if (!a) throw notFound('Not an advertiser.')
    const at = req.query.at ?? ctx.clock().toISOString()
    if (Number.isNaN(Date.parse(at))) throw validationFailed([{ field: 'at', reason: 'A date-time.' }])
    return { items: (await invitedDealIds(ctx, a.advertiserId, at)).filter((e) => e.deals.length).map(({ list: l, deals }) => ({ buyersListId: l.id, dealId: deals[0].dealId, deals, name: l.name, dealType: l.dealType, activeFrom: l.activeFrom, activeTo: l.activeTo })) }
  })

  /* Save changes. Applies to future submissions; campaigns already awaiting
     approval stay in the queue (spec §3). */
  app.put<{ Body: { settings?: Record<string, { approvalRequired?: unknown; floorMultiplier?: unknown }> } }>('/advertisers', async (req, reply) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    const settings = req.body?.settings
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw validationFailed([{ field: 'settings', reason: 'Required.' }])
    const known = new Set((await listAdvertisers(ctx)).map((a) => a.advertiserId))
    const errors: { field: string; reason: string }[] = []
    for (const [id, s] of Object.entries(settings)) {
      if (!known.has(id)) errors.push({ field: `settings.${id}`, reason: 'Not an advertiser on any DSP.' })
      if (typeof s?.approvalRequired !== 'boolean') errors.push({ field: `settings.${id}.approvalRequired`, reason: 'Must be true or false.' })
      if (typeof s?.floorMultiplier !== 'number' || !(s.floorMultiplier > 0)) errors.push({ field: `settings.${id}.floorMultiplier`, reason: 'Must be greater than 0.' })
    }
    if (errors.length) throw validationFailed(errors)
    await ctx.company.saveAdvertiserSettings(settings as Record<string, { approvalRequired: boolean; floorMultiplier: number }>)
    return reply.status(200).send()
  })
}
