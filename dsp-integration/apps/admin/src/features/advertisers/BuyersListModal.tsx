/* New/edit deal and buyers list (spec "Support private auctions" — Available
   Inventory UX): the buyers list and its deal terms are ONE object, created
   or edited from this one pop-up. It carries both who may buy (invited
   buyers) and the targeting criteria appended to the deal. The floor is optional: blank inherits
   the DSP's floor, else the platform floor (bid floor hierarchy). The auction resolution rule (platform-wide) is deliberately not a field here.

   Lifecycle (ticket QG40V1vVwqp9NtFmlC9H): Save as draft (shared with no DSP; it can be assigned to slots) -> Finalise (needs at
   least one assigned slot; opens FinaliseDealModal to confirm the slots, deal ID and terms) -> Share deal (inside that pop-up). */
import { App, Button, DatePicker, Input, InputNumber, Modal, Select } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { ALL_DSPS, DIRECT_PARTNER_ID, isGuaranteedLike, OPERATOR_LABELS, formatAggregateValue, isAggregateVariable, parseAggregateValue, TARGETING_VARIABLES, type BuyersList, type BuyersListDealType, type Condition, type InvitedBuyer, type SharedVariable, type TermCheck, type TimeZoneMode } from '@ph-dsp/types'
import dayjs from 'dayjs'
import { useEffect, useState } from 'react'
import { api, ApiRequestError } from '../../api/client'
import { Q } from '../../api/queries'
import { Icon } from '../../shared/Icon'
import { WithTip } from '../../shared/InfoTip'
import { Tip } from '../../shared/Tip'
import { IAB_OPTIONS_SORTED, iabFilterOption } from '../../shared/iabOptions'
import { T } from '../../theme/phTheme'
import { TERM_TOTAL_HINT, equivalentCpmText, rateText, rateTypeOf, resolveTerm, sourceLabel } from './effectiveTerm'
import { FinaliseDealModal } from './FinaliseDealModal'
import { ConflictCallout, useFlightConflicts } from './reservingConflicts'

type Draft = { name: string; description: string; dealType: BuyersListDealType; invitedBuyers: InvitedBuyer[]; invitedCategories: string[]; targeting: Condition[]; activeFrom: string | null; activeTo: string | null; timeZoneMode: TimeZoneMode; auctionCloses: string | null; floorCpm: number | null; termTotal: number | null }
/* An invited buyer is one synced seat of one connected DSP — the Select's value is both halves. */
/* The full IAB Content Taxonomy 1.0, tier 1 then its subcategories. */
const IAB_CATEGORY_OPTIONS = IAB_OPTIONS_SORTED
const buyerKey = (b: InvitedBuyer) => JSON.stringify([b.partnerId, b.seatId])
/* The AWS POC supports programmatic guaranteed (plus open auction) only: the other deal types stay visible, greyed out, for demos. */
const COMING_SOON = 'Coming in a future release. The POC supports programmatic guaranteed deals only.'
const blankDraft = (): Draft => ({ name: '', description: '', dealType: 'guaranteed', invitedBuyers: [], invitedCategories: [], targeting: [], activeFrom: null, activeTo: null, timeZoneMode: 'platform', auctionCloses: null, floorCpm: null, termTotal: null })
const draftOf = (l: BuyersList): Draft => ({
  name: l.name, description: l.description, dealType: l.dealType,
  invitedBuyers: l.invitedBuyers.map((b) => ({ ...b })),
  invitedCategories: l.dealType === 'private_auction' ? [...(l.invitedCategories ?? [])] : [],
  targeting: (l.targeting ?? []).map((c) => ({ ...c, values: [...c.values] })),
  activeFrom: l.activeFrom, activeTo: l.activeTo, timeZoneMode: l.timeZoneMode ?? 'platform', auctionCloses: l.auctionCloses, floorCpm: l.floorCpm ?? null, termTotal: l.termTotal ?? null,
})
/* A flight has a start and an end date AND time (22 Oct 2026), read in the deal's time zone mode. The times are shown exactly as saved: the picker never converts them to the browser's zone. An end picked at 23:59 means the end of that minute, so a whole-day flight still ends at 23:59:59.999. */
const momentOf = (iso: string | null) => (iso ? dayjs(iso.slice(0, 19)) : null)
const startIso = (d: dayjs.Dayjs) => `${d.format('YYYY-MM-DDTHH:mm')}:00.000Z`
const endIso = (d: dayjs.Dayjs) => `${d.format('YYYY-MM-DDTHH:mm')}:${d.format('HH:mm') === '23:59' ? '59.999' : '00.000'}Z`
const TIME_ZONE_OPTIONS: { value: TimeZoneMode; label: string }[] = [{ value: 'platform', label: 'Platform time zone' }, { value: 'store', label: 'Local store time' }]

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
  /* A guaranteed deal is priced as a fixed CPM or a total for the term (21 Oct 2026); only one is sent. */
  const [priceMode, setPriceMode] = useState<'cpm' | 'total'>('cpm')
  useEffect(() => {
    if (!open) return
    setDraft(editing ? draftOf(editing) : blankDraft())
    setPriceMode(editing?.termTotal != null ? 'total' : 'cpm')
    setErrors({})
  }, [open, editing])

  const settings = useQuery(Q.advertiserSettings)

  /* The deal type decides which fields the list carries (7 Oct 2026): switching drops what the new type does not capture. */
  const setDealType = (dealType: BuyersListDealType) => setDraft((d) => ({
    ...d, dealType,
    /* The auction window is retired (16 Oct 2026); only a legacy deal's saved value is carried, so an edit does not re-version it. */
    auctionCloses: dealType === d.dealType ? d.auctionCloses : null,
    invitedCategories: dealType === 'private_auction' ? d.invitedCategories : [],
    termTotal: isGuaranteedLike(dealType) ? d.termTotal : null,
    /* The buyer of a Direct advertiser deal is a direct advertiser, not a DSP seat: switching to or from it clears the buyer. */
    invitedBuyers: (dealType === 'direct') === (d.dealType === 'direct') ? d.invitedBuyers : [],
  }))
  /* A Direct advertiser deal has exactly the Programmatic guaranteed fields and rules (22 Oct 2026); only its buyer differs. */
  const direct = draft.dealType === 'direct'
  const guaranteed = isGuaranteedLike(draft.dealType)
  /* Reserving deals never overlap on a slot: asked as the dates change, and saving is blocked until they don't. */
  const flightConflicts = useFlightConflicts(editing?.id, draft.dealType, draft.activeFrom, draft.activeTo, open && !!editing && guaranteed && draft.dealType === editing.dealType)
  const blocked = flightConflicts.length > 0
  const privateAuction = draft.dealType === 'private_auction'
  /* A programmatic guaranteed deal is one-to-one with its buyer (21 Oct 2026): a list that already has several must be reduced to one before it can be saved as guaranteed. */
  const tooManyForPg = guaranteed && draft.invitedBuyers.length > 1

  /* The dropdown offers every advertiser (seat) a connected DSP has synced, grouped by DSP — no typing, no identifier type. */
  const partners = useQuery(Q.partners)
  const advertisers = useQuery({ queryKey: Q.advertisers.queryKey, queryFn: () => api<{ items: { advertiserId: string; name: string; direct?: boolean }[] }>('GET', '/admin/v1/advertisers') })
  const directOptions = (advertisers.data?.items ?? []).filter((a) => a.direct).map((a) => ({ value: buyerKey({ partnerId: DIRECT_PARTNER_ID, seatId: a.advertiserId }), label: `${a.name} (Direct)` }))
  /* What the two terms resolve to for this draft: platform default -> DSP -> this list (Rob, 7 Oct 2026), so
     neither field is ever left looking blank. The platform floor clamps a lower DSP floor up, as the exchange does. */
  const draftDsps = [...new Set(draft.invitedBuyers.map((b) => b.partnerId))].map((id) => (partners.data ?? []).find((p) => p.id === id)?.bidder)
  const platformFloor = settings.data?.floorCpm
  const rate = resolveTerm(platformFloor, draftDsps.map((b) => b?.floorCpm), draft.floorCpm, (n) => Math.max(platformFloor ?? 0, n))
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
          {check.changes.some((c) => c.field === 'committedPlays') && (
            <p data-testid="committed-plays-change">The committed plays will change{(() => { const c = check.changes.find((x) => x.field === 'committedPlays'); return c ? ` from ${c.from == null ? 'none' : Number(c.from).toLocaleString()} to ${c.to == null ? 'none' : Number(c.to).toLocaleString()}` : '' })()}, so the deal must be re-shared and accepted again by the buyer. The updated deal is not re-sent until you confirm.</p>
          )}
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            {check.affectedBuyers.map((b) => <li key={`${b.partnerId}/${b.seatId}`}>{b.seatId} ({b.partnerName})</li>)}
          </ul>
        </div>
      ),
      okText: 'Save and request re-acceptance', cancelText: 'Keep editing',
      onOk: () => resolve(true), onCancel: () => resolve(false),
    })
  })

  /* Below-floor warning (Rob, 22 Oct 2026): a price under the platform floor is warned about, not blocked. Saving it is an explicit override, which the deal records. */
  const confirmBelowFloor = (reasons: string[]) => new Promise<boolean>((resolve) => {
    modal.confirm({
      title: 'This deal is priced below the platform floor',
      content: (
        <div data-testid="below-floor-warning">
          {reasons.map((r) => <p key={r}>{r}</p>)}
          <p>You can save it anyway, for example a preferred supplier on an extended term with guaranteed sales. The deal will be marked Below floor (override).</p>
        </div>
      ),
      okText: 'Save anyway (override)', cancelText: 'Keep editing',
      onOk: () => resolve(true), onCancel: () => resolve(false),
    })
  })

  const save = async (finalise = false, belowFloorOverride = false): Promise<void> => {
    if (tooManyForPg) return void setErrors({ invitedBuyers: 'A programmatic guaranteed deal is with one named buyer; remove the others, or create a separate deal for each advertiser.' })
    /* A flight needs both ends, each a date and a time: a half-set one is not saved. */
    if (!draft.activeFrom !== !draft.activeTo) return void setErrors({ activeTo: `Set the flight's ${draft.activeFrom ? 'end' : 'start'} date and time too, or clear both.` })
    setSaving(true)
    setErrors({})
    const payload = { ...(showTargeting ? draft : { ...draft, targeting: [] }), ...(belowFloorOverride ? { belowFloorOverride: true } : {}) }
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
      /* The API names the override in the reason of a below-floor refusal: ask, and save again with it if the retailer agrees. */
      const belowFloor = detailFields.filter((d) => (d.field === 'floorCpm' || d.field === 'termTotal') && /belowFloorOverride/.test(d.reason ?? ''))
      if (!belowFloorOverride && belowFloor.length) {
        if (await confirmBelowFloor(belowFloor.map((d) => (d.reason ?? '').replace(/ Send belowFloorOverride: true to save it anyway\.$/, '')))) return save(finalise, true)
        return void setErrors(Object.fromEntries(belowFloor.map((d) => [d.field as string, (d.reason ?? '').replace(/ Send belowFloorOverride: true to save it anyway\.$/, '')])))
      }
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
        <Button key="save" type={isDraft && editing ? 'default' : 'primary'} loading={saving} disabled={blocked} onClick={() => save()}>{!isDraft ? 'Save changes' : editing ? 'Save draft' : 'Save as draft'}</Button>,
        ...(isDraft ? [
          <Tip key="finalise" title={slots.length ? undefined : 'Assign this deal to at least one slot in Available Inventory first. A deal with no inventory can’t be finalised.'}>
            <span><Button type="primary" disabled={saving || blocked || !editing || !slots.length} onClick={() => save(true)}>Finalise deal terms</Button></span>
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
        {/* A Direct advertiser deal is never shared with a DSP: Finalise makes it live (E2E 21 Oct 2026). */}
        {draft.dealType === 'direct'
          ? !isDraft
            ? 'Live: the slots it is assigned to are reserved for its direct advertiser over its flight. It is not sent to a DSP.'
            : editing
              ? `Draft: not live yet. ${slots.length ? `Assigned to ${slots.length} slot${slots.length === 1 ? '' : 's'}; finalise it to make it live.` : 'Assign it to a slot in Available Inventory, then finalise it to make it live.'}`
              : 'Save as draft first. Then assign it to a slot in Available Inventory and finalise it to make it live. It is never sent to a DSP.'
          : !isDraft
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
        <WithTip tip={editing.dealType === 'direct' ? "The deal's rate, flight dates and buyer are versioned on the same deal ID. A Direct advertiser deal needs no buyer acceptance." : "The deal's rate, flight dates and buyers are versioned on the same deal ID. Changing the price, flight dates or slots (which changes the committed plays) asks the buyers who accepted to accept again."}>{editing.dealType === 'direct' ? `Term version ${editing.termVersion}` : `Term version ${editing.termVersion} · ${(editing.buyerAcceptance ?? []).filter((a) => a.state === 'accepted').length} of ${(editing.buyerAcceptance ?? []).length} buyers on this version`}</WithTip>
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
        <label className="mb-1 block" style={{ fontSize: 13, color: T.muted }} htmlFor="buyersListDealType"><WithTip tip="The deal type this list bids against, and where it is set: the DSP deal (deal ID and type) and any reservation on a slot using this list follow it. Private auction: invited buyers bid on each slot throughout the flight, first price, against the rate as a floor; nothing is held or locked. Preferred deal: one named buyer, a fixed CPM and first look at every slot ahead of private and open auction; the buyer may pass, and no window is reserved. Programmatic guaranteed: commits a volume, shown as guaranteed impressions. Direct advertiser: the same terms as programmatic guaranteed, sold straight to one direct advertiser; it is not sent to a DSP."><span style={{ color: T.error }}>*</span> Deal type</WithTip></label>
        <Select
          id="buyersListDealType" className="w-full" aria-label="Deal type" value={draft.dealType} onChange={setDealType}
          options={[
            { value: 'private_auction', label: <WithTip tip={COMING_SOON}>Private auction</WithTip>, disabled: true },
            { value: 'preferred', label: <WithTip tip={COMING_SOON}>Preferred deal</WithTip>, disabled: true },
            { value: 'guaranteed', label: 'Programmatic guaranteed' },
            { value: 'direct', label: 'Direct advertiser' },
          ]}
        />
        {editing && draft.dealType !== editing.dealType && <div className="mt-1" style={{ fontSize: 11.5, color: T.error }} data-testid="deal-type-new-deal-note">The deal type is fixed once saved. Saving creates a new deal with a new Deal ID; this deal ({editing.dealId}) is left as it is.</div>}
        <div className="mt-1" style={{ fontSize: 11.5, color: T.muted }} data-testid="deal-type-note">
          {privateAuction ? 'Invited buyers bid on each slot, first price; nothing is held or locked, and no volume is committed.' : direct ? 'One deal with one direct advertiser covers the whole delivery term, with the same terms as programmatic guaranteed. It is not sent to a DSP: Finalise makes it live inside Personalisation Hub.' : guaranteed ? 'One deal with one named buyer covers the whole delivery term. It commits a volume worked out from its assigned slots; there is no bidding.' : 'One named buyer at a fixed CPM with first look at each slot; it may pass. No window is reserved and no volume is committed.'}
        </div>
      </div>
      <div className="mb-3.5">
        <label className="mb-1 block" style={{ fontSize: 13, color: T.muted }}><WithTip tip="Only advertisers a connected DSP has synced can be invited (who can buy); each is matched on the seat ID that DSP bids under.">Buyers</WithTip></label>
        <Select
          mode="multiple" maxCount={guaranteed ? 1 : undefined} className="w-full" aria-label="Buyers" showSearch optionFilterProp="label"
          status={errors.invitedBuyers || tooManyForPg ? 'error' : undefined} loading={partners.isLoading}
          placeholder={direct ? 'Choose the one direct advertiser this deal is with' : guaranteed ? 'Choose the one advertiser this deal is with' : 'Choose advertisers synced from your connected DSPs'}
          notFoundContent={direct ? 'No direct advertisers yet — add one on the Advertisers page.' : 'No advertisers synced yet — connect a DSP first.'}
          value={draft.invitedBuyers.map(buyerKey)} options={direct ? directOptions as never : [...(staleOptions.length ? [{ label: 'Not synced', options: staleOptions }] : []), ...options]}
          onChange={setBuyers}
        />
        {errors.invitedBuyers && <div className="mt-1" style={{ fontSize: 11.5, color: T.error }}>{errors.invitedBuyers}</div>}
        {tooManyForPg && !errors.invitedBuyers && <div className="mt-1" style={{ fontSize: 11.5, color: T.error }} data-testid="pg-single-buyer-note">A programmatic guaranteed deal is with one buyer. Remove the others to keep this as a guaranteed deal; each additional advertiser needs its own deal and Deal ID.</div>}
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
        <label className="mb-1 block" style={{ fontSize: 13, color: T.muted }}><WithTip tip={guaranteed ? 'The delivery term: one deal covers the whole range, from its start time to its end time. Two reserving deals cannot overlap on a slot, but may share a day when their times do not. The committed plays are worked out over it, so give it both dates.' : 'The span this deal is awarded for (Start date to End date) — leave either side empty for no bound. Outside it, the deal admits nobody.'}>Flight dates</WithTip></label>
        <div className="mb-2">
          <label className="mb-1 block" htmlFor="buyersListTimeZone" style={{ fontSize: 12, color: T.muted }}><WithTip tip="Platform time zone reads the start and end times on the platform's clock. Local store time reads them on each store's or device's own clock, so a window starts and ends by that store's time.">Time zone</WithTip></label>
          <Select id="buyersListTimeZone" aria-label="Time zone" style={{ width: '100%' }} value={draft.timeZoneMode} options={TIME_ZONE_OPTIONS} onChange={(timeZoneMode) => setDraft((d) => ({ ...d, timeZoneMode }))} />
        </div>
        <div className="flex gap-2">
          <DatePicker showTime={{ format: 'HH:mm' }} format="D MMM YYYY HH:mm" allowClear style={{ flex: 1 }} aria-label="Flight start" placeholder="Start date and time" value={momentOf(draft.activeFrom)} onChange={(v) => setDraft((d) => ({ ...d, activeFrom: v ? startIso(v) : null }))} />
          <DatePicker showTime={{ format: 'HH:mm' }} format="D MMM YYYY HH:mm" allowClear style={{ flex: 1 }} aria-label="Flight end" placeholder="End date and time" value={momentOf(draft.activeTo)} onChange={(v) => setDraft((d) => ({ ...d, activeTo: v ? endIso(v) : null }))} />
        </div>
        <ConflictCallout conflicts={flightConflicts} />
        {errors.activeTo && <div className="mt-1" style={{ fontSize: 11.5, color: T.error }}>{errors.activeTo}</div>}
      </div>
      {guaranteed && (
      <div className="mb-3.5">
        <label className="mb-1 block" style={{ fontSize: 13, color: T.muted }} htmlFor="buyersListPriceType"><WithTip tip="Programmatic guaranteed only. Price the whole delivery term either as a fixed CPM, or as one USD total for the term (the CPM it works out to is derived from the assigned slots' forecast).">Price</WithTip></label>
        <Select
          id="buyersListPriceType" className="w-full" aria-label="Price type" value={priceMode}
          onChange={(m: 'cpm' | 'total') => { setPriceMode(m); setDraft((d) => (m === 'total' ? { ...d, floorCpm: null } : { ...d, termTotal: null })) }}
          options={[{ value: 'cpm', label: 'Fixed CPM' }, { value: 'total', label: 'Total for the term' }]}
        />
      </div>
      )}
      {guaranteed && priceMode === 'total' ? (
      <div className="mb-3.5" data-testid="term-total">
        <label className="mb-1 block" style={{ fontSize: 13, color: T.muted }} htmlFor="buyersListTermTotal"><WithTip tip={TERM_TOTAL_HINT}>Total for the term</WithTip></label>
        <InputNumber
          id="buyersListTermTotal" min={0} precision={2} step={100} style={{ width: '100%' }} addonBefore="USD" placeholder="One total for every day and slot in the term"
          status={errors.termTotal ? 'error' : undefined}
          value={draft.termTotal} onChange={(v) => setDraft((d) => ({ ...d, termTotal: typeof v === 'number' && v > 0 ? v : null }))}
        />
        {errors.termTotal && <div className="mt-1" style={{ fontSize: 11.5, color: T.error }}>{errors.termTotal}</div>}
        {editing?.termTotal != null && editing.equivalentCpm && <div className="mt-1" style={{ fontSize: 11.5, color: T.muted }} data-testid="equivalent-cpm">Equivalent CPM {equivalentCpmText(editing.equivalentCpm)} across the assigned slots</div>}
        {editing?.belowFloorOverride && <div className="mt-1" style={{ fontSize: 11.5, color: T.error }} data-testid="below-floor-override">Below floor (override){editing.belowFloorOverrideBy ? `: saved by ${editing.belowFloorOverrideBy}` : ''}. Saving it again below the floor asks for the override again.</div>}
        <div className="mt-1" style={{ fontSize: 11.5, color: T.muted }} data-testid="rate-type">Rate type: {rateTypeOf(draft.dealType, draft.termTotal ?? 0)}</div>
      </div>
      ) : (
      <div className="mb-3.5">
        <label className="mb-1 block" style={{ fontSize: 13, color: T.muted }} htmlFor="buyersListFloorCpm"><WithTip tip="In USD. The rate for deals using this list, overriding the DSP's floor. It can raise the floor. On a Preferred or Programmatic guaranteed deal it can go below the platform floor only when you choose Save anyway, and the deal is then marked Below floor (override). Leave empty to inherit.">{draft.dealType === 'preferred' || guaranteed ? 'Fixed CPM' : 'Rate'}</WithTip></label>
        <InputNumber
          id="buyersListFloorCpm" min={0} style={{ width: '100%' }} step={1} placeholder={rateText(rate) ?? 'Inherit the DSP or platform floor'}
          status={errors.floorCpm ? 'error' : undefined}
          formatter={(v) => (v === undefined || v === null ? '' : String(v))} parser={(v) => Number(v)}
          value={draft.floorCpm} onChange={(v) => setDraft((d) => ({ ...d, floorCpm: typeof v === 'number' && v > 0 ? v : null }))}
        />
        {errors.floorCpm && <div className="mt-1" style={{ fontSize: 11.5, color: T.error }}>{errors.floorCpm}</div>}
        {/* A below-floor fixed CPM is flagged here too, not only a below-floor total (E2E 22 Oct 2026). */}
        {editing?.belowFloorOverride && <div className="mt-1" style={{ fontSize: 11.5, color: T.error }} data-testid="below-floor-override">Below floor (override){editing.belowFloorOverrideBy ? `: saved by ${editing.belowFloorOverrideBy}` : ''}. Saving it again below the floor asks for the override again.</div>}
        <div className="mt-1" style={{ fontSize: 11.5, color: T.muted }} data-testid="effective-rate">
          {rateText(rate) ? `Rate: ${rateText(rate)} (${sourceLabel(rate.source)})` : 'Rate: per play'}
          <div data-testid="rate-type">Rate type: {rateTypeOf(draft.dealType)}</div>
        </div>
      </div>
      )}
      {/* Derived, never typed (21 Oct 2026): shown only once slots are assigned, as a read-only figure. */}
      {guaranteed && editing && editing.committedPlays != null && (slots.length > 0) && (
      <div className="mb-3.5" data-testid="committed-plays">
        <label className="mb-1 block" style={{ fontSize: 13, color: T.muted }} htmlFor="buyersListCommittedPlays"><WithTip tip="Worked out for you: the total forecast plays of every slot assigned to this deal across its whole delivery term, less the guarantee buffer, rounded down. It is the volume the deal delivers against and what goes on the deal sheet and to the DSP. It is recalculated when slots or dates change.">Committed plays</WithTip></label>
        <Input id="buyersListCommittedPlays" aria-label="Committed plays" readOnly value={editing.committedPlays.toLocaleString()} />
        <div className="mt-1" style={{ fontSize: 11.5, color: T.muted }}>
          {`Forecast plays for ${slots.length} assigned slot${slots.length === 1 ? '' : 's'} over the delivery term, less the ${settings.data?.guaranteeBufferPct ?? 10}% guarantee buffer. Recalculated when slots or dates change and the deal is saved.`}
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
