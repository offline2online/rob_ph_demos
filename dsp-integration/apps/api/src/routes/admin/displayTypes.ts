/* Display types: POC stand-in endpoints for the existing record, plus this
   build's PUT …/extensions (slot ownership and venue; flag-gated). */
import type { DisplayType, DisplayTypeExtensions } from '@ph-dsp/types'
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import { tx } from '../../db/db'
import { dependentDetails, displayTypeDeleteCheck, soldOrReservedPositions } from '../../domain/deleteChecks'
import { ensureReferencedPlaylists, validateRecord } from '../../domain/displayTypes'
import { validateExtensions } from '../../domain/slots'
import type { Guards } from '../../http/app'
import { hasDependents, notFound, validationFailed } from '../../http/errors'

/* Existing fields only: phExtensions is saved through /extensions. */
const recordFields = (b: DisplayType): DisplayType => {
  const { phExtensions: _ignored, ...rest } = b
  return rest
}

export const displayTypeRoutes = (ctx: Context, guards: Guards): FastifyPluginAsync => async (app) => {
  app.get('/display-types', async () => ({ items: ctx.displayTypes.list() }))

  app.post<{ Body: DisplayType }>('/display-types', async (req, reply) => {
    const dt = recordFields(req.body)
    const errors = validateRecord(dt)
    if (!dt.id?.trim()) errors.push({ field: 'id', reason: 'An id is required.' })
    else if (ctx.displayTypes.get(dt.id)) errors.push({ field: 'id', reason: 'A display type with this id already exists.' })
    if (errors.length) throw validationFailed(errors)
    const created = tx(ctx.db, () => {
      const withPlaylist = { ...dt, defaultPlaylistId: dt.defaultPlaylistId ?? `pl_${dt.id}` }
      ensureReferencedPlaylists(withPlaylist, ctx.playlists, true)
      return ctx.displayTypes.create(withPlaylist)
    })
    return reply.status(201).send(created)
  })

  app.get<{ Params: { id: string } }>('/display-types/:id/record', async (req) => {
    const dt = ctx.displayTypes.get(req.params.id)
    if (!dt) throw notFound()
    return dt
  })

  app.put<{ Params: { id: string }; Body: DisplayType }>('/display-types/:id/record', async (req) => {
    if (!ctx.displayTypes.get(req.params.id)) throw notFound()
    const dt = { ...recordFields(req.body), id: req.params.id }
    const errors = validateRecord(dt)
    if (errors.length) throw validationFailed(errors)
    return tx(ctx.db, () => {
      ensureReferencedPlaylists(dt, ctx.playlists, false)
      return ctx.displayTypes.saveRecord(req.params.id, dt)
    })
  })

  app.put<{ Params: { id: string }; Body: DisplayTypeExtensions }>('/display-types/:id/extensions', async (req) => {
    guards.flagged()
    const dt = ctx.displayTypes.get(req.params.id)
    if (!dt) throw notFound()
    const body = req.body ?? ({} as DisplayTypeExtensions)
    if (!Array.isArray(body.slots)) throw validationFailed([{ field: 'slots', reason: 'Required.' }])
    const errors = validateExtensions(dt, body, ctx.partners.list(), ctx.company.get(), dt.phExtensions?.slots ?? [])
    if (errors.length) throw validationFailed(errors)
    const ext: DisplayTypeExtensions = {
      slots: body.slots.map((s) => ({
        label: s.label.trim(), owner: s.owner, partnerId: s.partnerId ?? null, advertiser: s.advertiser ?? null,
        listMode: s.listMode ?? null, storeScope: s.storeScope ?? null, quota: s.quota ?? null,
      })),
      ...((body.venue ?? dt.phExtensions?.venue) ? { venue: body.venue ?? dt.phExtensions?.venue } : {}),
    }
    return ctx.displayTypes.saveExtensions(req.params.id, ext)
  })

  app.get<{ Params: { id: string } }>('/display-types/:id/delete-check', async (req) => {
    if (!ctx.displayTypes.get(req.params.id)) throw notFound()
    return displayTypeDeleteCheck(ctx, req.params.id)
  })

  /* Deletes the display type and its settings. Its auto-created playlist is
     kept: it shows as unused in Playlist Management (spec §1). */
  app.delete<{ Params: { id: string } }>('/display-types/:id', async (req, reply) => {
    if (!ctx.displayTypes.get(req.params.id)) throw notFound()
    const check = displayTypeDeleteCheck(ctx, req.params.id)
    if (!check.canDelete) throw hasDependents("This display type can't be deleted while displays are assigned to it.", dependentDetails(check))
    const positions = soldOrReservedPositions(ctx, req.params.id)
    req.log.info({ displayTypeId: req.params.id, soldOrReservedPositions: positions }, 'display type deleted')
    ctx.displayTypes.delete(req.params.id)
    return reply.status(204).send()
  })
}
