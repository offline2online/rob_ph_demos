/* Delete a display type (spec §1): blocked while displays are assigned,
   listing them; otherwise permanent. A confirmed delete applies at once and
   leaves other unsaved changes as they were. */
import { Alert } from 'antd'
import type { DeleteCheck } from '@ph-dsp/types'
import { DeleteDialog } from '../../shared/DeleteDialog'
import { Icon } from '../../shared/Icon'
import { T } from '../../theme/phTheme'

export function DeleteDisplayType({ name, check, deleting, onDelete, onClose }: {
  name: string
  check: DeleteCheck
  deleting: boolean
  onDelete: () => void
  onClose: () => void
}) {
  const n = check.dependents.length
  return (
    <DeleteDialog
      open
      name={name || 'this display type'}
      blockedReason={check.canDelete ? null : 'Displays are assigned to this display type'}
      deleting={deleting}
      onDelete={onDelete}
      onClose={onClose}
    >
      {check.canDelete ? (
        <>This permanently deletes the display type and its settings. No displays are assigned to it. This can't be undone.</>
      ) : (
        <>
          <Alert
            className="mb-2.5"
            type="warning"
            message={
              <>
                <b>This display type can't be deleted.</b> {n} display{n > 1 ? 's are' : ' is'} assigned to it. Remove {n > 1 ? 'them' : 'it'} from the platform, or assign {n > 1 ? 'them' : 'it'} to another display type, first.
              </>
            }
          />
          <ul aria-label="Assigned displays" className="m-0 max-h-[180px] list-none overflow-y-auto rounded-md border p-0" style={{ borderColor: T.borderSubtle }}>
            {check.dependents.map((x, i) => (
              <li key={i} className="flex items-center gap-2 px-3 py-[7px]" style={{ fontSize: 12.5, borderBottom: i < n - 1 ? `1px solid ${T.borderSubtle}` : 'none' }}>
                <Icon name="tv" size={15} style={{ color: T.muted }} />
                <b>{x.name}</b>
                <span style={{ color: T.muted }}>· {x.detail}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </DeleteDialog>
  )
}
