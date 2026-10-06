/* Guaranteed deal path (Rob, 7 Oct 2026). A reserve is either a PREFERRED deal
   (the premium window held at the reserve price, no volume promised: the
   existing reserve-price path, unchanged) or a GUARANTEED deal that also
   commits a delivery volume. Both wrap the same slot inventory.

   The committed volume is the window's forecast impressions less a
   contingency buffer for screen downtime, so expected delivery sits above
   the guarantee and make-goods are rare:

     forecast  = plays x audience for the window = the slot's VAC-d assumed
                 views per window (assumedViewsPerWindow): the audience score
                 already scales the scheduled plays across the estate, and it
                 is what billing realises against (billing/index.ts)
     committed = floor(forecast x (1 - buffer% / 100))

   The buffer is the retailer's, set on Advertiser settings (default 10%) and
   applied instance-wide to every guaranteed forecast. */
export const DEFAULT_GUARANTEE_BUFFER_PCT = 10
export const MAX_GUARANTEE_BUFFER_PCT = 50

export const guaranteedImpressions = (forecastImpressions: number, bufferPct: number) =>
  Math.max(0, Math.floor(forecastImpressions * (1 - bufferPct / 100)))
