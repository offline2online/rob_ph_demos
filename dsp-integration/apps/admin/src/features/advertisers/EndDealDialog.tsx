/* Cancel deal and End deal (ticket q2t6YgDdW9XCsbORxCq2). Cancel: a finalised deal whose flight has not started is archived at once as
   Cancelled. End: a live deal gets an end date, now or later, and keeps running until then. Both need a reason, kept on the deal and shown
   in Archived Deals. The API refuses the wrong action for a deal's state; the row actions only offer the right one. */
import { App, DatePicker, Input, Modal, Radio, Select } from 'antd'
import type { BuyersList } from '@ph-dsp/types'
import dayjs from 'dayjs'
import { useEffect, useState } from 'react'
import { api, ApiRequestError } from '../../api/client'
import { Icon } from '../../shared/Icon'
import { T } from '../../theme/phTheme'
import { flightMoment, TIME_ZONE_LABEL } from './effectiveTerm'

export type TerminateMode = 'cancel' | 'end'

/* Cancel is for a shared deal whose flight has not started; End for a live one that has no early end yet and whose flight is not over. */
export const canCancel = (l: BuyersList, now = Date.now()) => l.status === 'shared' && !!l.activeFrom && Date.parse(l.activeFrom) > now
export const canEnd = (l: BuyersList, now = Date.now()) => l.status === 'shared' && !l.endKind && (!l.activeFrom || Date.parse(l.activeFrom) <= now) && (!l.activeTo || Date.parse(l.activeTo) > now)

/* Same wall-clock-as-UTC form the flight dates use. */
const endIso = (d: dayjs.Dayjs) => `${d.format('YYYY-MM-DDTHH:mm')}:00.000Z`

export function EndDealDialog({ deal, mode, onClose, onDone }: { deal: BuyersList | null; mode: TerminateMode; onClose: () => void; onDone: () => void }) {
  const { message } = App.useApp()
  const [reason, setReason] = useState('')
  const [when, setWhen] = useState<'now' | 'later'>('now')
  const [at, setAt] = useState<dayjs.Dayjs | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { if (deal) { setReason(''); setWhen('now'); setAt(null); setError(null) } }, [deal?.id, mode])
  if (!deal) return null
  const cancelling = mode === 'cancel'
  const verb = cancelling ? 'Cancel deal' : 'End deal'
  const ready = reason.trim().length > 0 && (cancelling || when === 'now' || !!at)
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      if (cancelling) await api('POST', `/admin/v1/buyers-lists/${deal.id}/cancel`, { reason: reason.trim() })
      else await api('POST', `/admin/v1/buyers-lists/${deal.id}/end`, { reason: reason.trim(), endAt: when === 'now' ? new Date().toISOString() : endIso(at as dayjs.Dayjs) })
      message.success(cancelling ? `“${deal.name}” was cancelled and archived.` : when === 'now' ? `“${deal.name}” was ended.` : `“${deal.name}” will end on ${flightMoment(endIso(at as dayjs.Dayjs))}.`)
      onDone()
      onClose()
    } catch (e) {
      setError(e instanceof ApiRequestError ? [e.message, ...(e.body?.error.details ?? []).map((d) => d.reason)].join(' ') : `Could not ${verb.toLowerCase()}.`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open width={480} closable={false} onCancel={onClose}
      title={<span className="inline-flex items-center gap-2.5"><Icon name={cancelling ? 'cancel' : 'event_busy'} size={20} style={{ color: T.error }} />{`${verb} “${deal.name}”?`}</span>}
      okText={verb} okButtonProps={{ danger: true, disabled: !ready, loading: busy }} cancelText="Keep deal" onOk={submit}
    >
      <div style={{ fontSize: 13, lineHeight: 1.55 }}>
        <div>{cancelling
          ? 'The flight has not started. The deal is archived as Cancelled now and its slots are released. The advertiser is told, and campaigns using this deal ID do not deliver.'
          : 'The deal keeps running until the end date you choose, then releases its slots and archives itself as Ended early. Campaigns using this deal ID stop delivering at that time. Revenue up to it stays reported; nothing after it. Billing adjustments happen outside the platform.'}</div>
        {!cancelling && (
          <div className="mt-3">
            <Radio.Group value={when} onChange={(e) => setWhen(e.target.value)} aria-label="When the deal ends">
              <Radio value="now">End now</Radio>
              <Radio value="later">End on a date and time</Radio>
            </Radio.Group>
            {when === 'later' && (
              <div className="mt-2 flex gap-2">
                <DatePicker showTime={{ format: 'HH:mm' }} format="D MMM YYYY HH:mm" style={{ flex: 1 }} aria-label="End date and time" placeholder="End date and time" value={at}
                  disabledDate={(d) => d.isBefore(dayjs().startOf('day')) || (!!deal.activeTo && d.isAfter(dayjs(deal.activeTo.slice(0, 19)).endOf('day')))} onChange={setAt} />
                <Select aria-label="Time zone" style={{ width: 170 }} value={deal.timeZoneMode ?? 'platform'} disabled options={[{ value: 'platform', label: TIME_ZONE_LABEL.platform }, { value: 'store', label: TIME_ZONE_LABEL.store }]} />
              </div>
            )}
            <div className="mt-1" style={{ fontSize: 12, color: T.muted }}>A future date covers contractual notice. The platform has no notice period of its own.</div>
          </div>
        )}
        <label className="mt-3 mb-1 block" htmlFor="terminateReason" style={{ fontSize: 12, color: T.muted }}>Reason (required)</label>
        <Input.TextArea id="terminateReason" aria-label="Reason" rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this deal being ended? It is kept on the deal and shown in Archived Deals." />
        {error && <div className="mt-2" role="alert" style={{ color: T.error }}>{error}</div>}
      </div>
    </Modal>
  )
}
