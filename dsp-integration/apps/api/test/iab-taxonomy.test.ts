import { describe, expect, it } from 'vitest'
import { canonicalIabCategory, IAB_CATEGORY_CODES, IAB_TAXONOMY } from '@ph-dsp/types'
import { categoryCodes } from '../src/exchange/openrtb'

describe('IAB Content Taxonomy 1.0', () => {
  it('carries all 26 tier-1 categories and their subcategories, with unique names and codes', () => {
    expect(IAB_TAXONOMY.filter((c) => c.tier === 1)).toHaveLength(26)
    expect(IAB_TAXONOMY.length).toBeGreaterThan(370)
    expect(new Set(IAB_TAXONOMY.map((c) => c.name)).size).toBe(IAB_TAXONOMY.length)
    expect(new Set(IAB_TAXONOMY.map((c) => c.code)).size).toBe(IAB_TAXONOMY.length)
  })
  it('maps names to OpenRTB codes, tier 1 and tier 2', () => {
    expect(categoryCodes(['Food & Drink', 'Food & Drink › Vegan', 'Sports › Tennis', 'Illegal Content › Warez'])).toEqual(['IAB8', 'IAB8-16', 'IAB17-40', 'IAB26-2'])
  })
  it('keeps the first eight-category names working', () => {
    expect(categoryCodes(['Beauty', 'Retail', 'Finance', 'Travel', 'Automotive', 'Health & Fitness', 'Family & Parenting'])).toEqual(['IAB18-1', 'IAB22', 'IAB13', 'IAB20', 'IAB2', 'IAB7', 'IAB6'])
    expect(IAB_CATEGORY_CODES['Style & Fashion › Beauty']).toBe('IAB18-1')
  })
  it('canonicalises case and rejects non-taxonomy names', () => {
    expect(canonicalIabCategory(' food & drink › vegan ')).toBe('Food & Drink › Vegan')
    expect(canonicalIabCategory('Gadgets')).toBeUndefined()
  })
})
