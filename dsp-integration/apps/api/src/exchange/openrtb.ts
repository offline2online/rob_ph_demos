/* OpenRTB 2.6 bid requests with the DOOH object (API.md "OpenRTB — what we
   send and accept"; spec §7 "What a DOOH bid request carries"). A request
   describes a venue and a moment, never a person: there is no `user`
   object, and no visitor, Personalisation or Computer Vision data. */
import { IAB_CATEGORY_CODES } from '@ph-dsp/types'
import type { Context } from '../context'
import { type PositionRef, positionView, windowMs } from '../domain/positions'
import { effectiveLists } from '../domain/lists'
import type { PartnerRecord } from '../repos/PartnerRepo'

export interface BidRequest {
  id: string
  imp: {
    id: string
    video: { w: number; h: number; minduration: number; maxduration: number }
    banner: { w: number; h: number }
    bidfloor: number
    bidfloorcur: string
    qty: { multiplier: number; sourcetype: 1 | 2 }
    exp: number
    ext: { ph: { orientation: string; slotDurationSec: number; loopLengthSec: number; shareOfVoice: number } }
  }[]
  dooh: { id: string; venuetype: string[]; venuetypetax: 1; publisher: { id: string; name: string; domain: string } }
  source: { schain: { complete: 1; ver: '1.0'; nodes: { asi: string; sid: string; hp: 1 }[] } }
  cur: string[]
  bcat: string[]
  badv: string[]
  tmax: number
  at: 1
}

export interface Bid { id?: string; impid?: string; price?: number; crid?: string; adomain?: string[]; cat?: string[]; iurl?: string }
export interface BidResponse { id?: string; cur?: string; seatbid?: { seat?: string; bid?: Bid[] }[] }

const looksLikeDomain = (s: string) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(s.trim())

/* badv carries domains. A blacklist entry that is a domain goes as is; one
   that names an advertiser goes as that advertiser's domain, where the DSP
   has told us it (seats pulled on connect). */
export function blockedDomains(partner: PartnerRecord, blockList: string[]) {
  const out = new Set<string>()
  for (const entry of blockList) {
    if (looksLikeDomain(entry)) out.add(entry.trim().toLowerCase())
    const seat = partner.seats.find((s) => s.name.trim().toLowerCase() === entry.trim().toLowerCase())
    if (seat?.domain) out.add(seat.domain.toLowerCase())
  }
  return [...out]
}

export const categoryCodes = (names: string[]) => names.map((n) => IAB_CATEGORY_CODES[n as keyof typeof IAB_CATEGORY_CODES]).filter(Boolean)

/* One request per sellable position, play window and DSP. The bid floor is
   the position's base effective floor; each bid is then held to the floor
   for its own campaign type and advertiser before it can win (spec §4).
   The position's view is the same for every DSP (no advertiser, so no
   floor multiplier); the auction works it out once and passes it in. */
export function buildBidRequest(ctx: Context, p: PositionRef, partner: PartnerRecord, id: string, view = positionView(ctx, p, { partner, advertiser: null, unknownAdvertiser: false })): BidRequest {
  const company = ctx.company.get()
  const exchange = ctx.exchange.get()
  const lists = effectiveLists(partner, company)
  const audience = ctx.audience.forSlot(p.displayType.id, p.slot)
  const { width: w, height: h } = view.screen
  return {
    id,
    imp: [{
      id: '1',
      video: { w, h, minduration: 1, maxduration: view.screen.slotDurationSec },
      banner: { w, h },
      bidfloor: view.pricing.effectiveFloorCpm.localised,
      bidfloorcur: company.currency,
      qty: { multiplier: audience.assumedViewsPerWindow, sourcetype: audience.counted ? 2 : 1 },
      exp: Math.round(windowMs(ctx) / 1000),
      ext: { ph: { orientation: view.screen.orientation, slotDurationSec: view.screen.slotDurationSec, loopLengthSec: view.screen.loopLengthSec, shareOfVoice: view.screen.shareOfVoice } },
    }],
    dooh: {
      id: p.displayType.id,
      venuetype: view.screen.openOohVenueType ? [view.screen.openOohVenueType] : [],
      venuetypetax: 1,
      publisher: { id: exchange.sellerId, name: exchange.organisation, domain: exchange.domain },
    },
    source: { schain: { complete: 1, ver: '1.0', nodes: [{ asi: exchange.domain, sid: exchange.sellerId, hp: 1 }] } },
    cur: [company.currency],
    bcat: categoryCodes(company.categoryBlacklist),
    badv: blockedDomains(partner, lists.blockList),
    tmax: ctx.config.bidderTimeoutMs,
    at: 1,
  }
}
