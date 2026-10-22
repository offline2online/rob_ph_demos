/* Delete confirmation (spec "Deleting"), shared by display types and
   playlists. When something still depends on the item, Delete is disabled
   and the only action is Close. */
import { Button, Modal } from 'antd'
import type { ReactNode } from 'react'
import { T } from '../theme/phTheme'
import { Icon } from './Icon'

export function DeleteDialog({ open, name, blockedReason, deleting, onDelete, onClose, children, action = 'Delete', icon = 'delete' }: {
  open: boolean
  name: string
  /* Set when something depends on the item: Delete is disabled, with this as its title. */
  blockedReason?: string | null
  deleting?: boolean
  onDelete: () => void
  onClose: () => void
  children: ReactNode
  /* The confirming verb and its icon, for a dialog that archives rather than deletes. */
  action?: string
  icon?: string
}) {
  const blocked = !!blockedReason
  return (
    <Modal
      open={open}
      width={460}
      closable={false}
      onCancel={onClose}
      title={
        <span className="inline-flex items-center gap-2.5">
          <Icon name={blocked ? 'block' : icon} size={20} style={{ color: blocked ? T.warning : T.error }} />
          {`${action} ${name}?`}
        </span>
      }
      footer={[
        <Button key="close" onClick={onClose}>
          {blocked ? 'Close' : 'Cancel'}
        </Button>,
        <Button key="confirm" type="primary" danger disabled={blocked} title={blockedReason ?? undefined} loading={deleting} onClick={onDelete}>
          {action}
        </Button>,
      ]}
    >
      <div style={{ fontSize: 13, lineHeight: 1.55 }}>{children}</div>
    </Modal>
  )
}
