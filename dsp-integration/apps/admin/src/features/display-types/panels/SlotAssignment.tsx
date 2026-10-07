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
   changes it. Website and Mobile App use this same editor, owner list and
   Advertiser assignment as Digital Signage (ticket 0jviesctpWGyOYtK20tg,
   Rob 7 Oct 2026); that replaced their HQ-only rule and the "Available for
   RTB" switch. Their bid requests still go out as OpenRTB site / app objects.

   On a multi-zone display type this table sits under each zone's own
   playlist and edits that zone's own slots (ticket, 28 Sep 2026) — there is
   no zone to pick per slot, and no other zone's slots showing here. */
import { Alert, Button, Input, Select } from 'antd'
import type { ColDef, ICellRendererParams } from 'ag-grid-community'
import { SLOT_OWNERS, allowsAdvertising, assignedOf, providerDef, type Partner, type Slot, type SlotOwner } from '@ph-dsp/types'
import { useEffect, useMemo, useState } from 'react'
import { Field } from '../../../shared/Field'
import { Grid } from '../../../shared/Grid'
import { Icon } from '../../../shared/Icon'
import { Tip } from '../../../shared/Tip'
import { T } from '../../../theme/phTheme'
import { ownerAssignment, ownerChange } from '../model'

const ADVERTISER_COLOUR = SLOT_OWNERS.advertiser.colour

/* The owners a slot can be given in this release (ticket, 27 Sep 2026). */
const RELEASE_OWNERS: SlotOwner[] = ['internal', 'advertiser']
/* Website and Mobile App are HQ-only (ticket, 28 Sep 2026). Only Headquarters
   is selectable, but — unlike Stores, which stays off the list release-wide
   unless a slot already has it — Advertiser and Stores are always shown,
   greyed out, with their own tooltip ("Advertiser and Stores greyed out
   with a tooltip saying advertising isn't available for this touch point"). */
const HQ_ONLY_OWNERS: SlotOwner[] = ['internal']
const ALL_OWNERS: SlotOwner[] = ['internal', 'advertiser', 'retail']

interface Ctx {
  partners: Partner[]
  advertiserOpen: (i: number) => boolean
  setSlot: (i: number, patch: Partial<Slot>) => void
  /* The owners this display type's touch point actually allows picking —
     narrower than `listedOwners` for Website/Mobile App, where Advertiser
     and Stores are shown but disabled rather than left off the list. */
  offeredOwners: SlotOwner[]
  /* The owners shown in the dropdown at all, before a slot already saved
     with an owner outside that list (e.g. a legacy Stores slot) is added
     back so it keeps reading correctly. */
  listedOwners: SlotOwner[]
  unsupportedTip: (k: SlotOwner) => string
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

/* Edited in local state and committed on blur/Enter: committing every
   keystroke re-renders the row, which remounts this cell and drops focus
   after one character. */
function LabelCell({ data, context: grid }: ICellRendererParams<Row, unknown, GridCtx>) {
  const [text, setText] = useState(data?.slot.label ?? '')
  useEffect(() => { setText(data?.slot.label ?? '') }, [data?.slot.label])
  if (!data) return null
  const context = grid.current
  const commit = () => { if (text !== data.slot.label) context.setSlot(data.i, { label: text }) }
  return (
    <div className="w-full min-w-0">
      <Input size="small" aria-label={`Slot ${data.i + 1} label`} value={text}
        onChange={(e) => setText(e.target.value)} onBlur={commit} onPressEnter={commit} />
    </div>
  )
}

function OwnerCell({ data, context: grid }: ICellRendererParams<Row, unknown, GridCtx>) {
  if (!data) return null
  const context = grid.current
  const o = SLOT_OWNERS[data.slot.owner]
  /* A slot saved as Stores before this release dropped it keeps showing it, greyed out. */
  const owners = context.listedOwners.includes(data.slot.owner) ? context.listedOwners : [...context.listedOwners, data.slot.owner]
  return (
    <div className="w-full min-w-0">
    <Select
      size="small"
      className="w-full"
      aria-label={`Slot ${data.i + 1} owner`}
      value={data.slot.owner}
      onChange={(v: SlotOwner) => context.setSlot(data.i, ownerChange(v))}
      options={owners.map((k) => {
        const unsupported = !context.offeredOwners.includes(k)
        const closed = k === 'advertiser' && !context.advertiserOpen(data.i)
        const disabled = unsupported || closed
        return {
          value: k, disabled,
          title: unsupported ? context.unsupportedTip(k)
            : closed ? 'Enable DSP Integration (DSP Integration → Exchange settings) to add an Advertiser slot.' : undefined,
          label: <span style={{ color: disabled ? T.disabled : SLOT_OWNERS[k].colour }}>{SLOT_OWNERS[k].label}</span>,
        }
      })}
      labelRender={() => <span style={{ color: o.colour }}>{o.label}</span>}
    />
    </div>
  )
}

export function SlotAssignment({ slots, setSlots, partners, advertiserOpen, onFixConnection, tip, touchPoint }: {
  slots: Slot[]
  /* An updater, run against the latest slots: several tables on one page
     can edit the same display type, so a value computed from this render's
     `slots` could undo an edit made elsewhere since. */
  setSlots: (fn: (prev: Slot[]) => Slot[]) => void
  partners: Partner[]
  advertiserOpen: (i: number) => boolean
  onFixConnection: (partnerId: string) => void
  tip: string
  /* Gates which owners are offered at all (ticket, 28 Sep 2026: Website and
     Mobile App are HQ-only). */
  touchPoint: string
}) {
  const hqOnly = !allowsAdvertising(touchPoint)
  const offeredOwners = hqOnly ? HQ_ONLY_OWNERS : RELEASE_OWNERS
  const listedOwners = hqOnly ? ALL_OWNERS : RELEASE_OWNERS
  const unsupportedTip = (k: SlotOwner) => (hqOnly ? 'Advertising isn’t available for this touch point.' : `${SLOT_OWNERS[k].label} slots aren’t supported in this release.`)
  const ctx: Ctx = { partners, advertiserOpen, setSlot: (i, patch) => setSlots((prev) => prev.map((s, k) => (k === i ? { ...s, ...patch } : s))), offeredOwners, listedOwners, unsupportedTip }
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
