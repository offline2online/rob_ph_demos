/* Committed volume and rate on a buyers list inherit platform default -> DSP -> buyers list (Rob, 7 Oct 2026),
   so the table and the modal never show them blank. The API resolves them per list (BuyersList.effective…);
   `resolveTerm` is the same rule for the modal's unsaved draft, whose invited buyers and own values the
   server hasn't seen yet. Rate is the base bid floor in USD CPM; volume is plays. */
import type { BuyersList } from '@ph-dsp/types'

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
export const playsText = (t: MaybeTerm) => { const r = range(t, (n) => n.toLocaleString()); return r === null ? null : `${r} plays` }
export const rateText = (t: MaybeTerm) => { const r = range(t, (n) => String(n)); return r === null ? null : `USD ${r} CPM` }

/* Floor or committed (8 Oct 2026): a private auction's CPM is the minimum an invited buyer must bid above (the clearing
   price can land higher until the deal locks); a preferred or guaranteed deal's is the fixed rate the window clears and bills at. */
type DealType = BuyersList['dealType']
export const cpmKind = (d: DealType | undefined) => (d === 'preferred' || d === 'guaranteed' ? 'committed' : 'floor')
export const cpmKindHint = (d: DealType | undefined) =>
  cpmKind(d) === 'floor'
    ? 'Floor CPM: the minimum an invited buyer must bid above. The clearing price can land higher until the deal locks.'
    : 'Committed CPM: the fixed rate this window clears and bills at.'
/* One line for a list, e.g. "USD 4–6 CPM floor", or the locked rate once the deal has one. */
export const cpmSummary = (l: Pick<BuyersList, 'dealType' | 'lockedWin' | 'effectiveRateCpm'>) => {
  if (l.lockedWin) return `Locked: ${l.lockedWin.cpm} CPM`
  const t = rateText(l.effectiveRateCpm)
  return t ? `${t} ${cpmKind(l.dealType)}` : null
}
