/* Buyers lists (spec "Support private auctions"): reusable private-auction
   deal objects, managed from Available Inventory's own table underneath the
   Assigned to picker (Rob, 23 Sep). */
import { randomUUID } from 'node:crypto'
import { IDENTIFIER_TYPES, assignedOf, type BuyersList, type InvitedBuyer } from '@ph-dsp/types'
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import type { Guards } from '../../http/app'
import { hasDependents, notFound, validationFailed } from '../../http/errors'

const IDENTIFIER_KEYS = IDENTIFIER_TYPES.map((t) => t.key) as string[]

type Body = { name?: unknown; description?: unknown; invitedBuyers?: unknown; activeFrom?: unknown; activeTo?: unknown }

/* Every slot currently assigned to this buyers list, across every display
   type — what stops a delete (spec "Deleting"). */
const dependentSlots = (ctx: Context, buyersListId: string) =>
  ctx.displayTypes.list().flatMap((t) =>
    (t.phExtensions?.slots ?? []).flatMap((s, i) => (assignedOf(s).buyersListId === buyersListId ? [`${t.name} — ${s.label || `slot ${i + 1}`}`] : [])),
  )

export const buyersListRoutes = (ctx: Context, guards: Guards): FastifyPluginAsync => async (app) => {
  const parse = (b: Body, errors: { field: string; reason: string }[]): { name: string; description: string; invitedBuyers: InvitedBuyer[]; activeFrom: string | null; activeTo: string | null } => {
    const name = typeof b.name === 'string' ? b.name.trim() : ''
    if (!name) errors.push({ field: 'name', reason: 'A name is required.' })
    const description = typeof b.description === 'string' ? b.description.trim() : ''
    const rawBuyers = Array.isArray(b.invitedBuyers) ? (b.invitedBuyers as unknown[]) : null
    const invitedBuyers: InvitedBuyer[] = []
    if (!rawBuyers?.length) errors.push({ field: 'invitedBuyers', reason: 'At least one invited buyer is required.' })
    else rawBuyers.forEach((raw, i) => {
      const r = (raw ?? {}) as { identifierType?: unknown; value?: unknown }
      const identifierType = typeof r.identifierType === 'string' ? r.identifierType : ''
      const value = typeof r.value === 'string' ? r.value.trim() : ''
      if (!IDENTIFIER_KEYS.includes(identifierType)) errors.push({ field: `invitedBuyers[${i}].identifierType`, reason: `One of: ${IDENTIFIER_KEYS.join(', ')}.` })
      else if (!value) errors.push({ field: `invitedBuyers[${i}].value`, reason: 'Required.' })
      else invitedBuyers.push({ identifierType: identifierType as InvitedBuyer['identifierType'], value })
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
    return { name, description, invitedBuyers, activeFrom, activeTo }
  }

  app.get('/buyers-lists', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'sections')
    return { items: ctx.buyersLists.list() }
  })

  app.post<{ Body: Body }>('/buyers-lists', async (req, reply) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    const errors: { field: string; reason: string }[] = []
    const parsed = parse(req.body ?? {}, errors)
    if (errors.length) throw validationFailed(errors)
    const created: BuyersList = ctx.buyersLists.insert({ id: `bl_${randomUUID().slice(0, 12)}`, ...parsed })
    return reply.status(201).send(created)
  })

  app.put<{ Params: { buyersListId: string }; Body: Body }>('/buyers-lists/:buyersListId', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    if (!ctx.buyersLists.get(req.params.buyersListId)) throw notFound()
    const errors: { field: string; reason: string }[] = []
    const parsed = parse(req.body ?? {}, errors)
    if (errors.length) throw validationFailed(errors)
    return ctx.buyersLists.update(req.params.buyersListId, parsed)
  })

  app.delete<{ Params: { buyersListId: string } }>('/buyers-lists/:buyersListId', async (req, reply) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    if (!ctx.buyersLists.get(req.params.buyersListId)) throw notFound()
    const dependents = dependentSlots(ctx, req.params.buyersListId)
    if (dependents.length) throw hasDependents("This buyers list can't be deleted while a slot is assigned to it.", dependents.map((reason) => ({ field: 'slots', reason })))
    ctx.buyersLists.delete(req.params.buyersListId)
    return reply.status(204).send()
  })
}
