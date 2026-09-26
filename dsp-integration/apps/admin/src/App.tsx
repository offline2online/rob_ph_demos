import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import { App as AntApp, ConfigProvider } from 'antd'
import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, Outlet, RouterProvider, createBrowserRouter, createHashRouter, useMatches, type RouteObject } from 'react-router-dom'
import type { Session } from '@ph-dsp/types'
import { api } from './api/client'
import { useFeatures } from './api/features'
import { Q } from './api/queries'
import { type Flags, envFlags } from './flags'
import { AdvertisersPage } from './features/advertisers/AdvertisersPage'
import { CampaignDetail } from './features/campaign-status/CampaignDetail'
import { DisplayTypesPage } from './features/display-types/DisplayTypesPage'
import { PlaylistManagementPage } from './features/playlist-management/PlaylistManagementPage'
import { DspIndex, DspIntegrationLayout } from './features/dsp-integration/DspIntegrationLayout'
import { AddPartnerRoute, PartnerRoute } from './features/dsp-integration/AddPartner'
import { AdvertiserSettings } from './features/dsp-integration/AdvertiserSettings'
import { CampaignSchedulePage } from './features/booking-schedule/CampaignSchedulePage'
import { BOOKING_SCHEDULE_PATH } from './features/booking-schedule/path'
import { ExchangeSettings } from './features/dsp-integration/ExchangeSettings'
import { SharedTargetingVariables } from './features/dsp-integration/SharedTargetingVariables'
import { AppShell, type NavItem } from './shared/AppShell'
import { Icon } from './shared/Icon'
import { WithTip } from './shared/InfoTip'
import { UnsavedChangesProvider } from './shared/UnsavedChanges'
import { T, phTheme } from './theme/phTheme'

/* A page title may carry a tooltip saying what the page covers (spec Help text).
   hideNav: this route stands alone (opened in its own tab) and shouldn't show
   the Display Types / DSP Integration nav beside it (ticket, 21 Sep). */
export interface RouteHandle { title: string; tip?: string; hideNav?: boolean }

/* Navigation order (Rob, 24 Sep 2026; Campaign Status folded into Campaign
   schedule's own second tab, 26 Sep 2026 — it is no longer a nav item of its
   own): Display Types, Playlist Management, Advertisers / Inventory, then
   DSP Integration at the bottom — the everyday pages first, the one-off DSP
   set-up last.

   Who sees what (spec "Who sees each section"; Rob, 20 Sep): DSP Integration
   is admin only; the rest is admin and marketing; a help desk user sees
   nothing at all. The API enforces the same.

   `dspOn` is the retailer's own DSP integration switch (Exchange settings,
   Rob 24 Sep 2026): while it is off — or not yet known — Advertisers /
   Inventory (and, from there, Campaign schedule's Campaign status tab) is
   hidden. DSP Integration stays, because the switch lives there. */
export function navFor(flags: Flags, session: Session | undefined, dspOn = false): NavItem[] {
  if (session && session.role === 'hq_helpdesk') return []
  const admin = session?.role === 'hq_admin'
  const selling = flags.dspIntegration && dspOn
  return [
    { to: '/display-types', label: 'Display Types', icon: 'dashboard_customize' },
    { to: '/playlists', label: 'Playlist Management', icon: 'playlist_play' },
    /* Marketing users read it too (spec §3). */
    ...(selling ? [{ to: '/advertisers', label: 'Advertisers / Inventory', icon: 'sell' }] : []),
    /* Last in the list. Flag off: hidden (decision 6). Admin users only. */
    ...(flags.dspIntegration && admin ? [{ to: '/dsp-integration', label: 'DSP Integration', icon: 'handshake' }] : []),
  ]
}

/* Campaign schedule (Booking schedule + its Campaign status tab) and
   Advertisers / Inventory open only while DSP integration is switched on; a
   bookmark or an old tab lands on the first page instead. Their records are
   untouched either way. */
function WhileDspOn({ children }: { children: ReactNode }) {
  const features = useFeatures()
  if (!features.data) return null
  return features.data.dspIntegration ? <>{children}</> : <Navigate to="/" replace />
}

function featureRoutes(flags: Flags): RouteObject[] {
  return [
    { path: 'display-types', handle: { title: 'Display Types Details' } satisfies RouteHandle, element: <DisplayTypesPage flags={flags} /> },
    {
      path: 'playlists',
      /* The prototype's page footer paragraph, as the page-title tooltip
         (decision 2) — updated 26 Sep 2026 when Playlist Settings moved
         here from the display type. */
      handle: { title: 'Playlist Management', tip: 'A playlist is created automatically whenever a display type is created. Rename or delete a playlist here, and expand a row to edit its settings. Reassigning it to a different display type or zone still happens on the Display Types form.' } satisfies RouteHandle,
      element: <PlaylistManagementPage flags={flags} />,
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
          element: <WhileDspOn><AdvertisersPage /></WhileDspOn>,
        },
        /* Its own page, opened in a new tab from Available Inventory or an advertiser
           (Rob, 20 Sep) — just the schedule, so no Display Types / DSP Integration
           nav beside it (Rob, 21 Sep). Renamed "Campaign schedule" and given a second
           tab hosting the full Campaign Status table (ticket, 26 Sep 2026): Campaign
           Status is no longer its own admin nav item or route — this tab is its only
           home now. Booking schedule (this route's first/default tab) is unchanged. */
        { path: BOOKING_SCHEDULE_PATH.slice(1), handle: { title: 'Campaign schedule', hideNav: true } satisfies RouteHandle, element: <WhileDspOn><CampaignSchedulePage /></WhileDspOn> },
        /* The campaign detail drill-down still stands alone, opened from a
           playlist row in the Campaign status tab — same STAND-IN for the
           existing Campaigns section (package 11), removed on integration. */
        {
          path: 'campaign-status/:id',
          handle: { title: 'Campaign detail', hideNav: true } satisfies RouteHandle,
          element: <WhileDspOn><CampaignDetail /></WhileDspOn>,
        }]
      : []),
  ]
}

/* Once the first page is up, fetch every other section this user can open
   in the background, so a first click on any of them has its data already
   (page-load review, Rob 24 Sep 2026). Only what the user may see: DSP
   pages need the flag, admin-only reads need an admin, and Campaign Status /
   Advertisers / Inventory need DSP integration switched on. A prefetch that
   fails is simply fetched again when its page opens. */
const PREFETCH_AFTER_MS = 800
function usePrefetchSections(flags: Flags, session: Session | undefined, dspOn: boolean | undefined) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!session || session.role === 'hq_helpdesk' || (flags.dspIntegration && dspOn === undefined)) return
    const admin = session.role === 'hq_admin'
    const wanted: { queryKey: readonly string[]; queryFn: () => Promise<unknown> }[] = [
      Q.displayTypes, Q.playlists,
      ...(flags.dspIntegration ? [Q.partners, Q.advertiserSettings] : []),
      ...(flags.dspIntegration && admin ? [Q.exchange, Q.targetingVariables] : []),
      ...(flags.dspIntegration && dspOn ? [Q.advertisers, Q.availableInventory, Q.buyersLists, Q.campaigns] : []),
    ]
    /* After the page in front of the user has asked for its own data. */
    const timer = setTimeout(() => wanted.forEach((q) => void qc.prefetchQuery(q)), PREFETCH_AFTER_MS)
    return () => clearTimeout(timer)
  }, [qc, flags.dspIntegration, session, dspOn])
}

function Root({ flags }: { flags: Flags }) {
  const session = useQuery(Q.session)
  const features = useFeatures(flags.dspIntegration)
  usePrefetchSections(flags, session.data, features.data?.dspIntegration)
  const matches = useMatches()
  const handle = [...matches].reverse().map((m) => m.handle as RouteHandle | undefined).find((h) => h?.title)
  const title = handle?.tip ? <WithTip tip={handle.tip}>{handle.title}</WithTip> : (handle?.title ?? '')
  return (
    <UnsavedChangesProvider>
      <AppShell title={title} nav={handle?.hideNav ? [] : navFor(flags, session.data, features.data?.dspIntegration)}>
        <Outlet />
      </AppShell>
    </UnsavedChangesProvider>
  )
}

function Home({ flags }: { flags: Flags }) {
  const session = useQuery(Q.session)
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
  /* staleTime: data fetched in the last 30 s is shown without asking the API
     again, so moving back to a section is instant and costs no request (page-
     load review, 24 Sep 2026). A save invalidates what it changed, so your
     own edits always show at once; someone else's, on the shared hosted
     demo, within 30 s of opening the page. */
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 } } }))
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
