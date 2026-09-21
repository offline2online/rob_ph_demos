/* Save changes / Cancel bar (spec "Saving changes"). Always visible at the
   bottom of the content column: position sticky, never fixed (the page is
   iframed into HQ Admin). Both actions are disabled until something changed.
   With `saveOnEnter`, pressing Enter in a field on the page saves, the same
   as Save changes (Rob's board ticket, for the Display Types pages). */
import { Button } from 'antd'
import { useEffect, useRef } from 'react'
import { T } from '../theme/phTheme'
import { Icon } from './Icon'

/* Enter saves only from a plain field: not a text area, not a dropdown or
   date picker (Enter picks there), not inside a dialog, and not when the
   field already handled Enter itself (e.g. a list's "add" input). */
export function savesOnEnter(e: KeyboardEvent) {
  if (e.key !== 'Enter' || e.defaultPrevented || e.isComposing || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return false
  const t = e.target as HTMLElement | null
  if (!(t instanceof HTMLInputElement) || ['checkbox', 'radio', 'button', 'submit', 'file'].includes(t.type)) return false
  return !t.closest('.ant-select, .ant-picker, .ant-modal, [role="dialog"]')
}

export function SaveBar({ dirty, saving, onSave, onCancel, saveOnEnter }: { dirty: boolean; saving?: boolean; onSave: () => void; onCancel: () => void; saveOnEnter?: boolean }) {
  const latest = useRef({ dirty, saving, onSave })
  latest.current = { dirty, saving, onSave }
  useEffect(() => {
    if (!saveOnEnter) return
    /* On the document, so a field's own Enter handling runs (and can prevent this) first. */
    const onKey = (e: KeyboardEvent) => {
      const { dirty: d, saving: busy, onSave: save } = latest.current
      if (!d || busy || !savesOnEnter(e)) return
      e.preventDefault()
      save()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [saveOnEnter])
  return (
    <div
      role="region"
      aria-label="Save changes"
      className="sticky bottom-0 z-[5] mt-6 flex items-center gap-2 border-t bg-white py-3"
      style={{ borderColor: T.borderSubtle }}
    >
      <span className="inline-flex flex-1 items-center gap-1.5" style={{ fontSize: 12.5, color: dirty ? T.warning : T.micro }}>
        <Icon name={dirty ? 'edit_note' : 'check'} size={16} />
        {dirty ? 'You have unsaved changes.' : 'No changes to save.'}
      </span>
      <Button onClick={onCancel} disabled={!dirty || saving}>
        Cancel
      </Button>
      <Button type="primary" onClick={onSave} disabled={!dirty} loading={saving}>
        Save changes
      </Button>
    </div>
  )
}
