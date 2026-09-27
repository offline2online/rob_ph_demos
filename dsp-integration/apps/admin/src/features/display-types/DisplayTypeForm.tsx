/* The display type form — one column in reading order (spec "Page layout"):
   preview, Touch Point, name, canvas size, background, default playlist,
   then the three collapsed panels. Playlist Settings (including slot
   assignment) moved to Playlist Management, under each playlist, 26 Sep
   2026 — editing them stays there, never here. The one exception (ticket,
   27 Sep 2026): while the Default Playlist is still a local, unsaved
   draft — just created via "Add new playlist" and not yet on Playlist
   Management at all — its own settings (what it will actually be created
   with) are shown here as a read-only preview, since there's nowhere else
   to see them before Save (Rob's own follow-up on the ticket: read-only
   here, with the option to open and expand them on Playlist Management —
   not a second, competing editor). The block disappears the moment the
   playlist is actually saved; from then on Playlist Management is the only
   place to edit it. */
import { Button, ColorPicker, Input, InputNumber, Select } from 'antd'
import { TOUCH_POINTS, type DisplayType, type Playlist } from '@ph-dsp/types'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Field } from '../../shared/Field'
import { Icon } from '../../shared/Icon'
import { SectionLabel } from '../../shared/SectionLabel'
import { T } from '../../theme/phTheme'
import { PlaylistStyleFields } from '../playlist-management/PlaylistStyleFields'
import { EnabledFeaturesPanel } from './panels/EnabledFeaturesPanel'
import { MultiZonePanel } from './panels/MultiZonePanel'
import { PhantomZonePanel } from './panels/PhantomZonePanel'
import { Preview } from './Preview'

export interface PlaylistOption { id: string; name: string; autoCreatedFor: string | null; playlistSettings?: Record<string, unknown> }

/* Sentinel Select value for "+ Add new playlist" — never a real playlist id
   (those are always "pl_…"), so it can't collide with one. */
const ADD_NEW_PLAYLIST = '__add_new_playlist__'

export function DisplayTypeForm({ d, update, playlists, zonePlaylistId, onAddPlaylist, isNewPlaylist }: {
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
}) {
  const navigate = useNavigate()
  const [open, setOpen] = useState({ phantom: false, features: false, zones: false })
  const toggle = (k: keyof typeof open) => setOpen((o) => ({ ...o, [k]: !o[k] }))
  const playlistName = (id: string | undefined) => playlists.find((p) => p.id === id)?.name ?? '—'
  const set = (patch: Partial<DisplayType>) => update((t) => ({ ...t, ...patch }))
  const defaultPlaylistOption = playlists.find((p) => p.id === d.defaultPlaylistId)
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
      <Field label="Default Playlist" htmlFor="defaultPlaylist">
        <Select
          id="defaultPlaylist"
          className="w-full"
          value={d.defaultPlaylistId}
          onChange={(v) => set({ defaultPlaylistId: v === ADD_NEW_PLAYLIST ? onAddPlaylist() : v })}
          options={[
            ...playlists.map((p) => ({ value: p.id, label: `${p.name}${p.autoCreatedFor === d.id ? ' (auto-created)' : ''}` })),
            {
              value: ADD_NEW_PLAYLIST,
              label: <span className="inline-flex items-center gap-1.5" style={{ color: T.primary }}><Icon name="add" size={16} />Add new playlist</span>,
            },
          ]}
        />
      </Field>

      {defaultPlaylistIsNew && defaultPlaylistOption && (
        <div className="mt-1 mb-4 overflow-hidden rounded-lg border" style={{ borderColor: '#38b0cf' }}>
          <div className="flex items-start justify-between gap-3 px-3.5 pt-3.5">
            <div>
              <SectionLabel style={{ marginTop: 0, marginBottom: 4 }}>Playlist Settings — {defaultPlaylistOption.name}</SectionLabel>
              <div style={{ fontSize: 12.5, color: T.muted }}>
                This new playlist will be created with these settings. Edit them from Playlist Management once it's been saved.
              </div>
            </div>
            <Button type="text" size="small" className="shrink-0 px-1" onClick={() => navigate('/playlists')}>
              Playlist Management<Icon name="arrow_forward" size={13} />
            </Button>
          </div>
          <div className="px-3.5 pb-3.5 pt-3">
            <PlaylistStyleFields
              readOnly
              p={{
                id: defaultPlaylistOption.id,
                name: defaultPlaylistOption.name,
                autoCreatedFor: defaultPlaylistOption.autoCreatedFor,
                playlistSettings: defaultPlaylistOption.playlistSettings ?? {},
                assignments: [],
              } as Playlist}
              update={() => {}}
            />
          </div>
        </div>
      )}

      <PhantomZonePanel d={d} update={update} open={open.phantom} onToggle={() => toggle('phantom')} />
      <EnabledFeaturesPanel d={d} update={update} open={open.features} onToggle={() => toggle('features')} />
      <MultiZonePanel d={d} update={update} open={open.zones} onToggle={() => toggle('zones')} zonePlaylistId={zonePlaylistId}
        playlistOptions={playlists.map((p) => ({ value: p.id, label: p.name }))} />
    </div>
  )
}
