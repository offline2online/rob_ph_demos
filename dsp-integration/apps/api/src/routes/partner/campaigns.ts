/* Partner API campaigns (content packages), spec §3 and §6:
     POST /v1/campaigns                 baseline (required) + targeted versions, rules validated
     POST /v1/campaigns/{id}/assets     creative upload and automated checks
     POST /v1/campaigns/{id}/submit     submit for retailer approval
     GET  /v1/campaigns/{id}/status     approval status
   A partner only ever sees its own campaigns; anyone else's is not found. */
import { randomUUID } from 'node:crypto'
import { ApprovalError } from '@ph-dsp/campaign-approval/server'
import { advertiserSlug } from '@ph-dsp/types'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { requireConnected } from '../../auth/partnerAuth'
import type { Context } from '../../context'
import { type Check, failed, failureDetails, fileChecks } from '../../domain/assetChecks'
import { validateBrief } from '../../domain/campaignBrief'
import { EXTENSION, isVideo, readMedia } from '../../domain/media'
import { type Rules, throwIfRejected, validateRules } from '../../domain/targetingValidation'
import type { StoredTargeting } from '../../domain/targetingSummary'
import { HttpError, conflict, notFound, validationFailed } from '../../http/errors'
import type { PartnerRecord } from '../../repos/PartnerRepo'

const PRICING_TYPES = ['default', 'localised', 'personalised', 'interactive'] as const
type PricingType = (typeof PRICING_TYPES)[number]
type Detail = { field: string; reason: string }

interface CreateBody {
  advertiserId?: unknown; name?: unknown; displayTypeId?: unknown; brief?: unknown
  default?: { pricingType?: unknown }
  targeted?: { id?: unknown; priority?: unknown; pricingType?: unknown; rules?: unknown }[]
}

/* The partner's advertisers are its seats, keyed by slug (decision 6). */
export const partnerAdvertiser = (p: PartnerRecord, advertiserId: string) => p.seats.find((s) => advertiserSlug(s.name) === advertiserId) ?? null

const statusView = (a: { campaignId: string; status: string; mode: string | null; reason: string | null; assetVersion: string }) => ({
  campaignId: a.campaignId, status: a.status, mode: a.mode, reason: a.reason, assetVersion: a.assetVersion,
})

const approvalError = (e: unknown) => (e instanceof ApprovalError ? new HttpError(e.status, e.code, e.message) : e)

export const campaignRoutes = (ctx: Context): FastifyPluginAsync => async (app) => {
  /* The calling partner's campaign, or 404. */
  const own = (partner: PartnerRecord, id: string) => {
    const c = ctx.campaigns.getCampaign(id)
    if (!c || c.partnerId !== partner.id || c.source === 'hq') throw notFound('Campaign not found.')
    return c
  }
  const targetingOf = (targeting: unknown) => (targeting ?? { default: { pricingType: 'default' } }) as StoredTargeting

  app.post<{ Body: CreateBody }>('/campaigns', async (req, reply) => {
    requireConnected(req.partner)
    const b = req.body ?? {}
    const invalid: Detail[] = []
    const lim = ctx.config.campaignLimits
    if (typeof b.advertiserId !== 'string' || !partnerAdvertiser(req.partner, b.advertiserId)) invalid.push({ field: 'advertiserId', reason: `Not an advertiser on ${req.partner.name}.` })
    if (typeof b.name !== 'string' || !b.name.trim()) invalid.push({ field: 'name', reason: 'Required.' })
    else if (b.name.trim().length > lim.nameLength) invalid.push({ field: 'name', reason: `At most ${lim.nameLength} characters.` })
    if (b.displayTypeId !== undefined && (typeof b.displayTypeId !== 'string' || !ctx.displayTypes.get(b.displayTypeId))) invalid.push({ field: 'displayTypeId', reason: 'Unknown display type.' })
    /* default is mandatory on every submission (decision, 22 Sep,
       superseding the earlier same-day "baseline optional" decision —
       ticket "Make default creative mandatory; retire localised-only
       booking path"): the fallback-free/part-sold submission shape (only
       localised targeted versions, leaving stores none of them match to
       another advertiser) is retired — every slot goes to one advertiser,
       whose default layer is what plays there when nothing more specific
       matches. localised/personalised targeted versions remain optional
       upsells on top of it. */
    const hasDefault = b.default !== undefined && b.default !== null
    if (!hasDefault) invalid.push({ field: 'default', reason: 'Required.' })
    else if (!PRICING_TYPES.includes(b.default!.pricingType as PricingType)) invalid.push({ field: 'default.pricingType', reason: `One of ${PRICING_TYPES.join(', ')}.` })
    const brief = validateBrief(b.brief)
    invalid.push(...brief.errors)
    const targeted = b.targeted ?? []
    if (!Array.isArray(targeted)) invalid.push({ field: 'targeted', reason: 'Must be a list.' })
    else if (targeted.length > lim.targetedVersions) throw validationFailed([...invalid, { field: 'targeted', reason: `At most ${lim.targetedVersions} targeted versions.` }])
    const ids = new Set<string>()
    const notPermitted = new Map<string, { variable?: string; reason: string }>()
    const ruleErrors: Detail[] = []
    const access = ctx.company.variableAccess()
    if (Array.isArray(targeted)) {
      targeted.forEach((t, i) => {
        const f = (k: string) => `targeted[${i}].${k}`
        if (typeof t?.id !== 'string' || !t.id.trim() || t.id === 'default') invalid.push({ field: f('id'), reason: 'A version id other than "default".' })
        else if (ids.has(t.id)) invalid.push({ field: f('id'), reason: 'Version ids must be unique.' })
        else ids.add(t.id)
        if (!Number.isInteger(t?.priority)) invalid.push({ field: f('priority'), reason: 'An integer.' })
        if (!PRICING_TYPES.includes(t?.pricingType as PricingType)) invalid.push({ field: f('pricingType'), reason: `One of ${PRICING_TYPES.join(', ')}.` })
        if (typeof t?.id === 'string' && t.id.length > lim.nameLength) invalid.push({ field: f('id'), reason: `At most ${lim.nameLength} characters.` })
        const r = validateRules(t?.rules, f('rules'), req.partner, access, ctx.config.maxValuesPerCondition, lim)
        ruleErrors.push(...(r.invalid as Detail[]))
        r.notPermitted.forEach((d) => notPermitted.set(d.variable as string, d))
      })
    }
    throwIfRejected({ invalid: ruleErrors, notPermitted: [...notPermitted.values()] }, invalid)

    const targeting: StoredTargeting = {
      default: { pricingType: b.default!.pricingType as PricingType },
      ...(targeted.length ? { targeted: targeted.map((t) => ({ id: t.id as string, priority: t.priority as number, pricingType: t.pricingType as PricingType, rules: t.rules as Rules })) } : {}),
    }
    /* Enforcement (checkFloor/checkTargeting) reads one pricingType for the
       whole campaign, taken from the mandatory default layer. */
    const pricingType = b.default!.pricingType as PricingType
    const c = ctx.campaigns.createCampaign({
      id: `c_${randomUUID().slice(0, 12)}`, name: (b.name as string).trim(), targeting, source: 'api',
      advertiserId: b.advertiserId as string, partnerId: req.partner.id, displayTypeId: (b.displayTypeId as string | undefined) ?? null,
      pricingType,
      ...(brief.brief ? { brief: brief.brief } : {}),
    })
    return reply.status(201).send(statusView(await ctx.approvals.view(c.campaignId)))
  })

  /* Uploads in flight per partner. Each is buffered (up to the asset size
     limit) while its checks run, so without a cap one partner opening many
     uploads at once could exhaust the server's memory. */
  const uploading = new Map<string, number>()
  app.post<{ Params: { id: string } }>('/campaigns/:id/assets', async (req, reply) => {
    /* Ownership first: another partner's campaign is 404 whatever state the caller is in. */
    const c = own(req.partner, req.params.id)
    requireConnected(req.partner)
    const inFlight = uploading.get(req.partner.id) ?? 0
    if (inFlight >= ctx.config.maxConcurrentUploadsPerPartner) {
      reply.header('Retry-After', '1')
      throw new HttpError(429, 'rate_limited', `At most ${ctx.config.maxConcurrentUploadsPerPartner} uploads at once; wait for one to finish.`)
    }
    uploading.set(req.partner.id, inFlight + 1)
    try {
      return await upload(req, reply, c)
    } finally {
      const n = (uploading.get(req.partner.id) ?? 1) - 1
      if (n > 0) uploading.set(req.partner.id, n)
      else uploading.delete(req.partner.id)
    }
  })
  const upload = async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply, c: ReturnType<typeof own>) => {
    if (!req.isMultipart()) throw validationFailed([{ field: 'file', reason: 'Send multipart/form-data with version and file.' }])
    const limit = Math.max(ctx.config.assetLimits.maxImageBytes, ctx.config.assetLimits.maxVideoBytes)
    let version: string | undefined
    let bytes: Buffer | undefined
    let truncated = false
    for await (const part of req.parts({ limits: { fileSize: limit + 1, files: 1 } })) {
      if (part.type === 'file') {
        bytes = await part.toBuffer().catch(() => {
          truncated = true
          return Buffer.alloc(0)
        })
        truncated ||= part.file.truncated
      } else if (part.fieldname === 'version') version = String(part.value)
    }
    const targeting = targetingOf(c.targeting)
    const roles = [...(targeting.default ? ['default'] : []), ...(targeting.targeted ?? []).map((t) => t.id)]
    const invalid: Detail[] = []
    if (!version || !roles.includes(version)) invalid.push({ field: 'version', reason: `One of ${roles.join(', ')}.` })
    if (!bytes && !truncated) invalid.push({ field: 'file', reason: 'Required.' })
    if (invalid.length) throw validationFailed(invalid)

    const dt = c.displayTypeId ? ctx.displayTypes.get(c.displayTypeId) : null
    const media = truncated ? null : readMedia(bytes as Buffer)
    const checks: Check[] = truncated
      ? [{ name: 'file_size', passed: false, detail: `The file is over the ${Math.round(limit / 1024 / 1024)} MB limit.` }]
      : fileChecks(media, (bytes as Buffer).length, dt ?? null, ctx.config.assetLimits, version)
    if (failed(checks).length) throw new HttpError(422, 'checks_failed', 'The file failed the automated checks.', failureDetails(checks))

    const m = media!
    const file = ctx.assets.put(bytes as Buffer, EXTENSION[m.kind])
    const asset = ctx.campaigns.addAsset({
      id: `as_${randomUUID().slice(0, 12)}`, campaignId: c.campaignId, role: version as string, file, mimeType: m.mimeType,
      width: m.width, height: m.height, durationSec: m.durationSec,
      bitrateKbps: isVideo(m.kind) && m.durationSec ? Math.round(((bytes as Buffer).length * 8) / 1000 / m.durationSec) : null,
      sizeBytes: (bytes as Buffer).length,
    })
    /* A new creative on a submitted campaign needs a fresh decision (spec §3). */
    await ctx.approvals.changed(c.campaignId, req.partner.name).catch((e) => {
      throw approvalError(e)
    })
    return reply.status(201).send({ assetId: asset.id, checks })
  }

  app.post<{ Params: { id: string } }>('/campaigns/:id/submit', async (req) => {
    const c = own(req.partner, req.params.id)
    requireConnected(req.partner)
    const current = await ctx.approvals.view(c.campaignId)
    if (current.status === 'awaiting_approval' || current.status === 'approved') throw conflict(`The campaign is already ${current.status === 'approved' ? 'approved' : 'awaiting approval'}.`)
    if (current.status === 'rejected') throw conflict('The campaign was rejected. Upload a new version before submitting again.')

    const targeting = targetingOf(c.targeting)
    const assets = ctx.campaigns.latestAssets(c.campaignId)
    /* default is mandatory (decision, 22 Sep — see the /campaigns validation
       above), so submitting always needs its own creative: there is no
       fallback-free path any more where a targeted version's creative could
       stand in for it. */
    const def = assets.find((a) => a.role === 'default')
    const dt = c.displayTypeId ? ctx.displayTypes.get(c.displayTypeId) : null
    /* The file checks of the default layer's current file, recorded for the reviewer. */
    const file = def ? fileChecks(readMedia(ctx.assets.read(def.file) ?? Buffer.alloc(0)), def.sizeBytes, dt ?? null, ctx.config.assetLimits, 'default') : []
    const access = ctx.company.variableAccess()
    const refused = (targeting.targeted ?? []).flatMap((t, i) => validateRules(t.rules, `targeted[${i}].rules`, req.partner, access, ctx.config.maxValuesPerCondition).notPermitted)
    const checks: Check[] = [
      ...file,
      { name: 'default_present', passed: !!def, detail: def ? undefined : 'Upload a creative for the default campaign.' },
      { name: 'targeting_permitted', passed: !refused.length, detail: refused.length ? `Not enabled for ${req.partner.name}: ${[...new Set(refused.map((d) => d.variable))].join(', ')}.` : undefined },
    ]
    if (failed(checks).length) throw new HttpError(422, 'checks_failed', 'The campaign failed the automated checks.', failureDetails(checks))
    try {
      return statusView(await ctx.approvals.submit(c.campaignId, checks, req.partner.name))
    } catch (e) {
      throw approvalError(e)
    }
  })

  app.get<{ Params: { id: string } }>('/campaigns/:id/status', async (req) => {
    const c = own(req.partner, req.params.id)
    return statusView(await ctx.approvals.view(c.campaignId))
  })
}
