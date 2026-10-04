import { describe, expect, it } from 'vitest'
import type { AdvertiserSettings, DisplayType, Partner, Playlist, Slot } from '@ph-dsp/types'
import {
  capSummary, capValueFor, expectedSlotCount, featuresSummary, isCappedFor, newDisplayType, normaliseSlots, ownerAssignment, phantomSummary, resizeSlots, slotIndicesFor, styleSummary, zonesSummary,
} from '../src/features/display-types/model'

const base = (over: Partial<DisplayType> = {}): DisplayType => ({ ...newDisplayType('t'), playlistSettings: { maximumCampaignsPlayedInRotation: null }, ...over })
const playlist = (over: Partial<Playlist> = {}): Playlist => ({ id: 'p', name: 'P', autoCreatedFor: null, assignments: [], playlistSettings: {}, ...over })
const slot = (over: Partial<Slot>): Slot => ({ label: 'S', owner: 'internal', partnerIds: [], advertisers: [], listMode: null, storeScope: null, quota: null, ...over })
const labels = (chips: { label: string; tone: string }[]) => chips.map((c) => `${c.label}${c.tone === 'default' ? ' (grey)' : ''}`)

describe('collapsed panel summaries (spec §1)', () => {
  it('Maximum Campaigns Played In Rotation: "Unlimited rotation" when not capped', () => {
    expect(labels(capSummary(base(), true))).toEqual(['Unlimited rotation (grey)'])
  })

  it('Maximum Campaigns Played In Rotation: slot count and one chip per owner when capped', () => {
    const d = base({
      playlistSettings: { maximumCampaignsPlayedInRotation: 3 },
      phExtensions: { slots: [slot({ owner: 'internal' }), slot({ owner: 'advertiser', listMode: 'rtb' }), slot({ owner: 'retail', storeScope: 'Store staff' })] },
    })
    expect(labels(capSummary(d, true))).toEqual(['3 slots', '1 Headquarters', '1 Advertiser', '1 Stores'])
    expect(labels(capSummary(d, false))).toEqual(['3 slots'])
    const unlimited = base({ playlistSettings: { maximumCampaignsPlayedInRotation: -1 } })
    expect(labels(capSummary(unlimited, true))).toEqual(['Unlimited rotation (grey)'])
  })

  it('Playlist settings: a single grey "Default settings" when nothing differs, else "n settings changed" — regardless of assignment count', () => {
    expect(labels(styleSummary(playlist()))).toEqual(['Default settings (grey)'])
    expect(labels(styleSummary(playlist({ playlistSettings: { campaignTransition: 'Fade' } })))).toEqual(['1 setting changed'])
    expect(labels(styleSummary(playlist({ playlistSettings: { assetFill: 'Fill', assetPosition: 'Center' } })))).toEqual(['2 settings changed'])
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
  const google = { id: 'p_google', name: 'Google DSP', status: 'connected' } as Partner
  const amazon = { id: 'p_amazon', name: 'Amazon Ads DSP', advertiserWhitelist: ['a1'], advertiserBlacklist: ['a2'], status: 'error' } as Partner
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

  /* Ticket, 28 Sep 2026: on a multi-zone display type each zone has its
     own rotation cap and its own slots — one segment per zone, in zone
     order. Removing a zone drops its slots; adding one back (or raising its
     cap) adds new Headquarters slots for it. */
  it('sizes a zoned display type’s slots per zone, following zones being removed and added back', () => {
    const zone = (n: number, cap: number | null) => ({ id: `z${n}`, name: `Zone ${n}`, x: 0, y: 0, width: 33, height: 100, playlistId: `pl_z${n}`, maximumCampaignsPlayedInRotation: cap })
    const zoned = (zones: ReturnType<typeof zone>[], slots: Slot[]) => base({ multiZone: { enabled: true, zones }, phExtensions: { slots } })
    const three = zoned([zone(1, 2), zone(2, 2), zone(3, 2)], [])
    const sized = normaliseSlots(three)
    expect(sized.phExtensions?.slots.map((x) => [x.label, x.zoneId])).toEqual([['Slot 1', 'z1'], ['Slot 2', 'z1'], ['Slot 1', 'z2'], ['Slot 2', 'z2'], ['Slot 1', 'z3'], ['Slot 2', 'z3']])
    expect(expectedSlotCount(sized)).toBe(6)
    expect(slotIndicesFor(sized, 'z2')).toEqual([2, 3])
    /* The default playlist of a zoned display type owns the layout, not a rotation. */
    expect(slotIndicesFor(sized, null)).toEqual([])
    expect(capValueFor(sized, 'z2')).toBe('2')
    expect(isCappedFor(sized, null)).toBe(false)

    const advertised = { ...sized, phExtensions: { slots: sized.phExtensions!.slots.map((x) => ({ ...x, owner: 'advertiser' as const })) } }
    expect(labels(capSummary(advertised, true, 'z2'))).toEqual(['2 slots', '2 Advertiser'])
    expect(labels(capSummary(advertised, true))).toEqual(['6 slots', '6 Advertiser'])

    /* Zone 3 removed: its two slots go with it; Zone 1 and 2's are untouched. */
    const two = normaliseSlots({ ...advertised, multiZone: { enabled: true, zones: [zone(1, 2), zone(2, 2)] } })
    expect(two.phExtensions?.slots.map((x) => [x.owner, x.zoneId])).toEqual([['advertiser', 'z1'], ['advertiser', 'z1'], ['advertiser', 'z2'], ['advertiser', 'z2']])
    /* Added back, at the default cap: no slots until one is picked; at 2, two new Headquarters slots. */
    expect(normaliseSlots({ ...two, multiZone: { enabled: true, zones: [zone(1, 2), zone(2, 2), zone(3, null)] } }).phExtensions?.slots).toHaveLength(4)
    const back = normaliseSlots({ ...two, multiZone: { enabled: true, zones: [zone(1, 2), zone(2, 2), zone(3, 2)] } })
    expect(back.phExtensions?.slots.map((x) => [x.owner, x.zoneId])).toEqual([['advertiser', 'z1'], ['advertiser', 'z1'], ['advertiser', 'z2'], ['advertiser', 'z2'], ['internal', 'z3'], ['internal', 'z3']])
    /* Zones switched off: back to the display type's own cap, slots belong to no zone. */
    const single = normaliseSlots({ ...back, playlistSettings: { maximumCampaignsPlayedInRotation: 3 }, multiZone: { enabled: false, zones: back.multiZone!.zones } })
    expect(single.phExtensions?.slots.map((x) => x.zoneId)).toEqual([null, null, null])
    /* Nothing to change: the same object comes back. */
    expect(normaliseSlots(back)).toBe(back)
  })

  /* 28 Sep 2026: switching zones on kept nothing — the display type's slots
     had no zone, every zone was at the default cap, so all of them dropped
     off the draft. They are the first zone's now, and it takes their count. */
  it('keeps a display type’s existing slots as Zone 1’s when zones are switched on', () => {
    const zone = (n: number) => ({ id: `z${n}`, name: `Zone ${n}`, x: 0, y: 0, width: 33, height: 100, playlistId: `pl_z${n}` })
    const single = base({
      playlistSettings: { maximumCampaignsPlayedInRotation: 3 },
      phExtensions: { slots: [slot({ label: 'Priority 1' }), slot({ label: 'Supplier slot', owner: 'advertiser', partnerIds: ['p_google'], listMode: 'rtb' }), slot({ label: 'Store choice', owner: 'advertiser', listMode: 'rtb' })] },
    })
    const zoned = normaliseSlots({ ...single, multiZone: { enabled: true, zones: [zone(1), zone(2), zone(3)] } })
    expect((zoned.multiZone as { zones: { maximumCampaignsPlayedInRotation?: number | null }[] }).zones.map((z) => z.maximumCampaignsPlayedInRotation)).toEqual([3, undefined, undefined])
    expect(zoned.phExtensions?.slots.map((x) => [x.label, x.owner, x.zoneId])).toEqual([['Priority 1', 'internal', 'z1'], ['Supplier slot', 'advertiser', 'z1'], ['Store choice', 'advertiser', 'z1']])
    expect(zoned.phExtensions?.slots[1].partnerIds).toEqual(['p_google'])
    /* A first zone that already has its own cap keeps it: extras beyond it are cut, never the cap raised. */
    const capped = normaliseSlots({ ...single, multiZone: { enabled: true, zones: [{ ...zone(1), maximumCampaignsPlayedInRotation: 2 }, zone(2)] } })
    expect(capped.phExtensions?.slots.map((x) => x.label)).toEqual(['Priority 1', 'Supplier slot'])
    expect(labels(capSummary(zoned, true, 'z1'))).toEqual(['3 slots', '1 Headquarters', '2 Advertiser'])
  })
})
