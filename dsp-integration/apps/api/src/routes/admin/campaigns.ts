/* Campaigns: the POC stand-in list and activation toggle (existing
   platform), plus the approval module's routes. Activation is enforced by
   the module: only an approved campaign can be activated (spec §3). */
import { ApprovalError, approvalRoutes } from '@ph-dsp/campaign-approval/server'
import type { Campaign } from '@ph-dsp/types'
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import type { Guards } from '../../http/app'
import { campaignLayerSummary } from '../../domain/targetingSummary'
import { HttpError, notFound, validationFailed } from '../../http/errors'

export const campaignRoutes = (ctx: Context, guards: Guards): FastifyPluginAsync => async (app) => {
  const toCampaign = (c: Awaited<ReturnType<typeof ctx.approvalCampaigns.listCampaigns>>[number], pricingType: Campaign['pricingType'], displayTypeId: string | null): Campaign => ({
    campaignId: c.campaignId, name: c.name, source: c.source, advertiserId: c.advertiserId, advertiserName: c.advertiserName,
    partnerId: c.partnerId, partnerName: c.partnerName, displayTypeId, pricingType, schedule: scheduleOf(c.campaignId), activation: c.activation,
    ...campaignLayerSummary(raw(c.campaignId)?.targeting),
    ...(raw(c.campaignId)?.brief ? { brief: raw(c.campaignId)!.brief } : {}),
  })
  const raw = (id: string) => ctx.campaigns.getCampaign(id)
  /* What the advertiser booked: the next window it holds, and how many (Rob, 20 Sep). */
  const scheduleOf = (campaignId: string): Campaign['schedule'] => {
    const now = ctx.clock().toISOString()
    const held = ctx.reservations.byStatus(['won', 'reserved']).filter((r) => r.campaignId === campaignId && !r.testMode)
    const ahead = held.map((r) => r.windowStart).filter((w) => w >= now).sort()
    return { nextWindowStart: ahead[0] ?? null, bookedWindows: held.length }
  }

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
