/* The one pricing formula (Rob, 28 Oct 2026; Broadsign model agreed 7 Oct 2026). Plays are the transacting unit and VAC-d is the
   impressions-per-play multiplier, so
     value = plays x VAC-d / 1,000 x CPM = impressions / 1,000 x CPM.
   Every money value in the platform (billing, booking revenue, forecasts, deal values, floors, reserve values, the minimum on the
   Slots filter row, the price a buyer sees) goes through valueOfImpressions; none divides plays by 1,000 itself. The one exception
   (15 Oct 2026): a CV-targeted / personalised matched play counts each match as one unit, with no VAC-d (use valueOfUnits). */

/* Impressions a number of plays deliver: plays x VAC-d per play. */
export const impressionsOfPlays = (plays: number, vacdPerPlay: number): number => plays * vacdPerPlay

/* Money for a number of impressions at a CPM (price per thousand impressions). Unrounded: callers round for display or storage. */
export const valueOfImpressions = (impressions: number, cpm: number): number => (impressions / 1000) * cpm

/* plays x VAC-d / 1,000 x CPM. */
export const valueOfPlays = (plays: number, vacdPerPlay: number, cpm: number): number => valueOfImpressions(impressionsOfPlays(plays, vacdPerPlay), cpm)

/* The personalised-match exception: each matched unit counts as one impression, with no VAC-d multiplier. */
export const valueOfUnits = (units: number, cpm: number): number => valueOfImpressions(units, cpm)

/* A slot's VAC-d per play: its window's assumed views over its plays in that window (across the displays). Null with no plays or no audience score. */
export const vacdPerPlayOf = (assumedViews: number, plays: number): number | null => (plays > 0 && assumedViews > 0 ? Math.round((assumedViews / plays) * 1e6) / 1e6 : null)
