/* Advertiser settings (spec §4, §5, §6): pricing and the company lists, plus
   the read-only Where these apply and Available Inventory. */
import { MAX_MAX_CAMPAIGNS, MIN_MAX_CAMPAIGNS, TARGETING_MODES, advertiserSlug, assignedOf, billingUnitHoursOf, maxCampaignsOf, reservePriceOf, supportedTargetingOf, type AdvertiserSettings, type AdvertiserSettingsInput, type Assigned, type AvailableInventoryRow, type DisplayType, type DspAdvertisers, type TargetingMode } from '@ph-dsp/types'
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import { cleanList, validateAdvertiserSettings } from '../../domain/advertiserSettings'
import { assignedToSlot, validateAssigned } from '../../domain/slots'
import type { Guards } from '../../http/app'
import { validationFailed } from '../../http/errors'

/* Interactive targeting needs the visitor to have something to scan. */
const hasQrControl = (dt: DisplayType) => !!(dt.qrControl as { enabled?: boolean } | undefined)?.enabled
/* This display type's own Vision/AI capability (ticket "show a computer
   vision icon when computer vision is enabled on a specific display type",
   22 Sep) — mirrors hasQrControl above, read the same way the admin's own
   `featureOn(d, 'vision_ai')` does (model.ts), just without the UI-only
   `DisplayType` helpers this route doesn't import. */
const hasVisionAi = (dt: DisplayType) => !!(dt.enabledFeatures as { visionAi?: { enabled?: boolean } } | undefined)?.visionAi?.enabled

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
      currency: b.currency, floorCpm: b.floorCpm, personalisedMultiplier: b.personalisedMultiplier, interactiveCpe: b.interactiveCpe,
      auctionOpensHours: b.auctionOpensHours, playWindowHours: b.playWindowHours, auctionCutoffTime: b.auctionCutoffTime,
      advertiserWhitelist: cleanList(b.advertiserWhitelist), advertiserBlacklist: cleanList(b.advertiserBlacklist),
      categoryWhitelist: cleanList(b.categoryWhitelist), categoryBlacklist: cleanList(b.categoryBlacklist),
    })
    return view()
  })

  /* Every advertiser-owned slot across the estate (spec §5 "Available Inventory"). No advertisers column. */
  /* Every advertiser-owned slot, and the DSPs (with their advertisers) a
     position can be assigned to — the options behind the Assigned to
     multi-select (Rob, 20 Sep). */
  const inventory = () => {
    const partners = ctx.partners.list()
    const buyersLists = ctx.buyersLists.list()
    const items: AvailableInventoryRow[] = []
    for (const t of ctx.displayTypes.list()) {
      const playlistName = (t.defaultPlaylistId && ctx.playlists.get(t.defaultPlaylistId)?.name) || '—'
      ;(t.phExtensions?.slots ?? []).forEach((s, i) => {
        if (s.owner !== 'advertiser') return
        const a = assignedOf(s)
        items.push({
          displayTypeId: t.id, displayTypeName: t.name, touchPoint: t.touchPoint, playlistName, slot: i + 1, position: s.label,
          assignedTo: {
            ...a,
            partnerNames: a.partnerIds.map((id) => partners.find((p) => p.id === id)?.name ?? id),
            buyersListName: a.buyersListId ? buyersLists.find((l) => l.id === a.buyersListId)?.name ?? a.buyersListId : null,
          },
          qrControl: hasQrControl(t),
          visionAi: hasVisionAi(t),
          supportedTargeting: supportedTargetingOf(s),
          reservePrice: reservePriceOf(t, s),
          reservePriceOverride: s.reservePrice ?? null,
          displayTypeReservePrice: t.phExtensions?.reservePrice ?? null,
          billingUnitHours: billingUnitHoursOf(t, s),
          billingUnitHoursOverride: s.billingUnitHours ?? null,
          displayTypeBillingUnitHours: t.phExtensions?.billingUnitHours ?? null,
          maxCampaigns: maxCampaignsOf(t, s),
          maxCampaignsOverride: s.maxCampaigns ?? null,
          displayTypeMaxCampaigns: t.phExtensions?.maxCampaigns ?? null,
        })
      })
    }
    const dsps: DspAdvertisers[] = partners.map((p) => ({ partnerId: p.id, name: p.name, advertisers: p.seats.map((s) => ({ advertiserId: advertiserSlug(s.name), name: s.name })) }))
    return { items, dsps }
  }

  app.get('/available-inventory', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'sections')
    return inventory()
  })

  /* A CPM of 0 or more, or null for no reserve (Rob, 22 Sep) — shared by
     reservePrice (a slot's own override) and reservePriceDefault (its
     display type's). */
  const parseReservePrice = (v: unknown, field: string, errors: { field: string; reason: string }[]): number | null => {
    if (v === null || v === undefined) return null
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      errors.push({ field, reason: 'A CPM of 0 or more, or null for no reserve.' })
      return null
    }
    return v
  }

  /* A billing unit of at least one hour, or null to inherit (spec "Private
     auctions: two-period model", 23 Sep 2026) — the same override/default
     pair as reservePrice/reservePriceDefault above. */
  const parseBillingUnitHours = (v: unknown, field: string, errors: { field: string; reason: string }[]): number | null => {
    if (v === null || v === undefined) return null
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 1) {
      errors.push({ field, reason: 'A billing unit of at least one hour, or null to inherit.' })
      return null
    }
    return v
  }

  /* An integer 1-10 inclusive, or null to inherit (ticket "Available
     Inventory: Max campaigns column + slot playlist statement") — the
     same override/default pair as reservePrice/reservePriceDefault and
     billingUnitHours/billingUnitHoursDefault above. */
  const parseMaxCampaigns = (v: unknown, field: string, errors: { field: string; reason: string }[]): number | null => {
    if (v === null || v === undefined) return null
    if (typeof v !== 'number' || !Number.isInteger(v) || v < MIN_MAX_CAMPAIGNS || v > MAX_MAX_CAMPAIGNS) {
      errors.push({ field, reason: `An integer from ${MIN_MAX_CAMPAIGNS} to ${MAX_MAX_CAMPAIGNS}, or null to inherit.` })
      return null
    }
    return v
  }

  /* Who a slot is assigned to, what targeting it supports, and its reserve
     price override (Rob, 22 Sep): the fields of a sellable slot that live
     here. Everything else about it is set on its display type — including
     the reserve price *default*, which every row for that display type
     edits together (spec §1 configuration inheritance: override always
     wins; a slot with no override of its own simply follows it). */
  app.put<{ Body: { items?: unknown } }>('/available-inventory', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    const rows = Array.isArray(req.body?.items) ? (req.body.items as { displayTypeId?: unknown; slot?: unknown; supportedTargeting?: unknown; assignedTo?: unknown; reservePrice?: unknown; reservePriceDefault?: unknown; billingUnitHours?: unknown; billingUnitHoursDefault?: unknown; maxCampaigns?: unknown; maxCampaignsDefault?: unknown }[]) : null
    if (!rows) throw validationFailed([{ field: 'items', reason: 'An array of slots is required.' }])
    const keys = TARGETING_MODES.map((m) => m.key) as string[]
    const partners = ctx.partners.list()
    const company = ctx.company.get()
    const errors: { field: string; reason: string }[] = []
    type Patch = { supportedTargeting: TargetingMode[]; assigned: Assigned; reservePrice: number | null; billingUnitHours: number | null; maxCampaigns: number | null }
    const wanted = new Map<string, Map<number, Patch>>()
    const defaults = new Map<string, number | null>()
    const billingUnitDefaults = new Map<string, number | null>()
    const maxCampaignsDefaults = new Map<string, number | null>()
    const names = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean) : [])

    rows.forEach((r, i) => {
      const f = (k: string) => `items[${i}].${k}`
      const dt = typeof r.displayTypeId === 'string' ? ctx.displayTypes.get(r.displayTypeId) : null
      const slot = typeof r.slot === 'number' ? r.slot : 0
      const def = dt?.phExtensions?.slots?.[slot - 1]
      if (!dt) errors.push({ field: f('displayTypeId'), reason: 'Unknown display type.' })
      else if (!def) errors.push({ field: f('slot'), reason: `${dt.name} has no slot ${slot}.` })
      else if (def.owner !== 'advertiser') errors.push({ field: f('slot'), reason: 'Only an Advertiser slot is sellable inventory.' })

      const modes = Array.isArray(r.supportedTargeting) ? (r.supportedTargeting as unknown[]) : null
      let targeting: TargetingMode[] | null = null
      if (!modes?.length) errors.push({ field: f('supportedTargeting'), reason: 'Choose at least one type of targeting.' })
      else if (modes.some((m) => typeof m !== 'string' || !keys.includes(m))) errors.push({ field: f('supportedTargeting'), reason: `One of: ${keys.join(', ')}.` })
      /* Nothing to engage with without the QR code (Rob, 20 Sep). */
      else if (modes.includes('interactive') && dt && !hasQrControl(dt)) errors.push({ field: f('supportedTargeting'), reason: 'QR Control is required to support an interactive engagement.' })
      else targeting = keys.filter((k) => modes.includes(k)) as TargetingMode[]

      const raw = (r.assignedTo ?? {}) as { partnerIds?: unknown; advertisers?: unknown; whitelistOnly?: unknown; buyersListId?: unknown }
      const assigned: Assigned = { partnerIds: names(raw.partnerIds), advertisers: names(raw.advertisers), whitelistOnly: raw.whitelistOnly === true, buyersListId: typeof raw.buyersListId === 'string' ? raw.buyersListId : null }
      const bad = validateAssigned(assigned, (k) => f(`assignedTo.${k}`), partners, company, def ? assignedOf(def) : { partnerIds: [], advertisers: [], whitelistOnly: false, buyersListId: null }, ctx.buyersLists)
      errors.push(...bad)

      const reservePrice = parseReservePrice(r.reservePrice, f('reservePrice'), errors)
      const reservePriceDefault = parseReservePrice(r.reservePriceDefault, f('reservePriceDefault'), errors)
      if (dt) {
        if (defaults.has(dt.id) && defaults.get(dt.id) !== reservePriceDefault) errors.push({ field: f('reservePriceDefault'), reason: 'All slots on a display type must submit the same reserve price default.' })
        else defaults.set(dt.id, reservePriceDefault)
      }
      const billingUnitHours = parseBillingUnitHours(r.billingUnitHours, f('billingUnitHours'), errors)
      const billingUnitHoursDefault = parseBillingUnitHours(r.billingUnitHoursDefault, f('billingUnitHoursDefault'), errors)
      if (dt) {
        if (billingUnitDefaults.has(dt.id) && billingUnitDefaults.get(dt.id) !== billingUnitHoursDefault) errors.push({ field: f('billingUnitHoursDefault'), reason: 'All slots on a display type must submit the same billing unit default.' })
        else billingUnitDefaults.set(dt.id, billingUnitHoursDefault)
      }
      const maxCampaigns = parseMaxCampaigns(r.maxCampaigns, f('maxCampaigns'), errors)
      const maxCampaignsDefault = parseMaxCampaigns(r.maxCampaignsDefault, f('maxCampaignsDefault'), errors)
      if (dt) {
        if (maxCampaignsDefaults.has(dt.id) && maxCampaignsDefaults.get(dt.id) !== maxCampaignsDefault) errors.push({ field: f('maxCampaignsDefault'), reason: 'All slots on a display type must submit the same max campaigns default.' })
        else maxCampaignsDefaults.set(dt.id, maxCampaignsDefault)
      }

      if (dt && def && targeting && !bad.length) {
        const byType = wanted.get(dt.id) ?? new Map<number, Patch>()
        byType.set(slot, { supportedTargeting: targeting, assigned, reservePrice, billingUnitHours, maxCampaigns })
        wanted.set(dt.id, byType)
      }
    })
    if (errors.length) throw validationFailed(errors, 'A slot supports at least one type of targeting, and is assigned to DSPs or advertisers it can actually sell to.')

    for (const [displayTypeId, slots] of wanted) {
      const dt = ctx.displayTypes.get(displayTypeId)!
      const ext = { ...(dt.phExtensions ?? { slots: [] }) }
      ext.slots = (ext.slots ?? []).map((s, i) => {
        const patch = slots.get(i + 1)
        return patch ? { ...s, supportedTargeting: patch.supportedTargeting, ...assignedToSlot(patch.assigned, partners), reservePrice: patch.reservePrice, billingUnitHours: patch.billingUnitHours, maxCampaigns: patch.maxCampaigns } : s
      })
      if (defaults.has(displayTypeId)) ext.reservePrice = defaults.get(displayTypeId) ?? null
      if (billingUnitDefaults.has(displayTypeId)) ext.billingUnitHours = billingUnitDefaults.get(displayTypeId) ?? null
      if (maxCampaignsDefaults.has(displayTypeId)) ext.maxCampaigns = maxCampaignsDefaults.get(displayTypeId) ?? null
      ctx.displayTypes.saveExtensions(displayTypeId, ext)
    }
    return inventory()
  })
}
