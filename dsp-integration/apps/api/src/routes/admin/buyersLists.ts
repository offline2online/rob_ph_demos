/* Buyers lists (spec "Support private auctions"): reusable private-auction
   deal objects, managed from Available Inventory's own table underneath the
   Assigned to picker (Rob, 23 Sep). */
import { randomUUID } from 'node:crypto'
import { assignedOf, type BuyersList, type InvitedBuyer } from '@ph-dsp/types'
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import type { Guards } from '../../http/app'
import { hasDependents, notFound, validationFailed } from '../../http/errors'
import { tx } from '../../db/db'
import type { PartnerRecord } from '../../repos/PartnerRepo'

type Body = { name?: unknown; description?: unknown; invitedBuyers?: unknown; activeFrom?: unknown; activeTo?: unknown; auctionCloses?: unknown }

/* Every slot currently assigned to this buyers list, across every display
   type — what stops a delete (spec "Deleting"). */
const dependentSlots = async (ctx: Context, buyersListId: string) =>
  (await ctx.displayTypes.list()).flatMap((t) =>
    (t.phExtensions?.slots ?? []).flatMap((s, i) => (assignedOf(s).buyersListId === buyersListId ? [`${t.name} — ${s.label || `slot ${i + 1}`}`] : [])),
  )

export const buyersListRoutes = (ctx: Context, guards: Guards): FastifyPluginAsync => async (app) => {
  /* An invited buyer must be a seat a connected DSP actually synced. */
  const partnersById = async () => new Map((await ctx.partners.list()).filter((p) => p.status === 'connected').map((p) => [p.id, p]))
  const parse = (b: Body, partnerById: Map<string, PartnerRecord>, errors: { field: string; reason: string }[]): { name: string; description: string; invitedBuyers: InvitedBuyer[]; activeFrom: string | null; activeTo: string | null; auctionCloses: string | null } => {
    const name = typeof b.name === 'string' ? b.name.trim() : ''
    if (!name) errors.push({ field: 'name', reason: 'A name is required.' })
    const description = typeof b.description === 'string' ? b.description.trim() : ''
    const rawBuyers = Array.isArray(b.invitedBuyers) ? (b.invitedBuyers as unknown[]) : null
    const invitedBuyers: InvitedBuyer[] = []
    if (!rawBuyers?.length) errors.push({ field: 'invitedBuyers', reason: 'At least one invited buyer is required.' })
    else rawBuyers.forEach((raw, i) => {
      const r = (raw ?? {}) as { partnerId?: unknown; seatId?: unknown }
      const partnerId = typeof r.partnerId === 'string' ? r.partnerId.trim() : ''
      const seatId = typeof r.seatId === 'string' ? r.seatId.trim() : ''
      const partner = partnerId ? partnerById.get(partnerId) : undefined
      if (!partner) errors.push({ field: `invitedBuyers[${i}].partnerId`, reason: 'Pick a connected DSP.' })
      else if (!partner.seats.some((x) => x.id === seatId)) errors.push({ field: `invitedBuyers[${i}].seatId`, reason: `Not a seat synced from ${partner.name}.` })
      else if (!invitedBuyers.some((x) => x.partnerId === partnerId && x.seatId === seatId)) invitedBuyers.push({ partnerId, seatId })
    })
    const parseDate = (v: unknown, field: string): string | null => {
      if (v === null || v === undefined) return null
      if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) {
        errors.push({ field, reason: 'A date-time, or null for no bound.' })
        return null
      }
      return v
    }
    const activeFrom = parseDate(b.activeFrom, 'activeFrom')
    const activeTo = parseDate(b.activeTo, 'activeTo')
    if (activeFrom && activeTo && Date.parse(activeFrom) > Date.parse(activeTo)) errors.push({ field: 'activeTo', reason: 'Must be on or after activeFrom.' })
    /* auctionCloses (the two-period model's bidding deadline, 23 Sep 2026)
       is independent of the delivery term above — it's fine for it to sit
       before, inside or after activeFrom/activeTo (a deal can be set up to
       award its term ahead of time). */
    const auctionCloses = parseDate(b.auctionCloses, 'auctionCloses')
    return { name, description, invitedBuyers, activeFrom, activeTo, auctionCloses }
  }

  app.get('/buyers-lists', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'sections')
    return { items: await ctx.buyersLists.list() }
  })

  app.post<{ Body: Body }>('/buyers-lists', async (req, reply) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    const errors: { field: string; reason: string }[] = []
    const parsed = parse(req.body ?? {}, await partnersById(), errors)
    if (errors.length) throw validationFailed(errors)
    const created: BuyersList = await ctx.buyersLists.insert({ id: `bl_${randomUUID().slice(0, 12)}`, ...parsed })
    return reply.status(201).send(created)
  })

  app.put<{ Params: { buyersListId: string }; Body: Body }>('/buyers-lists/:buyersListId', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    if (!(await ctx.buyersLists.get(req.params.buyersListId))) throw notFound()
    const errors: { field: string; reason: string }[] = []
    const parsed = parse(req.body ?? {}, await partnersById(), errors)
    if (errors.length) throw validationFailed(errors)
    return ctx.buyersLists.update(req.params.buyersListId, parsed)
  })

  app.delete<{ Params: { buyersListId: string } }>('/buyers-lists/:buyersListId', async (req, reply) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    /* The check and the delete are one transaction: no slot can be assigned to it in between. */
    await tx(ctx.db, async () => {
      if (!(await ctx.buyersLists.get(req.params.buyersListId))) throw notFound()
      const dependents = await dependentSlots(ctx, req.params.buyersListId)
      if (dependents.length) throw hasDependents("This buyers list can't be deleted while a slot is assigned to it.", dependents.map((reason) => ({ field: 'slots', reason })))
      await ctx.buyersLists.delete(req.params.buyersListId)
    })
    return reply.status(204).send()
  })
}
