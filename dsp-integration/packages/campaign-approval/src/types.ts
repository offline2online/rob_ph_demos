/* Approval types, matching the API contract's Approval / CampaignStatus. */
export type ApprovalStatus = 'draft' | 'awaiting_approval' | 'approved' | 'rejected'
export type ApprovalMode = 'manual' | 'auto'
/* edit_discarded (Q38, 29 Sep 2026): a rejected edit to a running campaign
   was thrown away and the approved version carries on. reused_clearance
   (Q40, 29 Sep 2026): every asset of the version was byte-identical to one
   a human already cleared, so it was approved without another review. */
export type AuditAction = 'submitted' | 'auto_approved' | 'approved' | 'rejected' | 'returned_for_review' | 'unrejected' | 'approval_reverted' | 'edit_discarded' | 'reused_clearance'
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
/* The fixed pick-list a rejection is coded with (19 Oct 2026), so reasons can
   be counted: free text alone can't be. A rejection also keeps its required
   free-text reason. A rejection recorded before the pick-list reads 'other'. */
export type RejectionCode = 'price_or_offer_in_artwork' | 'wrong_size_or_ratio' | 'duration_too_long' | 'brand_or_category_not_allowed' | 'poor_quality' | 'other'
export const REJECTION_CODES: { code: RejectionCode; label: string }[] = [
  { code: 'price_or_offer_in_artwork', label: 'Price or offer in artwork' },
  { code: 'wrong_size_or_ratio', label: 'Wrong size or ratio' },
  { code: 'duration_too_long', label: 'Duration too long' },
  { code: 'brand_or_category_not_allowed', label: 'Brand or category not allowed' },
  { code: 'poor_quality', label: 'Poor quality' },
  { code: 'other', label: 'Other' },
]
export const isRejectionCode = (v: unknown): v is RejectionCode => REJECTION_CODES.some((r) => r.code === v)
export const rejectionLabel = (code: RejectionCode | null | undefined) => REJECTION_CODES.find((r) => r.code === (code ?? 'other'))?.label ?? 'Other'

/* A rejection reason attached to one specific asset, not the whole
   campaign (spec §3, ticket 22 Sep) — a rejection can name reasons against
   one or more assets. `code` is the asset's coded reason; unset on one
   recorded before the pick-list. */
export interface AssetRejection { assetId: string; reason: string; code?: RejectionCode }
export interface AuditEntry {
  at: string
  action: AuditAction
  by: string | null
  reason: string | null
  /* The coded reason of a 'rejected' entry; unset on one recorded before the pick-list (counts as 'other'). */
  reasonCode?: RejectionCode
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
  /* The coded reason of the current rejection; null when the campaign isn't rejected or was rejected before the pick-list. */
  reasonCode?: RejectionCode | null
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
  /* The creative ID this campaign is grouped under for DSP bidding, once a
     retailer has approved it into one. null until then. A resubmission keeps
     it while it awaits re-approval (the assignment belongs to the campaign,
     not to one version of its creative). */
  creativeId?: string | null
  /* The private-auction deal ID the advertiser set at authoring, as submitted; null for a direct campaign. Kept for older callers: the first of dealIds. */
  dealId?: string | null
  /* Every deal the campaign is associated with: the authored deal plus any added since (sorted). Empty for a campaign with none. */
  dealIds?: string[]
  /* True when the campaign was authored with no deal, i.e. it has a direct arrangement — which it keeps if a deal is added later (the crossover). */
  direct?: boolean
  targetingSummary?: string
  creative?: Creative | null
  canvas?: Canvas | null
  audit?: AuditEntry[]
}

/* A creative ID and the campaigns grouped under it. The service fills
   campaigns' name; the host adds touchPoints, which it alone knows. */
export interface CreativeIdView {
  creativeId: string
  advertiserId: string
  advertiserName: string | null
  createdAt: string
  /* The first of dealIds, or null when there is none; kept for older callers. */
  dealId: string | null
  /* Every deal any member campaign is associated with (sorted): one creative can be in many deals at once. */
  dealIds: string[]
  /* True when some member campaign has a direct arrangement (authored with no deal). */
  direct: boolean
  campaigns: { campaignId: string; name: string; touchPoints: string[]; dealId: string | null; dealIds: string[]; direct: boolean }[]
}

export interface StatusCounts { draft: number; awaiting_approval: number; approved: number; rejected: number }

export const STATUS_LABELS: Record<ApprovalStatus, string> = {
  draft: 'Draft',
  awaiting_approval: 'Awaiting approval',
  approved: 'Approved',
  rejected: 'Rejected',
}
export const STATUSES: ApprovalStatus[] = ['draft', 'awaiting_approval', 'approved', 'rejected']

/* The queue's health over the last `days` days (GET /approvals/summary).
   Turnaround and the rejection rate count decisions a person made; a
   campaign approved automatically is in neither. */
export interface ApprovalSummary {
  days: number
  /* Decisions a person made in the window (approved + rejected). */
  decided: number
  rejected: number
  /* Median seconds from submission to decision; null with no decision in the window. */
  medianSecondsToDecision: number | null
  /* rejected ÷ decided, 0–1; null with no decision in the window. */
  rejectionRate: number | null
  /* The campaign that has waited longest for a decision; null when none is waiting. */
  oldestWaiting: { campaignId: string; campaignName?: string; submittedAt: string; ageSeconds: number } | null
  /* The three most frequent coded reasons in the window. */
  topRejectionReasons: { code: RejectionCode; label: string; count: number }[]
}
