/* One item in a collapsed panel's summary: coloured when something is
   enabled or changed, grey for defaults or "off" (spec §1). Outlined pill,
   components.md §5. */
import { T } from '../theme/phTheme'
import { Icon } from './Icon'

export function SummaryChip({ label, icon, tone = 'on', colour }: { label: string; icon?: string; tone?: 'on' | 'default'; colour?: string }) {
  const c = tone === 'on' ? (colour ?? T.primary) : T.muted
  return (
    <span
      data-tone={tone}
      className="inline-flex h-[22px] items-center gap-1 rounded-full px-2 whitespace-nowrap"
      style={{ fontSize: 11.5, border: `1px solid ${tone === 'on' ? c : T.border}`, color: c, background: tone === 'on' ? '#fff' : 'rgba(0,0,0,0.03)' }}
    >
      {icon && <Icon name={icon} size={13} />}
      {label}
    </span>
  )
}
