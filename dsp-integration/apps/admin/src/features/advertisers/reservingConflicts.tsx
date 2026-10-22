/* Reserving deals never overlap on a slot (Rob, 22 Oct 2026): Programmatic guaranteed and Direct advertiser deals sell
   the slot outright. These ask the API (POST /admin/v1/reserving-conflicts, no write) before anything is saved, so the
   warning sits inline on the page, naming the other deal, its advertiser, the slot and the dates. The server refuses the save too (409). */
import { useQuery } from '@tanstack/react-query'
import type { ReservingConflict } from '@ph-dsp/types'
import { api } from '../../api/client'
import { Callout } from '../../shared/Callout'
import { flightMoment } from './effectiveTerm'

type Answer = { conflicts: ReservingConflict[]; candidates: Record<string, ReservingConflict[]> }
const NONE: Answer = { conflicts: [], candidates: {} }

/* A deal's flight against the other reserving deals on every slot it is on. */
export function useFlightConflicts(listId: string | undefined, dealType: string, activeFrom: string | null, activeTo: string | null, enabled: boolean): ReservingConflict[] {
  const q = useQuery({
    queryKey: ['reserving-conflicts', 'flight', listId, dealType, activeFrom, activeTo],
    queryFn: () => api<Answer>('POST', '/admin/v1/reserving-conflicts', { listId, dealType, activeFrom, activeTo }),
    enabled: enabled && !!listId, staleTime: 0, retry: false,
  })
  return enabled && Array.isArray(q.data?.conflicts) ? q.data.conflicts : []
}

/* A slot's would-be assignment: its conflicts, and what each candidate option would clash with. */
export function useSlotConflicts(slot: { displayTypeId: string; slot: number } | undefined, ids: string[], candidates: string[]): Answer {
  const q = useQuery({
    queryKey: ['reserving-conflicts', 'slot', slot?.displayTypeId, slot?.slot, ids, candidates],
    queryFn: () => api<Answer>('POST', '/admin/v1/reserving-conflicts', { displayTypeId: slot!.displayTypeId, slot: slot!.slot, buyersListIds: ids, candidates }),
    enabled: !!slot && (ids.length > 0 || candidates.length > 0), staleTime: 0, retry: false,
  })
  /* Anything but the contract's shape (an older API, the read-only snapshot) means no warning. */
  return q.data && Array.isArray(q.data.conflicts) ? { conflicts: q.data.conflicts, candidates: q.data.candidates ?? {} } : NONE
}

const date = (d: string | null, open: string) => d ?? open
/* With flight times (ticket yOginusgiFgFkwVHTRFH) a same-day clash is only visible in the hours, so the shared span is
   shown to the minute when the API gives it (overlapFromAt/overlapToAt), else by date (E2E 22 Oct 2026). */
export const rangeLabel = (c: Pick<ReservingConflict, 'overlapFrom' | 'overlapTo' | 'overlapFromAt' | 'overlapToAt'>) =>
  c.overlapFromAt || c.overlapToAt
    ? `${flightMoment(c.overlapFromAt ?? null) ?? 'the start'} to ${flightMoment(c.overlapToAt ?? null) ?? 'no end date'}`
    : c.overlapFrom && c.overlapFrom === c.overlapTo ? c.overlapFrom : `${date(c.overlapFrom, 'the start')} to ${date(c.overlapTo, 'no end date')}`

export function ConflictCallout({ conflicts, testId }: { conflicts: ReservingConflict[]; testId?: string }) {
  if (!conflicts.length) return null
  return (
    /* Wraps: inside Available Inventory's Assigned to cell AG Grid's nowrap cut it to one truncated line (E2E 21 Oct 2026); the row's autoHeight grows to fit. */
    <div className="mt-2 flex flex-col gap-2" style={{ whiteSpace: 'normal', overflowWrap: 'anywhere', lineHeight: 1.4 }} data-testid={testId ?? 'reserving-conflict'}>
      {conflicts.map((c) => (
        <Callout key={`${c.dealId}/${c.positionId}`} tone="warning" icon="event_busy">
          <strong>{c.dealName}</strong> ({c.advertiser}) already holds <strong>{c.playlist}, slot {c.slot}{c.slotLabel ? ` (${c.slotLabel})` : ''}</strong>: the slot is already sold for {rangeLabel(c)}. Change the dates or the slot to save.
        </Callout>
      ))}
    </div>
  )
}
