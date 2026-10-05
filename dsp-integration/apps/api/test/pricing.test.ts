import { describe, expect, it } from 'vitest'
import { effectiveFloorCpm } from '../src/domain/pricing'

const defaults = { floorCpm: 100, interactiveCpe: 0.5 }

describe('effective floor CPM (spec §4)', () => {
  it('one floor for every campaign type: floor × advertiser multiplier', () => {
    expect(effectiveFloorCpm(defaults, 1)).toBe(100)
    expect(effectiveFloorCpm(defaults, 1.2)).toBe(120)
    expect(effectiveFloorCpm(defaults, 0.8)).toBe(80)
  })
  it('rounds to cents', () => {
    expect(effectiveFloorCpm({ ...defaults, floorCpm: 99.99 }, 1.05)).toBe(104.99)
  })
})
