/* Approval API (contract: Admin — Campaign approval). Mount it under the
   host's admin prefix; the host supplies auth (approver scope), the feature
   flag and the reviewer's identity. */
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { STATUSES, type ApprovalStatus, type AssetRejection } from '../types'
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

  app.get<{ Params: { id: string } }>('/campaigns/:id/approval', async (req, reply) => {
    hooks.guard(req)
    try { return await service.view(req.params.id) } catch (e) { return send(reply, e) }
  })

  app.post<{ Params: { id: string }; Body: { assetVersion?: string } }>('/campaigns/:id/approve', async (req, reply) => {
    hooks.guard(req)
    hooks.requireApprover(req)
    try { return await service.approve(req.params.id, req.body?.assetVersion ?? '', hooks.reviewer(req)) } catch (e) { return send(reply, e) }
  })

  app.post<{ Params: { id: string }; Body: { assetVersion?: string; reason?: string; assetReasons?: AssetRejection[] } }>('/campaigns/:id/reject', async (req, reply) => {
    hooks.guard(req)
    hooks.requireApprover(req)
    if (!req.body?.reason?.trim()) return reply.status(400).send({ error: { code: 'validation_failed', message: 'A reason is required.', details: [{ field: 'reason', reason: 'Required.' }] } })
    try { return await service.reject(req.params.id, req.body?.assetVersion ?? '', hooks.reviewer(req), req.body.reason, req.body.assetReasons) } catch (e) { return send(reply, e) }
  })

  /* Undo a mistaken rejection: Rejected → Awaiting approval. Same permission
     as approve/reject (Q39); a reason is optional, unlike reject's. */
  app.post<{ Params: { id: string }; Body: { assetVersion?: string; reason?: string } }>('/campaigns/:id/unreject', async (req, reply) => {
    hooks.guard(req)
    hooks.requireApprover(req)
    try { return await service.unreject(req.params.id, req.body?.assetVersion ?? '', hooks.reviewer(req), req.body?.reason) } catch (e) { return send(reply, e) }
  })
}
