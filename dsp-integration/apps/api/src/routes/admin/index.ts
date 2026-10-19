/* The Admin API (/api/admin/v1): what the HQ Admin screens call. Each
   section's routes live in their own file here and are registered in this
   one plugin; http/app.ts mounts it under the prefix and its onRequest hook
   gives every request the HQ Admin session first (POC_ROLE in the POC,
   SessionSource on integration). Only ever on the INTERNAL ingress
   (deploy/kubernetes/base/ingress.yaml): the POC session has no
   authentication of its own. The test-only routes exist only outside
   production (config.testEndpoints). */
import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import type { Guards } from '../../http/app'
import { advertiserRoutes } from './advertisers'
import { advertiserSettingsRoutes } from './advertiserSettings'
import { bookingScheduleRoutes } from './bookingSchedule'
import { bookingCapacityRoutes } from './bookingCapacity'
import { buyersListRoutes } from './buyersLists'
import { campaignRoutes } from './campaigns'
import { displayTypeRoutes } from './displayTypes'
import { exchangeRoutes } from './exchange'
import { lostRevenueRoutes } from './lostRevenue'
import { unsoldReportRoutes } from './unsoldReport'
import { targetingVariableRoutes } from './targetingVariables'
import { partnerRoutes } from './partners'
import { playlistRoutes } from './playlists'
import { sessionRoutes } from './session'
import { sspAuditLogRoutes } from './sspAuditLog'
import { testRoutes } from './test'
import { userRoutes } from './users'

export const adminRoutes = (ctx: Context, guards: Guards): FastifyPluginAsync => async (app) => {
  await app.register(sessionRoutes(ctx, guards))
  await app.register(displayTypeRoutes(ctx, guards))
  await app.register(playlistRoutes(ctx, guards))
  await app.register(partnerRoutes(ctx, guards))
  await app.register(advertiserSettingsRoutes(ctx, guards))
  await app.register(buyersListRoutes(ctx, guards))
  await app.register(advertiserRoutes(ctx, guards))
  await app.register(userRoutes(ctx, guards))
  await app.register(bookingScheduleRoutes(ctx, guards))
  await app.register(bookingCapacityRoutes(ctx, guards))
  await app.register(exchangeRoutes(ctx, guards))
  await app.register(sspAuditLogRoutes(ctx, guards))
  await app.register(lostRevenueRoutes(ctx, guards))
  await app.register(unsoldReportRoutes(ctx, guards))
  await app.register(targetingVariableRoutes(ctx, guards))
  await app.register(campaignRoutes(ctx, guards))
  if (ctx.config.testEndpoints) await app.register(testRoutes(ctx, guards))
}
