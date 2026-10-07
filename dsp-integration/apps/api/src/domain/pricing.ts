/* Pricing maths (spec §4; API.md "Pricing maths"). Used by the Advertisers
   screen, inventory, forecast and the auction.

   effective floor CPM = resolved base floor × advertiser floorMultiplier
   (resolved base floor: see resolveBaseFloor — platform, DSP, buyers list)
   A bid, and the auction, clear against that one floor whatever the
   campaign's type. There is no personalised multiplier (Rob, 5 Oct 2026):
   every play bills at the window's committed CPM whatever tier played.

   Interactive is not a multiplier (Rob, 20 Sep): an interactive campaign
   pays the ordinary floor for its plays, and `interactiveCpe` on top each
   time someone engages with it — scanning the QR Control code. The
   advertiser's floor multiplier does not scale that fee. */
export interface PricingInputs { floorCpm: number; interactiveCpe: number }

const cents = (n: number) => Math.round(n * 100) / 100

/* The bid floor hierarchy (Rob, 7 Oct 2026): platform floor (Advertiser
   settings), then a per-DSP floor, then a per-buyers-list floor. The most
   specific floor that is set applies; a blank level inherits from the one
   above. The platform floor is the minimum: a DSP or list floor can raise
   it, never lower it (a stored value below it, because the platform floor
   was raised later, is clamped up to it). All in USD. */
export function resolveBaseFloor(platformCpm: number, dspCpm?: number | null, listCpm?: number | null): number {
  const level = typeof listCpm === 'number' ? listCpm : typeof dspCpm === 'number' ? dspCpm : platformCpm
  return Math.max(platformCpm, level)
}

export function effectiveFloorCpm(p: PricingInputs, advertiserFloorMultiplier: number, base: number = p.floorCpm) {
  return cents(base * advertiserFloorMultiplier)
}
