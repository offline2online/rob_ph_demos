import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MAX_TIP_RULES, PlaybackStrategyPills, tipLines } from '../src/shared/PlaybackStrategyPills'

const pills = (c: HTMLElement) => [...c.querySelectorAll('[data-pill]')].map((e) => e.textContent)

describe('PlaybackStrategyPills', () => {
  it('shows only the strategies that have rules, in a fixed order', () => {
    const { container } = render(<PlaybackStrategyPills rules={{ scheduled: ['Mon–Fri 09:00–17:00'], localised: ['Suburb includes Parramatta'] }} />)
    expect(pills(container)).toEqual(['LOCALISED', 'SCHEDULED'])
  })
  it('shows all three in order', () => {
    const { container } = render(<PlaybackStrategyPills rules={{ scheduled: ['a'], personalised: ['b'], localised: ['c'] }} />)
    expect(pills(container)).toEqual(['LOCALISED', 'PERSONALISED', 'SCHEDULED'])
  })
  it('shows a dash when there are no rules', () => {
    const { container } = render(<PlaybackStrategyPills rules={{ localised: [], personalised: undefined }} />)
    expect(pills(container)).toEqual([])
    expect(container.textContent).toBe('—')
  })
  it('hover lists only that strategy’s rules', async () => {
    const { container } = render(<PlaybackStrategyPills rules={{ personalised: ['Age includes 25–34'], scheduled: ['Sat 10:00–14:00'] }} />)
    fireEvent.mouseEnter(container.querySelector('[data-pill="scheduled"]')!)
    await waitFor(() => expect(screen.getByText('Sat 10:00–14:00')).toBeTruthy())
    expect(screen.queryByText('Age includes 25–34')).toBeNull()
  })
  it('cuts long lists to +N more', () => {
    const rules = Array.from({ length: MAX_TIP_RULES + 3 }, (_, i) => `r${i}`)
    const lines = tipLines(rules)
    expect(lines).toHaveLength(MAX_TIP_RULES + 1)
    expect(lines.at(-1)).toBe('+3 more')
    expect(tipLines(['a', 'b'])).toEqual(['a', 'b'])
  })
})
