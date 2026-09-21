/* Sample bookings, so the booking schedule and the revenue tables have
   something in them (Rob, 21 Sep). One approved and activated campaign per
   advertiser a connected DSP brings, and a few play windows each — some
   reserved at an agreed price, some won at auction.

   Data-driven and additive: it books whatever advertiser positions and DSP
   seats the database actually has, skips anything it has already written,
   and never touches a window someone else has taken. `seed()` runs it on a
   fresh database; `npm run db:bookings` adds them to one that is already
   running. */
import { randomUUID } from 'node:crypto'
import { advertiserSlug } from '@ph-dsp/types'
import type { Context } from '../context'
import { allPositions, nextWindow, windowMs } from '../domain/positions'

const money = [120, 135, 150, 165, 180, 195]

const svg = (w: number, h: number, bg: string, brand: string) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="${bg}"/>` +
    `<text x="50%" y="55%" fill="#fff" font-family="Helvetica, Arial, sans-serif" font-size="${Math.round(h / 8)}" font-weight="700" text-anchor="middle">${brand}</text></svg>`)

const CHECKS = (w: number, h: number) => [
  { name: 'file_type' as const, passed: true, detail: 'SVG image' },
  { name: 'file_size' as const, passed: true, detail: 'Under the 10 MB limit' },
  { name: 'dimensions' as const, passed: true, detail: `${w}×${h} matches the canvas` },
  { name: 'aspect_ratio' as const, passed: true, detail: `${(w / h).toFixed(2)} matches the canvas` },
  { name: 'baseline_present' as const, passed: true },
  { name: 'targeting_permitted' as const, passed: true },
]
const COLOURS = ['#1b5e20', '#b3261e', '#0b4f6c', '#4a148c', '#8d6e00', '#37474f']

/* A campaign the advertiser could really have booked with: approved, and
   switched on. Returns the id, or null if the advertiser already has one. */
async function campaignFor(ctx: Context, brand: { advertiserId: string; name: string; partnerId: string; displayTypeId: string }, colour: string, width: number, height: number) {
  const id = `c_seed_${brand.advertiserId}`
  if (ctx.campaigns.getCampaign(id)) return id
  ctx.db.prepare(
    `INSERT INTO campaigns (id, name, targeting, created_at, source, advertiser_id, partner_id, display_type_id, pricing_type, activation_enabled, brief)
     VALUES (?, ?, ?, ?, 'api', ?, ?, ?, 'localised', 0, ?)`,
  ).run(
    id, `${brand.name} — always on`, JSON.stringify({ baseline: { pricingType: 'localised' } }), new Date().toISOString(),
    brand.advertiserId, brand.partnerId, brand.displayTypeId,
    JSON.stringify({ details: `${brand.name}'s standing booking across the estate.`, objective: 'Increase Revenue / Sales', touchPoints: ['Digital Signage'] }),
  )
  const file = ctx.assets.put(svg(width, height, colour, brand.name), '.svg')
  ctx.db.prepare("INSERT INTO campaign_assets (id, campaign_id, version, role, file, mime_type, width, height, size_bytes, created_at) VALUES (?, ?, 1, 'baseline', ?, 'image/svg+xml', ?, ?, 1024, ?)")
    .run(randomUUID(), id, file, width, height, new Date().toISOString())
  await ctx.approvals.submit(id, CHECKS(width, height), brand.name)
  /* Auto-approved already when the advertiser doesn't need approval. */
  if ((await ctx.approvals.statusOf(id)) === 'awaiting_approval') await ctx.approvals.approve(id, 'v1', 'HQ Admin (POC)')
  await ctx.approvalCampaigns.setActivation(id, true)
  return id
}

export async function seedBookings(ctx: Context) {
  const positions = allPositions(ctx)
  const brands = ctx.partners.list()
    .filter((p) => p.status === 'connected')
    .flatMap((p) => p.seats.map((s) => ({ partnerId: p.id, name: s.name, advertiserId: advertiserSlug(s.name), live: p.mode === 'live' })))
  if (!positions.length || !brands.length) return 0

  const len = windowMs(ctx)
  const first = nextWindow(ctx).getTime()
  const currency = ctx.company.get().currency
  let written = 0

  for (const [b, brand] of brands.entries()) {
    const position = positions[b % positions.length]
    const dt = position.displayType
    /* Booked revenue is CPM × assumed views, so a position nobody has scored
       yet would book for nothing. 412 viewers a window per display is the
       figure the Menu Board is seeded with (API.md's example bid request). */
    if (!ctx.audience.forSlot(dt.id, position.slot).assumedViewsPerWindow) {
      const displays = Math.max(1, ctx.displays.listByDisplayType(dt.id).length)
      ctx.db.prepare('INSERT INTO audience_vacd (display_type_id, slot, assumed_views_per_window, counted) VALUES (?, ?, ?, 0)')
        .run(dt.id, position.slot, displays * 412)
    }
    const campaignId = await campaignFor(
      ctx, { ...brand, displayTypeId: dt.id },
      COLOURS[b % COLOURS.length], dt.displayCanvasSize.width, dt.displayCanvasSize.height,
    )
    /* Three windows each. Each advertiser starts a window later than the
       one before and steps forward by the number of advertisers, so two of
       them sharing a position never want the same window. */
    for (let n = 0; n < 3; n++) {
      const offset = b + n * brands.length
      const start = new Date(first + offset * len).toISOString()
      const id = `res_seed_${brand.advertiserId}_${n}`
      if (ctx.reservations.get(id)) continue
      /* Never step on a window that is already sold. */
      if (ctx.reservations.forWindow(position.positionId, start).some((r) => !r.testMode && ['won', 'reserved'].includes(r.status))) continue
      const cpm = money[(b + n) % money.length]
      ctx.reservations.insert({
        id, partnerId: brand.partnerId, advertiserId: brand.advertiserId, campaignId, positionId: position.positionId, windowStart: start,
        /* A mix of both ways in: reserved at an agreed price, or won at auction. */
        type: n === 0 ? 'reserve' : 'bid', channel: n === 0 ? 'api' : 'openrtb',
        bidCpm: cpm, currency, status: n === 0 ? 'reserved' : 'won', clearingCpm: cpm, reason: null,
        testMode: false, pricingType: 'localised', handedOffAt: new Date().toISOString(),
      })
      ctx.campaigns.bookSlot({
        id: `bk_seed_${brand.advertiserId}_${n}`, campaignId, displayTypeId: dt.id, slot: position.slot,
        windowStart: start, windowEnd: new Date(Date.parse(start) + len).toISOString(),
      })
      written++
    }
  }
  return written
}
