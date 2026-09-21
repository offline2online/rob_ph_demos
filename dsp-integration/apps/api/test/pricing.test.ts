import { describe, expect, it } from 'vitest'
import { effectiveFloorCpm, effectiveFloors } from '../src/domain/pricing'

const defaults = { floorCpm: 100, personalisedMultiplier: 1.5, interactiveCpe: 0.5 }

describe('effective floor CPM (spec §4)', () => {
  it('localised / baseline: floor × advertiser multiplier only', () => {
    expect(effectiveFloorCpm(defaults, 1)).toBe(100)
    expect(effectiveFloorCpm(defaults, 1.2)).toBe(120)
  })
  it('personalised: floor × the personalised multiplier, scaled by the advertiser multiplier', () => {
    expect(effectiveFloorCpm(defaults, 1, { personalised: true })).toBe(150)
    expect(effectiveFloorCpm(defaults, 0.8, { personalised: true })).toBe(120)
  })
  /* Interactive is a fee per engagement, not a multiplier (Rob, 20 Sep). */
  it('reports the two floors a bid can be measured against', () => {
    expect(effectiveFloors(defaults, 0.8)).toEqual({ localised: 80, personalised: 120 })
  })
  it('rounds to cents', () => {
    expect(effectiveFloorCpm({ ...defaults, floorCpm: 99.99 }, 1.05)).toBe(104.99)
  })
})
