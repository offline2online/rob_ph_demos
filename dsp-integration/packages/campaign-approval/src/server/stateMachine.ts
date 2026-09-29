/* Approval state machine (spec §3):
     Draft → Awaiting approval → Approved | Rejected
     Rejected → Awaiting approval (un-reject: a mistaken rejection, undone)
     asset or targeting change on an approved campaign → Awaiting approval
       (a pending edit: the approved version keeps running meanwhile, Q38 —
       the service, not this machine, decides what runs)
     auto-approve when the advertiser doesn't require approval
     approve without review when every asset was already human-cleared at
       the same content hash (safe reuse, spec §3, Q40). */
import type { ApprovalMode, ApprovalStatus, AssetRejection, AuditAction } from '../types'

export type ApprovalEvent =
  | { type: 'submit'; requiresApproval: boolean; preCleared?: boolean }
  | { type: 'approve' }
  | { type: 'reject'; reason: string; assetReasons?: AssetRejection[] }
  | { type: 'unreject'; reason?: string }
  | { type: 'change'; requiresApproval: boolean; preCleared?: boolean }

export interface Transition { status: ApprovalStatus; mode: ApprovalMode | null; audit: AuditAction[] }

export class TransitionError extends Error {}

export function transition(from: ApprovalStatus, e: ApprovalEvent): Transition {
  switch (e.type) {
    case 'submit':
      if (from !== 'draft' && from !== 'rejected') throw new TransitionError(`A campaign that is ${from.replace('_', ' ')} can't be submitted.`)
      if (e.requiresApproval && e.preCleared) return { status: 'approved', mode: 'auto', audit: ['submitted', 'reused_clearance'] }
      return e.requiresApproval
        ? { status: 'awaiting_approval', mode: 'manual', audit: ['submitted'] }
        : { status: 'approved', mode: 'auto', audit: ['submitted', 'auto_approved'] }
    case 'approve':
      if (from !== 'awaiting_approval') throw new TransitionError('Only a campaign awaiting approval can be approved.')
      return { status: 'approved', mode: 'manual', audit: ['approved'] }
    case 'reject':
      if (from !== 'awaiting_approval') throw new TransitionError('Only a campaign awaiting approval can be rejected.')
      if (!e.reason.trim()) throw new TransitionError('A reason is required.')
      return { status: 'rejected', mode: 'manual', audit: ['rejected'] }
    case 'unreject':
      /* Reverses a mistaken rejection back to Awaiting approval for a fresh
         decision. Never auto-approves, even for an advertiser who doesn't
         require approval — it undoes the rejection, it isn't a new
         submission. */
      if (from !== 'rejected') throw new TransitionError('Only a rejected campaign can be un-rejected.')
      return { status: 'awaiting_approval', mode: 'manual', audit: ['unrejected'] }
    case 'change':
      /* A change to an approved campaign's assets or targeting needs a fresh decision. */
      if (from === 'approved' || from === 'awaiting_approval') {
        if (e.requiresApproval && e.preCleared) return { status: 'approved', mode: 'auto', audit: ['returned_for_review', 'reused_clearance'] }
        return e.requiresApproval
          ? { status: 'awaiting_approval', mode: 'manual', audit: ['returned_for_review'] }
          : { status: 'approved', mode: 'auto', audit: ['returned_for_review', 'auto_approved'] }
      }
      return { status: from, mode: null, audit: [] }
  }
}
