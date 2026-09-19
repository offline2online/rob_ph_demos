/* Save changes on a DSP page (spec §7): credentials, bidder integration,
   mode and advertiser lists. Secrets are write-only: a new value replaces,
   an omitted one is kept, an empty one clears. */
import { providerDef, type PartnerInput } from '@ph-dsp/types'
import type { CompanySettings } from '../repos/CompanySettingsRepo'
import type { PartnerRecord } from '../repos/PartnerRepo'
import { cleanList } from './advertiserSettings'

type Detail = { field: string; reason: string }
export interface PartnerChange { patch: Partial<PartnerRecord>; secrets: Record<string, string> }

const isHttpsUrl = (s: string) => {
  try {
    return new URL(s).protocol === 'https:'
  } catch {
    return false
  }
}
export const bidderComplete = (b: PartnerRecord['bidder']) => !!b.bidderEndpoint?.trim() && !!b.seatIds?.length

export function applyPartnerInput(p: PartnerRecord, currentSecrets: Record<string, string>, body: PartnerInput, company: CompanySettings): { change?: PartnerChange; errors: Detail[]; conflict?: string } {
  const errors: Detail[] = []
  const def = providerDef(p.provider)
  const fields = new Map((def?.fields ?? []).map((f) => [f.key, f]))
  const credsPublic = { ...p.credsPublic }
  const secrets = { ...currentSecrets }

  for (const [k, v] of Object.entries(body.credentials ?? {})) {
    const f = fields.get(k)
    if (!f) { errors.push({ field: `credentials.${k}`, reason: `Not a ${def?.label ?? 'DSP'} credential.` }); continue }
    if (typeof v !== 'string') { errors.push({ field: `credentials.${k}`, reason: 'Must be text.' }); continue }
    if (f.options && v && !f.options.includes(v)) { errors.push({ field: `credentials.${k}`, reason: `Must be one of: ${f.options.join(', ')}.` }); continue }
    /* Amazon Ads: "Region … fixed once connected". */
    if (k === 'region' && p.provider === 'amazon_dsp' && p.status === 'connected' && v !== credsPublic.region) { errors.push({ field: 'credentials.region', reason: 'Region is fixed once connected.' }); continue }
    if (f.secret) {
      if (v) secrets[k] = v
      else delete secrets[k]
    } else credsPublic[k] = v.trim()
  }

  const bidder = { ...p.bidder }
  if (body.bidder) {
    if (body.bidder.bidderEndpoint !== undefined) {
      const e = body.bidder.bidderEndpoint.trim()
      if (e && !isHttpsUrl(e)) errors.push({ field: 'bidder.bidderEndpoint', reason: 'Enter an https:// URL.' })
      bidder.bidderEndpoint = e
    }
    if (body.bidder.seatIds !== undefined) bidder.seatIds = cleanList(body.bidder.seatIds)
  }

  let { listsLinked, allowList, blockList } = p
  if (body.listsLinked === false && p.listsLinked) {
    /* Unlinking copies the inherited lists down, so a blacklist never silently empties. */
    listsLinked = false
    allowList = [...company.advertiserWhitelist]
    blockList = [...company.advertiserBlacklist]
  } else if (body.listsLinked === true && !p.listsLinked) {
    /* Relinking discards the DSP's own lists. */
    listsLinked = true
    allowList = []
    blockList = []
  }
  if (!listsLinked) {
    if (body.advertiserWhitelist !== undefined) allowList = cleanList(body.advertiserWhitelist)
    if (body.advertiserBlacklist !== undefined) blockList = cleanList(body.advertiserBlacklist)
    const black = new Set(blockList.map((x) => x.toLowerCase()))
    for (const a of allowList) if (black.has(a.toLowerCase())) errors.push({ field: 'advertiserWhitelist', reason: `${a} is on both the whitelist and the blacklist.` })
  }

  const mode = body.mode ?? p.mode
  if (body.mode !== undefined && body.mode !== 'test' && body.mode !== 'live') errors.push({ field: 'mode', reason: 'Must be test or live.' })
  if (errors.length) return { errors }
  /* No real spend: Live only once connected with the bidder integration complete; never automatic. */
  if (mode === 'live' && p.mode !== 'live' && !(p.status === 'connected' && bidderComplete(bidder))) {
    return { errors, conflict: 'Connect and complete the bidder integration first.' }
  }
  if (mode === 'live' && !bidderComplete(bidder)) return { errors, conflict: 'A live DSP needs its bidder endpoint and seat IDs.' }
  return { errors, change: { patch: { credsPublic, bidder, mode, listsLinked, allowList, blockList }, secrets } }
}
