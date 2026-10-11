/* Ticket DbiT9qrFwL4O5ibgSowF: the copyable text of a deal sheet. */
import { describe, expect, it } from 'vitest'
import { dealSheetText } from '../src/features/advertisers/DealSheetModal'

describe('dealSheetText', () => {
  it('lists the deal ID per DSP with the terms and creative spec', () => {
    const text = dealSheetText({
      buyersListId: 'bl_1', name: 'Q4 deal', dealType: 'preferred', currency: 'USD', rateCpm: 150, rateKind: 'floor', activeFrom: null, activeTo: null, auctionCloses: null, committedPlays: null,
      entries: [{ partnerId: 'p_google', dsp: 'Google DV360', provider: 'google_dv360', dealId: 'PH-ABC1234567', seats: [{ id: '51', name: 'Nestlé' }], setup: 'DV360: do it.' }],
      creativeRequirements: [{ canvas: { width: 1080, height: 1920 }, orientation: 'portrait', maxPlayLengthSec: 15, formats: ['image', 'video'], positionIds: ['a.s1'] }],
    })
    expect(text).toContain('Deal ID: PH-ABC1234567')
    expect(text).toContain('Preferred deal')
    expect(text).toContain('150 USD CPM (floor)')
    expect(text).toContain('image + video, 1080x1920 (portrait), max play 15s')
    expect(text).toContain('Nestlé (51)')
  })
})
