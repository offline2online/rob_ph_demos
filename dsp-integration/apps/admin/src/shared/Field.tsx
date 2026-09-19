/* Form field: label above the control, red * before the label when required
   (components.md §13), optional InfoTip beside it. */
import type { ReactNode } from 'react'
import { T } from '../theme/phTheme'
import { InfoTip } from './InfoTip'

export function Field({ label, required, tip, htmlFor, children, className }: { label: ReactNode; required?: boolean; tip?: ReactNode; htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 flex items-center gap-[5px]" style={{ fontSize: 14, color: T.muted }}>
        {required && <span style={{ color: T.error }}>*</span>}
        {label}
        {tip && <InfoTip text={tip} />}
      </label>
      {children}
    </div>
  )
}
