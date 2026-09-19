/* Pricing maths (spec §4; API.md "Pricing maths"). Used by the Advertisers
   screen, inventory, forecast and the auction.

   effective floor CPM = floorCpm
                       × personalisedMultiplier  (personalised campaigns only)
                       × interactiveMultiplier   (interactive campaigns only)
                       × advertiser floorMultiplier
   Multipliers stack and are not capped. Baseline and localised campaigns
   use floor × advertiser multiplier only. */
export interface PricingInputs { floorCpm: number; personalisedMultiplier: number; interactiveMultiplier: number }
export interface CampaignType { personalised?: boolean; interactive?: boolean }

const cents = (n: number) => Math.round(n * 100) / 100

export function effectiveFloorCpm(p: PricingInputs, advertiserFloorMultiplier: number, type: CampaignType = {}) {
  let floor = p.floorCpm
  if (type.personalised) floor *= p.personalisedMultiplier
  if (type.interactive) floor *= p.interactiveMultiplier
  return cents(floor * advertiserFloorMultiplier)
}

/* The four effective floors a position reports for a requester (Position.pricing). */
export const effectiveFloors = (p: PricingInputs, advertiserFloorMultiplier: number) => ({
  localised: effectiveFloorCpm(p, advertiserFloorMultiplier),
  personalised: effectiveFloorCpm(p, advertiserFloorMultiplier, { personalised: true }),
  interactive: effectiveFloorCpm(p, advertiserFloorMultiplier, { interactive: true }),
  personalisedInteractive: effectiveFloorCpm(p, advertiserFloorMultiplier, { personalised: true, interactive: true }),
})
