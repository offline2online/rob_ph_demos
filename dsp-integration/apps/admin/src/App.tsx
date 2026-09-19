import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { App as AntApp, ConfigProvider } from 'antd'
import { useState, type ReactNode } from 'react'
import { Navigate, Outlet, RouterProvider, createBrowserRouter, useMatches, type RouteObject } from 'react-router-dom'
import type { Session } from '@ph-dsp/types'
import { api } from './api/client'
import { type Flags, envFlags } from './flags'
import { AppShell, type NavItem } from './shared/AppShell'
import { UnsavedChangesProvider } from './shared/UnsavedChanges'
import { phTheme } from './theme/phTheme'

export interface RouteHandle { title: string }

/* Navigation in the prototype's order: Display Types, Playlist Management,
   DSP Integration, Advertisers. Items are added by the package that builds them. */
export function navFor(_flags: Flags, _session: Session | undefined): NavItem[] {
  return []
}

function featureRoutes(_flags: Flags): RouteObject[] {
  return []
}

function Root({ flags }: { flags: Flags }) {
  const session = useQuery({ queryKey: ['session'], queryFn: () => api<Session>('GET', '/admin/v1/session') })
  const matches = useMatches()
  const title = [...matches].reverse().map((m) => (m.handle as RouteHandle | undefined)?.title).find(Boolean) ?? ''
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
