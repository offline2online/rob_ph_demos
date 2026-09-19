/* Slot assignment (spec §1, §6): who may fill each slot. The explanation of
   the three owners is the label's tooltip. Slot cards summarise each slot;
   the table (AG Grid) edits them. */
import { Alert, Button, Input, Select } from 'antd'
import type { ColDef, ICellRendererParams } from 'ag-grid-community'
import { SLOT_OWNERS, STORE_SCOPES, providerDef, type AdvertiserSettings, type Partner, type Slot, type SlotOwner } from '@ph-dsp/types'
import { useMemo } from 'react'
import { Field } from '../../../shared/Field'
import { Grid } from '../../../shared/Grid'
import { Icon } from '../../../shared/Icon'
import { T } from '../../../theme/phTheme'
import { effectiveLists, isBlocked, ownerAssignment, ownerChange, partnerChange } from '../model'

const ANY = '__any__'
const RTB = '__rtb__'
const WHITELIST = '__whitelist__'
const ADVERTISER_COLOUR = SLOT_OWNERS.advertiser.colour

interface Ctx {
  partners: Partner[]
  company: AdvertiserSettings | undefined
  seatsOf: (p: Partner) => string[]
  setSlot: (i: number, patch: Partial<Slot>) => void
}
interface Row { i: number; slot: Slot }
/* Stable grid context; cells read the latest values through it. */
interface GridCtx { current: Ctx }

const partnerOf = (ctx: Ctx, sl: Slot) => (sl.partnerId ? ctx.partners.find((p) => p.id === sl.partnerId) ?? null : null)
const isBroken = (ctx: Ctx, sl: Slot) => {
  const p = sl.owner === 'advertiser' ? partnerOf(ctx, sl) : null
  return !!p && p.status !== 'connected'
}
const partnerColour = (p: Partner | null) => (p ? providerDef(p.provider)?.colour ?? ADVERTISER_COLOUR : ADVERTISER_COLOUR)

const NotConnected = () => (
  <div className="flex items-center gap-[3px]" style={{ fontSize: 10.5, color: T.error }}>
    <Icon name="error" size={11} />Not connected
  </div>
)

function LabelCell({ data, context: grid }: ICellRendererParams<Row, unknown, GridCtx>) {
  if (!data) return null
  const context = grid.current
  return <div className="w-full min-w-0"><Input size="small" aria-label={`Slot ${data.i + 1} label`} value={data.slot.label} onChange={(e) => context.setSlot(data.i, { label: e.target.value })} /></div>
}

function OwnerCell({ data, context: grid }: ICellRendererParams<Row, unknown, GridCtx>) {
  if (!data) return null
  const context = grid.current
  const o = SLOT_OWNERS[data.slot.owner]
  return (
    <div className="w-full min-w-0">
    <Select
      size="small"
      className="w-full"
      aria-label={`Slot ${data.i + 1} owner`}
      value={data.slot.owner}
      onChange={(v: SlotOwner) => context.setSlot(data.i, ownerChange(v))}
      options={(Object.keys(SLOT_OWNERS) as SlotOwner[]).map((k) => ({ value: k, label: <span style={{ color: SLOT_OWNERS[k].colour }}>{SLOT_OWNERS[k].label}</span> }))}
      labelRender={() => <span style={{ color: o.colour }}>{o.label}</span>}
    />
    </div>
  )
}

function AssignedToCell({ data, context: grid }: ICellRendererParams<Row, unknown, GridCtx>) {
  if (!data) return null
  const ctx = grid.current
  const { i, slot: sl } = data
  if (sl.owner === 'internal') return <span style={{ fontSize: 11.5, color: T.micro }}>Based on priority</span>
  if (sl.owner === 'retail') {
    return (
      <div className="w-full min-w-0">
        <Select size="small" className="w-full" aria-label={`Slot ${i + 1} store scope`} value={sl.storeScope || 'Store staff'}
          onChange={(v) => ctx.setSlot(i, { storeScope: v })} options={STORE_SCOPES.map((s) => ({ value: s, label: s }))} />
      </div>
    )
  }
  const p = partnerOf(ctx, sl)
  const eff = effectiveLists(p, ctx.company)
  const allowN = eff.allowList.length
  const blockN = eff.blockList.length
  /* The blacklist subtracts everywhere, so a blocked seat is not offered. */
  const sellable = p ? ctx.seatsOf(p).filter((s) => !isBlocked(s, eff)) : []
  const namedButBlocked = !!sl.advertiser && isBlocked(sl.advertiser, eff)
  const broken = isBroken(ctx, sl)
  const advValue = sl.advertiser ?? (sl.listMode === 'whitelist_only' ? WHITELIST : RTB)
  return (
    <div className="flex w-full min-w-0 flex-col gap-1 py-1.5">
      <Select
        size="small"
        className="w-full"
        aria-label={`Slot ${i + 1} partner`}
        title="Partner / DSP the demand for this position comes through"
        value={sl.partnerId ?? ANY}
        onChange={(v: string) => ctx.setSlot(i, partnerChange(sl, v === ANY ? null : ctx.partners.find((x) => x.id === v) ?? null, ctx.company, ctx.seatsOf))}
        labelRender={({ label }) => <span style={{ color: broken ? T.error : partnerColour(p) }}>{label}</span>}
        options={[{ value: ANY, label: 'Any connected DSP' }, ...ctx.partners.map((x) => ({ value: x.id, label: `${x.name}${x.status !== 'connected' ? ' (not connected)' : ''}` }))]}
      />
      <Select
        size="small"
        className="w-full"
        aria-label={`Slot ${i + 1} advertiser`}
        disabled={!p}
        title={!p ? 'Name a partner first to reserve the position to one of its advertisers.' : 'Who this position may sell to'}
        value={advValue}
        onChange={(v: string) => ctx.setSlot(i, v === RTB ? { listMode: 'rtb', advertiser: null } : v === WHITELIST ? { listMode: 'whitelist_only', advertiser: null } : { listMode: null, advertiser: v })}
        labelRender={({ label }) => <span style={{ color: advValue === RTB ? ADVERTISER_COLOUR : T.text }}>{label}</span>}
        options={[
          { value: RTB, label: blockN ? `RTB bidding — any except ${blockN} blocked` : 'RTB bidding (open)' },
          ...(p ? [{ value: WHITELIST, label: allowN ? `Whitelist only (${allowN})` : 'Whitelist only — list empty', disabled: allowN === 0 }] : []),
          ...sellable.map((s) => ({ value: s, label: s })),
          /* A named advertiser since blocked stays selectable so the position doesn't change under the user. */
          ...(namedButBlocked ? [{ value: sl.advertiser as string, label: `${sl.advertiser} — blocked` }] : []),
        ]}
      />
      {namedButBlocked && (
        <div className="flex items-start gap-[3px]" style={{ fontSize: 10.5, color: T.error }}>
          <Icon name="block" size={11} style={{ marginTop: 1 }} />On the blacklist — this position cannot fill.
        </div>
      )}
      {broken && <NotConnected />}
    </div>
  )
}

export function SlotAssignment({ slots, setSlots, partners, company, seatsOf, onFixConnection, tip }: {
  slots: Slot[]
  setSlots: (s: Slot[]) => void
  partners: Partner[]
  company: AdvertiserSettings | undefined
  seatsOf: (p: Partner) => string[]
  onFixConnection: (partnerId: string) => void
  tip: string
}) {
  const ctx: Ctx = { partners, company, seatsOf, setSlot: (i, patch) => setSlots(slots.map((s, k) => (k === i ? { ...s, ...patch } : s))) }
  const rows = useMemo(() => slots.map((slot, i) => ({ i, slot })), [slots])
  const columns = useMemo<ColDef<Row>[]>(
    () => [
      { headerName: '#', width: 52, suppressSizeToFit: true, valueGetter: (p) => (p.data ? p.data.i + 1 : ''), cellStyle: { color: T.micro, fontSize: 12 } },
      { headerName: 'Label', width: 180, minWidth: 110, cellRenderer: LabelCell },
      { headerName: 'Owner', width: 160, suppressSizeToFit: true, cellRenderer: OwnerCell },
      { headerName: 'Assigned to', width: 260, minWidth: 190, cellRenderer: AssignedToCell, autoHeight: true },
    ],
    [],
  )
  const broken = slots.filter((s) => isBroken(ctx, s))
  return (
    <Field label="Slot assignment" tip={tip} className="mb-4">
      <div className="mb-2.5 flex flex-wrap gap-1.5" aria-label="Slots">
        {slots.map((sl, i) => {
          const o = SLOT_OWNERS[sl.owner]
          const p = sl.owner === 'advertiser' ? partnerOf(ctx, sl) : null
          const rtb = sl.owner === 'advertiser' && !sl.advertiser && sl.listMode !== 'whitelist_only'
          const bad = isBroken(ctx, sl)
          const col = p ? partnerColour(p) : o.colour
          return (
            <div key={i} data-testid={`slot-card-${i + 1}`} className="rounded-md px-2.5 py-1.5"
              style={{ border: `1px ${rtb ? 'dashed' : 'solid'} ${bad ? T.error : col}`, background: o.bg, minWidth: 96 }}>
              <div style={{ fontSize: 10.5, color: T.micro }}>Slot {i + 1}</div>
              <div className="flex items-center gap-1" style={{ fontSize: 12, color: bad ? T.error : col, fontWeight: 500 }}>
                <Icon name={p ? providerDef(p.provider)?.icon ?? o.icon : o.icon} size={13} />{o.label}
              </div>
              <div style={{ fontSize: 11, color: bad ? T.error : T.muted, marginTop: 2 }}>{ownerAssignment(sl, partners, company)}</div>
              {bad && <NotConnected />}
            </div>
          )
        })}
      </div>
      {/* Remount once partners and company lists arrive so every cell re-reads them. */}
      <Grid<Row> key={`${partners.length}-${company ? 1 : 0}`} label="Slot assignment" rows={rows} columns={columns} context={ctx} getRowId={(r) => String(r.i)} />
      {broken.length > 0 && (
        <Alert
          className="mt-2.5"
          type="error"
          showIcon
          message={`${broken.length} advertiser ${broken.length === 1 ? 'position is' : 'positions are'} assigned to a partner that is not connected. ${broken.length === 1 ? 'It' : 'They'} will fall back to the next eligible Headquarters campaign until the connection is fixed.`}
          action={<Button color="primary" variant="outlined" size="small" onClick={() => onFixConnection(broken[0].partnerId as string)}>Fix connection</Button>}
        />
      )}
    </Field>
  )
}
