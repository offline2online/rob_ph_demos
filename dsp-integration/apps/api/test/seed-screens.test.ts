import { describe, expect, it } from 'vitest'
import { audienceOf } from '../src/domain/displayTypes'
import { seedScreens } from '../src/seed/screens'
import { testContext } from './helpers'

const NOW = new Date('2026-09-20T00:00:00Z')

describe('seedScreens', () => {
  it('assigns unassigned screens, is re-runnable, and supports the scenarios', async () => {
    const ctx = await testContext({ clock: () => NOW })
    const dt = (await ctx.displayTypes.list())[0].id
    const ins = ctx.db.prepare("INSERT INTO displays (id, name, store, store_id, display_type_id) VALUES (?, 'Loose', '', NULL, ?)")
    for (const n of [1, 2, 3, 4]) ins.run(`d_loose_${n}`, dt)
    const a = await seedScreens(ctx, 'all-scored')
    expect(a.assigned.length).toBeGreaterThanOrEqual(4)
    expect(await seedScreens(ctx, 'all-scored')).toEqual(a)
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM displays WHERE store_id IS NULL').get()).toEqual({ n: 0 })
    const o = await seedScreens(ctx, 'some-overridden')
    expect(o.overrides.length).toBeGreaterThan(0)
    expect((await seedScreens(ctx, 'all-scored')).overrides).toEqual([])
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM displays WHERE vacd_override IS NOT NULL').get()).toEqual({ n: 0 })
    const u = await seedScreens(ctx, 'some-unscored')
    expect(u.unscoredDisplayTypes).toHaveLength(1)
    expect((await audienceOf(ctx.audience, (await ctx.displayTypes.get(u.unscoredDisplayTypes[0]))!, 1)).scored).toBe(false)
  })
})
