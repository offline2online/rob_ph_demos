/* Feature flags. `dspIntegration` gates everything this build adds; it is
   off by default so the branch can merge before DSPs are live. */
export interface Flags {
  readonly dspIntegration: boolean
}

export const envFlags = (env: NodeJS.ProcessEnv = process.env): Flags => ({
  dspIntegration: /^(1|true|yes|on)$/i.test(env.DSP_INTEGRATION_ENABLED ?? ''),
})

export const staticFlags = (dspIntegration: boolean): Flags => ({ dspIntegration })
