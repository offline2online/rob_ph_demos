/* Buyers lists (spec "Support private auctions"): reusable private-auction
   deal objects, managed from Available Inventory's own table underneath the
   Assigned to picker (Rob, 23 Sep). */
import { randomUUID } from 'node:crypto'
import { assignedOf, canonicalIabCategory, DIRECT_PARTNER_ID, isGuaranteedLike, isAggregateVariable, isValidAggregateValue, TARGETING_VARIABLES, type BuyersList, type BuyersListDealType, type TimeZoneMode, type TermCheck, type Condition, type InvitedBuyer } from '@ph-dsp/types'
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import type { Guards } from '../../http/app'
import { conflict, hasDependents, notFound, validationFailed } from '../../http/errors'
import { flightConflicts, isReserving, slotConflicts } from '../../domain/reservingDeals'
import { mintDealId } from '../../repos/BuyersListRepo'
import { tx } from '../../db/db'
import { invitedPartnerIds } from '../../domain/buyersLists'
import { needsReacceptance, termChanges } from '../../domain/termVersions'
import { auditActorOf } from '../../domain/sspAudit'
import { baseFloorFor } from '../../exchange/enforcement'
import { dealOf } from '../../domain/dealCreative'
import { dealSheetCsv, dealSheetOf } from '../../domain/dealSheet'
import { TRANSACTING_CURRENCY } from '../../domain/currency'
import { effectiveTerm } from '../../domain/pricing'
import { positionIdOf } from '../../domain/positions'
import { slotDetailOf, type SlotDetail } from '../../domain/displayTypes'
import { dealAudienceErrors } from '../../domain/audiences'
import { belowFloorReasons, equivalentCpmOf, equivalentCpmRange, termDaysOf, termSlotsOf } from '../../domain/termPrice'
import { derivedCommittedPlays } from '../../domain/committedPlays'
import { permittedFor, undefinedValues } from '../../domain/variables'
import type { Access, VariableValues } from '../../repos/CompanySettingsRepo'
import type { PartnerRecord } from '../../repos/PartnerRepo'

type Body = { status?: unknown; dealId?: unknown; name?: unknown; description?: unknown; dealType?: unknown; invitedBuyers?: unknown; invitedCategories?: unknown; targeting?: unknown; activeFrom?: unknown; activeTo?: unknown; timeZoneMode?: unknown; auctionCloses?: unknown; committedPlays?: unknown; floorCpm?: unknown; termTotal?: unknown; ratePerDay?: unknown; belowFloorOverride?: unknown }

/* Every slot currently assigned to this buyers list, across every display
   type — what stops a delete (spec "Deleting"). */
/* An archived deal is read-only: edits, sharing and acceptances answer 409. */
const notArchived = (l: BuyersList) => {
  if (l.status === 'archived') throw conflict('This deal is archived, so it is read-only.', [{ field: 'status', reason: 'Archived deals cannot be edited, shared or accepted.' }])
}

const dependentSlots = async (ctx: Context, buyersListId: string) =>
  (await ctx.displayTypes.list()).flatMap((t) =>
    (t.phExtensions?.slots ?? []).flatMap((s, i) => (assignedOf(s).buyersListIds.includes(buyersListId) ? [`${t.name} — ${s.label || `slot ${i + 1}`}`] : [])),
  )

type AssignedSlot = SlotDetail & { positionId: string; label: string; displayTypeName: string }

/* Every slot assigned to each list, saved assignments only: what Finalise confirms and what a deal needs at least one of before it can be shared. */
const assignedSlotsByList = async (ctx: Context) => {
  const out = new Map<string, AssignedSlot[]>()
  for (const t of await ctx.displayTypes.list()) {
    ;(t.phExtensions?.slots ?? []).forEach((s, i) => {
      for (const id of new Set(assignedOf(s).buyersListIds)) out.set(id, [...(out.get(id) ?? []), { positionId: positionIdOf(t.id, i + 1), label: `${t.name} — ${s.label || `slot ${i + 1}`}`, displayTypeName: t.name, ...slotDetailOf(t, i + 1) }])
    })
  }
  return out
}

/* The positions a deal is attached to: every slot assigned to it, as `displayTypeId.sN`. */
const positionsOfDeal = async (ctx: Context, buyersListId: string) =>
  (await ctx.displayTypes.list()).flatMap((t) =>
    (t.phExtensions?.slots ?? []).flatMap((s, i) => (assignedOf(s).buyersListIds.includes(buyersListId) ? [positionIdOf(t.id, i + 1)] : [])),
  )

/* A total for the term is refused when, across the slots the deal is assigned to, it is worth less than their floors over the term's forecast impressions. A deal with no slot yet has no forecast to convert against: it is checked again at Share, which needs a slot. */
const checkTermFloor = async (ctx: Context, listId: string, termTotal: number | null, activeFrom: string | null, activeTo: string | null, errors: { field: string; reason: string }[], override = false): Promise<boolean> => {
  if (termTotal == null) return false
  const reasons = belowFloorReasons(termTotal, await termSlotsOf(ctx, listId), termDaysOf(activeFrom, activeTo))
  /* With the admin's explicit override the deal is saved below the floor and records it (Rob, 22 Oct 2026); Share trusts that record. */
  if (!override) for (const reason of reasons) errors.push({ field: 'termTotal', reason: `${reason} Send belowFloorOverride: true to save it anyway.` })
  return reasons.length > 0 && override
}

/* Volume lives on the deal, never the open auction (open question 45): a
   deal's delivery is the plays billed at its positions inside its term. */
const withDelivery = async (ctx: Context, l: BuyersList, slots?: Map<string, AssignedSlot[]>): Promise<BuyersList> => {
  /* Committed volume and rate inherit platform default -> DSP -> this list (Rob, 7 Oct 2026); the rate is the
     base bid floor in USD CPM (the deal's own floor, else its DSP's, else the platform's), never blank. */
  const company = await ctx.company.get()
  const dsps = new Map((await ctx.partners.list()).map((p) => [p.id, p]))
  const invited = invitedPartnerIds(l, [...dsps.values()]).map((id) => dsps.get(id)?.bidder)
  /* Only a guaranteed deal carries volume, and it is the figure derived from its slots (21 Oct 2026); a private auction or preferred deal reports none. */
  const committed = isGuaranteedLike(l.dealType) ? l.committedPlays : null
  const effectiveCommittedPlays = { min: committed, max: committed, source: committed == null ? ('none' as const) : ('buyer' as const) }
  const effectiveRateCpm = effectiveTerm({ platform: company.floorCpm, dsp: invited.map((b) => b?.floorCpm), buyer: l.floorCpm }, (n) => Math.max(company.floorCpm, n))
  const equivalentCpm = isGuaranteedLike(l.dealType) && l.termTotal != null ? equivalentCpmRange(equivalentCpmOf(l.termTotal, await termSlotsOf(ctx, l.id), termDaysOf(l.activeFrom, l.activeTo))) : null
  return { ...l, effectiveCommittedPlays, effectiveRateCpm, equivalentCpm, deliveredPlays: await deliveredOf(ctx, l), assignedSlots: (slots ?? (await assignedSlotsByList(ctx))).get(l.id) ?? [] }
}
const deliveredOf = async (ctx: Context, l: BuyersList): Promise<number> =>
  l.committedPlays == null ? 0 : await ctx.billing.playsAt(await positionsOfDeal(ctx, l.id), l.activeFrom, l.activeTo)

export const buyersListRoutes = (ctx: Context, guards: Guards): FastifyPluginAsync => async (app) => {
  /* An invited buyer must be a seat a connected DSP actually synced. */
  const partnersById = async () => new Map((await ctx.partners.list()).filter((p) => p.status === 'connected').map((p) => [p.id, p]))
  /* A buyers list (deal) from the request body, checked field by field into
     `errors` rather than stopping at the first, so the editor can mark every
     field at once: name; the deal type, which decides which of the fields
     below it may carry; invited buyers (seats a connected DSP synced) and
     categories; targeting (only variables shared with every invited DSP,
     values from each variable's defined list); the delivery term; committed
     plays (guaranteed only); and the floor, never below the platform's. */
  const parse = (b: Body, partnerById: Map<string, PartnerRecord>, access: Record<string, Access>, defined: Record<string, VariableValues>, platformFloor: number, errors: { field: string; reason: string }[], legacyAuctionCloses: string | null = null, directIds: Set<string> = new Set()): { name: string; description: string; dealType: BuyersListDealType; invitedBuyers: InvitedBuyer[]; invitedCategories: string[]; targeting: Condition[]; activeFrom: string | null; activeTo: string | null; timeZoneMode: TimeZoneMode | undefined; auctionCloses: string | null; committedPlays: number | null; floorCpm: number | null; termTotal: number | null; belowFloorOverride: boolean } => {
    const name = typeof b.name === 'string' ? b.name.trim() : ''
    if (!name) errors.push({ field: 'name', reason: 'A name is required.' })
    const description = typeof b.description === 'string' ? b.description.trim() : ''
    /* The deal type (7 Oct 2026) decides which of the fields below the list may carry. Omitted by an older client: a private auction. */
    const requestedType = b.dealType === undefined || b.dealType === null ? 'private_auction' : b.dealType
    if (requestedType !== 'private_auction' && requestedType !== 'preferred' && requestedType !== 'guaranteed' && requestedType !== 'direct') errors.push({ field: 'dealType', reason: 'private_auction, preferred, guaranteed or direct.' })
    const dealType: BuyersListDealType = requestedType === 'preferred' || requestedType === 'guaranteed' || requestedType === 'direct' ? requestedType : 'private_auction'
    /* A Direct advertiser deal (22 Oct 2026) takes every Programmatic guaranteed rule; only who the buyer is differs. */
    const guaranteedLike = dealType === 'guaranteed' || dealType === 'direct'
    const rawBuyers = Array.isArray(b.invitedBuyers) ? (b.invitedBuyers as unknown[]) : null
    const invitedBuyers: InvitedBuyer[] = []
    if (b.invitedBuyers !== undefined && b.invitedBuyers !== null && !rawBuyers) errors.push({ field: 'invitedBuyers', reason: 'A list of seats.' })
    rawBuyers?.forEach((raw, i) => {
      const r = (raw ?? {}) as { partnerId?: unknown; seatId?: unknown }
      const partnerId = typeof r.partnerId === 'string' ? r.partnerId.trim() : ''
      const seatId = typeof r.seatId === 'string' ? r.seatId.trim() : ''
      const partner = partnerId ? partnerById.get(partnerId) : undefined
      if (dealType === 'direct') {
        if (partnerId !== DIRECT_PARTNER_ID || !directIds.has(seatId)) errors.push({ field: `invitedBuyers[${i}]`, reason: 'A Direct advertiser deal is with a direct advertiser: choose one from the Advertisers page (no DSP seats).' })
        else if (!invitedBuyers.some((x) => x.seatId === seatId)) invitedBuyers.push({ partnerId: DIRECT_PARTNER_ID, seatId })
        return
      }
      if (partnerId === DIRECT_PARTNER_ID) errors.push({ field: `invitedBuyers[${i}]`, reason: 'A direct advertiser can only be the buyer of a Direct advertiser deal.' })
      else if (!partner) errors.push({ field: `invitedBuyers[${i}].partnerId`, reason: 'Pick a connected DSP.' })
      else if (!partner.seats.some((x) => x.id === seatId)) errors.push({ field: `invitedBuyers[${i}].seatId`, reason: `Not a seat synced from ${partner.name}.` })
      else if (!invitedBuyers.some((x) => x.partnerId === partnerId && x.seatId === seatId)) invitedBuyers.push({ partnerId, seatId })
    })
    /* Invited by IAB category (Rob, 7 Oct 2026): IAB taxonomy names only, never free text (400 otherwise). Combines with the named seats as a union; a list needs at least one of the two. */
    const invitedCategories: string[] = []
    const rawCategories = b.invitedCategories === undefined || b.invitedCategories === null ? [] : Array.isArray(b.invitedCategories) ? (b.invitedCategories as unknown[]) : null
    if (!rawCategories) errors.push({ field: 'invitedCategories', reason: 'A list of IAB categories.' })
    /* Categories are a private-auction bid-time filter only: a preferred or guaranteed deal is a bilateral commitment to named seats, so an invited category has no meaning there. */
    else if (rawCategories.length && dealType !== 'private_auction') errors.push({ field: 'invitedCategories', reason: 'Only a private auction can invite IAB categories; a preferred, guaranteed or direct deal is with named buyers.' })
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
        if (isAggregateVariable(def.key) && (values.length !== 1 || !isValidAggregateValue((values[0] as string).trim()))) return void errors.push({ field: `targeting[${i}].values`, reason: `${def.label} takes one category and a percentage from 0 to 100, e.g. "Returns: 25%".` })
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
    /* The time zone the flight's start and end times are read in (22 Oct 2026): the platform's (the default) or each store's own. Omitted means as it is (the stored mode on an edit, the platform's on a create). */
    if (b.timeZoneMode !== undefined && b.timeZoneMode !== 'platform' && b.timeZoneMode !== 'store') errors.push({ field: 'timeZoneMode', reason: 'platform or store.' })
    const timeZoneMode: TimeZoneMode | undefined = b.timeZoneMode === 'platform' || b.timeZoneMode === 'store' ? b.timeZoneMode : undefined
    /* The two-period model is retired (Rob, 16 Oct 2026; industry-standard private auctions): invited buyers bid per slot for the whole flight, first price against the deal's CPM floor, with no auction window and no rate lock. A deal that already has an auctionCloses keeps it as a record (a locked deal honours its terms to flight end); no new one is accepted. */
    const auctionCloses = parseDate(b.auctionCloses, 'auctionCloses')
    if (auctionCloses && auctionCloses !== legacyAuctionCloses) errors.push({ field: 'auctionCloses', reason: 'Private auctions no longer have an auction window: invited buyers bid on each slot throughout the flight. Leave auctionCloses empty.' })
    /* A preferred deal is one named buyer at one fixed CPM, with first look at every slot (it may pass). */
    if (dealType === 'preferred') {
      if (invitedBuyers.length > 1) errors.push({ field: 'invitedBuyers', reason: 'A preferred deal is with one named buyer; use a private auction to invite several.' })
      if (b.floorCpm === undefined || b.floorCpm === null) errors.push({ field: 'floorCpm', reason: 'A preferred deal has a fixed CPM: enter the price the buyer pays on every slot it takes.' })
    }
    /* A programmatic guaranteed deal is one-to-one with its buyer (Rob, 21 Oct 2026): one buyer, one deal ID. Two advertisers on the same slot are two PG deals. Reduce a multi-buyer list to one before switching it to guaranteed. */
    if (guaranteedLike && invitedBuyers.length > 1) errors.push({ field: 'invitedBuyers', reason: `A ${dealType === 'direct' ? 'Direct advertiser' : 'programmatic guaranteed'} deal is with one named buyer; create a separate deal for each additional advertiser.` })
    /* committedPlays is derived from the assigned slots, the term and the guarantee buffer (21 Oct 2026): the caller computes it, so a typed one is refused rather than ignored. */
    if (b.committedPlays !== null && b.committedPlays !== undefined) errors.push({ field: 'committedPlays', reason: !guaranteedLike ? 'Only a guaranteed deal commits volume; leave it empty for a private auction or preferred deal.' : 'Committed plays is worked out from the slots assigned to the deal, its delivery term and the guarantee buffer; leave it out.' })
    /* Bid floor hierarchy (7 Oct 2026): blank inherits the DSP's floor, else the platform's; a value can raise the floor, never go below the platform floor. */
    let floorCpm: number | null = null
    /* Below-floor override (Rob, 22 Oct 2026): a Preferred or guaranteed deal may be priced under the platform floor when the admin explicitly overrides the warning. It has to be sent on every save that keeps the deal below the floor; the record notes it. A private auction's rate is only a floor, so it stays a hard limit. */
    if (b.belowFloorOverride !== undefined && typeof b.belowFloorOverride !== 'boolean') errors.push({ field: 'belowFloorOverride', reason: 'true or false.' })
    const override = b.belowFloorOverride === true
    let belowFloorOverride = false
    if (b.floorCpm !== undefined && b.floorCpm !== null) {
      if (typeof b.floorCpm !== 'number' || !Number.isFinite(b.floorCpm) || b.floorCpm <= 0) errors.push({ field: 'floorCpm', reason: 'Floor price (CPM) must be greater than 0, or empty to inherit.' })
      else if (b.floorCpm < platformFloor && override && (dealType === 'preferred' || guaranteedLike)) { floorCpm = b.floorCpm; belowFloorOverride = true }
      else if (b.floorCpm < platformFloor) errors.push({ field: 'floorCpm', reason: `Floor price (CPM) can't be below the platform floor of ${platformFloor} ${TRANSACTING_CURRENCY}.${dealType === 'preferred' || guaranteedLike ? ' Send belowFloorOverride: true to save it anyway.' : ''}` })
      else floorCpm = b.floorCpm
    }
    /* Programmatic guaranteed is priced as a fixed CPM (floorCpm) or a total for the whole term (termTotal, USD; 21 Oct 2026), not both. Its equivalent CPM needs the assigned slots' forecast, so the floor is checked once slots exist (checkTermFloor), not here. */
    let termTotal: number | null = null
    if (b.ratePerDay !== undefined && b.ratePerDay !== null) errors.push({ field: 'ratePerDay', reason: 'A rate per day is replaced by a fixed CPM or a total for the delivery term (termTotal).' })
    if (b.termTotal !== undefined && b.termTotal !== null) {
      if (!guaranteedLike) errors.push({ field: 'termTotal', reason: 'Only a Programmatic guaranteed or Direct advertiser deal is priced as a total for its term; leave it empty for a private auction or preferred deal.' })
      else if (typeof b.termTotal !== 'number' || !Number.isFinite(b.termTotal) || b.termTotal <= 0) errors.push({ field: 'termTotal', reason: 'Total for the term must be greater than 0 USD.' })
      else if (floorCpm != null) errors.push({ field: 'termTotal', reason: 'Price a guaranteed deal as a fixed CPM or a total for the term, not both.' })
      else termTotal = Math.round(b.termTotal * 100) / 100
    }
    const committedPlays: number | null = null
    return { name, description, dealType, invitedBuyers, invitedCategories, targeting, activeFrom, activeTo, timeZoneMode, auctionCloses, committedPlays, floorCpm, termTotal, belowFloorOverride }
  }

  const directIdsOf = async () => new Set((await ctx.company.directAdvertisers()).map((d) => d.advertiserId))

  app.get<{ Querystring: { archived?: string } }>('/buyers-lists', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'sections')
    const slots = await assignedSlotsByList(ctx)
    /* The live table by default; ?archived=true is View Archived Deals, newest archive first. */
    const archived = req.query.archived === 'true'
    const lists = await ctx.buyersLists.list(archived ? 'archived' : 'live')
    if (archived) lists.sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? ''))
    return { items: await Promise.all(lists.map((l) => withDelivery(ctx, l, slots))) }
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
    if (req.body?.status !== undefined && req.body.status !== 'draft' && req.body.status !== 'shared') errors.push({ field: 'status', reason: 'draft or shared.' })
    const parsed = parse(req.body ?? {}, await partnersById(), await ctx.company.variableAccess(), await ctx.company.variableValues(), (await ctx.company.get()).floorCpm, errors, null, await directIdsOf())
    await dealAudienceErrors(ctx, parsed, errors)
    if (errors.length) throw validationFailed(errors)
    const created: BuyersList = await ctx.buyersLists.insert({ by: auditActorOf(req).actor.name, id: `bl_${randomUUID().slice(0, 12)}`, dealId: mintDealId(), ...parsed, shared: req.body?.status !== 'draft' })
    return reply.status(201).send(await withDelivery(ctx, created))
  })

  /* Share deal (ticket QG40V1vVwqp9NtFmlC9H): the last step of Draft -> Finalise -> Share. A deal with no slot, or no named buyer to send it to, is not a deal yet. The check and the stamp are one transaction, so a slot cannot be unassigned in between. */
  app.post<{ Params: { buyersListId: string } }>('/buyers-lists/:buyersListId/share', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    const shared = await tx(ctx.db, async () => {
      const list = await ctx.buyersLists.get(req.params.buyersListId)
      if (!list) throw notFound()
      notArchived(list)
      if (list.status === 'shared') return list
      const errors: { field: string; reason: string }[] = []
      if (!(await positionsOfDeal(ctx, list.id)).length) errors.push({ field: 'assignedSlots', reason: 'Assign this deal to at least one slot in Available Inventory before sharing it.' })
      await checkTermFloor(ctx, list.id, list.termTotal ?? null, list.activeFrom, list.activeTo, errors, list.belowFloorOverride)
      if (!list.invitedBuyers.length) errors.push({ field: 'invitedBuyers', reason: 'Invite at least one named buyer: a deal that invites only IAB categories has no seat to share it with.' })
      if (errors.length) throw validationFailed(errors)
      /* The volume the buyers accept is the one the slots give today: refreshed first, so the deal is shared with its current figure. */
      await ctx.buyersLists.setCommittedPlays(list.id, await derivedCommittedPlays(ctx, list), auditActorOf(req).actor.name)
      return (await ctx.buyersLists.share(list.id)) as BuyersList
    })
    return withDelivery(ctx, shared)
  })

  /* Dry run of a PUT (ticket KcqiJpzR5RXy4TWODYlG): writes nothing; says whether saving would version the terms and which buyers who had accepted would have to accept again, so the UI can warn before save. */
  app.post<{ Params: { buyersListId: string }; Body: Body }>('/buyers-lists/:buyersListId/term-check', async (req): Promise<TermCheck> => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    const existing = await ctx.buyersLists.get(req.params.buyersListId)
    if (!existing) throw notFound()
    const errors: { field: string; reason: string }[] = []
    const body: Body = { ...(req.body ?? {}), dealType: req.body?.dealType ?? existing.dealType }
    const parsed = parse(body, await partnersById(), await ctx.company.variableAccess(), await ctx.company.variableValues(), (await ctx.company.get()).floorCpm, errors, existing.auctionCloses, await directIdsOf())
    await dealAudienceErrors(ctx, parsed, errors)
    /* The slots are the existing deal's; a changed deal type is a new deal with none. */
    if (parsed.dealType === existing.dealType && (await checkTermFloor(ctx, existing.id, parsed.termTotal, parsed.activeFrom, parsed.activeTo, errors, body.belowFloorOverride === true))) parsed.belowFloorOverride = true
    if (errors.length) throw validationFailed(errors)
    /* Committed plays follow the slots and the term: a changed term changes the figure, and that is part of what buyers re-accept. */
    if (parsed.dealType === existing.dealType) parsed.committedPlays = await derivedCommittedPlays(ctx, { id: existing.id, ...parsed })
    /* A different deal type mints a new deal: nothing on this one changes, so nobody re-accepts. */
    const changes = parsed.dealType !== existing.dealType || existing.status === 'draft' ? [] : termChanges(existing, parsed)
    const requiresReacceptance = needsReacceptance(changes)
    const partnerName = new Map((await ctx.partners.list()).map((p) => [p.id, p.name]))
    /* Only buyers still invited after the change can be asked to accept again. */
    const stillInvited = new Set(parsed.invitedBuyers.map((b) => `${b.partnerId}\u0000${b.seatId}`))
    const affectedBuyers = requiresReacceptance
      ? existing.buyerAcceptance.filter((a) => a.state === 'accepted' && stillInvited.has(`${a.partnerId}\u0000${a.seatId}`)).map((a) => ({ partnerId: a.partnerId, partnerName: partnerName.get(a.partnerId) ?? a.partnerId, seatId: a.seatId, acceptedVersion: a.acceptedVersion as number }))
      : []
    return { currentVersion: existing.termVersion, nextVersion: existing.termVersion + (changes.length ? 1 : 0), changes, requiresReacceptance, affectedBuyers }
  })

  /* Dry run of the reserving-deal overlap rule (Rob, 22 Oct 2026); writes nothing. Two questions, so the UI can warn inline before anything is saved:
       - a deal's flight: { listId, activeFrom, activeTo } -> its conflicts on every slot it is on;
       - a slot's assignment: { displayTypeId, slot, buyersListIds, candidates? } -> conflicts of the deals newly in the list, and for each candidate (an option in the Assigned to picker) what choosing it would clash with. */
  app.post<{ Body: { listId?: unknown; activeFrom?: unknown; activeTo?: unknown; dealType?: unknown; timeZoneMode?: unknown; displayTypeId?: unknown; slot?: unknown; buyersListIds?: unknown; candidates?: unknown } }>('/reserving-conflicts', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    const b = req.body ?? {}
    const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
    const date = (v: unknown): string | null => (typeof v === 'string' && v && !Number.isNaN(Date.parse(v)) ? v : null)
    if (typeof b.listId === 'string') {
      const list = await ctx.buyersLists.get(b.listId)
      if (!list) throw notFound()
      const dealType = (typeof b.dealType === 'string' ? b.dealType : list.dealType) as BuyersListDealType
      return { conflicts: await flightConflicts(ctx, { id: list.id, dealType, activeFrom: b.activeFrom === undefined ? list.activeFrom : date(b.activeFrom), activeTo: b.activeTo === undefined ? list.activeTo : date(b.activeTo) }), candidates: {} }
    }
    const dt = typeof b.displayTypeId === 'string' ? await ctx.displayTypes.get(b.displayTypeId) : null
    const slot = typeof b.slot === 'number' ? b.slot : 0
    const def = dt?.phExtensions?.slots?.[slot - 1]
    if (!dt || !def) throw validationFailed([{ field: 'displayTypeId', reason: 'A display type and one of its slots, or a listId, is required.' }])
    const chosen = strs(b.buyersListIds)
    const now = new Set(assignedOf(def).buyersListIds)
    const conflicts = []
    for (const id of chosen) {
      if (now.has(id)) continue
      const list = await ctx.buyersLists.get(id)
      if (list && isReserving(list)) conflicts.push(...(await slotConflicts(ctx, list, dt, slot, chosen)))
    }
    const candidates: Record<string, Awaited<ReturnType<typeof slotConflicts>>> = {}
    for (const id of strs(b.candidates)) {
      const list = await ctx.buyersLists.get(id)
      const found = list && isReserving(list) && !chosen.includes(id) ? await slotConflicts(ctx, list, dt, slot, chosen) : []
      if (found.length) candidates[id] = found
    }
    return { conflicts, candidates }
  })

  app.get<{ Params: { buyersListId: string } }>('/buyers-lists/:buyersListId/term-versions', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'sections')
    if (!(await ctx.buyersLists.get(req.params.buyersListId))) throw notFound()
    return { items: await ctx.buyersLists.termVersions(req.params.buyersListId) }
  })

  /* A buyer accepted the deal on its DSP: recorded against the current term version. */
  app.post<{ Params: { buyersListId: string }; Body: { partnerId?: unknown; seatId?: unknown } }>('/buyers-lists/:buyersListId/acceptances', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    const list = await ctx.buyersLists.get(req.params.buyersListId)
    if (!list) throw notFound()
    notArchived(list)
    if (list.status === 'draft') throw validationFailed([{ field: 'status', reason: 'This deal has not been shared yet, so there is nothing to accept.' }])
    if (list.dealType === 'direct') throw validationFailed([{ field: 'status', reason: 'A Direct advertiser deal is not sent to a DSP, so there is no buyer acceptance.' }])
    const partnerId = typeof req.body?.partnerId === 'string' ? req.body.partnerId.trim() : ''
    const seatId = typeof req.body?.seatId === 'string' ? req.body.seatId.trim() : ''
    if (!list.invitedBuyers.some((b) => b.partnerId === partnerId && b.seatId === seatId)) throw validationFailed([{ field: 'seatId', reason: 'Not a named invited buyer of this list.' }])
    return withDelivery(ctx, (await ctx.buyersLists.accept(list.id, partnerId, seatId)) as BuyersList)
  })

  app.put<{ Params: { buyersListId: string }; Body: Body }>('/buyers-lists/:buyersListId', async (req, reply) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    const existing = await ctx.buyersLists.get(req.params.buyersListId)
    if (!existing) throw notFound()
    notArchived(existing)
    const errors: { field: string; reason: string }[] = []
    /* Immutable like a DV360 deal: the ID can be echoed back unchanged, never altered. */
    if (req.body?.dealId !== undefined && req.body.dealId !== existing.dealId) errors.push({ field: 'dealId', reason: 'A deal ID cannot be changed.' })
    /* An omitted dealType means "as it is" on an edit, so an older client can never mint a new deal by accident. */
    const body: Body = { ...(req.body ?? {}), dealType: req.body?.dealType ?? existing.dealType }
    const parsed = parse(body, await partnersById(), await ctx.company.variableAccess(), await ctx.company.variableValues(), (await ctx.company.get()).floorCpm, errors, existing.auctionCloses, await directIdsOf())
    await dealAudienceErrors(ctx, parsed, errors)
    /* The slots are the existing deal's; a changed deal type is a new deal with none. */
    if (parsed.dealType === existing.dealType && (await checkTermFloor(ctx, existing.id, parsed.termTotal, parsed.activeFrom, parsed.activeTo, errors, body.belowFloorOverride === true))) parsed.belowFloorOverride = true
    if (errors.length) throw validationFailed(errors)
    /* Committed plays follow the slots and the term (21 Oct 2026). */
    if (parsed.dealType === existing.dealType) parsed.committedPlays = await derivedCommittedPlays(ctx, { id: existing.id, ...parsed })
    /* Reserving deals never overlap on a slot (Rob, 22 Oct 2026): new dates that meet another PG or Direct advertiser deal on any of this deal's slots are refused. Unchanged dates are not re-judged, so an old overlap never blocks a rename. */
    if (parsed.dealType === existing.dealType && isReserving(parsed) && (parsed.activeFrom !== existing.activeFrom || parsed.activeTo !== existing.activeTo)) {
      const clashes = await flightConflicts(ctx, { id: existing.id, ...parsed })
      if (clashes.length) throw conflict(clashes[0].message, clashes.map((c) => ({ field: 'activeTo', reason: c.message })))
    }
    /* A different deal type is a different deal: insert a new list with a new ID and leave this one (and its slot assignments and campaigns) as it was until it ends. */
    if (parsed.dealType !== existing.dealType) {
      const minted: BuyersList = await ctx.buyersLists.insert({ by: auditActorOf(req).actor.name, id: `bl_${randomUUID().slice(0, 12)}`, dealId: mintDealId(), ...parsed, shared: existing.status === 'shared' })
      return reply.status(201).send(await withDelivery(ctx, minted))
    }
    const updated = await ctx.buyersLists.update(req.params.buyersListId, { ...parsed, by: auditActorOf(req).actor.name })
    if (!updated) throw notFound()
    return withDelivery(ctx, updated)
  })

  /* Deals are archived, never deleted (ticket bCcJ2e00CRLxtd98Utlr). Refused while a slot is assigned to the deal, naming each slot; the check and the archive are one transaction, so no slot can be assigned in between. The change history records it: the archive is an update of the deal's status, archivedAt and archivedBy. */
  app.post<{ Params: { buyersListId: string } }>('/buyers-lists/:buyersListId/archive', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    const archived = await tx(ctx.db, async () => {
      const list = await ctx.buyersLists.get(req.params.buyersListId)
      if (!list) throw notFound()
      if (list.status === 'archived') return list
      const dependents = await dependentSlots(ctx, list.id)
      if (dependents.length) throw hasDependents("This deal can't be archived while a slot is assigned to it.", dependents.map((reason) => ({ field: 'slots', reason })))
      return (await ctx.buyersLists.archive(list.id, auditActorOf(req).actor.name)) as BuyersList
    })
    return withDelivery(ctx, archived)
  })
}
