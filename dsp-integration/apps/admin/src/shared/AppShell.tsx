/* The prototype's content frame: page title, divider, then its own left
   navigation beside the page. No platform header, sidebar or breadcrumb —
   HQ Admin iframes this page (ph-designer prototyping.md). */
import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { T } from '../theme/phTheme'
import { Icon } from './Icon'
import { useViewportWidth } from './useViewportWidth'

export interface NavItem { to: string; label: string; icon: string }

/* Below this frame width the nav contracts to icons only (prototype). */
export const NAV_COLLAPSE_BELOW = 900

export function AppShell({ title, nav, children }: { title: ReactNode; nav: NavItem[]; children: ReactNode }) {
  const collapsed = useViewportWidth() < NAV_COLLAPSE_BELOW
  return (
    <div className="min-h-screen w-full bg-white p-5" style={{ color: T.text, fontSize: 14 }}>
      <div className="truncate text-xl font-bold">{title}</div>
      <div className="my-4 h-px" style={{ background: T.divider }} />
      <div className="flex items-start">
        <nav
          aria-label="Display Types and DSP Integration"
          className="sticky top-5 shrink-0 overflow-x-hidden overflow-y-auto border-r"
          style={{ width: collapsed ? 56 : 230, maxHeight: 'calc(100vh - 40px)', borderColor: T.borderSubtle, transition: 'width .15s' }}
        >
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              title={collapsed ? n.label : undefined}
              className="flex items-center gap-2 no-underline"
              style={({ isActive }) => ({
                padding: collapsed ? '12px 0' : '12px 16px',
                justifyContent: collapsed ? 'center' : 'flex-start',
                color: isActive ? T.primary : T.text,
                background: isActive ? T.primaryTint : 'transparent',
              })}
            >
              <Icon name={n.icon} size={18} />
              {!collapsed && n.label}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0 flex-1 pl-5">{children}</div>
      </div>
    </div>
  )
}
