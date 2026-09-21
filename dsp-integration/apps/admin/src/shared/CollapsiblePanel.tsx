/* Collapsible section — components.md §14 (bordered card, grey header strip,
   chevron, ALL CAPS title). The collapsed header carries summary chips. */
import type { ReactNode } from 'react'
import { T } from '../theme/phTheme'
import { Icon } from './Icon'

export function CollapsiblePanel({ title, open, onToggle, summary, badge, children }: {
  title: string
  open: boolean
  onToggle: () => void
  summary?: ReactNode
  badge?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="mt-4 overflow-hidden rounded-lg border" style={{ borderColor: T.borderSubtle }} aria-label={title}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onToggle())}
        className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-3"
        style={{ background: T.surfaceAlt, borderBottom: open ? `1px solid ${T.borderSubtle}` : 'none', fontSize: 13, letterSpacing: '0.3px' }}
      >
        <Icon name={open ? 'expand_more' : 'chevron_right'} size={18} style={{ color: T.muted }} />
        <span className="uppercase" style={{ minWidth: 150 }}>{title}</span>
        <span className="flex flex-1 flex-wrap items-center gap-1.5" style={{ letterSpacing: 0 }}>{summary}</span>
        {badge}
      </div>
      {open && <div className="p-4">{children}</div>}
    </section>
  )
}
