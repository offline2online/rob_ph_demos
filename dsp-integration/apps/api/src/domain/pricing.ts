/* Pricing maths (spec §4; API.md "Pricing maths"). Used by the Advertisers
   screen, inventory, forecast and the auction.

   effective floor CPM = floorCpm × advertiser floorMultiplier
   A bid, and the auction, clear against that one floor whatever the
   campaign's type. The personalised multiplier is NOT part of it (Rob,
   30 Sep 2026): it is charged per personalised play, at billing, on top of
   the committed price — `personalisedPlayCpm` below.

   Interactive is not a multiplier (Rob, 20 Sep): an interactive campaign
   pays the ordinary floor for its plays, and `interactiveCpe` on top each
   time someone engages with it — scanning the QR Control code. The
   advertiser's floor multiplier does not scale that fee, and no
   personalised multiplier applies to it. */
export interface PricingInputs { floorCpm: number; personalisedMultiplier: number; interactiveCpe: number }

const cents = (n: number) => Math.round(n * 100) / 100

export function effectiveFloorCpm(p: PricingInputs, advertiserFloorMultiplier: number) {
  return cents(p.floorCpm * advertiserFloorMultiplier)
}

/* What one personalised play bills at: the committed (clearing) CPM × the
   personalised multiplier. floorMultiplier affects the floor only. */
export const personalisedPlayCpm = (clearingCpm: number, multiplier: number) => cents(clearingCpm * multiplier)

/* The multiplier written on a reservation when its window clears, so a later
   settings change cannot reprice it. null for an interactive campaign,
   which has no multiplier. */
export const multiplierToSnapshot = (p: PricingInputs, pricingType: string | null | undefined) => (pricingType === 'interactive' ? null : p.personalisedMultiplier)
