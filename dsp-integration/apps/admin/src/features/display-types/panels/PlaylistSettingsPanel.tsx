/* PLAYLIST SETTINGS panel (spec §1). How these settings drive playback is
   unchanged; Slot assignment (flag-gated) decides who may fill each slot. */
import type { DisplayType, Partner } from '@ph-dsp/types'
import { CollapsiblePanel } from '../../../shared/CollapsiblePanel'
import { Field } from '../../../shared/Field'
import { SummaryChip } from '../../../shared/SummaryChip'
import { DefaultSelect } from '../DefaultSelect'
import {
  ASSET_FILLS, ASSET_POSITIONS, AUTO_PLAY, AUTO_ROTATION, CAMPAIGN_TRANSITIONS, DEFAULTS, ROTATION_CAPS,
  capValue, isCapped, playlistSummary, ps, resizeSlots, slotsOf, type PlaylistSettings,
} from '../model'
import { TIPS } from '../tooltips'
import { SlotAssignment } from './SlotAssignment'

export function PlaylistSettingsPanel({ d, update, open, onToggle, slotAssignment, advertiserOpen, partners, onFixConnection }: {
  d: DisplayType
  update: (fn: (d: DisplayType) => DisplayType) => void
  open: boolean
  onToggle: () => void
  slotAssignment: boolean
  advertiserOpen: (i: number) => boolean
  partners: Partner[]
  onFixConnection: (partnerId: string) => void
}) {
  const s = ps(d)
  const setSetting = (k: keyof PlaylistSettings, v: string | number | null) => update((t) => ({ ...t, playlistSettings: { ...ps(t), [k]: v } }))
  const setCap = (v: string | null) => {
    const n = v === null ? null : v === 'Unlimited' ? -1 : Number(v)
    update((t) => {
      const next = { ...t, playlistSettings: { ...ps(t), maximumCampaignsPlayedInRotation: n } }
      /* Slot ownership follows the cap; hidden (and left alone) with the flag off. */
      if (!slotAssignment) return next
      const count = n === null || n === -1 ? 0 : n
      return { ...next, phExtensions: { ...(t.phExtensions ?? { slots: [] }), slots: resizeSlots(slotsOf(t), count) } }
    })
  }
  const unlimited = DEFAULTS.maximumCampaignsPlayedInRotation === -1 ? 'Unlimited' : String(DEFAULTS.maximumCampaignsPlayedInRotation)

  return (
    <CollapsiblePanel
      title="Playlist Settings"
      open={open}
      onToggle={onToggle}
      summary={playlistSummary(d, slotAssignment).map(({ key, ...c }) => <SummaryChip key={key} {...c} />)}
    >
      <div className="mb-3.5 grid grid-cols-2 gap-3.5">
        <Field label="Asset Position" htmlFor="assetPosition">
          <DefaultSelect id="assetPosition" value={s.assetPosition} onChange={(v) => setSetting('assetPosition', v)} fallback={DEFAULTS.assetPosition} options={ASSET_POSITIONS} />
        </Field>
        <Field label="Asset Fill" htmlFor="assetFill">
          <DefaultSelect id="assetFill" value={s.assetFill} onChange={(v) => setSetting('assetFill', v)} fallback={DEFAULTS.assetFill} options={ASSET_FILLS} />
        </Field>
        <Field label="Maximum Campaigns Played In Rotation" htmlFor="maxCampaigns">
          <DefaultSelect id="maxCampaigns" value={capValue(d)} onChange={setCap} fallback={unlimited} options={ROTATION_CAPS} />
        </Field>
        <Field label="Campaign Transition" htmlFor="campaignTransition">
          <DefaultSelect id="campaignTransition" value={s.campaignTransition} onChange={(v) => setSetting('campaignTransition', v)} fallback={DEFAULTS.campaignTransition} options={CAMPAIGN_TRANSITIONS} />
        </Field>
      </div>
      {slotAssignment && isCapped(d) && (
        <SlotAssignment
          slots={slotsOf(d)}
          setSlots={(slots) => update((t) => ({ ...t, phExtensions: { ...(t.phExtensions ?? {}), slots } }))}
          partners={partners}
          advertiserOpen={advertiserOpen}
          onFixConnection={onFixConnection}
          tip={TIPS.slotAssignment}
        />
      )}
      <div className="grid grid-cols-2 gap-3.5">
        <Field label="Campaign Auto-Rotation" htmlFor="autoRotation">
          <DefaultSelect id="autoRotation" value={s.campaignAutoRotation} onChange={(v) => setSetting('campaignAutoRotation', v)} fallback={DEFAULTS.campaignAutoRotation} options={AUTO_ROTATION} />
        </Field>
        <Field label="Campaign Auto-Play" htmlFor="autoPlay">
          <DefaultSelect id="autoPlay" value={s.campaignAutoPlay} onChange={(v) => setSetting('campaignAutoPlay', v)} fallback={DEFAULTS.campaignAutoPlay} options={AUTO_PLAY} />
        </Field>
      </div>
    </CollapsiblePanel>
  )
}
