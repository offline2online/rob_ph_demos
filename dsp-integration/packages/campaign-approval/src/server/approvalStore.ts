/* Approval rows (one per campaign and asset version) and the append-only
   audit log. Plain, Postgres-compatible SQL. */
import { randomUUID } from 'node:crypto'
import type { SqlDb } from '../db'
import type { ApprovalMode, ApprovalStatus, AuditAction, AuditEntry, Check } from '../types'

export interface ApprovalRow {
  campaignId: string
  assetVersion: string
  status: ApprovalStatus
  mode: ApprovalMode | null
  submittedAt: string | null
  reviewedBy: string | null
  reviewedAt: string | null
  reason: string | null
  checks: Check[]
}

interface Raw { campaign_id: string; asset_version: string; status: ApprovalStatus; mode: ApprovalMode | null; submitted_at: string | null; reviewed_by: string | null; reviewed_at: string | null; reason: string | null; checks: string }
const toRow = (r: Raw): ApprovalRow => ({
  campaignId: r.campaign_id, assetVersion: r.asset_version, status: r.status, mode: r.mode, submittedAt: r.submitted_at,
  reviewedBy: r.reviewed_by, reviewedAt: r.reviewed_at, reason: r.reason, checks: JSON.parse(r.checks),
})

export function approvalStore(db: SqlDb) {
  return {
    /* The row for the campaign's most recent version with a decision trail. */
    latest(campaignId: string): ApprovalRow | null {
      const r = db.prepare('SELECT * FROM campaign_approvals WHERE campaign_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(campaignId) as Raw | undefined
      return r ? toRow(r) : null
    },
    get(campaignId: string, assetVersion: string): ApprovalRow | null {
      const r = db.prepare('SELECT * FROM campaign_approvals WHERE campaign_id = ? AND asset_version = ?').get(campaignId, assetVersion) as Raw | undefined
      return r ? toRow(r) : null
    },
    /* Any version of the campaign approved at some point (for Q38's "old version keeps running"). */
    anyApproved(campaignId: string) {
      return !!db.prepare("SELECT 1 FROM campaign_approvals WHERE campaign_id = ? AND status = 'approved' LIMIT 1").get(campaignId)
    },
    upsert(row: ApprovalRow, now: string) {
      db.prepare(
        `INSERT INTO campaign_approvals (campaign_id, asset_version, status, mode, submitted_at, reviewed_by, reviewed_at, reason, checks, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (campaign_id, asset_version) DO UPDATE SET status = excluded.status, mode = excluded.mode, submitted_at = excluded.submitted_at,
           reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at, reason = excluded.reason, checks = excluded.checks`,
      ).run(row.campaignId, row.assetVersion, row.status, row.mode, row.submittedAt, row.reviewedBy, row.reviewedAt, row.reason, JSON.stringify(row.checks), now)
    },
    audit(campaignId: string, assetVersion: string, action: AuditAction, actor: string | null, reason: string | null, at: string) {
      db.prepare('INSERT INTO campaign_approval_audit (id, campaign_id, asset_version, action, actor, reason, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), campaignId, assetVersion, action, actor, reason, at)
    },
    auditTrail(campaignId: string): AuditEntry[] {
      return (db.prepare('SELECT * FROM campaign_approval_audit WHERE campaign_id = ? ORDER BY at, rowid').all(campaignId) as { at: string; action: AuditAction; actor: string | null; reason: string | null; asset_version: string }[])
        .map((a) => ({ at: a.at, action: a.action, by: a.actor, reason: a.reason, assetVersion: a.asset_version }))
    },
  }
}
