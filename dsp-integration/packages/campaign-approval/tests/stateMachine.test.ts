import { describe, expect, it } from 'vitest'
import { TransitionError, transition } from '../src/server/stateMachine'

describe('approval state machine (spec §3)', () => {
  it('submit: Draft or Rejected → Awaiting approval, or Approved automatically', () => {
    expect(transition('draft', { type: 'submit', requiresApproval: true })).toEqual({ status: 'awaiting_approval', mode: 'manual', audit: ['submitted'] })
    expect(transition('rejected', { type: 'submit', requiresApproval: true }).status).toBe('awaiting_approval')
    expect(transition('draft', { type: 'submit', requiresApproval: false })).toEqual({ status: 'approved', mode: 'auto', audit: ['submitted', 'auto_approved'] })
    expect(() => transition('approved', { type: 'submit', requiresApproval: true })).toThrow(TransitionError)
  })
  it('approve and reject only from Awaiting approval; reject needs a reason', () => {
    expect(transition('awaiting_approval', { type: 'approve' }).status).toBe('approved')
    expect(transition('awaiting_approval', { type: 'reject', reason: 'Price in artwork' }).status).toBe('rejected')
    expect(() => transition('awaiting_approval', { type: 'reject', reason: '  ' })).toThrow(/reason/)
    expect(() => transition('draft', { type: 'approve' })).toThrow(TransitionError)
    expect(() => transition('rejected', { type: 'approve' })).toThrow(TransitionError)
  })
  it('a change to an approved campaign returns it to Awaiting approval (or re-approves automatically)', () => {
    expect(transition('approved', { type: 'change', requiresApproval: true })).toEqual({ status: 'awaiting_approval', mode: 'manual', audit: ['returned_for_review'] })
    expect(transition('approved', { type: 'change', requiresApproval: false })).toEqual({ status: 'approved', mode: 'auto', audit: ['returned_for_review', 'auto_approved'] })
    expect(transition('draft', { type: 'change', requiresApproval: true })).toEqual({ status: 'draft', mode: null, audit: [] })
  })
})
