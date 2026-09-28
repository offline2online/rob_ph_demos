/* Maximum Campaigns Played In Rotation and slot assignment, for one display
   type or zone a playlist is assigned to (spec §1, §6). These stay per
   assignment rather than moving to the playlist with the rest of Playlist
   Settings (26 Sep 2026): a position is sold per display type × slot
   (PH-CORE-BOUNDARIES.md), so a shared playlist can be capped — and have its
   slots owned — differently on each screen it fills. Edited here, inside a
   playlist's expanded row on Playlist Management, and on the Display Types
   form while a display type is still being created (ticket, 28 Sep 2026).

   `zoneId` is the zone this assignment fills, when it is a zone's playlist:
   the cap is then that zone's own (each zone runs its own rotation), and the
   table edits that zone's own segment of the display type's slots (ticket,
   28 Sep 2026). A zoned display type's default playlist carries the layout,
   not a rotation, so it has neither. */
import type { DisplayType, Partner } from '@ph-dsp/types'
import { Field } from '../../shared/Field'
import { T } from '../../theme/phTheme'
import { DefaultSelect } from '../display-types/DefaultSelect'
import { capOf, capValueFor, DEFAULTS, isCappedFor, isZoned, mz, normaliseSlots, ROTATION_CAPS, slotIndicesFor, slotsOf, zoneOf } from '../display-types/model'
import { SlotAssignment } from '../display-types/panels/SlotAssignment'
import { TIPS } from '../display-types/tooltips'

export function PlaylistCapSlotsFields({ d, update, slotAssignment, advertiserOpen, partners, onFixConnection, zoneId = null }: {
  d: DisplayType
  zoneId?: string | null
  update: (fn: (t: DisplayType) => DisplayType) => void
  slotAssignment: boolean
  /* Whether slot `i` (an index into the display type's whole slot list) may
     be made an Advertiser slot. */
  advertiserOpen: (i: number) => boolean
  partners: Partner[]
  onFixConnection: (partnerId: string) => void
}) {
  const zone = zoneOf(d, zoneId)
  if (!zone && isZoned(d)) {
    const n = mz(d).zones.length
    return (
      <div style={{ fontSize: 12.5, color: T.muted }}>
        This playlist lays out {n} zone{n === 1 ? '' : 's'}. Each zone’s own playlist sets its Maximum Campaigns Played In Rotation and slot assignment.
      </div>
    )
  }
  const setCap = (v: string | null) => {
    const n = v === null ? null : v === 'Unlimited' ? -1 : Number(v)
    update((t) => {
      const next: DisplayType = zone
        ? { ...t, multiZone: { ...mz(t), zones: mz(t).zones.map((z) => (z.id === zone.id ? { ...z, maximumCampaignsPlayedInRotation: n } : z)) } as unknown as DisplayType['multiZone'] }
        : { ...t, playlistSettings: { ...capOf(t), maximumCampaignsPlayedInRotation: n } }
      /* Slots follow the cap; hidden (and left alone) with the flag off. */
      return slotAssignment ? normaliseSlots(next) : next
    })
  }
  const unlimited = DEFAULTS.maximumCampaignsPlayedInRotation === -1 ? 'Unlimited' : String(DEFAULTS.maximumCampaignsPlayedInRotation)
  const indices = slotIndicesFor(d, zone ? zone.id : null)
  const id = `maxCampaigns-${d.id}${zone ? `-${zone.id}` : ''}`

  return (
    <>
      <Field label="Maximum Campaigns Played In Rotation" htmlFor={id} className="mb-3.5">
        <DefaultSelect id={id} value={capValueFor(d, zone ? zone.id : null)} onChange={setCap} fallback={unlimited} options={ROTATION_CAPS} />
      </Field>
      {slotAssignment && isCappedFor(d, zone ? zone.id : null) && (
        <SlotAssignment
          slots={indices.map((i) => slotsOf(d)[i])}
          /* `fn` runs against the latest slots inside `update`'s own
             functional draft update — the same display type can be edited
             from several tables on one page (one per zone), so the array
             this component rendered with may be a step behind. Only this
             assignment's own segment is handed to `fn`; the rest is kept. */
          setSlots={(fn) => update((t) => {
            const idx = slotIndicesFor(t, zone ? zone.id : null)
            const all = [...slotsOf(t)]
            const next = fn(idx.map((i) => all[i]))
            idx.forEach((i, k) => { all[i] = next[k] })
            return { ...t, phExtensions: { ...(t.phExtensions ?? {}), slots: all } }
          })}
          partners={partners}
          advertiserOpen={(k) => advertiserOpen(indices[k])}
          onFixConnection={onFixConnection}
          tip={TIPS.slotAssignment}
        />
      )}
    </>
  )
}
