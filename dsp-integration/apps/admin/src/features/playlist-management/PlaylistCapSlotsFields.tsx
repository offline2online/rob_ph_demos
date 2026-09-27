/* Maximum Campaigns Played In Rotation and slot assignment, for one display
   type or zone a playlist is assigned to (spec §1, §6). These stay per
   assignment rather than moving to the playlist with the rest of Playlist
   Settings (26 Sep 2026): a position is sold per display type × slot
   (PH-CORE-BOUNDARIES.md), so a shared playlist can be capped — and have its
   slots owned — differently on each screen it fills. Edited here, inside a
   playlist's expanded row on Playlist Management, now that the display
   type's own Playlist Settings block is gone. */
import type { DisplayType, Partner } from '@ph-dsp/types'
import { Field } from '../../shared/Field'
import { DefaultSelect } from '../display-types/DefaultSelect'
import { capOf, capValue, DEFAULTS, isCapped, mz, resizeSlots, ROTATION_CAPS, slotsOf } from '../display-types/model'
import { SlotAssignment } from '../display-types/panels/SlotAssignment'
import { TIPS } from '../display-types/tooltips'

export function PlaylistCapSlotsFields({ d, update, slotAssignment, advertiserOpen, partners, onFixConnection }: {
  d: DisplayType
  update: (fn: (t: DisplayType) => DisplayType) => void
  slotAssignment: boolean
  advertiserOpen: (i: number) => boolean
  partners: Partner[]
  onFixConnection: (partnerId: string) => void
}) {
  const setCap = (v: string | null) => {
    const n = v === null ? null : v === 'Unlimited' ? -1 : Number(v)
    update((t) => {
      const next = { ...t, playlistSettings: { ...capOf(t), maximumCampaignsPlayedInRotation: n } }
      /* Slot ownership follows the cap; hidden (and left alone) with the flag off. */
      if (!slotAssignment) return next
      const count = n === null || n === -1 ? 0 : n
      return { ...next, phExtensions: { ...(t.phExtensions ?? { slots: [] }), slots: resizeSlots(slotsOf(t), count) } }
    })
  }
  const unlimited = DEFAULTS.maximumCampaignsPlayedInRotation === -1 ? 'Unlimited' : String(DEFAULTS.maximumCampaignsPlayedInRotation)

  return (
    <>
      <Field label="Maximum Campaigns Played In Rotation" htmlFor={`maxCampaigns-${d.id}`} className="mb-3.5">
        <DefaultSelect id={`maxCampaigns-${d.id}`} value={capValue(d)} onChange={setCap} fallback={unlimited} options={ROTATION_CAPS} />
      </Field>
      {slotAssignment && isCapped(d) && (
        <SlotAssignment
          slots={slotsOf(d)}
          /* `fn` runs against `t` inside `update`'s own functional draft
             update (ticket, 27 Sep 2026), not against the `d` this
             component was rendered with — the same display type's slots are
             edited from up to four places at once here (its default
             playlist's row plus one per zone), so `d`/`slotsOf(d)` can be a
             render behind by the time a click lands. Building the next
             array from `slotsOf(t)` instead means each edit always starts
             from the true latest slots, however many other edits to this
             same display type landed first. */
          setSlots={(fn) => update((t) => ({ ...t, phExtensions: { ...(t.phExtensions ?? {}), slots: fn(slotsOf(t)) } }))}
          partners={partners}
          advertiserOpen={advertiserOpen}
          onFixConnection={onFixConnection}
          tip={TIPS.slotAssignment}
          zones={mz(d).enabled ? mz(d).zones : []}
        />
      )}
    </>
  )
}
