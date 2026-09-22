/* STAND-IN — shared data and actions for the Campaign Status screens:
   approval state for the rows on screen (the module's own hook), and the
   approve / reject / activate calls the table and the campaign page share. */
import { useQueryClient } from '@tanstack/react-query'
import { App } from 'antd'
import { useCampaignApprovals, type Approval, type ApprovalClient } from '@ph-dsp/campaign-approval/ui'
import type { Campaign, Session } from '@ph-dsp/types'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiRequestError, api } from '../../api/client'

export const CAMPAIGN_STATUS_PATH = '/campaign-status'

const client: ApprovalClient = { getApproval: (id) => api<Approval>('GET', `/admin/v1/campaigns/${id}/approval`) }

export const useCampaign = (id: string | undefined) =>
  useQuery({
    queryKey: ['poc-campaigns'],
    queryFn: () => api<{ items: Campaign[] }>('GET', '/admin/v1/campaigns').then((r) => r.items),
    select: (items) => items.find((c) => c.campaignId === id),
    enabled: !!id,
  })

export function useCampaignActions(campaignIds: string[]) {
  const { message } = App.useApp()
  const qc = useQueryClient()
  const session = useQuery({ queryKey: ['session'], queryFn: () => api<Session>('GET', '/admin/v1/session') })
  const { approvals, reload } = useCampaignApprovals(campaignIds, client)
  const [busy, setBusy] = useState<string | null>(null)

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id)
    try {
      await fn()
      await qc.invalidateQueries({ queryKey: ['poc-campaigns'] })
      await reload()
    } catch (e) {
      message.error(e instanceof ApiRequestError ? e.message : 'Something went wrong.')
    } finally {
      setBusy(null)
    }
  }
  return {
    approvals,
    canApprove: session.data?.role === 'hq_admin',
    busy,
    approve: (a: Approval) => act(a.campaignId, () => api('POST', `/admin/v1/campaigns/${a.campaignId}/approve`, { assetVersion: a.assetVersion })),
    reject: (a: Approval, reason: string) => act(a.campaignId, () => api('POST', `/admin/v1/campaigns/${a.campaignId}/reject`, { assetVersion: a.assetVersion, reason })),
    unreject: (a: Approval, reason?: string) => act(a.campaignId, () => api('POST', `/admin/v1/campaigns/${a.campaignId}/unreject`, { assetVersion: a.assetVersion, reason })),
    activate: (c: Campaign, enabled: boolean) => act(c.campaignId, () => api('PUT', `/admin/v1/campaigns/${c.campaignId}/activation`, { enabled })),
  }
}
