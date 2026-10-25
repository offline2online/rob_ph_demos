/* The overlap warning's span (E2E 22 Oct 2026): with flight times a same-day clash shows its hours, not only the date. */
import { describe, expect, it } from 'vitest'
import { dealRangeLabel, rangeLabel } from '../src/features/advertisers/reservingConflicts'

describe('rangeLabel', () => {
  it('shows the shared span to the minute when the API gives the instants', () => {
    expect(rangeLabel({ overlapFrom: '2027-10-05', overlapTo: '2027-10-05', overlapFromAt: '2027-10-05T11:00:00.000Z', overlapToAt: '2027-10-05T12:00:00.000Z' })).toBe('5 Oct 2027 11:00 to 5 Oct 2027 12:00')
  })
  it('falls back to dates without them', () => {
    expect(rangeLabel({ overlapFrom: '2026-11-20', overlapTo: '2026-11-30' })).toBe('2026-11-20 to 2026-11-30')
    expect(rangeLabel({ overlapFrom: '2026-11-20', overlapTo: '2026-11-20' })).toBe('2026-11-20')
  })
})

describe('dealRangeLabel', () => {
  it("shows the holding deal's own flight, not the shared span", () => {
    expect(dealRangeLabel({ overlapFrom: '2026-11-20', overlapTo: '2026-11-30', dealFromAt: '2026-11-01T00:00:00.000Z', dealToAt: '2026-11-30T23:59:59.999Z' })).toBe('1 Nov 2026 00:00 to 30 Nov 2026 23:59')
  })
  it('falls back to the shared span from an older API', () => {
    expect(dealRangeLabel({ overlapFrom: '2026-11-20', overlapTo: '2026-11-30' })).toBe('2026-11-20 to 2026-11-30')
  })
})
