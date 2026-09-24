/* DSP Integration data. Each company page and DSP page saves through its
   own whole-page PUT (API.md: admin saves are whole-page PUTs). */
import { useQuery } from '@tanstack/react-query'
import type { AdvertiserSettings, AdvertiserSettingsInput, Exchange, ExchangeInput, Partner, PartnerInput, Provider, SharedVariable, VariableAccess } from '@ph-dsp/types'
import { api } from '../../api/client'
import { Q } from '../../api/queries'

export { useAdvertiserSettings, usePartners } from '../display-types/api'

export const useExchange = () => useQuery(Q.exchange)
export const saveExchange = (e: ExchangeInput) => api<Exchange>('PUT', '/admin/v1/exchange', e)
export const saveAdvertiserSettings = (s: AdvertiserSettingsInput) => api<AdvertiserSettings>('PUT', '/admin/v1/advertiser-settings', s)
export const useTargetingVariables = () => useQuery(Q.targetingVariables)
export const saveVariableAccess = (access: Record<string, VariableAccess>) => api<{ items: SharedVariable[] }>('PUT', '/admin/v1/targeting-variables', { access })
export const addPartner = (provider: Provider) => api<Partner>('POST', '/admin/v1/partners', { provider })
export const savePartner = (id: string, body: PartnerInput) => api<Partner>('PUT', `/admin/v1/partners/${id}`, body)
export const connectPartner = (id: string) => api<Partner>('POST', `/admin/v1/partners/${id}/connect`)
export const disconnectPartner = (id: string) => api<Partner>('POST', `/admin/v1/partners/${id}/disconnect`)
