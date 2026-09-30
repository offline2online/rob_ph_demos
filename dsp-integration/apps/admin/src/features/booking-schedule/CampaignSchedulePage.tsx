/* Campaign schedule (ticket, 26 Sep 2026): the section formerly named
   "Booking schedule", now two tabs — Booking schedule (the landing tab,
   unchanged) and Campaign status, which is this table's only home now
   that it is no longer its own admin nav item. Underline tabs (ph-designer
   components.md §2 — "list pages, campaign detail"), same style
   CampaignDetail already uses; each tab's own content is untouched, so it
   renders exactly as it did as a standalone page, full width. The second
   tab's label reads "Upcoming Campaign Approval" (ticket, 27 Sep 2026); its
   URL key stays `campaign-status`, so existing links keep working. */
import { Tabs } from 'antd'
import { useSearchParams } from 'react-router-dom'
import { CampaignStatusPage } from '../campaign-status/CampaignStatusPage'
import { BookingSchedulePage } from './BookingSchedulePage'

export type CampaignScheduleTab = 'booking' | 'campaign-status'

/* The tab lives in the URL (ticket HSTgB0s6l56UWH71JwOv, 30 Sep 2026), so
   reloading the browser on Upcoming Campaign Approval stays there instead of
   dropping back to Booking schedule. This reverses LH8iavmKqMB8mjHs9M8m
   (28 Sep), which stripped `?tab=` after arrival. Booking schedule is the
   default and carries no `tab` param; Campaign detail's "Campaign Status"
   back link still returns to `?tab=campaign-status`. */
export function CampaignSchedulePage() {
  const [params, setParams] = useSearchParams()
  const tab: CampaignScheduleTab = params.get('tab') === 'campaign-status' ? 'campaign-status' : 'booking'
  const onChange = (key: string) => {
    const next = new URLSearchParams(params)
    if (key === 'campaign-status') next.set('tab', 'campaign-status')
    else next.delete('tab')
    setParams(next, { replace: true })
  }
  return (
    <Tabs
      activeKey={tab}
      onChange={onChange}
      items={[
        { key: 'booking', label: 'Booking schedule', children: <BookingSchedulePage /> },
        { key: 'campaign-status', label: 'Upcoming Campaign Approval', children: <CampaignStatusPage /> },
      ]}
    />
  )
}
