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
  const out: Advertiser[] = []
  for (const [advertiserId, a] of [...byId.entries()].sort((x, y) => x[1].name.localeCompare(y[1].name))) {
    const s = await ctx.company.advertiserSetting(advertiserId)
    out.push({
      advertiserId, name: a.name, via: a.via, direct: direct.has(advertiserId), ...s, effectiveFloorCpm: effectiveFloorCpm(company, s.floorMultiplier),
      bookings: bookings.get(advertiserId) ?? 0,
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

  /* Remove a direct advertiser. Refused while it has campaigns or bookings. */
  app.delete<{ Params: { advertiserId: string } }>('/advertisers/direct/:advertiserId', async (req, reply) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    const a = (await listAdvertisers(ctx)).find((x) => x.advertiserId === req.params.advertiserId)
    if (!a || !a.direct) throw notFound('Not a direct advertiser.')
    if (a.bookings > 0 || Object.values(a.campaigns).some((n) => n > 0)) throw conflict(`${a.name} has campaigns or bookings, so it can't be removed.`)
    await ctx.company.removeDirectAdvertiser(a.advertiserId)
    return reply.status(204).send()
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
