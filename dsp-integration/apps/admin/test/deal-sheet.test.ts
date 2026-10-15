/* Tickets DbiT9qrFwL4O5ibgSowF and DbSVEGXNIWlYW68UQnY3: the copyable text of a deal sheet, in DV360's terms. */
import { describe, expect, it } from 'vitest'
import { dealSheetText } from '../src/features/advertisers/DealSheetModal'

const cond = (variable: string, name: string, group: 'localisation' | 'personalisation', values: string[]) => ({ variable, name, group, operator: 'includes selected', values, text: `${name} includes selected ${values.join(' or ')}` })
const sheet = (over: object = {}) => ({
  buyersListId: 'bl_1', name: 'Q4 deal', dealType: 'preferred' as const, currency: 'USD', rateCpm: 150, rateKind: 'floor' as const, activeFrom: null, activeTo: null, auctionCloses: null, committedPlays: null,
  entries: [{ partnerId: 'p_google', dsp: 'Google DV360', provider: 'google_dv360' as const, dealId: 'PH-ABC1234567', seats: [{ id: '51', name: 'Nestlé' }], setup: 'DV360: do it.',
    inventorySource: { externalDealId: 'PH-ABC1234567', rateDetails: { rate: 150, rateType: 'CPM fixed' as const, currency: 'USD' }, timeRange: { startTime: null, endTime: null }, buyerStatus: 'PENDING' as const, sellerStatus: 'ACTIVE' as const, termVersion: 2 } }],
  slots: [{ positionId: 'a.s1', label: 'Menu Board — Slot A', displayTypeName: 'Menu Board', slot: 3, zoneName: 'Zone 2', zoneSlot: 1, description: 'Long format menu', storeZone: 'checkout' as const }],
  creativeRequirements: [{ canvas: { width: 1080, height: 1920 }, orientation: 'portrait' as const, maxPlayLengthSec: 15, formats: ['image', 'video'] as ('image' | 'video')[], positionIds: ['a.s1'] }],
  order: { name: 'Q4 deal', status: 'PENDING_ACCEPTANCE' as const },
  product: { name: 'Q4 deal', displayName: 'Q4 deal', transactionType: 'PREFERRED_DEAL' as const, pricingType: 'CPM' as const, startTime: null, endTime: null, creativeConfig: [] },
  termVersion: 2,
  targeting: { targetingCriteria: [{ targetingType: 'GEO' as const, conditions: [cond('store.state', 'State', 'localisation', ['NSW'])] }], sellerSideOnly: [cond('visitor.purchase_intent', 'Purchase Intent', 'personalisation', ['Gift'])], plainLanguage: 'State includes selected NSW AND Purchase Intent includes selected Gift' },
  inventoryScope: { venueTypes: ['retail.grocery'], geography: ['Sydney Inner'], stores: 3, displays: 4, storesBeforeTargeting: 5, displaysBeforeTargeting: 8, screenFormats: [{ width: 1080, height: 1920, orientation: 'portrait' }], narrowedBy: ['Fixed Store Segments includes selected Metro'], notReflectedInCounts: ['State includes selected NSW'], summary: 'retail.grocery; 3 stores, 4 displays in Sydney Inner' },
  estimatedVolume: { label: 'Estimate' as const, playsPerWindow: 5760, assumedViewsPerWindow: 2000, targetedShare: 0.5, windows: 7, playsInTerm: 40320, assumedViewsInTerm: 14000, guaranteedImpressionsPerWindow: null, bufferPct: null, assumedViewsPerPlay: 0.35 },
  guaranteedImpressions: null, description: 'Preferred deal, 150 USD CPM fixed.',
  ...over,
})

describe('dealSheetText', () => {
  it('lists the deal ID per DSP with the terms and creative spec', () => {
    const text = dealSheetText(sheet())
    expect(text).toContain('Deal ID: PH-ABC1234567')
    expect(text).toContain('Preferred deal')
    expect(text).toContain('Rate: 150 USD (CPM fixed)')
    expect(text).toContain('image + video, 1080x1920 (portrait), max play 15s')
    expect(text).toContain('Nestlé (51)')
    expect(text).toContain('Menu Board (Long format menu), Zone 2, slot 1, IAB zone: Checkout')
  })

  it('uses DV360 labels: Order, Flight dates, Buyers and Buyer / Seller status', () => {
    const text = dealSheetText(sheet())
    expect(text).toContain('Order: Q4 deal (PENDING_ACCEPTANCE)')
    expect(text).toContain('Flight dates: No start date to No end date')
    expect(text).toContain('Buyers: Nestlé (51)')
    expect(text).toContain('Buyer status: PENDING · Seller status: ACTIVE · Term version 2')
    expect(text).not.toMatch(/Delivery term|Invited seats|Committed plays/)
  })

  it('writes the targeting in words, flags the seller-side-only criteria, and states the scope and the estimate', () => {
    const text = dealSheetText(sheet())
    expect(text).toContain('Targeting: State includes selected NSW AND Purchase Intent includes selected Gift')
    expect(text).toContain('- GEO: State includes selected NSW')
    expect(text).toContain('- Purchase Intent includes selected Gift (seller-side only)')
    expect(text).toContain('Inventory scope: retail.grocery; 3 stores, 4 displays in Sydney Inner')
    expect(text).toContain('Narrowed by: Fixed Store Segments includes selected Metro (4 of 8 displays)')
    expect(text).toContain('Estimated volume (estimate) per play window: 5,760 plays, 2,000 assumed views (targeted share 50%)')
  })

  it('shows guaranteed impressions with the plays beneath, and reads no targeting plainly', () => {
    const text = dealSheetText(sheet({
      dealType: 'guaranteed', committedPlays: 1000, guaranteedImpressions: 350,
      targeting: { targetingCriteria: [], sellerSideOnly: [], plainLanguage: 'No additional targeting (all attached positions)' },
      estimatedVolume: { ...sheet().estimatedVolume, guaranteedImpressionsPerWindow: 1800, bufferPct: 10 },
    }))
    expect(text).toContain('Guaranteed impressions: 350 (1,000 plays)')
    expect(text).toContain('Guaranteed impressions per window: 1,800 (forecast less 10% buffer)')
    expect(text).toContain('Targeting: No additional targeting (all attached positions)')
  })
})
