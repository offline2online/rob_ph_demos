/* Slot assignment (spec §1, §6): who owns each slot. The explanation of the
   three owners is the label's tooltip. Slot cards summarise each slot; the
   table (AG Grid) edits them.

   The editor sets the label and the owner only (Rob, 20 Sep): who a sellable
   position is assigned to — DSPs, named advertisers, the whitelist — is
   managed on Advertisers / Inventory, and shown here read-only on the card.

   While the retailer has DSP integration switched off (Exchange settings),
   Advertiser stays in the owner list but is greyed out, unless the slot was
   already an Advertiser slot when last saved: existing ones are left as
   they are, and no new one can be set up (Rob, 24 Sep 2026). The API
   enforces the same. */
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

interface ZoneOption { id: string; name: string }
const NO_ZONE = '__no_zone__'

interface Ctx {
  partners: Partner[]
  advertiserOpen: (i: number) => boolean
  setSlot: (i: number, patch: Partial<Slot>) => void
  zones: ZoneOption[]
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

/* Which zone (if any) this slot's position is tagged to — purely an
   attribution/display detail for Available Inventory (ticket "Available
   Inventory: playlist-primary table…", 27 Sep 2026): it says which zone
   playlist the slot's advertiser position shows up under there, not which
   zone the slot is "sold on" — booking is still keyed by display type +
   slot regardless (PH-CORE-BOUNDARIES.md). Only rendered when this display
   type has zones at all. */
function ZoneCell({ data, context: grid }: ICellRendererParams<Row, unknown, GridCtx>) {
  if (!data) return null
  const context = grid.current
  return (
    <div className="w-full min-w-0">
      <Select
        size="small"
        className="w-full"
        aria-label={`Slot ${data.i + 1} zone`}
        value={data.slot.zoneId ?? NO_ZONE}
        onChange={(v: string) => context.setSlot(data.i, { zoneId: v === NO_ZONE ? null : v })}
        options={[{ value: NO_ZONE, label: 'Not zone-specific' }, ...context.zones.map((z) => ({ value: z.id, label: z.name }))]}
      />
    </div>
  )
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
      options={(Object.keys(SLOT_OWNERS) as SlotOwner[]).map((k) => {
        const disabled = k === 'advertiser' && !context.advertiserOpen(data.i)
        return {
          value: k, disabled,
          title: disabled ? 'Enable DSP Integration (DSP Integration → Exchange settings) to add an Advertiser slot.' : undefined,
          label: <span style={{ color: disabled ? T.disabled : SLOT_OWNERS[k].colour }}>{SLOT_OWNERS[k].label}</span>,
        }
      })}
      labelRender={() => <span style={{ color: o.colour }}>{o.label}</span>}
    />
    </div>
  )
}

export function SlotAssignment({ slots, setSlots, partners, advertiserOpen, onFixConnection, tip, zones = [] }: {
  slots: Slot[]
  /* An updater, not a value (ticket, 27 Sep 2026): a multi-zone display
     type renders this same table once per playlist it has (the default
     playlist plus one per zone, PlaylistCapSlotsFields/PlaylistManagementPage),
     all editing the one shared `slots` array. Computing the next array here
     from this component's own `slots` prop and handing that whole array up
     used to lose a slot's change whenever two edits landed before this
     component re-rendered with the first one's result — e.g. tagging Slot 1
     to Zone 1 and Slot 3 to Zone 3 in quick succession, where Slot 3's write
     was still built from the pre-Slot-1-change array and so overwrote it.
     Passing an updater instead lets the draft state apply each edit against
     its own latest value, the same way React's setState updater form does,
     so no edit can undo one made just before it. */
  setSlots: (fn: (prev: Slot[]) => Slot[]) => void
  partners: Partner[]
  advertiserOpen: (i: number) => boolean
  onFixConnection: (partnerId: string) => void
  tip: string
  /* This display type's zones (multi-zone layout), so a slot can be tagged
     to one — empty/omitted on a single-zone display type, which just hides
     the Zone column below. */
  zones?: ZoneOption[]
}) {
  const ctx: Ctx = { partners, advertiserOpen, zones, setSlot: (i, patch) => setSlots((prev) => prev.map((s, k) => (k === i ? { ...s, ...patch } : s))) }
  const rows = useMemo(() => slots.map((slot, i) => ({ i, slot })), [slots])
  const columns = useMemo<ColDef<Row>[]>(
    () => [
      { headerName: '#', width: 52, suppressSizeToFit: true, valueGetter: (p) => (p.data ? p.data.i + 1 : ''), cellStyle: { color: T.micro, fontSize: 12 } },
      { headerName: 'Label', width: 260, minWidth: 140, cellRenderer: LabelCell },
      { headerName: 'Owner', width: 180, minWidth: 140, cellRenderer: OwnerCell },
      ...(zones.length ? [{ headerName: 'Zone', width: 180, minWidth: 140, cellRenderer: ZoneCell } as ColDef<Row>] : []),
    ],
    [zones],
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
