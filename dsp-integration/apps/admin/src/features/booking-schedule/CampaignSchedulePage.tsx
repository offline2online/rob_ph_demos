/* Campaign schedule: Booking schedule and Campaign Approval as two tabs on one
   page. They were dropped on 13 Oct 2026 (ticket BG4LKXiqTMYNm8jRNFDk) while
   the initial release had no booking schedule; restored now that programmatic
   guaranteed is supported (ticket BGxKMB89DIOgWuwgfrej). Booking schedule is the
   default tab; `?tab=campaign-status` opens Campaign Approval. The tab lives in
   the URL, so it survives a refresh and the campaign detail's back link can
   return to it. */
import { Tabs } from 'antd'
import { useSearchParams } from 'react-router-dom'
import { CampaignStatusPage } from '../campaign-status/CampaignStatusPage'
import { BookingSchedulePage } from './BookingSchedulePage'

export const CAMPAIGN_APPROVAL_TAB = 'campaign-status'

export function CampaignSchedulePage() {
  const [params, setParams] = useSearchParams()
  const active = params.get('tab') === CAMPAIGN_APPROVAL_TAB ? CAMPAIGN_APPROVAL_TAB : 'booking-schedule'
  /* Each tab owns its own filters (advertiserId, status, …), so switching drops them. */
  const select = (key: string) => setParams(key === CAMPAIGN_APPROVAL_TAB ? { tab: key } : {}, { replace: true })
  return (
    <Tabs
      activeKey={active}
      onChange={select}
      items={[
        { key: 'booking-schedule', label: 'Booking schedule', children: <BookingSchedulePage /> },
        { key: CAMPAIGN_APPROVAL_TAB, label: 'Campaign Approval', children: <CampaignStatusPage /> },
      ]}
    />
  )
}
