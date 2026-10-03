/* Approval rows (one per campaign and asset version) and the append-only
   audit log. Plain, Postgres-compatible SQL. Every method answers with
   whatever the SqlDb answers: at once on node:sqlite, a promise on an
   async adapter (callers await). */
import { randomUUID } from 'node:crypto'
import { type Awaitable, type SqlDb, type SqlStatement, andThen } from '../db'
import type { ApprovalMode, ApprovalStatus, AssetRejection, AuditAction, AuditEntry, Check } from '../types'

export interface ApprovalRow {
  campaignId: string
  assetVersion: string
  status: ApprovalStatus
  mode: ApprovalMode | null
  submittedAt: string | null
  reviewedBy: string | null
  reviewedAt: string | null
  reason: string | null
  assetReasons: AssetRejection[]
  checks: Check[]
}

interface Raw { campaign_id: string; asset_version: string; status: ApprovalStatus; mode: ApprovalMode | null; submitted_at: string | null; reviewed_by: string | null; reviewed_at: string | null; reason: string | null; asset_reasons: string | null; checks: string }
const toRow = (r: Raw): ApprovalRow => ({
  campaignId: r.campaign_id, assetVersion: r.asset_version, status: r.status, mode: r.mode, submittedAt: r.submitted_at,
  reviewedBy: r.reviewed_by, reviewedAt: r.reviewed_at, reason: r.reason, assetReasons: r.asset_reasons ? JSON.parse(r.asset_reasons) : [], checks: JSON.parse(r.checks),
})

export function approvalStore(db: SqlDb) {
  /* Each statement is prepared once per SQL text (scalability review,
     24 Sep 2026): the eligibility check behind every bid in an auction and
     every bid placed reads `latest`, and preparing it each time parsed and
     planned the same SQL thousands of times a window. */
  const cache = new Map<string, SqlStatement>()
  const stmt = (sql: string) => {
    let s = cache.get(sql)
    if (!s) cache.set(sql, (s = db.prepare(sql)))
    return s
  }
  return {
    /* The row for the campaign's most recent version with a decision trail. */
    latest(campaignId: string): Awaitable<ApprovalRow | null> {
      return andThen(stmt('SELECT * FROM campaign_approvals WHERE campaign_id = ? ORDER BY created_at DESC, seq DESC LIMIT 1').get(campaignId), (r) => (r ? toRow(r as Raw) : null))
    },
    get(campaignId: string, assetVersion: string): Awaitable<ApprovalRow | null> {
      return andThen(stmt('SELECT * FROM campaign_approvals WHERE campaign_id = ? AND asset_version = ?').get(campaignId, assetVersion), (r) => (r ? toRow(r as Raw) : null))
    },
    /* The live version (Q38, Rob, 29 Sep 2026): the most recently approved
       one. Versions only ever move forward and only the current one can be
       approved, so this is the newest approved row — the one that runs
       while a later edit awaits review, and the one an approval of that
       edit replaces in the same write. On the eligibility hot path. */
    liveVersion(campaignId: string): Awaitable<string | null> {
      return andThen(stmt("SELECT asset_version FROM campaign_approvals WHERE campaign_id = ? AND status = 'approved' ORDER BY created_at DESC, seq DESC LIMIT 1").get(campaignId),
        (r) => (r as { asset_version: string } | undefined)?.asset_version ?? null)
    },
    /* Every row of the campaign, oldest first (same order as latest()). */
    rows(campaignId: string): Awaitable<ApprovalRow[]> {
      return andThen(stmt('SELECT * FROM campaign_approvals WHERE campaign_id = ? ORDER BY created_at, seq').all(campaignId), (rs) => (rs as Raw[]).map(toRow))
    },
    /* A discarded edit's row (Q38). Its decision stays in the audit log. */
    remove(campaignId: string, assetVersion: string): Awaitable<void> {
      return andThen(stmt('DELETE FROM campaign_approvals WHERE campaign_id = ? AND asset_version = ?').run(campaignId, assetVersion), () => undefined)
    },
    upsert(row: ApprovalRow, now: string): Awaitable<void> {
      return andThen(stmt(
        `INSERT INTO campaign_approvals (campaign_id, asset_version, status, mode, submitted_at, reviewed_by, reviewed_at, reason, asset_reasons, checks, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (campaign_id, asset_version) DO UPDATE SET status = excluded.status, mode = excluded.mode, submitted_at = excluded.submitted_at,
           reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at, reason = excluded.reason, asset_reasons = excluded.asset_reasons, checks = excluded.checks`,
      ).run(row.campaignId, row.assetVersion, row.status, row.mode, row.submittedAt, row.reviewedBy, row.reviewedAt, row.reason, row.assetReasons.length ? JSON.stringify(row.assetReasons) : null, JSON.stringify(row.checks), now), () => undefined)
    },
    audit(campaignId: string, assetVersion: string, action: AuditAction, actor: string | null, reason: string | null, at: string, assetReasons?: AssetRejection[]): Awaitable<void> {
      return andThen(stmt('INSERT INTO campaign_approval_audit (id, campaign_id, asset_version, action, actor, reason, asset_reasons, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), campaignId, assetVersion, action, actor, reason, assetReasons?.length ? JSON.stringify(assetReasons) : null, at), () => undefined)
    },
    auditTrail(campaignId: string): Awaitable<AuditEntry[]> {
      return andThen(stmt('SELECT * FROM campaign_approval_audit WHERE campaign_id = ? ORDER BY at, seq').all(campaignId), (rs) =>
        (rs as { at: string; action: AuditAction; actor: string | null; reason: string | null; asset_version: string; asset_reasons: string | null }[])
          .map((a) => ({ at: a.at, action: a.action, by: a.actor, reason: a.reason, assetVersion: a.asset_version, ...(a.asset_reasons ? { assetReasons: JSON.parse(a.asset_reasons) } : {}) })))
    },
    /* Safe reuse (spec §3): record that a human (never auto-approve) has
       cleared this asset at this exact content. */
    recordHumanClearance(campaignId: string, assetId: string, contentHash: string, clearedBy: string, at: string): Awaitable<void> {
      return andThen(stmt(
        `INSERT INTO campaign_approval_asset_clearance (campaign_id, asset_id, content_hash, cleared_by, cleared_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (campaign_id, asset_id) DO UPDATE SET content_hash = excluded.content_hash, cleared_by = excluded.cleared_by, cleared_at = excluded.cleared_at`,
      ).run(campaignId, assetId, contentHash, clearedBy, at), () => undefined)
    },
    /* True only when BOTH hold: the asset is unchanged (same content_hash)
       AND its clearance came from a human review, not merely automated
       checks — recordHumanClearance is the only way a row gets here. */
    isHumanCleared(campaignId: string, assetId: string, contentHash: string): Awaitable<boolean> {
      return andThen(stmt('SELECT content_hash FROM campaign_approval_asset_clearance WHERE campaign_id = ? AND asset_id = ?').get(campaignId, assetId),
        (r) => !!r && (r as { content_hash: string }).content_hash === contentHash)
    },
  }
}
