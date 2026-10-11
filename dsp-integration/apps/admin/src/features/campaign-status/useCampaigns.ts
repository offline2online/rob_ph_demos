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
import { Q } from '../../api/queries'

export const CAMPAIGN_STATUS_PATH = '/campaign-status'

const client: ApprovalClient = {
  getApproval: (id) => api<Approval>('GET', `/admin/v1/campaigns/${id}/approval`),
  /* The table's rows in one request (200 per page), not one per campaign. */
  listApprovals: (cursor) => api<{ items: Approval[]; nextCursor: string | null }>('GET', `/admin/v1/approvals?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
}

export const useCampaign = (id: string | undefined) =>
  useQuery({
    ...Q.campaigns,
    select: (items) => items.find((c) => c.campaignId === id),
    enabled: !!id,
  })

export function useCampaignActions(campaignIds: string[]) {
  const { message } = App.useApp()
  const qc = useQueryClient()
  const session = useQuery(Q.session)
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
  /* Several campaigns in one go (the table's selection): the result is toasted
     and returned, never thrown, so the page decides what to clear. */
  const batch = async (run: () => Promise<string>) => {
    setBusy('batch')
    try {
      const done = await run()
      message.success(done)
      return true
    } catch (e) {
      message.error(e instanceof ApiRequestError ? e.message : 'Something went wrong.')
      return false
    } finally {
      await qc.invalidateQueries({ queryKey: ['poc-campaigns'] })
      await qc.invalidateQueries({ queryKey: ['creative-ids'] })
      await reload()
      setBusy(null)
    }
  }
  return {
    approvals,
    canApprove: session.data?.role === 'hq_admin',
    busy,
    approve: (a: Approval) => act(a.campaignId, () => api('POST', `/admin/v1/campaigns/${a.campaignId}/approve`, { assetVersion: a.assetVersion })),
    reject: (a: Approval, reason: string) => act(a.campaignId, () => api('POST', `/admin/v1/campaigns/${a.campaignId}/reject`, { assetVersion: a.assetVersion, reason })),
    /* Approve the ticked campaigns of ONE advertiser and group them under a
       creative ID — a new one (creativeId omitted) or an existing one. All or nothing. */
    approveAssign: (as: Approval[], creativeId?: string) => batch(async () => {
      /* A rejected campaign goes back to Awaiting approval first (the state machine's only way on), then is approved with the rest. */
      for (const a of as) if (a.status === 'rejected') await api('POST', `/admin/v1/campaigns/${a.campaignId}/unreject`, { assetVersion: a.assetVersion })
      const res = await api<{ creativeId: string }>('POST', '/admin/v1/approvals/approve-assign', { items: as.map((a) => ({ campaignId: a.campaignId, assetVersion: a.assetVersion })), ...(creativeId ? { creativeId } : {}) })
      return `${as.length === 1 ? '1 campaign' : `${as.length} campaigns`} approved under creative ID ${res.creativeId}.`
    }),
    /* An auto-approved advertiser's campaigns are already approved: group the
       ticked ones under a creative ID, a new one or an existing one. */
    assignCreativeId: (as: Approval[], creativeId?: string) => batch(async () => {
      const res = await api<{ creativeId: string }>('POST', '/admin/v1/approvals/assign-creative-id', { campaignIds: as.map((a) => a.campaignId), ...(creativeId ? { creativeId } : {}) })
      return `${as.length === 1 ? '1 campaign' : `${as.length} campaigns`} grouped under creative ID ${res.creativeId}.`
    }),
    /* Reject each ticked campaign with the same reason, which the advertiser sees. */
    rejectMany: (as: Approval[], reason: string) => batch(async () => {
      for (const a of as) {
        if (a.status === 'rejected') await api('POST', `/admin/v1/campaigns/${a.campaignId}/unreject`, { assetVersion: a.assetVersion })
        await api('POST', `/admin/v1/campaigns/${a.campaignId}/reject`, { assetVersion: a.assetVersion, reason })
      }
      return `${as.length === 1 ? '1 campaign' : `${as.length} campaigns`} rejected. The advertiser sees the reason.`
    }),
    /* Switch the ticked, approved campaigns on or off; any already in that state are left as they are. */
    activateMany: (cs: Campaign[], enabled: boolean) => batch(async () => {
      const changing = cs.filter((c) => c.activation.enabled !== enabled)
      for (const c of changing) await api('PUT', `/admin/v1/campaigns/${c.campaignId}/activation`, { enabled })
      return `${changing.length === 1 ? '1 campaign' : `${changing.length} campaigns`} ${enabled ? 'activated' : 'deactivated'}.`
    }),
    unreject: (a: Approval, reason?: string) => act(a.campaignId, () => api('POST', `/admin/v1/campaigns/${a.campaignId}/unreject`, { assetVersion: a.assetVersion, reason })),
    activate: (c: Campaign, enabled: boolean) => act(c.campaignId, () => api('PUT', `/admin/v1/campaigns/${c.campaignId}/activation`, { enabled })),
  }
}
