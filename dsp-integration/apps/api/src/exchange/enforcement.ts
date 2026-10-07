/* Pre-auction enforcement (spec §7 "The auction", §4 "Billing"): the
   effective floor for the campaign's type and advertiser, the advertiser
   and category lists, and creative approval, all applied before a bid can
   win. Used by POST /v1/reservations and by the auction for DSP bids. */
import type { Context } from '../context'
import { TRANSACTING_CURRENCY } from '../domain/currency'
import { INTERACTIVE_ENABLED, assignedOf, maxCampaignsOf } from '@ph-dsp/types'
import { type PositionRef, assignmentOf } from '../domain/positions'
import { isInvitedBuyer } from '../domain/buyersLists'
import { isActiveAt } from '../billing/term'
import { effectiveCategoryLists, effectiveLists, isBlocked, isOn } from '../domain/lists'
import { effectiveFloorCpm } from '../domain/pricing'
import type { PartnerRecord } from '../repos/PartnerRepo'
import { blockedDomains, categoryCodes } from './openrtb'

/* The first refusal among checks run in order; later checks don't run once
   one refuses (the `a ?? b ?? c` the synchronous checks used to be). */
export async function firstRefusal(...checks: (() => Refusal | null | Promise<Refusal | null>)[]): Promise<Refusal | null> {
  for (const check of checks) {
    const r = await check()
    if (r) return r
  }
  return null
}

export type RefusalCode = 'not_approved' | 'below_floor' | 'advertiser_blocked' | 'category_blocked' | 'not_on_whitelist' | 'not_invited' | 'targeting_not_supported' | 'too_many_versions'
export interface Refusal { code: RefusalCode; reason: string }

/* The DSP's own blacklist (seat IDs it synced) always subtracts; its
   whitelist is what a whitelist-only position uses (spec §6); a deal (private auction) checks
   the buyers list's invited buyers instead — this DSP's seat by its seatId — and that its delivery term covers the play window
   being sold (`windowStart`; the deal's term decides which windows it can
   sell, not when the bid arrives). Without a window it falls back to now. */
export async function checkAdvertiser(ctx: Context, p: PositionRef, partner: PartnerRecord, name: string, domains: string[] = [], seatId?: string | null, windowStart?: string): Promise<Refusal | null> {
  const eff = effectiveLists(partner)
  const blockedDomain = blockedDomains(partner, eff.blockList)
  const id = seatId ?? ''
  if ((id && isBlocked(id, eff)) || domains.some((d) => blockedDomain.includes(d.trim().toLowerCase()))) return { code: 'advertiser_blocked', reason: `${name} is on the advertiser blacklist.` }
  const assignment = assignmentOf(p.def)
  if (assignment === 'whitelist_only' && !(id && isOn(id, eff.allowList))) return { code: 'not_on_whitelist', reason: `${name} is not on the advertiser whitelist for this whitelist-only position.` }
  if (assignment === 'deal') {
    const listId = assignedOf(p.def).buyersListId
    const list = listId ? await ctx.buyersLists.get(listId) : null
    if (!list || !isActiveAt(list, windowStart ?? ctx.clock().toISOString()) || !isInvitedBuyer(list, partner.id, seatId)) {
      return { code: 'not_invited', reason: `${name} is not an invited buyer on this private auction${list ? ` (${list.name})` : ''}.` }
    }
  }
  return null
}

/* Category lists (IAB codes on the bid): the DSP's own when it has unlinked
   its list management, else the company's (same resolution as the
   advertiser lists checkAdvertiser uses above). A blacklisted category
   never wins; on a whitelist-only position every category must be
   whitelisted (Q12). */
export async function checkCategories(ctx: Context, p: PositionRef, partner: PartnerRecord, cats: string[]): Promise<Refusal | null> {
  const eff = effectiveCategoryLists(await ctx.company.get())
  const black = categoryCodes(eff.blockList)
  const hit = cats.find((c) => black.includes(c))
  if (hit) return { code: 'category_blocked', reason: `Category ${hit} is on the category blacklist.` }
  if (assignmentOf(p.def) === 'whitelist_only' && eff.allowList.length) {
    const white = categoryCodes(eff.allowList)
    if (!cats.length || cats.some((c) => !white.includes(c))) return { code: 'not_on_whitelist', reason: 'The bid’s categories are not all on the category whitelist.' }
  }
  return null
}

/* A campaign can only bid, be reserved, win or be handed off once it is
   approved and activated (Rob, Q14): the winner then fits straight into
   the slot. The contract has no separate code for "not activated", so it
   is `not_approved` with its own message. */
export async function checkCampaign(ctx: Context, campaignId: string): Promise<Refusal | null> {
  if (!(await ctx.approvals.isCampaignEligible(campaignId))) return { code: 'not_approved', reason: 'The campaign is not approved.' }
  if (!(await ctx.campaigns.getCampaign(campaignId))?.activation.enabled) return { code: 'not_approved', reason: 'The campaign is approved but not activated.' }
  return null
}

/* The real-time path's version of checkCampaign (Rob, 7 Oct 2026): a creative PH is still reviewing may play, because the review runs after the play. Only a rejected (or never submitted) creative is refused, and an approved one must still be activated. */
export async function checkCampaignAtBid(ctx: Context, campaignId: string): Promise<Refusal | null> {
  const status = await ctx.approvals.statusOf(campaignId)
  if (status === 'awaiting_approval') return null
  if (status === 'rejected') return { code: 'not_approved', reason: 'The creative was rejected on review and no longer plays.' }
  return checkCampaign(ctx, campaignId)
}

/* What kind of campaign may bid. Targeting is not a property of the slot
   (Rob, 7 Oct 2026): which dimensions a deal may use is defined on the buyers
   and targeting list assigned to the slot. Only the campaign's own type is
   checked here. A campaign with no type of its own counts as localised. */
export function checkTargeting(p: PositionRef, pricingType: string | null | undefined, reserve = false): Refusal | null {
  const wanted = pricingType === 'personalised' || pricingType === 'interactive' ? pricingType : 'localised'
  if (wanted === 'interactive' && !INTERACTIVE_ENABLED) return { code: 'targeting_not_supported', reason: 'Interactive campaigns are not available yet; the campaign is interactive.' }
  /* Personalised versions are sold only through a reserve booking (Rob,
     5 Oct 2026): an open or private auction clears default and localised
     only, so a personalised campaign cannot bid for a window. */
  if (wanted === 'personalised' && !reserve) return { code: 'targeting_not_supported', reason: 'Personalised campaigns are sold only through a reserve booking (type reserve) on a slot with a reserve price; open and private auctions clear default and localised only.' }
  return null
}

/* The slot's Max campaigns (slot override, else the display type's default,
   else 5; counting the default layer plus the targeted versions) is
   enforced where the campaign meets the slot (Rob, 1 Oct 2026): submission
   happens before booking, so it only guards package size. A campaign with
   more versions than the slot sells is refused at bid and reservation. */
export async function checkVersionCount(ctx: Context, p: PositionRef, campaignId: string): Promise<Refusal | null> {
  const t = (await ctx.campaigns.getCampaign(campaignId))?.targeting as { targeted?: unknown[] } | null | undefined
  const versions = 1 + (Array.isArray(t?.targeted) ? t.targeted.length : 0)
  const max = maxCampaignsOf(p.displayType, p.def)
  return versions <= max ? null : { code: 'too_many_versions', reason: `At most ${max} campaigns (default + targeted versions) for this slot.` }
}

/* The effective floor a bid must clear: the base floor × the advertiser's
   floor multiplier (spec §4), whatever the campaign's type. The personalised
   multiplier is not a floor (Rob, 30 Sep 2026): it is charged on personalised
   plays at billing. An interactive campaign clears the ordinary floor for its
   plays and pays the engagement fee on top of it (Rob, 20 Sep). */
export async function floorFor(ctx: Context, advertiserId: string | null | undefined): Promise<number> {
  const multiplier = advertiserId ? (await ctx.company.advertiserSetting(advertiserId)).floorMultiplier : 1
  return effectiveFloorCpm(await ctx.company.get(), multiplier)
}

export async function checkFloor(ctx: Context, cpm: number, advertiserId: string | null | undefined): Promise<Refusal | null> {
  const floor = await floorFor(ctx, advertiserId)
  return cpm >= floor ? null : { code: 'below_floor', reason: `${cpm} is below the effective floor of ${floor} ${TRANSACTING_CURRENCY} CPM.` }
}
