/* Ticket jfQ4gbwnLCxVSR8ZeCP5 (Rob, 28 Oct 2026): one pricing formula, value = plays x VAC-d / 1,000 x CPM, and Programmatic guaranteed commits
   IMPRESSIONS, built bottom-up from the assigned slots and the same VAC-d source billing realises against. */
import { describe, expect, it } from 'vitest'
import { impressionsOfPlays, valueOfImpressions, valueOfPlays, vacdPerPlayOf } from '@ph-dsp/types'
import { buildApp } from '../src/http/app'
import { committedImpressionsOf, committedPlaysOf, termSlotsOf } from '../src/domain/termPrice'
import { assumedViewsPerWindow, allPositions } from '../src/domain/positions'
import { testContext } from './helpers'

const URL = '/api/admin/v1/buyers-lists'
const INV = '/api/admin/v1/available-inventory'
const body = { name: 'Flight', description: '', dealType: 'guaranteed', invitedBuyers: [{ partnerId: 'p_google', seatId: '5130001' }], activeFrom: '2026-10-01T00:00:00.000Z', activeTo: '2026-10-07T23:59:59.999Z', status: 'draft' }

describe('the one pricing formula', () => {
  it('values a slot with VAC-d 300, 1,000 plays at a $10 CPM as 300,000 impressions and $3,000', () => {
    expect(impressionsOfPlays(1000, 300)).toBe(300_000)
    expect(valueOfImpressions(300_000, 10)).toBe(3000)
    expect(valueOfPlays(1000, 300, 10)).toBe(3000)
    expect(valueOfPlays(1000, 300, 10)).not.toBe(10)
  })

  it('commits impressions as forecast x (1 - buffer), with a 0% buffer committing all of them', () => {
    const slot = { positionId: 'x.s1', playsPerDay: 1000, impressionsPerDay: 300_000, floorCpm: 10 }
    expect(committedImpressionsOf([slot], 1, 0)).toBe(300_000)
    expect(committedImpressionsOf([slot], 1, 10)).toBe(270_000)
    expect(committedPlaysOf([slot], 1, 0)).toBe(1000)
    expect(committedImpressionsOf([slot], null, 0)).toBeNull()
    expect(valueOfImpressions(committedImpressionsOf([slot], 1, 0) as number, 10)).toBe(3000)
  })

  it('gives displays with VAC-d 100 and 300 impressions in the ratio 1:3 for the same plays', () => {
    const a = { positionId: 'a.s1', playsPerDay: 500, impressionsPerDay: 500 * 100, floorCpm: 5 }
    const b = { positionId: 'b.s1', playsPerDay: 500, impressionsPerDay: 500 * 300, floorCpm: 5 }
    expect(committedImpressionsOf([b], 2, 0)! / committedImpressionsOf([a], 2, 0)!).toBe(3)
  })

  it('keeps a slot VAC-d per play whole: plays x vacdPerPlay is the window assumed views billing realises against', () => {
    expect(vacdPerPlayOf(900, 3)).toBe(300)
    expect(vacdPerPlayOf(0, 3)).toBeNull()
    expect(vacdPerPlayOf(900, 0)).toBeNull()
  })
})

describe('Programmatic guaranteed commits impressions over the API', () => {
  const setup = async () => {
    const ctx = await testContext()
    await ctx.partners.update('p_google', { seats: [{ id: '5130001', name: 'Nestlé', category: 'Food & Drink' }] })
    /* Slot 2 scored at 1,000 views a window, slot 3 at three times that: the same plays, three times the VAC-d. */
    const dt = (await ctx.displayTypes.get('menu_board'))!
    await ctx.displayTypes.saveExtensions('menu_board', { ...dt.phExtensions!, slots: dt.phExtensions!.slots.map((s, i) => (i === 2 ? { ...s, owner: 'advertiser', listMode: 'rtb', storeScope: null } : s)) as never })
    for (const [n, v] of [[2, 1000], [3, 3000]] as const) ctx.db.prepare('INSERT INTO audience_vacd (display_type_id, slot, assumed_views_per_window, counted) VALUES (?, ?, ?, 0) ON CONFLICT DO NOTHING').run('menu_board', n, v)
    const app = buildApp(ctx)
    const assign = (id: string, slot: number) => app.inject({ method: 'PUT', url: INV, payload: { items: [{ displayTypeId: 'menu_board', slot, assignedTo: { partnerIds: [], advertisers: [], whitelistOnly: false, buyersListId: id } }] } })
    const create = async () => (await app.inject({ method: 'POST', url: URL, payload: body })).json()
    const get = async (id: string) => (await app.inject({ method: 'GET', url: URL })).json().items.find((l: { id: string }) => l.id === id)
    return { ctx, app, assign, create, get }
  }

  it('stores committedImpressions beside committedPlays, equal to the forecast impressions over the term less the buffer', async () => {
    const { ctx, assign, create, get } = await setup()
    const { id } = await create()
    expect((await get(id)).committedImpressions).toBeNull()
    expect((await assign(id, 2)).statusCode).toBe(200)
    const slots = await termSlotsOf(ctx, id)
    const buffer = (await ctx.company.get()).guaranteeBufferPct
    const l = await get(id)
    expect(l.committedImpressions).toBe(Math.floor(slots.reduce((n, s) => n + s.impressionsPerDay, 0) * 7 * (1 - buffer / 100) + 1e-9))
    expect(l.committedImpressions).toBeGreaterThan(0)
    expect(l.deliveredImpressions).toBe(0)
  })

  it('shows the deal sheet guaranteed impressions as that committed figure, not committed plays x an average', async () => {
    const { app, assign, create, get } = await setup()
    const { id } = await create()
    await assign(id, 2)
    const sheet = (await app.inject({ method: 'GET', url: `${URL}/${id}/deal-sheet` })).json()
    expect(sheet.guaranteedImpressions).toBe((await get(id)).committedImpressions)
  })

  it('reports each slot VAC-d per play on Available Inventory, so plays x vacdPerPlay x displays is the window VAC-d billing uses', async () => {
    const { ctx, app } = await setup()
    const rows = (await app.inject({ method: 'GET', url: INV })).json().items.filter((r: { displayTypeId: string }) => r.displayTypeId === 'menu_board')
    const positions = await allPositions(ctx)
    let checked = 0
    for (const r of rows) {
      if (r.vacdPerPlay == null) continue
      const p = positions.find((q) => q.positionId === `${r.displayTypeId}.s${r.slot}`)
      if (!p) continue
      const views = await assumedViewsPerWindow(ctx, p)
      /* Billing's value for the whole window and the formula's value for the same plays agree (to the rounding of vacdPerPlay). */
      const viaPlays = valueOfPlays(r.playsPerWindow * r.displayCount, r.vacdPerPlay, 10)
      expect(viaPlays).toBeCloseTo(valueOfImpressions(views, 10), 0)
      checked++
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('commits in proportion to each slot VAC-d (slot 3 vs slot 2)', async () => {
    const { ctx, assign, create, get } = await setup()
    const a = (await create()).id
    const b = (await create()).id
    await assign(a, 2)
    await assign(b, 3)
    const pa = (await termSlotsOf(ctx, a))[0]!, pb = (await termSlotsOf(ctx, b))[0]!
    /* The slot scored three times higher commits more, in exact proportion to its own forecast impressions. */
    const buffer = (await ctx.company.get()).guaranteeBufferPct
    for (const [id, slot] of [[a, pa], [b, pb]] as const) expect((await get(id)).committedImpressions).toBe(Math.floor(slot.impressionsPerDay * 7 * (1 - buffer / 100) + 1e-9))
    expect(pb.impressionsPerDay).toBeGreaterThan(pa.impressionsPerDay)
    expect((await get(b)).committedImpressions).toBeGreaterThan((await get(a)).committedImpressions)
  })
})
