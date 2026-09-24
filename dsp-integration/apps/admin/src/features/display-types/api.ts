/* Display Types data: existing records through the POC stand-in endpoints,
   slot ownership through PUT …/extensions (flag-gated). */
import { useQuery } from '@tanstack/react-query'
import type { DeleteCheck, DisplayType } from '@ph-dsp/types'
import { api } from '../../api/client'
import { Q } from '../../api/queries'
import { deepEqual } from '../../shared/deepEqual'

export const useDisplayTypes = () => useQuery(Q.displayTypes)
export const usePlaylists = () => useQuery(Q.playlists)
export const usePartners = (enabled: boolean) => useQuery({ ...Q.partners, enabled })
export const useAdvertiserSettings = (enabled: boolean) => useQuery({ ...Q.advertiserSettings, enabled })
export const deleteCheck = (id: string) => api<DeleteCheck>('GET', `/admin/v1/display-types/${id}/delete-check`)
export const deleteDisplayType = (id: string) => api<void>('DELETE', `/admin/v1/display-types/${id}`)

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
