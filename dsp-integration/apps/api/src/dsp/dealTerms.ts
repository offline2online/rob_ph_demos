import type { Provider } from '@ph-dsp/types'

/* What a DSP is told about a deal. DV360 Programmatic Guaranteed carries the
   committed volume as its unit count (impressions); Amazon's guaranteed deal
   takes it as the guaranteed impression count. The exact field names are to
   be confirmed against each DSP's sandbox (ticket dependency); a preferred
   deal holds the price and carries no volume on any DSP. */
export interface DspDealTerms { dealType: 'preferred' | 'guaranteed'; dspDealKind: string; unitCount: number | null; unit: 'impressions' | null }

export function dspDealTerms(provider: Provider | string, dealType: 'preferred' | 'guaranteed', committed: number | null): DspDealTerms {
  const guaranteed = dealType === 'guaranteed' && committed !== null
  const kind = (g: string, p: string) => (guaranteed ? g : p)
  switch (provider) {
    case 'google_dv360': return { dealType, dspDealKind: kind('programmatic_guaranteed', 'preferred_deal'), unitCount: guaranteed ? committed : null, unit: guaranteed ? 'impressions' : null }
    case 'amazon_dsp': return { dealType, dspDealKind: kind('guaranteed_deal', 'preferred_deal'), unitCount: guaranteed ? committed : null, unit: guaranteed ? 'impressions' : null }
    default: return { dealType, dspDealKind: kind('guaranteed', 'preferred_deal'), unitCount: guaranteed ? committed : null, unit: guaranteed ? 'impressions' : null }
  }
}

/* Where the buyer keys it in, per DSP. Wording follows each DSP's own UI; confirm against its sandbox before quoting externally. */
export const dealSetupHint = (provider: string, dealType: 'private_auction' | 'preferred' | 'guaranteed'): string => {
  const kind = dealType === 'guaranteed' ? 'guaranteed' : 'non-guaranteed'
  switch (provider) {
    case 'google_dv360': return `DV360: Inventory > My Inventory > New > ${kind} deal. Enter this deal ID, choose the exchange and format, and set the rate.`
    case 'the_trade_desk': return 'The Trade Desk: create a first-party / private contract and enter this deal ID as the supply vendor deal.'
    case 'amazon_dsp': return 'Amazon DSP: add a deal under Inventory > Deals with this deal ID and the terms below.'
    default: return 'Create the deal in your DSP using this deal ID and the terms below.'
  }
}
