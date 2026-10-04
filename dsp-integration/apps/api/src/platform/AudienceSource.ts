/* Stand-in for audience scoring (spec §4): assumed views (VAC-d) per play
   window for each display type slot. The retailer populates the real
   framework from its own insights, automated where cameras are connected;
   the POC reads seeded numbers. Engineering swaps in the real source. */
import { type Db, prepared, type Awaitable } from '../db/db'
import type { Rules } from '../domain/targetingValidation'

export interface Audience {
  assumedViewsPerWindow: number
  /* Counted by Vision/AI or MIST (OpenRTB qty.sourcetype 2) rather than estimated (1). */
  counted: boolean
  /* Whether the slot has a score: an audience_vacd row, or its display
     type's default VAC-d. An unscored slot reports 0 assumed views, which is
     "unknown", not "nobody watching": it is never sold or billed (ticket,
     30 Sep 2026). */
  scored: boolean
}

export interface AudienceSource {
  /* defaultVacd is the display type's default VAC-d per display — an
     exchange setting (Display Types → defaultVacd), resolved by the
     exchange through DisplayTypeSource and passed in (ticket
     DDOjJoYjraKROu4Ainj5, Rob 2 Oct 2026). The audience source owns only
     the per-slot score and each display's own counted/modelled override;
     it never reads display_types. null: the type has no default. */
  forSlot(displayTypeId: string, slot: number, defaultVacd: number | null, defaultCounted?: boolean): Awaitable<Audience>
  /* The share of a slot's assumed views a targeted campaign can reach
     (spec §5: "targeting changes it"). Only the platform that holds the
     store and visitor data can answer this; see BUILD-PLAN Q9. */
  targetedShare(displayTypeId: string, rules: Rules | undefined): Awaitable<number>
}

/* POC stand-in share: each AND group halves the audience (Q9). */
export const POC_SHARE_PER_AND_GROUP = 0.5

export const sqliteAudienceSource = (db: Db): AudienceSource => ({
  forSlot(displayTypeId, slot, dflt, dfltCounted = false) {
    const r = prepared(db, 'SELECT assumed_views_per_window AS v, counted FROM audience_vacd WHERE display_type_id = ? AND slot = ?').get(displayTypeId, slot) as { v: number; counted: number } | undefined
    if (r) return { assumedViewsPerWindow: r.v, counted: !!r.counted, scored: true }
    /* No slot score of its own: the slot inherits from its display type
       (ticket "Default VAC-d score per display type", 1 Oct 2026). The
       default is per display, so the slot's assumed views are the sum of
       its displays' scores — each display's own override where it has one,
       otherwise the default. A type with no displays yet counts as one. */
    if (dflt === null) return { assumedViewsPerWindow: 0, counted: false, scored: false }
    const d = prepared(db, 'SELECT COUNT(*) AS n, COALESCE(SUM(COALESCE(vacd_override, ?)), 0) AS total FROM displays WHERE display_type_id = ?').get(dflt, displayTypeId) as { n: number; total: number }
    return { assumedViewsPerWindow: d.n ? d.total : dflt, counted: dfltCounted, scored: true }
  },
  targetedShare: (_displayTypeId, rules) => POC_SHARE_PER_AND_GROUP ** (rules?.length ?? 0),
})
