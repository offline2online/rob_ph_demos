/* Column filter by advertiser for the Campaigns table. When a direct
   advertiser user is logged in, pass `lockedTo` (their advertiser id): the
   control shows only that advertiser, is disabled and its value is forced,
   so they only ever see their own campaigns. The server must enforce the
   same scope; this is the matching UI. Props only. */
import { Select } from 'antd'

export interface AdvertiserOption { id: string; name: string }

export function AdvertiserFilter({ advertisers, value, onChange, lockedTo }: {
  advertisers: AdvertiserOption[]
  value: string | null
  onChange: (advertiserId: string | null) => void
  lockedTo?: string | null
}) {
  const locked = !!lockedTo
  const options = (locked ? advertisers.filter((a) => a.id === lockedTo) : advertisers).map((a) => ({ value: a.id, label: a.name }))
  return (
    <Select
      aria-label="Filter by advertiser" placeholder="Advertiser" allowClear={!locked} disabled={locked} showSearch optionFilterProp="label"
      style={{ minWidth: 200 }} options={options} value={locked ? lockedTo : value} onChange={(v) => onChange(v ?? null)}
    />
  )
}

/* Rows after the filter. `lockedTo` wins over the chosen value. */
export const filterByAdvertiser = <T extends { advertiserId?: string | null }>(rows: T[], value: string | null, lockedTo?: string | null) => {
  const id = lockedTo || value
  return id ? rows.filter((r) => r.advertiserId === id) : rows
}
