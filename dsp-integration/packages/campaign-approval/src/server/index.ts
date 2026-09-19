export { createApprovalService, ApprovalError, type ApprovalService, type ApprovalServiceOptions } from './service'
export { approvalRoutes, type ApprovalRouteHooks } from './routes'
export { transition, TransitionError, type ApprovalEvent } from './stateMachine'
export * from '../types'
import { fileURLToPath } from 'node:url'
/* The module's migrations (numbered 0100+), for the host's migrator. */
export const APPROVAL_MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url))
