/* Advertiser settings (spec §4, §5, §6): pricing and the company lists, plus
   the read-only Where these apply and Available Inventory. */
import { TARGETING_MODES, supportedTargetingOf, type AdvertiserSettings, type AdvertiserSettingsInput, type AvailableInventoryRow, type TargetingMode } from '@ph-dsp/types'
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
  const inventory = (): AvailableInventoryRow[] => {
    const partners = ctx.partners.list()
    const items: AvailableInventoryRow[] = []
    for (const t of ctx.displayTypes.list()) {
      const playlistName = (t.defaultPlaylistId && ctx.playlists.get(t.defaultPlaylistId)?.name) || '—'
      ;(t.phExtensions?.slots ?? []).forEach((s, i) => {
        if (s.owner !== 'advertiser') return
        items.push({
          displayTypeId: t.id, displayTypeName: t.name, touchPoint: t.touchPoint, playlistName, slot: i + 1, position: s.label,
          partnerName: s.partnerId ? partners.find((p) => p.id === s.partnerId)?.name ?? null : null,
          supportedTargeting: supportedTargetingOf(s),
        })
      })
    }
    return items
  }

  app.get('/available-inventory', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'sections')
    return { items: inventory() }
  })

  /* What targeting each slot supports (Rob, 20 Sep). Everything else about a
     slot is set on its display type, so only this field is writable here. */
  app.put<{ Body: { items?: unknown } }>('/available-inventory', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    const rows = Array.isArray(req.body?.items) ? (req.body.items as { displayTypeId?: unknown; slot?: unknown; supportedTargeting?: unknown }[]) : null
    if (!rows) throw validationFailed([{ field: 'items', reason: 'An array of slots is required.' }])
    const keys = TARGETING_MODES.map((m) => m.key) as string[]
    const errors: { field: string; reason: string }[] = []
    const wanted = new Map<string, Map<number, TargetingMode[]>>()
    rows.forEach((r, i) => {
      const f = (k: string) => `items[${i}].${k}`
      const dt = typeof r.displayTypeId === 'string' ? ctx.displayTypes.get(r.displayTypeId) : null
      const slot = typeof r.slot === 'number' ? r.slot : 0
      const def = dt?.phExtensions?.slots?.[slot - 1]
      if (!dt) errors.push({ field: f('displayTypeId'), reason: 'Unknown display type.' })
      else if (!def) errors.push({ field: f('slot'), reason: `${dt.name} has no slot ${slot}.` })
      else if (def.owner !== 'advertiser') errors.push({ field: f('slot'), reason: 'Only an Advertiser slot is sellable inventory.' })
      const modes = Array.isArray(r.supportedTargeting) ? (r.supportedTargeting as unknown[]) : null
      if (!modes?.length) errors.push({ field: f('supportedTargeting'), reason: 'Choose at least one type of targeting.' })
      else if (modes.some((m) => typeof m !== 'string' || !keys.includes(m))) errors.push({ field: f('supportedTargeting'), reason: `One of: ${keys.join(', ')}.` })
      else if (dt && def) {
        const byType = wanted.get(dt.id) ?? new Map<number, TargetingMode[]>()
        byType.set(slot, keys.filter((k) => modes.includes(k)) as TargetingMode[])
        wanted.set(dt.id, byType)
      }
    })
    if (errors.length) throw validationFailed(errors, 'A slot supports at least one type of targeting.')
    for (const [displayTypeId, slots] of wanted) {
      const dt = ctx.displayTypes.get(displayTypeId)!
      const ext = { ...(dt.phExtensions ?? { slots: [] }) }
      ext.slots = (ext.slots ?? []).map((s, i) => (slots.has(i + 1) ? { ...s, supportedTargeting: slots.get(i + 1)! } : s))
      ctx.displayTypes.saveExtensions(displayTypeId, ext)
    }
    return { items: inventory() }
  })
}
