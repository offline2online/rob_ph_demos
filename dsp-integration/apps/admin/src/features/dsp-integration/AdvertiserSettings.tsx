/* Advertiser settings (spec §4, §5, §6): Pricing and List management are
   edited here; Where these apply and Available Inventory are read-only. */
import { useQuery } from '@tanstack/react-query'
import { Button, InputNumber, Select } from 'antd'
import type { ColDef, ICellRendererParams } from 'ag-grid-community'
import { IAB_CATEGORIES, PROVIDERS, touchPointIcon, type AdvertiserSettingsInput, type AvailableInventoryRow } from '@ph-dsp/types'
import { type ReactNode, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api/client'
import { Field } from '../../shared/Field'
import { Grid } from '../../shared/Grid'
import { Icon } from '../../shared/Icon'
import { InfoTip, WithTip } from '../../shared/InfoTip'
import { ListEditor, addExclusive } from '../../shared/ListEditor'
import { SectionLabel } from '../../shared/SectionLabel'
import { T } from '../../theme/phTheme'
import { useSection } from './DspIntegrationLayout'
import { PATHS } from './DspList'
import { SubPageHeader } from './SubPageHeader'

export const ADVERTISER_SETTINGS_TIP =
  "Company-wide advertiser settings, applied to every DSP. Configurable here: Pricing (currency, floor CPM, personalised and interactive multipliers), the Auction schedule (when bidding opens, play-window length, auction cutoff) and List management (advertiser and IAB category whitelists and blacklists). Read-only here: Where these apply (which DSPs use these lists or keep their own; unlink or relink on the DSP's page) and Available Inventory (advertiser-owned slots, set on Display Types). Per-advertiser campaign approval and floor multipliers are on the Advertisers screen."

/* Every ISO 4217 currency, listed by code and name (spec §4). */
const CURRENCIES = (() => {
  const dn = new Intl.DisplayNames(['en-GB'], { type: 'currency' })
  return Intl.supportedValuesOf('currency').map((code) => ({ value: code, label: `${code} — ${dn.of(code) ?? code}` }))
})()

/* How a floor CPM turns into what an advertiser pays, in the floor and
   multiplier tooltips (Rob's board ticket, 19 Sep). One screen over a
   two-hour daypart, at a floor of 100 per thousand VAC-d. */
const VACD_STEPS: [string, string, string][] = [
  ['Footfall past the screen (entrance counter, 2 h)', '—', '1,200'],
  ['× visibility (ROTS: size, angle, path, lighting)', '0.65', '780 viewable'],
  ['× attention (VAC: the share who actually look)', '0.42', '328 viewed'],
  ['× share of time (10 s ÷ 120 s loop)', '0.083', '27 VAC-d'],
]
const rule = '1px solid rgba(255,255,255,0.25)'
const FloorExample = ({ children, rate }: { children: ReactNode; rate: ReactNode }) => (
  <div style={{ fontSize: 12 }}>
    <div className="mb-2">{children}</div>
    <div className="mb-1" style={{ opacity: 0.75 }}>One screen over a two-hour daypart:</div>
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <tbody>
        {VACD_STEPS.map(([step, factor, result]) => (
          <tr key={step}>
            <td style={{ padding: '3px 6px 3px 0', borderBottom: rule }}>{step}</td>
            <td style={{ padding: '3px 6px', borderBottom: rule, textAlign: 'right', opacity: 0.75 }}>{factor}</td>
            <td style={{ padding: '3px 0 3px 6px', borderBottom: rule, textAlign: 'right', whiteSpace: 'nowrap' }}>{result}</td>
          </tr>
        ))}
      </tbody>
    </table>
    <div className="mt-2">{rate}</div>
  </div>
)

const FLOOR_TIP = (
  <FloorExample rate={<>At a floor of <b>100</b> per thousand VAC-d: 100 × 27 ÷ 1,000 = <b>$2.70</b> for the daypart.</>}>
    Cost per thousand assumed views (VAC-d). The minimum any bid must meet; bids below it never win.
  </FloorExample>
)
const PERSONALISED_TIP = (
  <FloorExample rate={<>The same daypart at 100 × 1.5 = <b>150</b> CPM: 150 × 27 ÷ 1,000 = <b>$4.05</b>, against $2.70 at the floor.</>}>
    Applied when the visitor is checked in or otherwise identified, so the advert is one-to-one for that individual. Multiplies the floor CPM.
  </FloorExample>
)
const INTERACTIVE_TIP = (
  <FloorExample rate={<>The same daypart at 100 × 3 = <b>300</b> CPM: <b>$8.10</b>. Stacked with personalised, 100 × 1.5 × 3 = <b>450</b> CPM: <b>$12.15</b> — and the advertiser’s own floor multiplier scales that again (0.8 → $9.72).</>}>
    Applied when the visitor interacts with the campaign and engages with the advertiser on that display, for example by scanning an interactive QR Control campaign. Multiplies the floor CPM.
  </FloorExample>
)

/* The auction cutoff, every half hour (UTC). */
const CUTOFF_TIMES = Array.from({ length: 48 }, (_, i) => {
  const t = `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`
  return { value: t, label: `${t} UTC` }
})

/* A duration stored in hours, entered as days and hours. */
function DaysHours({ id, hours, onChange }: { id: string; hours: number; onChange: (hours: number) => void }) {
  const days = Math.floor((hours ?? 0) / 24)
  const rest = (hours ?? 0) % 24
  const whole = (v: number | string | null) => Math.max(0, Math.floor(Number(v) || 0))
  return (
    <div className="flex gap-2">
      <InputNumber id={id} aria-label="Days" className="flex-1" min={0} precision={0} value={days} suffix="days" onChange={(v) => onChange(whole(v) * 24 + rest)} />
      <InputNumber aria-label="Hours" className="flex-1" min={0} max={23} precision={0} value={rest} suffix="hours" onChange={(v) => onChange(days * 24 + Math.min(23, whole(v)))} />
    </div>
  )
}

type ListKey = 'advertiserWhitelist' | 'advertiserBlacklist' | 'categoryWhitelist' | 'categoryBlacklist'
const OTHER: Record<ListKey, ListKey> = {
  advertiserWhitelist: 'advertiserBlacklist', advertiserBlacklist: 'advertiserWhitelist',
  categoryWhitelist: 'categoryBlacklist', categoryBlacklist: 'categoryWhitelist',
}

type Ctx = { current: { open: (displayTypeId: string) => void } }
const TypeCell = ({ data }: ICellRendererParams<AvailableInventoryRow>) =>
  data ? <span className="inline-flex min-w-0 items-center gap-[5px]"><Icon name={touchPointIcon(data.touchPoint ?? '')} size={14} style={{ color: T.muted }} /><span className="truncate">{data.displayTypeName}</span></span> : null
const PositionCell = ({ data }: ICellRendererParams<AvailableInventoryRow>) =>
  data ? <div className="min-w-0"><div className="truncate">{data.position}</div><div style={{ fontSize: 11, color: T.micro }}>{data.partnerName ?? 'Any connected DSP'}</div></div> : null
const OpenCell = ({ data, context }: ICellRendererParams<AvailableInventoryRow, unknown, Ctx>) =>
  data ? <Button color="primary" variant="text" size="small" className="px-0" onClick={() => context.current.open(data.displayTypeId)}>Open</Button> : null

export function AdvertiserSettings() {
  const navigate = useNavigate()
  const { draft, update, settings: savedView, partners } = useSection()
  const s = draft.settings
  const set = <K extends keyof AdvertiserSettingsInput>(k: K, v: AdvertiserSettingsInput[K]) => update('settings', (x) => ({ ...x, [k]: v }))
  const add = (k: ListKey) => (name: string) => update('settings', (x) => {
    const r = addExclusive({ add: x[k], other: x[OTHER[k]] }, name)
    return { ...x, [k]: r.add, [OTHER[k]]: r.other }
  })
  const remove = (k: ListKey) => (name: string) => update('settings', (x) => ({ ...x, [k]: x[k].filter((y) => y !== name) }))
  const inventory = useQuery({ queryKey: ['available-inventory'], queryFn: () => api<{ items: AvailableInventoryRow[] }>('GET', '/admin/v1/available-inventory').then((r) => r.items) })
  const columns = useMemo<ColDef<AvailableInventoryRow>[]>(() => [
    { headerName: 'Display type', width: 260, cellRenderer: TypeCell },
    { headerName: 'Playlist', width: 170, field: 'playlistName', cellStyle: { color: T.muted } },
    { headerName: 'Slot', width: 70, field: 'slot', suppressSizeToFit: true, cellStyle: { color: T.muted } },
    { headerName: 'Position', width: 160, cellRenderer: PositionCell },
    { headerName: '', width: 76, suppressSizeToFit: true, cellRenderer: OpenCell },
  ], [])
  const num = (k: 'floorCpm' | 'personalisedMultiplier' | 'interactiveMultiplier', step: number, ph: string) => (
    <InputNumber id={k} className="w-full" step={step} min={0} placeholder={ph} formatter={(v) => (v === undefined || v === null ? '' : String(v))} parser={(v) => Number(v)} value={s[k]} onChange={(v) => set(k, (v === null ? null : Number(v)) as number)} />
  )
  const where = savedView.whereTheseApply

  return (
    <>
      <SubPageHeader icon="rule" title="Advertiser settings" tip={ADVERTISER_SETTINGS_TIP} />

      <SectionLabel><WithTip tip="Multipliers stack: effective floor = floor CPM × personalised × interactive × the advertiser's floor multiplier (set on the Advertisers screen). Bids below the effective floor never win.">Pricing</WithTip></SectionLabel>
      <div className="grid grid-cols-4 gap-3.5">
        <Field label="Currency" htmlFor="currency" tip="Used for the floor CPM, every effective floor and billing. Bid requests carry it as the bid floor currency.">
          <Select id="currency" className="w-full" showSearch optionFilterProp="label" value={s.currency} onChange={(v) => set('currency', v)} options={CURRENCIES} popupMatchSelectWidth={280} />
        </Field>
        <Field label="Floor price (CPM)" htmlFor="floorCpm" tip={FLOOR_TIP} tipWidth={400}>{num('floorCpm', 1, '100')}</Field>
        <Field label="Personalised multiplier" htmlFor="personalisedMultiplier" tip={PERSONALISED_TIP} tipWidth={400}>{num('personalisedMultiplier', 0.05, '1.5')}</Field>
        <Field label="Interactive multiplier" htmlFor="interactiveMultiplier" tip={INTERACTIVE_TIP} tipWidth={400}>{num('interactiveMultiplier', 0.05, '3')}</Field>
      </div>

      <SectionLabel><WithTip tip="In-store screens can't take a bid per play, so advertisers bid for a play window that clears ahead of time. Bidding for a window opens, closes at the auction cutoff (when the auction runs) and the winner holds the slot for the whole window. Times are UTC.">Auction schedule</WithTip></SectionLabel>
      <div className="grid grid-cols-3 gap-3.5">
        <Field label="Auction opens" htmlFor="auctionOpensHours" tip="How long before the auction cutoff bidding for a play window opens, for example 7 days.">
          <DaysHours id="auctionOpensHours" hours={s.auctionOpensHours} onChange={(v) => set('auctionOpensHours', v)} />
        </Field>
        <Field label="Play-window length" htmlFor="playWindowHours" tip="The minimum period a won slot is held, in days and hours, for example 24 hours or 7 days. It can't change while future windows are bid on or booked.">
          <DaysHours id="playWindowHours" hours={s.playWindowHours} onChange={(v) => set('playWindowHours', v)} />
        </Field>
        <Field label="Auction cutoff time" htmlFor="auctionCutoffTime" tip="The daily time by which bids must be in. The auction for the next play window runs then; 18:00 gives six hours before a midnight window.">
          <Select id="auctionCutoffTime" className="w-full" value={s.auctionCutoffTime} onChange={(v) => set('auctionCutoffTime', v)} options={CUTOFF_TIMES} />
        </Field>
      </div>

      <SectionLabel><WithTip tip="Nothing can sit on both lists. The blacklist always applies and no position can opt out of it. The whitelist is only used by positions set to whitelist-only.">List management</WithTip></SectionLabel>
      <div className="grid grid-cols-2 gap-3.5">
        <ListEditor label="Advertisers — whitelist" tone={T.success} icon="verified" items={s.advertiserWhitelist} onAdd={add('advertiserWhitelist')} onRemove={remove('advertiserWhitelist')} empty="Empty — a position set to whitelist-only would never fill." />
        <ListEditor label="Advertisers — blacklist" tone={T.error} icon="block" items={s.advertiserBlacklist} onAdd={add('advertiserBlacklist')} onRemove={remove('advertiserBlacklist')} empty="Empty — nothing is blocked by default." />
        <ListEditor label="Categories — whitelist" tone={T.success} icon="category" items={s.categoryWhitelist} suggestions={[...IAB_CATEGORIES]} onAdd={add('categoryWhitelist')} onRemove={remove('categoryWhitelist')} empty="Empty — every category is eligible." addLabel="Add a category…" suggestLabel="Categories:" />
        <ListEditor label="Categories — blacklist" tone={T.error} icon="block" items={s.categoryBlacklist} suggestions={[...IAB_CATEGORIES]} onAdd={add('categoryBlacklist')} onRemove={remove('categoryBlacklist')} empty="Empty — no category is blocked by default." addLabel="Add a category…" suggestLabel="Categories:" />
      </div>

      <SectionLabel><WithTip tip="Whether each DSP uses the company lists above or has unlinked to keep its own.">Where these apply</WithTip></SectionLabel>
      {where.length === 0 ? (
        <div style={{ fontSize: 12.5, color: T.muted }}>No DSP connected yet. A partner added later adopts these lists automatically.</div>
      ) : (
        <ul aria-label="Where these apply" className="m-0 list-none overflow-hidden rounded-md border p-0" style={{ borderColor: T.borderSubtle }}>
          {where.map((x, i) => {
            const partner = partners.find((p) => p.id === x.partnerId)
            const def = PROVIDERS.find((p) => p.key === partner?.provider)
            return (
              <li key={x.partnerId} className="flex items-center gap-2.5 px-3 py-2.5" style={{ fontSize: 12.5, borderBottom: i < where.length - 1 ? `1px solid ${T.borderSubtle}` : 'none' }}>
                <Icon name={def?.icon ?? 'handshake'} size={17} style={{ color: def?.colour }} />
                <span className="min-w-0 flex-1">{x.name}</span>
                <span className="inline-flex items-center gap-[5px]" style={{ color: x.adopting ? T.primary : T.warning }}>
                  <Icon name={x.adopting ? 'link' : 'link_off'} size={14} />
                  {x.adopting ? 'Adopting' : 'Own lists'}
                  {!x.adopting && <InfoTip text={`Edits to the company lists don't reach ${x.name} until it is relinked.`} />}
                </span>
                <Button color="primary" variant="text" size="small" className="px-0" onClick={() => navigate(PATHS.partner(x.partnerId))}>Open</Button>
              </li>
            )
          })}
        </ul>
      )}

      <div className="flex items-center justify-between gap-3">
        <SectionLabel><WithTip tip="Every advertiser-owned slot across the estate that connected DSPs can bid on. Slots are made available by setting their owner to Advertiser on a display type.">Available Inventory</WithTip></SectionLabel>
        <Button color="primary" variant="text" size="small" icon={<Icon name="calendar_month" size={16} />} style={{ marginTop: 12 }} onClick={() => navigate(PATHS.bookingSchedule)}>Booking schedule</Button>
      </div>
      {inventory.data && inventory.data.length === 0 ? (
        <div className="flex items-center gap-2" style={{ fontSize: 12.5, color: T.muted }}>
          <Icon name="view_week" size={18} />
          <span>No advertiser positions yet. Set a slot's owner to <b>Advertiser</b> on a display type.</span>
        </div>
      ) : (
        <Grid<AvailableInventoryRow>
          label="Available Inventory"
          rows={inventory.data ?? []}
          columns={columns}
          context={{ open: (id: string) => navigate(`/display-types?id=${encodeURIComponent(id)}`) }}
          getRowId={(r) => `${r.displayTypeId}:${r.slot}`}
          rowHeight={52}
        />
      )}
    </>
  )
}

