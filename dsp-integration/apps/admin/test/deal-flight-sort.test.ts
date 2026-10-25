import { describe, expect, it } from 'vitest'
import { compareFlights } from '../src/features/advertisers/BuyersListsTable'

describe('Flight dates sort', () => {
  it('orders by start, then end, with a missing start first', () => {
    const rows = ['2026-12-01T00:00|2026-12-31T00:00', 'null|null', '2026-11-01T00:00|2026-11-30T00:00', '2026-11-01T00:00|2026-11-15T00:00']
    expect([...rows].sort(compareFlights)).toEqual(['null|null', '2026-11-01T00:00|2026-11-15T00:00', '2026-11-01T00:00|2026-11-30T00:00', '2026-12-01T00:00|2026-12-31T00:00'])
  })
})
