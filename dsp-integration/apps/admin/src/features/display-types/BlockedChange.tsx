/* A save the exchange refused because the change would break commitments
   (Q47): the assigned playlist, or the multi-zone layout, can't change while
   the display type's positions are reserved or sold for a current or future
   window. Same look as the delete dialog's blocked state — what is wrong, then
   each position and window in a list — with Close as the only action. */
import { Alert, Button, Modal } from 'antd'
import { Icon } from '../../shared/Icon'
import { T } from '../../theme/phTheme'

export interface BlockedChangeItem { kind: string; text: string }

export function BlockedChange({ name, message, items, onClose }: {
  name: string
  message: string
  items: BlockedChangeItem[]
  onClose: () => void
}) {
  const n = items.length
  return (
    <Modal
      open
      width={460}
      closable={false}
      onCancel={onClose}
      title={
        <span className="inline-flex items-center gap-2.5">
          <Icon name="block" size={20} style={{ color: T.warning }} />
          {`${name || 'This display type'} can't be changed`}
        </span>
      }
      footer={[<Button key="close" type="primary" onClick={onClose}>Close</Button>]}
    >
      <div style={{ fontSize: 13, lineHeight: 1.55 }}>
        <Alert
          className="mb-2.5"
          type="warning"
          message={
            <>
              <b>Your changes were not saved.</b> {message}{' '}
              {n > 0 && <>{n} play window{n > 1 ? 's are' : ' is'} reserved or sold. The change can be saved once {n > 1 ? 'they have' : 'it has'} played, or the booking is removed.</>}
            </>
          }
        />
        {n > 0 && (
          <ul aria-label="Reserved or sold slots" className="m-0 max-h-[180px] list-none overflow-y-auto rounded-md border p-0" style={{ borderColor: T.borderSubtle }}>
            {items.map((x, i) => (
              <li key={i} className="flex items-center gap-2 px-3 py-[7px]" style={{ fontSize: 12.5, borderBottom: i < n - 1 ? `1px solid ${T.borderSubtle}` : 'none' }}>
                <Icon name={x.kind === 'reservation' ? 'event_busy' : 'tv'} size={15} style={{ color: T.muted }} />
                <span>{x.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}
