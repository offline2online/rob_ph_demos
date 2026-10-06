/* The transacting unit is the play (ticket "Standardise the transacting unit
   on plays", 6 Oct 2026). Broadsign and programmatic DOOH generally sell
   plays; the impression multiplier (VAC-d) only converts plays to estimated
   impressions for pricing and billing. A window is therefore a number of
   plays, and its length in hours is derived from that, not the other way
   round: a slot plays once per loop, so a window of `windowSec` holds
   floor(windowSec / loopLengthSec) plays of the slot on each display. */

/* Plays one slot gets on ONE display in a window of `windowMs`, given the
   loop length (every slot of the rotation plays once per loop). 0 when there
   is no loop length to count against or the window is shorter than a loop. */
export const playsPerWindowOf = (windowMs: number, loopLengthSec: number): number =>
  loopLengthSec > 0 && windowMs > 0 ? Math.floor(windowMs / 1000 / loopLengthSec) : 0

/* The inverse, for a window set as a play count: how long it lasts. */
export const windowMsForPlays = (plays: number, loopLengthSec: number): number =>
  plays > 0 && loopLengthSec > 0 ? plays * loopLengthSec * 1000 : 0

/* Plays across the whole estate the position runs on: per display × displays. */
export const totalPlaysOf = (playsPerDisplay: number, displays: number): number => playsPerDisplay * Math.max(0, displays)
