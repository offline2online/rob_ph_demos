/* Unit gate M12 — buyers lists that invite by IAB category (Rob, 7 Oct 2026;
   ticket M9aTqeDgGfRZoL3AEw9i). Spec §5 Private auctions, §6 IAB categories. */
import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/http/app'
import { invitedPartnerIds, isInvitedBuyer } from '../src/domain/buyersLists'
import { expectMatchesContract } from './contract'
import { testContext } from './helpers'

const base = { name: 'Food deal', description: 'By category', activeFrom: null, activeTo: null }
const url = '/api/admin/v1/buyers-lists'
const withCategories = async () => {
  const ctx = await testContext()
  const google = (await ctx.partners.get('p_google'))!
  await ctx.partners.update('p_google', { seats: [{ id: '5130001', name: 'Nestlé', category: 'Food & Drink' }, { id: '5130002', name: 'Swisse', category: 'Health & Fitness' }] })
  return { ctx, app: buildApp(ctx), google }
}

describe('Buyers lists — invite by IAB category (gate M12)', () => {
  it('saves a category-only list; no named buyers needed', async () => {
    const { app } = await withCategories()
    const res = await app.inject({ method: 'POST', url, payload: { ...base, invitedBuyers: [], invitedCategories: ['Food & Drink'] } })
    expect(res.statusCode).toBe(201)
    expectMatchesContract('POST', '/admin/v1/buyers-lists', 201, res.json())
    expect(res.json()).toMatchObject({ invitedBuyers: [], invitedCategories: ['Food & Drink'] })
    const put = await app.inject({ method: 'PUT', url: `${url}/${res.json().id}`, payload: { ...base, invitedCategories: ['Food & Drink', 'food & drink', 'Beauty'] } })
    expect(put.json().invitedCategories).toEqual(['Food & Drink', 'Beauty'])
  })

  it('accepts a tier-2 subcategory and refuses a name outside the taxonomy', async () => {
    const { app } = await withCategories()
    const ok = await app.inject({ method: 'POST', url, payload: { ...base, invitedBuyers: [], invitedCategories: ['food & drink › vegan'] } })
    expect(ok.statusCode).toBe(201)
    expect(ok.json().invitedCategories).toEqual(['Food & Drink › Vegan'])
    const bad = await app.inject({ method: 'POST', url, payload: { ...base, invitedBuyers: [], invitedCategories: ['Food & Drink › Gadgets'] } })
    expect(bad.statusCode).toBe(400)
  })

  it('refuses a list with neither buyers nor categories', async () => {
    const { app } = await withCategories()
    for (const payload of [{ ...base, invitedBuyers: [], invitedCategories: [] }, { ...base }]) {
      const res = await app.inject({ method: 'POST', url, payload })
      expect(res.statusCode).toBe(400)
      expectMatchesContract('POST', '/admin/v1/buyers-lists', 400, res.json())
      expect(res.json().error.details.map((d: { field: string }) => d.field)).toEqual(['invitedBuyers'])
    }
  })

  it('refuses an entry outside the IAB taxonomy with 400 validation_failed', async () => {
    const { app } = await withCategories()
    const res = await app.inject({ method: 'POST', url, payload: { ...base, invitedBuyers: [], invitedCategories: ['Nestlé'] } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('validation_failed')
    expect(res.json().error.details.map((d: { field: string }) => d.field)).toEqual(['invitedCategories[0]'])
  })

  it('resolves live against the synced seats’ category, as a union with named buyers', async () => {
    const { ctx, google } = await withCategories()
    const partner = (await ctx.partners.get('p_google'))!
    const byCategory = { invitedBuyers: [], invitedCategories: ['Food & Drink'] } as never
    expect(isInvitedBuyer(byCategory, partner, '5130001')).toBe(true)
    expect(isInvitedBuyer(byCategory, partner, '5130002')).toBe(false)
    expect(isInvitedBuyer(byCategory, partner, null)).toBe(false)
    const both = { invitedBuyers: [{ partnerId: 'p_google', seatId: '5130002' }], invitedCategories: ['Food & Drink'] } as never
    expect(isInvitedBuyer(both, partner, '5130001')).toBe(true)
    expect(isInvitedBuyer(both, partner, '5130002')).toBe(true)
    expect(invitedPartnerIds(byCategory, [partner, google])).toEqual(['p_google'])
    /* The DSP re-categorises the seat: the deal follows with no edit. */
    const moved = (await ctx.partners.update('p_google', { seats: [{ id: '5130001', name: 'Nestlé', category: 'Beauty' }] }))!
    expect(isInvitedBuyer(byCategory, moved, '5130001')).toBe(false)
    /* A seat that reports no category, or a category nobody reports, admits nobody. */
    const none = (await ctx.partners.update('p_google', { seats: [{ id: '5130001', name: 'Nestlé' }] }))!
    expect(isInvitedBuyer(byCategory, none, '5130001')).toBe(false)
    expect(invitedPartnerIds(byCategory, [none])).toEqual([])
  })
})
