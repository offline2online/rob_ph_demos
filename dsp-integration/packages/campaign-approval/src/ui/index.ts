/* The approval module's React components and hook, as the host's admin UI
   imports them (`@ph-dsp/campaign-approval/ui`). They render with the host's
   Ant Design theme and talk to the API through the ApprovalClient the host
   passes in, so they carry no URL or fetch of their own. */
export { ApprovalStatusBadge } from './ApprovalStatusBadge'
export { ApprovalActions, RejectionCodeSelect } from './ApprovalActions'
export { ApprovalStatusFilter, RETAILER_VISIBLE_STATUSES } from './ApprovalStatusFilter'
export { ApprovalReviewPanel } from './ApprovalReviewPanel'
export { useCampaignApprovals, type ApprovalClient } from './useCampaignApprovals'
export * from '../types'
