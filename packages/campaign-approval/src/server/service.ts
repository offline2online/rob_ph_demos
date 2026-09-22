/* Approval service: the state machine applied to campaigns through the
   CampaignSource adapter, with every decision recorded (who, when, reason,
   asset version) in the append-only audit log. */
import type { CampaignRef, CampaignSource } from '../adapter/CampaignSource'
import type { SqlDb } from '../db'
import { STATUSES, type Approval, type ApprovalStatus, type AssetRejection, type Check, type StatusCounts } from '../types'
import { type ApprovalRow, approvalStore } from './approvalStore'
import { type ApprovalEvent, TransitionError, transition } from './stateMachine'

export class ApprovalError extends Error {
  constructor(readonly status: number, readonly code: 'not_found' | 'conflict' | 'validation_failed' | 'not_approved', message: string) {
    super(message)
  }
}

export interface ApprovalServiceOptions {
  db: SqlDb
  campaigns: CampaignSource
  /* The advertiser's Campaign approval setting (Advertisers screen). */
  requiresApproval: (advertiserId: string | null) => boolean
  /* Q38: does the previously approved version keep running during re-review? Default: no. */
  oldVersionRunsDuringReview?: boolean
  now?: () => Date
}

export function createApprovalService(o: ApprovalServiceOptions) {
  const store = approvalStore(o.db)
  const now = () => (o.now?.() ?? new Date()).toISOString()

  const campaign = async (id: string) => {
    const c = await o.campaigns.getCampaign(id)
    if (!c) throw new ApprovalError(404, 'not_found', 'Campaign not found.')
    return c
  }
  /* The current version's row; no row yet means Draft. */
  const currentRow = (c: CampaignRef) => store.get(c.campaignId, c.assetVersion)
  const statusOf = (c: CampaignRef): ApprovalStatus => currentRow(c)?.status ?? 'draft'

  const toView = (c: CampaignRef, full: boolean): Approval => {
    const r = currentRow(c)
    return {
      campaignId: c.campaignId, campaignName: c.name, ...(c.advertiserName ? { advertiserName: c.advertiserName } : {}), ...(c.partnerName ? { partnerName: c.partnerName } : {}),
      status: r?.status ?? 'draft', mode: r?.mode ?? null, assetVersion: c.assetVersion,
      submittedAt: r?.submittedAt ?? null, reviewedBy: r?.reviewedBy ?? null, reviewedAt: r?.reviewedAt ?? null, reason: r?.reason ?? null,
      ...(r?.assetReasons?.length ? { assetReasons: r.assetReasons } : {}),
      checks: r?.checks ?? [],
      ...(full ? { targetingSummary: c.targetingSummary, creative: c.creative, canvas: c.canvas, audit: store.auditTrail(c.campaignId) } : {}),
    }
  }

  const apply = (c: CampaignRef, e: ApprovalEvent, actor: string | null, patch: Partial<ApprovalRow> = {}) => {
    const from = statusOf(c)
    let t
    try {
      t = transition(from, e)
    } catch (err) {
      if (err instanceof TransitionError) throw new ApprovalError(e.type === 'reject' && from === 'awaiting_approval' ? 400 : 409, e.type === 'reject' && from === 'awaiting_approval' ? 'validation_failed' : 'conflict', err.message)
      throw err
    }
    const at = now()
    const prev = currentRow(c)
    const reviewed = e.type === 'approve' || e.type === 'reject' || t.mode === 'auto'
    store.upsert({
      campaignId: c.campaignId, assetVersion: c.assetVersion, status: t.status, mode: t.mode,
      submittedAt: e.type === 'submit' || e.type === 'change' ? at : prev?.submittedAt ?? null,
      reviewedBy: reviewed ? (t.mode === 'auto' ? null : actor) : null, reviewedAt: reviewed ? at : null,
      reason: e.type === 'reject' ? e.reason.trim() : null,
      assetReasons: e.type === 'reject' ? (e.assetReasons ?? []) : [],
      checks: patch.checks ?? prev?.checks ?? [],
    }, at)
    const auditReason = e.type === 'reject' ? e.reason.trim() : e.type === 'unreject' && e.reason?.trim() ? e.reason.trim() : null
    const auditAssetReasons = e.type === 'reject' ? e.assetReasons : undefined
    for (const action of t.audit) store.audit(c.campaignId, c.assetVersion, action, action === 'auto_approved' ? null : actor, auditReason, at, auditAssetReasons)
    return t
  }

  const isEligible = async (id: string) => {
    const c = await o.campaigns.getCampaign(id)
    if (!c) return false
    if (c.source === 'hq') return true
    if (statusOf(c) === 'approved') return true
    return !!o.oldVersionRunsDuringReview && statusOf(c) === 'awaiting_approval' && store.anyApproved(id)
  }

  return {
    /* The one enforcement hook: call it wherever eligibility is decided
       (reservation, bidding, hand-off, activation). */
    isCampaignEligible: isEligible,

    /* One campaign's approval status, for a host screen that only needs the word. */
    async statusOf(id: string): Promise<ApprovalStatus> {
      const c = await o.campaigns.getCampaign(id)
      return c ? statusOf(c) : 'draft'
    },

    async view(id: string) {
      return toView(await campaign(id), true)
    },

    async list(q: { status?: ApprovalStatus; cursor?: string; limit?: number } = {}) {
      const all = (await o.campaigns.listCampaigns({ sources: ['api', 'dsp'] })).map((c) => toView(c, false))
      const counts = Object.fromEntries(STATUSES.map((s) => [s, all.filter((a) => a.status === s).length])) as unknown as StatusCounts
      const filtered = q.status ? all.filter((a) => a.status === q.status) : all
      const start = Number(q.cursor) || 0
      const limit = Math.min(Math.max(q.limit ?? 50, 1), 200)
      const items = filtered.slice(start, start + limit)
      return { counts, items, nextCursor: start + limit < filtered.length ? String(start + limit) : null }
    },

    /* Submission (package 12): Awaiting approval, or Approved automatically. */
    async submit(id: string, checks: Check[], actor: string | null) {
      const c = await campaign(id)
      apply(c, { type: 'submit', requiresApproval: o.requiresApproval(c.advertiserId) }, actor, { checks })
      return toView(c, false)
    },

    async approve(id: string, assetVersion: string, reviewer: string) {
      const c = await campaign(id)
      if (assetVersion !== c.assetVersion) throw new ApprovalError(409, 'conflict', 'The creative changed after you opened it. Review the new version.')
      apply(c, { type: 'approve' }, reviewer)
      /* Safe reuse (spec §3): a genuine human decision clears this exact
         content, so a later, unchanged resubmission can skip re-review.
         Only the mandatory default layer is modelled as `creative` today
         (CampaignRef); a targeted version's asset joins this the same way
         once the adapter exposes it as its own asset id. */
      if (c.creative?.contentHash) store.recordHumanClearance(c.campaignId, 'default', c.creative.contentHash, reviewer, now())
      return toView(c, true)
    },

    async reject(id: string, assetVersion: string, reviewer: string, reason: string, assetReasons?: AssetRejection[]) {
      if (!reason?.trim()) throw new ApprovalError(400, 'validation_failed', 'A reason is required.')
      const c = await campaign(id)
      if (assetVersion !== c.assetVersion) throw new ApprovalError(409, 'conflict', 'The creative changed after you opened it. Review the new version.')
      apply(c, { type: 'reject', reason, assetReasons }, reviewer)
      return toView(c, true)
    },

    /* Whether `assetId` can skip re-review on resubmission: unchanged
       (same contentHash) AND its most recent clearance was by a human —
       never true from automated checks alone. */
    wasAssetHumanCleared(campaignId: string, assetId: string, contentHash: string): boolean {
      return store.isHumanCleared(campaignId, assetId, contentHash)
    },

    /* Undo a mistaken rejection: back to Awaiting approval for a fresh
       decision, never auto-approved. Same permission as approve/reject
       (Q39). The prior rejection reason stays in the audit trail. */
    async unreject(id: string, assetVersion: string, reviewer: string, reason?: string) {
      const c = await campaign(id)
      if (assetVersion !== c.assetVersion) throw new ApprovalError(409, 'conflict', 'The creative changed after you opened it. Review the new version.')
      apply(c, { type: 'unreject', reason }, reviewer)
      return toView(c, true)
    },

    /* The host calls this when a campaign's assets or targeting change. For
       an advertiser that requires approval it returns to Awaiting approval;
       by default (Q38) the campaign also stops until the new version is approved. */
    async changed(id: string, actor: string | null, checks?: Check[]) {
      const c = await campaign(id)
      const latest = store.latest(id)
      const decided = latest && (latest.status === 'approved' || latest.status === 'awaiting_approval')
      if (!decided) return toView(c, false)
      const from = statusOf(c)
      if (from === 'draft') {
        /* A new asset version: carry the decision trail over to it. */
        store.upsert({ ...latest!, assetVersion: c.assetVersion }, now())
      }
      const t = apply(c, { type: 'change', requiresApproval: o.requiresApproval(c.advertiserId) }, actor, checks ? { checks } : {})
      if (t.status !== 'approved' && !o.oldVersionRunsDuringReview && c.activation.enabled) await o.campaigns.setActivation(id, false)
      return toView(c, false)
    },

    /* The existing activation toggle: only an approved campaign can be activated. */
    async setActivation(id: string, enabled: boolean) {
      await campaign(id)
      if (enabled && !(await isEligible(id))) throw new ApprovalError(422, 'not_approved', 'Only an approved campaign can be activated.')
      return o.campaigns.setActivation(id, enabled)
    },
  }
}

export type ApprovalService = ReturnType<typeof createApprovalService>
