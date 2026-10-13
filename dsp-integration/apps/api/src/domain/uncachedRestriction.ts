/* Bandwidth protection for real-time impressions (Rob, 7 Oct 2026). A client
   on a constrained in-store network (shared with POS and stock systems) does
   not want live creative downloads contending with trading, but does not
   want to go dark at peak either, and rejects a blunt "what plays when"
   daypart block. So the restriction is only on content the player does not
   already hold: while it is in force, a bid can win only if its creative is
   already cached on the player. Cached creative bids, wins and plays as
   normal throughout; outside the window everything bids as normal.

   The window is either a fixed daily start/end in the PLAYER'S LOCAL time
   (the store's wall clock, not UTC; Rob, 13 Oct 2026) or the store's trading
   hours, while the store is OPEN. Cache state, store hours and the store's
   clock belong to PH Core's player and store service
   (PH-CORE-BOUNDARIES.md), so the player sends all three on the impression
   signal rather than the exchange modelling them. */
import type { CompanySettings } from '../repos/CompanySettingsRepo'

export const UNCACHED_MODES = ['off', 'fixed', 'store_open'] as const
export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

/* Is the restriction in force? `storeOpen` and `localTime` (HH:MM on the player's own clock) are the player's reports; a missing one counts as not restricted, so a missing signal never blocks anything. */
export function uncachedRestricted(s: Pick<CompanySettings, 'uncachedRestriction' | 'uncachedRestrictionStart' | 'uncachedRestrictionEnd'>, localTime: string | undefined, storeOpen: boolean | undefined): boolean {
  if (s.uncachedRestriction === 'store_open') return storeOpen === true
  if (s.uncachedRestriction !== 'fixed') return false
  if (localTime === undefined || !HHMM.test(localTime)) return false
  const start = minutes(s.uncachedRestrictionStart)
  const end = minutes(s.uncachedRestrictionEnd)
  const at = minutes(localTime)
  if (start === end) return false
  return start < end ? at >= start && at < end : at >= start || at < end
}
