/* The deal sheet (ticket DbiT9qrFwL4O5ibgSowF): everything a DSP buyer needs to key a deal into their own platform by hand.
   DV360 and The Trade Desk both set a deal up this way today: the seller shares the deal ID, terms and creative spec out of
   band and the buyer creates the deal on their side; the deal ID is the handshake. One entry per invited DSP, because each
   DSP has its own deal ID (ticket fgBVnNItNcu7qMBUtqH7). The seller-initiated API push is a later phase, gated on PH being
   a certified supply source on each DSP (REQUIREMENTS.md §5 "Sharing a deal with the buyer", §7).
   Read-only: it derives from the list, its DSPs and its attached positions and stores nothing. */
import type { BuyersList } from '@ph-dsp/types'
import type { Context } from '../context'
import { dealSetupHint } from '../dsp/dealTerms'
import { baseFloorFor } from '../exchange/enforcement'
import { TRANSACTING_CURRENCY } from './currency'
import { creativeRequirementsFor, type CreativeRequirement } from './dealCreative'

export interface DealSheetEntry {
  partnerId: string
  dsp: string
  provider: string
  dealId: string
  seats: { id: string; name: string }[]
  setup: string
}

export interface DealSheet {
  buyersListId: string
  name: string
  dealType: BuyersList['dealType']
  currency: string
  rateCpm: number
  rateKind: 'floor' | 'fixed'
  activeFrom: string | null
  activeTo: string | null
  auctionCloses: string | null
  committedPlays: number | null
  entries: DealSheetEntry[]
  creativeRequirements: CreativeRequirement[]
}

export const DEAL_TYPE_LABEL: Record<BuyersList['dealType'], string> = { private_auction: 'Private auction', preferred: 'Preferred deal', guaranteed: 'Programmatic guaranteed' }

export async function dealSheetOf(ctx: Context, list: BuyersList): Promise<DealSheet> {
  /* A locked rate is what the deal bills at for the rest of its term; until then the rate is the resolved floor. */
  const locked = list.lockedWin?.cpm
  const partners = new Map((await ctx.partners.list()).map((p) => [p.id, p]))
  const entries: DealSheetEntry[] = []
  /* Category invitations name no seat, so there is nothing to share: only named seats get an entry. */
  for (const partnerId of [...new Set(list.invitedBuyers.map((b) => b.partnerId))]) {
    const partner = partners.get(partnerId)
    if (!partner) continue
    const seats = list.invitedBuyers.filter((b) => b.partnerId === partnerId).map((b) => ({ id: b.seatId, name: partner.seats.find((s) => s.id === b.seatId)?.name ?? b.seatId }))
    const dealId = (await ctx.buyersLists.dealIdFor(list.id, partnerId)) ?? list.dealId
    entries.push({ partnerId, dsp: partner.name, provider: partner.provider, dealId, seats, setup: dealSetupHint(partner.provider, list.dealType) })
  }
  return {
    buyersListId: list.id,
    name: list.name,
    dealType: list.dealType,
    currency: TRANSACTING_CURRENCY,
    rateCpm: locked ?? (await baseFloorFor(ctx, { buyersListId: list.id })),
    rateKind: locked != null ? 'fixed' : 'floor',
    activeFrom: list.activeFrom,
    activeTo: list.activeTo,
    auctionCloses: list.auctionCloses,
    committedPlays: list.dealType === 'guaranteed' ? list.committedPlays ?? null : null,
    entries,
    creativeRequirements: await creativeRequirementsFor(ctx, list.id),
  }
}

const cell = (v: string | number | null): string => {
  const s = v == null ? '' : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/* A flat sheet a buyer can open in Excel: one row per DSP deal ID and creative format. */
export function dealSheetCsv(sheet: DealSheet): string {
  const head = ['Deal name', 'DSP', 'Deal ID', 'Deal type', `Rate (${sheet.currency} CPM)`, 'Rate basis', 'Delivery from', 'Delivery to', 'Auction closes', 'Committed plays', 'Invited seats', 'Creative formats', 'Canvas size', 'Orientation', 'Max play length (s)']
  const reqs: (CreativeRequirement | null)[] = sheet.creativeRequirements.length ? sheet.creativeRequirements : [null]
  const rows = sheet.entries.flatMap((e) => reqs.map((r) => [
    sheet.name, e.dsp, e.dealId, DEAL_TYPE_LABEL[sheet.dealType], sheet.rateCpm, sheet.rateKind === 'fixed' ? 'Fixed rate' : 'Floor',
    sheet.activeFrom, sheet.activeTo, sheet.auctionCloses, sheet.committedPlays, e.seats.map((s) => `${s.name} (${s.id})`).join('; '),
    r?.formats.join(' + ') ?? '', r ? `${r.canvas.width}x${r.canvas.height}` : '', r?.orientation ?? '', r?.maxPlayLengthSec ?? '',
  ]))
  return `${[head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`
}
