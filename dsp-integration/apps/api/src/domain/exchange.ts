/* The client as seller of record (spec §7). sellers.json and the
   SupplyChain node are generated from these four fields; seller type,
   confidentiality and OpenRTB options are fixed platform defaults. */
import type { Exchange, ExchangeInput } from '@ph-dsp/types'

export const isComplete = (e: ExchangeInput) => [e.organisation, e.domain, e.sellerId, e.contactEmail].every((v) => !!v?.trim())

export const toApiExchange = (e: ExchangeInput): Exchange => {
  const published = isComplete(e)
  return { ...e, published, sellersJsonUrl: published ? `https://${e.domain}/sellers.json` : null }
}

export const sellersJson = (e: ExchangeInput) => ({
  contact_email: e.contactEmail,
  version: '1.0' as const,
  sellers: [{ seller_id: e.sellerId, seller_type: 'PUBLISHER' as const, name: e.organisation, domain: e.domain, is_confidential: 0 as const }],
})

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DOMAIN = /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i

export function validateExchange(b: Partial<ExchangeInput> | undefined) {
  const out: { field: string; reason: string }[] = []
  const req = (k: keyof ExchangeInput, label: string) => {
    if (typeof b?.[k] !== 'string' || !b[k]!.trim()) out.push({ field: k, reason: `${label} is required.` })
  }
  req('organisation', 'Organisation')
  req('domain', 'Domain')
  req('sellerId', 'Seller ID')
  req('contactEmail', 'Ad-ops contact email')
  if (b?.domain?.trim() && !DOMAIN.test(b.domain.trim())) out.push({ field: 'domain', reason: 'Enter a domain such as demoretail.example (no https:// or path).' })
  if (b?.contactEmail?.trim() && !EMAIL.test(b.contactEmail.trim())) out.push({ field: 'contactEmail', reason: 'Enter a valid email address.' })
  return out
}
