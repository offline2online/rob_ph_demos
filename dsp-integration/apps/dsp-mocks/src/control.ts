/* Control API for testers (not part of the product contract): seats,
   advertisers, auth failure and bidder behaviour per mock DSP. */
import { randomUUID } from 'node:crypto'
import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import { type BidderBehaviour, DSPS, type DspKey, type MockAdvertiser, type MockStore } from './state'

const bad = (reply: FastifyReply, message: string, status = 400) => reply.status(status).send({ error: message })

export const controlRoutes = (store: MockStore): FastifyPluginAsync => async (app) => {
  const dspOf = (d: string) => (DSPS as string[]).includes(d) ? (d as DspKey) : null

  app.get('/state', async () => store.state)
  app.post('/reset', async () => {
    store.reset()
    return store.state
  })

  app.get<{ Params: { dsp: string } }>('/:dsp', async (req, reply) => {
    const d = dspOf(req.params.dsp)
    return d ? store.state[d] : bad(reply, 'Unknown DSP', 404)
  })

  app.post<{ Params: { dsp: string }; Body: { seatId?: string; name?: string } }>('/:dsp/seats', async (req, reply) => {
    const d = dspOf(req.params.dsp)
    if (!d) return bad(reply, 'Unknown DSP', 404)
    const seatId = req.body?.seatId?.trim()
    if (!seatId) return bad(reply, 'seatId is required')
    if (store.state[d].seats.some((s) => s.seatId === seatId)) return bad(reply, 'Seat already exists', 409)
    store.state[d].seats.push({ seatId, name: req.body?.name?.trim() || seatId })
    return reply.status(201).send(store.state[d])
  })
  app.delete<{ Params: { dsp: string; seatId: string } }>('/:dsp/seats/:seatId', async (req, reply) => {
    const d = dspOf(req.params.dsp)
    if (!d) return bad(reply, 'Unknown DSP', 404)
    const s = store.state[d]
    if (s.advertisers.some((a) => a.seatId === req.params.seatId)) return bad(reply, 'Move or remove this seat’s advertisers first', 409)
    s.seats = s.seats.filter((x) => x.seatId !== req.params.seatId)
    return s
  })

  const validAdvertiser = (d: DspKey, a: Partial<MockAdvertiser>) => {
    if (!a.name?.trim()) return 'name is required'
    if (!a.seatId || !store.state[d].seats.some((s) => s.seatId === a.seatId)) return 'seatId must be one of this DSP’s seats'
    return null
  }
  app.post<{ Params: { dsp: string }; Body: Partial<MockAdvertiser> }>('/:dsp/advertisers', async (req, reply) => {
    const d = dspOf(req.params.dsp)
    if (!d) return bad(reply, 'Unknown DSP', 404)
    const b = req.body ?? {}
    const err = validAdvertiser(d, b)
    if (err) return bad(reply, err)
    const a: MockAdvertiser = {
      id: b.id?.trim() || randomUUID().slice(0, 8), name: b.name!.trim(), seatId: b.seatId!, domain: b.domain?.trim() || '',
      categories: Array.isArray(b.categories) ? b.categories : [], currency: b.currency || 'AUD',
    }
    if (store.state[d].advertisers.some((x) => x.id === a.id)) return bad(reply, 'Advertiser id already exists', 409)
    store.state[d].advertisers.push(a)
    return reply.status(201).send(a)
  })
  app.patch<{ Params: { dsp: string; id: string }; Body: Partial<MockAdvertiser> }>('/:dsp/advertisers/:id', async (req, reply) => {
    const d = dspOf(req.params.dsp)
    if (!d) return bad(reply, 'Unknown DSP', 404)
    const a = store.state[d].advertisers.find((x) => x.id === req.params.id)
    if (!a) return bad(reply, 'Unknown advertiser', 404)
    const next = { ...a, ...req.body, id: a.id }
    const err = validAdvertiser(d, next)
    if (err) return bad(reply, err)
    Object.assign(a, next)
    return a
  })
  app.delete<{ Params: { dsp: string; id: string } }>('/:dsp/advertisers/:id', async (req, reply) => {
    const d = dspOf(req.params.dsp)
    if (!d) return bad(reply, 'Unknown DSP', 404)
    store.state[d].advertisers = store.state[d].advertisers.filter((x) => x.id !== req.params.id)
    return store.state[d]
  })

  app.put<{ Params: { dsp: string }; Body: Partial<{ accept: boolean; error: string; description: string }> }>('/:dsp/auth', async (req, reply) => {
    const d = dspOf(req.params.dsp)
    if (!d) return bad(reply, 'Unknown DSP', 404)
    const b = req.body ?? {}
    store.state[d].auth = { accept: b.accept !== false, error: b.error ?? (b.accept === false ? 'invalid_grant' : ''), description: b.description ?? '' }
    /* Rejecting auth also revokes tokens already issued. */
    if (b.accept === false) for (const [t, k] of store.tokens) if (k === d) store.tokens.delete(t)
    return store.state[d]
  })
  app.put<{ Params: { dsp: string }; Body: Partial<BidderBehaviour> }>('/:dsp/bidder', async (req, reply) => {
    const d = dspOf(req.params.dsp)
    if (!d) return bad(reply, 'Unknown DSP', 404)
    const b = req.body ?? {}
    if (b.mode && !['bid', 'no_bid', 'below_floor'].includes(b.mode)) return bad(reply, 'mode is bid, no_bid or below_floor')
    if (b.priceCpm !== undefined && !(typeof b.priceCpm === 'number' && b.priceCpm >= 0)) return bad(reply, 'priceCpm is a number ≥ 0')
    if (b.advertiserId && !store.state[d].advertisers.some((a) => a.id === b.advertiserId)) return bad(reply, 'advertiserId must be one of this DSP’s advertisers')
    store.state[d].bidder = { ...store.state[d].bidder, ...b }
    return store.state[d]
  })
}
