/* Feature flags for the admin UI. Same switch as the API
   (DSP_INTEGRATION_ENABLED), read through one interface. */
export interface Flags {
  readonly dspIntegration: boolean
}

export const envFlags = (): Flags => ({
  dspIntegration: /^(1|true|yes|on)$/i.test(String(import.meta.env.DSP_INTEGRATION_ENABLED ?? '')),
})
