import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { App as AntApp, ConfigProvider } from 'antd'
import { useState, type ReactNode } from 'react'
import { Navigate, Outlet, RouterProvider, createBrowserRouter, useMatches, type RouteObject } from 'react-router-dom'
import type { Session } from '@ph-dsp/types'
import { api } from './api/client'
import { type Flags, envFlags } from './flags'
import { AdvertisersPage } from './features/advertisers/AdvertisersPage'
import { CampaignsPocPage } from './features/campaigns-poc/CampaignsPocPage'
import { DisplayTypesPage } from './features/display-types/DisplayTypesPage'
import { PlaylistManagementPage } from './features/playlist-management/PlaylistManagementPage'
import { DspIndex, DspIntegrationLayout } from './features/dsp-integration/DspIntegrationLayout'
import { AddPartnerRoute, PartnerRoute } from './features/dsp-integration/AddPartner'
import { AdvertiserSettings } from './features/dsp-integration/AdvertiserSettings'
import { BookingSchedule } from './features/dsp-integration/BookingSchedule'
import { ExchangeSettings } from './features/dsp-integration/ExchangeSettings'
import { SharedTargetingVariables } from './features/dsp-integration/SharedTargetingVariables'
import { AppShell, type NavItem } from './shared/AppShell'
import { WithTip } from './shared/InfoTip'
import { UnsavedChangesProvider } from './shared/UnsavedChanges'
import { phTheme } from './theme/phTheme'

/* A page title may carry a tooltip saying what the page covers (spec Help text). */
export interface RouteHandle { title: string; tip?: string }

/* Navigation in the prototype's order: Display Types, Playlist Management,
   DSP Integration, Advertisers. Items are added by the package that builds them. */
export function navFor(flags: Flags, session: Session | undefined): NavItem[] {
  return [
    { to: '/display-types', label: 'Display Types', icon: 'dashboard_customize' },
    { to: '/playlists', label: 'Playlist Management', icon: 'playlist_play' },
    /* Flag off: DSP Integration is hidden (decision 6). */
    ...(flags.dspIntegration ? [{ to: '/dsp-integration', label: 'DSP Integration', icon: 'handshake' }] : []),
    /* Admin users only, directly below DSP Integration (spec §3). */
    ...(flags.dspIntegration && session?.role === 'hq_admin' ? [{ to: '/advertisers', label: 'Advertisers', icon: 'sell' }] : []),
    /* STAND-IN for the existing Campaigns section (package 11); removed on integration. */
    ...(flags.dspIntegration ? [{ to: '/campaigns-poc', label: 'Campaigns (POC)', icon: 'campaign' }] : []),
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
            { path: 'booking-schedule', element: <BookingSchedule /> },
            { path: 'targeting-variables', element: <SharedTargetingVariables /> },
            { path: 'partners/:id', element: <PartnerRoute /> },
            { path: 'add/:provider', element: <AddPartnerRoute /> },
          ],
        },
        {
          path: 'advertisers',
          /* The prototype's intro line, as the page-title tooltip (decision 2). */
          handle: { title: 'Advertisers', tip: 'Every advertiser using the platform, across all DSPs.' } satisfies RouteHandle,
          element: <AdvertisersPage />,
        },
        { path: 'campaigns-poc', handle: { title: 'Campaigns (POC)' } satisfies RouteHandle, element: <CampaignsPocPage /> }]
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
  const first = navFor(flags, undefined)[0]
  return first ? <Navigate to={first.to} replace /> : null
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
  const [router] = useState(() => createBrowserRouter(appRoutes(flags)))
  return (
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  )
}
