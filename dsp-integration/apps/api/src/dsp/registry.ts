/* The DSPs, one DspProvider each, in onboarding order (spec §7). This is the
   one list of DSPs the API knows; context.ts wires it in as `ctx.dsp`. */
import type { Provider } from '@ph-dsp/types'
import type { Fetch } from './DspClient'
import type { BidderEndpoints, DspProvider } from './DspProvider'
import { type AmazonRegion, amazonDspProvider } from './amazonDsp'
import { googleDv360Provider } from './googleDv360'
import { theTradeDeskProvider } from './theTradeDesk'

export interface DspEndpoints {
  dv360TokenUrl: string
  dv360ApiBaseUrl: string
  amazon: Record<AmazonRegion, { tokenUrl: string; apiBaseUrl: string }>
  ttdApiBaseUrl: string
}

export type DspProviders = Record<Provider, DspProvider>

export function dspProviders(ep: DspEndpoints, bidders: Partial<Record<Provider, BidderEndpoints>>, fetchImpl?: Fetch): DspProviders {
  return {
    google_dv360: googleDv360Provider({ tokenUrl: ep.dv360TokenUrl, apiBaseUrl: ep.dv360ApiBaseUrl }, bidders.google_dv360, fetchImpl),
    amazon_dsp: amazonDspProvider({ baseUrls: ep.amazon }, bidders.amazon_dsp, fetchImpl),
    the_trade_desk: theTradeDeskProvider({ apiBaseUrl: ep.ttdApiBaseUrl }, bidders.the_trade_desk, fetchImpl),
  }
}

/* A partner's DSP, by its stored provider key; undefined for a key this
   build doesn't know. */
export const providerOf = (dsps: DspProviders, provider: string): DspProvider | undefined =>
  Object.hasOwn(dsps, provider) ? dsps[provider as Provider] : undefined
