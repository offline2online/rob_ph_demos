import { describe, expect, it } from 'vitest'
import { testContext } from './helpers'

describe('stub store trading hours', () => {
  it('the demo seed gives every store varied hours, all under 24, so Store hours plays fewer than 24 hours', async () => {
    const ctx = await testContext({ demo: true })
    const stores = await ctx.stores.list()
    expect(stores.length).toBeGreaterThan(4)
    for (const s of stores) expect(s.closeHour - s.openHour, s.name).toBeLessThan(24)
    expect(new Set(stores.map((s) => `${s.openHour}-${s.closeHour}`)).size).toBeGreaterThan(3)
  })
})
