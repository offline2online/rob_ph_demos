/* DSP Integration list column: the company pages, then one row per DSP in
   onboarding order (DV360, Amazon Ads DSP, The Trade Desk; spec §7). A DSP
   not set up yet opens its Add card. Contracts to icons below 900px. */
import { PROVIDERS, TARGETING_VARIABLES, type Partner } from '@ph-dsp/types'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Icon } from '../../shared/Icon'
import { SectionLabel } from '../../shared/SectionLabel'
import { NAV_COLLAPSE_BELOW } from '../../shared/AppShell'
import { useViewportWidth } from '../../shared/useViewportWidth'
import { T } from '../../theme/phTheme'
import { useSection } from './DspIntegrationLayout'

export const PATHS = {
  exchange: '/dsp-integration/exchange',
  advertiserSettings: '/dsp-integration/advertiser-settings',
  bookingSchedule: '/dsp-integration/booking-schedule',
  variables: '/dsp-integration/targeting-variables',
  partner: (id: string) => `/dsp-integration/partners/${id}`,
  add: (provider: string) => `/dsp-integration/add/${provider}`,
}

export function dspState(x: Partner | undefined, drafted = false) {
  if (x?.status === 'connected') return { icon: 'check_circle', colour: T.success, label: x.mode === 'live' ? 'Live' : 'Set up · Test', setUp: true }
  if (x?.status === 'error') return { icon: 'error', colour: T.error, label: 'Connection error', setUp: true }
  return { icon: 'add_circle', colour: T.micro, label: x || drafted ? 'Not set up yet — finish credentials' : 'Not set up yet', setUp: false }
}

function Row({ active, collapsed, dashed, title, onClick, children }: { active: boolean; collapsed: boolean; dashed?: boolean; title: string; onClick: () => void; children: ReactNode }) {
  return (
    <div
      role="link"
      tabIndex={0}
      aria-current={active ? 'page' : undefined}
      aria-label={title}
      title={collapsed ? title : undefined}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      className="mb-1.5 cursor-pointer rounded-md"
      style={{ padding: collapsed ? '10px 0' : '10px 12px', border: `1px ${dashed ? 'dashed' : 'solid'} ${active ? T.primary : dashed ? T.border : T.borderSubtle}`, background: active ? T.primaryTint : '#fff' }}
    >
      {children}
    </div>
  )
}

export function DspList() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { draft, partners } = useSection()
  const collapsed = useViewportWidth() < NAV_COLLAPSE_BELOW
  const advertisers = new Set(partners.flatMap((p) => (p.seats ?? []).map((s) => s.name.toLowerCase()))).size

  const company = [
    { to: PATHS.exchange, icon: 'storefront', title: 'Exchange settings', sub: `${draft.exchange.organisation || 'Client'} is seller of record` },
    { to: PATHS.advertiserSettings, icon: 'rule', title: 'Advertiser settings', sub: `${advertisers} advertisers · floor ${draft.settings.currency || 'AUD'} ${draft.settings.floorCpm ?? '—'} CPM` },
    { to: PATHS.variables, icon: 'tune', title: 'Shared Targeting Variables', sub: `${TARGETING_VARIABLES.length} platform variables` },
  ]

  return (
    <nav aria-label="DSP Integration" style={{ width: collapsed ? 64 : undefined }}>
      {!collapsed && <SectionLabel style={{ marginTop: 0 }}>Company</SectionLabel>}
      {company.map((c) => {
        const active = pathname === c.to
        return (
          <Row key={c.to} active={active} collapsed={collapsed} title={c.title} onClick={() => navigate(c.to)}>
            <div className="flex items-center gap-2" style={{ justifyContent: collapsed ? 'center' : 'flex-start' }}>
              <Icon name={c.icon} size={18} style={{ color: active ? T.primary : T.micro }} />
              {!collapsed && (
                <div className="min-w-0 flex-1">
                  <div style={{ fontSize: 13.5, fontWeight: 500 }}>{c.title}</div>
                  <div className="truncate" style={{ fontSize: 11, color: T.micro }}>{c.sub}</div>
                </div>
              )}
            </div>
          </Row>
        )
      })}

      {!collapsed && <SectionLabel>Partner DSPs</SectionLabel>}
      {PROVIDERS.map((def) => {
        const x = partners.find((p) => p.provider === def.key)
        const drafted = !!draft.partners[`new:${def.key}`]
        const state = dspState(x, drafted)
        const to = x ? PATHS.partner(x.id) : PATHS.add(def.key)
        const active = pathname === to
        const name = x ? x.name : def.label
        return (
          <Row key={def.key} active={active} collapsed={collapsed} dashed={!x && !drafted} title={`${name} — ${state.label}`} onClick={() => navigate(to)}>
            {collapsed ? (
              <div className="flex justify-center" style={{ opacity: x ? 1 : 0.75 }}>
                <Icon name={def.icon} size={18} style={{ color: def.colour }} />
                <Icon name={state.icon} size={12} style={{ color: state.colour, marginLeft: 4 }} />
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <Icon name={def.icon} size={18} style={{ color: def.colour }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate" style={{ fontSize: 13.5, fontWeight: 500 }}>{name}</div>
                    <div style={{ fontSize: 11, color: state.colour }}>{state.label}</div>
                  </div>
                  <Icon name={state.icon} size={state.icon === 'add_circle' ? 17 : 15} style={{ color: state.colour }} />
                </div>
                {x && state.setUp && (
                  <div className="mt-1 flex items-center gap-1" style={{ fontSize: 10.5, color: x.listsLinked ? T.primary : T.warning }}>
                    <Icon name={x.listsLinked ? 'link' : 'link_off'} size={12} />
                    {x.listsLinked ? 'Adopts company lists' : 'Own advertiser lists'}
                  </div>
                )}
              </>
            )}
          </Row>
        )
      })}
    </nav>
  )
}
