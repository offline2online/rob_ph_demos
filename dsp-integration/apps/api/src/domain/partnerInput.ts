/* Save changes on a DSP page (spec §7): credentials, bidder integration,
   mode, the DSP's own advertiser lists and its category lists. Secrets are write-only: a
   new value replaces, an omitted one is kept, an empty one clears. */
import { providerDef, type PartnerInput } from '@ph-dsp/types'
import type { CompanySettings } from '../repos/CompanySettingsRepo'
import type { PartnerRecord } from '../repos/PartnerRepo'
import { cleanList } from './advertiserSettings'

type Detail = { field: string; reason: string }
export interface PartnerChange { patch: Partial<PartnerRecord>; secrets: Record<string, string> }

/* An IPv4 address that can only mean the machine, the cluster or the VPC:
   loopback, link-local (the EC2 metadata service is 169.254.169.254),
   RFC 1918 and carrier-grade NAT private ranges, "this network", multicast
   and reserved. */
function privateIpv4(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  return a === 10 || a === 127 || a === 0 || a >= 224
    || (a === 169 && b === 254) || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127)
}
/* Hosts an admin-typed URL may not name (scalability/security review for a
   client VPC, 24 Sep 2026). A DSP's bidder endpoint is where the exchange
   POSTs every bid request (on integration; the POC sends them to
   config.bidders), so it must never be able to point the exchange at the
   VPC itself: the instance metadata service, a node, a pod, an internal
   service. Refused here: IP literals in private ranges, IPv6 loopback,
   unique-local and link-local, names that are plainly local (localhost,
   .local, .internal, .svc, .home.arpa) and single-label names (a cluster
   Service name). A public name that resolves to a private address is
   stopped by the cluster's egress policy (deploy/kubernetes/base/
   networkpolicy.yaml) — the second lock; this is the first. */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '')
  if (h.startsWith('[') && h.endsWith(']')) {
    const v6 = h.slice(1, -1)
    if (v6 === '::1' || v6 === '::' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6)) return true
    /* An IPv4-mapped address, dotted (::ffff:10.0.0.1) or as the URL parser
       rewrites it, in hex (::ffff:a00:1). */
    const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6)
    if (dotted) return privateIpv4(dotted[1])
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v6)
    if (hex) {
      const [hi, lo] = [parseInt(hex[1], 16), parseInt(hex[2], 16)]
      return privateIpv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`)
    }
    return false
  }
  if (privateIpv4(h)) return true
  if (h === 'localhost' || !h.includes('.')) return true
  return /\.(localhost|local|internal|svc|localdomain|home\.arpa)$/.test(h)
}
/* https, to a host outside the machine and the network the exchange runs in. */
export const isPublicHttpsUrl = (s: string) => {
  try {
    const u = new URL(s)
    return u.protocol === 'https:' && !isPrivateHost(u.hostname) && !u.username && !u.password
  } catch {
    return false
  }
}
const BIDDER_TUNING = [['qps', 1, 10_000, 'QPS ceiling'], ['timeoutMs', 50, 2_000, 'Bidder timeout']] as const

/* A DSP's resolved bidder settings: its override, else the platform default (Q46). */
export const bidderTuning = (b: PartnerRecord['bidder'], config: { bidderQps: number; bidderTimeoutMs: number }) =>
  ({ qps: b.qps ?? config.bidderQps, timeoutMs: b.timeoutMs ?? config.bidderTimeoutMs })

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
    /* A credential the DSP fixes once connected (Amazon Ads: region). */
    if (f.fixedOnceConnected && p.status === 'connected' && v !== credsPublic[k]) { errors.push({ field: `credentials.${k}`, reason: `${f.label} is fixed once connected.` }); continue }
    if (f.secret) {
      if (v) secrets[k] = v
      else delete secrets[k]
    } else credsPublic[k] = v.trim()
  }

  const bidder = { ...p.bidder }
  if (body.bidder) {
    if (body.bidder.bidderEndpoint !== undefined) {
      const e = body.bidder.bidderEndpoint.trim()
      if (e && !isPublicHttpsUrl(e)) errors.push({ field: 'bidder.bidderEndpoint', reason: 'Enter a public https:// URL (no private, local or internal addresses).' })
      bidder.bidderEndpoint = e
    }
    if (body.bidder.seatIds !== undefined) bidder.seatIds = cleanList(body.bidder.seatIds)
    /* Per-DSP bidder tuning (Q46, decision 29 Sep 2026): an override wins
       over the platform default (500 QPS, 300 ms); null clears it. */
    for (const [k, min, max, label] of BIDDER_TUNING) {
      const v = (body.bidder as Record<string, unknown>)[k]
      if (v === undefined) continue
      if (v === null) delete bidder[k]
      else if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) errors.push({ field: `bidder.${k}`, reason: `${label}: a whole number from ${min} to ${max}, or empty for the platform default.` })
      else bidder[k] = v
    }
  }

  /* The advertiser lists are this DSP's own and hold only seat IDs it has
     synced (ticket 7ZrBqNdkV9UXbRa8o2fo): an ID means nothing outside the
     DSP that issued it, and free text can't be resolved to one. */
  let { allowList, blockList } = p
  const seatIds = new Map(p.seats.map((s) => [s.id.trim().toLowerCase(), s.id]))
  const seatList = (xs: unknown, field: string) => {
    const out: string[] = []
    for (const x of cleanList(xs)) {
      const id = seatIds.get(x.toLowerCase())
      if (id) out.push(id)
      else errors.push({ field, reason: `${x} is not a seat or advertiser synced from ${p.name}. Connect or refresh the DSP, then choose from its list.` })
    }
    return out
  }
  if (body.advertiserWhitelist !== undefined) allowList = seatList(body.advertiserWhitelist, 'advertiserWhitelist')
  if (body.advertiserBlacklist !== undefined) blockList = seatList(body.advertiserBlacklist, 'advertiserBlacklist')
  const black = new Set(blockList.map((x) => x.toLowerCase()))
  for (const a of allowList) if (black.has(a.toLowerCase())) errors.push({ field: 'advertiserWhitelist', reason: `${p.seats.find((s) => s.id === a)?.name ?? a} is on both the whitelist and the blacklist.` })

  const mode = body.mode ?? p.mode
  if (body.mode !== undefined && body.mode !== 'test' && body.mode !== 'live') errors.push({ field: 'mode', reason: 'Must be test or live.' })
  if (errors.length) return { errors }
  /* No real spend: Live only once connected with the bidder integration complete; never automatic. */
  if (mode === 'live' && p.mode !== 'live' && !(p.status === 'connected' && bidderComplete(bidder))) {
    return { errors, conflict: 'Connect and complete the bidder integration first.' }
  }
  if (mode === 'live' && !bidderComplete(bidder)) return { errors, conflict: 'A live DSP needs its bidder endpoint and seat IDs.' }
  return { errors, change: { patch: { credsPublic, bidder, mode, allowList, blockList }, secrets } }
}
