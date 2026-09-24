/* Every section's read queries in one place: the key and how its data is
   fetched and shaped. The pages' hooks and the background prefetch
   (usePrefetchSections) both use these, so a prefetched answer is exactly
   what the page would have fetched and lands in the same cache entry.

   Page-load review (Rob, 24 Sep 2026): each section used to fetch its data
   only when opened, so every first click showed a spinner for a round trip
   to the hosted API; now the other sections are fetched in the background
   once the first page is up. */
import type { AdvertiserSettings, Campaign, DisplayType, Exchange, Features, Partner, Playlist, Session, SharedVariable } from '@ph-dsp/types'
import { api } from './client'

const items = <T,>(path: string) => () => api<{ items: T[] }>('GET', path).then((r) => r.items)

export const Q = {
  session: { queryKey: ['session'], queryFn: () => api<Session>('GET', '/admin/v1/session') },
  features: { queryKey: ['features'], queryFn: () => api<Features>('GET', '/admin/v1/features') },
  displayTypes: { queryKey: ['display-types'], queryFn: items<DisplayType>('/admin/v1/display-types') },
  playlists: { queryKey: ['playlists'], queryFn: items<Playlist>('/admin/v1/playlists') },
  partners: { queryKey: ['partners'], queryFn: items<Partner>('/admin/v1/partners') },
  advertiserSettings: { queryKey: ['advertiser-settings'], queryFn: () => api<AdvertiserSettings>('GET', '/admin/v1/advertiser-settings') },
  exchange: { queryKey: ['exchange'], queryFn: () => api<Exchange>('GET', '/admin/v1/exchange') },
  targetingVariables: { queryKey: ['targeting-variables'], queryFn: items<SharedVariable>('/admin/v1/targeting-variables') },
  /* Advertisers / Inventory and Campaign Status: their pages type the data. */
  advertisers: { queryKey: ['advertisers'], queryFn: () => api<unknown>('GET', '/admin/v1/advertisers') },
  availableInventory: { queryKey: ['available-inventory'], queryFn: () => api<unknown>('GET', '/admin/v1/available-inventory') },
  buyersLists: { queryKey: ['buyers-lists'], queryFn: () => api<unknown>('GET', '/admin/v1/buyers-lists') },
  campaigns: { queryKey: ['poc-campaigns'], queryFn: items<Campaign>('/admin/v1/campaigns') },
} as const
