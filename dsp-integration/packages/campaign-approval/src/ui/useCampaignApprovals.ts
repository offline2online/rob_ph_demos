/* Loads approval state for the campaign rows on screen. The host passes a
   client (the approval endpoints) so the hook works inside any table. */
import { useCallback, useEffect, useState } from 'react'
import type { Approval } from '../types'

export interface ApprovalClient {
  getApproval(campaignId: string): Promise<Approval>
}

export function useCampaignApprovals(campaignIds: string[], client: ApprovalClient) {
  const [approvals, setApprovals] = useState<Record<string, Approval>>({})
  const [loading, setLoading] = useState(false)
  const key = campaignIds.join(',')
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await Promise.all(campaignIds.map((id) => client.getApproval(id).then((a) => [id, a] as const).catch(() => null)))
      setApprovals(Object.fromEntries(rows.filter((r): r is readonly [string, Approval] => !!r)))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, client])
  useEffect(() => {
    void load()
  }, [load])
  return { approvals, loading, reload: load }
}
