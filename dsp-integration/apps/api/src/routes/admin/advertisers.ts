/* Advertisers (admin only, spec §3): every advertiser across all DSPs, from
   the seats pulled on connect. Package 3 needs the read side for the slot
   picker; saving arrives with the screen (package 10). */
import { advertiserSlug, type Advertiser } from '@ph-dsp/types'
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import type { Guards } from '../../http/app'
import { validationFailed } from '../../http/errors'
import { effectiveFloorCpm } from '../../domain/pricing'

export async function listAdvertisers(ctx: Context): Promise<Advertiser[]> {
  const company = ctx.company.get()
  /* Each advertiser's campaigns by approval status (Rob, 20 Sep). */
  const byAdvertiser = new Map<string, Advertiser['campaigns']>()
  for (const c of ctx.campaigns.listCampaigns()) {
    if (c.source === 'hq' || !c.advertiserId) continue
    const counts = byAdvertiser.get(c.advertiserId) ?? { draft: 0, awaiting_approval: 0, approved: 0, rejected: 0 }
    counts[await ctx.approvals.statusOf(c.campaignId)]++
    byAdvertiser.set(c.advertiserId, counts)
  }
  const byId = new Map<string, { name: string; via: string[] }>()
  for (const p of ctx.partners.list()) {
    for (const s of p.seats) {
      const id = advertiserSlug(s.name)
      const a = byId.get(id) ?? { name: s.name, via: [] }
      if (!a.via.includes(p.name)) a.via.push(p.name)
      byId.set(id, a)
    }
  }
  return [...byId.entries()]
    .sort((a, b) => a[1].name.localeCompare(b[1].name))
    .map(([advertiserId, a]) => {
      const s = ctx.company.advertiserSetting(advertiserId)
      return {
        advertiserId, name: a.name, via: a.via, ...s, effectiveFloorCpm: effectiveFloorCpm(company, s.floorMultiplier),
        campaigns: byAdvertiser.get(advertiserId) ?? { draft: 0, awaiting_approval: 0, approved: 0, rejected: 0 },
      }
    })
}

export const advertiserRoutes = (ctx: Context, guards: Guards): FastifyPluginAsync => async (app) => {
  app.get('/advertisers', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'sections')
    const { currency, floorCpm } = ctx.company.get()
    return { currency, floorCpm, items: await listAdvertisers(ctx) }
  })

  /* Save changes. Applies to future submissions; campaigns already awaiting
     approval stay in the queue (spec §3). */
  app.put<{ Body: { settings?: Record<string, { approvalRequired?: unknown; floorMultiplier?: unknown }> } }>('/advertisers', async (req, reply) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    const settings = req.body?.settings
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw validationFailed([{ field: 'settings', reason: 'Required.' }])
    const known = new Set((await listAdvertisers(ctx)).map((a) => a.advertiserId))
    const errors: { field: string; reason: string }[] = []
    for (const [id, s] of Object.entries(settings)) {
      if (!known.has(id)) errors.push({ field: `settings.${id}`, reason: 'Not an advertiser on any DSP.' })
      if (typeof s?.approvalRequired !== 'boolean') errors.push({ field: `settings.${id}.approvalRequired`, reason: 'Must be true or false.' })
      if (typeof s?.floorMultiplier !== 'number' || !(s.floorMultiplier > 0)) errors.push({ field: `settings.${id}.floorMultiplier`, reason: 'Must be greater than 0.' })
    }
    if (errors.length) throw validationFailed(errors)
    ctx.company.saveAdvertiserSettings(settings as Record<string, { approvalRequired: boolean; floorMultiplier: number }>)
    return reply.status(200).send()
  })
}
