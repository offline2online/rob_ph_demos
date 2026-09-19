/* Reads what the automated asset checks need (type, dimensions, duration)
   straight from the file's bytes: PNG, JPEG and MP4. The type is sniffed
   from the content, never taken from the file name or the client. */

export type MediaKind = 'png' | 'jpeg' | 'mp4'
export interface MediaInfo {
  kind: MediaKind
  mimeType: string
  width: number | null
  height: number | null
  /* Seconds; video only. */
  durationSec: number | null
}

const MIME: Record<MediaKind, string> = { png: 'image/png', jpeg: 'image/jpeg', mp4: 'video/mp4' }
export const EXTENSION: Record<MediaKind, string> = { png: '.png', jpeg: '.jpg', mp4: '.mp4' }
export const isVideo = (k: MediaKind) => k === 'mp4'

export function sniff(b: Buffer): MediaKind | null {
  if (b.length >= 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a) return 'png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (b.length >= 12 && b.toString('latin1', 4, 8) === 'ftyp') return 'mp4'
  return null
}

function png(b: Buffer) {
  if (b.length < 24 || b.toString('latin1', 12, 16) !== 'IHDR') return { width: null, height: null }
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
}

/* The first start-of-frame marker carries the frame size. */
function jpeg(b: Buffer) {
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return { width: null, height: null }
    const marker = b[i + 1]
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2
      continue
    }
    const len = b.readUInt16BE(i + 2)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) }
    }
    i += 2 + len
  }
  return { width: null, height: null }
}

/* ISO BMFF boxes: [size:4][type:4], size 1 = 64-bit size follows, 0 = to the end. */
function* boxes(b: Buffer, start: number, end: number): Generator<{ type: string; body: number; end: number }> {
  let i = start
  while (i + 8 <= end) {
    let size = b.readUInt32BE(i)
    const type = b.toString('latin1', i + 4, i + 8)
    let header = 8
    if (size === 1) {
      if (i + 16 > end) return
      size = Number(b.readBigUInt64BE(i + 8))
      header = 16
    } else if (size === 0) size = end - i
    if (size < header || i + size > end) return
    yield { type, body: i + header, end: i + size }
    i += size
  }
}
const child = (b: Buffer, start: number, end: number, type: string) => {
  for (const x of boxes(b, start, end)) if (x.type === type) return x
  return null
}

function mp4(b: Buffer) {
  const out = { width: null as number | null, height: null as number | null, durationSec: null as number | null }
  const moov = child(b, 0, b.length, 'moov')
  if (!moov) return out
  const mvhd = child(b, moov.body, moov.end, 'mvhd')
  if (mvhd) {
    const v1 = b[mvhd.body] === 1
    const ts = v1 ? mvhd.body + 20 : mvhd.body + 12
    if (ts + (v1 ? 12 : 8) <= mvhd.end) {
      const timescale = b.readUInt32BE(ts)
      const duration = v1 ? Number(b.readBigUInt64BE(ts + 4)) : b.readUInt32BE(ts + 4)
      if (timescale > 0) out.durationSec = Math.round((duration / timescale) * 1000) / 1000
    }
  }
  /* The video track is the one whose track header has a size. */
  for (const trak of boxes(b, moov.body, moov.end)) {
    if (trak.type !== 'trak') continue
    const tkhd = child(b, trak.body, trak.end, 'tkhd')
    if (!tkhd || tkhd.end - 8 < tkhd.body) continue
    const w = b.readUInt32BE(tkhd.end - 8) / 65536
    const h = b.readUInt32BE(tkhd.end - 4) / 65536
    if (w > 0 && h > 0) {
      out.width = Math.round(w)
      out.height = Math.round(h)
      break
    }
  }
  return out
}

export function readMedia(b: Buffer): MediaInfo | null {
  const kind = sniff(b)
  if (!kind) return null
  if (kind === 'png') return { kind, mimeType: MIME.png, durationSec: null, ...png(b) }
  if (kind === 'jpeg') return { kind, mimeType: MIME.jpeg, durationSec: null, ...jpeg(b) }
  return { kind, mimeType: MIME.mp4, ...mp4(b) }
}
