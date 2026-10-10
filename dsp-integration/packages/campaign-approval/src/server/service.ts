/* Approval service: the state machine applied to campaigns through the
   CampaignSource adapter, with every decision recorded (who, when, reason,
   asset version) in the append-only audit log.

   Re-approval (Q38, Rob, 29 Sep 2026): approval rows are per asset version,
   so "the approved version" needs no snapshot of its own — it is the newest
   approved row (store.liveVersion), and the host resolves that version to
   its assets. An edit to a running campaign is a newer version Awaiting
   approval (a pending edit) while the live one keeps running. Approving
   the edit makes it the newest approved row: one write, so eligibility
   never lapses and the two versions never both run. Rejecting it discards
   it (the adapter drops its assets, the row goes, the audit stays) and the
   live version carries on untouched. */
import { createHash, randomBytes } from 'node:crypto'
import type { CampaignRef, CampaignSource } from '../adapter/CampaignSource'
import type { Awaitable, SqlDb } from '../db'
import { STATUSES, type Approval, type ApprovalStatus, type AssetRejection, type Check, type CreativeIdView, type StatusCounts } from '../types'
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
  requiresApproval: (advertiserId: string | null) => Awaitable<boolean>
  now?: () => Date
  /* How the host runs a burst of this module's statements against its
     database (synchronous, all at once): at once by default. A host whose
     database is shared with transactions that await passes its own, which
     waits until the connection is free (apps/api db.ts onFree). */
  run?: <T>(fn: () => T) => Awaitable<T>
  /* How the host runs one decision — read the status, write the row and the
     audit — as a single transaction. Runs fn directly by default. */
  transaction?: <T>(fn: () => Promise<T>) => Promise<T>
}

/* The store with every method answering through `run` (each store method is
   one statement; on node:sqlite it answers at once, which is what lets
   `run` serialise it against the host's open transaction). */
type Store = ReturnType<typeof approvalStore>
type AsyncStore = { [K in keyof Store]: Store[K] extends (...a: infer A) => infer R ? (...a: A) => Awaitable<Awaited<R>> : Store[K] }
function runThrough(store: Store, run: <T>(fn: () => T) => Awaitable<T>): AsyncStore {
  return Object.fromEntries(Object.entries(store).map(([k, fn]) => [k, (...a: unknown[]) => run(() => (fn as (...x: unknown[]) => unknown)(...a))])) as unknown as AsyncStore
}

/* Safe reuse clears the targeting rules as well as the files (Q40): a
   pseudo-asset whose "content" is the rendered rules, so an edit that
   changes targeting but re-sends identical files is still reviewed. */
const TARGETING_ASSET = '#targeting'
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

export function createApprovalService(o: ApprovalServiceOptions) {
  const store = runThrough(approvalStore(o.db), o.run ?? ((fn) => fn()))
  const transaction = o.transaction ?? ((fn) => fn())
  const now = () => (o.now?.() ?? new Date()).toISOString()

  const campaign = async (id: string) => {
    const c = await o.campaigns.getCampaign(id)
    if (!c) throw new ApprovalError(404, 'not_found', 'Campaign not found.')
    return c
  }
  /* The current version's row; no row yet means Draft. */
  const currentRow = async (c: CampaignRef) => store.get(c.campaignId, c.assetVersion)
  const statusOf = async (c: CampaignRef): Promise<ApprovalStatus> => (await currentRow(c))?.status ?? 'draft'

  /* The latest rejected-and-discarded edit, until the next edit (Q38). */
  const rejectedEdit = (trail: Awaited<ReturnType<Store['auditTrail']>>) => {
    let out: Approval['rejectedEdit']
    for (const [i, a] of trail.entries()) {
      if (a.action === 'edit_discarded') out = { assetVersion: a.assetVersion, reason: trail.slice(0, i).reverse().find((x) => x.action === 'rejected' && x.assetVersion === a.assetVersion)?.reason ?? null, at: a.at }
      else if (a.action === 'returned_for_review' || a.action === 'submitted') out = undefined
    }
    return out
  }

  /* A campaign's deal set: the deal authored with it plus any added since
     (REQUIREMENTS.md §3 "Creative IDs"). A campaign authored with no deal has a
     direct arrangement, which it keeps if a deal is added later. */
  const dealsOf = async (c: CampaignRef) => [...new Set([...(c.dealId ? [c.dealId] : []), ...(await store.addedDeals(c.campaignId))])].sort()

  const toView = async (c: CampaignRef, full: boolean): Promise<Approval> => {
    const r = await currentRow(c)
    const live = await store.liveVersion(c.campaignId)
    const trail = full ? await store.auditTrail(c.campaignId) : null
    const discarded = trail ? rejectedEdit(trail) : undefined
    const creativeId = await store.creativeIdOf(c.campaignId)
    const dealIds = await dealsOf(c)
    return {
      campaignId: c.campaignId, campaignName: c.name, ...(c.advertiserName ? { advertiserName: c.advertiserName } : {}), ...(c.partnerName ? { partnerName: c.partnerName } : {}),
      status: r?.status ?? 'draft', mode: r?.mode ?? null, assetVersion: c.assetVersion,
      submittedAt: r?.submittedAt ?? null, reviewedBy: r?.reviewedBy ?? null, reviewedAt: r?.reviewedAt ?? null, reason: r?.reason ?? null,
      ...(r?.assetReasons?.length ? { assetReasons: r.assetReasons } : {}),
      checks: r?.checks ?? [],
      creativeId,
      dealId: dealIds[0] ?? null, dealIds, direct: !c.dealId,
      liveAssetVersion: live, pendingEdit: !!live && live !== c.assetVersion && r?.status === 'awaiting_approval',
      ...(discarded ? { rejectedEdit: discarded } : {}),
      ...(full ? { targetingSummary: c.targetingSummary, creative: c.creative, canvas: c.canvas, audit: trail! } : {}),
    }
  }

  const apply = async (c: CampaignRef, e: ApprovalEvent, actor: string | null, patch: Partial<ApprovalRow> = {}) => {
    const from = await statusOf(c)
    let t
    try {
      t = transition(from, e)
    } catch (err) {
      if (err instanceof TransitionError) throw new ApprovalError(e.type === 'reject' && from === 'awaiting_approval' ? 400 : 409, e.type === 'reject' && from === 'awaiting_approval' ? 'validation_failed' : 'conflict', err.message)
      throw err
    }
    const at = now()
    const prev = await currentRow(c)
    const reviewed = e.type === 'approve' || e.type === 'reject' || t.mode === 'auto'
    await store.upsert({
      campaignId: c.campaignId, assetVersion: c.assetVersion, status: t.status, mode: t.mode,
      submittedAt: e.type === 'submit' || e.type === 'change' ? at : prev?.submittedAt ?? null,
      reviewedBy: reviewed ? (t.mode === 'auto' ? null : actor) : null, reviewedAt: reviewed ? at : null,
      reason: e.type === 'reject' ? e.reason.trim() : null,
      assetReasons: e.type === 'reject' ? (e.assetReasons ?? []) : [],
      checks: patch.checks ?? prev?.checks ?? [],
    }, at)
    const auditReason = e.type === 'reject' ? e.reason.trim() : e.type === 'unreject' && e.reason?.trim() ? e.reason.trim() : null
    const auditAssetReasons = e.type === 'reject' ? e.assetReasons : undefined
    for (const action of t.audit) await store.audit(c.campaignId, c.assetVersion, action, action === 'auto_approved' || action === 'reused_clearance' ? null : actor, auditReason, at, auditAssetReasons)
    return t
  }

  /* A human approval of the version: the decision, and the clearance that lets
     an unchanged resubmission skip re-review. */
  const approveReviewed = async (c: CampaignRef, reviewer: string) => {
    await apply(c, { type: 'approve' }, reviewer)
    /* Safe reuse (spec §3): a genuine human decision clears this exact
       content — every asset of the version (or, from an adapter that
       lists none, the default creative) and its targeting rules — so a
       later, unchanged resubmission can skip re-review. */
    const at = now()
    const assets = c.assets ?? (c.creative?.contentHash ? [{ assetId: 'default', contentHash: c.creative.contentHash }] : [])
    for (const a of assets) if (a.contentHash) await store.recordHumanClearance(c.campaignId, a.assetId, a.contentHash, reviewer, at)
    await store.recordHumanClearance(c.campaignId, TARGETING_ASSET, sha256(c.targetingSummary), reviewer, at)
  }

  /* Q38: eligible while ANY version is approved — the live one keeps
     running through the review of a later edit. */
  const isEligible = async (id: string) => {
    const c = await o.campaigns.getCampaign(id)
    if (!c) return false
    if (c.source === 'hq') return true
    return (await store.liveVersion(id)) !== null
  }

  /* Safe reuse (spec §3, Q40): the assets of this version a human has
     already cleared at exactly this content, and whether that covers the
     whole version — every asset, and its targeting rules. An adapter that
     doesn't list assets or hashes never gets a reuse. */
  const clearedAssets = async (c: CampaignRef) => {
    const out = []
    for (const a of c.assets ?? []) if (a.contentHash && (await store.isHumanCleared(c.campaignId, a.assetId, a.contentHash))) out.push(a)
    return out
  }
  const preCleared = async (c: CampaignRef) => !!c.assets?.length && (await clearedAssets(c)).length === c.assets.length && !!(await store.isHumanCleared(c.campaignId, TARGETING_ASSET, sha256(c.targetingSummary)))
  /* Tells the reviewer which assets are unchanged since a human cleared them (advisory). */
  const withClearance = async (c: CampaignRef, checks: Check[]): Promise<Check[]> => [
    ...checks.filter((x) => x.name !== 'previously_cleared'),
    ...(await clearedAssets(c)).map((a): Check => ({ name: 'previously_cleared', passed: true, advisory: true, assetId: a.assetId, detail: 'Byte-identical to a version a reviewer already approved.' })),
  ]

  return {
    /* The one enforcement hook: call it wherever eligibility is decided
       (reservation, bidding, hand-off, activation). */
    isCampaignEligible: isEligible,

    /* Which version runs (Q38): the live approved assetVersion, for the host
       to resolve to assets at hand-off. null when nothing is approved, or
       for an HQ campaign, which doesn't go through approval. */
    async liveAssetVersion(id: string): Promise<string | null> {
      const c = await o.campaigns.getCampaign(id)
      return c && c.source !== 'hq' ? store.liveVersion(id) : null
    },

    /* One campaign's approval status, for a host screen that only needs the word. */
    async statusOf(id: string): Promise<ApprovalStatus> {
      const c = await o.campaigns.getCampaign(id)
      return c ? statusOf(c) : 'draft'
    },

    async view(id: string) {
      return toView(await campaign(id), true)
    },

    async list(q: { status?: ApprovalStatus; cursor?: string; limit?: number } = {}) {
      const all: Approval[] = []
      for (const c of await o.campaigns.listCampaigns({ sources: ['api', 'dsp'] })) all.push(await toView(c, false))
      const counts = Object.fromEntries(STATUSES.map((s) => [s, all.filter((a) => a.status === s).length])) as unknown as StatusCounts
      const filtered = q.status ? all.filter((a) => a.status === q.status) : all
      const start = Number(q.cursor) || 0
      const limit = Math.min(Math.max(q.limit ?? 50, 1), 200)
      const items = filtered.slice(start, start + limit)
      return { counts, items, nextCursor: start + limit < filtered.length ? String(start + limit) : null }
    },

    /* Submission (package 12): Awaiting approval, or Approved automatically —
       including when every asset was already human-cleared (Q40). */
    async submit(id: string, checks: Check[], actor: string | null) {
      return transaction(async () => {
        const c = await campaign(id)
        await apply(c, { type: 'submit', requiresApproval: await o.requiresApproval(c.advertiserId), preCleared: await preCleared(c) }, actor, { checks: await withClearance(c, checks) })
        return toView(c, false)
      })
    },

    async approve(id: string, assetVersion: string, reviewer: string) {
      return transaction(async () => {
      const c = await campaign(id)
      if (assetVersion !== c.assetVersion) throw new ApprovalError(409, 'conflict', 'The creative changed after you opened it. Review the new version.')
      await approveReviewed(c, reviewer)
      return toView(c, true)
      })
    },

    /* Approve campaigns one at a time AND group them under a creative ID
       (the grouping a DSP bids on). `creativeId` null mints a new ID across
       the campaigns; otherwise they join that existing ID. Everything is
       checked before anything is written, so a stale version or a mixed
       advertiser approves none of them. A creative ID spans one advertiser's
       campaigns only. A resubmitted campaign that still holds its original
       ID is moved only if the caller names a different one. */
    async approveAndAssign(items: { campaignId: string; assetVersion: string }[], creativeId: string | null, reviewer: string) {
      if (!items.length) throw new ApprovalError(400, 'validation_failed', 'Choose at least one campaign.')
      if (new Set(items.map((i) => i.campaignId)).size !== items.length) throw new ApprovalError(400, 'validation_failed', 'A campaign can only be listed once.')
      return transaction(async () => {
        const campaigns: CampaignRef[] = []
        for (const i of items) {
          const c = await campaign(i.campaignId)
          if (c.source === 'hq' || !c.advertiserId) throw new ApprovalError(400, 'validation_failed', `${c.name} is not an advertiser campaign, so it has no creative ID.`)
          if (i.assetVersion !== c.assetVersion) throw new ApprovalError(409, 'conflict', `The creative for ${c.name} changed after you opened it. Review the new version.`)
          if ((await statusOf(c)) !== 'awaiting_approval') throw new ApprovalError(409, 'conflict', `${c.name} is not awaiting approval.`)
          campaigns.push(c)
        }
        const advertiserId = campaigns[0].advertiserId!
        if (campaigns.some((c) => c.advertiserId !== advertiserId)) throw new ApprovalError(400, 'validation_failed', 'A creative ID spans only one advertiser’s campaigns. Choose campaigns from a single advertiser.')
        if (creativeId) {
          const existing = await store.creativeId(creativeId)
          if (!existing) throw new ApprovalError(404, 'not_found', 'That creative ID does not exist.')
          if (existing.advertiserId !== advertiserId) throw new ApprovalError(400, 'validation_failed', 'That creative ID belongs to a different advertiser.')
        }
        const at = now()
        let target = creativeId
        if (!target) {
          for (let tries = 0; !target; tries++) {
            const candidate = `CR-${randomBytes(4).toString('hex').toUpperCase()}`
            if (!(await store.creativeId(candidate))) target = candidate
            else if (tries > 8) throw new Error('Could not mint a unique creative ID.')
          }
          await store.createCreativeId(target, advertiserId, reviewer, at)
        }
        for (const c of campaigns) {
          await approveReviewed(c, reviewer)
          await store.assignCreativeId(c.campaignId, target, reviewer, at)
        }
        const approvals: Approval[] = []
        for (const c of campaigns) approvals.push(await toView(c, false))
        return { creativeId: target, approvals }
      })
    },

    /* Group already-approved campaigns under a creative ID, for an advertiser
       who does not require approval: submission was the approval, so there is
       no reviewer step to assign the ID and the advertiser does it from their
       own campaign table. `creativeId` null mints a new one across the
       campaigns; otherwise they join that existing ID. All or nothing; a
       creative ID spans one advertiser's campaigns only. */
    async assignCreativeId(campaignIds: string[], creativeId: string | null, actor: string) {
      if (!campaignIds.length) throw new ApprovalError(400, 'validation_failed', 'Choose at least one campaign.')
      if (new Set(campaignIds).size !== campaignIds.length) throw new ApprovalError(400, 'validation_failed', 'A campaign can only be listed once.')
      return transaction(async () => {
        const campaigns: CampaignRef[] = []
        for (const id of campaignIds) {
          const c = await campaign(id)
          if (c.source === 'hq' || !c.advertiserId) throw new ApprovalError(400, 'validation_failed', `${c.name} is not an advertiser campaign, so it has no creative ID.`)
          if (await o.requiresApproval(c.advertiserId)) throw new ApprovalError(400, 'validation_failed', `${c.name} is approved by the retailer, which assigns its creative ID.`)
          if ((await statusOf(c)) !== 'approved') throw new ApprovalError(409, 'conflict', `${c.name} is not approved.`)
          campaigns.push(c)
        }
        const advertiserId = campaigns[0].advertiserId!
        if (campaigns.some((c) => c.advertiserId !== advertiserId)) throw new ApprovalError(400, 'validation_failed', 'A creative ID spans only one advertiser’s campaigns. Choose campaigns from a single advertiser.')
        if (creativeId) {
          const existing = await store.creativeId(creativeId)
          if (!existing) throw new ApprovalError(404, 'not_found', 'That creative ID does not exist.')
          if (existing.advertiserId !== advertiserId) throw new ApprovalError(400, 'validation_failed', 'That creative ID belongs to a different advertiser.')
        }
        const at = now()
        let target = creativeId
        if (!target) {
          for (let tries = 0; !target; tries++) {
            const candidate = `CR-${randomBytes(4).toString('hex').toUpperCase()}`
            if (!(await store.creativeId(candidate))) target = candidate
            else if (tries > 8) throw new Error('Could not mint a unique creative ID.')
          }
          await store.createCreativeId(target, advertiserId, actor, at)
        }
        for (const c of campaigns) await store.assignCreativeId(c.campaignId, target, actor, at)
        const approvals: Approval[] = []
        for (const c of campaigns) approvals.push(await toView(c, false))
        return { creativeId: target, approvals }
      })
    },

    /* The creative IDs in use, each with the campaigns grouped under it — so
       a reviewer picks an existing one by seeing its siblings. An ID whose
       campaigns have all moved on is not listed. The host adds touch points. */
    async creativeIds(advertiserId?: string, dealId?: string | null): Promise<CreativeIdView[]> {
      const members = new Map<string, string[]>()
      for (const a of await store.assignments()) members.set(a.creativeId, [...(members.get(a.creativeId) ?? []), a.campaignId])
      const out: CreativeIdView[] = []
      for (const row of await store.creativeIds(advertiserId)) {
        const campaigns: CreativeIdView['campaigns'] = []
        let advertiserName: string | null = null
        for (const id of members.get(row.creativeId) ?? []) {
          const c = await o.campaigns.getCampaign(id)
          if (!c) continue
          advertiserName ??= c.advertiserName
          const dealIds = await dealsOf(c)
          campaigns.push({ campaignId: id, name: c.name, touchPoints: [], dealId: dealIds[0] ?? null, dealIds, direct: !c.dealId })
        }
        /* The creative's deals are the union of its campaigns': one creative, many deals. */
        const dealIds = [...new Set(campaigns.flatMap((m) => m.dealIds))].sort()
        const direct = campaigns.some((m) => m.direct)
        /* dealId undefined lists every ID; null lists those with a direct arrangement; a string lists the IDs in that deal. */
        const listed = dealId === undefined || (dealId === null ? direct : dealIds.includes(dealId))
        if (campaigns.length && listed) out.push({ creativeId: row.creativeId, advertiserId: row.advertiserId, advertiserName, createdAt: row.createdAt, dealId: dealIds[0] ?? null, dealIds, direct, campaigns })
      }
      return out
    },

    /* Set the deals a campaign is associated with, beyond the one it was
       authored with (which cannot be removed). The retailer or the advertiser
       does this from the campaign — including after the fact, when a campaign
       first run direct is also run through a DSP. Replaces the added set. */
    /* Every campaign's full deal set in one read, for the campaign list. */
    async dealSets(): Promise<Map<string, string[]>> {
      const added = await store.allAddedDeals()
      const out = new Map<string, string[]>()
      for (const c of await o.campaigns.listCampaigns()) out.set(c.campaignId, [...new Set([...(c.dealId ? [c.dealId] : []), ...(added.get(c.campaignId) ?? [])])].sort())
      return out
    },

    async setDeals(campaignId: string, dealIds: string[], actor: string): Promise<Approval> {
      const ids = [...new Set(dealIds.map((d) => (typeof d === 'string' ? d.trim() : '')))]
      if (ids.some((d) => !d || d.length > 200) || ids.length > 50) throw new ApprovalError(400, 'validation_failed', 'Send up to 50 deal IDs, each 1–200 characters.')
      return transaction(async () => {
        const c = await campaign(campaignId)
        if (c.source === 'hq') throw new ApprovalError(400, 'validation_failed', `${c.name} is not an advertiser campaign, so it has no deals.`)
        const want = new Set(ids.filter((d) => d !== c.dealId))
        const have = new Set(await store.addedDeals(campaignId))
        const at = now()
        for (const d of have) if (!want.has(d)) await store.removeDeal(campaignId, d)
        for (const d of want) if (!have.has(d)) await store.addDeal(campaignId, d, actor, at)
        return toView(c, false)
      })
    },

    async reject(id: string, assetVersion: string, reviewer: string, reason: string, assetReasons?: AssetRejection[]) {
      if (!reason?.trim()) throw new ApprovalError(400, 'validation_failed', 'A reason is required.')
      return transaction(async () => {
      const c = await campaign(id)
      if (assetVersion !== c.assetVersion) throw new ApprovalError(409, 'conflict', 'The creative changed after you opened it. Review the new version.')
      const live = await store.liveVersion(id)
      await apply(c, { type: 'reject', reason, assetReasons }, reviewer)
      if (!live || live === c.assetVersion) return toView(c, true)
      /* A rejected edit to a running campaign (Q38): discard it. The live
         version carries on untouched; the rejection and the discard stay
         in the audit trail against the edit's version. */
      await store.audit(id, c.assetVersion, 'edit_discarded', reviewer, null, now())
      await o.campaigns.discardEditsAfter(id, live)
      const rows = await store.rows(id)
      const keep = rows.map((r) => r.assetVersion).lastIndexOf(live)
      for (const r of rows.slice(keep + 1)) await store.remove(id, r.assetVersion)
      return toView(await campaign(id), true)
      })
    },

    /* Whether `assetId` can skip re-review on resubmission: unchanged
       (same contentHash) AND its most recent clearance was by a human —
       never true from automated checks alone. */
    async wasAssetHumanCleared(campaignId: string, assetId: string, contentHash: string): Promise<boolean> {
      return store.isHumanCleared(campaignId, assetId, contentHash)
    },

    /* Undo a mistaken rejection: back to Awaiting approval for a fresh
       decision, never auto-approved. Same permission as approve/reject
       (Q39). The prior rejection reason stays in the audit trail. */
    async unreject(id: string, assetVersion: string, reviewer: string, reason?: string) {
      return transaction(async () => {
        const c = await campaign(id)
        if (assetVersion !== c.assetVersion) throw new ApprovalError(409, 'conflict', 'The creative changed after you opened it. Review the new version.')
        await apply(c, { type: 'unreject', reason }, reviewer)
        return toView(c, true)
      })
    },

    /* The host calls this when a campaign's assets or targeting change. For
       an advertiser that requires approval the new version goes to Awaiting
       approval as a pending edit; the approved version keeps running until
       it is decided (Q38). Unless every asset was already human-cleared at
       this exact content (Q40), in which case it is approved straight away. */
    async changed(id: string, actor: string | null, checks?: Check[]) {
      return transaction(async () => {
        const c = await campaign(id)
        const latest = await store.latest(id)
        const decided = latest && (latest.status === 'approved' || latest.status === 'awaiting_approval')
        if (!decided) return toView(c, false)
        const from = await statusOf(c)
        if (from === 'draft') {
          /* A new asset version: carry the decision trail over to it. */
          await store.upsert({ ...latest!, assetVersion: c.assetVersion }, now())
        }
        await apply(c, { type: 'change', requiresApproval: await o.requiresApproval(c.advertiserId), preCleared: await preCleared(c) }, actor, { checks: await withClearance(c, checks ?? latest!.checks) })
        return toView(c, false)
      })
    },

    /* The existing activation toggle: only an approved campaign can be activated. */
    async setActivation(id: string, enabled: boolean) {
      return transaction(async () => {
        await campaign(id)
        if (enabled && !(await isEligible(id))) throw new ApprovalError(422, 'not_approved', 'Only an approved campaign can be activated.')
        return o.campaigns.setActivation(id, enabled)
      })
    },
  }
}

export type ApprovalService = ReturnType<typeof createApprovalService>
