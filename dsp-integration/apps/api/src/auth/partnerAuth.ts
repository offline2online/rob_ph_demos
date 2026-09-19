/* Partner API auth (POC): one static bearer token per seeded partner, from
   config. Engineering replaces this with the platform's token issuance. */
import type { FastifyRequest } from 'fastify'
import type { Context } from '../context'
import type { PartnerRecord } from '../repos/PartnerRepo'
import { HttpError } from '../http/errors'

export function partnerFromRequest(ctx: Context, req: FastifyRequest): PartnerRecord {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')
  const id = m ? ctx.config.partnerTokens[m[1].trim()] : undefined
  const partner = id ? ctx.partners.get(id) : null
  if (!partner) throw new HttpError(401, 'unauthorised', 'A valid partner bearer token is required.')
  return partner
}
