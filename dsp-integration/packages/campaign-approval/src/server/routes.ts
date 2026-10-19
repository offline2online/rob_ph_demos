/* Approval API (contract: Admin — Campaign approval). Mount it under the
   host's admin prefix; the host supplies auth (approver scope), the feature
   flag and the reviewer's identity. */
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { REJECTION_CODES, STATUSES, isRejectionCode, type ApprovalStatus, type AssetRejection, type RejectionCode } from '../types'
import { ApprovalError, type ApprovalService } from './service'

export interface ApprovalRouteHooks {
  /* Throw (or reply) to refuse: flag off, no session. */
  guard: (req: FastifyRequest) => void
  /* Throw unless the session may approve/reject (HQ Admin role by default, Q39). */
  requireApprover: (req: FastifyRequest) => void
  reviewer: (req: FastifyRequest) => string
}

const send = (reply: FastifyReply, e: unknown) => {
  if (e instanceof ApprovalError) return reply.status(e.status).send({ error: { code: e.code, message: e.message } })
  throw e
}

export const approvalRoutes = (service: ApprovalService, hooks: ApprovalRouteHooks): FastifyPluginAsync => async (app) => {
  app.get<{ Querystring: { status?: string; cursor?: string; limit?: string } }>('/approvals', async (req, reply) => {
    hooks.guard(req)
    const { status, cursor, limit } = req.query
    if (status && !STATUSES.includes(status as ApprovalStatus)) return reply.status(400).send({ error: { code: 'validation_failed', message: 'Unknown status.', details: [{ field: 'status', reason: `Must be one of: ${STATUSES.join(', ')}.` }] } })
    if (limit !== undefined && !(Number(limit) >= 1 && Number(limit) <= 200)) return reply.status(400).send({ error: { code: 'validation_failed', message: 'limit must be 1–200.' } })
    return service.list({ status: status as ApprovalStatus | undefined, cursor, limit: limit ? Number(limit) : undefined })
  })

  /* The queue's health for the approver's page: median time to decide, the
     oldest campaign waiting, the rejection rate and the top rejection reasons. */
  app.get<{ Querystring: { days?: string } }>('/approvals/summary', async (req, reply) => {
    hooks.guard(req)
    const { days } = req.query
    if (days !== undefined && !(Number.isInteger(Number(days)) && Number(days) >= 1 && Number(days) <= 365)) return reply.status(400).send({ error: { code: 'validation_failed', message: 'days must be a whole number of 1–365.', details: [{ field: 'days', reason: 'Must be 1–365.' }] } })
    return service.summary(days === undefined ? 30 : Number(days))
  })

  app.get<{ Params: { id: string } }>('/campaigns/:id/approval', async (req, reply) => {
    hooks.guard(req)
    try { return await service.view(req.params.id) } catch (e) { return send(reply, e) }
  })

  app.post<{ Params: { id: string }; Body: { assetVersion?: string } }>('/campaigns/:id/approve', async (req, reply) => {
    hooks.guard(req)
    hooks.requireApprover(req)
    try { return await service.approve(req.params.id, req.body?.assetVersion ?? '', hooks.reviewer(req)) } catch (e) { return send(reply, e) }
  })

  /* Approve campaigns one at a time and group them under a creative ID: a new
     one (creativeId omitted) or an existing one. All or nothing. */
  app.post<{ Body: { items?: { campaignId?: string; assetVersion?: string }[]; creativeId?: string | null } }>('/approvals/approve-assign', async (req, reply) => {
    hooks.guard(req)
    hooks.requireApprover(req)
    const items = req.body?.items
    const bad = !Array.isArray(items) || !items.length || items.length > 100 || items.some((i) => typeof i?.campaignId !== 'string' || typeof i?.assetVersion !== 'string')
    if (bad || (req.body?.creativeId != null && typeof req.body.creativeId !== 'string')) {
      return reply.status(400).send({ error: { code: 'validation_failed', message: 'Send 1–100 items, each with a campaignId and the assetVersion reviewed.', details: [{ field: 'items', reason: 'Required.' }] } })
    }
    try {
      return await service.approveAndAssign(items!.map((i) => ({ campaignId: i.campaignId!, assetVersion: i.assetVersion! })), req.body.creativeId ?? null, hooks.reviewer(req))
    } catch (e) { return send(reply, e) }
  })

  /* Group already-approved campaigns of an auto-approved advertiser under a
     creative ID: a new one (creativeId omitted) or an existing one. */
  app.post<{ Body: { campaignIds?: string[]; creativeId?: string | null } }>('/approvals/assign-creative-id', async (req, reply) => {
    hooks.guard(req)
    hooks.requireApprover(req)
    const ids = req.body?.campaignIds
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some((i) => typeof i !== 'string') || (req.body?.creativeId != null && typeof req.body.creativeId !== 'string')) {
      return reply.status(400).send({ error: { code: 'validation_failed', message: 'Send 1–100 campaignIds.', details: [{ field: 'campaignIds', reason: 'Required.' }] } })
    }
    try { return await service.assignCreativeId(ids, req.body.creativeId ?? null, hooks.reviewer(req)) } catch (e) { return send(reply, e) }
  })

  app.post<{ Params: { id: string }; Body: { assetVersion?: string; reason?: string; reasonCode?: string; assetReasons?: AssetRejection[] } }>('/campaigns/:id/reject', async (req, reply) => {
    hooks.guard(req)
    hooks.requireApprover(req)
    if (!req.body?.reason?.trim()) return reply.status(400).send({ error: { code: 'validation_failed', message: 'A reason is required.', details: [{ field: 'reason', reason: 'Required.' }] } })
    /* A rejection is coded from the fixed pick-list as well as explained: free text alone can't be counted. */
    const codes = REJECTION_CODES.map((r) => r.code).join(', ')
    if (!isRejectionCode(req.body.reasonCode)) return reply.status(400).send({ error: { code: 'validation_failed', message: 'Choose a rejection reason.', details: [{ field: 'reasonCode', reason: `Must be one of: ${codes}.` }] } })
    const badAsset = req.body.assetReasons?.findIndex((a) => a.code !== undefined && !isRejectionCode(a.code)) ?? -1
    if (badAsset >= 0) return reply.status(400).send({ error: { code: 'validation_failed', message: 'Unknown rejection reason.', details: [{ field: `assetReasons/${badAsset}/code`, reason: `Must be one of: ${codes}.` }] } })
    try { return await service.reject(req.params.id, req.body?.assetVersion ?? '', hooks.reviewer(req), req.body.reason, req.body.assetReasons, req.body.reasonCode as RejectionCode) } catch (e) { return send(reply, e) }
  })

  /* Undo a mistaken rejection: Rejected → Awaiting approval. Same permission
     as approve/reject (Q39); a reason is optional, unlike reject's. */
  app.post<{ Params: { id: string }; Body: { assetVersion?: string; reason?: string } }>('/campaigns/:id/unreject', async (req, reply) => {
    hooks.guard(req)
    hooks.requireApprover(req)
    try { return await service.unreject(req.params.id, req.body?.assetVersion ?? '', hooks.reviewer(req), req.body?.reason) } catch (e) { return send(reply, e) }
  })
}
