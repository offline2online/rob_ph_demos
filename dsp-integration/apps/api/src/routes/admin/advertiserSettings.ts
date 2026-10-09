/* Advertiser settings (spec §4, §5, §6): pricing and the company lists, plus
   the read-only Where these apply and Available Inventory. */
import { INTERACTIVE_ENABLED, PLATFORM_DEFAULT_BILLING_UNIT_HOURS, MAX_MAX_CAMPAIGNS, MAX_MAX_PLAY_LENGTH_SEC, MIN_MAX_CAMPAIGNS, MIN_MAX_PLAY_LENGTH_SEC, maxPlayLengthSecOf, advertiserSlug, assignedOf, billingUnitHoursOf, maxCampaignsOf, interactiveReservePriceOf, reservePriceOf, type AdvertiserSettings, type AdvertiserSettingsInput, type Assigned, type AvailableInventoryRow, type DisplayType, type DspAdvertisers } from '@ph-dsp/types'
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import { cleanCategoryList, validateAdvertiserSettings } from '../../domain/advertiserSettings'
import { tx } from '../../db/db'
import { globalDealSuppressedBy, positionIdOf, slotInGlobalDeal, slotWindowCommitments, unsellableReason } from '../../domain/positions'
import { audienceOf, zonesOf } from '../../domain/displayTypes'
import { playsPerWindowOf } from '../../domain/plays'
import { assignedToSlot, rotationSizeOf, validateAssigned } from '../../domain/slots'
import type { Guards } from '../../http/app'
import { conflict, hasDependents, notFound, validationFailed } from '../../http/errors'
import { releaseSettledSlotLocks, slotBookedUntil, slotLiveBookings } from '../../domain/slotLock'

/* Interactive targeting needs the visitor to have something to scan. */
const hasQrControl = (dt: DisplayType) => !!(dt.qrControl as { enabled?: boolean } | undefined)?.enabled
/* This display type's own Vision/AI capability (ticket "show a computer
   vision icon when computer vision is enabled on a specific display type",
   22 Sep) — mirrors hasQrControl above, read the same way the admin's own
   `featureOn(d, 'vision_ai')` does (model.ts), just without the UI-only
   `DisplayType` helpers this route doesn't import. */
const hasVisionAi = (dt: DisplayType) => !!(dt.enabledFeatures as { visionAi?: { enabled?: boolean } } | undefined)?.visionAi?.enabled

export const advertiserSettingsRoutes = (ctx: Context, guards: Guards): FastifyPluginAsync => async (app) => {
  const view = async (): Promise<AdvertiserSettings> => ({ ...(await ctx.company.get()) })

  app.get('/advertiser-settings', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    return view()
  })

  app.put<{ Body: Partial<AdvertiserSettingsInput> }>('/advertiser-settings', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    const errors = validateAdvertiserSettings(req.body)
    if (errors.length) throw validationFailed(errors, 'An entry can’t be on both category lists, and pricing must be positive.')
    const b = req.body as AdvertiserSettingsInput
    await tx(ctx.db, async () => {
      const current = await ctx.company.get()
      await ctx.company.save({
        currency: b.currency, floorCpm: b.floorCpm, interactiveCpe: INTERACTIVE_ENABLED ? b.interactiveCpe : current.interactiveCpe,
        categoryWhitelist: cleanCategoryList(b.categoryWhitelist), categoryBlacklist: cleanCategoryList(b.categoryBlacklist),
        guaranteeBufferPct: b.guaranteeBufferPct ?? current.guaranteeBufferPct,
        uncachedRestriction: b.uncachedRestriction ?? current.uncachedRestriction,
        uncachedRestrictionStart: b.uncachedRestrictionStart ?? current.uncachedRestrictionStart,
        uncachedRestrictionEnd: b.uncachedRestrictionEnd ?? current.uncachedRestrictionEnd,
        bidLookaheadSeconds: b.bidLookaheadSeconds ?? current.bidLookaheadSeconds,
        cachedAssetRetentionHours: b.cachedAssetRetentionHours ?? current.cachedAssetRetentionHours,
        defaultCommittedPlays: b.defaultCommittedPlays === undefined ? current.defaultCommittedPlays : b.defaultCommittedPlays,
        maxPlayLengthSec: b.maxPlayLengthSec ?? current.maxPlayLengthSec,
      })
    })
    return view()
  })

  /* Every advertiser-owned slot across the estate (spec §5 "Available Inventory"). No advertisers column. */
  /* Every advertiser-owned slot, and the DSPs (with their advertisers) a
     position can be assigned to — the options behind the Assigned to
     multi-select (Rob, 20 Sep). */
  const inventory = async () => {
    /* A lock whose bookings have all played is released before it is shown. */
    await releaseSettledSlotLocks(ctx)
    const partners = await ctx.partners.list()
    const buyersLists = await ctx.buyersLists.list()
    const items: AvailableInventoryRow[] = []
    const company = await ctx.company.get()
    for (const t of await ctx.displayTypes.list()) {
      const zones = zonesOf(t)
      /* A position's playlist, per slot: the zone playlist it's tagged to
         (Slot.zoneId) when this is a multi-zone display type and the slot
         names one, else the display type's own default playlist — same
         "override always wins" shape as reserve price/billing unit/max
         campaigns above, just a lookup instead of a number (ticket
         "Available Inventory: playlist-primary table (drop Display type
         column) with Unassigned indicator", 27 Sep 2026). This is what
         makes only the zone playlists that actually have an advertiser slot
         show up on Available Inventory — a zone nothing is tagged to simply
         never produces a row. */
      /* Every slot belongs to exactly one zone on a multi-zone display type:
         one tagged to no current zone counts as the first zone's (same rule
         as the editor's normaliseSlots), and a zoned display type never falls
         back to its default playlist, which only carries the layout. */
      const zoneOfSlot = (s: { zoneId?: string | null }) => (zones.length ? zones.find((z) => z.id === s.zoneId) ?? zones[0] : null)
      const playlistIdOf = (s: { zoneId?: string | null }): string | null => {
        if (!zones.length) return t.defaultPlaylistId || null
        return zoneOfSlot(s)?.playlistId || null
      }
      /* Not tied to any physical display (Displays & Devices) — its
         advertiser slots exist but aren't actually playing anywhere. Same
         "no displays" read windowStatus (positions.ts) already uses to mark
         a position unavailable, surfaced here as Available Inventory's
         "Unassigned" indicator, not a live/sold state (that's out of scope
         — this build has no such concept). Per display type, since a
         multi-zone display type's zones all share the one physical screen. */
      const displayCount = (await ctx.displays.summaryByDisplayType(t.id)).displays
      const unassigned = displayCount === 0
      /* zoneSlot: this slot's 1-based position within its own zone's segment
         of the list, rather than `slot`'s flat position across every zone
         (ticket, 28 Sep 2026 — Rob: setting Zone 2's first slot showed as
         "Slot 4" on Available Inventory, because each zone runs its own
         separate playlist/rotation and the flat number across all zones
         isn't the number that rotation actually uses). Counts every slot in
         the zone's segment, not just advertiser-owned ones, so it lines up
         with that zone's own slot table on Playlist Management. A slot with
         no zoneId (a single-zone display type) has only one segment, so this
         is the same value as `slot`. */
      const zoneSlotCounts = new Map<string | null, number>()
      for (const [i, s] of (t.phExtensions?.slots ?? []).entries()) {
        const zoneKey = zoneOfSlot(s)?.id ?? null
        const zoneSlot = (zoneSlotCounts.get(zoneKey) ?? 0) + 1
        zoneSlotCounts.set(zoneKey, zoneSlot)
        if (s.owner !== 'advertiser') continue
        const a = assignedOf(s)
        const playlistId = playlistIdOf(s)
        const playlistName = (playlistId && (await ctx.playlists.get(playlistId))?.name) || '—'
        const audience = await audienceOf(ctx.audience, t, i + 1)
        /* An unlimited rotation has no countable loop: treat it as one slot. */
        const slotCount = Math.max(1, rotationSizeOf(t, i + 1))
        items.push({
          displayTypeId: t.id, displayTypeName: t.name, touchPoint: t.touchPoint, playlistName, playlistId, unassigned, scored: audience.scored, unsellableReason: await unsellableReason(ctx, { positionId: positionIdOf(t.id, i + 1), displayType: t, slot: i + 1, def: s }, audience), salesLocked: s.salesLocked === true, inGlobalDeal: slotInGlobalDeal(s), globalDealSuppressedBy: globalDealSuppressedBy(s), salesLockedUntil: s.salesLocked ? await slotBookedUntil(ctx, t.id, i + 1) : null, slot: i + 1, zoneSlot, position: s.label,
          assignedTo: {
            ...a,
            partnerNames: a.partnerIds.map((id) => partners.find((p) => p.id === id)?.name ?? id),
            buyersListName: a.buyersListId ? buyersLists.find((l) => l.id === a.buyersListId)?.name ?? a.buyersListId : null,
            buyersListNames: a.buyersListIds.map((id) => buyersLists.find((l) => l.id === id)?.name ?? id),
          },
          qrControl: hasQrControl(t),
          visionAi: hasVisionAi(t),
          reservePrice: reservePriceOf(t, s),
          reservePriceOverride: s.reservePrice ?? null,
          interactiveReservePrice: interactiveReservePriceOf(t, s),
          interactiveReservePriceOverride: s.interactiveReservePrice ?? null,
          displayTypeReservePrice: t.phExtensions?.reservePrice ?? null,
          billingUnitHours: billingUnitHoursOf(t, s),
          billingUnitHoursOverride: s.billingUnitHours ?? null,
          displayTypeBillingUnitHours: t.phExtensions?.billingUnitHours ?? null,
          maxCampaigns: maxCampaignsOf(t, s),
          maxCampaignsOverride: s.maxCampaigns ?? null,
          displayTypeMaxCampaigns: t.phExtensions?.maxCampaigns ?? null,
          maxPlayLengthSec: maxPlayLengthSecOf(t, s, company.maxPlayLengthSec),
          maxPlayLengthSecOverride: s.maxPlayLengthSec ?? null,
          displayTypeMaxPlayLengthSec: t.phExtensions?.maxPlayLengthSec ?? null,
          companyMaxPlayLengthSec: company.maxPlayLengthSec,
          slotCount,
          displayCount,
          playsPerWindow: playsPerWindowOf(billingUnitHoursOf(t, s) * 3_600_000, maxPlayLengthSecOf(t, s, company.maxPlayLengthSec), slotCount),
        })
      }
    }
    const dsps: DspAdvertisers[] = partners.map((p) => ({ partnerId: p.id, name: p.name, advertisers: p.seats.map((s) => ({ advertiserId: advertiserSlug(s.name), name: s.name })) }))
    return { items, dsps }
  }

  app.get('/available-inventory', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'sections')
    return inventory()
  })

  /* Lock a sold slot against new sales (ticket, 30 Sep 2026). Only a slot
     with a live booking can be locked; there is no unlock — the lock
     releases itself when the booking schedule has none left. */
  app.put<{ Body: { displayTypeId?: unknown; slot?: unknown } }>('/available-inventory/lock', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    const { displayTypeId, slot } = req.body ?? {}
    if (typeof displayTypeId !== 'string' || typeof slot !== 'number' || !Number.isInteger(slot) || slot < 1) throw validationFailed([{ field: 'slot', reason: 'A display type and a slot number are required.' }])
    /* Read, check and save as one transaction. */
    await tx(ctx.db, async () => {
      const dt = await ctx.displayTypes.get(displayTypeId)
      if (!dt) throw notFound('Unknown display type.')
      const def = dt.phExtensions?.slots?.[slot - 1]
      if (!def) throw validationFailed([{ field: 'slot', reason: `${dt.name} has no slot ${slot}.` }])
      if (def.owner !== 'advertiser') throw validationFailed([{ field: 'slot', reason: 'Only an Advertiser slot is sellable inventory.' }])
      if (!def.salesLocked) {
        if (!(await slotLiveBookings(ctx, dt.id, slot)).length) throw conflict('Nothing is sold on this slot, so there is nothing to lock: remove the advertiser instead.')
        const ext = dt.phExtensions!
        await ctx.displayTypes.saveExtensions(dt.id, { ...ext, slots: ext.slots.map((s, i) => (i === slot - 1 ? { ...s, salesLocked: true } : s)) })
      }
    })
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
     pair as reservePrice/reservePriceDefault above. Whole hours, up to a
     year, since OQ27 made it the slot's play-window length: the same
     bounds the company play window had before it was removed. */
  const parseBillingUnitHours = (v: unknown, field: string, errors: { field: string; reason: string }[]): number | null => {
    if (v === null || v === undefined) return null
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 8760) {
      errors.push({ field, reason: 'A billing unit of whole hours, from one hour to 365 days, or null to inherit.' })
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

  /* Whole seconds, MIN_MAX_PLAY_LENGTH_SEC to MAX_MAX_PLAY_LENGTH_SEC, or null to inherit (the max play length ticket, 7 Oct 2026). */
  const parseMaxPlayLength = (v: unknown, field: string, errors: { field: string; reason: string }[]): number | null => {
    if (v === null || v === undefined) return null
    if (typeof v !== 'number' || !Number.isInteger(v) || v < MIN_MAX_PLAY_LENGTH_SEC || v > MAX_MAX_PLAY_LENGTH_SEC) {
      errors.push({ field, reason: `Whole seconds from ${MIN_MAX_PLAY_LENGTH_SEC} to ${MAX_MAX_PLAY_LENGTH_SEC}, or null to inherit.` })
      return null
    }
    return v
  }

  /* Who a slot is assigned to and its reserve
     price override (Rob, 22 Sep): the fields of a sellable slot that live
     here. Everything else about it is set on its display type — including
     the reserve price *default*, which every row for that display type
     edits together (spec §1 configuration inheritance: override always
     wins; a slot with no override of its own simply follows it). */
  app.put<{ Body: { items?: unknown } }>('/available-inventory', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    const rows = Array.isArray(req.body?.items) ? (req.body.items as { displayTypeId?: unknown; slot?: unknown; assignedTo?: unknown; reservePrice?: unknown; reservePriceDefault?: unknown; interactiveReservePrice?: unknown; billingUnitHours?: unknown; billingUnitHoursDefault?: unknown; maxCampaigns?: unknown; maxCampaignsDefault?: unknown; maxPlayLengthSec?: unknown; maxPlayLengthSecDefault?: unknown; inGlobalDeal?: unknown }[]) : null
    if (!rows) throw validationFailed([{ field: 'items', reason: 'An array of slots is required.' }])
    /* Validation, the sold and resize checks and the save are one
       transaction: nothing can be sold, or the slot edited, in between. */
    await tx(ctx.db, async () => {
      const partners = await ctx.partners.list()
      const company = await ctx.company.get()
      const errors: { field: string; reason: string }[] = []
      type Patch = { inGlobalDeal: boolean; assigned: Assigned; reservePrice: number | null; interactiveReservePrice: number | null; billingUnitHours: number | null; maxCampaigns: number | null; maxPlayLengthSec: number | null }
      const wanted = new Map<string, Map<number, Patch>>()
      const defaults = new Map<string, number | null>()
      const billingUnitDefaults = new Map<string, number | null>()
      const maxCampaignsDefaults = new Map<string, number | null>()
      const maxPlayLengthDefaults = new Map<string, number | null>()
      const names = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean) : [])

      for (const [i, r] of rows.entries()) {
        const f = (k: string) => `items[${i}].${k}`
        const dt = typeof r.displayTypeId === 'string' ? await ctx.displayTypes.get(r.displayTypeId) : null
        const slot = typeof r.slot === 'number' ? r.slot : 0
        const def = dt?.phExtensions?.slots?.[slot - 1]
        if (!dt) errors.push({ field: f('displayTypeId'), reason: 'Unknown display type.' })
        else if (!def) errors.push({ field: f('slot'), reason: `${dt.name} has no slot ${slot}.` })
        else if (def.owner !== 'advertiser') errors.push({ field: f('slot'), reason: 'Only an Advertiser slot is sellable inventory.' })

        const raw = (r.assignedTo ?? {}) as { partnerIds?: unknown; advertisers?: unknown; whitelistOnly?: unknown; buyersListId?: unknown; buyersListIds?: unknown; openAuction?: unknown }
        /* The ordered waterfall (7 Oct 2026); an older client sends just buyersListId. Duplicates are kept so validation can name them. */
        const tiers = Array.isArray(raw.buyersListIds) ? names(raw.buyersListIds) : typeof raw.buyersListId === 'string' && raw.buyersListId ? [raw.buyersListId] : []
        const assigned: Assigned = { partnerIds: names(raw.partnerIds), advertisers: names(raw.advertisers), whitelistOnly: raw.whitelistOnly === true, buyersListId: tiers[0] ?? null, buyersListIds: tiers, openAuction: raw.openAuction === true }
        const bad = await validateAssigned(assigned, (k) => f(`assignedTo.${k}`), partners, def ? assignedOf(def) : { partnerIds: [], advertisers: [], whitelistOnly: false, buyersListId: null, buyersListIds: [], openAuction: false }, ctx.buyersLists)
        errors.push(...bad)

        /* The global deal flag (8 Oct 2026): omitted keeps the slot's, so a client that predates it never changes it. */
        if (r.inGlobalDeal !== undefined && typeof r.inGlobalDeal !== 'boolean') errors.push({ field: f('inGlobalDeal'), reason: 'inGlobalDeal must be true or false.' })
        const inGlobalDealNow = typeof r.inGlobalDeal === 'boolean' ? r.inGlobalDeal : def ? slotInGlobalDeal(def) : true

        const reservePrice = parseReservePrice(r.reservePrice, f('reservePrice'), errors)
        /* Omitted keeps what the slot has (older clients never send it); it
           only means anything while the slot supports interactive, so a slot
           that stops supporting it drops the price too. */
        const interactiveReservePrice = r.interactiveReservePrice === undefined ? (def?.interactiveReservePrice ?? null) : parseReservePrice(r.interactiveReservePrice, f('interactiveReservePrice'), errors)
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
        /* Omitted keeps what the slot / display type has (a client that predates max play length never sends it); null inherits. */
        const maxPlayLengthSec = r.maxPlayLengthSec === undefined ? def?.maxPlayLengthSec ?? null : parseMaxPlayLength(r.maxPlayLengthSec, f('maxPlayLengthSec'), errors)
        const maxPlayLengthSecDefault = r.maxPlayLengthSecDefault === undefined ? dt?.phExtensions?.maxPlayLengthSec ?? null : parseMaxPlayLength(r.maxPlayLengthSecDefault, f('maxPlayLengthSecDefault'), errors)
        if (dt) {
          if (maxPlayLengthDefaults.has(dt.id) && maxPlayLengthDefaults.get(dt.id) !== maxPlayLengthSecDefault) errors.push({ field: f('maxPlayLengthSecDefault'), reason: 'All slots on a display type must submit the same max play length default.' })
          else maxPlayLengthDefaults.set(dt.id, maxPlayLengthSecDefault)
        }

        if (dt && def && !bad.length) {
          const byType = wanted.get(dt.id) ?? new Map<number, Patch>()
          byType.set(slot, { inGlobalDeal: inGlobalDealNow, assigned, reservePrice, interactiveReservePrice: INTERACTIVE_ENABLED ? interactiveReservePrice : null, billingUnitHours, maxCampaigns, maxPlayLengthSec })
          wanted.set(dt.id, byType)
        }
      }
      if (errors.length) throw validationFailed(errors, 'A slot is assigned to DSPs or advertisers it can actually sell to.')

      /* A sold slot keeps its advertiser (ticket, 30 Sep 2026): taking one off
         a slot that is reserved or sold for a current or future window would
         silently destroy inventory someone is paying for. Hard block; the
         admin can lock the slot against new sales instead (PUT
         /available-inventory/lock), and once its bookings have played the
         lock releases and the advertiser can go. */
      await releaseSettledSlotLocks(ctx)
      const sold: { field: string; reason: string }[] = []
      for (const [i, r] of rows.entries()) {
        const dt = (await ctx.displayTypes.get(r.displayTypeId as string))!
        const slot = r.slot as number
        const patch = wanted.get(dt.id)?.get(slot)
        const def = dt.phExtensions?.slots?.[slot - 1]
        if (!patch || !def) continue
        const keep = new Set(patch.assigned.advertisers.map((n) => n.trim().toLowerCase()))
        const removed = assignedOf(def).advertisers.filter((n) => !keep.has(n.trim().toLowerCase()))
        if (!removed.length) continue
        const live = await slotLiveBookings(ctx, dt.id, slot)
        if (!live.length) continue
        sold.push({
          field: `items[${i}].assignedTo.advertisers`,
          reason: `${removed.join(', ')} can't be removed from ${dt.name} slot ${slot}: slots are sold (${live.slice(0, 3).map((d) => d.detail).join('; ')}${live.length > 3 ? `; and ${live.length - 3} more` : ''}). Lock the slot against new sales; existing bookings keep running, and once they have played the lock releases and the advertiser can be removed.`,
        })
      }
      if (sold.length) throw hasDependents('Slots are sold, so the advertiser can’t be removed. Existing bookings continue.', sold)

      /* A slot's billing unit is its play-window length (OQ27, Rob 29 Sep
         2026), so changing it — its own override, or the display type
         default it inherits, or dropping back to the platform default — would
         resize windows already bid on or booked under the old length: a
         locked-rate term's windows, a sold week half played. Refused for just
         the slots that have any, naming when the last one ends; every other
         slot's change goes through as before. (A slot's billing unit is one
         row's edit, and its CPM is quoted against it: the admin tries again
         once those windows have played.) */
      const resizing: { field: string; reason: string }[] = []
      for (const [displayTypeId, slots] of wanted) {
        const dt = (await ctx.displayTypes.get(displayTypeId))!
        const newDefault = billingUnitDefaults.has(displayTypeId) ? billingUnitDefaults.get(displayTypeId) ?? null : dt.phExtensions?.billingUnitHours ?? null
        for (const [i, s] of (dt.phExtensions?.slots ?? []).entries()) {
          if (s.owner !== 'advertiser') continue
          const patch = slots.get(i + 1)
          const before = billingUnitHoursOf(dt, s)
          const after = (patch ? patch.billingUnitHours : s.billingUnitHours ?? null) ?? newDefault ?? PLATFORM_DEFAULT_BILLING_UNIT_HOURS
          if (after === before) continue
          const active = await slotWindowCommitments(ctx, positionIdOf(displayTypeId, i + 1), before * 3_600_000)
          if (!active.length) continue
          const until = new Date(Math.max(...active.map((r) => Date.parse(r.windowStart) + before * 3_600_000))).toISOString()
          const row = rows.findIndex((r) => r.displayTypeId === displayTypeId && r.slot === i + 1)
          resizing.push({
            field: row >= 0 ? `items[${row}].billingUnitHours` : 'items',
            reason: `${dt.name} slot ${i + 1} has windows bid on, booked or not yet billed under its ${before}-hour billing unit (the last ends ${until}); its billing unit can change once they have played and been billed.`,
          })
        }
      }
      if (resizing.length) throw validationFailed(resizing, 'A slot’s billing unit is its play-window length, so it can’t change while windows already bid on or booked under it are still to play.')

      for (const [displayTypeId, slots] of wanted) {
        const dt = (await ctx.displayTypes.get(displayTypeId))!
        const ext = { ...(dt.phExtensions ?? { slots: [] }) }
        ext.slots = (ext.slots ?? []).map((s, i) => {
          const patch = slots.get(i + 1)
          /* A slot no longer carries a targeting capability (Rob, 7 Oct 2026): drop any saved one. */
          const { supportedTargeting: _legacy, ...slotNow } = s as typeof s & { supportedTargeting?: unknown }
          const { inGlobalDeal: _flag, ...slotBase } = slotNow
          return patch ? { ...slotBase, ...(patch.inGlobalDeal ? {} : { inGlobalDeal: false }), ...assignedToSlot(patch.assigned, partners), reservePrice: patch.reservePrice, interactiveReservePrice: patch.interactiveReservePrice, billingUnitHours: patch.billingUnitHours, maxCampaigns: patch.maxCampaigns, maxPlayLengthSec: patch.maxPlayLengthSec } : slotNow
        })
        if (defaults.has(displayTypeId)) ext.reservePrice = defaults.get(displayTypeId) ?? null
        if (billingUnitDefaults.has(displayTypeId)) ext.billingUnitHours = billingUnitDefaults.get(displayTypeId) ?? null
        if (maxCampaignsDefaults.has(displayTypeId)) ext.maxCampaigns = maxCampaignsDefaults.get(displayTypeId) ?? null
        if (maxPlayLengthDefaults.has(displayTypeId)) ext.maxPlayLengthSec = maxPlayLengthDefaults.get(displayTypeId) ?? null
        await ctx.displayTypes.saveExtensions(displayTypeId, ext)
      }
    })
    return inventory()
  })
}
