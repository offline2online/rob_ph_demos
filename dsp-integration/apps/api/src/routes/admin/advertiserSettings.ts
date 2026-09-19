/* Advertiser settings (spec §4, §6). Package 3 needs the read side for the
   slot picker's list counts; saving arrives with the screen (package 7). */
import type { AdvertiserSettings } from '@ph-dsp/types'
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import type { Guards } from '../../http/app'

export const advertiserSettingsRoutes = (ctx: Context, guards: Guards): FastifyPluginAsync => async (app) => {
  app.get('/advertiser-settings', async (): Promise<AdvertiserSettings> => {
    guards.flagged()
    return {
      ...ctx.company.get(),
      whereTheseApply: ctx.partners.list().map((p) => ({ partnerId: p.id, name: p.name, adopting: p.listsLinked })),
    }
  })
}
