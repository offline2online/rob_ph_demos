import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { App as AntApp, ConfigProvider } from 'antd'
import { useState, type ReactNode } from 'react'
import { Navigate, Outlet, RouterProvider, createBrowserRouter, createHashRouter, useMatches, type RouteObject } from 'react-router-dom'
import type { Session } from '@ph-dsp/types'
import { api } from './api/client'
import { type Flags, envFlags } from './flags'
import { AdvertisersPage } from './features/advertisers/AdvertisersPage'
import { CampaignDetail } from './features/campaign-status/CampaignDetail'
import { CampaignStatusPage } from './features/campaign-status/CampaignStatusPage'
import { DisplayTypesPage } from './features/display-types/DisplayTypesPage'
import { PlaylistManagementPage } from './features/playlist-management/PlaylistManagementPage'
import { DspIndex, DspIntegrationLayout } from './features/dsp-integration/DspIntegrationLayout'
import { AddPartnerRoute, PartnerRoute } from './features/dsp-integration/AddPartner'
import { AdvertiserSettings } from './features/dsp-integration/AdvertiserSettings'
import { BookingSchedulePage } from './features/booking-schedule/BookingSchedulePage'
import { BOOKING_SCHEDULE_PATH } from './features/booking-schedule/path'
import { ExchangeSettings } from './features/dsp-integration/ExchangeSettings'
import { SharedTargetingVariables } from './features/dsp-integration/SharedTargetingVariables'
import { AppShell, type NavItem } from './shared/AppShell'
import { Icon } from './shared/Icon'
import { WithTip } from './shared/InfoTip'
import { UnsavedChangesProvider } from './shared/UnsavedChanges'
import { T, phTheme } from './theme/phTheme'

/* A page title may carry a tooltip saying what the page covers (spec Help text). */
export interface RouteHandle { title: string; tip?: string }

/* Navigation in the prototype's order: Display Types, Playlist Management,
   DSP Integration, Advertisers / Inventory. Items are added by the package
   that builds them.

   Who sees what (spec "Who sees each section"; Rob, 20 Sep): DSP Integration
   is admin only; the rest is admin and marketing; a help desk user sees
   nothing at all. The API enforces the same. */
export function navFor(flags: Flags, session: Session | undefined): NavItem[] {
  if (session && session.role === 'hq_helpdesk') return []
  const admin = session?.role === 'hq_admin'
  return [
    { to: '/display-types', label: 'Display Types', icon: 'dashboard_customize' },
    { to: '/playlists', label: 'Playlist Management', icon: 'playlist_play' },
    /* Flag off: DSP Integration is hidden (decision 6). Admin users only. */
    ...(flags.dspIntegration && admin ? [{ to: '/dsp-integration', label: 'DSP Integration', icon: 'handshake' }] : []),
    /* Directly below DSP Integration (spec §3); marketing users read it too. */
    ...(flags.dspIntegration ? [{ to: '/advertisers', label: 'Advertisers / Inventory', icon: 'sell' }] : []),
    /* STAND-IN for the existing Campaigns section (package 11); removed on integration. */
    ...(flags.dspIntegration ? [{ to: '/campaign-status', label: 'Campaign Status', icon: 'campaign' }] : []),
  ]
}

function featureRoutes(flags: Flags): RouteObject[] {
  return [
    { path: 'display-types', handle: { title: 'Display Types Details' } satisfies RouteHandle, element: <DisplayTypesPage flags={flags} /> },
    {
      path: 'playlists',
      /* The prototype's page footer paragraph, as the page-title tooltip (decision 2). */
      handle: { title: 'Playlist Management', tip: 'A playlist is created automatically whenever a display type is created. Auto-created playlists can be renamed, reassigned and deleted once nothing references them.' } satisfies RouteHandle,
      element: <PlaylistManagementPage />,
    },
    ...(flags.dspIntegration
      ? [{
          path: 'dsp-integration',
          handle: { title: 'DSP Integration' } satisfies RouteHandle,
          element: <DspIntegrationLayout />,
          children: [
            /* Exchange settings until the exchange is published, then Advertiser settings (Rob, 20 Sep). */
            { index: true, element: <DspIndex /> },
            { path: 'exchange', element: <ExchangeSettings /> },
            { path: 'advertiser-settings', element: <AdvertiserSettings /> },
            { path: 'targeting-variables', element: <SharedTargetingVariables /> },
            { path: 'partners/:id', element: <PartnerRoute /> },
            { path: 'add/:provider', element: <AddPartnerRoute /> },
          ],
        },
        {
          path: 'advertisers',
          /* The prototype's intro line, as the page-title tooltip (decision 2). */
          handle: { title: 'Advertisers / Inventory', tip: 'Every advertiser using the platform, across all DSPs, and the inventory they can buy: every advertiser-owned slot across the estate.' } satisfies RouteHandle,
          element: <AdvertisersPage />,
        },
        /* Its own page, opened in a new tab from Available Inventory or an advertiser (Rob, 20 Sep). */
        { path: BOOKING_SCHEDULE_PATH.slice(1), handle: { title: 'Booking schedule' } satisfies RouteHandle, element: <BookingSchedulePage /> },
        {
          path: 'campaign-status',
          handle: { title: 'Campaign Status', tip: 'Every campaign advertisers and DSPs have submitted, with its approval status. Open one to see what was booked, or approve and reject from the table. HQ\u2019s own campaigns are not listed here.' } satisfies RouteHandle,
          children: [{ index: true, element: <CampaignStatusPage /> }, { path: ':id', element: <CampaignDetail /> }],
        }]
      : []),
  ]
}

function Root({ flags }: { flags: Flags }) {
  const session = useQuery({ queryKey: ['session'], queryFn: () => api<Session>('GET', '/admin/v1/session') })
  const matches = useMatches()
  const handle = [...matches].reverse().map((m) => m.handle as RouteHandle | undefined).find((h) => h?.title)
  const title = handle?.tip ? <WithTip tip={handle.tip}>{handle.title}</WithTip> : (handle?.title ?? '')
  return (
    <UnsavedChangesProvider>
      <AppShell title={title} nav={navFor(flags, session.data)}>
        <Outlet />
      </AppShell>
    </UnsavedChangesProvider>
  )
}

function Home({ flags }: { flags: Flags }) {
  const session = useQuery({ queryKey: ['session'], queryFn: () => api<Session>('GET', '/admin/v1/session') })
  if (!session.data) return null
  const first = navFor(flags, session.data)[0]
  /* A help desk user sees none of this (spec, "Who sees each section"). */
  return first ? <Navigate to={first.to} replace /> : (
    <div className="flex items-center gap-2" style={{ fontSize: 13, color: T.muted }}>
      <Icon name="lock" size={18} />
      <span>These pages are for admin and marketing users. Ask an administrator if you need access.</span>
    </div>
  )
}

export const appRoutes = (flags: Flags): RouteObject[] => [
  { path: '/', element: <Root flags={flags} />, children: [{ index: true, element: <Home flags={flags} /> }, ...featureRoutes(flags)] },
]

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }))
  return (
    <ConfigProvider theme={phTheme}>
      <AntApp>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  )
}

export default function App({ flags = envFlags() }: { flags?: Flags }) {
  /* The hosted demo is static files on a CDN, with no server to rewrite
     paths, so its routes live in the hash: a deep link and a refresh both
     work, which matters when it is embedded in an iframe. */
  const [router] = useState(() => (import.meta.env.VITE_DEMO === '1' ? createHashRouter : createBrowserRouter)(appRoutes(flags)))
  return (
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  )
}
