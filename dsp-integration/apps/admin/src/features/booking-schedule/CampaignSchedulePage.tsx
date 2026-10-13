/* Campaign Approval (ticket BG4LKXiqTMYNm8jRNFDk, 13 Oct 2026): this route used to
   host two tabs — Booking schedule and Campaign Approval. The initial release
   does not support a booking schedule, so the tabs are gone and the Campaign
   Approval table sits directly under the page header. BookingSchedulePage and
   its API stay in the repo, unrouted, for a later release. Old
   `?tab=campaign-status` links still land here; the param is ignored. */
import { CampaignStatusPage } from '../campaign-status/CampaignStatusPage'

export function CampaignSchedulePage() {
  return <CampaignStatusPage />
}
