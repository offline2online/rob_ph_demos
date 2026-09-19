/* One client per DSP, speaking that DSP's real API over HTTP. In the POC
   every base URL points at the mock DSP service (apps/dsp-mocks); on
   integration engineering sets the real ones (sandbox first). No real DSP
   is ever called from the POC. */
export interface Seat { id: string; name: string }
export type ConnectResult = { ok: true; seats: Seat[] } | { ok: false; reason: string }

export interface DspClient {
  /* Authenticate with the saved credentials and pull the DSP's advertisers. */
  connect(creds: { public: Record<string, string>; secrets: Record<string, string> }): Promise<ConnectResult>
}

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>

export const unreachable = (dsp: string, e: unknown): ConnectResult => ({ ok: false, reason: `Could not reach ${dsp}: ${e instanceof Error ? e.message : String(e)}` })
