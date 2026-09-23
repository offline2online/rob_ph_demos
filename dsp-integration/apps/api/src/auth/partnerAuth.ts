/* Partner API auth (POC): one static bearer token per seeded partner, from
   config. Engineering replaces this with the platform's token issuance
   (PH-CORE-BOUNDARIES.md, "Partner identity") — the contract with the
   routes stays the same: a request resolves to one PartnerRecord, or 401.

   Tokens are compared as SHA-256 digests with timingSafeEqual, so the time
   a lookup takes says nothing about how much of a guessed token was right,
   and a token that happens to be an object key ("__proto__", "toString")
   can't resolve to anything. */
import { createHash, timingSafeEqual } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import type { Context } from '../context'
import type { PartnerRecord } from '../repos/PartnerRepo'
import { HttpError } from '../http/errors'

const digest = (token: string) => createHash('sha256').update(token, 'utf8').digest()

/* The configured tokens as digests, built once per config object. */
const tables = new WeakMap<Record<string, string>, { hash: Buffer; partnerId: string }[]>()
function table(tokens: Record<string, string>) {
  let t = tables.get(tokens)
  if (!t) tables.set(tokens, (t = Object.entries(tokens).map(([token, partnerId]) => ({ hash: digest(token), partnerId }))))
  return t
}

export function partnerIdForToken(tokens: Record<string, string>, token: string): string | null {
  const h = digest(token)
  let found: string | null = null
  /* Every entry is compared, match or not: constant work per request. */
  for (const e of table(tokens)) if (timingSafeEqual(e.hash, h)) found = e.partnerId
  return found
}

export function partnerFromRequest(ctx: Context, req: FastifyRequest): PartnerRecord {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')
  const id = m ? partnerIdForToken(ctx.config.partnerTokens, m[1].trim()) : null
  const partner = id ? ctx.partners.get(id) : null
  if (!partner) throw new HttpError(401, 'unauthorised', 'A valid partner bearer token is required.')
  return partner
}

/* Writes (campaigns, assets, submissions) need a connected DSP. Reads stay
   open to an authenticated partner — inventory already shows a DSP that
   isn't connected nothing (visibility, not rejection), and a partner may
   always read the status of its own campaigns. Disconnecting a DSP in DSP
   Integration therefore stops it creating anything, straight away, without
   waiting for its token to be revoked. */
export function requireConnected(partner: PartnerRecord) {
  if (partner.status !== 'connected') throw new HttpError(409, 'conflict', `${partner.name} is not connected.`)
}
