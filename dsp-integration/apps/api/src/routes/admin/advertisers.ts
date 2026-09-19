/* Advertisers (admin only, spec §3): every advertiser across all DSPs, from
   the seats pulled on connect. Package 3 needs the read side for the slot
   picker; saving arrives with the screen (package 10). */
import { advertiserSlug, type Advertiser } from '@ph-dsp/types'
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import type { Guards } from '../../http/app'
import { effectiveFloorCpm } from '../../domain/pricing'

export function listAdvertisers(ctx: Context): Advertiser[] {
  const company = ctx.company.get()
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
      return { advertiserId, name: a.name, via: a.via, ...s, effectiveFloorCpm: effectiveFloorCpm(company, s.floorMultiplier) }
    })
}

export const advertiserRoutes = (ctx: Context, guards: Guards): FastifyPluginAsync => async (app) => {
  app.get('/advertisers', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    const { currency, floorCpm } = ctx.company.get()
    return { currency, floorCpm, items: listAdvertisers(ctx) }
  })
}
