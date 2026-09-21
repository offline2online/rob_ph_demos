/* MULTI-ZONE LAYOUT panel (spec §1): each zone runs its own playlist. Zone
   playlists ("<Display Type> / Zone N") are created on demand and applied
   with Save changes. */
import { Button, Input, InputNumber, Select, Switch } from 'antd'
import type { DisplayType } from '@ph-dsp/types'
import { CollapsiblePanel } from '../../../shared/CollapsiblePanel'
import { Icon } from '../../../shared/Icon'
import { WithTip } from '../../../shared/InfoTip'
import { SummaryChip } from '../../../shared/SummaryChip'
import { T } from '../../../theme/phTheme'
import { ZONE_COLOURS, mz, zonesSummary, type Zone } from '../model'
import { TIPS } from '../tooltips'

const Small = ({ children }: { children: string }) => <div className="mb-0.5" style={{ fontSize: 11, color: T.muted }}>{children}</div>

export function MultiZonePanel({ d, update, open, onToggle, playlistOptions, zonePlaylistId }: {
  d: DisplayType
  update: (fn: (d: DisplayType) => DisplayType) => void
  open: boolean
  onToggle: () => void
  playlistOptions: { value: string; label: string }[]
  /* Id of the "<Display Type> / Zone n" playlist, creating a draft one if needed. */
  zonePlaylistId: (n: number) => string
}) {
  const { enabled, zones } = mz(d)
  const W = d.displayCanvasSize.width || 1
  const H = d.displayCanvasSize.height || 1
  const setZones = (z: Zone[]) => update((t) => ({ ...t, multiZone: { ...mz(t), zones: z } }))
  const setZone = (i: number, patch: Partial<Zone>) => setZones(zones.map((z, k) => (k === i ? { ...z, ...patch } : z)))
  const zone = (i: number, n: number, x: number, width: number): Zone => ({ id: `z${i + 1}`, name: `Zone ${i + 1}`, x, y: 0, width, height: 100, playlistId: zonePlaylistId(n) })

  return (
    <CollapsiblePanel title="Multi-Zone Layout" open={open} onToggle={onToggle} summary={zonesSummary(d).map(({ key, ...c }) => <SummaryChip key={key} {...c} />)}>
      <div className="flex items-center justify-between" style={{ marginBottom: enabled ? 14 : 0 }}>
        <WithTip tip={TIPS.enableZones}><span style={{ fontSize: 13.5 }}>Enable zones</span></WithTip>
        <Switch
          aria-label="Enable zones"
          checked={enabled}
          onChange={(v) => {
            /* Zone playlists are created before the state update, never inside it. */
            const next = v && zones.length === 0 ? [zone(0, 1, 0, 50), zone(1, 2, 50, 50)] : zones
            update((t) => ({ ...t, multiZone: { enabled: v, zones: next } }))
          }}
        />
      </div>
      {enabled && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <span className="mr-1" style={{ fontSize: 12, color: T.muted }}>Quick split:</span>
            {[2, 3, 4, 6].map((n) => (
              <Button key={n} size="small" onClick={() => setZones(Array.from({ length: n }, (_, i) => zone(i, i + 1, +(i * (100 / n)).toFixed(1), +(100 / n).toFixed(1))))}>{n}</Button>
            ))}
          </div>
          {zones.map((z, i) => (
            <div key={z.id} className="mb-2 rounded-md border p-2.5" style={{ borderColor: T.borderSubtle }} aria-label={z.name}>
              <div className="mb-2 flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: ZONE_COLOURS[i % 6] }} />
                <Input size="small" aria-label="Zone name" value={z.name} onChange={(e) => setZone(i, { name: e.target.value })} className="flex-1" />
                {zones.length > 1 && (
                  <Button type="text" size="small" aria-label={`Remove ${z.name}`} icon={<Icon name="close" size={16} style={{ color: T.muted }} />} onClick={() => setZones(zones.filter((_, k) => k !== i))} />
                )}
              </div>
              <div className="mb-2 grid grid-cols-4 gap-1.5">
                <div><Small>X %</Small><InputNumber size="small" className="w-full" aria-label="X %" value={z.x} onChange={(v) => setZone(i, { x: Number(v ?? 0) })} /></div>
                <div><Small>Y %</Small><InputNumber size="small" className="w-full" aria-label="Y %" value={z.y} onChange={(v) => setZone(i, { y: Number(v ?? 0) })} /></div>
                <div><Small>Width px</Small><InputNumber size="small" className="w-full" aria-label="Width px" value={Math.round((z.width / 100) * W)} onChange={(v) => setZone(i, { width: (Number(v ?? 0) / W) * 100 })} /></div>
                <div><Small>Height px</Small><InputNumber size="small" className="w-full" aria-label="Height px" value={Math.round((z.height / 100) * H)} onChange={(v) => setZone(i, { height: (Number(v ?? 0) / H) * 100 })} /></div>
              </div>
              <Small>Playlist</Small>
              <Select size="small" className="w-full" aria-label="Zone playlist" value={z.playlistId} onChange={(v) => setZone(i, { playlistId: v })} options={playlistOptions} />
            </div>
          ))}
          <Button color="primary" variant="outlined" size="small" icon={<Icon name="add" size={15} />}
            onClick={() => setZones([...zones, { id: `z${Date.now()}`, name: `Zone ${zones.length + 1}`, x: 0, y: 0, width: 25, height: 100, playlistId: zonePlaylistId(zones.length + 1) }])}>
            Add zone
          </Button>
        </>
      )}
    </CollapsiblePanel>
  )
}
