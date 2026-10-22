/* Deal sheet (ticket DbiT9qrFwL4O5ibgSowF): what the retail media team hands a DSP buyer so they can key the deal into
   their own platform. On-screen and copyable, plus a CSV download. The automated API push is a later phase. */
import { App, Button, Modal } from 'antd'
import { useQuery } from '@tanstack/react-query'
import type { BuyersList, components } from '@ph-dsp/types'
import { api } from '../../api/client'
import { Icon } from '../../shared/Icon'
import { T } from '../../theme/phTheme'
import { equivalentCpmText } from './effectiveTerm'
import { slotLine } from './slotLine'

type Sheet = components['schemas']['DealSheet']
const TYPE_LABEL = { private_auction: 'Private auction', preferred: 'Preferred deal', guaranteed: 'Programmatic guaranteed', direct: 'Direct advertiser' } as const
const when = (v: string | null) => (v ? new Date(v).toLocaleString() : null)

const num = (n: number | null | undefined) => (n == null ? '-' : n.toLocaleString())
const cond = (c: { text: string }) => c.text

/* Plain text for pasting into an email or chat: the Order, Product and what is bought once, then one block per DSP
   (its InventorySource), in DV360's terms (ticket DbSVEGXNIWlYW68UQnY3). */
export function dealSheetText(s: Sheet): string {
  const flight = `${when(s.product.startTime) ?? 'No start date'} to ${when(s.product.endTime) ?? 'No end date'}`
  const creative = s.creativeRequirements.length
    ? s.creativeRequirements.map((r) => `  - ${r.formats.join(' + ')}, ${r.canvas.width}x${r.canvas.height} (${r.orientation}), max play ${r.maxPlayLengthSec}s`).join('\n')
    : '  - None yet: the deal is not attached to a slot'
  const slots = s.slots?.length ? s.slots.map((x) => `  - ${slotLine(x)}`).join('\n') : '  - None yet: the deal is not attached to a slot'
  const t = s.targeting
  const targeting = [
    ...t.targetingCriteria.map((g) => `  - ${g.targetingType}: ${g.conditions.map(cond).join('; ')}`),
    ...t.sellerSideOnly.map((c) => `  - ${cond(c)} (seller-side only)`),
  ]
  const sc = s.inventoryScope
  const v = s.estimatedVolume
  const rateType = s.entries[0]?.inventorySource.rateDetails.rateType
  const shared = [
    `Order: ${s.order.name} (${s.order.status})`,
    `Product: ${s.product.displayName}`, `Deal type: ${TYPE_LABEL[s.dealType]}`, `Pricing type: ${s.product.pricingType}`,
    s.termTotal != null ? `Rate: ${s.termTotal} ${s.currency} for the whole term (${rateType ?? 'Fixed per term'})${s.equivalentCpm ? `, equivalent CPM ${equivalentCpmText(s.equivalentCpm)}` : ''}` : `Rate: ${s.rateCpm} ${s.currency}${rateType ? ` (${rateType})` : ''}`, `Flight dates: ${flight}${s.termDays != null ? ` (${s.termDays} day${s.termDays === 1 ? '' : 's'})` : ''}`, `Term version: ${s.termVersion}`,
    ...(s.guaranteedImpressions != null ? [`Guaranteed impressions: ${num(s.guaranteedImpressions)} (${num(s.committedPlays)} plays)`] : s.committedPlays != null ? [`Guaranteed plays: ${num(s.committedPlays)}`] : []),
    ...(s.auctionCloses ? [`Auction window closes: ${when(s.auctionCloses)}`] : []),
    'Slots:', slots,
    'Creative config:', creative,
    `Targeting: ${t.plainLanguage}`, ...targeting,
    `Inventory scope: ${sc.summary}`,
    ...(sc.screenFormats.length ? [`  Screen formats: ${sc.screenFormats.map((f) => `${f.width}x${f.height} ${f.orientation}`).join('; ')}`] : []),
    ...(sc.narrowedBy.length ? [`  Narrowed by: ${sc.narrowedBy.join('; ')} (${num(sc.displays)} of ${num(sc.displaysBeforeTargeting)} displays)`] : []),
    ...(sc.notReflectedInCounts.length ? [`  Applied at bid time, not reflected in these counts: ${sc.notReflectedInCounts.join('; ')}`] : []),
    `Estimated volume (estimate) per play window: ${num(v.playsPerWindow)} plays, ${num(v.assumedViewsPerWindow)} assumed views (targeted share ${Math.round(v.targetedShare * 100)}%)`,
    ...(v.windows != null ? [`  Over the flight (${v.windows} windows): ${num(v.playsInTerm)} plays, ${num(v.assumedViewsInTerm)} assumed views`] : []),
    ...(v.guaranteedImpressionsPerWindow != null ? [`  Guaranteed impressions per window: ${num(v.guaranteedImpressionsPerWindow)} (forecast less ${v.bufferPct}% buffer)`] : []),
    `Description: ${s.description}`,
  ].join('\n')
  const perDsp = s.entries.map((e) => `${e.dsp}\nDeal ID: ${e.dealId}\nBuyer status: ${e.inventorySource.buyerStatus} · Seller status: ${e.inventorySource.sellerStatus} · Term version ${e.inventorySource.termVersion}\nBuyers: ${e.seats.map((x) => `${x.name} (${x.id})`).join(', ')}\n${e.setup}`)
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
    <Modal open={!!list} onCancel={onClose} title={`Deal sheet: ${list?.name ?? ''}`} width={720} destroyOnHidden footer={[
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
              <div>Buyers: {e.seats.map((x) => `${x.name} (${x.id})`).join(', ')}</div>
              <div data-testid={`status-${e.partnerId}`}>Buyer status: {e.inventorySource.buyerStatus} · Seller status: {e.inventorySource.sellerStatus} · Term version {e.inventorySource.termVersion}</div>
              <div style={{ color: T.muted, fontSize: 12.5 }}>{e.setup}</div>
            </div>
          ))}
          {(() => {
            const sc = data.inventoryScope, v = data.estimatedVolume, t = data.targeting
            const rateType = data.entries[0]?.inventorySource.rateDetails.rateType
            const dt = { color: T.muted }
            return (
              <dl className="m-0 grid grid-cols-[170px_1fr] gap-y-1">
                <dt style={dt}>Order</dt><dd className="m-0" data-testid="deal-sheet-order">{data.order.name} · {data.order.status}</dd>
                <dt style={dt}>Product</dt><dd className="m-0">{data.product.displayName}</dd>
                <dt style={dt}>Deal type</dt><dd className="m-0">{TYPE_LABEL[data.dealType]}</dd>
                {data.termTotal != null
                  ? <><dt style={dt}>Total for the term</dt><dd className="m-0" data-testid="deal-sheet-term-total">{data.termTotal} {data.currency} for the whole term · {rateType ?? 'Fixed per term'}{data.equivalentCpm && <div style={{ color: T.muted, fontSize: 12.5 }}>Equivalent CPM {equivalentCpmText(data.equivalentCpm)}</div>}</dd></>
                  : <><dt style={dt}>Rate</dt><dd className="m-0">{data.rateCpm} {data.currency}{rateType ? ` · ${rateType}` : ''}</dd></>}
                <dt style={dt}>Flight dates</dt><dd className="m-0">{when(data.activeFrom) ?? 'No start date'} → {when(data.activeTo) ?? 'No end date'}{data.termDays != null ? ` (${data.termDays} day${data.termDays === 1 ? '' : 's'})` : ''}</dd>
                <dt style={dt}>Term version</dt><dd className="m-0">{data.termVersion}</dd>
                {data.guaranteedImpressions != null && <><dt style={dt}>Guaranteed impressions</dt><dd className="m-0" data-testid="deal-sheet-impressions">{data.guaranteedImpressions.toLocaleString()}<div style={{ color: T.muted, fontSize: 12.5 }}>{(data.committedPlays ?? 0).toLocaleString()} plays</div></dd></>}
                {data.auctionCloses && <><dt style={dt}>Auction window closes</dt><dd className="m-0">{when(data.auctionCloses)}</dd></>}
                <dt style={dt}>Slots</dt>
                <dd className="m-0" data-testid="deal-sheet-slots">
                  {data.slots?.length
                    ? data.slots.map((x) => <div key={x.positionId}>{slotLine(x)}</div>)
                    : <span style={{ color: T.muted }}>None yet: this deal is not attached to a slot</span>}
                </dd>
                <dt style={dt}>Creative config</dt>
                <dd className="m-0">
                  {data.creativeRequirements.length
                    ? data.creativeRequirements.map((r, i) => <div key={i}>{r.formats.join(' + ')}, {r.canvas.width}×{r.canvas.height} ({r.orientation}), max play {r.maxPlayLengthSec}s</div>)
                    : <span style={{ color: T.muted }}>None yet: this deal is not attached to a slot</span>}
                </dd>
                <dt style={dt}>Targeting</dt>
                <dd className="m-0" data-testid="deal-sheet-targeting">
                  <div>{t.plainLanguage}</div>
                  {t.targetingCriteria.map((g) => <div key={g.targetingType} style={{ color: T.muted, fontSize: 12.5 }}>{g.targetingType}: {g.conditions.map(cond).join('; ')}</div>)}
                  {t.sellerSideOnly.map((c) => <div key={c.variable} style={{ color: T.muted, fontSize: 12.5 }}>{cond(c)} · seller-side only</div>)}
                </dd>
                <dt style={dt}>Inventory scope</dt>
                <dd className="m-0" data-testid="deal-sheet-scope">
                  <div>{sc.summary}</div>
                  {sc.screenFormats.length > 0 && <div style={{ color: T.muted, fontSize: 12.5 }}>Screen formats: {sc.screenFormats.map((f) => `${f.width}×${f.height} ${f.orientation}`).join('; ')}</div>}
                  {sc.narrowedBy.length > 0 && <div style={{ color: T.muted, fontSize: 12.5 }}>Narrowed by {sc.narrowedBy.join('; ')}: {sc.displays.toLocaleString()} of {sc.displaysBeforeTargeting.toLocaleString()} displays</div>}
                  {sc.notReflectedInCounts.length > 0 && <div style={{ color: T.muted, fontSize: 12.5 }}>Applied at bid time, not reflected in these counts: {sc.notReflectedInCounts.join('; ')}</div>}
                </dd>
                <dt style={dt}>Estimated volume</dt>
                <dd className="m-0" data-testid="deal-sheet-volume">
                  <div>Estimate, per play window: {v.playsPerWindow.toLocaleString()} plays · {v.assumedViewsPerWindow.toLocaleString()} assumed views (targeted share {Math.round(v.targetedShare * 100)}%)</div>
                  {v.windows != null && <div style={{ color: T.muted, fontSize: 12.5 }}>Over the flight ({v.windows} windows): {num(v.playsInTerm)} plays · {num(v.assumedViewsInTerm)} assumed views</div>}
                  {v.guaranteedImpressionsPerWindow != null && <div style={{ color: T.muted, fontSize: 12.5 }}>Guaranteed impressions per window: {v.guaranteedImpressionsPerWindow.toLocaleString()} (forecast less {v.bufferPct}% buffer)</div>}
                </dd>
                <dt style={dt}>Description</dt><dd className="m-0" data-testid="deal-sheet-description">{data.description}</dd>
              </dl>
            )
          })()}
        </div>
      )}
    </Modal>
  )
}
