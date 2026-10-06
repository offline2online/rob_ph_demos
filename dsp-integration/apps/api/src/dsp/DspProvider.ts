/* One DSP, and everything the exchange needs from it, behind one shape.
   Each provider module (googleDv360.ts, amazonDsp.ts, theTradeDesk.ts)
   owns all of its DSP's quirks and builds one of these: its management
   API client (Connect / Re-test), where its OpenRTB bid requests go, its
   creative-path rule and its pre-approval hook. registry.ts lists them and
   context.ts wires them in (`ctx.dsp`). The auction, the creative path and
   the routes call these blind: none of them branches on which DSP it is.

   Adding a DSP is one new module and one line in registry.ts, plus its
   credential form in @ph-dsp/types PROVIDERS and its endpoints in
   config.ts. */
import type { Provider } from '@ph-dsp/types'
import type { Check } from '../domain/assetChecks'
import { type EffectiveLists, seatDomains } from '../domain/lists'
import type { PartnerRecord } from '../repos/PartnerRepo'
import type { DspClient } from './DspClient'

export interface DspProvider extends DspClient {
  key: Provider
  /* Where this DSP's OpenRTB bid requests go (bidder.ts sends them); unset,
     none are sent. */
  bidUrl: string | undefined
  /* The creative-path rule: an unknown creative in a bid may be retrieved
     from `url` only if it is under this DSP's own creative host and path. */
  ownsCreativeUrl(url: string): boolean
  /* The pre-approval hook: this DSP's own audit of a creative, in its own
     shape, as an ADVISORY check for the reviewer (Q40) — or null when the
     DSP said nothing usable. It never approves or blocks a creative. */
  auditCheck(raw: unknown): Check | null
  /* How this DSP's bid requests carry the retailer's per-DSP seat lists:
     the standard OpenRTB `badv` (standardBuyerBlocking) or the DSP's own
     fields (TTD's `ext` permissions). openrtb.ts spreads the result in. */
  buyerBlocking(partner: PartnerRecord, lists: EffectiveLists): BuyerBlocking
}

export interface Perm { allow: string[]; block: string[] }
export type BuyerBlocking = { badv: string[] } | { ext: { seatperms: Perm; advperms: Perm; domainperms: Perm } }

/* Standard OpenRTB: the blacklisted seats go as their domains in badv. */
export const standardBuyerBlocking = (partner: PartnerRecord, lists: EffectiveLists): BuyerBlocking =>
  ({ badv: seatDomains(partner, lists.blockList) })

/* Per provider, from config.ts `bidders`: the bid URL and the only base URL
   a creative may be fetched from. */
export interface BidderEndpoints { bidUrl: string; creativeBase: string }

/* Is `url` under `base`? Compared after URL normalisation, so
   `…/creatives/../x` (which a plain string prefix check lets through) is
   refused, as is any URL carrying credentials. */
export function underBase(url: string, base: string) {
  try {
    const u = new URL(url)
    const b = new URL(base)
    return u.origin === b.origin && u.pathname.startsWith(b.pathname) && !u.username && !u.password
  } catch {
    return false
  }
}

/* The parts every provider builds the same way from its bidder endpoints. */
export const bidderSide = (ep: BidderEndpoints | undefined) => ({
  bidUrl: ep?.bidUrl,
  ownsCreativeUrl: (url: string) => !!ep?.creativeBase && underBase(url, ep.creativeBase),
})
