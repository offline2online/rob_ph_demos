/* Approval types, matching the API contract's Approval / CampaignStatus. */
export type ApprovalStatus = 'draft' | 'awaiting_approval' | 'approved' | 'rejected'
export type ApprovalMode = 'manual' | 'auto'
/* edit_discarded (Q38, 29 Sep 2026): a rejected edit to a running campaign
   was thrown away and the approved version carries on. reused_clearance
   (Q40, 29 Sep 2026): every asset of the version was byte-identical to one
   a human already cleared, so it was approved without another review. */
export type AuditAction = 'submitted' | 'auto_approved' | 'approved' | 'rejected' | 'returned_for_review' | 'unrejected' | 'edit_discarded' | 'reused_clearance'
/* dsp_audit and previously_cleared are advisory (Q40): recorded for the
   reviewer, never a gate and never an approval on their own. */
export type CheckName = 'file_type' | 'file_size' | 'bitrate' | 'dimensions' | 'aspect_ratio' | 'duration' | 'default_present' | 'targeting_permitted' | 'dsp_audit' | 'previously_cleared'

/* assetId is the specific asset a check ran against ('default' or a
   targeted version id) — unset for a campaign-level check that isn't
   about one asset (default_present, targeting_permitted). */
export interface Check {
  name: CheckName; passed: boolean; detail?: string; assetId?: string
  /* Information for the reviewer, not a gate: a failed advisory check never
     blocks a submission, and a passed one never approves it (Q40). */
  advisory?: boolean
}
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
  /* Q38 (Rob, 29 Sep 2026): the approved version that is running — eligible
     for reservation, bidding and hand-off — whatever is under review. null
     until a version has been approved. While an edit is pending it differs
     from assetVersion (the version under review) and pendingEdit is true. */
  liveAssetVersion: string | null
  pendingEdit: boolean
  /* The most recent edit a reviewer rejected, which was discarded while the
     live version carried on; cleared by the next edit. */
  rejectedEdit?: { assetVersion: string; reason: string | null; at: string }
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
