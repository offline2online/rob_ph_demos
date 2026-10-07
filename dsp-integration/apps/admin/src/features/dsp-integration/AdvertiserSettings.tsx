/* Advertiser settings (spec §4, §5, §6): Pricing and the IAB category lists are
   edited here (advertiser lists are per DSP, on its own page); Where these apply is read-only. The inventory table moved to
   Advertisers / Inventory (Rob, 20 Sep). */
import { InputNumber, Select } from 'antd'
import { IAB_CATEGORIES, IAB_CATEGORY_CODES, INTERACTIVE_ENABLED, type AdvertiserSettingsInput } from '@ph-dsp/types'
import { type ReactNode, useMemo } from 'react'
import { Field } from '../../shared/Field'
import { WithTip } from '../../shared/InfoTip'
import { ListEditor, addExclusive } from '../../shared/ListEditor'
import { SectionLabel } from '../../shared/SectionLabel'
import { T } from '../../theme/phTheme'
import { useSection } from './DspIntegrationLayout'
import { SubPageHeader } from './SubPageHeader'

export const ADVERTISER_SETTINGS_TIP =
  "Company-wide advertiser settings, applied to every DSP. Configurable here: Pricing (currency, and floor CPM), Guaranteed deals (contingency buffer) and the Category lists. The Play config shows how plays, the one unit everything transacts in, are sold: per slot by real-time bidding, or as committed plays over a delivery term on a deal (IAB whitelists and blacklists; each DSP's advertiser lists are managed on its own page, from the advertisers it syncs). Read-only here: Where these apply (which DSPs use these lists or keep their own; unlink or relink on the DSP's page). Per-advertiser campaign approval and floor multipliers, and the inventory advertisers can buy, are on Advertisers / Inventory."

/* Every ISO 4217 currency, listed by code and name (spec §4). */
const CURRENCIES = (() => {
  const dn = new Intl.DisplayNames(['en-GB'], { type: 'currency' })
  return Intl.supportedValuesOf('currency').map((code) => ({ value: code, label: `${code} — ${dn.of(code) ?? code}` }))
})()

/* How a floor CPM turns into what an advertiser pays, in the floor and
   fee tooltips (Rob's board ticket, 19 Sep). One screen over a
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
    Cost per thousand assumed views (VAC-d). The platform floor is the minimum any bid must meet; bids below it never win. A DSP's floor (on its page) or a buyers list's floor can raise it for their own bids, never lower it.
  </FloorExample>
)
/* The fee relates itself to the floor price tooltip rather than repeating its working (Rob, 20 Sep). */
const INTERACTIVE_TIP = (
  <div style={{ fontSize: 12 }}>
    What an advertiser pays each time someone engages with an interactive campaign — scanning its QR Control code to carry on with the brand on their own phone.
    <div className="mt-2">Charged per engagement, <b>on top of the CPM</b>: an interactive campaign still clears the <b>floor price</b> for its plays, and adds this for each scan. The advertiser’s floor multiplier does not scale it. Set it to 0 to leave engagements unpriced.</div>
  </div>
)

/* "7 days" / "24 hours" / "7 days 6 hours": the derived time display of a play window. */
function formatHours(hours: number) {
  const days = Math.floor(hours / 24)
  const rest = hours % 24
  const parts: string[] = []
  if (days) parts.push(`${days} day${days === 1 ? '' : 's'}`)
  if (rest || !days) parts.push(`${rest} hour${rest === 1 ? '' : 's'}`)
  return parts.join(' ')
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
  const num = (k: 'floorCpm' | 'interactiveCpe', step: number, ph: string, extra: { precision?: number; prefix?: string } = {}) => (
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

      <SectionLabel><WithTip tip="Effective floor = the floor in force × the advertiser's floor multiplier. The floor in force is the platform floor here, unless a DSP or a buyers list sets a higher one for its own bids (the most specific wins; never below this) (set on Advertisers / Inventory), the same for every campaign type. Bids below it never win. Every play bills at the committed price, whatever version plays.">Pricing</WithTip></SectionLabel>
      <div className="flex flex-wrap items-start gap-3.5">
        <Field label={<span className="block" style={{ minHeight: 36 }}>Currency</span>} htmlFor="currency" tip="Used for the floor CPM, every effective floor and billing. Bid requests carry it as the bid floor currency." className="w-56">
          <Select id="currency" className="w-full" showSearch optionFilterProp="label" value={s.currency} onChange={(v) => set('currency', v)} options={CURRENCIES} popupMatchSelectWidth={280} />
        </Field>
        <Field label={<span className="block" style={{ minHeight: 36 }}>Platform floor price (CPM)</span>} htmlFor="floorCpm" tip={FLOOR_TIP} tipWidth={400} className="w-32">{num('floorCpm', 1, '100')}</Field>
        {INTERACTIVE_ENABLED && <Field label={<span className="block" style={{ minHeight: 36 }}>Interactive cost per engagement</span>} htmlFor="interactiveCpe" tip={INTERACTIVE_TIP} tipWidth={400} className="w-44">{num('interactiveCpe', 0.05, '0.50', { precision: 2, prefix: s.currency })}</Field>}
      </div>

      <SectionLabel><WithTip tip="A guaranteed deal commits a delivery volume: the window's forecast impressions (scheduled plays × audience score) less this contingency for screen downtime, so expected delivery sits above the guarantee and make-goods are rare. The committed figure is sent to the DSP as the guaranteed unit count. A preferred deal (the reserve price alone) promises no volume. Applies to every guaranteed deal.">Guaranteed deals</WithTip></SectionLabel>
      <div className="flex flex-wrap items-start gap-3.5">
        <Field label={<span className="block" style={{ minHeight: 36 }}>Contingency buffer (%)</span>} htmlFor="guaranteeBufferPct" tip="Percentage taken off the forecast to cover screen downtime. Default 10." className="w-40">
          <InputNumber id="guaranteeBufferPct" className="w-full" step={1} min={0} max={50} placeholder="10" value={s.guaranteeBufferPct ?? 10} onChange={(v) => set('guaranteeBufferPct', (v === null ? null : Number(v)) as number)} />
        </Field>
      </div>

      <SectionLabel><WithTip tip="How early a real-time slot's auction opens, so the winning creative can be downloaded and rendered before the slot plays. The auction is per slot, opened this long before that slot's own start, not on a schedule.">Real-time bidding</WithTip></SectionLabel>
      <div className="flex flex-wrap items-start gap-3.5">
        <Field label={<span className="block" style={{ minHeight: 36 }}>Bid lookahead</span>} htmlFor="bidLookaheadSeconds" tip="Seconds before a slot plays that its auction opens, for every real-time slot. Whole seconds, at least 1. Default 35, as Broadsign Reach, whose Real-Time Audience API sends bid requests about 35 seconds ahead of the expected programmatic slot." className="w-40">
          <InputNumber id="bidLookaheadSeconds" className="w-full" step={1} placeholder="35" suffix="seconds" value={s.bidLookaheadSeconds ?? 35} onChange={(v) => set('bidLookaheadSeconds', (v === null ? null : Number(v)) as number)} />
        </Field>
      </div>

      <SectionLabel><WithTip tip="Defaults the exchange offers when something new is set up. Nothing here changes an existing deal.">Play defaults</WithTip></SectionLabel>
      <div className="flex flex-wrap items-start gap-3.5">
        <Field label={<span className="block" style={{ minHeight: 36 }}>Default committed plays</span>} htmlFor="defaultCommittedPlays" tip="Pre-fills Committed plays when a new buyers list is created. It stays editable on each list and never changes a saved list or its 'N of M plays' delivery. Whole number, at least 1; leave empty for per play." className="w-56">
          <InputNumber id="defaultCommittedPlays" className="w-full" step={1} min={1} precision={0} placeholder="Per play" value={s.defaultCommittedPlays ?? null} onChange={(v) => set('defaultCommittedPlays', typeof v === 'number' ? v : null)} />
        </Field>
      </div>

      <SectionLabel><WithTip tip="A play is the one unit the exchange transacts in; time is shown only as a derived display. There is no auction to open or close, and nothing here is scheduled.">Play config</WithTip></SectionLabel>
      <div className="flex flex-wrap items-stretch gap-3.5 mb-3.5" role="group" aria-label="Play config">
        <div className="flex-1" style={{ minWidth: 260, border: `1px solid ${T.border}`, borderRadius: 6, padding: '10px 14px', fontSize: 13 }}>
          <div style={{ color: T.muted, fontSize: 12 }}>Real-time bidding</div>
          <div><b>Per play.</b> Each play of a slot is bid for as it comes up. No scheduled open or cutoff.</div>
        </div>
        <div className="flex-1" style={{ minWidth: 260, border: `1px solid ${T.border}`, borderRadius: 6, padding: '10px 14px', fontSize: 13 }}>
          <div style={{ color: T.muted, fontSize: 12 }}>Deals and reservations</div>
          <div><b>Committed plays over a delivery term.</b> Set on each deal; guaranteed deals use the contingency buffer above.</div>
        </div>
        <div className="flex-1" style={{ minWidth: 260, border: `1px solid ${T.border}`, borderRadius: 6, padding: '10px 14px', fontSize: 13 }}>
          <div style={{ color: T.muted, fontSize: 12 }}>Time (derived display only)</div>
          <div>Shown as a play window of <b>{formatHours(savedView.playWindowHours)}</b>, to turn plays into time on screen.</div>
        </div>
      </div>

      <SectionLabel><WithTip tip="IAB category lists, managed once for the whole company and applied to every connected DSP: IAB is one taxonomy all of them speak. Entries are chosen from the IAB categories, never typed. Nothing can sit on both lists. The blacklist always applies and no position can opt out of it. Advertiser whitelists and blacklists are not here: each DSP manages its own, from the advertisers it syncs, on its own page.">Category lists</WithTip></SectionLabel>
      <div className="grid grid-cols-2 gap-3.5">
        <ListEditor label="Categories — whitelist" tone={T.success} icon="category" items={s.categoryWhitelist} options={IAB_OPTIONS} onAdd={add('categoryWhitelist')} onRemove={remove('categoryWhitelist')} empty="Empty — every category is eligible." addLabel="Choose an IAB category…" noneLeft="No IAB categories left to add" />
        <ListEditor label="Categories — blacklist" tone={T.error} icon="block" items={s.categoryBlacklist} options={IAB_OPTIONS} onAdd={add('categoryBlacklist')} onRemove={remove('categoryBlacklist')} empty="Empty — no category is blocked by default." addLabel="Choose an IAB category…" noneLeft="No IAB categories left to add" />
      </div>

    </>
  )
}

