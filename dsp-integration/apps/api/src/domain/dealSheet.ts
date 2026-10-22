/* The deal sheet (ticket DbiT9qrFwL4O5ibgSowF): everything a DSP buyer needs to key a deal into their own platform by hand.
   DV360 and The Trade Desk both set a deal up this way today: the seller shares the deal ID, terms and creative spec out of
   band and the buyer creates the deal on their side; the deal ID is the handshake. One entry per invited DSP, because each
   DSP has its own deal ID (ticket fgBVnNItNcu7qMBUtqH7). The seller-initiated API push is a later phase, gated on PH being
   a certified supply source on each DSP (REQUIREMENTS.md §5 "Sharing a deal with the buyer", §7).
   Read-only: it derives from the list, its DSPs and its attached positions and stores nothing. */
import { isGuaranteedLike, storeZoneLabel, type BuyersList, type TimeZoneMode } from '@ph-dsp/types'
import type { Context } from '../context'
import { dealSetupHint } from '../dsp/dealTerms'
import { baseFloorFor } from '../exchange/enforcement'
import { TRANSACTING_CURRENCY } from './currency'
import { creativeRequirementsFor, positionsOfList, type CreativeRequirement } from './dealCreative'
import { slotDetailOf, type SlotDetail } from './displayTypes'
import { equivalentCpmOf, equivalentCpmRange, termDaysOf, termSlotsOf } from './termPrice'
import { NO_TARGETING, scopeAndVolumeOf, targetingOf, type DealSheetInventoryScope, type DealSheetTargeting, type DealSheetVolume } from './dealSheetScope'

export interface DealSheetEntry {
  partnerId: string
  dsp: string
  provider: string
  dealId: string
  seats: { id: string; name: string }[]
  setup: string
  /* DV360 InventorySource: keyed by external_deal_id, with rate details, time range and the two statuses. */
  inventorySource: DealSheetInventorySource
}

/* PH share status and buyer acceptance in DV360's words: SellerStatus ACTIVE once PH has shared the deal (PENDING while a draft);
   BuyerStatus ACTIVE once a seat on this DSP holds the current terms, else PENDING. */
export interface DealSheetInventorySource {
  externalDealId: string
  /* Fixed per term (Programmatic guaranteed): `rate` is the USD total for the whole delivery term, `equivalentCpm` the same price as a CPM over the assigned slots' forecast. */
  rateDetails: { rate: number; rateType: RateType; currency: string; termDays?: number | null; equivalentCpm?: { min: number; max: number } | null }
  timeRange: { startTime: string | null; endTime: string | null }
  buyerStatus: 'PENDING' | 'ACTIVE'
  sellerStatus: 'PENDING' | 'ACTIVE'
  termVersion: number
}
export type RateType = 'CPM floor' | 'CPM fixed' | 'Fixed per term'
export const RATE_TYPE_OF: Record<BuyersList['dealType'], RateType> = { private_auction: 'CPM floor', preferred: 'CPM fixed', guaranteed: 'CPM fixed', direct: 'CPM fixed' }
/* A guaranteed deal priced as a total for its term (21 Oct 2026) is one fixed amount for the whole flight; otherwise its price is a CPM. */
export const isTermTotal = (l: Pick<BuyersList, 'dealType' | 'termTotal'>) => isGuaranteedLike(l.dealType) && l.termTotal != null
export const rateTypeOf = (l: Pick<BuyersList, 'dealType' | 'termTotal'>): RateType => (isTermTotal(l) ? 'Fixed per term' : RATE_TYPE_OF[l.dealType])

/* DV360 Product.transactionType. */
export const TRANSACTION_TYPE: Record<BuyersList['dealType'], string> = { private_auction: 'PRIVATE_AUCTION', preferred: 'PREFERRED_DEAL', guaranteed: 'PROGRAMMATIC_GUARANTEED', direct: 'PROGRAMMATIC_GUARANTEED' }

/* A slot the deal is assigned to, as the buyer should read it: number, zone and the display type's description. */
export interface DealSheetSlot extends SlotDetail { positionId: string; displayTypeName: string; label: string }

export const slotLine = (s: DealSheetSlot): string =>
  `${s.displayTypeName}${s.description ? ` (${s.description})` : ''}${s.zoneName ? `, ${s.zoneName}` : ''}, slot ${s.zoneSlot}${s.storeZone ? `, IAB zone: ${storeZoneLabel(s.storeZone)}` : ''}`

export interface DealSheet {
  buyersListId: string
  name: string
  dealType: BuyersList['dealType']
  currency: string
  rateCpm: number
  rateKind: 'floor' | 'fixed'
  /* Fixed per term only: the USD total for the whole delivery term, its length in days, and the same price as a CPM (null until the deal has a slot to forecast from). */
  termTotal?: number | null
  termDays?: number | null
  equivalentCpm?: { min: number; max: number } | null
  activeFrom: string | null
  activeTo: string | null
  /* The time zone the flight's times are read in: the platform's, or each store's own. */
  timeZoneMode: TimeZoneMode
  auctionCloses: string | null
  committedPlays: number | null
  entries: DealSheetEntry[]
  slots: DealSheetSlot[]
  creativeRequirements: CreativeRequirement[]
  /* DV360 Seller API structure: Order -> Product -> InventorySource (the last is on each entry). */
  order: { name: string; status: 'DRAFT' | 'PENDING_ACCEPTANCE' | 'ACCEPTED' }
  product: {
    name: string
    displayName: string
    transactionType: string
    pricingType: 'CPM'
    startTime: string | null
    endTime: string | null
    creativeConfig: { creativeType: string; width: number; height: number; maxDurationSec: number }[]
  }
  termVersion: number
  targeting: DealSheetTargeting
  inventoryScope: DealSheetInventoryScope
  estimatedVolume: DealSheetVolume
  /* Programmatic guaranteed only: committed plays x assumed views per play. Plays stay the stored figure. */
  guaranteedImpressions: number | null
  /* A short plain-language description to paste into a DSP's description field. */
  description: string
}

export const DEAL_TYPE_LABEL: Record<BuyersList['dealType'], string> = { private_auction: 'Private auction', preferred: 'Preferred deal', guaranteed: 'Programmatic guaranteed', direct: 'Direct advertiser' }

export async function dealSheetOf(ctx: Context, list: BuyersList): Promise<DealSheet> {
  /* A locked rate is what the deal bills at for the rest of its term; until then the rate is the resolved floor. */
  const locked = list.lockedWin?.cpm
  const floor = locked ?? (await baseFloorFor(ctx, { buyersListId: list.id }))
  const perTerm = isTermTotal(list)
  const termDays = termDaysOf(list.activeFrom, list.activeTo)
  const equivalentCpm = perTerm ? equivalentCpmRange(equivalentCpmOf(list.termTotal as number, await termSlotsOf(ctx, list.id), termDays)) : null
  /* A total for the term: the CPM on the sheet is the equivalent one; the rate a DSP keys in is the total. */
  const rate = perTerm ? equivalentCpm?.min ?? floor : floor
  const rateType = rateTypeOf(list)
  const partners = new Map((await ctx.partners.list()).map((p) => [p.id, p]))
  const entries: DealSheetEntry[] = []
  /* Category invitations name no seat, so there is nothing to share: only named seats get an entry. */
  for (const partnerId of [...new Set(list.invitedBuyers.map((b) => b.partnerId))]) {
    const partner = partners.get(partnerId)
    if (!partner) continue
    const seats = list.invitedBuyers.filter((b) => b.partnerId === partnerId).map((b) => ({ id: b.seatId, name: partner.seats.find((s) => s.id === b.seatId)?.name ?? b.seatId }))
    const dealId = (await ctx.buyersLists.dealIdFor(list.id, partnerId)) ?? list.dealId
    const accepted = list.buyerAcceptance.some((a) => a.partnerId === partnerId && a.state === 'accepted' && a.acceptedVersion === list.termVersion)
    entries.push({
      partnerId, dsp: partner.name, provider: partner.provider, dealId, seats, setup: dealSetupHint(partner.provider, list.dealType === 'direct' ? 'guaranteed' : list.dealType),
      inventorySource: {
        externalDealId: dealId,
        rateDetails: perTerm
          ? { rate: list.termTotal as number, rateType, currency: TRANSACTING_CURRENCY, termDays, equivalentCpm }
          : { rate, rateType, currency: TRANSACTING_CURRENCY },
        timeRange: { startTime: list.activeFrom, endTime: list.activeTo },
        buyerStatus: accepted ? 'ACTIVE' : 'PENDING',
        sellerStatus: list.status === 'shared' ? 'ACTIVE' : 'PENDING',
        termVersion: list.termVersion,
      },
    })
  }
  const positions = await positionsOfList(ctx, list.id)
  const creativeRequirements = await creativeRequirementsFor(ctx, list.id)
  const { inventoryScope, estimatedVolume } = await scopeAndVolumeOf(ctx, list, positions)
  const targeting = targetingOf(list)
  const committedPlays = isGuaranteedLike(list.dealType) ? list.committedPlays ?? null : null
  const guaranteedImps = committedPlays != null && estimatedVolume.assumedViewsPerPlay != null ? Math.round(committedPlays * estimatedVolume.assumedViewsPerPlay) : null
  const orderStatus = list.status !== 'shared' ? 'DRAFT' : entries.length && entries.every((e) => e.inventorySource.buyerStatus === 'ACTIVE') ? 'ACCEPTED' : 'PENDING_ACCEPTANCE'
  return {
    buyersListId: list.id,
    name: list.name,
    dealType: list.dealType,
    currency: TRANSACTING_CURRENCY,
    rateCpm: rate,
    rateKind: locked != null || perTerm || (isGuaranteedLike(list.dealType) && list.floorCpm != null) ? 'fixed' : 'floor',
    ...(perTerm ? { termTotal: list.termTotal, equivalentCpm } : {}),
    ...(isGuaranteedLike(list.dealType) ? { termDays } : {}),
    activeFrom: list.activeFrom,
    activeTo: list.activeTo,
    timeZoneMode: list.timeZoneMode ?? 'platform',
    auctionCloses: list.auctionCloses,
    committedPlays,
    entries,
    slots: positions.map((p) => ({ positionId: p.positionId, displayTypeName: p.displayType.name, label: `${p.displayType.name} — ${p.def.label || `slot ${p.slot}`}`, ...slotDetailOf(p.displayType, p.slot) })),
    creativeRequirements,
    order: { name: list.name, status: orderStatus },
    product: {
      name: list.name, displayName: list.name, transactionType: TRANSACTION_TYPE[list.dealType], pricingType: 'CPM', startTime: list.activeFrom, endTime: list.activeTo,
      creativeConfig: creativeRequirements.flatMap((r) => r.formats.map((f) => ({ creativeType: f, width: r.canvas.width, height: r.canvas.height, maxDurationSec: r.maxPlayLengthSec }))),
    },
    termVersion: list.termVersion,
    targeting,
    inventoryScope,
    estimatedVolume,
    guaranteedImpressions: guaranteedImps,
    description: descriptionOf(list, rate, targeting, inventoryScope, guaranteedImps, equivalentCpm),
  }
}

const day = (v: string | null) => (v ? v.slice(0, 10) : null)
export const TIME_ZONE_LABEL: Record<TimeZoneMode, string> = { platform: 'Platform time zone', store: 'Local store time' }
/* One paragraph a buyer can paste into a DSP's description field (The Trade Desk, until its deal model is confirmed). */
function descriptionOf(list: BuyersList, rate: number, t: DealSheetTargeting, scope: DealSheetInventoryScope, guaranteedImps: number | null, equivalentCpm: { min: number; max: number } | null): string {
  const flight = day(list.activeFrom) || day(list.activeTo) ? `, ${day(list.activeFrom) ?? 'open start'} to ${day(list.activeTo) ?? 'open end'} (${TIME_ZONE_LABEL[list.timeZoneMode ?? 'platform']})` : ''
  const where = scope.displays ? ` on ${scope.displays} ${scope.venueTypes.join('/') || 'retail'} screens in ${scope.stores} stores` : ''
  const vol = guaranteedImps ? ` Guarantees ${guaranteedImps.toLocaleString('en-GB')} impressions.` : ''
  const price = isTermTotal(list)
    ? `${list.termTotal} ${TRANSACTING_CURRENCY} for the whole term, a fixed total${equivalentCpm ? ` (equivalent ${equivalentCpm.min === equivalentCpm.max ? equivalentCpm.min : `${equivalentCpm.min}–${equivalentCpm.max}`} CPM)` : ''}`
    : `${rate} ${TRANSACTING_CURRENCY} ${rateTypeOf(list)}`
  return `${DEAL_TYPE_LABEL[list.dealType]}${flight}, ${price}${where}. Targeting: ${t.plainLanguage === NO_TARGETING ? 'none beyond the attached positions' : t.plainLanguage}.${vol}`
}

const cell = (v: string | number | null | undefined): string => {
  const s = v == null ? '' : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/* A flat sheet a buyer can open in Excel: one row per DSP deal ID and creative format, in DV360's field names. */
export function dealSheetCsv(sheet: DealSheet): string {
  const v = sheet.estimatedVolume, sc = sheet.inventoryScope
  const head = ['Order name', 'Order status', 'Product name', 'Display name', 'Transaction type', 'Deal type', 'Pricing type', 'Start time', 'End time', 'Deal ID', 'DSP', 'Rate', 'Rate type', 'Currency', 'Total for the term', 'Equivalent CPM', 'Buyer status', 'Seller status', 'Term version', 'Auction closes', 'Guaranteed impressions', 'Guaranteed plays', 'Buyers', 'Slots', 'Creative type', 'Width', 'Height', 'Max duration (s)',
    'Targeting', 'Targeting (DV360 type)', 'Seller-side only targeting', 'Venue types', 'Geography', 'Stores', 'Displays', 'Screen formats', 'Estimated plays per window', 'Estimated assumed views per window', 'Targeted share', 'Estimated guaranteed impressions per window', 'Description']
  const reqs: (CreativeRequirement | null)[] = sheet.creativeRequirements.length ? sheet.creativeRequirements : [null]
  const t = sheet.targeting
  const rows = sheet.entries.flatMap((e) => reqs.map((r) => [
    sheet.order.name, sheet.order.status, sheet.product.name, sheet.product.displayName, sheet.product.transactionType, DEAL_TYPE_LABEL[sheet.dealType], sheet.product.pricingType, sheet.product.startTime, sheet.product.endTime,
    e.inventorySource.externalDealId, e.dsp, e.inventorySource.rateDetails.rate, e.inventorySource.rateDetails.rateType, e.inventorySource.rateDetails.currency, sheet.termTotal ?? '', sheet.equivalentCpm ? (sheet.equivalentCpm.min === sheet.equivalentCpm.max ? sheet.equivalentCpm.min : `${sheet.equivalentCpm.min}-${sheet.equivalentCpm.max}`) : '', e.inventorySource.buyerStatus, e.inventorySource.sellerStatus, e.inventorySource.termVersion,
    sheet.auctionCloses, sheet.guaranteedImpressions, sheet.committedPlays, e.seats.map((s) => `${s.name} (${s.id})`).join('; '), sheet.slots.map(slotLine).join('; '),
    r?.formats.join(' + ') ?? '', r?.canvas.width ?? '', r?.canvas.height ?? '', r?.maxPlayLengthSec ?? '',
    t.plainLanguage, t.targetingCriteria.map((g) => `${g.targetingType}: ${g.conditions.map((c) => c.text).join('; ')}`).join(' | '), t.sellerSideOnly.map((c) => c.text).join('; '),
    sc.venueTypes.join('; '), sc.geography.join('; '), sc.stores, sc.displays, sc.screenFormats.map((f) => `${f.width}x${f.height} ${f.orientation}`).join('; '),
    v.playsPerWindow, v.assumedViewsPerWindow, v.targetedShare, v.guaranteedImpressionsPerWindow, sheet.description,
  ]))
  return `${[head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`
}
