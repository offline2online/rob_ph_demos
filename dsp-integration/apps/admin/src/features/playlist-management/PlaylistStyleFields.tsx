/* A playlist's own settings (spec §1, moved here from the display type 26
   Sep 2026): Asset Position, Asset Fill, Campaign Transition, Campaign
   Auto-Rotation and Campaign Auto-Play. Kept on the playlist itself — one
   block, shown once regardless of how many display types the playlist is
   assigned to, or none — so it can be set up before a playlist is ever
   assigned. Maximum Campaigns Played In Rotation and slot assignment are
   still per assignment: see PlaylistCapSlotsFields. */
import type { Playlist } from '@ph-dsp/types'
import { Field } from '../../shared/Field'
import { DefaultSelect } from '../display-types/DefaultSelect'
import { ASSET_FILLS, ASSET_POSITIONS, AUTO_PLAY, AUTO_ROTATION, CAMPAIGN_TRANSITIONS, DEFAULTS, styleOf, type PlaylistStyleSettings } from '../display-types/model'

export function PlaylistStyleFields({ p, update }: {
  p: Playlist
  update: (fn: (p: Playlist) => Playlist) => void
}) {
  const s = styleOf(p)
  const set = (k: keyof PlaylistStyleSettings, v: string | null) => update((cur) => ({ ...cur, playlistSettings: { ...styleOf(cur), [k]: v } }))
  return (
    <div className="grid grid-cols-2 gap-3.5">
      <Field label="Asset Position" htmlFor={`assetPosition-${p.id}`}>
        <DefaultSelect id={`assetPosition-${p.id}`} value={s.assetPosition} onChange={(v) => set('assetPosition', v)} fallback={DEFAULTS.assetPosition} options={ASSET_POSITIONS} />
      </Field>
      <Field label="Asset Fill" htmlFor={`assetFill-${p.id}`}>
        <DefaultSelect id={`assetFill-${p.id}`} value={s.assetFill} onChange={(v) => set('assetFill', v)} fallback={DEFAULTS.assetFill} options={ASSET_FILLS} />
      </Field>
      <Field label="Campaign Transition" htmlFor={`campaignTransition-${p.id}`}>
        <DefaultSelect id={`campaignTransition-${p.id}`} value={s.campaignTransition} onChange={(v) => set('campaignTransition', v)} fallback={DEFAULTS.campaignTransition} options={CAMPAIGN_TRANSITIONS} />
      </Field>
      <Field label="Campaign Auto-Rotation" htmlFor={`autoRotation-${p.id}`}>
        <DefaultSelect id={`autoRotation-${p.id}`} value={s.campaignAutoRotation} onChange={(v) => set('campaignAutoRotation', v)} fallback={DEFAULTS.campaignAutoRotation} options={AUTO_ROTATION} />
      </Field>
      <Field label="Campaign Auto-Play" htmlFor={`autoPlay-${p.id}`}>
        <DefaultSelect id={`autoPlay-${p.id}`} value={s.campaignAutoPlay} onChange={(v) => set('campaignAutoPlay', v)} fallback={DEFAULTS.campaignAutoPlay} options={AUTO_PLAY} />
      </Field>
    </div>
  )
}
