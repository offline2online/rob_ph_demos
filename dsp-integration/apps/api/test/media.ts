/* Synthetic creative files for the asset-check tests: the smallest valid
   headers the checks read (PNG IHDR, JPEG SOF0, MP4 moov/mvhd/tkhd). */
const box = (type: string, ...parts: Buffer[]) => {
  const body = Buffer.concat(parts)
  const head = Buffer.alloc(8)
  head.writeUInt32BE(8 + body.length, 0)
  head.write(type, 4, 'latin1')
  return Buffer.concat([head, body])
}

export function png(w: number, h: number, pad = 0) {
  const ihdr = Buffer.alloc(25)
  ihdr.writeUInt32BE(13, 0)
  ihdr.write('IHDR', 4, 'latin1')
  ihdr.writeUInt32BE(w, 8)
  ihdr.writeUInt32BE(h, 12)
  ihdr[16] = 8
  ihdr[17] = 2
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr, Buffer.alloc(pad)])
}

export function jpeg(w: number, h: number) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00])
  const sof = Buffer.alloc(19)
  sof.writeUInt16BE(0xffc0, 0)
  sof.writeUInt16BE(17, 2)
  sof[4] = 8
  sof.writeUInt16BE(h, 5)
  sof.writeUInt16BE(w, 7)
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])])
}

export function mp4(w: number, h: number, durationSec: number, pad = 0) {
  const mvhd = Buffer.alloc(100)
  mvhd.writeUInt32BE(1000, 12)
  mvhd.writeUInt32BE(Math.round(durationSec * 1000), 16)
  const tkhd = Buffer.alloc(84)
  tkhd.writeUInt32BE(w * 65536, 76)
  tkhd.writeUInt32BE(h * 65536, 80)
  return Buffer.concat([
    box('ftyp', Buffer.from('isom\0\0\x02\0isomiso2mp41', 'latin1')),
    box('moov', box('mvhd', mvhd), box('trak', box('tkhd', tkhd))),
    box('mdat', Buffer.alloc(pad)),
  ])
}

/* A multipart/form-data body for app.inject. */
export function multipart(fields: Record<string, string>, file?: { name: string; bytes: Buffer; type?: string }) {
  const boundary = '----phtest' + Math.random().toString(16).slice(2)
  const parts: Buffer[] = []
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`))
  if (file) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type ?? 'application/octet-stream'}\r\n\r\n`), file.bytes, Buffer.from('\r\n'))
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`))
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } }
}
