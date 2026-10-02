/* Playlists: the POC stand-in list and rename, plus this build's delete
   check and delete (spec §2). Items, scenes and scheduling are untouched. */
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import { dependentDetails, displayTypesUsingPlaylist, liveCommitments, playlistDeleteCheck } from '../../domain/deleteChecks'
import { toApiPlaylist, validatePlaylistSettings } from '../../domain/displayTypes'
import type { Guards } from '../../http/app'
import { hasDependents, notFound, validationFailed } from '../../http/errors'
import { tx } from '../../db/db'

export const playlistRoutes = (ctx: Context, _guards: Guards): FastifyPluginAsync => async (app) => {
  const one = async (id: string) => {
    const p = await ctx.playlists.get(id)
    if (!p) throw notFound()
    return p
  }

  app.get('/playlists', async () => {
    const types = await ctx.displayTypes.list()
    return { items: (await ctx.playlists.list()).map((p) => toApiPlaylist(p, types)) }
  })

  /* Rename only (decision 4): assignments are made on the display type form. */
  app.put<{ Params: { id: string }; Body: { name?: unknown } }>('/playlists/:id/record', async (req) => {
    await one(req.params.id)
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
    if (!name) throw validationFailed([{ field: 'name', reason: 'A name is required.' }])
    const unexpected = Object.keys(req.body ?? {}).filter((k) => k !== 'name')
    if (unexpected.length) throw validationFailed(unexpected.map((k) => ({ field: k, reason: 'Not accepted: a playlist is renamed here, assigned on the display type form.' })))
    const renamed = await ctx.playlists.rename(req.params.id, name)
    if (!renamed) throw notFound()
    return toApiPlaylist(renamed, await ctx.displayTypes.list())
  })

  /* This playlist's own settings, edited from an expandable row on Playlist
     Management whether or not it is currently assigned to a display type
     (26 Sep 2026). Maximum Campaigns Played In Rotation and slot assignment
     stay on the display type's own /extensions endpoint — see
     validatePlaylistSettings. */
  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>('/playlists/:id/settings', async (req) => {
    const errors = validatePlaylistSettings(req.body)
    /* The checks and the save are one transaction: nothing can be sold in between. */
    const saved = await tx(ctx.db, async () => {
      await one(req.params.id)
      if (errors.length) throw validationFailed(errors)
      /* Q47: a playlist carries the play commitments; no change while a display
         type using it has a current or future window reserved or sold. */
      const live = []
      for (const t of await displayTypesUsingPlaylist(ctx, req.params.id)) live.push(...(await liveCommitments(ctx, t.id)))
      if (live.length) throw hasDependents("This playlist can't be changed while its display type's positions are reserved or sold for a current or future window.", dependentDetails({ canDelete: false, dependents: live }))
      return (await ctx.playlists.saveSettings(req.params.id, req.body ?? {}))!
    })
    return toApiPlaylist(saved, await ctx.displayTypes.list())
  })

  app.get<{ Params: { id: string } }>('/playlists/:id/delete-check', async (req) => {
    await one(req.params.id)
    return playlistDeleteCheck(ctx, req.params.id)
  })

  app.delete<{ Params: { id: string } }>('/playlists/:id', async (req, reply) => {
    /* The check and the delete are one transaction. */
    await tx(ctx.db, async () => {
      await one(req.params.id)
      const check = await playlistDeleteCheck(ctx, req.params.id)
      if (!check.canDelete) throw hasDependents("This playlist can't be deleted while it is assigned to a display type or zone.", dependentDetails(check))
      await ctx.playlists.delete(req.params.id)
    })
    return reply.status(204).send()
  })
}
