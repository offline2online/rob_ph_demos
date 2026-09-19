/* Display Types data: existing records through the POC stand-in endpoints,
   slot ownership through PUT …/extensions (flag-gated). */
import { useQuery } from '@tanstack/react-query'
import type { Advertiser, AdvertiserSettings, DisplayType, Partner, Playlist } from '@ph-dsp/types'
import { api, ApiRequestError } from '../../api/client'
import { deepEqual } from '../../shared/deepEqual'

export const useDisplayTypes = () => useQuery({ queryKey: ['display-types'], queryFn: () => api<{ items: DisplayType[] }>('GET', '/admin/v1/display-types').then((r) => r.items) })
export const usePlaylists = () => useQuery({ queryKey: ['playlists'], queryFn: () => api<{ items: Playlist[] }>('GET', '/admin/v1/playlists').then((r) => r.items) })
export const usePartners = (enabled: boolean) => useQuery({ queryKey: ['partners'], enabled, queryFn: () => api<{ items: Partner[] }>('GET', '/admin/v1/partners').then((r) => r.items) })
export const useAdvertiserSettings = (enabled: boolean) => useQuery({ queryKey: ['advertiser-settings'], enabled, queryFn: () => api<AdvertiserSettings>('GET', '/admin/v1/advertiser-settings') })
/* Seats per DSP (Q1: the contract's Partner has no seats yet). Admin only. */
export const useAdvertisers = (enabled: boolean) =>
  useQuery({
    queryKey: ['advertisers'],
    enabled,
    queryFn: () =>
      api<{ items: Advertiser[] }>('GET', '/admin/v1/advertisers')
        .then((r) => r.items)
        .catch((e) => (e instanceof ApiRequestError && e.status === 403 ? [] : Promise.reject(e))),
  })

const recordOf = ({ phExtensions: _ext, ...rest }: DisplayType) => rest

/* Save changes: new types are created, changed records and changed slot
   ownership are saved; everything else is left alone. */
export async function saveDisplayTypes(draft: DisplayType[], saved: DisplayType[], opts: { extensions: boolean }) {
  for (const d of draft) {
    const before = saved.find((s) => s.id === d.id)
    if (!before) await api('POST', '/admin/v1/display-types', recordOf(d))
    else if (!deepEqual(recordOf(d), recordOf(before))) await api('PUT', `/admin/v1/display-types/${d.id}/record`, recordOf(d))
    if (opts.extensions && d.phExtensions && !deepEqual(d.phExtensions, before?.phExtensions ?? { slots: [] })) {
      await api('PUT', `/admin/v1/display-types/${d.id}/extensions`, d.phExtensions)
    }
  }
}
