/* The mock DSP service: each DSP's API under its own base path, plus the
   control API and test page. Point the POC's DSP clients at these base URLs;
   on integration engineering swaps in the real ones. */
import formbody from '@fastify/formbody'
import Fastify from 'fastify'
import { bidderRoutes } from './bidder'
import { controlRoutes } from './control'
import { dv360Routes } from './dv360'
import { controlPage } from './page'
import { MockStore } from './state'

export function buildMocks(store = new MockStore()) {
  const app = Fastify({ logger: false })
  app.register(formbody)
  app.get('/', async (_req, reply) => reply.type('text/html').send(controlPage()))
  app.register(controlRoutes(store), { prefix: '/_control' })
  /* Google: token endpoint (oauth2.googleapis.com) and DV360 API v4 (displayvideo.googleapis.com). */
  app.register(dv360Routes(store), { prefix: '/dv360' })
  /* Each DSP's bidder (OpenRTB 2.6) and the creatives its bids reference. */
  app.register(bidderRoutes(store, 'google_dv360'), { prefix: '/dv360' })
  app.register(bidderRoutes(store, 'amazon_dsp'), { prefix: '/amazon' })
  app.register(bidderRoutes(store, 'the_trade_desk'), { prefix: '/ttd' })
  return { app, store }
}
