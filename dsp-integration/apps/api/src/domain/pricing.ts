/* Pricing maths (spec §4; API.md "Pricing maths"). Used by the Advertisers
   screen, inventory, forecast and the auction.

   effective floor CPM = floorCpm
                       × personalisedMultiplier  (personalised campaigns only)
                       × advertiser floorMultiplier
   Baseline and localised campaigns use floor × advertiser multiplier only.

   Interactive is not a multiplier (Rob, 20 Sep): an interactive campaign
   pays the ordinary floor for its plays, and `interactiveCpe` on top each
   time someone engages with it — scanning the QR Control code. The
   advertiser's floor multiplier does not scale that fee. */
export interface PricingInputs { floorCpm: number; personalisedMultiplier: number; interactiveCpe: number }
export interface CampaignType { personalised?: boolean }

const cents = (n: number) => Math.round(n * 100) / 100

export function effectiveFloorCpm(p: PricingInputs, advertiserFloorMultiplier: number, type: CampaignType = {}) {
  const floor = type.personalised ? p.floorCpm * p.personalisedMultiplier : p.floorCpm
  return cents(floor * advertiserFloorMultiplier)
}

/* What a position reports for a requester (Position.pricing): the two floors
   a bid can be measured against, and the engagement fee. */
export const effectiveFloors = (p: PricingInputs, advertiserFloorMultiplier: number) => ({
  localised: effectiveFloorCpm(p, advertiserFloorMultiplier),
  personalised: effectiveFloorCpm(p, advertiserFloorMultiplier, { personalised: true }),
})
