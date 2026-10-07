/* New/edit buyers and targeting list (spec "Support private auctions" — Available
   Inventory UX): the buyers list and its deal terms are ONE object, created
   or edited from this one pop-up. It carries both who may buy (invited
   buyers) and the targeting criteria appended to the deal. The floor is optional: blank inherits
   the DSP's floor, else the platform floor (bid floor hierarchy). The auction resolution rule (platform-wide) and the per-brand relationship
   variable (global on the brand entity) are deliberately not fields here. */
import { App, Button, DatePicker, Input, InputNumber, Modal, Select } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { ALL_DSPS, OPERATOR_LABELS, TARGETING_VARIABLES, type BuyersList, type Condition, type InvitedBuyer, type SharedVariable } from '@ph-dsp/types'
import dayjs from 'dayjs'
import { useEffect, useRef, useState } from 'react'
import { api, ApiRequestError } from '../../api/client'
import { Q } from '../../api/queries'
import { Icon } from '../../shared/Icon'
import { WithTip } from '../../shared/InfoTip'
import { T } from '../../theme/phTheme'

type Draft = { name: string; description: string; invitedBuyers: InvitedBuyer[]; targeting: Condition[]; activeFrom: string | null; activeTo: string | null; auctionCloses: string | null; committedPlays: number | null; floorCpm: number | null }
/* An invited buyer is one synced seat of one connected DSP — the Select's value is both halves. */
const buyerKey = (b: InvitedBuyer) => JSON.stringify([b.partnerId, b.seatId])
const blankDraft = (): Draft => ({ name: '', description: '', invitedBuyers: [], targeting: [], activeFrom: null, activeTo: null, auctionCloses: null, committedPlays: null, floorCpm: null })
const draftOf = (l: BuyersList): Draft => ({
  name: l.name, description: l.description,
  invitedBuyers: l.invitedBuyers.map((b) => ({ ...b })),
  targeting: (l.targeting ?? []).map((c) => ({ ...c, values: [...c.values] })),
  activeFrom: l.activeFrom, activeTo: l.activeTo, auctionCloses: l.auctionCloses, committedPlays: l.committedPlays, floorCpm: l.floorCpm ?? null,
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
    setDraft(editing ? draftOf(editing) : { ...blankDraft(), committedPlays: defaultPlaysRef.current })
    setErrors({})
  }, [open, editing])

  /* Play config (Advertiser settings): the committed plays a NEW list starts with. Applied on open, and again
     if the default arrives or changes while the modal is open and the field is still untouched. Editing a
     saved list never takes it. */
  const settings = useQuery(Q.advertiserSettings)
  const defaultPlays = settings.data?.defaultCommittedPlays ?? null
  const defaultPlaysRef = useRef(defaultPlays)
  const untouched = useRef(true)
  useEffect(() => { untouched.current = true }, [open, editing])
  useEffect(() => {
    const prev = defaultPlaysRef.current
    defaultPlaysRef.current = defaultPlays
    if (open && !editing && untouched.current && prev !== defaultPlays) setDraft((d) => ({ ...d, committedPlays: defaultPlays }))
  }, [defaultPlays, open, editing])

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

  /* Targeting criteria offered are exactly the variables the retailer has
     enabled for EVERY invited buyer's DSP (Shared Targeting Variables) —
     nothing else is selectable. A criterion already saved on this list that
     has since been disabled stays visible, marked, so it can be removed. */
  const variables = useQuery(Q.targetingVariables)
  const dspIds = [...new Set(draft.invitedBuyers.map((b) => b.partnerId))]
  const enabledFor = (v: SharedVariable) => v.access === ALL_DSPS || dspIds.every((id) => (v.access as string[]).includes(id))
  const enabledVars = (variables.data ?? []).filter(enabledFor)
  const defOf = (key: string) => TARGETING_VARIABLES.find((v) => v.key === key)
  const groupOptions = (group: 'localisation' | 'personalisation') => ({
    label: group === 'localisation' ? 'Store and location' : 'Personalised (matched against the live visitor)',
    options: enabledVars.filter((v) => v.group === group).map((v) => ({ value: v.key, label: v.label })),
  })
  const stale = draft.targeting.filter((c) => !enabledVars.some((v) => v.key === c.variable))
  const targetingOptions = [
    ...(stale.length ? [{ label: 'No longer enabled', options: stale.map((c) => ({ value: c.variable, label: `${defOf(c.variable)?.label ?? c.variable} (not enabled)` })) }] : []),
    groupOptions('localisation'), groupOptions('personalisation'),
  ].filter((g) => g.options.length)
  const setCriteria = (keys: string[]) => setDraft((d) => ({
    ...d,
    targeting: keys.map((k) => d.targeting.find((c) => c.variable === k) ?? { source: defOf(k)?.source ?? 'store', variable: k, op: defOf(k)?.operators[0] ?? 'include', values: [] }),
  }))
  const patchCriterion = (key: string, patch: Partial<Condition>) => setDraft((d) => ({ ...d, targeting: d.targeting.map((c) => (c.variable === key ? { ...c, ...patch } : c)) }))
  const errorFor = (key: string) => Object.entries(errors).find(([f]) => f.startsWith('targeting[') && draft.targeting[Number(f.slice(10, f.indexOf(']')))]?.variable === key)?.[1]

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
      okText={editing ? 'Save changes' : 'Create buyers and targeting'}
      title={
        <span className="inline-flex items-center gap-2">
          <Icon name="gavel" size={20} style={{ color: T.primary }} />
          {editing ? 'Edit buyers and targeting' : 'New buyers and targeting'}
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
        <label className="mb-1 block" style={{ fontSize: 13, color: T.muted }}><WithTip tip="Only advertisers a connected DSP has synced can be invited (who can buy); each is matched on the seat ID that DSP bids under."><span style={{ color: T.error }}>*</span> Invited buyers</WithTip></label>
        <Select
          mode="multiple" className="w-full" aria-label="Invited buyers" showSearch optionFilterProp="label"
          status={errors.invitedBuyers ? 'error' : undefined} loading={partners.isLoading}
          placeholder="Choose advertisers synced from your connected DSPs"
          notFoundContent="No advertisers synced yet — connect a DSP first."
          value={draft.invitedBuyers.map(buyerKey)} options={[...(staleOptions.length ? [{ label: 'Not synced', options: staleOptions }] : []), ...options]}
          onChange={setBuyers}
        />
        {errors.invitedBuyers && <div className="mt-1" style={{ fontSize: 11.5, color: T.error }}>{errors.invitedBuyers}</div>}
      </div>
      <div className="mb-3.5">
        <label className="mb-1 block" style={{ fontSize: 13, color: T.muted }}><WithTip tip="Only variables the retailer has enabled for the invited DSPs are offered. Store segments are variable (switched by store staff) or fixed (HQ Admin only); the deal honours whichever you choose. A personalised criterion is matched against the live visitor at bid time — buyers never see the visitor’s attributes.">Targeting criteria</WithTip></label>
        <Select
          mode="multiple" className="w-full" aria-label="Targeting criteria" showSearch optionFilterProp="label"
          loading={variables.isLoading} placeholder="Add criteria appended to this deal (all must match)"
          notFoundContent="No targeting variables are enabled for the invited DSPs."
          value={draft.targeting.map((c) => c.variable)} options={targetingOptions} onChange={setCriteria}
        />
        {draft.targeting.map((c) => {
          const def = defOf(c.variable)
          return (
            <div key={c.variable} className="mt-2 flex flex-wrap items-center gap-2" data-testid={`criterion-${c.variable}`}>
              <span style={{ fontSize: 12.5, fontWeight: 500, minWidth: 140 }}>{def?.label ?? c.variable}</span>
              <Select size="small" style={{ width: 170 }} aria-label={`${def?.label ?? c.variable} operator`} value={c.op} onChange={(op) => patchCriterion(c.variable, { op })}
                options={(def?.operators ?? [c.op]).map((o) => ({ value: o, label: OPERATOR_LABELS[o] }))} />
              <Select mode="tags" size="small" style={{ flex: 1, minWidth: 160 }} aria-label={`${def?.label ?? c.variable} values`} tokenSeparators={[',']} open={false}
                placeholder={def ? `e.g. ${def.values}` : 'Values'} status={errorFor(c.variable) ? 'error' : undefined} value={c.values} onChange={(values) => patchCriterion(c.variable, { values })} />
              {errorFor(c.variable) && <div className="w-full" style={{ fontSize: 11.5, color: T.error }}>{errorFor(c.variable)}</div>}
            </div>
          )
        })}
      </div>
      <div className="mb-3.5">
        <label className="mb-1 block" style={{ fontSize: 13, color: T.muted }}><WithTip tip="The span this deal is awarded for — leave either side empty for no bound. Outside it, the deal admits nobody.">Delivery term</WithTip></label>
        <DatePicker.RangePicker
          allowEmpty={[true, true]} showTime style={{ width: '100%' }}
          value={[draft.activeFrom ? dayjs(draft.activeFrom) : null, draft.activeTo ? dayjs(draft.activeTo) : null]}
          onChange={(v) => setDraft((d) => ({ ...d, activeFrom: v?.[0] ? v[0].toISOString() : null, activeTo: v?.[1] ? v[1].toISOString() : null }))}
        />
        {errors.activeTo && <div className="mt-1" style={{ fontSize: 11.5, color: T.error }}>{errors.activeTo}</div>}
      </div>
      <div className="mb-3.5">
        <label className="mb-1 block" style={{ fontSize: 13, color: T.muted }}><WithTip tip="The number of plays this deal commits to over its delivery term. Volume is carried by deals; the open auction always stays per play. Delivery is counted in plays billed at the slots this list is assigned to.">Committed plays</WithTip></label>
        <InputNumber
          min={1} precision={0} style={{ width: '100%' }} aria-label="Committed plays"
          status={errors.committedPlays ? 'error' : undefined} placeholder="Leave empty for per play"
          value={draft.committedPlays} onChange={(v) => { untouched.current = false; setDraft((d) => ({ ...d, committedPlays: typeof v === 'number' ? v : null })) }}
        />
        {errors.committedPlays && <div className="mt-1" style={{ fontSize: 11.5, color: T.error }}>{errors.committedPlays}</div>}
      </div>
      <div className="mb-3.5">
        <label className="mb-1 block" style={{ fontSize: 13, color: T.muted }} htmlFor="buyersListFloorCpm"><WithTip tip="In USD. Applies to deals using this list, overriding the DSP's floor. It can raise the floor but never go below the platform floor. Leave empty to inherit.">Floor price (CPM)</WithTip></label>
        <InputNumber
          id="buyersListFloorCpm" min={0} style={{ width: '100%' }} step={1} placeholder="Inherit the DSP or platform floor"
          status={errors.floorCpm ? 'error' : undefined}
          formatter={(v) => (v === undefined || v === null ? '' : String(v))} parser={(v) => Number(v)}
          value={draft.floorCpm} onChange={(v) => setDraft((d) => ({ ...d, floorCpm: typeof v === 'number' && v > 0 ? v : null }))}
        />
        {errors.floorCpm && <div className="mt-1" style={{ fontSize: 11.5, color: T.error }}>{errors.floorCpm}</div>}
      </div>
      {editing?.lockedWin && (
        <div style={{ fontSize: 12.5, color: T.muted }}>Rate locked at {editing.lockedWin.cpm} CPM on {new Date(editing.lockedWin.lockedAt).toLocaleString()}: every play for the rest of the delivery term books at that rate.</div>
      )}
    </Modal>
  )
}
