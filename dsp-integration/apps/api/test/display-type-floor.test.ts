/* Per-display-type floor (ticket BtGIATyIhObobOFTNuEm, 9 Oct 2026): null
   inherits the central floor at read time; a number overrides for that type
   only. Schema and read-time resolution only — no editor writes it. */
import { describe, expect, it } from 'vitest'
import { allPositions } from '../src/domain/positions'
import { resolveBaseFloor } from '../src/domain/pricing'
import { floorFor } from '../src/exchange/enforcement'
import { buildBidRequest } from '../src/exchange/openrtb'
import { testContext } from './helpers'

describe('resolveBaseFloor with a display type level', () => {
  it('inherits the platform floor when null; overrides when set; never below platform', () => {
    expect(resolveBaseFloor(100, null, null, null)).toBe(100)
    expect(resolveBaseFloor(100, null, null, 180)).toBe(180)
    expect(resolveBaseFloor(100, 150, null, 180)).toBe(150)
    expect(resolveBaseFloor(300, null, null, 180)).toBe(300)
  })
})

describe('display type floor end to end', () => {
  it('follows the central floor until overridden, and reverts when cleared', async () => {
    const ctx = await testContext()
    const first = (await allPositions(ctx))[0]
    const otherId = (await allPositions(ctx)).find((x) => x.displayType.id !== first.displayType.id)?.positionId
    /* Positions carry a snapshot of their display type: re-read after every write. */
    const posOf = async (id: string) => (await allPositions(ctx)).find((x) => x.positionId === id)!
    const p = { positionId: first.positionId, displayType: first.displayType }
    const floorOf = async (id = p.positionId) => floorFor(ctx, null, { position: await posOf(id) })
    const partner = (await ctx.partners.get('p_google'))!
    const sent = async (id = p.positionId) => (await buildBidRequest(ctx, await posOf(id), partner, 'r')).imp[0].bidfloor
    const setType = async (id: string, floorCpm: number | null) => {
      const ext = (await ctx.displayTypes.get(id))!.phExtensions!
      const { floorCpm: _old, ...rest } = ext
      await ctx.displayTypes.saveExtensions(id, floorCpm === null ? rest : { ...rest, floorCpm })
    }
    const setCentral = async (floorCpm: number) => ctx.company.save({ ...(await ctx.company.get()), floorCpm })

    expect(await floorOf()).toBe(100)
    expect(await sent()).toBe(100)
    await setCentral(120)                     // inheriting: moves with the central floor
    expect(await floorOf()).toBe(120)
    expect(await sent()).toBe(120)

    await setType(p.displayType.id, 200)      // explicit override: this type only
    expect(await floorOf()).toBe(200)
    expect(await sent()).toBe(200)
    if (otherId) expect(await floorOf(otherId)).toBe(120)
    await setCentral(130)                     // override is not a copy: unaffected
    expect(await floorOf()).toBe(200)

    await setType(p.displayType.id, null)     // cleared: inherits again
    expect(await floorOf()).toBe(130)
  })
})
