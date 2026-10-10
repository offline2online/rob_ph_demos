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
  type Held = Map<string, { bookedWindows: number; nextWindowStart: string | null }>
  const toCampaign = (c: Awaited<ReturnType<typeof ctx.approvalCampaigns.listCampaigns>>[number], r: Awaited<ReturnType<typeof ctx.campaigns.getCampaign>>, held: Held, lastPlayed: Map<string, string>, deals: string[]): Campaign => ({
    campaignId: c.campaignId, name: c.name, source: c.source, advertiserId: c.advertiserId, advertiserName: c.advertiserName,
    partnerId: c.partnerId, partnerName: c.partnerName, displayTypeId: r?.displayTypeId ?? null, pricingType: r?.pricingType ?? null, schedule: scheduleOf(c.campaignId, held), lastPlayedAt: lastPlayed.get(c.campaignId) ?? null, activation: c.activation,
    ...campaignLayerSummary(r?.targeting),
    ...(r?.brief ? { brief: r.brief } : {}),
    ...(deals.length ? { dealId: deals[0], dealIds: deals } : {}),
    direct: !c.dealId,
  })
  /* What the advertiser booked: the next window it holds, and how many (Rob, 20 Sep). */
  const scheduleOf = (campaignId: string, held: Held): Campaign['schedule'] => held.get(campaignId) ?? { nextWindowStart: null, bookedWindows: 0 }

  /* One read of each side for the whole list, not one per campaign (the
     list used to make 3-4 platform reads and a reservations scan per row). */
  app.get('/campaigns', async () => {
    /* Counted per campaign in one grouped query (review, 3 Oct 2026): it
       used to load every live sale ever made — 100,000 rows after months —
       and filter that whole list once per campaign. */
    const [refs, held] = [await ctx.approvalCampaigns.listCampaigns(), await ctx.reservations.liveByCampaign(ctx.clock().toISOString())]
    /* Last used is PH Core's playback data (api/PH-CORE-BOUNDARIES.md, PlaybackSource.lastPlayed); the exchange holds none of it. */
    const lastPlayed = await ctx.playback.lastPlayed()
    const platform = new Map((await ctx.campaigns.listCampaigns()).map((c) => [c.campaignId, c]))
    const dealSets = await ctx.approvals.dealSets()
    return { items: refs.map((c) => toCampaign(c, platform.get(c.campaignId) ?? null, held, lastPlayed, dealSets.get(c.campaignId) ?? [])) }
  })

  /* The creative IDs in use, each with the campaigns grouped under it and the
     touch points they run on, so a reviewer picks one by its siblings. */
  app.get<{ Querystring: { advertiserId?: string; dealId?: string } }>('/creative-ids', async (req) => {
    guards.flagged()
    const items = await ctx.approvals.creativeIds(req.query.advertiserId || undefined, req.query.dealId === undefined ? undefined : req.query.dealId || null)
    const platform = new Map((await ctx.campaigns.listCampaigns()).map((c) => [c.campaignId, c]))
    return { items: items.map((g) => ({ ...g, campaigns: g.campaigns.map((m) => ({ ...m, touchPoints: platform.get(m.campaignId)?.brief?.touchPoints ?? [] })) })) }
  })

  /* Set the deals a campaign is associated with beyond its authored one — the
     retailer's side of the crossover (a direct campaign also run through a DSP). */
  app.put<{ Params: { id: string }; Body: { dealIds?: unknown } }>('/campaigns/:id/deals', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'approver')
    const ids = req.body?.dealIds
    if (!Array.isArray(ids) || ids.some((d) => typeof d !== 'string')) throw validationFailed([{ field: 'dealIds', reason: 'An array of deal IDs.' }])
    try { return await ctx.approvals.setDeals(req.params.id, ids as string[], req.session.name) } catch (e) {
      if (e instanceof ApprovalError) throw new HttpError(e.status, e.code, e.message)
      throw e
    }
  })

  app.put<{ Params: { id: string }; Body: { enabled?: unknown } }>('/campaigns/:id/activation', async (req) => {
    if (typeof req.body?.enabled !== 'boolean') throw validationFailed([{ field: 'enabled', reason: 'Must be true or false.' }])
    try {
      const c = await ctx.approvals.setActivation(req.params.id, req.body.enabled)
      if (!c) throw notFound()
      return toCampaign(c, await ctx.campaigns.getCampaign(c.campaignId), await ctx.reservations.liveByCampaign(ctx.clock().toISOString()), await ctx.playback.lastPlayed(), (await ctx.approvals.dealSets()).get(c.campaignId) ?? [])
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
