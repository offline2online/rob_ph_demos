import { describe, expect, it } from 'vitest'
import { loopLengthSecOf, playsPerWindowOf, totalPlaysOf, windowMsForPlays } from '../src/domain/plays'

const HOUR = 3_600_000
describe('plays are the transacting unit', () => {
  it('derives plays from window ÷ (max slot length × slots)', () => {
    expect(playsPerWindowOf(24 * HOUR, 15, 3)).toBe(1920)
    expect(playsPerWindowOf(24 * HOUR, 30, 3)).toBe(960)
    expect(playsPerWindowOf(8 * HOUR, 15, 3)).toBe(640)
    expect(playsPerWindowOf(24 * HOUR, 45, 1)).toBe(1920)
    expect(playsPerWindowOf(168 * HOUR, 60, 1)).toBe(10080)
  })
  it('loop length is max slot length × slots, every position counted', () => {
    expect(loopLengthSecOf(15, 3)).toBe(45)
    expect(loopLengthSecOf(15, 0)).toBe(15)
  })
  it('is zero without a slot length or a full loop', () => {
    expect(playsPerWindowOf(24 * HOUR, 0, 3)).toBe(0)
    expect(playsPerWindowOf(10_000, 45, 1)).toBe(0)
  })
  it('round-trips a play count back to a window length', () => {
    expect(windowMsForPlays(1920, 15, 3)).toBe(24 * HOUR)
    expect(windowMsForPlays(0, 15, 3)).toBe(0)
  })
  it('scales by display count', () => {
    expect(totalPlaysOf(1920, 3)).toBe(5760)
  })
})
