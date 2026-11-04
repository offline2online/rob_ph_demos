/* "Advertiser Bookings" CTA for the Campaigns page header: place it to the
   LEFT of the existing "Launch a New Campaign" button. Opens the Advertiser
   Bookings page (Booking schedule + Upcoming Campaign Approval tabs). Shows
   the number of campaigns awaiting approval, nothing when zero. Props only. */
import { Button, Tooltip } from 'antd'

export function AdvertiserBookingsButton({ awaitingCount, onClick }: { awaitingCount: number; onClick: () => void }) {
  return (
    <Tooltip title="Bookings made by advertisers, and campaigns waiting for your approval">
      <Button onClick={onClick}>{awaitingCount > 0 ? `Advertiser Bookings (${awaitingCount})` : 'Advertiser Bookings'}</Button>
    </Tooltip>
  )
}
