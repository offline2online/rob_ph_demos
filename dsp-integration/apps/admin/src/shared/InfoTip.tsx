/* Info icon whose tooltip explains the field, column or section it sits
   next to (spec "Help text"). Opens above, or below when there isn't room
   (AntD autoAdjustOverflow). Shows on hover and keyboard focus. */
import type { ReactNode } from 'react'
import { T } from '../theme/phTheme'
import { Icon } from './Icon'
import { Tip } from './Tip'

export function InfoTip({ text, size = 14, width = 280 }: { text: ReactNode; size?: number; width?: number }) {
  return (
    <Tip title={text} placement="top" autoAdjustOverflow styles={{ root: { maxWidth: width } }}>
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
    </Tip>
  )
}

/* A label with its InfoTip beside it. */
export const WithTip = ({ children, tip }: { children: ReactNode; tip: ReactNode }) => (
  <span className="inline-flex items-center gap-[5px]">
    {children}
    <InfoTip text={tip} />
  </span>
)
