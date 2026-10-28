/* The deal hover shared by the Deals and buyers lists Details column and the Booking schedule tile (ticket CXmiVdLcDzkcojpSnJic,
   27 Oct 2026): one component so the two never differ. The body is the Details hover of ticket nfDLP1CZiPjGfN8FG764, moved here
   unchanged: a compact, programmatic read of the deal over its whole flight. It does not repeat the Slots hover (per-window slot
   copy): per slot it gives only the total plays and total value, then the deal's total. */
import { isGuaranteedLike, type BuyersList, type StoreZone } from '@ph-dsp/types'
import type { ReactNode } from 'react'
import { flightDays, flightMoment, rateTypeOf, rateValue, slotImpressionsOver, slotPlaysOver, sourceLabel, termTotalText, valueOf, valueText, zoneLabelOf, type DetailSlot } from './effectiveTerm'

/* Secondary text inside a Tip (dark background). */
export const TIP_MUTED = 'rgba(255,255,255,0.65)'
export const DEAL_TYPE_LABELS = { private_auction: 'Private auction', preferred: 'Preferred deal', guaranteed: 'Programmatic guaranteed', direct: 'Direct advertiser' } as const
export const MAX_TIP_SLOTS = 5
export const num = (n: number) => n.toLocaleString('en-US')

/* A slot a deal is assigned to, with what the hover needs to count its plays. */
export type DealSlot = DetailSlot & { displayType: string; description: string | null; storeZone: StoreZone | null; orientation?: 'landscape' | 'portrait' | null; zoneName: string | null; playlist: string; position: string; slot: number }

/* The figures behind both the cell and the hover. The rate the deal locked in, once it has one; until then the rate it inherits
   platform -> DSP -> this list, so it is never blank. */
export function dealFigures(data: BuyersList, slots: DealSlot[]) {
  const perTerm = isGuaranteedLike(data.dealType) && data.termTotal != null
  const rate = data.lockedWin ? `Locked: ${data.lockedWin.cpm} CPM` : perTerm ? termTotalText(data.termTotal) : rateValue(data.effectiveRateCpm)
  const rateType = data.lockedWin ? '' : rateTypeOf(data.dealType, data.termTotal)
  const typeLabel = DEAL_TYPE_LABELS[data.dealType] ?? 'Private auction'
  const days = flightDays(data.activeFrom, data.activeTo)
  const plays = slots.map((s) => slotPlaysOver(s, days))
  const impressions = slots.map((s) => slotImpressionsOver(s, days))
  const counted = plays.filter((n): n is number => n !== null)
  const totalPlays = counted.reduce((a, n) => a + n, 0)
  const countedImps = impressions.filter((n): n is number => n !== null)
  const totalImpressions = countedImps.reduce((a, n) => a + n, 0)
  const complete = slots.length > 0 && counted.length === slots.length && countedImps.length === slots.length
  const total = complete ? valueText(valueOf(data, totalImpressions, totalImpressions)) : null
  return { perTerm, rate, rateType, typeLabel, days, plays, impressions, totalPlays, totalImpressions, complete, total }
}

export function DealDetailsTip({ data, slots, seatName, showFlight = true, pacing }: { data: BuyersList; slots: DealSlot[]; seatName: (partnerId: string, seatId: string) => string; showFlight?: boolean; pacing?: ReactNode }) {
  const { perTerm, rate, rateType, typeLabel, days, plays, impressions, totalPlays, totalImpressions, complete, total } = dealFigures(data, slots)
  const src = sourceLabel(data.effectiveRateCpm?.source ?? 'none')
  const flight = data.activeFrom || data.activeTo ? `${flightMoment(data.activeFrom) ?? 'No start date'} → ${flightMoment(data.activeTo) ?? (data.activeFrom ? 'No end date (always active)' : 'No end date')} (${zoneLabelOf(data.timeZoneMode)})` : 'Always active'
  /* The hover sits on the tooltip's dark background, where T.muted (black at 45%) is invisible (E2E 22 Oct 2026): secondary text is white at 65% there. */
  const sub = (l: string, v: string) => <div><span style={{ color: TIP_MUTED }}>{l}: </span>{v}</div>
  return (
    <div data-testid={`details-tip-${data.id}`}>
      <div style={{ fontWeight: 500 }}>{typeLabel}</div>
      {sub('Rate', `${rate ?? 'Per play'}${rateType ? ` ${rateType}` : ''}${src && !perTerm && !data.lockedWin ? ` (${src})` : ''}`)}
      {showFlight && sub('Flight', flight)}
      {data.endKind === 'ended_early' && <>
        {sub('Ended early', `ends ${flightMoment(data.activeTo)} (was ${data.originalActiveTo ? flightMoment(data.originalActiveTo) : 'open-ended'})`)}
        {data.endReason && sub('Reason', data.endReason)}
        {perTerm && data.termTotal != null && <div data-testid={`ended-values-${data.id}`}>{sub('Original total', termTotalText(data.termTotal) ?? '')}{data.deliveredValue != null && sub('Delivered to date', valueText({ min: data.deliveredValue, max: data.deliveredValue, from: false }) ?? '')}</div>}
      </>}
      {data.endKind === 'cancelled' && <>{sub('Cancelled', flightMoment(data.endRequestedAt ?? null) ?? '')}{data.endReason && sub('Reason', data.endReason)}</>}
      {sub('Period', days == null ? (data.activeFrom && !data.activeTo ? 'No end date (always active)' : data.activeFrom || data.activeTo ? 'Open flight' : 'Always active') : `${num(days)} day${days === 1 ? '' : 's'}`)}
      {data.dealType === 'direct' && <>
        {sub('Advertiser', data.invitedBuyers.length ? seatName(data.invitedBuyers[0].partnerId, data.invitedBuyers[0].seatId) : 'None yet')}
        {sub('Deal ID', data.dealId)}
      </>}
      <div style={{ marginTop: 6, fontWeight: 500 }}>Over the whole flight</div>
      {!slots.length ? <div>No assigned slots.</div>
        : days == null ? <div>Set a start and an end date to total the plays and value.</div>
        : <>
          {slots.slice(0, MAX_TIP_SLOTS).map((s, i) => {
            const p = plays[i], imp = impressions[i]
            const v = imp === null || !complete ? null : valueText(valueOf(data, imp, totalImpressions))
            return <div key={i} data-testid={`details-slot-${data.id}-${i}`}>{s.displayType} · slot {s.slot}: {p === null ? 'plays n/a' : `${num(p)} plays`}{imp === null ? '' : ` · ${num(imp)} impressions`}{v ? ` · ${v}` : ''}</div>
          })}
          {slots.length > MAX_TIP_SLOTS && <div style={{ color: TIP_MUTED }}>+ {slots.length - MAX_TIP_SLOTS} more slot{slots.length - MAX_TIP_SLOTS === 1 ? '' : 's'}</div>}
          <div style={{ marginTop: 4, fontWeight: 500 }} data-testid={`details-total-${data.id}`}>Deal total: {complete ? `${num(totalPlays)} plays · ${num(totalImpressions)} impressions${total ? ` · ${total}` : ''}` : 'not available for every slot'}</div>
          {!perTerm && !data.lockedWin && <div style={{ color: TIP_MUTED }}>Value = plays × VAC-d ÷ 1,000 × CPM (impressions ÷ 1,000 × CPM).</div>}
        </>}
      {pacing}
    </div>
  )
}
