/* The prototype's content frame: page title, divider, then its own left
   navigation beside the page (an empty `nav` skips the nav column entirely,
   for a route that stands alone in its own tab). No platform header, sidebar
   or breadcrumb — HQ Admin iframes this page (ph-designer prototyping.md). */
import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { T } from '../theme/phTheme'
import { Icon } from './Icon'
import { useViewportWidth } from './useViewportWidth'

export interface NavItem { to: string; label: string }

/* Below this frame width the nav collapses to a narrow strip. */
export const NAV_COLLAPSE_BELOW = 900
/* Platform Admin's left menu column width (measured from its screenshot). */
export const NAV_WIDTH = 250

/* Platform Admin's other Enabled Features entries, shown for context only:
   they are not links and do nothing (ticket, 30 Sep 2026). */
const BEFORE = ['Google Maps/Places', 'Digital Signage']
const AFTER = ['Campaign Monitoring Setti…', 'Queueing / Appointments', 'Mobile Store Sites', 'API Authentication', 'Google Business Profile', 'QR Control', 'AI Models / Integrations', 'AI Agents / Skills', 'MIST (Proximity)']

const rowStyle = { padding: '12px 16px 12px 32px', color: T.text, fontSize: 14 } as const
const Static = ({ children }: { children: ReactNode }) => <div className="truncate" style={rowStyle}>{children}</div>

/* Like Platform Admin: the menu runs the full height down the left and stays
   put (sticky, its own scroll if taller than the frame) while the right-hand
   pane scrolls, and the page title sits at the top of the right-hand pane with the page under it.
   On a touch screen (iPad) it is NOT sticky and has no scroll of its own —
   see .ph-sticky-pane in theme/index.css for why.
   An empty `nav` (a route that stands alone in its own tab) has no menu. */
export function AppShell({ title, nav, children }: { title: ReactNode; nav: NavItem[]; children: ReactNode }) {
  const collapsed = useViewportWidth() < NAV_COLLAPSE_BELOW
  const header = (
    <>
      <div className="truncate text-xl font-bold">{title}</div>
      <div className="my-4 h-px" style={{ background: T.divider }} />
    </>
  )
  if (nav.length === 0) {
    return <div className="min-h-screen w-full bg-white p-5" style={{ color: T.text, fontSize: 14 }}>{header}{children}</div>
  }
  return (
    <div className="flex min-h-screen w-full items-stretch bg-white" style={{ color: T.text, fontSize: 14 }}>
      <nav
        aria-label="Display Types and DSP Integration"
        className="ph-sticky-pane ph-full-height sticky top-0 shrink-0 self-start overflow-y-auto overflow-x-hidden border-r"
        style={{ width: collapsed ? 56 : NAV_WIDTH, borderColor: T.borderSubtle, transition: 'width .15s' }}
      >
        {!collapsed && (
          <div aria-hidden="true">
            <div className="p-2"><div style={{ padding: '12px 16px', borderRadius: 8 }}>Security (IP Restrictions)</div></div>
            <div className="flex items-center justify-between" style={{ padding: '12px 24px' }}>
              <span>Enabled Features</span><Icon name="expand_less" size={18} />
            </div>
          </div>
        )}
        <div style={{ background: '#fafafa' }}>
          {!collapsed && <div aria-hidden="true">{BEFORE.map((l) => <Static key={l}>{l}</Static>)}</div>}
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              title={collapsed ? n.label : undefined}
              className="block truncate no-underline"
              style={({ isActive }) => ({
                padding: collapsed ? '12px 0' : '12px 16px 12px 32px',
                textAlign: collapsed ? 'center' : 'left',
                color: isActive ? T.primary : T.text,
                background: isActive ? T.primaryTint : 'transparent',
              })}
            >
              {collapsed ? n.label.slice(0, 2) : n.label}
            </NavLink>
          ))}
          {!collapsed && <div aria-hidden="true">{AFTER.map((l) => <Static key={l}>{l}</Static>)}</div>}
        </div>
      </nav>
      <div className="min-w-0 flex-1 p-5">{header}{children}</div>
    </div>
  )
}
