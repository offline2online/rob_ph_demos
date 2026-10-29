/* Committed volume and rate on a buyers list inherit platform default -> DSP -> buyers list (Rob, 7 Oct 2026),
   so the table and the modal never show them blank. The API resolves them per list (BuyersList.effective…);
   `resolveTerm` is the same rule for the modal's unsaved draft, whose invited buyers and own values the
   server hasn't seen yet. Rate is the base bid floor in USD CPM; volume is plays. */
import { impressionsOfPlays, isGuaranteedLike, valueOfImpressions, type BuyersList } from '@ph-dsp/types'

export type Term = BuyersList['effectiveCommittedPlays']
export type TermSource = Term['source']

export function resolveTerm(platform: number | null | undefined, dsp: (number | null | undefined)[], own: number | null | undefined, clamp: (n: number) => number = (n) => n): Term {
  const levels = (dsp.length ? dsp : [undefined]).map((d): { v: number | null; source: TermSource } =>
    typeof own === 'number' ? { v: own, source: 'buyer' } : typeof d === 'number' ? { v: d, source: 'dsp' } : typeof platform === 'number' ? { v: platform, source: 'platform' } : { v: null, source: 'none' })
  const values = levels.map((l) => l.v).filter((v): v is number => v !== null).map(clamp)
  const sources = new Set(levels.map((l) => l.source))
  return { min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null, source: sources.size === 1 ? [...sources][0] : 'mixed' }
}

/* A saved snapshot older than this field has no effective terms: treated as nothing resolved, never a crash. */
type MaybeTerm = Term | undefined
const SOURCE: Record<TermSource, string> = { buyer: 'set on this list', dsp: 'from the DSP', platform: 'platform default', mixed: 'varies by DSP', none: '' }
export const sourceLabel = (s: TermSource) => SOURCE[s]

const range = (t: MaybeTerm, f: (n: number) => string) => (!t || t.min === null || t.max === null ? null : t.min === t.max ? f(t.min) : `${f(t.min)}–${f(t.max)}`)
export const rateText = (t: MaybeTerm) => { const r = range(t, (n) => String(n)); return r === null ? null : `USD ${r} CPM` }
/* The Rate column's number on its own; the Rate type (DV360's wording) sits beside it. */
export const rateValue = (t: MaybeTerm) => { const r = range(t, (n) => String(n)); return r === null ? null : `USD ${r}` }

/* Floor or committed (8 Oct 2026): a private auction's CPM is the minimum an invited buyer must bid above (the clearing
   price can land higher until the deal locks); a preferred or guaranteed deal's is the fixed rate the window clears and bills at. */
type DealType = BuyersList['dealType']
export const cpmKind = (d: DealType | undefined) => (d === 'preferred' || isGuaranteedLike(d) ? 'committed' : 'floor')
/* Rate type, in DV360's words (ticket DbSVEGXNIWlYW68UQnY3): CPM floor for a Private auction, CPM fixed for a Preferred deal and Programmatic guaranteed. */
export const rateTypeOf = (d: DealType | undefined, termTotal?: number | null) => (isGuaranteedLike(d) && termTotal != null ? 'Fixed per term' : cpmKind(d) === 'floor' ? 'CPM floor' : 'CPM fixed')
/* Programmatic guaranteed covers a whole delivery term (21 Oct 2026; one deal per flight): priced as a fixed CPM, or a total for the term with the CPM it works out to beside it for comparison with CPM deals. */
export const TERM_TOTAL_HINT = 'A fixed USD total for the whole delivery term, however many days and slots. The CPM it works out to is shown beside it for comparison with CPM deals.'
export const termTotalText = (n: number | null | undefined) => (n == null ? null : `USD ${n.toLocaleString('en-US')} for the term`)
export const equivalentCpmText = (e: { min: number; max: number } | null | undefined) => (!e ? null : e.min === e.max ? `${e.min}` : `${e.min}–${e.max}`)
export const cpmKindHint = (d: DealType | undefined, termTotal?: number | null) =>
  isGuaranteedLike(d) && termTotal != null
    ? `Fixed per term: ${TERM_TOTAL_HINT}`
    : cpmKind(d) === 'floor'
    ? 'CPM floor: the minimum a buyer must bid above. The clearing price can land higher until the deal locks.'
    : 'CPM fixed: the fixed rate this window clears and bills at.'
/* One line for a list, e.g. "USD 4–6 · CPM floor", or the locked rate once the deal has one. */
export const cpmSummary = (l: Pick<BuyersList, 'dealType' | 'lockedWin' | 'effectiveRateCpm' | 'termTotal' | 'equivalentCpm'>) => {
  if (l.lockedWin) return `Locked: ${l.lockedWin.cpm} CPM`
  if (isGuaranteedLike(l.dealType) && l.termTotal != null) return `${termTotalText(l.termTotal)}${l.equivalentCpm ? ` (≈ ${equivalentCpmText(l.equivalentCpm)} CPM)` : ''} · Fixed per term`
  const t = rateValue(l.effectiveRateCpm)
  return t ? `${t} · ${rateTypeOf(l.dealType)}` : null
}
/* PH's share status and buyer acceptance in DV360's wording: a shared deal is Pending until the buyers hold the current terms, then Active. */
export const buyerStatusOf = (l: Pick<BuyersList, 'status' | 'termVersion' | 'buyerAcceptance'>): { label: 'Pending' | 'Active'; reacceptance: boolean } | null => {
  if (l.status !== 'shared') return null
  const acc = l.buyerAcceptance ?? []
  const active = acc.length > 0 && acc.every((a) => a.state === 'accepted' && a.acceptedVersion === l.termVersion)
  return { label: active ? 'Active' : 'Pending', reacceptance: acc.some((a) => a.state === 'reacceptance_required') }
}

/* A flight moment as saved (22 Oct 2026): the stored date and time, never converted to the browser's zone, e.g. "1 Nov 2026 09:00". */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const flightMoment = (iso: string | null): string | null => (iso ? `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)} ${iso.slice(11, 16)}` : null)
/* The time zone mode shown wherever a flight is displayed. */
export const TIME_ZONE_LABEL = { platform: 'Platform time zone', store: 'Local store time' } as const
export const zoneLabelOf = (mode: 'platform' | 'store' | undefined) => TIME_ZONE_LABEL[mode ?? 'platform']

/* Details column (ticket nfDLP1CZiPjGfN8FG764, 21 Oct 2026): what a deal delivers over its whole flight, for the hover.
   Signage, so plays are the measure: a slot's plays = plays per window per display x displays x windows a day x days in the flight
   (calendar days, both ends included, as the API counts a term). Value follows the one pricing formula (28 Oct 2026): plays x VAC-d per
   play = impressions, and impressions / 1,000 x the CPM; or the term total split across the slots by their share of the impressions.
   A floor is the lowest value the deal can settle at, so it is flagged as "from". */
export type DetailSlot = { playsPerWindow: number | null; displayCount: number | null; windowHours: number; vacdPerPlay?: number | null }
export const flightDays = (from: string | null | undefined, to: string | null | undefined): number | null => {
  if (!from || !to) return null
  const a = Date.parse(from.slice(0, 10)), b = Date.parse(to.slice(0, 10))
  return Number.isNaN(a) || Number.isNaN(b) || b < a ? null : Math.round((b - a) / 86_400_000) + 1
}
export const slotPlaysOver = (s: DetailSlot, days: number | null): number | null =>
  days == null || s.playsPerWindow == null || s.displayCount == null || !(s.windowHours > 0) ? null : Math.round(s.playsPerWindow * s.displayCount * (24 / s.windowHours) * days)
/* Impressions a slot delivers over the flight: its plays x its VAC-d per play. Null when either is unknown. */
export const slotImpressionsOver = (s: DetailSlot, days: number | null): number | null => {
  const plays = slotPlaysOver(s, days)
  return plays == null || s.vacdPerPlay == null ? null : Math.round(impressionsOfPlays(plays, s.vacdPerPlay))
}
export type DealValue = { min: number; max: number; from: boolean }
type ValueList = Pick<BuyersList, 'dealType' | 'lockedWin' | 'effectiveRateCpm' | 'termTotal'>
/* The deal's value for `impressions` impressions (the whole deal's, or one slot's share of a term total); null with no rate to price at. */
export const valueOf = (l: ValueList, impressions: number, totalImpressions: number): DealValue | null => {
  if (l.lockedWin) { const v = valueOfImpressions(impressions, l.lockedWin.cpm); return { min: v, max: v, from: false } }
  if (isGuaranteedLike(l.dealType) && l.termTotal != null) { const v = totalImpressions > 0 ? (l.termTotal * impressions) / totalImpressions : 0; return { min: v, max: v, from: false } }
  const r = l.effectiveRateCpm
  return !r || r.min === null || r.max === null ? null : { min: valueOfImpressions(impressions, r.min), max: valueOfImpressions(impressions, r.max), from: cpmKind(l.dealType) === 'floor' }
}
export const valueText = (v: DealValue | null) => {
  if (!v) return null
  const f = (n: number) => Math.round(n).toLocaleString('en-US')
  return `${v.from ? 'from ' : ''}USD ${Math.round(v.min) === Math.round(v.max) ? f(v.min) : `${f(v.min)}–${f(v.max)}`}`
}

/* The deal's total value for a campaign's hover (Campaign Approval): a term total as set, otherwise the committed IMPRESSIONS priced at the
   deal's rate: impressions / 1,000 x CPM (a range when the rate varies). Null when the deal has no committed volume or rate yet - the hover then says so. */
export const dealTotalValueText = (l: ValueList & Pick<BuyersList, 'committedImpressions'>): string | null => {
  if (isGuaranteedLike(l.dealType) && l.termTotal != null) return valueText(valueOf(l, 1, 1))
  const imps = l.committedImpressions
  return imps == null ? null : valueText(valueOf(l, imps, imps))
}

/* Delivery pacing for a Programmatic guaranteed deal (Booking schedule hover, ticket CXmiVdLcDzkcojpSnJic, 27 Oct 2026). Impressions are the
   measure since 28 Oct 2026 (Programmatic guaranteed commits impressions, as the industry does; plays are the delivery plan shown beside them).
   Delivered = impressions billed so far (realised VAC-d); due = the committed impressions x the share of the flight elapsed; pacing = delivered / due. Within 5% of due is on pace. Null when the deal commits nothing or has an open flight (nothing to pace
   against); "not started" before the flight begins. Flight moments are compared as saved (no zone conversion), so the share is approximate
   to within the zone offset. */
export const PACING_TOLERANCE = 0.05
export type Pacing = { delivered: number; committed: number; status: 'not started' | 'on pace' | 'behind' | 'ahead'; pct: number | null }
export const pacingOf = (l: Pick<BuyersList, 'dealType' | 'committedImpressions' | 'deliveredImpressions' | 'activeFrom' | 'activeTo'>, now: number): Pacing | null => {
  if (l.dealType !== 'guaranteed' || l.committedImpressions == null || !(l.committedImpressions > 0)) return null
  const delivered = l.deliveredImpressions ?? 0
  const base = { delivered, committed: l.committedImpressions }
  if (!l.activeFrom || !l.activeTo) return null
  const start = Date.parse(l.activeFrom), end = Date.parse(l.activeTo)
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null
  if (now < start) return { ...base, status: 'not started', pct: null }
  const due = l.committedImpressions * Math.min(1, (now - start) / (end - start))
  const ratio = delivered / due
  return { ...base, status: Math.abs(ratio - 1) <= PACING_TOLERANCE ? 'on pace' : ratio < 1 ? 'behind' : 'ahead', pct: Math.round(ratio * 100) }
}

/* A flight as the Booking schedule hover reads it: start → end with times and the time zone. */
export const flightText = (l: Pick<BuyersList, 'activeFrom' | 'activeTo' | 'timeZoneMode'>): string =>
  l.activeFrom || l.activeTo ? `${flightMoment(l.activeFrom) ?? 'No start date'} → ${flightMoment(l.activeTo) ?? 'No end date'} (${zoneLabelOf(l.timeZoneMode)})` : 'Always active'
