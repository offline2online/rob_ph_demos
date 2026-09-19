/* Draft vs saved state for a page (spec "Saving changes"): edits go to the
   draft; Save commits, Cancel restores the saved values. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { deepEqual } from './deepEqual'

export function useDraft<T>(saved: T | undefined) {
  const [draft, setDraft] = useState<T | undefined>(saved)
  const baseline = useRef(saved)
  /* A fresh server value replaces the draft only when the page has no edits. */
  useEffect(() => {
    if (saved === undefined) return
    setDraft((cur) => (cur === undefined || deepEqual(cur, baseline.current) ? saved : cur))
    baseline.current = saved
  }, [saved])
  const dirty = useMemo(() => draft !== undefined && saved !== undefined && !deepEqual(draft, saved), [draft, saved])
  const reset = useCallback(() => setDraft(baseline.current), [])
  return { draft, setDraft, dirty, reset }
}
