/* Finalise confirmation (ticket QG40V1vVwqp9NtFmlC9H): the last look before a draft deal is shared. It lists every slot the deal is
   assigned to and the deal ID, terms and invited buyers, so the retailer can check them before anything leaves the platform.
   "Share deal" then sends the deal, including its deal ID, to the invited buyers via their DSP for authorisation. It is one fixed
   deal broadcast to the invited buyers, not a negotiable proposal: a buyer can accept it, not change it.
   It also shows the creative the DSP must supply for each slot (supported formats and pixel resolution, from PH Core via the deal
   sheet's creativeRequirements), since that is sent with the deal when it is shared (ticket JE9dQN8DTYDn5KbU7A3d).
   The body uses the same layout as the deal sheet shared with buyers (DealSheetModal): a card per DSP, then the term rows, with slots
   and creative as rows in that list; the explanatory copy sits in a tooltip beside the title (ticket wp5SuM9hSX1Od0CeNn4T). */
import { App, Button, Modal } from 'antd'
import { useQuery } from '@tanstack/react-query'
import type { BuyersList, components } from '@ph-dsp/types'
import { useState } from 'react'
import { api, ApiRequestError } from '../../api/client'
import { InfoTip } from '../../shared/InfoTip'
import { T } from '../../theme/phTheme'

type Sheet = components['schemas']['DealSheet']
const TYPE_LABEL = { private_auction: 'Private auction', preferred: 'Preferred deal', guaranteed: 'Programmatic guaranteed' } as const
const when = (v: string | null) => (v ? new Date(v).toLocaleString() : null)

export function FinaliseDealModal({ list, onClose, onShared }: { list: BuyersList | null; onClose: () => void; onShared: (list: BuyersList) => void }) {
  const { message } = App.useApp()
  const [sharing, setSharing] = useState(false)
  const { data } = useQuery({ queryKey: ['deal-sheet', list?.id, list?.updatedAt], enabled: !!list, queryFn: () => api<Sheet>('GET', `/admin/v1/buyers-lists/${list?.id}/deal-sheet`) })
  const share = async () => {
    if (!list) return
    setSharing(true)
    try {
      const shared = await api<BuyersList>('POST', `/admin/v1/buyers-lists/${list.id}/share`)
      message.success('Deal shared with the invited buyers')
      onShared(shared)
    } catch (e) {
      message.error(e instanceof ApiRequestError ? [e.message, ...(e.body?.error.details ?? []).map((d) => d.reason)].join(' ') : 'Could not share this deal.')
    } finally {
      setSharing(false)
    }
  }
  const slotLabels = new Map((list?.assignedSlots ?? []).map((s) => [s.positionId, s.label]))
  const label = (s: string) => <dt style={{ color: T.muted }}>{s}</dt>
  const guidance = <>Check the slots and terms below. <strong>Share deal</strong> sends this deal, including its deal ID, to the invited buyers via their DSP for authorisation. It is a fixed deal: buyers can accept it but not change it. After it is shared, any change to its terms asks the buyers who accepted to accept again.</>
  return (
    <Modal
      open={!!list} onCancel={onClose} width={640} destroyOnHidden
      title={<span className="inline-flex items-center gap-1">{`Finalise deal: ${list?.name ?? ''}`}
        <InfoTip text={<span data-testid="finalise-guidance">{guidance}</span>} size={18} width={360} /></span>}
      footer={<div className="flex justify-end gap-2" data-testid="finalise-actions">
        <Button onClick={onClose}>Back</Button>
        <Button type="primary" loading={sharing} onClick={share}>Share deal</Button>
      </div>}
    >
      {list && (
        <div style={{ fontSize: 13.5 }} data-testid="finalise-summary">
          {data?.entries.map((e) => (
            <div key={e.partnerId} className="mb-3" style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: 12 }}>
              <div style={{ fontWeight: 500 }}>{e.dsp}</div>
              <div>Deal ID: <span style={{ fontFamily: 'monospace' }}>{e.dealId}</span></div>
              <div>Invited seats: {e.seats.map((x) => `${x.name} (${x.id})`).join(', ')}</div>
              <div style={{ color: T.muted, fontSize: 12.5 }}>{e.setup}</div>
            </div>
          ))}
          <dl className="m-0 grid grid-cols-[150px_1fr] gap-y-1">
            {!data?.entries.length && <>{label('Deal ID')}<dd className="m-0" style={{ fontFamily: 'monospace' }}>{list.dealId}</dd></>}
            {!data?.entries.length && <>{label('Invited buyers')}<dd className="m-0">{`${list.invitedBuyers.length} buyer${list.invitedBuyers.length === 1 ? '' : 's'}`}</dd></>}
            {label('Deal type')}<dd className="m-0">{TYPE_LABEL[list.dealType]}</dd>
            {label('Rate')}<dd className="m-0">{data ? `${data.rateCpm} ${data.currency} CPM (${data.rateKind === 'fixed' ? 'fixed' : 'floor'})` : '…'}</dd>
            {label('Delivery term')}<dd className="m-0">{when(list.activeFrom) ?? 'No start'} → {when(list.activeTo) ?? 'No end'}</dd>
            {list.committedPlays != null && <>{label('Committed plays')}<dd className="m-0">{list.committedPlays.toLocaleString()}</dd></>}
            {list.auctionCloses && <>{label('Auction closes')}<dd className="m-0">{when(list.auctionCloses)}</dd></>}
            {label(`Slots (${(list.assignedSlots ?? []).length})`)}
            <dd className="m-0" data-testid="finalise-slots">
              {(list.assignedSlots ?? []).map((s) => <div key={s.positionId}>{s.label}</div>)}
            </dd>
            {label('Creative')}
            <dd className="m-0" data-testid="finalise-creative">
              {!data && <span style={{ color: T.muted }}>…</span>}
              {data && !data.creativeRequirements.length && <span style={{ color: T.muted }}>None yet: this deal is not attached to a slot</span>}
              {data?.creativeRequirements.map((r) => (
                <div key={r.positionIds.join(',')}>
                  {r.formats.join(' + ')}, {r.canvas.width}×{r.canvas.height} ({r.orientation}), max play {r.maxPlayLengthSec}s
                  <div style={{ color: T.muted }}>{r.positionIds.map((id) => slotLabels.get(id) ?? id).join('; ')}</div>
                </div>
              ))}
            </dd>
          </dl>
        </div>
      )}
    </Modal>
  )
}
