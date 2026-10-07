/* Rob, 7 Oct 2026: committed volume and rate show on every buyers list and are never blank. They inherit
   platform default -> DSP -> buyers list. Rate is the base bid floor in USD CPM. */
import { describe, expect, it } from 'vitest'
import { effectiveTerm } from '../src/domain/pricing'
import { buildApp } from '../src/http/app'
import { expectMatchesContract } from './contract'
import { testContext } from './helpers'

/* Committed volume belongs to a guaranteed deal only (ticket ke38J410jwLTYu9blGK7): this list is one. */
const list = { name: 'Q4', description: '', dealType: 'guaranteed', invitedBuyers: [{ partnerId: 'p_google', seatId: '5130001' }], activeFrom: null, activeTo: null }
const api = '/api/admin/v1'

describe('buyers list committed volume and rate inherit platform -> DSP -> list', () => {
  it('shows the platform default, then the DSP value, then the list’s own, never blank', async () => {
    const ctx = await testContext()
    const app = buildApp(ctx)
    const settings = (await app.inject({ method: 'GET', url: `${api}/advertiser-settings` })).json()
    const put = await app.inject({ method: 'PUT', url: `${api}/advertiser-settings`, payload: { ...settings, floorCpm: 100, defaultCommittedPlays: 5000 } })
    expect(put.statusCode).toBe(200)
    const read = async (id: string) => (await app.inject({ method: 'GET', url: `${api}/buyers-lists` })).json().items.find((l: { id: string }) => l.id === id)

    const created = await app.inject({ method: 'POST', url: `${api}/buyers-lists`, payload: list })
    expectMatchesContract('POST', '/admin/v1/buyers-lists', 201, created.json())
    const id = created.json().id
    expect((await read(id)).effectiveCommittedPlays).toEqual({ min: 5000, max: 5000, source: 'platform' })
    expect((await read(id)).effectiveRateCpm).toEqual({ min: 100, max: 100, source: 'platform' })

    const dsp = await app.inject({ method: 'PUT', url: `${api}/partners/p_google`, payload: { bidder: { committedPlays: 8000, floorCpm: 120 } } })
    expect(dsp.statusCode).toBe(200)
    expect(dsp.json().bidder).toMatchObject({ committedPlays: 8000, floorCpm: 120 })
    const listed = await app.inject({ method: 'GET', url: `${api}/buyers-lists` })
    expectMatchesContract('GET', '/admin/v1/buyers-lists', 200, listed.json())
    expect((await read(id)).effectiveCommittedPlays).toEqual({ min: 8000, max: 8000, source: 'dsp' })
    expect((await read(id)).effectiveRateCpm).toEqual({ min: 120, max: 120, source: 'dsp' })

    await app.inject({ method: 'PUT', url: `${api}/buyers-lists/${id}`, payload: { ...list, committedPlays: 1200, floorCpm: 150 } })
    expect((await read(id)).effectiveCommittedPlays).toEqual({ min: 1200, max: 1200, source: 'buyer' })
    expect((await read(id)).effectiveRateCpm).toEqual({ min: 150, max: 150, source: 'buyer' })

    /* A private auction commits no volume, whatever the levels above hold; its rate still inherits. */
    const auction = (await app.inject({ method: 'POST', url: `${api}/buyers-lists`, payload: { ...list, name: 'Open bids', dealType: 'private_auction' } })).json().id
    expect((await read(auction)).effectiveCommittedPlays).toEqual({ min: null, max: null, source: 'none' })
    expect((await read(auction)).effectiveRateCpm).toEqual({ min: 120, max: 120, source: 'dsp' })
  })

  it('refuses a bad DSP committed volume and clears it with null', async () => {
    const app = buildApp(await testContext())
    for (const committedPlays of [0, 1.5, -3, '10']) {
      const res = await app.inject({ method: 'PUT', url: `${api}/partners/p_google`, payload: { bidder: { committedPlays } } })
      expect(res.statusCode).toBe(400)
    }
    await app.inject({ method: 'PUT', url: `${api}/partners/p_google`, payload: { bidder: { committedPlays: 10 } } })
    const cleared = await app.inject({ method: 'PUT', url: `${api}/partners/p_google`, payload: { bidder: { committedPlays: null } } })
    expect(cleared.json().bidder.committedPlays).toBeUndefined()
  })

  it('reports a range when the invited DSPs resolve differently, and none when nothing is set', () => {
    expect(effectiveTerm({ platform: 100, dsp: [120, undefined], buyer: null })).toEqual({ min: 100, max: 120, source: 'mixed' })
    expect(effectiveTerm({ platform: null, dsp: [undefined], buyer: null })).toEqual({ min: null, max: null, source: 'none' })
    expect(effectiveTerm({ platform: 100, dsp: [80], buyer: null }, (n) => Math.max(100, n))).toEqual({ min: 100, max: 100, source: 'dsp' })
  })
})
