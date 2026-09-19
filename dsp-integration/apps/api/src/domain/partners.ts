/* Partner as the admin API returns it (contract `Partner`): secrets only as
   {set:true}, own lists only when unlinked, and the issues shown at the top
   of the DSP page. */
import { providerDef, type Partner } from '@ph-dsp/types'
import type { PartnerRecord } from '../repos/PartnerRepo'

export function partnerIssues(p: PartnerRecord): NonNullable<Partner['issues']> {
  const issues: NonNullable<Partner['issues']> = []
  if (p.status === 'error') issues.push({ kind: 'connection_error', message: p.lastSync || 'The last connection test failed.' })
  const missing = (providerDef(p.provider)?.fields ?? [])
    .filter((f) => (f.secret ? !p.secretsSet.includes(f.key) : !String(p.credsPublic[f.key] ?? '').trim()))
    .map((f) => f.label)
  if (missing.length) issues.push({ kind: 'missing_credentials', message: `Missing credentials: ${missing.join(', ')}.`, fields: missing })
  const bidderMissing = [!p.bidder.bidderEndpoint && 'Bidder endpoint', !(p.bidder.seatIds ?? []).length && 'Seat IDs'].filter(Boolean) as string[]
  if (bidderMissing.length) issues.push({ kind: 'missing_bidder_fields', message: `Cannot receive bids yet: missing ${bidderMissing.join(', ')}.`, fields: bidderMissing })
  return issues
}

export function toApiPartner(p: PartnerRecord): Partner {
  const credentials: Record<string, unknown> = { ...p.credsPublic }
  p.secretsSet.forEach((k) => (credentials[k] = { set: true }))
  const bidder: NonNullable<Partner['bidder']> = {}
  if (p.bidder.bidderEndpoint) bidder.bidderEndpoint = p.bidder.bidderEndpoint
  if (p.bidder.seatIds?.length) bidder.seatIds = p.bidder.seatIds
  return {
    id: p.id, provider: p.provider as Partner['provider'], name: p.name, status: p.status, lastSync: p.lastSync, mode: p.mode,
    credentials, bidder, issues: partnerIssues(p), seats: p.seats, listsLinked: p.listsLinked,
    ...(p.listsLinked ? {} : { advertiserWhitelist: p.allowList, advertiserBlacklist: p.blockList }),
  }
}
