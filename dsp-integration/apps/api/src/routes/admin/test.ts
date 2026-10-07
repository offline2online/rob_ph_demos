/* Test-only endpoints (E2E Testing Strategy §3.3, ticket 71VbuDn0bnbWYxfztjws).
   Registered only while config.testEndpoints is on — never in production,
   where they answer 404 like any unknown route. They exist so the Run 6
   journey runner can finish L4 (billing) inside one run: it advances
   PH_TEST_CLOCK past the window end, reports plays here, ticks the
   scheduler and asserts the line item. The plays table is PH Core's
   stand-in; on integration the playback store reports plays itself and
   this file is deleted with the stand-in. */
import { randomUUID } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import { findPosition, maxPlayLengthSecFor, windowEndOf } from '../../domain/positions'
import type { Guards } from '../../http/app'
import { tx } from '../../db/db'
import { notFound, validationFailed } from '../../http/errors'
import type { PlayTier } from '../../platform/PlaybackSource'

const TIERS: PlayTier[] = ['default', 'localised', 'personalised']

export interface TestPlaysBody {
  /* The won or reserved reservation whose window the plays fall in. */
  reservationId: string
  /* Plays to write, spread round-robin over the display type's displays and
     evenly through the window. Each entry is one tier. */
  plays: { tier: PlayTier | null; count: number; durationSec?: number; versionId?: string | null; receivedAt?: string | null }[]
}

export const testRoutes = (ctx: Context, guards: Guards): FastifyPluginAsync => async (app) => {
  app.post<{ Body: TestPlaysBody }>('/test/plays', async (req, reply) => {
    guards.flagged()
    guards.requireScope(req, 'admin')
    const b = req.body ?? ({} as TestPlaysBody)
    const errors: { field: string; reason: string }[] = []
    if (!b.reservationId) errors.push({ field: 'reservationId', reason: 'reservationId is required.' })
    if (!Array.isArray(b.plays) || b.plays.length === 0) errors.push({ field: 'plays', reason: 'plays must be a non-empty array.' })
    else b.plays.forEach((p, i) => {
      if (p.tier !== null && !TIERS.includes(p.tier)) errors.push({ field: `plays[${i}].tier`, reason: 'tier is default, localised, personalised or null.' })
      if (!(Number.isInteger(p.count) && p.count > 0 && p.count <= 100_000)) errors.push({ field: `plays[${i}].count`, reason: 'count is an integer from 1 to 100,000.' })
      if (p.durationSec !== undefined && !(typeof p.durationSec === 'number' && p.durationSec > 0)) errors.push({ field: `plays[${i}].durationSec`, reason: 'durationSec is a positive number.' })
      if (p.receivedAt !== undefined && p.receivedAt !== null && !(typeof p.receivedAt === 'string' && Number.isFinite(Date.parse(p.receivedAt)))) errors.push({ field: `plays[${i}].receivedAt`, reason: 'receivedAt is an ISO timestamp, or null.' })
      if (p.versionId !== undefined && p.versionId !== null && !(typeof p.versionId === 'string' && p.versionId.length > 0 && p.versionId.length <= 200)) errors.push({ field: `plays[${i}].versionId`, reason: 'versionId is a string of up to 200 characters, or null.' })
    })
    if (errors.length) throw validationFailed(errors)

    const r = await ctx.reservations.get(b.reservationId)
    if (!r || !r.campaignId) throw notFound('No such reservation, or it carries no campaign.')
    const p = await findPosition(ctx, r.positionId)
    if (!p) throw notFound('The reservation’s position is no longer in the estate.')
    const displays = await ctx.displays.listByDisplayType(p.displayType.id)
    if (displays.length === 0) throw validationFailed([{ field: 'reservationId', reason: 'The display type has no displays to play on.' }])

    const start = Date.parse(r.windowStart)
    const end = await windowEndOf(ctx, r)
    const total = b.plays.reduce((n, x) => n + x.count, 0)
    const step = Math.max(1, Math.floor((end - start) / (total + 1)))
    let i = 0
    /* The version handed off for this window (the booking's asset version,
       eeBT1Qp33GdsPcxG2As3): what every play shows unless a test says otherwise. */
    const booking = (await ctx.campaigns.bookings(r.campaignId)).find((bk) => bk.displayTypeId === p.displayType.id && bk.slot === p.slot && bk.windowStart === r.windowStart)
    const handedOff = booking?.assetVersion ?? null
    const written: { tier: PlayTier | null; count: number; versionId: string | null }[] = []
    const fallbackDur = maxPlayLengthSecFor((await ctx.company.get()).maxPlayLengthSec, p)
    await tx(ctx.db, () => {
      for (const spec of b.plays) {
        const dur = spec.durationSec ?? fallbackDur
        const versionId = spec.versionId === undefined ? handedOff : spec.versionId
        for (let k = 0; k < spec.count; k++, i++) {
          ctx.plays.insertTestPlay({ id: `tp_${randomUUID().slice(0, 12)}`, displayId: displays[i % displays.length].id, campaignId: r.campaignId!, playedAt: new Date(start + (i + 1) * step).toISOString(), durationSec: dur, versionId, tier: spec.tier, receivedAt: spec.receivedAt ? new Date(spec.receivedAt).toISOString() : null })
        }
        written.push({ tier: spec.tier, count: spec.count, versionId })
      }
    }, 'IMMEDIATE')
    return reply.status(201).send({ reservationId: r.id, campaignId: r.campaignId, positionId: r.positionId, windowStart: r.windowStart, windowEnd: new Date(end).toISOString(), displays: displays.length, written, total })
  })
}
