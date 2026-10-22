import { describe, expect, it } from 'vitest'
import { rulesMatchSegments, selectVersion } from '../src/domain/versionSelection'
import { memoryVisitorSource } from '../src/platform/VisitorSource'

const seg = (op: string, ...values: string[]) => ({ source: 'visitor', variable: 'visitor.visitor_segments', op, values })
const targeting = {
  default: { pricingType: 'default' },
  targeted: [
    { id: 'late', priority: 2, pricingType: 'personalised', rules: [[seg('include', 'fitness')]] },
    { id: 'energy', priority: 1, pricingType: 'personalised', rules: [[seg('include', 'loves_energy_drinks', 'gamer')]] },
  ],
}

describe('selectVersion (Visitor Segments → the version that plays)', () => {
  it('plays the default when the visitor is in no matching segment', () => {
    expect(selectVersion(targeting, [])).toEqual({ versionId: 'default', tier: 'default' })
    expect(selectVersion(targeting, ['new_parent'])).toEqual({ versionId: 'default', tier: 'default' })
    expect(selectVersion({ default: { pricingType: 'default' } }, ['fitness'])).toEqual({ versionId: 'default', tier: 'default' })
  })
  it('plays the first matching targeted version by priority; a condition holds on any of its values', () => {
    expect(selectVersion(targeting, ['gamer'])).toEqual({ versionId: 'energy', tier: 'personalised' })
    expect(selectVersion(targeting, ['fitness', 'loves_energy_drinks'])).toEqual({ versionId: 'energy', tier: 'personalised' })
    expect(selectVersion(targeting, ['fitness'])).toEqual({ versionId: 'late', tier: 'personalised' })
  })
  it('AND groups all hold; exclusions and exact matches follow their operator', () => {
    expect(rulesMatchSegments([[seg('include', 'a')], [seg('include', 'b')]], ['a'])).toBe(false)
    expect(rulesMatchSegments([[seg('include', 'a')], [seg('include', 'b')]], ['a', 'b'])).toBe(true)
    expect(rulesMatchSegments([[seg('exclude_or', 'a', 'b')]], ['c'])).toBe(true)
    expect(rulesMatchSegments([[seg('exclude_or', 'a', 'b')]], ['a'])).toBe(false)
    expect(rulesMatchSegments([[seg('match_exactly', 'a')]], ['a', 'b'])).toBe(false)
    expect(rulesMatchSegments([], ['a'])).toBe(false)
  })
  it('the Visitor API stand-in returns the segments last pushed for a visitor', async () => {
    const v = memoryVisitorSource()
    expect(await v.source.segmentsFor('x')).toEqual([])
    v.push('x', ['a', 'b'])
    v.push('x', ['c'])
    expect(await v.source.segmentsFor('x')).toEqual(['c'])
  })
})
