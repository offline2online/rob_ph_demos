/* Pre-auction enforcement (spec §7 "The auction", §4 "Billing"): the
   effective floor for the campaign's type and advertiser, the advertiser
   and category lists, and creative approval, all applied before a bid can
   win. Used by POST /v1/reservations and by the auction for DSP bids. */
import type { Context } from '../context'
import { supportedTargetingOf, targetingLabel } from '@ph-dsp/types'
import { type PositionRef, assignmentOf } from '../domain/positions'
import { effectiveLists, isBlocked, isOn } from '../domain/lists'
import { effectiveFloorCpm } from '../domain/pricing'
import type { PartnerRecord } from '../repos/PartnerRepo'
import { blockedDomains, categoryCodes } from './openrtb'

export type RefusalCode = 'not_approved' | 'below_floor' | 'advertiser_blocked' | 'category_blocked' | 'not_on_whitelist' | 'targeting_not_supported'
export interface Refusal { code: RefusalCode; reason: string }

/* The blacklist always subtracts; the advertiser whitelist is what a
   whitelist-only position uses (spec §6). */
export function checkAdvertiser(ctx: Context, p: PositionRef, partner: PartnerRecord, name: string, domains: string[] = []): Refusal | null {
  const eff = effectiveLists(partner, ctx.company.get())
  const blockedDomain = blockedDomains(partner, eff.blockList)
  if (isBlocked(name, eff) || domains.some((d) => blockedDomain.includes(d.trim().toLowerCase()))) return { code: 'advertiser_blocked', reason: `${name} is on the advertiser blacklist.` }
  if (assignmentOf(p.def) === 'whitelist_only' && !isOn(name, eff.allowList)) return { code: 'not_on_whitelist', reason: `${name} is not on the advertiser whitelist for this whitelist-only position.` }
  return null
}

/* Category lists (IAB codes on the bid). A blacklisted category never wins;
   on a whitelist-only position every category must be whitelisted (Q12). */
export function checkCategories(ctx: Context, p: PositionRef, cats: string[]): Refusal | null {
  const company = ctx.company.get()
  const black = categoryCodes(company.categoryBlacklist)
  const hit = cats.find((c) => black.includes(c))
  if (hit) return { code: 'category_blocked', reason: `Category ${hit} is on the category blacklist.` }
  if (assignmentOf(p.def) === 'whitelist_only' && company.categoryWhitelist.length) {
    const white = categoryCodes(company.categoryWhitelist)
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
  if (!ctx.campaigns.getCampaign(campaignId)?.activation.enabled) return { code: 'not_approved', reason: 'The campaign is approved but not activated.' }
  return null
}

/* What the position was opened up to (Rob, 20 Sep): a slot supports
   localised targeting until someone says otherwise on Advertisers /
   Inventory, so a personalised or interactive campaign can't buy it by
   default. A campaign with no type of its own counts as localised. */
export function checkTargeting(p: PositionRef, pricingType: string | null | undefined): Refusal | null {
  const supported = supportedTargetingOf(p.def)
  const wanted = pricingType === 'personalised' || pricingType === 'interactive' ? pricingType : 'localised'
  if (supported.includes(wanted)) return null
  return { code: 'targeting_not_supported', reason: `This position supports ${targetingLabel(supported).toLowerCase()} targeting only; the campaign is ${wanted}.` }
}

/* The effective floor a bid must clear: floor × the personalised multiplier
   × the advertiser's floor multiplier (spec §4). An interactive campaign
   clears the ordinary floor for its plays and pays the engagement fee on
   top of it (Rob, 20 Sep), so it has no floor of its own. */
export function floorFor(ctx: Context, pricingType: string | null | undefined, advertiserId: string | null | undefined) {
  const multiplier = advertiserId ? ctx.company.advertiserSetting(advertiserId).floorMultiplier : 1
  return effectiveFloorCpm(ctx.company.get(), multiplier, { personalised: pricingType === 'personalised' })
}

export function checkFloor(ctx: Context, cpm: number, pricingType: string | null | undefined, advertiserId: string | null | undefined): Refusal | null {
  const floor = floorFor(ctx, pricingType, advertiserId)
  return cpm >= floor ? null : { code: 'below_floor', reason: `${cpm} is below the effective floor of ${floor} ${ctx.company.get().currency} CPM.` }
}
