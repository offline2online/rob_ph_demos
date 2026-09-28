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
   enforces the same.

   Owners offered: Headquarters and Advertiser only for the first release
   (ticket, 27 Sep 2026) — Stores is not supported yet. A slot already saved
   as Stores still reads as Stores (greyed out in the list) until someone
   changes it.

   Under a zone's playlist (`scopeZoneId`), the table edits the same slots
   as every other zone of the display type — a position is sold per display
   type × slot — so a slot already tagged to a different zone is shown but
   locked here, and making a slot Advertiser tags it to this zone. Without
   that, setting "Slot 1 → Advertiser" under Zone 1, then Zone 2, then Zone 3
   silently re-tagged the one slot each time, and Available Inventory showed
   a single position instead of three (ticket, 27 Sep 2026). */
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

/* The owners a slot can be given in this release (ticket, 27 Sep 2026). */
const OFFERED_OWNERS: SlotOwner[] = ['internal', 'advertiser']

interface Ctx {
  partners: Partner[]
  advertiserOpen: (i: number) => boolean
  setSlot: (i: number, patch: Partial<Slot>) => void
  zones: ZoneOption[]
  scopeZoneId: string | null
}
interface Row { i: number; slot: Slot }
/* Stable grid context; cells read the latest values through it. */
interface GridCtx { current: Ctx }

/* The DSPs a sellable position is assigned to, and the first one, for colour. */
const partnersOf = (ctx: Ctx, sl: Slot) =>
  sl.owner === 'advertiser' ? assignedOf(sl).partnerIds.flatMap((id) => ctx.partners.filter((p) => p.id === id)) : []
const brokenPartners = (ctx: Ctx, sl: Slot) => partnersOf(ctx, sl).filter((p) => p.status !== 'connected')
const partnerColour = (p: Partner | undefined) => (p ? providerDef(p.provider)?.colour ?? ADVERTISER_COLOUR : ADVERTISER_COLOUR)
const zoneName = (ctx: Ctx, sl: Slot) => (sl.zoneId ? ctx.zones.find((z) => z.id === sl.zoneId)?.name ?? null : null)
/* Tagged to a different zone than the one whose playlist this table sits under. */
const otherZone = (ctx: Ctx, sl: Slot) => (ctx.scopeZoneId && sl.zoneId && sl.zoneId !== ctx.scopeZoneId ? zoneName(ctx, sl) ?? sl.zoneId : null)
const lockedTip = (zone: string) => `Tagged to ${zone}. Edit it under ${zone}’s playlist, or set its zone there.`

const NotConnected = () => (
  <div className="flex items-center gap-[3px]" style={{ fontSize: 10.5, color: T.error }}>
    <Icon name="error" size={11} />Not connected
  </div>
)

function LabelCell({ data, context: grid }: ICellRendererParams<Row, unknown, GridCtx>) {
  if (!data) return null
  const context = grid.current
  return <div className="w-full min-w-0"><Input size="small" aria-label={`Slot ${data.i + 1} label`} disabled={!!otherZone(context, data.slot)} value={data.slot.label} onChange={(e) => context.setSlot(data.i, { label: e.target.value })} /></div>
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
  const locked = otherZone(context, data.slot)
  return (
    <div className="w-full min-w-0" title={locked ? lockedTip(locked) : undefined}>
      <Select
        size="small"
        className="w-full"
        aria-label={`Slot ${data.i + 1} zone`}
        disabled={!!locked}
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
  const locked = otherZone(context, data.slot)
  /* A slot saved as Stores before this release dropped it keeps showing it, greyed out. */
  const owners = OFFERED_OWNERS.includes(data.slot.owner) ? OFFERED_OWNERS : [...OFFERED_OWNERS, data.slot.owner]
  return (
    <div className="w-full min-w-0" title={locked ? lockedTip(locked) : undefined}>
    <Select
      size="small"
      className="w-full"
      aria-label={`Slot ${data.i + 1} owner`}
      disabled={!!locked}
      value={data.slot.owner}
      onChange={(v: SlotOwner) => context.setSlot(data.i, {
        ...ownerChange(v),
        /* Made Advertiser under a zone's playlist: it's that zone's position. */
        ...(v === 'advertiser' && context.scopeZoneId && !data.slot.zoneId ? { zoneId: context.scopeZoneId } : {}),
      })}
      options={owners.map((k) => {
        const unsupported = !OFFERED_OWNERS.includes(k)
        const closed = k === 'advertiser' && !context.advertiserOpen(data.i)
        const disabled = unsupported || closed
        return {
          value: k, disabled,
          title: unsupported ? `${SLOT_OWNERS[k].label} slots aren’t supported in this release.`
            : closed ? 'Enable DSP Integration (DSP Integration → Exchange settings) to add an Advertiser slot.' : undefined,
          label: <span style={{ color: disabled ? T.disabled : SLOT_OWNERS[k].colour }}>{SLOT_OWNERS[k].label}</span>,
        }
      })}
      labelRender={() => <span style={{ color: o.colour }}>{o.label}</span>}
    />
    </div>
  )
}

export function SlotAssignment({ slots, setSlots, partners, advertiserOpen, onFixConnection, tip, zones = [], scopeZoneId = null }: {
  slots: Slot[]
  /* An updater, run against the latest slots: every zone's table on the
     page edits this one array, so a value computed from this render's
     `slots` could undo an edit made elsewhere since. */
  setSlots: (fn: (prev: Slot[]) => Slot[]) => void
  partners: Partner[]
  advertiserOpen: (i: number) => boolean
  onFixConnection: (partnerId: string) => void
  tip: string
  /* This display type's zones (multi-zone layout), so a slot can be tagged
     to one — empty/omitted on a single-zone display type, which just hides
     the Zone column below. */
  zones?: ZoneOption[]
  /* The zone whose playlist this table sits under, if any. */
  scopeZoneId?: string | null
}) {
  const ctx: Ctx = { partners, advertiserOpen, zones, scopeZoneId, setSlot: (i, patch) => setSlots((prev) => prev.map((s, k) => (k === i ? { ...s, ...patch } : s))) }
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
          const zone = zones.length ? zoneName(ctx, sl) : null
          return (
            <div key={i} data-testid={`slot-card-${i + 1}`} className="rounded-md px-2.5 py-1.5"
              style={{ border: `1px ${rtb ? 'dashed' : 'solid'} ${bad ? T.error : col}`, background: o.bg, minWidth: 96 }}>
              <div style={{ fontSize: 10.5, color: T.micro }}>Slot {i + 1}</div>
              <div className="flex items-center gap-1" style={{ fontSize: 12, color: bad ? T.error : col, fontWeight: 500 }}>
                <Icon name={ps.length ? providerDef(ps[0].provider)?.icon ?? o.icon : o.icon} size={13} />{o.label}
              </div>
              <div style={{ fontSize: 11, color: bad ? T.error : T.muted, marginTop: 2 }}>{ownerAssignment(sl, partners)}</div>
              {zone && <div className="flex items-center gap-[3px]" style={{ fontSize: 10.5, color: T.micro, marginTop: 2 }}><Icon name="grid_view" size={11} />{zone}</div>}
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
