/* Ticket jfQ4gbwnLCxVSR8ZeCP5 (28 Oct 2026): every admin surface values a deal with the one pricing formula (plays x VAC-d / 1,000 x CPM),
   so they agree with each other and with billing (realised VAC-d / 1,000 x CPM) for the same slot, plays and CPM. */
import { describe, expect, it } from 'vitest'
import { valueOfImpressions, valueOfPlays } from '@ph-dsp/types'
import { dealTotalValueText, pacingOf, slotImpressionsOver, slotPlaysOver, valueOf, valueText } from '../src/features/advertisers/effectiveTerm'
import { dealFigures } from '../src/features/advertisers/DealDetailsTip'

/* 1,000 plays a day over a one-day flight: 1,000 plays per window x 1 display, VAC-d 300 per play. */
const slot = { displayType: 'Portrait', description: null, storeZone: null, zoneName: null, playlist: '', position: 'Slot 1', slot: 1, playsPerWindow: 1000, displayCount: 1, windowHours: 24, vacdPerPlay: 300 }
const list = (over: Record<string, unknown> = {}) => ({ id: 'bl_1', dealType: 'guaranteed', lockedWin: null, termTotal: null, activeFrom: '2026-11-01T00:00:00Z', activeTo: '2026-11-01T23:59:00Z', effectiveRateCpm: { min: 10, max: 10, source: 'buyer' }, committedImpressions: 300_000, ...over }) as never
const BILLING = valueOfImpressions(300_000, 10)

describe('every surface prices a slot with VAC-d 300, 1,000 plays and a $10 CPM at $3,000', () => {
  it('Details hover: the slot and the deal total', () => {
    expect(slotPlaysOver(slot, 1)).toBe(1000)
    expect(slotImpressionsOver(slot, 1)).toBe(300_000)
    const f = dealFigures(list(), [slot])
    expect(f.totalImpressions).toBe(300_000)
    expect(f.total).toBe('USD 3,000')
    expect(valueText(valueOf(list(), 300_000, 300_000))).toBe('USD 3,000')
  })
  it('Campaign Approval deal total: committed impressions at the deal rate', () => {
    expect(dealTotalValueText(list())).toBe('USD 3,000')
    expect(dealTotalValueText(list({ committedImpressions: null }))).toBeNull()
    expect(dealTotalValueText(list({ termTotal: 12500 }))).toBe('USD 12,500')
  })
  it('agrees with billing for the same slot, plays and CPM', () => {
    expect(BILLING).toBe(3000)
    expect(valueOfPlays(1000, 300, 10)).toBe(BILLING)
    expect(valueOf(list(), slotImpressionsOver(slot, 1)!, 1)?.min).toBe(BILLING)
    expect(valueOf(list({ lockedWin: { cpm: 10 } }), 300_000, 300_000)?.min).toBe(BILLING)
  })
  it('a slot with no VAC-d has no impressions and no value rather than a plays-only figure', () => {
    expect(slotImpressionsOver({ ...slot, vacdPerPlay: null }, 1)).toBeNull()
    expect(dealFigures(list(), [{ ...slot, vacdPerPlay: null }]).total).toBeNull()
  })
  it('two slots with VAC-d 100 and 300 give impressions in the ratio 1:3', () => {
    expect(slotImpressionsOver({ ...slot, vacdPerPlay: 300 }, 1)! / slotImpressionsOver({ ...slot, vacdPerPlay: 100 }, 1)!).toBe(3)
  })
})

describe('Programmatic guaranteed pacing reads impressions', () => {
  it('is delivered against committed impressions', () => {
    const p = pacingOf({ dealType: 'guaranteed', committedImpressions: 300_000, deliveredImpressions: 150_000, activeFrom: '2026-11-01T00:00:00Z', activeTo: '2026-11-03T00:00:00Z' } as never, Date.parse('2026-11-02T00:00:00Z'))
    expect(p).toMatchObject({ delivered: 150_000, committed: 300_000, status: 'on pace', pct: 100 })
  })
})
