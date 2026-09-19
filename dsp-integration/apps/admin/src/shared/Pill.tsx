/* Outlined status pill — components.md §5. */
import type { ReactNode } from 'react'
import { Icon } from './Icon'

export const StatusPill = ({ colour, icon, children }: { colour: string; icon?: string; children: ReactNode }) => (
  <span className="inline-flex h-[22px] items-center gap-1 rounded-full px-2 whitespace-nowrap" style={{ fontSize: 12, color: colour, border: `1px solid ${colour}`, background: '#fff' }}>
    {icon && <Icon name={icon} size={13} />}
    {children}
  </span>
)
