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
   above. A display type may also carry its own floor (null = inherit the
   platform floor at read time; nothing in the product writes it yet), which
   sits between the platform and the DSP. The platform floor is the minimum: a DSP or list floor can raise
   it, never lower it (a stored value below it, because the platform floor
   was raised later, is clamped up to it). All in USD. */
export function resolveBaseFloor(platformCpm: number, dspCpm?: number | null, listCpm?: number | null, displayTypeCpm?: number | null): number {
  const level = typeof listCpm === 'number' ? listCpm : typeof dspCpm === 'number' ? dspCpm : typeof displayTypeCpm === 'number' ? displayTypeCpm : platformCpm
  return Math.max(platformCpm, level)
}

/* A deal term resolved per invited DSP through platform default -> DSP -> buyers list (Rob, 7 Oct 2026), so
   nothing the retailer has set at any level shows blank. When the list's invited DSPs resolve differently the
   range is returned (min..max) with source 'mixed'. */
export type TermSource = 'buyer' | 'dsp' | 'platform' | 'mixed' | 'none'
export interface EffectiveTerm { min: number | null; max: number | null; source: TermSource }
export function effectiveTerm(levels: { platform: number | null; dsp: (number | null | undefined)[]; buyer: number | null | undefined }, clamp: (n: number) => number = (n) => n): EffectiveTerm {
  const resolved = (levels.dsp.length ? levels.dsp : [undefined]).map((d): { v: number | null; source: TermSource } =>
    typeof levels.buyer === 'number' ? { v: levels.buyer, source: 'buyer' }
    : typeof d === 'number' ? { v: d, source: 'dsp' }
    : levels.platform !== null ? { v: levels.platform, source: 'platform' } : { v: null, source: 'none' })
  const values = resolved.map((r) => r.v).filter((v): v is number => v !== null).map(clamp)
  const sources = new Set(resolved.map((r) => r.source))
  return { min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null, source: sources.size === 1 ? [...sources][0] : 'mixed' }
}

export function effectiveFloorCpm(p: PricingInputs, advertiserFloorMultiplier: number, base: number = p.floorCpm) {
  return cents(base * advertiserFloorMultiplier)
}
