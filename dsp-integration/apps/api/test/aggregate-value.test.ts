import { describe, expect, it } from 'vitest'
import { formatAggregateValue, isAggregateVariable, isValidAggregateValue, parseAggregateValue } from '@ph-dsp/types'

describe('aggregate targeting values ("<category>: <n>%")', () => {
  it('knows the two aggregate variables', () => {
    expect(isAggregateVariable('store.reason_for_visit')).toBe(true)
    expect(isAggregateVariable('store.device_type_aggregate')).toBe(true)
    expect(isAggregateVariable('visitor.reason_for_visit')).toBe(false)
  })
  it('round-trips a category and percentage', () => {
    expect(parseAggregateValue(formatAggregateValue('Returns', 25))).toEqual({ category: 'Returns', pct: 25 })
    expect(parseAggregateValue('Returns')).toEqual({ category: 'Returns', pct: null })
  })
  it('accepts 0–100 with a category and refuses the rest', () => {
    expect(isValidAggregateValue('Returns: 30%')).toBe(true)
    expect(isValidAggregateValue('Returns: 100%')).toBe(true)
    expect(isValidAggregateValue('Returns: 101%')).toBe(false)
    expect(isValidAggregateValue('Returns')).toBe(false)
    expect(isValidAggregateValue(': 20%')).toBe(false)
  })
})
