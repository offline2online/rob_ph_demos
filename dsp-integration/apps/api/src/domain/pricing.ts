/* Pricing maths (spec §4; API.md "Pricing maths"). Used by the Advertisers
   screen, inventory, forecast and the auction.

   effective floor CPM = floorCpm × advertiser floorMultiplier
   A bid, and the auction, clear against that one floor whatever the
   campaign's type. There is no personalised multiplier (Rob, 5 Oct 2026):
   every play bills at the window's committed CPM whatever tier played.

   Interactive is not a multiplier (Rob, 20 Sep): an interactive campaign
   pays the ordinary floor for its plays, and `interactiveCpe` on top each
   time someone engages with it — scanning the QR Control code. The
   advertiser's floor multiplier does not scale that fee. */
export interface PricingInputs { floorCpm: number; interactiveCpe: number }

const cents = (n: number) => Math.round(n * 100) / 100

export function effectiveFloorCpm(p: PricingInputs, advertiserFloorMultiplier: number) {
  return cents(p.floorCpm * advertiserFloorMultiplier)
}
