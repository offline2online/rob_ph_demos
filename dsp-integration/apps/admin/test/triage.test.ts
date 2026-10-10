import { describe, expect, it } from 'vitest'
import type { Campaign } from '@ph-dsp/types'
import { byAdvertiserDeal, elapsedSince, triageOrder } from '../src/features/campaign-status/triage'

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

describe('Upcoming Campaign Approval grouping', () => {
  const a = (id: string, advertiserName: string | null) => ({ campaignId: id, name: id, advertiserName }) as unknown as Campaign
  it('groups by advertiser A–Z, keeping the given order inside each group and unattributed rows last', () => {
    const rows = [a('1', 'Swisse'), a('2', null), a('3', 'Nestlé'), a('4', 'Swisse'), a('5', 'Nestlé')]
    expect(byAdvertiserDeal(rows).map((r) => r.campaignId)).toEqual(['3', '5', '1', '4', '2'])
  })
  it('puts deals A–Z under their advertiser, with no-deal campaigns after them', () => {
    const d = (id: string, advertiserName: string, dealId?: string) => ({ campaignId: id, name: id, advertiserName, ...(dealId ? { dealId } : {}) }) as unknown as Campaign
    const rows = [d('1', 'Swisse'), d('2', 'Swisse', 'PMP-2'), d('3', 'Swisse', 'PMP-1'), d('4', 'Swisse', 'PMP-2'), d('5', 'Nestlé')]
    expect(byAdvertiserDeal(rows).map((r) => r.campaignId)).toEqual(['5', '3', '2', '4', '1'])
  })
})
