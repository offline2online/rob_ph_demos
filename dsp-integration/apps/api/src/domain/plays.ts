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

/* Plays-per-window derivation (ticket "Derive plays per window from slot
   length x slots / billing unit", 8 Oct 2026). Three retailer-controlled
   inputs, nothing from an advertiser's creative:
     max slot length  - the longest one play may run (resolved company ->
                        display type -> slot), binding EVERY campaign on the
                        position, HQ's included;
     slots            - the loop positions of the rotation the slot plays in
                        (Max campaigns in rotation, Playlist Management),
                        HQ positions counted as well as advertiser ones;
     billing unit     - the play-window length.
   Loop length = max slot length x slots; plays per window =
   floor(window / loop length). A position gets one play per loop. */

/* The loop's length in seconds. A rotation always has at least one slot. */
export const loopLengthSecOf = (maxPlayLengthSec: number, slots: number): number => Math.max(0, maxPlayLengthSec) * Math.max(1, Math.floor(slots) || 1)

/* Plays one slot gets on ONE display in a window of `windowMs`. 0 when there
   is no slot length to count against or the window is shorter than one loop. */
export const playsPerWindowOf = (windowMs: number, maxPlayLengthSec: number, slots: number): number => {
  const loop = loopLengthSecOf(maxPlayLengthSec, slots)
  return loop > 0 && windowMs > 0 ? Math.floor(windowMs / 1000 / loop) : 0
}

/* The inverse, for a window set as a play count: how long it lasts. */
export const windowMsForPlays = (plays: number, maxPlayLengthSec: number, slots: number): number =>
  plays > 0 && maxPlayLengthSec > 0 ? plays * loopLengthSecOf(maxPlayLengthSec, slots) * 1000 : 0

/* Plays across the whole estate the position runs on: per display x displays. */
export const totalPlaysOf = (playsPerDisplay: number, displays: number): number => playsPerDisplay * Math.max(0, displays)
