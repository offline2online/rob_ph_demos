import { describe, expect, it } from 'vitest'
import { effectiveFloorCpm, multiplierToSnapshot, personalisedPlayCpm } from '../src/domain/pricing'

const defaults = { floorCpm: 100, personalisedMultiplier: 1.5, interactiveCpe: 0.5 }

describe('effective floor CPM (spec §4)', () => {
  it('one floor for every campaign type: floor × advertiser multiplier', () => {
    expect(effectiveFloorCpm(defaults, 1)).toBe(100)
    expect(effectiveFloorCpm(defaults, 1.2)).toBe(120)
    expect(effectiveFloorCpm(defaults, 0.8)).toBe(80)
  })
  it('the personalised multiplier is not part of the floor (Rob, 30 Sep 2026)', () => {
    expect(effectiveFloorCpm({ ...defaults, personalisedMultiplier: 3 }, 1)).toBe(100)
  })
  it('rounds to cents', () => {
    expect(effectiveFloorCpm({ ...defaults, floorCpm: 99.99 }, 1.05)).toBe(104.99)
  })
})

describe('personalised multiplier (per play, not a floor)', () => {
  it('a personalised play bills at the committed price × the multiplier; floorMultiplier does not scale it', () => {
    expect(personalisedPlayCpm(100, 1.5)).toBe(150)
    expect(personalisedPlayCpm(80, 1.5)).toBe(120)
  })
  it('is snapshotted on a reservation, except for interactive campaigns', () => {
    expect(multiplierToSnapshot(defaults, 'localised')).toBe(1.5)
    expect(multiplierToSnapshot(defaults, 'personalised')).toBe(1.5)
    expect(multiplierToSnapshot(defaults, null)).toBe(1.5)
    expect(multiplierToSnapshot(defaults, 'interactive')).toBeNull()
  })
})
