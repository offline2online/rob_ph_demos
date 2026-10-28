/* Ticket DbiT9qrFwL4O5ibgSowF: the deal sheet a retail media team shares so a buyer can key a deal into their DSP. */
import { describe, expect, it } from 'vitest'
import { refreshCommittedPlays } from '../src/domain/committedPlays'
import { buildApp } from '../src/http/app'
import { expectMatchesContract } from './contract'
import { testContext } from './helpers'

const URL = '/api/admin/v1/buyers-lists'
const list = { name: 'Q4 private auction', description: '', invitedBuyers: [{ partnerId: 'p_google', seatId: '5130001' }], activeFrom: '2026-10-01T00:00:00.000Z', activeTo: '2026-12-31T00:00:00.000Z', floorCpm: 150 }

describe('Deal sheet', () => {
  it('carries the DSP deal ID, type, rate, term, invited seats and the creative spec', async () => {
    const ctx = await testContext()
    await ctx.partners.update('p_google', { seats: [{ id: '5130001', name: 'Nestlé', category: 'Food & Drink' }] })
    const app = buildApp(ctx)
    const created = (await app.inject({ method: 'POST', url: URL, payload: list })).json()
    const res = await app.inject({ method: 'GET', url: `${URL}/${created.id}/deal-sheet` })
    expect(res.statusCode).toBe(200)
    expectMatchesContract('GET', '/admin/v1/buyers-lists/{buyersListId}/deal-sheet', 200, res.json())
    const sheet = res.json()
    expect(sheet).toMatchObject({ buyersListId: created.id, dealType: 'private_auction', rateCpm: 150, rateKind: 'floor', activeFrom: list.activeFrom, activeTo: list.activeTo })
    expect(sheet.entries).toHaveLength(1)
    expect(sheet.entries[0]).toMatchObject({ partnerId: 'p_google', dealId: created.dealId, seats: [{ id: '5130001', name: 'Nestlé' }] })
    expect(sheet.entries[0].setup).toMatch(/DV360/)
    expect(Array.isArray(sheet.creativeRequirements)).toBe(true)
  })

  it('downloads as CSV with one row per DSP deal and creative format, quoting commas', async () => {
    const ctx = await testContext()
    const app = buildApp(ctx)
    const created = (await app.inject({ method: 'POST', url: URL, payload: { ...list, name: 'Food, drink' } })).json()
    const res = await app.inject({ method: 'GET', url: `${URL}/${created.id}/deal-sheet?format=csv` })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/csv/)
    expect(res.headers['content-disposition']).toContain(`deal-sheet-${created.id}.csv`)
    const lines = res.body.trim().split('\r\n')
    expect(lines[0]).toContain('Deal ID')
    expect(lines.length).toBeGreaterThanOrEqual(2)
    expect(lines[1]).toContain('"Food, drink"')
    expect(lines[1]).toContain(created.dealId)
  })

  it('has no entries for a category-only list, 404s an unknown list and 400s an unknown format', async () => {
    const ctx = await testContext()
    const app = buildApp(ctx)
    const cat = (await app.inject({ method: 'POST', url: URL, payload: { name: 'Cats', description: '', invitedBuyers: [], invitedCategories: ['Food & Drink'], activeFrom: null, activeTo: null } })).json()
    expect((await app.inject({ method: 'GET', url: `${URL}/${cat.id}/deal-sheet` })).json().entries).toEqual([])
    expect((await app.inject({ method: 'GET', url: `${URL}/nope/deal-sheet` })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: `${URL}/${cat.id}/deal-sheet?format=pdf` })).statusCode).toBe(400)
  })

  describe('DV360 structure (ticket DbSVEGXNIWlYW68UQnY3)', () => {
    const attach = async (ctx: Awaited<ReturnType<typeof testContext>>, id: string) => {
      /* Score every slot so the volume is not the "unknown" zero of an unscored one. */
      for (let n = 1; n <= 8; n++) ctx.db.prepare('INSERT INTO audience_vacd (display_type_id, slot, assumed_views_per_window, counted) VALUES (?, ?, ?, 0) ON CONFLICT DO NOTHING').run('menu_board', n, 1000)
      const dt = (await ctx.displayTypes.get('menu_board'))!
      const slot = dt.phExtensions!.slots.find((x) => x.owner === 'advertiser')!
      await ctx.displayTypes.saveExtensions('menu_board', { ...dt.phExtensions!, slots: [...dt.phExtensions!.slots.filter((x) => x !== slot), { ...slot, listMode: 'deal', buyersListId: id, buyersListIds: [id] }] as never })
    }
    const sheetOf = async (app: ReturnType<typeof buildApp>, id: string) => (await app.inject({ method: 'GET', url: `${URL}/${id}/deal-sheet` })).json()

    it('is shaped Order -> Product -> InventorySource with DV360 names, and states the rate type', async () => {
      const ctx = await testContext()
      const app = buildApp(ctx)
      const created = (await app.inject({ method: 'POST', url: URL, payload: list })).json()
      await attach(ctx, created.id)
      const res = await app.inject({ method: 'GET', url: `${URL}/${created.id}/deal-sheet` })
      expectMatchesContract('GET', '/admin/v1/buyers-lists/{buyersListId}/deal-sheet', 200, res.json())
      const sheet = res.json()
      expect(sheet.order).toEqual({ name: 'Q4 private auction', status: 'PENDING_ACCEPTANCE' })
      expect(sheet.product).toMatchObject({ displayName: 'Q4 private auction', transactionType: 'PRIVATE_AUCTION', pricingType: 'CPM', startTime: list.activeFrom, endTime: list.activeTo })
      expect(sheet.product.creativeConfig.length).toBeGreaterThan(0)
      expect(sheet.product.creativeConfig[0]).toMatchObject({ creativeType: expect.any(String), width: expect.any(Number), height: expect.any(Number) })
      expect(sheet.entries[0].inventorySource).toMatchObject({ externalDealId: created.dealId, rateDetails: { rate: 150, rateType: 'CPM floor', currency: 'USD' }, timeRange: { startTime: list.activeFrom, endTime: list.activeTo }, buyerStatus: 'PENDING', sellerStatus: 'ACTIVE', termVersion: 1 })
      expect(sheet.estimatedVolume.label).toBe('Estimate')
      expect(sheet.estimatedVolume.guaranteedImpressionsPerWindow).toBeNull()
      expect(sheet.guaranteedImpressions).toBeNull()
      expect(sheet.description).toMatch(/Private auction/)
    })

    it('reads "No additional targeting" for a list with none', async () => {
      const ctx = await testContext()
      const app = buildApp(ctx)
      const created = (await app.inject({ method: 'POST', url: URL, payload: list })).json()
      const sheet = await sheetOf(app, created.id)
      expect(sheet.targeting).toEqual({ targetingCriteria: [], sellerSideOnly: [], plainLanguage: 'No additional targeting (all attached positions)' })
    })

    it('groups criteria by DV360 targeting type, flags the rest seller-side only, and personalisation does not narrow the screens', async () => {
      const ctx = await testContext()
      const app = buildApp(ctx)
      const vars = (await app.inject({ method: 'GET', url: '/api/admin/v1/targeting-variables' })).json().items as { key: string; access: unknown }[]
      const access = Object.fromEntries(vars.map((v) => [v.key, v.access]))
      access['visitor.purchase_intent'] = ['p_google']
      access['visitor.device_type'] = ['p_google']
      await app.inject({ method: 'PUT', url: '/api/admin/v1/targeting-variables', payload: { access } })
      const plain = (await app.inject({ method: 'POST', url: URL, payload: list })).json()
      const targeting = [
        { source: 'store', variable: 'store.state', op: 'include', values: ['NSW'] },
        { source: 'visitor', variable: 'visitor.device_type', op: 'include', values: ['iPhone'] },
        { source: 'visitor', variable: 'visitor.purchase_intent', op: 'include', values: ['Gift'] },
      ]
      const created = await app.inject({ method: 'POST', url: URL, payload: { ...list, name: 'Targeted', targeting } })
      expect(created.statusCode, created.body).toBe(201)
      /* The same slot, one list at a time. */
      await attach(ctx, plain.id)
      const a = await sheetOf(app, plain.id)
      await attach(ctx, created.json().id)
      const b = await sheetOf(app, created.json().id)
      expect(b.targeting.targetingCriteria.map((g: { targetingType: string }) => g.targetingType)).toEqual(['GEO', 'DEVICE'])
      expect(b.targeting.sellerSideOnly.map((c: { variable: string }) => c.variable)).toEqual(['visitor.purchase_intent'])
      expect(b.targeting.plainLanguage).toBe('State includes selected NSW AND Device Type includes selected iPhone AND Purchase Intent includes selected Gift')
      /* Personalisation reduces volume only: the screens in scope are the same, the audience is smaller. */
      expect(b.inventoryScope.displays).toBe(b.inventoryScope.displaysBeforeTargeting)
      expect(b.inventoryScope.notReflectedInCounts).toContain('State includes selected NSW')
      expect(b.estimatedVolume.targetedShare).toBeLessThan(1)
      expect(a.estimatedVolume.assumedViewsPerWindow).toBeGreaterThan(0)
      expect(b.estimatedVolume.assumedViewsPerWindow).toBeLessThan(a.estimatedVolume.assumedViewsPerWindow)
      expect(a.estimatedVolume.targetedShare).toBe(1)
    })

    it('Programmatic guaranteed carries guaranteed impressions, the stored committed impressions built from VAC-d (28 Oct 2026)', async () => {
      const ctx = await testContext()
      const app = buildApp(ctx)
      const created = (await app.inject({ method: 'POST', url: URL, payload: { ...list, dealType: 'guaranteed', activeFrom: '2026-11-01T00:00:00.000Z', activeTo: '2026-11-30T23:59:59.999Z' } })).json()
      await attach(ctx, created.id)
      await refreshCommittedPlays(ctx, [created.id])
      const sheet = await sheetOf(app, created.id)
      expect(sheet.product.transactionType).toBe('PROGRAMMATIC_GUARANTEED')
      expect(sheet.entries[0].inventorySource.rateDetails.rateType).toBe('CPM fixed')
      /* Derived from the slot's forecast plays over the 30-day term, less the buffer. */
      expect(sheet.termDays).toBe(30)
      expect(sheet.committedPlays).toBeGreaterThan(0)
      const committed = sheet.committedPlays as number
      const perPlay = sheet.estimatedVolume.assumedViewsPerPlay
      expect(perPlay).toBeGreaterThan(0)
      /* Impressions are what is committed: the stored figure, built per slot from VAC-d, not committed plays x an average. */
      const stored = (await ctx.buyersLists.get(created.id))!.committedImpressions
      expect(stored).toBeGreaterThan(0)
      expect(sheet.guaranteedImpressions).toBe(stored)
      expect(committed).toBeGreaterThan(0)
      expect(sheet.description).toContain(`Guarantees ${sheet.guaranteedImpressions.toLocaleString('en-GB')} impressions`)
      expect(sheet.estimatedVolume.bufferPct).toBe((await ctx.company.get()).guaranteeBufferPct)
      expect(sheet.estimatedVolume.guaranteedImpressionsPerWindow).toBe(Math.max(0, Math.floor(sheet.estimatedVolume.assumedViewsPerWindow * (1 - sheet.estimatedVolume.bufferPct / 100))))
    })

    it('CSV carries the targeting, scope and volume', async () => {
      const ctx = await testContext()
      const app = buildApp(ctx)
      const created = (await app.inject({ method: 'POST', url: URL, payload: list })).json()
      const head = (await app.inject({ method: 'GET', url: `${URL}/${created.id}/deal-sheet?format=csv` })).body.split('\r\n')[0]
      for (const h of ['Order name', 'Transaction type', 'Rate type', 'Buyer status', 'Seller status', 'Targeting', 'Venue types', 'Estimated plays per window', 'Description']) expect(head).toContain(h)
    })
  })
})
