/* Mock bidder: answers OpenRTB 2.6 bid requests the way a DSP's bidder
   would. Each bid comes from one of the DSP's seats (seatbid[].seat) and one
   of its advertisers (adomain, cat, crid). The creative is served at iurl,
   so the exchange can retrieve an unknown creative and queue it for
   approval. Testers change the behaviour through /_control/{dsp}/bidder. */
import { deflateSync, crc32 } from 'node:zlib'
import type { FastifyPluginAsync } from 'fastify'
import type { DspKey, MockAdvertiser, MockStore } from './state'

/* IAB content categories (1.0) for the mock advertisers' categories. */
export const IAB_CODES: Record<string, string> = {
  'Food & Drink': 'IAB8', 'Health & Fitness': 'IAB7', Beauty: 'IAB18-1', Retail: 'IAB22', 'Family & Parenting': 'IAB6',
  Automotive: 'IAB2', Finance: 'IAB13', Travel: 'IAB20',
}

interface BidRequest {
  id: string
  imp?: { id: string; bidfloor?: number; video?: { w?: number; h?: number }; banner?: { w?: number; h?: number } }[]
  cur?: string[]
}

const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/* A solid-colour PNG of the requested size: a real, viewable creative. */
export function solidPng(w: number, h: number, rgb: [number, number, number]) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const row = Buffer.alloc(1 + w * 3)
  for (let x = 0; x < w; x++) row.set(rgb, 1 + x * 3)
  const raw = Buffer.concat(Array.from({ length: h }, () => row))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const colourOf = (s: string): [number, number, number] => {
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return [60 + (h % 150), 60 + ((h >> 8) % 150), 60 + ((h >> 16) % 150)]
}

export const bidderRoutes = (store: MockStore, dsp: DspKey): FastifyPluginAsync => async (app) => {
  const s = () => store.state[dsp]

  /* POST {bidder endpoint}: one bid per impression, or 204 No Content. */
  app.post<{ Body: BidRequest }>('/openrtb2/bid', async (req, reply) => {
    const b = s().bidder
    const imp = req.body?.imp?.[0]
    const adv: MockAdvertiser | undefined = s().advertisers.find((a) => a.id === b.advertiserId) ?? s().advertisers[0]
    if (b.mode === 'no_bid' || !imp || !adv) return reply.status(204).send()
    const size = imp.video ?? imp.banner ?? {}
    const crid = b.crid || `crid-${adv.id}`
    const price = b.mode === 'below_floor' ? Math.round((imp.bidfloor ?? 0) * 50) / 100 : b.priceCpm
    return {
      id: req.body.id,
      cur: req.body.cur?.[0] ?? adv.currency,
      seatbid: [{
        seat: adv.seatId,
        bid: [{
          id: `${req.body.id}-1`, impid: imp.id, price, crid,
          adomain: [b.adomain || adv.domain].filter(Boolean),
          cat: adv.categories.map((c) => IAB_CODES[c]).filter(Boolean),
          iurl: `${req.protocol}://${req.host}${req.url.replace(/openrtb2\/bid$/, '')}creatives/${encodeURIComponent(crid)}.png?w=${size.w ?? 1920}&h=${size.h ?? 1080}`,
          w: size.w, h: size.h,
        }],
      }],
    }
  })

  /* The creative behind a crid, at the requested size. */
  app.get<{ Params: { file: string }; Querystring: { w?: string; h?: string } }>('/creatives/:file', async (req, reply) => {
    const w = Math.min(Math.max(Number(req.query.w) || 1920, 1), 8000)
    const h = Math.min(Math.max(Number(req.query.h) || 1080, 1), 8000)
    return reply.type('image/png').send(solidPng(w, h, colourOf(req.params.file)))
  })
}
