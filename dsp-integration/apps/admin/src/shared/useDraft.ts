/* Draft vs saved state for a page (spec "Saving changes"): edits go to the
   draft; Save commits, Cancel restores the saved values. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { deepEqual } from './deepEqual'

export function useDraft<T>(saved: T | undefined) {
  const [draft, setDraft] = useState<T | undefined>(saved)
  const baseline = useRef(saved)
  const committing = useRef(false)
  /* A fresh server value replaces the draft when the page has no edits, or
     right after a save (commitNext). */
  useEffect(() => {
    if (saved === undefined) return
    const replace = committing.current
    committing.current = false
    setDraft((cur) => (replace || cur === undefined || deepEqual(cur, baseline.current) ? saved : cur))
    baseline.current = saved
  }, [saved])
  /* Call once a save succeeded, before the saved value is refetched. */
  const commitNext = useCallback(() => {
    committing.current = true
  }, [])
  const dirty = useMemo(() => draft !== undefined && saved !== undefined && !deepEqual(draft, saved), [draft, saved])
  const reset = useCallback(() => setDraft(baseline.current), [])
  return { draft, setDraft, dirty, reset, commitNext }
}
