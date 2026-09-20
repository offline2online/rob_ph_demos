/* Slot ownership (spec §1): server-side validation of what the Slot
   assignment editor allows. Ownership decides who may fill a slot; how the
   slot plays is unchanged. */
import { UNLIMITED, type Assigned, type DisplayType, type DisplayTypeExtensions, type Slot } from '@ph-dsp/types'
import type { CompanySettings } from '../repos/CompanySettingsRepo'
import type { PartnerRecord } from '../repos/PartnerRepo'
import { effectiveLists, isBlocked, isOn } from './lists'

/* The rotation cap is the slot count; null = the platform default (Unlimited). */
export const slotCountOf = (dt: DisplayType) => {
  const cap = (dt.playlistSettings as { maximumCampaignsPlayedInRotation?: number | null }).maximumCampaignsPlayedInRotation
  return cap === null || cap === undefined || cap === UNLIMITED ? 0 : Number(cap)
}

type Detail = { field: string; reason: string }

/* The display type's slot editor sets the label and the owner only (Rob,
   20 Sep): who a position is assigned to, and what targeting it supports,
   are edited on Advertisers / Inventory and validated there. */
export function validateExtensions(dt: DisplayType, ext: DisplayTypeExtensions): Detail[] {
  const out: Detail[] = []
  const n = slotCountOf(dt)
  if (ext.slots.length !== n) out.push({ field: 'slots', reason: `Expected ${n} slot${n === 1 ? '' : 's'} (Maximum Campaigns Played In Rotation), got ${ext.slots.length}.` })
  ext.slots.forEach((s, i) => {
    if (!s.label?.trim()) out.push({ field: `slots[${i}].label`, reason: 'A label is required.' })
    if (!(['internal', 'advertiser', 'retail'] as string[]).includes(s.owner)) out.push({ field: `slots[${i}].owner`, reason: 'One of: internal, advertiser, retail.' })
  })
  return out
}

/* Who a sellable position is assigned to (Advertisers / Inventory). DSPs say
   who may bid; advertisers hold it for them, and their DSPs are added
   automatically; neither means any connected DSP. */
export function validateAssigned(
  a: Assigned,
  field: (k: string) => string,
  partners: PartnerRecord[],
  company: CompanySettings,
  previous: Assigned,
): Detail[] {
  const out: Detail[] = []
  const unknown = a.partnerIds.filter((id) => !partners.some((p) => p.id === id))
  if (unknown.length) out.push({ field: field('partnerIds'), reason: `Unknown DSP: ${unknown.join(', ')}.` })
  if (a.advertisers.length && a.whitelistOnly) out.push({ field: field('whitelistOnly'), reason: 'A position is either held for named advertisers or open to the whitelist, not both.' })
  /* The advertiser has to be a seat on a DSP this position can sell through. */
  const scope = a.partnerIds.length ? partners.filter((p) => a.partnerIds.includes(p.id)) : partners
  for (const name of a.advertisers) {
    const p = scope.find((x) => x.seats.some((s) => s.name === name))
    if (!p) {
      out.push({ field: field('advertisers'), reason: `${name} is not an advertiser on ${a.partnerIds.length ? 'the chosen DSPs' : 'any connected DSP'}.` })
      continue
    }
    /* A blocked advertiser is withdrawn from the picker; one already held
       stays, so the position doesn't change under whoever set it (spec §6). */
    const eff = effectiveLists(p, company)
    if (isBlocked(name, eff) && !previous.advertisers.includes(name)) out.push({ field: field('advertisers'), reason: `${name} is on the blacklist.` })
  }
  if (a.whitelistOnly) {
    const lists = (a.partnerIds.length ? partners.filter((p) => a.partnerIds.includes(p.id)) : [null]).map((p) => effectiveLists(p, company))
    if (lists.every((l) => !l.allowList.length)) out.push({ field: field('whitelistOnly'), reason: 'The whitelist is empty.' })
    if (lists.some((l) => l.allowList.some((x) => isOn(x, l.blockList)))) out.push({ field: field('whitelistOnly'), reason: 'The whitelist contains a blocked advertiser.' })
  }
  return out
}

/* What is stored for a position: the advertisers' own DSPs are always among
   the DSPs that may bid, and the list mode follows from the choice. */
export function assignedToSlot(a: Assigned, partners: PartnerRecord[]): Pick<Slot, 'partnerIds' | 'advertisers' | 'listMode'> {
  const implied = a.advertisers.flatMap((name) => partners.filter((p) => p.seats.some((s) => s.name === name)).map((p) => p.id))
  return {
    partnerIds: [...new Set([...a.partnerIds, ...implied])],
    advertisers: [...a.advertisers],
    listMode: a.advertisers.length ? null : a.whitelistOnly ? 'whitelist_only' : 'rtb',
  }
}

/* A slot's share of the loop: loop length / slot count (e.g. 45s / 3 = 15s).
   null when the display type has no slots or no loop length. */
export const slotDurationSec = (dt: DisplayType) => {
  const n = slotCountOf(dt)
  const loop = dt.phExtensions?.venue?.loopLengthSec
  return n > 0 && loop ? Math.round((loop / n) * 1000) / 1000 : null
}
