import { describe, expect, it } from 'vitest'
import { uncachedRestricted } from '../src/domain/uncachedRestriction'

const at = (hhmm: string) => new Date(`2026-10-07T${hhmm}:00.000Z`)
const fixed = (start: string, end: string) => ({ uncachedRestriction: 'fixed' as const, uncachedRestrictionStart: start, uncachedRestrictionEnd: end })

describe('uncachedRestricted', () => {
  it('fixed window: start inclusive, end exclusive, wraps past midnight, empty when equal', () => {
    expect(uncachedRestricted(fixed('09:00', '18:00'), at('09:00'), undefined)).toBe(true)
    expect(uncachedRestricted(fixed('09:00', '18:00'), at('17:59'), undefined)).toBe(true)
    expect(uncachedRestricted(fixed('09:00', '18:00'), at('18:00'), undefined)).toBe(false)
    expect(uncachedRestricted(fixed('22:00', '06:00'), at('23:30'), undefined)).toBe(true)
    expect(uncachedRestricted(fixed('22:00', '06:00'), at('05:59'), undefined)).toBe(true)
    expect(uncachedRestricted(fixed('22:00', '06:00'), at('12:00'), undefined)).toBe(false)
    expect(uncachedRestricted(fixed('09:00', '09:00'), at('09:00'), undefined)).toBe(false)
  })
  it('store_open follows the player report only; off never restricts', () => {
    const s = { uncachedRestrictionStart: '09:00', uncachedRestrictionEnd: '18:00' }
    expect(uncachedRestricted({ ...s, uncachedRestriction: 'store_open' }, at('12:00'), true)).toBe(true)
    expect(uncachedRestricted({ ...s, uncachedRestriction: 'store_open' }, at('12:00'), false)).toBe(false)
    expect(uncachedRestricted({ ...s, uncachedRestriction: 'store_open' }, at('12:00'), undefined)).toBe(false)
    expect(uncachedRestricted({ ...s, uncachedRestriction: 'off' }, at('12:00'), true)).toBe(false)
  })
})
