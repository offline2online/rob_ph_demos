/* Approval types, matching the API contract's Approval / CampaignStatus. */
export type ApprovalStatus = 'draft' | 'awaiting_approval' | 'approved' | 'rejected'
export type ApprovalMode = 'manual' | 'auto'
export type AuditAction = 'submitted' | 'auto_approved' | 'approved' | 'rejected' | 'returned_for_review'
export type CheckName = 'file_type' | 'file_size' | 'bitrate' | 'dimensions' | 'aspect_ratio' | 'duration' | 'default_present' | 'targeting_permitted'

export interface Check { name: CheckName; passed: boolean; detail?: string }
export interface Creative { assetUrl: string; mimeType: string; width: number; height: number }
export interface Canvas { width: number; height: number }
export interface AuditEntry { at: string; action: AuditAction; by: string | null; reason: string | null; assetVersion: string }

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
