/* The approval module's server side, as the host imports it: the service
   (decisions, the state machine, the store), its Fastify routes, and where
   its migrations live. The host passes in its campaign source adapter
   (adapter/CampaignSource.ts) and its transaction hooks; nothing here
   imports from the host. See docs/dsp-integration/CAMPAIGN-APPROVAL-INTEGRATION.md. */
export { createApprovalService, ApprovalError, type ApprovalService, type ApprovalServiceOptions } from './service'
export { approvalRoutes, type ApprovalRouteHooks } from './routes'
export { transition, TransitionError, type ApprovalEvent } from './stateMachine'
export * from '../types'
import { fileURLToPath } from 'node:url'
/* The module's migrations (numbered 0100+), for the host's migrator. */
export const APPROVAL_MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url))
