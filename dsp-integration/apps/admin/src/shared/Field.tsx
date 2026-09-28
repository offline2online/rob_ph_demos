/* Form field: label above the control, red * before the label when required
   (components.md §13), optional InfoTip beside it, and an optional action
   (a button) at the right-hand end of the label row. */
import type { ReactNode } from 'react'
import { T } from '../theme/phTheme'
import { InfoTip } from './InfoTip'

export function Field({ label, required, tip, tipWidth, htmlFor, action, children, className }: { label: ReactNode; required?: boolean; tip?: ReactNode; tipWidth?: number; htmlFor?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  const labelEl = (
    <label htmlFor={htmlFor} className={`${action ? '' : 'mb-1.5 '}flex items-center gap-[5px]`} style={{ fontSize: 14, color: T.muted }}>
      {required && <span style={{ color: T.error }}>*</span>}
      {label}
      {tip && <InfoTip text={tip} width={tipWidth} />}
    </label>
  )
  return (
    <div className={className}>
      {/* The action sits beside the label, not inside it: a click on a
          <label> is forwarded to its control. */}
      {action ? <div className="mb-1.5 flex items-center justify-between gap-2">{labelEl}{action}</div> : labelEl}
      {children}
    </div>
  )
}
