import { describe, expect, it } from 'vitest'
import { IAB_OPTIONS_SORTED, iabFilterOption } from '../src/shared/iabOptions'

describe('IAB category pickers', () => {
  it('lists every category alphabetically, a tier 1 before its own subcategories', () => {
    const names = IAB_OPTIONS_SORTED.map((o) => o.value)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })))
    expect(names.indexOf('Food & Drink')).toBe(names.indexOf('Food & Drink › Vegan') - names.filter((n) => n.startsWith('Food & Drink › ') && n < 'Food & Drink › Vegan').length - 1)
  })
  it('finds a category by any word in it, in any order, ignoring case and punctuation', () => {
    const find = (q: string) => IAB_OPTIONS_SORTED.filter((o) => iabFilterOption(q, o)).map((o) => o.value)
    expect(find('vegan')).toContain('Food & Drink › Vegan')
    expect(find('drink vegan')).toEqual(['Food & Drink › Vegan'])
    expect(find('FASHION')).toContain('Style & Fashion')
    expect(find('iab8-16')).toEqual(['Food & Drink › Vegan'])
    expect(find('gov')).toContain("Law, Gov't & Politics")
    expect(find('')).toHaveLength(IAB_OPTIONS_SORTED.length)
  })
})
