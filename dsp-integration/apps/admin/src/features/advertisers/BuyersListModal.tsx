/* New/edit buyers list (spec "Support private auctions" — Available
   Inventory UX): the buyers list and its deal terms are ONE object, created
   or edited from this one pop-up. Floor (inherited from the slot), the
   auction resolution rule (platform-wide) and the per-brand relationship
   variable (global on the brand entity) are deliberately not fields here. */
import { Button, DatePicker, Input, Modal, Select } from 'antd'
import { IDENTIFIER_TYPES, type BuyersList, type IdentifierType, type InvitedBuyer } from '@ph-dsp/types'
import dayjs from 'dayjs'
import { useEffect, useState } from 'react'
import { api, ApiRequestError } from '../../api/client'
import { Icon } from '../../shared/Icon'
import { T } from '../../theme/phTheme'

type Draft = { name: string; description: string; invitedBuyers: InvitedBuyer[]; activeFrom: string | null; activeTo: string | null }
const blankBuyer = (): InvitedBuyer => ({ identifierType: 'brandEntity', value: '' })
const blankDraft = (): Draft => ({ name: '', description: '', invitedBuyers: [blankBuyer()], activeFrom: null, activeTo: null })
const draftOf = (l: BuyersList): Draft => ({
  name: l.name, description: l.description,
  invitedBuyers: l.invitedBuyers.length ? l.invitedBuyers.map((b) => ({ ...b })) : [blankBuyer()],
  activeFrom: l.activeFrom, activeTo: l.activeTo,
})

export function BuyersListModal({ open, editing, onClose, onSaved }: {
  open: boolean
  /* null: creating a new buyers list. Set: editing this one. */
  editing: BuyersList | null
  onClose: () => void
  onSaved: (list: BuyersList) => void
}) {
  const [draft, setDraft] = useState<Draft>(blankDraft)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!open) return
    setDraft(editing ? draftOf(editing) : blankDraft())
    setErrors({})
  }, [open, editing])

  const setBuyer = (i: number, patch: Partial<InvitedBuyer>) => setDraft((d) => ({ ...d, invitedBuyers: d.invitedBuyers.map((b, j) => (j === i ? { ...b, ...patch } : b)) }))
  const addBuyer = () => setDraft((d) => ({ ...d, invitedBuyers: [...d.invitedBuyers, blankBuyer()] }))
  const removeBuyer = (i: number) => setDraft((d) => ({ ...d, invitedBuyers: d.invitedBuyers.filter((_, j) => j !== i) }))

  const save = async () => {
    setSaving(true)
    setErrors({})
    const payload = { ...draft, invitedBuyers: draft.invitedBuyers.filter((b) => b.value.trim()) }
    try {
      const saved = editing
        ? await api<BuyersList>('PUT', `/admin/v1/buyers-lists/${editing.id}`, payload)
        : await api<BuyersList>('POST', '/admin/v1/buyers-lists', payload)
      onSaved(saved)
      onClose()
    } catch (e) {
      if (e instanceof ApiRequestError && e.body?.error.details) {
        setErrors(Object.fromEntries(e.body.error.details.filter((d) => d.field).map((d) => [d.field as string, d.reason ?? 'Invalid.'])))
      }
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
        <div className="mb-1.5 flex items-center justify-between">
          <label style={{ fontSize: 13, color: T.muted }}><span style={{ color: T.error }}>*</span> Invited buyers</label>
          <Button type="text" size="small" icon={<Icon name="add" size={14} />} onClick={addBuyer}>Add buyer</Button>
        </div>
        <div className="flex flex-col gap-1.5">
          {draft.invitedBuyers.map((b, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Select<IdentifierType>
                size="small" style={{ width: 168 }} aria-label={`Invited buyer ${i + 1}: identifier type`}
                value={b.identifierType} options={IDENTIFIER_TYPES.map((t) => ({ value: t.key, label: t.label }))}
                onChange={(v) => setBuyer(i, { identifierType: v })}
              />
              <Input
                size="small" aria-label={`Invited buyer ${i + 1}: value`} value={b.value}
                placeholder={IDENTIFIER_TYPES.find((t) => t.key === b.identifierType)?.placeholder}
                onChange={(e) => setBuyer(i, { value: e.target.value })}
              />
              <Button type="text" size="small" danger aria-label={`Remove invited buyer ${i + 1}`} disabled={draft.invitedBuyers.length === 1}
                icon={<Icon name="close" size={14} />} onClick={() => removeBuyer(i)} />
            </div>
          ))}
        </div>
        {errors.invitedBuyers && <div className="mt-1" style={{ fontSize: 11.5, color: T.error }}>{errors.invitedBuyers}</div>}
      </div>
      <div>
        <label className="mb-1 block" style={{ fontSize: 13, color: T.muted }}>Active time window</label>
        <DatePicker.RangePicker
          allowEmpty={[true, true]} showTime style={{ width: '100%' }}
          value={[draft.activeFrom ? dayjs(draft.activeFrom) : null, draft.activeTo ? dayjs(draft.activeTo) : null]}
          onChange={(v) => setDraft((d) => ({ ...d, activeFrom: v?.[0] ? v[0].toISOString() : null, activeTo: v?.[1] ? v[1].toISOString() : null }))}
        />
        <div className="mt-1" style={{ fontSize: 11, color: T.micro }}>Leave either side empty for no bound.</div>
        {errors.activeTo && <div className="mt-1" style={{ fontSize: 11.5, color: T.error }}>{errors.activeTo}</div>}
      </div>
    </Modal>
  )
}
