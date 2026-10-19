/* GET /v1/targeting/attributes — the variables the calling DSP may target.
   Never values: PH evaluates conditions and answers matched / not matched. */
import type { TargetingAttribute } from '@ph-dsp/types'
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import { SEGMENT_VARIABLE, audiencesForSeat } from '../../domain/audiences'
import { validationFailed } from '../../http/errors'
import { permittedFor } from '../../domain/variables'

export const targetingRoutes = (ctx: Context): FastifyPluginAsync => async (app) => {
  /* ?seatId= (ticket OanRebXyEryAXBQrBsVe): the calling DSP's seat. Visitor Segments then lists, as `audiences`, the values the
     retailer shares with the advertiser that seat is mapped to, and with no one else. Other seats never see them. */
  app.get<{ Querystring: { seatId?: string } }>('/targeting/attributes', async (req): Promise<{ items: TargetingAttribute[] }> => {
    const seatId = req.query.seatId?.trim()
    if (seatId && !req.partner.seats.some((s) => s.id === seatId)) throw validationFailed([{ field: 'seatId', reason: `Not a seat of ${req.partner.name}.` }])
    const mine = seatId ? await audiencesForSeat(ctx, req.partner.id, seatId) : []
    return {
      items: permittedFor(req.partner, await ctx.company.variableAccess()).map((v) => ({ key: v.key, source: v.source, label: v.label, group: v.group, operators: v.operators, ...(v.key === SEGMENT_VARIABLE && seatId ? { audiences: mine } : {}) })),
    }
  })
}
