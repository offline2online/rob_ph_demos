/* DSP clients by provider, in onboarding order (spec §7). */
import type { Provider } from '@ph-dsp/types'
import type { DspClient, Fetch } from './DspClient'
import { amazonDspClient, type AmazonRegion } from './amazonDsp'
import { googleDv360Client } from './googleDv360'
import { theTradeDeskClient } from './theTradeDesk'

export interface DspEndpoints {
  dv360TokenUrl: string
  dv360ApiBaseUrl: string
  amazon: Record<AmazonRegion, { tokenUrl: string; apiBaseUrl: string }>
  ttdApiBaseUrl: string
}

export function dspClients(ep: DspEndpoints, fetchImpl?: Fetch): Record<Provider, DspClient> {
  return {
    google_dv360: googleDv360Client({ tokenUrl: ep.dv360TokenUrl, apiBaseUrl: ep.dv360ApiBaseUrl }, fetchImpl),
    amazon_dsp: amazonDspClient({ baseUrls: ep.amazon }, fetchImpl),
    the_trade_desk: theTradeDeskClient({ apiBaseUrl: ep.ttdApiBaseUrl }, fetchImpl),
  }
}
