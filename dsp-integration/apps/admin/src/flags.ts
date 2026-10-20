/* Feature flags for the admin UI. Same switch as the API
   (DSP_INTEGRATION_ENABLED), read through one interface. */
export interface Flags {
  readonly dspIntegration: boolean
  /* Self-service for advertisers (not built yet). Off by default: UI that only
     matters once advertisers submit their own campaigns stays hidden until this
     is switched on. (The Available Inventory "Max campaigns" column is no longer
     gated by it: restored 12 Oct 2026.) */
  readonly selfService?: boolean
  /* DSP Integration → Change history. Off by default (Rob, 9 Oct 2026: "we will
     deal with this in a future release"): the menu row and the page's route stay
     hidden until this is switched on. The audit log itself is still recorded. */
  readonly changeHistory?: boolean
  /* Targeting criteria on deals and buyers lists. Off by default (ticket Zxw7VRUSytMAovkbDFKt):
     the first release does not support targeting, so the deal form hides the picker and a saved
     deal carries none. Switch it on to restore the picker and the criteria in the deal's tooltip. */
  readonly dealTargeting?: boolean
}

export const envFlags = (): Flags => ({
  dspIntegration: /^(1|true|yes|on)$/i.test(String(import.meta.env.DSP_INTEGRATION_ENABLED ?? '')),
  selfService: /^(1|true|yes|on)$/i.test(String(import.meta.env.SELF_SERVICE_ENABLED ?? '')),
  changeHistory: /^(1|true|yes|on)$/i.test(String(import.meta.env.CHANGE_HISTORY_ENABLED ?? '')),
  dealTargeting: /^(1|true|yes|on)$/i.test(String(import.meta.env.DEAL_TARGETING_ENABLED ?? '')),
})
