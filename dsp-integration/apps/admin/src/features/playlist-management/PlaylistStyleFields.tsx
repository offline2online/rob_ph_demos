/* A playlist's own settings (spec §1, moved here from the display type 26
   Sep 2026): Asset Position, Asset Fill, Campaign Auto-Rotation, Campaign
   Auto-Play and Campaign Transition — Auto-Rotation/Auto-Play ordered
   between Asset Fill and Campaign Transition (26 Sep 2026 ticket) so they
   read below the asset fields and above rotation/transition, matching where
   Maximum Campaigns Played In Rotation sits next (PlaylistCapSlotsFields,
   rendered after this block). Kept on the playlist itself — one block,
   shown once regardless of how many display types the playlist is assigned
   to, or none — so it can be set up before a playlist is ever assigned. */
import type { Playlist } from '@ph-dsp/types'
import { Field } from '../../shared/Field'
import { DefaultSelect } from '../display-types/DefaultSelect'
import { ASSET_FILLS, ASSET_POSITIONS, AUTO_PLAY, AUTO_ROTATION, CAMPAIGN_TRANSITIONS, DEFAULTS, styleOf, type PlaylistStyleSettings } from '../display-types/model'

export function PlaylistStyleFields({ p, update, readOnly }: {
  p: Playlist
  update: (fn: (p: Playlist) => Playlist) => void
  /* Preview only, no editing (Display Types' inline block for a playlist
     still being created, ticket 27 Sep 2026) — the same fields and layout,
     disabled, since editing them is Playlist Management's job once the
     playlist actually exists. */
  readOnly?: boolean
}) {
  const s = styleOf(p)
  const set = (k: keyof PlaylistStyleSettings, v: string | null) => update((cur) => ({ ...cur, playlistSettings: { ...styleOf(cur), [k]: v } }))
  return (
    <div className="grid grid-cols-2 gap-3.5">
      <Field label="Asset Position" htmlFor={`assetPosition-${p.id}`}>
        <DefaultSelect id={`assetPosition-${p.id}`} disabled={readOnly} value={s.assetPosition} onChange={(v) => set('assetPosition', v)} fallback={DEFAULTS.assetPosition} options={ASSET_POSITIONS} />
      </Field>
      <Field label="Asset Fill" htmlFor={`assetFill-${p.id}`}>
        <DefaultSelect id={`assetFill-${p.id}`} disabled={readOnly} value={s.assetFill} onChange={(v) => set('assetFill', v)} fallback={DEFAULTS.assetFill} options={ASSET_FILLS} />
      </Field>
      <Field label="Campaign Auto-Rotation" htmlFor={`autoRotation-${p.id}`}>
        <DefaultSelect id={`autoRotation-${p.id}`} disabled={readOnly} value={s.campaignAutoRotation} onChange={(v) => set('campaignAutoRotation', v)} fallback={DEFAULTS.campaignAutoRotation} options={AUTO_ROTATION} />
      </Field>
      <Field label="Campaign Auto-Play" htmlFor={`autoPlay-${p.id}`}>
        <DefaultSelect id={`autoPlay-${p.id}`} disabled={readOnly} value={s.campaignAutoPlay} onChange={(v) => set('campaignAutoPlay', v)} fallback={DEFAULTS.campaignAutoPlay} options={AUTO_PLAY} />
      </Field>
      <Field label="Campaign Transition" htmlFor={`campaignTransition-${p.id}`}>
        <DefaultSelect id={`campaignTransition-${p.id}`} disabled={readOnly} value={s.campaignTransition} onChange={(v) => set('campaignTransition', v)} fallback={DEFAULTS.campaignTransition} options={CAMPAIGN_TRANSITIONS} />
      </Field>
    </div>
  )
}
