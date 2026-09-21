/* A DSP Integration page's heading: icon, title with the tooltip that says
   what the page covers (spec Help text), and an optional status on the right. */
import type { ReactNode } from 'react'
import { Icon } from '../../shared/Icon'
import { WithTip } from '../../shared/InfoTip'
import { T } from '../../theme/phTheme'

export function SubPageHeader({ icon, iconColour = T.primary, title, tip, sub, right }: { icon: string; iconColour?: string; title: ReactNode; tip?: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-3">
      <Icon name={icon} size={26} style={{ color: iconColour, marginTop: 2 }} />
      <div className="min-w-[200px] flex-1">
        <h2 className="m-0" style={{ fontSize: 16, fontWeight: 600 }}>{tip ? <WithTip tip={tip}>{title}</WithTip> : title}</h2>
        {sub && <div className="mt-1" style={{ fontSize: 12, color: T.muted }}>{sub}</div>}
      </div>
      {right}
    </div>
  )
}
