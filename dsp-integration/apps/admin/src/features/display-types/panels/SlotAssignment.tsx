/* Slot assignment (spec §1, §6): who owns each slot. The explanation of the
   three owners is the label's tooltip. Slot cards summarise each slot; the
   table (AG Grid) edits them.

   The editor sets the label and the owner only (Rob, 20 Sep): who a sellable
   position is assigned to — DSPs, named advertisers, the whitelist — is
   managed on Advertisers / Inventory, and shown here read-only on the card. */
import { Alert, Button, Input, Select } from 'antd'
import type { ColDef, ICellRendererParams } from 'ag-grid-community'
import { SLOT_OWNERS, assignedOf, providerDef, type Partner, type Slot, type SlotOwner } from '@ph-dsp/types'
import { useMemo } from 'react'
import { Field } from '../../../shared/Field'
import { Grid } from '../../../shared/Grid'
import { Icon } from '../../../shared/Icon'
import { T } from '../../../theme/phTheme'
import { ownerAssignment, ownerChange } from '../model'

const ADVERTISER_COLOUR = SLOT_OWNERS.advertiser.colour

interface Ctx {
  partners: Partner[]
  setSlot: (i: number, patch: Partial<Slot>) => void
}
interface Row { i: number; slot: Slot }
/* Stable grid context; cells read the latest values through it. */
interface GridCtx { current: Ctx }

/* The DSPs a sellable position is assigned to, and the first one, for colour. */
const partnersOf = (ctx: Ctx, sl: Slot) =>
  sl.owner === 'advertiser' ? assignedOf(sl).partnerIds.flatMap((id) => ctx.partners.filter((p) => p.id === id)) : []
const brokenPartners = (ctx: Ctx, sl: Slot) => partnersOf(ctx, sl).filter((p) => p.status !== 'connected')
const partnerColour = (p: Partner | undefined) => (p ? providerDef(p.provider)?.colour ?? ADVERTISER_COLOUR : ADVERTISER_COLOUR)

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

export function SlotAssignment({ slots, setSlots, partners, onFixConnection, tip }: {
  slots: Slot[]
  setSlots: (s: Slot[]) => void
  partners: Partner[]
  onFixConnection: (partnerId: string) => void
  tip: string
}) {
  const ctx: Ctx = { partners, setSlot: (i, patch) => setSlots(slots.map((s, k) => (k === i ? { ...s, ...patch } : s))) }
  const rows = useMemo(() => slots.map((slot, i) => ({ i, slot })), [slots])
  const columns = useMemo<ColDef<Row>[]>(
    () => [
      { headerName: '#', width: 52, suppressSizeToFit: true, valueGetter: (p) => (p.data ? p.data.i + 1 : ''), cellStyle: { color: T.micro, fontSize: 12 } },
      { headerName: 'Label', width: 260, minWidth: 140, cellRenderer: LabelCell },
      { headerName: 'Owner', width: 180, minWidth: 140, cellRenderer: OwnerCell },
    ],
    [],
  )
  const broken = slots.filter((s) => brokenPartners(ctx, s).length)
  return (
    <Field label="Slot assignment" tip={tip} className="mb-4">
      <div className="mb-2.5 flex flex-wrap gap-1.5" aria-label="Slots">
        {slots.map((sl, i) => {
          const o = SLOT_OWNERS[sl.owner]
          const ps = partnersOf(ctx, sl)
          const a = assignedOf(sl)
          const rtb = sl.owner === 'advertiser' && !a.advertisers.length && !a.whitelistOnly
          const bad = brokenPartners(ctx, sl).length > 0
          const col = ps.length ? partnerColour(ps[0]) : o.colour
          return (
            <div key={i} data-testid={`slot-card-${i + 1}`} className="rounded-md px-2.5 py-1.5"
              style={{ border: `1px ${rtb ? 'dashed' : 'solid'} ${bad ? T.error : col}`, background: o.bg, minWidth: 96 }}>
              <div style={{ fontSize: 10.5, color: T.micro }}>Slot {i + 1}</div>
              <div className="flex items-center gap-1" style={{ fontSize: 12, color: bad ? T.error : col, fontWeight: 500 }}>
                <Icon name={ps.length ? providerDef(ps[0].provider)?.icon ?? o.icon : o.icon} size={13} />{o.label}
              </div>
              <div style={{ fontSize: 11, color: bad ? T.error : T.muted, marginTop: 2 }}>{ownerAssignment(sl, partners)}</div>
              {bad && <NotConnected />}
            </div>
          )
        })}
      </div>
      {/* Remount once the partners arrive so every cell re-reads them. */}
      <Grid<Row> key={partners.length} label="Slot assignment" rows={rows} columns={columns} context={ctx} getRowId={(r) => String(r.i)} />
      {broken.length > 0 && (
        <Alert
          className="mt-2.5"
          type="error"
          showIcon
          message={`${broken.length} advertiser ${broken.length === 1 ? 'position is' : 'positions are'} assigned to a partner that is not connected. ${broken.length === 1 ? 'It' : 'They'} will fall back to the next eligible Headquarters campaign until the connection is fixed.`}
          action={<Button color="primary" variant="outlined" size="small" onClick={() => onFixConnection(brokenPartners(ctx, broken[0])[0].id)}>Fix connection</Button>}
        />
      )}
    </Field>
  )
}
