/* Playlists: the POC stand-in list and rename, plus this build's delete
   check and delete (spec §2). Items, scenes and scheduling are untouched. */
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import { dependentDetails, playlistDeleteCheck } from '../../domain/deleteChecks'
import { toApiPlaylist } from '../../domain/displayTypes'
import type { Guards } from '../../http/app'
import { hasDependents, notFound, validationFailed } from '../../http/errors'

export const playlistRoutes = (ctx: Context, _guards: Guards): FastifyPluginAsync => async (app) => {
  const one = (id: string) => {
    const p = ctx.playlists.get(id)
    if (!p) throw notFound()
    return p
  }

  app.get('/playlists', async () => {
    const types = ctx.displayTypes.list()
    return { items: ctx.playlists.list().map((p) => toApiPlaylist(p, types)) }
  })

  /* Rename only (decision 4): assignments are made on the display type form. */
  app.put<{ Params: { id: string }; Body: { name?: unknown } }>('/playlists/:id/record', async (req) => {
    one(req.params.id)
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
    if (!name) throw validationFailed([{ field: 'name', reason: 'A name is required.' }])
    const unexpected = Object.keys(req.body ?? {}).filter((k) => k !== 'name')
    if (unexpected.length) throw validationFailed(unexpected.map((k) => ({ field: k, reason: 'Not accepted: a playlist is renamed here, assigned on the display type form.' })))
    return toApiPlaylist(ctx.playlists.rename(req.params.id, name)!, ctx.displayTypes.list())
  })

  app.get<{ Params: { id: string } }>('/playlists/:id/delete-check', async (req) => {
    one(req.params.id)
    return playlistDeleteCheck(ctx, req.params.id)
  })

  app.delete<{ Params: { id: string } }>('/playlists/:id', async (req, reply) => {
    one(req.params.id)
    const check = playlistDeleteCheck(ctx, req.params.id)
    if (!check.canDelete) throw hasDependents("This playlist can't be deleted while it is assigned to a display type or zone.", dependentDetails(check))
    ctx.playlists.delete(req.params.id)
    return reply.status(204).send()
  })
}
