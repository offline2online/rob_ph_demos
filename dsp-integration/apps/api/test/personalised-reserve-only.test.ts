import { describe, expect, it } from 'vitest'
import { personalisedAllowedOn } from '@ph-dsp/types'
import { checkTargeting } from '../src/exchange/enforcement'
import type { PositionRef } from '../src/domain/positions'

/* Personalised versions are sold through reserve bookings and deals, never the open auction (Rob, 5 Oct 2026, widened to deals 8 Oct); see personalised-on-deals.test.ts. */
describe('personalised on reserved slots only', () => {
  const pos = () => ({ def: {} }) as unknown as PositionRef
  it('is allowed on a slot only when it has a reserve price, own or inherited', () => {
    expect(personalisedAllowedOn({ phExtensions: null }, {})).toBe(false)
    expect(personalisedAllowedOn({ phExtensions: { reservePrice: 120 } }, {})).toBe(true)
    expect(personalisedAllowedOn({ phExtensions: null }, { reservePrice: 90 })).toBe(true)
  })
  it('refuses a personalised campaign outside a reserve booking or deal, accepts it inside one', () => {
    const p = pos()
    expect(checkTargeting(p, 'personalised')).toMatchObject({ code: 'targeting_not_supported' })
    expect(checkTargeting(p, 'personalised', true)).toBeNull()
    expect(checkTargeting(p, 'localised')).toBeNull()
    expect(checkTargeting(p, 'default')).toBeNull()
  })
})
