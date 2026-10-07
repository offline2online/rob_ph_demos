/* The transacting unit is the play (ticket "Standardise the transacting unit
   on plays", 6 Oct 2026). Broadsign and programmatic DOOH generally sell
   plays; the impression multiplier (VAC-d) only converts plays to estimated
   impressions for pricing and billing. A window is therefore a number of
   plays, and its length in hours is derived from that, not the other way
   round: a window of `windowSec` holds floor(windowSec / maxPlayLengthSec)
   plays of the slot on each display.

   The divisor is the slot's resolved MAX PLAY LENGTH (ticket "Max play length
   as an inherited slot setting", 7 Oct 2026): a fixed per-play duration set
   in Advertiser settings (company → display type → slot), as Broadsign builds
   its loop from a fixed slot length in loop policy. It is never the loop
   length (which moves with the rotation) and never an advertiser's creative
   length (which differs by campaign): neither feeds this count. */

/* Plays one slot gets on ONE display in a window of `windowMs`, given the
   slot's resolved max play length. 0 when there is no play length to count
   against or the window is shorter than one play. */
export const playsPerWindowOf = (windowMs: number, maxPlayLengthSec: number): number =>
  maxPlayLengthSec > 0 && windowMs > 0 ? Math.floor(windowMs / 1000 / maxPlayLengthSec) : 0

/* The inverse, for a window set as a play count: how long it lasts. */
export const windowMsForPlays = (plays: number, maxPlayLengthSec: number): number =>
  plays > 0 && maxPlayLengthSec > 0 ? plays * maxPlayLengthSec * 1000 : 0

/* Plays across the whole estate the position runs on: per display × displays. */
export const totalPlaysOf = (playsPerDisplay: number, displays: number): number => playsPerDisplay * Math.max(0, displays)
