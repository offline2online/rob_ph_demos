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
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CampaignStatusPage } from '../campaign-status/CampaignStatusPage'
import { BookingSchedulePage } from './BookingSchedulePage'

export type CampaignScheduleTab = 'booking' | 'campaign-status'

/* Advertiser Bookings always opens on Booking schedule (ticket
   LH8iavmKqMB8mjHs9M8m, 28 Sep 2026). The tab used to live in the URL, so
   once someone had looked at Upcoming Campaign Approval, reloading the page
   or coming back to that browser tab reopened it there. Now `?tab=
   campaign-status` is honoured once, on arrival — Campaign detail's
   "Campaign Status" back link still returns to that tab — and then dropped
   from the URL; switching tabs is page state only. */
export function CampaignSchedulePage() {
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState<CampaignScheduleTab>(() => (params.get('tab') === 'campaign-status' ? 'campaign-status' : 'booking'))
  useEffect(() => {
    if (!params.has('tab')) return
    const next = new URLSearchParams(params)
    next.delete('tab')
    setParams(next, { replace: true })
  }, [params, setParams])
  return (
    <Tabs
      activeKey={tab}
      onChange={(key) => setTab(key as CampaignScheduleTab)}
      items={[
        { key: 'booking', label: 'Booking schedule', children: <BookingSchedulePage /> },
        { key: 'campaign-status', label: 'Upcoming Campaign Approval', children: <CampaignStatusPage /> },
      ]}
    />
  )
}
