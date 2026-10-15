import { describe, expect, it } from 'vitest'
import { effectiveFloorCpm } from '../src/domain/pricing'

const defaults = { floorCpm: 100, interactiveCpe: 0.5 }

describe('effective floor CPM (spec §4)', () => {
  it('is the resolved base floor, whatever the advertiser', () => {
    expect(effectiveFloorCpm(defaults)).toBe(100)
    expect(effectiveFloorCpm(defaults, 80)).toBe(80)
  })
  it('rounds to cents', () => {
    expect(effectiveFloorCpm({ ...defaults, floorCpm: 99.999 })).toBe(100)
  })
})
