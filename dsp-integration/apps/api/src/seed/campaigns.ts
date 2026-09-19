/* Seeded advertiser campaigns for the approval demo (stand-in POC campaign
   table): one per approval state. Creative is a generated SVG at the target
   canvas size, written to the AssetStore. */
import { randomUUID } from 'node:crypto'
import type { Context } from '../context'
import type { StoredTargeting } from '../domain/targetingSummary'

const svg = (w: number, h: number, bg: string, brand: string, line: string) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="${bg}"/>` +
    `<text x="50%" y="45%" fill="#fff" font-family="Helvetica, Arial, sans-serif" font-size="${Math.round(h / 8)}" font-weight="700" text-anchor="middle">${brand}</text>` +
    `<text x="50%" y="60%" fill="#fff" font-family="Helvetica, Arial, sans-serif" font-size="${Math.round(h / 18)}" text-anchor="middle">${line}</text></svg>`)

const PASSED = (w: number, h: number) => [
  { name: 'file_type' as const, passed: true, detail: 'SVG image' },
  { name: 'file_size' as const, passed: true, detail: 'Under the 20 MB limit' },
  { name: 'dimensions' as const, passed: true, detail: `${w}×${h} matches the canvas` },
  { name: 'aspect_ratio' as const, passed: true, detail: `${(w / h).toFixed(2)} matches the canvas` },
  { name: 'baseline_present' as const, passed: true },
  { name: 'targeting_permitted' as const, passed: true },
]

export async function seedCampaigns(ctx: Context) {
  const insert = ctx.db.prepare(
    `INSERT INTO campaigns (id, name, targeting, created_at, source, advertiser_id, partner_id, display_type_id, pricing_type, activation_enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
  )
  const asset = (campaignId: string, w: number, h: number, bg: string, brand: string, line: string) => {
    const file = ctx.assets.put(svg(w, h, bg, brand, line), '.svg')
    ctx.db.prepare("INSERT INTO campaign_assets (id, campaign_id, version, role, file, mime_type, width, height, size_bytes, created_at) VALUES (?, ?, 1, 'baseline', ?, 'image/svg+xml', ?, ?, 1024, ?)")
      .run(randomUUID(), campaignId, file, w, h, '2026-09-15T09:00:00.000Z')
  }
  const targeting: StoredTargeting = {
    baseline: { pricingType: 'localised' },
    targeted: [{ id: 'metro-open', priority: 10, pricingType: 'localised', rules: [[{ source: 'store', variable: 'store.fixed_segments', op: 'includes_selected', values: ['Metro'] }], [{ source: 'store', variable: 'store.hours', op: 'equal', values: ['Open'] }]] }],
  }
  const baseline: StoredTargeting = { baseline: { pricingType: 'localised' } }

  insert.run('c_dsp_nestle', 'Nestlé — Winter warmers', JSON.stringify(targeting), '2026-09-15T09:00:00.000Z', 'dsp', 'nestle', 'p_google', 'landscape', 'localised')
  asset('c_dsp_nestle', 1920, 1080, '#b3261e', 'Nestlé', 'Winter warmers')
  insert.run('c_api_swisse', 'Swisse — Spring immunity', JSON.stringify(baseline), '2026-09-16T09:00:00.000Z', 'api', 'swisse', 'p_google', 'portrait', 'localised')
  asset('c_api_swisse', 1080, 1920, '#1b5e20', 'Swisse', 'Spring immunity')
  insert.run('c_dsp_loreal', 'L’Oréal — Revitalift', JSON.stringify(baseline), '2026-09-17T09:00:00.000Z', 'dsp', 'loreal', 'p_amazon', 'landscape', 'localised')
  asset('c_dsp_loreal', 1920, 1080, '#212121', 'L’Oréal', 'Revitalift — A$29.95')
  insert.run('c_api_swisse_kids', 'Swisse — Kids multivitamin', JSON.stringify(baseline), '2026-09-18T09:00:00.000Z', 'api', 'swisse', 'p_google', 'landscape', 'localised')

  /* Nestlé doesn't require approval: approved automatically. */
  await ctx.approvals.submit('c_dsp_nestle', PASSED(1920, 1080), 'Google DSP')
  await ctx.approvalCampaigns.setActivation('c_dsp_nestle', true)
  await ctx.approvals.submit('c_api_swisse', PASSED(1080, 1920), 'Swisse')
  await ctx.approvals.submit('c_dsp_loreal', PASSED(1920, 1080), 'Amazon Ads DSP')
  await ctx.approvals.reject('c_dsp_loreal', 'v1', 'HQ Admin (POC)', 'Price shown in the artwork (A$29.95). Prices come from Personalisation Hub, not the creative.')
}
