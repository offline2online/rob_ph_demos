import { describe, expect, it } from 'vitest'
import { personalisedAllowedOn, supportedTargetingOf } from '@ph-dsp/types'
import { checkTargeting } from '../src/exchange/enforcement'
import type { PositionRef } from '../src/domain/positions'

/* Personalised versions are sold only through reserved slots (Rob, 5 Oct 2026). */
describe('personalised on reserved slots only', () => {
  const pos = (supportedTargeting: string[]) => ({ def: { supportedTargeting } }) as unknown as PositionRef
  it('is allowed on a slot only when it has a reserve price, own or inherited', () => {
    expect(personalisedAllowedOn({ phExtensions: null }, {})).toBe(false)
    expect(personalisedAllowedOn({ phExtensions: { reservePrice: 120 } }, {})).toBe(true)
    expect(personalisedAllowedOn({ phExtensions: null }, { reservePrice: 90 })).toBe(true)
  })
  it('refuses a personalised campaign outside a reserve booking, accepts it inside one', () => {
    const p = pos(['localised', 'personalised'])
    expect(supportedTargetingOf(p.def)).toContain('personalised')
    expect(checkTargeting(p, 'personalised')).toMatchObject({ code: 'targeting_not_supported' })
    expect(checkTargeting(p, 'personalised', true)).toBeNull()
    expect(checkTargeting(p, 'localised')).toBeNull()
    expect(checkTargeting(p, 'default')).toBeNull()
  })
})
