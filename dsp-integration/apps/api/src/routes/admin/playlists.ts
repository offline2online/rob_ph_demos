/* Playlists: POC stand-in list for the existing playlist service. */
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import { toApiPlaylist } from '../../domain/displayTypes'
import type { Guards } from '../../http/app'

export const playlistRoutes = (ctx: Context, _guards: Guards): FastifyPluginAsync => async (app) => {
  app.get('/playlists', async () => {
    const types = ctx.displayTypes.list()
    return { items: ctx.playlists.list().map((p) => toApiPlaylist(p, types)) }
  })
}
