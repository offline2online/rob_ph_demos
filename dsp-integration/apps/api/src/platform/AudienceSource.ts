/* Stand-in for audience scoring (spec §4): assumed views (VAC-d) per play
   window for each display type slot. The retailer populates the real
   framework from its own insights, automated where cameras are connected;
   the POC reads seeded numbers. Engineering swaps in the real source. */
import type { Db } from '../db/db'
import type { Rules } from '../domain/targetingValidation'

export interface Audience {
  assumedViewsPerWindow: number
  /* Counted by Vision/AI or MIST (OpenRTB qty.sourcetype 2) rather than estimated (1). */
  counted: boolean
}

export interface AudienceSource {
  forSlot(displayTypeId: string, slot: number): Audience
  /* The share of a slot's assumed views a targeted campaign can reach
     (spec §5: "targeting changes it"). Only the platform that holds the
     store and visitor data can answer this; see BUILD-PLAN Q9. */
  targetedShare(displayTypeId: string, rules: Rules | undefined): number
}

/* POC stand-in share: each AND group halves the audience (Q9). */
export const POC_SHARE_PER_AND_GROUP = 0.5

export const sqliteAudienceSource = (db: Db): AudienceSource => ({
  forSlot(displayTypeId, slot) {
    const r = db.prepare('SELECT assumed_views_per_window AS v, counted FROM audience_vacd WHERE display_type_id = ? AND slot = ?').get(displayTypeId, slot) as { v: number; counted: number } | undefined
    return { assumedViewsPerWindow: r?.v ?? 0, counted: !!r?.counted }
  },
  targetedShare: (_displayTypeId, rules) => POC_SHARE_PER_AND_GROUP ** (rules?.length ?? 0),
})
