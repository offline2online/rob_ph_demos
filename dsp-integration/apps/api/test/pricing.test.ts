import { describe, expect, it } from 'vitest'
import { effectiveFloorCpm, effectiveFloors } from '../src/domain/pricing'

const defaults = { floorCpm: 100, personalisedMultiplier: 1.5, interactiveMultiplier: 3 }

describe('effective floor CPM (spec §4)', () => {
  it('localised / baseline: floor × advertiser multiplier only', () => {
    expect(effectiveFloorCpm(defaults, 1)).toBe(100)
    expect(effectiveFloorCpm(defaults, 1.2)).toBe(120)
  })
  it('multipliers stack and are not capped: 100 × 1.5 × 3 = 450', () => {
    expect(effectiveFloorCpm(defaults, 1, { personalised: true, interactive: true })).toBe(450)
  })
  it('the advertiser multiplier scales the whole stacked total: 100 × 1.5 × 3 × 0.8 = 360', () => {
    expect(effectiveFloorCpm(defaults, 0.8, { personalised: true, interactive: true })).toBe(360)
  })
  it('reports all four floors for a requester', () => {
    expect(effectiveFloors(defaults, 0.8)).toEqual({ localised: 80, personalised: 120, interactive: 240, personalisedInteractive: 360 })
  })
  it('rounds to cents', () => {
    expect(effectiveFloorCpm({ ...defaults, floorCpm: 99.99 }, 1.05)).toBe(104.99)
  })
})
