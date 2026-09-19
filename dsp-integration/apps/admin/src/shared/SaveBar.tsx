/* Save changes / Cancel bar (spec "Saving changes"). Always visible at the
   bottom of the content column: position sticky, never fixed (the page is
   iframed into HQ Admin). Both actions are disabled until something changed. */
import { Button } from 'antd'
import { T } from '../theme/phTheme'
import { Icon } from './Icon'

export function SaveBar({ dirty, saving, onSave, onCancel }: { dirty: boolean; saving?: boolean; onSave: () => void; onCancel: () => void }) {
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
