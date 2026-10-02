/* Stand-in for audience scoring (spec §4): assumed views (VAC-d) per play
   window for each display type slot. The retailer populates the real
   framework from its own insights, automated where cameras are connected;
   the POC reads seeded numbers. Engineering swaps in the real source. */
import { type Db, prepared } from '../db/db'
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
  forSlot(displayTypeId: string, slot: number): Audience
  /* The share of a slot's assumed views a targeted campaign can reach
     (spec §5: "targeting changes it"). Only the platform that holds the
     store and visitor data can answer this; see BUILD-PLAN Q9. */
  targetedShare(displayTypeId: string, rules: Rules | undefined): number
}

/* POC stand-in share: each AND group halves the audience (Q9). */
export const POC_SHARE_PER_AND_GROUP = 0.5

/* The display type's default VAC-d (assumed views per play window, per
   display), or null when it has none. Stored in phExtensions so it saves
   with the rest of the DSP fields. Read from the parsed record, not with
   SQLite's json_extract, so the SQL runs unchanged on Postgres (ticket
   gAi2mkcm43uW6hrchOjh). forSlot is on the inventory hot path, so the parse
   is remembered per display type until its stored text changes. */
const parsedDefaults = new WeakMap<Db, Map<string, { text: string | null; v: number | null }>>()
export function defaultVacd(db: Db, displayTypeId: string): number | null {
  const r = prepared(db, 'SELECT ph_extensions FROM display_types WHERE id = ?').get(displayTypeId) as { ph_extensions: string | null } | undefined
  const text = r?.ph_extensions ?? null
  let byType = parsedDefaults.get(db)
  if (!byType) parsedDefaults.set(db, (byType = new Map()))
  const hit = byType.get(displayTypeId)
  if (hit && hit.text === text) return hit.v
  let v: number | null = null
  try {
    const ext = text ? (JSON.parse(text) as { defaultVacd?: unknown }) : null
    v = typeof ext?.defaultVacd === 'number' ? ext.defaultVacd : null
  } catch { v = null }
  if (byType.size > 10_000) byType.clear()
  byType.set(displayTypeId, { text, v })
  return v
}

export const sqliteAudienceSource = (db: Db): AudienceSource => ({
  forSlot(displayTypeId, slot) {
    const r = prepared(db, 'SELECT assumed_views_per_window AS v, counted FROM audience_vacd WHERE display_type_id = ? AND slot = ?').get(displayTypeId, slot) as { v: number; counted: number } | undefined
    if (r) return { assumedViewsPerWindow: r.v, counted: !!r.counted, scored: true }
    /* No slot score of its own: the slot inherits from its display type
       (ticket "Default VAC-d score per display type", 1 Oct 2026). The
       default is per display, so the slot's assumed views are the sum of
       its displays' scores — each display's own override where it has one,
       otherwise the default. A type with no displays yet counts as one. */
    const dflt = defaultVacd(db, displayTypeId)
    if (dflt === null) return { assumedViewsPerWindow: 0, counted: false, scored: false }
    const d = prepared(db, 'SELECT COUNT(*) AS n, COALESCE(SUM(COALESCE(vacd_override, ?)), 0) AS total FROM displays WHERE display_type_id = ?').get(dflt, displayTypeId) as { n: number; total: number }
    return { assumedViewsPerWindow: d.n ? d.total : dflt, counted: false, scored: true }
  },
  targetedShare: (_displayTypeId, rules) => POC_SHARE_PER_AND_GROUP ** (rules?.length ?? 0),
})
