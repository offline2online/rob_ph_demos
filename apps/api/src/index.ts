/* npm run dev:api — the POC API on API_PORT (default 4000). */
import { createContext } from './context'
import { loadEnv } from './env'
import { buildApp } from './http/app'
import { seed } from './seed/seed'
import { startAuctionScheduler, startCampaignRetentionScheduler } from './exchange/scheduler'

loadEnv()
const ctx = createContext()
if (await seed(ctx)) console.log('Seeded an empty database with the prototype sample data.')
const app = buildApp(ctx, { logger: true })
startAuctionScheduler(ctx, (m) => app.log.info(m))
startCampaignRetentionScheduler(ctx, (m) => app.log.info(m))
app.listen({ port: ctx.config.port, host: '127.0.0.1' }).then(() => {
  console.log(`dspIntegration flag: ${ctx.flags.dspIntegration ? 'ON' : 'off'} · role: ${ctx.session.current().role}`)
})
