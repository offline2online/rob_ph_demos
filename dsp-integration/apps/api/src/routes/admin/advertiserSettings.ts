/* Advertiser settings (spec §4, §5, §6): pricing and the company lists, plus
   the read-only Where these apply and Available Inventory. */
import type { AdvertiserSettings, AdvertiserSettingsInput, AvailableInventoryRow } from '@ph-dsp/types'
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import { cleanList, validateAdvertiserSettings } from '../../domain/advertiserSettings'
import type { Guards } from '../../http/app'
import { validationFailed } from '../../http/errors'

export const advertiserSettingsRoutes = (ctx: Context, guards: Guards): FastifyPluginAsync => async (app) => {
  const view = (): AdvertiserSettings => ({
    ...ctx.company.get(),
    whereTheseApply: ctx.partners.list().map((p) => ({ partnerId: p.id, name: p.name, adopting: p.listsLinked })),
  })

  app.get('/advertiser-settings', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    return view()
  })

  app.put<{ Body: Partial<AdvertiserSettingsInput> }>('/advertiser-settings', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    const errors = validateAdvertiserSettings(req.body)
    if (errors.length) throw validationFailed(errors, 'An entry can’t be on both lists, and pricing must be positive.')
    const b = req.body as AdvertiserSettingsInput
    /* Windows already bid on or booked are keyed on the current length (Q13). */
    const current = ctx.company.get()
    if (b.playWindowHours !== current.playWindowHours && ctx.reservations.byStatus(['pending', 'won', 'reserved'], ctx.clock().toISOString()).some((r) => !r.testMode)) {
      throw validationFailed([{ field: 'playWindowHours', reason: 'Future play windows are already bid on or booked; the length can change once they have played.' }])
    }
    ctx.company.save({
      currency: b.currency, floorCpm: b.floorCpm, personalisedMultiplier: b.personalisedMultiplier, interactiveMultiplier: b.interactiveMultiplier,
      auctionOpensHours: b.auctionOpensHours, playWindowHours: b.playWindowHours, auctionCutoffTime: b.auctionCutoffTime,
      advertiserWhitelist: cleanList(b.advertiserWhitelist), advertiserBlacklist: cleanList(b.advertiserBlacklist),
      categoryWhitelist: cleanList(b.categoryWhitelist), categoryBlacklist: cleanList(b.categoryBlacklist),
    })
    return view()
  })

  /* Every advertiser-owned slot across the estate (spec §5 "Available Inventory"). No advertisers column. */
  app.get('/available-inventory', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'sections')
    const partners = ctx.partners.list()
    const items: AvailableInventoryRow[] = []
    for (const t of ctx.displayTypes.list()) {
      const playlistName = (t.defaultPlaylistId && ctx.playlists.get(t.defaultPlaylistId)?.name) || '—'
      ;(t.phExtensions?.slots ?? []).forEach((s, i) => {
        if (s.owner !== 'advertiser') return
        items.push({
          displayTypeId: t.id, displayTypeName: t.name, touchPoint: t.touchPoint, playlistName, slot: i + 1, position: s.label,
          partnerName: s.partnerId ? partners.find((p) => p.id === s.partnerId)?.name ?? null : null,
        })
      })
    }
    return { items }
  })
}
