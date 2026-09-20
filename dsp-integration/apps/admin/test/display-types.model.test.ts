import { describe, expect, it } from 'vitest'
import type { AdvertiserSettings, DisplayType, Partner, Slot } from '@ph-dsp/types'
import {
  featuresSummary, newDisplayType, normaliseSlots, ownerAssignment, phantomSummary, playlistSummary, resizeSlots, zonesSummary,
} from '../src/features/display-types/model'

const base = (over: Partial<DisplayType> = {}): DisplayType => ({ ...newDisplayType('t'), playlistSettings: { assetPosition: null, assetFill: null, maximumCampaignsPlayedInRotation: null, campaignTransition: null, campaignAutoRotation: null, campaignAutoPlay: null }, ...over })
const slot = (over: Partial<Slot>): Slot => ({ label: 'S', owner: 'internal', partnerIds: [], advertisers: [], listMode: null, storeScope: null, quota: null, ...over })
const labels = (chips: { label: string; tone: string }[]) => chips.map((c) => `${c.label}${c.tone === 'default' ? ' (grey)' : ''}`)

describe('collapsed panel summaries (spec §1)', () => {
  it('Playlist Settings: a single grey "Default settings" when nothing differs', () => {
    expect(labels(playlistSummary(base(), true))).toEqual(['Default settings (grey)'])
  })

  it('Playlist Settings: slot count and one chip per owner when capped; unlimited gets no chip', () => {
    const d = base({
      playlistSettings: { ...base().playlistSettings, maximumCampaignsPlayedInRotation: 3, campaignTransition: 'Fade' },
      phExtensions: { slots: [slot({ owner: 'internal' }), slot({ owner: 'advertiser', listMode: 'rtb' }), slot({ owner: 'retail', storeScope: 'Store staff' })] },
    })
    expect(labels(playlistSummary(d, true))).toEqual(['3 slots', '1 Headquarters', '1 Advertiser', '1 Stores', '1 setting changed'])
    expect(labels(playlistSummary(d, false))).toEqual(['3 slots', '1 setting changed'])
    const unlimited = base({ playlistSettings: { ...base().playlistSettings, maximumCampaignsPlayedInRotation: -1, assetFill: 'Fill', assetPosition: 'Center' } })
    expect(labels(playlistSummary(unlimited, true))).toEqual(['2 settings changed'])
  })

  it('Phantom Zone: size and position, "Default (Bottom Right)" when inherited, or "Not defined"', () => {
    expect(labels(phantomSummary(base()))).toEqual(['Not defined (grey)'])
    const d = base({ qrControl: { ...base().qrControl, phantomArea: { enabled: true, width: 250, height: 250, position: null, sizingMode: 'Fit to Display' } } })
    expect(labels(phantomSummary(d))).toEqual(['250×250', 'Default (Bottom Right) (grey)'])
  })

  it('Enabled Features: one chip per enabled feature available to the company, or "None enabled"', () => {
    expect(labels(featuresSummary(base()))).toEqual(['None enabled (grey)'])
    const d = base({
      qrControl: { ...base().qrControl, enabled: true },
      enabledFeatures: { ...base().enabledFeatures, visionAi: { enabled: true }, inStoreRadio: { enabled: true } },
    })
    /* In-Store Radio is not available to this company, so it isn't shown. */
    expect(labels(featuresSummary(d))).toEqual(['QR Control', 'Vision/AI'])
  })

  it('Multi-Zone Layout: zone count or "Single zone"', () => {
    expect(labels(zonesSummary(base()))).toEqual(['Single zone (grey)'])
    expect(labels(zonesSummary(base({ multiZone: { enabled: true, zones: [{}, {}, {}] } })))).toEqual(['3 zones'])
  })
})

describe('slot ownership helpers', () => {
  const company = { advertiserWhitelist: ['Nestlé', 'Swisse', 'Arnott’s'], advertiserBlacklist: ['Red Bull', 'Monster Energy'] } as AdvertiserSettings
  const google = { id: 'p_google', name: 'Google DSP', listsLinked: true, status: 'connected' } as Partner
  const amazon = { id: 'p_amazon', name: 'Amazon Ads DSP', listsLinked: false, advertiserWhitelist: ["L'Oréal"], advertiserBlacklist: ['Red Bull', 'Chemist Warehouse', 'Nestlé'], status: 'error' } as Partner
  const partners = [google, amazon]
  const seats: Record<string, string[]> = { p_google: ['Nestlé', 'Swisse'], p_amazon: ["L'Oréal", 'Nestlé'] }
  const seatsOf = (p: Partner) => seats[p.id]

  it('describes each assignment as the prototype does', () => {
    expect(ownerAssignment(slot({ owner: 'internal' }), partners)).toBe('Based on priority')
    expect(ownerAssignment(slot({ owner: 'retail', storeScope: 'Franchisee' }), partners)).toBe('Franchisee')
    expect(ownerAssignment(slot({ owner: 'advertiser', listMode: 'rtb' }), partners)).toBe('Any connected DSP · RTB')
    expect(ownerAssignment(slot({ owner: 'advertiser', partnerIds: ['p_google', 'p_amazon'], listMode: 'rtb' }), partners)).toBe('Google DSP, Amazon Ads DSP · RTB')
    expect(ownerAssignment(slot({ owner: 'advertiser', partnerIds: ['p_google'], listMode: 'whitelist_only' }), partners)).toBe('Google DSP · whitelist')
    expect(ownerAssignment(slot({ owner: 'advertiser', partnerIds: ['p_amazon'], advertisers: ["L'Oréal", 'Nestlé'] }), partners)).toBe("L'Oréal, Nestlé")
  })

  /* A slot saved before the assignment moved to Advertisers / Inventory. */
  it('reads a slot that still carries one partnerId and one advertiser', () => {
    const legacy = { label: 'S', owner: 'advertiser', partnerId: 'p_google', advertiser: 'Nestlé' } as unknown as Slot
    expect(ownerAssignment(legacy, partners)).toBe('Nestlé')
  })


  it('slots follow the rotation cap, keeping what was there', () => {
    const s = [slot({ label: 'Keep' })]
    expect(resizeSlots(s, 3).map((x) => x.label)).toEqual(['Keep', 'Slot 2', 'Slot 3'])
    expect(resizeSlots(s, 0)).toEqual([])
    const d = base({ playlistSettings: { ...base().playlistSettings, maximumCampaignsPlayedInRotation: 2 }, phExtensions: { slots: s } })
    expect(normaliseSlots(d).phExtensions?.slots.map((x) => x.label)).toEqual(['Keep', 'Slot 2'])
  })
})
