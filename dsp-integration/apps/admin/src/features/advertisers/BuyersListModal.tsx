/* New/edit buyers list (spec "Support private auctions" — Available
   Inventory UX): the buyers list and its deal terms are ONE object, created
   or edited from this one pop-up. Floor (inherited from the slot), the
   auction resolution rule (platform-wide) and the per-brand relationship
   variable (global on the brand entity) are deliberately not fields here. */
import { App, Button, DatePicker, Input, Modal, Select } from 'antd'
import { useQuery } from '@tanstack/react-query'
import type { BuyersList, InvitedBuyer } from '@ph-dsp/types'
import dayjs from 'dayjs'
import { useEffect, useState } from 'react'
import { api, ApiRequestError } from '../../api/client'
import { Q } from '../../api/queries'
import { Icon } from '../../shared/Icon'
import { T } from '../../theme/phTheme'

type Draft = { name: string; description: string; invitedBuyers: InvitedBuyer[]; activeFrom: string | null; activeTo: string | null; auctionCloses: string | null }
/* An invited buyer is one synced seat of one connected DSP — the Select's value is both halves. */
const buyerKey = (b: InvitedBuyer) => JSON.stringify([b.partnerId, b.seatId])
const blankDraft = (): Draft => ({ name: '', description: '', invitedBuyers: [], activeFrom: null, activeTo: null, auctionCloses: null })
const draftOf = (l: BuyersList): Draft => ({
  name: l.name, description: l.description,
  invitedBuyers: l.invitedBuyers.map((b) => ({ ...b })),
  activeFrom: l.activeFrom, activeTo: l.activeTo, auctionCloses: l.auctionCloses,
})

export function BuyersListModal({ open, editing, onClose, onSaved }: {
  open: boolean
  /* null: creating a new buyers list. Set: editing this one. */
  editing: BuyersList | null
  onClose: () => void
  onSaved: (list: BuyersList) => void
}) {
  const { message } = App.useApp()
  const [draft, setDraft] = useState<Draft>(blankDraft)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!open) return
    setDraft(editing ? draftOf(editing) : blankDraft())
    setErrors({})
  }, [open, editing])

  /* The dropdown offers every advertiser (seat) a connected DSP has synced, grouped by DSP — no typing, no identifier type. */
  const partners = useQuery(Q.partners)
  const connected = (partners.data ?? []).filter((p) => p.status === 'connected' && p.seats?.length)
  const labelOf = new Map(connected.flatMap((p) => (p.seats ?? []).map((s) => [buyerKey({ partnerId: p.id, seatId: s.id }), `${s.name} (${p.name})`] as const)))
  const options = connected.map((p) => ({
    label: p.name,
    options: (p.seats ?? []).map((s) => ({ value: buyerKey({ partnerId: p.id, seatId: s.id }), label: `${s.name} (${p.name})` })),
  }))
  /* A saved buyer whose seat is no longer synced stays visible (by its seat ID) so it can be removed. */
  const staleOptions = draft.invitedBuyers.filter((b) => !labelOf.has(buyerKey(b))).map((b) => ({ value: buyerKey(b), label: `${b.seatId} (no longer synced)` }))
  const setBuyers = (keys: string[]) => setDraft((d) => ({ ...d, invitedBuyers: keys.map((k) => { const [partnerId, seatId] = JSON.parse(k) as [string, string]; return { partnerId, seatId } }) }))

  const save = async () => {
    setSaving(true)
    setErrors({})
    const payload = draft
    try {
      const saved = editing
        ? await api<BuyersList>('PUT', `/admin/v1/buyers-lists/${editing.id}`, payload)
        : await api<BuyersList>('POST', '/admin/v1/buyers-lists', payload)
      onSaved(saved)
      onClose()
    } catch (e) {
      /* Every other save flow in this app surfaces SOMETHING on failure
         (AdvertisersPage's onSave, DisplayTypesPage's errorText) — this one
         used to show field errors only when the API sent `details` and say
         nothing at all otherwise, so an error with no field to blame (the
         hosted demo's read-only 403, a plain 500, a name clash with no
         `field`) failed completely silently: the modal just sat there with
         no indication anything had gone wrong (Rob, 23 Sep — this is what
         made "+ Add new buyers list…" read as broken/"missing" when tested
         against the read-only demo, where every write is exactly this kind
         of detail-less error). Always show a message; add field errors too
         when the API gave them. */
      const detailFields = e instanceof ApiRequestError ? (e.body?.error.details ?? []).filter((d) => d.field) : []
      if (detailFields.length) setErrors(Object.fromEntries(detailFields.map((d) => [d.field as string, d.reason ?? 'Invalid.'])))
      message.error(e instanceof ApiRequestError ? [e.message, ...(e.body?.error.details ?? []).filter((d) => !d.field).map((d) => d.reason)].join(' ') : 'Could not save this buyers list.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open} width={580} destroyOnHidden confirmLoading={saving} onCancel={onClose} onOk={save}
      okText={editing ? 'Save changes' : 'Create buyers list'}
      title={
        <span className="inline-flex items-center gap-2">
          <Icon name="gavel" size={20} style={{ color: T.primary }} />
          {editing ? 'Edit buyers list' : 'New buyers list'}
        </span>
      }
    >
      <div className="mb-3.5">
        <label className="mb-1 block" style={{ fontSize: 13, color: T.muted }}><span style={{ color: T.error }}>*</span> Name</label>
        <Input value={draft.name} status={errors.name ? 'error' : undefined} placeholder="e.g. Q4 FMCG private auction" onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
        {errors.name && <div className="mt-1" style={{ fontSize: 11.5, color: T.error }}>{errors.name}</div>}
      </div>
      <div className="mb-3.5">
        <label className="mb-1 block" style={{ fontSize: 13, color: T.muted }}>Description</label>
        <Input.TextArea rows={2} value={draft.description} placeholder="So this list is distinguishable in the table below" onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />
      </div>
      <div className="mb-3.5">
        <label className="mb-1 block" style={{ fontSize: 13, color: T.muted }}><span style={{ color: T.error }}>*</span> Invited buyers</label>
        <Select
          mode="multiple" className="w-full" aria-label="Invited buyers" showSearch optionFilterProp="label"
          status={errors.invitedBuyers ? 'error' : undefined} loading={partners.isLoading}
          placeholder="Choose advertisers synced from your connected DSPs"
          notFoundContent="No advertisers synced yet — connect a DSP first."
          value={draft.invitedBuyers.map(buyerKey)} options={[...(staleOptions.length ? [{ label: 'Not synced', options: staleOptions }] : []), ...options]}
          onChange={setBuyers}
        />
        <div className="mt-1" style={{ fontSize: 11, color: T.micro }}>Only advertisers a connected DSP has synced can be invited; each is matched on the seat ID that DSP bids under.</div>
        {errors.invitedBuyers && <div className="mt-1" style={{ fontSize: 11.5, color: T.error }}>{errors.invitedBuyers}</div>}
      </div>
      <div className="mb-3.5">
        <label className="mb-1 block" style={{ fontSize: 13, color: T.muted }}>Delivery term</label>
        <DatePicker.RangePicker
          allowEmpty={[true, true]} showTime style={{ width: '100%' }}
          value={[draft.activeFrom ? dayjs(draft.activeFrom) : null, draft.activeTo ? dayjs(draft.activeTo) : null]}
          onChange={(v) => setDraft((d) => ({ ...d, activeFrom: v?.[0] ? v[0].toISOString() : null, activeTo: v?.[1] ? v[1].toISOString() : null }))}
        />
        <div className="mt-1" style={{ fontSize: 11, color: T.micro }}>The span this deal is awarded for — leave either side empty for no bound. Outside it, the deal admits nobody.</div>
        {errors.activeTo && <div className="mt-1" style={{ fontSize: 11.5, color: T.error }}>{errors.activeTo}</div>}
      </div>
      <div>
        <label className="mb-1 block" style={{ fontSize: 13, color: T.muted }}>Auction window closes</label>
        <DatePicker
          allowClear showTime style={{ width: '100%' }}
          value={draft.auctionCloses ? dayjs(draft.auctionCloses) : null}
          onChange={(v) => setDraft((d) => ({ ...d, auctionCloses: v ? v.toISOString() : null }))}
        />
        <div className="mt-1" style={{ fontSize: 11, color: T.micro }}>
          {editing?.lockedWin
            ? `Rate locked at ${editing.lockedWin.cpm} CPM on ${new Date(editing.lockedWin.lockedAt).toLocaleString()} — every play window for the rest of the delivery term books at that rate, no re-auction.`
            : 'The deadline invited brands may submit or revise bids until. The first bid that clears by then locks the winning CPM for the whole delivery term above — no daily re-auction. Leave empty to keep clearing a fresh auction every play window, as before.'}
        </div>
        {errors.auctionCloses && <div className="mt-1" style={{ fontSize: 11.5, color: T.error }}>{errors.auctionCloses}</div>}
      </div>
    </Modal>
  )
}
