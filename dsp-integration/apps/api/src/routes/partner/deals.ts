/* GET /v1/deals — the deals this DSP is invited to, each with its terms and the
   creative requirements (one entry per distinct format across the positions the
   deal is attached to) a buyer needs to set up and bid it. */
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import { isInvitedBuyer } from '../../domain/buyersLists'
import { dealOf } from '../../domain/dealCreative'
import { baseFloorFor } from '../../exchange/enforcement'

export const dealRoutes = (ctx: Context): FastifyPluginAsync => async (app) => {
  app.get('/deals', async (req) => {
    const partner = req.partner
    const lists = (await ctx.buyersLists.list()).filter((l) => partner.seats.some((s) => isInvitedBuyer(l, partner, s.id)))
    return { items: await Promise.all(lists.map(async (l) => dealOf(ctx, l, Math.round((await baseFloorFor(ctx, { partner, buyersListId: l.id })) * 100) / 100, partner.id))) }
  })
}
