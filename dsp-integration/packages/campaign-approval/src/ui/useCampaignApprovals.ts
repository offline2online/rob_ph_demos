/* Loads approval state for the campaign rows on screen. The host passes a
   client (the approval endpoints) so the hook works inside any table. */
import { useCallback, useEffect, useState } from 'react'
import type { Approval } from '../types'

export interface ApprovalClient {
  getApproval(campaignId: string): Promise<Approval>
  /* Optional: one page of GET /approvals (the list view, 200 at most). With
     it, a table of many campaigns loads in a request per 200 rows instead of
     one request per row (page-load review, 24 Sep 2026: Campaign Status made
     31 requests on every visit). */
  listApprovals?(cursor?: string): Promise<{ items: Approval[]; nextCursor: string | null }>
}

/* Every approval the list endpoint has, following its cursor. */
async function listAll(client: ApprovalClient) {
  const out: Approval[] = []
  let cursor: string | undefined
  do {
    const page = await client.listApprovals!(cursor)
    out.push(...page.items)
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  return out
}

export function useCampaignApprovals(campaignIds: string[], client: ApprovalClient) {
  const [approvals, setApprovals] = useState<Record<string, Approval>>({})
  const [loading, setLoading] = useState(false)
  const key = campaignIds.join(',')
  const load = useCallback(async () => {
    setLoading(true)
    try {
      /* Many rows and a list endpoint: one paged list. Any campaign it
         doesn't cover is still fetched on its own. A single campaign keeps
         getApproval, which returns the full view (creative, audit). */
      const listed = client.listApprovals && campaignIds.length > 1 ? await listAll(client).catch(() => []) : []
      const byId = new Map(listed.map((a) => [a.campaignId, a] as const))
      const rows = await Promise.all(
        campaignIds.map((id) => (byId.has(id) ? Promise.resolve([id, byId.get(id)!] as const) : client.getApproval(id).then((a) => [id, a] as const).catch(() => null))),
      )
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
