/* Unit gate M11 — the global deal (ticket rkm4bgISL7W0thKc7SwW, 8 Oct 2026):
   the master switch, the per-slot flag and the deference rule. The bid-path
   cases are the E2E run 3 cases P9–P11 (test/e2e/run3-private-auction.test.ts). */
import { describe, expect, it } from 'vitest'
import { GLOBAL_DEAL_ID, toApiExchange, validateExchange } from '../src/domain/exchange'
import { globalDealSuppressedBy, inGlobalDeal, slotInGlobalDeal } from '../src/domain/positions'
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
  it('the default is suppressed when held for an advertiser, whitelist-only or on a buyers list', () => {
    expect(globalDealSuppressedBy(slot({ advertisers: ['Swisse'], listMode: null }))).toBe('reserved')
    expect(globalDealSuppressedBy(slot({ listMode: 'whitelist_only' }))).toBe('whitelist_only')
    expect(globalDealSuppressedBy(slot({ listMode: 'deal', buyersListId: 'bl1', buyersListIds: ['bl1'] }))).toBe('deal')
    for (const s of [slot({ advertisers: ['Swisse'], listMode: null }), slot({ listMode: 'whitelist_only' }), slot({ listMode: 'deal', buyersListIds: ['bl1'] })]) expect(inGlobalDeal(s, true)).toBe(false)
    expect(globalDealSuppressedBy(slot())).toBeNull()
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
