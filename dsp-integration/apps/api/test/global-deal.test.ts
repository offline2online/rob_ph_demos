/* Unit gate M11 — the global deal (ticket rkm4bgISL7W0thKc7SwW, 8 Oct 2026):
   the master switch, the per-slot flag and the deference rule. The bid-path
   cases are the E2E run 3 cases P9–P11 (test/e2e/run3-private-auction.test.ts). */
import { describe, expect, it } from 'vitest'
import { GLOBAL_DEAL_ID, toApiExchange, validateExchange } from '../src/domain/exchange'
import { fallsThroughToOpen, globalDealSuppressedBy, inGlobalDeal, openTierOf, slotInGlobalDeal } from '../src/domain/positions'
import type { Slot } from '@ph-dsp/types'
import { harness } from './e2e/harness'

const slot = (patch: Partial<Slot> = {}) => ({ label: 'S', owner: 'advertiser', partnerIds: [], advertisers: [], listMode: 'rtb', ...patch }) as Slot

describe('global deal — which slots are in it', () => {
  it('a new slot is in the global deal by default, once the master switch is on', () => {
    expect(slotInGlobalDeal(slot())).toBe(true)
    expect(inGlobalDeal(slot(), true)).toBe(true)
    expect(inGlobalDeal(slot(), false)).toBe(false)
  })
  it('a slot can opt out', () => {
    expect(inGlobalDeal(slot({ inGlobalDeal: false }), true)).toBe(false)
  })
  it('the default is suppressed when held for an advertiser or whitelist-only', () => {
    expect(globalDealSuppressedBy(slot({ advertisers: ['Swisse'], listMode: null }))).toBe('reserved')
    expect(globalDealSuppressedBy(slot({ listMode: 'whitelist_only' }))).toBe('whitelist_only')
    for (const s of [slot({ advertisers: ['Swisse'], listMode: null }), slot({ listMode: 'whitelist_only' })]) expect(inGlobalDeal(s, true)).toBe(false)
    expect(globalDealSuppressedBy(slot())).toBeNull()
  })
  /* 12 Oct 2026 (ticket 3FFOpIpry1XM29TimpJy): a buyers list no longer suppresses it. The global deal sits in the open tier beneath the numbered lists, opt-in on a restricted slot. */
  it('a buyers-list slot can also be in the global deal, but only when explicitly included', () => {
    const deal: Partial<Slot> = { listMode: 'deal', buyersListId: 'bl1', buyersListIds: ['bl1'] }
    expect(globalDealSuppressedBy(slot(deal))).toBeNull()
    expect(slotInGlobalDeal(slot(deal))).toBe(false)
    expect(inGlobalDeal(slot({ ...deal, inGlobalDeal: true }), true)).toBe(true)
    expect(inGlobalDeal(slot({ ...deal, inGlobalDeal: true }), false)).toBe(false)
  })
  it('a buyers-list slot falls through to the open tier for the global deal alone, or for chosen DSPs', () => {
    const deal: Partial<Slot> = { listMode: 'deal', buyersListId: 'bl1', buyersListIds: ['bl1'] }
    expect(fallsThroughToOpen(slot(deal), true)).toBe(false)
    expect(fallsThroughToOpen(slot({ ...deal, inGlobalDeal: true }), true)).toBe(true)
    expect(fallsThroughToOpen(slot({ ...deal, inGlobalDeal: true }), false)).toBe(false)
    expect(fallsThroughToOpen(slot({ ...deal, openAuction: true, partnerIds: ['p_google'] }), false)).toBe(true)
  })
  it('the open tier of a buyers-list slot carries the global deal flag and no deals', () => {
    const p = openTierOf({ def: slot({ listMode: 'deal', buyersListId: 'bl1', buyersListIds: ['bl1'], inGlobalDeal: true }) } as never)
    expect(p.def.buyersListIds).toEqual([])
    expect(inGlobalDeal(p.def, true)).toBe(true)
    const off = openTierOf({ def: slot({ listMode: 'deal', buyersListId: 'bl1', buyersListIds: ['bl1'], openAuction: true }) } as never)
    expect(inGlobalDeal(off.def, true)).toBe(false)
  })
})

describe('global deal — exchange settings', () => {
  it('reports the fixed deal ID and the switch, off for a new instance', async () => {
    const h = await harness()
    const ex = (await h.app.inject({ method: 'GET', url: '/api/admin/v1/exchange' })).json()
    expect(ex).toMatchObject({ globalDealEnabled: false, globalDealId: GLOBAL_DEAL_ID })
  })
  it('saves the switch; omitted keeps it; a non-boolean is refused', async () => {
    const h = await harness()
    const base = { enabled: true, organisation: 'Demo Retail Group', domain: 'demoretail.example', sellerId: 'drg-4471', contactEmail: 'adops@demoretail.example' }
    const put = (payload: Record<string, unknown>) => h.app.inject({ method: 'PUT', url: '/api/admin/v1/exchange', payload })
    expect((await put({ ...base, globalDealEnabled: true })).json()).toMatchObject({ globalDealEnabled: true })
    expect((await put(base)).json()).toMatchObject({ globalDealEnabled: true })
    expect((await put({ ...base, globalDealEnabled: false })).json()).toMatchObject({ globalDealEnabled: false })
    expect((await put({ ...base, globalDealEnabled: 'yes' })).statusCode).toBe(400)
  })
  it('the switch needs no seller-of-record fields', () => {
    expect(validateExchange({ enabled: false, organisation: '', domain: '', sellerId: '', contactEmail: '', globalDealEnabled: true })).toEqual([])
    expect(toApiExchange({ enabled: false, organisation: '', domain: '', sellerId: '', contactEmail: '' }).globalDealEnabled).toBe(false)
  })
})
