import { describe, expect, it } from 'vitest'
import type { Campaign } from '@ph-dsp/types'
import { elapsedSince, triageOrder } from '../src/features/campaign-status/triage'

const c = (campaignId: string, lastPlayedAt: string | null = null) => ({ campaignId, name: campaignId, lastPlayedAt }) as unknown as Campaign
const ap = (status: string, submittedAt: string | null = null) => ({ status, submittedAt }) as never

describe('Upcoming Campaign Approval triage order', () => {
  it('puts Awaiting approval first, oldest received at the top, then decided rows by last used desc', () => {
    const rows = [c('approved-old', '2026-10-01T00:00:00Z'), c('wait-new'), c('approved-new', '2026-10-07T00:00:00Z'), c('wait-old'), c('rejected-never'), c('approved-mid', '2026-10-03T00:00:00Z')]
    const approvals = {
      'approved-old': ap('approved'), 'approved-new': ap('approved'), 'approved-mid': ap('approved'), 'rejected-never': ap('rejected'),
      'wait-new': ap('awaiting_approval', '2026-10-08T10:00:00Z'), 'wait-old': ap('awaiting_approval', '2026-10-06T10:00:00Z'),
    }
    expect(triageOrder(rows, approvals).map((r) => r.campaignId)).toEqual(['wait-old', 'wait-new', 'approved-new', 'approved-mid', 'approved-old', 'rejected-never'])
  })
  it('formats the elapsed snapshot', () => {
    const now = Date.parse('2026-10-08T12:00:00Z')
    expect(elapsedSince('2026-10-08T11:59:40Z', now)).toBe('<1m')
    expect(elapsedSince('2026-10-08T11:48:00Z', now)).toBe('12m')
    expect(elapsedSince('2026-10-08T08:40:00Z', now)).toBe('3h 20m')
    expect(elapsedSince('2026-10-06T08:00:00Z', now)).toBe('2d 4h')
  })
})
