/* Slot ownership (spec §1): server-side validation of what the Slot
   assignment editor allows. Ownership decides who may fill a slot; how the
   slot plays is unchanged. */
import { UNLIMITED, allowsAdvertising, type Assigned, type DisplayType, type DisplayTypeExtensions, type Slot } from '@ph-dsp/types'
import type { BuyersListRepo } from '../repos/BuyersListRepo'
import type { CompanySettings } from '../repos/CompanySettingsRepo'
import type { PartnerRecord } from '../repos/PartnerRepo'
import { zonesOf, type Zone } from './displayTypes'
import { effectiveLists, isBlocked, isOn } from './lists'

const countOfCap = (cap: number | null | undefined) => (cap === null || cap === undefined || cap === UNLIMITED ? 0 : Number(cap))
/* The rotation cap is the slot count; null = the platform default (Unlimited). */
export const slotCountOf = (dt: DisplayType) => countOfCap((dt.playlistSettings as { maximumCampaignsPlayedInRotation?: number | null }).maximumCampaignsPlayedInRotation)
export const zoneSlotCountOf = (z: Zone) => countOfCap(z.maximumCampaignsPlayedInRotation)

/* Which zone each slot of the display type belongs to, in order (ticket,
   28 Sep 2026): on a multi-zone display type the slot list is one segment
   per zone, sized by that zone's own Maximum Campaigns Played In Rotation,
   because each zone runs its own playlist and so its own rotation; on a
   single-zone one it is the display type's own cap, with no zone at all. A
   position is still identified by display type + slot number
   (PH-CORE-BOUNDARIES.md) — a three-zone Menu Board with two slots a zone
   simply has six positions. */
export const expectedZoneIds = (dt: DisplayType): (string | null)[] => {
  const zones = zonesOf(dt)
  return zones.length ? zones.flatMap((z) => Array<string | null>(zoneSlotCountOf(z)).fill(z.id)) : Array<string | null>(slotCountOf(dt)).fill(null)
}
export const expectedSlotCountOf = (dt: DisplayType) => expectedZoneIds(dt).length
/* The size of the rotation a slot (1-based) plays in: its zone's, or the
   whole screen's — what its share of voice is a share of. */
export const rotationSizeOf = (dt: DisplayType, slot: number) => {
  const s = dt.phExtensions?.slots?.[slot - 1]
  const zone = s?.zoneId ? zonesOf(dt).find((z) => z.id === s.zoneId) : undefined
  return zone ? zoneSlotCountOf(zone) : slotCountOf(dt)
}

type Detail = { field: string; reason: string }

/* The display type's slot editor sets the label and the owner only (Rob,
   20 Sep): who a position is assigned to, and what targeting it supports,
   are edited on Advertisers / Inventory and validated there. */
export function validateExtensions(dt: DisplayType, ext: DisplayTypeExtensions): Detail[] {
  const out: Detail[] = []
  const zones = zonesOf(dt)
  const expected = expectedZoneIds(dt)
  const n = expected.length
  if (ext.slots.length !== n) {
    out.push({
      field: 'slots',
      reason: zones.length
        ? `Expected ${n} slot${n === 1 ? '' : 's'} across ${zones.length} zone${zones.length === 1 ? '' : 's'} (each zone's Maximum Campaigns Played In Rotation), got ${ext.slots.length}.`
        : `Expected ${n} slot${n === 1 ? '' : 's'} (Maximum Campaigns Played In Rotation), got ${ext.slots.length}.`,
    })
  }
  const advertisingAllowed = allowsAdvertising(dt.touchPoint)
  ext.slots.forEach((s, i) => {
    if (!s.label?.trim()) out.push({ field: `slots[${i}].label`, reason: 'A label is required.' })
    if (!(['internal', 'advertiser', 'retail'] as string[]).includes(s.owner)) out.push({ field: `slots[${i}].owner`, reason: 'One of: internal, advertiser, retail.' })
    else if (!advertisingAllowed && s.owner !== 'internal') out.push({ field: `slots[${i}].owner`, reason: 'Advertising isn’t available for this touch point: only Headquarters slots are allowed.' })
    else if (s.owner === 'retail') out.push({ field: `slots[${i}].owner`, reason: `Slot ${i + 1}: Stores can’t own a slot in this release — choose internal or advertiser.` })
    if (!zones.length) {
      if (s.zoneId != null) out.push({ field: `slots[${i}].zoneId`, reason: 'Unknown zone.' })
    } else if (i < n && (s.zoneId ?? null) !== expected[i]) {
      const zone = zones.find((z) => z.id === expected[i])
      out.push({ field: `slots[${i}].zoneId`, reason: `Slot ${i + 1} is ${zone?.name ?? expected[i]}'s: each zone's slots follow its own Maximum Campaigns Played In Rotation, in zone order.` })
    }
  })
  return out
}

/* Who a sellable position is assigned to (Advertisers / Inventory). DSPs say
   who may bid; advertisers hold it for them, and their DSPs are added
   automatically; a buyers list restricts it to a private auction among its
   invited buyers; none of these means any connected DSP. */
export async function validateAssigned(
  a: Assigned,
  field: (k: string) => string,
  partners: PartnerRecord[],
  previous: Assigned,
  buyersLists: BuyersListRepo,
): Promise<Detail[]> {
  const out: Detail[] = []
  const unknown = a.partnerIds.filter((id) => !partners.some((p) => p.id === id))
  if (unknown.length) out.push({ field: field('partnerIds'), reason: `Unknown DSP: ${unknown.join(', ')}.` })
  if (a.advertisers.length && a.whitelistOnly) out.push({ field: field('whitelistOnly'), reason: 'A position is either held for named advertisers or open to the whitelist, not both.' })
  if (a.openAuction && (a.advertisers.length || a.whitelistOnly)) out.push({ field: field('openAuction'), reason: 'The Open auction (a DSP or All DSPs) is mutually exclusive with named advertisers and the whitelist.' })
  if (a.buyersListIds.length && (a.advertisers.length || a.whitelistOnly)) out.push({ field: field('buyersListId'), reason: 'A private auction (buyers list) is mutually exclusive with named advertisers and the whitelist.' })
  /* The waterfall (7 Oct 2026): an ordered list, one list per tier, so a list can appear once. */
  if (new Set(a.buyersListIds).size !== a.buyersListIds.length) out.push({ field: field('buyersListIds'), reason: 'A buyers list can be in the waterfall once: each tier holds one list.' })
  for (const id of a.buyersListIds) if (!(await buyersLists.get(id))) out.push({ field: field(a.buyersListIds.length > 1 ? 'buyersListIds' : 'buyersListId'), reason: `Unknown buyers list${a.buyersListIds.length > 1 ? ` (${id})` : ''}.` })
  /* The advertiser has to be a seat on a DSP this position can sell through. */
  const scope = a.partnerIds.length ? partners.filter((p) => a.partnerIds.includes(p.id)) : partners
  for (const name of a.advertisers) {
    const p = scope.find((x) => x.seats.some((s) => s.name === name))
    const seat = p?.seats.find((s) => s.name === name)
    if (!p || !seat) {
      out.push({ field: field('advertisers'), reason: `${name} is not an advertiser on ${a.partnerIds.length ? 'the chosen DSPs' : 'any connected DSP'}.` })
      continue
    }
    /* A blocked advertiser is withdrawn from the picker; one already held
       stays, so the position doesn't change under whoever set it (spec §6). */
    if (isBlocked(seat.id, effectiveLists(p)) && !previous.advertisers.includes(name)) out.push({ field: field('advertisers'), reason: `${name} is on the blacklist.` })
  }
  if (a.whitelistOnly) {
    const lists = scope.map((p) => effectiveLists(p))
    if (lists.every((l) => !l.allowList.length)) out.push({ field: field('whitelistOnly'), reason: 'The whitelist is empty.' })
    if (lists.some((l) => l.allowList.some((x) => isOn(x, l.blockList)))) out.push({ field: field('whitelistOnly'), reason: 'The whitelist contains a blocked advertiser.' })
  }
  return out
}

/* What is stored for a position: the advertisers' own DSPs are always among
   the DSPs that may bid, and the list mode follows from the choice. A
   buyers list's own invited buyers are resolved to DSPs live at auction
   time (positions.ts effectivePartnerIds), not cached here — partnerIds is
   left as the caller's own DSP-level choice (usually empty) for a deal. */
export function assignedToSlot(a: Assigned, partners: PartnerRecord[]): Pick<Slot, 'partnerIds' | 'advertisers' | 'listMode' | 'buyersListId' | 'buyersListIds' | 'openAuction'> {
  const implied = a.advertisers.flatMap((name) => partners.filter((p) => p.seats.some((s) => s.name === name)).map((p) => p.id))
  return {
    partnerIds: [...new Set([...a.partnerIds, ...implied])],
    advertisers: [...a.advertisers],
    listMode: a.advertisers.length ? null : a.buyersListIds.length ? 'deal' : a.whitelistOnly ? 'whitelist_only' : 'rtb',
    buyersListId: a.advertisers.length ? null : a.buyersListIds[0] ?? null,
    buyersListIds: a.advertisers.length ? [] : [...a.buyersListIds],
    openAuction: !a.advertisers.length && !a.whitelistOnly && a.openAuction,
  }
}

/* A slot's share of the loop: loop length / the size of its rotation (e.g.
   45s / 3 = 15s). null when the rotation has no slots or no loop length. */
export const slotDurationSec = (dt: DisplayType, n = slotCountOf(dt)) => {
  const loop = dt.phExtensions?.venue?.loopLengthSec
  return n > 0 && loop ? Math.round((loop / n) * 1000) / 1000 : null
}
