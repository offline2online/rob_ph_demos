/* DSPs (spec §7). Package 3 needs the read side for the slot picker; the
   rest of the endpoints arrive with the DSP page (package 9). */
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import { toApiPartner } from '../../domain/partners'
import type { Guards } from '../../http/app'

export const partnerRoutes = (ctx: Context, guards: Guards): FastifyPluginAsync => async (app) => {
  app.get('/partners', async () => {
    guards.flagged()
    return { items: ctx.partners.list().map(toApiPartner) }
  })
}
