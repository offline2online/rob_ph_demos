/* Exchange settings (spec §7): the DSP integration switch and the four
   seller-of-record fields; and the switch alone, for the navigation. */
import type { ExchangeInput } from '@ph-dsp/types'
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import { toApiExchange, validateExchange } from '../../domain/exchange'
import type { Guards } from '../../http/app'
import { validationFailed } from '../../http/errors'

export const exchangeRoutes = (ctx: Context, guards: Guards): FastifyPluginAsync => async (app) => {
  app.get('/exchange', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    return toApiExchange(ctx.exchange.get())
  })

  /* Read by every user who sees these sections — marketing too, who can't
     read Exchange settings — so the nav can hide Campaign Status and
     Advertisers / Inventory while the switch is off. `sections` scope is
     checked for every admin route in app.ts. */
  app.get('/features', async () => {
    if (!ctx.flags.dspIntegration) return { dspIntegration: false }
    return { dspIntegration: ctx.exchange.get().enabled }
  })

  /* Save changes. Republishes sellers.json as soon as it is switched on and
     all four are complete; switching off takes it down and keeps the rest. */
  app.put<{ Body: Partial<ExchangeInput> }>('/exchange', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    const errors = validateExchange(req.body)
    if (errors.length) throw validationFailed(errors)
    const b = req.body as ExchangeInput
    return toApiExchange(ctx.exchange.save({ enabled: b.enabled, organisation: b.organisation.trim(), domain: b.domain.trim().toLowerCase(), sellerId: b.sellerId.trim(), contactEmail: b.contactEmail.trim() }))
  })
}
