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
    const errors = validateExtensions(dt, body)
    if (errors.length) throw validationFailed(errors)
    /* While the retailer has DSP integration switched off (Exchange settings),
       no NEW advertiser slot: a slot may be Advertiser only if it already was
       (Rob, 24 Sep 2026). Existing ones are left exactly as they are. */
    if (!ctx.exchange.get().enabled) {
      const before = dt.phExtensions?.slots ?? []
      const added = body.slots.flatMap((s, i) => (s.owner === 'advertiser' && before[i]?.owner !== 'advertiser' ? [i] : []))
      if (added.length) throw validationFailed(added.map((i) => ({ field: `slots[${i}].owner`, reason: 'Switch on DSP integration (DSP Integration → Exchange settings) to make a slot an Advertiser slot.' })))
    }
    /* The editor sets the label and the owner; who the position is assigned
       to and what it supports are edited on Advertisers / Inventory, so they
       are carried over here — and dropped when a slot stops being sellable
       (Rob, 20 Sep). A Stores slot takes the default scope. */
    const previous = dt.phExtensions?.slots ?? []
    const ext: DisplayTypeExtensions = {
      slots: body.slots.map((s, i) => {
        const was = previous[i]
        const kept = was?.owner === 'advertiser' && s.owner === 'advertiser'
        return {
          label: s.label.trim(), owner: s.owner,
          partnerIds: kept ? was.partnerIds ?? [] : [],
          advertisers: kept ? was.advertisers ?? [] : [],
          listMode: s.owner === 'advertiser' ? (kept ? was.listMode ?? 'rtb' : 'rtb') : null,
          buyersListId: kept ? was.buyersListId ?? null : null,
          storeScope: s.owner === 'retail' ? was?.storeScope ?? 'Store staff' : null,
          quota: was?.quota ?? null,
          ...(kept && was.supportedTargeting ? { supportedTargeting: was.supportedTargeting } : {}),
        }
      }),
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
