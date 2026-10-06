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
