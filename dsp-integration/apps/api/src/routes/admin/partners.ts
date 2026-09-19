/* DSPs (spec §7): add, read, save, connect and disconnect. Credentials are
   encrypted at rest, never logged and never returned in full. */
import { PROVIDERS, providerDef, type PartnerInput, type Provider } from '@ph-dsp/types'
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import { applyPartnerInput } from '../../domain/partnerInput'
import { partnerIssues, toApiPartner } from '../../domain/partners'
import type { Guards } from '../../http/app'
import { conflict, notFound, validationFailed } from '../../http/errors'

export const partnerRoutes = (ctx: Context, guards: Guards): FastifyPluginAsync => async (app) => {
  const one = (id: string) => {
    const p = ctx.partners.get(id)
    if (!p) throw notFound()
    return p
  }

  app.get('/partners', async () => {
    guards.flagged()
    return { items: ctx.partners.list().map(toApiPartner) }
  })

  /* Starts in Test mode and adopts the company lists. One per provider. */
  app.post<{ Body: { provider?: string } }>('/partners', async (req, reply) => {
    guards.flagged()
    const def = PROVIDERS.find((p) => p.key === req.body?.provider)
    if (!def) throw validationFailed([{ field: 'provider', reason: `Must be one of: ${PROVIDERS.map((p) => p.key).join(', ')}.` }])
    if (ctx.partners.list().some((p) => p.provider === def.key)) throw conflict(`${def.label} is already set up.`)
    const created = ctx.partners.insert({
      id: `p_${def.key}`, provider: def.key as Provider, name: def.label, status: 'draft', mode: 'test', lastSync: null,
      credsPublic: {}, bidder: {}, seats: [], listsLinked: true, allowList: [], blockList: [],
    })
    return reply.status(201).send(toApiPartner(created))
  })

  app.get<{ Params: { id: string } }>('/partners/:id', async (req) => {
    guards.flagged()
    return toApiPartner(one(req.params.id))
  })

  app.put<{ Params: { id: string }; Body: PartnerInput }>('/partners/:id', async (req) => {
    guards.flagged()
    const p = one(req.params.id)
    const r = applyPartnerInput(p, ctx.partners.secrets(p.id), req.body ?? {}, ctx.company.get())
    if (r.errors.length) throw validationFailed(r.errors)
    if (r.conflict) throw conflict(r.conflict)
    return toApiPartner(ctx.partners.update(p.id, r.change!.patch, r.change!.secrets)!)
  })

  /* Connect or re-test with the saved credentials; pulls the DSP's advertisers. */
  app.post<{ Params: { id: string } }>('/partners/:id/connect', async (req) => {
    guards.flagged()
    const p = one(req.params.id)
    const missing = partnerIssues(p).find((i) => i.kind === 'missing_credentials')
    const client = ctx.dsp[p.provider as Provider]
    const result = missing
      ? { ok: false as const, reason: missing.message.replace(/\.$/, '') }
      : client
        ? await client.connect({ public: p.credsPublic, secrets: ctx.partners.secrets(p.id) })
        : { ok: false as const, reason: `Connecting ${providerDef(p.provider)?.label} arrives with package 17` }
    req.log.info({ partnerId: p.id, ok: result.ok }, 'dsp connect')
    const updated = result.ok
      ? ctx.partners.update(p.id, { status: 'connected', lastSync: new Date().toISOString(), seats: result.seats })
      : ctx.partners.update(p.id, { status: 'error', lastSync: result.reason })
    return toApiPartner(updated!)
  })

  /* Disconnect: back to Test, seats cleared. */
  app.post<{ Params: { id: string } }>('/partners/:id/disconnect', async (req) => {
    guards.flagged()
    const p = one(req.params.id)
    return toApiPartner(ctx.partners.update(p.id, { status: 'draft', mode: 'test', lastSync: null, seats: [] })!)
  })
}
