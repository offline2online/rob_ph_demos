/* Approval types, matching the API contract's Approval / CampaignStatus. */
export type ApprovalStatus = 'draft' | 'awaiting_approval' | 'approved' | 'rejected'
export type ApprovalMode = 'manual' | 'auto'
export type AuditAction = 'submitted' | 'auto_approved' | 'approved' | 'rejected' | 'returned_for_review' | 'unrejected'
export type CheckName = 'file_type' | 'file_size' | 'bitrate' | 'dimensions' | 'aspect_ratio' | 'duration' | 'default_present' | 'targeting_permitted'

/* assetId is the specific asset a check ran against ('default' or a
   targeted version id) — unset for a campaign-level check that isn't
   about one asset (default_present, targeting_permitted). */
export interface Check { name: CheckName; passed: boolean; detail?: string; assetId?: string }
export interface Creative {
  assetUrl: string
  mimeType: string
  width: number
  height: number
  /* Content hash of the uploaded file (sha256), when the adapter can supply
     one — the basis for "safe reuse of previously approved assets" (spec
     §3): unchanged means byte-identical, i.e. the same hash. */
  contentHash?: string
}
export interface Canvas { width: number; height: number }
/* A rejection reason attached to one specific asset, not the whole
   campaign (spec §3, ticket 22 Sep) — a rejection can name reasons against
   one or more assets. */
export interface AssetRejection { assetId: string; reason: string }
export interface AuditEntry {
  at: string
  action: AuditAction
  by: string | null
  reason: string | null
  assetVersion: string
  /* Present on a 'rejected' entry when the reviewer named specific assets, in addition to (or instead of) the overall `reason`. */
  assetReasons?: AssetRejection[]
}

export interface Approval {
  campaignId: string
  campaignName?: string
  advertiserName?: string
  partnerName?: string
  status: ApprovalStatus
  mode: ApprovalMode | null
  assetVersion: string
  submittedAt: string | null
  reviewedBy: string | null
  reviewedAt: string | null
  reason: string | null
  /* The current rejection's per-asset breakdown, when the reviewer gave one — see AssetRejection. */
  assetReasons?: AssetRejection[]
  checks: Check[]
  targetingSummary?: string
  creative?: Creative | null
  canvas?: Canvas | null
  audit?: AuditEntry[]
}

export interface StatusCounts { draft: number; awaiting_approval: number; approved: number; rejected: number }

export const STATUS_LABELS: Record<ApprovalStatus, string> = {
  draft: 'Draft',
  awaiting_approval: 'Awaiting approval',
  approved: 'Approved',
  rejected: 'Rejected',
}
export const STATUSES: ApprovalStatus[] = ['draft', 'awaiting_approval', 'approved', 'rejected']
