/* DSP Integration data. Each company page and DSP page saves through its
   own whole-page PUT (API.md: admin saves are whole-page PUTs). */
import { useQuery } from '@tanstack/react-query'
import type { AdvertiserSettings, AdvertiserSettingsInput, Exchange, ExchangeInput } from '@ph-dsp/types'
import { api } from '../../api/client'

export { useAdvertiserSettings, usePartners } from '../display-types/api'

export const useExchange = () => useQuery({ queryKey: ['exchange'], queryFn: () => api<Exchange>('GET', '/admin/v1/exchange') })
export const saveExchange = (e: ExchangeInput) => api<Exchange>('PUT', '/admin/v1/exchange', e)
export const saveAdvertiserSettings = (s: AdvertiserSettingsInput) => api<AdvertiserSettings>('PUT', '/admin/v1/advertiser-settings', s)
