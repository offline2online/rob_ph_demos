import { describe, expect, it } from 'vitest'
import { formatSync } from '../src/features/dsp-integration/DspPage'

describe('formatSync', () => {
  const now = new Date('2026-09-19T12:00:00')
  it('shows a successful sync as a time', () => {
    expect(formatSync(new Date('2026-09-19T07:12:00').toISOString(), now)).toBe('Today, 07:12')
    expect(formatSync(new Date('2026-09-16T07:12:00').toISOString(), now)).toBe('16 Sept 2026, 07:12')
  })
  it('shows a DSP error reason as it is', () => {
    expect(formatSync('Refresh token rejected — 3 days ago', now)).toBe('Refresh token rejected — 3 days ago')
    expect(formatSync(null, now)).toBeNull()
  })
})
