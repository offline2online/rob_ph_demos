/* DSP clients by provider. Amazon Ads DSP and The Trade Desk connect in
   package 17. */
import type { Provider } from '@ph-dsp/types'
import type { DspClient, Fetch } from './DspClient'
import { googleDv360Client } from './googleDv360'

export interface DspEndpoints { dv360TokenUrl: string; dv360ApiBaseUrl: string }

export function dspClients(ep: DspEndpoints, fetchImpl?: Fetch): Partial<Record<Provider, DspClient>> {
  return {
    google_dv360: googleDv360Client({ tokenUrl: ep.dv360TokenUrl, apiBaseUrl: ep.dv360ApiBaseUrl }, fetchImpl),
  }
}
