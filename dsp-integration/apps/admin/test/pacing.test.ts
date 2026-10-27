import { describe, expect, it } from 'vitest'
import { pacingOf } from '../src/features/advertisers/effectiveTerm'

const NOW = Date.parse('2026-11-06T00:00:00Z')
const deal = (over: Record<string, unknown> = {}) => ({ dealType: 'guaranteed', committedImpressions: 1000, deliveredImpressions: 500, activeFrom: '2026-11-01T00:00:00Z', activeTo: '2026-11-11T00:00:00Z', ...over }) as never

describe('Programmatic guaranteed delivery pacing (Booking schedule hover)', () => {
  it('is on pace within 5% of the impressions due, behind below and ahead above', () => {
    expect(pacingOf(deal(), NOW)).toMatchObject({ delivered: 500, committed: 1000, status: 'on pace', pct: 100 })
    expect(pacingOf(deal({ deliveredImpressions: 480 }), NOW)).toMatchObject({ status: 'on pace', pct: 96 })
    expect(pacingOf(deal({ deliveredImpressions: 100 }), NOW)).toMatchObject({ status: 'behind', pct: 20 })
    expect(pacingOf(deal({ deliveredImpressions: 900 }), NOW)).toMatchObject({ status: 'ahead', pct: 180 })
  })
  it('is not started before the flight and has no pacing for other deals, no commitment or an open flight', () => {
    expect(pacingOf(deal({ activeFrom: '2026-11-20T00:00:00Z', activeTo: '2026-11-30T00:00:00Z', deliveredImpressions: 0 }), NOW)).toMatchObject({ status: 'not started', pct: null })
    expect(pacingOf(deal({ dealType: 'direct' }), NOW)).toBeNull()
    expect(pacingOf(deal({ committedImpressions: null }), NOW)).toBeNull()
    expect(pacingOf(deal({ activeTo: null }), NOW)).toBeNull()
  })
  it('is all due once the flight has ended', () => {
    expect(pacingOf(deal({ deliveredImpressions: 1000 }), Date.parse('2026-12-01T00:00:00Z'))).toMatchObject({ status: 'on pace', pct: 100 })
  })
})
