/* Form field: label above the control, red * before the label when required
   (components.md §13), optional InfoTip beside it. */
import type { ReactNode } from 'react'
import { T } from '../theme/phTheme'
import { InfoTip } from './InfoTip'

export function Field({ label, required, tip, tipWidth, htmlFor, children, className }: { label: ReactNode; required?: boolean; tip?: ReactNode; tipWidth?: number; htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 flex items-center gap-[5px]" style={{ fontSize: 14, color: T.muted }}>
        {required && <span style={{ color: T.error }}>*</span>}
        {label}
        {tip && <InfoTip text={tip} width={tipWidth} />}
      </label>
      {children}
    </div>
  )
}
