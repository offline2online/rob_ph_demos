/* Platform users (Company Settings -> Users, ticket H6BcvdNZUvdP8Ebh5Tve).
   Internal users (Admin, Marketing, Help Desk) are stored as entered. An
   Advertiser user is bound to one advertiser from the same list as
   Advertisers / Inventory (DSP seats and direct advertisers). Signing in is
   PH Core's job (api/PH-CORE-BOUNDARIES.md); GET /users/:email/scope is what
   it reads to limit that user to their own advertiser's campaigns. */
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import type { Guards } from '../../http/app'
import type { PlatformUserRecord } from '../../repos/CompanySettingsRepo'
import { conflict, notFound, validationFailed } from '../../http/errors'
import { listAdvertisers } from './advertisers'

const ROLES: PlatformUserRecord['role'][] = ['Admin', 'Marketing', 'Help Desk', 'Advertiser']
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

type Body = { firstName?: unknown; lastName?: unknown; email?: unknown; role?: unknown; advertiserId?: unknown; invite?: unknown }

export const userRoutes = (ctx: Context, guards: Guards): FastifyPluginAsync => async (app) => {
  const view = async (u: PlatformUserRecord) => {
    const advertisers = u.advertiserId ? await listAdvertisers(ctx) : []
    const a = advertisers.find((x) => x.advertiserId === u.advertiserId)
    return { ...u, advertiserName: a?.name ?? null, advertiserDirect: a ? a.direct : null }
  }
  /* Shared by add and edit; edit never changes the email. */
  const parse = async (b: Body | undefined, editing: boolean) => {
    const errors: { field: string; reason: string }[] = []
    const str = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '')
    const firstName = str(b?.firstName)
    const lastName = str(b?.lastName)
    const email = str(b?.email).toLowerCase()
    if (!firstName || firstName.length > 80) errors.push({ field: 'firstName', reason: 'A first name of 1 to 80 characters is required.' })
    if (lastName.length > 80) errors.push({ field: 'lastName', reason: 'At most 80 characters.' })
    if (!editing && (!EMAIL.test(email) || email.length > 200)) errors.push({ field: 'email', reason: 'Enter a valid email address.' })
    const role = b?.role as PlatformUserRecord['role']
    if (!ROLES.includes(role)) errors.push({ field: 'role', reason: `Must be one of ${ROLES.join(', ')}.` })
    let advertiserId: string | null = null
    if (role === 'Advertiser') {
      advertiserId = typeof b?.advertiserId === 'string' ? b.advertiserId : ''
      if (!(await listAdvertisers(ctx)).some((a) => a.advertiserId === advertiserId)) errors.push({ field: 'advertiserId', reason: 'Choose an advertiser from Advertisers / Inventory.' })
    }
    if (errors.length) throw validationFailed(errors)
    return { firstName, lastName, email, role, advertiserId, invite: b?.invite === true }
  }

  app.get('/users', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    const advertisers = new Map((await listAdvertisers(ctx)).map((a) => [a.advertiserId, a]))
    return {
      items: (await ctx.company.platformUsers()).map((u) => {
        const a = u.advertiserId ? advertisers.get(u.advertiserId) : undefined
        return { ...u, advertiserName: a?.name ?? null, advertiserDirect: a ? a.direct : null }
      }),
    }
  })

  app.post<{ Body: Body }>('/users', async (req, reply) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    const p = await parse(req.body, false)
    if (await ctx.company.platformUser(p.email)) throw conflict(`${p.email} is already a user.`)
    const u: PlatformUserRecord = { email: p.email, firstName: p.firstName, lastName: p.lastName, role: p.role, advertiserId: p.advertiserId, invited: p.invite, lastLoginAt: null }
    await ctx.company.savePlatformUser(u)
    return reply.status(201).send(await view(u))
  })

  app.put<{ Params: { email: string }; Body: Body }>('/users/:email', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    const email = req.params.email.toLowerCase()
    const old = await ctx.company.platformUser(email)
    if (!old) throw notFound('No such user.')
    const p = await parse(req.body, true)
    const u: PlatformUserRecord = { ...old, firstName: p.firstName, lastName: p.lastName, role: p.role, advertiserId: p.advertiserId }
    await ctx.company.savePlatformUser(u)
    return view(u)
  })

  app.delete<{ Params: { email: string } }>('/users/:email', async (req, reply) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    if (!(await ctx.company.removePlatformUser(req.params.email.toLowerCase()))) throw notFound('No such user.')
    return reply.status(204).send()
  })

  /* What this user may see: an Advertiser user gets only their advertiser's
     campaigns; an internal user is not limited (advertiser null). */
  app.get<{ Params: { email: string } }>('/users/:email/scope', async (req) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    const u = await ctx.company.platformUser(req.params.email.toLowerCase())
    if (!u) throw notFound('No such user.')
    if (u.role !== 'Advertiser' || !u.advertiserId) return { email: u.email, role: u.role, advertiser: null, campaigns: [] }
    const a = (await listAdvertisers(ctx)).find((x) => x.advertiserId === u.advertiserId)
    const campaigns = (await ctx.approvalCampaigns.listCampaigns()).filter((c) => c.advertiserId === u.advertiserId)
    return {
      email: u.email, role: u.role,
      advertiser: a ? { advertiserId: a.advertiserId, name: a.name, direct: a.direct, bookings: a.bookings, campaigns: a.campaigns } : null,
      campaigns: await Promise.all(campaigns.map(async (c) => ({ campaignId: c.campaignId, name: c.name, activation: c.activation, approval: await ctx.approvals.statusOf(c.campaignId) }))),
    }
  })
}
