/* Display Preview (prototype Preview): the canvas fitted into 300×320, zones
   and phantom zone drawn to scale. Decision 1: no Idle/Connected toggle. */
import { PLATFORM_DEFAULTS, type DisplayType } from '@ph-dsp/types'
import { Icon } from '../../shared/Icon'
import { T } from '../../theme/phTheme'
import { ZONE_COLOURS, mz, qr } from './model'

const BOX_W = 300
const BOX_H = 320

export function Preview({ d, playlistName }: { d: DisplayType; playlistName: (id: string | undefined) => string }) {
  const W = d.displayCanvasSize.width || 1
  const H = d.displayCanvasSize.height || 1
  const aspect = W / H
  const width = Math.min(BOX_W, Math.round(BOX_H * aspect))
  const height = Math.max(60, Math.round(width / aspect))
  const q = qr(d)
  const phantomOn = !!q.phantomArea?.enabled
  const showQR = phantomOn && q.enabled
  const pw = ((q.phantomArea?.width ?? 0) / W) * 100
  const ph = ((q.phantomArea?.height ?? 0) / H) * 100
  const pos = q.phantomArea?.position || PLATFORM_DEFAULTS.phantomAreaPosition
  const place: Record<string, React.CSSProperties> = {
    'Bottom Right': { right: '1.5%', bottom: '4%' }, 'Bottom Left': { left: '1.5%', bottom: '4%' },
    'Top Right': { right: '1.5%', top: '4%' }, 'Top Left': { left: '1.5%', top: '4%' },
    Center: { left: `${50 - pw / 2}%`, top: `${50 - ph / 2}%` },
  }
  const zones = mz(d)

  return (
    <div>
      <div className="mb-2.5 uppercase" style={{ fontSize: 12, color: T.micro, letterSpacing: '0.5px' }}>Display Preview</div>
      <div
        data-testid="display-preview"
        className="relative overflow-hidden rounded-md border"
        style={{ width, height, background: d.backgroundColor, borderColor: T.border }}
      >
        {zones.enabled ? (
          zones.zones.map((z, i) => (
            <div
              key={z.id}
              className="absolute flex flex-col items-center justify-center overflow-hidden p-[3px] text-center"
              style={{ left: `${z.x}%`, top: `${z.y}%`, width: `${z.width}%`, height: `${z.height}%`, border: `2px dashed ${ZONE_COLOURS[i % 6]}`, background: `${ZONE_COLOURS[i % 6]}1a` }}
            >
              <div style={{ color: '#fff', fontSize: 10, fontWeight: 600 }}>{z.name}</div>
              <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 8.5, marginTop: 2 }}>{Math.round((z.width / 100) * W)}×{Math.round((z.height / 100) * H)}px</div>
              <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 8, marginTop: 1 }}>{playlistName(z.playlistId)}</div>
            </div>
          ))
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: 500 }}>{playlistName(d.defaultPlaylistId)}</div>
            <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, marginTop: 4 }}>single zone · full canvas</div>
          </div>
        )}
        {phantomOn && (
          <div
            className="absolute flex flex-col items-center justify-center rounded"
            style={{ ...place[pos], width: `${pw}%`, height: `${ph}%`, minWidth: 22, minHeight: 22, background: showQR ? '#fff' : 'rgba(255,255,255,0.14)', border: showQR ? 'none' : '1px dashed rgba(255,255,255,0.5)', boxShadow: showQR ? '0 2px 8px rgba(0,0,0,0.35)' : 'none' }}
          >
            {showQR ? (
              <Icon name="qr_code_2" size={Math.max(14, Math.min(34, ((q.qrCode?.size ?? 100) / W) * width * 1.6))} style={{ color: q.qrCode?.colour }} />
            ) : (
              <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 9 }}>phantom</span>
            )}
          </div>
        )}
      </div>
      <div className="mt-3" style={{ fontSize: 12, color: T.muted, maxWidth: BOX_W, lineHeight: 1.6 }}>
        {W} × {H} · {zones.enabled ? `${zones.zones.length} zones` : 'single zone'} · {phantomOn ? (showQR ? 'phantom zone with QR control' : 'phantom zone defined, QR control off') : 'no phantom zone'}
      </div>
    </div>
  )
}
