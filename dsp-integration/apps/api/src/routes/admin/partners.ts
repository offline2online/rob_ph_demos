/* DSPs (spec §7): add, read, save, connect and disconnect. Credentials are
   encrypted at rest, never logged and never returned in full. */
import { PROVIDERS, providerDef, type PartnerInput, type Provider } from '@ph-dsp/types'
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import { applyPartnerInput } from '../../domain/partnerInput'
import { partnerIssues, toApiPartner } from '../../domain/partners'
import { providerOf } from '../../dsp/registry'
import type { Guards } from '../../http/app'
import { conflict, notFound, validationFailed } from '../../http/errors'
import { tx } from '../../db/db'

export const partnerRoutes = (ctx: Context, guards: Guards): FastifyPluginAsync => async (app) => {
  const one = async (id: string) => {
    const p = await ctx.partners.get(id)
    if (!p) throw notFound()
    return p
  }

  app.get('/partners', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    return { items: (await ctx.partners.list()).map(toApiPartner) }
  })

  /* Starts in Test mode and adopts the company lists. One per provider. */
  app.post<{ Body: { provider?: string } }>('/partners', async (req, reply) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    const def = PROVIDERS.find((p) => p.key === req.body?.provider)
    if (!def) throw validationFailed([{ field: 'provider', reason: `Must be one of: ${PROVIDERS.map((p) => p.key).join(', ')}.` }])
    if ((await ctx.partners.list()).some((p) => p.provider === def.key)) throw conflict(`${def.label} is already set up.`)
    const created = await ctx.partners.insert({
      id: `p_${def.key}`, provider: def.key as Provider, name: def.label, status: 'draft', mode: 'test', lastSync: null,
      credsPublic: {}, bidder: {}, seats: [], listsLinked: true, allowList: [], blockList: [], categoryAllowList: [], categoryBlockList: [],
    })
    return reply.status(201).send(toApiPartner(created))
  })

  app.get<{ Params: { id: string } }>('/partners/:id', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    return toApiPartner(await one(req.params.id))
  })

  app.put<{ Params: { id: string }; Body: PartnerInput }>('/partners/:id', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    /* Read, apply and save as one transaction. */
    return toApiPartner(await tx(ctx.db, async () => {
      const p = await one(req.params.id)
      const r = applyPartnerInput(p, await ctx.partners.secrets(p.id), req.body ?? {}, await ctx.company.get())
      if (r.errors.length) throw validationFailed(r.errors)
      if (r.conflict) throw conflict(r.conflict)
      return (await ctx.partners.update(p.id, r.change!.patch, r.change!.secrets))!
    }))
  })

  /* Connect or re-test with the saved credentials; pulls the DSP's advertisers. */
  app.post<{ Params: { id: string } }>('/partners/:id/connect', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    const p = await one(req.params.id)
    const missing = partnerIssues(p).find((i) => i.kind === 'missing_credentials')
    const client = providerOf(ctx.dsp, p.provider)!
    const result = missing
      ? { ok: false as const, reason: missing.message.replace(/\.$/, '') }
      : await client.connect({ public: p.credsPublic, secrets: await ctx.partners.secrets(p.id) })
    req.log.info({ partnerId: p.id, ok: result.ok }, 'dsp connect')
    const updated = result.ok
      ? await ctx.partners.update(p.id, { status: 'connected', lastSync: new Date().toISOString(), seats: result.seats })
      : await ctx.partners.update(p.id, { status: 'error', lastSync: result.reason })
    return toApiPartner(updated!)
  })

  /* Disconnect: back to Test, seats cleared. */
  app.post<{ Params: { id: string } }>('/partners/:id/disconnect', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    const p = await one(req.params.id)
    return toApiPartner((await ctx.partners.update(p.id, { status: 'draft', mode: 'test', lastSync: null, seats: [] }))!)
  })
}
