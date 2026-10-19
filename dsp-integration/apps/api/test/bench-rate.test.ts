import { describe, expect, it } from 'vitest'
import { ratePerSecond } from '../bench/rate'

describe('the bench rate', () => {
  it('divides by the elapsed time when the driver ran out of work before --seconds ended', () => {
    expect(ratePerSecond(1206, 3, 1500, true)).toBe(804)
  })

  it('divides by --seconds when the driver kept sending for the whole run', () => {
    expect(ratePerSecond(3000, 3, 3000, false)).toBe(1000)
  })

  it('never divides by more than --seconds, nor by zero', () => {
    expect(ratePerSecond(600, 3, 3400, true)).toBe(200)
    expect(ratePerSecond(10, 3, 0, true)).toBe(3)
  })
})
