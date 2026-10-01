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
  const liveReservations = () => ctx.reservations.byStatus(['won', 'reserved']).filter((r) => !r.testMode)
  type Held = ReturnType<typeof liveReservations>
  const toCampaign = (c: Awaited<ReturnType<typeof ctx.approvalCampaigns.listCampaigns>>[number], r: ReturnType<typeof ctx.campaigns.getCampaign>, held: Held): Campaign => ({
    campaignId: c.campaignId, name: c.name, source: c.source, advertiserId: c.advertiserId, advertiserName: c.advertiserName,
    partnerId: c.partnerId, partnerName: c.partnerName, displayTypeId: r?.displayTypeId ?? null, pricingType: r?.pricingType ?? null, schedule: scheduleOf(c.campaignId, held), activation: c.activation,
    ...campaignLayerSummary(r?.targeting),
    ...(r?.brief ? { brief: r.brief } : {}),
  })
  /* What the advertiser booked: the next window it holds, and how many (Rob, 20 Sep). */
  const scheduleOf = (campaignId: string, all: Held): Campaign['schedule'] => {
    const now = ctx.clock().toISOString()
    const held = all.filter((r) => r.campaignId === campaignId)
    const ahead = held.map((r) => r.windowStart).filter((w) => w >= now).sort()
    return { nextWindowStart: ahead[0] ?? null, bookedWindows: held.length }
  }

  /* One read of each side for the whole list, not one per campaign (the
     list used to make 3-4 platform reads and a reservations scan per row). */
  app.get('/campaigns', async () => {
    const [refs, held] = [await ctx.approvalCampaigns.listCampaigns(), liveReservations()]
    const platform = new Map(ctx.campaigns.listCampaigns().map((c) => [c.campaignId, c]))
    return { items: refs.map((c) => toCampaign(c, platform.get(c.campaignId) ?? null, held)) }
  })

  app.put<{ Params: { id: string }; Body: { enabled?: unknown } }>('/campaigns/:id/activation', async (req) => {
    if (typeof req.body?.enabled !== 'boolean') throw validationFailed([{ field: 'enabled', reason: 'Must be true or false.' }])
    try {
      const c = await ctx.approvals.setActivation(req.params.id, req.body.enabled)
      if (!c) throw notFound()
      return toCampaign(c, ctx.campaigns.getCampaign(c.campaignId), liveReservations())
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
