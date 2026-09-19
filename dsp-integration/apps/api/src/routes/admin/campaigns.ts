/* Campaigns: the POC stand-in list and activation toggle (existing
   platform), plus the approval module's routes. Activation is enforced by
   the module: only an approved campaign can be activated (spec §3). */
import { ApprovalError, approvalRoutes } from '@ph-dsp/campaign-approval/server'
import type { Campaign } from '@ph-dsp/types'
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import type { Guards } from '../../http/app'
import { HttpError, notFound, validationFailed } from '../../http/errors'

export const campaignRoutes = (ctx: Context, guards: Guards): FastifyPluginAsync => async (app) => {
  const toCampaign = (c: Awaited<ReturnType<typeof ctx.approvalCampaigns.listCampaigns>>[number], pricingType: Campaign['pricingType'], displayTypeId: string | null): Campaign => ({
    campaignId: c.campaignId, name: c.name, source: c.source, advertiserId: c.advertiserId, advertiserName: c.advertiserName,
    partnerId: c.partnerId, partnerName: c.partnerName, displayTypeId, pricingType, activation: c.activation,
    ...(raw(c.campaignId)?.brief ? { brief: raw(c.campaignId)!.brief } : {}),
  })
  const raw = (id: string) => ctx.campaigns.getCampaign(id)

  app.get('/campaigns', async () => ({
    items: (await ctx.approvalCampaigns.listCampaigns()).map((c) => {
      const r = raw(c.campaignId)
      return toCampaign(c, r?.pricingType ?? null, r?.displayTypeId ?? null)
    }),
  }))

  app.put<{ Params: { id: string }; Body: { enabled?: unknown } }>('/campaigns/:id/activation', async (req) => {
    if (typeof req.body?.enabled !== 'boolean') throw validationFailed([{ field: 'enabled', reason: 'Must be true or false.' }])
    try {
      const c = await ctx.approvals.setActivation(req.params.id, req.body.enabled)
      if (!c) throw notFound()
      const r = raw(c.campaignId)
      return toCampaign(c, r?.pricingType ?? null, r?.displayTypeId ?? null)
    } catch (e) {
      if (e instanceof ApprovalError) throw new HttpError(e.status, e.code, e.message)
      throw e
    }
  })

  await app.register(approvalRoutes(ctx.approvals, {
    guard: () => guards.flagged(),
    requireApprover: (req) => guards.requireScope(req, 'approver'),
    reviewer: (req) => req.session.name,
  }))
}
