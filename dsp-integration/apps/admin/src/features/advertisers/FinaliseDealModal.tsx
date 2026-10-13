/* Finalise confirmation (ticket QG40V1vVwqp9NtFmlC9H): the last look before a draft deal is shared. It lists every slot the deal is
   assigned to and the deal ID, terms and invited buyers, so the retailer can check them before anything leaves the platform.
   "Share deal" then sends the deal, including its deal ID, to the invited buyers via their DSP for authorisation. It is one fixed
   deal broadcast to the invited buyers, not a negotiable proposal: a buyer can accept it, not change it.
   It also shows the creative the DSP must supply for each slot (supported formats and pixel resolution, from PH Core via the deal
   sheet's creativeRequirements), since that is sent with the deal when it is shared (ticket JE9dQN8DTYDn5KbU7A3d). */
import { App, Button, Modal } from 'antd'
import { useQuery } from '@tanstack/react-query'
import type { BuyersList, components } from '@ph-dsp/types'
import { useState } from 'react'
import { api, ApiRequestError } from '../../api/client'
import { T } from '../../theme/phTheme'

type Sheet = components['schemas']['DealSheet']
const TYPE_LABEL = { private_auction: 'Private auction', preferred: 'Preferred deal', guaranteed: 'Programmatic guaranteed' } as const
const FORMAT_LABEL = { image: 'Image', video: 'Video' } as const
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
  return (
    <Modal
      open={!!list} onCancel={onClose} width={600} destroyOnHidden title={`Finalise deal: ${list?.name ?? ''}`}
      footer={<div className="flex justify-end gap-2" data-testid="finalise-actions">
        <Button onClick={onClose}>Back</Button>
        <Button type="primary" loading={sharing} onClick={share}>Share deal</Button>
      </div>}
    >
      {list && (
        <div style={{ fontSize: 13.5 }} data-testid="finalise-summary">
          <p style={{ color: T.muted, marginTop: 0 }}>
            Check the slots and terms below. <strong>Share deal</strong> sends this deal, including its deal ID, to the invited buyers via their DSP for authorisation. It is a fixed deal: buyers can accept it but not change it. After it is shared, any change to its terms asks the buyers who accepted to accept again.
          </p>
          <div style={{ fontWeight: 500 }}>Slots ({(list.assignedSlots ?? []).length})</div>
          <ul className="mb-3" style={{ paddingLeft: 18 }} data-testid="finalise-slots">
            {(list.assignedSlots ?? []).map((s) => <li key={s.positionId}>{s.label}</li>)}
          </ul>
          <div style={{ fontWeight: 500 }}>Creative required</div>
          <p style={{ color: T.muted, margin: '2px 0 4px' }}>Sent to the DSP with the deal, so buyers supply creative in these formats at these resolutions.</p>
          <ul className="mb-3" style={{ paddingLeft: 18 }} data-testid="finalise-creative">
            {!data && <li style={{ color: T.muted }}>…</li>}
            {data && !data.creativeRequirements.length && <li style={{ color: T.muted }}>None: assign this deal to a slot first.</li>}
            {data?.creativeRequirements.map((r) => (
              <li key={r.positionIds.join(',')}>
                {r.formats.map((f) => FORMAT_LABEL[f]).join(' + ')}, {r.canvas.width}×{r.canvas.height} px ({r.orientation}), max play {r.maxPlayLengthSec}s
                <div style={{ color: T.muted }}>{r.positionIds.map((id) => slotLabels.get(id) ?? id).join('; ')}</div>
              </li>
            ))}
          </ul>
          <dl className="m-0 grid grid-cols-[150px_1fr] gap-y-1">
            {label('Deal ID')}
            <dd className="m-0" style={{ fontFamily: 'monospace' }}>{data?.entries?.length ? data.entries?.map((e) => `${e.dealId} (${e.dsp})`).join(', ') : list.dealId}</dd>
            {label('Deal type')}<dd className="m-0">{TYPE_LABEL[list.dealType]}</dd>
            {label('Invited buyers')}
            <dd className="m-0">{data?.entries?.length ? data.entries?.map((e) => `${e.seats.map((x) => x.name).join(', ')} (${e.dsp})`).join('; ') : `${list.invitedBuyers.length} buyer${list.invitedBuyers.length === 1 ? '' : 's'}`}</dd>
            {label('Rate')}<dd className="m-0">{data ? `${data.rateCpm} ${data.currency} CPM (${data.rateKind === 'fixed' ? 'fixed' : 'floor'})` : '…'}</dd>
            {label('Delivery term')}<dd className="m-0">{when(list.activeFrom) ?? 'No start'} → {when(list.activeTo) ?? 'No end'}</dd>
            {list.committedPlays != null && <>{label('Committed plays')}<dd className="m-0">{list.committedPlays.toLocaleString()}</dd></>}
            {list.auctionCloses && <>{label('Auction closes')}<dd className="m-0">{when(list.auctionCloses)}</dd></>}
          </dl>
        </div>
      )}
    </Modal>
  )
}
