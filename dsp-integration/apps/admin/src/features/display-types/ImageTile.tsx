/* Display Type Image (ticket RXZD8UN3ZhZ9qAU5T1YN): the tile beside Display Preview and
   the "Update picture" dialog, as in production HQ Admin — cropper with zoom,
   rotate and delete, then a drop zone for a replacement. The cropped result is
   a PNG/JPEG data URL held on the display type (imageUrl) and saved with the page. */
import { Button, Modal } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../shared/Icon'
import { T } from '../../theme/phTheme'

const VIEW_W = 420
const VIEW_H = 280
const OUT_W = 480
const MAX_CHARS = 400 * 1024
const ACCEPT = ['image/png', 'image/jpeg']

export function DisplayTypeThumb({ src, size = 28 }: { src?: string | null; size?: number }) {
  return src ? (
    <img src={src} alt="" width={size} height={size} style={{ width: size, height: size, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
  ) : (
    <span className="inline-flex items-center justify-center" style={{ width: size, height: size, borderRadius: 4, background: T.primaryTint, flexShrink: 0 }}>
      <Icon name="desktop_windows" size={Math.round(size * 0.65)} style={{ color: T.micro }} />
    </span>
  )
}

export function ImageTile({ d, onChange }: { d: { imageUrl?: string | null; displayCanvasSize: { width: number; height: number } }; onChange: (url: string | null) => void }) {
  const [open, setOpen] = useState(false)
  const aspect = clampAspect(d.displayCanvasSize.width / (d.displayCanvasSize.height || 1))
  const h = 150
  return (
    <div>
      <div className="mb-2.5 uppercase" style={{ fontSize: 12, color: T.micro, letterSpacing: '0.5px' }}>Display Type Image</div>
      <div
        data-testid="display-type-image"
        className="flex items-center justify-center overflow-hidden rounded-md border"
        style={{ width: Math.round(h * aspect), height: h, maxWidth: 260, borderColor: T.border, background: '#fafafa' }}
      >
        {d.imageUrl ? <img src={d.imageUrl} alt="Display type" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Icon name="desktop_windows" size={44} style={{ color: T.micro }} />}
      </div>
      <Button type="link" className="!px-0" onClick={() => setOpen(true)}>Update Picture</Button>
      {open && <PictureDialog current={d.imageUrl ?? null} aspect={aspect} onCancel={() => setOpen(false)} onSave={(u) => { onChange(u); setOpen(false) }} />}
    </div>
  )
}

const clampAspect = (a: number) => Math.min(2.5, Math.max(0.4, Number.isFinite(a) && a > 0 ? a : 1.6))

interface Xf { zoom: number; rot: number; x: number; y: number }
const START: Xf = { zoom: 1, rot: 0, x: 0, y: 0 }

function frameOf(aspect: number) {
  const maxW = VIEW_W - 40
  const maxH = VIEW_H - 40
  const w = Math.min(maxW, maxH * aspect)
  return { w, h: w / aspect }
}

/* Draw the image so it covers the crop frame at zoom 1, then apply zoom,
   rotation and pan about the frame centre. `k` scales frame pixels to canvas pixels. */
function paint(ctx: CanvasRenderingContext2D, img: HTMLImageElement, f: { w: number; h: number }, xf: Xf, k: number, ox: number, oy: number) {
  const rotated = xf.rot % 180 !== 0
  const iw = rotated ? img.naturalHeight : img.naturalWidth
  const ih = rotated ? img.naturalWidth : img.naturalHeight
  const base = Math.max(f.w / iw, f.h / ih)
  ctx.save()
  ctx.translate(ox + (f.w / 2 + xf.x) * k, oy + (f.h / 2 + xf.y) * k)
  ctx.rotate((xf.rot * Math.PI) / 180)
  const s = base * xf.zoom * k
  ctx.drawImage(img, (-img.naturalWidth * s) / 2, (-img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s)
  ctx.restore()
}

function PictureDialog({ current, aspect, onCancel, onSave }: { current: string | null; aspect: number; onCancel: () => void; onSave: (url: string | null) => void }) {
  const [src, setSrc] = useState<string | null>(current)
  const [removed, setRemoved] = useState(false)
  const [picked, setPicked] = useState(false)
  const [xf, setXf] = useState<Xf>(START)
  const [error, setError] = useState<string | null>(null)
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null)
  const frame = frameOf(aspect)
  const fx = (VIEW_W - frame.w) / 2
  const fy = (VIEW_H - frame.h) / 2

  useEffect(() => {
    if (!src) { setImg(null); return }
    const i = new Image()
    i.onload = () => setImg(i)
    i.onerror = () => setError("That image couldn't be read.")
    i.src = src
  }, [src])

  useEffect(() => {
    const c = canvas.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    ctx.clearRect(0, 0, VIEW_W, VIEW_H)
    if (!img) return
    paint(ctx, img, frame, xf, 1, fx, fy)
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    ctx.beginPath()
    ctx.rect(0, 0, VIEW_W, VIEW_H)
    ctx.rect(fx, fy, frame.w, frame.h)
    ctx.fill('evenodd')
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2
    ctx.strokeRect(fx, fy, frame.w, frame.h)
  }, [img, xf, frame.w, frame.h, fx, fy])

  const changed = removed ? picked : xf.zoom !== 1 || xf.rot !== 0 || xf.x !== 0 || xf.y !== 0 || picked
  const canSave = removed && !picked ? !!current : !!img && changed

  const take = (file: File | undefined) => {
    if (!file) return
    if (!ACCEPT.includes(file.type)) { setError('Choose a PNG or JPEG image.'); return }
    const r = new FileReader()
    r.onload = () => { setError(null); setSrc(String(r.result)); setRemoved(false); setPicked(true); setXf(START) }
    r.readAsDataURL(file)
  }

  const save = () => {
    if (removed && !picked) { onSave(null); return }
    if (!img) return
    const out = document.createElement('canvas')
    const k = OUT_W / frame.w
    out.width = OUT_W
    out.height = Math.round(frame.h * k)
    const ctx = out.getContext('2d')
    if (!ctx) return
    paint(ctx, img, frame, xf, k, 0, 0)
    let url = out.toDataURL('image/png')
    for (let q = 0.85; url.length > MAX_CHARS && q > 0.3; q -= 0.15) url = out.toDataURL('image/jpeg', q)
    if (url.length > MAX_CHARS) { setError('That image is too large. Try a smaller one.'); return }
    onSave(url)
  }

  const tool = (icon: string, label: string, fn: () => void, danger = false) => (
    <Button type="text" danger={danger} aria-label={label} title={label} icon={<Icon name={icon} size={20} />} onClick={fn} />
  )
  const picking = removed || !src

  return (
    <Modal
      open
      title="Update picture (Delete current image to upload a new image)"
      width={VIEW_W + 48}
      onCancel={onCancel}
      footer={[
        <Button key="cancel" onClick={onCancel}>Cancel</Button>,
        <Button key="save" type="primary" disabled={!canSave} onClick={save}>Save</Button>,
      ]}
    >
      {picking ? (
        <label
          className="flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed"
          style={{ width: VIEW_W, height: VIEW_H, borderColor: T.border, color: T.muted }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); take(e.dataTransfer.files[0]) }}
        >
          <div className="mb-1 font-medium" style={{ color: T.text }}>Select a new picture</div>
          <Icon name="upload" size={32} style={{ color: T.micro }} />
          <div>Drop image here or <span style={{ color: T.primary }}>Browse</span></div>
          <input type="file" accept="image/*,.jpeg,.png" aria-label="Browse for an image" hidden onChange={(e) => take(e.target.files?.[0])} />
        </label>
      ) : (
        <>
          <canvas
            ref={canvas}
            data-testid="cropper"
            width={VIEW_W}
            height={VIEW_H}
            className="rounded-md"
            style={{ width: VIEW_W, height: VIEW_H, touchAction: 'none', cursor: 'move', backgroundColor: '#fff', backgroundImage: 'conic-gradient(#e5e7eb 25%, #fff 0 50%, #e5e7eb 0 75%, #fff 0)', backgroundSize: '16px 16px' }}
            onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); drag.current = { px: e.clientX, py: e.clientY, x: xf.x, y: xf.y } }}
            onPointerMove={(e) => { const g = drag.current; if (g) setXf((v) => ({ ...v, x: g.x + e.clientX - g.px, y: g.y + e.clientY - g.py })) }}
            onPointerUp={() => { drag.current = null }}
          />
          <div className="mt-2 flex items-center gap-1">
            {tool('zoom_in', 'Zoom in', () => setXf((v) => ({ ...v, zoom: Math.min(4, +(v.zoom + 0.25).toFixed(2)) })))}
            {tool('zoom_out', 'Zoom out', () => setXf((v) => ({ ...v, zoom: Math.max(1, +(v.zoom - 0.25).toFixed(2)) })))}
            {tool('rotate_left', 'Rotate left', () => setXf((v) => ({ ...v, rot: (v.rot + 270) % 360 })))}
            {tool('rotate_right', 'Rotate right', () => setXf((v) => ({ ...v, rot: (v.rot + 90) % 360 })))}
            {tool('delete', 'Delete', () => { setRemoved(true); setPicked(false); setSrc(null); setImg(null) }, true)}
          </div>
        </>
      )}
      {error && <div role="alert" className="mt-2" style={{ color: '#d92d20', fontSize: 12 }}>{error}</div>}
    </Modal>
  )
}
