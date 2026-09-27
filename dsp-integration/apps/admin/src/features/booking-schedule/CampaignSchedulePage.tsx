/* Campaign schedule (ticket, 26 Sep 2026): the section formerly named
   "Booking schedule", now two tabs — Booking schedule (the landing tab,
   unchanged) and Campaign status, which is this table's only home now
   that it is no longer its own admin nav item. Underline tabs (ph-designer
   components.md §2 — "list pages, campaign detail"), same style
   CampaignDetail already uses; each tab's own content is untouched, so it
   renders exactly as it did as a standalone page, full width. */
import { Tabs } from 'antd'
import { useSearchParams } from 'react-router-dom'
import { CampaignStatusPage } from '../campaign-status/CampaignStatusPage'
import { BookingSchedulePage } from './BookingSchedulePage'

export type CampaignScheduleTab = 'booking' | 'campaign-status'

export function CampaignSchedulePage() {
  const [params, setParams] = useSearchParams()
  const tab: CampaignScheduleTab = params.get('tab') === 'campaign-status' ? 'campaign-status' : 'booking'
  const setTab = (key: string) => {
    const next = new URLSearchParams(params)
    /* Booking schedule is the default/landing tab (ticket) — keep the URL
       clean rather than always carrying an explicit `tab=booking`. */
    if (key === 'booking') next.delete('tab')
    else next.set('tab', key)
    setParams(next, { replace: true })
  }
  return (
    <Tabs
      activeKey={tab}
      onChange={setTab}
      items={[
        { key: 'booking', label: 'Booking schedule', children: <BookingSchedulePage /> },
        { key: 'campaign-status', label: 'Campaign status', children: <CampaignStatusPage /> },
      ]}
    />
  )
}
