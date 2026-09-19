import type { FastifyPluginAsync } from 'fastify'
import type { Context } from '../../context'
import type { Guards } from '../../http/app'
import { advertiserRoutes } from './advertisers'
import { advertiserSettingsRoutes } from './advertiserSettings'
import { campaignRoutes } from './campaigns'
import { displayTypeRoutes } from './displayTypes'
import { exchangeRoutes } from './exchange'
import { targetingVariableRoutes } from './targetingVariables'
import { partnerRoutes } from './partners'
import { playlistRoutes } from './playlists'
import { sessionRoutes } from './session'

export const adminRoutes = (ctx: Context, guards: Guards): FastifyPluginAsync => async (app) => {
  await app.register(sessionRoutes(ctx, guards))
  await app.register(displayTypeRoutes(ctx, guards))
  await app.register(playlistRoutes(ctx, guards))
  await app.register(partnerRoutes(ctx, guards))
  await app.register(advertiserSettingsRoutes(ctx, guards))
  await app.register(advertiserRoutes(ctx, guards))
  await app.register(exchangeRoutes(ctx, guards))
  await app.register(targetingVariableRoutes(ctx, guards))
  await app.register(campaignRoutes(ctx, guards))
}
