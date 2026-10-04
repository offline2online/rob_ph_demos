/* Advertiser settings (spec §4, §5, §6): Pricing and the IAB category lists are
   edited here (advertiser lists are per DSP, on its own page); Where these apply is read-only. The inventory table moved to
   Advertisers / Inventory (Rob, 20 Sep). */
import { InputNumber, Select } from 'antd'
import { IAB_CATEGORIES, IAB_CATEGORY_CODES, type AdvertiserSettingsInput } from '@ph-dsp/types'
import { type ReactNode, useMemo } from 'react'
import { Callout } from '../../shared/Callout'
import { Field } from '../../shared/Field'
import { WithTip } from '../../shared/InfoTip'
import { ListEditor, addExclusive } from '../../shared/ListEditor'
import { SectionLabel } from '../../shared/SectionLabel'
import { T } from '../../theme/phTheme'
import { useSection } from './DspIntegrationLayout'
import { SubPageHeader } from './SubPageHeader'

export const ADVERTISER_SETTINGS_TIP =
  "Company-wide advertiser settings, applied to every DSP. Configurable here: Pricing (currency, floor CPM, the personalised multiplier and the interactive cost per engagement), the Auction schedule (when bidding opens, play-window length, auction cutoff) and the Category lists (IAB whitelists and blacklists; each DSP's advertiser lists are managed on its own page, from the advertisers it syncs). Read-only here: Where these apply (which DSPs use these lists or keep their own; unlink or relink on the DSP's page). Per-advertiser campaign approval and floor multipliers, and the inventory advertisers can buy, are on Advertisers / Inventory."

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
/* The multiplier and the fee relate themselves to the floor price tooltip
   rather than repeating its working (Rob, 20 Sep). */
const PERSONALISED_TIP = (
  <div style={{ fontSize: 12 }}>
    Applied when the visitor is checked in or otherwise identified, so the advert is one-to-one for that individual.
    <div className="mt-2">It is <b>not a bid floor</b>. Bids and the auction clear against the floor price, and the price a campaign wins at covers its default and localised plays. This is charged <b>only when a personalised version plays</b>: that play bills at the committed price × this. At 1.5, a campaign committed at 100 pays <b>150</b> CPM for a personalised play. The advertiser’s floor multiplier scales the floor only. Interactive campaigns are not charged it. By submitting a personalised version an advertiser accepts it.</div>
  </div>
)
const INTERACTIVE_TIP = (
  <div style={{ fontSize: 12 }}>
    What an advertiser pays each time someone engages with an interactive campaign — scanning its QR Control code to carry on with the brand on their own phone.
    <div className="mt-2">Charged per engagement, <b>on top of the CPM</b>: an interactive campaign still clears the <b>floor price</b> for its plays, and adds this for each scan. The advertiser’s floor multiplier does not scale it. Set it to 0 to leave engagements unpriced.</div>
  </div>
)

/* The auction cutoff, every half hour (UTC). */
const CUTOFF_TIMES = Array.from({ length: 48 }, (_, i) => {
  const t = `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`
  return { value: t, label: `${t} UTC` }
})

/* "7 days" / "24 hours" / "7 days 6 hours" — the play-window length, in the
   deferred-change callout below (Rob's board ticket, 26 Sep 2026). */
function formatDuration(hours: number) {
  const days = Math.floor(hours / 24)
  const rest = hours % 24
  const parts: string[] = []
  if (days) parts.push(`${days} day${days === 1 ? '' : 's'}`)
  if (rest || !days) parts.push(`${rest} hour${rest === 1 ? '' : 's'}`)
  return parts.join(' ')
}
/* "26 Sep 2026, 00:00 UTC" — every play window is anchored to UTC (Q13), so
   the effective date is shown in it rather than the viewer's own time zone.
   Date and time are formatted and joined separately (as formatSync does in
   DspPage.tsx), not via one combined toLocaleString call, so the join is
   always ", " rather than whatever a locale's combined pattern happens to
   use. */
function formatEffectiveDate(iso: string) {
  const t = new Date(iso)
  const date = t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  const time = t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' })
  return `${date}, ${time} UTC`
}

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

const IAB_OPTIONS = IAB_CATEGORIES.map((c) => ({ value: c, label: `${c} (${IAB_CATEGORY_CODES[c]})` }))
type ListKey = 'categoryWhitelist' | 'categoryBlacklist'
const OTHER: Record<ListKey, ListKey> = {
  categoryWhitelist: 'categoryBlacklist', categoryBlacklist: 'categoryWhitelist',
}

export function AdvertiserSettings() {
  const { draft, update, settings: savedView } = useSection()
  const s = draft.settings
  const set = <K extends keyof AdvertiserSettingsInput>(k: K, v: AdvertiserSettingsInput[K]) => update('settings', (x) => ({ ...x, [k]: v }))
  const add = (k: ListKey) => (name: string) => update('settings', (x) => {
    const r = addExclusive({ add: x[k], other: x[OTHER[k]] }, name)
    return { ...x, [k]: r.add, [OTHER[k]]: r.other }
  })
  const remove = (k: ListKey) => (name: string) => update('settings', (x) => ({ ...x, [k]: x[k].filter((y) => y !== name) }))
  const num = (k: 'floorCpm' | 'personalisedMultiplier' | 'interactiveCpe', step: number, ph: string, extra: { precision?: number; prefix?: string } = {}) => (
    <InputNumber
      id={k} className="w-full" step={step} min={0} placeholder={ph} {...extra}
      /* An amount to the cent keeps AntD's own formatting (0.50); the others
         only need the thousand separators suppressed. */
      {...(extra.precision === undefined ? { formatter: (v: unknown) => (v === undefined || v === null ? '' : String(v)), parser: (v: string | undefined) => Number(v) } : {})}
      value={s[k]} onChange={(v) => set(k, (v === null ? null : Number(v)) as number)}
    />
  )
  return (
    <>
      <SubPageHeader icon="rule" title="Advertiser settings" tip={ADVERTISER_SETTINGS_TIP} />

      <SectionLabel><WithTip tip="Effective floor = floor CPM × the advertiser's floor multiplier (set on Advertisers / Inventory), the same for every campaign type. Bids below it never win. The personalised multiplier is not part of it: it is charged on top of the committed price only when a personalised version plays. An interactive campaign clears the same floor and pays the cost per engagement on top.">Pricing</WithTip></SectionLabel>
      <div className="flex flex-wrap items-start gap-3.5">
        <Field label={<span className="block" style={{ minHeight: 36 }}>Currency</span>} htmlFor="currency" tip="Used for the floor CPM, every effective floor and billing. Bid requests carry it as the bid floor currency." className="w-56">
          <Select id="currency" className="w-full" showSearch optionFilterProp="label" value={s.currency} onChange={(v) => set('currency', v)} options={CURRENCIES} popupMatchSelectWidth={280} />
        </Field>
        <Field label={<span className="block" style={{ minHeight: 36 }}>Floor price (CPM)</span>} htmlFor="floorCpm" tip={FLOOR_TIP} tipWidth={400} className="w-32">{num('floorCpm', 1, '100')}</Field>
        <Field label={<span className="block" style={{ minHeight: 36 }}>Personalised multiplier</span>} htmlFor="personalisedMultiplier" tip={PERSONALISED_TIP} tipWidth={400} className="w-32">{num('personalisedMultiplier', 0.05, '1.5')}</Field>
        <Field label={<span className="block" style={{ minHeight: 36 }}>Interactive cost per engagement</span>} htmlFor="interactiveCpe" tip={INTERACTIVE_TIP} tipWidth={400} className="w-44">{num('interactiveCpe', 0.05, '0.50', { precision: 2, prefix: s.currency })}</Field>
      </div>

      <SectionLabel><WithTip tip="In-store screens can't take a bid per play, so advertisers bid for a play window that clears ahead of time. Bidding for a window opens, closes at the auction cutoff (when the auction runs) and the winner holds the slot for the whole window. Times are UTC.">Auction schedule</WithTip></SectionLabel>
      <div className="flex flex-wrap items-start gap-3.5">
        <Field label={<span className="block" style={{ minHeight: 36 }}>Auction opens</span>} htmlFor="auctionOpensHours" tip="How long before the auction cutoff bidding for a play window opens, for example 7 days." className="w-64">
          <DaysHours id="auctionOpensHours" hours={s.auctionOpensHours} onChange={(v) => set('auctionOpensHours', v)} />
        </Field>
        <Field label={<span className="block" style={{ minHeight: 36 }}>Play-window length</span>} htmlFor="playWindowHours" tip="The minimum period a won slot is held, in days and hours, for example 24 hours or 7 days. If any window is already bid on or booked, a change to this can't reach it — it takes effect once every one of those has played." className="w-64">
          <DaysHours id="playWindowHours" hours={s.playWindowHours} onChange={(v) => set('playWindowHours', v)} />
        </Field>
        <Field label={<span className="block" style={{ minHeight: 36 }}>Auction cutoff time</span>} htmlFor="auctionCutoffTime" tip="The daily time by which bids must be in. The auction for the next play window runs then; 18:00 gives six hours before a midnight window." className="w-36">
          <Select id="auctionCutoffTime" className="w-full" value={s.auctionCutoffTime} onChange={(v) => set('auctionCutoffTime', v)} options={CUTOFF_TIMES} />
        </Field>
      </div>
      {savedView.pendingPlayWindowHours != null && savedView.pendingPlayWindowEffectiveFrom && (
        <Callout tone="info" icon="schedule" className="mb-3.5">
          <b>Play-window length: change scheduled.</b> Every window already bid on or booked keeps its current {formatDuration(savedView.playWindowHours)} length.
          Once all of those have played — from <b>{formatEffectiveDate(savedView.pendingPlayWindowEffectiveFrom)}</b> onwards — new windows will be {formatDuration(savedView.pendingPlayWindowHours)} long instead.
        </Callout>
      )}

      <SectionLabel><WithTip tip="IAB category lists, managed once for the whole company and applied to every connected DSP: IAB is one taxonomy all of them speak. Entries are chosen from the IAB categories, never typed. Nothing can sit on both lists. The blacklist always applies and no position can opt out of it. Advertiser whitelists and blacklists are not here: each DSP manages its own, from the advertisers it syncs, on its own page.">Category lists</WithTip></SectionLabel>
      <div className="grid grid-cols-2 gap-3.5">
        <ListEditor label="Categories — whitelist" tone={T.success} icon="category" items={s.categoryWhitelist} options={IAB_OPTIONS} onAdd={add('categoryWhitelist')} onRemove={remove('categoryWhitelist')} empty="Empty — every category is eligible." addLabel="Choose an IAB category…" noneLeft="No IAB categories left to add" />
        <ListEditor label="Categories — blacklist" tone={T.error} icon="block" items={s.categoryBlacklist} options={IAB_OPTIONS} onAdd={add('categoryBlacklist')} onRemove={remove('categoryBlacklist')} empty="Empty — no category is blocked by default." addLabel="Choose an IAB category…" noneLeft="No IAB categories left to add" />
      </div>

    </>
  )
}

