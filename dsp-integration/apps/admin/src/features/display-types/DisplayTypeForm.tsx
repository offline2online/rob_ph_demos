/* The display type form — one column in reading order (spec "Page layout"):
   preview, Touch Point, name, canvas size, background, default playlist,
   then the four collapsed panels. */
import { ColorPicker, Input, InputNumber, Select } from 'antd'
import { TOUCH_POINTS, type AdvertiserSettings, type DisplayType, type Partner } from '@ph-dsp/types'
import { useState } from 'react'
import { Field } from '../../shared/Field'
import { Icon } from '../../shared/Icon'
import { T } from '../../theme/phTheme'
import { EnabledFeaturesPanel } from './panels/EnabledFeaturesPanel'
import { MultiZonePanel } from './panels/MultiZonePanel'
import { PhantomZonePanel } from './panels/PhantomZonePanel'
import { PlaylistSettingsPanel } from './panels/PlaylistSettingsPanel'
import { Preview } from './Preview'

export interface PlaylistOption { id: string; name: string; autoCreatedFor: string | null }

export function DisplayTypeForm({ d, update, playlists, zonePlaylistId, slotAssignment, partners, company, seatsOf, onFixConnection, openPanel }: {
  d: DisplayType
  update: (fn: (d: DisplayType) => DisplayType) => void
  playlists: PlaylistOption[]
  zonePlaylistId: (n: number) => string
  slotAssignment: boolean
  partners: Partner[]
  company: AdvertiserSettings | undefined
  seatsOf: (p: Partner) => string[]
  onFixConnection: (partnerId: string) => void
  openPanel?: string | null
}) {
  /* Opening from Available Inventory's slot lands on Playlist Settings, where
     slot assignment lives (Rob, 20 Sep): /display-types?id=…&panel=playlist. */
  const [open, setOpen] = useState({ playlist: openPanel === 'playlist', phantom: false, features: false, zones: false })
  const toggle = (k: keyof typeof open) => setOpen((o) => ({ ...o, [k]: !o[k] }))
  const playlistName = (id: string | undefined) => playlists.find((p) => p.id === id)?.name ?? '—'
  const set = (patch: Partial<DisplayType>) => update((t) => ({ ...t, ...patch }))

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
          onChange={(v) => set({ defaultPlaylistId: v })}
          options={playlists.map((p) => ({ value: p.id, label: `${p.name}${p.autoCreatedFor === d.id ? ' (auto-created)' : ''}` }))}
        />
      </Field>

      <PlaylistSettingsPanel d={d} update={update} open={open.playlist} onToggle={() => toggle('playlist')} slotAssignment={slotAssignment}
        partners={partners} company={company} seatsOf={seatsOf} onFixConnection={onFixConnection} />
      <PhantomZonePanel d={d} update={update} open={open.phantom} onToggle={() => toggle('phantom')} />
      <EnabledFeaturesPanel d={d} update={update} open={open.features} onToggle={() => toggle('features')} />
      <MultiZonePanel d={d} update={update} open={open.zones} onToggle={() => toggle('zones')} zonePlaylistId={zonePlaylistId}
        playlistOptions={playlists.map((p) => ({ value: p.id, label: p.name }))} />
    </div>
  )
}
