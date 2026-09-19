/* Delete confirmation (spec "Deleting"), shared by display types and
   playlists. When something still depends on the item, Delete is disabled
   and the only action is Close. */
import { Button, Modal } from 'antd'
import type { ReactNode } from 'react'
import { T } from '../theme/phTheme'
import { Icon } from './Icon'

export function DeleteDialog({ open, name, blockedReason, deleting, onDelete, onClose, children }: {
  open: boolean
  name: string
  /* Set when something depends on the item: Delete is disabled, with this as its title. */
  blockedReason?: string | null
  deleting?: boolean
  onDelete: () => void
  onClose: () => void
  children: ReactNode
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
          <Icon name={blocked ? 'block' : 'delete'} size={20} style={{ color: blocked ? T.warning : T.error }} />
          {`Delete ${name}?`}
        </span>
      }
      footer={[
        <Button key="close" onClick={onClose}>
          {blocked ? 'Close' : 'Cancel'}
        </Button>,
        <Button key="delete" type="primary" danger disabled={blocked} title={blockedReason ?? undefined} loading={deleting} onClick={onDelete}>
          Delete
        </Button>,
      ]}
    >
      <div style={{ fontSize: 13, lineHeight: 1.55 }}>{children}</div>
    </Modal>
  )
}
