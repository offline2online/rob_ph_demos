/* OpenRTB 2.6 bid requests with the DOOH object (API.md "OpenRTB — what we
   send and accept"; spec §7 "What a DOOH bid request carries"); a Website or
   Mobile App slot sold in real time carries `site` or `app` instead, with no
   impression multiplier. A request
   describes a venue and a moment, never a person: there is no `user`
   object, and no visitor, Personalisation or Computer Vision data. */
import { bidderTuning } from '../domain/partnerInput'
import { IAB_CATEGORY_CODES } from '@ph-dsp/types'
import { TRANSACTING_CURRENCY } from '../domain/currency'
import type { Context } from '../context'
import { type PositionRef, assignmentOf, inGlobalDeal, positionView, windowMsFor } from '../domain/positions'
import { assignedOf, openRtbInventoryOf } from '@ph-dsp/types'
import { isInvitedBuyer } from '../domain/buyersLists'
import { effectiveCategoryLists, effectiveLists, seatDomains } from '../domain/lists'
import { GLOBAL_DEAL_ID } from '../domain/exchange'
import { baseFloorFor } from './enforcement'
import { type Perm, standardBuyerBlocking } from '../dsp/DspProvider'
import { providerOf } from '../dsp/registry'
import type { PartnerRecord } from '../repos/PartnerRepo'

export interface BidRequest {
  id: string
  imp: {
    id: string
    video: { w: number; h: number; minduration: number; maxduration?: number }
    banner: { w: number; h: number }
    bidfloor: number
    bidfloorcur: string
    /* Absent on a website or mobile app impression: one impression per render, multiplier 1. */
    qty?: { multiplier: number; sourcetype: 2 }
    exp: number
    /* A deal position carries its SSP-issued deal ID, restricted to the invited seats (private_auction 1).
       An open position in the global deal carries the global deal ID with private_auction 0 and no wseat:
       it is open inventory behind a deal handle, not a PMP/PG deal. */
    pmp?: { private_auction: 0 | 1; deals: { id: string; at: 1; wseat?: string[] }[] }
    ext: { ph: { orientation: string; slotDurationSec: number; loopLengthSec: number; maxPlayLengthSec: number; shareOfVoice: number; playsPerWindow: number; mode?: 'realtime' } }
  }[]
  /* Exactly one of these, by the display type's touch point: dooh for
     Digital Signage and Kiosk, site for a Website, app for a Mobile App. */
  dooh?: { id: string; venuetype: string[]; venuetypetax: 1; publisher: { id: string; name: string; domain: string } }
  site?: { id: string; name: string; domain: string; publisher: { id: string; name: string; domain: string } }
  app?: { id: string; name: string; publisher: { id: string; name: string; domain: string } }
  source: { schain: { complete: 1; ver: '1.0'; nodes: { asi: string; sid: string; hp: 1 }[] } }
  cur: string[]
  bcat: string[]
  /* The per-DSP seat lists, in the shape that DSP reads (its provider's
     buyerBlocking hook): standard OpenRTB badv (domains), or a DSP's own
     ext permissions instead. */
  badv?: string[]
  ext?: { seatperms: Perm; advperms: Perm; domainperms: Perm }
  tmax: number
  at: 1
}

/* ext.creativeAudit: the DSP's own audit of the creative, in its own shape
   (domain/dspAudit.ts) — advisory only, Q40. */
export interface Bid { id?: string; impid?: string; dealid?: string; price?: number; crid?: string; adomain?: string[]; cat?: string[]; iurl?: string; ext?: { creativeAudit?: unknown } }
export interface BidResponse { id?: string; cur?: string; seatbid?: { seat?: string; bid?: Bid[] }[] }

/* badv carries domains: each blacklisted seat goes as the domain the DSP
   told us for it (seats pulled on connect). */
export const blockedDomains = (partner: PartnerRecord, blockList: string[]) => seatDomains(partner, blockList)

export const categoryCodes = (names: string[]) => names.map((n) => IAB_CATEGORY_CODES[n]).filter(Boolean)


/* imp.bidfloor: the resolved base floor for this DSP and, on a deal, its
   buyers list (platform, DSP, list: the most specific set, never below the
   platform floor), in USD, rounded to cents. The advertiser's floor
   multiplier is not applied: the request names no advertiser. */
const bidFloorFor = async (ctx: Context, p: PositionRef, partner: PartnerRecord, buyersListId?: string) =>
  Math.round((await baseFloorFor(ctx, { partner, position: p, buyersListId })) * 100) / 100

/* One request per sellable position, play window and DSP. The bid floor is
   the position's resolved base floor for that DSP; each bid is then held to the floor
   for its own campaign type and advertiser before it can win (spec §4).
   The position's view is the same for every DSP (no advertiser, so no
   floor multiplier); the auction works it out once and passes it in. */
export async function buildBidRequest(ctx: Context, p: PositionRef, partner: PartnerRecord, id: string, given?: Awaited<ReturnType<typeof positionView>>): Promise<BidRequest> {
  const view = given ?? (await positionView(ctx, p, { partner, advertiser: null, unknownAdvertiser: false }))
  const company = await ctx.company.get()
  const exchange = await ctx.exchange.get()
  const lists = effectiveLists(partner)
  const categoryLists = effectiveCategoryLists(company)
  const { width: w, height: h } = view.screen
  const inventory = openRtbInventoryOf(p.displayType.touchPoint)
  const publisher = { id: exchange.sellerId, name: exchange.organisation, domain: exchange.domain }
  const listId = assignmentOf(p.def) === 'deal' ? assignedOf(p.def).buyersListId : undefined
  const list = listId ? await ctx.buyersLists.get(listId) : null
  const pmp = list ? { private_auction: 1 as const, deals: [{ id: list.dealId, at: 1 as const, wseat: partner.seats.map((x) => x.id).filter((id) => isInvitedBuyer(list, partner, id)) }] }
    : inGlobalDeal(p.def, exchange.globalDealEnabled === true) ? { private_auction: 0 as const, deals: [{ id: GLOBAL_DEAL_ID, at: 1 as const }] } : undefined
  return {
    id,
    imp: [{
      id: '1',
      video: { w, h, minduration: 1, maxduration: view.screen.maxPlayLengthSec },
      banner: { w, h },
      bidfloor: await bidFloorFor(ctx, p, partner, list?.id),
      bidfloorcur: TRANSACTING_CURRENCY,
      /* This position's own window (OQ27): its assumed views and its length. sourcetype is always 2
         (publisher-provided): the audience counts come from our own cameras. 1 (measurement vendor)
         would misrepresent the source and, on The Trade Desk, needs a vendor domain we don't have.
         If an independent measurement partner is adopted, switch to 1 and send that vendor's domain.
         A website or mobile app impression has no multiplier at all (one render, one impression). */
      ...(inventory === 'dooh' ? { qty: { multiplier: view.assumedViewsPerWindow, sourcetype: 2 as const } } : {}),
      exp: Math.round(windowMsFor(p) / 1000),
      ...(pmp ? { pmp } : {}),
      ext: { ph: { orientation: view.screen.orientation, slotDurationSec: view.screen.slotDurationSec, loopLengthSec: view.screen.loopLengthSec, maxPlayLengthSec: view.screen.maxPlayLengthSec, shareOfVoice: view.screen.shareOfVoice, playsPerWindow: view.playsPerWindow } },
    }],
    ...(inventory === 'dooh' ? {
      dooh: {
        id: p.displayType.id,
        venuetype: view.screen.openOohVenueType ? [view.screen.openOohVenueType] : [],
        venuetypetax: 1 as const,
        publisher,
      },
    } : inventory === 'site' ? { site: { id: p.displayType.id, name: p.displayType.name, domain: exchange.domain, publisher } }
      : { app: { id: p.displayType.id, name: p.displayType.name, publisher } }),
    source: { schain: { complete: 1, ver: '1.0', nodes: [{ asi: exchange.domain, sid: exchange.sellerId, hp: 1 }] } },
    cur: [TRANSACTING_CURRENCY],
    bcat: categoryCodes(categoryLists.blockList),
    ...(providerOf(ctx.dsp, partner.provider)?.buyerBlocking ?? standardBuyerBlocking)(partner, lists),
    tmax: bidderTuning(partner.bidder, ctx.config).timeoutMs,
    at: 1,
  }
}
