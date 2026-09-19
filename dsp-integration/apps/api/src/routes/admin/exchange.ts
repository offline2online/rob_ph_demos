/* Exchange settings (spec §7): the four seller-of-record fields. */
import type { ExchangeInput } from '@ph-dsp/types'
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import { toApiExchange, validateExchange } from '../../domain/exchange'
import type { Guards } from '../../http/app'
import { validationFailed } from '../../http/errors'

export const exchangeRoutes = (ctx: Context, guards: Guards): FastifyPluginAsync => async (app) => {
  app.get('/exchange', async () => {
    guards.flagged()
    return toApiExchange(ctx.exchange.get())
  })

  /* Save changes. Republishes sellers.json as soon as all four are complete. */
  app.put<{ Body: Partial<ExchangeInput> }>('/exchange', async (req) => {
    guards.flagged()
    const errors = validateExchange(req.body)
    if (errors.length) throw validationFailed(errors)
    const b = req.body as ExchangeInput
    return toApiExchange(ctx.exchange.save({ organisation: b.organisation.trim(), domain: b.domain.trim().toLowerCase(), sellerId: b.sellerId.trim(), contactEmail: b.contactEmail.trim() }))
  })
}
