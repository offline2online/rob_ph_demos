/* Deal sheet (ticket DbiT9qrFwL4O5ibgSowF): what the retail media team hands a DSP buyer so they can key the deal into
   their own platform. On-screen and copyable, plus a CSV download. The automated API push is a later phase. */
import { App, Button, Modal } from 'antd'
import { useQuery } from '@tanstack/react-query'
import type { BuyersList, components } from '@ph-dsp/types'
import { api } from '../../api/client'
import { Icon } from '../../shared/Icon'
import { T } from '../../theme/phTheme'

type Sheet = components['schemas']['DealSheet']
const TYPE_LABEL = { private_auction: 'Private auction', preferred: 'Preferred deal', guaranteed: 'Programmatic guaranteed' } as const
const when = (v: string | null) => (v ? new Date(v).toLocaleString() : null)

/* Plain text for pasting into an email or chat: one block per DSP. */
export function dealSheetText(s: Sheet): string {
  const term = `${when(s.activeFrom) ?? 'No start'} to ${when(s.activeTo) ?? 'No end'}`
  const creative = s.creativeRequirements.length
    ? s.creativeRequirements.map((r) => `  - ${r.formats.join(' + ')}, ${r.canvas.width}x${r.canvas.height} (${r.orientation}), max play ${r.maxPlayLengthSec}s`).join('\n')
    : '  - None yet: the deal is not attached to a slot'
  const shared = [
    `Deal: ${s.name}`, `Deal type: ${TYPE_LABEL[s.dealType]}`, `Rate: ${s.rateCpm} ${s.currency} CPM (${s.rateKind === 'fixed' ? 'fixed' : 'floor'})`, `Delivery term: ${term}`,
    ...(s.committedPlays != null ? [`Committed plays: ${s.committedPlays.toLocaleString()}`] : []),
    ...(s.auctionCloses ? [`Auction closes: ${when(s.auctionCloses)}`] : []),
    'Creative requirements:', creative,
  ].join('\n')
  const perDsp = s.entries.map((e) => `${e.dsp}\nDeal ID: ${e.dealId}\nInvited seats: ${e.seats.map((x) => `${x.name} (${x.id})`).join(', ')}\n${e.setup}`)
  return [shared, ...perDsp].join('\n\n')
}

export function DealSheetModal({ list, onClose }: { list: BuyersList | null; onClose: () => void }) {
  const { message } = App.useApp()
  const { data, isLoading, isError } = useQuery({ queryKey: ['deal-sheet', list?.id], enabled: !!list, queryFn: () => api<Sheet>('GET', `/admin/v1/buyers-lists/${list?.id}/deal-sheet`) })
  const copy = async () => {
    if (!data) return
    try {
      await navigator.clipboard.writeText(dealSheetText(data))
      message.success('Deal sheet copied')
    } catch {
      message.error('Could not copy. Select the text and copy it instead.')
    }
  }
  return (
    <Modal open={!!list} onCancel={onClose} title={`Deal sheet: ${list?.name ?? ''}`} width={640} destroyOnHidden footer={[
      <Button key="copy" icon={<Icon name="content_copy" size={16} />} disabled={!data} onClick={copy}>Copy</Button>,
      <Button key="csv" type="primary" icon={<Icon name="download" size={16} />} disabled={!data?.entries.length} href={`/api/admin/v1/buyers-lists/${list?.id}/deal-sheet?format=csv`}>Download CSV</Button>,
    ]}>
      {isLoading && <div style={{ color: T.muted }}>Loading…</div>}
      {isError && <div role="alert" style={{ color: T.error }}>The deal sheet could not be loaded.</div>}
      {data && (
        <div style={{ fontSize: 13.5 }}>
          <p style={{ color: T.muted, marginTop: 0 }}>Share this with the buyer. They create the deal in their DSP with these details; the deal ID is how it is matched.</p>
          {!data.entries.length && <p>This list invites only IAB categories, so there is no named buyer to share a deal ID with. Invite a buyer first.</p>}
          {data.entries.map((e) => (
            <div key={e.partnerId} className="mb-3" style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: 12 }}>
              <div style={{ fontWeight: 500 }}>{e.dsp}</div>
              <div>Deal ID: <span style={{ fontFamily: 'monospace' }}>{e.dealId}</span></div>
              <div>Invited seats: {e.seats.map((x) => `${x.name} (${x.id})`).join(', ')}</div>
              <div style={{ color: T.muted, fontSize: 12.5 }}>{e.setup}</div>
            </div>
          ))}
          <dl className="m-0 grid grid-cols-[150px_1fr] gap-y-1">
            <dt style={{ color: T.muted }}>Deal type</dt><dd className="m-0">{TYPE_LABEL[data.dealType]}</dd>
            <dt style={{ color: T.muted }}>Rate</dt><dd className="m-0">{data.rateCpm} {data.currency} CPM ({data.rateKind === 'fixed' ? 'fixed' : 'floor'})</dd>
            <dt style={{ color: T.muted }}>Delivery term</dt><dd className="m-0">{when(data.activeFrom) ?? 'No start'} → {when(data.activeTo) ?? 'No end'}</dd>
            {data.committedPlays != null && <><dt style={{ color: T.muted }}>Committed plays</dt><dd className="m-0">{data.committedPlays.toLocaleString()}</dd></>}
            {data.auctionCloses && <><dt style={{ color: T.muted }}>Auction closes</dt><dd className="m-0">{when(data.auctionCloses)}</dd></>}
            <dt style={{ color: T.muted }}>Creative</dt>
            <dd className="m-0">
              {data.creativeRequirements.length
                ? data.creativeRequirements.map((r, i) => <div key={i}>{r.formats.join(' + ')}, {r.canvas.width}×{r.canvas.height} ({r.orientation}), max play {r.maxPlayLengthSec}s</div>)
                : <span style={{ color: T.muted }}>None yet: this deal is not attached to a slot</span>}
            </dd>
          </dl>
        </div>
      )}
    </Modal>
  )
}
