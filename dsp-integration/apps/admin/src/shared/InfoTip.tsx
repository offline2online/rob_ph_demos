/* Info icon whose tooltip explains the field, column or section it sits
   next to (spec "Help text"). Opens above, or below when there isn't room
   (AntD autoAdjustOverflow). Shows on hover and keyboard focus. */
import { Tooltip } from 'antd'
import type { ReactNode } from 'react'
import { T } from '../theme/phTheme'
import { Icon } from './Icon'

export function InfoTip({ text, size = 14 }: { text: ReactNode; size?: number }) {
  return (
    <Tooltip title={text} placement="top" autoAdjustOverflow styles={{ root: { maxWidth: 280 } }} trigger={['hover', 'focus']}>
      <span
        role="button"
        tabIndex={0}
        aria-label={typeof text === 'string' ? text : 'More information'}
        onClick={(e) => e.stopPropagation()}
        className="inline-flex cursor-help items-center"
        style={{ color: T.micro, flexShrink: 0 }}
      >
        <Icon name="info" size={size} />
      </span>
    </Tooltip>
  )
}

/* A label with its InfoTip beside it. */
export const WithTip = ({ children, tip }: { children: ReactNode; tip: ReactNode }) => (
  <span className="inline-flex items-center gap-[5px]">
    {children}
    <InfoTip text={tip} />
  </span>
)
