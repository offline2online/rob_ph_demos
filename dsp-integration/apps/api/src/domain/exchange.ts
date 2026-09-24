/* The client as seller of record (spec §7). sellers.json and the
   SupplyChain node are generated from these four fields; seller type,
   confidentiality and OpenRTB options are fixed platform defaults. */
import type { Exchange, ExchangeInput } from '@ph-dsp/types'

export const isComplete = (e: ExchangeInput) => [e.organisation, e.domain, e.sellerId, e.contactEmail].every((v) => !!v?.trim())

/* Selling: the retailer has DSP integration switched on (Exchange settings,
   Rob 24 Sep 2026) and the seller of record is complete. Only then is
   sellers.json published and any DSP sent a bid request. */
export const isLive = (e: ExchangeInput) => e.enabled && isComplete(e)

export const toApiExchange = (e: ExchangeInput): Exchange => {
  const published = isLive(e)
  return { ...e, published, sellersJsonUrl: published ? `https://${e.domain}/sellers.json` : null }
}

export const sellersJson = (e: ExchangeInput) => ({
  contact_email: e.contactEmail,
  version: '1.0' as const,
  sellers: [{ seller_id: e.sellerId, seller_type: 'PUBLISHER' as const, name: e.organisation, domain: e.domain, is_confidential: 0 as const }],
})

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DOMAIN = /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i

/* The four fields are required only while switched on. Switched off they
   may be blank (a retailer who has never set it up) and are stored as sent,
   so switching back on restores them; a value that is there must still be
   well formed. */
export function validateExchange(b: Partial<ExchangeInput> | undefined) {
  const out: { field: string; reason: string }[] = []
  if (typeof b?.enabled !== 'boolean') out.push({ field: 'enabled', reason: 'Say whether DSP integration is switched on (true or false).' })
  const req = (k: Exclude<keyof ExchangeInput, 'enabled'>, label: string) => {
    if (typeof b?.[k] !== 'string') out.push({ field: k, reason: `${label} is required.` })
    else if (b.enabled && !b[k]!.trim()) out.push({ field: k, reason: `${label} is required.` })
  }
  req('organisation', 'Organisation')
  req('domain', 'Domain')
  req('sellerId', 'Seller ID')
  req('contactEmail', 'Ad-ops contact email')
  if (b?.domain?.trim() && !DOMAIN.test(b.domain.trim())) out.push({ field: 'domain', reason: 'Enter a domain such as demoretail.example (no https:// or path).' })
  if (b?.contactEmail?.trim() && !EMAIL.test(b.contactEmail.trim())) out.push({ field: 'contactEmail', reason: 'Enter a valid email address.' })
  return out
}
