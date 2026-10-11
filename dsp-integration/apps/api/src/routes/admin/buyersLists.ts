/* Buyers lists (spec "Support private auctions"): reusable private-auction
   deal objects, managed from Available Inventory's own table underneath the
   Assigned to picker (Rob, 23 Sep). */
import { randomUUID } from 'node:crypto'
import { assignedOf, canonicalIabCategory, TARGETING_VARIABLES, type BuyersList, type BuyersListDealType, type Condition, type InvitedBuyer } from '@ph-dsp/types'
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import type { Guards } from '../../http/app'
import { hasDependents, notFound, validationFailed } from '../../http/errors'
import { mintDealId } from '../../repos/BuyersListRepo'
import { tx } from '../../db/db'
import { invitedPartnerIds } from '../../domain/buyersLists'
import { baseFloorFor } from '../../exchange/enforcement'
import { dealOf } from '../../domain/dealCreative'
import { dealSheetCsv, dealSheetOf } from '../../domain/dealSheet'
import { TRANSACTING_CURRENCY } from '../../domain/currency'
import { effectiveTerm } from '../../domain/pricing'
import { positionIdOf } from '../../domain/positions'
import { permittedFor, undefinedValues } from '../../domain/variables'
import type { Access, VariableValues } from '../../repos/CompanySettingsRepo'
import type { PartnerRecord } from '../../repos/PartnerRepo'

type Body = { dealId?: unknown; name?: unknown; description?: unknown; dealType?: unknown; invitedBuyers?: unknown; invitedCategories?: unknown; targeting?: unknown; activeFrom?: unknown; activeTo?: unknown; auctionCloses?: unknown; committedPlays?: unknown; floorCpm?: unknown }

/* Every slot currently assigned to this buyers list, across every display
   type — what stops a delete (spec "Deleting"). */
const dependentSlots = async (ctx: Context, buyersListId: string) =>
  (await ctx.displayTypes.list()).flatMap((t) =>
    (t.phExtensions?.slots ?? []).flatMap((s, i) => (assignedOf(s).buyersListIds.includes(buyersListId) ? [`${t.name} — ${s.label || `slot ${i + 1}`}`] : [])),
  )

/* The positions a deal is attached to: every slot assigned to it, as `displayTypeId.sN`. */
const positionsOfDeal = async (ctx: Context, buyersListId: string) =>
  (await ctx.displayTypes.list()).flatMap((t) =>
    (t.phExtensions?.slots ?? []).flatMap((s, i) => (assignedOf(s).buyersListIds.includes(buyersListId) ? [positionIdOf(t.id, i + 1)] : [])),
  )

/* Volume lives on the deal, never the open auction (open question 45): a
   deal's delivery is the plays billed at its positions inside its term. */
const withDelivery = async (ctx: Context, l: BuyersList): Promise<BuyersList> => {
  /* Committed volume and rate inherit platform default -> DSP -> this list (Rob, 7 Oct 2026); the rate is the
     base bid floor in USD CPM (the deal's own floor, else its DSP's, else the platform's), never blank. */
  const company = await ctx.company.get()
  const dsps = new Map((await ctx.partners.list()).map((p) => [p.id, p]))
  const invited = invitedPartnerIds(l, [...dsps.values()]).map((id) => dsps.get(id)?.bidder)
  /* Only a guaranteed deal carries volume: a private auction or preferred deal reports none, whatever the levels above hold. */
  const effectiveCommittedPlays = l.dealType === 'guaranteed'
    ? effectiveTerm({ platform: company.defaultCommittedPlays, dsp: invited.map((b) => b?.committedPlays), buyer: l.committedPlays })
    : { min: null, max: null, source: 'none' as const }
  const effectiveRateCpm = effectiveTerm({ platform: company.floorCpm, dsp: invited.map((b) => b?.floorCpm), buyer: l.floorCpm }, (n) => Math.max(company.floorCpm, n))
  return { ...l, effectiveCommittedPlays, effectiveRateCpm, deliveredPlays: await deliveredOf(ctx, l) }
}
const deliveredOf = async (ctx: Context, l: BuyersList): Promise<number> =>
  l.committedPlays == null ? 0 : await ctx.billing.playsAt(await positionsOfDeal(ctx, l.id), l.activeFrom, l.activeTo)

export const buyersListRoutes = (ctx: Context, guards: Guards): FastifyPluginAsync => async (app) => {
  /* An invited buyer must be a seat a connected DSP actually synced. */
  const partnersById = async () => new Map((await ctx.partners.list()).filter((p) => p.status === 'connected').map((p) => [p.id, p]))
  const parse = (b: Body, partnerById: Map<string, PartnerRecord>, access: Record<string, Access>, defined: Record<string, VariableValues>, platformFloor: number, errors: { field: string; reason: string }[]): { name: string; description: string; dealType: BuyersListDealType; invitedBuyers: InvitedBuyer[]; invitedCategories: string[]; targeting: Condition[]; activeFrom: string | null; activeTo: string | null; auctionCloses: string | null; committedPlays: number | null; floorCpm: number | null } => {
    const name = typeof b.name === 'string' ? b.name.trim() : ''
    if (!name) errors.push({ field: 'name', reason: 'A name is required.' })
    const description = typeof b.description === 'string' ? b.description.trim() : ''
    /* The deal type (7 Oct 2026) decides which of the fields below the list may carry. Omitted by an older client: guaranteed if it commits plays, else a private auction. */
    const requestedType = b.dealType === undefined || b.dealType === null ? (typeof b.committedPlays === 'number' ? 'guaranteed' : 'private_auction') : b.dealType
    if (requestedType !== 'private_auction' && requestedType !== 'preferred' && requestedType !== 'guaranteed') errors.push({ field: 'dealType', reason: 'private_auction, preferred or guaranteed.' })
    const dealType: BuyersListDealType = requestedType === 'preferred' || requestedType === 'guaranteed' ? requestedType : 'private_auction'
    const rawBuyers = Array.isArray(b.invitedBuyers) ? (b.invitedBuyers as unknown[]) : null
    const invitedBuyers: InvitedBuyer[] = []
    if (b.invitedBuyers !== undefined && b.invitedBuyers !== null && !rawBuyers) errors.push({ field: 'invitedBuyers', reason: 'A list of seats.' })
    rawBuyers?.forEach((raw, i) => {
      const r = (raw ?? {}) as { partnerId?: unknown; seatId?: unknown }
      const partnerId = typeof r.partnerId === 'string' ? r.partnerId.trim() : ''
      const seatId = typeof r.seatId === 'string' ? r.seatId.trim() : ''
      const partner = partnerId ? partnerById.get(partnerId) : undefined
      if (!partner) errors.push({ field: `invitedBuyers[${i}].partnerId`, reason: 'Pick a connected DSP.' })
      else if (!partner.seats.some((x) => x.id === seatId)) errors.push({ field: `invitedBuyers[${i}].seatId`, reason: `Not a seat synced from ${partner.name}.` })
      else if (!invitedBuyers.some((x) => x.partnerId === partnerId && x.seatId === seatId)) invitedBuyers.push({ partnerId, seatId })
    })
    /* Invited by IAB category (Rob, 7 Oct 2026): IAB taxonomy names only, never free text (400 otherwise). Combines with the named seats as a union; a list needs at least one of the two. */
    const invitedCategories: string[] = []
    const rawCategories = b.invitedCategories === undefined || b.invitedCategories === null ? [] : Array.isArray(b.invitedCategories) ? (b.invitedCategories as unknown[]) : null
    if (!rawCategories) errors.push({ field: 'invitedCategories', reason: 'A list of IAB categories.' })
    /* Categories are a private-auction bid-time filter only: a preferred or guaranteed deal is a bilateral commitment to named seats, so an invited category has no meaning there. */
    else if (rawCategories.length && dealType !== 'private_auction') errors.push({ field: 'invitedCategories', reason: 'Only a private auction can invite IAB categories; a preferred or guaranteed deal is with named buyers.' })
    else rawCategories.forEach((raw, i) => {
      const c = canonicalIabCategory(raw)
      if (!c) errors.push({ field: `invitedCategories[${i}]`, reason: `${typeof raw === 'string' ? raw : 'That'} is not an IAB category. Choose from the IAB Content Taxonomy (tier 1, or tier 2 as "Tier 1 › Tier 2").` })
      else if (!invitedCategories.includes(c)) invitedCategories.push(c)
    })
    if (!invitedBuyers.length && !invitedCategories.length && !errors.some((e) => e.field.startsWith('invitedBuyers') || e.field.startsWith('invitedCategories'))) errors.push({ field: 'invitedBuyers', reason: 'Invite at least one buyer or one IAB category.' })
    /* Targeting criteria appended to the deal (Rob, 7 Oct 2026): only
       variables the retailer has enabled for EVERY invited buyer's DSP, so
       the deal never offers a dimension some invited DSP cannot use. A
       personalised criterion is stored as a predicate only; it is matched
       against the live visitor at bid time and no attribute value reaches
       the buyer. */
    const targeting: Condition[] = []
    const rawTargeting = b.targeting === undefined || b.targeting === null ? [] : Array.isArray(b.targeting) ? (b.targeting as unknown[]) : null
    if (!rawTargeting) errors.push({ field: 'targeting', reason: 'A list of criteria.' })
    else if (rawTargeting.length > 20) errors.push({ field: 'targeting', reason: 'At most 20 criteria.' })
    else {
      const dsps = invitedPartnerIds({ invitedBuyers, invitedCategories } as BuyersList, [...partnerById.values()]).map((id) => partnerById.get(id) as PartnerRecord)
      rawTargeting.forEach((raw, i) => {
        const r = (raw ?? {}) as { variable?: unknown; op?: unknown; values?: unknown }
        const def = TARGETING_VARIABLES.find((v) => v.key === r.variable)
        if (!def) return void errors.push({ field: `targeting[${i}].variable`, reason: 'Not a shared targeting variable.' })
        const refused = dsps.filter((p) => !permittedFor(p, access).some((v) => v.key === def.key))
        if (refused.length) return void errors.push({ field: `targeting[${i}].variable`, reason: `${def.label} is not enabled for ${refused.map((p) => p.name).join(', ')}.` })
        if (typeof r.op !== 'string' || !def.operators.includes(r.op as never)) return void errors.push({ field: `targeting[${i}].op`, reason: `Not an operator for ${def.label}.` })
        const values = Array.isArray(r.values) ? (r.values as unknown[]) : []
        if (!values.length || values.length > 100 || values.some((v) => typeof v !== 'string' || !v.trim() || v.length > 200)) return void errors.push({ field: `targeting[${i}].values`, reason: 'One or more values (up to 100, 200 characters each).' })
        const undef = undefinedValues(def.key, (values as string[]).map((v) => v.trim()), defined)
        if (undef.length) return void errors.push({ field: `targeting[${i}].values`, reason: `${undef.join(', ')} ${undef.length === 1 ? 'is' : 'are'} not defined for ${def.label} in Shared Targeting Variables.` })
        targeting.push({ source: def.source, variable: def.key, op: r.op as Condition['op'], values: (values as string[]).map((v) => v.trim()) })
      })
    }
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
    if (auctionCloses && dealType !== 'private_auction') errors.push({ field: 'auctionCloses', reason: 'Only a private auction has an auction window; a preferred or guaranteed deal is not bid for.' })
    /* committedPlays: the volume this deal commits to over its term — a whole number of plays, or null for none. */
    let committedPlays: number | null = null
    if (b.committedPlays !== null && b.committedPlays !== undefined && dealType !== 'guaranteed') errors.push({ field: 'committedPlays', reason: 'Only a guaranteed deal commits volume; leave it empty for a private auction or preferred deal.' })
    else if (b.committedPlays !== null && b.committedPlays !== undefined) {
      if (typeof b.committedPlays !== 'number' || !Number.isInteger(b.committedPlays) || b.committedPlays < 1) errors.push({ field: 'committedPlays', reason: 'A whole number of plays, 1 or more, or null for no volume commitment.' })
      else committedPlays = b.committedPlays
    }
    /* Bid floor hierarchy (7 Oct 2026): blank inherits the DSP's floor, else the platform's; a value can raise the floor, never go below the platform floor. */
    let floorCpm: number | null = null
    if (b.floorCpm !== undefined && b.floorCpm !== null) {
      if (typeof b.floorCpm !== 'number' || !Number.isFinite(b.floorCpm) || b.floorCpm <= 0) errors.push({ field: 'floorCpm', reason: 'Floor price (CPM) must be greater than 0, or empty to inherit.' })
      else if (b.floorCpm < platformFloor) errors.push({ field: 'floorCpm', reason: `Floor price (CPM) can't be below the platform floor of ${platformFloor} ${TRANSACTING_CURRENCY}.` })
      else floorCpm = b.floorCpm
    }
    return { name, description, dealType, invitedBuyers, invitedCategories, targeting, activeFrom, activeTo, auctionCloses, committedPlays, floorCpm }
  }

  app.get('/buyers-lists', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'sections')
    return { items: await Promise.all((await ctx.buyersLists.list()).map((l) => withDelivery(ctx, l))) }
  })

  /* The deal as a DSP buyer sees it: terms plus the creative requirements derived from the attached positions. */
  app.get<{ Params: { buyersListId: string } }>('/buyers-lists/:buyersListId/deal', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'sections')
    const list = await ctx.buyersLists.get(req.params.buyersListId)
    if (!list) throw notFound()
    return dealOf(ctx, list, await baseFloorFor(ctx, { buyersListId: list.id }))
  })

  /* The deal sheet (ticket DbiT9qrFwL4O5ibgSowF): the deal ID per DSP, terms and creative spec a buyer keys into their DSP. JSON, or a downloadable CSV with ?format=csv. */
  app.get<{ Params: { buyersListId: string }; Querystring: { format?: string } }>('/buyers-lists/:buyersListId/deal-sheet', async (req, reply) => {
    guards.flagged()
    guards.requireScope(req, 'sections')
    const list = await ctx.buyersLists.get(req.params.buyersListId)
    if (!list) throw notFound()
    const sheet = await dealSheetOf(ctx, list)
    if (req.query.format === undefined || req.query.format === 'json') return sheet
    if (req.query.format !== 'csv') throw validationFailed([{ field: 'format', reason: 'json or csv.' }])
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="deal-sheet-${list.id}.csv"`).send(dealSheetCsv(sheet))
  })

  app.post<{ Body: Body }>('/buyers-lists', async (req, reply) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    const errors: { field: string; reason: string }[] = []
    /* The deal ID is minted by the platform (ticket 5CCgGEYSkVoDTH9yNSYu): a typed one is refused, not ignored. */
    if (req.body?.dealId !== undefined) errors.push({ field: 'dealId', reason: 'The deal ID is generated by the platform; leave it out.' })
    const parsed = parse(req.body ?? {}, await partnersById(), await ctx.company.variableAccess(), await ctx.company.variableValues(), (await ctx.company.get()).floorCpm, errors)
    if (errors.length) throw validationFailed(errors)
    const created: BuyersList = await ctx.buyersLists.insert({ id: `bl_${randomUUID().slice(0, 12)}`, dealId: mintDealId(), ...parsed })
    return reply.status(201).send(await withDelivery(ctx, created))
  })

  app.put<{ Params: { buyersListId: string }; Body: Body }>('/buyers-lists/:buyersListId', async (req, reply) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    const existing = await ctx.buyersLists.get(req.params.buyersListId)
    if (!existing) throw notFound()
    const errors: { field: string; reason: string }[] = []
    /* Immutable like a DV360 deal: the ID can be echoed back unchanged, never altered. */
    if (req.body?.dealId !== undefined && req.body.dealId !== existing.dealId) errors.push({ field: 'dealId', reason: 'A deal ID cannot be changed.' })
    /* An omitted dealType means "as it is" on an edit, so an older client can never mint a new deal by accident. */
    const body: Body = { ...(req.body ?? {}), dealType: req.body?.dealType ?? existing.dealType }
    const parsed = parse(body, await partnersById(), await ctx.company.variableAccess(), await ctx.company.variableValues(), (await ctx.company.get()).floorCpm, errors)
    if (errors.length) throw validationFailed(errors)
    /* A different deal type is a different deal: insert a new list with a new ID and leave this one (and its slot assignments and campaigns) as it was until it ends. */
    if (parsed.dealType !== existing.dealType) {
      const minted: BuyersList = await ctx.buyersLists.insert({ id: `bl_${randomUUID().slice(0, 12)}`, dealId: mintDealId(), ...parsed })
      return reply.status(201).send(await withDelivery(ctx, minted))
    }
    const updated = await ctx.buyersLists.update(req.params.buyersListId, parsed)
    if (!updated) throw notFound()
    return withDelivery(ctx, updated)
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
