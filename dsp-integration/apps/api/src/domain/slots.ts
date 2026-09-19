/* Slot ownership (spec §1): server-side validation of what the Slot
   assignment editor allows. Ownership decides who may fill a slot; how the
   slot plays is unchanged. */
import { STORE_SCOPES, UNLIMITED, type DisplayType, type DisplayTypeExtensions, type Slot } from '@ph-dsp/types'
import type { CompanySettings } from '../repos/CompanySettingsRepo'
import type { PartnerRecord } from '../repos/PartnerRepo'
import { effectiveLists, isBlocked, isOn } from './lists'

/* The rotation cap is the slot count; null = the platform default (Unlimited). */
export const slotCountOf = (dt: DisplayType) => {
  const cap = (dt.playlistSettings as { maximumCampaignsPlayedInRotation?: number | null }).maximumCampaignsPlayedInRotation
  return cap === null || cap === undefined || cap === UNLIMITED ? 0 : Number(cap)
}

type Detail = { field: string; reason: string }

export function validateExtensions(
  dt: DisplayType,
  ext: DisplayTypeExtensions,
  partners: PartnerRecord[],
  company: CompanySettings,
  previous: Slot[] = [],
): Detail[] {
  const out: Detail[] = []
  const n = slotCountOf(dt)
  if (ext.slots.length !== n) out.push({ field: 'slots', reason: `Expected ${n} slot${n === 1 ? '' : 's'} (Maximum Campaigns Played In Rotation), got ${ext.slots.length}.` })
  ext.slots.forEach((s, i) => {
    const f = (k: string) => `slots[${i}].${k}`
    if (!s.label?.trim()) out.push({ field: f('label'), reason: 'A label is required.' })
    if (s.owner === 'internal') {
      if (s.partnerId || s.advertiser || s.listMode || s.storeScope) out.push({ field: f('owner'), reason: 'A Headquarters slot is filled by priority and takes no assignment.' })
    } else if (s.owner === 'retail') {
      if (!s.storeScope || !(STORE_SCOPES as readonly string[]).includes(s.storeScope)) out.push({ field: f('storeScope'), reason: `Must be one of: ${STORE_SCOPES.join(', ')}.` })
      if (s.partnerId || s.advertiser || s.listMode) out.push({ field: f('owner'), reason: 'A Stores slot takes a store scope only.' })
    } else if (s.owner === 'advertiser') {
      if (s.storeScope) out.push({ field: f('storeScope'), reason: 'An Advertiser slot takes no store scope.' })
      const p = s.partnerId ? partners.find((x) => x.id === s.partnerId) ?? null : null
      if (s.partnerId && !p) out.push({ field: f('partnerId'), reason: 'Unknown partner.' })
      const eff = effectiveLists(p, company)
      const named = !!s.advertiser
      if (named && s.listMode) out.push({ field: f('advertiser'), reason: 'A position is either reserved to a named advertiser or left to RTB / whitelist-only, not both.' })
      if (!named && !s.listMode) out.push({ field: f('listMode'), reason: 'Choose RTB, whitelist-only or a named advertiser.' })
      if ((named || s.listMode === 'whitelist_only') && !p) out.push({ field: f('partnerId'), reason: 'Name a partner first to reserve the position or use its whitelist.' })
      if (s.listMode === 'whitelist_only' && p && !eff.allowList.length) out.push({ field: f('listMode'), reason: 'The whitelist is empty.' })
      if (named && p) {
        if (!p.seats.some((x) => x.name === s.advertiser)) out.push({ field: f('advertiser'), reason: `${s.advertiser} is not an advertiser on ${p.name}.` })
        /* A blocked advertiser is withdrawn from the picker; one that was
           already named stays, flagged, so the position doesn't change under
           whoever set it (spec §6). */
        const unchanged = previous[i]?.owner === 'advertiser' && previous[i]?.partnerId === s.partnerId && previous[i]?.advertiser === s.advertiser
        if (isBlocked(s.advertiser as string, eff) && !unchanged) out.push({ field: f('advertiser'), reason: `${s.advertiser} is on the blacklist.` })
      }
      if (s.listMode === 'whitelist_only' && p && eff.allowList.some((a) => isOn(a, eff.blockList))) out.push({ field: f('listMode'), reason: 'The whitelist contains a blocked advertiser.' })
    }
  })
  return out
}

/* A slot's share of the loop: loop length / slot count (e.g. 45s / 3 = 15s).
   null when the display type has no slots or no loop length. */
export const slotDurationSec = (dt: DisplayType) => {
  const n = slotCountOf(dt)
  const loop = dt.phExtensions?.venue?.loopLengthSec
  return n > 0 && loop ? Math.round((loop / n) * 1000) / 1000 : null
}
