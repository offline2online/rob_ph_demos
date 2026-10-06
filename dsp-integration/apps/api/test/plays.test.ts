import { describe, expect, it } from 'vitest'
import { playsPerWindowOf, totalPlaysOf, windowMsForPlays } from '../src/domain/plays'

const HOUR = 3_600_000
describe('plays are the transacting unit', () => {
  it('derives plays from a time window and the loop length', () => {
    expect(playsPerWindowOf(24 * HOUR, 45)).toBe(1920)
    expect(playsPerWindowOf(168 * HOUR, 60)).toBe(10080)
  })
  it('is zero without a loop length or a full loop', () => {
    expect(playsPerWindowOf(24 * HOUR, 0)).toBe(0)
    expect(playsPerWindowOf(10_000, 45)).toBe(0)
  })
  it('round-trips a play count back to a window length', () => {
    expect(windowMsForPlays(1920, 45)).toBe(24 * HOUR)
    expect(windowMsForPlays(0, 45)).toBe(0)
  })
  it('scales by display count', () => {
    expect(totalPlaysOf(1920, 3)).toBe(5760)
  })
})
