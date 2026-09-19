/* Status callout (components.md §17: AntD Alert). Status stays on the page,
   never in a tooltip (spec Help text). */
import { Alert } from 'antd'
import type { ReactNode } from 'react'
import { Icon } from './Icon'

export function Callout({ tone, icon, children, action, className }: { tone: 'info' | 'success' | 'warning' | 'error'; icon: string; children: ReactNode; action?: ReactNode; className?: string }) {
  return <Alert className={className} type={tone} showIcon icon={<Icon name={icon} size={18} />} message={<span style={{ fontSize: 13 }}>{children}</span>} action={action} />
}
