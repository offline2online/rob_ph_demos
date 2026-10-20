/* New/edit deal and buyers list (spec "Support private auctions" — Available
   Inventory UX): the buyers list and its deal terms are ONE object, created
   or edited from this one pop-up. It carries both who may buy (invited
   buyers) and the targeting criteria appended to the deal. The floor is optional: blank inherits
   the DSP's floor, else the platform floor (bid floor hierarchy). The auction resolution rule (platform-wide) is deliberately not a field here.

   Lifecycle (ticket QG40V1vVwqp9NtFmlC9H): Save as draft (shared with no DSP; it can be assigned to slots) -> Finalise (needs at
   least one assigned slot; opens FinaliseDealModal to confirm the slots, deal ID and terms) -> Share deal (inside that pop-up). */
import { App, Button, DatePicker, Input, InputNumber, Modal, Select } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { ALL_DSPS, OPERATOR_LABELS, formatAggregateValue, isAggregateVariable, parseAggregateValue, TARGETING_VARIABLES, type BuyersList, type BuyersListDealType, type Condition, type InvitedBuyer, type SharedVariable, type TermCheck } from '@ph-dsp/types'
import dayjs from 'dayjs'
import { useEffect, useRef, useState } from 'react'
import { api, ApiRequestError } from '../../api/client'
import { Q } from '../../api/queries'
import { Icon } from '../../shared/Icon'
import { WithTip } from '../../shared/InfoTip'
import { Tip } from '../../shared/Tip'
import { IAB_OPTIONS_SORTED, iabFilterOption } from '../../shared/iabOptions'
import { T } from '../../theme/phTheme'
import { equivalentCpmText, PER_DAY_HINT, playsText, rateText, rateTypeOf, resolveTerm, sourceLabel } from './effectiveTerm'
import { FinaliseDealModal } from './FinaliseDealModal'

type Draft = { name: string; description: string; dealType: BuyersListDealType; invitedBuyers: InvitedBuyer[]; invitedCategories: string[]; targeting: Condition[]; activeFrom: string | null; activeTo: string | null; auctionCloses: string | null; committedPlays: number | null; floorCpm: number | null; ratePerDay: number | null }
/* An invited buyer is one synced seat of one connected DSP — the Select's value is both halves. */
/* The full IAB Content Taxonomy 1.0, tier 1 then its subcategories. */
const IAB_CATEGORY_OPTIONS = IAB_OPTIONS_SORTED
const buyerKey = (b: InvitedBuyer) => JSON.stringify([b.partnerId, b.seatId])
/* The AWS POC supports programmatic guaranteed (plus open auction) only: the other deal types stay visible, greyed out, for demos. */
const COMING_SOON = 'Coming in a future release. The POC supports programmatic guaranteed deals only.'
const blankDraft = (): Draft => ({ name: '', description: '', dealType: 'guaranteed', invitedBuyers: [], invitedCategories: [], targeting: [], activeFrom: null, activeTo: null, auctionCloses: null, committedPlays: null, floorCpm: null, ratePerDay: null })
const draftOf = (l: BuyersList): Draft => ({
  name: l.name, description: l.description, dealType: l.dealType,
  invitedBuyers: l.invitedBuyers.map((b) => ({ ...b })),
  invitedCategories: l.dealType === 'private_auction' ? [...(l.invitedCategories ?? [])] : [],
  targeting: (l.targeting ?? []).map((c) => ({ ...c, values: [...c.values] })),
  activeFrom: l.activeFrom, activeTo: l.activeTo, auctionCloses: l.auctionCloses, committedPlays: l.committedPlays, floorCpm: l.floorCpm ?? null, ratePerDay: l.ratePerDay ?? null,
})
/* A Programmatic guaranteed flight is picked in whole days (20 Oct 2026; DOOH full-day takeover): the first day from 00:00 UTC, the last day to 23:59:59.999 UTC, so every day on the slot is a full 24 hours. */
const dayStart = (d: dayjs.Dayjs) => `${d.format('YYYY-MM-DD')}T00:00:00.000Z`
const dayEnd = (d: dayjs.Dayjs) => `${d.format('YYYY-MM-DD')}T23:59:59.999Z`
const dayOf = (iso: string | null) => (iso ? dayjs(iso.slice(0, 10)) : null)

export function BuyersListModal({ open, editing, onClose, onSaved, showTargeting = false }: {
  open: boolean
  /* The dealTargeting flag: off, the criteria picker is hidden and nothing is saved in it. */
  showTargeting?: boolean
  /* null: creating a new buyers list. Set: editing this one. */
  editing: BuyersList | null
  onClose: () => void
  onSaved: (list: BuyersList) => void
}) {
  const { message, modal } = App.useApp()
  const [draft, setDraft] = useState<Draft>(blankDraft)
  const [saving, setSaving] = useState(false)
  /* Set once Finalise has saved the draft: the confirmation pop-up for it. */
  const [finalising, setFinalising] = useState<BuyersList | null>(null)
  const isDraft = !editing || editing.status === 'draft'
  /* Absent on the hosted read-only snapshot, which pre-dates drafts. */
  const slots = editing?.assignedSlots ?? []
  const [errors, setErrors] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!open) return
    setDraft(editing ? draftOf(editing) : { ...blankDraft(), committedPlays: defaultPlaysRef.current })
    setErrors({})
  }, [open, editing])

  /* Play config (Advertiser settings): the committed plays a NEW guaranteed list starts with. Applied when the
     guaranteed type is chosen, and again if the default arrives or changes while the field is still untouched. Editing a
     saved list never takes it. */
  const settings = useQuery(Q.advertiserSettings)
  const defaultPlays = settings.data?.defaultCommittedPlays ?? null
  const defaultPlaysRef = useRef(defaultPlays)
  const untouched = useRef(true)
  useEffect(() => { untouched.current = true }, [open, editing])
  useEffect(() => {
    const prev = defaultPlaysRef.current
    defaultPlaysRef.current = defaultPlays
    if (open && !editing && untouched.current && prev !== defaultPlays) setDraft((d) => (d.dealType === 'guaranteed' ? { ...d, committedPlays: defaultPlays } : d))
  }, [defaultPlays, open, editing])

  /* The deal type decides which fields the list carries (7 Oct 2026): switching drops what the new type does not capture. */
  const setDealType = (dealType: BuyersListDealType) => setDraft((d) => ({
    ...d, dealType,
    /* The auction window is retired (16 Oct 2026); only a legacy deal's saved value is carried, so an edit does not re-version it. */
    auctionCloses: dealType === d.dealType ? d.auctionCloses : null,
    invitedCategories: dealType === 'private_auction' ? d.invitedCategories : [],
    committedPlays: dealType !== 'guaranteed' ? null : d.committedPlays ?? (untouched.current ? defaultPlaysRef.current : null),
    ratePerDay: dealType === 'guaranteed' ? d.ratePerDay : null,
  }))
  const guaranteed = draft.dealType === 'guaranteed'
  const privateAuction = draft.dealType === 'private_auction'

  /* The dropdown offers every advertiser (seat) a connected DSP has synced, grouped by DSP — no typing, no identifier type. */
  const partners = useQuery(Q.partners)
  /* What the two terms resolve to for this draft: platform default -> DSP -> this list (Rob, 7 Oct 2026), so
     neither field is ever left looking blank. The platform floor clamps a lower DSP floor up, as the exchange does. */
  const draftDsps = [...new Set(draft.invitedBuyers.map((b) => b.partnerId))].map((id) => (partners.data ?? []).find((p) => p.id === id)?.bidder)
  const platformFloor = settings.data?.floorCpm
  const volume = resolveTerm(defaultPlays, draftDsps.map((b) => b?.committedPlays), draft.committedPlays)
  const rate = resolveTerm(platformFloor, draftDsps.map((b) => b?.floorCpm), draft.floorCpm, (n) => Math.max(platformFloor ?? 0, n))
  /* Equivalent CPM (rate per day / forecast impressions per day x 1000) needs the assigned slots' forecast. The API derives it for the saved rate; the draft's follows it linearly, so it updates as the rate is typed. */
  const equivalent = (() => {
    const saved = editing?.ratePerDay && editing.equivalentCpm ? editing : null
    if (!saved || !draft.ratePerDay) return null
    const k = draft.ratePerDay / (saved.ratePerDay as number)
    const e = saved.equivalentCpm as { min: number; max: number }
    return { min: Math.round(e.min * k * 100) / 100, max: Math.round(e.max * k * 100) / 100 }
  })()
  const equivalentNote = equivalentCpmText(equivalent) ?? (slots.length ? 'Save to see it' : 'Assign a slot to see the equivalent CPM')
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

  /* Term versioning (ticket KcqiJpzR5RXy4TWODYlG): before an edit is saved, ask the API whether it changes what accepted buyers agreed to. If so, say so and let the retailer back out; otherwise it saves with no warning. If the check itself can't be made, the save goes ahead and reports its own errors. */
  const confirmReacceptance = (check: TermCheck) => new Promise<boolean>((resolve) => {
    modal.confirm({
      title: 'Buyers will need to re-accept this deal',
      content: (
        <div data-testid="reacceptance-warning">
          <p>This change creates term version {check.nextVersion}. The buyers who had accepted the current terms will have to accept again; until they do they stay on the version they accepted.</p>
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            {check.affectedBuyers.map((b) => <li key={`${b.partnerId}/${b.seatId}`}>{b.seatId} ({b.partnerName})</li>)}
          </ul>
        </div>
      ),
      okText: 'Save and request re-acceptance', cancelText: 'Keep editing',
      onOk: () => resolve(true), onCancel: () => resolve(false),
    })
  })

  const save = async (finalise = false) => {
    setSaving(true)
    setErrors({})
    const payload = showTargeting ? draft : { ...draft, targeting: [] }
    try {
      if (editing) {
        const check = await api<TermCheck>('POST', `/admin/v1/buyers-lists/${editing.id}/term-check`, payload).catch(() => null)
        if (check?.requiresReacceptance && !(await confirmReacceptance(check))) return
      }
      const saved = editing
        ? await api<BuyersList>('PUT', `/admin/v1/buyers-lists/${editing.id}`, payload)
        : await api<BuyersList>('POST', '/admin/v1/buyers-lists', { ...payload, status: 'draft' })
      /* A changed deal type is saved as a new deal with a new ID; the original row stays as it was. */
      if (editing && saved.id !== editing.id) message.success(`Deal type changed, so a new deal was created. Its Deal ID is ${saved.dealId}; the original deal (${editing.dealId}) is unchanged.`)
      onSaved(saved)
      /* Finalise saves what is on screen first, so the pop-up confirms exactly what will be shared. A changed deal type is a new deal with no slots yet, so it cannot be finalised from here. */
      if (finalise && saved.id === editing?.id) { setFinalising(saved); return }
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
    <>
    <Modal
      open={open} width={580} destroyOnHidden confirmLoading={saving} onCancel={onClose}
      footer={<div className="flex justify-end gap-2" data-testid="deal-actions">{[
        <Button key="cancel" onClick={onClose}>Cancel</Button>,
        <Button key="save" type={isDraft && editing ? 'default' : 'primary'} loading={saving} onClick={() => save()}>{!isDraft ? 'Save changes' : editing ? 'Save draft' : 'Save as draft'}</Button>,
        ...(isDraft ? [
          <Tip key="finalise" title={slots.length ? undefined : 'Assign this deal to at least one slot in Available Inventory first. A deal with no inventory can’t be finalised.'}>
            <span><Button type="primary" disabled={saving || !editing || !slots.length} onClick={() => save(true)}>Finalise deal terms</Button></span>
          </Tip>,
        ] : []),
      ]}</div>}
      title={
        <span className="inline-flex items-center gap-2">
          <Icon name="gavel" size={20} style={{ color: T.primary }} />
          {editing ? 'Edit deal and buyers list' : 'New deal and buyers list'}
        </span>
      }
    >
      <div className="mb-3.5" style={{ fontSize: 12.5, color: T.muted }} data-testid="deal-status-note">
        {!isDraft
          ? 'Shared with the buyers. A change to its terms asks the buyers who accepted to accept again.'
          : editing
            ? `Draft: not shared with any DSP. ${slots.length ? `Assigned to ${slots.length} slot${slots.length === 1 ? '' : 's'}; finalise it to share it.` : 'Assign it to a slot in Available Inventory, then finalise it to share it.'}`
            : 'Save as draft first: nothing is shared with any DSP. Then assign it to a slot in Available Inventory and finalise it.'}
      </div>
      <div className="mb-3.5">
        <label className="mb-1 block" style={{ fontSize: 13, color: T.muted }}><span style={{ color: T.error }}>*</span> Name</label>
        <Input value={draft.name} status={errors.name ? 'error' : undefined} placeholder="e.g. Q4 FMCG private auction" onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
        {errors.name && <div className="mt-1" style={{ fontSize: 11.5, color: T.error }}>{errors.name}</div>}
      </div>
      {editing && editing.termVersion != null && <div className="mb-3.5" style={{ fontSize: 12.5, color: T.muted }} data-testid="term-version">
        <WithTip tip="The deal's rate, flight dates and buyers are versioned on the same deal ID. Changing the rate, guaranteed impressions or flight dates asks the buyers who accepted to accept again.">{`Term version ${editing.termVersion} · ${(editing.buyerAcceptance ?? []).filter((a) => a.state === 'accepted').length} of ${(editing.buyerAcceptance ?? []).length} buyers on this version`}</WithTip>
      </div>}
      {editing && <div className="mb-3.5">
        <label className="mb-1 block" style={{ fontSize: 13, color: T.muted }} htmlFor="buyersListDealId"><WithTip tip="Generated by the platform when the list was created and fixed for the life of the deal. This is the ID the buyer targets in their DSP (pmp.deals[].id); share it with them.">Deal ID</WithTip></label>
        {(editing.deals ?? []).filter((d) => !d.retiredAt).length > 1
          ? (editing.deals ?? []).filter((d) => !d.retiredAt).map((d) => {
            const dsp = (partners.data ?? []).find((p) => p.id === d.partnerId)?.name ?? d.partnerId
            return <div key={d.dealId} className="mb-1 flex items-center gap-2"><span style={{ fontSize: 12.5, minWidth: 120 }}>{dsp}</span><Input aria-label={`Deal ID — ${dsp}`} readOnly value={d.dealId} style={{ fontFamily: 'monospace' }} /></div>
          })
          : <Input id="buyersListDealId" aria-label="Deal ID" readOnly value={(editing.deals ?? []).find((d) => !d.retiredAt)?.dealId ?? editing.dealId} style={{ fontFamily: 'monospace' }} />}
        {(editing.deals ?? []).filter((d) => !d.retiredAt).length > 1 && <div className="mt-1" style={{ fontSize: 11.5, color: T.muted }}>One deal ID per DSP: each DSP's buyer accepts its own. Terms are shared.</div>}
      </div>}
      <div className="mb-3.5">
        <label className="mb-1 block" style={{ fontSize: 13, color: T.muted }}>Description</label>
        <Input.TextArea rows={2} value={draft.description} placeholder="So this list is distinguishable in the table below" onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />
      </div>
      <div className="mb-3.5">
        <label className="mb-1 block" style={{ fontSize: 13, color: T.muted }} htmlFor="buyersListDealType"><WithTip tip="The deal type this list bids against, and where it is set: the DSP deal (deal ID and type) and any reservation on a slot using this list follow it. Private auction: invited buyers bid on each slot throughout the flight, first price, against the rate as a floor; nothing is held or locked. Preferred deal: one named buyer, a fixed CPM and first look at every slot ahead of private and open auction; the buyer may pass, and no window is reserved. Programmatic guaranteed: commits a volume, shown as guaranteed impressions."><span style={{ color: T.error }}>*</span> Deal type</WithTip></label>
        <Select
          id="buyersListDealType" className="w-full" aria-label="Deal type" value={draft.dealType} onChange={setDealType}
          options={[
            { value: 'private_auction', label: <WithTip tip={COMING_SOON}>Private auction</WithTip>, disabled: true },
            { value: 'preferred', label: <WithTip tip={COMING_SOON}>Preferred deal</WithTip>, disabled: true },
            { value: 'guaranteed', label: 'Programmatic guaranteed' },
          ]}
        />
        {editing && draft.dealType !== editing.dealType && <div className="mt-1" style={{ fontSize: 11.5, color: T.error }} data-testid="deal-type-new-deal-note">The deal type is fixed once saved. Saving creates a new deal with a new Deal ID; this deal ({editing.dealId}) is left as it is.</div>}
        <div className="mt-1" style={{ fontSize: 11.5, color: T.muted }} data-testid="deal-type-note">
          {privateAuction ? 'Invited buyers bid on each slot, first price; nothing is held or locked, and no volume is committed.' : guaranteed ? 'Commits a volume of impressions; there is no bidding.' : 'One named buyer at a fixed CPM with first look at each slot; it may pass. No window is reserved and no volume is committed.'}
        </div>
      </div>
      <div className="mb-3.5">
        <label className="mb-1 block" style={{ fontSize: 13, color: T.muted }}><WithTip tip="Only advertisers a connected DSP has synced can be invited (who can buy); each is matched on the seat ID that DSP bids under.">Buyers</WithTip></label>
        <Select
          mode="multiple" className="w-full" aria-label="Buyers" showSearch optionFilterProp="label"
          status={errors.invitedBuyers ? 'error' : undefined} loading={partners.isLoading}
          placeholder="Choose advertisers synced from your connected DSPs"
          notFoundContent="No advertisers synced yet — connect a DSP first."
          value={draft.invitedBuyers.map(buyerKey)} options={[...(staleOptions.length ? [{ label: 'Not synced', options: staleOptions }] : []), ...options]}
          onChange={setBuyers}
        />
        {errors.invitedBuyers && <div className="mt-1" style={{ fontSize: 11.5, color: T.error }}>{errors.invitedBuyers}</div>}
      </div>
      {privateAuction && <div className="mb-3.5">
        <label className="mb-1 block" style={{ fontSize: 13, color: T.muted }}><WithTip tip="Widens who may bid in this private auction: invite every advertiser a connected DSP reports in these IAB categories, without naming each one. Combines with the invited buyers above (either is enough to bid); the advertiser blacklist still applies. Resolved live, so advertisers a DSP adds or re-categorises move in or out with no edit. A category is a bid-time filter only: the deal ID is shared with, and authored against, named buyers. Fill in at least one of the two.">Invited IAB categories</WithTip></label>
        <Select
          mode="multiple" className="w-full" aria-label="Invited IAB categories" showSearch filterOption={iabFilterOption}
          status={Object.keys(errors).some((f) => f.startsWith('invitedCategories')) ? 'error' : undefined}
          placeholder="Choose IAB categories"
          value={draft.invitedCategories} options={IAB_CATEGORY_OPTIONS}
          onChange={(invitedCategories: string[]) => setDraft((d) => ({ ...d, invitedCategories }))}
        />
        {Object.entries(errors).filter(([f]) => f.startsWith('invitedCategories')).map(([f, reason]) => <div key={f} className="mt-1" style={{ fontSize: 11.5, color: T.error }}>{reason}</div>)}
        {!draft.invitedBuyers.length && draft.invitedCategories.length > 0 && <div className="mt-1" style={{ fontSize: 11.5, color: T.muted }} data-testid="category-only-note">Category-only: matching advertisers can bid, but the deal ID can’t be formally shared or authored against until you invite at least one named buyer.</div>}
      </div>}
      {showTargeting && <div className="mb-3.5">
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
              {(() => {
                const sv = (variables.data ?? []).find((v) => v.key === c.variable)
                const label = `${def?.label ?? c.variable} values`
                const status = errorFor(c.variable) ? 'error' : undefined
                const operator = (width: number) => (
                  <Select size="small" style={{ width }} aria-label={`${def?.label ?? c.variable} operator`} value={c.op} onChange={(op) => patchCriterion(c.variable, { op })}
                    options={(def?.operators ?? [c.op]).map((o) => ({ value: o, label: OPERATOR_LABELS[o] }))} />
                )
                if (isAggregateVariable(c.variable)) {
                  /* A share of everyone present, in one row: category (from Shared Targeting Variables), comparison, percentage. The name sits on its own line above so all three fit. */
                  const { category, pct } = parseAggregateValue(c.values[0])
                  const setAgg = (cat: string | undefined, n: number | null) => patchCriterion(c.variable, { values: n !== null ? [formatAggregateValue(cat ?? '', n)] : cat ? [cat] : [] })
                  return (
                    <>
                      <span className="w-full" style={{ fontSize: 12.5, fontWeight: 500 }}>{def?.label ?? c.variable}</span>
                      <Select size="small" style={{ flex: 1, minWidth: 120 }} aria-label={label} placeholder="Choose category" status={status} value={category || undefined}
                        options={[...new Set([...(sv?.values ?? []), ...(category ? [category] : [])])].map((v) => ({ value: v, label: v }))} onChange={(v) => setAgg(v, pct)} />
                      {operator(150)}
                      <InputNumber size="small" min={0} max={100} style={{ width: 100 }} aria-label={`${def?.label ?? c.variable} percentage`} placeholder="Percentage" addonAfter="%" status={status}
                        value={pct} onChange={(n) => setAgg(category || undefined, n === null ? null : Number(n))} />
                      {!sv?.values.length && <span style={{ fontSize: 12, color: T.micro }}>Define its values in Shared Targeting Variables</span>}
                    </>
                  )
                }
                return (
                  <>
                    <span style={{ fontSize: 12.5, fontWeight: 500, minWidth: 140 }}>{def?.label ?? c.variable}</span>
                    {operator(170)}
                    {sv?.freeText ? <Select mode="tags" size="small" style={{ flex: 1, minWidth: 160 }} aria-label={label} tokenSeparators={[',']} open={false} placeholder={def ? `e.g. ${def.values}` : 'Values'} status={status} value={c.values} onChange={(values) => patchCriterion(c.variable, { values })} />
                      : sv?.values.length ? <Select mode="multiple" size="small" style={{ flex: 1, minWidth: 160 }} aria-label={label} placeholder="Choose values" status={status} value={c.values} options={[...new Set([...sv.values, ...c.values])].map((v) => ({ value: v, label: v }))} onChange={(values) => patchCriterion(c.variable, { values })} />
                      : <span style={{ fontSize: 12, color: T.micro }}>Define its values in Shared Targeting Variables</span>}
                  </>
                )
              })()}
              {errorFor(c.variable) && <div className="w-full" style={{ fontSize: 11.5, color: T.error }}>{errorFor(c.variable)}</div>}
            </div>
          )
        })}
      </div>}
      <div className="mb-3.5">
        <label className="mb-1 block" style={{ fontSize: 13, color: T.muted }}><WithTip tip="The span this deal is awarded for (Start date to End date) — leave either side empty for no bound. Outside it, the deal admits nobody.">Flight dates</WithTip></label>
        {guaranteed
          ? <DatePicker.RangePicker
            allowEmpty={[true, true]} style={{ width: '100%' }} aria-label="Flight days" format="D MMM YYYY"
            value={[dayOf(draft.activeFrom), dayOf(draft.activeTo)]}
            onChange={(v) => setDraft((d) => ({ ...d, activeFrom: v?.[0] ? dayStart(v[0]) : null, activeTo: v?.[1] ? dayEnd(v[1]) : null }))}
          />
          : <DatePicker.RangePicker
            allowEmpty={[true, true]} showTime style={{ width: '100%' }}
            value={[draft.activeFrom ? dayjs(draft.activeFrom) : null, draft.activeTo ? dayjs(draft.activeTo) : null]}
            onChange={(v) => setDraft((d) => ({ ...d, activeFrom: v?.[0] ? v[0].toISOString() : null, activeTo: v?.[1] ? v[1].toISOString() : null }))}
          />}
        {errors.activeTo && <div className="mt-1" style={{ fontSize: 11.5, color: T.error }}>{errors.activeTo}</div>}
      </div>
      {guaranteed && (
      <div className="mb-3.5">
        <label className="mb-1 block" style={{ fontSize: 13, color: T.muted }}><WithTip tip="Programmatic guaranteed only: the volume this deal guarantees over its flight dates. You enter it as plays; the deal sheet shows it as guaranteed impressions (plays × assumed views per play). Delivery is counted in plays billed at the slots this list is assigned to. Private auctions and preferred deals commit no volume, so this is not captured for them.">Guaranteed impressions (entered as plays)</WithTip></label>
        <InputNumber
          min={1} precision={0} style={{ width: '100%' }} aria-label="Guaranteed impressions"
          status={errors.committedPlays ? 'error' : undefined} placeholder={playsText(volume) ?? 'Number of plays to guarantee'}
          value={draft.committedPlays} onChange={(v) => { untouched.current = false; setDraft((d) => ({ ...d, committedPlays: typeof v === 'number' ? v : null })) }}
        />
        {errors.committedPlays && <div className="mt-1" style={{ fontSize: 11.5, color: T.error }}>{errors.committedPlays}</div>}
        <div className="mt-1" style={{ fontSize: 11.5, color: T.muted }} data-testid="effective-volume">
          {playsText(volume) ? `Guaranteed plays: ${playsText(volume)} (${sourceLabel(volume.source)})` : 'Guaranteed plays: none set'}
        </div>
      </div>
      )}
      {guaranteed ? (
      <div className="mb-3.5" data-testid="per-day-rate">
        <label className="mb-1 block" style={{ fontSize: 13, color: T.muted }} htmlFor="buyersListRatePerDay"><WithTip tip={PER_DAY_HINT}>Rate per day</WithTip></label>
        <div className="flex items-start gap-3">
          <div style={{ flex: 1 }}>
            <InputNumber
              id="buyersListRatePerDay" min={0} precision={2} step={10} style={{ width: '100%' }} addonBefore="USD" placeholder="Flat rate for each 24-hour day"
              status={errors.ratePerDay ? 'error' : undefined}
              value={draft.ratePerDay} onChange={(v) => setDraft((d) => ({ ...d, ratePerDay: typeof v === 'number' && v > 0 ? v : null }))}
            />
          </div>
          <div style={{ flex: 1 }}>
            <Input aria-label="Equivalent CPM" readOnly addonBefore="Equivalent CPM" value={equivalentCpmText(equivalent) ?? ''} placeholder={equivalentNote} />
          </div>
        </div>
        {errors.ratePerDay && <div className="mt-1" style={{ fontSize: 11.5, color: T.error }}>{errors.ratePerDay}</div>}
        <div className="mt-1" style={{ fontSize: 11.5, color: T.muted }} data-testid="rate-type">Rate type: {rateTypeOf('guaranteed', 0)}</div>
      </div>
      ) : (
      <div className="mb-3.5">
        <label className="mb-1 block" style={{ fontSize: 13, color: T.muted }} htmlFor="buyersListFloorCpm"><WithTip tip="In USD. The rate for deals using this list, overriding the DSP's floor. It can raise the floor but never go below the platform floor. Leave empty to inherit.">{draft.dealType === 'preferred' ? 'Fixed CPM' : 'Rate'}</WithTip></label>
        <InputNumber
          id="buyersListFloorCpm" min={0} style={{ width: '100%' }} step={1} placeholder={rateText(rate) ?? 'Inherit the DSP or platform floor'}
          status={errors.floorCpm ? 'error' : undefined}
          formatter={(v) => (v === undefined || v === null ? '' : String(v))} parser={(v) => Number(v)}
          value={draft.floorCpm} onChange={(v) => setDraft((d) => ({ ...d, floorCpm: typeof v === 'number' && v > 0 ? v : null }))}
        />
        {errors.floorCpm && <div className="mt-1" style={{ fontSize: 11.5, color: T.error }}>{errors.floorCpm}</div>}
        <div className="mt-1" style={{ fontSize: 11.5, color: T.muted }} data-testid="effective-rate">
          {rateText(rate) ? `Rate: ${rateText(rate)} (${sourceLabel(rate.source)})` : 'Rate: per play'}
          <div data-testid="rate-type">Rate type: {rateTypeOf(draft.dealType)}</div>
        </div>
      </div>
      )}
      {editing?.lockedWin && (
        <div style={{ fontSize: 12.5, color: T.muted }}>Rate locked at {editing.lockedWin.cpm} CPM on {new Date(editing.lockedWin.lockedAt).toLocaleString()}, before private auctions stopped locking a rate: every play for the rest of the flight books at that rate.</div>
      )}
    </Modal>
      <FinaliseDealModal list={finalising} onClose={() => setFinalising(null)} onShared={(l) => { setFinalising(null); onSaved(l); onClose() }} />
    </>
  )
}
