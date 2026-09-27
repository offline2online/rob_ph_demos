/* The display type form — one column in reading order (spec "Page layout"):
   preview, Touch Point, name, canvas size, background, default playlist,
   then the collapsed panels, Playlist Settings always last (ticket, 27 Sep
   2026). Playlist Settings itself (including slot assignment) moved to
   Playlist Management, under each playlist, 26 Sep 2026 — editing them
   stays there once the display type exists. The one exception: while a
   display type is still being created, its default playlist is only a
   local, unsaved draft with nowhere else to edit it, so the Playlist
   Settings panel here is genuinely editable in that case, and the Default
   Playlist dropdown above it is hidden — there's nothing to pick between
   yet, since no playlist exists until Save creates one. */
import { Button, ColorPicker, Input, InputNumber, Select } from 'antd'
import { TOUCH_POINTS, type DisplayType, type Playlist } from '@ph-dsp/types'
import { useState } from 'react'
import { Field } from '../../shared/Field'
import { Icon } from '../../shared/Icon'
import { T } from '../../theme/phTheme'
import { EnabledFeaturesPanel } from './panels/EnabledFeaturesPanel'
import { MultiZonePanel } from './panels/MultiZonePanel'
import { PhantomZonePanel } from './panels/PhantomZonePanel'
import { PlaylistSettingsPanel } from './panels/PlaylistSettingsPanel'
import { Preview } from './Preview'

export interface PlaylistOption { id: string; name: string; autoCreatedFor: string | null; playlistSettings?: Record<string, unknown> }

export function DisplayTypeForm({ d, update, playlists, zonePlaylistId, onAddPlaylist, isNewPlaylist, isNewDisplayType, updateDefaultPlaylistSettings }: {
  d: DisplayType
  update: (fn: (d: DisplayType) => DisplayType) => void
  playlists: PlaylistOption[]
  zonePlaylistId: (n: number) => string
  /* Creates a new playlist scoped to this display type and returns its id. */
  onAddPlaylist: () => string
  /* True while a playlist id is still a local, unsaved draft (created via
     "Add new playlist" or "New Display Type") — not yet a real playlist a
     person could open on Playlist Management. */
  isNewPlaylist: (id: string | undefined) => boolean
  /* True while this display type itself hasn't been saved yet — hides the
     Default Playlist dropdown, since there's no playlist to pick between
     until Save creates one (ticket, 27 Sep 2026). */
  isNewDisplayType: boolean
  /* Edits the default playlist's own settings while it is still a local
     draft — a no-op once the display type (and so the playlist) is real,
     since the panel is read-only by then. */
  updateDefaultPlaylistSettings: (fn: (p: Playlist) => Playlist) => void
}) {
  const [open, setOpen] = useState({ phantom: false, features: false, zones: false, playlistSettings: false })
  const toggle = (k: keyof typeof open) => setOpen((o) => ({ ...o, [k]: !o[k] }))
  const playlistName = (id: string | undefined) => playlists.find((p) => p.id === id)?.name ?? '—'
  const set = (patch: Partial<DisplayType>) => update((t) => ({ ...t, ...patch }))
  const defaultPlaylistOption = playlists.find((p) => p.id === d.defaultPlaylistId)
  /* Editable in the Playlist Settings panel whenever the default playlist
     itself is still a local draft — true for a brand-new display type, and
     also for an existing one whose default was just swapped via "+ Add new
     playlist" (there's no Playlist Management row for either yet). The
     Default Playlist dropdown only hides for the former: an existing
     display type still needs it, to pick a different already-saved
     playlist if the new one wasn't wanted after all. */
  const defaultPlaylistIsNew = isNewPlaylist(d.defaultPlaylistId)

  return (
    <div>
      <div className="mb-4"><Preview d={d} playlistName={playlistName} /></div>
      <Field label="Touch Point" htmlFor="touchPoint" className="mb-4">
        <Select
          id="touchPoint"
          className="w-full"
          value={d.touchPoint}
          onChange={(v) => set({ touchPoint: v })}
          options={TOUCH_POINTS.map((t) => ({
            value: t.name,
            label: <span className="inline-flex items-center gap-2"><Icon name={t.icon} size={17} style={{ color: T.primary }} />{t.name}</span>,
          }))}
        />
      </Field>
      <Field label="Display Type Name" required htmlFor="dtName" className="mb-4">
        <Input id="dtName" value={d.name} autoFocus={!d.name} placeholder="Name this display type" status={d.name ? undefined : 'warning'} onChange={(e) => set({ name: e.target.value })} />
      </Field>
      <Field label="Display Canvas Size (Resolution)" required className="mb-4">
        <div className="flex items-center gap-2">
          <span style={{ color: T.muted }}>W</span>
          <InputNumber aria-label="Canvas width" min={1} precision={0} value={d.displayCanvasSize.width} style={{ width: 110 }}
            onChange={(v) => set({ displayCanvasSize: { ...d.displayCanvasSize, width: Number(v ?? 0) } })} />
          <span style={{ color: T.muted }}>H</span>
          <InputNumber aria-label="Canvas height" min={1} precision={0} value={d.displayCanvasSize.height} style={{ width: 110 }}
            onChange={(v) => set({ displayCanvasSize: { ...d.displayCanvasSize, height: Number(v ?? 0) } })} />
        </div>
      </Field>
      <Field label="Background Color" className="mb-4">
        <ColorPicker aria-label="Background Color" value={d.backgroundColor} onChange={(c) => set({ backgroundColor: c.toHexString() })} />
      </Field>
      {/* Hidden while the display type itself is still new (ticket, 27 Sep
          2026): its default playlist is auto-created behind the scenes, so
          there's nothing yet to pick between — the dropdown comes back the
          moment the display type is saved and the playlist is real. */}
      {!isNewDisplayType && (
        <Field
          label="Default Playlist"
          htmlFor="defaultPlaylist"
          /* "Add new playlist" is its own button, top right above the
             dropdown, rather than the dropdown's last option (ticket, 27 Sep
             2026) — so it reads as the way to add a playlist, not as one of
             the playlists to pick. */
          action={(
            <Button color="primary" variant="outlined" size="small" icon={<Icon name="add" size={16} />} onClick={() => set({ defaultPlaylistId: onAddPlaylist() })}>
              Add new playlist
            </Button>
          )}
        >
          <Select
            id="defaultPlaylist"
            className="w-full"
            value={d.defaultPlaylistId}
            onChange={(v) => set({ defaultPlaylistId: v })}
            options={playlists.map((p) => ({ value: p.id, label: `${p.name}${p.autoCreatedFor === d.id ? ' (auto-created)' : ''}` }))}
          />
        </Field>
      )}

      <PhantomZonePanel d={d} update={update} open={open.phantom} onToggle={() => toggle('phantom')} />
      <EnabledFeaturesPanel d={d} update={update} open={open.features} onToggle={() => toggle('features')} />
      <MultiZonePanel d={d} update={update} open={open.zones} onToggle={() => toggle('zones')} zonePlaylistId={zonePlaylistId}
        playlistOptions={playlists.map((p) => ({ value: p.id, label: p.name }))} />
      {/* Always last (ticket, 27 Sep 2026) — editable while the default
          playlist is still a local draft (`defaultPlaylistIsNew`, whether
          because the whole display type is new or because its default was
          just swapped via "+ Add new playlist"); a read-only preview with a
          Playlist Management CTA once it's real. */}
      <PlaylistSettingsPanel
        playlist={defaultPlaylistOption}
        editable={defaultPlaylistIsNew}
        onUpdate={updateDefaultPlaylistSettings}
        open={open.playlistSettings}
        onToggle={() => toggle('playlistSettings')}
      />
    </div>
  )
}
