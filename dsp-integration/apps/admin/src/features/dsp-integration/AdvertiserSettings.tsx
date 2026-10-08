/* Advertiser settings (spec §4, §5, §6): Pricing and the IAB category lists are
   edited here (advertiser lists are per DSP, on its own page); Where these apply is read-only. The inventory table moved to
   Advertisers / Inventory (Rob, 20 Sep). */
import { Input, InputNumber, Select, Switch } from 'antd'
import { IAB_CATEGORIES, IAB_CATEGORY_CODES, INTERACTIVE_ENABLED, type AdvertiserSettingsInput } from '@ph-dsp/types'
import { type ReactNode, useMemo } from 'react'
import { Field } from '../../shared/Field'
import { WithTip } from '../../shared/InfoTip'
import { ListEditor, addExclusive } from '../../shared/ListEditor'
import { SectionLabel } from '../../shared/SectionLabel'
import { T } from '../../theme/phTheme'
import { useSection } from './DspIntegrationLayout'
import { SubPageHeader } from './SubPageHeader'
import { GLOBAL_DEAL_ID, GLOBAL_DEAL_TIP } from './ExchangeSettings'

export const ADVERTISER_SETTINGS_TIP =
  "Company-wide advertiser settings, applied to every DSP. Configurable here: Pricing (floor CPM, always in USD); Play configuration (max slot length, default committed plays, guaranteed-deal buffer and the uncached-creative restriction); Real-time bidding (bid lookahead); and the Category lists (IAB whitelists and blacklists; each DSP's advertiser lists are managed on its own page, from the advertisers it syncs). Read-only here: Where these apply (which DSPs use these lists or keep their own; unlink or relink on the DSP's page). Per-advertiser campaign approval and floor multipliers, and the inventory advertisers can buy, are on Advertisers / Inventory."

/* The exchange transacts in USD on every instance (TRANSACTING_CURRENCY in the API's
   domain/currency.ts); company.currency is display/reporting only. Everything priced on
   this page is a bid floor, so it reads USD whatever the instance's own currency. */
const TRANSACTING_CURRENCY = 'USD'

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

/* The two committed-volume settings sit together; each tip says what it does and how it differs from the other. */
const BUFFER_TIP = (
  <div style={{ fontSize: 12 }}>
    Sets a <b>guaranteed deal’s</b> committed volume. It is never typed: the platform takes the slot’s VAC-d forecast and works out <b>floor(forecast × (1 − buffer %))</b>, so the buffer is the share held back for screen downtime and expected delivery sits above the guarantee.
    <div className="mt-2">The committed figure is sent to the DSP as the guaranteed unit count. Preferred deals promise no volume and ignore it. Applies to every guaranteed deal. 0 to 50, default 10. It does not touch a buyers list’s Committed plays.</div>
  </div>
)
const DEFAULT_PLAYS_TIP = (
  <div style={{ fontSize: 12 }}>
    A starting value for <b>Committed plays</b> on a <b>new buyers and targeting list</b>. It is only a default: never a cap, the field stays editable, and the list keeps its own figure.
    <div className="mt-2">It pre-fills a new list only. It never changes a saved list or any existing list, and a changed default is picked up by the next new list. It does not affect how a guaranteed deal’s volume is computed (that is the Guarantee buffer). Whole number, at least 1; leave empty for per play.</div>
  </div>
)

const UNCACHED_TIP = (
  <div style={{ fontSize: 12 }}>
    Bandwidth protection. Suppresses only <b>not-yet-cached</b> creatives from winning in the window: a bid wins there only if the player already holds its creative. Cached creative plays throughout, and outside the window everything bids as normal.
    <div className="mt-2"><b>Fixed hours</b>: restricted between the start and end every day, in UTC (a start after the end wraps past midnight). <b>Store trading hours</b>: restricted while the store is open, as the player reports it; no times to set, and a missing report never blocks a bid. <b>Off</b> (default): never restricted.</div>
  </div>
)
const UNCACHED_OPTIONS = [
  { value: 'off', label: 'Off' }, { value: 'fixed', label: 'Fixed hours' }, { value: 'store_open', label: 'Store trading hours' },
]

const IAB_OPTIONS = IAB_CATEGORIES.map((c) => ({ value: c, label: `${c} (${IAB_CATEGORY_CODES[c]})` }))
type ListKey = 'categoryWhitelist' | 'categoryBlacklist'
const OTHER: Record<ListKey, ListKey> = {
  categoryWhitelist: 'categoryBlacklist', categoryBlacklist: 'categoryWhitelist',
}

export function AdvertiserSettings() {
  const { draft, update } = useSection()
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
        <Field label={<span className="block" style={{ minHeight: 36 }}>Currency</span>} htmlFor="currency" tip="Fixed at USD on every instance: floors, reserves and bids are all transacted in USD, whatever currency this instance reports in. Bid requests carry USD as the bid floor currency." className="w-56">
          <Select id="currency" className="w-full" disabled value={TRANSACTING_CURRENCY} options={[{ value: TRANSACTING_CURRENCY, label: 'USD — US Dollar' }]} />
        </Field>
        <Field label={<span className="block" style={{ minHeight: 36 }}>Platform floor price (CPM, USD)</span>} htmlFor="floorCpm" tip={FLOOR_TIP} tipWidth={400} className="w-32">{num('floorCpm', 1, '100')}</Field>
        {INTERACTIVE_ENABLED && <Field label={<span className="block" style={{ minHeight: 36 }}>Interactive cost per engagement (USD)</span>} htmlFor="interactiveCpe" tip={INTERACTIVE_TIP} tipWidth={400} className="w-44">{num('interactiveCpe', 0.05, '0.50', { precision: 2, prefix: TRANSACTING_CURRENCY })}</Field>}
      </div>

      {/* Reach setting (9 Oct 2026, moved from Exchange settings): its own line, not part of Play configuration. */}
      <SectionLabel><WithTip tip={GLOBAL_DEAL_TIP}>Reach</WithTip></SectionLabel>
      <div className="mb-3.5 flex items-center justify-between border-b py-3" style={{ borderColor: T.divider }}>
        <label htmlFor="globalDealEnabled" style={{ fontSize: 14, color: T.text }}>Enable global deal</label>
        <Switch id="globalDealEnabled" checked={draft.exchange.globalDealEnabled === true} onChange={(on) => update('exchange', (x) => ({ ...x, globalDealEnabled: on }))} />
      </div>
      {draft.exchange.globalDealEnabled === true && (
        <div className="mb-3.5" style={{ fontSize: 14, color: T.text }}>
          Deal ID <code style={{ fontFamily: 'ui-monospace, monospace' }}>{GLOBAL_DEAL_ID}</code>: give this to a DSP that only transacts on deals.
        </div>
      )}

      <SectionLabel><WithTip tip="How many plays a slot offers and what a deal commits to. The company max slot length sets the default length of one play, which a display type and then a slot can override. The buffer decides a guaranteed deal's committed volume, worked out from the slot's forecast. The default seeds Committed plays on a new buyers list. They are separate: changing one never changes another.">Play configuration</WithTip></SectionLabel>
      <div className="flex flex-wrap items-start gap-3.5">
        <Field label={<span className="block" style={{ minHeight: 36 }}>Max play length</span>} htmlFor="maxPlayLengthSec" tip="The company-wide default length of one play of a slot, in seconds. A display type and then a slot can override it on Advertisers / Inventory (slot wins over display type, which wins over this). Plays per window are the billing unit divided by it × the slots playing in the loop (HQ slots included), whoever is booked; it applies to HQ campaigns too; a creative longer than it is rejected on upload, never trimmed. Whole seconds, 1 to 600. Default 15." className="w-56">
          <div className="flex items-center gap-2">
            <InputNumber id="maxPlayLengthSec" className="w-full" step={1} min={1} max={600} precision={0} placeholder="15" value={s.maxPlayLengthSec ?? 15} onChange={(v) => set('maxPlayLengthSec', (v === null ? null : Number(v)) as number)} />
            <span>seconds</span>
          </div>
        </Field>
      
        <Field label={<span className="block" style={{ minHeight: 36 }}>Guarantee buffer</span>} htmlFor="guaranteeBufferPct" tip={BUFFER_TIP} tipWidth={400} className="w-40">
          <div className="flex items-center gap-2">
            <InputNumber id="guaranteeBufferPct" className="w-full" step={1} min={0} max={50} placeholder="10" value={s.guaranteeBufferPct ?? 10} onChange={(v) => set('guaranteeBufferPct', (v === null ? null : Number(v)) as number)} />
            <span aria-hidden="true">%</span>
          </div>
        </Field>
        <Field label={<span className="block" style={{ minHeight: 36 }}>Default committed plays</span>} htmlFor="defaultCommittedPlays" tip={DEFAULT_PLAYS_TIP} tipWidth={400} className="w-56">
          <InputNumber id="defaultCommittedPlays" className="w-full" step={1} min={1} precision={0} placeholder="Per play" value={s.defaultCommittedPlays ?? null} onChange={(v) => set('defaultCommittedPlays', typeof v === 'number' ? v : null)} />
        </Field>
        <Field label={<span className="block" style={{ minHeight: 36 }}>Uncached creative restriction</span>} htmlFor="uncachedRestriction" tip={UNCACHED_TIP} tipWidth={400} className="w-56">
          <Select id="uncachedRestriction" className="w-full" value={s.uncachedRestriction ?? 'off'} options={UNCACHED_OPTIONS} onChange={(v) => set('uncachedRestriction', v)} />
        </Field>
        {s.uncachedRestriction === 'fixed' && (
          <Field label={<span className="block" style={{ minHeight: 36 }}>Restricted from (UTC)</span>} htmlFor="uncachedRestrictionStart" tip="Start of the daily restricted window, in UTC (HH:MM). A start after the end wraps past midnight." className="w-40">
            <Input id="uncachedRestrictionStart" type="time" value={s.uncachedRestrictionStart ?? '09:00'} onChange={(e) => e.target.value && set('uncachedRestrictionStart', e.target.value)} />
          </Field>
        )}
        {s.uncachedRestriction === 'fixed' && (
          <Field label={<span className="block" style={{ minHeight: 36 }}>Restricted until (UTC)</span>} htmlFor="uncachedRestrictionEnd" tip="End of the daily restricted window, in UTC (HH:MM, exclusive)." className="w-40">
            <Input id="uncachedRestrictionEnd" type="time" value={s.uncachedRestrictionEnd ?? '18:00'} onChange={(e) => e.target.value && set('uncachedRestrictionEnd', e.target.value)} />
          </Field>
        )}
      </div>

      <SectionLabel><WithTip tip="How early a real-time slot's auction opens, so the winning creative can be downloaded and rendered before the slot plays. The auction is per slot, opened this long before that slot's own start, not on a schedule.">Real-time bidding</WithTip></SectionLabel>
      <div className="flex flex-wrap items-start gap-3.5">
        <Field label={<span className="block" style={{ minHeight: 36 }}>Bid lookahead</span>} htmlFor="bidLookaheadSeconds" tip="Bid lookahead, in seconds: how long before a slot plays that its auction opens, for every real-time slot. Whole seconds, at least 1. Default 35, as Broadsign Reach, whose Real-Time Audience API sends bid requests about 35 seconds ahead of the expected programmatic slot." className="w-40">
          <div className="flex items-center gap-2">
            <InputNumber id="bidLookaheadSeconds" className="w-full" step={1} placeholder="35" value={s.bidLookaheadSeconds ?? 35} onChange={(v) => set('bidLookaheadSeconds', (v === null ? null : Number(v)) as number)} />
            <span>seconds</span>
          </div>
        </Field>
      </div>

      <SectionLabel><WithTip tip="IAB category lists, managed once for the whole company and applied to every connected DSP: IAB is one taxonomy all of them speak. Entries are chosen from the IAB categories, never typed. Nothing can sit on both lists. The blacklist always applies and no position can opt out of it. Advertiser whitelists and blacklists are not here: each DSP manages its own, from the advertisers it syncs, on its own page.">Category lists</WithTip></SectionLabel>
      <div className="grid grid-cols-2 gap-3.5">
        <ListEditor label="Categories — whitelist" tone={T.success} icon="category" items={s.categoryWhitelist} options={IAB_OPTIONS} onAdd={add('categoryWhitelist')} onRemove={remove('categoryWhitelist')} empty="Empty — every category is eligible." addLabel="Choose an IAB category…" noneLeft="No IAB categories left to add" />
        <ListEditor label="Categories — blacklist" tone={T.error} icon="block" items={s.categoryBlacklist} options={IAB_OPTIONS} onAdd={add('categoryBlacklist')} onRemove={remove('categoryBlacklist')} empty="Empty — no category is blocked by default." addLabel="Choose an IAB category…" noneLeft="No IAB categories left to add" />
      </div>

    </>
  )
}

